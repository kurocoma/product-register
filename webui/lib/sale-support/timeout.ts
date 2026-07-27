/** per-call タイムアウト（既定30s）。RMS API 呼び出しをこの単位で包み、
 * 1件のハングで一括処理全体が止まらないようにする（超過は日本語メッセージの例外
 * → サービス層が当該商品 failed で継続）。tests/shimanoya_yahoo_sync_common.mjs の
 * withTimeout と同じ方式。 */
export const SALE_SUPPORT_CALL_TIMEOUT_MS = 30_000;

export async function withCallTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`タイムアウト(${ms}ms): ${label}`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
