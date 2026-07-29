#!/usr/bin/env node
// NE（ネクストエンジン）商品マスタの自動ダウンロード（Playwright）。
//
//   node scripts/ne-master-download.mjs --targets ne-syohin,ne-set,ne-himoduke --out-dir <dir> [--json] [--headed]
//   node scripts/ne-master-download.mjs --probe [--json]      ← 非破壊の診断モード（CSVは落とさない）
//
// 対象定義（DOM 手掛かり）と1ページ件数の正本は lib/ne-master/auto-download.ts。
// Next サーバーが env を解決して `--target-defs` / `--page-items` で渡す。
// CLI 単体起動時のみ ne-master-defaults.mjs のフォールバックを使う（両者はテストで一致を固定）。
//
// 取得手順（依頼ノートの操作をそのまま自動化）:
//   商品管理 https://main.next-engine.com/User_Syohin_Search
//   1. 「詳細検索」→ 2. 「検索する対象」を選択（商品情報単位 / セット商品情報単位 / ページ情報単位）→ 検索
//   3. 総件数（data-entries →「全N件中…」表記 → 不明）から必要ページ数を判定し、ページごとに
//   4. 全チェック → 5. ダウンロード（別ウィンドウ/ポップオーバー）→ 6. 「商品管理」ラジオを確認
//   7. 「項目選択へ」→ 全チェック → 対象CSVの「ダウンロード」
// 1ページ最大1000件のため、1000件超は2ページ目以降も同手順で取得する。
// 例外: 紐づけ表（ne-himoduke）は検索一覧に存在せず、専用ページ
//   設定＞商品＞商品コード紐づけ https://main.next-engine.com/Userhimoduke
// の「【1】商品コード紐づけCSVダウンロード」ボタンで直接取得する（店舗未選択＝全店舗一括。
// ページネーション無しの1ファイルで全件が落ちる。2026-07-30 実機スクリーンショットで確定）。
// 総件数を解決できないときは「1ページ＝全件」と決めつけず、1ページ目が満杯なら続きを探索し、
// 結果には entriesUnknown を立てて取込側（route/UI）に自動取込をブロックさせる。
// ページ結合（ヘッダー統合）は呼び出し側（lib/ne-master/auto-download.ts の mergeCsvPages）が行う。
//
// --probe: 検索対象3種 ×「店舗選択」ラジオ各値で項目選択画面まで進み、
//   画面上の data-file-name / パネル見出し / ページャの実装（ul.pagination の中身）を JSON で列挙する。
//   ダウンロードは一切行わない。紐づけ表がどの検索対象の配下にあるかを1回の実走で確定するための診断。
//
// ログインは obsidian ne-playwright-reuse-guide.md の流儀:
//   base.next-engine.org でログイン →「メイン機能」リンクを踏んで main セッションを確立
//   （main への直URLは base にリダイレクトされる）。storage state を再利用する。
// 資格情報は環境変数 NEXT_ENGINE_LOGIN_ID / NEXT_ENGINE_PASSWORD を優先し、
// 無ければ認証情報 Excel（NEXT_ENGINE_CREDENTIAL_PATH）から読む。実値はコードに書かない。

import { chromium } from "playwright";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  domSelectSearchTarget,
  domReadSearchResult,
  domReadPagination,
  domMaximizePageSize,
  domRemoveBackdrops,
  domListTenpoRadios,
  domSelectShohinKanri,
  domExpandPanels,
  domCheckAllCheckboxes,
  domListDownloadTargets,
  domListPanelHeadings,
  domFindDownloadTarget,
} from "./ne-dom-helpers.mjs";
import {
  NE_PAGE_ITEMS_DEFAULT as PAGE_ITEMS_FALLBACK,
  DEFAULT_TARGET_DEFS,
  probeSearchTargetsFromDefs,
  resolveTotalEntries,
  evaluateSearchResultReadiness,
  describePaginationLinks,
} from "./ne-master-defaults.mjs";

const LOGIN_URL = "https://base.next-engine.org/users/sign_in/";
const PLATFORM_URL = "https://base.next-engine.org/";
const SYOHIN_SEARCH_URL = "https://main.next-engine.com/User_Syohin_Search";

const NAV_TIMEOUT = num(process.env.KURIMA_NAV_TIMEOUT_MS, 60000);
const DL_TIMEOUT = num(process.env.KURIMA_DOWNLOAD_TIMEOUT_MS, 90000);
// 一括DL画面の出現待ち。別ウィンドウ／同一ページのポップオーバーの **先着** で進むため、
// この値は「どちらも出てこなかったとき」にだけ効く（毎回の固定待ちにはならない）。
const SURFACE_TIMEOUT = num(process.env.NE_MASTER_SURFACE_TIMEOUT_MS, 10000);
const MAX_PAGES = num(process.env.NE_MASTER_MAX_PAGES, 20); // 暴走防止
const DEADLINE_MS = num(process.env.NE_MASTER_DEADLINE_MS, 20 * 60 * 1000); // 自己 kill（親の kill が届かない場合の保険）
const PROBE_MAX_TENPO = num(process.env.NE_PROBE_MAX_TENPO, 8);
const ATTEMPTS = 3;

const CHROMIUM_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

// ---------------------------------------------------------------------------
// CLI / ログ
// ---------------------------------------------------------------------------

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
}
function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const JSON_MODE = process.argv.includes("--json");
const PROBE_MODE = process.argv.includes("--probe");
/**
 * 1ページあたりの既定件数。正本は lib の NE_PAGE_ITEMS_DEFAULT（`--page-items` で渡る）。
 * CLI 単体起動時のみ ne-master-defaults.mjs の値にフォールバックする。
 */
const NE_PAGE_ITEMS_DEFAULT = num(arg("page-items"), PAGE_ITEMS_FALLBACK);
const HEADED = process.argv.includes("--headed") || /^(0|false|no|off)$/i.test(process.env.NEXT_ENGINE_HEADLESS ?? "");

function emit(event) {
  if (JSON_MODE) process.stdout.write(JSON.stringify(event) + "\n");
  const label = event.key ? `[${event.key}] ` : "";
  process.stderr.write(`${label}${event.message ?? event.type}\n`);
}
const progress = (message, key) => emit({ type: "progress", ...(key ? { key } : {}), message });

/** 対象定義を CLI 引数（正本）から読む。壊れていたら既定値へフォールバックする。 */
function loadTargetDefs() {
  const raw = arg("target-defs");
  if (!raw) return DEFAULT_TARGET_DEFS;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch {
    progress("--target-defs を解釈できませんでした。既定の対象定義で続行します");
  }
  return DEFAULT_TARGET_DEFS;
}

// ---------------------------------------------------------------------------
// 資格情報（環境変数 → 認証情報 Excel フォールバック。実値はログに出さない）
// ---------------------------------------------------------------------------

const DEFAULT_CREDENTIAL_PATH = path.join(
  os.homedir(),
  "開発案件",
  "日別売上集計データダウンロード",
  "docs",
  "ID・PW.xlsx",
);

function decodeXml(s) {
  return String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

/** xlsx を最小限だけ読む（A列サイト名 / B列ID / C列PW の表を想定）。openpyxl 相当を jszip で。 */
async function readXlsxRows(file) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await readFile(file));
  const sharedXml = (await zip.file("xl/sharedStrings.xml")?.async("string")) ?? "";
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1])).join(""),
  );
  const sheetName = Object.keys(zip.files)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort()[0];
  if (!sheetName) return [];
  const sheetXml = await zip.file(sheetName).async("string");
  const rows = [];
  for (const rowM of sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = {};
    for (const cM of rowM[1].matchAll(/<c\s([^>]*)>([\s\S]*?)<\/c>/g)) {
      const col = (cM[1].match(/r="([A-Z]+)\d+"/) || [])[1];
      const type = (cM[1].match(/t="([^"]+)"/) || [])[1];
      const v = (cM[2].match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      const inline = (cM[2].match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/) || [])[1];
      let value = "";
      if (type === "s" && v != null) value = shared[Number(v)] ?? "";
      else if (inline != null) value = decodeXml(inline);
      else if (v != null) value = decodeXml(v);
      if (col) cells[col] = value;
    }
    rows.push(cells);
  }
  return rows;
}

async function loadCredential() {
  const id = process.env.NEXT_ENGINE_LOGIN_ID;
  const pw = process.env.NEXT_ENGINE_PASSWORD;
  if (id && pw) return { loginId: id, password: pw, source: "env" };

  const file = process.env.NEXT_ENGINE_CREDENTIAL_PATH || DEFAULT_CREDENTIAL_PATH;
  if (!existsSync(file)) {
    throw new Error(
      "Next Engine の認証情報が見つかりません。環境変数 NEXT_ENGINE_LOGIN_ID / NEXT_ENGINE_PASSWORD を設定するか、" +
        `NEXT_ENGINE_CREDENTIAL_PATH に認証情報Excelのパスを指定してください（探索先: ${file}）`,
    );
  }
  const rows = await readXlsxRows(file);
  for (const r of rows.slice(1)) {
    if ((r.A ?? "").trim() !== "ネクストエンジン") continue;
    const loginId = (r.B ?? "").trim();
    const password = (r.C ?? "").trim();
    if (loginId && password) return { loginId, password, source: "excel" };
  }
  throw new Error(`認証情報Excelに「ネクストエンジン」の行が見つかりません: ${file}`);
}

// ---------------------------------------------------------------------------
// 汎用ヘルパー（原本 next_engine_downloader.py の流儀を踏襲）
// ---------------------------------------------------------------------------

let artifactDir = null;

/**
 * ne-dom-helpers.mjs の純DOM関数をページ内で実行する。
 * 関数ソースを文字列として送るため、helper 側は self-contained（外部識別子参照なし）である必要がある。
 *
 * 一括ダウンロードの各段（店舗選択→項目選択）は**同一ページのナビゲーションで進む**ため、
 * 遷移中に evaluate すると "Execution context was destroyed" で落ちる（2026-07-30 実機）。
 * 遷移由来のエラーに限り、読み込み完了を待って再試行する。
 */
const CONTEXT_LOST = /Execution context was destroyed|Cannot find context|frame was detached|Target closed|navigating/i;

async function domEval(target, fn, ...args) {
  const tail = args.map((a) => ", " + JSON.stringify(a === undefined ? null : a)).join("");
  const expr = `(${fn.toString()})(document${tail})`;
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await target.evaluate(expr);
    } catch (e) {
      if (!CONTEXT_LOST.test(e?.message ?? String(e))) throw e;
      lastError = e;
      await target.waitForLoadState?.("domcontentloaded", { timeout: NAV_TIMEOUT }).catch(() => {});
      await target.waitForTimeout?.(700);
    }
  }
  throw lastError;
}

async function saveArtifacts(page, label) {
  if (!artifactDir || !page || page.isClosed?.()) return [];
  const ts = new Date().toISOString().replace(/[:.]/g, "").replace("T", "_").slice(0, 15);
  const safe = String(label).replace(/[^A-Za-z0-9_-]/g, "_");
  const out = [];
  try {
    const p = path.join(artifactDir, `${ts}_${safe}.png`);
    await page.screenshot({ path: p, fullPage: true });
    out.push(p);
  } catch {
    /* 証跡は取れなくても本処理を止めない */
  }
  try {
    const p = path.join(artifactDir, `${ts}_${safe}.html`);
    await writeFile(p, await page.content(), "utf8");
    out.push(p);
  } catch {
    /* 同上 */
  }
  return out;
}

async function removeBackdrops(page) {
  await domEval(page, domRemoveBackdrops).catch(() => {});
}

/**
 * 候補セレクタのうち、実際に「表示されるまで待って」最初に見えたものを返す。
 * `locator.isVisible({timeout})` は timeout を無視して即時判定するため使わない（待ちが効かないバグの元）。
 */
async function firstVisible(page, selectors, timeout = 2500) {
  const per = Math.max(250, Math.floor(timeout / Math.max(1, selectors.length)));
  for (const sel of selectors) {
    const loc = page.locator(sel);
    try {
      await loc.first().waitFor({ state: "visible", timeout: per });
    } catch {
      continue; // この候補は出てこなかった
    }
    // 同じセレクタで複数ヒットするときは可視な最初の1つを選ぶ
    const n = await loc.count().catch(() => 0);
    for (let i = 0; i < n; i++) {
      const c = loc.nth(i);
      if (await c.isVisible().catch(() => false)) return c;
    }
  }
  return null;
}

async function clickFirstVisible(page, selectors, label, { optional = false, timeout = 2500 } = {}) {
  const loc = await firstVisible(page, selectors, timeout);
  if (!loc) {
    if (optional) return false;
    await saveArtifacts(page, `click_${label}`);
    throw new Error(`${label} をクリックできませんでした（候補: ${selectors.join(" / ")}）`);
  }
  await loc.click({ timeout: NAV_TIMEOUT });
  return true;
}

/**
 * select は select_option / fill では効かない（NEはJSで再描画するため）。
 * option の表示テキスト一致で selected を立て、change を bubbles 付きで dispatch する。
 */
async function setSelectByOptionTexts(page, texts, preferredSelector) {
  const res = await domEval(page, domSelectSearchTarget, texts, preferredSelector ?? null);
  if (!res.ok) {
    await saveArtifacts(page, "select_not_found");
    throw new Error(
      `「${texts.join(", ")}」を持つ select が見つかりません（画面上の選択肢: ` +
        `${(res.available ?? []).map((a) => a.join("/")).join(" | ") || "なし"}）`,
    );
  }
  return res;
}

function autoAcceptDialogs(page) {
  page.on("dialog", (d) => d.accept().catch(() => {}));
}

const isNewsPage = (p) => p.url().includes("/Usernotice/news");

// ---------------------------------------------------------------------------
// ログイン（base → main セッション確立）
// ---------------------------------------------------------------------------

async function dismissCookieBanner(page) {
  const consent = await firstVisible(page, ["#cm-acceptAll", "button:has-text('同意します')"], 2500);
  if (consent) {
    await consent.click().catch(() => {});
    await page.waitForTimeout(500);
  }
  await domEval(page, domRemoveBackdrops).catch(() => {});
}

async function dismissNewsPage(page) {
  const loc = await firstVisible(
    page,
    [
      "button:has-text('あとで見る')",
      'button.markasread[data-newsonly="1"]',
      "a:has-text('すべて既読にする')",
      "button:has-text('すべて既読にする')",
    ],
    1500,
  );
  if (loc) {
    await loc.click().catch(() => {});
    await page.waitForTimeout(1000);
  }
}

async function closeExtraNewsPages(context, keep) {
  for (const p of context.pages()) {
    if (p === keep || p.isClosed()) continue;
    if (!isNewsPage(p)) continue;
    await dismissNewsPage(p).catch(() => {});
    await p.close().catch(() => {});
  }
}

/** 「メイン機能」リンク経由でしか main.next-engine.com のセッションは確立できない（直URLは base へ戻される）。 */
async function openMainFunction(context, page) {
  const link = await firstVisible(page, ["a:has-text('メイン機能')", "role=link[name='メイン機能']"], 8000);
  if (!link) return false;
  const popupPromise = context.waitForEvent("page", { timeout: 15000 }).catch(() => null);
  await link.click().catch(() => {});
  const popup = await popupPromise;
  if (popup && popup !== page) {
    await popup.waitForLoadState("domcontentloaded", { timeout: NAV_TIMEOUT }).catch(() => {});
    await popup.waitForTimeout(1500);
    await popup.close().catch(() => {});
  } else {
    await page.waitForLoadState("domcontentloaded", { timeout: NAV_TIMEOUT }).catch(() => {});
    await page.waitForTimeout(2000);
  }
  return true;
}

async function login(context, page, credential) {
  progress("NE にログインしています");
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
  await page.waitForTimeout(1500);
  await dismissCookieBanner(page);

  const loginInput = await firstVisible(page, ["#user_login_code"], 5000);
  if (loginInput) {
    await loginInput.fill(credential.loginId);
    await page.locator("#user_password").fill(credential.password);
    await page.locator('input[name="commit"]').click();
    await page.waitForLoadState("domcontentloaded", { timeout: NAV_TIMEOUT }).catch(() => {});
    await page.waitForTimeout(2000);
    if (isNewsPage(page)) {
      await dismissNewsPage(page);
      await page.goto(PLATFORM_URL, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT }).catch(() => {});
      await page.waitForTimeout(1000);
    } else {
      await dismissNewsPage(page);
    }
  } else {
    progress("保存済みセッションを再利用します");
  }

  await closeExtraNewsPages(context, page);
  await removeBackdrops(page);
  await openMainFunction(context, page); // main セッション確立（最重要）
  await closeExtraNewsPages(context, page);
}

// ---------------------------------------------------------------------------
// 商品検索ページ
// ---------------------------------------------------------------------------

/**
 * main.next-engine.com 配下のページを開く（base リダイレクト＝セッション未確立なら
 * 「メイン機能」を踏み直して再試行）。readySelectors のどれかが見えたら成功。
 */
async function gotoMainPage(context, page, credential, url, readySelectors, label) {
  const slug = String(label).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40);
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT }).catch(() => {});
    await page.waitForTimeout(1000);
    await dismissCookieBanner(page);
    if (isNewsPage(page)) await dismissNewsPage(page);

    const onMain = page.url().includes("main.next-engine.com");
    const ready = (await firstVisible(page, readySelectors, 8000)) != null;
    if (onMain && ready) return;

    // base へリダイレクトされた＝main セッション未確立。「メイン機能」を踏み直す。
    progress(`${label}に入れませんでした（${attempt}/${ATTEMPTS}）。メイン機能を踏み直します`);
    await saveArtifacts(page, `goto_${slug}_retry${attempt}`);
    await page.goto(PLATFORM_URL, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT }).catch(() => {});
    await page.waitForTimeout(1000);
    if (!(await openMainFunction(context, page))) {
      await login(context, page, credential); // セッション切れ（ログイン画面に落ちた）
    }
  }
  await saveArtifacts(page, `goto_${slug}_failed`);
  throw new Error(`${label}（${url}）を開けませんでした。NE のセッション確立に失敗しています。`);
}

async function gotoSyohinSearch(context, page, credential) {
  await gotoMainPage(
    context,
    page,
    credential,
    SYOHIN_SEARCH_URL,
    ["#btn_search_item", "button.btn-search-item"],
    "商品管理ページ",
  );
}

/** 一覧の表示件数プルダウンがあれば最大（通常1000）にする。無い画面では何もしない。 */
async function ensurePageSizeMax(page) {
  const res = await domEval(page, domMaximizePageSize).catch(() => ({ changed: false }));
  if (res?.changed) await page.waitForTimeout(1500);
  return !!res?.changed;
}

/** 「詳細検索」を開き、「検索する対象を選択」を目的の単位に切り替える（依頼手順 1〜2）。 */
async function openSearchDialog(page, searchTargetTexts) {
  await removeBackdrops(page);
  await clickFirstVisible(
    page,
    ["#btn_search_item", "button.btn-search-item", "button:has-text('詳細検索')"],
    "詳細検索ボタン",
    { timeout: 8000 },
  );
  await page.waitForSelector("#modal_search_item, .modal-search-dialog", { state: "visible", timeout: NAV_TIMEOUT });
  await page.waitForTimeout(500);
  await setSelectByOptionTexts(page, searchTargetTexts, 'select[name="select_target"]');
  await page.waitForTimeout(500);
}

async function clickSearch(page) {
  await removeBackdrops(page);
  const ok = await clickFirstVisible(
    page,
    [
      '#modal_search_item button:text-is("検索")',
      '#modal_search_item input[value="検索"]',
      "#modal_search_item #btn_search",
      "#modal_search_item .modal-footer .btn-primary",
      '.modal-search-dialog button:text-is("検索")',
    ],
    "検索ボタン",
    { optional: true, timeout: 5000 },
  );
  if (!ok) {
    // モーダル内で見つからないときはフォーム送信で代替（ボタンIDの揺れ対策）
    const submitted = await page
      .evaluate(() => {
        const f = document.querySelector("#modal_search_item_form");
        if (!f) return false;
        f.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        return true;
      })
      .catch(() => false);
    if (!submitted) {
      await saveArtifacts(page, "search_button_not_found");
      throw new Error("詳細検索ダイアログの「検索」ボタンが見つかりませんでした");
    }
  }
}

/**
 * 検索結果が**実際に入る**まで待ち、ページング情報を返す。
 *
 * NE の結果コンテナは検索前から display:block で存在し、検索直後は「全775件中0-0を表示」の
 * ように件数表記だけ先に入る。可視になった瞬間を結果と見なすと 0件エラーになるか、
 * 行が無いまま全チェック→ダウンロードへ進んでナビゲーションで壊れる（2026-07-30 実機）。
 * 判定は evaluateSearchResultReadiness（純ロジック・単体テスト済み）に委ねる。
 */
async function waitForResult(page, containerIds) {
  const deadline = Date.now() + NAV_TIMEOUT;
  let info = null;
  while (Date.now() < deadline) {
    const observed = await domEval(page, domReadSearchResult, containerIds).catch(() => null);
    if (observed) info = observed;
    if (evaluateSearchResultReadiness(observed).settled) return observed;
    await page.waitForTimeout(500);
  }
  if (!info) {
    await saveArtifacts(page, "search_result_timeout");
    throw new Error("検索結果の表示を待てませんでした（タイムアウト）");
  }
  // 確定しないままタイムアウト。最後の観測を返し、呼び出し側の0件判定（診断つき）に委ねる。
  progress(
    `検索結果が確定しないままタイムアウトしました（${evaluateSearchResultReadiness(info).reason}）: ` +
      `container=${info.containerId ?? "なし"} / 行数=${info.rowCount ?? "不明"} / 件数表記=${info.countText || "なし"}`,
  );
  return info;
}

/**
 * ページ N へ移動する。番号リンク → ページ番号入力 →「→」の順に試し、
 * `data-current-page` が N になったことを **必ず確認** する。確認できなければ throw（1ページ目を再取得して
 * 「取れたつもり」になる事故を防ぐ）。
 */
async function gotoListPage(page, containerId, n) {
  await removeBackdrops(page);
  const before = await domEval(page, domReadPagination, containerId).catch(() => null);

  const numberSelectors = [
    `#${containerId}-pagination-top ul.pagination a:text-is("${n}")`,
    `#${containerId}-pagination-top a[data-page="${n}"]`,
    `#${containerId}-pagination-top button[data-page="${n}"]`,
    `#${containerId}-pagination-top a:text-is("${n}")`,
    `#${containerId} .ne-table-pagination a:text-is("${n}")`,
  ];
  let moved = await clickFirstVisible(page, numberSelectors, `${n}ページ目へのリンク`, {
    optional: true,
    timeout: 3000,
  });

  // 番号リンクが無い実装（ページ番号入力＋矢印）に対応する
  if (!moved) {
    const input = await firstVisible(
      page,
      [`#${containerId}-pagination-top input[type="text"]`, `#${containerId}-pagination-top input[type="number"]`],
      1500,
    );
    if (input) {
      await input.fill(String(n)).catch(() => {});
      await input.press("Enter").catch(() => {});
      moved = true;
    }
  }
  if (!moved && before?.currentPage != null && n === before.currentPage + 1) {
    moved = await clickFirstVisible(
      page,
      [
        `#${containerId}-pagination-top a:text-is("→")`,
        `#${containerId}-pagination-top button:text-is("→")`,
        `#${containerId}-pagination-top a.next`,
        `#${containerId}-pagination-top a[rel="next"]`,
      ],
      `${n}ページ目（次へ）`,
      { optional: true, timeout: 3000 },
    );
  }
  if (!moved) {
    await saveArtifacts(page, `pagination_link_not_found_p${n}`);
    // 自己解決できるよう、probe と同じ収集結果（ページャの実体）をそのままメッセージに載せる。
    throw new Error(
      `${n}ページ目へ移動する操作要素が見つかりませんでした（現在ページ: ${before?.currentPage ?? "不明"}）。` +
        `ページャの実体: ${describePaginationLinks(before?.links)}。` +
        `生データ: ${JSON.stringify(before?.links ?? []).slice(0, 1500)}。` +
        "この出力（または `--probe`）でセレクタを確認してください。",
    );
  }

  const ok = await page
    .waitForFunction(
      ({ id, target }) => {
        const p = document.getElementById(`${id}-pagination-top`);
        return !!p && Number(p.getAttribute("data-current-page")) === target;
      },
      { id: containerId, target: n },
      { timeout: NAV_TIMEOUT },
    )
    .then(() => true)
    .catch(() => false);
  if (!ok) {
    const after = await domEval(page, domReadPagination, containerId).catch(() => null);
    await saveArtifacts(page, `pagination_not_moved_p${n}`);
    throw new Error(
      `${n}ページ目への遷移を確認できませんでした（現在ページ: ${after?.currentPage ?? "不明"}）。` +
        "同じページを二重取得する事故を避けるため中止します。",
    );
  }
  await page.waitForTimeout(1500);
}

// ---------------------------------------------------------------------------
// 一括ダウンロード（別ウィンドウ／ポップオーバー）
// ---------------------------------------------------------------------------

/** 一覧の「全チェック」を押す（依頼手順 4）。 */
async function checkAllRows(page, containerId) {
  await removeBackdrops(page);
  await clickFirstVisible(
    page,
    [`#${containerId} button.ne-table-check-all`, "button.ne-table-check-all", "button:has-text('全チェック')"],
    "一覧の全チェックボタン",
    { timeout: 8000 },
  );
  await page.waitForTimeout(500);
}

/** 一括ダウンロード画面（同一ページのポップオーバー実装）が出たと判断できるセレクタ。 */
const BULK_SURFACE_SELECTOR =
  '.ne-table-download-popover, .ne-table-popover, form[name="select_column"], input[name="tenpo_code_list[]"], button.download[data-file-name]';

/** 先に「真値」を返したものを採用する race（片方が失敗しても、もう片方の成立を待てる）。 */
function firstTruthy(promises, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let pending = promises.length;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    for (const p of promises) {
      Promise.resolve(p).then(
        (v) => (v ? finish(v) : --pending === 0 && finish(null)),
        () => --pending === 0 && finish(null),
      );
    }
  });
}

/**
 * 「ダウンロード」を押して一括ダウンロード画面を得る。
 * NE の現行UIは同一ページのポップオーバー（別ウィンドウが開かない）ため、popup イベントを
 * 固定時間待つと1回あたり数十秒を空費する（probe は最大27回開く）。
 * 別ウィンドウ実装にも耐えるよう、**popup 出現とポップオーバー可視化の先着**で進める。
 */
async function openBulkDownload(context, page, containerId) {
  await removeBackdrops(page);
  const popupPromise = context.waitForEvent("page", { timeout: SURFACE_TIMEOUT }).catch(() => null);
  await clickFirstVisible(
    page,
    [
      `#${containerId} button.batch-operation.batch-download`,
      `#${containerId} button.batch-download`,
      "button.batch-operation.batch-download",
      "button.batch-download",
      "button:has-text('ダウンロード')",
    ],
    "ダウンロードボタン",
    { timeout: 8000 },
  );

  // 同一ページがナビゲートする実装（実機の現行UI）にも備え、読み込み完了を先に待つ。
  await page.waitForLoadState("domcontentloaded", { timeout: NAV_TIMEOUT }).catch(() => {});
  const inlinePromise = page
    .waitForSelector(BULK_SURFACE_SELECTOR, { state: "visible", timeout: SURFACE_TIMEOUT })
    .then(() => ({ kind: "inline" }))
    .catch(() => null);
  const winner = await firstTruthy(
    [popupPromise.then((p) => (p && p !== page ? { kind: "popup", popup: p } : null)), inlinePromise],
    SURFACE_TIMEOUT + 1000,
  );

  const popup = winner?.kind === "popup" ? winner.popup : null;
  if (popup) {
    autoAcceptDialogs(popup);
  } else {
    // ポップオーバーで進む場合、遅れて別ウィンドウが開いたらタブが残るので閉じておく
    void popupPromise.then((p) => {
      if (p && p !== page && !p.isClosed()) p.close().catch(() => {});
    });
  }
  const surface = popup ?? page;
  await surface.waitForLoadState("domcontentloaded", { timeout: NAV_TIMEOUT }).catch(() => {});
  if (!winner) {
    // どちらも観測できなかった: 同一ページ側で最後にもう一度だけ待ってから進む（診断は失敗時に残る）
    await surface.waitForSelector(BULK_SURFACE_SELECTOR, { timeout: SURFACE_TIMEOUT }).catch(() => {});
  }
  return { surface, popup };
}

/** 一括ダウンロード画面を閉じる（ポップアップならクローズ、ポップオーバーなら「閉じる」）。 */
async function closeBulkDownload(page, surface, popup) {
  if (popup && popup !== page && !popup.isClosed()) {
    await popup.close().catch(() => {});
    return;
  }
  await clickFirstVisible(surface, ["button:has-text('閉じる')", "a:has-text('閉じる')"], "閉じる", {
    optional: true,
    timeout: 2000,
  });
  await surface.waitForTimeout(500);
  await removeBackdrops(surface);
}

/** 店舗選択で「商品管理」ラジオが選ばれている状態にする（依頼手順 5）。 */
async function ensureShohinKanriSelected(surface) {
  const res = await domEval(surface, domSelectShohinKanri);
  if (res.present && !res.ok) {
    await saveArtifacts(surface, "tenpo_radio_not_shohin_kanri");
    throw new Error(
      `「商品管理」ラジオを選択できませんでした（選択中: ${res.label ?? "なし"} / 候補: ${(res.labels ?? []).join(" | ")}）`,
    );
  }
  return res.present;
}

/** 任意の店舗ラジオを value で選ぶ（probe 専用）。 */
async function selectTenpoByValue(surface, value) {
  return surface.evaluate((v) => {
    const radios = Array.from(document.querySelectorAll('input[type="radio"][name="tenpo_code_list[]"]'));
    const target = radios.find((r) => r.value === v);
    if (!target) return false;
    for (const r of radios) r.checked = false;
    target.checked = true;
    target.dispatchEvent(new Event("change", { bubbles: true }));
    target.dispatchEvent(new Event("click", { bubbles: true }));
    return true;
  }, value);
}

/** 「項目選択へ」を押して項目選択画面に進む。 */
async function advanceToColumnSelect(surface) {
  const advanced = await clickFirstVisible(
    surface,
    [
      "button:has-text('項目選択')",
      "input[value*='項目選択']",
      "#select_column",
      "button:has-text('次へ')",
    ],
    "項目選択ボタン",
    { optional: true, timeout: 4000 },
  );
  if (!advanced) return false;
  await surface.waitForLoadState("domcontentloaded", { timeout: NAV_TIMEOUT }).catch(() => {});
  await surface.waitForTimeout(1000);
  return true;
}

/** 項目選択画面で全項目にチェックを入れる（依頼手順 6）。 */
async function checkAllColumns(surface) {
  await domEval(surface, domExpandPanels).catch(() => {});

  let clicked = 0;
  for (const sel of [
    "button:has-text('全チェック')",
    "a:has-text('全チェック')",
    "button:has-text('全選択')",
    "a:has-text('全選択')",
    "button:has-text('すべて選択')",
    ".check-all",
  ]) {
    const loc = surface.locator(sel);
    const n = await loc.count().catch(() => 0);
    for (let i = 0; i < n; i++) {
      const c = loc.nth(i);
      if (await c.isVisible().catch(() => false)) {
        await c.click({ timeout: 5000 }).catch(() => {});
        clicked++;
      }
    }
    if (clicked) break;
  }

  // 全チェックUIが無い / 効かない場合は素のチェックボックスを直接立てる
  const counts = await domEval(surface, domCheckAllCheckboxes);
  await surface.waitForTimeout(300);
  return { clicked, ...counts };
}

/** 対象CSVの「ダウンロード」ボタンを探す。見つからないときは null（診断情報は呼び出し側で集める）。 */
async function findDownloadButton(surface, def) {
  const res = await domEval(surface, domFindDownloadTarget, def.fileNames, def.panelPattern, def.panelPatternFlags ?? "i");
  if (!res.found) return null;
  if (res.fileName) {
    return {
      loc: surface.locator(`button[data-file-name="${res.fileName}"], [data-file-name="${res.fileName}"]`).first(),
      matchedBy: `${res.by}=${res.fileName}`,
    };
  }
  return {
    loc: surface.locator(".panel").nth(res.panelIndex).locator("button.download, button.btn-primary").first(),
    matchedBy: `パネル見出し一致(${res.panelHeading})`,
  };
}

// ---------------------------------------------------------------------------
// 対象1件のダウンロード
// ---------------------------------------------------------------------------

async function downloadOnePage(context, page, def, key, containerId, pageNo, outDir) {
  progress(`${pageNo}ページ目: 全チェック → ダウンロード`, key);
  await checkAllRows(page, containerId);

  const { surface, popup } = await openBulkDownload(context, page, containerId);
  try {
    // 店舗選択 →（項目選択へ）→ 項目選択 → ダウンロード。ウィザードの段数差に耐えるためループで進める。
    let btn = null;
    for (let stage = 0; stage < 4; stage++) {
      btn = await findDownloadButton(surface, def);
      if (btn) break;
      const hadRadio = await ensureShohinKanriSelected(surface);
      if (hadRadio) progress(`${pageNo}ページ目: 「商品管理」を選択しました`, key);
      if (!(await advanceToColumnSelect(surface))) break;
      const checked = await checkAllColumns(surface);
      progress(`${pageNo}ページ目: 項目を全チェック（${checked.checked}/${checked.total}）`, key);
    }

    if (!btn) {
      const files = await domEval(surface, domListDownloadTargets).catch(() => []);
      const panels = await domEval(surface, domListPanelHeadings).catch(() => []);
      await saveArtifacts(surface, `download_button_not_found_${key}`);
      throw new Error(
        `${def.label} のダウンロードボタンが見つかりません（探した data-file-name: ${def.fileNames.join(", ")}）。` +
          `画面上のCSV: ${files.map((f) => f.fileName).filter(Boolean).join(", ") || "なし"} / ` +
          `パネル: ${panels.join(" | ") || "なし"}。` +
          "`--probe` で対象の所在を確認し、環境変数（NE_MASTER_*_FILE / _SEARCH_TARGET / _CONTAINER）で指定してください。",
      );
    }

    progress(`${pageNo}ページ目: CSVを取得中（${btn.matchedBy}）`, key);
    const dest = path.join(outDir, `_page_${key}_${pageNo}_${Date.now()}.csv`);
    const dlPromise = surface.waitForEvent("download", { timeout: DL_TIMEOUT });
    await btn.loc.click({ timeout: NAV_TIMEOUT });
    const download = await dlPromise;
    await download.saveAs(dest);
    return dest;
  } finally {
    await closeBulkDownload(page, surface, popup).catch(() => {});
  }
}

/**
 * 専用ページからの直接ダウンロード（紐づけ表）。検索一覧・ページネーションを経由せず、
 * 店舗未選択（＝全店舗一括）のままダウンロードボタンを押して1ファイルで全件を得る。
 * ページ分割が存在しないため「総件数不明」の安全弁は適用しない（0行チェックは route 側に残る）。
 */
async function downloadDirectTarget(context, page, def, outDir) {
  const key = def.key;
  const dp = def.directPage;
  progress("店舗未選択のまま（＝全店舗一括）ダウンロードします", key);
  await removeBackdrops(page);

  const dest = path.join(outDir, `_page_${key}_1_${Date.now()}.csv`);
  const dlPromise = page.waitForEvent("download", { timeout: DL_TIMEOUT });
  await clickFirstVisible(page, dp.downloadSelectors, `${def.label} のダウンロードボタン`, { timeout: 8000 });
  const download = await dlPromise.catch(async (e) => {
    await saveArtifacts(page, `direct_download_timeout_${key}`);
    throw new Error(`${def.label} のダウンロードが始まりませんでした（${e?.message ?? e}）`);
  });
  await download.saveAs(dest);

  emit({
    type: "target-done",
    key,
    pageFiles: [dest],
    entries: null,
    pageItems: NE_PAGE_ITEMS_DEFAULT,
    entriesUnknown: false,
    direct: true,
    message: `${def.label} 取得完了（専用ページ・全店舗一括）`,
  });
}

async function downloadTarget(context, page, def, outDir, credential) {
  const key = def.key;
  emit({ type: "target-start", key, message: `${def.label} の取得を開始` });

  // 専用ページ持ちの対象（紐づけ表）は検索フローを使わない
  if (def.directPage?.url) {
    await gotoMainPage(context, page, credential, def.directPage.url, def.directPage.readySelectors, `${def.label} のページ`);
    await downloadDirectTarget(context, page, def, outDir);
    return;
  }

  await gotoSyohinSearch(context, page, credential);
  await ensurePageSizeMax(page);
  await openSearchDialog(page, def.searchTargetTexts);
  await clickSearch(page);

  const info = await waitForResult(page, def.containerIds);
  const pageItems = Number.isFinite(info.pageItems) && info.pageItems > 0 ? info.pageItems : NE_PAGE_ITEMS_DEFAULT;
  // 総件数は data-entries →「全N件中…」表記 → 不明 の3段で解決する。
  // 不明を「1ページ＝全件」と扱うと部分データを既存マスタへ流し込む事故になるため、
  // 1ページ目が満杯なら続きを探索し、いずれにせよ entriesUnknown を立てて取込側にブロックさせる。
  const resolved = resolveTotalEntries({
    entries: info.entries,
    countText: info.countText,
    rowCount: info.rowCount,
    pageItems,
  });
  const entries = resolved.total;
  const entriesUnknown = resolved.source === "unknown";
  if (!info.containerId || entries === 0 || (entriesUnknown && !info.rowCount)) {
    await saveArtifacts(page, `zero_result_${key}`);
    // 何をどう読んで0件と判断したかを必ず残す（画面変更時に証跡だけで原因を特定できるようにする）
    throw new Error(
      `${def.label} の検索結果が0件でした（空CSVの取込事故を防ぐため中止します）。` +
        `観測値: container=${info.containerId ?? "なし"} / data-entries=${info.entries ?? "なし"} / ` +
        `件数表記=${info.countText || "なし"} / 一覧行数=${info.rowCount ?? "不明"} / ` +
        `探したコンテナ=${def.containerIds.join(", ")}`,
    );
  }
  if (entriesUnknown) {
    progress(
      `総件数を読み取れませんでした（件数表示: ${info.countText || "なし"} / 1ページ目 ${info.rowCount}行）。` +
        (resolved.mayHaveMore
          ? "1ページ目が満杯のため続きのページを探索します"
          : "1ページ目が満杯ではないため1ページとして扱います") +
        "。結合結果は「要確認」として自動取込をブロックします",
      key,
    );
  }

  const needPages = entries == null ? (resolved.mayHaveMore ? MAX_PAGES : 1) : Math.ceil(entries / pageItems);
  if (entries != null && needPages > MAX_PAGES) {
    throw new Error(
      `必要ページ数 ${needPages} が上限 ${MAX_PAGES} を超えています（NE_MASTER_MAX_PAGES で緩和できます）。` +
        "部分データの取込を防ぐため中止します。",
    );
  }
  const totalPages = Math.min(needPages, MAX_PAGES);
  progress(
    entries == null
      ? `総件数不明のため最大${totalPages}ページまで探索します`
      : `${info.countText || `${entries}件`} → ${totalPages}ページ取得します`,
    key,
  );

  const pageFiles = [];
  let lastRowCount = Number.isFinite(info.rowCount) ? info.rowCount : null;
  for (let p = 1; p <= totalPages; p++) {
    if (p > 1) {
      progress(`${p}ページ目へ移動します`, key);
      if (entries == null) {
        // 件数不明の探索: 次ページへ移動できない＝終端とみなして打ち切る（要確認フラグは立ったまま）
        const movedOk = await gotoListPage(page, info.containerId, p).then(
          () => true,
          (e) => {
            progress(`${p}ページ目へ移動できませんでした（終端とみなします）: ${e.message}`, key);
            return false;
          },
        );
        if (!movedOk) break;
        const next = await waitForResult(page, [info.containerId]).catch(() => null);
        lastRowCount = next && Number.isFinite(next.rowCount) ? next.rowCount : null;
        if (lastRowCount === 0) break;
      } else {
        await gotoListPage(page, info.containerId, p);
        // 遷移後の再描画を待つ（行が入る前に全チェック→DLへ進むとナビゲーションで壊れる）
        await waitForResult(page, [info.containerId]);
      }
    }
    pageFiles.push(await downloadOnePage(context, page, def, key, info.containerId, p, outDir));
    // 件数不明のときは「1ページ目が満杯か」でしか続きを判断できない
    if (entries == null && (lastRowCount == null || lastRowCount < pageItems)) break;
  }

  emit({
    type: "target-done",
    key,
    pageFiles,
    entries,
    pageItems,
    entriesUnknown,
    message: `${def.label} 取得完了（${pageFiles.length}ページ${entriesUnknown ? " / 総件数不明のため要確認" : ""}）`,
  });
}

// ---------------------------------------------------------------------------
// probe（非破壊診断）
// ---------------------------------------------------------------------------

/**
 * 検索対象3種 × 店舗ラジオ各値で項目選択画面まで進み、観測結果を返す。
 * ダウンロードは行わない（クリックしない）ため、NE 側のデータには一切触れない。
 */
async function probeSearchTarget(context, page, st, credential) {
  const out = {
    optionText: st.text,
    optionValue: st.value,
    containerId: null,
    entries: null,
    pageItems: null,
    countText: "",
    pagination: { found: false, links: [], html: "" },
    tenpoRadios: [],
    perTenpo: [],
  };
  try {
    await gotoSyohinSearch(context, page, credential);
    await ensurePageSizeMax(page);
    await openSearchDialog(page, [st.text]);
    await clickSearch(page);
    const info = await waitForResult(page, st.containerIds);
    out.containerId = info.containerId;
    // 件数は data-entries → 件数表記 の順で解決する（本番ダウンロードと同じ規則）
    out.entries = resolveTotalEntries({
      entries: info.entries,
      countText: info.countText,
      rowCount: info.rowCount,
      pageItems: info.pageItems,
    }).total;
    out.pageItems = info.pageItems;
    out.countText = info.countText;
    if (!info.containerId) {
      out.error = "検索結果コンテナを特定できませんでした（0件かコンテナIDが変わっています）";
      return out;
    }
    const pager = await domEval(page, domReadPagination, info.containerId).catch(() => null);
    if (pager) out.pagination = { found: pager.found, links: pager.links, html: pager.html };

    await checkAllRows(page, info.containerId);
    const first = await openBulkDownload(context, page, info.containerId);
    out.tenpoRadios = await domEval(first.surface, domListTenpoRadios).catch(() => []);
    await closeBulkDownload(page, first.surface, first.popup).catch(() => {});

    const radios = out.tenpoRadios.length ? out.tenpoRadios.slice(0, PROBE_MAX_TENPO) : [{ value: "", label: "(店舗選択なし)" }];
    for (const radio of radios) {
      const entry = { value: radio.value, label: radio.label, downloadFiles: [], panelHeadings: [] };
      try {
        await checkAllRows(page, info.containerId);
        const { surface, popup } = await openBulkDownload(context, page, info.containerId);
        try {
          if (radio.value !== "") await selectTenpoByValue(surface, radio.value).catch(() => {});
          await advanceToColumnSelect(surface);
          entry.downloadFiles = await domEval(surface, domListDownloadTargets).catch(() => []);
          entry.panelHeadings = await domEval(surface, domListPanelHeadings).catch(() => []);
        } finally {
          await closeBulkDownload(page, surface, popup).catch(() => {});
        }
      } catch (e) {
        entry.error = e?.message ?? String(e);
      }
      out.perTenpo.push(entry);
      progress(
        `probe: ${st.text} / ${radio.label || radio.value} → CSV: ${entry.downloadFiles.map((f) => f.fileName).join(", ") || "なし"}`,
      );
    }
  } catch (e) {
    out.error = e?.message ?? String(e);
    await saveArtifacts(page, `probe_${st.value}`);
  }
  return out;
}

async function runProbe(context, page, credential, outDir, defs) {
  const report = { generatedAt: new Date().toISOString(), searchTargets: [] };
  // 総当りする検索対象は対象定義（正本）から導出する。定義を2箇所に持たない。
  for (const st of probeSearchTargetsFromDefs(defs)) {
    progress(`probe: 「${st.text}」を調べます`);
    report.searchTargets.push(await probeSearchTarget(context, page, st, credential));
  }
  const file = path.join(outDir, `_probe_${Date.now()}.json`);
  await writeFile(file, JSON.stringify(report, null, 2), "utf8").catch(() => {});
  emit({ type: "probe", report, message: `probe 完了（${report.searchTargets.length}検索対象 / 保存先 ${file}）` });
  return report;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function launchOptions() {
  const opts = { headless: !HEADED };
  const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const exe = configured && existsSync(configured) ? configured : CHROMIUM_CANDIDATES.find((p) => existsSync(p));
  if (exe) opts.executablePath = exe; // Playwright 同梱 Chromium が無い環境でも動くように
  return opts;
}

async function main() {
  const defs = loadTargetDefs();
  const byKey = Object.fromEntries(defs.map((d) => [d.key, d]));
  const targets = (arg("targets") ?? defs.map((d) => d.key).join(","))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!PROBE_MODE) {
    const unknown = targets.filter((t) => !byKey[t]);
    if (unknown.length) throw new Error(`未知の対象です: ${unknown.join(", ")}（有効: ${Object.keys(byKey).join(", ")}）`);
  }

  const outDir = path.resolve(arg("out-dir") ?? path.join(process.cwd(), ".ne-master-downloads"));
  const workDir = path.join(outDir, "_work");
  artifactDir = path.join(workDir, "artifacts");
  const statePath = path.join(workDir, "next_engine_state.json");
  await mkdir(artifactDir, { recursive: true });

  const credential = await loadCredential();
  progress(`資格情報の取得元: ${credential.source === "env" ? "環境変数" : "認証情報Excel"}`);

  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({
    acceptDownloads: true,
    locale: "ja-JP",
    viewport: HEADED ? null : { width: 1366, height: 900 },
    ...(existsSync(statePath) ? { storageState: statePath } : {}),
  });
  const page = await context.newPage();
  autoAcceptDialogs(page);

  let failed = 0;
  try {
    await login(context, page, credential);
    await context.storageState({ path: statePath }).catch(() => {});

    if (PROBE_MODE) {
      await runProbe(context, page, credential, outDir, defs);
    } else {
      for (const key of targets) {
        let lastError = null;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            await downloadTarget(context, page, byKey[key], outDir, credential);
            lastError = null;
            break;
          } catch (e) {
            lastError = e;
            progress(`${byKey[key].label} の取得に失敗（${attempt}/2）: ${e.message}`, key);
            if (attempt < 2) await page.waitForTimeout(2000);
          }
        }
        if (lastError) {
          failed++;
          const artifacts = await saveArtifacts(page, `target_failed_${key}`);
          emit({ type: "target-error", key, message: lastError.message, artifacts });
        }
      }
    }
    await context.storageState({ path: statePath }).catch(() => {});
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  emit({ type: "done", message: failed ? `${failed}件の対象で失敗しました` : "すべての対象を取得しました" });
  process.exit(failed ? 2 : 0);
}

// 親プロセスからの kill が届かない場合の保険。ブラウザを道連れに必ず死ぬ。
const deadline = setTimeout(() => {
  emit({ type: "fatal", message: `全体タイムアウト（${Math.round(DEADLINE_MS / 1000)}秒）に達したため終了します` });
  process.exit(3);
}, DEADLINE_MS);
deadline.unref();

main().catch(async (e) => {
  emit({ type: "fatal", message: e?.message ?? String(e) });
  process.exit(1);
});
