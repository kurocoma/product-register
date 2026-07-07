import { ProductInputSchema, type ProductInput } from "@/lib/product/schema";

type Mall = "rakuten" | "yahoo" | "shopify";

export type BuildImportedResult =
  | { ok: true; product: ProductInput; neCode: string }
  | { ok: false; error: string };

/** 楽天 商品管理番号に使える文字（半角英数 + "-" "_"）。items.get/upsert と同一。最大32バイト。 */
const RAKUTEN_CODE_RE = /^[a-zA-Z0-9_-]+$/;

/** モール getItem が返した JAN を正規化する。前後空白を除き、13桁数字のときだけ採用する。 */
function normalizeJan(jan: string | undefined): string {
  const t = (jan ?? "").trim();
  return /^\d{13}$/.test(t) ? t : "";
}

/** NEコード変換ロジックでメーカーコードを導出する（表示・絞り込み用。往復は実管理番号で行う）。
 * NEコード(SKU管理番号/variantキー) = `メーカーコード-JAN下4桁-数量`、商品管理番号 = `メーカーコード-JAN下4桁`。
 * 実JANがあれば JAN下4桁を手掛かりに maker を切り出す。無ければ管理番号末尾の4桁を手掛かりにする。
 * 機械的に切り出せない（非規約書式）の場合は空文字（実害なし＝表示用）。 */
function deriveRakutenMaker(neCode: string, code: string, mallJan: string): string {
  if (mallJan) {
    const j4 = mallJan.slice(-4);
    const i = neCode.indexOf(`-${j4}-`); // NE = maker-JAN下4-数量
    if (i > 0) return neCode.slice(0, i);
    if (neCode.endsWith(`-${j4}`)) return neCode.slice(0, -(j4.length + 1)); // NE = maker-JAN下4
    if (code.endsWith(`-${j4}`)) return code.slice(0, -(j4.length + 1)); // 管理番号 = maker-JAN下4
  }
  const m = code.match(/^(.+)-(\d{4})$/); // 管理番号 = maker-(末尾4桁)
  if (m) return m[1];
  return "";
}

/** モール getItem のパース結果(editable subset)＋既定値から、完全な ProductInput を組み立てる。
 *
 * 識別子の整合性:
 *  - jan_code は 13桁必須（でないと dbRowToProductInput の再 parse が落ち編集画面が壊れる）。
 *  - 楽天: 実際の商品管理番号を rakuten_manage_number に保存し、編集→反映で同一商品へ往復させる。
 *    maker_code / jan_code は NEコード変換ロジック(variantキー)＋実JANから導出する（表示用）。
 *    管理番号の書式は問わない（maker-JAN下4桁以外も可）が、楽天で使用可能な文字種である必要がある。
 *
 * 戻り値が ok:false の場合は取込不可（手動作成を促す）。 */
export function buildImportedProduct(
  mall: Mall,
  code: string,
  parsed: Partial<ProductInput>,
): BuildImportedResult {
  if (mall === "rakuten") {
    // 管理番号は楽天の使用可能文字（半角英数 - _ ・32文字以内）であること。
    // 実在商品の管理番号なら必ず満たす（getItem が通っている）。日本語/空白/スラッシュ等は拒否。
    if (!RAKUTEN_CODE_RE.test(code) || code.length > 32) {
      return {
        ok: false,
        error: `商品管理番号「${code}」は楽天で使用できない文字を含むため取込できません（使用可: 半角英数字と - _、32文字以内）。`,
      };
    }
    // variant キー(SKU管理番号)を NEコードに使う。無ければ管理番号で代用。
    const neCode = (parsed.ne_code && parsed.ne_code.trim()) || code;
    const mallJan = normalizeJan(parsed.jan_code);
    // jan_code: 実JAN優先。無く管理番号が `*-NNNN`(末尾4桁)ならその4桁でダミー、それも無ければ全ゼロ13桁。
    let janCode: string;
    if (mallJan) {
      janCode = mallJan;
    } else {
      const m = code.match(/^(.+)-(\d{4})$/);
      janCode = m ? "000000000" + m[2] : "0000000000000";
    }
    const makerCode = deriveRakutenMaker(neCode, code, mallJan);
    // 実際の管理番号を保存（buildRakutenManageNumber が最優先で使い、確実に同一商品へ往復させる）。
    return finalize(mall, code, parsed, { neCode, makerCode, janCode, rakutenManageNumber: code });
  }

  if (mall === "shopify") {
    // Shopify: code は Global ID（gid://shopify/Product/{数値}）。first variant の SKU
    // （= CSV 登録規約の NEコード）を NEコードに使い、無ければ gid 数値部で代用する。
    const numericId = code.split("/").pop() ?? code;
    const neCode = (parsed.ne_code && parsed.ne_code.trim()) || `shopify-${numericId}`;
    const janCode = normalizeJan(parsed.jan_code) || "0000000000000";
    return finalize(mall, code, parsed, { neCode, makerCode: "", janCode, rakutenManageNumber: "", shopifyProductId: code });
  }

  // Yahoo: itemCode をそのまま NEコードに使う。maker は持たない。商品コードの書式制約はない。
  const neCode = code;
  const makerCode = "";
  const janCode = normalizeJan(parsed.jan_code) || "0000000000000";
  return finalize(mall, code, parsed, { neCode, makerCode, janCode, rakutenManageNumber: "" });
}

/** 既定値＋パース値＋確定済み識別子から ProductInput を検証して返す。 */
function finalize(
  mall: Mall,
  code: string,
  parsed: Partial<ProductInput>,
  ids: { neCode: string; makerCode: string; janCode: string; rakutenManageNumber: string; shopifyProductId?: string },
): BuildImportedResult {
  const name = (parsed.display_name && parsed.display_name.trim()) || code;

  const base: Record<string, unknown> = {
    // 既定値（モール getItem に含まれない項目）
    product_type: "単品",
    quantity: 1,
    tax_rate: 10,
    cost_price: 0,
    selling_price: 0,
    shipping_type: "送料別",
    image_count: 1,
    delivery_method: mall === "yahoo" ? 1 : 4,
    lead_time: 1,
    mall_category_id: "",
    // パース値を流し込む（display_name/価格/カテゴリ/説明文など）。識別子は下で再上書きする。
    ...parsed,
    // 識別子 — parsed の値で汚されないよう最後に確定
    ne_code: ids.neCode,
    jan_code: ids.janCode,
    maker_code: ids.makerCode,
    // 実際のモール管理番号（編集→反映で同一商品へ往復させる冪等キー。楽天=管理番号 / Shopify=gid）
    rakuten_manage_number: ids.rakutenManageNumber,
    shopify_product_id: ids.shopifyProductId ?? "",
    // 商品名（管理用）と表示名の両方を埋める
    product_name: name,
    display_name: name,
  };

  // 派生プロパティが parsed に混ざっていても schema 側で再計算されるため除去
  delete base.is_single;
  delete base.is_set;
  delete (base as { _variantId?: string })._variantId;

  // 価格を整数円へ正規化（parse 失敗で取込全体を落とさない）。
  // schema は selling_price: z.number().int() なので、小数(例 "1980.5")や NaN/undefined を
  // そのまま渡すと parse が落ちる。有限値は四捨五入、それ以外は 0 にフォールバックする。
  const priceNum = Number(base.selling_price);
  base.selling_price = Number.isFinite(priceNum) ? Math.round(priceNum) : 0;

  let product: ProductInput;
  try {
    product = ProductInputSchema.parse(base);
  } catch (e) {
    return { ok: false, error: "取込データの検証に失敗しました: " + (e instanceof Error ? e.message : String(e)) };
  }
  return { ok: true, product, neCode: ids.neCode };
}
