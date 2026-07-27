// -SS コピーのアプリDB行化（parseRakutenItem + parseRakutenVariants + buildImportedProduct）が
// 実在商品の getItem 生JSONで ok:true になるかの read-only 確認（DB書き込みなし）。
// 実行: cd webui && npx tsx tests/sale_support_dbrow_check.mjs [管理番号...]
import { readFileSync } from "node:fs";
import { getRakutenCredentialsFromEnv } from "../lib/rakuten/credentials.ts";
import { getItem } from "../lib/rakuten/item-client.ts";
import { parseRakutenItem, parseRakutenVariants } from "../lib/converters/rakuten-item-parser.ts";
import { buildImportedProduct } from "../lib/converters/mall-import.ts";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const l of env.split("\n")) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); }
const cred = getRakutenCredentialsFromEnv();
let fail = 0;

const targets = process.argv.slice(2).length ? process.argv.slice(2) : ["r117-1", "r3001-1", "r7201-1"];
for (const mn of targets) {
  const g = await getItem(cred, mn);
  if (!g.exists || !g.json) { console.log(`❌ ${mn}: getItem 失敗 (status=${g.status})`); fail++; continue; }
  const parsed = parseRakutenItem(g.json);
  const variants = parseRakutenVariants(g.json);
  const merged = { ...parsed, ne_code: "" };
  if (variants.length > 0) merged.variants = variants;
  const built = buildImportedProduct("rakuten", `${mn}-SS`, merged);
  if (built.ok) {
    console.log(`✅ ${mn}-SS: ProductInput 化 OK（ne_code=${built.product.ne_code} / SKU ${variants.length}件 / 価格 ${built.product.selling_price}）`);
  } else {
    console.log(`❌ ${mn}-SS: ${built.error}`);
    fail++;
  }
  await new Promise((r) => setTimeout(r, 800));
}
process.exit(fail === 0 ? 0 : 1);
