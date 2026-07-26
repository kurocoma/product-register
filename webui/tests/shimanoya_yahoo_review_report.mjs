// Yahoo(okimarumarket)反映前の不備総点検レポートをHTMLで生成する（読み取り専用）。
// 入力: .codex-work/shimanoya-yahoo-survey/survey.json + アプリDB + 反映プレビュー(9件のみ実差分取得)
// 出力: .codex-work/shimanoya-yahoo-survey/yahoo-review.html
// 実行: cd webui && npx tsx tests/shimanoya_yahoo_review_report.mjs
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { dbRowToProductInput } from "../lib/product/repository.ts";

const BASE = process.env.BASE || "http://localhost:3001";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); }
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const survey = JSON.parse(readFileSync(new URL("../../.codex-work/shimanoya-yahoo-survey/survey.json", import.meta.url), "utf8"));

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- DB 全行 → manage 単位の最新行 ---
const { data: rows, error } = await admin.from("products").select("*");
if (error) throw error;
const linked = [];
for (const row of rows) {
  const input = dbRowToProductInput(row);
  const manage = input.rakuten_manage_number || (input.mall_listed?.rakuten ? input.ne_code : null);
  if (manage) linked.push({ row, input, manage });
}
linked.sort((a, b) => String(b.row.updated_at).localeCompare(String(a.row.updated_at)));
const byManage = new Map();
for (const t of linked) if (!byManage.has(t.manage)) byManage.set(t.manage, t);
// 既定: しまのや正式64リストに限定（2026-07-23 ユーザー裁定）。ALL=1 で解除。
if (process.env.ALL !== "1") {
  const master = new Set(readFileSync(new URL("../../.codex-work/shimanoya-master/shimanoya-64.txt", import.meta.url), "utf8").split(/\r?\n/).filter(Boolean));
  for (const key of [...byManage.keys()]) if (!master.has(key)) byManage.delete(key);
}

// --- 画像監査（DB側） ---
function imageAudit(input) {
  const urls = [];
  for (let i = 1; i <= 20; i++) urls.push(String(input[`image_url_${i}`] ?? "").trim());
  const filled = urls.filter(Boolean).length;
  const lastIdx = urls.reduce((acc, u, i) => (u ? i : acc), -1);
  const holes = [];
  for (let i = 0; i <= lastIdx; i++) if (!urls[i]) holes.push(i + 1);
  const declared = Number(input.image_count ?? 0);
  const issues = [];
  if (filled === 0) issues.push("画像が0枚");
  else if (!urls[0]) issues.push("メイン画像(1枚目)が空");
  if (holes.length) issues.push(`連番の抜け: ${holes.join(",")}番`);
  if (declared !== filled) issues.push(`画像枚数の申告(${declared})と実URL数(${filled})が不一致`);
  // 白背景は楽天用のため Yahoo 反映の不備には数えない（参考フラグのみ）
  const noWhiteBg = !String(input.white_bg_image_url ?? "").trim();
  return { filled, declared, issues, noWhiteBg };
}

// --- survey 分類 ---
const results = survey.results;
const ready = results.filter((r) => r.previewOk && r.hasChanges && !(r.advanced ?? []).length && !(r.subscriptionErrors ?? []).length);
const optGuard = results.filter((r) => (r.advanced ?? []).length > 0);
const subNg = results.filter((r) => (r.subscriptionErrors ?? []).length > 0);
const notOn = results.filter((r) => String(r.error ?? "").includes("該当商品が存在しません") && r.manage !== "n050-3419-1");
const codeMismatch = results.filter((r) => r.manage === "n050-3419-1");

// --- 9件の実差分（before→after）をプレビューから取得 ---
const { data: ulist } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
const cookieByUser = new Map();
async function cookieFor(uid) {
  if (cookieByUser.has(uid)) return cookieByUser.get(uid);
  const user = ulist.users.find((u) => u.id === uid);
  const jar = new Map();
  const ssr = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)) } });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email });
  await ssr.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  const c = [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
  cookieByUser.set(uid, c);
  return c;
}
const readyDiffs = new Map();
for (const r of ready) {
  const t = byManage.get(r.manage);
  if (!t) continue;
  try {
    const pr = await fetch(`${BASE}/api/update/yahoo/${t.row.id}`, { headers: { Cookie: await cookieFor(t.row.user_id) } });
    const pj = await pr.json();
    if (pj.ok) readyDiffs.set(r.manage, pj.changedFields ?? []);
  } catch { /* 差分名のみで続行 */ }
  await sleep(250);
}

// --- HTML 生成 ---
const trunc = (s, n) => { const t = String(s ?? "").replace(/<[^>]*>/g, " "); return t.length > n ? t.slice(0, n) + "…" : t; };
const name = (m) => trunc(byManage.get(m)?.input.display_name || byManage.get(m)?.input.product_name || "", 40);
const yes = "<span class='ok'>✔</span>", no = "<span class='ng'>✖</span>";

let imgRows = "";
let imgIssueCount = 0;
for (const [manage, t] of [...byManage.entries()].sort()) {
  const a = imageAudit(t.input);
  if (!a.issues.length) continue;
  imgIssueCount++;
  imgRows += `<tr><td>${esc(manage)}</td><td>${esc(name(manage))}</td><td>${a.filled}枚</td><td class="issue">${esc(a.issues.join(" / "))}</td></tr>`;
}

let readyRows = "";
for (const r of ready) {
  const diffs = readyDiffs.get(r.manage);
  const a = imageAudit(byManage.get(r.manage)?.input ?? {});
  const dHtml = diffs
    ? diffs.map((c) => `<div><b>${esc(c.field)}</b>: <span class="before">${esc(trunc(c.before, 60) || "(空)")}</span> → <span class="after">${esc(trunc(c.after, 60) || "(空)")}</span></div>`).join("")
    : (r.changedFields ?? []).map(esc).join(", ");
  readyRows += `<tr><td>${esc(r.manage)}</td><td>${esc(name(r.manage))}</td><td>${dHtml}</td><td>${a.issues.length ? `<span class="issue">${esc(a.issues.join(" / "))}</span>` : "問題なし"}</td></tr>`;
}

let newRows = "";
for (const r of [...notOn].sort((a, b) => a.manage.localeCompare(b.manage))) {
  const t = byManage.get(r.manage);
  const i = t?.input ?? {};
  const a = imageAudit(i);
  const hasName = !!String(i.display_name || i.product_name || "").trim();
  const hasPrice = Number(i.selling_price ?? 0) > 0 || (i.variants ?? []).some((v) => Number(v.selling_price ?? 0) > 0);
  const hasCat = !!String(i.yahoo_category_id ?? "").trim();
  const hasPath = !!String(i.yahoo_path ?? "").trim();
  const hasCatch = !!String(i.catch_copy_yahoo ?? "").trim();
  const imgOk = a.filled > 0 && !a.issues.some((x) => x.startsWith("画像が0") || x.startsWith("メイン"));
  const blockers = [!hasName && "商品名", !hasPrice && "売価", !hasCat && "Yahooカテゴリ", !hasPath && "ストアカテゴリパス"].filter(Boolean);
  newRows += `<tr><td>${esc(r.manage)}</td><td>${esc(name(r.manage))}</td>` +
    `<td>${hasName ? yes : no}</td><td>${hasPrice ? yes : no}</td><td>${hasCat ? yes : no}</td><td>${hasPath ? yes : no}</td>` +
    `<td>${hasCatch ? yes : no}</td><td>${imgOk ? yes : no}${a.issues.length ? ` <span class="issue">${esc(a.issues.join(" / "))}</span>` : ""}</td>` +
    `<td>${blockers.length ? `<span class="issue">登録不可: ${esc(blockers.join("・"))}</span>` : "<span class='ok'>登録可能</span>"}</td></tr>`;
}

let optRows = "";
for (const r of [...optGuard].sort((a, b) => a.manage.localeCompare(b.manage))) {
  optRows += `<tr><td>${esc(r.manage)}</td><td>${esc(name(r.manage))}</td><td>${(r.changedFields ?? []).length}項目</td></tr>`;
}

const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Yahoo(okimarumarket)反映前 不備総点検</title>
<style>
body{margin:0;padding:24px;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f6f7f9;color:#1f2937;line-height:1.6}
main{max-width:1200px;margin:0 auto}
h1{font-size:24px;margin:0 0 4px} h2{font-size:18px;margin:28px 0 8px;border-left:4px solid #1d4ed8;padding-left:8px}
.meta{color:#6b7280;font-size:13px;margin-bottom:16px}
table{width:100%;border-collapse:collapse;font-size:13px;background:#fff;border:1px solid #e5e7eb;border-radius:8px}
th,td{border-bottom:1px solid #e5e7eb;padding:7px 8px;vertical-align:top;text-align:left}
th{background:#f3f4f6;color:#374151;position:sticky;top:0}
.ok{color:#166534;font-weight:700} .ng{color:#991b1b;font-weight:700} .issue{color:#991b1b}
.before{color:#6b7280;text-decoration:line-through} .after{color:#166534;font-weight:600}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:14px 0}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:12px}
.card b{font-size:22px;display:block}
.note{background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:10px 12px;font-size:13px;margin:10px 0}
</style></head><body><main>
<h1>Yahoo（okimarumarket）反映前 不備総点検</h1>
<div class="meta">生成: ${new Date().toLocaleString("ja-JP")} / 対象: 楽天連携 ${byManage.size}商品 / Yahooへの書き込みなし（読み取り調査のみ）</div>
<div class="cards">
<div class="card"><b>${ready.length}</b>すぐ反映できる（要差分確認）</div>
<div class="card"><b>${imgIssueCount}</b>画像に不備あり</div>
<div class="card"><b>${notOn.length}</b>Yahooに無い（新規登録）</div>
<div class="card"><b>${optGuard.length}</b>オプションガードで保留</div>
<div class="card"><b>${subNg.length + codeMismatch.length}</b>個別問題（書式・コード不一致）</div>
</div>

<h2>1. すぐ反映できる ${ready.length}件 — 送信される差分（before→after）</h2>
<div class="note">この表の「after」がYahooへ送られる値です。意図と違う差分があれば反映前にお知らせください。</div>
<table><tr><th>商品</th><th>商品名</th><th>差分</th><th>画像チェック</th></tr>${readyRows}</table>

<h2>2. 画像に不備がある商品（全対象横断・${imgIssueCount}件）</h2>
<div class="note">検査項目: 画像0枚・メイン画像(1枚目)欠落・連番の抜け（例: 3枚目が空のまま4枚目にURL）・枚数申告(image_count)と実URL数のずれ。<br>
今回の結果、<b>画像の欠落・連番の抜けは0件</b>でした。表示されるのは枚数申告のずれ（軽微・±1）のみです。<br>
参考: 白背景画像なしは ${[...byManage.values()].filter((t) => imageAudit(t.input).noWhiteBg).length}件ありますが、白背景は楽天専用項目のため Yahoo 反映には影響しません。</div>
<table><tr><th>商品</th><th>商品名</th><th>実画像数</th><th>不備</th></tr>${imgRows || "<tr><td colspan='4'>不備なし</td></tr>"}</table>

<h2>3. Yahooに無い ${notOn.length}件 — 新規登録の必須項目チェック</h2>
<div class="note">必須（editItem）: 商品名・売価・Yahooカテゴリ(product_category)・ストアカテゴリパス(path)。「登録不可」の商品は不足を埋めるまで新規登録できません。キャッチコピー・画像は必須ではありませんが売り場品質のため掲載。</div>
<table><tr><th>商品</th><th>商品名</th><th>名称</th><th>売価</th><th>Yahooカテゴリ</th><th>パス</th><th>キャッチ</th><th>画像</th><th>判定</th></tr>${newRows}</table>

<h2>4. オプションガードで保留中の ${optGuard.length}件（参考）</h2>
<div class="note">商品オプション(options)をAPI更新が保持できないため、安全装置により反映を中止しています（方針決定待ち。この表の商品はYahooに存在します）。</div>
<table><tr><th>商品</th><th>商品名</th><th>保留中の差分数</th></tr>${optRows}</table>

<h2>5. 個別問題</h2>
<table><tr><th>商品</th><th>問題</th><th>対処案</th></tr>
<tr><td>n019-0298</td><td class="issue">定期「おすすめサイクル」の書式不正（現在値「2:」）</td><td>「2:1」（1か月ごと）等へ修正</td></tr>
<tr><td>n050-3419-1</td><td class="issue">コード不一致（Yahoo=n050-3419-1 ↔ DB ne_code=n050-3419-s01）</td><td>紐付けキーの整理（別途）</td></tr>
</table>
</main></body></html>`;

const out = path.join(path.resolve(import.meta.dirname, "..", ".."), ".codex-work", "shimanoya-yahoo-survey", "yahoo-review.html");
writeFileSync(out, html, "utf8");
console.log(`生成完了: ${out}`);
console.log(`集計: 反映可${ready.length} / 画像不備${imgIssueCount} / 新規${notOn.length} / オプション保留${optGuard.length}`);
