// 商品登録系E2Eの反復ランナー。安定性（flake）確認のため同じE2E一式を複数周回す。
//   対象: e2e_bulk_register / e2e_register_rakuten / e2e_register_yahoo_nosubmit
//   （e2e_register_yahoo.mjs は commit で submit:true=reservePublish（ストア全体の反映予約）を行うため
//     反復実行には使わない。「publish/submit/公開反映を行わない」制約を満たす nosubmit 変種を回す）
// 逐次実行（モールAPIへ同時多発リクエストを送らない）。各E2Eは自前で後始末するため、
// 周回間で残骸は残らない。失敗しても止まらず全周回を記録する（flake検出のため）。
// 実行: npx tsx tests/run_e2e_repeat.mjs [--rounds 3] [--out <結果JSONパス>]
// 前提: dev server (localhost:3000) 稼働中・webui/.env.local 設定済み
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEBUI = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const TESTS = [
  "e2e_bulk_register.mjs",
  "e2e_register_rakuten.mjs",
  "e2e_register_yahoo_nosubmit.mjs",
];

const args = process.argv.slice(2);
const argOf = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const rounds = Math.max(1, Number(argOf("--rounds", "3")) || 3);
const outPath = resolve(WEBUI, argOf("--out", "../logs/e2e_repeat_runs.json"));
const PAUSE_MS = 3000; // モールAPIへの負荷を安全側に（テスト間の小休止）

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const startedAt = new Date().toISOString();

function runOne(round, test) {
  const t0 = Date.now();
  // Windows でも動くよう npx はシェル経由で起動
  const r = spawnSync("npx", ["tsx", `tests/${test}`], {
    cwd: WEBUI, shell: true, encoding: "utf8", timeout: 10 * 60 * 1000,
  });
  const seconds = Math.round((Date.now() - t0) / 100) / 10;
  const stdout = (r.stdout || "") + (r.stderr || "");
  const tail = stdout.trim().split(/\r?\n/).slice(-6);
  const exitCode = typeof r.status === "number" ? r.status : -1;
  return { round, test, exitCode, ok: exitCode === 0, seconds, tail };
}

async function main() {
  for (let round = 1; round <= rounds; round++) {
    console.log(`\n===== Round ${round}/${rounds} =====`);
    for (const test of TESTS) {
      console.log(`--- ${test} (round ${round}) ---`);
      const rec = runOne(round, test);
      results.push(rec);
      console.log(rec.tail.join("\n"));
      console.log(`=> ${rec.ok ? "PASS" : `FAIL(exit=${rec.exitCode})`} ${rec.seconds}s`);
      await sleep(PAUSE_MS);
    }
  }

  const passed = results.filter((r) => r.ok).length;
  const summary = {
    rounds,
    tests: TESTS,
    totalRuns: results.length,
    passed,
    failed: results.length - passed,
    successRate: `${Math.round((passed / results.length) * 1000) / 10}%`,
    totalSeconds: Math.round(results.reduce((a, r) => a + r.seconds, 0) * 10) / 10,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({ summary, results }, null, 2));

  console.log(`\n===== サマリ =====`);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`結果JSON: ${outPath}`);
  process.exit(summary.failed === 0 ? 0 : 1);
}
main().catch((e) => { console.error("例外:", e); process.exit(3); });
