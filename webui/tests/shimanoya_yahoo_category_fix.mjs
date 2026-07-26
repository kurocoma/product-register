// [追加作業B-2] Yahoo カテゴリ未設定商品に product_category / path を設定する（ユーザー裁定 2026-07-26）。
//
// 裁定: ストアカテゴリは「しまのや」を使う（path）。Yahoo公式カテゴリ(leaf)は同族・類似商品から流用する。
// 実際の値は「Yahoo公式カテゴリ検索(getShopCategoryList)で完全一致が取れたもの」だけを採用し、
// 判断がつかない商品は設定せず候補を報告する（重複・誤カテゴリ登録を避けるため）。
//
// 変更前の行は backup/category-fix-backup.json へ退避してから upsertProduct で保存する。
// 実行: cd webui && npx tsx tests/shimanoya_yahoo_category_fix.mjs   （DRY=1 で保存せず内容確認）
import path from "node:path";
import { upsertProduct, dbRowToProductInput } from "../lib/product/repository.ts";
import {
  WORK_DIR, ensureWorkDir, loadEnv, getAdmin, loadTargets, writeJson, nowIso,
} from "./shimanoya_yahoo_sync_common.mjs";

loadEnv();
ensureWorkDir();

const DRY = process.env.DRY === "1";
const STORE_PATH = process.env.STORE_PATH || "しまのや";
const RESULTS_FILE = path.join(WORK_DIR, DRY ? "category-fix.dryrun.json" : "category-fix-results.json");
const BACKUP_FILE = path.join(WORK_DIR, "backup", "category-fix-backup.json");

/** 設定する値。null = 判断がつかないので設定せず候補だけ報告する。 */
const PLAN = [
  {
    manage: "r8801-0",
    categoryId: "42867",
    evidence: "getShopCategoryList('着圧ソックス') が完全一致1件: 42867 ダイエット、健康 > ダイエット > ダイエットウエア、サポーター > 着圧ソックス、靴下",
    note: "同族 r8801-2/-3 のDB値は 41383「沖縄のお酒」だが、着圧ソックスに対して明らかに誤りのため流用しない",
  },
  {
    // 2026-07-27 ユーザー裁定: 42751（衛生日用品＞除菌剤）を採用する。
    manage: "r9101-1",
    categoryId: "42751",
    evidence: "ユーザー裁定（2026-07-27）。候補3件のうち「ダイエット、健康 > 衛生日用品 > 除菌剤、抗菌剤」を採用",
    note: "マスク外側に吹き付ける除菌・消臭スプレーのため衛生日用品カテゴリを選択",
    candidatesConsidered: [
      { code: "42751", path: "ダイエット、健康 > 衛生日用品 > 除菌剤、抗菌剤", why: "マスクの除菌・衛生用途" },
      { code: "3988", path: "キッチン、日用品、文具 > 芳香剤、消臭剤、除湿剤 > その他芳香剤、消臭剤", why: "アロマ・消臭スプレー用途" },
      { code: "1763", path: "コスメ、美容、ヘアケア > スキンケア > 化粧水", why: "同店の月桃ミスト r6440-1 が採用（ただし本品は肌に使う化粧水ではない）" },
    ],
  },
];

const admin = getAdmin();
const { found } = await loadTargets(admin);

const backup = [];
const results = [];

for (const plan of PLAN) {
  const t = found.get(plan.manage);
  const rec = { manage: plan.manage, status: "ng", timestamp: nowIso() };
  if (!t) {
    rec.status = "skip";
    rec.reason = "アプリDBに該当商品がありません";
    results.push(rec);
    console.log(`${plan.manage} skip: アプリDBに該当なし`);
    continue;
  }
  const row = (await admin.from("products").select("*").eq("id", t.row.id).single()).data;
  const current = dbRowToProductInput(row);
  rec.productId = t.row.id;
  rec.before = { yahoo_category_id: current.yahoo_category_id, yahoo_path: current.yahoo_path };

  if (!plan.categoryId) {
    rec.status = "skip";
    rec.reason = plan.reason;
    rec.candidates = plan.candidates;
    results.push(rec);
    console.log(`${plan.manage} 設定せず（要ユーザー判断）: ${plan.reason}`);
    console.log(`   候補: ${plan.candidates.map((c) => `${c.code}=${c.path}`).join(" / ")}`);
    continue;
  }

  rec.after = { yahoo_category_id: plan.categoryId, yahoo_path: STORE_PATH };
  rec.evidence = plan.evidence;
  if (plan.note) rec.note = plan.note;

  if (DRY) {
    rec.status = "skip";
    rec.reason = "DRY-RUN（保存せず）";
    results.push(rec);
    console.log(`${plan.manage} dry-run: category "${rec.before.yahoo_category_id}"→"${plan.categoryId}" / path "${rec.before.yahoo_path}"→"${STORE_PATH}"`);
    continue;
  }

  backup.push({ manage: plan.manage, productId: t.row.id, savedAt: nowIso(), row });
  writeJson(BACKUP_FILE, backup); // 保存の直前に必ずバックアップを書き出す
  const saved = await upsertProduct(
    admin,
    { ...current, yahoo_category_id: plan.categoryId, yahoo_path: STORE_PATH },
    t.row.id,
    { authenticatedUserId: t.row.user_id },
  );
  const reread = dbRowToProductInput((await admin.from("products").select("*").eq("id", saved.id).single()).data);
  rec.status = reread.yahoo_category_id === plan.categoryId && reread.yahoo_path === STORE_PATH ? "ok" : "ng";
  rec.verified = { yahoo_category_id: reread.yahoo_category_id, yahoo_path: reread.yahoo_path };
  if (rec.status === "ng") rec.error = "保存後の再読込で値が一致しません";
  results.push(rec);
  console.log(`${plan.manage} ${rec.status === "ok" ? "設定OK" : "設定NG"}: category=${reread.yahoo_category_id} path="${reread.yahoo_path}"`);
}

if (!DRY && backup.length) writeJson(BACKUP_FILE, backup);
writeJson(RESULTS_FILE, {
  ranAt: nowIso(),
  storePath: STORE_PATH,
  ruling: "ストアカテゴリは「しまのや」（既存・pageKey a4b7a4dea4）。Yahoo公式カテゴリは検索で完全一致したものだけ採用",
  ok: results.filter((r) => r.status === "ok").length,
  skip: results.filter((r) => r.status === "skip").length,
  ng: results.filter((r) => r.status === "ng").length,
  results,
});
console.log(`\nカテゴリ設定 完了: OK ${results.filter((r) => r.status === "ok").length} / 見送り ${results.filter((r) => r.status === "skip").length} / NG ${results.filter((r) => r.status === "ng").length}`);
console.log(`→ ${RESULTS_FILE}`);
