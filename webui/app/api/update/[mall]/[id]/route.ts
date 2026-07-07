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
import { getItem as getYahooItem, editItem, reservePublish } from "@/lib/yahoo/item-client";
import { parseYahooItem } from "@/lib/converters/yahoo-item-parser";
import { buildYahooUpdateParams } from "@/lib/converters/yahoo-patch";
import { getShopifyConfig } from "@/lib/shopify/auth";
import { getProduct as getShopifyProduct, updateProduct as updateShopifyProduct, bulkUpdateVariants } from "@/lib/shopify/product-client";
import { getLocations, setAvailableQuantities } from "@/lib/shopify/inventory-client";
import { buildShopifyPatchPlan, detectShopifyStructuralChange } from "@/lib/converters/shopify-patch";
import { productVariants } from "@/lib/product/schema";

export const runtime = "nodejs";

type Mall = "rakuten" | "yahoo" | "shopify";

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
    // 多SKU商品は価格/JAN/送料をフラットでなく variants[] で扱うため除外。
    // 表示価格(display_price)は楽天ItemAPIに項目が無いため常に除外（CSVのみ・空patch防止。Yahooはoriginal_priceで反映）。
    const rakutenExclude = product.variants.length > 0
      ? ["selling_price", "jan_code", "shipping_type", "display_price"]
      : ["display_price"];
    const flatFields = EDITABLE_FIELDS.filter((f) => !rakutenExclude.includes(f as string));
    const changed = [
      ...diffProduct(mallParsed, product, flatFields),
      ...diffVariants(mallParsed.variants, product.variants),
    ];
    const { body, skipped } = buildRakutenPatchBody(changed, product, mallParsed);
    // IE0418(ジャンル必須属性不足)時の再試行用に、属性を同梱したボディも用意する。
    const bodyWithAttributes = buildRakutenPatchBody(changed, product, mallParsed, { includeAttributes: true }).body;
    // SKU構成変更(追加/削除/キー未入力)はpatchで表現できない→再登録(upsert)へ誘導するガード理由。
    const sc = detectVariantStructuralChange(mallParsed.variants, product.variants);
    const structural: string[] = [];
    if (sc.added.length) structural.push(`SKU追加(${sc.added.join(", ")})`);
    if (sc.removed.length) structural.push(`SKU削除(${sc.removed.join(", ")})`);
    if (sc.emptyKey) structural.push("SKU管理番号/NEコード未入力のSKU");
    return { mall, cred, key: manageNumber, changed, body, bodyWithAttributes, skipped, advanced: [] as string[], structural } as const;
  }
  if (mall === "shopify") {
    // Shopify は productUpdate(商品情報) + productVariantsBulkUpdate(SKU価格/JAN) の楽天patch型
    // （送った項目だけ更新・未送信は保持。docs/shopify/08 §4）。productSet は編集フローでは使わない。
    const scfg = getShopifyConfig();
    if (!scfg) return { error: "Shopify 認証情報が未設定です（SHOPIFY_SHOP / SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET）", status: 500 } as const;
    const gid = product.shopify_product_id?.trim();
    if (!gid) return { error: "Shopify 商品IDが未設定です（「モール取込」で Shopify から取込むと自動設定されます）", status: 400 } as const;
    const got = await getShopifyProduct(scfg, gid);
    if (!got.exists) return { error: "モールに該当商品が存在しません", status: 404, key: gid } as const;
    const splan = buildShopifyPatchPlan(product, got.product);
    // SKU構成変更(追加/削除/キー未入力)は部分更新で表現できない（追加=BulkCreate別系統、削除=productSet全置換のみ）。
    const sc = detectShopifyStructuralChange(productVariants(product), got.product);
    const structural: string[] = [];
    if (sc.added.length) structural.push(`SKU追加(${sc.added.join(", ")})`);
    if (sc.removed.length) structural.push(`SKU削除(${sc.removed.join(", ")})`);
    if (sc.emptyKey) structural.push("NEコード未入力のSKU");
    return {
      mall, cfg: scfg, key: gid, changed: splan.changed,
      productUpdateInput: splan.productUpdateInput, variantsInput: splan.variantsInput,
      skipped: splan.skipped, advanced: [] as string[], structural,
      snapshot: got.product, // 在庫更新(下地)の inventoryItemId 解決に使う
    } as const;
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
  // 税率フォールバック: XML に TaxrateType が無い場合は商品側の税率で税抜へ変換する（送受対称）。
  const mallParsed = parseYahooItem(got.raw, { fallbackTaxRate: product.tax_rate });
  const changed = diffProduct(mallParsed, product);
  const { params, advanced, skipped } = buildYahooUpdateParams(got.raw, changed, product, { sellerId: cfg.sellerId });
  return { mall, cfg, token, key: product.ne_code, changed, params, skipped, advanced, structural: [] as string[] } as const;
}

/** GET = 反映プレビュー（書き込みなし）。差分・送信予定ボディ・警告を返す。 */
export async function GET(req: Request, { params }: { params: Promise<{ mall: string; id: string }> }) {
  const { mall, id } = await params;
  if (mall !== "rakuten" && mall !== "yahoo" && mall !== "shopify") return NextResponse.json({ ok: false, error: "不正なモール指定です" }, { status: 400 });
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
    willSend: mall === "rakuten"
      ? (plan as { body: unknown }).body
      : mall === "shopify"
        ? {
            productUpdate: (plan as { productUpdateInput: unknown }).productUpdateInput,
            productVariantsBulkUpdate: (plan as { variantsInput: unknown }).variantsInput,
          }
        : (plan as { params: unknown }).params,
    hasChanges: plan.changed.length > 0,
  });
}

/** POST = 反映確定（部分更新を送信）。body: { submit?: boolean }（Yahoo の個別反映） */
export async function POST(req: Request, { params }: { params: Promise<{ mall: string; id: string }> }) {
  const { mall, id } = await params;
  if (mall !== "rakuten" && mall !== "yahoo" && mall !== "shopify") return NextResponse.json({ ok: false, error: "不正なモール指定です" }, { status: 400 });
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
  // Shopify: SKU構成変更は部分更新で表現できない（追加=BulkCreate別系統・削除=productSet全置換のみ）。
  // productSet を誤って部分送信すると未送信 variant が全削除されるため、安全側で反映を中止する。
  if (plan.mall === "shopify" && plan.structural.length > 0) {
    return NextResponse.json({
      ok: false,
      error: `SKU構成の変更（${plan.structural.join(" / ")}）は「反映」では送れません。価格・商品情報のみの変更は「反映」で可能です。SKUの追加・削除は Shopify 管理画面または CSV 再同期で行ってください。`,
      structural: plan.structural,
    }, { status: 409 });
  }
  // Shopify 在庫更新の下地（UI 非公開・スコープ追加後に有効化）: body.inventory = [{ ne_code, quantity }]。
  // 現アプリのスコープ（read_products / write_products）には在庫系が無いため、実行すると
  // inventory-client が ACCESS_DENIED を「write_inventory / read_inventory スコープの追加が必要」の
  // メッセージへ変換して返す（握り潰さない）。商品情報の反映とは混ぜず、在庫指定時は在庫のみ処理する。
  if (plan.mall === "shopify" && Array.isArray(reqBody?.inventory) && reqBody.inventory.length > 0) {
    const entries = reqBody.inventory as { ne_code?: string; quantity?: number }[];
    const loc = await getLocations(plan.cfg);
    if (!loc.ok) {
      return NextResponse.json({ ok: false, error: "在庫更新失敗: " + loc.message, needsScope: loc.needsScope }, { status: loc.needsScope ? 403 : 502 });
    }
    const locationId = loc.locations.find((l) => l.isActive)?.id ?? loc.locations[0]?.id;
    if (!locationId) return NextResponse.json({ ok: false, error: "在庫更新失敗: ロケーションが見つかりません" }, { status: 502 });
    const bySku = new Map(plan.snapshot.variants.map((sv) => [sv.sku.trim(), sv]));
    const quantities = [];
    for (const e of entries) {
      const sv = e.ne_code ? bySku.get(e.ne_code.trim()) : undefined;
      if (!sv?.inventoryItem?.id || typeof e.quantity !== "number") {
        return NextResponse.json({ ok: false, error: `在庫更新失敗: SKU「${e.ne_code ?? ""}」の inventoryItem を解決できません` }, { status: 422 });
      }
      quantities.push({ inventoryItemId: sv.inventoryItem.id, locationId, quantity: e.quantity });
    }
    const r = await setAvailableQuantities(plan.cfg, quantities);
    if (!r.ok) {
      return NextResponse.json({ ok: false, error: "在庫更新失敗: " + r.message, needsScope: r.needsScope }, { status: r.needsScope ? 403 : 502 });
    }
    await recordHistory(supabase, "edit", id, { via: "api_update_inventory", mall, key: plan.key });
    return NextResponse.json({ ok: true, mall, key: plan.key, inventoryUpdated: quantities.length });
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
    let result = await patchItem(plan.cred, plan.key, plan.body);
    // IE0418(ジャンル必須属性不足)なら、商品側の属性を同梱して1回だけ再試行（属性が揃っていれば成功）。
    if (!result.ok && /IE0418|mandatory attribute/i.test(result.message)) {
      result = await patchItem(plan.cred, plan.key, plan.bodyWithAttributes);
    }
    if (!result.ok) {
      const hint = /IE0418|mandatory attribute/i.test(result.message)
        ? "（楽天のジャンル必須属性が不足しています。商品編集の「商品属性」でカテゴリIDから属性を読み込み、不足項目を入力して再度反映してください）"
        : "";
      return NextResponse.json({ ok: false, error: "items.patch 失敗: " + result.message + hint, status: result.status }, { status: 502 });
    }
    await recordHistory(supabase, "edit", id, { via: "api_update", mall, key: plan.key, changedFields });
    return NextResponse.json({ ok: true, mall, key: plan.key, status: result.status, changedFields, skipped: plan.skipped });
  }

  if (plan.mall === "shopify") {
    // 価格(SKU) → 商品情報 の順に送る。variants 側は allowPartialUpdates 既定 false =
    // 1件でもエラーなら全 variant 不成立（原子性。docs/shopify/08 §2）。
    if (plan.variantsInput.length > 0) {
      const r = await bulkUpdateVariants(plan.cfg, plan.key, plan.variantsInput);
      if (!r.ok) {
        return NextResponse.json({ ok: false, error: "productVariantsBulkUpdate 失敗: " + r.message }, { status: 502 });
      }
    }
    if (plan.productUpdateInput) {
      const r = await updateShopifyProduct(plan.cfg, plan.productUpdateInput);
      if (!r.ok) {
        const note = plan.variantsInput.length > 0 ? "（SKU価格側は反映済みです。再実行すると残りだけ送信されます）" : "";
        return NextResponse.json({ ok: false, error: "productUpdate 失敗: " + r.message + note }, { status: 502 });
      }
    }
    await recordHistory(supabase, "edit", id, { via: "api_update", mall, key: plan.key, changedFields });
    return NextResponse.json({ ok: true, mall, key: plan.key, changedFields, skipped: plan.skipped });
  }

  // Yahoo
  const result = await editItem(plan.token, plan.params);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: "editItem 失敗: " + result.message, errors: result.errors, warnings: result.warnings }, { status: 502 });
  }
  let submitted = false;
  let submitMessage = "";
  if (doSubmit) {
    // フロント反映は reservePublish（全反映予約・ストア全体）。submitItem は存在しない誤APIのため使わない。
    const s = await reservePublish(plan.token, plan.cfg.sellerId);
    submitted = s.ok;
    submitMessage = s.message;
  }
  await recordHistory(supabase, "edit", id, { via: "api_update", mall, key: plan.key, changedFields });
  return NextResponse.json({ ok: true, mall, key: plan.key, changedFields, skipped: plan.skipped, warnings: result.warnings, submitted, submitMessage });
}
