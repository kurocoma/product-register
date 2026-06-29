import { describe, it, expect } from "vitest";
import { buildItemPlan } from "./plan";
import type { ItemPlanInput } from "./types";

/** すべて移行可能な基準入力。各テストで1条件だけ崩す。 */
function baseInput(overrides: Partial<ItemPlanInput> = {}): ItemPlanInput {
  return {
    manageNumber: "abc-123",
    existed: false,
    yahooCategoryResolved: true,
    hasMultipleSku: false,
    hasAdvancedYahooSettings: false,
    missingRequiredYahooFields: [],
    ...overrides,
  };
}

describe("buildItemPlan", () => {
  it("全条件クリアなら action=migrate（理由なし）", () => {
    const p = buildItemPlan(baseInput());
    expect(p.action).toBe("migrate");
    expect(p.reasons).toEqual([]);
    expect(p.categoryResolved).toBe(true);
  });

  it("カテゴリ未解決(null)→requires_manual", () => {
    const p = buildItemPlan(baseInput({ yahooCategoryResolved: null }));
    expect(p.action).toBe("requires_manual");
    expect(p.categoryResolved).toBe(false);
    expect(p.reasons[0]).toContain("Yahooカテゴリ");
  });

  it("カテゴリ未解決(false)→requires_manual", () => {
    const p = buildItemPlan(baseInput({ yahooCategoryResolved: false }));
    expect(p.action).toBe("requires_manual");
    expect(p.categoryResolved).toBe(false);
  });

  it("多SKU→requires_manual", () => {
    const p = buildItemPlan(baseInput({ hasMultipleSku: true }));
    expect(p.action).toBe("requires_manual");
    expect(p.reasons.some((r) => r.includes("多SKU"))).toBe(true);
  });

  it("高度なYahoo設定→requires_manual", () => {
    const p = buildItemPlan(baseInput({ hasAdvancedYahooSettings: true }));
    expect(p.action).toBe("requires_manual");
    expect(p.reasons.some((r) => r.includes("高度なYahoo設定"))).toBe(true);
  });

  it("Yahoo必須項目不足→requires_manual（項目名を理由に含む）", () => {
    const p = buildItemPlan(baseInput({ missingRequiredYahooFields: ["product-category", "name"] }));
    expect(p.action).toBe("requires_manual");
    expect(p.reasons.some((r) => r.includes("product-category") && r.includes("name"))).toBe(true);
  });

  it("複合理由をすべて列挙", () => {
    const p = buildItemPlan(
      baseInput({
        yahooCategoryResolved: null,
        hasMultipleSku: true,
        hasAdvancedYahooSettings: true,
        missingRequiredYahooFields: ["name"],
      }),
    );
    expect(p.action).toBe("requires_manual");
    expect(p.reasons).toHaveLength(4);
  });

  it("existed は移行可否をブロックせず計画に反映するだけ", () => {
    const p = buildItemPlan(baseInput({ existed: true }));
    expect(p.action).toBe("migrate");
    expect(p.existed).toBe(true);
  });

  it("入力フラグを計画にそのまま反映する", () => {
    const p = buildItemPlan(
      baseInput({ manageNumber: "x-9", hasMultipleSku: true, missingRequiredYahooFields: ["jan"] }),
    );
    expect(p.manageNumber).toBe("x-9");
    expect(p.hasMultipleSku).toBe(true);
    expect(p.missingRequiredYahooFields).toEqual(["jan"]);
  });
});
