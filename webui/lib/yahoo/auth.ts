/** Yahoo!ショッピングAPI の OAuth(YConnect v2) トークン管理。
 * 画像アップロード(uploadLibImage/deleteLibImage)は通常の Bearer 認証で足りる
 * （公開鍵認証は editItem 専用なので不要）。
 * サーバー専用env: YAHOO_CLIENT_ID / YAHOO_CLIENT_SECRET / YAHOO_REFRESH_TOKEN / SELLER_ID。 */

const TOKEN_ENDPOINT = "https://auth.login.yahoo.co.jp/yconnect/v2/token";

export type YahooConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  sellerId: string;
};

export function getYahooConfig(): YahooConfig | null {
  const clientId = process.env.YAHOO_CLIENT_ID;
  const clientSecret = process.env.YAHOO_CLIENT_SECRET;
  const refreshToken = process.env.YAHOO_REFRESH_TOKEN;
  const sellerId = process.env.SELLER_ID;
  if (!clientId || !clientSecret || !refreshToken || !sellerId) return null;
  return { clientId, clientSecret, refreshToken, sellerId };
}

// アクセストークンのプロセス内キャッシュ（有効期限の少し前まで再利用）
let cached: { token: string; expiresAt: number } | null = null;

/** refresh_token からアクセストークンを取得する（有効ならキャッシュを返す）。 */
export async function getYahooAccessToken(cfg: YahooConfig): Promise<string> {
  const now = Date.now();
  if (cached && now < cached.expiresAt - 60_000) return cached.token;

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: cfg.refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    }),
  });
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!json.access_token) {
    const detail = json.error_description || json.error || `HTTP ${res.status}`;
    // refresh_token 失効(invalid_grant/4102)はここに来る → 再認証が必要
    throw new Error(`Yahoo アクセストークン取得失敗: ${detail}`);
  }
  cached = { token: json.access_token, expiresAt: now + (json.expires_in ?? 3600) * 1000 };
  return json.access_token;
}

/** テスト用: トークンキャッシュをクリアする。 */
export function _clearYahooTokenCache() {
  cached = null;
}
