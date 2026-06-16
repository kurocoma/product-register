// .env.local の SUPABASE_DB_URL から pg.Client を作るヘルパー。
// パスワードに特殊文字が混じっても安全に扱えるよう、@aws- を境にパースする。
import { readFileSync } from "node:fs";
import pg from "pg";

export function loadDbConfig() {
  const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  const raw = (env.match(/^SUPABASE_DB_URL=(.*)$/m) || [])[1]?.trim();
  if (!raw) throw new Error("SUPABASE_DB_URL が .env.local にありません");
  const body = raw.replace(/^postgresql:\/\//, "");
  const hostIdx = body.indexOf("@aws-");
  if (hostIdx < 0) throw new Error("接続文字列の @aws- が見つかりません");
  const cred = body.slice(0, hostIdx);
  const rest = body.slice(hostIdx + 1);
  const user = cred.slice(0, cred.indexOf(":"));
  const password = cred.slice(cred.indexOf(":") + 1);
  const hm = rest.match(/^([^:]+):(\d+)\/(.+)$/);
  if (!hm) throw new Error("host:port/db のパースに失敗");
  return { host: hm[1], port: Number(hm[2]), database: hm[3], user, password, ssl: { rejectUnauthorized: false } };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function withClient(fn, { retries = 5, retryDelayMs = 15000 } = {}) {
  const cfg = loadDbConfig();
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const client = new pg.Client(cfg);
    try {
      await client.connect();
    } catch (e) {
      // Session pooler は認証情報の反映に遅延があり 28P01 が一時的に出る → リトライ
      lastErr = e;
      if (e.code === "28P01" && attempt < retries) {
        console.error(`  接続リトライ ${attempt}/${retries} (${e.code})...`);
        await sleep(retryDelayMs);
        continue;
      }
      throw e;
    }
    try {
      return await fn(client);
    } finally {
      await client.end();
    }
  }
  throw lastErr;
}
