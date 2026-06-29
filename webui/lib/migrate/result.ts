import type { MigrationItemResult, MigrationStep, MigrationSummary } from "./types";

/** per-item の結果配列をステータス別に集計する純関数。
 * total は配列長。各カテゴリは status で振り分ける。
 * migrated は「移行できた件数」: commit の成功(status="ok") と
 * dry-run の移行可(status="migrate") の両方を数える。
 * 1 回の run は dry-run か commit のどちらか一方なので、両者を同じ migrated に
 * 合算しても意味は一意（dry-run では migrated=移行可件数、commit では migrated=成功件数）。 */
export function aggregate(results: MigrationItemResult[]): MigrationSummary {
  const summary: MigrationSummary = {
    total: results.length,
    migrated: 0,
    requiresManual: 0,
    skipped: 0,
    failed: 0,
  };
  for (const r of results) {
    switch (r.status) {
      case "ok": // commit: 登録成功
      case "migrate": // dry-run: 移行可（書き込みなしのプレビュー結果）
        summary.migrated++;
        break;
      case "requires_manual":
        summary.requiresManual++;
        break;
      case "skipped":
        summary.skipped++;
        break;
      case "failed":
        summary.failed++;
        break;
    }
  }
  return summary;
}

/** 既定の待機関数（実時間スリープ）。テストでは opts.sleep に no-op を注入して使う。 */
const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 注入された per-item 処理を順次実行する純粋オーケストレータ。
 *
 * - 入力順を保持して結果を返す（順序保持）。
 * - continueOnError=true（既定）なら 1件が throw/reject しても残りを処理し、
 *   失敗を MigrationItemResult(status:"failed") として結果化する（失敗継続）。
 * - continueOnError=false なら最初の throw で打ち切る（それまでの結果＋失敗1件を返す）。
 *   また item が status:"failed" を返した場合も以降は実行せず、残りを
 *   status:"skipped"（前段の失敗で中断）として明示的に積む（型契約の honest化 / AC-H03）。
 *   requires_manual は「失敗」ではなく安全分類なので打ち切らない。
 * - delayMs>0（任意・既定0）なら各 item の処理の「間」に待機を挟み、モール API への
 *   過負荷（連続リクエスト）を防ぐ（レート制御）。先頭の前・末尾の後には待たない。
 *   既定0なら待機自体を行わないため、既存の順次・遅延0挙動と完全に一致する。
 *   sleep は注入可能（テストは no-op を渡して実時間を消費しない）。
 *
 * perItem 自身は通常 MigrationItemResult を return する。throw は想定外失敗の安全網。
 * 想定外 throw 時の step は errorStep（既定 "register"）を使う。 */
export async function runItems<T extends { manageNumber: string }>(
  items: T[],
  perItem: (item: T, index: number) => Promise<MigrationItemResult>,
  opts: {
    continueOnError?: boolean;
    errorStep?: MigrationStep;
    /** item 間の待機ミリ秒（レート制御）。既定0=待機なし（既存挙動）。 */
    delayMs?: number;
    /** 待機関数の注入口（テスト用）。既定は実時間スリープ。 */
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<MigrationItemResult[]> {
  const { continueOnError = true, errorStep = "register", delayMs = 0, sleep = defaultSleep } = opts;
  const out: MigrationItemResult[] = [];
  for (let i = 0; i < items.length; i++) {
    // レート制御: 2件目以降は前の処理との間に待機を挟む（delayMs>0 のときだけ）
    if (i > 0 && delayMs > 0) await sleep(delayMs);
    const item = items[i];
    let result: MigrationItemResult;
    try {
      result = await perItem(item, i);
    } catch (e) {
      // 想定外 throw は安全網。continueOnError=false なら以降を処理せず打ち切る（従来挙動）。
      out.push({
        manageNumber: item.manageNumber,
        step: errorStep,
        ok: false,
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
      });
      if (!continueOnError) break;
      continue;
    }
    out.push(result);
    // continueOnError=false で item が status:"failed" を返したら、残りは実行せず
    // status:"skipped"（前段の失敗で中断）として明示的に積む（dead path 解消 / AC-H03）。
    if (!continueOnError && result.status === "failed") {
      for (let j = i + 1; j < items.length; j++) {
        out.push({
          manageNumber: items[j].manageNumber,
          step: "import", // 未到達（前段で中断）
          ok: false,
          status: "skipped",
          error: "前段の失敗により中断（continueOnError=false）",
        });
      }
      break;
    }
  }
  return out;
}
