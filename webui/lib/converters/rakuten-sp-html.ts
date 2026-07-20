/** 楽天スマホ用説明文（productDescription.sp）の禁止タグ自動修正（260720）。
 * sp は PC より許可タグが厳しく、strong / tbody 等が混ざると items.upsert が
 * IE0215（Cannot set "X" in productDescription.sp）で失敗する。
 * PC 向け販売説明文を sp に連結して送る構成のため、送信直前に意味を保存する形で変換する:
 * - strong → b ／ em → i（見た目・意味を維持できる同等タグへ）
 * - thead / tbody / tfoot → タグだけ外して中身（tr/td）を残す（table 構造は維持）
 * - img は文書順で先頭 20 個だけ残し 21 個目以降を除去
 *   （sp は img 最大 20 個。超えると IE0257 で upsert が失敗する。260720 実件）
 * PC 側（productDescription.pc / salesDescription）は strong/tbody とも許可のため変換しない。 */

// 楽天 items.upsert の productDescription.sp に登録できる <img> タグの上限（IE0257）
const SP_IMG_TAG_LIMIT = 20;

export function sanitizeRakutenSpHtml(html: string): string {
  let imgCount = 0;
  return String(html ?? "")
    .replace(/<strong(\s[^>]*)?>/gi, "<b>")
    .replace(/<\/strong\s*>/gi, "</b>")
    .replace(/<em(\s[^>]*)?>/gi, "<i>")
    .replace(/<\/em\s*>/gi, "</i>")
    .replace(/<\/?(thead|tbody|tfoot)(\s[^>]*)?>/gi, "")
    .replace(/<img\b[^>]*>/gi, (tag) => (++imgCount > SP_IMG_TAG_LIMIT ? "" : tag));
}
