// parseRakutenItem の実機検証: テスト商品をupsert→getItem(全文JSON)→parse→期待値→delete。
// 実行: npx tsx tests/verify_rakuten_parser.mjs
import { readFileSync } from "node:fs";
import { getRakutenCredentialsFromEnv } from "../lib/rakuten/credentials.ts";
import { esaAuthHeader } from "../lib/rakuten/cabinet-client.ts";
import { getItem, deleteItem } from "../lib/rakuten/item-client.ts";
import { parseRakutenItem } from "../lib/converters/rakuten-item-parser.ts";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const l of env.split("\n")) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); }
const cred = getRakutenCredentialsFromEnv();
const auth = esaAuthHeader(cred.serviceSecret, cred.licenseKey);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (l, c, d) => { if (!c) fail++; console.log(`${c ? "✅" : "❌"} ${l}${d ? "  " + d : ""}`); };

const MN = "zzz-parse-9995";
// variant キー(zzz-pv-1)と merchantDefinedSkuId(zzz-mds-1)を別値にし、NEコードに後者が採用されることを検証。
const body = {
  title: "パース検証商品", itemType: "NORMAL", genreId: "553575", hideItem: true, tagline: "キャッチ確認",
  productDescription: { pc: "<p>PC説明確認</p>", sp: "<p>SP説明</p>" },
  images: [{ type: "CABINET", location: "/thum02/zzz-pv-1.jpg" }],
  variants: { "zzz-pv-1": { merchantDefinedSkuId: "zzz-mds-1", standardPrice: "2580", articleNumber: { value: "4955028002542" }, shipping: { postageIncluded: true },
    attributes: [{ name: "メーカー型番", values: ["X"] }, { name: "タイトル", values: ["Y"] }, { name: "発売元", values: ["Z"] }] } },
};

const up = await fetch(`https://api.rms.rakuten.co.jp/es/2.0/items/manage-numbers/${MN}`, { method: "PUT", headers: { Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify(body) });
check("テスト商品 upsert", up.status === 201 || up.status === 204, `HTTP ${up.status}`);
await sleep(1500);

const got = await getItem(cred, MN);
check("getItem 全文JSON取得", got.exists && got.json !== null, `status=${got.status}`);

const parsed = parseRakutenItem(got.json);
check("display_name = title", parsed.display_name === "パース検証商品", parsed.display_name);
check("mall_category_id = genreId", parsed.mall_category_id === "553575", parsed.mall_category_id);
check("description_pc", parsed.description_pc === "<p>PC説明確認</p>", parsed.description_pc);
check("catch_copy_pc = tagline", parsed.catch_copy_pc === "キャッチ確認", parsed.catch_copy_pc);
check("ne_code = merchantDefinedSkuId(variantキーでなく)", parsed.ne_code === "zzz-mds-1", parsed.ne_code);
check("rakuten_variant_id = variantキー(SKU管理番号)", parsed.rakuten_variant_id === "zzz-pv-1", parsed.rakuten_variant_id);
check("selling_price(number)", parsed.selling_price === 2580, String(parsed.selling_price));
check("jan_code = articleNumber.value", parsed.jan_code === "4955028002542", parsed.jan_code);
check("shipping_type = 送料無料", parsed.shipping_type === "送料無料", parsed.shipping_type);
check("image_count = images数", parsed.image_count === 1, String(parsed.image_count));
check("image_url_1 = 実画像の公開URL", parsed.image_url_1 === "https://image.rakuten.co.jp/ichiban-okinawa/cabinet/thum02/zzz-pv-1.jpg", parsed.image_url_1);
check("attributes 取込(3件)", Array.isArray(parsed.attributes) && parsed.attributes.length === 3, `${parsed.attributes?.length}件`);
check("attribute item/value(ジャンル必須属性を保持)", parsed.attributes?.[0]?.item === "メーカー型番" && parsed.attributes?.[0]?.value === "X", JSON.stringify(parsed.attributes?.[0]));

// オフライン: unit付き・多値属性のパース(先頭値採用)を確認（API不要）。
{
  const mock = parseRakutenItem({
    variants: { v1: { merchantDefinedSkuId: "ne-1", attributes: [
      { name: "総重量", unit: "ｇ", values: ["300"] },
      { name: "食品の状態", values: ["レトルト", "インスタント"] },
      { name: "", values: ["x"] },        // 名前空→除外
      { name: "空値", values: [] },        // 値空→除外
    ] } },
  });
  check("offline: unit付き属性", mock.attributes?.some((a) => a.item === "総重量" && a.unit === "ｇ" && a.value === "300"), JSON.stringify(mock.attributes));
  check("offline: 多値は先頭値採用", mock.attributes?.some((a) => a.item === "食品の状態" && a.value === "レトルト"), "");
  check("offline: 名前/値が空の属性は除外", mock.attributes?.length === 2, `${mock.attributes?.length}件`);
}

await sleep(800);
const del = await deleteItem(cred, MN);
check("後始末 delete", del.ok, `status=${del.status}`);

console.log(fail === 0 ? "\n🎉 parseRakutenItem 実機検証パス（後始末完了）" : `\n⚠ ${fail}件失敗`);
process.exit(fail === 0 ? 0 : 1);
