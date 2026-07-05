import { describe, it, expect } from "vitest";
import { attributesToColumns } from "./category-assist";
import { emptyGridRow, type GridRow } from "./grid-rows";
import type { GenreAttribute } from "./genre-attributes";

/** attributesToColumns（カテゴリ読み込み → 属性をグリッド列へ展開する純関数）のテスト。
 * 規則:
 * - 必須系（requirement に「必須」を含む: 必須/いずれか必須）優先 → 同順位は API 順（sort_order 取得順）
 * - 先頭5件を attribute_item_N / attribute_unit_N に割当（単位は楽天推奨単位をプリフィル）
 * - currentRow に同名 item の入力が既にあれば、その値（attribute_value_N）と単位を保持する
 * - 6件目以降は切り捨て、truncated に件数を返す（編集画面で入力する案内に使う）
 * - attrs 空（マスタ未登録）は columns 空 = 行を変えない */

const attr = (
  item_name: string,
  requirement: string,
  recommended_unit = "",
  sort_order = 0,
): GenreAttribute => ({
  item_name,
  requirement,
  recommended_unit,
  unit_choices: "",
  has_unit: recommended_unit !== "",
  sort_order,
});

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

/** 7件（必須3 + 任意4）: 必須優先 → API順 で先頭5件が選ばれ、任意の後ろ2件が切り捨てられる。 */
const SEVEN: GenreAttribute[] = [
  attr("任意A", "任意", "", 1),
  attr("内容量", "必須", "ml", 2),
  attr("任意B", "任意", "", 3),
  attr("原材料", "いずれか必須", "", 4),
  attr("任意C", "任意", "", 5),
  attr("賞味期限", "必須", "日", 6),
  attr("任意D", "任意", "", 7),
];

describe("attributesToColumns: 必須優先 → API順で先頭5件を割当", () => {
  it("必須系（必須・いずれか必須）が先、残りを API 順で埋め、6件目以降は truncated に返す", () => {
    const { columns, truncated } = attributesToColumns(SEVEN, emptyGridRow());
    expect([
      columns.attribute_item_1, columns.attribute_item_2, columns.attribute_item_3,
      columns.attribute_item_4, columns.attribute_item_5,
    ]).toEqual(["内容量", "原材料", "賞味期限", "任意A", "任意B"]);
    expect(truncated).toBe(2); // 任意C・任意D が切り捨て
  });

  it("単位は楽天推奨単位をプリフィルし、推奨が無い項目は空", () => {
    const { columns } = attributesToColumns(SEVEN, emptyGridRow());
    expect(columns.attribute_unit_1).toBe("ml"); // 内容量
    expect(columns.attribute_unit_2).toBe(""); // 原材料（推奨単位なし）
    expect(columns.attribute_unit_3).toBe("日"); // 賞味期限
  });

  it("値の枠は空でスタートする（値だけ行内で入力すれば良い状態）", () => {
    const { columns } = attributesToColumns(SEVEN, emptyGridRow());
    for (const key of ["attribute_value_1", "attribute_value_2", "attribute_value_3", "attribute_value_4", "attribute_value_5"] as const) {
      expect(columns[key]).toBe("");
    }
  });

  it("5件以下なら truncated=0 で、余った枠は空文字にする（前カテゴリの残骸を消す）", () => {
    const stale = filledRow({
      attribute_item_4: "前カテゴリの項目",
      attribute_value_4: "残骸",
      attribute_unit_4: "個",
    });
    const { columns, truncated } = attributesToColumns([attr("内容量", "必須", "ml")], stale);
    expect(truncated).toBe(0);
    expect(columns.attribute_item_1).toBe("内容量");
    expect(columns.attribute_item_4).toBe("");
    expect(columns.attribute_value_4).toBe("");
    expect(columns.attribute_unit_4).toBe("");
  });
});

describe("attributesToColumns: 既存入力の保持（手入力優先）", () => {
  it("currentRow のフラット列に同名 item の値・単位があれば保持する（枠位置が変わっても item 単位で追従）", () => {
    const current = filledRow({
      // 前回は 2枠目に入っていた内容量（値・単位入力済み。単位はユーザーが L に変更済み）
      attribute_item_2: "内容量",
      attribute_value_2: "500",
      attribute_unit_2: "L",
    });
    const { columns } = attributesToColumns(SEVEN, current);
    // 今回の並びでは内容量が1枠目 → 値と単位が枠を越えて引き継がれる
    expect(columns.attribute_item_1).toBe("内容量");
    expect(columns.attribute_value_1).toBe("500");
    expect(columns.attribute_unit_1).toBe("L"); // 手入力単位を推奨単位 ml で上書きしない
  });

  it("currentRow.attributes（旧形式の行付帯データ）の値も item 単位で保持する", () => {
    const current = filledRow({
      attributes: [{ item: "原材料", value: "レモン果汁", unit: "", requirement: "いずれか必須" }],
    });
    const { columns } = attributesToColumns(SEVEN, current);
    expect(columns.attribute_item_2).toBe("原材料");
    expect(columns.attribute_value_2).toBe("レモン果汁");
    expect(columns.attribute_unit_2).toBe(""); // 単位未入力・推奨も無し
  });

  it("既存単位が空なら推奨単位をプリフィルする", () => {
    const current = filledRow({
      attribute_item_1: "内容量",
      attribute_value_1: "500",
      attribute_unit_1: "",
    });
    const { columns } = attributesToColumns(SEVEN, current);
    expect(columns.attribute_value_1).toBe("500");
    expect(columns.attribute_unit_1).toBe("ml");
  });

  it("currentRow は変更しない（イミュータブル）", () => {
    const current = filledRow({ attribute_item_1: "内容量", attribute_value_1: "500" });
    const snapshot = JSON.parse(JSON.stringify(current));
    attributesToColumns(SEVEN, current);
    expect(current).toEqual(snapshot);
  });
});

describe("attributesToColumns: マスタ未登録", () => {
  it("attrs 空なら columns 空 + truncated=0（行を変えない = 既存規則と同じ）", () => {
    const { columns, truncated } = attributesToColumns([], filledRow({ attribute_item_1: "内容量" }));
    expect(columns).toEqual({});
    expect(truncated).toBe(0);
  });
});
