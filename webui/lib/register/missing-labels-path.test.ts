import { describe, it, expect } from "vitest";
import { missingFieldLabel } from "./missing-labels";

/** path の文字数超過メッセージは汎用の先頭置換だと
 * 「Yahooカテゴリ（パス）カテゴリ名「…」…」と冗長になるため、専用の言い換えを持つ。 */
describe("missingFieldLabel — path 文字数超過メッセージの専用言い換え", () => {
  it("「path カテゴリ名…」は冗長にならず「Yahooカテゴリ名…」になる", () => {
    expect(missingFieldLabel("path カテゴリ名「とても長いカテゴリ名の例」が全角20を超過")).toBe(
      "Yahooカテゴリ名「とても長いカテゴリ名の例」が全角20を超過",
    );
  });
  it("完全一致の path 単体は従来どおり", () => {
    expect(missingFieldLabel("path")).toBe("Yahooカテゴリ（パス）");
  });
  it("「path が空です」の動的メッセージは従来どおり先頭置換", () => {
    expect(missingFieldLabel("path が空です")).toBe("Yahooカテゴリ（パス）が空です");
  });
});
