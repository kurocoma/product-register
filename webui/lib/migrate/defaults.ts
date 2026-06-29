import type { SafeStateDefaults } from "./types";

/** Yahoo 登録時の安全状態の既定値を返す純関数。
 *
 * 既存 `app/api/register/yahoo/[id]` の安全登録思想（display=0 で非公開登録）に整合させ、
 * 一括移行でも誤公開を防ぐ。
 *
 * 実効的な安全機構は **display=0（非表示）** と **submitItem を呼ばない（publish=false）**。
 * stock は editItem の対象列ではなく（Yahoo の在庫は別 API 管理）本フローからは送信しない。
 * そのため stock は「安全既定では在庫を増やさない」という意図を表す参考値に留める（誇張しない）。
 *
 * - publish=false（既定・本セッションで使う安全側）:
 *     display:0（非表示）/ submitItem 非実行（非公開）。stock:0 は意図値（未送信）。
 * - publish=true（公開相当・本セッションでは使わない）:
 *     display:1（表示）/ 公開。stock:1 は意図値（実在庫は別 API・呼び出し側の責務）。 */
export function safeStateDefaults(publish: boolean): SafeStateDefaults {
  if (publish) {
    return { yahooDisplay: 1, stock: 1, registerPublish: true };
  }
  return { yahooDisplay: 0, stock: 0, registerPublish: false };
}
