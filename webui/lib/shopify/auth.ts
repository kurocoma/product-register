/** Shopify Admin API の Client Credentials 認証（Dev Dashboard custom app・サーバー間通信）。
 * トークンは shpca_ プレフィックス・有効期限 86399 秒(約24h)・refresh_token なし →
 * 期限 60 秒前に同じリクエストで再取得する。仕様: docs/shopify/01-認証・共通仕様.md §1。
 * サーバー専用 env: SHOPIFY_SHOP / SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET。 */

export type ShopifyConfig = {
  /** myshopify.com のサブドメイン（例 "kurima-okinawa"。".myshopify.com" 付きでも可） */
  shop: string;
  clientId: string;
  clientSecret: string;
};

export function getShopifyConfig(): ShopifyConfig | null {
  const shop = process.env.SHOPIFY_SHOP?.trim().replace(/\.myshopify\.com$/i, "");
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!shop || !clientId || !clientSecret) return null;
  return { shop, clientId, clientSecret };
}

// アクセストークンのプロセス内キャッシュ（有効期限の60秒前まで再利用）。
// yahoo/auth.ts と同じ流儀で資格情報ごとにキーを分離する。
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

function cacheKey(cfg: ShopifyConfig): string {
  return `${cfg.shop}\n${cfg.clientId}`;
}

/** Client Credentials Grant でアクセストークンを取得する（有効ならキャッシュを返す）。 */
export async function getShopifyAccessToken(cfg: ShopifyConfig): Promise<string> {
  const now = Date.now();
  const key = cacheKey(cfg);
  const cached = tokenCache.get(key);
  if (cached && now < cached.expiresAt - 60_000) return cached.token;

  const res = await fetch(`https://${cfg.shop}.myshopify.com/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: "client_credentials",
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!json.access_token) {
    const detail = json.error_description || json.error || `HTTP ${res.status}`;
    // custom app 未インストール・secret ローテーション時はここに来る（Dev Dashboard で確認）
    throw new Error(`Shopify アクセストークン取得失敗: ${detail}`);
  }
  tokenCache.set(key, { token: json.access_token, expiresAt: now + (json.expires_in ?? 86399) * 1000 });
  return json.access_token;
}

/** 401 復旧・テスト用: トークンキャッシュをクリアする。 */
export function _clearShopifyTokenCache() {
  tokenCache.clear();
}
