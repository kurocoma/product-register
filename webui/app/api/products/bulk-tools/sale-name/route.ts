import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseManageNumbers } from "@/lib/migrate";
import {
  buildSaleNamePlans,
  executeBulkPlans,
  summarizeBulk,
  validateSalePhrase,
  type BulkExecItemResult,
  type BulkPlanItem,
  type SaleNameItemInfo,
} from "@/lib/bulk-tools";
import { makeBulkDbDeps, prepareMallClients } from "../deps";

export const runtime = "nodejs";

const MAX_ITEMS = 50;

/** POST = 商品名セール文言（機能3）。
 *
 * body: {
 *   mode: "add" | "remove"          // 追記 / 解除
 *   phrase: string                  // セール文言（商品名の先頭へ「文言＋半角スペース1個」で追記）
 *   manageNumbers: string | string[]
 *   dryRun?: boolean                // 既定 true
 *   payloadHash?: string            // commit 必須
 *   yahooReserve?: boolean
 *   delayMs?: number
 * }
 *
 * 文字数レギュレーション: 楽天=255バイト（全角2/半角1。IE0004 実測確定）・Yahoo=全角75字/文字数75
 * （fitYahooFieldLimits の定数）。違反商品は実行から除外し、警告一覧に超過量を表示する。
 * 解除は先頭からの完全一致（後続スペース含む）で除去。先頭に無い商品はスキップ一覧に出す。
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });

  let body: {
    mode?: unknown;
    phrase?: unknown;
    manageNumbers?: unknown;
    dryRun?: unknown;
    payloadHash?: unknown;
    yahooReserve?: unknown;
    delayMs?: unknown;
  } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* 下の検証で弾く */
  }

  const mode = body.mode === "remove" ? "remove" : body.mode === "add" ? "add" : null;
  if (!mode) {
    return NextResponse.json({ ok: false, error: "mode は add（追記）/ remove（解除）を指定してください" }, { status: 400 });
  }
  const phraseCheck = validateSalePhrase(typeof body.phrase === "string" ? body.phrase : "");
  if (!phraseCheck.ok) {
    return NextResponse.json({ ok: false, error: phraseCheck.error }, { status: 400 });
  }
  const rawManage = body.manageNumbers;
  if (typeof rawManage !== "string" && !Array.isArray(rawManage)) {
    return NextResponse.json(
      { ok: false, error: "manageNumbers（管理番号の配列／改行テキスト／CSV1列）を指定してください" },
      { status: 400 },
    );
  }
  const { valid, invalid, duplicatesRemoved } = parseManageNumbers(rawManage as string | string[]);
  if (valid.length === 0) {
    return NextResponse.json({ ok: false, error: "有効な管理番号がありません", invalid }, { status: 400 });
  }
  if (valid.length > MAX_ITEMS) {
    return NextResponse.json(
      { ok: false, error: `対象が多すぎます(${valid.length}件)。${MAX_ITEMS}件以下に分割してください` },
      { status: 400 },
    );
  }
  const dryRun = body.dryRun !== false;
  const yahooReserve = body.yahooReserve === true;
  const delayMs = typeof body.delayMs === "number" && body.delayMs >= 0 ? body.delayMs : 300;

  const db = makeBulkDbDeps(supabase, user.id);
  let planned;
  try {
    planned = await buildSaleNamePlans(db, valid, { phrase: phraseCheck.phrase, mode });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
  const { plans, infos, payloadHash } = planned;
  const infoByKey = new Map(infos.map((i) => [i.key, i]));

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      payloadHash,
      mode,
      phrase: phraseCheck.phrase,
      results: plans.map((p) => toPlanResponse(p, infoByKey.get(p.key))),
      summary: summarizeBulk(plans),
      invalid,
      duplicatesRemoved,
    });
  }

  if (typeof body.payloadHash !== "string" || body.payloadHash !== payloadHash) {
    return NextResponse.json(
      { ok: false, error: "プレビュー後に商品データまたは入力が変わりました。もう一度プレビューしてください" },
      { status: 409 },
    );
  }
  const clients = await prepareMallClients(plans);
  if (!clients.ok) {
    return NextResponse.json({ ok: false, error: clients.error }, { status: clients.status });
  }
  const { results, reserve } = await executeBulkPlans(
    { ...db, rakuten: clients.rakuten, yahoo: clients.yahoo },
    plans,
    {
      kind: mode === "add" ? "bulk_sale_name_add" : "bulk_sale_name_remove",
      yahooReserve,
      delayMs,
      detail: { phrase: phraseCheck.phrase, mode },
    },
  );
  return NextResponse.json({
    ok: true,
    dryRun: false,
    payloadHash,
    mode,
    phrase: phraseCheck.phrase,
    results: results.map((r) => toCommitResponse(r, infoByKey.get(r.key))),
    summary: summarizeBulk(results),
    reserve,
    invalid,
    duplicatesRemoved,
  });
}

function toPlanResponse(p: BulkPlanItem, info?: SaleNameItemInfo) {
  return {
    key: p.key,
    productId: p.productId,
    status: p.status,
    reason: p.reason,
    before: info?.before ?? p.title,
    after: info?.after,
    violation: info?.violation,
    warnings: p.warnings,
  };
}

function toCommitResponse(r: BulkExecItemResult, info?: SaleNameItemInfo) {
  return {
    key: r.key,
    productId: r.productId,
    status: r.status,
    error: r.error,
    before: info?.before,
    after: info?.after,
    warnings: r.warnings,
    rakuten: r.rakuten ? { ok: r.rakuten.ok, updated: r.rakuten.updated, message: r.rakuten.message } : null,
    yahoo: r.yahoo ? { ok: r.yahoo.ok, updated: r.yahoo.updated, message: r.yahoo.message } : null,
  };
}
