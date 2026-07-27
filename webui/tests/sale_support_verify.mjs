// 楽天スーパーセール支援の実装前提を zzz テスト商品で実機検証する（2026-07-28）。
//   V1: purchasablePeriod（販売期間）の patch → getItem 読み戻しでフィールド名・書式を確定
//   V2: purchasablePeriod の解除（JSON Merge Patch の null 送信）可否
//   V3: referencePrice（二重価格）の設定 → null 送信による解除可否
//   V4: getItem 生JSON を土台にした -SS コピー（hideItem=倉庫）upsert の成立可否
// 安全規約: zzz 系テスト商品のみ・hideItem=true（倉庫・非公開）・実商品には一切送信しない・全件後始末。
// 実行: cd webui && npx tsx tests/sale_support_verify.mjs
import { readFileSync } from "node:fs";
import { getRakutenCredentialsFromEnv } from "../lib/rakuten/credentials.ts";
import { getItem, patchItem, upsertItem, deleteItem } from "../lib/rakuten/item-client.ts";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const l of env.split("\n")) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); }
const cred = getRakutenCredentialsFromEnv();
if (!cred) { console.error("楽天 ESA 認証情報が未設定です"); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (l, c, d) => { if (!c) fail++; console.log(`${c ? "✅" : "❌"} ${l}${d ? "  " + d : ""}`); };
const note = (l, d) => console.log(`ℹ️  ${l}${d ? "  " + d : ""}`);

const MN = "zzz-ss-9990";
const SS = `${MN}-SS`;
const VID = "zzz-ssv-1";

// --- 0) 初期 upsert（税抜2000円・倉庫・単一SKU） ---
const initBody = {
  title: "SS支援検証商品", itemType: "NORMAL", genreId: "553575", hideItem: true, tagline: "SS検証キャッチ",
  productDescription: { pc: "<p>SS検証PC説明</p>", sp: "<p>SS検証SP説明</p>" },
  variants: { [VID]: { standardPrice: "2000", articleNumber: { value: "4955028002542" }, shipping: { postageIncluded: true },
    attributes: [{ name: "メーカー型番", values: ["X"] }, { name: "タイトル", values: ["Y"] }, { name: "発売元", values: ["Z"] }] } },
};
const up = await upsertItem(cred, MN, initBody);
check("初期 upsert (zzz-ss-9990, 倉庫)", up.ok, up.ok ? `HTTP ${up.status}` : up.message);
await sleep(1500);

const g0 = await getItem(cred, MN);
check("初期 getItem", g0.exists && g0.json !== null, `status=${g0.status}`);
note("getItem トップレベルキー", Object.keys(g0.json ?? {}).join(", "));
note("payment", JSON.stringify(g0.json?.payment ?? null));
note("purchasablePeriod(初期)", JSON.stringify(g0.json?.purchasablePeriod ?? null));

// --- V1) purchasablePeriod の patch → 読み戻し ---
const periodBody = { purchasablePeriod: { start: "2026-08-01T10:00:00+09:00", end: "2026-08-05T09:59:59+09:00" } };
const p1 = await patchItem(cred, MN, periodBody);
check("V1 purchasablePeriod patch 受理", p1.ok, p1.ok ? `HTTP ${p1.status}` : p1.message);
await sleep(1500);
const g1 = await getItem(cred, MN);
const pp = g1.json?.purchasablePeriod;
note("V1 読み戻し purchasablePeriod", JSON.stringify(pp ?? null));
check("V1 読み戻しで start/end が返る", !!pp && typeof pp === "object" && !!pp.start && !!pp.end, JSON.stringify(pp ?? null));

// --- V2) purchasablePeriod の解除（null 送信） ---
const p2 = await patchItem(cred, MN, { purchasablePeriod: null });
check("V2 purchasablePeriod:null patch 受理", p2.ok, p2.ok ? `HTTP ${p2.status}` : p2.message);
await sleep(1500);
const g2 = await getItem(cred, MN);
note("V2 読み戻し purchasablePeriod", JSON.stringify(g2.json?.purchasablePeriod ?? null));
check("V2 null 送信で解除される", g2.json?.purchasablePeriod == null, JSON.stringify(g2.json?.purchasablePeriod ?? null));

// --- V3) referencePrice 設定 → null 解除 ---
const p3a = await patchItem(cred, MN, { variants: { [VID]: { referencePrice: { displayType: "REFERENCE_PRICE", type: 1, value: "3000" } } } });
check("V3 referencePrice 設定 patch 受理", p3a.ok, p3a.ok ? `HTTP ${p3a.status}` : p3a.message);
await sleep(1500);
const g3a = await getItem(cred, MN);
const ref3a = g3a.json?.variants?.[VID]?.referencePrice;
note("V3 読み戻し referencePrice(設定後)", JSON.stringify(ref3a ?? null));
check("V3 referencePrice が設定される", !!ref3a && String(ref3a.value ?? "") !== "", JSON.stringify(ref3a ?? null));

const p3b = await patchItem(cred, MN, { variants: { [VID]: { referencePrice: null } } });
check("V3 referencePrice:null patch 受理", p3b.ok, p3b.ok ? `HTTP ${p3b.status}` : p3b.message);
await sleep(1500);
const g3b = await getItem(cred, MN);
const ref3b = g3b.json?.variants?.[VID]?.referencePrice;
note("V3 読み戻し referencePrice(null送信後)", JSON.stringify(ref3b ?? null));
check("V3 null 送信で解除される", ref3b == null, JSON.stringify(ref3b ?? null));

// --- V4) getItem 生JSONを土台にした -SS コピー upsert（倉庫） ---
const g4 = await getItem(cred, MN);
const raw = g4.json;
// 読み取り専用/メタと推定されるキーを外し hideItem を強制（実機で通るキー集合を確定させる）
const copy = { ...raw };
for (const k of ["manageNumber", "created", "updated"]) delete copy[k];
copy.hideItem = true;
const upSS = await upsertItem(cred, SS, copy);
check("V4 -SS コピー upsert 受理", upSS.ok, upSS.ok ? `HTTP ${upSS.status} created=${upSS.created}` : upSS.message);
await sleep(1500);
const gSS = await getItem(cred, SS);
check("V4 -SS getItem 存在", gSS.exists, `status=${gSS.status}`);
check("V4 -SS 価格が元と同一", gSS.json?.variants?.[VID]?.standardPrice === raw?.variants?.[VID]?.standardPrice,
  `copy=${gSS.json?.variants?.[VID]?.standardPrice} orig=${raw?.variants?.[VID]?.standardPrice}`);
check("V4 -SS は倉庫(hideItem=true)", gSS.json?.hideItem === true, String(gSS.json?.hideItem));

// --- 後始末 ---
await sleep(800);
const delSS = await deleteItem(cred, SS);
check("後始末 -SS delete", delSS.ok, `status=${delSS.status}`);
const del = await deleteItem(cred, MN);
check("後始末 delete", del.ok, `status=${del.status}`);

console.log(fail === 0 ? "\n🎉 SS支援 実機検証 全パス（後始末完了）" : `\n⚠ ${fail}件失敗（上のログでフィールド仕様を確認）`);
process.exit(fail === 0 ? 0 : 1);
