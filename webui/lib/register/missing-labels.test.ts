import { describe, it, expect } from "vitest";
import { MISSING_FIELD_LABELS, missingFieldLabel, missingFieldLabels } from "./missing-labels";

describe("missingFieldLabel: 既知フィールドの日本語化（E3）", () => {
  // 楽天 validateUpsertBody（lib/converters/rakuten-api.ts）が返す全フィールド
  it.each([
    ["manageNumber(英数-_)", "商品管理番号（半角英数と - _ のみ）"],
    ["title", "掲載商品名（モール用）"],
    ["itemType", "商品タイプ"],
    ["genreId(6桁)", "楽天ジャンルID（6桁）"],
    ["variants", "SKU（バリエーション）情報"],
    ["variants.standardPrice", "SKUの販売価格"],
  ])("楽天: %s → %s", (field, label) => {
    expect(missingFieldLabel(field)).toBe(label);
  });

  // Yahoo validateEditItemParams（lib/yahoo/item-mapper.ts）の必須フィールド全件
  it.each([
    ["seller_id", "Yahooストアアカウント（seller_id 設定）"],
    ["item_code", "商品コード（NEコード）"],
    ["path", "Yahooカテゴリ（パス）"],
    ["name", "掲載商品名（モール用）"],
    ["product_category", "YahooカテゴリID"],
    ["price", "販売価格"],
  ])("Yahoo: %s → %s", (field, label) => {
    expect(missingFieldLabel(field)).toBe(label);
  });

  it("マッピング表の全エントリが元のフィールド名を残さない日本語ラベルになっている", () => {
    for (const [field, label] of Object.entries(MISSING_FIELD_LABELS)) {
      expect(label).not.toBe(field);
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe("missingFieldLabel: 動的メッセージの先頭フィールド名だけ変換する", () => {
  it.each([
    // validateYahooFieldLimits / 値域ゲートの実メッセージ形（lib/yahoo/item-mapper.ts）
    ["name が空です", "掲載商品名（モール用）が空です"],
    ["path が空です", "Yahooカテゴリ（パス）が空です"],
    ["product_category が空です", "YahooカテゴリIDが空です"],
    ["name が全角75を超過", "掲載商品名（モール用）が全角75を超過"],
    ["caption が全角5000を超過", "商品説明（PC）が全角5000を超過"],
    ["price が範囲外（整数 1〜99,999,999）", "販売価格が範囲外（整数 1〜99,999,999）"],
    ["item_code の書式不正（半角英数とハイフン・99文字以内）", "商品コード（NEコード）の書式不正（半角英数とハイフン・99文字以内）"],
    ["product_category の書式不正（数字 1〜10 桁）", "YahooカテゴリIDの書式不正（数字 1〜10 桁）"],
    ["path の階層が8を超過", "Yahooカテゴリ（パス）の階層が8を超過"],
  ])("%s → %s", (msg, label) => {
    expect(missingFieldLabel(msg)).toBe(label);
  });
});

describe("missingFieldLabel: 未知フィールドは原名フォールバック", () => {
  it("未知の単独フィールド名はそのまま返す", () => {
    expect(missingFieldLabel("unknown_field")).toBe("unknown_field");
  });

  it("未知フィールドの動的メッセージもそのまま返す（誤変換しない）", () => {
    expect(missingFieldLabel("meta_desc が全角80を超過")).toBe("meta_desc が全角80を超過");
  });

  it("空文字はそのまま返す", () => {
    expect(missingFieldLabel("")).toBe("");
  });
});

describe("missingFieldLabels: 一括変換（確認結果テーブル表示用）", () => {
  it("既知・未知の混在をそれぞれのルールで変換する", () => {
    expect(missingFieldLabels(["genreId(6桁)", "title", "unknown_x"])).toEqual([
      "楽天ジャンルID（6桁）",
      "掲載商品名（モール用）",
      "unknown_x",
    ]);
  });

  it("空配列は空配列を返す", () => {
    expect(missingFieldLabels([])).toEqual([]);
  });
});
