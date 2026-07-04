import { describe, it, expect } from "vitest";
import {
  ALL_GRID_COLUMNS,
  BULK_GRID_COLUMNS,
  type GridRow,
  emptyGridRow,
  validateGridRow,
  validateGridRows,
} from "./grid-rows";

/** select 列（選択肢固定の列）の選択肢外値の検証テスト。
 * turn-002 素材3: 列貼り付け（parseClipboardColumn）は <select> を素通りして任意文字列を
 * 入れられるため、validateGridRow が product_type/税率しか見ていないと「送料区分に HTML」の
 * ような不正値が保存まで素通りしていた。選択肢検証を行エラー（日本語）として固定する。 */

/** テンプレート入力例（example）そのままの行 = 既存の正常データの代表。誤検知しないことの基準。 */
function exampleRow(): GridRow {
  const row = emptyGridRow();
  for (const col of ALL_GRID_COLUMNS) {
    row[col.key] = col.example ?? col.defaultValue ?? "";
  }
  return row;
}

describe("validateGridRow: 送料区分（shipping_type）の選択肢検証", () => {
  it("正常: テンプレート入力例そのままの行はエラーなし（既存データを誤検知しない）", () => {
    expect(validateGridRow(exampleRow())).toEqual([]);
  });

  it("正常: 「送料別」「送料無料」はどちらもエラーなし", () => {
    for (const v of ["送料別", "送料無料"]) {
      const row = { ...exampleRow(), shipping_type: v };
      expect(validateGridRow(row)).toEqual([]);
    }
  });

  it("空欄はエラーなし（保存時に「送料別」へ既定化されるため）", () => {
    const row = { ...exampleRow(), shipping_type: "" };
    expect(validateGridRow(row)).toEqual([]);
  });

  it("前後空白つきの「 送料別 」はエラーなし（保存時変換 gridRowToRaw と同じ trim 判定）", () => {
    const row = { ...exampleRow(), shipping_type: " 送料別 " };
    expect(validateGridRow(row)).toEqual([]);
  });

  it("異常: 選択肢外の値（送料込）は行エラー（日本語）になる", () => {
    const row = { ...exampleRow(), shipping_type: "送料込" };
    const errors = validateGridRow(row);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("送料区分は「送料別」または「送料無料」");
  });

  it("異常: 列貼り付けの誤操作で入る HTML 断片も行エラーになる（保存へ素通りしない）", () => {
    const row = { ...exampleRow(), shipping_type: "<p><b>■ 商品の魅力</b></p>" };
    expect(validateGridRow(row).some((e) => e.includes("送料区分"))).toBe(true);
  });
});

describe("validateGridRow: select 列の棚卸し（全 select 列が選択肢検証されている）", () => {
  it("options を持つ select 列（product_type / tax_rate / shipping_type）はすべて選択肢外値でエラーになる", () => {
    const selects = BULK_GRID_COLUMNS.filter((c) => c.input === "select");
    expect(selects.map((c) => c.key).sort()).toEqual(["product_type", "shipping_type", "tax_rate"]);
    for (const col of selects) {
      const row = { ...exampleRow(), [col.key]: "選択肢外の値" };
      expect(
        validateGridRow(row).length,
        `select 列 ${col.key} に選択肢外の値を入れてもエラーにならない（検証漏れ）`,
      ).toBeGreaterThan(0);
    }
  });
});

describe("validateGridRows: 選択肢外の送料区分が行単位のエラーとして返る", () => {
  it("不正値の行だけがエラーになり、正常行・空行は対象外", () => {
    const bad = { ...exampleRow(), ne_code: "a009-4916-2", shipping_type: "コピー2" };
    const rows = [exampleRow(), bad, emptyGridRow()];
    const result = validateGridRows(rows);
    expect(result.has(0)).toBe(false);
    expect(result.get(1)?.some((e) => e.includes("送料区分"))).toBe(true);
    expect(result.has(2)).toBe(false);
  });
});
