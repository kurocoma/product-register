// read-before-write: current-products.json の current state を、最新DB読取(JSONL)で更新する。
// 外部通信なし（既取得の backup/app-db-current-rows.jsonl を使う）。書き込みは confidential dir のみ。
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dbRowToProductInput } from "../lib/product/repository.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const outDir = path.join(root, ".codex-work", "shimanoya-app-update");
const cpPath = path.join(outDir, "current-products.json");
const cp = JSON.parse(readFileSync(cpPath, "utf8"));
const jl = readFileSync(path.join(outDir, "backup", "app-db-current-rows.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const byId = new Map(jl.map((r) => [r.id, r]));
const norm = (v) => JSON.stringify(v ?? null);

// 変更前スナップショットを退避（機密dir）
writeFileSync(path.join(outDir, "backup", "current-products.pre-refresh.json"), JSON.stringify(cp), "utf8");

const refreshedAt = new Date().toISOString();
const changed = [];       // 内容が変わった
const bumpedOnly = [];    // updated_at だけ変わった（内容同一）
let refreshedCount = 0;

for (const e of cp.exact) {
  const row = byId.get(e.id);
  if (!row) continue;
  const fresh = dbRowToProductInput(row);
  const contentChanged = norm(e.product) !== norm(fresh);
  const tsChanged = (e.updatedAt || "").slice(0, 19) !== (row.updated_at || "").slice(0, 19);
  if (contentChanged) changed.push(e.targetId);
  else if (tsChanged) bumpedOnly.push(e.targetId);
  e.product = fresh;
  e.updatedAt = row.updated_at ?? e.updatedAt;
  refreshedCount++;
}
// catalog も id 一致分は最新化（siblingJan の正確性のため）
let catalogRefreshed = 0;
for (const c of cp.catalog ?? []) {
  const row = byId.get(c.id);
  if (!row) continue;
  c.product = dbRowToProductInput(row);
  c.updatedAt = row.updated_at ?? c.updatedAt;
  catalogRefreshed++;
}

cp.refreshedAt = refreshedAt;
cp.refreshSource = "supabase-live via backup/app-db-current-rows.jsonl";
cp.refreshChangedContent = changed;
cp.refreshBumpedOnly = bumpedOnly;
writeFileSync(cpPath, JSON.stringify(cp, null, 2) + "\n", "utf8");

console.log(JSON.stringify({
  refreshedAt, exactRefreshed: refreshedCount, catalogRefreshed,
  contentChanged: changed, updatedAtBumpedOnly: bumpedOnly,
}, null, 2));
