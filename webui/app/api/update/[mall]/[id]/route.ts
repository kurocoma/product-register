import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProduct, dbRowToProductInput } from "@/lib/product/repository";
import { recordHistory } from "@/lib/history/recorder";
import type { ProductInput } from "@/lib/product/schema";
import { diffProduct, type ChangedField } from "@/lib/product/diff";
import { getRakutenCredentialsFromEnv } from "@/lib/rakuten/credentials";
import { getItem as getRakutenItem, patchItem } from "@/lib/rakuten/item-client";
import { parseRakutenItem } from "@/lib/converters/rakuten-item-parser";
import { buildRakutenManageNumber } from "@/lib/converters/rakuten-api";
import { buildRakutenPatchBody } from "@/lib/converters/rakuten-patch";
import { getYahooConfig, getYahooAccessToken } from "@/lib/yahoo/auth";
import { getItem as getYahooItem, editItem, submitItem } from "@/lib/yahoo/item-client";
import { parseYahooItem } from "@/lib/converters/yahoo-item-parser";
import { buildYahooUpdateParams } from "@/lib/converters/yahoo-patch";

export const runtime = "nodejs";

type Mall = "rakuten" | "yahoo";

/** モール現状を取得し、diff・送信プランを構築する（dry-run/commit 共通の前処理）。 */
async function buildPlan(mall: Mall, product: ProductInput) {
  if (mall === "rakuten") {
    const cred = getRakutenCredentialsFromEnv();
    if (!cred) return { error: "楽天 ESA 認証情報が未設定です", status: 500 } as const;
    const manageNumber = buildRakutenManageNumber(product);
    const got = await getRakutenItem(cred, manageNumber);
    if (!got.exists || !got.json) return { error: "モールに該当商品が存在しません", status: 404, key: manageNumber } as const;
    const mallParsed = parseRakutenItem(got.json);
    delete (mallParsed as { _variantId?: string })._variantId;
    const changed = diffProduct(mallParsed, product);
    const { body, skipped } = buildRakutenPatchBody(changed, product, mallParsed);
    return { mall, cred, key: manageNumber, changed, body, skipped, advanced: [] as string[] } as const;
  }
  const cfg = getYahooConfig();
  if (!cfg) return { error: "Yahoo 認証情報が未設定です", status: 500 } as const;
  let token: string;
  try {
    token = await getYahooAccessToken(cfg);
  } catch (e) {
    return { error: (e instanceof Error ? e.message : String(e)) + "（リフレッシュトークン失効時は再認証）", status: 502 } as const;
  }
  const got = await getYahooItem(token, cfg.sellerId, product.ne_code);
  if (!got.exists) return { error: "モールに該当商品が存在しません", status: 404, key: product.ne_code } as const;
  const mallParsed = parseYahooItem(got.raw);
  const changed = diffProduct(mallParsed, product);
  const { params, advanced, skipped } = buildYahooUpdateParams(got.raw, changed, product, { sellerId: cfg.sellerId });
  return { mall, cfg, token, key: product.ne_code, changed, params, skipped, advanced } as const;
}

/** GET = 反映プレビュー（書き込みなし）。差分・送信予定ボディ・警告を返す。 */
export async function GET(req: Request, { params }: { params: Promise<{ mall: string; id: string }> }) {
  const { mall, id } = await params;
  if (mall !== "rakuten" && mall !== "yahoo") return NextResponse.json({ ok: false, error: "不正なモール指定です" }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });

  const row = await getProduct(supabase, id);
  if (!row) return NextResponse.json({ ok: false, error: "商品が見つかりません" }, { status: 404 });
  const product = dbRowToProductInput(row);

  const plan = await buildPlan(mall, product);
  if ("error" in plan) return NextResponse.json({ ok: false, error: plan.error, key: plan.key }, { status: plan.status });

  return NextResponse.json({
    ok: true, dryRun: true, mall, key: plan.key,
    changedFields: plan.changed.map((c: ChangedField) => ({ field: c.field, before: c.before, after: c.after })),
    skipped: plan.skipped,
    advanced: plan.advanced,
    willSend: mall === "rakuten" ? (plan as { body: unknown }).body : (plan as { params: unknown }).params,
    hasChanges: plan.changed.length > 0,
  });
}

/** POST = 反映確定（部分更新を送信）。body: { submit?: boolean }（Yahoo の個別反映） */
export async function POST(req: Request, { params }: { params: Promise<{ mall: string; id: string }> }) {
  const { mall, id } = await params;
  if (mall !== "rakuten" && mall !== "yahoo") return NextResponse.json({ ok: false, error: "不正なモール指定です" }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });

  const reqBody = await req.json().catch(() => ({}));
  const doSubmit = reqBody?.submit === true;

  const row = await getProduct(supabase, id);
  if (!row) return NextResponse.json({ ok: false, error: "商品が見つかりません" }, { status: 404 });
  const product = dbRowToProductInput(row);

  const plan = await buildPlan(mall, product);
  if ("error" in plan) return NextResponse.json({ ok: false, error: plan.error, key: plan.key }, { status: plan.status });

  if (plan.changed.length === 0) {
    return NextResponse.json({ ok: true, mall, key: plan.key, noChange: true, message: "変更はありません" });
  }
  // Yahoo: ラウンドトリップで保持できない高度設定が実体としてある場合は反映を中止（消失防止）。
  if (plan.advanced.length > 0) {
    return NextResponse.json({
      ok: false,
      error: `この商品はAPI更新で保持できない設定（${plan.advanced.join(", ")}）を含むため、安全のため反映を中止しました。ストア管理画面で更新してください。`,
      advanced: plan.advanced,
    }, { status: 409 });
  }

  const changedFields = plan.changed.map((c: ChangedField) => c.field);

  if (plan.mall === "rakuten") {
    const result = await patchItem(plan.cred, plan.key, plan.body);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: "items.patch 失敗: " + result.message, status: result.status }, { status: 502 });
    }
    await recordHistory(supabase, "edit", id, { via: "api_update", mall, key: plan.key, changedFields });
    return NextResponse.json({ ok: true, mall, key: plan.key, status: result.status, changedFields, skipped: plan.skipped });
  }

  // Yahoo
  const result = await editItem(plan.token, plan.params);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: "editItem 失敗: " + result.message, errors: result.errors, warnings: result.warnings }, { status: 502 });
  }
  let submitted = false;
  let submitMessage = "";
  if (doSubmit) {
    const s = await submitItem(plan.token, plan.cfg.sellerId, plan.key);
    submitted = s.ok;
    submitMessage = s.message;
  }
  await recordHistory(supabase, "edit", id, { via: "api_update", mall, key: plan.key, changedFields });
  return NextResponse.json({ ok: true, mall, key: plan.key, changedFields, skipped: plan.skipped, warnings: result.warnings, submitted, submitMessage });
}
