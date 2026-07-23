// bulk-product-update 段4: 「お召し上がり方」自由入力行削除 manifest の DB 反映。
// 承認: ユーザー裁定(2026-07-23)「お召し上がり方はすべて自由入力欄から削除で」。
// 実行: cd webui && npx tsx tests/shimanoya_remove_serving_apply.mjs          … preflight のみ
//       cd webui && EXECUTE=1 npx tsx tests/shimanoya_remove_serving_apply.mjs … 反映実行
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { upsertProduct } from "../lib/product/repository.ts";

const APPROVED_PAYLOAD_HASH = "760EFD3AC5BAC494456FACDB39B25EBA32C1EFBA07368FE449FF81768BCC2E97";
const EXECUTE = process.env.EXECUTE === "1";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); }
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const root = path.resolve(import.meta.dirname, "..", "..");
const outDir = path.join(root, ".codex-work", "shimanoya-remove-serving");
const manifest = JSON.parse(readFileSync(path.join(outDir, "app-dry-run.json"), "utf8"));

if (manifest.mode !== "dry-run") throw new Error(`manifest.mode が dry-run ではない: ${manifest.mode}`);
if (manifest.mallWrite !== false) throw new Error("manifest.mallWrite が false ではない（モール書き込み禁止）");
if (manifest.validation?.ok !== true) throw new Error("manifest.validation.ok が true ではない");
if (manifest.payloadHash !== APPROVED_PAYLOAD_HASH) {
  throw new Error(`payloadHash 不一致: 承認済み=${APPROVED_PAYLOAD_HASH.slice(0, 8)}… manifest=${String(manifest.payloadHash).slice(0, 8)}…`);
}

const ops = manifest.operations;
console.log(`manifest OK (hash ${APPROVED_PAYLOAD_HASH.slice(0, 8)}…): 更新 ${ops.length}件`);

// --- preflight ---
const { data: currentRows, error: selErr } = await supabase
  .from("products").select("id, ne_code, updated_at, user_id")
  .in("id", ops.map((o) => o.id));
if (selErr) throw selErr;
const byId = new Map(currentRows.map((r) => [r.id, r]));
const missing = ops.filter((o) => !byId.has(o.id));
const conflicted = ops.filter((o) => byId.has(o.id) && byId.get(o.id).updated_at !== o.expectedUpdatedAt);
const owners = [...new Set(currentRows.map((r) => r.user_id))];
console.log(`preflight: 既存${currentRows.length}/${ops.length}行 / 消失${missing.length} / 競合${conflicted.length} / 所有者${owners.length}名`);
for (const o of conflicted) console.log(`  競合: ${o.targetId}`);
if (missing.length || conflicted.length) throw new Error("preflight NG。dry-run を再生成してください");
if (owners.length !== 1) throw new Error(`所有者が一意でない: ${owners.length}名`);
const OWNER_ID = owners[0];

if (!EXECUTE) {
  console.log("preflight OK（EXECUTE=1 を付けると反映を実行します。今回は書き込みなし）");
  process.exit(0);
}

// --- 反映（repository 経由・履歴付き） ---
const results = [];
let okCount = 0, ngCount = 0;
for (let i = 0; i < ops.length; i++) {
  const op = ops[i];
  try {
    const row = await upsertProduct(supabase, op.product, op.id, {
      expectedUpdatedAt: op.expectedUpdatedAt,
      authenticatedUserId: OWNER_ID,
    });
    okCount++;
    results.push({ targetId: op.targetId, ok: true, id: row.id });
  } catch (e) {
    ngCount++;
    results.push({ targetId: op.targetId, ok: false, error: String(e?.message ?? e) });
    console.log(`[${i + 1}/${ops.length}] ${op.targetId} NG: ${String(e?.message ?? e).slice(0, 120)}`);
  }
}
writeFileSync(
  path.join(outDir, "apply-result.json"),
  JSON.stringify({ appliedAt: new Date().toISOString(), payloadHash: APPROVED_PAYLOAD_HASH, total: ops.length, ok: okCount, ng: ngCount, results }, null, 2),
  "utf8",
);
console.log(`完了: OK ${okCount} / NG ${ngCount} → apply-result.json`);
if (ngCount > 0) process.exit(1);
