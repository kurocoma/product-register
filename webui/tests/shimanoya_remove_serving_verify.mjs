// bulk-product-update 段5: 「お召し上がり方」削除の読み取り専用検証。
// (a) DB全行に対象ラベルの残存が無いこと (b) 反映行が manifest 期待値と一致すること（順序不問の深い比較）。
// 実行: cd webui && npx tsx tests/shimanoya_remove_serving_verify.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { dbRowToProductInput, productInputToDbRow } from "../lib/product/repository.ts";

const TARGET_LABEL = "お召し上がり方";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); }
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const root = path.resolve(import.meta.dirname, "..", "..");
const manifest = JSON.parse(readFileSync(path.join(root, ".codex-work", "shimanoya-remove-serving", "app-dry-run.json"), "utf8"));

function diff(a, b, p, out) {
  if (a === b) return;
  if (a === null || b === null || typeof a !== typeof b) { out.push(p); return; }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) { out.push(`${p}.length`); return; }
    a.forEach((v, i) => diff(v, b[i], `${p}[${i}]`, out));
    return;
  }
  if (typeof a === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) diff(a[k] ?? null, b[k] ?? null, `${p}.${k}`, out);
    return;
  }
  out.push(p);
}

// (a) DB 全行スキャン: 対象ラベルの残存確認
const { data: rows, error } = await supabase.from("products").select("*");
if (error) throw error;
let leftover = 0;
for (const row of rows) {
  const input = dbRowToProductInput(row);
  for (const v of input.variants ?? []) {
    leftover += (v.specs ?? []).filter((s) => s.label === TARGET_LABEL).length;
  }
}

// (b) 反映行と manifest 期待値の一致
const byId = new Map(rows.map((r) => [r.id, r]));
let mismatch = 0;
const details = [];
for (const op of manifest.operations) {
  const row = byId.get(op.id);
  if (!row) { mismatch++; details.push(`${op.targetId}: 行が見つからない`); continue; }
  const expected = productInputToDbRow(op.product);
  const diffs = [];
  for (const [k, v] of Object.entries(expected)) {
    if (k === "user_id" || k === "updated_at") continue;
    diff(v ?? null, row[k] ?? null, k, diffs);
  }
  if (diffs.length) { mismatch++; details.push(`${op.targetId}: ${diffs.slice(0, 5).join(", ")}`); }
}
console.log(`DB全${rows.length}行スキャン: 「${TARGET_LABEL}」残存 ${leftover}行 / 期待値との実不一致 ${mismatch}件（対象${manifest.operations.length}商品）`);
for (const d of details.slice(0, 10)) console.log("  " + d);
process.exit(leftover || mismatch ? 1 : 0);
