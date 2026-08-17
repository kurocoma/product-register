/** 競合抽出（純関数）。楽天市場検索の結果から「同一商品を売る他店」だけを残す。
 * 検索APIにはJAN専用パラメータが無く keyword=JAN の間接突合になるため、
 * (1) 自店除外 (2) 価格帯ガード (3) 商品名一致度 の3段で誤マッチを防ぐ。
 * 誤マッチは店舗負担のポイント原資を無駄に増やすため、迷ったら落とす（安全側）。 */

import type { IchibaSearchItem } from "@/lib/rakuten";
import type { Competitor } from "./types";

/** 価格帯ガード: 自店の税込販売価格の 0.5〜2.0 倍のみ同一商品候補とする。
 * 入数違い（例: 8個セットに対する単品）や別商品の混入を防ぐ。
 * ※検索APIの itemPrice は税込。自店 selling_price は税抜統一のため、
 *   呼び出し側で rakutenTaxInclusive で税込換算してから渡すこと。 */
export const PRICE_BAND_LOW = 0.5;
export const PRICE_BAND_HIGH = 2.0;

/** 商品名フォールバック検索時の一致度しきい値（有意トークンの過半超え） */
export const NAME_MATCH_THRESHOLD = 0.6;
/** JAN検索時の商品名検証しきい値（JANは説明文マッチで姉妹品等が混ざるため緩めに検証） */
export const JAN_NAME_MATCH_THRESHOLD = 0.3;

export type MatchFilter = {
  ownShopCode: string;
  /** 自店の税込販売価格（0 = 価格不明。呼び出し側で商品名検索を止めること） */
  ownPrice: number;
  /** 設定すると商品名一致度で検証する（JAN検索・商品名検索の双方で使う） */
  ownName?: string;
  /** 一致度しきい値（既定 NAME_MATCH_THRESHOLD） */
  nameThreshold?: number;
};

/** 検索結果 → 競合リスト（価格昇順のまま）。 */
export function filterCompetitors(items: IchibaSearchItem[], filter: MatchFilter): Competitor[] {
  const low = filter.ownPrice > 0 ? filter.ownPrice * PRICE_BAND_LOW : 0;
  const high = filter.ownPrice > 0 ? filter.ownPrice * PRICE_BAND_HIGH : Number.POSITIVE_INFINITY;
  const threshold = filter.nameThreshold ?? NAME_MATCH_THRESHOLD;
  return items
    .filter((it) => it.shopCode !== filter.ownShopCode)
    .filter((it) => it.itemPrice >= low && it.itemPrice <= high)
    .filter((it) => (filter.ownName ? nameMatchScore(filter.ownName, it.itemName) >= threshold : true))
    .map((it) => ({
      shopCode: it.shopCode,
      shopName: it.shopName,
      itemName: it.itemName,
      itemPrice: it.itemPrice,
      pointRate: it.pointRate,
      itemUrl: it.itemUrl,
    }));
}

/** 最安値上位 topN「店」の最大ポイント倍率。競合なしは null。
 * 同一店の複数出品（入数違い・重複出品）が N 枠を潰さないよう、店ごとに最安の1件だけを数える。 */
export function competitorMaxRate(competitors: Competitor[], topN: number): number | null {
  if (competitors.length === 0) return null;
  const sorted = [...competitors].sort((a, b) => a.itemPrice - b.itemPrice);
  const n = Math.max(1, topN);
  const seen = new Set<string>();
  let max = 1;
  for (const c of sorted) {
    if (seen.has(c.shopCode)) continue;
    seen.add(c.shopCode);
    max = Math.max(max, c.pointRate || 1);
    if (seen.size >= n) break;
  }
  return max;
}

/** 商品名をトークン列へ（記号・スペース区切り＋2文字以上）。 */
export function tokenize(name: string): string[] {
  return name
    .replace(/[【】\[\]（）()「」/／|、。,.・×☆★!！?？:：;；~〜'"”“]+/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

/** 販促の常套句（どの商品にも付くため一致度の根拠にならない） */
const PROMO_STOPWORD =
  /^(送料無料|送料込み?|送料別|あす楽|翌日配送|翌日配達|即納|公式|正規品|国内正規|セール|限定|お得|おすすめ|まとめ買い|ギフト|プレゼント|ポイント\d*倍?)$/;
/** 数量・入数トークン（8個セット 等。カテゴリが同じ別商品でも一致するため除外） */
const QUANTITY_TOKEN = /^\d+(個|本|袋|枚|包|錠|粒|箱|点|ml|g|l|kg)?(セット|入り?|パック)?$/i;

/** 一致度計算に使う有意トークン（販促常套句・数量語を除いたもの）。 */
export function significantTokens(name: string): string[] {
  return tokenize(name).filter((t) => !PROMO_STOPWORD.test(t) && !QUANTITY_TOKEN.test(t));
}

/** 自店商品名の有意トークンのうち、相手商品名に含まれる割合（0〜1）。
 * 「送料無料」「8個セット」のような汎用語だけの一致で別ブランド品を
 * 競合と誤認しないよう、有意トークンが無い場合は 0（=競合と認めない）。 */
export function nameMatchScore(ownName: string, theirName: string): number {
  const tokens = significantTokens(ownName);
  if (tokens.length === 0) return 0;
  const their = theirName.toLowerCase();
  const hit = tokens.filter((t) => their.includes(t.toLowerCase())).length;
  return hit / tokens.length;
}

/** 商品名フォールバック検索用のキーワード（長すぎる商品名は先頭から切る）。 */
export function normalizeNameKeyword(name: string, maxLen = 60): string {
  return name.replace(/\s+/g, " ").trim().slice(0, maxLen);
}
