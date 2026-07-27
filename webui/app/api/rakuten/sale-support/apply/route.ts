import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRakutenCredentialsFromEnv } from "@/lib/rakuten";
import { parseManageNumbers } from "@/lib/migrate";
import {
  buildApplyPlans,
  discountPercentToBp,
  executeApply,
  summarize,
  validateSalePeriod,
  type ApplyItemPlan,
  type SaleSupportItemResult,
} from "@/lib/sale-support";
import { makeSaleSupportDeps } from "../deps";

// 楽天 items.get/upsert/patch を伴うため Node ランタイム必須
export const runtime = "nodejs";

/** 1リクエストの対象上限（超過は分割を促す。migrate と同じタイムアウト対策）。
 *  1商品あたり RMS 呼び出しが多く（get×3 + upsert + patch）、QPSペーシング
 *  （429対策・rms-deps.ts）で1呼び出し400ms空けるため migrate(200) より小さくする。 */
const MAX_ITEMS = 50;

/** POST = 楽天スーパーセール支援「セール適用」。
 *
 * body: {
 *   manageNumbers: string | string[]  // 改行/カンマ/CSV1列・配列いずれも可
 *   discountPercent: number           // 値引き％（0.01〜99.99。税込×(1-％)切り捨て）
 *   periodStart: string               // 販売期間 開始（"2026-09-04T20:00" 形式可・JST）
 *   periodEnd: string                 // 販売期間 終了
 *   dualPrice?: boolean               // 既定 false。true=元税抜価格を二重価格(referencePrice)に設定
 *   dryRun?: boolean                  // 既定 true（プレビュー。書き込みなし）
 *   payloadHash?: string              // commit 必須（プレビューの返り値。値が変わっていたら 409）
 *   delayMs?: number                  // item 間待機ms（既定 300）
 * }
 *
 * 実行順（安全型）: -SSコピー作成（倉庫・元価格の控え）→ アプリDB保存 → 元商品へ最小patch
 * （SKU価格・二重価格・販売期間）→ 読み戻し検証 → 履歴記録。既に -SS がある商品は対象外（上書きしない）。
 * 定期購入価格は変更しない。
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });

  let body: {
    manageNumbers?: unknown;
    discountPercent?: unknown;
    periodStart?: unknown;
    periodEnd?: unknown;
    dualPrice?: unknown;
    dryRun?: unknown;
    payloadHash?: unknown;
    delayMs?: unknown;
  } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* 空ボディは下の検証で弾く */
  }

  const rawManage = body.manageNumbers;
  if (typeof rawManage !== "string" && !Array.isArray(rawManage)) {
    return NextResponse.json(
      { ok: false, error: "manageNumbers（管理番号の配列／改行テキスト／CSV1列）を指定してください" },
      { status: 400 },
    );
  }
  const discountBp = discountPercentToBp(Number(body.discountPercent));
  if (discountBp == null) {
    return NextResponse.json(
      { ok: false, error: "値引き％は 0.01〜99.99 の範囲（小数第2位まで）で指定してください" },
      { status: 400 },
    );
  }
  const periodCheck = validateSalePeriod(String(body.periodStart ?? ""), String(body.periodEnd ?? ""));
  if (!periodCheck.ok) {
    return NextResponse.json({ ok: false, error: periodCheck.error }, { status: 400 });
  }
  const dualPrice = body.dualPrice === true;
  const dryRun = body.dryRun !== false; // 既定 true（安全）
  const delayMs = typeof body.delayMs === "number" && body.delayMs >= 0 ? body.delayMs : 300;

  const { valid, invalid, duplicatesRemoved } = parseManageNumbers(rawManage as string | string[]);
  if (valid.length === 0) {
    return NextResponse.json({ ok: false, error: "有効な管理番号がありません", invalid }, { status: 400 });
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
  const opts = { discountBp, period: periodCheck.period, dualPrice, delayMs };

  // read-before-write: プレビューも commit も直前の RMS 現在値からプランを組む。
  const { plans, payloadHash } = await buildApplyPlans(deps, valid, opts);

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      payloadHash,
      discountPercent: discountBp / 100,
      period: periodCheck.period,
      dualPrice,
      results: plans.map(toPlanResponse),
      summary: summarize(plans),
      invalid,
      duplicatesRemoved,
    });
  }

  // commit: プレビューで表示した値と同一のものだけを実行（payloadHash 突き合わせ）。
  if (typeof body.payloadHash !== "string" || body.payloadHash !== payloadHash) {
    return NextResponse.json(
      { ok: false, error: "プレビュー後に楽天側の値または対象が変わりました。もう一度プレビューしてください" },
      { status: 409 },
    );
  }
  const results = await executeApply(deps, plans, opts);
  const planByManage = new Map(plans.map((p) => [p.manageNumber, p]));
  return NextResponse.json({
    ok: true,
    dryRun: false,
    payloadHash,
    discountPercent: discountBp / 100,
    period: periodCheck.period,
    dualPrice,
    results: results.map((r) => toCommitResponse(r, planByManage.get(r.manageNumber))),
    summary: summarize(results),
    invalid,
    duplicatesRemoved,
  });
}

/** プレビュー応答（生JSONは返さない）。 */
function toPlanResponse(p: ApplyItemPlan) {
  return {
    manageNumber: p.manageNumber,
    ssManageNumber: p.ssManageNumber,
    status: p.status,
    reason: p.reason,
    title: p.title,
    taxAssumed: p.taxAssumed === true,
    skus: p.skus,
    patchBody: p.patchBody,
  };
}

/** 実行応答（プレビュー時の計算内容も添えて画面で突き合わせられるようにする）。 */
function toCommitResponse(r: SaleSupportItemResult, plan?: ApplyItemPlan) {
  return {
    manageNumber: r.manageNumber,
    ssManageNumber: r.ssManageNumber,
    status: r.status,
    error: r.error,
    warnings: r.warnings,
    verified: r.verified,
    title: plan?.title,
    skus: plan?.skus,
  };
}
