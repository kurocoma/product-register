// [1/4] しまのや 楽天→Yahoo 一括反映（2026-07-26）: 変更前バックアップ（読み取り専用・書き込みなし）。
// 対象66件について
//   - アプリDBの現在行（楽天取込=read-before-write で上書きされる前の状態）
//   - Yahoo!ショッピングの現在値（getItem の生XML＝ロスレス）
// を .codex-work/shimanoya-yahoo-sync-20260726/backup/ へ保存し、復元手順 RESTORE.md を残す。
// 全外部呼び出しに 30s タイムアウト。タイムアウト・エラーは当該itemのみ失敗扱いで全体は継続する。
// 実行: cd webui && npx tsx tests/shimanoya_yahoo_sync_backup.mjs
import { writeFileSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { getItem as getYahooItem } from "../lib/yahoo/item-client.ts";
import {
  TARGETS, WORK_DIR, BACKUP_DIR, API_TIMEOUT_MS, CHUNK_SIZE,
  ensureWorkDir, loadEnv, withTimeout, getAdmin, loadTargets, yahooAuth, writeAuthBlocked,
  chunk, writeJson, appendJsonl, readJsonl, csvRow, xmlTag, xmlImageUrls, sleep, nowIso,
} from "./shimanoya_yahoo_sync_common.mjs";

loadEnv();
ensureWorkDir();

const admin = getAdmin();
const { found, missing, allRows } = await loadTargets(admin);
console.log(`対象 ${TARGETS.length}件 → DB解決 ${found.size}件 / 未解決 ${missing.length}件`);
if (missing.length) console.log(`  DB未解決: ${missing.join(", ")}`);

// --- 1) アプリDBの現在行を丸ごと退避（楽天取込で上書きされる前のロスレススナップショット） ---
const dbFile = path.join(BACKUP_DIR, "app-db-current-rows.jsonl");
if (existsSync(dbFile)) rmSync(dbFile);
const targetIds = new Set([...found.values()].map((t) => t.row.id));
let dbSaved = 0;
for (const row of allRows) {
  if (!targetIds.has(row.id)) continue;
  appendJsonl(dbFile, row);
  dbSaved++;
}
console.log(`アプリDB行を退避: ${dbSaved}件 → backup/app-db-current-rows.jsonl`);

// --- 2) Yahoo 認証（失効時はユーザー操作が必要な旨を残して停止） ---
let cfg, token;
try {
  ({ cfg, token } = await yahooAuth());
} catch (e) {
  const msg = String(e?.message ?? e);
  const file = writeAuthBlocked("backup", msg);
  console.error(`Yahoo認証に失敗しました。処理を中止します（${file}）\n  ${msg}`);
  process.exit(2);
}

// --- 3) Yahoo 現在値の取得（10〜20件チャンクで逐次・per-call 30s タイムアウト） ---
const yahooFile = path.join(BACKUP_DIR, "yahoo-current.jsonl");
if (existsSync(yahooFile)) rmSync(yahooFile);
const results = [];
const chunks = chunk(TARGETS, CHUNK_SIZE);
let i = 0;
for (const [ci, group] of chunks.entries()) {
  for (const manage of group) {
    i++;
    const t = found.get(manage);
    const label = `[${i}/${TARGETS.length}] ${manage}`;
    if (!t) {
      results.push({ manage, chunk: ci + 1, status: "skip", reason: "アプリDBに該当商品がありません", timestamp: nowIso() });
      console.log(`${label} skip: アプリDBに該当なし`);
      continue;
    }
    const itemCode = t.input.ne_code;
    try {
      const got = await withTimeout(getYahooItem(token, cfg.sellerId, itemCode), API_TIMEOUT_MS, `getItem ${itemCode}`);
      appendJsonl(yahooFile, {
        manage, itemCode, productId: t.row.id, exists: got.exists, fetchedAt: nowIso(), raw: got.raw,
      });
      results.push({
        manage, itemCode, productId: t.row.id, chunk: ci + 1,
        status: got.exists ? "ok" : "ng",
        reason: got.exists ? undefined : "Yahooに該当商品が存在しません（新規登録が必要）",
        timestamp: nowIso(),
      });
      console.log(`${label} ${got.exists ? "取得OK" : "Yahooに商品なし"} (${itemCode})`);
    } catch (e) {
      results.push({ manage, itemCode, productId: t.row.id, chunk: ci + 1, status: "ng", reason: String(e?.message ?? e), timestamp: nowIso() });
      console.log(`${label} 取得NG: ${String(e?.message ?? e).slice(0, 120)}`);
    }
    await sleep(150);
  }
  console.log(`--- チャンク ${ci + 1}/${chunks.length} 完了 ---`);
}

// --- 4) 人間可読 CSV（主要フィールドのみ。生XMLは JSONL 側がロスレス正本） ---
const rows = [csvRow([
  "管理番号", "Yahoo商品コード", "Yahoo存在", "商品名", "価格(税込)", "表示価格(税込)", "在庫数",
  "キャッチコピー", "ストアカテゴリパス", "Yahooカテゴリ", "JAN", "公開(Display)", "税率区分",
  "画像枚数", "定期タイプ", "オプション有無", "取得エラー",
])];
const yahooJsonl = new Map();
for (const r of results) {
  const raw = r.status === "ok" ? readRaw(r.manage) : "";
  rows.push(csvRow([
    r.manage, r.itemCode ?? "", r.status === "ok" ? "あり" : "なし",
    xmlTag(raw, "Name"), xmlTag(raw, "Price"), xmlTag(raw, "OriginalPrice"), xmlTag(raw, "Quantity"),
    xmlTag(raw, "Headline"), (raw.match(/<Path[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/Path>/i) || [])[1] ?? "",
    xmlTag(raw, "ProductCategory"), xmlTag(raw, "Jan"), xmlTag(raw, "Display"), xmlTag(raw, "TaxrateType"),
    raw ? xmlImageUrls(raw).length : "", xmlTag(raw, "SubscriptionType"),
    /<Options>[\s\S]*?<Option[ >]/i.test(raw) ? "あり" : "なし",
    r.reason ?? "",
  ]));
}
function readRaw(manage) {
  if (yahooJsonl.size === 0) {
    for (const rec of readJsonl(yahooFile)) yahooJsonl.set(rec.manage, rec.raw ?? "");
  }
  return yahooJsonl.get(manage) ?? "";
}
writeFileSync(path.join(BACKUP_DIR, "yahoo-current.csv"), "﻿" + rows.join("\r\n") + "\r\n", "utf8");

// --- 5) 対象解決結果（以降のスクリプトが参照する） ---
writeJson(path.join(WORK_DIR, "targets.json"), {
  ranAt: nowIso(),
  total: TARGETS.length,
  resolved: found.size,
  missing,
  items: TARGETS.map((manage) => {
    const t = found.get(manage);
    if (!t) return { manage, resolved: false };
    return {
      manage, resolved: true, productId: t.row.id, userId: t.row.user_id,
      itemCode: t.input.ne_code, matchedBy: t.matchedBy,
      displayName: t.input.display_name || t.input.product_name || "",
      sellingPriceExclusive: t.input.selling_price,
      taxRate: t.input.tax_rate,
      stockQuantity: typeof t.input.stock_quantity === "number" ? t.input.stock_quantity : null,
      variantCount: (t.input.variants ?? []).length,
      updatedAt: t.row.updated_at,
    };
  }),
});

writeJson(path.join(WORK_DIR, "backup-results.json"), {
  ranAt: nowIso(), total: TARGETS.length,
  ok: results.filter((r) => r.status === "ok").length,
  ng: results.filter((r) => r.status === "ng").length,
  skip: results.filter((r) => r.status === "skip").length,
  dbRowsSaved: dbSaved,
  results,
});

// --- 6) 復元手順 ---
writeFileSync(path.join(BACKUP_DIR, "RESTORE.md"), RESTORE_MD(), "utf8");

const ok = results.filter((r) => r.status === "ok").length;
const ng = results.filter((r) => r.status === "ng").length;
const skip = results.filter((r) => r.status === "skip").length;
console.log(`\nバックアップ完了: Yahoo取得OK ${ok} / NG ${ng} / skip ${skip}（DB行 ${dbSaved}件）`);
console.log(`→ ${BACKUP_DIR}`);
if (ng + skip > 0) for (const r of results.filter((x) => x.status !== "ok")) console.log(`  ${r.status.toUpperCase()} ${r.manage}: ${r.reason}`);

function RESTORE_MD() {
  return `# 復元手順 — しまのや 楽天→Yahoo 一括反映（2026-07-26）

このフォルダは **変更前** のロスレスバックアップです。git 追跡外（\`.gitignore\` = \`*\`）。コミット禁止。

## 中身

| ファイル | 内容 |
| --- | --- |
| \`yahoo-current.jsonl\` | Yahoo getItem の**生XML**（1行1商品・ロスレス正本）。\`{manage, itemCode, productId, exists, fetchedAt, raw}\` |
| \`yahoo-current.csv\` | 上記の主要フィールド抜粋（Excel 確認用・UTF-8 BOM付き） |
| \`app-db-current-rows.jsonl\` | 商品登録アプリDB \`products\` の該当行そのまま（楽天取込で上書きされる前） |
| \`RESTORE.md\` | 本ファイル |

取得日時: ${nowIso()} / 対象 ${TARGETS.length}件（Yahoo取得成功 ${results.filter((r) => r.status === "ok").length}件）

## 1. Yahoo を変更前へ戻す

\`yahoo-current.jsonl\` の生XMLを \`xmlToEditItemParams()\`（= 現在値を完全復元する editItem パラメータ生成）へ通して再送します。
アプリ本体と同じ変換関数を使うので、退避時点の値がそのまま戻ります。

1. 下のスクリプトを \`webui/tests/_restore_yahoo_20260726.mjs\` として保存する
2. \`cd webui && npx tsx tests/_restore_yahoo_20260726.mjs\`（\`ONLY=r0101-1,r113-1\` で対象を絞れる／\`DRY=1\` で送信せず確認のみ）
3. 復元後に公開反映が必要なら Yahoo ストアクリエイターPro で「反映」する（本作業では reservePublish を実行していないため、
   未反映のまま戻す場合は追加操作は不要）

\`\`\`js
import { readFileSync } from "node:fs";
import path from "node:path";
import { getYahooConfig, getYahooAccessToken } from "../lib/yahoo/auth.ts";
import { editItem } from "../lib/yahoo/item-client.ts";
import { xmlToEditItemParams } from "../lib/converters/yahoo-patch.ts";
import { fitYahooFieldLimits } from "../lib/yahoo/item-mapper.ts";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); }
const cfg = getYahooConfig();
const token = await getYahooAccessToken(cfg);
const file = path.join(import.meta.dirname, "..", "..", ".codex-work", "shimanoya-yahoo-sync-20260726", "backup", "yahoo-current.jsonl");
const only = process.env.ONLY ? new Set(process.env.ONLY.split(",").map((s) => s.trim())) : null;
for (const line of readFileSync(file, "utf8").split("\\n").filter(Boolean)) {
  const rec = JSON.parse(line);
  if (!rec.exists) { console.log(\`skip \${rec.manage}: 退避時点でYahooに商品なし\`); continue; }
  if (only && !only.has(rec.manage)) continue;
  const { params } = xmlToEditItemParams(rec.raw, cfg.sellerId);
  const body = fitYahooFieldLimits(params);
  if (process.env.DRY === "1") { console.log(\`dry \${rec.manage}: \${Object.keys(body).length}項目\`); continue; }
  const r = await editItem(token, body);
  console.log(\`\${r.ok ? "復元OK" : "復元NG"} \${rec.manage} \${r.ok ? "" : r.message}\`);
  await new Promise((s) => setTimeout(s, 300));
}
\`\`\`

### 注意
- \`editItem\` は**送らなかった項目を既定値で上書き**します。必ず上記の \`xmlToEditItemParams()\` 経由で全項目を再送してください
  （生XMLの一部だけを手で送ると他項目が消えます）。
- 在庫（Quantity）は \`editItem\` の対象外です。在庫を戻す場合は \`setStock(token, sellerId, itemCode, 退避時の在庫数)\` を使ってください。
  退避時の在庫数は \`yahoo-current.csv\` の「在庫数」列、または生XMLの \`<Quantity>\` にあります。
  本作業では在庫はアプリDBに管理値がある商品のみ更新し、それ以外は Yahoo 現在値を維持しています（\`sync-results.json\` の \`stock\` 参照）。
- 商品オプション（\`<Options>\`）が「未対応形」の商品はアプリが反映自体をブロックしているため、そもそも変更されていません。

## 2. アプリDBを変更前へ戻す

本作業では反映前に楽天の現在値をアプリDBへ取込みます（read-before-write）。取込前の行は \`app-db-current-rows.jsonl\` にあります。

\`\`\`bash
# Supabase service role で該当行を JSONL の内容へ上書きする（id 一致で update）
cd webui && npx tsx -e "
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const env = readFileSync('.env.local','utf8');
for (const l of env.split('\\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); }
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const rows = readFileSync('../.codex-work/shimanoya-yahoo-sync-20260726/backup/app-db-current-rows.jsonl','utf8').split('\\n').filter(Boolean).map(JSON.parse);
for (const r of rows) { const { id, created_at, updated_at, ...rest } = r; const { error } = await admin.from('products').update(rest).eq('id', id); console.log(id, error?.message ?? 'OK'); }
"
\`\`\`

## 3. 秘密情報について
このバックアップには API トークン・環境変数値は一切含まれません（商品データのみ）。
`;
}
