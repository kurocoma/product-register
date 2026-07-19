/** 登録（items.upsert）での商品オプション送出のテスト（260720）。
 * 背景: upsert は全置換なのに customizationOptions を送っておらず、
 * 登録のたびに楽天側の商品オプションが消えていた（取込済みデータは80商品に存在）。 */
import { describe, it, expect } from "vitest";
import { makeProduct } from "../product/schema";
import { buildRakutenUpsertBody, buildCustomizationOptions } from "./rakuten-api";

describe("buildCustomizationOptions（商品オプションの送出・純関数）", () => {
  it("保存済みオプションをメタの種別・必須フラグ付きで楽天形式へ組み立てる", () => {
    const p = makeProduct({
      customization_options: [{ name: "のし", values: ["あり", "なし"] }],
      customization_options_meta: [{ name: "のし", input_type: "SINGLE_SELECTION", required: true }],
    });
    expect(buildCustomizationOptions(p)).toEqual([
      { displayName: "のし", inputType: "SINGLE_SELECTION", required: true, selections: [{ displayValue: "あり" }, { displayValue: "なし" }] },
    ]);
  });

  it("メタが無い（アプリで手入力した）オプションは単一選択・任意の既定で送る", () => {
    const p = makeProduct({ customization_options: [{ name: "お届け方法", values: ["ゆうパケット", "宅急便"] }] });
    expect(buildCustomizationOptions(p)).toEqual([
      { displayName: "お届け方法", inputType: "SINGLE_SELECTION", required: false, selections: [{ displayValue: "ゆうパケット" }, { displayValue: "宅急便" }] },
    ]);
  });

  it("自由入力オプション（メタのみ・選択肢なし）も selections 無しで維持する", () => {
    const p = makeProduct({
      customization_options: [{ name: "のし", values: ["あり"] }],
      customization_options_meta: [
        { name: "のし", input_type: "SINGLE_SELECTION", required: false },
        { name: "刻印メッセージ", input_type: "FREE_TEXT", required: false },
      ],
    });
    expect(buildCustomizationOptions(p)).toEqual([
      { displayName: "のし", inputType: "SINGLE_SELECTION", required: false, selections: [{ displayValue: "あり" }] },
      { displayName: "刻印メッセージ", inputType: "FREE_TEXT", required: false },
    ]);
  });

  it("upsert body に customizationOptions が載る（オプション無しならキー自体なし）", () => {
    const withOpts = makeProduct({ customization_options: [{ name: "のし", values: ["あり"] }] });
    expect(buildRakutenUpsertBody(withOpts).customizationOptions).toEqual([
      { displayName: "のし", inputType: "SINGLE_SELECTION", required: false, selections: [{ displayValue: "あり" }] },
    ]);
    expect("customizationOptions" in buildRakutenUpsertBody(makeProduct())).toBe(false);
  });
});
