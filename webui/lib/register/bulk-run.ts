/** 一括登録（commit）のフロント側オーケストレーション。
 * BulkRegisterPanel から通信を deps 注入で分離し、ユニットテスト可能にする。
 * 反映(submit)の予約可否は「最後の1件の成否」ではなく「全体で1件でも登録に成功したか」で
 * 判定する（最終件が失敗しても、先行して成功した商品の反映が漏れないようにする）。 */

import type { BulkItemResult } from "./types";

export type BulkRunTarget = Pick<BulkItemResult, "id" | "ne_code" | "product_name">;

export type BulkRunProgress = { done: number; total: number; ok: number; ng: number };

export type BulkRunSubmit = { submitted: boolean; submitMessage?: string };

export type BulkRunDeps = {
  /** 1商品の実登録（/api/register/bulk/[mall] へ ids:[id] で POST）。件別結果を返す。 */
  registerOne: (target: BulkRunTarget) => Promise<BulkItemResult>;
  /** ストア全体の反映予約（/api/register/bulk/yahoo へ action:"submit" で POST）。 */
  reserveSubmit: () => Promise<BulkRunSubmit>;
  /** 1件処理するたびに呼ぶ進捗通知（UI 更新用）。 */
  onProgress?: (progress: BulkRunProgress, results: BulkItemResult[]) => void;
};

export type BulkRunResult = {
  results: BulkItemResult[];
  /** 登録に成功した商品ID（一覧の mall_listed 表示更新の通知用）。 */
  okIds: string[];
  /** 反映予約の結果。予約を要求しなかった（opts.submit=false）ときは null。 */
  submit: BulkRunSubmit | null;
};

/** 対象商品を1件ずつ順番に登録し、完了後に必要なら反映予約を1回だけ行う。
 * - モールAPIに負荷をかけないため並列にしない。
 * - 1件の失敗（HTTPエラー・通信例外）で全体を止めない。
 * - opts.submit=true のとき、成功が1件でもあれば reserveSubmit を1回呼ぶ
 *   （予約はストア全体単位のため商品ごとには呼ばない）。 */
export async function runBulkRegisterSequential(
  targets: BulkRunTarget[],
  opts: { submit: boolean },
  deps: BulkRunDeps,
): Promise<BulkRunResult> {
  const results: BulkItemResult[] = [];
  const okIds: string[] = [];
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    let r: BulkItemResult;
    try {
      r = await deps.registerOne(t);
    } catch (e) {
      r = {
        id: t.id,
        ne_code: t.ne_code,
        product_name: t.product_name,
        ok: false,
        error: "通信エラー: " + (e instanceof Error ? e.message : String(e)),
      };
    }
    results.push(r);
    if (r.ok) okIds.push(t.id);
    deps.onProgress?.(
      { done: i + 1, total: targets.length, ok: okIds.length, ng: results.length - okIds.length },
      [...results],
    );
  }

  // 反映予約は「最終件の成否」ではなく「成功件数 > 0」で判定する（先行成功分の反映漏れ防止）
  let submit: BulkRunSubmit | null = null;
  if (opts.submit) {
    if (okIds.length > 0) {
      try {
        submit = await deps.reserveSubmit();
      } catch (e) {
        submit = {
          submitted: false,
          submitMessage: "通信エラー: " + (e instanceof Error ? e.message : String(e)),
        };
      }
    } else {
      submit = { submitted: false, submitMessage: "登録に成功した商品がないため反映を予約しませんでした" };
    }
  }

  return { results, okIds, submit };
}
