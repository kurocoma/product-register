import { describe, it, expect } from "vitest";
import Papa from "papaparse";
import {
  ALL_GRID_COLUMNS,
  BULK_GRID_COLUMNS,
  TEMPLATE_NOTE,
  buildProductsFromRows,
  buildTemplateCsv,
  parseTsv,
} from "./grid-rows";
import { applyCategoryAutofill } from "./category-autofill";
import type { YahooCategoryMapping } from "./category-mapping";

const BOM = "﻿";

const parseCsv = (csv: string) =>
  (Papa.parse<string[]>(csv.replace(BOM, ""), { skipEmptyLines: true }).data ?? []);

function toTsvLine(cells: string[]): string {
  return cells
    .map((c) => (/[\t\n\r"]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c))
    .join("\t");
}

const colIndex = (key: string) => BULK_GRID_COLUMNS.findIndex((c) => c.key === key);

describe("バリエーションキー入りテンプレの Yahoo 列は空欄（※説明と例の挙動一致）", () => {
  const data = parseCsv(buildTemplateCsv(BULK_GRID_COLUMNS));
  const yahooId = colIndex("yahoo_category_id");
  const yahooPath = colIndex("yahoo_path");

  it("入力例2行とも YahooカテゴリID / Yahooストアカテゴリパス が空欄になる", () => {
    expect(data[1][yahooId]).toBe("");
    expect(data[1][yahooPath]).toBe("");
    expect(data[2][yahooId]).toBe("");
    expect(data[2][yahooPath]).toBe("");
  });

  it("モール基本カテゴリIDは入力例に入っている（「カテゴリIDのみ入力」を例が体現）", () => {
    const mallCat = colIndex("mall_category_id");
    expect(data[1][mallCat]).toBe("110692");
    expect(data[2][mallCat]).toBe("110692");
  });

  it("Yahoo 2列以外の入力例は従来どおり（bulkExample は Yahoo 2列だけ）", () => {
    BULK_GRID_COLUMNS.forEach((c, i) => {
      if (c.key === "yahoo_category_id" || c.key === "yahoo_path") return;
      expect(data[1][i], `列「${c.label}」の入力例が変わった`).toBe(c.example ?? c.defaultValue ?? "");
    });
  });

  it("※説明行は「空欄のまま→保存時に自動補完」を案内している（例と説明が食い違わない）", () => {
    expect(data[3][0].startsWith("※")).toBe(true);
    expect(data[3][0]).toContain("空欄のまま");
    expect(data[3][0]).toContain("自動補完");
    expect(TEMPLATE_NOTE).toContain("モール基本カテゴリID");
  });

  it("既定の27列テンプレは従来どおり YahooカテゴリID の例が入る（後方互換・bulkExample の影響なし）", () => {
    const legacy = parseCsv(buildTemplateCsv());
    expect(legacy).toHaveLength(2);
    const idx = ALL_GRID_COLUMNS.findIndex((c) => c.key === "yahoo_category_id");
    expect(legacy[1][idx]).toBe("13457");
    // 全列に入力例がある（既存テンプレの「空セルなし」仕様を維持）
    legacy[1].forEach((cell, i) => {
      expect(cell.trim(), `${ALL_GRID_COLUMNS[i].label} の入力例が空`).not.toBe("");
    });
  });
});

describe("テンプレ往復: Yahoo列空欄のまま取込 → 保存時にカテゴリIDから自動補完される", () => {
  const mapping: YahooCategoryMapping = {
    yahoo_category_id: "44433",
    yahoo_category_name: "ソフトドリンク、ジュース",
    yahoo_path: "食品＞ソフトドリンク、ジュース",
    confidence: "high",
  };

  it("テンプレ2行を貼り付けると Yahoo 列は空欄のまま統合され、autofill で補完される", () => {
    const data = parseCsv(buildTemplateCsv(BULK_GRID_COLUMNS));
    const rows = parseTsv(data.map(toTsvLine).join("\r\n"));
    expect(rows).toHaveLength(2); // 見出し・※行は自動スキップ
    expect(rows.map((r) => r.yahoo_category_id)).toEqual(["", ""]);
    expect(rows.map((r) => r.yahoo_path)).toEqual(["", ""]);

    const built = buildProductsFromRows(rows);
    expect(built).toHaveLength(1);
    const p = built[0].input!;
    expect(p.variants).toHaveLength(2);
    expect(p.yahoo_category_id).toBe(""); // 取込時点では空欄

    // 保存時の自動補完（BulkGridEditor.save と同じ applyCategoryAutofill）で埋まる
    const { product, filled } = applyCategoryAutofill(p, [], mapping);
    expect(filled.yahoo).toBe(true);
    expect(product.yahoo_category_id).toBe("44433");
    expect(product.yahoo_path).toBe("食品＞ソフトドリンク、ジュース");
  });

  it("手入力があるときは補完で上書きしない（手入力優先の維持）", () => {
    const data = parseCsv(buildTemplateCsv(BULK_GRID_COLUMNS));
    const rows = parseTsv(data.map(toTsvLine).join("\r\n"));
    rows[0].yahoo_category_id = "99999"; // 代表行（数量1）に手入力
    const p = buildProductsFromRows(rows)[0].input!;
    const { product, filled } = applyCategoryAutofill(p, [], mapping);
    expect(product.yahoo_category_id).toBe("99999"); // 手入力を保持
    expect(product.yahoo_path).toBe("食品＞ソフトドリンク、ジュース"); // 空欄側だけ補完
    expect(filled.yahoo).toBe(true);
  });
});
