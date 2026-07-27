// 楽天スーパーセール支援 サービス層の実機E2E（zzz テスト商品のみ・全件後始末）。
//   セール適用: buildApplyPlans（プレビュー・hash安定）→ executeApply（-SSコピー→patch→読み戻し検証）
//   復元:      buildRestorePlans → executeRestore（書き戻し→検証→-SS削除）
// アプリDB・履歴はこのE2Eの対象外（unit テストと route で担保）のため stub を注入する。
// 実行: cd webui && npx tsx tests/sale_support_e2e_service.mjs
import { readFileSync } from "node:fs";
import { getRakutenCredentialsFromEnv } from "../lib/rakuten/credentials.ts";
import { getItem, upsertItem, deleteItem } from "../lib/rakuten/item-client.ts";
import {
  buildApplyPlans,
  executeApply,
  buildRestorePlans,
  executeRestore,
} from "../lib/sale-support/service.ts";
import { makeRakutenRmsDeps } from "../lib/sale-support/rms-deps.ts";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const l of env.split("\n")) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); }
const cred = getRakutenCredentialsFromEnv();
if (!cred) { console.error("楽天 ESA 認証情報が未設定です"); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (l, c, d) => { if (!c) fail++; console.log(`${c ? "✅" : "❌"} ${l}${d ? "  " + d : ""}`); };

const MN = "zzz-ss-9991";
const SS = `${MN}-SS`;
const VID = "zzz-ssv-1";
const PERIOD = { start: "2026-08-01T10:00:00+09:00", end: "2026-08-05T09:59:59+09:00" };
const OPTS = { discountBp: 2000, period: PERIOD, dualPrice: true, delayMs: 400 };

/** 実RMS（route と同じ QPSペーシング＋タイムアウト付き）＋stub DB の deps。 */
const deps = {
  ...makeRakutenRmsDeps(cred),
  saveSsCopy: async () => ({ ok: true }),
  findProductId: async () => null,
  deleteSsRow: async () => ({ ok: true }),
  recordHistory: async () => {},
};

// --- 0) 初期 upsert（税抜2000円・税8%・税別・倉庫） ---
const up = await upsertItem(cred, MN, {
  title: "SS支援E2E検証商品", itemType: "NORMAL", genreId: "553575", hideItem: true,
  payment: { taxIncluded: false, taxRate: "0.08" },
  productDescription: { pc: "<p>SS-E2E</p>" },
  variants: { [VID]: { standardPrice: "2000", articleNumber: { value: "4955028002542" }, shipping: { postageIncluded: true },
    attributes: [{ name: "メーカー型番", values: ["X"] }, { name: "タイトル", values: ["Y"] }, { name: "発売元", values: ["Z"] }] } },
});
check("初期 upsert（税別・8%指定）", up.ok, up.ok ? `HTTP ${up.status}` : up.message);
await sleep(1500);
const g0 = await getItem(cred, MN);
check("初期 payment=税別8%", g0.json?.payment?.taxIncluded === false && g0.json?.payment?.taxRate === "0.08", JSON.stringify(g0.json?.payment));

// --- 1) プレビュー（buildApplyPlans）: 20%引き・二重価格ON ---
const pv1 = await buildApplyPlans(deps, [MN], OPTS);
const plan = pv1.plans[0];
check("プレビュー status=plan", plan.status === "plan", plan.reason ?? "");
const sku = plan.skus?.[0];
// 2000(税抜) → 税込2160 → 20%引き目標1728 → 登録税抜1600・税込1728
check("計算: 2000→afterNet 1600", sku?.beforeNet === 2000 && sku?.afterNet === 1600 && sku?.afterGross === 1728,
  JSON.stringify({ beforeNet: sku?.beforeNet, afterNet: sku?.afterNet, afterGross: sku?.afterGross }));
const pv2 = await buildApplyPlans(deps, [MN], OPTS);
check("hash 安定（同一値で一致）", pv1.payloadHash === pv2.payloadHash, "");

// --- 2) 実行（executeApply）: -SSコピー → patch → 読み戻し検証 ---
const results = await executeApply(deps, pv2.plans, OPTS);
check("実行 status=ok（読み戻し一致）", results[0].status === "ok" && results[0].verified === true,
  results[0].error ?? JSON.stringify(results[0].warnings));
await sleep(1500);
const gA = await getItem(cred, MN);
check("元商品: 価格1600・二重価格2000・期間設定",
  gA.json?.variants?.[VID]?.standardPrice === "1600" &&
  gA.json?.variants?.[VID]?.referencePrice?.value === "2000" &&
  gA.json?.purchasablePeriod?.start === PERIOD.start,
  JSON.stringify({ p: gA.json?.variants?.[VID]?.standardPrice, ref: gA.json?.variants?.[VID]?.referencePrice, pp: gA.json?.purchasablePeriod }));
const gS = await getItem(cred, SS);
check("-SS コピー: 倉庫・元価格2000", gS.exists && gS.json?.hideItem === true && gS.json?.variants?.[VID]?.standardPrice === "2000",
  JSON.stringify({ exists: gS.exists, hide: gS.json?.hideItem, p: gS.json?.variants?.[VID]?.standardPrice }));

// --- 3) 重複ガード: もう一度プレビューすると excluded ---
const pv3 = await buildApplyPlans(deps, [MN], OPTS);
check("再プレビューは excluded（-SS 既存・上書きしない）", pv3.plans[0].status === "excluded", pv3.plans[0].reason ?? "");

// --- 4) 復元（buildRestorePlans → executeRestore、-SS削除まで） ---
const rp = await buildRestorePlans(deps, [SS], { delayMs: 400 });
check("復元プレビュー status=plan", rp.plans[0].status === "plan", rp.plans[0].reason ?? "");
check("復元プレビュー: 1600→2000・二重価格解除・期間解除",
  rp.plans[0].skus?.[0]?.currentNet === 1600 && rp.plans[0].skus?.[0]?.restoreNet === 2000 &&
  rp.plans[0].skus?.[0]?.referenceCleared === true && rp.plans[0].periodCleared === true,
  JSON.stringify(rp.plans[0].skus?.[0]));
const rr = await executeRestore(deps, rp.plans, { deleteCopy: true, delayMs: 400 });
check("復元実行 status=ok（読み戻し一致）", rr[0].status === "ok" && rr[0].verified === true, rr[0].error ?? JSON.stringify(rr[0].warnings));
await sleep(1500);
const gB = await getItem(cred, MN);
check("元商品: 価格2000へ復元・二重価格解除・期間解除",
  gB.json?.variants?.[VID]?.standardPrice === "2000" &&
  gB.json?.variants?.[VID]?.referencePrice == null &&
  gB.json?.purchasablePeriod == null,
  JSON.stringify({ p: gB.json?.variants?.[VID]?.standardPrice, ref: gB.json?.variants?.[VID]?.referencePrice ?? null, pp: gB.json?.purchasablePeriod ?? null }));
const gS2 = await getItem(cred, SS);
check("-SS コピーは削除済み", !gS2.exists, `status=${gS2.status}`);

// --- 後始末 ---
await sleep(800);
const del = await deleteItem(cred, MN);
check("後始末 delete", del.ok, `status=${del.status}`);
if (gS2.exists) { await deleteItem(cred, SS); }

console.log(fail === 0 ? "\n🎉 SS支援 サービス層 実機E2E 全パス（後始末完了）" : `\n⚠ ${fail}件失敗`);
process.exit(fail === 0 ? 0 : 1);
