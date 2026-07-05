import { describe, it, expect } from "vitest";
import {
  applyCategoryLoadToRow,
  applyCategoryLoadToRows,
  type CategoryLoadInfo,
} from "./category-assist";
import { emptyGridRow, type GridRow } from "./grid-rows";
import type { GenreAttribute } from "./genre-attributes";
import type { YahooCategoryMapping } from "./category-mapping";

/** 統合「📥 カテゴリ読み込み」（カテゴリ列グループ見出しのボタン）の純関数層のテスト。
 * 規則:
 * - 各行の モール基本カテゴリID に基づき、その行の商品属性列へ項目・単位を展開（機能B。
 *   attributesToColumns 再利用 = 必須優先 top5・推奨単位プリフィル・入力済みの値は item 単位で保持）
 *   → 続けて YahooカテゴリID/パスを空欄のみ適用（機能A = applyYahooCandidate と同一規則）
 * - 未解決カテゴリ（属性もYahoo候補も無い）はその行を変えず unresolved に集計し、他行の処理は継続
 * - カテゴリID未入力の行は触らない（同一参照） */

const attr = (item_name: string, requirement: string, recommended_unit = ""): GenreAttribute => ({
  item_name,
  requirement,
  recommended_unit,
  unit_choices: "",
  has_unit: recommended_unit !== "",
  sort_order: 0,
});

const MAPPING: YahooCategoryMapping = {
  yahoo_category_id: "41383",
  yahoo_category_name: "ソフトドリンク、ジュース",
  yahoo_path: "食品、飲料、製菓＞ソフトドリンク、ジュース",
  confidence: "high",
};

const INFO_A: CategoryLoadInfo = { attrs: [attr("内容量", "必須", "ml"), attr("ブランド名", "任意")], yahoo: MAPPING };
const INFO_B: CategoryLoadInfo = { attrs: [attr("産地", "必須")], yahoo: null };
const INFO_EMPTY: CategoryLoadInfo = { attrs: [], yahoo: null };

function filledRow(overrides: Partial<GridRow> = {}): GridRow {
  return {
    ...emptyGridRow(),
    ne_code: "a009-4916-1",
    jan_code: "4514603474916",
    maker_code: "a009",
    product_name: "沖縄バヤリース 島レモネード PET 500ml",
    selling_price: "200",
    mall_category_id: "110692",
    auto: { ne_code: false, display_name: false },
    ...overrides,
  };
}

describe("applyCategoryLoadToRow（1行分: 行自身のカテゴリIDで B→A を適用）", () => {
  const infoMap = new Map<string, CategoryLoadInfo>([["110692", INFO_A], ["999999", INFO_B]]);

  it("属性の項目・単位が行の商品属性列へ入り、Yahoo ID/パスも空欄なら入る", () => {
    const out = applyCategoryLoadToRow(filledRow(), infoMap);
    expect(out.attribute_item_1).toBe("内容量");
    expect(out.attribute_unit_1).toBe("ml"); // 推奨単位プリフィル
    expect(out.attribute_value_1).toBe(""); // 値は行内で入力
    expect(out.attribute_item_2).toBe("ブランド名");
    expect(out.yahoo_category_id).toBe("41383");
    expect(out.yahoo_path).toBe(MAPPING.yahoo_path);
  });

  it("入力済みの属性値は item 単位で保持し（枠が変わっても追従）、Yahoo 手入力は上書きしない", () => {
    const before = filledRow({
      attribute_item_2: "内容量", // 前回は2枠目
      attribute_value_2: "500",
      attribute_unit_2: "L",
      yahoo_category_id: "99999",
      yahoo_path: "手入力＞パス",
    });
    const out = applyCategoryLoadToRow(before, infoMap);
    expect(out.attribute_item_1).toBe("内容量");
    expect(out.attribute_value_1).toBe("500"); // 値を保持
    expect(out.attribute_unit_1).toBe("L"); // 手入力単位を保持
    expect(out.yahoo_category_id).toBe("99999"); // 手入力優先
    expect(out.yahoo_path).toBe("手入力＞パス");
  });

  it("カテゴリID未入力・未解決カテゴリ・infoMap 未登録の行は同一参照のまま返す", () => {
    const noCat = filledRow({ mall_category_id: "" });
    expect(applyCategoryLoadToRow(noCat, infoMap)).toBe(noCat);
    const unresolvedRow = filledRow({ mall_category_id: "777" });
    expect(applyCategoryLoadToRow(unresolvedRow, new Map([["777", INFO_EMPTY]]))).toBe(unresolvedRow);
    expect(applyCategoryLoadToRow(unresolvedRow, infoMap)).toBe(unresolvedRow); // map に無いIDも同様
  });

  it("カテゴリIDは trim 比較で解決し、元の行は変更しない（イミュータブル）", () => {
    const before = filledRow({ mall_category_id: " 110692 " });
    const out = applyCategoryLoadToRow(before, infoMap);
    expect(out.attribute_item_1).toBe("内容量");
    expect(before.attribute_item_1 ?? "").toBe("");
    expect(before.yahoo_category_id).toBe("");
  });
});

describe("applyCategoryLoadToRows（全行: 行ごとのカテゴリIDで一括適用 + 件数集計）", () => {
  it("行ごとに自分のカテゴリの属性が入り、カテゴリ違いは混ざらない（機能B = 行単位）", () => {
    const rows = [
      filledRow(), // カテゴリA
      filledRow({ mall_category_id: "110692" }), // カテゴリA
      filledRow({ mall_category_id: "999999" }), // カテゴリB
      filledRow({ mall_category_id: "" }), // カテゴリ未入力
    ];
    const infoMap = new Map([["110692", INFO_A], ["999999", INFO_B]]);
    const result = applyCategoryLoadToRows(rows, infoMap);
    expect(result.rows[0].attribute_item_1).toBe("内容量");
    expect(result.rows[1].attribute_item_1).toBe("内容量");
    expect(result.rows[2].attribute_item_1).toBe("産地"); // 行単位で自分のカテゴリ
    expect(result.rows[2].attribute_item_2).toBe("");
    expect(result.rows[3]).toBe(rows[3]); // 未入力行は同一参照
    expect(result.categories).toBe(2);
    expect(result.attrRows).toBe(3);
  });

  it("Yahoo は空欄の行のみ適用し、入力済みの行はスキップとして数える", () => {
    const rows = [
      filledRow(), // 空欄 → 適用
      filledRow({ yahoo_category_id: "99999", yahoo_path: "手入力＞パス" }), // 入力済み → スキップ
      filledRow({ mall_category_id: "999999" }), // カテゴリB は Yahoo 候補なし → 適用/スキップに数えない
    ];
    const result = applyCategoryLoadToRows(rows, new Map([["110692", INFO_A], ["999999", INFO_B]]));
    expect(result.yahooApplied).toBe(1);
    expect(result.yahooSkipped).toBe(1);
    expect(result.rows[0].yahoo_category_id).toBe("41383");
    expect(result.rows[1].yahoo_category_id).toBe("99999");
    expect(result.rows[2].yahoo_category_id).toBe("");
  });

  it("未解決カテゴリ（属性もYahooも無し）は unresolved に集計し、他行の処理は継続する", () => {
    const rows = [
      filledRow({ mall_category_id: "777" }), // 未解決
      filledRow(), // 解決 → 処理継続
      filledRow({ mall_category_id: "777" }), // 同じ未解決IDは1回だけ集計
    ];
    const result = applyCategoryLoadToRows(rows, new Map([["777", INFO_EMPTY], ["110692", INFO_A]]));
    expect(result.unresolved).toEqual(["777"]);
    expect(result.rows[0]).toBe(rows[0]); // 未解決の行は変えない
    expect(result.rows[2]).toBe(rows[2]);
    expect(result.rows[1].attribute_item_1).toBe("内容量"); // 他行は処理される
    expect(result.rows[1].yahoo_category_id).toBe("41383");
  });

  it("6件目以降の属性があるカテゴリを truncatedCategories に数える（top5 展開自体は成立）", () => {
    const seven: CategoryLoadInfo = {
      attrs: [
        attr("必須1", "必須", "ml"), attr("任意1", "任意"), attr("任意2", "任意"),
        attr("任意3", "任意"), attr("任意4", "任意"), attr("任意5", "任意"), attr("任意6", "任意"),
      ],
      yahoo: null,
    };
    const result = applyCategoryLoadToRows([filledRow({ mall_category_id: "888" })], new Map([["888", seven]]));
    expect(result.truncatedCategories).toBe(1);
    expect(result.rows[0].attribute_item_1).toBe("必須1");
    expect(result.rows[0].attribute_item_5).toBe("任意4");

    const ok = applyCategoryLoadToRows([filledRow()], new Map([["110692", INFO_A]]));
    expect(ok.truncatedCategories).toBe(0);
  });

  it("元の行配列・行オブジェクトは変更しない（イミュータブル）", () => {
    const rows = [filledRow()];
    applyCategoryLoadToRows(rows, new Map([["110692", INFO_A]]));
    expect(rows[0].attribute_item_1 ?? "").toBe("");
    expect(rows[0].yahoo_category_id).toBe("");
  });
});
