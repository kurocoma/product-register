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
