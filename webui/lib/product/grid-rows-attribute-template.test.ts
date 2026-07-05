import { describe, it, expect } from "vitest";
import Papa from "papaparse";
import {
  ATTRIBUTE_GRID_COLUMNS,
  BULK_GRID_ALL_COLUMNS,
  BULK_GRID_COLUMNS,
  buildProductsFromRows,
  buildTemplateCsv,
  parseTsv,
  validateGridRow,
} from "./grid-rows";

/** BULK_GRID_ALL_COLUMNS（43列 = 既存28列 + 商品属性15列）のテンプレ往復テスト。
 * テンプレDL → Excel コピー（TSV）→ parseTsv → buildProductsFromRows で、
 * 商品属性のフラット列に入力した値が ProductInput.attributes まで確実に届くことを固定する。 */

const BOM = "﻿";

const parseCsv = (csv: string) =>
  (Papa.parse<string[]>(csv.replace(BOM, ""), { skipEmptyLines: true }).data ?? []);

/** Excel がセルをコピーするときの TSV 表現。 */
function toTsvLine(cells: string[]): string {
  return cells
    .map((c) => (/[\t\n\r"]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c))
    .join("\t");
}

describe("buildTemplateCsv(BULK_GRID_ALL_COLUMNS) — 43列テンプレート", () => {
  const data = parseCsv(buildTemplateCsv(BULK_GRID_ALL_COLUMNS));

  it("見出し43列 + 統合デモの入力例2行 + ※説明行を持つ（見出しは列定義の label と完全一致）", () => {
    expect(data).toHaveLength(4);
    expect(data[0]).toEqual(BULK_GRID_ALL_COLUMNS.map((c) => c.label));
    expect(data[0]).toHaveLength(43);
    expect(data[3][0].startsWith("※")).toBe(true);
  });

  it("入力例は Yahoo 2列（空欄→保存時自動補完のデモ）以外すべて非空（商品属性15列も入力例が入る）", () => {
    BULK_GRID_ALL_COLUMNS.forEach((c, i) => {
      if (c.key === "yahoo_category_id" || c.key === "yahoo_path") {
        expect(data[1][i], `列「${c.label}」は空欄デモのはず`).toBe("");
        return;
      }
      expect(data[1][i].trim(), `列「${c.label}」の入力例が空`).not.toBe("");
      expect(data[2][i].trim(), `列「${c.label}」の2行目入力例が空`).not.toBe("");
    });
  });

  it("既存28列テンプレ（BULK_GRID_COLUMNS）の出力は不変（先頭28列が一致）", () => {
    const legacy = parseCsv(buildTemplateCsv(BULK_GRID_COLUMNS));
    expect(data[0].slice(0, BULK_GRID_COLUMNS.length)).toEqual(legacy[0]);
    expect(data[1].slice(0, BULK_GRID_COLUMNS.length)).toEqual(legacy[1]);
    expect(data[2].slice(0, BULK_GRID_COLUMNS.length)).toEqual(legacy[2]);
  });
});

describe("往復: 43列テンプレ → TSV貼り付け → rows → ProductInput", () => {
  const data = parseCsv(buildTemplateCsv(BULK_GRID_ALL_COLUMNS));
  const tsv = data.map(toTsvLine).join("\r\n");

  it("全43列が row の正しいフィールドへ入る（見出し・※行は自動スキップ）", () => {
    const rows = parseTsv(tsv);
    expect(rows).toHaveLength(2);
    BULK_GRID_ALL_COLUMNS.forEach((col, i) => {
      expect(rows[0][col.key] ?? "", `列「${col.label}」が往復で失われた`).toBe(data[1][i]);
    });
    // 商品属性の代表値（フラット列）
    expect(rows[0].attribute_item_1).toBe(ATTRIBUTE_GRID_COLUMNS[0].example);
    expect(rows[0].attribute_unit_1).toBe(ATTRIBUTE_GRID_COLUMNS[2].example);
  });

  it("貼り付けた入力例は検証を通り、フラット属性が ProductInput.attributes / variants[].attributes に届く", () => {
    const rows = parseTsv(tsv);
    expect(validateGridRow(rows[0])).toEqual([]);
    expect(validateGridRow(rows[1])).toEqual([]);

    const built = buildProductsFromRows(rows);
    expect(built).toHaveLength(1); // バリエーションキー統合で1商品2SKU
    const p = built[0].input!;
    expect(p.variants).toHaveLength(2);

    // 商品属性: フラット15列（5項目）→ attributes[] に枠順で入る
    const items = [0, 1, 2, 3, 4].map((i) => ATTRIBUTE_GRID_COLUMNS[i * 3].example);
    expect(p.attributes.map((a) => a.item)).toEqual(items);
    expect(p.attributes[0].value).toBe(ATTRIBUTE_GRID_COLUMNS[1].example);
    expect(p.attributes[0].unit).toBe(ATTRIBUTE_GRID_COLUMNS[2].example);
    // 各SKUにも同じ属性が入る（楽天はジャンル必須属性を variant 単位で送る）
    for (const v of p.variants) {
      expect(v.attributes.map((a) => a.item)).toEqual(items);
    }
  });

  it("後方互換: 従来28列だけの貼り付けでは商品属性フラット列は未設定のまま", () => {
    const legacy = parseCsv(buildTemplateCsv(BULK_GRID_COLUMNS));
    const rows = parseTsv(legacy.map(toTsvLine).join("\r\n"));
    expect(rows).toHaveLength(2);
    expect(rows[0].attribute_item_1 ?? "").toBe("");
    const p = buildProductsFromRows(rows)[0].input!;
    expect(p.attributes).toEqual([]); // フラット未入力 → row.attributes ?? [] の従来規則
  });
});
