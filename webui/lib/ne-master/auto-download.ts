// NE マスタ自動ダウンロード（Playwright）の純ロジック＋スクリプト起動ヘルパー。
//
// 実際のブラウザ操作は `webui/scripts/ne-master-download.mjs`（別プロセス）が行い、
// ページ単位の生CSVをファイルに落とすだけ。ここでは
//   - 対象定義（既存の取込ソースキーと 1:1）
//   - ページ数の見積り／件数表記のパース
//   - 複数ページCSVのヘッダー統合・結合（NEセットCSVは引用符内改行を含むため papaparse 必須）
//   - スクリプト出力(NDJSON)の解釈
// を担当する。node 依存（child_process）は関数内 dynamic import に閉じてあるため、
// このモジュール自体はクライアントから import しても安全。

import Papa from "papaparse";

/** 1ページあたりの既定件数（NEの商品検索一覧の最大表示件数）。 */
export const NE_PAGE_ITEMS_DEFAULT = 1000;

// ---------------------------------------------------------------------------
// 対象定義（正本）— UI も route も .mjs も **すべてここから導出**する。
// DOM 手掛かり・ラベル・検索対象を3箇所に散らさないための単一情報源。
// ---------------------------------------------------------------------------

/** 専用ページから直接ダウンロードする対象の手掛かり（商品検索一覧・ページネーションを経由しない）。 */
export type NeDirectPageDef = {
  /** ダウンロードページの URL（main セッション必須） */
  url: string;
  /** ページが開けたと判断できる要素の候補（先頭が本命） */
  readySelectors: string[];
  /** ダウンロードボタンのセレクタ候補（先頭が本命） */
  downloadSelectors: string[];
};

/** ブラウザ操作に必要な対象別の手掛かり。ここが唯一の正本で、.mjs も route も UI もこれを使う。 */
export type NeAutoDownloadTargetDef = {
  key: NeAutoDownloadTargetKey;
  label: string;
  /** 詳細検索 select の option 表示テキスト（完全一致） */
  searchTargetTexts: string[];
  /** 同 option の value（テキスト一致に失敗したときのフォールバック） */
  searchTargetValue: string;
  /** 検索結果コンテナ id の候補（先頭が本命） */
  containerIds: string[];
  /** 項目選択画面の data-file-name 候補（先頭が本命） */
  fileNames: string[];
  /** data-file-name で当たらないときにパネル見出し／file-name を拾う正規表現 */
  panelPattern: string;
  panelPatternFlags: string;
  /**
   * CSV の1行が一覧の1件に対応するか。セット商品CSVは「セット商品×構成品」の明細行のため
   * false（実測 2026-07-30: 一覧1472件に対しCSV1677行）。false のときは行数照合をせず、
   * ページ数照合だけで取りこぼしを検出する。
   */
  rowsMatchEntries: boolean;
  /** 指定があれば検索一覧を経由せず、このページから直接ダウンロードする（紐づけ表）。 */
  directPage?: NeDirectPageDef;
};

/**
 * 正本の対象定義。key は既存の `/api/masters/import/[source]` のソースキーと一致させる。
 * 紐づけ表は商品検索の一括DL画面には無く、専用ページ「設定＞商品＞商品コード紐づけ」
 * （/Userhimoduke の【1】商品コード紐づけCSVダウンロード。店舗未選択＝全店舗一括）から取得する
 * （2026-07-30 実機スクリーンショットで確定）。検索系フィールド（searchTargetTexts 等）は
 * probe の総当り・env 上書きの互換のために残してあり、directPage がある対象では使われない。
 */
const BASE_DEFS = [
  {
    key: "ne-syohin",
    label: "NE 商品マスタ（単品）",
    searchTargetTexts: ["商品情報単位で検索"],
    searchTargetValue: "0",
    containerIds: ["search_syouhin_result", "search_syohin_result"],
    fileNames: ["syohin_basic"],
    panelPattern: "syohin_basic|商品管理CSV",
    panelPatternFlags: "i",
    rowsMatchEntries: true,
  },
  {
    key: "ne-set",
    label: "NE セット商品マスタ",
    searchTargetTexts: ["セット商品情報単位で検索"],
    searchTargetValue: "1",
    containerIds: ["search_setsyohin_result", "search_set_syohin_result"],
    fileNames: ["set_syohin", "setsyohin", "syohin_set"],
    panelPattern: "set[_-]?syohin|セット商品",
    panelPatternFlags: "i",
    rowsMatchEntries: false,
  },
  {
    key: "ne-himoduke",
    label: "NE 紐づけ表",
    searchTargetTexts: ["ページ情報単位で検索"],
    searchTargetValue: "2",
    containerIds: ["search_syohin_page_result", "search_page_result"],
    fileNames: ["himoduke", "himozuke", "syohin_himoduke", "syohin_page"],
    panelPattern: "himo[dz]uke|紐[づ付]け|商品ページ",
    panelPatternFlags: "i",
    rowsMatchEntries: true,
    // 実機 DevTools（2026-07-30）: form#all_form 内の
    // <button name="action_button[]" onclick="javascript:csv_download(this);" class="btn btn-primary">
    directPage: {
      url: "https://main.next-engine.com/Userhimoduke",
      readySelectors: ['button[onclick*="csv_download"]', "#all_form", "#main_body.himoduke_wrapper"],
      downloadSelectors: [
        'button[name="action_button[]"][onclick*="csv_download"]',
        'button[onclick*="csv_download"]',
        "#all_form button.btn-primary:has-text('商品コード紐づけCSVダウンロード')",
        "button:has-text('商品コード紐づけCSVダウンロード')",
      ],
    },
  },
] as const;

export type NeAutoDownloadTargetKey = (typeof BASE_DEFS)[number]["key"];

export type NeSearchTargetOption = { value: string; text: string; containerIds: string[] };

/**
 * 詳細検索「検索する対象を選択」(`select[name="select_target"]`) の全選択肢（正本からの導出）。
 * DOM 実測（2026-07-29 スクリーンショット）: option value=0/1/2。probe はこの3つを総当りする。
 */
export const NE_SEARCH_TARGET_OPTIONS: readonly NeSearchTargetOption[] = BASE_DEFS.map((d) => ({
  value: d.searchTargetValue,
  text: d.searchTargetTexts[0],
  containerIds: [...d.containerIds],
}));

/** 自動ダウンロード対象の一覧（UI のチェックボックスはこれを使う）。正本からの導出。 */
export const NE_AUTO_DOWNLOAD_TARGETS: readonly {
  key: NeAutoDownloadTargetKey;
  label: string;
  searchUnit: string;
  /** 専用ページから直接取得する対象（検索一覧・probe の対象外）。 */
  direct: boolean;
}[] = BASE_DEFS.map((d) => ({
  key: d.key,
  label: d.label,
  searchUnit: d.searchTargetTexts[0],
  direct: "directPage" in d,
}));

const TARGET_KEYS = new Set<string>(NE_AUTO_DOWNLOAD_TARGETS.map((t) => t.key));

export function isNeAutoDownloadTargetKey(value: unknown): value is NeAutoDownloadTargetKey {
  return typeof value === "string" && TARGET_KEYS.has(value);
}

export function neAutoDownloadLabel(key: string): string {
  return NE_AUTO_DOWNLOAD_TARGETS.find((t) => t.key === key)?.label ?? key;
}

function splitEnv(value: string | undefined): string[] | null {
  if (!value) return null;
  const a = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return a.length ? a : null;
}

const ENV_PREFIX: Record<NeAutoDownloadTargetKey, string> = {
  "ne-syohin": "NE_MASTER_SYOHIN",
  "ne-set": "NE_MASTER_SET",
  "ne-himoduke": "NE_MASTER_HIMODUKE",
};

/**
 * 対象定義を返す（env 上書き込み）。NE の画面変更に追従するため、
 * `NE_MASTER_<X>_FILE` / `_SEARCH_TARGET` / `_CONTAINER` で外から差し替えられる。
 * env は Next サーバープロセスで解決し、確定した定義を子プロセスへ渡す（定義の分散を防ぐ）。
 */
export function neAutoDownloadTargetDefs(env: Record<string, string | undefined> = process.env): NeAutoDownloadTargetDef[] {
  return BASE_DEFS.map((def) => {
    const p = ENV_PREFIX[def.key];
    const directPage = "directPage" in def ? def.directPage : undefined;
    return {
      key: def.key,
      label: def.label,
      searchTargetValue: def.searchTargetValue,
      panelPattern: def.panelPattern,
      panelPatternFlags: def.panelPatternFlags,
      rowsMatchEntries: def.rowsMatchEntries,
      searchTargetTexts: splitEnv(env[`${p}_SEARCH_TARGET`]) ?? [...def.searchTargetTexts],
      containerIds: splitEnv(env[`${p}_CONTAINER`]) ?? [...def.containerIds],
      fileNames: splitEnv(env[`${p}_FILE`]) ?? [...def.fileNames],
      ...(directPage
        ? {
            directPage: {
              // NE の画面変更・検証用に URL とボタンだけ env で差し替えられるようにしておく
              url: env[`${p}_DIRECT_URL`] || directPage.url,
              readySelectors: [...directPage.readySelectors],
              downloadSelectors: splitEnv(env[`${p}_DIRECT_BUTTON`]) ?? [...directPage.downloadSelectors],
            },
          }
        : {}),
    };
  });
}

export function neAutoDownloadTargetDef(
  key: string,
  env?: Record<string, string | undefined>,
): NeAutoDownloadTargetDef | null {
  return neAutoDownloadTargetDefs(env).find((d) => d.key === key) ?? null;
}

/**
 * probe（非破壊診断）が総当りする検索対象。対象定義（env 上書き込み）と既定 option の和集合。
 * env で検索対象を寄せても既定の3種は必ず調べる（紐づけ表の所在探索を潰さないため）。
 */
export function neProbeSearchTargets(env?: Record<string, string | undefined>): NeSearchTargetOption[] {
  const out: NeSearchTargetOption[] = [];
  const seen = new Set<string>();
  const push = (value: string, text: string, containerIds: readonly string[]) => {
    if (!text || seen.has(text)) return;
    seen.add(text);
    out.push({ value, text, containerIds: [...containerIds] });
  };
  for (const def of neAutoDownloadTargetDefs(env)) {
    for (const text of def.searchTargetTexts) push(def.searchTargetValue, text, def.containerIds);
  }
  for (const opt of NE_SEARCH_TARGET_OPTIONS) push(opt.value, opt.text, opt.containerIds);
  return out;
}

/** 総件数と1ページ件数から必要ページ数を求める。0件は0ページ（＝異常としてスクリプト側で弾く）。 */
export function planPages(totalEntries: number, pageSize: number = NE_PAGE_ITEMS_DEFAULT): number {
  if (!Number.isFinite(totalEntries) || totalEntries <= 0) return 0;
  const size = Number.isFinite(pageSize) && pageSize > 0 ? pageSize : NE_PAGE_ITEMS_DEFAULT;
  return Math.ceil(totalEntries / size);
}

/** 「全775件中1-775を表示」→ { total:775, from:1, to:775 }。読めなければ null。 */
export function parsePagenationCount(text: string): { total: number; from: number; to: number } | null {
  const m = (text || "").replace(/[,\s]/g, "").match(/全(\d+)件中(\d+)[-–~〜](\d+)を表示/);
  if (!m) return null;
  return { total: Number(m[1]), from: Number(m[2]), to: Number(m[3]) };
}

/** 総件数の解決結果。source が "unknown" のときは **絶対に「1ページで全部」と決めつけない**。 */
export type NeEntriesResolution = {
  total: number | null;
  source: "data-entries" | "count-text" | "unknown";
  /** 総件数不明かつ1ページ目が満杯＝続きがある可能性がある（次ページ探索を試みる合図）。 */
  mayHaveMore: boolean;
};

/**
 * 総件数を3段で解決する: `data-entries` → 件数表記（「全775件中1-775を表示」）→ 不明。
 * NE の画面変更や紐づけ表の未確定コンテナで `data-entries` が読めないことがあり、
 * そこで「1ページ＝全件」と決めつけると部分データを既存マスタへ流し込む事故になる。
 * 不明のときは `mayHaveMore`（1ページ目が満杯か）を返し、呼び出し側に続きの探索と警告を強制する。
 */
export function resolveTotalEntries(info: {
  entries?: number | null;
  countText?: string | null;
  rowCount?: number | null;
  pageItems?: number | null;
}): NeEntriesResolution {
  const size =
    typeof info.pageItems === "number" && Number.isFinite(info.pageItems) && info.pageItems > 0
      ? info.pageItems
      : NE_PAGE_ITEMS_DEFAULT;
  const entries = info.entries;
  if (typeof entries === "number" && Number.isFinite(entries) && entries >= 0) {
    return { total: entries, source: "data-entries", mayHaveMore: false };
  }
  const parsed = parsePagenationCount(info.countText ?? "");
  if (parsed && Number.isFinite(parsed.total) && parsed.total >= 0) {
    return { total: parsed.total, source: "count-text", mayHaveMore: false };
  }
  const rowCount = typeof info.rowCount === "number" && Number.isFinite(info.rowCount) ? info.rowCount : null;
  return { total: null, source: "unknown", mayHaveMore: rowCount != null && rowCount >= size };
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function normalizeHeader(cells: string[]): string[] {
  return cells.map((c) => (c ?? "").replace(/^﻿/, "").trim());
}

export type MergedCsv = { csv: string; header: string[]; rows: number; pages: number };

/**
 * 複数ページ分のCSVテキストを1本に結合する。
 * - ヘッダーは先頭ページのものだけを残す（2ページ目以降のヘッダー行は捨てる）
 * - 列構成が一致しないページがあればエラー（別条件のCSVを混ぜた事故を検出）
 * - 空文字・空白のみのページは無視する
 * papaparse を使うのは、NEセット商品CSV（142列）が説明文に改行を含み、行分割が使えないため。
 */
export function mergeCsvPages(pages: string[]): MergedCsv {
  const tables: string[][][] = [];
  for (const raw of pages) {
    if (typeof raw !== "string" || raw.trim() === "") continue;
    const parsed = Papa.parse<string[]>(stripBom(raw), { skipEmptyLines: true });
    const data = (parsed.data as string[][]) ?? [];
    if (data.length === 0) continue;
    tables.push(data);
  }
  if (tables.length === 0) throw new Error("結合できるCSVがありません（全ページが空でした）");

  const header = normalizeHeader(tables[0][0]);
  const out: string[][] = [tables[0][0]];
  for (let i = 0; i < tables.length; i++) {
    const h = normalizeHeader(tables[i][0]);
    if (h.length !== header.length || h.some((c, j) => c !== header[j])) {
      throw new Error(
        `ページ間で列構成が一致しません（1ページ目 ${header.length}列 / ${i + 1}ページ目 ${h.length}列）。` +
          "検索条件が途中で変わった可能性があります。",
      );
    }
    for (let r = 1; r < tables[i].length; r++) out.push(tables[i][r]);
  }

  return { csv: Papa.unparse(out), header, rows: out.length - 1, pages: tables.length };
}

/** 結合結果の件数を NE 側の総件数と突き合わせる。問題なければ null、差異があれば警告文。 */
export function verifyMergedRowCount(rows: number, expectedEntries: number | null): string | null {
  if (expectedEntries == null || !Number.isFinite(expectedEntries)) return null;
  if (rows === expectedEntries) return null;
  return `NE の表示件数 ${expectedEntries} 件に対し、結合後 ${rows} 行でした（取りこぼし・重複の可能性があります）`;
}

/**
 * 結合結果の健全性を判定する。
 * 行数不一致・ページ数不足は「部分データ／重複データを既存マスタへ流し込む」事故に直結するため、
 * 警告を出すだけでなく **自動取込をブロック**（`autoImportBlocked`）して人の明示確認を要求する。
 */
export type MergeVerification = { warnings: string[]; autoImportBlocked: boolean };

export function evaluateMergedPages(args: {
  rows: number;
  entries: number | null;
  mergedPages: number;
  expectedPages: number;
  /**
   * NE 側の総件数を解決できなかった（`data-entries` も件数表記も読めなかった）とき true。
   * 行数照合ができない＝取りこぼしを検出できないため、「件数不明＝安全」ではなく
   * **「件数不明＝要確認」** に倒して自動取込をブロックする。
   * 呼び出し側（route）は総件数が null のとき必ずこれを立てる。
   */
  entriesUnknown?: boolean;
  /**
   * CSV の1行が一覧の1件に対応するか（既定 true）。false のときは行数照合をスキップする。
   * セット商品CSVは「セット商品×構成品」の明細行で、一覧件数と行数が構造的に一致しない
   * （実測 2026-07-30: 1472件 → 1677行）。ここで照合すると毎回誤警告になり、
   * 本物の取りこぼし警告が埋もれる。ページ数照合は引き続き有効。
   */
  rowsMatchEntries?: boolean;
}): MergeVerification {
  const warnings: string[] = [];
  if (args.rowsMatchEntries !== false) {
    const countWarning = verifyMergedRowCount(args.rows, args.entries);
    if (countWarning) warnings.push(countWarning);
  }
  if (args.entriesUnknown) {
    warnings.push(
      "NE 側の総件数を読み取れませんでした（1000件超の後半ページを取りこぼしている可能性があるため、" +
        "CSVの行数を確認してから取込んでください）",
    );
  }
  if (args.expectedPages > 0 && args.mergedPages < args.expectedPages) {
    warnings.push(
      `必要ページ数 ${args.expectedPages} に対し ${args.mergedPages} ページ分しか結合できていません（後半ページが欠落しています）`,
    );
  } else if (args.expectedPages > 0 && args.mergedPages > args.expectedPages) {
    warnings.push(`必要ページ数 ${args.expectedPages} を超える ${args.mergedPages} ページを結合しました（重複の可能性があります）`);
  }
  if (args.rows <= 0) warnings.push("結合結果が0行です（空CSVの取込を防ぐため取込しません）");
  return { warnings, autoImportBlocked: warnings.length > 0 };
}

// ---------------------------------------------------------------------------
// スクリプト（別プロセス）の起動と NDJSON 出力の解釈
// ---------------------------------------------------------------------------

/** probe（非破壊診断）が1検索対象ぶんに返す観測結果。 */
export type NeProbeSearchTargetReport = {
  optionText: string;
  optionValue: string;
  containerId: string | null;
  entries: number | null;
  pageItems: number | null;
  countText: string;
  pagination: { found: boolean; links: Record<string, unknown>[]; html: string };
  tenpoRadios: { value: string; label: string; checked: boolean }[];
  /** 店舗ラジオごとに項目選択画面まで進んで観測した data-file-name */
  perTenpo: {
    value: string;
    label: string;
    downloadFiles: { fileName: string; panelHeading: string }[];
    panelHeadings: string[];
    error?: string;
  }[];
  error?: string;
};

export type NeProbeReport = { generatedAt: string; searchTargets: NeProbeSearchTargetReport[] };

export type NeScriptEvent =
  | { type: "progress"; key?: string; message: string }
  | { type: "target-start"; key: string }
  | {
      type: "target-done";
      key: string;
      pageFiles: string[];
      entries: number | null;
      pageItems: number | null;
      /** 総件数を解決できなかった（部分データの可能性がある）。route は必ず自動取込をブロックする。 */
      entriesUnknown?: boolean;
      /**
       * 専用ページからの直接ダウンロード（紐づけ表）。ページネーションが存在せず1回で全件が
       * 落ちるため、route は「総件数不明＝要確認」の安全弁を適用しない（0行チェックは残る）。
       */
      direct?: boolean;
    }
  | { type: "target-error"; key: string; message: string; artifacts?: string[] }
  | { type: "probe"; report: NeProbeReport; message?: string }
  | { type: "done" }
  | { type: "fatal"; message: string };

const EVENT_TYPES = new Set(["progress", "target-start", "target-done", "target-error", "probe", "done", "fatal"]);

/** probe 結果から、対象定義（fileNames / panelPattern）に当たる検索対象・店舗を探す。 */
export function findProbeMatches(
  report: NeProbeReport,
  def: Pick<NeAutoDownloadTargetDef, "fileNames" | "panelPattern" | "panelPatternFlags">,
): { optionText: string; optionValue: string; tenpoLabel: string; fileName: string; panelHeading: string }[] {
  let re: RegExp | null = null;
  try {
    re = new RegExp(def.panelPattern, def.panelPatternFlags || "i");
  } catch {
    re = null;
  }
  const out: { optionText: string; optionValue: string; tenpoLabel: string; fileName: string; panelHeading: string }[] = [];
  for (const st of report.searchTargets ?? []) {
    for (const t of st.perTenpo ?? []) {
      for (const f of t.downloadFiles ?? []) {
        const hit = def.fileNames.includes(f.fileName) || (re != null && (re.test(f.fileName) || re.test(f.panelHeading)));
        if (hit) {
          out.push({
            optionText: st.optionText,
            optionValue: st.optionValue,
            tenpoLabel: t.label,
            fileName: f.fileName,
            panelHeading: f.panelHeading,
          });
        }
      }
    }
  }
  return out;
}

/** スクリプトが1行1件で吐く JSON を型付きイベントにする。解釈できない行は null（ログ行として扱う）。 */
export function parseScriptEvent(line: string): NeScriptEvent | null {
  const t = (line || "").trim();
  if (!t.startsWith("{")) return null;
  try {
    const o = JSON.parse(t) as Record<string, unknown>;
    if (typeof o.type !== "string" || !EVENT_TYPES.has(o.type)) return null;
    return o as unknown as NeScriptEvent;
  } catch {
    return null;
  }
}

/**
 * 子プロセス stdout を「1行1イベント」に切り出すリーダー。
 * チャンク境界が行の途中に来ても壊れないこと・終端の未改行行を捨てないことが要件なので、
 * spawn から切り離して単体テストできる形にしてある。
 */
export function createNdjsonLineReader(handlers: {
  onEvent: (event: NeScriptEvent) => void;
  onLog?: (line: string) => void;
}): { push: (chunk: string) => void; flush: () => void } {
  let buf = "";
  const emit = (line: string) => {
    const ev = parseScriptEvent(line);
    if (ev) handlers.onEvent(ev);
    else if (line.trim()) handlers.onLog?.(line.trim());
  };
  return {
    push(chunk: string) {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        emit(line);
      }
    },
    flush() {
      if (buf) {
        const rest = buf;
        buf = "";
        emit(rest);
      }
    },
  };
}

/** 既定の全体タイムアウト（NE ログイン＋3マスタ×複数ページで数分かかるため長め）。 */
export const NE_SCRIPT_TIMEOUT_MS_DEFAULT = 15 * 60 * 1000;

export type NeScriptRunResult = { code: number; stderr: string; timedOut: boolean; aborted: boolean };

export type NeScriptRunArgs = {
  scriptPath: string;
  cwd: string;
  targets: string[];
  outDir: string;
  /** ヘッドありで動かす（開発時のみ。route 側で env ガードしてから渡すこと）。 */
  headless?: boolean;
  /** "probe" は非破壊診断モード（CSVを落とさない）。 */
  mode?: "download" | "probe";
  /** 対象定義の正本（lib で env 解決済みのものを渡す）。 */
  targetDefs?: NeAutoDownloadTargetDef[];
  /** 全体タイムアウト（ミリ秒）。超過したらプロセスツリーごと kill する。 */
  timeoutMs?: number;
  /** クライアント切断などで中断するためのシグナル。 */
  signal?: AbortSignal;
  onEvent: (event: NeScriptEvent) => void;
  onLog?: (line: string) => void;
};

/** Windows では node を kill しても Chromium が残るため、プロセスツリーごと落とす。 */
async function killProcessTree(pid: number | undefined, fallback: () => void): Promise<void> {
  if (!pid) {
    fallback();
    return;
  }
  if (process.platform === "win32") {
    try {
      const { spawn } = await import("node:child_process");
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on("error", () => {});
    } catch {
      /* taskkill が無い環境では下の fallback に委ねる */
    }
  }
  fallback();
}

/**
 * ne-master-download.mjs を子プロセスで実行し、標準出力の NDJSON を onEvent へ流す。
 * サーバー専用。node:child_process は関数内 dynamic import に閉じてある。
 * 全体タイムアウト・abort シグナルで必ず kill されるため、ブラウザが居残ることはない。
 */
export async function runNeMasterDownloadScript(args: NeScriptRunArgs): Promise<NeScriptRunResult> {
  const { spawn } = await import("node:child_process");
  const defs = args.targetDefs ?? neAutoDownloadTargetDefs();
  const argv = [
    args.scriptPath,
    "--targets",
    args.targets.join(","),
    "--out-dir",
    args.outDir,
    "--json",
    "--target-defs",
    JSON.stringify(defs),
    // 1ページ件数の既定値も lib 側の定数を正本として渡す（.mjs にリテラルを持たせない）
    "--page-items",
    String(NE_PAGE_ITEMS_DEFAULT),
    ...(args.mode === "probe" ? ["--probe"] : []),
  ];
  const child = spawn(process.execPath, argv, {
    cwd: args.cwd,
    env: { ...process.env, ...(args.headless === false ? { NEXT_ENGINE_HEADLESS: "false" } : {}) },
    windowsHide: true,
  });

  let stderr = "";
  let timedOut = false;
  let aborted = false;
  const reader = createNdjsonLineReader({ onEvent: args.onEvent, onLog: args.onLog });

  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => reader.push(chunk));
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
    if (stderr.length > 20000) stderr = stderr.slice(-20000);
  });

  const kill = () => void killProcessTree(child.pid, () => child.kill("SIGKILL"));
  const timeoutMs = args.timeoutMs ?? NE_SCRIPT_TIMEOUT_MS_DEFAULT;
  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          args.onEvent({ type: "progress", message: `全体タイムアウト（${Math.round(timeoutMs / 1000)}秒）のため中断します` });
          kill();
        }, timeoutMs)
      : null;
  const onAbort = () => {
    aborted = true;
    kill();
  };
  if (args.signal) {
    if (args.signal.aborted) onAbort();
    else args.signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    const code = await new Promise<number>((resolve) => {
      child.on("error", () => {
        reader.flush();
        resolve(-1);
      });
      child.on("close", (c) => {
        reader.flush();
        resolve(c ?? -1);
      });
    });
    return { code, stderr, timedOut, aborted };
  } finally {
    if (timer) clearTimeout(timer);
    args.signal?.removeEventListener("abort", onAbort);
  }
}
