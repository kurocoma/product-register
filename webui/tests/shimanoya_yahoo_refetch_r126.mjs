// [追加作業C] r126-1 を楽天から再取込し、税率10%を起点に Yahoo を更新する（ユーザーが楽天側を修正済み）。
//
// 手順: 変更前の行を退避 → /api/fetch/rakuten（修正済みパーサで再取込） → DB の tax_rate/価格を確認
//       → /api/update/yahoo（差分があれば editItem） → getItem で読み戻し、DB起点の期待値と突き合わせ。
// reservePublish は呼ばない。per-call タイムアウトあり。
// 実行: cd webui && npx tsx tests/shimanoya_yahoo_refetch_r126.mjs   （DRY=1 で取込・送信せず現状確認）
import path from "node:path";
import { getItem as getYahooItem } from "../lib/yahoo/item-client.ts";
import { dbRowToProductInput } from "../lib/product/repository.ts";
import { yahooTaxInclusive } from "../lib/converters/yahoo-tax.ts";
import { displayPrice } from "../lib/product/schema.ts";
import {
  WORK_DIR, API_TIMEOUT_MS, BASE,
  ensureWorkDir, loadEnv, fetchWithTimeout, withTimeout, getAdmin, loadTargets, makeCookieFactory,
  yahooAuth, writeAuthBlocked, writeJson, xmlTag, sleep, nowIso,
} from "./shimanoya_yahoo_sync_common.mjs";

loadEnv();
ensureWorkDir();

const ROUTE_TIMEOUT_MS = API_TIMEOUT_MS * 2;
const DRY = process.env.DRY === "1";
const MANAGE = process.env.ONLY || "r126-1";
const RESULTS_FILE = path.join(WORK_DIR, DRY ? "refetch-r126.dryrun.json" : "refetch-r126-results.json");
const BACKUP_FILE = path.join(WORK_DIR, "backup", "refetch-r126-backup.json");

const admin = getAdmin();
const { found } = await loadTargets(admin);
const cookieFor = await makeCookieFactory(admin);
const t = found.get(MANAGE);
if (!t) {
  console.error(`アプリDBに ${MANAGE} がありません`);
  process.exit(2);
}

let cfg, token;
try {
  ({ cfg, token } = await yahooAuth());
} catch (e) {
  const msg = String(e?.message ?? e);
  writeAuthBlocked("refetch-r126", msg);
  console.error(`Yahoo認証に失敗しました。中止します。\n  ${msg}`);
  process.exit(2);
}

const rec = { manage: MANAGE, itemCode: t.input.ne_code, productId: t.row.id, timestamp: nowIso() };
const rowBefore = (await admin.from("products").select("*").eq("id", t.row.id).single()).data;
const before = dbRowToProductInput(rowBefore);
rec.before = { taxRate: before.tax_rate, sellingPriceExclusive: before.selling_price, displayPrice: before.display_price };
console.log(`${MANAGE} 取込前DB: 税率 ${before.tax_rate}% / 税抜 ${before.selling_price}`);

const gotBefore = await withTimeout(getYahooItem(token, cfg.sellerId, t.input.ne_code), API_TIMEOUT_MS, "getItem(before)");
rec.mallBefore = {
  price: xmlTag(gotBefore.raw, "Price"),
  originalPrice: xmlTag(gotBefore.raw, "OriginalPrice"),
  taxrateType: xmlTag(gotBefore.raw, "TaxrateType"),
};
console.log(`  Yahoo現在値: 価格 ${rec.mallBefore.price} / 税率区分 ${rec.mallBefore.taxrateType}`);

if (DRY) {
  rec.status = "skip";
  rec.reason = "DRY-RUN（再取込・送信なし）";
  writeJson(RESULTS_FILE, { ranAt: nowIso(), dryRun: true, result: rec });
  console.log("DRY-RUN のため再取込・送信は行いませんでした。");
  process.exit(0);
}

// --- 1) 変更前の行を退避してから再取込 ---
writeJson(BACKUP_FILE, [{ manage: MANAGE, productId: t.row.id, savedAt: nowIso(), row: rowBefore }]);
const cookie = await cookieFor(t.row.user_id);
try {
  const fr = await fetchWithTimeout(`${BASE}/api/fetch/rakuten/${t.row.id}`, {
    method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: "{}",
  }, ROUTE_TIMEOUT_MS, "fetch rakuten");
  const fj = await fr.json();
  rec.rakutenFetch = { ok: fr.ok && fj.ok, imported: fj.imported ?? [], error: fj.error };
} catch (e) {
  rec.rakutenFetch = { ok: false, error: String(e?.message ?? e) };
}
if (!rec.rakutenFetch.ok) {
  rec.status = "ng";
  rec.error = `楽天の再取込に失敗: ${rec.rakutenFetch.error}`;
  writeJson(RESULTS_FILE, { ranAt: nowIso(), result: rec });
  console.error(rec.error);
  process.exit(2);
}

const after = dbRowToProductInput((await admin.from("products").select("*").eq("id", t.row.id).single()).data);
rec.after = { taxRate: after.tax_rate, sellingPriceExclusive: after.selling_price, displayPrice: after.display_price };
rec.taxRateFixed = after.tax_rate === 10;
console.log(`${MANAGE} 取込後DB: 税率 ${after.tax_rate}% / 税抜 ${after.selling_price}（税率10%になったか: ${rec.taxRateFixed ? "はい" : "いいえ"}）`);

// --- 2) Yahoo へ反映（差分がある場合のみ editItem。submit は送らない＝reservePublish なし）---
const pr = await fetchWithTimeout(`${BASE}/api/update/yahoo/${t.row.id}`, { headers: { Cookie: cookie } }, ROUTE_TIMEOUT_MS, "update GET");
const pj = await pr.json();
rec.preview = pj.ok
  ? { hasChanges: pj.hasChanges, changedFields: (pj.changedFields ?? []).map((c) => c.field), willSendPrice: pj.willSend?.price, willSendTaxrate: pj.willSend?.taxrate_type }
  : { error: pj.error ?? `HTTP ${pr.status}` };
if (!pj.ok) {
  rec.status = "ng";
  rec.error = `反映プレビューNG: ${rec.preview.error}`;
} else if (!pj.hasChanges) {
  rec.status = "ok";
  rec.noChange = true;
  console.log("差分なし（Yahoo は既に期待値と一致）");
} else {
  const po = await fetchWithTimeout(`${BASE}/api/update/yahoo/${t.row.id}`, {
    method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: "{}",
  }, ROUTE_TIMEOUT_MS, "update POST");
  const oj = await po.json();
  rec.apply = { ok: po.ok && oj.ok, changedFields: oj.changedFields ?? [], error: oj.error };
  rec.status = rec.apply.ok ? "ok" : "ng";
  if (!rec.apply.ok) rec.error = `反映NG: ${oj.error ?? `HTTP ${po.status}`}`;
  console.log(rec.apply.ok ? `反映OK（${rec.apply.changedFields.length}項目）` : rec.error);
}

// --- 3) 読み戻して DB 起点の期待値と突き合わせ ---
await sleep(1000);
const gotAfter = await withTimeout(getYahooItem(token, cfg.sellerId, after.ne_code), API_TIMEOUT_MS, "getItem(after)");
const expectedInclusive = yahooTaxInclusive(after.selling_price, after.tax_rate);
const expectedOriginal = yahooTaxInclusive(displayPrice(after), after.tax_rate);
rec.mallAfter = {
  price: xmlTag(gotAfter.raw, "Price"),
  originalPrice: xmlTag(gotAfter.raw, "OriginalPrice"),
  taxrateType: xmlTag(gotAfter.raw, "TaxrateType"),
};
rec.expected = { price: String(expectedInclusive), originalPrice: String(expectedOriginal), taxrateType: String(after.tax_rate / 100) };
rec.match = {
  price: rec.mallAfter.price === rec.expected.price,
  originalPrice: rec.mallAfter.originalPrice === rec.expected.originalPrice,
  taxrateType: rec.mallAfter.taxrateType === rec.expected.taxrateType,
};
const allMatch = Object.values(rec.match).every(Boolean);
if (rec.status === "ok" && !allMatch) {
  rec.status = "ng";
  rec.error = `読み戻しが期待値と一致しません（価格 期待${rec.expected.price}/実際${rec.mallAfter.price}・税率区分 期待${rec.expected.taxrateType}/実際${rec.mallAfter.taxrateType}）`;
}
writeJson(RESULTS_FILE, {
  ranAt: nowIso(),
  reservePublish: "未実行（公開保留）",
  note: "楽天側の税率修正をユーザーが実施済みという前提で再取込した",
  result: rec,
});
console.log(`\n読み戻し: 価格 ${rec.mallAfter.price}（期待 ${rec.expected.price}）/ 税率区分 ${rec.mallAfter.taxrateType}（期待 ${rec.expected.taxrateType}）→ ${allMatch ? "一致" : "不一致"}`);
console.log(`→ ${RESULTS_FILE}`);
