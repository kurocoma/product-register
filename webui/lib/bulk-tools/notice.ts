import { createHash } from "node:crypto";

/** お知らせ一括追記（機能2）のマーカー純ロジック。
 *
 * 追記は HTML コメント＋本文ハッシュID のマーカーで囲む:
 *   `<!--PR_NOTICE_START:a1b2c3d4-->本文<!--PR_NOTICE_END:a1b2c3d4-->`
 * ID は本文の sha256 先頭8桁。同じ本文なら同じ ID になり、二重追記の検出と
 * 「同じお知らせを一括で外す」解除の両方に使う。
 *
 * スマホ説明文（productDescription.sp）も同方式（マーカーあり）を採用:
 * 2026-07-28 実測（tests/bulk_tools_probe_sp_comment.mjs・zzz商品）で、HTML コメントは
 * pc / sp とも items.patch 204 で受理され、items.get 読み戻しでも保持されることを確認済み。
 * （sp の禁止タグ変換 sanitizeRakutenSpHtml はコメントに触れない。）
 * Yahoo 側は caption サニタイズ（html-sanitize.ts）がコメントを落とすため、ページ上は
 * 本文のみ表示される（マーカーはアプリDB内でのみ往復し、解除はDB値に対して行う）。
 */

export const NOTICE_FIELDS = ["sale_description_pc", "description_pc", "description_sp"] as const;
export type NoticeField = (typeof NOTICE_FIELDS)[number];
export type NoticePosition = "head" | "tail";

export const NOTICE_FIELD_LABELS: Record<NoticeField, string> = {
  sale_description_pc: "楽天PC販売説明文",
  description_pc: "PC商品説明文",
  description_sp: "スマホ説明文",
};

/** お知らせ本文 → マーカーID（sha256 先頭8桁）。 */
export function noticeIdOf(body: string): string {
  return createHash("sha256").update(body).digest("hex").slice(0, 8);
}

/** 本文をマーカーで囲んだブロックを作る。 */
export function wrapNotice(body: string): { id: string; block: string } {
  const id = noticeIdOf(body);
  return { id, block: `<!--PR_NOTICE_START:${id}-->${body}<!--PR_NOTICE_END:${id}-->` };
}

/** ブロックを冒頭/末尾へ追記する（区切りは改行1つ。解除時に同じ改行ごと除去して原文へ戻す）。 */
export function appendNotice(current: string, block: string, position: NoticePosition): string {
  return position === "head" ? `${block}\n${current}` : `${current}\n${block}`;
}

const BLOCK_RE = /<!--PR_NOTICE_START:([0-9a-f]{8})-->([\s\S]*?)<!--PR_NOTICE_END:\1-->/g;

export type NoticeBlock = { id: string; body: string; block: string };

/** テキスト中のマーカーブロックを列挙する（解除プレビューの検出用）。 */
export function findNoticeBlocks(text: string): NoticeBlock[] {
  const out: NoticeBlock[] = [];
  for (const m of String(text ?? "").matchAll(BLOCK_RE)) {
    out.push({ id: m[1], body: m[2], block: m[0] });
  }
  return out;
}

/** 指定 ID のマーカーブロックが存在するか（二重追記ガード）。 */
export function hasNoticeBlock(text: string, id: string): boolean {
  return findNoticeBlocks(text).some((b) => b.id === id);
}

/** 指定 ID のマーカーブロックをすべて除去する（マーカーごと）。
 * appendNotice が足した区切り改行も一緒に除去する:
 * 冒頭追記（block\n…）は後続改行を、末尾追記（…\nblock）は直前改行を優先的に除去し、
 * 追記→解除で原文が完全に復元される（往復対称）。 */
export function removeNoticeBlock(text: string, id: string): string {
  if (!/^[0-9a-f]{8}$/.test(id)) return text;
  const re = new RegExp(`<!--PR_NOTICE_START:${id}-->[\\s\\S]*?<!--PR_NOTICE_END:${id}-->`);
  let out = String(text ?? "");
  for (;;) {
    const m = re.exec(out);
    if (!m) break;
    const start = m.index;
    const end = start + m[0].length;
    if (out[end] === "\n") out = out.slice(0, start) + out.slice(end + 1);
    else if (start > 0 && out[start - 1] === "\n") out = out.slice(0, start - 1) + out.slice(end);
    else out = out.slice(0, start) + out.slice(end);
  }
  return out;
}
