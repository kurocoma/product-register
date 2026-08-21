// ポイント変倍最適化の単体実行スクリプト（タスクスケジューラから1日2回実行される）。
// dev サーバの起動に依存せず、.env.local と Supabase(service role) で直接実行する。
// 実行: cd webui && npx tsx scripts/point_boost_run.mjs [--dry-run] [--limit N] [--manual [--live]]
//   --dry-run : 照会のみ（RMSへ反映しない）
//   --limit N : 処理する商品数の上限（既定: 全件）
//   --manual  : trigger=manual として実行（設定が無効でも動く。動作確認用のため既定 dry-run。
//               RMSへ実際に反映するときだけ --manual --live と明示する）
// 既定（フラグなし）は trigger=scheduled ＝ 画面の「自動実行を有効にする」がONのときだけ反映する（安全弁）。
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
// barrel(index.ts) 経由は tsx のモジュール解決で落ちるため service を直 import する
// （barrel は Next.js 側の公開境界。ここは同一 feature 内スクリプトなので直 import を許容）
import { runPointBoost } from "../lib/point-boost/service.ts";
import {
  getRakutenApplicationIdFromEnv,
  getRakutenCredentialsFromEnv,
  getRakutenWebServiceAccessKeyFromEnv,
} from "../lib/rakuten/credentials.ts";

// .env.local を process.env へ（既存 e2e スクリプトと同じ方式）
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const args = process.argv.slice(2);
const trigger = args.includes("--manual") ? "manual" : "scheduled";
// --manual（動作確認用）は既定 dry-run。反映は --live の明示が必要（誤操作でのPATCH防止）
const dryRun = trigger === "manual" ? !args.includes("--live") : args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) || undefined : undefined;

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !SVC) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が .env.local にありません");
  process.exit(1);
}

// 対象ユーザーの解決: POINT_BOOST_USER_EMAIL > DEV_AUTOLOGIN_EMAIL
const email = process.env.POINT_BOOST_USER_EMAIL || process.env.DEV_AUTOLOGIN_EMAIL;
if (!email) {
  console.error("対象ユーザーのメールが未設定です（.env.local に POINT_BOOST_USER_EMAIL か DEV_AUTOLOGIN_EMAIL を設定）");
  process.exit(1);
}

const admin = createClient(URL_, SVC, { auth: { persistSession: false } });
const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
if (listErr) {
  console.error("ユーザー一覧の取得に失敗:", listErr.message);
  process.exit(1);
}
const user = list.users.find((u) => u.email === email);
if (!user) {
  console.error(`ユーザーが見つかりません: ${email}`);
  process.exit(1);
}

const startedAt = new Date();
console.log(`[point-boost] 開始 ${startedAt.toISOString()} trigger=${trigger} dryRun=${dryRun} user=${email}`);

const summary = await runPointBoost(
  {
    supabase: admin, // service role は RLS を通らないため、repository 側で常に user_id で絞っている
    userId: user.id,
    rmsCred: getRakutenCredentialsFromEnv(),
    applicationId: getRakutenApplicationIdFromEnv(),
    accessKey: getRakutenWebServiceAccessKeyFromEnv(),
    log: (msg) => console.log(`[point-boost] ${msg}`),
  },
  { dryRun, trigger, limit },
);

console.log(`[point-boost] ${summary.status}: ${summary.message}`);
if (summary.status === "done") {
  const t = summary.totals;
  console.log(
    `[point-boost] 対象=${t.total_targets} 変倍=${t.boosted_count} 変更なし=${t.unchanged_count} 競合なし=${t.no_competitor_count} 対象外=${t.skipped_count} エラー=${t.error_count} runId=${summary.runId}`,
  );
}
for (const r of summary.results) {
  if (r.action === "boosted" || r.action === "error") {
    console.log(`[point-boost]   ${r.action} ${r.ne_code} ${r.detail}`);
  }
}
console.log(`[point-boost] 終了 ${new Date().toISOString()} (${Math.round((Date.now() - startedAt.getTime()) / 1000)}秒)`);
process.exit(summary.status === "done" || summary.status === "disabled" ? 0 : 1);
