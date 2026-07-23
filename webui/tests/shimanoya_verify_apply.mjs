// しまのや第2ステージ: 反映結果の読み取り専用検証。jsonb のキー順正規化に影響されない
// 順序不問の深い比較で、DB の実値と manifest 期待値を突き合わせる。書き込みなし。
// 実行: cd webui && npx tsx tests/shimanoya_verify_apply.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { productInputToDbRow } from "../lib/product/repository.ts";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); }
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const root = path.resolve(import.meta.dirname, "..", "..");
const outDir = path.join(root, ".codex-work", "shimanoya-app-update");
const manifest = JSON.parse(readFileSync(path.join(outDir, "app-dry-run.json"), "utf8"));
const applied = JSON.parse(readFileSync(path.join(outDir, "apply-result.json"), "utf8"));
const idByTarget = new Map(applied.results.map((r) => [r.targetId, r.id]));

// 順序不問（オブジェクトのキー順を無視。配列は順序あり）の深い比較。差分パスを収集する。
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

let realMismatch = 0;
const details = [];
for (const op of manifest.operations) {
  const id = idByTarget.get(op.targetId);
  const { data: row, error } = await supabase.from("products").select("*").eq("id", id).single();
  if (error) { realMismatch++; details.push(`${op.targetId}: 取得失敗 ${error.message}`); continue; }
  const expected = productInputToDbRow(op.product);
  const diffs = [];
  for (const [k, v] of Object.entries(expected)) {
    if (k === "user_id" || k === "updated_at") continue;
    diff(v ?? null, row[k] ?? null, k, diffs);
  }
  if (diffs.length) { realMismatch++; details.push(`${op.targetId}: ${diffs.slice(0, 5).join(", ")}${diffs.length > 5 ? ` …計${diffs.length}` : ""}`); }
}
console.log(`検証対象 ${manifest.operations.length}件 / 実不一致 ${realMismatch}件`);
for (const d of details.slice(0, 20)) console.log("  " + d);
process.exit(realMismatch ? 1 : 0);
