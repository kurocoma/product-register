import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dbRowToProductInput, upsertProduct, type ProductRow } from "@/lib/product/repository";
import {
  diffResearchProduct,
  hashResearchImportPlan,
  parseResearchImportPayload,
  type ResearchImportExistingState,
} from "@/lib/product/research-import";

export const runtime = "nodejs";

/**
 * Codex/Excelの調査結果を、ログイン中ユーザーのアプリ下書きへ保存する。
 * モールAPIは呼ばない。dryRunは既定trueで、commitにはpreview hashと確認語が必要。
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = parseResearchImportPayload(body);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  }

  const neCodes = parsed.products.map((product) => product.ne_code);
  const { data: existingRows, error: lookupError } = await supabase
    .from("products")
    .select("*")
    .eq("user_id", user.id)
    .in("ne_code", neCodes);
  if (lookupError) {
    return NextResponse.json({ ok: false, error: lookupError.message }, { status: 500 });
  }

  const existingByCode = new Map(
    ((existingRows ?? []) as ProductRow[]).map((row) => [String(row.ne_code), row]),
  );
  const planHash = hashResearchImportPlan(
    parsed.products,
    parsed.overwrite,
    (existingRows ?? []) as ResearchImportExistingState[],
  );
  if (!parsed.dryRun && parsed.expectedHash !== planHash) {
    return NextResponse.json(
      { ok: false, error: "dry-run後に商品・上書き指定・既存データが変わりました。もう一度dry-runしてください" },
      { status: 409 },
    );
  }

  // 既存行の復元・差分計算を全件先に終える。legacy不整合で途中終了して保存済みprefixを残さない。
  const plans = parsed.products.map((product, index) => {
    const existing = existingByCode.get(product.ne_code);
    try {
      const diff = existing ? diffResearchProduct(dbRowToProductInput(existing), product) : [];
      return { index, product, existing, diff, planningError: null as string | null };
    } catch (error) {
      return {
        index,
        product,
        existing,
        diff: [],
        planningError: `既存商品の復元に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });
  const planningFailures = plans.filter((plan) => plan.planningError !== null);
  if (planningFailures.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        dryRun: parsed.dryRun,
        payloadHash: planHash,
        total: plans.length,
        saved: 0,
        failed: planningFailures.length,
        results: planningFailures.map((plan) => ({
          index: plan.index,
          ne_code: plan.product.ne_code,
          product_name: plan.product.product_name,
          action: "error",
          ok: false,
          id: plan.existing?.id ?? null,
          error: plan.planningError,
        })),
      },
      { status: 422 },
    );
  }
  const results: Array<Record<string, unknown>> = [];

  // 履歴の順序と部分失敗の切り分けを明確にするため逐次処理する。
  for (const plan of plans) {
    const { index, product, existing, diff } = plan;
    const base = {
      index,
      ne_code: product.ne_code,
      product_name: product.product_name,
      action: existing ? "update" : "create",
      willOverwrite: Boolean(existing),
      changedFields: diff.length,
      diff,
    };

    if (parsed.dryRun) {
      results.push({ ...base, ok: true, id: existing?.id ?? null });
      continue;
    }
    if (existing && !parsed.overwrite) {
      results.push({
        ...base,
        ok: false,
        skipped: true,
        id: existing.id,
        error: "既存NEコードのためスキップしました。更新する場合はoverwrite:trueを明示してください",
      });
      continue;
    }

    try {
      const saved = await upsertProduct(supabase, product, existing?.id, {
        expectedUpdatedAt: existing?.updated_at,
        authenticatedUserId: user.id,
      });
      results.push({ ...base, ok: true, saved: true, id: saved.id });
    } catch (error) {
      results.push({
        ...base,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const failed = results.filter((result) => result.ok !== true).length;
  const saved = results.filter((result) => result.saved === true).length;
  return NextResponse.json({
    ok: failed === 0,
    dryRun: parsed.dryRun,
    payloadHash: planHash,
    total: results.length,
    saved,
    failed,
    results,
  });
}
