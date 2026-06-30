import { describe, it, expect } from "vitest";
import { makeProduct } from "@/lib/product/schema";
import { stripHtml, fullWidthLen } from "@/lib/product/text-fit";
import { buildYahooEditItemParams, fitYahooFieldLimits } from "./item-mapper";

const opts = { sellerId: "S" };
const angleBalanced = (s: string) =>
  (s.match(/</g) || []).length === (s.match(/>/g) || []).length;

// loop-006 turn-002: abstract / additional1-3 are HTML-allowed fields wired with
// html:"sanitize" in YAHOO_FIELD_LIMITS. The YahooConverter leaves them empty, so
// buildYahooEditItemParams never carries a value for them; the field-level sanitize
// wiring is exercised through fitYahooFieldLimits (the same function
// buildYahooEditItemParams calls before returning).
describe("fitYahooFieldLimits - abstract/additional1-3 sanitize wiring", () => {
  const cases: Array<[string, number]> = [
    ["abstract", 500],
    ["additional1", 5000],
    ["additional2", 5000],
    ["additional3", 5000],
  ];
  for (const [field, max] of cases) {
    it("sanitizes " + field + " (unclosed tag + script -> no script, balanced, within limit)", () => {
      const raw = "<p>desc<b>bold<script>alert(1)</script>";
      const out = fitYahooFieldLimits({ [field]: raw });
      const v = out[field];
      expect(v).not.toContain("script");
      expect(v).not.toContain("alert");
      expect(v).toContain("</b>");
      expect(v).toContain("</p>");
      expect(angleBalanced(v)).toBe(true);
      expect(fullWidthLen(stripHtml(v))).toBeLessThanOrEqual(max);
    });

    it("truncates long " + field + " on a tag boundary within limit", () => {
      const raw = "<p>" + "あ".repeat(max + 1000) + "</p>";
      const out = fitYahooFieldLimits({ [field]: raw });
      const v = out[field];
      expect(fullWidthLen(stripHtml(v))).toBeLessThanOrEqual(max);
      expect(v).toContain("</p>");
      expect(angleBalanced(v)).toBe(true);
    });

    it("drops an entity-encoded javascript style in " + field, () => {
      const raw = '<div style="background:url(&#x6a;avascript:alert(1))">keep</div>';
      const out = fitYahooFieldLimits({ [field]: raw });
      const v = out[field].toLowerCase();
      expect(v).not.toContain("javascript");
      expect(out[field]).not.toContain("alert(1)");
      expect(out[field]).toContain("keep");
    });
  }
});

// e2e through buildYahooEditItemParams: caption is the reachable HTML-allowed field
// (sp_additional mirrors it); confirm the same sanitize pipeline runs end to end.
describe("buildYahooEditItemParams - reachable HTML field sanitize (e2e)", () => {
  it("sanitizes caption from a product (no script, balanced, within 5000)", () => {
    const p = makeProduct({
      image_count: 1,
      description_pc: "<p>商品<b>説明<script>alert(1)</script>",
    });
    const params = buildYahooEditItemParams(p, opts);
    expect(params.caption).not.toContain("script");
    expect(params.caption).not.toContain("alert");
    expect(params.caption).toContain("</b>");
    expect(params.caption).toContain("</p>");
    expect(angleBalanced(params.caption)).toBe(true);
    expect(fullWidthLen(stripHtml(params.caption))).toBeLessThanOrEqual(5000);
  });
});
