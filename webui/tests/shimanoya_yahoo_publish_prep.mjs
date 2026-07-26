// [公開準備] しまのや Yahoo 全66件の在庫を100に設定し、非公開(display=0)の商品を公開(display=1)にする。
//
// ユーザー承認（2026-07-27）: 「全部在庫100こで」＋公開の最終承認。
//   1. setStock quantity=100 を全件へ送信（送信前の在庫値を stock-backup.json へ退避）
//   2. display=0 の商品だけ editItem で display=1（送信前の値を display-backup.json へ退避）
// reservePublish は本スクリプトでは実行しない（別スクリプトで1回だけ実行する）。
// 変更は最小差分（getItem のラウンドトリップ＋display のみ上書き）。per-call 30s タイムアウト。
// 実行: cd webui && npx tsx tests/shimanoya_yahoo_publish_prep.mjs   （DRY=1 で送信せず現状確認）
import path from "node:path";
import { getItem as getYahooItem, editItem, setStock } from "../lib/yahoo/item-client.ts";
import { xmlToEditItemParams } from "../lib/converters/yahoo-patch.ts";
import { fitYahooFieldLimits } from "../lib/yahoo/item-mapper.ts";
import {
  TARGETS, WORK_DIR, API_TIMEOUT_MS, CHUNK_SIZE,
  ensureWorkDir, loadEnv, withTimeout, getAdmin, loadTargets,
  yahooAuth, writeAuthBlocked, chunk, writeJson, xmlTag, sleep, nowIso,
} from "./shimanoya_yahoo_sync_common.mjs";

loadEnv();
ensureWorkDir();

const DRY = process.env.DRY === "1";
const QUANTITY = Number(process.env.QUANTITY || 100);
const STOCK_FILE = path.join(WORK_DIR, DRY ? "stock-results.dryrun.json" : "stock-results.json");
const DISPLAY_FILE = path.join(WORK_DIR, DRY ? "display-results.dryrun.json" : "display-results.json");
const STOCK_BACKUP = path.join(WORK_DIR, "backup", "stock-backup.json");
const DISPLAY_BACKUP = path.join(WORK_DIR, "backup", "display-backup.json");

const admin = getAdmin();
const { found } = await loadTargets(admin);

let cfg, token;
try {
  ({ cfg, token } = await yahooAuth());
} catch (e) {
  const msg = String(e?.message ?? e);
  writeAuthBlocked("publish-prep", msg);
  console.error(`Yahoo認証に失敗しました。中止します。\n  ${msg}`);
  process.exit(2);
}

/** Yahoo が外部リンクを中継ページへ書き換えた形を元URLへ戻す（再送で二重に包まれるのを防ぐ）。 */
const unwrapBouncer = (s) => String(s ?? "").replace(
  /https:\/\/shopping\.yahoo\.co\.jp\/stores\/wrap\/bouncer\.html\?dest_path=([^"'\s>]+)/g,
  (_, u) => { try { return decodeURIComponent(u); } catch { return u; } },
);

// --- Phase 0: 全件の現在値を取得して退避（在庫・公開状態） ---
const snapshot = [];
for (const group of chunk(TARGETS, CHUNK_SIZE)) {
  for (const manage of group) {
    const t = found.get(manage);
    if (!t) {
      snapshot.push({ manage, itemCode: null, exists: false, reason: "アプリDBに該当商品がありません" });
      continue;
    }
    const itemCode = t.input.ne_code;
    try {
      const got = await withTimeout(getYahooItem(token, cfg.sellerId, itemCode), API_TIMEOUT_MS, `getItem ${itemCode}`);
      snapshot.push({
        manage, itemCode, exists: got.exists,
        quantity: got.exists ? xmlTag(got.raw, "Quantity") : null,
        display: got.exists ? xmlTag(got.raw, "Display") : null,
        raw: got.exists ? got.raw : null,
      });
    } catch (e) {
      snapshot.push({ manage, itemCode, exists: false, error: String(e?.message ?? e) });
    }
    await sleep(120);
  }
  console.log(`現在値取得 ${snapshot.length}/${TARGETS.length}`);
}
const live = snapshot.filter((s) => s.exists);
console.log(`Yahoo に存在: ${live.length}件 / 取得できず: ${snapshot.length - live.length}件`);

writeJson(STOCK_BACKUP, {
  savedAt: nowIso(),
  note: "在庫を100へ一括変更する前の Yahoo 現在値（Quantity）",
  items: snapshot.map((s) => ({ manage: s.manage, itemCode: s.itemCode, quantity: s.quantity ?? null, exists: s.exists })),
});
writeJson(DISPLAY_BACKUP, {
  savedAt: nowIso(),
  note: "公開状態を1へ変更する前の Yahoo 現在値（Display）",
  items: snapshot.map((s) => ({ manage: s.manage, itemCode: s.itemCode, display: s.display ?? null, exists: s.exists })),
});
console.log(`退避: ${STOCK_BACKUP} / ${DISPLAY_BACKUP}`);

// --- Phase 1: 在庫を一律 QUANTITY に設定 ---
const stockResults = [];
for (const s of snapshot) {
  const rec = { manage: s.manage, itemCode: s.itemCode, before: s.quantity ?? null, target: QUANTITY, status: "ng", timestamp: nowIso() };
  if (!s.exists) {
    rec.status = "skip";
    rec.reason = s.reason ?? s.error ?? "Yahooに商品がありません";
    stockResults.push(rec);
    continue;
  }
  if (DRY) {
    rec.status = "skip";
    rec.reason = "DRY-RUN（送信せず）";
    stockResults.push(rec);
    continue;
  }
  try {
    const r = await withTimeout(setStock(token, cfg.sellerId, s.itemCode, QUANTITY), API_TIMEOUT_MS, `setStock ${s.itemCode}`);
    rec.sent = true;
    if (!r.ok) {
      rec.status = "ng";
      rec.error = r.message;
    } else {
      rec.status = "ok";
    }
  } catch (e) {
    rec.error = String(e?.message ?? e);
  }
  stockResults.push(rec);
  console.log(`[在庫] ${s.manage}: ${rec.status}（${rec.before} → ${QUANTITY}）${rec.error ? " — " + rec.error : ""}`);
  await sleep(200);
}

// --- Phase 2: display=0 の商品を display=1 へ ---
const displayResults = [];
for (const s of snapshot) {
  const rec = { manage: s.manage, itemCode: s.itemCode, before: s.display ?? null, status: "ng", timestamp: nowIso() };
  if (!s.exists) {
    rec.status = "skip";
    rec.reason = s.reason ?? s.error ?? "Yahooに商品がありません";
    displayResults.push(rec);
    continue;
  }
  if (s.display === "1") {
    rec.status = "ok";
    rec.unchanged = true;
    rec.reason = "既に公開(display=1)";
    displayResults.push(rec);
    continue;
  }
  if (DRY) {
    rec.status = "skip";
    rec.reason = `DRY-RUN（display ${s.display} → 1 を送信せず）`;
    displayResults.push(rec);
    continue;
  }
  try {
    const { params } = xmlToEditItemParams(s.raw, cfg.sellerId);
    if (params.caption) params.caption = unwrapBouncer(params.caption);
    if (params.sp_additional) params.sp_additional = unwrapBouncer(params.sp_additional);
    params.display = "1";
    const body = fitYahooFieldLimits(params);
    const r = await withTimeout(editItem(token, body), API_TIMEOUT_MS, `editItem ${s.itemCode}`);
    if (!r.ok) {
      rec.status = "ng";
      rec.error = r.message;
      displayResults.push(rec);
      console.log(`[公開] ${s.manage}: NG — ${String(r.message).slice(0, 140)}`);
      continue;
    }
    await sleep(700);
    const back = await withTimeout(getYahooItem(token, cfg.sellerId, s.itemCode), API_TIMEOUT_MS, `getItem ${s.itemCode}`);
    rec.after = xmlTag(back.raw, "Display");
    rec.status = rec.after === "1" ? "ok" : "ng";
    if (rec.status === "ng") rec.error = `読み戻しで display が 1 になっていません（実際 ${rec.after || "(空)"}）`;
    console.log(`[公開] ${s.manage}: ${rec.status}（display ${rec.before} → ${rec.after}）`);
  } catch (e) {
    rec.error = String(e?.message ?? e);
    console.log(`[公開] ${s.manage}: 例外 — ${String(e?.message ?? e).slice(0, 140)}`);
  }
  displayResults.push(rec);
  await sleep(250);
}

// --- 在庫の読み戻し確認（setStock は editItem と別APIのため個別に確認） ---
if (!DRY) {
  for (const rec of stockResults.filter((r) => r.status === "ok")) {
    try {
      const back = await withTimeout(getYahooItem(token, cfg.sellerId, rec.itemCode), API_TIMEOUT_MS, `getItem ${rec.itemCode}`);
      rec.after = xmlTag(back.raw, "Quantity");
      if (String(rec.after) !== String(QUANTITY)) {
        rec.status = "ng";
        rec.error = `読み戻しで在庫が ${QUANTITY} になっていません（実際 ${rec.after || "(空)"}）`;
      }
    } catch (e) {
      rec.verifyError = String(e?.message ?? e);
    }
    await sleep(120);
  }
}

writeJson(STOCK_FILE, {
  ranAt: nowIso(), dryRun: DRY, quantity: QUANTITY,
  note: "ユーザー指示により全件一律100。r7501-1 の旧DB管理値による設定も上書き",
  ok: stockResults.filter((r) => r.status === "ok").length,
  ng: stockResults.filter((r) => r.status === "ng").length,
  skip: stockResults.filter((r) => r.status === "skip").length,
  results: stockResults,
});
writeJson(DISPLAY_FILE, {
  ranAt: nowIso(), dryRun: DRY,
  changed: displayResults.filter((r) => r.status === "ok" && !r.unchanged).length,
  alreadyPublic: displayResults.filter((r) => r.unchanged).length,
  ng: displayResults.filter((r) => r.status === "ng").length,
  skip: displayResults.filter((r) => r.status === "skip").length,
  results: displayResults,
});
console.log(`\n在庫: OK ${stockResults.filter((r) => r.status === "ok").length} / NG ${stockResults.filter((r) => r.status === "ng").length} / SKIP ${stockResults.filter((r) => r.status === "skip").length}`);
console.log(`公開状態: 変更 ${displayResults.filter((r) => r.status === "ok" && !r.unchanged).length} / 元から公開 ${displayResults.filter((r) => r.unchanged).length} / NG ${displayResults.filter((r) => r.status === "ng").length}`);
for (const r of [...stockResults, ...displayResults].filter((x) => x.status === "ng")) console.log(`  NG ${r.manage}: ${String(r.error).slice(0, 160)}`);
console.log(`→ ${STOCK_FILE} / ${DISPLAY_FILE}`);
