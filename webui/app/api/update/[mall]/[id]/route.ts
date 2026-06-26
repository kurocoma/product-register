import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProduct, dbRowToProductInput } from "@/lib/product/repository";
import { recordHistory } from "@/lib/history/recorder";
import type { ProductInput } from "@/lib/product/schema";
import { diffProduct, type ChangedField } from "@/lib/product/diff";
import { getRakutenCredentialsFromEnv } from "@/lib/rakuten/credentials";
import { getItem as getRakutenItem, patchItem } from "@/lib/rakuten/item-client";
import { parseRakutenItem, parseRakutenVariants } from "@/lib/converters/rakuten-item-parser";
import { buildRakutenManageNumber } from "@/lib/converters/rakuten-api";
import { buildRakutenPatchBody, diffVariants, detectVariantStructuralChange } from "@/lib/converters/rakuten-patch";
import { EDITABLE_FIELDS } from "@/lib/product/diff";
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
    // 多SKU: モール現状の全SKUを snapshot.variants に持たせ、SKU別に差分判定する。
    mallParsed.variants = parseRakutenVariants(got.json);
    // 多SKU商品は価格/JAN/送料をフラットでなく variants[] で扱うため、フラット差分からは除外（二重・誤検知防止）。
    const flatFields = product.variants.length > 0
      ? EDITABLE_FIELDS.filter((f) => !["selling_price", "jan_code", "shipping_type"].includes(f as string))
      : EDITABLE_FIELDS;
    const changed = [
      ...diffProduct(mallParsed, product, flatFields),
      ...diffVariants(mallParsed.variants, product.variants),
    ];
    const { body, skipped } = buildRakutenPatchBody(changed, product, mallParsed);
    // SKU構成変更(追加/削除/キー未入力)はpatchで表現できない→再登録(upsert)へ誘導するガード理由。
    const sc = detectVariantStructuralChange(mallParsed.variants, product.variants);
    const structural: string[] = [];
    if (sc.added.length) structural.push(`SKU追加(${sc.added.join(", ")})`);
    if (sc.removed.length) structural.push(`SKU削除(${sc.removed.join(", ")})`);
    if (sc.emptyKey) structural.push("SKU管理番号/NEコード未入力のSKU");
    return { mall, cred, key: manageNumber, changed, body, skipped, advanced: [] as string[], structural } as const;
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
  return { mall, cfg, token, key: product.ne_code, changed, params, skipped, advanced, structural: [] as string[] } as const;
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
    structural: plan.structural,
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

  // 楽天: SKU構成の変更(追加/削除/キー未入力)は patch では送れない（追加=selectorValues必須でIE0156、
  // 削除=未指定保持で残存、空キー=IE0220）。安全のため反映を中止し、再登録(楽天へ登録=upsert/全置換)へ誘導する。
  // ※削除のみだと changed が空になり「変更なし」に紛れてサイレント乖離するため、noChange判定より前に置く。
  if (plan.mall === "rakuten" && plan.structural.length > 0) {
    return NextResponse.json({
      ok: false,
      error: `SKU構成の変更（${plan.structural.join(" / ")}）は「反映」では送れません。価格・配送のみの変更は「反映」で可能です。SKUの追加・削除を含む場合は「楽天へ登録」（全置換）で反映してください。`,
      structural: plan.structural,
    }, { status: 409 });
  }
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
