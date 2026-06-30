/** 全角ベースの文字数カウントと上限切詰のユーティリティ。
 *
 * Yahoo editItem は各フィールドの上限を「全角」で規定する（全角=1, 半角=0.5）。
 * 楽天由来の長い name/path/explanation を上限へ適合させるための共有土台で、I/O は持たない純関数のみ。
 * 文字境界(コードポイント)で切り、全角文字やサロゲートペア(絵文字)を割らない。 */

/** 半角(=0.5幅)とみなすコードポイントか。
 * - ASCII(制御含む 0x00-0x7F)
 * - 半角カナ・半角記号(0xFF61-0xFF9F)
 * それ以外(全角英数・かな・漢字・絵文字・Latin-1拡張など)は全角(=1幅)として安全側に数える。 */
function isHalfWidth(codePoint: number): boolean {
  if (codePoint <= 0x7f) return true;
  if (codePoint >= 0xff61 && codePoint <= 0xff9f) return true;
  return false;
}

function charWidth(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  return isHalfWidth(cp) ? 0.5 : 1;
}

/** 文字列の全角換算長を返す（全角=1, 半角=0.5）。
 * for...of でコードポイント単位に走査するためサロゲートペアは1文字(=全角1)として数える。 */
export function fullWidthLen(s: string): number {
  let total = 0;
  for (const ch of s) total += charWidth(ch);
  return total;
}

/** 全角換算 maxFullWidth に収まるよう末尾を切り詰める。
 * - 上限内ならそのまま返す（短い値は出力不変）。
 * - 途中の全角文字/サロゲートペアを割らない（コードポイント単位で判定）。
 * - 半角は0.5幅で数えるため、例えば maxFullWidth=75 は半角150文字まで収まる。 */
export function fitFullWidth(s: string, maxFullWidth: number): string {
  if (maxFullWidth <= 0) return "";
  let total = 0;
  let out = "";
  for (const ch of s) {
    const w = charWidth(ch);
    if (total + w > maxFullWidth) break;
    total += w;
    out += ch;
  }
  return out;
}

/** 全角換算上限と「文字数（コードポイント数）」上限の二重上限で末尾を切り詰める。
 * - どちらかの上限を超える手前で停止する（全角文字/サロゲートペアを割らない）。
 * - 各文字は最大でも全角1幅なので「文字数<=maxChars」を満たせば、相手側カウンタが
 *   全角=1で数える環境でも「換算長<=maxChars」が構造的に保証される（カウント差に依存しない）。
 * - 半角混在で文字数だけ多い場合は maxChars 側、全角中心で幅が嵩む場合は maxFullWidth 側で先に止まる。 */
export function fitFullWidthAndChars(s: string, maxFullWidth: number, maxChars: number): string {
  if (maxFullWidth <= 0 || maxChars <= 0) return "";
  let total = 0;
  let count = 0;
  let out = "";
  for (const ch of s) {
    if (count + 1 > maxChars) break;
    const w = charWidth(ch);
    if (total + w > maxFullWidth) break;
    total += w;
    count += 1;
    out += ch;
  }
  return out;
}

/** HTML タグを除去する（HTML 不可フィールド: headline/explanation 用）。
 * 既存 converter と同等の簡易除去（属性内の `>` は想定しない運用に合わせる）。 */
export function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}

/** HTML を plain text へ変換する（name など「区切りを空白で保ちたい」フィールド用）。
 * - `<br>` / `<br/>` / `<br />`（大小文字・前後/内側の空白許容）は半角空白へ変換し、
 *   楽天 display_name の「本来の商品名 <br> SEOキーワード群」の区切りを保持する。
 * - その他のタグ（`<b>` 等）は除去する。
 * - 変換後に連続空白（改行・タブ含む）を半角空白1つへ畳み、前後を trim する。 */
export function htmlToPlainText(s: string): string {
  return s
    .replace(/<\s*br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
