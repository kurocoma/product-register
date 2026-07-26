// [最終ラウンド] しまのや Yahoo 残タスクのユーザー裁定分（2026-07-27）。
//
//   2. r8801-2 / r8801-3 の Yahooカテゴリを 41383（沖縄のお酒）→ 42867（着圧ソックス）へ修正（DB + Yahoo）
//   3. r1101-5 / r7201-5-mg5 の配送グループを 6 へ修正（Yahoo のみ。アプリは楽天値を保持）
//   4. r117-1 の定期購入を恒久ルール ×0.90 切り捨てで設定（DB + Yahoo）
//   5. r7201-2 / s071-1132-1 / s071-1149-1 は定期なしのまま（裁定の記録のみ・無変更）
//
// 変更方式: getItem の現在値をラウンドトリップし、該当パラメータだけ上書きして editItem（最小差分）。
// display は送らない/現状維持。reservePublish は呼ばない。per-call 30s タイムアウト。
// DB 変更は upsertProduct 経由（変更前行を backup/final-round-backup.json へ退避）。
// 実行: cd webui && npx tsx tests/shimanoya_yahoo_final_round.mjs   （DRY=1 で送信・保存せず内容確認）
import path from "node:path";
import { getItem as getYahooItem, editItem } from "../lib/yahoo/item-client.ts";
import { xmlToEditItemParams } from "../lib/converters/yahoo-patch.ts";
import { fitYahooFieldLimits } from "../lib/yahoo/item-mapper.ts";
import { yahooTaxInclusive } from "../lib/converters/yahoo-tax.ts";
import { upsertProduct, dbRowToProductInput } from "../lib/product/repository.ts";
import {
  WORK_DIR, API_TIMEOUT_MS,
  ensureWorkDir, loadEnv, withTimeout, getAdmin, loadTargets,
  yahooAuth, writeAuthBlocked, readJson, writeJson, xmlTag, sleep, nowIso,
} from "./shimanoya_yahoo_sync_common.mjs";

loadEnv();
ensureWorkDir();

const DRY = process.env.DRY === "1";
const RESULTS_FILE = path.join(WORK_DIR, DRY ? "final-round.dryrun.json" : "final-round-results.json");
const BACKUP_FILE = path.join(WORK_DIR, "backup", "final-round-backup.json");

/** 2. カテゴリ修正（DB + Yahoo）。 */
const CATEGORY_FIX = [
  { manage: "r8801-2", from: "41383", to: "42867" },
  { manage: "r8801-3", from: "41383", to: "42867" },
];
/** 3. 配送グループ修正（Yahoo のみ）。 */
const POSTAGE_FIX = [{ manage: "r1101-5" }, { manage: "r7201-5" }];
const POSTAGE_SET = "6";
/** 4. 定期購入をルールで設定（DB + Yahoo）。 */
const SUBSCRIPTION_FIX = [{ manage: "r117-1" }];
const SUB_TYPE = 1, SUB_GROUP = 1, SUB_CYCLE = "2:1";
/** 5. 定期なしのまま（無変更・記録のみ）。 */
const NO_SUBSCRIPTION_RULING = ["r7201-2", "s071-1132-1", "s071-1149-1"];

const admin = getAdmin();
const { found } = await loadTargets(admin);

let cfg, token;
try {
  ({ cfg, token } = await yahooAuth());
} catch (e) {
  const msg = String(e?.message ?? e);
  writeAuthBlocked("final-round", msg);
  console.error(`Yahoo認証に失敗しました。中止します。\n  ${msg}`);
  process.exit(2);
}

/** Yahoo が外部リンクを中継ページへ書き換えた形を元URLへ戻す（再送で二重に包まれるのを防ぐ）。 */
const unwrapBouncer = (s) => String(s ?? "").replace(
  /https:\/\/shopping\.yahoo\.co\.jp\/stores\/wrap\/bouncer\.html\?dest_path=([^"'\s>]+)/g,
  (_, u) => { try { return decodeURIComponent(u); } catch { return u; } },
);

const backup = [];
const results = [];

/** getItem → ラウンドトリップ → override 適用 → editItem → 読み戻し検証。 */
async function applyToYahoo(rec, itemCode, override, verifyTags) {
  const got = await withTimeout(getYahooItem(token, cfg.sellerId, itemCode), API_TIMEOUT_MS, `getItem ${itemCode}`);
  if (!got.exists) {
    rec.status = "ng";
    rec.error = "Yahooに該当商品がありません";
    return;
  }
  rec.mallBefore = Object.fromEntries(Object.entries(verifyTags).map(([k, tagName]) => [k, xmlTag(got.raw, tagName)]));
  const { params } = xmlToEditItemParams(got.raw, cfg.sellerId);
  if (params.caption) params.caption = unwrapBouncer(params.caption);
  if (params.sp_additional) params.sp_additional = unwrapBouncer(params.sp_additional);
  Object.assign(params, override);
  const body = fitYahooFieldLimits(params);
  rec.willSend = { ...override };
  if (DRY) {
    rec.status = "skip";
    rec.reason = "DRY-RUN（送信せず）";
    return;
  }
  const r = await withTimeout(editItem(token, body), API_TIMEOUT_MS, `editItem ${itemCode}`);
  if (!r.ok) {
    rec.status = "ng";
    rec.error = r.message;
    return;
  }
  if ((r.warnings ?? []).length) rec.warnings = r.warnings;
  await sleep(900);
  const back = await withTimeout(getYahooItem(token, cfg.sellerId, itemCode), API_TIMEOUT_MS, `getItem ${itemCode}`);
  rec.mallAfter = Object.fromEntries(Object.entries(verifyTags).map(([k, tagName]) => [k, xmlTag(back.raw, tagName)]));
  const mismatches = Object.entries(override)
    .filter(([k, v]) => verifyTags[k] !== undefined && String(rec.mallAfter[k]) !== String(v))
    .map(([k, v]) => `${k}: 期待 ${v} / 実際 ${rec.mallAfter[k] || "(空)"}`);
  rec.status = mismatches.length === 0 ? "ok" : "ng";
  if (mismatches.length) rec.error = `読み戻し不一致 — ${mismatches.join(" / ")}`;
}

/** DB を repository 経由で更新し、再読込で確認する。 */
async function applyToDb(rec, t, patch) {
  const row = (await admin.from("products").select("*").eq("id", t.row.id).single()).data;
  const current = dbRowToProductInput(row);
  rec.dbBefore = Object.fromEntries(Object.keys(patch).map((k) => [k, current[k]]));
  if (DRY) {
    rec.dbAfter = { ...patch, note: "DRY-RUN（保存せず）" };
    return current;
  }
  backup.push({ manage: rec.manage, productId: t.row.id, savedAt: nowIso(), row });
  writeJson(BACKUP_FILE, backup); // 保存の直前に必ずバックアップを書き出す
  const saved = await upsertProduct(admin, { ...current, ...patch }, t.row.id, { authenticatedUserId: t.row.user_id });
  const reread = dbRowToProductInput((await admin.from("products").select("*").eq("id", saved.id).single()).data);
  rec.dbAfter = Object.fromEntries(Object.keys(patch).map((k) => [k, reread[k]]));
  rec.dbOk = Object.entries(patch).every(([k, v]) => String(reread[k]) === String(v));
  return reread;
}

// ---- 2. カテゴリ修正（DB + Yahoo）----
for (const f of CATEGORY_FIX) {
  const t = found.get(f.manage);
  const rec = { task: "category", manage: f.manage, itemCode: t?.input.ne_code, status: "ng", timestamp: nowIso() };
  try {
    if (!t) throw new Error("アプリDBに該当商品がありません");
    await applyToDb(rec, t, { yahoo_category_id: f.to });
    await applyToYahoo(rec, t.input.ne_code, { product_category: f.to }, { product_category: "ProductCategory" });
  } catch (e) {
    rec.status = "ng";
    rec.error = String(e?.message ?? e);
  }
  results.push(rec);
  console.log(`[カテゴリ] ${f.manage}: ${rec.status}${rec.error ? " — " + rec.error : ` (${f.from}→${f.to})`}`);
}

// ---- 3. 配送グループ修正（Yahoo のみ）----
for (const f of POSTAGE_FIX) {
  const t = found.get(f.manage);
  const rec = { task: "postage", manage: f.manage, itemCode: t?.input.ne_code, status: "ng", timestamp: nowIso() };
  try {
    if (!t) throw new Error("アプリDBに該当商品がありません");
    await applyToYahoo(rec, t.input.ne_code, { postage_set: POSTAGE_SET }, { postage_set: "PostageSet" });
    rec.note = "アプリDBの delivery_method（楽天の配送方法セット番号）は変更していない";
  } catch (e) {
    rec.status = "ng";
    rec.error = String(e?.message ?? e);
  }
  results.push(rec);
  console.log(`[配送グループ] ${f.manage}: ${rec.status}${rec.error ? " — " + rec.error : ` (${rec.mallBefore?.postage_set}→${rec.mallAfter?.postage_set ?? POSTAGE_SET})`}`);
}

// ---- 4. 定期購入をルールで設定（DB + Yahoo）----
for (const f of SUBSCRIPTION_FIX) {
  const t = found.get(f.manage);
  const rec = { task: "subscription", manage: f.manage, itemCode: t?.input.ne_code, status: "ng", timestamp: nowIso() };
  try {
    if (!t) throw new Error("アプリDBに該当商品がありません");
    const exclusive = Math.floor(t.input.selling_price * 0.9);
    const inclusive = yahooTaxInclusive(exclusive, t.input.tax_rate);
    rec.rule = {
      sellingPriceExclusive: t.input.selling_price,
      subscriptionExclusive: exclusive,
      subscriptionInclusive: inclusive,
      taxRate: t.input.tax_rate,
      rakutenBasePrice: t.input.subscription_base_price,
    };
    await applyToDb(rec, t, {
      yahoo_subscription_type: SUB_TYPE,
      yahoo_subscription_price: exclusive,
      yahoo_subscription_group_index: SUB_GROUP,
      yahoo_subscription_recommended_cycle: SUB_CYCLE,
    });
    await applyToYahoo(rec, t.input.ne_code, {
      subscription_type: String(SUB_TYPE),
      subscription_price: String(inclusive),
      subscription_group_index: String(SUB_GROUP),
      subscription_recommended_cycle: SUB_CYCLE,
    }, {
      subscription_type: "SubscriptionType",
      subscription_price: "SubscriptionPrice",
      subscription_group_index: "SubscriptionGroupIndex",
      subscription_recommended_cycle: "SubscriptionRecommendedCycle",
    });
    rec.rakutenFollowUp = `楽天側は ×0.95（${t.input.subscription_base_price}円）のまま。楽天も ×0.90（${exclusive}円）へ要修正（ユーザー対応）`;
  } catch (e) {
    rec.status = "ng";
    rec.error = String(e?.message ?? e);
  }
  results.push(rec);
  console.log(`[定期購入] ${f.manage}: ${rec.status}${rec.error ? " — " + rec.error : ` (税抜${rec.rule?.subscriptionExclusive} / 税込${rec.rule?.subscriptionInclusive})`}`);
}

// ---- 5. 定期なしのまま（無変更・裁定の記録）----
for (const manage of NO_SUBSCRIPTION_RULING) {
  const t = found.get(manage);
  results.push({
    task: "no-subscription-ruling",
    manage,
    itemCode: t?.input.ne_code ?? null,
    status: "ok",
    unchanged: true,
    ruling: "定期購入は設定しない（2026-07-27 ユーザー裁定）。楽天側にも定期購入が無いため現状維持",
    timestamp: nowIso(),
  });
  console.log(`[定期なし裁定] ${manage}: 無変更（記録のみ）`);
}

if (!DRY && backup.length) writeJson(BACKUP_FILE, backup);
// r9101-1 の登録結果（別スクリプト実行分）も取り込んで一覧にする
const reg = readJson(path.join(WORK_DIR, "register-results.json"));
const r9101 = (reg?.results ?? []).find((r) => r.manage === "r9101-1");
if (r9101) {
  results.unshift({
    task: "register",
    manage: "r9101-1",
    itemCode: r9101.itemCode,
    status: r9101.status === "registered" ? "ok" : "ng",
    detail: r9101.status === "registered"
      ? `display=${r9101.verify?.display}（非公開） / 価格 ${r9101.verify?.price} / 配送グループ ${r9101.postageSet?.sent ?? "-"}`
      : (r9101.reason ?? r9101.error),
    source: "shimanoya_yahoo_register_missing.mjs",
    timestamp: nowIso(),
  });
}

writeJson(RESULTS_FILE, {
  ranAt: nowIso(),
  dryRun: DRY,
  reservePublish: "未実行（公開保留）",
  display: "新規登録は display=0 / 既存商品は display を送らず現状維持",
  ruling: "2026-07-27 ユーザー裁定（r9101-1登録 / r8801-2,-3カテゴリ修正 / r1101-5,r7201-5配送グループ6 / r117-1定期×0.90 / 3商品は定期なし）",
  ok: results.filter((r) => r.status === "ok").length,
  ng: results.filter((r) => r.status === "ng").length,
  skip: results.filter((r) => r.status === "skip").length,
  results,
});
console.log(`\n最終ラウンド 完了: OK ${results.filter((r) => r.status === "ok").length} / NG ${results.filter((r) => r.status === "ng").length} / SKIP ${results.filter((r) => r.status === "skip").length}`);
for (const r of results.filter((x) => x.status === "ng")) console.log(`  NG ${r.manage} [${r.task}]: ${String(r.error).slice(0, 160)}`);
console.log(`→ ${RESULTS_FILE}`);
