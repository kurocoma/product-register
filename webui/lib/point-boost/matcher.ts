/** 競合抽出（純関数）。楽天市場検索の結果から「同一商品を売る他店」だけを残す。
 * 検索APIにはJAN専用パラメータが無く keyword=JAN の間接突合になるため、
 * (1) 自店除外 (2) 価格帯ガード (3) 商品名一致度（商品名検索時のみ）の3段で誤マッチを防ぐ。 */

import type { IchibaSearchItem } from "@/lib/rakuten";
import type { Competitor } from "./types";

/** 価格帯ガード: 自店販売価格の 0.5〜2.0 倍のみ同一商品候補とする。
 * 入数違い（例: 8個セットに対する単品）や別商品の混入を防ぐ。 */
export const PRICE_BAND_LOW = 0.5;
export const PRICE_BAND_HIGH = 2.0;

/** 商品名検索時の一致度しきい値（自店商品名のトークンの過半が含まれること） */
export const NAME_MATCH_THRESHOLD = 0.5;

export type MatchFilter = {
  ownShopCode: string;
  ownPrice: number;
  /** 商品名フォールバック検索のときだけ設定（一致度検証に使う） */
  ownName?: string;
};

/** 検索結果 → 競合リスト（価格昇順のまま）。 */
export function filterCompetitors(items: IchibaSearchItem[], filter: MatchFilter): Competitor[] {
  const low = filter.ownPrice > 0 ? filter.ownPrice * PRICE_BAND_LOW : 0;
  const high = filter.ownPrice > 0 ? filter.ownPrice * PRICE_BAND_HIGH : Number.POSITIVE_INFINITY;
  return items
    .filter((it) => it.shopCode !== filter.ownShopCode)
    .filter((it) => it.itemPrice >= low && it.itemPrice <= high)
    .filter((it) => (filter.ownName ? nameMatchScore(filter.ownName, it.itemName) >= NAME_MATCH_THRESHOLD : true))
    .map((it) => ({
      shopCode: it.shopCode,
      shopName: it.shopName,
      itemName: it.itemName,
      itemPrice: it.itemPrice,
      pointRate: it.pointRate,
      itemUrl: it.itemUrl,
    }));
}

/** 最安値上位 topN 店の最大ポイント倍率。競合なしは null。 */
export function competitorMaxRate(competitors: Competitor[], topN: number): number | null {
  if (competitors.length === 0) return null;
  const sorted = [...competitors].sort((a, b) => a.itemPrice - b.itemPrice);
  const top = sorted.slice(0, Math.max(1, topN));
  return top.reduce((max, c) => Math.max(max, c.pointRate || 1), 1);
}

/** 商品名をトークン列へ（記号・スペース区切り＋2文字以上）。 */
export function tokenize(name: string): string[] {
  return name
    .replace(/[【】\[\]（）()「」/／|、。,.・×☆★!！?？:：;；~〜'"”“]+/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

/** 自店商品名のトークンのうち、相手商品名に含まれる割合（0〜1）。 */
export function nameMatchScore(ownName: string, theirName: string): number {
  const tokens = tokenize(ownName);
  if (tokens.length === 0) return 0;
  const their = theirName.toLowerCase();
  const hit = tokens.filter((t) => their.includes(t.toLowerCase())).length;
  return hit / tokens.length;
}

/** 商品名フォールバック検索用のキーワード（長すぎる商品名は先頭から切る）。 */
export function normalizeNameKeyword(name: string, maxLen = 60): string {
  return name.replace(/\s+/g, " ").trim().slice(0, maxLen);
}
