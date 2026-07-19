/** 楽天スマホ用説明文（productDescription.sp）の禁止タグ自動修正のテスト（260720）。
 * 背景（a028-3593-1-out 実件）: sp は「販売説明文＋スマホ説明文」の連結で送られるが、
 * PC 向け販売説明文に含まれる strong / tbody は sp では楽天が拒否する
 * （IE0215: Cannot set "strong"/"tbody" in productDescription.sp）。
 * 対策: 意味を保存する自動変換 — strong→b・em→i、thead/tbody/tfoot は外して中身を残す。 */
import { describe, it, expect } from "vitest";
import { makeProduct } from "../product/schema";
import { sanitizeRakutenSpHtml } from "./rakuten-sp-html";
import { buildRakutenUpsertBody } from "./rakuten-api";

describe("sanitizeRakutenSpHtml", () => {
  it("strong を b に変換する（属性付き・閉じタグも）", () => {
    expect(sanitizeRakutenSpHtml('<strong class="x">注意</strong>')).toBe("<b>注意</b>");
  });

  it("em を i に変換する", () => {
    expect(sanitizeRakutenSpHtml("<em>強調</em>")).toBe("<i>強調</i>");
  });

  it("tbody/thead/tfoot はタグだけ外して中身（table/tr/td）を残す", () => {
    expect(
      sanitizeRakutenSpHtml("<table><tbody><tr><td>A</td></tr></tbody></table>"),
    ).toBe("<table><tr><td>A</td></tr></table>");
    expect(sanitizeRakutenSpHtml("<thead><tr><th>H</th></tr></thead>")).toBe("<tr><th>H</th></tr>");
  });

  it("楽天SPで許可されるタグ（table/tr/td/p/font/b/hr/br/img/a）は変更しない", () => {
    const ok = '<table width="100%"><tr><td bgcolor="#FFECEC"><p><font size="4"><b>訳あり</b></font></p><hr><br><img src="x.jpg"><a href="y">L</a></td></tr></table>';
    expect(sanitizeRakutenSpHtml(ok)).toBe(ok);
  });

  it("空・タグ無しはそのまま", () => {
    expect(sanitizeRakutenSpHtml("")).toBe("");
    expect(sanitizeRakutenSpHtml("プレーン本文")).toBe("プレーン本文");
  });
});

describe("buildRakutenUpsertBody: productDescription.sp の自動修正", () => {
  it("販売説明文の strong/tbody が sp 連結時に自動変換される（IE0215 の根治）", () => {
    const p = makeProduct({
      sale_description_pc: "<table><tbody><tr><td><strong>訳あり</strong></td></tr></tbody></table>",
      description_sp: "<p>スマホ本文</p>",
    });
    const sp = (buildRakutenUpsertBody(p).productDescription as { sp: string }).sp;
    expect(sp).toBe("<table><tr><td><b>訳あり</b></td></tr></table><p>スマホ本文</p>");
    expect(sp).not.toMatch(/<\/?(strong|tbody|thead|tfoot)/i);
  });

  it("PC 側（productDescription.pc / salesDescription）は変換しない（strong/tbody は PC では許可）", () => {
    const p = makeProduct({
      description_pc: "<strong>PC</strong>",
      sale_description_pc: "<tbody>S</tbody>",
    });
    const body = buildRakutenUpsertBody(p);
    expect((body.productDescription as { pc: string }).pc).toBe("<strong>PC</strong>");
    expect(body.salesDescription).toBe("<tbody>S</tbody>");
  });
});
