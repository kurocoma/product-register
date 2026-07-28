import { fullWidthLen } from "@/lib/product";
import { countYahooField } from "@/lib/yahoo";

/** 商品名セール文言（機能3）の純ロジック。
 *
 * 文言は商品名の先頭に「文言＋半角スペース1個」で追記し、解除は先頭からの完全一致で
 * （後続スペース含め）除去する。文字数レギュレーション違反の商品は実行から除外する。
 */

/** 楽天 商品名(title)の上限バイト数。
 * 根拠: docs/楽天/items.upsert.txt L32・items.patch.txt L31「title 商品名 string Max Byte 255」。
 * カウント基準は 2026-07-28 実測（tests/bulk_tools_probe_sp_comment.mjs・zzz商品・IE0004）で確定:
 *   全角127字(=254バイト)OK / 全角128字NG / 半角255字OK / 半角256字NG
 * → 全角=2バイト・半角=1バイト計上の 255 バイト上限（UTF-8 バイト数ではない）。 */
export const RAKUTEN_TITLE_MAX_BYTES = 255;

/** 楽天カウント基準のバイト長。全角=2・半角=1 は fullWidthLen（全角=1・半角=0.5）の2倍。 */
export function rakutenTitleBytes(s: string): number {
  return Math.round(fullWidthLen(s) * 2);
}

/** 適用後の商品名に対する両モールのレギュレーション判定。
 * Yahoo は既存 fitYahooFieldLimits の定数（YAHOO_FIELD_LIMITS.name: 全角75・文字数75）を
 * countYahooField 経由で参照する（送信時と同じ前処理＝<br>→空白/タグ除去で数える）。 */
export type SaleNameCheck = {
  ok: boolean;
  rakutenBytes: number;
  /** 楽天の超過バイト数（0=適合） */
  rakutenOverBytes: number;
  yahooFullWidth: number;
  /** Yahoo の全角換算の超過（0=適合） */
  yahooOverFullWidth: number;
  yahooChars: number;
  /** Yahoo の文字数（コードポイント）超過（0=適合） */
  yahooOverChars: number;
  yahooLimit: number;
};

export function checkSaleNameLimits(name: string): SaleNameCheck {
  const rakutenBytes = rakutenTitleBytes(name);
  const y = countYahooField("name", name);
  const rakutenOverBytes = Math.max(0, rakutenBytes - RAKUTEN_TITLE_MAX_BYTES);
  const yahooOverFullWidth = Math.max(0, y.fullWidth - y.limit);
  const yahooOverChars = y.maxChars != null ? Math.max(0, y.chars - y.maxChars) : 0;
  return {
    ok: rakutenOverBytes === 0 && yahooOverFullWidth === 0 && yahooOverChars === 0,
    rakutenBytes,
    rakutenOverBytes,
    yahooFullWidth: y.fullWidth,
    yahooOverFullWidth,
    yahooChars: y.chars,
    yahooOverChars,
    yahooLimit: y.limit,
  };
}

/** 超過内容の日本語表示（警告一覧用。何字/何バイトオーバーかを明示）。 */
export function describeSaleNameViolation(c: SaleNameCheck): string {
  const parts: string[] = [];
  if (c.rakutenOverBytes > 0) {
    parts.push(`楽天: ${c.rakutenBytes}バイト（上限${RAKUTEN_TITLE_MAX_BYTES}バイト・${c.rakutenOverBytes}バイト超過）`);
  }
  if (c.yahooOverFullWidth > 0) {
    parts.push(`Yahoo: 全角換算${c.yahooFullWidth}字（上限${c.yahooLimit}字・${c.yahooOverFullWidth}字超過）`);
  }
  if (c.yahooOverChars > 0) {
    parts.push(`Yahoo: 文字数${c.yahooChars}字（上限${c.yahooLimit}字・${c.yahooOverChars}字超過）`);
  }
  return parts.join(" / ");
}

/** セール文言の入力検証（前後空白は除去。改行不可）。 */
export function validateSalePhrase(
  phrase: string,
): { ok: true; phrase: string } | { ok: false; error: string } {
  const p = String(phrase ?? "").trim();
  if (!p) return { ok: false, error: "セール文言を入力してください" };
  if (/[\r\n]/.test(p)) return { ok: false, error: "セール文言に改行は使えません" };
  return { ok: true, phrase: p };
}

export type SaleNameApplyResult = { ok: true; after: string } | { ok: false; reason: string };

/** 商品名の先頭へ文言を追記する（文言と元名の間は半角スペース1個）。既に追記済みならスキップ。 */
export function addSalePrefix(name: string, phrase: string): SaleNameApplyResult {
  if (name === phrase || name.startsWith(`${phrase} `)) {
    return { ok: false, reason: "既にセール文言が追記されています" };
  }
  return { ok: true, after: `${phrase} ${name}` };
}

/** 商品名の先頭から文言を完全一致で除去する（後続の半角スペース1個も含めて）。 */
export function removeSalePrefix(name: string, phrase: string): SaleNameApplyResult {
  if (name === phrase) {
    return { ok: false, reason: "商品名がセール文言のみのため除去できません" };
  }
  if (!name.startsWith(`${phrase} `)) {
    return { ok: false, reason: "商品名の先頭にセール文言がありません" };
  }
  const after = name.slice(phrase.length + 1);
  if (!after.trim()) return { ok: false, reason: "除去後の商品名が空になります" };
  return { ok: true, after };
}
