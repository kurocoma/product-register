// [追加作業B-1] Yahoo ストアカテゴリ「しまのや」を用意する（ユーザー裁定 2026-07-26）。
//
// 第1階層に「しまのや」が無ければ作成する（あれば作らない＝冪等）。
// フロント反映（reservePublish）は行わない — ストアカテゴリも「未反映」のまま残す。
// 実行: cd webui && npx tsx tests/shimanoya_yahoo_store_category.mjs   （DRY=1 で一覧表示のみ）
import path from "node:path";
import { listStCategories, ensureTopLevelStCategory } from "../lib/yahoo/st-category-client.ts";
import {
  WORK_DIR, API_TIMEOUT_MS,
  ensureWorkDir, loadEnv, withTimeout, yahooAuth, writeAuthBlocked, writeJson, nowIso,
} from "./shimanoya_yahoo_sync_common.mjs";

loadEnv();
ensureWorkDir();

const DRY = process.env.DRY === "1";
const NAME = process.env.CATEGORY_NAME || "しまのや";

let cfg, token;
try {
  ({ cfg, token } = await yahooAuth());
} catch (e) {
  const msg = String(e?.message ?? e);
  writeAuthBlocked("store-category", msg);
  console.error(`Yahoo認証に失敗しました。中止します。\n  ${msg}`);
  process.exit(2);
}

const list = await withTimeout(listStCategories(token, cfg.sellerId), API_TIMEOUT_MS, "stCategoryList");
if (!list.ok) {
  console.error(`ストアカテゴリ一覧の取得に失敗: ${list.message}`);
  writeJson(path.join(WORK_DIR, "store-category.json"), { ranAt: nowIso(), ok: false, error: list.message });
  process.exit(2);
}
console.log(`第1階層のストアカテゴリ ${list.categories.length}件:`);
for (const c of list.categories) console.log(`  ${c.pageKey}  ${c.name}  (display=${c.display})`);

const existing = list.categories.find((c) => c.name === NAME);
if (DRY) {
  console.log(`\nDRY-RUN: 「${NAME}」は ${existing ? `既に存在します（pageKey=${existing.pageKey}）` : "存在しないため新規作成が必要です"}`);
  writeJson(path.join(WORK_DIR, "store-category.dryrun.json"), { ranAt: nowIso(), name: NAME, exists: !!existing, existing, categories: list.categories });
  process.exit(0);
}

const r = await withTimeout(ensureTopLevelStCategory(token, cfg.sellerId, NAME), API_TIMEOUT_MS, "ensureTopLevelStCategory");
if (!r.ok) {
  console.error(`「${NAME}」の作成に失敗: ${r.message}`);
  writeJson(path.join(WORK_DIR, "store-category.json"), { ranAt: nowIso(), ok: false, name: NAME, error: r.message, categoriesBefore: list.categories });
  process.exit(2);
}
// 作成後の一覧で実在を確認する（読み戻し）
const after = await withTimeout(listStCategories(token, cfg.sellerId), API_TIMEOUT_MS, "stCategoryList(after)");
const verified = after.ok ? after.categories.find((c) => c.name === NAME) : null;
writeJson(path.join(WORK_DIR, "store-category.json"), {
  ranAt: nowIso(),
  ok: true,
  name: NAME,
  pageKey: r.pageKey,
  created: r.created,
  verified: !!verified,
  verifiedEntry: verified ?? null,
  reservePublish: "未実行（公開保留）",
  categoriesAfter: after.ok ? after.categories : [],
});
console.log(`\n${r.created ? "作成しました" : "既に存在しました"}: ${NAME}（pageKey=${r.pageKey}） / 読み戻し確認=${verified ? "OK" : "NG"}`);
console.log("reservePublish は実行していません（ストアカテゴリも未反映のままです）。");
