import { describe, it, expect } from "vitest";
import {
  GRID_COLUMNS,
  applyFieldChange,
  emptyGridRow,
  expandSetRows,
  gridRowToProductInput,
  isRowBlank,
  parseQuantities,
  parseTsv,
  suggestNeCode,
  validateGridRow,
  validateGridRows,
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
    cost_price: "123",
    selling_price: "200",
    shipping_type: "送料別",
    image_count: "6",
    delivery_method: "4",
    lead_time: "1",
    mall_category_id: "110692",
    store_category: "フルーツ・ソフトドリンク・酢",
    catch_copy_pc: "沖縄の夏を彩る島レモネード！",
    catch_copy_yahoo: "沖縄の夏を彩る島レモネード！",
    auto: { ne_code: false, display_name: false },
    ...overrides,
  };
}

describe("GRID_COLUMNS", () => {
  it("データ入力シートの18列を同じ順で持つ", () => {
    expect(GRID_COLUMNS.map((c) => c.label)).toEqual([
      "NEコード", "JANコード", "メーカーコード", "単品orセット商品", "数量",
      "商品名", "掲載商品名", "消費税率", "原価", "販売価格",
      "送料区分", "作成した画像数", "配送方法セット", "納期管理番号",
      "モール基本カテゴリID", "店舗内カテゴリ1", "キャッチコピーPC", "キャッチコピー(Yahoo)",
    ]);
  });
});

describe("emptyGridRow / isRowBlank", () => {
  it("よく使う値が既定でプリセットされる（税率10・送料別・配送4・納期1・数量1）", () => {
    const r = emptyGridRow();
    expect(r.tax_rate).toBe("10");
    expect(r.shipping_type).toBe("送料別");
    expect(r.delivery_method).toBe("4");
    expect(r.lead_time).toBe("1");
    expect(r.quantity).toBe("1");
    expect(r.product_type).toBe("単品");
  });

  it("既定値のままの行は空行として扱う", () => {
    expect(isRowBlank(emptyGridRow())).toBe(true);
    expect(isRowBlank(filledRow())).toBe(false);
    // 1項目でも入力があれば空行ではない
    expect(isRowBlank({ ...emptyGridRow(), product_name: "x" })).toBe(false);
  });
});

describe("suggestNeCode（NEコード自動生成 = メーカーコード-JAN下4桁-数量）", () => {
  it("実データの規約どおり生成する", () => {
    expect(suggestNeCode({ maker_code: "a009", jan_code: "4514603474916", quantity: "1" })).toBe("a009-4916-1");
    expect(suggestNeCode({ maker_code: "a009", jan_code: "4514603474916", quantity: "24" })).toBe("a009-4916-24");
  });

  it("JAN13桁が揃うまでは生成しない（中途半端な値を作らない）", () => {
    expect(suggestNeCode({ maker_code: "a009", jan_code: "451460347491", quantity: "1" })).toBe("");
    expect(suggestNeCode({ maker_code: "", jan_code: "4514603474916", quantity: "1" })).toBe("");
    expect(suggestNeCode({ maker_code: "a009", jan_code: "4514603474916", quantity: "0" })).toBe("");
  });
});

describe("applyFieldChange（自動補完の連動）", () => {
  it("メーカー→JAN→数量と入力すると NEコードが自動生成される", () => {
    let r = emptyGridRow();
    r = applyFieldChange(r, "maker_code", "a009");
    expect(r.ne_code).toBe(""); // まだJANが無い
    r = applyFieldChange(r, "jan_code", "4514603474916");
    expect(r.ne_code).toBe("a009-4916-1"); // 数量は既定の1
    r = applyFieldChange(r, "quantity", "6");
    expect(r.ne_code).toBe("a009-4916-6");
  });

  it("NEコードを手入力したら以後自動追従しない。空に戻すと追従再開", () => {
    let r = filledRow({ auto: { ne_code: true, display_name: true } });
    r = applyFieldChange(r, "ne_code", "custom-code");
    r = applyFieldChange(r, "quantity", "48");
    expect(r.ne_code).toBe("custom-code");
    r = applyFieldChange(r, "ne_code", "");
    expect(r.ne_code).toBe("a009-4916-48"); // 追従再開して再生成
  });

  it("掲載商品名は商品名から自動補完され、手入力で追従を止める", () => {
    let r = emptyGridRow();
    r = applyFieldChange(r, "product_name", "沖縄バヤリース 島レモネード");
    expect(r.display_name).toBe("沖縄バヤリース 島レモネード");
    r = applyFieldChange(r, "display_name", "【公式】島レモネード");
    r = applyFieldChange(r, "product_name", "別の商品名");
    expect(r.display_name).toBe("【公式】島レモネード"); // 手入力後は追従しない
  });
});

describe("validateGridRow（行単位の日本語エラー）", () => {
  it("正しい行はエラーなし", () => {
    expect(validateGridRow(filledRow())).toEqual([]);
  });

  it("JANコードは13桁の数字", () => {
    const errors = validateGridRow(filledRow({ jan_code: "12345" }));
    expect(errors).toContain("JANコードは13桁の数字で入力してください");
  });

  it("消費税率は8または10", () => {
    const errors = validateGridRow(filledRow({ tax_rate: "5" }));
    expect(errors).toContain("消費税率は 8 または 10 を選択してください");
  });

  it("必須欠落（商品名・NEコード・販売価格）を検出する", () => {
    const errors = validateGridRow(filledRow({ product_name: "", ne_code: "", selling_price: "" }));
    expect(errors.join(" ")).toContain("商品名が未入力です");
    expect(errors.join(" ")).toContain("NEコード");
    expect(errors.join(" ")).toContain("販売価格は0以上の整数で入力してください");
  });

  it("数量は1以上の整数", () => {
    expect(validateGridRow(filledRow({ quantity: "0" }))).toContain("数量は1以上の整数で入力してください");
    expect(validateGridRow(filledRow({ quantity: "1.5" }))).toContain("数量は1以上の整数で入力してください");
  });

  it("桁区切りカンマ付きの価格は許容する", () => {
    expect(validateGridRow(filledRow({ selling_price: "5,480" }))).toEqual([]);
  });
});

describe("validateGridRows（複数行・NEコード重複）", () => {
  it("空行はスキップし、エラー行だけ返す", () => {
    const rows = [emptyGridRow(), filledRow({ jan_code: "bad" }), filledRow()];
    const result = validateGridRows(rows);
    expect(result.has(0)).toBe(false);
    expect(result.get(1)).toContain("JANコードは13桁の数字で入力してください");
    // 3行目は 2行目と同じNEコードなので重複エラー
    expect(result.get(2)?.join(" ")).toContain("重複");
  });

  it("グリッド内のNEコード重複を行番号付きで報告する", () => {
    const rows = [filledRow(), filledRow()];
    const result = validateGridRows(rows);
    expect(result.get(1)).toContain("NEコードが 1 行目と重複しています");
    expect(result.has(0)).toBe(false);
  });
});

describe("gridRowToProductInput（既存スキーマへの変換）", () => {
  it("実データ相当の行を ProductInput に変換できる", () => {
    const p = gridRowToProductInput(filledRow());
    expect(p.ne_code).toBe("a009-4916-1");
    expect(p.jan_code).toBe("4514603474916");
    expect(p.quantity).toBe(1);
    expect(p.tax_rate).toBe(8);
    expect(p.cost_price).toBe(123);
    expect(p.selling_price).toBe(200);
    expect(p.is_single).toBe(true);
    expect(p.mall_category_id).toBe("110692");
  });

  it("掲載商品名が空なら商品名を使い、任意数値の空欄は既定値になる", () => {
    const p = gridRowToProductInput(
      filledRow({ display_name: "", cost_price: "", image_count: "", delivery_method: "", lead_time: "" }),
    );
    expect(p.display_name).toBe("沖縄バヤリース 島レモネード PET 500ml");
    expect(p.cost_price).toBe(0);
    expect(p.image_count).toBe(1);
    expect(p.delivery_method).toBe(4);
    expect(p.lead_time).toBe(1);
  });

  it("カンマ付き数値を数値化する", () => {
    const p = gridRowToProductInput(filledRow({ selling_price: "5,480" }));
    expect(p.selling_price).toBe(5480);
  });
});

describe("parseQuantities", () => {
  it("カンマ・読点・空白区切りを許容し、正の整数だけ重複なしで返す", () => {
    expect(parseQuantities("6,24,48")).toEqual([6, 24, 48]);
    expect(parseQuantities("6、24 48")).toEqual([6, 24, 48]);
    expect(parseQuantities("6, 6, 0, -1, abc")).toEqual([6]);
    expect(parseQuantities("")).toEqual([]);
  });
});

describe("expandSetRows（単品行からセット行を自動展開）", () => {
  it("共通項目を引き継ぎ、数量・NEコード末尾を変え、販売価格は空にする", () => {
    const single = filledRow();
    const sets = expandSetRows(single, [6, 24]);
    expect(sets).toHaveLength(2);
    expect(sets[0].product_type).toBe("セット商品");
    expect(sets[0].quantity).toBe("6");
    expect(sets[0].ne_code).toBe("a009-4916-6");
    expect(sets[0].selling_price).toBe(""); // 価格は数量比例でないため人が入力
    expect(sets[0].product_name).toBe(single.product_name); // 共通項目は引き継ぎ
    expect(sets[0].jan_code).toBe(single.jan_code);
    expect(sets[0].catch_copy_pc).toBe(single.catch_copy_pc);
    expect(sets[1].ne_code).toBe("a009-4916-24");
    expect(sets[1].quantity).toBe("24");
  });

  it("規約外のNEコード（手入力）でも末尾の数量だけ付け替える", () => {
    const single = filledRow({ ne_code: "custom-777-1", jan_code: "", auto: { ne_code: false, display_name: false } });
    const sets = expandSetRows(single, [6]);
    expect(sets[0].ne_code).toBe("custom-777-6");
  });

  it("展開後の行は保存用の変換まで通る", () => {
    const sets = expandSetRows(filledRow(), [6]);
    const withPrice = { ...sets[0], selling_price: "2100" };
    expect(validateGridRow(withPrice)).toEqual([]);
    const p = gridRowToProductInput(withPrice);
    expect(p.is_set).toBe(true);
    expect(p.ne_code).toBe("a009-4916-6");
    expect(p.selling_price).toBe(2100);
  });
});

describe("parseTsv（Excel コピー取込）", () => {
  const HEADER =
    "NEコード\tJANコード\tメーカーコード\t単品orセット商品\t数量\t商品名\t掲載商品名\t消費税率\t原価\t販売価格\t送料区分\t作成した画像数\t配送方法セット\t納期管理番号\tモール基本カテゴリID\t店舗内カテゴリ1\tキャッチコピーPC\tキャッチコピー(Yahoo)";
  const ROW1 =
    "a009-4916-1\t4514603474916\ta009\t単品\t1\t島レモネード\t島レモネード\t8\t123\t200\t送料別\t6\t4\t1\t110692\tソフトドリンク\t夏を彩る！\t夏を彩る！";
  const ROW2 =
    "a009-4916-6\t4514603474916\ta009\tセット商品\t6\t島レモネード\t島レモネード\t8\t123\t2100\t送料無料\t6\t4\t1\t110692\tソフトドリンク\t夏を彩る！\t夏を彩る！";

  it("見出し行付きの貼り付けを行に変換する（見出しは自動スキップ）", () => {
    const rows = parseTsv([HEADER, ROW1, ROW2].join("\r\n"));
    expect(rows).toHaveLength(2);
    expect(rows[0].ne_code).toBe("a009-4916-1");
    expect(rows[0].selling_price).toBe("200");
    expect(rows[1].product_type).toBe("セット商品");
    expect(rows[1].shipping_type).toBe("送料無料");
  });

  it("見出し無し・データ行だけでも取り込める", () => {
    const rows = parseTsv(ROW1);
    expect(rows).toHaveLength(1);
    expect(rows[0].jan_code).toBe("4514603474916");
    expect(rows[0].catch_copy_yahoo).toBe("夏を彩る！");
  });

  it("シート左端の空列（A列）ごとコピーしても位置がずれない", () => {
    const rows = parseTsv(["\t" + HEADER, "\t" + ROW1].join("\n"));
    expect(rows).toHaveLength(1);
    expect(rows[0].ne_code).toBe("a009-4916-1");
    expect(rows[0].maker_code).toBe("a009");
  });

  it("見出し無しでも A列（19列以上・先頭全て空）を自動除去する", () => {
    const rows = parseTsv("\t" + ROW1);
    expect(rows).toHaveLength(1);
    expect(rows[0].ne_code).toBe("a009-4916-1");
    expect(rows[0].jan_code).toBe("4514603474916");
  });

  it("NEコード・掲載商品名が空欄なら取込時に自動補完する", () => {
    const cells = ROW1.split("\t");
    cells[0] = ""; // NEコード空
    cells[6] = ""; // 掲載商品名空
    const rows = parseTsv(cells.join("\t"));
    expect(rows[0].ne_code).toBe("a009-4916-1"); // maker-JAN下4桁-数量 で自動生成
    expect(rows[0].display_name).toBe("島レモネード"); // 商品名から補完
  });

  it("引用符付き・セル内改行（Excel のコピー形式）を1セルとして解釈する", () => {
    const cells = ROW1.split("\t");
    cells[16] = '"1行目\n2行目"'; // キャッチコピーPC に改行入り
    const rows = parseTsv(cells.join("\t"));
    expect(rows).toHaveLength(1);
    expect(rows[0].catch_copy_pc).toBe("1行目\n2行目");
  });

  it("空文字・空行だけなら空配列", () => {
    expect(parseTsv("")).toEqual([]);
    expect(parseTsv("\n\n")).toEqual([]);
  });
});
