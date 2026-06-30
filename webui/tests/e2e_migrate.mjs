// しまのや 商品の楽天→Yahoo 一括移行 ライブテスト。
//   既定は dry-run(書込なし)。--commit で実登録(新規 display=0=非公開 / submitItem 非実行)。
// 使い方(webui ディレクトリ):
//   node tests/e2e_migrate.mjs                      # dry-run プレビュー
//   node tests/e2e_migrate.mjs --commit             # 実登録(display=0 非公開)
//   node tests/e2e_migrate.mjs --codes=r0101-1,r113-1   # 対象管理番号を上書き
//   node tests/e2e_migrate.mjs --email=foo@bar.com  # 対象アプリユーザー上書き
// .env.local はこのプロセス内でのみ参照する。
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const BASE = process.env.E2E_BASE || "http://localhost:3000";
const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.split("=").slice(1).join("=") : d;
};
const COMMIT = process.argv.includes("--commit");
const TARGET_EMAIL = arg("email", "kurocommerce@gmail.com");
const CODES = arg("codes", "r0101-1,r1101-1,r113-1").split(",").map((s) => s.trim()).filter(Boolean);

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const get = (k) => process.env[k];
const URL_ = get("NEXT_PUBLIC_SUPABASE_URL");
const ANON = get("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SVC = get("SUPABASE_SERVICE_ROLE_KEY");
if (!URL_ || !ANON || !SVC) {
  console.error("supabase 環境変数が不足（NEXT_PUBLIC_SUPABASE_URL / ANON / SERVICE_ROLE）");
  process.exit(2);
}
const admin = createClient(URL_, SVC, { auth: { persistSession: false } });

async function main() {
  // 1) 対象アプリユーザー解決
  const { data: list, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) { console.error("listUsers 失敗:", error.message); process.exit(2); }
  const user = list.users.find((u) => u.email === TARGET_EMAIL);
  if (!user) {
    console.error(`対象ユーザーが見つかりません: ${TARGET_EMAIL}`);
    console.error("利用可能なメール:", list.users.map((u) => u.email).filter(Boolean).join(", "));
    process.exit(2);
  }
  console.log(`対象アプリユーザー: ${user.email} (${user.id.slice(0, 8)})`);

  // 2) セッション cookie 発行（magiclink → verifyOtp）
  const jar = new Map();
  const ssr = createServerClient(URL_, ANON, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email });
  if (linkErr) { console.error("generateLink 失敗:", linkErr.message); process.exit(2); }
  await ssr.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join("; ");

  // 3) 移行 API 呼び出し
  const dryRun = !COMMIT;
  console.log(`\n=== ${dryRun ? "DRY-RUN（書込なし・プレビュー）" : "COMMIT（実登録: 新規 display=0 非公開 / 公開しない）"} ===`);
  console.log(`対象 ${CODES.length}件: ${CODES.join(", ")}`);
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/migrate/rakuten-to-yahoo`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ manageNumbers: CODES, dryRun, delayMs: 300, preserveExistingDisplay: true }),
  });
  const text = await res.text();
  let j;
  try { j = JSON.parse(text); } catch { console.error("非JSON応答:", res.status, text.slice(0, 500)); process.exit(1); }
  console.log(`HTTP ${res.status}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  if (!res.ok || !j.ok) { console.error("失敗:", JSON.stringify(j, null, 2)); process.exit(1); }

  console.log(`\nsummary: ${JSON.stringify(j.summary)}`);
  console.log(`dryRun=${j.dryRun} delayMs=${j.delayMs} duplicatesRemoved=${j.duplicatesRemoved} invalid=${JSON.stringify(j.invalid)}`);
  console.log("\nper-item:");
  for (const r of j.results) {
    const pid = r.productId ? ` productId=${String(r.productId).slice(0, 8)}` : "";
    const err = r.error ? `  ⚠ ${r.error}` : "";
    console.log(`  ${r.manageNumber}: status=${r.status} step=${r.step} ok=${r.ok}${pid}${err}`);
  }
  const okCount = j.results.filter((r) => r.ok).length;
  console.log(`\n${dryRun ? "プレビュー" : "実行"}完了: ${okCount}/${j.results.length} ok / 要手動 ${j.summary.requiresManual} / 失敗 ${j.summary.failed}`);
  process.exit(0);
}
main().catch((e) => { console.error("例外:", e); process.exit(3); });
