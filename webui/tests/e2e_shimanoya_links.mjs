// しまのや 公開リンク一覧（/links/shimanoya）の E2E リンク検証。
// 1) 未ログイン + スマホUA でページが開けること（公開・スマホ対応の確認。認証リダイレクトしない）
// 2) ページ埋め込みの #links-data JSON を読み、静的検査（書式異常・データ不備・重複）
// 3) 楽天/Yahoo の実ページへ HTTP アクセスし、リンク切れ・エラーページ・
//    掲載フラグとの不整合（掲載済なのに404 / 未掲載なのにページあり）を検出
// 使い方（webui ディレクトリ）:
//   node tests/e2e_shimanoya_links.mjs                 # フルチェック
//   node tests/e2e_shimanoya_links.mjs --skip-live     # 実ページアクセスなし（静的検査のみ）
//   node tests/e2e_shimanoya_links.mjs --limit=10      # 先頭10商品だけ（スモーク）
//   node tests/e2e_shimanoya_links.mjs --mall=rakuten  # 片モールのみ
//   node tests/e2e_shimanoya_links.mjs --delay=800     # リクエスト間隔ms（既定300）
//   node tests/e2e_shimanoya_links.mjs --report=logs/shimanoya_links.json  # JSONレポート保存
//   E2E_BASE=https://本番URL node tests/e2e_shimanoya_links.mjs
// 終了コード: 0=異常なし(警告のみ含む) / 1=NGあり / 2=前提エラー(ページが開けない等)
// 自己テスト用: E2E_URL_REWRITE="https://item.rakuten.co.jp=http://localhost:9999/r" のように
// 「実URL接頭辞=差し替え先」をカンマ区切りで指定すると、実ページチェックだけその宛先に飛ぶ
// （モールへ出られない CI でスクリプト自体を検証するためのフック。通常運用では未設定のまま）。

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const BASE = process.env.E2E_BASE || "http://localhost:3000";
const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.split("=").slice(1).join("=") : d;
};
const SKIP_LIVE = process.argv.includes("--skip-live");
const LIMIT = Number(arg("limit", "0")) || 0;
const MALL = arg("mall", "");
const DELAY_MS = Number(arg("delay", "300")) || 300;
const REPORT = arg("report", "");

// 実機ブラウザ相当の UA（スマホ）。bot 判定での誤ブロックを避ける。
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const ng = [];   // 明確な異常（exit 1）
const warn = []; // 要確認（exit 0 だが表示）
const okLog = [];
function logNg(msg) { ng.push(msg); console.log(`❌ ${msg}`); }
function logWarn(msg) { warn.push(msg); console.log(`⚠️  ${msg}`); }
function logOk(msg) { okLog.push(msg); console.log(`✅ ${msg}`); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// E2E_URL_REWRITE（自己テスト用フック）: 実ページチェックの宛先だけ差し替える
const URL_REWRITES = (process.env.E2E_URL_REWRITE || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((pair) => {
    const i = pair.indexOf("=");
    return i > 0 ? [pair.slice(0, i), pair.slice(i + 1)] : null;
  })
  .filter(Boolean);
function rewriteUrl(url) {
  for (const [from, to] of URL_REWRITES) {
    if (url.startsWith(from)) return to + url.slice(from.length);
  }
  return url;
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** 商品ページ1件の生死判定。status とエラーページ文言の両方を見る。
 * 戻り値 state: "alive" | "dead" | "ended"(取扱終了系) | "blocked"(判定不能) */
async function checkUrl(url, mall) {
  const target = rewriteUrl(url);
  const usingRewrite = target !== url;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(2000);
    let res;
    try {
      res = await fetchWithTimeout(target, {
        redirect: "follow",
        headers: {
          "User-Agent": MOBILE_UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "ja",
        },
      });
    } catch (e) {
      if (attempt === 0) continue; // ネットワーク断は1回だけリトライ
      return { state: "blocked", status: 0, detail: `fetch失敗: ${e.message}` };
    }
    const status = res.status;
    if (status === 429 || status === 403 || status >= 500) {
      if (attempt === 0) continue; // 一時ブロック/障害はリトライ
      return { state: "blocked", status, detail: `HTTP ${status}（bot対策/一時障害の可能性。手動確認推奨）` };
    }
    if (status === 404 || status === 410) return { state: "dead", status, detail: `HTTP ${status}` };
    if (status >= 400) return { state: "dead", status, detail: `HTTP ${status}` };

    const finalUrl = res.url || url;
    let body = "";
    try {
      body = await res.text();
    } catch {
      return { state: "alive", status, detail: "本文読込失敗（statusのみで判定）" };
    }

    if (mall === "rakuten") {
      // 楽天: 削除済みでも 200 のままエラーページ/検索ページへ誘導されるケースがある
      if (/お探しのページが見つかりません|ページが存在しないか|エラー｜楽天市場/.test(body)) {
        return { state: "dead", status, detail: "楽天エラーページ文言を検出" };
      }
      if (!usingRewrite && !/item\.rakuten\.co\.jp/.test(finalUrl)) {
        return { state: "dead", status, detail: `商品ページ外へリダイレクト: ${finalUrl}` };
      }
      if (/この商品は現在お取り扱いできません|販売期間終了|売り切れました/.test(body)) {
        return { state: "ended", status, detail: "取扱終了/売り切れ表示" };
      }
      return { state: "alive", status, detail: "" };
    }
    // Yahoo!ショッピング: 削除済みは基本 404。200 のエラーページ文言も併せて確認
    if (/お探しのページは見つかりませんでした|ページが見つかりません/.test(body)) {
      return { state: "dead", status, detail: "Yahooエラーページ文言を検出" };
    }
    if (/現在お取り扱いしておりません|販売を終了|在庫がありません/.test(body)) {
      return { state: "ended", status, detail: "取扱終了/在庫なし表示" };
    }
    return { state: "alive", status, detail: "" };
  }
  return { state: "blocked", status: 0, detail: "リトライ上限" };
}

async function main() {
  console.log(`=== しまのや 公開リンク一覧 E2E ===`);
  console.log(`BASE=${BASE} skipLive=${SKIP_LIVE} limit=${LIMIT || "all"} mall=${MALL || "both"} delay=${DELAY_MS}ms\n`);

  // 1) 未ログイン（cookieなし）+ スマホUA で公開ページが開けるか
  let pageRes;
  try {
    pageRes = await fetchWithTimeout(`${BASE}/links/shimanoya`, {
      redirect: "manual",
      headers: { "User-Agent": MOBILE_UA },
    });
  } catch (e) {
    console.error(`❌ ページ取得失敗: ${e.message}（dev サーバは起動していますか？）`);
    process.exit(2);
  }
  if (pageRes.status >= 300 && pageRes.status < 400) {
    console.error(`❌ 未ログインでリダイレクトされました（→ ${pageRes.headers.get("location")}）。公開になっていません`);
    process.exit(2);
  }
  if (pageRes.status !== 200) {
    console.error(`❌ ページが HTTP ${pageRes.status} を返しました`);
    process.exit(2);
  }
  const html = await pageRes.text();
  logOk(`公開ページ取得 (未ログイン・スマホUA): HTTP 200`);

  if (/<meta[^>]+name="viewport"/.test(html)) logOk("viewport meta あり（スマホ表示対応）");
  else logWarn("viewport meta が見つからない（スマホ表示を要確認）");

  // 2) 埋め込み JSON（#links-data）を読む
  const m = html.match(/<script[^>]*id="links-data"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) {
    console.error("❌ #links-data JSON がページ内に見つかりません");
    process.exit(2);
  }
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch (e) {
    console.error(`❌ #links-data の JSON 解析に失敗: ${e.message}`);
    process.exit(2);
  }
  let entries = data.entries ?? [];
  const brokenRows = data.brokenRows ?? [];
  logOk(`商品 ${entries.length}件 / データ不備 ${brokenRows.length}件 を取得 (生成 ${data.generatedAt})`);
  if (entries.length === 0) logNg("商品が0件です（しまのや s071 の商品が取得できていない）");
  if (LIMIT > 0) entries = entries.slice(0, LIMIT);

  // 3) 静的検査（ページ側で検出済みの problems + データ不備行）
  for (const b of brokenRows) logNg(`データ検証失敗: ${b.neCode} — ${b.message}`);
  for (const e of entries) for (const p of e.problems) logNg(`静的異常: ${e.neCode} — ${p}`);

  // 掲載フラグと URL の整合
  for (const e of entries) {
    if (e.rakutenListed && !e.rakutenUrl) logNg(`静的異常: ${e.neCode} — 楽天掲載フラグありなのに楽天URLが組み立てられない`);
    if (e.yahooListed && e.yahoo.length === 0) logNg(`静的異常: ${e.neCode} — Yahoo掲載フラグありなのにYahoo URLがない`);
  }

  // HTML のリンクと JSON の件数整合（表示とデータのズレ検知）
  const rakutenAnchors = (html.match(/data-mall="rakuten"/g) || []).length;
  const yahooAnchors = (html.match(/data-mall="yahoo"/g) || []).length;
  const allEntries = data.entries ?? [];
  const expectedRakuten = allEntries.filter((e) => e.rakutenUrl).length;
  const expectedYahoo = allEntries.reduce((n, e) => n + e.yahoo.length, 0);
  if (rakutenAnchors !== expectedRakuten) logNg(`表示不整合: 楽天リンク表示 ${rakutenAnchors} ≠ データ ${expectedRakuten}`);
  if (yahooAnchors !== expectedYahoo) logNg(`表示不整合: Yahooリンク表示 ${yahooAnchors} ≠ データ ${expectedYahoo}`);
  if (rakutenAnchors === expectedRakuten && yahooAnchors === expectedYahoo) {
    logOk(`リンク表示数の整合: 楽天 ${rakutenAnchors} / Yahoo ${yahooAnchors}`);
  }

  // 4) 実ページの生死チェック
  const results = [];
  if (!SKIP_LIVE) {
    // 同一URL（楽天の SKU 行分割 peers 等）は1回だけ叩く
    const targets = [];
    const seen = new Set();
    for (const e of entries) {
      if ((!MALL || MALL === "rakuten") && e.rakutenUrl && !seen.has(e.rakutenUrl)) {
        seen.add(e.rakutenUrl);
        targets.push({ neCode: e.neCode, mall: "rakuten", url: e.rakutenUrl, listed: e.rakutenListed });
      }
      if (!MALL || MALL === "yahoo") {
        for (const y of e.yahoo) {
          if (seen.has(y.url)) continue;
          seen.add(y.url);
          targets.push({ neCode: e.neCode, mall: "yahoo", url: y.url, listed: e.yahooListed });
        }
      }
    }
    console.log(`\n--- 実ページチェック: ${targets.length} URL（間隔 ${DELAY_MS}ms）---`);
    let i = 0;
    for (const t of targets) {
      i++;
      const r = await checkUrl(t.url, t.mall);
      results.push({ ...t, ...r });
      const tag = `[${i}/${targets.length}] ${t.neCode} ${t.mall}`;
      if (r.state === "alive") {
        if (!t.listed) logWarn(`${tag} 未掲載フラグなのに実ページあり: ${t.url}`);
        else logOk(`${tag} OK`);
      } else if (r.state === "ended") {
        logWarn(`${tag} 取扱終了/売り切れ表示: ${t.url} — ${r.detail}`);
      } else if (r.state === "blocked") {
        logWarn(`${tag} 判定不能: ${t.url} — ${r.detail}`);
      } else if (t.listed) {
        logNg(`${tag} リンク切れ（掲載済のはず）: ${t.url} — ${r.detail}`);
      } else {
        logOk(`${tag} 未掲載どおりページなし`);
      }
      await sleep(DELAY_MS);
    }
  } else {
    console.log("\n--- 実ページチェックはスキップ（--skip-live）---");
  }

  // 5) サマリ
  console.log(`\n=== 結果 ===`);
  console.log(`OK ${okLog.length} / NG ${ng.length} / 要確認 ${warn.length}`);
  if (ng.length) {
    console.log("\n[NG]");
    ng.forEach((x) => console.log(`  - ${x}`));
  }
  if (warn.length) {
    console.log("\n[要確認]");
    warn.forEach((x) => console.log(`  - ${x}`));
  }

  if (REPORT) {
    mkdirSync(dirname(REPORT), { recursive: true });
    writeFileSync(
      REPORT,
      JSON.stringify(
        { base: BASE, generatedAt: new Date().toISOString(), summary: { ok: okLog.length, ng: ng.length, warn: warn.length }, ng, warn, results },
        null,
        2,
      ),
    );
    console.log(`\nレポート保存: ${REPORT}`);
  }

  process.exit(ng.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("例外:", e);
  process.exit(2);
});
