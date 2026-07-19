/** 楽天スマホ用説明文（productDescription.sp）の禁止タグ自動修正（260720）。
 * sp は PC より許可タグが厳しく、strong / tbody 等が混ざると items.upsert が
 * IE0215（Cannot set "X" in productDescription.sp）で失敗する。
 * PC 向け販売説明文を sp に連結して送る構成のため、送信直前に意味を保存する形で変換する:
 * - strong → b ／ em → i（見た目・意味を維持できる同等タグへ）
 * - thead / tbody / tfoot → タグだけ外して中身（tr/td）を残す（table 構造は維持）
 * PC 側（productDescription.pc / salesDescription）は strong/tbody とも許可のため変換しない。 */
export function sanitizeRakutenSpHtml(html: string): string {
  return String(html ?? "")
    .replace(/<strong(\s[^>]*)?>/gi, "<b>")
    .replace(/<\/strong\s*>/gi, "</b>")
    .replace(/<em(\s[^>]*)?>/gi, "<i>")
    .replace(/<\/em\s*>/gi, "</i>")
    .replace(/<\/?(thead|tbody|tfoot)(\s[^>]*)?>/gi, "");
}
