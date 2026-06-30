import { describe, it, expect } from "vitest";
import { sanitizeYahooHtml } from "./html-sanitize";

// loop-006 turn-002: the style-attribute scheme check must decode HTML entity
// references first (same basis as href/src), so entity-encoded obfuscation can
// no longer smuggle a dangerous scheme through a style declaration.
describe("sanitizeYahooHtml - dangerous style consistent with URL check (AC-S1)", () => {
  const dangerous: Array<[string, string]> = [
    ["entity-encoded javascript in url()", '<div style="background:url(&#x6a;avascript:alert(1))">x</div>'],
    ["decimal entity javascript in url()", '<div style="background:url(&#106;avascript:alert(1))">x</div>'],
    ["IE expression()", '<div style="width:expression(alert(1))">x</div>'],
    ["expression with space", '<div style="width:expression (alert(1))">x</div>'],
    ["vbscript in url()", '<div style="x:url(vbscript:msgbox(1))">x</div>'],
  ];
  for (const [label, input] of dangerous) {
    it("drops the dangerous style and keeps the div + text (" + label + ")", () => {
      const r = sanitizeYahooHtml(input);
      const low = r.toLowerCase();
      expect(low).not.toContain("javascript");
      expect(low).not.toContain("vbscript");
      expect(low).not.toContain("expression(");
      expect(r).not.toContain("alert(1)");
      expect(r).not.toContain("msgbox(1)");
      expect(r).not.toContain("style=");
      expect(r).toContain("<div");
      expect(r).toContain("</div>");
      expect(r).toContain("x");
    });
  }

  it("keeps a benign style attribute verbatim", () => {
    expect(sanitizeYahooHtml('<div style="color:red">x</div>')).toBe(
      '<div style="color:red">x</div>',
    );
    expect(sanitizeYahooHtml('<span style="font-weight:bold">y</span>')).toBe(
      '<span style="font-weight:bold">y</span>',
    );
  });

  it("keeps a benign url() image background", () => {
    const r = sanitizeYahooHtml('<div style="background:url(https://x/y.png)">z</div>');
    expect(r).toContain("background:url(https://x/y.png)");
    expect(r).toContain("z");
  });
});
