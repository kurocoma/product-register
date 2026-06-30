/** Format-preserving HTML sanitizer for Yahoo's HTML-allowed fields
 * (caption / abstract / additional1-3 / sp_additional).
 *
 * Implemented with regex + a hand-written tokenizer only (no new dependency).
 *
 * Purpose (loop-006 / fixes the it-00002 / it-00004 unclosed-tag warnings):
 *  - remove dangerous / disallowed tags (script, style, iframe, form, on-handlers, javascript URLs ...),
 *  - keep safe formatting tags (a/br/p/table family/img/ul/ol/li/div/span ...),
 *  - balance the markup by closing any unclosed tags at the end,
 *  - when a length limit is given, truncate on a tag boundary (never mid-tag).
 *
 * Yahoo counts the limit on the text length (item-mapper's validateYahooFieldLimits
 * also counts after stripHtml), so this sanitizer's limit is applied to the
 * full-width length of the text portions only.
 */

import { fullWidthLen, fitFullWidth } from "@/lib/product/text-fit";

/** Tags removed together with their content.
 * - paired: drop the open..close range and everything in between (script bodies etc.).
 * - standalone (void): drop the single tag (input/embed/link/meta have no end tag). */
const DANGEROUS_PAIRED = [
  "script",
  "style",
  "iframe",
  "form",
  "button",
  "select",
  "textarea",
  "object",
];
const DANGEROUS_STANDALONE = ["input", "embed", "link", "meta"];

/** Whitelist of formatting tags to keep (conservative). Any other open/close tag is
 * dropped while its inner text is preserved. */
const ALLOWED = new Set([
  "a",
  "br",
  "p",
  "hr",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "small",
  "big",
  "sub",
  "sup",
  "font",
  "span",
  "div",
  "center",
  "blockquote",
  "pre",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "caption",
  "col",
  "colgroup",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "img",
  "h4",
  "h5",
  "h6",
]);

/** Void elements (no end tag; never pushed onto the balancing stack). */
const VOID = new Set([
  "br",
  "hr",
  "img",
  "input",
  "meta",
  "link",
  "col",
  "area",
  "base",
  "wbr",
]);

type Token =
  | { type: "text"; value: string }
  | { type: "start"; name: string; attrs: string; selfClose: boolean }
  | { type: "end"; name: string }
  | { type: "comment" };

/** Pre-pass that removes dangerous elements (with content) / standalone dangerous tags. */
function removeDangerousElements(html: string): string {
  let s = html;
  for (const tag of DANGEROUS_PAIRED) {
    // open..close incl. content (non-greedy). `>` inside attributes is not expected
    // (same assumption as the existing stripHtml).
    s = s.replace(new RegExp(`<${tag}(?=[\\s/>])[^>]*>[\\s\\S]*?</${tag}\\s*>`, "gi"), "");
    // remove any leftover unclosed open tag and orphan close tag.
    s = s.replace(new RegExp(`<${tag}(?=[\\s/>])[^>]*>`, "gi"), "");
    s = s.replace(new RegExp(`</${tag}\\s*>`, "gi"), "");
  }
  for (const tag of DANGEROUS_STANDALONE) {
    s = s.replace(new RegExp(`<${tag}(?=[\\s/>])[^>]*>`, "gi"), "");
  }
  return s;
}

const NAME_CHAR = /[a-zA-Z0-9:-]/;

/** Manually tokenize HTML into text / start / end / comment tokens
 * (quote aware, so `>` inside an attribute value is handled safely). */
function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  const n = html.length;
  let i = 0;
  let textStart = 0;
  const flushText = (end: number) => {
    if (end > textStart) tokens.push({ type: "text", value: html.slice(textStart, end) });
  };

  while (i < n) {
    if (html[i] !== "<") {
      i++;
      continue;
    }
    const next = html[i + 1];
    if (next === "!") {
      // comment or declaration ( <!-- --> / <!DOCTYPE ...> ) -> drop.
      flushText(i);
      if (html.startsWith("<!--", i)) {
        const end = html.indexOf("-->", i + 4);
        i = end === -1 ? n : end + 3;
      } else {
        const end = html.indexOf(">", i + 2);
        i = end === -1 ? n : end + 1;
      }
      tokens.push({ type: "comment" });
      textStart = i;
      continue;
    }
    if (next === "/") {
      if (i + 2 < n && /[a-zA-Z]/.test(html[i + 2])) {
        flushText(i);
        let j = i + 2;
        while (j < n && NAME_CHAR.test(html[j])) j++;
        const name = html.slice(i + 2, j).toLowerCase();
        const end = html.indexOf(">", j);
        i = end === -1 ? n : end + 1;
        tokens.push({ type: "end", name });
        textStart = i;
        continue;
      }
      // `</` that is not a tag name -> treat `<` as literal text.
      i++;
      continue;
    }
    if (next && /[a-zA-Z]/.test(next)) {
      flushText(i);
      let j = i + 1;
      while (j < n && NAME_CHAR.test(html[j])) j++;
      const name = html.slice(i + 1, j).toLowerCase();
      // read the attribute region quote-aware, ending at an unquoted `>`.
      let k = j;
      let quote = "";
      while (k < n) {
        const c = html[k];
        if (quote) {
          if (c === quote) quote = "";
        } else if (c === '"' || c === "'") {
          quote = c;
        } else if (c === ">") {
          break;
        }
        k++;
      }
      let attrs = html.slice(j, k);
      let selfClose = false;
      const trimmed = attrs.replace(/\s+$/, "");
      if (trimmed.endsWith("/")) {
        selfClose = true;
        attrs = trimmed.slice(0, -1);
      }
      i = k < n ? k + 1 : n;
      tokens.push({ type: "start", name, attrs, selfClose });
      textStart = i;
      continue;
    }
    // `<` followed by some other char -> keep it as literal text.
    i++;
  }
  flushText(n);
  return tokens;
}

type Attr = { name: string; value: string; full: string };

/** Split an attribute region into name / value / original text (full).
 * `full` keeps the original quoting verbatim so kept attributes round-trip. */
function parseAttrs(raw: string): Attr[] {
  const res: Attr[] = [];
  const re = /([^\s/=>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    if (m[0] === "") {
      re.lastIndex++;
      continue;
    }
    const value = m[2] ?? m[3] ?? m[4] ?? "";
    res.push({ name: m[1], value, full: m[0] });
  }
  return res;
}

/** URL-check-only decode: collapse HTML-entity obfuscation so a dangerous scheme
 * cannot hide behind numeric refs, named refs, or (entity-encoded) whitespace.
 * Aligns with browser leniency (numeric refs decode even without a trailing
 * semicolon). The decoded value drives the allow/deny decision only; the
 * original attribute text is kept verbatim when the URL is allowed. */
function decodeHtmlRefsForUrlCheck(s: string): string {
  const fromCode = (code: number): string => {
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
    try {
      return String.fromCodePoint(code);
    } catch {
      return "";
    }
  };
  let v = s
    .replace(/&colon;/gi, ":")
    .replace(/&(?:tab|newline);/gi, "")
    .replace(/&amp;/gi, "&")
    .replace(/&#x([0-9a-f]+);?/gi, (_m, hex: string) => fromCode(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_m, dec: string) => fromCode(parseInt(dec, 10)));
  // drop every whitespace / control character, then lowercase for scheme compare.
  v = v.replace(/[\u0000-\u0020\u007f-\u009f\s]/g, "");
  return v.toLowerCase();
}

/** Allowlist URL check (loop-006). Only known-safe schemes and relative
 * references pass; anything carrying a non-allowlisted scheme (javascript,
 * vbscript, data of a non-image type, file ...) is rejected, including
 * entity-encoded obfuscation, so the dangerous attribute is dropped. */
function isAllowedUrl(raw: string): boolean {
  const v = decodeHtmlRefsForUrlCheck(raw);
  if (v === "") return true; // empty value is harmless.
  if (v.startsWith("data:")) return v.startsWith("data:image/"); // images only.
  if (
    v.startsWith("http://") ||
    v.startsWith("https://") ||
    v.startsWith("mailto:") ||
    v.startsWith("tel:")
  ) {
    return true;
  }
  if (v.startsWith("#")) return true; // in-page anchor.
  if (
    v.startsWith("//") ||
    v.startsWith("/") ||
    v.startsWith("./") ||
    v.startsWith("../") ||
    v.startsWith("?")
  ) {
    return true; // scheme-less relative / network-path reference.
  }
  // A leading scheme is a letter run followed by a colon. If present, it is not
  // in the allowlist (handled above) so reject it. No scheme means relative.
  return !/^[a-z][a-z0-9+.-]*:/.test(v);
}

const URL_ATTRS = new Set(["href", "src", "xlink:href", "background", "formaction"]);

/** Decide whether a CSS `style` attribute value carries a dangerous construct.
 * The value is first decoded with decodeHtmlRefsForUrlCheck - the same basis used
 * for href/src - so entity-encoded obfuscation (numeric refs, named colon,
 * encoded whitespace) cannot hide a scheme, keeping the style check consistent
 * with the URL check. Returns true when a script scheme, IE expression(), or a
 * url() target that fails the allowlist URL check is present. */
function isDangerousStyle(value: string): boolean {
  const v = decodeHtmlRefsForUrlCheck(value);
  if (v === "") return false;
  // decodeHtmlRefsForUrlCheck already stripped whitespace and lowercased, so a
  // direct substring match also catches obfuscated "expression (" / "java script:".
  if (v.includes("javascript:") || v.includes("vbscript:") || v.includes("expression(")) {
    return true;
  }
  // every url(...) target must clear the same allowlist as href/src.
  const re = /url\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(v)) !== null) {
    const inner = m[1].replace(/^["']|["']$/g, "");
    if (!isAllowedUrl(inner)) return true;
  }
  return false;
}

/** Remove dangerous attributes (on* events, non-allowlisted URLs, dangerous style)
 * and rebuild the remaining attribute string. */
function sanitizeAttrs(raw: string): string {
  const kept: string[] = [];
  for (const a of parseAttrs(raw)) {
    const lower = a.name.toLowerCase();
    if (lower.startsWith("on")) continue;
    if (URL_ATTRS.has(lower) && !isAllowedUrl(a.value)) continue;
    if (lower === "style" && isDangerousStyle(a.value)) continue;
    kept.push(a.full);
  }
  return kept.join(" ");
}

/** Build the start-tag string for an allowed tag with sanitized attributes.
 * void elements are not closed; a self-closed non-void tag is normalized to
 * the balanced `<tag></tag>` form. */
function buildStartTag(name: string, attrs: string, selfClose: boolean): string {
  const cleaned = sanitizeAttrs(attrs);
  const attrStr = cleaned ? ` ${cleaned}` : "";
  if (VOID.has(name)) return `<${name}${attrStr}>`;
  if (selfClose) return `<${name}${attrStr}></${name}>`;
  return `<${name}${attrStr}>`;
}

/** Render tokens while keeping whitelisted tags, balancing the markup, and
 * (when maxFullWidth is given) truncating on a tag boundary. */
function render(tokens: Token[], maxFullWidth?: number): string {
  const out: string[] = [];
  const stack: string[] = [];
  let used = 0;

  for (const tk of tokens) {
    if (tk.type === "comment") continue;

    if (tk.type === "text") {
      if (maxFullWidth == null) {
        out.push(tk.value);
        continue;
      }
      const w = fullWidthLen(tk.value);
      if (used + w <= maxFullWidth) {
        out.push(tk.value);
        used += w;
        continue;
      }
      // limit reached: truncate the text on a char boundary (never mid-tag),
      // then stop and close the remaining open tags.
      const piece = fitFullWidth(tk.value, maxFullWidth - used);
      if (piece) out.push(piece);
      break;
    }

    if (tk.type === "start") {
      if (!ALLOWED.has(tk.name)) continue; // disallowed: drop the tag, keep inner text.
      out.push(buildStartTag(tk.name, tk.attrs, tk.selfClose));
      if (!VOID.has(tk.name) && !tk.selfClose) stack.push(tk.name);
      continue;
    }

    // end
    if (!ALLOWED.has(tk.name) || VOID.has(tk.name)) continue;
    const idx = stack.lastIndexOf(tk.name);
    if (idx === -1) continue; // stray close tag: ignore.
    for (let s = stack.length - 1; s >= idx; s--) out.push(`</${stack[s]}>`);
    stack.length = idx;
  }

  // close any still-open tags at the end (balancing / post-truncation completion).
  for (let s = stack.length - 1; s >= 0; s--) out.push(`</${stack[s]}>`);
  return out.join("");
}

/** Format-preserving sanitize for Yahoo's HTML-allowed fields.
 * @param html input HTML (e.g. raw HTML from Rakuten).
 * @param maxFullWidth when given, truncates so the text portion's full-width length
 *   stays within this limit, cutting only on a tag boundary.
 * @returns safe HTML with dangerous elements removed and all tags balanced. */
export function sanitizeYahooHtml(html: string, maxFullWidth?: number): string {
  if (html == null || html === "") return "";
  const pre = removeDangerousElements(html);
  return render(tokenize(pre), maxFullWidth);
}
