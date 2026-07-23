// しまのや第2ステージ: 楽天RMS「現在値」の読み取り取込 + 変更前バックアップ（read-before-write）。
// 権限境界: 楽天は getItem（読み取り）のみ。DBは SELECT のみ。書き込みAPIは一切呼ばない。
// 出力先は .codex-work/shimanoya-app-update/ 配下（機密・コミット禁止）。秘密情報・全文はログに出さない。
// 実行: cd webui && npx tsx tests/shimanoya_readonly_snapshot.mjs
//   REUSE_RAW=1 を付けると再取得せず rakuten-live/raw の保存済みJSONから再計算する（本番への再アクセス回避）。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import iconv from "../node_modules/iconv-lite/lib/index.js";
import Papa from "../node_modules/papaparse/papaparse.js";
import { getRakutenCredentialsFromEnv } from "../lib/rakuten/credentials.ts";
import { getItem } from "../lib/rakuten/item-client.ts";
import { parseRakutenItem, parseRakutenVariants } from "../lib/converters/rakuten-item-parser.ts";

const REUSE = process.env.REUSE_RAW === "1";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); }
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;

const root = path.resolve(import.meta.dirname, "..", "..");
const outDir = path.join(root, ".codex-work", "shimanoya-app-update");
const liveDir = path.join(outDir, "rakuten-live");
const rawDir = path.join(liveDir, "raw");
const backupDir = path.join(outDir, "backup");
for (const d of [liveDir, rawDir, backupDir]) mkdirSync(d, { recursive: true });
for (const d of [liveDir, backupDir]) writeFileSync(path.join(d, ".gitignore"), "*\n", "utf8");

const norm = (v) => String(v ?? "").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const csvPaths = {
  full: "C:/Users/hppym/株式会社しまのや/くりまポータル - ドキュメント/商品登録用データ/楽天/ritem/download/dl-normal-item_20260720232336-1.csv",
};

// --- 監査 inspect から対象・CSV基準値（現通常税抜=CSVの現行SKU税抜）を読む ---
const inspectPath = path.join(root, "outputs", "shimanoya-rakuten-audit-tax-exclusive-20260721", "しまのや楽天商品_修正候補監査_税抜再計算.xlsx.inspect.ndjson");
const lines = readFileSync(inspectPath, "utf8").split(/\r?\n/).filter(Boolean);
const skuTable = lines.map((l) => JSON.parse(l)).find((e) => e.kind === "table" && e.sheet === "SKU監査");
const [h, ...rows] = skuTable.values;
const I = Object.fromEntries(h.map((name, i) => [name, i]));
const skuBase = rows.map((r) => ({
  target: norm(r[I["商品管理番号"]]),
  sku: norm(r[I["SKU管理番号"]]),
  currentNet: norm(r[I["現通常税抜"]]).replace(/,/g, ""),   // 現行の楽天SKU税抜（CSV由来）
})).filter((s) => s.target);
const targets = [...new Set(skuBase.map((s) => s.target))].sort();
const skuByTarget = new Map(targets.map((t) => [t, skuBase.filter((s) => s.target === t)]));

// --- タイトルの基準値は RMS CSV(7/20) の 商品名 ---
const csvText = iconv.decode(readFileSync(csvPaths.full), "cp932");
const csvMatrix = Papa.parse(csvText, { skipEmptyLines: "greedy" }).data;
const cH = csvMatrix[0];
const cMN = cH.indexOf("商品管理番号（商品URL）");
const cName = cH.indexOf("商品名");
const csvNameByTarget = new Map();
for (let i = 1; i < csvMatrix.length; i++) {
  const mn = norm(csvMatrix[i][cMN]); const nm = norm(csvMatrix[i][cName]);
  if (mn && nm && !csvNameByTarget.has(mn)) csvNameByTarget.set(mn, nm);
}

const cred = getRakutenCredentialsFromEnv();
if (!cred && !REUSE) { console.error("NO_RAKUTEN_CREDENTIALS"); process.exit(2); }

// --- 楽天 read-only fetch（REUSE時は保存済みrawを読む） ---
let fetchedAt = new Date().toISOString();
if (REUSE && existsSync(path.join(liveDir, "snapshot.json"))) {
  try { fetchedAt = JSON.parse(readFileSync(path.join(liveDir, "snapshot.json"), "utf8")).fetchedAt || fetchedAt; } catch { /* keep */ }
}
const httpCounts = { ok: 0, notFound: 0, other: 0, reused: 0 };
const liveSnapshot = [];
const priceDrift = [];
const titleDrift = [];
const missingSkuOnRakuten = [];
const rakutenCsvRows = [];

const t0 = Date.now();
for (const target of targets) {
  const rawPath = path.join(rawDir, `${target}.json`);
  let json = null; let status = 0;
  if (REUSE) {
    if (existsSync(rawPath)) { json = JSON.parse(readFileSync(rawPath, "utf8")); status = 200; httpCounts.reused++; }
    else { status = 404; }
  } else {
    let got;
    try { got = await getItem(cred, target); }
    catch (e) { got = { status: -1, json: null, raw: String(e && e.message || e).slice(0, 120) }; }
    status = got.status;
    if (status === 200) httpCounts.ok++;
    else if (status === 404) httpCounts.notFound++;
    else httpCounts.other++;
    if (got.json) { json = got.json; writeFileSync(rawPath, JSON.stringify(json), "utf8"); }
    await sleep(120);
  }

  const rec = { target, status, title: "", skuCount: 0, skus: [] };
  const targetSkus = skuByTarget.get(target) ?? [];
  if (json) {
    const item = parseRakutenItem(json);
    const variants = parseRakutenVariants(json);
    const liveTitle = norm(item.display_name);
    rec.title = liveTitle;
    rec.skuCount = variants.length;
    const csvName = csvNameByTarget.get(target) ?? "";
    if (csvName && liveTitle && liveTitle !== csvName) titleDrift.push({ target, before: csvName, after: liveTitle });

    const liveById = new Map(variants.map((v) => [norm(v.sku_manage_number), v]));
    for (const v of variants) {
      const sku = norm(v.sku_manage_number);
      rec.skus.push({
        sku, ne: norm(v.ne_code), priceNet: v.selling_price ?? 0, sub: v.subscription_base_price ?? 0,
        janPresent: !!norm(v.jan_code),
        attrNames: (v.attributes ?? []).map((a) => norm(a.item)).filter(Boolean),
        specLabels: (v.specs ?? []).map((s) => norm(s.label)).filter(Boolean),
      });
    }
    // このtargetが受け持つ監査SKUだけを突き合わせる（共有ページの兄弟SKUは無視）
    for (const s of targetSkus) {
      const v = liveById.get(s.sku) ?? (variants.length === 1 ? variants[0] : null);
      if (!v) { missingSkuOnRakuten.push({ target, sku: s.sku }); continue; }
      const liveNet = v.selling_price ?? 0;
      rakutenCsvRows.push({
        商品管理番号: target, SKU管理番号: s.sku, NEコード: norm(v.ne_code),
        商品名: liveTitle, 現行税抜: liveNet, 定期税抜: v.subscription_base_price ?? 0,
        JAN: norm(v.jan_code), 選択肢: norm(v.variation_value),
        属性名: (v.attributes ?? []).map((a) => norm(a.item)).join(" | "),
        自由入力行項目: (v.specs ?? []).map((x) => norm(x.label)).join(" | "),
        取得時刻: fetchedAt,
      });
      if (s.currentNet !== "") {
        const baseNet = Number(s.currentNet);
        if (Number.isFinite(baseNet) && baseNet !== liveNet) priceDrift.push({ target, sku: s.sku, before: baseNet, after: liveNet });
      }
    }
  } else {
    for (const s of targetSkus) missingSkuOnRakuten.push({ target, sku: s.sku });
  }
  liveSnapshot.push(rec);
}
const fetchMs = Date.now() - t0;

writeFileSync(path.join(backupDir, "rakuten-current-values.csv"), "﻿" + Papa.unparse(rakutenCsvRows), "utf8");
writeFileSync(path.join(liveDir, "snapshot.json"), JSON.stringify({ fetchedAt, targetCount: targets.length, skuRows: rakutenCsvRows.length, httpCounts, liveSnapshot }, null, 2), "utf8");
writeFileSync(path.join(liveDir, "drift.json"), JSON.stringify({
  fetchedAt, csvBaseline: "dl-normal-item_20260720232336-1.csv (2026-07-20 23:23 取得)",
  priceBaselineColumn: "監査『現通常税抜』(=CSV現行SKU税抜)", titleBaseline: "RMS CSV 商品名",
  priceDrift, titleDrift, missingSkuOnRakuten,
}, null, 2), "utf8");

// --- バックアップ(b): アプリDB対象商品現在値（SELECTのみ） ---
const exact = JSON.parse(readFileSync(path.join(outDir, "current-products.json"), "utf8")).exact;
const ids = exact.map((e) => e.id);
let dbSource = "supabase-live";
let dbRows = null;
try {
  if (!SUPA_URL || !SVC) throw new Error("supabase env missing");
  const admin = createClient(SUPA_URL, SVC, { auth: { persistSession: false } });
  const collected = [];
  for (let i = 0; i < ids.length; i += 50) {
    const { data, error } = await admin.from("products").select("*").in("id", ids.slice(i, i + 50));
    if (error) throw new Error(error.message);
    collected.push(...(data ?? []));
  }
  dbRows = collected;
} catch (e) {
  dbSource = "fallback:current-products.json (" + String(e && e.message || e).slice(0, 80) + ")";
  dbRows = exact.map((e) => ({ id: e.id, ne_code: e.product.ne_code, product_name: e.product.product_name, selling_price: e.product.selling_price, updated_at: e.updatedAt, _snapshot: e.product }));
}
const dbCsvRows = dbRows.map((r) => ({
  id: r.id, ne_code: r.ne_code ?? "", rakuten_manage_number: r.rakuten_manage_number ?? (r._snapshot?.rakuten_manage_number ?? ""),
  product_name: r.product_name ?? "", selling_price: r.selling_price ?? "", updated_at: r.updated_at ?? "",
}));
writeFileSync(path.join(backupDir, "app-db-current-values.csv"), "﻿" + Papa.unparse(dbCsvRows), "utf8");
writeFileSync(path.join(backupDir, "app-db-current-rows.jsonl"), dbRows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");

// --- 復元手順メモ ---
writeFileSync(path.join(backupDir, "RESTORE.md"), `# しまのや第2ステージ 変更前バックアップ / 復元手順（機密・コミット禁止）

取得時刻(楽天現在値): ${fetchedAt}
DBバックアップ取得元: ${dbSource}
対象: 親 ${targets.length} / DB既存 ${dbRows.length} 商品

## ファイル
- backup/rakuten-current-values.csv … 楽天RMSの現在値（getItem 読み取り, SKU単位: 現行税抜・定期・JAN・属性名・自由入力行項目）。BOM付UTF-8。
- backup/app-db-current-values.csv … アプリDBの現在値（主要列）。BOM付UTF-8。
- backup/app-db-current-rows.jsonl … アプリDBの全行（ロスレス）。**復元はこちらを使う**。
- rakuten-live/raw/<管理番号>.json … 楽天 getItem 生JSON（親単位・ロスレス）。
- rakuten-live/snapshot.json … 取得サマリー。 rakuten-live/drift.json … 7/20 CSV基準との差分。

## 復元手順（DBを元に戻す場合）
1. app-db-current-rows.jsonl の各行JSONを **upsertProduct（repository経由=zod検証+履歴）** で書き戻す。service role でも生UPDATEを書かない（AI操作マニュアル §5）。
2. 楽天側は今回**読み取りのみ**で未変更のため復元不要。将来 upsert/patch/倉庫指定を実行した場合のみ、rakuten-live/raw/<管理番号>.json を使い変更前状態へ再送信する。

## 注意
- 本フォルダは社内機密。Git コミット・外部送信・ログ全量出力を禁止（.gitignore で保護済み）。
`, "utf8");

console.log(JSON.stringify({
  mode: REUSE ? "REUSE_RAW" : "LIVE_FETCH", fetchedAt, fetchMs, targetCount: targets.length, httpCounts,
  rakutenSkuRows: rakutenCsvRows.length,
  drift: { priceDrift: priceDrift.length, titleDrift: titleDrift.length, missingSkuOnRakuten: missingSkuOnRakuten.length },
  priceDriftSample: priceDrift.slice(0, 10), titleDriftSample: titleDrift.slice(0, 5).map((d) => d.target),
  missingSkuSample: missingSkuOnRakuten.slice(0, 10),
  dbSource, dbBackupRows: dbRows.length,
}, null, 2));
