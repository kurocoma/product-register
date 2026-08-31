/** Yahoo!ショッピング 公開 商品検索API v3 (itemSearch) クライアント（260901修正依頼-1）。
 * 自ストア（seller_id 絞り込み）の商品を「商品名キーワード」で検索するために使う。
 * ストア管理系 API（myItemList）の query は商品コードのみ対象で商品名を引けないため
 * （実測 2026-09-01）、名前検索はこの公開APIで行う。
 * - 認証: appid（アプリケーションID）。ストアAPIの OAuth Client ID をそのまま使える（実測確認済み）。
 * - 対象は「検索反映済みの公開商品」のみ。非公開（display=0）・反映前の商品は返らない。
 * - hits[].code は "{sellerId}_{itemCode}" 形式のため itemCode へ剥がして返す。 */

const SEARCH_BASE = "https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch";

export type YahooSearchHit = {
  itemCode: string;
  name: string;
  /** 税込価格（取得できないときは null）。 */
  price: number | null;
};

export async function searchStoreItemsByName(
  appId: string,
  sellerId: string,
  query: string,
  results = 20,
): Promise<{ ok: boolean; message?: string; hits: YahooSearchHit[] }> {
  const url =
    `${SEARCH_BASE}?appid=${encodeURIComponent(appId)}` +
    `&seller_id=${encodeURIComponent(sellerId)}` +
    `&query=${encodeURIComponent(query)}` +
    `&results=${Math.max(1, Math.min(50, results))}`;
  const res = await fetch(url);
  const text = await res.text();
  if (res.status !== 200) {
    return { ok: false, message: `itemSearch 失敗 (HTTP ${res.status}): ${text.slice(0, 200)}`, hits: [] };
  }
  try {
    const json = JSON.parse(text) as { hits?: { code?: string; name?: string; price?: number }[] };
    const prefix = `${sellerId}_`;
    const hits = (json.hits ?? [])
      .filter((h): h is { code: string; name?: string; price?: number } => typeof h.code === "string" && h.code.startsWith(prefix))
      .map((h) => ({
        itemCode: h.code.slice(prefix.length),
        name: h.name ?? "",
        price: typeof h.price === "number" ? h.price : null,
      }));
    return { ok: true, hits };
  } catch {
    return { ok: false, message: "itemSearch 応答の解析に失敗しました", hits: [] };
  }
}
