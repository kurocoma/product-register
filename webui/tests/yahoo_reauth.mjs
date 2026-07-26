// Yahoo!ショッピングAPI 再認証（YConnect v2 認可コードフロー）。refresh token 失効時に使う。
// 使い方: cd webui && npx tsx tests/yahoo_reauth.mjs
//   1) 自動で開くブラウザ（または表示URL）で Yahoo! JAPANビジネスID にログインして同意する
//   2) 登録済みコールバック http://localhost:8502 を本スクリプトが受け取り、
//      新しい YAHOO_REFRESH_TOKEN を webui/.env.local に保存する（既存行を置換・値はログに出さない）
// 安全: トークン・シークレットは標準出力に一切出さない。書き換え前に .env.local.bak を同フォルダに作成。
import http from "node:http";
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import crypto from "node:crypto";

const ENV_PATH = fileURLToPath(new URL("../.env.local", import.meta.url));
const envText = readFileSync(ENV_PATH, "utf8");
const envGet = (k) => envText.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim();
const CLIENT_ID = envGet("YAHOO_CLIENT_ID");
const CLIENT_SECRET = envGet("YAHOO_CLIENT_SECRET");
if (!CLIENT_ID || !CLIENT_SECRET) { console.error("YAHOO_CLIENT_ID / YAHOO_CLIENT_SECRET が .env.local にありません"); process.exit(1); }

const REDIRECT_URI = "http://localhost:8502"; // Yahoo!デベロッパーネットワークに登録済みのコールバックURL
const PORT = 8502;
const state = crypto.randomUUID();
const authUrl =
  "https://auth.login.yahoo.co.jp/yconnect/v2/authorization" +
  `?response_type=code&client_id=${encodeURIComponent(CLIENT_ID)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=openid&state=${state}`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get("code");
  const gotState = url.searchParams.get("state");
  if (!code) { res.writeHead(404); res.end(); return; }
  if (gotState !== state) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h3>state不一致のため中止しました。スクリプトを再実行してください。</h3>");
    console.error("state 不一致（別の認可フローの応答）。再実行してください");
    process.exit(1);
  }
  try {
    const tr = await fetch("https://auth.login.yahoo.co.jp/yconnect/v2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
    });
    const tj = await tr.json();
    if (!tj.refresh_token) {
      res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h3>トークン取得に失敗しました。ターミナルを確認してください。</h3>");
      console.error("トークン取得失敗:", tj.error_description || tj.error || `HTTP ${tr.status}`);
      process.exit(1);
    }
    copyFileSync(ENV_PATH, ENV_PATH + ".bak");
    const current = readFileSync(ENV_PATH, "utf8");
    const next = /^YAHOO_REFRESH_TOKEN=.*$/m.test(current)
      ? current.replace(/^YAHOO_REFRESH_TOKEN=.*$/m, `YAHOO_REFRESH_TOKEN=${tj.refresh_token}`)
      : current + `\nYAHOO_REFRESH_TOKEN=${tj.refresh_token}\n`;
    writeFileSync(ENV_PATH, next, "utf8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h2>✅ Yahoo再認証が完了しました。このタブは閉じて大丈夫です。</h2>");
    console.log("✅ 新しい YAHOO_REFRESH_TOKEN を .env.local に保存しました（値は表示しません。旧内容は .env.local.bak）");
    setTimeout(() => process.exit(0), 500);
  } catch (e) {
    console.error("例外:", String(e?.message ?? e));
    process.exit(1);
  }
});
server.listen(PORT, () => {
  console.log("Yahoo再認証を開始します。ブラウザでログイン・同意してください（10分でタイムアウト）。");
  console.log("URLが開かない場合は手動で開いてください:\n" + authUrl);
  spawn("cmd", ["/c", "start", "", authUrl], { detached: true, stdio: "ignore" }).unref();
});
server.on("error", (e) => { console.error(`ポート${PORT}を使用できません: ${e.message}`); process.exit(1); });
setTimeout(() => { console.error("タイムアウト（10分）。再実行してください"); process.exit(1); }, 600_000);
