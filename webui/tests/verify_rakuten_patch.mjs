// 楽天 items.patch 部分更新の実機検証:
//   upsert(初期) → getItem(snapshot) → 価格だけ変更しdiff→patch → getItem(価格のみ変化・他不変)
//   → 説明文だけ変更しpatch → getItem(説明のみ変化・価格保持) → delete
// 実行: npx tsx tests/verify_rakuten_patch.mjs
import { readFileSync } from "node:fs";
import { getRakutenCredentialsFromEnv } from "../lib/rakuten/credentials.ts";
import { esaAuthHeader } from "../lib/rakuten/cabinet-client.ts";
import { getItem, patchItem, deleteItem } from "../lib/rakuten/item-client.ts";
import { parseRakutenItem } from "../lib/converters/rakuten-item-parser.ts";
import { diffProduct } from "../lib/product/diff.ts";
import { buildRakutenPatchBody } from "../lib/converters/rakuten-patch.ts";
import { makeProduct } from "../lib/product/schema.ts";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const l of env.split("\n")) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); }
const cred = getRakutenCredentialsFromEnv();
const auth = esaAuthHeader(cred.serviceSecret, cred.licenseKey);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (l, c, d) => { if (!c) fail++; console.log(`${c ? "✅" : "❌"} ${l}${d ? "  " + d : ""}`); };

const MN = "zzz-patch-9994";
const VID = "zzz-pv-1";

// --- 初期 upsert（価格2580・PC説明確認・キャッチ確認・hideItem） ---
const initBody = {
  title: "PATCH初期商品", itemType: "NORMAL", genreId: "553575", hideItem: true, tagline: "初期キャッチ",
  productDescription: { pc: "<p>初期PC説明</p>", sp: "<p>初期SP説明</p>" },
  variants: { [VID]: { standardPrice: "2580", articleNumber: { value: "4955028002542" }, shipping: { postageIncluded: true },
    attributes: [{ name: "メーカー型番", values: ["X"] }, { name: "タイトル", values: ["Y"] }, { name: "発売元", values: ["Z"] }] } },
};
const up = await fetch(`https://api.rms.rakuten.co.jp/es/2.0/items/manage-numbers/${MN}`, { method: "PUT", headers: { Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify(initBody) });
check("初期 upsert", up.status === 201 || up.status === 204, `HTTP ${up.status}`);
await sleep(1500);

// --- snapshot 取得 ---
const g0 = await getItem(cred, MN);
check("snapshot getItem", g0.exists && g0.json !== null, `status=${g0.status}`);
const snap = parseRakutenItem(g0.json);
check("snapshot 価格=2580", snap.selling_price === 2580, String(snap.selling_price));

// --- ① 価格だけ変更（2580 → 3980） ---
const edited1 = makeProduct({ ...snap, ne_code: snap._variantId, selling_price: 3980 });
const diff1 = diffProduct(snap, edited1);
check("diff①は価格1件のみ", diff1.length === 1 && diff1[0].field === "selling_price", `${diff1.map((x) => x.field).join(",")}`);
const { body: pb1 } = buildRakutenPatchBody(diff1, edited1);
check("patchボディ① variantsのみ", JSON.stringify(pb1) === JSON.stringify({ variants: { [VID]: { standardPrice: "3980" } } }), JSON.stringify(pb1));
const pr1 = await patchItem(cred, MN, pb1);
check("patch① 実行", pr1.ok, pr1.ok ? `HTTP ${pr1.status}` : pr1.message);
await sleep(1500);

const g1 = await getItem(cred, MN);
const after1 = parseRakutenItem(g1.json);
check("① 価格が3980に変化", after1.selling_price === 3980, String(after1.selling_price));
check("① title 不変", after1.display_name === "PATCH初期商品", after1.display_name);
check("① PC説明 不変", after1.description_pc === "<p>初期PC説明</p>", after1.description_pc);
check("① catch 不変", after1.catch_copy_pc === "初期キャッチ", after1.catch_copy_pc);
check("① JAN 不変", after1.jan_code === "4955028002542", after1.jan_code);

// --- ② 説明文(PC)だけ変更（価格は保持されるはず） ---
const snap2 = parseRakutenItem(g1.json);
const edited2 = makeProduct({ ...snap2, ne_code: snap2._variantId, description_pc: "<p>更新後PC説明</p>" });
const diff2 = diffProduct(snap2, edited2);
check("diff②は説明1件のみ", diff2.length === 1 && diff2[0].field === "description_pc", `${diff2.map((x) => x.field).join(",")}`);
const { body: pb2 } = buildRakutenPatchBody(diff2, edited2);
check("patchボディ② productDescription含む", !!pb2.productDescription && !pb2.variants, JSON.stringify(pb2));
const pr2 = await patchItem(cred, MN, pb2);
check("patch② 実行", pr2.ok, pr2.ok ? `HTTP ${pr2.status}` : pr2.message);
await sleep(1500);

const g2 = await getItem(cred, MN);
const after2 = parseRakutenItem(g2.json);
check("② PC説明が更新", after2.description_pc === "<p>更新後PC説明</p>", after2.description_pc);
check("② 価格3980 保持", after2.selling_price === 3980, String(after2.selling_price));
check("② SP説明 不変", after2.description_sp === "<p>初期SP説明</p>", after2.description_sp);

// --- 後始末 ---
await sleep(800);
const del = await deleteItem(cred, MN);
check("後始末 delete", del.ok, `status=${del.status}`);

console.log(fail === 0 ? "\n🎉 楽天 items.patch 部分更新 実機検証パス（後始末完了）" : `\n⚠ ${fail}件失敗`);
process.exit(fail === 0 ? 0 : 1);
