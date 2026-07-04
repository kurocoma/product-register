import { describe, it, expect } from "vitest";
import {
  emptyGridRow,
  fillDown,
  parseClipboardColumn,
  type GridRow,
} from "./grid-rows";

/** Excel データ入力シートの実データ相当（a009-4916 バヤリース島レモネード）を1行組み立てる。 */
function filledRow(overrides: Partial<GridRow> = {}): GridRow {
  return {
    ...emptyGridRow(),
    ne_code: "a009-4916-1",
    jan_code: "4514603474916",
    maker_code: "a009",
    product_type: "単品",
    quantity: "1",
    product_name: "沖縄バヤリース 島レモネード PET 500ml",
    display_name: "沖縄バヤリース 島レモネード PET 500ml",
    tax_rate: "8",
    selling_price: "200",
    mall_category_id: "110692",
    auto: { ne_code: false, display_name: false },
    ...overrides,
  };
}

describe("parseClipboardColumn（Excel 1列コピーの縦データ解釈）", () => {
  it("CRLF 区切り + 末尾改行（Excel の実クリップボード形式）を値の配列にする", () => {
    expect(parseClipboardColumn("あいう\r\nかきく\r\nさしす\r\n")).toEqual(["あいう", "かきく", "さしす"]);
  });

  it("LF のみ・末尾改行なしでも取り込める", () => {
    expect(parseClipboardColumn("a\nb")).toEqual(["a", "b"]);
  });

  it("セル内改行を含むセル（Excel はダブルクォートで包む）は1セル=1値として解釈する", () => {
    // free2 列相当: 複数行 HTML の縦コピー
    const html1 = '<!--text--><p><br><b>■ 商品の魅力</b></p>\n<p>沖縄限定の島レモネード。</p>';
    const html2 = '<p><b>■ 内容量</b></p>\n<p>500ml×24本</p>';
    const clipboard = `"${html1}"\r\n"${html2}"\r\n`;
    expect(parseClipboardColumn(clipboard)).toEqual([html1, html2]);
  });

  it('クォート内の "" エスケープを解釈する', () => {
    expect(parseClipboardColumn('"say ""hi"""\r\n')).toEqual(['say "hi"']);
  });

  it("途中の空セルは空値として保持し、行ズレを起こさない（末尾改行由来の空だけ除去）", () => {
    expect(parseClipboardColumn("a\r\n\r\nc\r\n")).toEqual(["a", "", "c"]);
  });

  it("改行なしの単一値は1要素で返す", () => {
    expect(parseClipboardColumn("abc")).toEqual(["abc"]);
  });

  it("空文字は空配列", () => {
    expect(parseClipboardColumn("")).toEqual([]);
  });
});

describe("fillDown（下方向コピー）", () => {
  it("fromIndex の値を下の全行へコピーする（上の行・コピー元は不変）", () => {
    const rows = [
      filledRow({ catch_copy_pc: "上の行" }),
      filledRow({ catch_copy_pc: "コピー元" }),
      filledRow({ catch_copy_pc: "" }),
      filledRow({ catch_copy_pc: "上書きされる" }),
    ];
    const out = fillDown(rows, "catch_copy_pc", 1);
    expect(out[0].catch_copy_pc).toBe("上の行");
    expect(out[1].catch_copy_pc).toBe("コピー元");
    expect(out[2].catch_copy_pc).toBe("コピー元");
    expect(out[3].catch_copy_pc).toBe("コピー元");
    // 元配列は変更しない（イミュータブル）
    expect(rows[2].catch_copy_pc).toBe("");
  });

  it("count 指定で件数を限定できる", () => {
    const rows = [filledRow({ unit: "本" }), filledRow({ unit: "" }), filledRow({ unit: "" }), filledRow({ unit: "" })];
    const out = fillDown(rows, "unit", 0, 2);
    expect(out.map((r) => r.unit)).toEqual(["本", "本", "本", ""]);
  });

  it("最終行から呼ぶとコピー先が無く、同じ配列をそのまま返す（no-op 判定可能）", () => {
    const rows = [filledRow(), filledRow()];
    expect(fillDown(rows, "catch_copy_pc", 1)).toBe(rows);
    expect(fillDown(rows, "catch_copy_pc", 5)).toBe(rows); // 範囲外も no-op
  });

  it("セル編集と同じ連動をする（JANコードのコピーで自動追従中の NEコードが再生成される）", () => {
    const rows = [
      filledRow(),
      filledRow({ ne_code: "", jan_code: "", quantity: "6", auto: { ne_code: true, display_name: false } }),
    ];
    const out = fillDown(rows, "jan_code", 0);
    expect(out[1].jan_code).toBe("4514603474916");
    expect(out[1].ne_code).toBe("a009-4916-6"); // maker-JAN下4桁-数量 で再生成
  });

  it("optional 列（バリエーションキー）も下方向コピーできる", () => {
    const rows = [filledRow({ variation_key: "レモネード500" }), filledRow()];
    const out = fillDown(rows, "variation_key", 0);
    expect(out[1].variation_key).toBe("レモネード500");
  });
});
