import { describe, it, expect } from "vitest";
import { sanitizeYahooHtml } from "./html-sanitize";
import { stripHtml, fullWidthLen } from "./text-fit";

const angleBalanced = (s: string) =>
  (s.match(/</g) || []).length === (s.match(/>/g) || []).length;
const countOpen = (s: string, tag: string) =>
  (s.match(new RegExp(`<${tag}(?=[\\s/>])`, "g")) || []).length;
const countClose = (s: string, tag: string) =>
  (s.match(new RegExp(`</${tag}>`, "g")) || []).length;

describe("sanitizeYahooHtml - dangerous elements removed (AC-S1)", () => {
  it("removes <script> together with its content", () => {
    const r = sanitizeYahooHtml("<p>a<script>alert(1)</script>b</p>");
    expect(r).not.toContain("script");
    expect(r).not.toContain("alert");
    expect(r).toBe("<p>ab</p>");
  });
  it("removes <style> together with its content", () => {
    const r = sanitizeYahooHtml("<div>x<style>.a{color:red}</style>y</div>");
    expect(r).not.toContain("style");
    expect(r).not.toContain("color");
    expect(r).toBe("<div>xy</div>");
  });
  it("removes iframe / form / input / object / embed", () => {
    const r = sanitizeYahooHtml(
      '<p>t</p><iframe src="http://x"></iframe><form><input type="text"></form><object></object><embed>',
    );
    expect(r).not.toContain("iframe");
    expect(r).not.toContain("<form");
    expect(r).not.toContain("<input");
    expect(r).not.toContain("object");
    expect(r).not.toContain("embed");
    expect(r).toBe("<p>t</p>");
  });
});

describe("sanitizeYahooHtml - disallowed tags stripped but text kept (AC-S2)", () => {
  it("drops h1/h2/h3 tags but keeps their text", () => {
    const r = sanitizeYahooHtml("<h1>Title</h1><h2>A</h2><h3>B</h3>");
    expect(r).not.toContain("<h1");
    expect(r).not.toContain("<h2");
    expect(r).not.toContain("<h3");
    expect(r).toBe("TitleAB");
  });
  it("drops unknown tags but keeps inner text", () => {
    expect(sanitizeYahooHtml("<marquee>move</marquee>")).toBe("move");
  });
});

describe("sanitizeYahooHtml - dangerous attributes removed (AC-S3)", () => {
  it("removes onclick and javascript: href", () => {
    const r = sanitizeYahooHtml('<a href="javascript:alert(1)" onclick="x()">link</a>');
    expect(r).not.toContain("javascript:");
    expect(r).not.toContain("onclick");
    expect(r).toContain("link");
    expect(r).toContain("<a");
    expect(r).toContain("</a>");
  });
  it("keeps a safe http href verbatim", () => {
    const r = sanitizeYahooHtml('<a href="http://example.com/x">y</a>');
    expect(r).toBe('<a href="http://example.com/x">y</a>');
  });
});

describe("sanitizeYahooHtml - safe tags preserved (AC-S2)", () => {
  it("keeps b / a / table / img / ul / li / font", () => {
    expect(sanitizeYahooHtml("<b>bold</b>")).toBe("<b>bold</b>");
    expect(sanitizeYahooHtml('<a href="http://x">y</a>')).toBe('<a href="http://x">y</a>');
    expect(sanitizeYahooHtml("<table><tr><td>c</td></tr></table>")).toBe(
      "<table><tr><td>c</td></tr></table>",
    );
    expect(sanitizeYahooHtml("<ul><li>a</li><li>b</li></ul>")).toBe(
      "<ul><li>a</li><li>b</li></ul>",
    );
    expect(sanitizeYahooHtml('<font color="red">y</font>')).toBe('<font color="red">y</font>');
    const img = sanitizeYahooHtml('<img src="http://x/a.jpg">');
    expect(img).toContain("<img");
    expect(img).toContain('src="http://x/a.jpg"');
  });
});

describe("sanitizeYahooHtml - tag balancing (AC-S4)", () => {
  it("closes an unclosed <b> at the end", () => {
    expect(sanitizeYahooHtml("<b>x")).toBe("<b>x</b>");
  });
  it("closes nested unclosed <div>/<b> so open/close counts match", () => {
    const r = sanitizeYahooHtml("<div><b>x");
    expect(r).toBe("<div><b>x</b></div>");
    expect(countOpen(r, "b")).toBe(countClose(r, "b"));
    expect(countOpen(r, "div")).toBe(countClose(r, "div"));
    expect(angleBalanced(r)).toBe(true);
  });
  it("ignores a stray close tag", () => {
    expect(sanitizeYahooHtml("x</b>y")).toBe("xy");
  });
  it("does not close void elements (br / img / hr)", () => {
    const r = sanitizeYahooHtml('a<br>b<img src="u">c<hr>d');
    expect(r).not.toContain("</br>");
    expect(r).not.toContain("</img>");
    expect(r).not.toContain("</hr>");
    expect(r).toContain("<br>");
    expect(r).toContain("<img");
    expect(angleBalanced(r)).toBe(true);
  });
});

describe("sanitizeYahooHtml - tag-boundary truncation (AC-S5)", () => {
  it("truncates text to maxFullWidth without cutting a tag and closes open tags", () => {
    const long = "<div>" + "あ".repeat(100) + "<b>" + "い".repeat(100) + "</b></div>";
    const r = sanitizeYahooHtml(long, 10);
    expect(fullWidthLen(stripHtml(r))).toBeLessThanOrEqual(10);
    expect(angleBalanced(r)).toBe(true);
    expect(r).toContain("<div>");
    expect(r).toContain("</div>");
    expect(r).toBe("<div>" + "あ".repeat(10) + "</div>");
  });
  it("keeps full content when under the limit (short HTML unchanged)", () => {
    expect(sanitizeYahooHtml("<p>短い</p>", 5000)).toBe("<p>短い</p>");
  });
  it("plain text without tags is unchanged", () => {
    expect(sanitizeYahooHtml("テキスト", 5000)).toBe("テキスト");
  });
});
