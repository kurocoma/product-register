import { describe, expect, it } from "vitest";
import { makeProduct } from "@/lib/product/schema";
import {
  detectRuleViolation,
  RULE_VIOLATION_REASONS,
} from "./detect";

describe("detectRuleViolation", () => {
  it("販売説明文と画像URLが空なら違反なし", () => {
    expect(detectRuleViolation(makeProduct({ sale_description_pc: "" }))).toEqual({
      violated: false,
      reasons: [],
    });
  });

  it("sale_description_pc が非空なら説明文違反", () => {
    expect(
      detectRuleViolation(makeProduct({ sale_description_pc: "<table><tr><td>独自HTML</td></tr></table>" })),
    ).toEqual({
      violated: true,
      reasons: [RULE_VIOLATION_REASONS.descriptionHtml],
    });
  });

  it("空白だけでも空文字列ではないため説明文違反", () => {
    expect(detectRuleViolation(makeProduct({ sale_description_pc: " " })).reasons).toEqual([
      RULE_VIOLATION_REASONS.descriptionHtml,
    ]);
  });

  it("楽天基準の1枚目・2枚目・20枚目はクエリ付きURLでも規則通り", () => {
    const product = makeProduct({
      sale_description_pc: "",
      image_url_1: "https://example.test/item/t002-2542-1.jpg?cache=1",
      image_url_2: "https://example.test/item/t002-2542_2.jpg",
      image_url_20: "https://example.test/item/t002-2542_20.jpg#preview",
    });

    expect(detectRuleViolation(product)).toEqual({ violated: false, reasons: [] });
  });

  it.each([
    ["空文字列", "", [RULE_VIOLATION_REASONS.imageNaming]],
    ["4桁未満", "542", [RULE_VIOLATION_REASONS.imageNaming]],
    ["4桁以上", "4955028002542", []],
  ])("jan_code が%sの場合の画像命名判定を固定する", (_label, janCode, reasons) => {
    const result = detectRuleViolation({
      ...makeProduct({
        sale_description_pc: "",
        image_url_2: "https://example.test/item/t002-2542_2.jpg",
      }),
      jan_code: janCode,
    });

    expect(result).toEqual({
      violated: reasons.length > 0,
      reasons,
    });
  });

  it.each([
    ["1枚目", { image_url_1: "https://example.test/item/t002-2542.jpg" }],
    ["2枚目以降", { image_url_2: "https://example.test/item/t002-2542-1_2.jpg" }],
    ["拡張子", { image_url_3: "https://example.test/item/t002-2542_3.png" }],
  ])("%sのファイル名が規則外なら画像命名違反", (_label, images) => {
    const result = detectRuleViolation(makeProduct({ sale_description_pc: "", ...images }));

    expect(result).toEqual({
      violated: true,
      reasons: [RULE_VIOLATION_REASONS.imageNaming],
    });
  });

  it("説明文と画像命名が同時に違反なら両方の理由を返す", () => {
    const result = detectRuleViolation(
      makeProduct({
        sale_description_pc: "<p>独自説明</p>",
        image_url_1: "https://example.test/item/wrong.jpg",
      }),
    );

    expect(result).toEqual({
      violated: true,
      reasons: [
        RULE_VIOLATION_REASONS.descriptionHtml,
        RULE_VIOLATION_REASONS.imageNaming,
      ],
    });
  });
});
