import { describe, it, expect } from "vitest";
import { parseRakutenItem } from "./rakuten-item-parser";

/** 楽天 customizationOptions(項目選択肢) → { name, values }[] 抽出。 */
describe("parseRakutenItem — 商品オプション抽出", () => {
  it("displayName + selections.displayValue を {name,values} に", () => {
    const p = parseRakutenItem({
      title: "X",
      customizationOptions: [
        { displayName: "のし", inputType: "SINGLE_SELECTION", selections: [{ displayValue: "あり" }, { displayValue: "なし" }] },
      ],
    });
    expect(p.customization_options).toEqual([{ name: "のし", values: ["あり", "なし"] }]);
  });
  it("選択肢が無いオプションは除外（自由入力等）", () => {
    const p = parseRakutenItem({
      title: "X",
      customizationOptions: [{ displayName: "自由入力", selections: [] }],
    });
    expect(p.customization_options).toBeUndefined();
  });
});
