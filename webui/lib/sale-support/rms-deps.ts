import {
  createQpsPacer,
  deleteItem,
  getItem,
  patchItem,
  upsertItem,
  type RakutenCredentials,
} from "@/lib/rakuten";
import { SALE_SUPPORT_CALL_TIMEOUT_MS, withCallTimeout } from "./timeout";
import type { SaleSupportDeps } from "./service";

export type SaleSupportRmsDeps = Pick<
  SaleSupportDeps,
  "getItem" | "upsertItem" | "patchItem" | "deleteItem"
>;

/** RMS items API の QPS 制限（実測: 連続呼び出しで HTTP 429 GA0003
 * "Exceeded QPS Limitation"。2026-07-28 tests/sale_support_probe_ratelimit.mjs）。 */
const RMS_QPS_INTERVAL_MS = 400;

/**
 * 楽天 items API クライアントを「per-call タイムアウト＋QPSペーシング（429は待って再試行）」で
 * 包んだ RMS 側 deps。API ルート（deps.ts）と実機E2E（tests/sale_support_e2e_service.mjs）が共用する。
 * ペーサーは4関数で1本を共有し、呼び出し全体の間隔を空ける（既存 createQpsPacer を利用）。
 */
export function makeRakutenRmsDeps(
  cred: RakutenCredentials,
  opts: { intervalMs?: number } = {},
): SaleSupportRmsDeps {
  const pace = createQpsPacer({ intervalMs: opts.intervalMs ?? RMS_QPS_INTERVAL_MS, retries: 4 });
  const t = SALE_SUPPORT_CALL_TIMEOUT_MS;
  const isLimited = (r: { status: number }) => r.status === 429;
  return {
    getItem: (mn) =>
      pace(() => withCallTimeout(getItem(cred, mn), t, `items.get ${mn}`), isLimited),
    upsertItem: (mn, body) =>
      pace(() => withCallTimeout(upsertItem(cred, mn, body), t, `items.upsert ${mn}`), isLimited),
    patchItem: (mn, body) =>
      pace(() => withCallTimeout(patchItem(cred, mn, body), t, `items.patch ${mn}`), isLimited),
    deleteItem: (mn) =>
      pace(() => withCallTimeout(deleteItem(cred, mn), t, `items.delete ${mn}`), isLimited),
  };
}
