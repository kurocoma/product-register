// items.get 連続呼び出しの失敗ステータスを観察する調査用（zzz 商品のみ・後始末込み）。
// 実行: cd webui && npx tsx tests/sale_support_probe_ratelimit.mjs
import { readFileSync } from "node:fs";
import { getRakutenCredentialsFromEnv } from "../lib/rakuten/credentials.ts";
import { getItem, upsertItem, patchItem, deleteItem } from "../lib/rakuten/item-client.ts";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const l of env.split("\n")) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); }
const cred = getRakutenCredentialsFromEnv();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MN = "zzz-ss-9992";

// 前回の残骸を後始末
for (const mn of ["zzz-ss-9991-SS", MN]) {
  const d = await deleteItem(cred, mn);
  console.log(`cleanup ${mn}: ${d.status}`);
  await sleep(600);
}

const up = await upsertItem(cred, MN, {
  title: "レート調査", itemType: "NORMAL", genreId: "553575", hideItem: true,
  payment: { taxIncluded: false, taxRate: "0.08" },
  variants: { v1: { standardPrice: "1000", articleNumber: { exemptionReason: 3 }, shipping: { postageIncluded: true },
    attributes: [{ name: "メーカー型番", values: ["X"] }, { name: "タイトル", values: ["Y"] }, { name: "発売元", values: ["Z"] }] } },
});
console.log(`upsert: ${up.status} ${up.ok ? "" : up.message}`);

// patch 直後に無待機で連続 get（executeApply の readback 相当）
const p = await patchItem(cred, MN, { variants: { v1: { standardPrice: "900" } } });
console.log(`patch: ${p.status} ${p.ok ? "" : p.message}`);
for (let i = 0; i < 6; i++) {
  const g = await getItem(cred, MN);
  console.log(`get#${i} (no wait): status=${g.status} exists=${g.exists}${g.status !== 200 ? " raw=" + g.raw.slice(0, 200).replace(/\s+/g, " ") : ""}`);
}
await sleep(1200);
const g = await getItem(cred, MN);
console.log(`get (after 1.2s): status=${g.status} price=${g.json?.variants?.v1?.standardPrice}`);

const d = await deleteItem(cred, MN);
console.log(`cleanup: ${d.status}`);
