import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  buildJanPricePlans,
  executeBulkPlans,
  parseJanCodes,
  summarizeBulk,
  type BulkExecItemResult,
  type BulkPlanItem,
  type JanPriceEdit,
} from "@/lib/bulk-tools";
import { makeBulkDbDeps, prepareMallClients } from "../deps";

// 楽天 items.get/patch・Yahoo editItem を伴うため Node ランタイム必須
export const runtime = "nodejs";

/** 1リクエストの対象商品上限（超過は分割を促す。sale-support と同じタイムアウト対策）。 */
const MAX_PRODUCTS = 50;
const MAX_JANS = 100;

/** POST = JAN売価変更（機能1）。
 *
 * body: {
 *   jans: string | string[]        // JAN 13桁（改行/カンマ/CSV1列・配列可）
 *   edits?: { productId, variantKey, newNet }[]  // グリッドで入力した新税抜価格（未入力の行はスキップ）
 *   dryRun?: boolean               // 既定 true（プレビュー。書き込みなし）
 *   payloadHash?: string           // commit 必須（プレビューの返り値。値が変わっていたら 409）
 *   yahooReserve?: boolean         // 実行後に Yahoo 反映予約（reservePublish mode=1）を行うか
 *   delayMs?: number
 * }
 *
 * フロー: JAN一致（商品/SKU）で抽出 → 一覧（現在税抜・楽天税込/Yahoo税込）→ 新税抜価格を入力して
 * プレビュー → 実行で DB（upsertProduct）→ 楽天 patch → Yahoo editItem（分割SKUごと）→ 履歴。
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });

  let body: {
    jans?: unknown;
    edits?: unknown;
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

  const rawJans = body.jans;
  if (typeof rawJans !== "string" && !Array.isArray(rawJans)) {
    return NextResponse.json(
      { ok: false, error: "jans（JANコード13桁の配列／改行テキスト／CSV1列）を指定してください" },
      { status: 400 },
    );
  }
  const { valid, invalid, duplicatesRemoved } = parseJanCodes(rawJans as string | string[]);
  if (valid.length === 0) {
    return NextResponse.json({ ok: false, error: "有効なJANコードがありません", invalid }, { status: 400 });
  }
  if (valid.length > MAX_JANS) {
    return NextResponse.json(
      { ok: false, error: `JANが多すぎます(${valid.length}件)。${MAX_JANS}件以下に分割してください` },
      { status: 400 },
    );
  }
  const edits: JanPriceEdit[] = [];
  if (Array.isArray(body.edits)) {
    for (const e of body.edits as { productId?: unknown; variantKey?: unknown; newNet?: unknown }[]) {
      if (typeof e?.productId !== "string" || typeof e?.variantKey !== "string") continue;
      edits.push({ productId: e.productId, variantKey: e.variantKey, newNet: Number(e.newNet) });
    }
  }
  const dryRun = body.dryRun !== false; // 既定 true（安全）
  const yahooReserve = body.yahooReserve === true;
  const delayMs = typeof body.delayMs === "number" && body.delayMs >= 0 ? body.delayMs : 300;

  const db = makeBulkDbDeps(supabase, user.id);
  let planned;
  try {
    planned = await buildJanPricePlans(db, valid, edits);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
  const { rows, plans, payloadHash, notFoundJans } = planned;
  const productCount = new Set(plans.map((p) => p.productId)).size;
  if (productCount > MAX_PRODUCTS) {
    return NextResponse.json(
      {
        ok: false,
        error: `対象商品が多すぎます(${productCount}件)。JANを${MAX_PRODUCTS}商品以下になるよう分割してください`,
      },
      { status: 400 },
    );
  }

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      payloadHash,
      rows,
      results: plans.map(toPlanResponse),
      summary: summarizeBulk(plans),
      invalid,
      notFoundJans,
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
    { kind: "bulk_jan_price", yahooReserve, delayMs, detail: { jans: valid } },
  );
  return NextResponse.json({
    ok: true,
    dryRun: false,
    payloadHash,
    rows,
    results: results.map(toCommitResponse),
    summary: summarizeBulk(results),
    reserve,
    invalid,
    notFoundJans,
    duplicatesRemoved,
  });
}

function toPlanResponse(p: BulkPlanItem) {
  return {
    key: p.key,
    productId: p.productId,
    status: p.status,
    reason: p.reason,
    title: p.title,
    changes: p.changes,
    warnings: p.warnings,
  };
}

function toCommitResponse(r: BulkExecItemResult) {
  return {
    key: r.key,
    productId: r.productId,
    status: r.status,
    error: r.error,
    warnings: r.warnings,
    rakuten: r.rakuten ? { ok: r.rakuten.ok, updated: r.rakuten.updated, message: r.rakuten.message } : null,
    yahoo: r.yahoo ? { ok: r.yahoo.ok, updated: r.yahoo.updated, message: r.yahoo.message } : null,
  };
}
