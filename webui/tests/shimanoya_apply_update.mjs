// しまのや第2ステージ: 承認済み dry-run manifest をアプリDBへ反映する（AI操作マニュアル §5 経路①）。
// 権限境界: DB のみ（upsertProduct = repository 経由・zod検証＋履歴）。モールAPIは一切呼ばない。
// 承認: 2026-07-22 ユーザー承認「全部A」。payloadHash が下記 APPROVED と一致しない manifest は反映しない。
// 実行: cd webui && npx tsx tests/shimanoya_apply_update.mjs          … preflight のみ（書き込みなし）
//       cd webui && EXECUTE=1 npx tsx tests/shimanoya_apply_update.mjs … 反映実行
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { upsertProduct, productInputToDbRow } from "../lib/product/repository.ts";

const APPROVED_PAYLOAD_HASH = "5011A4E55BC961A374FCFD111AB3AE9EC3D59E66F6337F4460080915C811022F";
const EXECUTE = process.env.EXECUTE === "1";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); }
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SVC) throw new Error(".env.local から Supabase 接続情報を読めません");

const root = path.resolve(import.meta.dirname, "..", "..");
const outDir = path.join(root, ".codex-work", "shimanoya-app-update");
const manifest = JSON.parse(readFileSync(path.join(outDir, "app-dry-run.json"), "utf8"));

// --- 承認ゲート: manifest が承認済みのものと同一か検証 ---
if (manifest.mode !== "dry-run") throw new Error(`manifest.mode が dry-run ではない: ${manifest.mode}`);
if (manifest.mallWrite !== false) throw new Error("manifest.mallWrite が false ではない（モール書き込み禁止）");
if (manifest.payloadHash !== APPROVED_PAYLOAD_HASH) {
  throw new Error(`payloadHash 不一致: 承認済み=${APPROVED_PAYLOAD_HASH.slice(0, 8)}… manifest=${String(manifest.payloadHash).slice(0, 8)}…`);
}

const ops = manifest.operations;
const updates = ops.filter((o) => o.action === "update");
const creates = ops.filter((o) => o.action === "create");
console.log(`manifest OK (hash ${APPROVED_PAYLOAD_HASH.slice(0, 8)}…): 全${ops.length}件 = 更新${updates.length} + 新規${creates.length}`);

const supabase = createClient(SUPA_URL, SVC, { auth: { persistSession: false } });

// --- preflight: 書き込み前に対象を SELECT（件数・競合・所有者を確認してから書く） ---
const { data: currentRows, error: selErr } = await supabase
  .from("products").select("id, ne_code, updated_at, user_id")
  .in("id", updates.map((o) => o.id));
if (selErr) throw selErr;
const byId = new Map(currentRows.map((r) => [r.id, r]));
const missing = updates.filter((o) => !byId.has(o.id));
const conflicted = updates.filter((o) => byId.has(o.id) && byId.get(o.id).updated_at !== o.expectedUpdatedAt);
const owners = [...new Set(currentRows.map((r) => r.user_id))];

const { data: dupRows, error: dupErr } = await supabase
  .from("products").select("id, ne_code")
  .in("ne_code", creates.map((o) => o.targetId));
if (dupErr) throw dupErr;

console.log(`preflight: 既存${currentRows.length}/${updates.length}行を確認 / 消失${missing.length} / dry-run後の更新競合${conflicted.length} / 新規側の重複${dupRows.length} / 所有者${owners.length}名`);
for (const o of missing) console.log(`  消失: ${o.targetId} (${o.id})`);
for (const o of conflicted) console.log(`  競合: ${o.targetId} expected=${o.expectedUpdatedAt} actual=${byId.get(o.id).updated_at}`);
for (const r of dupRows) console.log(`  新規重複: ${r.ne_code} (${r.id})`);
if (missing.length || conflicted.length || dupRows.length) throw new Error("preflight NG。dry-run を再生成してください");
if (owners.length !== 1) throw new Error(`所有者が一意でない: ${owners.length}名`);
const OWNER_ID = owners[0];

if (!EXECUTE) {
  console.log("preflight OK（EXECUTE=1 を付けると反映を実行します。今回は書き込みなし）");
  process.exit(0);
}

// --- 反映実行（順次・repository 経由） + 反映直後の値検証 ---
const results = [];
let okCount = 0, ngCount = 0, mismatchCount = 0;
const VERIFY_EXCLUDE = new Set(["user_id", "updated_at"]);
for (let i = 0; i < ops.length; i++) {
  const op = ops[i];
  const label = `[${i + 1}/${ops.length}] ${op.action} ${op.targetId}`;
  try {
    const row = await upsertProduct(
      supabase, op.product, op.id ?? undefined,
      { expectedUpdatedAt: op.expectedUpdatedAt ?? undefined, authenticatedUserId: OWNER_ID },
    );
    // 検証: アプリ自身の変換（productInputToDbRow）で期待行を作り、返却行と突き合わせる
    const expected = productInputToDbRow(op.product);
    const diffs = [];
    for (const [k, v] of Object.entries(expected)) {
      if (VERIFY_EXCLUDE.has(k)) continue;
      if (JSON.stringify(row[k] ?? null) !== JSON.stringify(v ?? null)) diffs.push(k);
    }
    if (diffs.length) mismatchCount++;
    okCount++;
    results.push({ targetId: op.targetId, action: op.action, ok: true, id: row.id, fieldMismatch: diffs });
    console.log(`${label} OK${diffs.length ? ` (要確認フィールド: ${diffs.join(",")})` : ""}`);
  } catch (e) {
    ngCount++;
    results.push({ targetId: op.targetId, action: op.action, ok: false, error: String(e?.message ?? e) });
    console.log(`${label} NG: ${String(e?.message ?? e).slice(0, 120)}`);
  }
}

const summary = {
  appliedAt: new Date().toISOString(),
  payloadHash: APPROVED_PAYLOAD_HASH,
  total: ops.length, ok: okCount, ng: ngCount, fieldMismatch: mismatchCount,
  results,
};
writeFileSync(path.join(outDir, "apply-result.json"), JSON.stringify(summary, null, 2), "utf8");
console.log(`完了: OK ${okCount} / NG ${ngCount} / フィールド不一致 ${mismatchCount} → apply-result.json`);
if (ngCount > 0) process.exit(1);
