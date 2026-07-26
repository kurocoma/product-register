// [追加作業D] 定期購入価格の欠落を補完する（ユーザー指摘 2026-07-26）。
//
// 原因（調査結果）: 新規登録経路のバグではない。楽天→Yahoo の定期購入マッピングが存在せず、
//   アプリDBの yahoo_subscription_* が 66件中64件で未設定（type=0）のまま。
//   type=0 だと register/update いずれの経路も subscription_price を送らない（送るのが正しい挙動）。
//   → アプリDBへ値を入れれば既存経路がそのまま正しく送信する（コード修正は不要）。
//
// 恒久ルール（auto-memory shimanoya-update-rules #4）:
//   定期価格 = 各SKUの通常税抜価格 × 0.90 切り捨て（10%引き）。Yahoo へは税込（切り捨て）で送る。
//   例外4商品 r8801-0 / r8801-2 / r8801-3 / r135-10-1 は定期なし。
//
// 安全側の判定:
//   - 楽天に定期価格があり ×0.90 と一致 → ルールどおり設定する
//   - 楽天の定期価格がルールと違う（例 r117-1 は ×0.95）→ 設定せず報告（どちらを正とするか要判断）
//   - 楽天に定期価格が無い（例外4商品以外）→ 設定せず報告（楽天が定期未提供のため）
//
// 本スクリプトはアプリDBのみ更新する。Yahoo への送信は既存の反映経路
// （shimanoya_yahoo_sync_apply.mjs / register）に任せる（差分判定・ガード・履歴を通すため）。
// 実行: cd webui && npx tsx tests/shimanoya_yahoo_subscription_fix.mjs   （DRY=1 で保存せず一覧のみ）
import path from "node:path";
import { upsertProduct, dbRowToProductInput } from "../lib/product/repository.ts";
import {
  WORK_DIR, ensureWorkDir, loadEnv, getAdmin, loadTargets, writeJson, nowIso,
} from "./shimanoya_yahoo_sync_common.mjs";

loadEnv();
ensureWorkDir();

const DRY = process.env.DRY === "1";
// Yahoo 現物の読み戻し検証は shimanoya_yahoo_subscription_verify.mjs が担当する（本スクリプトはDB更新のみ）。
const RESULTS_FILE = path.join(WORK_DIR, DRY ? "subscription-fix.dryrun.json" : "subscription-fix-results.json");
const BACKUP_FILE = path.join(WORK_DIR, "backup", "subscription-fix-backup.json");

/** 定期購入を設定しない商品（ユーザー裁定）。 */
const NO_SUBSCRIPTION = new Set(["r8801-0", "r8801-2", "r8801-3", "r135-10-1"]);
/** Yahoo 定期購入の設定値（既に正しく入っている r7201-1 / r8901-1 と同一）。 */
const SUB_TYPE = 1;            // 1 = 通常購入 + 定期購入
const SUB_GROUP_INDEX = 1;     // 定期購入グループ管理番号
const SUB_CYCLE = "2:1";       // おすすめサイクル = 月数1（月1回）

/** ルール: 通常税抜 × 0.90 切り捨て。 */
const ruleSubscriptionPrice = (sellingPriceExclusive) => Math.floor(sellingPriceExclusive * 0.9);

const admin = getAdmin();
const { found } = await loadTargets(admin);

const backup = [];
const results = [];

for (const [manage, t] of found) {
  const p = t.input;
  const rec = { manage, itemCode: p.ne_code, productId: t.row.id, status: "skip", timestamp: nowIso() };
  const expected = ruleSubscriptionPrice(p.selling_price);
  rec.current = {
    yahooType: p.yahoo_subscription_type,
    yahooPriceExclusive: p.yahoo_subscription_price,
    rakutenBasePrice: p.subscription_base_price,
    sellingPriceExclusive: p.selling_price,
    taxRate: p.tax_rate,
  };
  rec.ruleExclusive = expected;

  if (NO_SUBSCRIPTION.has(manage)) {
    rec.reason = "定期購入なしの例外商品（ユーザー裁定）";
    results.push(rec);
    continue;
  }
  if (!p.subscription_base_price) {
    rec.reason = "楽天側に定期購入価格が無いため設定しません（楽天が定期未提供。要ユーザー判断）";
    rec.needsDecision = true;
    results.push(rec);
    continue;
  }
  if (p.subscription_base_price !== expected) {
    rec.reason = `楽天の定期価格(${p.subscription_base_price})がルール(通常税抜×0.90=${expected})と一致しないため設定しません（どちらを正とするか要判断）`;
    rec.needsDecision = true;
    results.push(rec);
    continue;
  }
  if (p.yahoo_subscription_type === SUB_TYPE && p.yahoo_subscription_price === expected
    && p.yahoo_subscription_group_index === SUB_GROUP_INDEX && p.yahoo_subscription_recommended_cycle === SUB_CYCLE) {
    rec.status = "ok";
    rec.reason = "既に正しい値が入っています（変更なし）";
    rec.unchanged = true;
    results.push(rec);
    continue;
  }

  rec.after = {
    yahoo_subscription_type: SUB_TYPE,
    yahoo_subscription_price: expected,
    yahoo_subscription_group_index: SUB_GROUP_INDEX,
    yahoo_subscription_recommended_cycle: SUB_CYCLE,
  };
  if (DRY) {
    rec.status = "skip";
    rec.reason = "DRY-RUN（保存せず）";
    results.push(rec);
    console.log(`${manage} dry-run: 定期税抜 ${p.yahoo_subscription_price} → ${expected}（通常税抜 ${p.selling_price}）`);
    continue;
  }

  try {
    const row = (await admin.from("products").select("*").eq("id", t.row.id).single()).data;
    backup.push({ manage, productId: t.row.id, savedAt: nowIso(), row });
    writeJson(BACKUP_FILE, backup); // 保存の直前に必ずバックアップを書き出す
    const current = dbRowToProductInput(row);
    const saved = await upsertProduct(admin, { ...current, ...rec.after }, t.row.id, { authenticatedUserId: t.row.user_id });
    const reread = dbRowToProductInput((await admin.from("products").select("*").eq("id", saved.id).single()).data);
    rec.verified = {
      type: reread.yahoo_subscription_type,
      priceExclusive: reread.yahoo_subscription_price,
      group: reread.yahoo_subscription_group_index,
      cycle: reread.yahoo_subscription_recommended_cycle,
    };
    rec.status = reread.yahoo_subscription_price === expected && reread.yahoo_subscription_type === SUB_TYPE ? "updated" : "ng";
    if (rec.status === "ng") rec.error = "保存後の再読込で値が一致しません";
    console.log(`${manage} ${rec.status === "updated" ? "設定OK" : "設定NG"}: 定期税抜 ${expected}（通常税抜 ${p.selling_price} / 税率 ${p.tax_rate}%）`);
  } catch (e) {
    rec.status = "ng";
    rec.error = String(e?.message ?? e);
    console.log(`${manage} 例外: ${String(e?.message ?? e).slice(0, 140)}`);
  }
  results.push(rec);
}

if (!DRY && backup.length) writeJson(BACKUP_FILE, backup);
const updated = results.filter((r) => r.status === "updated");
writeJson(RESULTS_FILE, {
  ranAt: nowIso(),
  rootCause: "楽天→Yahoo の定期購入マッピングが無く、アプリDBの yahoo_subscription_* が未設定だった（送信経路のバグではない）",
  rule: "定期価格 = 通常税抜 × 0.90 切り捨て / Yahoo へは税込（切り捨て）で送信。type=1・group=1・cycle=2:1（月1）",
  exceptions: [...NO_SUBSCRIPTION],
  nextStep: "アプリDB更新後、shimanoya_yahoo_sync_apply.mjs（既存の反映経路）で Yahoo へ送信する",
  total: results.length,
  updated: updated.length,
  unchanged: results.filter((r) => r.unchanged).length,
  needsDecision: results.filter((r) => r.needsDecision).length,
  exceptionCount: results.filter((r) => NO_SUBSCRIPTION.has(r.manage)).length,
  ng: results.filter((r) => r.status === "ng").length,
  results,
});
console.log(`\n定期価格の設定 完了: 更新 ${updated.length} / 変更なし ${results.filter((r) => r.unchanged).length} / 要判断 ${results.filter((r) => r.needsDecision).length} / 例外 ${results.filter((r) => NO_SUBSCRIPTION.has(r.manage)).length} / NG ${results.filter((r) => r.status === "ng").length}`);
for (const r of results.filter((x) => x.needsDecision)) console.log(`  要判断 ${r.manage}: ${r.reason}`);
console.log(`→ ${RESULTS_FILE}`);
