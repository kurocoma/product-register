import { describe, it, expect } from "vitest";
import { sanitizeYahooHtml } from "./html-sanitize";

const TAB = String.fromCharCode(9);

describe("sanitizeYahooHtml - entity-encoded URL scheme bypass removed (AC-S1)", () => {
  const bypassCases: Array<[string, string]> = [
    ["hex numeric entity", '<a href="&#x6a;avascript:alert(1)">x</a>'],
    ["decimal numeric entity", '<a href="&#106;avascript:alert(1)">x</a>'],
    ["named colon entity", '<a href="javascript&colon;alert(1)">x</a>'],
    ["leading whitespace", '<a href="   javascript:alert(1)">x</a>'],
    ["uppercase scheme", '<a href="JAVASCRIPT:alert(1)">x</a>'],
    ["tab inside scheme", '<a href="java' + TAB + 'script:alert(1)">x</a>'],
  ];
  for (const [label, input] of bypassCases) {
    it("drops the dangerous href and keeps the anchor text (" + label + ")", () => {
      const r = sanitizeYahooHtml(input);
      expect(r.toLowerCase()).not.toContain("javascript");
      expect(r).not.toContain("alert(1)");
      expect(r).not.toContain("href=");
      expect(r).toContain("<a");
      expect(r).toContain("</a>");
      expect(r).toContain("x");
    });
  }

  it("drops vbscript / data:text/html / file hrefs but keeps the anchor", () => {
    const schemes = ["vbscript:msgbox(1)", "data:text/html,abc", "file:///etc/passwd"];
    for (const scheme of schemes) {
      const r = sanitizeYahooHtml('<a href="' + scheme + '">y</a>');
      expect(r).not.toContain("href=");
      expect(r).toContain("<a");
      expect(r).toContain("</a>");
      expect(r).toContain("y");
    }
  });
});

describe("sanitizeYahooHtml - allowed URLs preserved (AC-S1)", () => {
  it("keeps http/https/mailto/tel/relative/anchor hrefs verbatim", () => {
    expect(sanitizeYahooHtml('<a href="http://x/y">a</a>')).toBe('<a href="http://x/y">a</a>');
    expect(sanitizeYahooHtml('<a href="https://x/y">a</a>')).toBe('<a href="https://x/y">a</a>');
    expect(sanitizeYahooHtml('<a href="mailto:a@b.com">a</a>')).toBe('<a href="mailto:a@b.com">a</a>');
    expect(sanitizeYahooHtml('<a href="tel:0312345678">a</a>')).toBe('<a href="tel:0312345678">a</a>');
    expect(sanitizeYahooHtml('<a href="/path/to">a</a>')).toBe('<a href="/path/to">a</a>');
    expect(sanitizeYahooHtml('<a href="./rel">a</a>')).toBe('<a href="./rel">a</a>');
    expect(sanitizeYahooHtml('<a href="#anchor">a</a>')).toBe('<a href="#anchor">a</a>');
  });

  it("keeps a data:image src on an img", () => {
    const src = "data:image/png;base64,iVBORw0KGgo=";
    const r = sanitizeYahooHtml('<img src="' + src + '">');
    expect(r).toContain("<img");
    expect(r).toContain('src="' + src + '"');
  });
});

describe("sanitizeYahooHtml - style expression removed (AC-S3)", () => {
  it("drops a style attribute that uses expression()", () => {
    const r = sanitizeYahooHtml('<div style="width:expression(alert(1))">x</div>');
    expect(r.toLowerCase()).not.toContain("expression(");
    expect(r).toContain("<div");
    expect(r).toContain("x");
  });
});
