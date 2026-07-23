// bulk-product-update 段1+2: 全商品の自由入力行から「お召し上がり方」を削除する dry-run manifest 生成。
// ユーザー裁定(2026-07-23):「お召し上がり方はすべて自由入力欄から削除で」。DB は SELECT のみ（書き込みなし）。
// 実行: cd webui && npx tsx tests/shimanoya_remove_serving_build.mjs
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { dbRowToProductInput } from "../lib/product/repository.ts";

const TARGET_LABEL = "お召し上がり方";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); }
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const root = path.resolve(import.meta.dirname, "..", "..");
const outDir = path.join(root, ".codex-work", "shimanoya-remove-serving");
const backupDir = path.join(outDir, "backup");
mkdirSync(backupDir, { recursive: true });
writeFileSync(path.join(outDir, ".gitignore"), "*\n", "utf8");
writeFileSync(path.join(backupDir, ".gitignore"), "*\n", "utf8");

const stableJson = (v) => JSON.stringify(v, (_k, val) =>
  val && typeof val === "object" && !Array.isArray(val)
    ? Object.fromEntries(Object.keys(val).sort().map((k) => [k, val[k]]))
    : val,
);
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex").toUpperCase();

// --- read-before-write: 全行を取得し、対象（specs に「お召し上がり方」を持つ商品）を抽出 ---
const { data: rows, error } = await supabase.from("products").select("*");
if (error) throw error;

const hasServing = (input) =>
  (input.variants ?? []).some((v) => (v.specs ?? []).some((s) => s.label === TARGET_LABEL));

const operations = [];
let removedRows = 0;
let affectedSkus = 0;
const backupLines = [];
for (const row of rows) {
  const input = dbRowToProductInput(row);
  if (!hasServing(input)) continue;
  backupLines.push(JSON.stringify(row));
  const variants = (input.variants ?? []).map((v) => {
    if (!(v.specs ?? []).some((s) => s.label === TARGET_LABEL)) return v;
    affectedSkus++;
    const kept = (v.specs ?? []).filter((s) => s.label !== TARGET_LABEL);
    removedRows += (v.specs ?? []).length - kept.length;
    return { ...v, specs: kept };
  });
  operations.push({
    action: "update",
    targetId: input.ne_code || row.ne_code || row.id,
    id: row.id,
    expectedUpdatedAt: row.updated_at,
    product: { ...input, variants },
  });
}
operations.sort((a, b) => String(a.targetId).localeCompare(String(b.targetId)));

// --- バックアップ（変更前の対象行・ロスレス） ---
writeFileSync(path.join(backupDir, "app-db-affected-rows.jsonl"), backupLines.join("\n") + "\n", "utf8");
writeFileSync(
  path.join(backupDir, "RESTORE.md"),
  `# 復元手順（機密・コミット禁止）\n\n取得時刻: ${new Date().toISOString()}\n対象: ${operations.length}商品（「${TARGET_LABEL}」削除前の全列スナップショット）\n\napp-db-affected-rows.jsonl の各行JSONを dbRowToProductInput で ProductInput に戻し、\nupsertProduct（repository経由 = zod検証+履歴）で書き戻す。生UPDATE禁止（AI操作マニュアル §5）。\n`,
  "utf8",
);

// --- 検証: 削除後 manifest に対象ラベルが残っていないこと ---
const leftover = operations.flatMap((op) =>
  (op.product.variants ?? []).flatMap((v) => (v.specs ?? []).filter((s) => s.label === TARGET_LABEL)),
);
const validation = { ok: leftover.length === 0 && operations.length > 0, errors: leftover.length ? [`${TARGET_LABEL} が ${leftover.length} 行残存`] : [] };

const payloadHash = sha256(stableJson(operations));
const manifest = {
  createdAt: new Date().toISOString(),
  mode: "dry-run",
  destination: "product-register app database only",
  mallWrite: false,
  decision: `ユーザー裁定(2026-07-23): 「${TARGET_LABEL}」を全商品の自由入力行(variants[].specs)から削除`,
  sourceFiles: { db: { note: "supabase products 全行 read-before-write", rows: rows.length } },
  summary: {
    scannedProducts: rows.length,
    targetProducts: operations.length,
    affectedSkus,
    removedSpecRows: removedRows,
  },
  validation,
  payloadHash,
  backupReference: { dir: ".codex-work/shimanoya-remove-serving/backup/（機密・コミット禁止）", files: ["app-db-affected-rows.jsonl", "RESTORE.md"] },
  holdDecisions: [],
  warnings: [],
  futureMallActions: [],
  operations,
};
writeFileSync(path.join(outDir, "app-dry-run.json"), JSON.stringify(manifest, null, 2), "utf8");
console.log(`scan ${rows.length}行 → 対象 ${operations.length}商品 / ${affectedSkus}SKU / 削除される行 ${removedRows}`);
console.log(`validation.ok=${validation.ok} / payloadHash=${payloadHash}`);
