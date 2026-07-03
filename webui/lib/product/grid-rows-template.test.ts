import { describe, it, expect } from "vitest";
import Papa from "papaparse";
import {
  ALL_GRID_COLUMNS,
  GRID_COLUMNS,
  GRID_COLUMNS_EXTRA,
  TEMPLATE_FILENAME,
  buildTemplateCsv,
  columnGroups,
  emptyGridRow,
  expandSetRows,
  gridRowToProductInput,
  parseTsv,
  validateGridRow,
  type GridRow,
} from "./grid-rows";

const BOM = "﻿";

/** Excel がセルをコピーするときの TSV 表現（タブ・改行・引用符入りセルは引用符で包む）。 */
function toTsvLine(cells: string[]): string {
  return cells
    .map((c) => (/[\t\n\r"]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c))
    .join("\t");
}

/** テンプレートCSV をパースして [見出し行, 入力例行] を返す（BOM は除去）。 */
function parseTemplate(): { header: string[]; example: string[] } {
  const csv = buildTemplateCsv().replace(BOM, "");
  const parsed = Papa.parse<string[]>(csv, { skipEmptyLines: true });
  const data = parsed.data ?? [];
  return { header: data[0] ?? [], example: data[1] ?? [] };
}

describe("列定義の単一源泉（ALL_GRID_COLUMNS）", () => {
  it("先頭18列は既存のデータ入力シート列（GRID_COLUMNS）と同一参照・同一順", () => {
    expect(ALL_GRID_COLUMNS.slice(0, GRID_COLUMNS.length)).toEqual(GRID_COLUMNS);
    expect(ALL_GRID_COLUMNS.slice(GRID_COLUMNS.length)).toEqual(GRID_COLUMNS_EXTRA);
  });

  it("拡張列に商品説明文（PC/スマホ）・販売説明文・キーワード・メーカー名・ブランド名・Yahooカテゴリ・単位がある", () => {
    expect(GRID_COLUMNS_EXTRA.map((c) => c.label)).toEqual([
      "PC用販売説明文", "商品説明PC", "商品説明スマホ", "検索キーワード",
      "メーカー名", "ブランド名", "YahooカテゴリID", "Yahooストアカテゴリパス", "単位",
    ]);
  });

  it("列キーに重複がなく、emptyGridRow の全フィールド（auto 以外）と一致する", () => {
    const keys = ALL_GRID_COLUMNS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    const rowKeys = Object.keys(emptyGridRow()).filter((k) => k !== "auto");
    expect([...keys].sort()).toEqual([...rowKeys].sort());
  });

  it("既定値は列定義（defaultValue）から emptyGridRow に反映される", () => {
    const r = emptyGridRow();
    for (const c of ALL_GRID_COLUMNS) {
      expect(r[c.key]).toBe(c.defaultValue ?? "");
    }
  });

  it("長文列（説明文系）は long フラグを持つ（UI が拡大エディタを出す判定）", () => {
    const longKeys = ALL_GRID_COLUMNS.filter((c) => c.long).map((c) => c.key);
    expect(longKeys).toEqual(["sale_description_pc", "description_pc", "description_sp"]);
  });
});

describe("columnGroups（列グループ見出し）", () => {
  it("連続する同名グループを束ね、スパン合計 = 全列数になる", () => {
    const groups = columnGroups();
    expect(groups.map((g) => g.name)).toEqual(["基本情報", "価格", "配送", "カテゴリ", "商品説明", "Yahoo"]);
    expect(groups.reduce((s, g) => s + g.span, 0)).toBe(ALL_GRID_COLUMNS.length);
    // 隣接グループが同名にならない（束ね漏れがない）
    for (let i = 1; i < groups.length; i++) expect(groups[i].name).not.toBe(groups[i - 1].name);
  });
});

describe("buildTemplateCsv（テンプレートDL）", () => {
  it("UTF-8 BOM 付きで始まる（Excel でそのまま開ける）", () => {
    expect(buildTemplateCsv().startsWith(BOM)).toBe(true);
    expect(TEMPLATE_FILENAME.endsWith(".csv")).toBe(true);
  });

  it("1行目の見出しがグリッド列の label と完全一致する（単一源泉）", () => {
    const { header } = parseTemplate();
    expect(header).toEqual(ALL_GRID_COLUMNS.map((c) => c.label));
  });

  it("2行目に全列そろった入力例があり、空セルがない", () => {
    const { example } = parseTemplate();
    expect(example).toHaveLength(ALL_GRID_COLUMNS.length);
    example.forEach((cell, i) => {
      expect(cell.trim(), `${ALL_GRID_COLUMNS[i].label} の入力例が空`).not.toBe("");
    });
  });
});

describe("往復テスト: テンプレ列 → TSV貼り付け → rows → ProductInput", () => {
  it("テンプレートの入力例をそのまま貼り付けると全項目が row に入る（見出し行は自動スキップ）", () => {
    const { header, example } = parseTemplate();
    // Excel でテンプレートを開いて全体をコピーした状態を再現（見出し行 + 入力例行の TSV）
    const tsv = [toTsvLine(header), toTsvLine(example)].join("\r\n");
    const rows = parseTsv(tsv);
    expect(rows).toHaveLength(1);
    ALL_GRID_COLUMNS.forEach((col, i) => {
      expect(rows[0][col.key], `列「${col.label}」が往復で失われた`).toBe(example[i]);
    });
  });

  it("貼り付けた入力例はそのまま検証を通り、ProductInput へ全項目が引き継がれる", () => {
    const { header, example } = parseTemplate();
    const rows = parseTsv([toTsvLine(header), toTsvLine(example)].join("\r\n"));
    expect(validateGridRow(rows[0])).toEqual([]);

    const p = gridRowToProductInput(rows[0]);
    // 基本18列の代表値
    expect(p.ne_code).toBe("a009-4916-1");
    expect(p.jan_code).toBe("4514603474916");
    expect(p.tax_rate).toBe(8);
    expect(p.selling_price).toBe(200);
    expect(p.store_category).toBe("フルーツ・ソフトドリンク・酢");
    // 拡張9列がすべて ProductInput に残る
    expect(p.sale_description_pc).toBe("<p>沖縄限定の島レモネード。まとめ買いがお得です。</p>");
    expect(p.description_pc).toBe("<p>シークヮーサー果汁入り。沖縄限定の島レモネードです。</p>");
    expect(p.description_sp).toBe("シークヮーサー果汁入り。沖縄限定の島レモネードです。");
    expect(p.keyword).toBe("レモネード 沖縄 バヤリース");
    expect(p.maker_name).toBe("沖縄バヤリース");
    expect(p.brand_name).toBe("バヤリース");
    expect(p.yahoo_category_id).toBe("13457");
    expect(p.yahoo_path).toBe("食品、飲料、製菓＞ソフトドリンク、ジュース");
    expect(p.unit).toBe("本");
  });

  it("見出し無し・データ行だけの貼り付けでも拡張列まで取り込める", () => {
    const { example } = parseTemplate();
    const rows = parseTsv(toTsvLine(example));
    expect(rows).toHaveLength(1);
    expect(rows[0].description_pc).toBe("<p>シークヮーサー果汁入り。沖縄限定の島レモネードです。</p>");
    expect(rows[0].unit).toBe("本");
  });
});

describe("parseTsv の拡張列対応（列ズレ検出）", () => {
  const fullRow = () => ALL_GRID_COLUMNS.map((c) => c.example ?? c.defaultValue ?? "");

  it("左端の空列（シートA列）ごとコピーしても、JANコードの位置から列ズレを補正する", () => {
    const rows = parseTsv(toTsvLine(["", ...fullRow()]));
    expect(rows).toHaveLength(1);
    expect(rows[0].ne_code).toBe("a009-4916-1");
    expect(rows[0].jan_code).toBe("4514603474916");
    expect(rows[0].unit).toBe("本");
  });

  it("NEコード列が空欄（自動生成待ち）の全列貼り付けは、列をずらさず自動補完する", () => {
    const cells = fullRow();
    cells[0] = ""; // NEコードのみ空
    const rows = parseTsv(toTsvLine(cells));
    expect(rows).toHaveLength(1);
    expect(rows[0].ne_code).toBe("a009-4916-1"); // maker-JAN下4桁-数量 から自動生成
    expect(rows[0].jan_code).toBe("4514603474916"); // ずれていない
    expect(rows[0].description_sp).toBe("シークヮーサー果汁入り。沖縄限定の島レモネードです。");
  });

  it("従来の基本18列だけの貼り付けは、拡張列を既定値のまま取り込む（後方互換）", () => {
    const legacy = GRID_COLUMNS.map((c) => c.example ?? c.defaultValue ?? "");
    const rows = parseTsv(toTsvLine(legacy));
    expect(rows).toHaveLength(1);
    expect(rows[0].catch_copy_yahoo).toBe("沖縄の夏を彩る島レモネード！");
    expect(rows[0].description_pc).toBe("");
    expect(rows[0].yahoo_category_id).toBe("");
  });

  it("引用符付き・セル内改行の長文（説明文HTML）も1セルとして取り込める", () => {
    const cells = fullRow();
    const html = "<p>1行目</p>\n<p>2行目</p>";
    cells[ALL_GRID_COLUMNS.findIndex((c) => c.key === "description_pc")] = html;
    const rows = parseTsv(toTsvLine(cells));
    expect(rows).toHaveLength(1);
    expect(rows[0].description_pc).toBe(html);
  });
});

describe("拡張列の変換・セット行展開", () => {
  const filled = (): GridRow => {
    const base = emptyGridRow();
    for (const c of ALL_GRID_COLUMNS) base[c.key] = c.example ?? c.defaultValue ?? "";
    base.auto = { ne_code: false, display_name: false };
    return base;
  };

  it("gridRowToProductInput が拡張列を trim して引き継ぐ", () => {
    const row = filled();
    row.keyword = "  レモネード 沖縄  ";
    row.maker_name = " 沖縄バヤリース ";
    const p = gridRowToProductInput(row);
    expect(p.keyword).toBe("レモネード 沖縄");
    expect(p.maker_name).toBe("沖縄バヤリース");
  });

  it("セット行の自動展開でも説明文・Yahooカテゴリ等の拡張列を引き継ぐ", () => {
    const sets = expandSetRows(filled(), [6]);
    expect(sets).toHaveLength(1);
    expect(sets[0].ne_code).toBe("a009-4916-6");
    expect(sets[0].sale_description_pc).toBe("<p>沖縄限定の島レモネード。まとめ買いがお得です。</p>");
    expect(sets[0].description_pc).toBe("<p>シークヮーサー果汁入り。沖縄限定の島レモネードです。</p>");
    expect(sets[0].keyword).toBe("レモネード 沖縄 バヤリース");
    expect(sets[0].yahoo_category_id).toBe("13457");
    expect(sets[0].unit).toBe("本");
  });
});
