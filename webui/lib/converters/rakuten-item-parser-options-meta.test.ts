/** 商品オプションの忠実性メタ（customization_options_meta）取込のテスト（260720）。
 * 背景: 既存の customization_options は {name, values} のみで、種別（自由入力）と
 * 必須フラグを捨てるため、登録（upsert 全置換）で楽天へ送り返すと劣化する。
 * メタは全オプション（自由入力含む）の name/input_type/required を別フィールドに保持し、
 * 既存の customization_options の形・除外規則は変えない。 */
import { describe, it, expect } from "vitest";
import { parseRakutenItem } from "./rakuten-item-parser";

const item = {
  title: "X",
  customizationOptions: [
    { displayName: "のし", inputType: "SINGLE_SELECTION", required: true, selections: [{ displayValue: "あり" }, { displayValue: "なし" }] },
    { displayName: "刻印メッセージ", inputType: "FREE_TEXT", required: false, selections: [] },
  ],
};

describe("parseRakutenItem — customization_options_meta（忠実性メタ）", () => {
  it("全オプション（自由入力含む）の name/input_type/required を保持する", () => {
    const p = parseRakutenItem(item);
    expect(p.customization_options_meta).toEqual([
      { name: "のし", input_type: "SINGLE_SELECTION", required: true },
      { name: "刻印メッセージ", input_type: "FREE_TEXT", required: false },
    ]);
  });

  it("既存の customization_options は従来どおり（選択肢ありのみ・{name,values}）", () => {
    const p = parseRakutenItem(item);
    expect(p.customization_options).toEqual([{ name: "のし", values: ["あり", "なし"] }]);
  });

  it("customizationOptions が無ければメタも設定しない", () => {
    const p = parseRakutenItem({ title: "X" });
    expect(p.customization_options_meta).toBeUndefined();
  });
});
