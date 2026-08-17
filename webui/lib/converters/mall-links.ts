import type { ProductInput } from "@/lib/product/schema";
import { mallPresence } from "@/lib/product/schema";
import { yahooItemsForProduct } from "@/lib/product/yahoo-split";
import { manageNumberOf } from "./rakuten";
import { DEFAULT_RAKUTEN_STORE } from "@/lib/rakuten/store";

/** Yahoo!ショッピングの既定ストアアカウント（公開ページ URL 用）。
 * 画像基底(image-url.ts の YAHOO_IMAGE_BASE)と同じ okimarumarket。
 * 別ストア運用になったら settings 経由で動的化する。 */
export const DEFAULT_YAHOO_STORE = "okimarumarket";

/** 楽天市場の商品ページ URL。商品管理番号(manageNumberOf と同じ規則)がそのままパスになる。 */
export function rakutenItemUrl(manageNumber: string, store: string = DEFAULT_RAKUTEN_STORE): string {
  return `https://item.rakuten.co.jp/${store}/${manageNumber}/`;
}

/** Yahoo!ショッピングの商品ページ URL。item_code(=NEコード)がそのままパスになる。
 * ストア URL はストアクリエイター上、小文字で公開されるため小文字化して組み立てる。 */
export function yahooItemUrl(itemCode: string, store: string = DEFAULT_YAHOO_STORE): string {
  return `https://store.shopping.yahoo.co.jp/${store}/${itemCode.toLowerCase()}.html`;
}

/** 1商品の公開リンク情報。page.tsx の表示・E2E(#links-data) の両方がこの形を使う。 */
export type MallLinkEntry = {
  neCode: string;
  productName: string;
  /** 楽天 商品管理番号（rakuten_manage_number 優先 / base_code フォールバック） */
  rakutenManageNumber: string;
  rakutenUrl: string;
  /** mall_listed の掲載記録（楽天は rakuten_manage_number フォールバック込み） */
  rakutenListed: boolean;
  /** Yahoo は SKU 分割(split)だと商品コードごとに別ページになるため配列 */
  yahoo: { itemCode: string; url: string }[];
  yahooListed: boolean;
  /** 行単位の静的異常（コード書式など）。空配列 = 異常なし */
  problems: string[];
};

/** Yahoo item_code の許容書式（editItem B2 と同じ: 半角英数とハイフン・99文字以内）。 */
const YAHOO_CODE_RE = /^[A-Za-z0-9-]{1,99}$/;
/** 楽天 商品管理番号の許容書式（半角英数小文字・ハイフン・アンダースコア）。 */
const RAKUTEN_MANAGE_RE = /^[a-z0-9_-]+$/;

/** 商品1件 → 公開リンク情報。URL 組み立てと同時に静的な書式異常を検出する。 */
export function mallLinkEntryOf(p: ProductInput): MallLinkEntry {
  const problems: string[] = [];
  const presence = mallPresence(p);

  const manageNumber = manageNumberOf(p);
  if (!manageNumber.trim()) {
    problems.push("楽天 商品管理番号が空（maker_code/JAN/NEコード全て欠落）");
  } else if (!RAKUTEN_MANAGE_RE.test(manageNumber)) {
    problems.push(`楽天 商品管理番号の書式が不正: "${manageNumber}"（小文字英数・ハイフン以外を含む）`);
  }

  const yahooItems = yahooItemsForProduct(p)
    .map((item) => item.ne_code?.trim() ?? "")
    .filter((code, i, arr) => arr.indexOf(code) === i)
    .map((itemCode) => {
      if (!itemCode) {
        problems.push("Yahoo 商品コード（NEコード）が空のSKUがある");
        return null;
      }
      if (!YAHOO_CODE_RE.test(itemCode)) {
        problems.push(`Yahoo 商品コードの書式が不正: "${itemCode}"（半角英数とハイフン・99文字以内）`);
        return null;
      }
      return { itemCode, url: yahooItemUrl(itemCode) };
    })
    .filter((x): x is { itemCode: string; url: string } => x !== null);

  return {
    neCode: p.ne_code,
    productName: p.display_name?.trim() || p.product_name,
    rakutenManageNumber: manageNumber,
    rakutenUrl: manageNumber.trim() ? rakutenItemUrl(manageNumber) : "",
    rakutenListed: presence.rakuten,
    yahoo: yahooItems,
    yahooListed: presence.yahoo,
    problems,
  };
}

/** 商品一覧 → 公開リンク一覧。Yahoo コードの重複（別商品が同じページを指す）も検出する。
 * 楽天の同一管理番号は SKU 行分割（peers）の正規運用なので重複扱いしない。 */
export function buildMallLinkEntries(products: ProductInput[]): MallLinkEntry[] {
  const entries = products.map(mallLinkEntryOf);

  const yahooSeen = new Map<string, string>();
  for (const e of entries) {
    for (const y of e.yahoo) {
      const prev = yahooSeen.get(y.itemCode);
      if (prev && prev !== e.neCode) {
        e.problems.push(`Yahoo 商品コード "${y.itemCode}" が ${prev} と重複`);
      } else {
        yahooSeen.set(y.itemCode, e.neCode);
      }
    }
  }
  return entries;
}
