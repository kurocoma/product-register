/** sanitizeRakutenSpHtml の <img> 上限（IE0257 対策）の characterization テスト。
 * sp は img 最大 20 個。21 個目以降は除去され、それ以外の内容は保持されること。 */
import { describe, expect, it } from "vitest";

import { sanitizeRakutenSpHtml } from "./rakuten-sp-html";

const img = (i: number) => `<img src="https://image.rakuten.co.jp/shop/cabinet/${i}.jpg">`;
const countImg = (html: string) => (html.match(/<img\b/gi) ?? []).length;

describe("sanitizeRakutenSpHtml <img> 上限 (IE0257)", () => {
  it("20個以下の img はそのまま残す", () => {
    const html = Array.from({ length: 20 }, (_, i) => img(i)).join("<br>");
    expect(sanitizeRakutenSpHtml(html)).toBe(html);
  });

  it("21個以上の img は文書順で先頭20個だけ残す", () => {
    const html = Array.from({ length: 25 }, (_, i) => img(i)).join("");
    const out = sanitizeRakutenSpHtml(html);
    expect(countImg(out)).toBe(20);
    expect(out.startsWith(img(0))).toBe(true);
    expect(out.endsWith(img(19))).toBe(true);
    expect(out).not.toContain("/20.jpg");
    expect(out).not.toContain("/24.jpg");
  });

  it("img を除去してもテキストや他タグは保持する", () => {
    const html =
      "<p>冒頭</p>" +
      Array.from({ length: 22 }, (_, i) => `${img(i)}<br>説明${i}`).join("") +
      "<p>末尾</p>";
    const out = sanitizeRakutenSpHtml(html);
    expect(countImg(out)).toBe(20);
    expect(out).toContain("<p>冒頭</p>");
    expect(out).toContain("<p>末尾</p>");
    expect(out).toContain("説明20");
    expect(out).toContain("説明21");
  });

  it("大文字 <IMG> や self-closing もカウント対象", () => {
    const html =
      Array.from({ length: 10 }, (_, i) => `<IMG SRC="a${i}.jpg">`).join("") +
      Array.from({ length: 12 }, (_, i) => `<img src="b${i}.jpg" />`).join("");
    expect(countImg(sanitizeRakutenSpHtml(html))).toBe(20);
  });

  it("IE0215 対策（strong→b 等）と併用しても img 上限が効く", () => {
    const html =
      "<strong>注意</strong>" + Array.from({ length: 21 }, (_, i) => img(i)).join("");
    const out = sanitizeRakutenSpHtml(html);
    expect(out).toContain("<b>注意</b>");
    expect(countImg(out)).toBe(20);
  });
});
