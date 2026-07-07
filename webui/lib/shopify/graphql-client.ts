/** Shopify Admin GraphQL クライアント。
 * POST https://{shop}.myshopify.com/admin/api/{version}/graphql.json
 * （ヘッダー Content-Type + X-Shopify-Access-Token。docs/shopify/01 §2）。
 * バージョンは明示固定（latest は使わない。docs/shopify/01 §3・07 §8）。
 * リトライ: 401=トークン再取得1回 / THROTTLED・429=コスト回復待ち（docs/shopify/06 §3・07 §5）。 */
import { getShopifyAccessToken, _clearShopifyTokenCache, type ShopifyConfig } from "./auth";

export const SHOPIFY_API_VERSION = "2026-01";

type GraphQLError = {
  message?: string;
  extensions?: { code?: string };
};

type CostInfo = {
  requestedQueryCost?: number;
  actualQueryCost?: number;
  throttleStatus?: { maximumAvailable?: number; currentlyAvailable?: number; restoreRate?: number };
};

export type ShopifyGraphQLResult = {
  ok: boolean;
  status: number;
  data: Record<string, unknown> | null;
  /** エラー時の表示用メッセージ（GraphQL errors[] を整形） */
  message: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** THROTTLED 時の待機ミリ秒。コスト回復計算（(要求コスト - 残量) / 回復速度）+ 最低1秒。 */
function throttleWaitMs(cost: CostInfo | undefined): number {
  const requested = cost?.requestedQueryCost ?? 0;
  const available = cost?.throttleStatus?.currentlyAvailable ?? 0;
  const restore = cost?.throttleStatus?.restoreRate ?? 100; // Standard: 100pt/秒（docs/shopify/07 §1）
  const deficit = Math.max(0, requested - available);
  return Math.max(1000, Math.ceil((deficit / Math.max(restore, 1)) * 1000));
}

function formatGraphQLErrors(errors: GraphQLError[] | undefined, status: number): string {
  if (Array.isArray(errors) && errors.length > 0) {
    return errors.map((e) => `${e.extensions?.code ? `[${e.extensions.code}] ` : ""}${e.message ?? ""}`).join(" / ");
  }
  return `HTTP ${status}`;
}

/** GraphQL を1回呼ぶ（自動リトライ付き）。ネットワーク/認証/THROTTLED を面倒見る。
 * 戻りの ok は「GraphQL としてエラーなく data が返った」こと。mutation の userErrors 検査は
 * 呼び出し側（product-client）の責務。 */
export async function shopifyGraphQL(
  cfg: ShopifyConfig,
  query: string,
  variables?: Record<string, unknown>,
  opts: { maxRetries?: number } = {},
): Promise<ShopifyGraphQLResult> {
  const maxRetries = opts.maxRetries ?? 3;
  let authRetried = false;

  for (let attempt = 0; ; attempt++) {
    const token = await getShopifyAccessToken(cfg);
    const res = await fetch(`https://${cfg.shop}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables: variables ?? {} }),
    });

    // 401: トークン期限切れ/失効 → キャッシュ破棄して1回だけ再取得（docs/shopify/06 §1）
    if (res.status === 401 && !authRetried) {
      authRetried = true;
      _clearShopifyTokenCache();
      continue;
    }
    // 429: Retry-After に従って再試行（docs/shopify/06 §3）
    if (res.status === 429 && attempt < maxRetries) {
      const after = Number(res.headers.get("Retry-After"));
      await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : 1000);
      continue;
    }

    const text = await res.text();
    let json: { data?: Record<string, unknown>; errors?: GraphQLError[]; extensions?: { cost?: CostInfo } };
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, status: res.status, data: null, message: `HTTP ${res.status}: ${text.slice(0, 300)}` };
    }

    const errors = json.errors;
    if (Array.isArray(errors) && errors.length > 0) {
      // THROTTLED: コスト回復を待って再試行（docs/shopify/07 §5）
      const throttled = errors.some((e) => e.extensions?.code === "THROTTLED");
      if (throttled && attempt < maxRetries) {
        await sleep(throttleWaitMs(json.extensions?.cost));
        continue;
      }
      return { ok: false, status: res.status, data: json.data ?? null, message: formatGraphQLErrors(errors, res.status) };
    }
    if (!res.ok || !json.data) {
      return { ok: false, status: res.status, data: json.data ?? null, message: `HTTP ${res.status}: ${text.slice(0, 300)}` };
    }
    return { ok: true, status: res.status, data: json.data, message: "" };
  }
}

export type UserError = { field?: (string | null)[] | null; message?: string };

/** mutation の userErrors[] を表示用メッセージへ整形する（空なら ""）。docs/shopify/06 §1 の3層判定の第3層。 */
export function formatUserErrors(userErrors: UserError[] | undefined): string {
  if (!Array.isArray(userErrors) || userErrors.length === 0) return "";
  return userErrors
    .map((e) => `${e.field?.filter(Boolean).join(".") ?? ""}: ${e.message ?? ""}`.replace(/^: /, ""))
    .join(" / ");
}
