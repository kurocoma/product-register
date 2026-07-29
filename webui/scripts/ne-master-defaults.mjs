// NE マスタ自動ダウンロードの「対象定義フォールバック」と「純ロジックの写し」。
//
// 正本は `webui/lib/ne-master/auto-download.ts`（Next サーバーが env を解決し、
// `--target-defs` / `--page-items` で ne-master-download.mjs へ渡す）。
// ここに置くのは **CLI 単体で叩いたときのフォールバック**と、ブラウザ操作から切り離して
// 単体テストできる純ロジックだけ。playwright を import しないため vitest から直接読める。
//
// 両者がずれると本番だけ壊れるので、`lib/ne-master/auto-download.entries.test.ts` が
// このファイルと lib 正本の一致（定義・件数解決の挙動）をテストで固定している。

/** 1ページあたりの既定件数（NEの商品検索一覧の最大表示件数）。lib の NE_PAGE_ITEMS_DEFAULT と同値。 */
export const NE_PAGE_ITEMS_DEFAULT = 1000;

/** 対象定義の既定値（lib の BASE_DEFS と同内容）。env 上書きは lib 側で解決される。 */
export const DEFAULT_TARGET_DEFS = [
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
    // 専用ページ「設定＞商品＞商品コード紐づけ」から直接ダウンロードする（2026-07-30 実機確定）。
    // 検索系フィールドは probe・env 上書きの互換のために残してある（directPage があるので使われない）。
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
];

/**
 * probe が総当りする検索対象を対象定義から導出する（lib の neProbeSearchTargets と同じ規則）。
 * env で検索対象を寄せても既定の3種は必ず調べる（紐づけ表の所在探索を潰さないため）。
 */
export function probeSearchTargetsFromDefs(defs) {
  const out = [];
  const seen = new Set();
  const push = (value, text, containerIds) => {
    if (!text || seen.has(text)) return;
    seen.add(text);
    out.push({ value, text, containerIds: [...(containerIds || [])] });
  };
  for (const def of defs || []) {
    for (const text of def.searchTargetTexts || []) push(def.searchTargetValue, text, def.containerIds);
  }
  for (const def of DEFAULT_TARGET_DEFS) push(def.searchTargetValue, def.searchTargetTexts[0], def.containerIds);
  return out;
}

/** 「全775件中1-775を表示」→ { total, from, to }。読めなければ null（lib と同じ実装）。 */
export function parsePagenationCount(text) {
  const m = (text || "").replace(/[,\s]/g, "").match(/全(\d+)件中(\d+)[-–~〜](\d+)を表示/);
  if (!m) return null;
  return { total: Number(m[1]), from: Number(m[2]), to: Number(m[3]) };
}

/**
 * 総件数を3段で解決する: `data-entries` → 件数表記 → 不明（lib の resolveTotalEntries と同じ）。
 * 不明のときに「1ページ＝全件」と決めつけると部分データを取込む事故になるため、
 * `mayHaveMore`（1ページ目が満杯か）を返して呼び出し側に続きの探索を促す。
 */
export function resolveTotalEntries(info) {
  const raw = info || {};
  const size = Number.isFinite(raw.pageItems) && raw.pageItems > 0 ? raw.pageItems : NE_PAGE_ITEMS_DEFAULT;
  if (typeof raw.entries === "number" && Number.isFinite(raw.entries) && raw.entries >= 0) {
    return { total: raw.entries, source: "data-entries", mayHaveMore: false };
  }
  const parsed = parsePagenationCount(raw.countText ?? "");
  if (parsed && Number.isFinite(parsed.total) && parsed.total >= 0) {
    return { total: parsed.total, source: "count-text", mayHaveMore: false };
  }
  const rowCount = typeof raw.rowCount === "number" && Number.isFinite(raw.rowCount) ? raw.rowCount : null;
  return { total: null, source: "unknown", mayHaveMore: rowCount != null && rowCount >= size };
}

/**
 * 検索結果の観測値が「確定した」と言えるかを判定する（描画途中を掴まないための門番）。
 *
 * NE の結果コンテナは**検索実行前から display:block で存在する**（中身が空）。さらに検索直後は
 * 「全775件中0-0を表示」のように件数表記だけ先に入り、行がまだ無い状態を経由する。
 * ここで確定と誤認すると、0件エラーになるか、行が無いまま全チェック→ダウンロードへ進んで
 * ナビゲーションで壊れる（2026-07-30 実機で両方発生）。
 *
 * @returns {{settled:boolean, zero:boolean, reason:string}}
 *   settled=false のあいだ呼び出し側はポーリングを続ける。zero=true は「本物の0件」。
 */
export function evaluateSearchResultReadiness(info) {
  if (!info) return { settled: false, zero: false, reason: "観測できていない" };
  if (!info.containerId) {
    // コンテナ非表示＋0件文言の経路（domReadSearchResult が entries:0 を返す）
    return { settled: info.entries === 0, zero: info.entries === 0, reason: "0件文言" };
  }
  const rowCount = Number.isFinite(info.rowCount) ? info.rowCount : 0;
  if (rowCount > 0) return { settled: true, zero: false, reason: "一覧に行がある" };

  // 行が無い＝「本物の0件」か「まだ描画されていない」。明示的な0件表示だけを 0件として確定する。
  if (info.entries === 0) return { settled: true, zero: true, reason: "data-entries=0" };
  const parsed = parsePagenationCount(info.countText ?? "");
  if (parsed && parsed.total === 0) return { settled: true, zero: true, reason: "件数表記が全0件" };
  return { settled: false, zero: false, reason: "件数表記はあるが行が未描画" };
}

/** ページャの実体（domReadPagination の links）を人が読める1行にまとめる（失敗時の自己解決用）。 */
export function describePaginationLinks(links) {
  const list = Array.isArray(links) ? links : [];
  if (!list.length) return "リンクなし";
  return list
    .map((l) => {
      const cls = l.className ? `.${String(l.className).trim().split(/\s+/).join(".")}` : "";
      const page = l.dataPage ? `[data-page=${l.dataPage}]` : "";
      const type = l.type ? `(${l.type})` : "";
      return `${l.tag ?? "?"}${type}${cls}${page}"${(l.text ?? "").trim()}"${l.disabled ? "(disabled)" : ""}`;
    })
    .join(" / ");
}
