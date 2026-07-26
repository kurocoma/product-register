// [追加作業D-検証] Yahoo の現物を読み戻して定期購入価格の欠落を点検する（既存57件＋今回登録分）。
//
// 期待値: アプリDBの yahoo_subscription_* をそのまま送った結果になっていること。
//   type=1 のとき SubscriptionPrice = 定期税抜 × 税率（切り捨て） / Group=1 / Cycle=2:1
//   例外4商品（r8801-0 / r8801-2 / r8801-3 / r135-10-1）は Type=0 のままが正。
// 結果は subscription-fix-results.json の yahooVerify へ追記する（DBは変更しない）。
// 実行: cd webui && npx tsx tests/shimanoya_yahoo_subscription_verify.mjs
import path from "node:path";
import { getItem as getYahooItem } from "../lib/yahoo/item-client.ts";
import { yahooTaxInclusive } from "../lib/converters/yahoo-tax.ts";
import {
  WORK_DIR, API_TIMEOUT_MS,
  ensureWorkDir, loadEnv, withTimeout, getAdmin, loadTargets,
  yahooAuth, writeAuthBlocked, readJson, writeJson, xmlTag, sleep, nowIso,
} from "./shimanoya_yahoo_sync_common.mjs";

loadEnv();
ensureWorkDir();

const RESULTS_FILE = path.join(WORK_DIR, "subscription-fix-results.json");
const NO_SUBSCRIPTION = new Set(["r8801-0", "r8801-2", "r8801-3", "r135-10-1"]);

const admin = getAdmin();
const { found } = await loadTargets(admin);

let cfg, token;
try {
  ({ cfg, token } = await yahooAuth());
} catch (e) {
  const msg = String(e?.message ?? e);
  writeAuthBlocked("subscription-verify", msg);
  console.error(`Yahoo認証に失敗しました。中止します。\n  ${msg}`);
  process.exit(2);
}

const checks = [];
for (const [manage, t] of found) {
  const p = t.input;
  const rec = { manage, itemCode: p.ne_code, timestamp: nowIso() };
  let got;
  try {
    got = await withTimeout(getYahooItem(token, cfg.sellerId, p.ne_code), API_TIMEOUT_MS, `getItem ${p.ne_code}`);
  } catch (e) {
    rec.verdict = "error";
    rec.error = String(e?.message ?? e);
    checks.push(rec);
    continue;
  }
  if (!got.exists) {
    rec.verdict = "not-listed";
    rec.reason = "Yahooに未出品";
    checks.push(rec);
    await sleep(120);
    continue;
  }
  rec.mall = {
    type: xmlTag(got.raw, "SubscriptionType") || "0",
    price: xmlTag(got.raw, "SubscriptionPrice") || "",
    group: xmlTag(got.raw, "SubscriptionGroupIndex") || "",
    cycle: xmlTag(got.raw, "SubscriptionRecommendedCycle") || "",
  };
  rec.db = { type: p.yahoo_subscription_type, priceExclusive: p.yahoo_subscription_price };

  if (NO_SUBSCRIPTION.has(manage)) {
    rec.verdict = rec.mall.type === "0" ? "ok-no-subscription" : "ng";
    if (rec.verdict === "ng") rec.error = `定期なしの例外商品だが Yahoo に定期設定が入っています（type=${rec.mall.type}）`;
  } else if (p.yahoo_subscription_type === 1) {
    const expected = String(yahooTaxInclusive(p.yahoo_subscription_price, p.tax_rate));
    rec.expected = { type: "1", price: expected, group: "1", cycle: "2:1" };
    const okType = rec.mall.type === "1";
    const okPrice = rec.mall.price === expected;
    const okGroup = rec.mall.group === "1";
    const okCycle = rec.mall.cycle === "2:1";
    rec.verdict = okType && okPrice && okGroup && okCycle ? "ok" : "ng";
    if (!okType) rec.error = `定期タイプ不一致（期待1 / 実際${rec.mall.type}）`;
    else if (!okPrice) rec.error = `定期価格不一致（期待${expected} / 実際${rec.mall.price || "(空)"}）`;
    else if (!okGroup) rec.error = `グループ管理番号不一致（期待1 / 実際${rec.mall.group || "(空)"}）`;
    else if (!okCycle) rec.error = `おすすめサイクル不一致（期待2:1 / 実際${rec.mall.cycle || "(空)"}）`;
  } else {
    rec.verdict = "pending-decision";
    rec.reason = "アプリDBに定期設定が無い（ルール外・要ユーザー判断の商品）";
  }
  checks.push(rec);
  console.log(`${manage}: ${rec.verdict}${rec.error ? " — " + rec.error : ""}`);
  await sleep(150);
}

const summary = {
  checkedAt: nowIso(),
  ok: checks.filter((c) => c.verdict === "ok").length,
  okNoSubscription: checks.filter((c) => c.verdict === "ok-no-subscription").length,
  ng: checks.filter((c) => c.verdict === "ng").length,
  pendingDecision: checks.filter((c) => c.verdict === "pending-decision").length,
  notListed: checks.filter((c) => c.verdict === "not-listed").length,
  error: checks.filter((c) => c.verdict === "error").length,
  checks,
};
const prev = readJson(RESULTS_FILE, {});
writeJson(RESULTS_FILE, { ...prev, yahooVerify: summary });
console.log(`\n定期購入の読み戻し検証: 一致 ${summary.ok} / 定期なし正常 ${summary.okNoSubscription} / 不一致 ${summary.ng} / 要判断 ${summary.pendingDecision} / 未出品 ${summary.notListed} / エラー ${summary.error}`);
for (const c of checks.filter((x) => x.verdict === "ng")) console.log(`  不一致 ${c.manage}: ${c.error}`);
console.log(`→ ${RESULTS_FILE}`);
