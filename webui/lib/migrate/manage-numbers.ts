import type { ManageNumberParseResult } from "./types";

/** 楽天 商品管理番号に使える文字（半角英数 + "-" "_"・32文字以内）。
 * 既存 `lib/converters/mall-import.ts` の検証規約（RAKUTEN_CODE_RE + 32文字制限）に整合させる。 */
const RAKUTEN_MANAGE_NUMBER_RE = /^[a-zA-Z0-9_-]{1,32}$/;

/** ユーザー貼り付けの管理番号入力を正規化して valid/invalid に分類する純関数。
 *
 * 受理する形:
 *  - 改行区切り / カンマ区切り / CSV 1列（混在可）
 *  - 文字列配列（各要素をさらに改行・カンマで分割）
 *
 * 処理:
 *  - 前後空白を除去し、空トークンは無視
 *  - 完全一致の重複は除去し件数を duplicatesRemoved に計上（valid/invalid 双方が対象）
 *  - 楽天で使用可能な文字種・桁（半角英数 - _・32文字以内）で valid/invalid を判定
 *
 * I/O は行わない（モール照会・取込は呼び出し側）。 */
export function parseManageNumbers(input: string | string[]): ManageNumberParseResult {
  // 1) トークン化（改行/カンマで分割 → trim → 空を捨てる）
  const sources = Array.isArray(input) ? input : [input];
  const rawTokens: string[] = [];
  for (const s of sources) {
    for (const part of String(s).split(/[\r\n,]+/)) {
      const t = part.trim();
      if (t) rawTokens.push(t);
    }
  }

  // 2) 完全一致の重複を除去（出現順を保持）
  const seen = new Set<string>();
  const unique: string[] = [];
  let duplicatesRemoved = 0;
  for (const t of rawTokens) {
    if (seen.has(t)) {
      duplicatesRemoved++;
      continue;
    }
    seen.add(t);
    unique.push(t);
  }

  // 3) 文字種・桁で valid/invalid を分類
  const valid: string[] = [];
  const invalid: { raw: string; reason: string }[] = [];
  for (const t of unique) {
    if (RAKUTEN_MANAGE_NUMBER_RE.test(t)) {
      valid.push(t);
      continue;
    }
    const reason =
      t.length > 32
        ? "32文字を超えています"
        : "楽天で使用できない文字を含みます（使用可: 半角英数字と - _）";
    invalid.push({ raw: t, reason });
  }

  return { valid, invalid, duplicatesRemoved };
}
