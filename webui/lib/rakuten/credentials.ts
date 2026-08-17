import type { RakutenCredentials } from "./cabinet-client";

/** サーバー専用の環境変数から R-Cabinet 資格情報を読む。
 * 単一店舗ローカル運用の前提。NEXT_PUBLIC_ を付けないこと（ブラウザに露出させない）。
 * 将来マルチ店舗化する場合は settings + Vault 経由に差し替える。 */
export function getRakutenCredentialsFromEnv(): RakutenCredentials | null {
  const serviceSecret = process.env.RAKUTEN_SERVICE_SECRET;
  const licenseKey = process.env.RAKUTEN_LICENSE_KEY;
  if (!serviceSecret || !licenseKey) return null;
  return { serviceSecret, licenseKey };
}

/** 楽天ウェブサービス（楽天市場商品検索API等）の applicationId を env から読む。
 * RMS の ESA 認証（serviceSecret/licenseKey）とは別系統。
 * https://webservice.rakuten.co.jp/ で無料発行できる。未設定なら null（呼び出し側で案内を出す）。 */
export function getRakutenApplicationIdFromEnv(): string | null {
  const id = process.env.RAKUTEN_APPLICATION_ID;
  return id && id.trim() ? id.trim() : null;
}
