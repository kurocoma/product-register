import { ProductInputSchema, type ProductInput } from "@/lib/product/schema";

type Mall = "rakuten" | "yahoo";

export type BuildImportedResult =
  | { ok: true; product: ProductInput; neCode: string }
  | { ok: false; error: string };

/** 楽天 商品管理番号(=baseCodeOf)に使える文字。validateUpsertBody と同一。 */
const RAKUTEN_CODE_RE = /^[a-zA-Z0-9_-]+$/;

/** モール getItem が返した JAN を正規化する。前後空白を除き、13桁数字のときだけ採用する。 */
function normalizeJan(jan: string | undefined): string {
  const t = (jan ?? "").trim();
  return /^\d{13}$/.test(t) ? t : "";
}

/** モール getItem のパース結果(editable subset)＋既定値から、完全な ProductInput を組み立てる。
 *
 * 最重要なのは識別子の整合性:
 *  - jan_code は 13桁必須（でないと dbRowToProductInput の再 parse が落ち編集画面が壊れる）。
 *  - 楽天: baseCodeOf(product) = `${maker_code}-${jan_code.slice(-4)}` が入力した商品管理番号を再現する
 *    こと（再登録/更新の冪等キーがズレないため）。
 *
 * 戻り値が ok:false の場合は識別子を機械的に復元できない（手動作成を促す）。 */
export function buildImportedProduct(
  mall: Mall,
  code: string,
  parsed: Partial<ProductInput>,
): BuildImportedResult {
  if (mall === "rakuten") {
    // variant キー(SKU管理番号)を NEコードに使う。無ければ管理番号で代用。
    const neCode = (parsed.ne_code && parsed.ne_code.trim()) || code;
    const mallJan = normalizeJan(parsed.jan_code);

    let makerCode: string;
    let janCode: string;
    if (mallJan && code.endsWith("-" + mallJan.slice(-4))) {
      // 管理番号 = `${maker}-${JAN下4桁}`。実JANを採用して maker を逆算する。
      makerCode = code.slice(0, -5);
      janCode = mallJan;
    } else {
      // JAN が取得できない／末尾が一致しない場合は「maker-4桁」形式とみなしダミーJANで再現する。
      const m = code.match(/^(.+)-(\d{4})$/);
      if (!m) {
        return {
          ok: false,
          error: `商品管理番号「${code}」が「メーカーコード-下4桁」形式でないため自動取込できません。アプリで手動作成してください。`,
        };
      }
      makerCode = m[1];
      janCode = "000000000" + m[2]; // 9桁ゼロ + 下4桁 = 13桁ダミー
    }
    // 復元した識別子が楽天の冪等キー(baseCodeOf=商品管理番号)として有効か検証する。
    // メーカーコードが空、または使用不可文字を含む場合は機械的に復元できないとみなし拒否する
    // （endsWith 分岐/regex 分岐で受理条件が非対称にならないよう、両分岐共通でガードする）。
    const baseCode = `${makerCode}-${janCode.slice(-4)}`;
    if (!makerCode || !RAKUTEN_CODE_RE.test(baseCode)) {
      return {
        ok: false,
        error: `商品管理番号「${code}」から有効なメーカーコードを復元できないため自動取込できません。アプリで手動作成してください。`,
      };
    }
    return finalize(mall, code, parsed, { neCode, makerCode, janCode });
  }

  // Yahoo: itemCode をそのまま NEコードに使う。maker は持たない。
  const neCode = code;
  const makerCode = "";
  const janCode = normalizeJan(parsed.jan_code) || "0000000000000";
  return finalize(mall, code, parsed, { neCode, makerCode, janCode });
}

/** 既定値＋パース値＋確定済み識別子から ProductInput を検証して返す。 */
function finalize(
  mall: Mall,
  code: string,
  parsed: Partial<ProductInput>,
  ids: { neCode: string; makerCode: string; janCode: string },
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
    // 識別子（モール往復の冪等キー）— parsed の値で汚されないよう最後に確定
    ne_code: ids.neCode,
    jan_code: ids.janCode,
    maker_code: ids.makerCode,
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
