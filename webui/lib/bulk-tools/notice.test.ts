import { describe, expect, it } from "vitest";
// rakuten-sp-html は barrel 非公開の内部モジュール（rakuten-patch が直 import する送信直前変換）。
// SP マーカー保持の固定にはその実体を直接検証する。
import { sanitizeRakutenSpHtml } from "@/lib/converters/rakuten-sp-html";
import {
  appendNotice,
  findNoticeBlocks,
  hasNoticeBlock,
  noticeIdOf,
  removeNoticeBlock,
  wrapNotice,
} from "./notice";

const BODY = "<p>【重要】8/11〜8/15は夏季休業のため出荷をお休みします。</p>";

describe("wrapNotice — マーカーID", () => {
  it("本文の sha256 先頭8桁（16進）を ID にする", () => {
    const { id, block } = wrapNotice(BODY);
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(id).toBe(noticeIdOf(BODY));
    expect(block).toBe(`<!--PR_NOTICE_START:${id}-->${BODY}<!--PR_NOTICE_END:${id}-->`);
  });

  it("本文が同じなら同じ ID、違えば別 ID", () => {
    expect(wrapNotice(BODY).id).toBe(wrapNotice(BODY).id);
    expect(wrapNotice(BODY).id).not.toBe(wrapNotice(BODY + "x").id);
  });
});

describe("appendNotice / removeNoticeBlock — 往復対称", () => {
  const original = "<p>元の説明文</p>\n<table><tr><td>内容</td></tr></table>";

  it("冒頭追記 → 解除で原文を完全復元する", () => {
    const { id, block } = wrapNotice(BODY);
    const appended = appendNotice(original, block, "head");
    expect(appended).toBe(`${block}\n${original}`);
    expect(appended.startsWith("<!--PR_NOTICE_START:")).toBe(true);
    expect(removeNoticeBlock(appended, id)).toBe(original);
  });

  it("末尾追記 → 解除で原文を完全復元する", () => {
    const { id, block } = wrapNotice(BODY);
    const appended = appendNotice(original, block, "tail");
    expect(appended).toBe(`${original}\n${block}`);
    expect(removeNoticeBlock(appended, id)).toBe(original);
  });

  it("改行に隣接しない（手動で埋め込まれた）ブロックも除去できる", () => {
    const { id, block } = wrapNotice(BODY);
    const text = `前${block}後`;
    expect(removeNoticeBlock(text, id)).toBe("前後");
  });

  it("別IDのお知らせが複数あるとき、指定IDだけを除去する", () => {
    const a = wrapNotice("お知らせA");
    const b = wrapNotice("お知らせB");
    let text = appendNotice(original, a.block, "head");
    text = appendNotice(text, b.block, "tail");
    const removedA = removeNoticeBlock(text, a.id);
    expect(removedA).toBe(appendNotice(original, b.block, "tail"));
    expect(removeNoticeBlock(removedA, b.id)).toBe(original);
  });

  it("同一IDのブロックが複数あればすべて除去する", () => {
    const { id, block } = wrapNotice(BODY);
    const text = `${block}\n${original}\n${block}`;
    expect(removeNoticeBlock(text, id)).toBe(original);
  });

  it("不正な ID（8桁16進でない）は何もしない", () => {
    const { block } = wrapNotice(BODY);
    const text = appendNotice(original, block, "head");
    expect(removeNoticeBlock(text, "../evil")).toBe(text);
  });
});

describe("findNoticeBlocks / hasNoticeBlock — 検出", () => {
  it("複数フィールド想定のテキストからブロックを列挙する", () => {
    const a = wrapNotice("A");
    const b = wrapNotice("B");
    const text = `${a.block}\n本文\n${b.block}`;
    const found = findNoticeBlocks(text);
    expect(found.map((f) => f.id)).toEqual([a.id, b.id]);
    expect(found[0].body).toBe("A");
    expect(found[1].body).toBe("B");
    expect(hasNoticeBlock(text, a.id)).toBe(true);
    expect(hasNoticeBlock(text, noticeIdOf("C"))).toBe(false);
  });

  it("マーカーが無いテキストは空配列", () => {
    expect(findNoticeBlocks("<p>説明</p>")).toEqual([]);
  });
});

describe("SP制約との整合 — sanitizeRakutenSpHtml がマーカーを保持する", () => {
  // 2026-07-28 実測（tests/bulk_tools_probe_sp_comment.mjs）: HTML コメントは
  // productDescription.pc / .sp とも items.patch 受理・読み戻しで保持される（マーカー方式採用の根拠）。
  // ここでは送信直前の sp 変換（禁止タグ自動修正）がコメントに触れないことを固定する。
  it("コメントマーカーは変換されず、本文内の禁止タグ（strong）だけが変換される", () => {
    const { id, block } = wrapNotice("<strong>重要なお知らせ</strong>");
    const sp = appendNotice("SP説明ベース", block, "tail");
    const sanitized = sanitizeRakutenSpHtml(sp);
    expect(sanitized).toContain(`<!--PR_NOTICE_START:${id}-->`);
    expect(sanitized).toContain(`<!--PR_NOTICE_END:${id}-->`);
    expect(sanitized).toContain("<b>重要なお知らせ</b>");
    expect(sanitized).not.toContain("<strong>");
  });

  it("マーカーは sp 変換後も findNoticeBlocks で検出できる（本文は変換後の形）", () => {
    const { id, block } = wrapNotice("<strong>B</strong>");
    const sanitized = sanitizeRakutenSpHtml(appendNotice("base", block, "head"));
    const found = findNoticeBlocks(sanitized);
    expect(found).toHaveLength(1);
    expect(found[0].id).toBe(id);
    expect(found[0].body).toBe("<b>B</b>");
  });
});
