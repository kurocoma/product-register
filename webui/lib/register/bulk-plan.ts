/** 一括登録の件別判定・集計の純関数群。
 * API route（bulk/[mall]）とフロント（BulkRegisterPanel）が同じ規則で
 * 結果を組み立て・集計・対象選定するための共有層（ユニットテスト対象）。 */

import type { BulkItemResult, BulkResponse, BulkSummary, Mall } from "./types";

/** dry-run の件別判定（key/exists/valid/missing）を共通の BulkItemResult へ正規化する。 */
export function toDryRunItemResult(
  id: string,
  product: { ne_code: string; product_name: string },
  plan: { key: string; exists: boolean; valid: boolean; missing: string[] },
): BulkItemResult {
  const base = {
    id,
    ne_code: product.ne_code,
    product_name: product.product_name,
    willOverwrite: plan.exists,
    key: plan.key,
  };
  if (!plan.valid) {
    return {
      ...base,
      ok: false,
      valid: false,
      missing: plan.missing,
      error: "必須項目が不足: " + plan.missing.join(", "),
    };
  }
  return { ...base, ok: true, valid: true, action: plan.exists ? "update" : "create" };
}

/** 商品が見つからない等、判定前に落ちた場合の件別結果。 */
export function toErrorItemResult(
  id: string,
  error: string,
  product?: { ne_code: string; product_name: string },
): BulkItemResult {
  return {
    id,
    ne_code: product?.ne_code ?? "",
    product_name: product?.product_name ?? "",
    ok: false,
    valid: false,
    error,
  };
}

/** 件別結果の集計（total/valid/invalid/willOverwrite/succeeded/failed）。 */
export function summarizeBulk(results: BulkItemResult[]): BulkSummary {
  return {
    total: results.length,
    valid: results.filter((r) => r.valid === true).length,
    invalid: results.filter((r) => r.valid !== true).length,
    willOverwrite: results.filter((r) => r.willOverwrite === true).length,
    succeeded: results.filter((r) => r.registered === true).length,
    failed: results.filter((r) => !r.ok).length,
  };
}

/** 一括レスポンスを組み立てる。一部の商品が invalid / 失敗でも全体は ok:true
 * （商品単位の成否は results[] で表現する。全体 fail は認証エラー等の処理前失敗のみ）。 */
export function buildBulkResponse(mall: Mall, dryRun: boolean, results: BulkItemResult[]): BulkResponse {
  return { ok: true, mall, dryRun, ...summarizeBulk(results), results };
}

/** commit の対象選定: dry-run で valid だった商品のみ。
 * 既存商品の上書き(willOverwrite)は overwrite を明示したときだけ含める（安全側既定）。 */
export function selectCommitTargets<T extends BulkItemResult>(
  results: T[],
  overwrite: boolean,
): { targets: T[]; skippedOverwrite: T[] } {
  const validResults = results.filter((r) => r.valid === true);
  return {
    targets: validResults.filter((r) => overwrite || r.willOverwrite !== true),
    skippedOverwrite: overwrite ? [] : validResults.filter((r) => r.willOverwrite === true),
  };
}

/** 「失敗した分だけ再実行」の対象抽出: commit 結果から失敗（ok !== true）のみを
 * 元の並び順のまま返す（成功済みの商品は再送しない）。 */
export function selectRetryTargets(results: BulkItemResult[]): BulkItemResult[] {
  return results.filter((r) => r.ok !== true);
}
