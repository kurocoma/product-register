// 実在商品の payment（taxIncluded / taxRate）と referencePrice の実態を read-only で確認する。
// getItem のみ（書き込みなし）。楽天スーパーセール支援の税計算前提（税別登録）の裏取り用。
// 実行: cd webui && npx tsx tests/sale_support_survey_payment.mjs [管理番号...]
import { readFileSync } from "node:fs";
import { getRakutenCredentialsFromEnv } from "../lib/rakuten/credentials.ts";
import { getItem } from "../lib/rakuten/item-client.ts";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const l of env.split("\n")) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); }
const cred = getRakutenCredentialsFromEnv();
if (!cred) { console.error("楽天 ESA 認証情報が未設定です"); process.exit(2); }

const targets = process.argv.slice(2).length ? process.argv.slice(2) : ["r117-1", "r3001-1", "r7201-1"];
for (const mn of targets) {
  const g = await getItem(cred, mn);
  if (!g.exists || !g.json) { console.log(`${mn}: 取得できず (status=${g.status})`); continue; }
  const j = g.json;
  console.log(`--- ${mn} ---`);
  console.log(`payment: ${JSON.stringify(j.payment ?? null)}`);
  console.log(`purchasablePeriod: ${JSON.stringify(j.purchasablePeriod ?? null)}`);
  for (const [k, v] of Object.entries(j.variants ?? {})) {
    console.log(`  SKU ${k}: standardPrice=${v.standardPrice} referencePrice=${JSON.stringify(v.referencePrice ?? null)} subscriptionPrice=${JSON.stringify(v.subscriptionPrice ?? null)}`);
  }
  await new Promise((r) => setTimeout(r, 700));
}
