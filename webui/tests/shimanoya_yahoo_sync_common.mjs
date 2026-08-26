// しまのや 楽天→Yahoo 一括反映（2026-07-26）の共有ユーティリティ。
// 対象66件の管理番号・作業ディレクトリ・タイムアウト付き通信・Supabase 接続・所有者セッション発行をまとめる。
// 秘密値（アクセストークン / .env の値）は一切ログ・成果物へ出さない。
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { dbRowToProductInput } from "../lib/product/repository.ts";
import { getYahooConfig, getYahooAccessToken } from "../lib/yahoo/auth.ts";

/** ユーザー指定の対象66件（楽天商品管理番号）。2026-07-26 指示原文の並び。 */
export const TARGETS = [
  "r0101-1", "r0101-13", "r0101-15", "r1101-1", "r1101-3", "r1101-5", "r113-1", "r113-3", "r113-5", "r116-1",
  "r117-1", "r117-3", "r117-5", "r122-1", "r124", "r125-1", "r126-1", "r135-10-1", "r2201-3", "r3001-1",
  "r3001-3", "r3001-5", "r55-1", "r6190-1", "r6190-3", "r6190-5", "r6410-1", "r6410-2", "r6410-3", "r6410-5",
  "r6440-1", "r6510-1", "r6801-1", "r6801-3", "r6801-5", "r7111-1", "r7111-3", "r7111-5", "r7201-1", "r7201-2",
  "r7201-3", "r7201-5", "r74-1", "r7501-1", "r7501-3", "r7501-5", "r7801-1", "r7801-2", "r7801-3", "r7801-5",
  "r8389-1", "r8389-2", "r8389-3", "r8401-1", "r8401-3", "r8401-5", "r8601-1", "r8601-3", "r8601-5", "r8801-0",
  "r8801-2", "r8801-3", "r8901-1", "r9101-1", "s071-1132-1", "s071-1149-1",
];

export const ROOT = path.resolve(import.meta.dirname, "..", "..");
export const WORK_DIR = path.join(ROOT, ".codex-work", "shimanoya-yahoo-sync-20260726");
export const BACKUP_DIR = path.join(WORK_DIR, "backup");

/** per-call タイムアウト（ユーザー指示: 画像15s / API30s）。 */
export const API_TIMEOUT_MS = Number(process.env.API_TIMEOUT_MS || 30_000);
export const IMAGE_TIMEOUT_MS = Number(process.env.IMAGE_TIMEOUT_MS || 15_000);
/** 逐次処理のチャンクサイズ（10〜20件）。 */
export const CHUNK_SIZE = Math.min(20, Math.max(10, Number(process.env.CHUNK_SIZE || 15)));

export const BASE = process.env.BASE || "http://localhost:3001";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 成果物ディレクトリを作り、git 追跡から外す（商品データ・バックアップはコミット禁止）。 */
export function ensureWorkDir() {
  mkdirSync(BACKUP_DIR, { recursive: true });
  if (!existsSync(path.join(WORK_DIR, ".gitignore"))) writeFileSync(path.join(WORK_DIR, ".gitignore"), "*\n", "utf8");
  writeFileSync(path.join(BACKUP_DIR, ".gitignore"), "*\n", "utf8");
  return { WORK_DIR, BACKUP_DIR };
}

/** webui/.env.local を自前パースして process.env へ載せる（値は出力しない）。 */
export function loadEnv() {
  const envPath = new URL("../.env.local", import.meta.url);
  const env = readFileSync(envPath, "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
}

/** AbortController 付き fetch。タイムアウトは日本語メッセージの例外にして呼び出し側で failed 扱いにする。 */
export async function fetchWithTimeout(url, opts = {}, ms = API_TIMEOUT_MS, label = "") {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ac.signal });
  } catch (e) {
    if (e?.name === "AbortError") throw new Error(`タイムアウト(${ms}ms)${label ? ": " + label : ""}`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** signal を受け取れないライブラリ呼び出し（Yahoo クライアント等）用のタイムアウト。 */
export async function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`タイムアウト(${ms}ms): ${label}`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function getAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) throw new Error("Supabase 接続情報が .env.local にありません");
  return createClient(url, svc, { auth: { persistSession: false } });
}

/** 対象66件を DB の最新行へ解決する。manage 未解決分は missing に載せる（欠落を隠さない）。 */
export async function loadTargets(admin) {
  const { data: rows, error } = await admin.from("products").select("*");
  if (error) throw error;
  const linked = [];
  for (const row of rows) {
    let input;
    try {
      input = dbRowToProductInput(row);
    } catch {
      continue; // schema 不正な旧行は対象外（対象66件に該当すれば missing として検出される）
    }
    const manage = input.rakuten_manage_number || (input.mall_listed?.rakuten ? input.ne_code : null);
    linked.push({ row, input, manage: manage || "", neCode: input.ne_code });
  }
  linked.sort((a, b) => String(b.row.updated_at).localeCompare(String(a.row.updated_at)));
  const byManage = new Map();
  const byNeCode = new Map();
  for (const t of linked) {
    if (t.manage && !byManage.has(t.manage)) byManage.set(t.manage, t);
    if (t.neCode && !byNeCode.has(t.neCode)) byNeCode.set(t.neCode, t);
  }
  const found = new Map();
  const missing = [];
  for (const manage of TARGETS) {
    const hit = byManage.get(manage) ?? byNeCode.get(manage);
    if (hit) found.set(manage, { ...hit, manage, matchedBy: byManage.has(manage) ? "rakuten_manage_number" : "ne_code" });
    else missing.push(manage);
  }
  return { found, missing, allRows: rows };
}

/** 所有者ごとのログイン Cookie（RLS 対応。アプリのAPIルート経由で反映するため必要）。 */
export async function makeCookieFactory(admin) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
  const cache = new Map();
  return async function cookieFor(userId) {
    if (cache.has(userId)) return cache.get(userId);
    const user = list.users.find((u) => u.id === userId);
    if (!user) throw new Error("所有者ユーザーが見つかりません");
    const jar = new Map();
    const ssr = createServerClient(url, anon, {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)),
      },
    });
    const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email });
    await ssr.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
    const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
    cache.set(userId, cookie);
    return cookie;
  };
}

/** Yahoo 認証。失効時は再認証手順を案内する例外にする（トークン値は出さない）。 */
export async function yahooAuth() {
  const cfg = getYahooConfig();
  if (!cfg) {
    throw new Error("Yahoo 認証情報が未設定です（YAHOO_CLIENT_ID / YAHOO_CLIENT_SECRET / YAHOO_REFRESH_TOKEN / SELLER_ID）");
  }
  try {
    const token = await withTimeout(getYahooAccessToken(cfg), API_TIMEOUT_MS, "Yahooアクセストークン取得");
    return { cfg, token };
  } catch (e) {
    throw new Error(
      `${String(e?.message ?? e)} / リフレッシュトークン失効の可能性があります。` +
      `ユーザー操作が必要です: cd webui && npx tsx tests/yahoo_reauth.mjs（ブラウザでYahoo!ビジネスIDにログイン・同意）`,
    );
  }
}

/** 認証ブロックを機械可読に残す（レポートで「ユーザー操作が必要」を明示するため）。 */
export function writeAuthBlocked(phase, message) {
  ensureWorkDir();
  const file = path.join(WORK_DIR, "auth-blocked.json");
  writeJson(file, {
    blockedAt: new Date().toISOString(),
    phase,
    message,
    userActionRequired: "cd webui && npx tsx tests/yahoo_reauth.mjs を実行し、ブラウザで Yahoo! JAPAN ビジネスID にログイン・同意してください",
  });
  return file;
}

export function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export function readJson(file, fallback = null) {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

export function appendJsonl(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(value) + "\n", "utf8");
}

export function readJsonl(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

/** CSV 1セル（改行・引用符・カンマを安全化）。 */
export function csvCell(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return `"${s.replace(/"/g, '""').replace(/\r?\n/g, "\\n")}"`;
}

export function csvRow(cells) {
  return cells.map(csvCell).join(",");
}

/** getItem XML から単一タグ値（CDATA対応）。 */
export function xmlTag(xml, name) {
  const cdata = xml.match(new RegExp(`<${name}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${name}>`, "i"));
  if (cdata) return cdata[1];
  const plain = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`, "i"));
  return plain ? plain[1] : "";
}

/** getItem XML の Image + LibImage1..20（editItem の item_image_urls と同じ並び）。 */
export function xmlImageUrls(xml) {
  const urls = [];
  const main = xmlTag(xml, "Image");
  if (main) urls.push(main.trim());
  for (let i = 1; i <= 20; i++) {
    const v = xmlTag(xml, `LibImage${i}`).trim();
    if (v) urls.push(v);
  }
  return urls;
}

/** HTML 文字列内の <img src>（説明文に埋め込まれた画像の検査用）。 */
export function extractImgSrc(html) {
  const out = [];
  for (const m of String(html ?? "").matchAll(/<img\b[^>]*?\bsrc=["']([^"']+)["']/gi)) {
    const u = m[1].trim();
    if (/^https?:\/\//i.test(u)) out.push(u);
  }
  return out;
}

/** アプリDBの image_url_1..20（画像の元データ）。 */
export function dbImageUrls(input) {
  const out = [];
  for (let i = 1; i <= 20; i++) {
    const v = String(input[`image_url_${i}`] ?? "").trim();
    if (v) out.push(v);
  }
  const white = String(input.white_bg_image_url ?? "").trim();
  if (white) out.push(white);
  return out;
}

export function nowIso() {
  return new Date().toISOString();
}
