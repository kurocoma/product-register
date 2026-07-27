import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRakutenCredentialsFromEnv } from "@/lib/rakuten";
import { parseManageNumbers } from "@/lib/migrate";
import {
  buildRestorePlans,
  executeRestore,
  listSsCopies,
  summarize,
  type RestoreItemPlan,
  type SaleSupportItemResult,
} from "@/lib/sale-support";
import { makeSaleSupportDeps } from "../deps";

export const runtime = "nodejs";

/** 上限は apply と同じ理由（QPSペーシング下の1リクエスト所要時間）で 50 件。 */
const MAX_ITEMS = 50;

/** GET = アプリDBに保存済みの -SS コピー一覧（復元タブの選択肢）。 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });

  try {
    const copies = await listSsCopies(supabase, user.id);
    return NextResponse.json({ ok: true, copies });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

/** POST = -SS コピーから元商品を復元する。
 *
 * body: {
 *   ssManageNumbers: string | string[]  // -SS コピーの管理番号
 *   dryRun?: boolean                    // 既定 true（プレビュー）
 *   payloadHash?: string                // commit 必須（プレビューの返り値）
 *   deleteCopy?: boolean                // 既定 false（実行時選択: -SS を削除する/残す）
 *   delayMs?: number                    // item 間待機ms（既定 300）
 * }
 *
 * 書き戻し内容: 各SKUの価格(standardPrice)・二重価格(referencePrice。-SS に無ければ null 送信で解除)・
 * 販売期間(purchasablePeriod。-SS に無ければ null 送信で解除)。いずれも 2026-07-28 実機検証済み。
 * 書き戻し失敗・読み戻し不一致の商品は -SS を削除しない（安全側）。
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });

  let body: {
    ssManageNumbers?: unknown;
    dryRun?: unknown;
    payloadHash?: unknown;
    deleteCopy?: unknown;
    delayMs?: unknown;
  } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* 空ボディは下の検証で弾く */
  }

  const rawList = body.ssManageNumbers;
  if (typeof rawList !== "string" && !Array.isArray(rawList)) {
    return NextResponse.json(
      { ok: false, error: "ssManageNumbers（-SS コピーの管理番号）を指定してください" },
      { status: 400 },
    );
  }
  const dryRun = body.dryRun !== false; // 既定 true（安全）
  const deleteCopy = body.deleteCopy === true; // 既定: 残す（安全）
  const delayMs = typeof body.delayMs === "number" && body.delayMs >= 0 ? body.delayMs : 300;

  const { valid, invalid, duplicatesRemoved } = parseManageNumbers(rawList as string | string[]);
  if (valid.length === 0) {
    return NextResponse.json({ ok: false, error: "有効な -SS 管理番号がありません", invalid }, { status: 400 });
  }
  if (valid.length > MAX_ITEMS) {
    return NextResponse.json(
      { ok: false, error: `対象が多すぎます(${valid.length}件)。${MAX_ITEMS}件以下に分割してください`, count: valid.length },
      { status: 400 },
    );
  }

  const cred = getRakutenCredentialsFromEnv();
  if (!cred) {
    return NextResponse.json({ ok: false, error: "楽天 ESA 認証情報が未設定です" }, { status: 500 });
  }
  const deps = makeSaleSupportDeps(supabase, user.id, cred);

  const { plans, payloadHash } = await buildRestorePlans(deps, valid, { delayMs });

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      payloadHash,
      results: plans.map(toPlanResponse),
      summary: summarize(plans),
      invalid,
      duplicatesRemoved,
    });
  }

  if (typeof body.payloadHash !== "string" || body.payloadHash !== payloadHash) {
    return NextResponse.json(
      { ok: false, error: "プレビュー後に楽天側の値または対象が変わりました。もう一度プレビューしてください" },
      { status: 409 },
    );
  }
  const results = await executeRestore(deps, plans, { deleteCopy, delayMs });
  const planBySs = new Map(plans.map((p) => [p.ssManageNumber, p]));
  return NextResponse.json({
    ok: true,
    dryRun: false,
    payloadHash,
    deleteCopy,
    results: results.map((r) => toCommitResponse(r, planBySs.get(r.ssManageNumber))),
    summary: summarize(results),
    invalid,
    duplicatesRemoved,
  });
}

function toPlanResponse(p: RestoreItemPlan) {
  return {
    ssManageNumber: p.ssManageNumber,
    originalManageNumber: p.originalManageNumber,
    status: p.status,
    reason: p.reason,
    title: p.title,
    skus: p.skus,
    purchasablePeriod: p.purchasablePeriod ?? null,
    periodCleared: p.periodCleared === true,
    warnings: p.warnings,
    patchBody: p.patchBody,
  };
}

function toCommitResponse(r: SaleSupportItemResult, plan?: RestoreItemPlan) {
  return {
    ssManageNumber: r.ssManageNumber,
    originalManageNumber: r.manageNumber,
    status: r.status,
    error: r.error,
    warnings: r.warnings,
    verified: r.verified,
    title: plan?.title,
    skus: plan?.skus,
    purchasablePeriod: plan?.purchasablePeriod ?? null,
    periodCleared: plan?.periodCleared === true,
  };
}
