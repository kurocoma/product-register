/** R-Cabinet API の秒間リクエスト制限（QPSLimit）対策。
 * 無ウェイトで連続アップロードすると数枚目から QPSLimit で失敗するため、
 * (1) 呼び出し間隔を最低 intervalMs 空ける、(2) QPSLimit 応答時は待って再試行する。
 * QPS 以外の失敗（認証エラー等）は再試行せず従来どおり即失敗として返す。 */

/** R-Cabinet の systemStatus=NG message が QPS 制限由来かを判定する。 */
export function isQpsLimit(message: string | undefined): boolean {
  return /qpslimit/i.test(message ?? "");
}

export type QpsPacerOpts = {
  /** 呼び出し間の最低間隔（既定 1100ms — 制限は秒間1リクエスト相当のため余裕を持たせる） */
  intervalMs?: number;
  /** QPSLimit 応答時の再試行回数（既定 3） */
  retries?: number;
  /** テスト注入用 */
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 直列呼び出し用のペーサーを作る。返る関数で API 呼び出しを包むと、
 * 2回目以降の呼び出し前に intervalMs 待ち、isLimited が真の間は待って再試行する。 */
export function createQpsPacer(opts: QpsPacerOpts = {}) {
  const intervalMs = opts.intervalMs ?? 1100;
  const retries = opts.retries ?? 3;
  const sleep = opts.sleep ?? defaultSleep;
  let first = true;

  return async function pace<T>(call: () => Promise<T>, isLimited: (result: T) => boolean): Promise<T> {
    if (!first) await sleep(intervalMs);
    first = false;
    let result = await call();
    for (let attempt = 1; attempt <= retries && isLimited(result); attempt++) {
      // 再試行のたびに待ちを延ばす（1.1s → 2.2s → 3.3s）。制限窓を確実に抜ける
      await sleep(intervalMs * (attempt + 1));
      result = await call();
    }
    return result;
  };
}
