// NE 画面操作の純DOM関数のテスト。
// フィクスチャは依頼ノートのスクリーンショット（2026-07-29）でDevToolsに写っていた
// 実DOM をそのまま起こしたもの。セレクタが実機とずれていればここで落ちる。
import { describe, it, expect, beforeEach } from "vitest";
// スクリプト本体と同じ実体を読む（.mjs は型定義を持たないので、ここで契約を明示的に型付けする）。
import * as neDom from "../../scripts/ne-dom-helpers.mjs";

type PagerLink = {
  tag: string;
  type: string;
  text: string;
  className: string;
  dataPage: string | null;
  href: string | null;
  name: string;
  disabled: boolean;
};
type SearchResult = {
  containerId: string | null;
  entries: number | null;
  pageItems: number | null;
  currentPage: number;
  countText: string;
  rowCount: number;
};
type DownloadFile = { fileName: string; tag: string; className: string; panelHeading: string };

const {
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
} = neDom as unknown as {
  domSelectSearchTarget: (
    d: Document,
    texts: string[],
    preferred: string | null,
  ) => { ok: boolean; name: string; id: string; value: string; available: string[][] };
  domReadSearchResult: (d: Document, ids: string[]) => SearchResult | null;
  domReadPagination: (
    d: Document,
    containerId: string,
  ) => { found: boolean; currentPage: number | null; entries: number | null; pageItems: number | null; links: PagerLink[]; html: string };
  domMaximizePageSize: (d: Document) => { changed: boolean; value: string | null };
  domRemoveBackdrops: (d: Document) => number;
  domListTenpoRadios: (d: Document) => { value: string; checked: boolean; label: string }[];
  domSelectShohinKanri: (d: Document) => { present: boolean; ok: boolean; label: string | null; labels: string[] };
  domExpandPanels: (d: Document) => number;
  domCheckAllCheckboxes: (d: Document) => { total: number; changed: number; checked: number };
  domListDownloadTargets: (d: Document) => DownloadFile[];
  domListPanelHeadings: (d: Document) => string[];
  domFindDownloadTarget: (
    d: Document,
    fileNames: string[],
    patternSource: string,
    patternFlags: string,
  ) => { found: boolean; by?: string; fileName?: string; panelIndex?: number; panelHeading?: string; fileNames?: string[]; panels?: string[] };
};

function mount(html: string): Document {
  document.body.innerHTML = html;
  return document;
}

/** 詳細検索モーダル（Pasted image 20260729045846.png）。 */
const SEARCH_DIALOG_HTML = `
<div id="modal_search_item" class="modal hide modal-search-dialog in" data-backdrop="static">
  <div class="modal-body">
    <form id="modal_search_item_form">
      <div class="control-group">
        <label class="control-label">検索する対象を選択</label>
        <div class="controls dlg_select_target">
          <select name="select_target" class="input-block-level">
            <option value="0" id="dlg_select_target_syohin" selected>商品情報単位で検索</option>
            <option value="1" id="dlg_select_target_set_syohin">セット商品情報単位で検索</option>
            <option value="2" id="dlg_select_target_all">ページ情報単位で検索</option>
          </select>
        </div>
      </div>
    </form>
  </div>
</div>`;

/** 検索結果一覧（Pasted image 20260729050310.png / 050354.png）。775件＝1ページ、ul.pagination は空。 */
const RESULT_LIST_HTML = `
<div id="search_syouhin_result" class="ne-table-container" style="display: block;">
  <div class="btn-toolbar clearfix" role="toolbar">
    <div class="btn-group before-batch-operations">
      <button type="button" class="btn btn-small ne-table-check-all">☑ 全チェック</button>
      <button type="button" class="btn btn-small ne-table-uncheck-all">□ 全クリア</button>
    </div>
    <div class="pull-right">
      <div class="ne-table-pagination ne-table-pagination-top pull-left pagination"
           id="search_syouhin_result-pagination-top"
           data-current-page="1" data-entries="775" data-page-items="1000">
        <span class="pagenation-count">全775件中1-775を表示</span>
        <ul class="pagination"></ul>
      </div>
    </div>
  </div>
  <table class="ne-table"><tbody>
    <tr><td>r7201-1-hr</td></tr>
    <tr><td>rs119-3-temp</td></tr>
  </tbody></table>
</div>
<div id="search_setsyohin_result" class="ne-table-container" style="display: none;"></div>
<div id="search_syohin_page_result" class="ne-table-container" style="display: none;"></div>`;

/** 一括ダウンロードの店舗選択（Pasted image 20260729050520.png）。 */
const TENPO_HTML = `
<form name="select_column" action="/User_Syohin_Page/selectColumn" method="post" class="form-horizontal">
  <input type="hidden" name="search_target_type" value="0">
  <div class="panel panel-default">
    <div class="panel-heading">店舗選択</div>
    <div class="panel-body">
      <label class="radio-inline"><input type="radio" name="tenpo_code_list[]" value="0" checked> 商品管理 </label>
      <label class="radio-inline"><input type="radio" name="tenpo_code_list[]" value="1"> １：★おきなわ一番　楽天市場店★ </label>
      <label class="radio-inline"><input type="radio" name="tenpo_code_list[]" value="2"> ２：◆くすりの健康家族　Yahoo◆ </label>
    </div>
  </div>
  <input type="hidden" name="action" value="download">
  <button type="button" class="btn btn-primary" id="btn_select_column">項目選択へ →</button>
</form>`;

/** 項目選択画面（Pasted image 20260729051049.png）。商品情報単位では3種類しか出ない。 */
const COLUMN_SELECT_HTML = `
<form name="select_column">
  <div class="panel panel-default panel-exec-download">
    <div class="panel-heading" role="tab">商品管理CSV（syohin_basic .csv）</div>
    <div class="panel-collapse collapse"><div class="panel-body">
      <input type="hidden" class="form-control" name="option[file][syohin_basic][]" value="">
      <input type="checkbox" name="column[syohin_basic][]" value="syohin_code">
      <input type="checkbox" name="column[syohin_basic][]" value="syohin_name">
      <input type="checkbox" class="check-all" name="">
      <button type="button" class="btn btn-primary download with-label-search-type" data-file-name="syohin_basic" data-analytics-name="download">ダウンロード</button>
    </div></div>
  </div>
  <div class="panel panel-default panel-exec-download">
    <div class="panel-heading" role="tab">商品管理バリエーションCSV（syohin_variation .csv）</div>
    <div class="panel-collapse collapse"><div class="panel-body">
      <button type="button" class="btn btn-primary download" data-file-name="syohin_variation">ダウンロード</button>
    </div></div>
  </div>
  <div class="panel panel-default panel-exec-download">
    <div class="panel-heading" role="tab">商品管理オプションCSV（syohin_option .csv）</div>
    <div class="panel-collapse collapse"><div class="panel-body">
      <button type="button" class="btn btn-primary download" data-file-name="syohin_option">ダウンロード</button>
    </div></div>
  </div>
</form>`;

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("domSelectSearchTarget", () => {
  it("option の表示テキストで select_target を切り替え、change を発火する", () => {
    const doc = mount(SEARCH_DIALOG_HTML);
    const select = doc.querySelector<HTMLSelectElement>('select[name="select_target"]')!;
    let changes = 0;
    select.addEventListener("change", () => changes++);

    const res = domSelectSearchTarget(doc, ["セット商品情報単位で検索"], 'select[name="select_target"]');
    expect(res.ok).toBe(true);
    expect(res.name).toBe("select_target");
    expect(select.value).toBe("1");
    expect(changes).toBe(1);
  });

  it("ページ情報単位（紐づけ表の候補）も選べる", () => {
    const doc = mount(SEARCH_DIALOG_HTML);
    expect(domSelectSearchTarget(doc, ["ページ情報単位で検索"], null).ok).toBe(true);
    expect(doc.querySelector<HTMLSelectElement>('select[name="select_target"]')!.value).toBe("2");
  });

  it("preferredSelector が不正でも通常の select 探索へフォールバックする", () => {
    const doc = mount(SEARCH_DIALOG_HTML);
    const res = domSelectSearchTarget(doc, ["商品情報単位で検索"], ":::invalid:::");
    expect(res.ok).toBe(true);
  });

  it("該当する option が無ければ ok:false と候補一覧を返す", () => {
    const doc = mount(SEARCH_DIALOG_HTML);
    const res = domSelectSearchTarget(doc, ["存在しない単位"], null);
    expect(res.ok).toBe(false);
    expect(res.available[0]).toContain("商品情報単位で検索");
  });
});

describe("domReadSearchResult", () => {
  it("表示中コンテナのページング情報（entries / pageItems）を読む", () => {
    const doc = mount(RESULT_LIST_HTML);
    const info = domReadSearchResult(doc, ["search_syouhin_result", "search_syohin_result"]);
    expect(info).toMatchObject({
      containerId: "search_syouhin_result",
      entries: 775,
      pageItems: 1000,
      currentPage: 1,
      countText: "全775件中1-775を表示",
    });
    expect(info?.rowCount).toBe(2);
  });

  it("display:none のコンテナは選ばない（セット側は非表示）", () => {
    const doc = mount(RESULT_LIST_HTML);
    expect(domReadSearchResult(doc, ["search_setsyohin_result"])).toBeNull();
  });

  it("0件表示は entries:0 として検出する（空CSV取込の防止に使う）", () => {
    for (const text of ["検索結果がありません", "該当するデータはありません", "全0件中0-0を表示"]) {
      const doc = mount(`<div class="alert">${text}</div>`);
      expect(domReadSearchResult(doc, ["search_syouhin_result"]), text).toMatchObject({ containerId: null, entries: 0 });
    }
  });

  it("「全1000件中」を 0件 と誤判定しない（コンテナ描画待ちを続ける）", () => {
    const doc = mount(`<div class="loading">全1000件中1-1000を表示</div>`);
    expect(domReadSearchResult(doc, ["search_syouhin_result"])).toBeNull();
  });

  it("まだ描画されていない間は null（＝待機継続）", () => {
    const doc = mount(`<div>読み込み中</div>`);
    expect(domReadSearchResult(doc, ["search_syouhin_result"])).toBeNull();
  });
});

describe("domReadPagination", () => {
  it("1ページのときは links 空（NE は ul.pagination を空にする）", () => {
    const doc = mount(RESULT_LIST_HTML);
    const p = domReadPagination(doc, "search_syouhin_result");
    expect(p.found).toBe(true);
    expect(p.currentPage).toBe(1);
    expect(p.entries).toBe(775);
    expect(p.links).toEqual([]);
  });

  it("複数ページのときは番号リンク・矢印を実体つきで列挙する", () => {
    const doc = mount(`
      <div id="c" class="ne-table-container" style="display:block;">
        <div class="ne-table-pagination" id="c-pagination-top" data-current-page="1" data-entries="1250" data-page-items="1000">
          <span class="pagenation-count">全1250件中1-1000を表示</span>
          <ul class="pagination">
            <li><a href="#" data-page="1" class="active">1</a></li>
            <li><a href="#" data-page="2">2</a></li>
            <li><a href="#" class="next">→</a></li>
          </ul>
        </div>
      </div>`);
    const p = domReadPagination(doc, "c");
    expect(p.entries).toBe(1250);
    expect(p.links.map((l) => l.text)).toEqual(["1", "2", "→"]);
    expect(p.links[1].dataPage).toBe("2");
    expect(p.html).toContain("pagination");
  });

  it("ページャが無ければ found:false", () => {
    const doc = mount(`<div id="c"></div>`);
    expect(domReadPagination(doc, "c").found).toBe(false);
  });
});

describe("domMaximizePageSize", () => {
  it("表示件数プルダウンを最大値にして change を発火する", () => {
    const doc = mount(`<select id="page_sel"><option value="50">50</option><option value="1000">1000</option></select>`);
    const sel = doc.querySelector<HTMLSelectElement>("#page_sel")!;
    sel.value = "50";
    let changes = 0;
    sel.addEventListener("change", () => changes++);
    expect(domMaximizePageSize(doc)).toEqual({ changed: true, value: "1000" });
    expect(sel.value).toBe("1000");
    expect(changes).toBe(1);
  });

  it("プルダウンが無い画面では何もしない", () => {
    expect(domMaximizePageSize(mount("<div/>"))).toEqual({ changed: false, value: null });
  });
});

describe("domRemoveBackdrops", () => {
  it("モーダル背景・Cookie バナーを取り除く", () => {
    const doc = mount(`<div class="modal-backdrop"></div><div id="cm-ov"></div><div class="keep"></div>`);
    doc.body.classList.add("modal-open");
    expect(domRemoveBackdrops(doc)).toBe(2);
    expect(doc.querySelector(".modal-backdrop")).toBeNull();
    expect(doc.body.classList.contains("modal-open")).toBe(false);
    expect(doc.querySelector(".keep")).not.toBeNull();
  });
});

describe("店舗選択（依頼手順5）", () => {
  it("ラジオを列挙してラベルを読める", () => {
    const radios = domListTenpoRadios(mount(TENPO_HTML));
    expect(radios).toHaveLength(3);
    expect(radios[0]).toMatchObject({ value: "0", checked: true, label: "商品管理" });
    expect(radios[1].label).toContain("楽天市場店");
  });

  it("別店舗が選ばれていても「商品管理」に切り替える", () => {
    const doc = mount(TENPO_HTML);
    const radios = doc.querySelectorAll<HTMLInputElement>('input[name="tenpo_code_list[]"]');
    radios[0].checked = false;
    radios[2].checked = true;
    const res = domSelectShohinKanri(doc);
    expect(res).toMatchObject({ present: true, ok: true, label: "商品管理" });
    expect(radios[0].checked).toBe(true);
    expect(radios[2].checked).toBe(false);
  });

  it("店舗選択段が無い画面では present:false（素通りしてよい）", () => {
    expect(domSelectShohinKanri(mount("<div/>"))).toMatchObject({ present: false });
  });

  it("商品管理ラジオが存在しなければ ok:false と候補を返す", () => {
    const doc = mount(`<label><input type="radio" name="tenpo_code_list[]" value="9"> ９：どこかの店 </label>`);
    const res = domSelectShohinKanri(doc);
    expect(res).toMatchObject({ present: true, ok: false });
    expect(res.labels).toEqual(["９：どこかの店"]);
  });
});

describe("項目選択（依頼手順6）", () => {
  it("畳まれたパネルを開く", () => {
    const doc = mount(COLUMN_SELECT_HTML);
    expect(domExpandPanels(doc)).toBe(3);
    expect(doc.querySelectorAll(".panel-collapse.collapse.in")).toHaveLength(3);
  });

  it("name 付きチェックボックスを全て立てる（all クラスの制御用は除く）", () => {
    const doc = mount(COLUMN_SELECT_HTML);
    const res = domCheckAllCheckboxes(doc);
    expect(res.total).toBe(2); // check-all クラス／name 空は対象外
    expect(res.changed).toBe(2);
    expect(res.checked).toBe(2);
    expect(doc.querySelectorAll<HTMLInputElement>('input[name="column[syohin_basic][]"]')[0].checked).toBe(true);
  });

  it("既にチェック済みなら changed は増えない（冪等）", () => {
    const doc = mount(COLUMN_SELECT_HTML);
    domCheckAllCheckboxes(doc);
    expect(domCheckAllCheckboxes(doc)).toMatchObject({ changed: 0, checked: 2 });
  });
});

describe("ダウンロード対象の特定", () => {
  it("画面上のCSVを data-file-name とパネル見出しで列挙する", () => {
    const doc = mount(COLUMN_SELECT_HTML);
    const files = domListDownloadTargets(doc);
    expect(files.map((f) => f.fileName)).toEqual([
      "syohin_basic",
      "syohin_variation",
      "syohin_option",
    ]);
    expect(files[0].panelHeading).toContain("商品管理CSV");
    expect(domListPanelHeadings(doc)).toHaveLength(3);
  });

  it("data-file-name 完全一致で見つける", () => {
    const res = domFindDownloadTarget(mount(COLUMN_SELECT_HTML), ["syohin_basic"], "syohin_basic|商品管理CSV", "i");
    expect(res).toMatchObject({ found: true, by: "data-file-name", fileName: "syohin_basic" });
  });

  it("data-file-name が変わっていても正規表現で拾う", () => {
    const doc = mount(`<button class="download" data-file-name="syohin_basic_v2">DL</button>`);
    const res = domFindDownloadTarget(doc, ["syohin_basic"], "syohin_basic", "i");
    expect(res).toMatchObject({ found: true, by: "data-file-name-pattern", fileName: "syohin_basic_v2" });
  });

  it("data-file-name が無ければパネル見出し一致で拾う", () => {
    const doc = mount(`
      <div class="panel"><div class="panel-heading">受注CSV</div><button class="btn btn-primary">DL</button></div>
      <div class="panel"><div class="panel-heading">商品紐づけCSV</div><button class="download">DL</button></div>`);
    const res = domFindDownloadTarget(doc, ["himoduke"], "himo[dz]uke|紐[づ付]け", "i");
    expect(res).toMatchObject({ found: true, by: "panel-heading", panelIndex: 1 });
  });

  it("紐づけ表は「商品情報単位」の項目選択画面には存在しない（見つからず診断情報を返す）", () => {
    const doc = mount(COLUMN_SELECT_HTML);
    const res = domFindDownloadTarget(doc, ["himoduke", "himozuke"], "himo[dz]uke|紐[づ付]け", "i");
    expect(res.found).toBe(false);
    expect(res.fileNames).toEqual(["syohin_basic", "syohin_variation", "syohin_option"]);
    expect(res.panels?.[0]).toContain("商品管理CSV");
  });

  it("壊れた正規表現でもクラッシュしない", () => {
    expect(domFindDownloadTarget(mount(COLUMN_SELECT_HTML), ["nope"], "([", "i").found).toBe(false);
  });
});

describe("page.evaluate への輸送形式", () => {
  // スクリプトは `(${fn.toString()})(document, …)` という文字列でブラウザへ関数を送る。
  // モジュールスコープの識別子を参照していると本番だけ ReferenceError になるため、
  // 同じ形（外部スコープを持たない new Function 経由）で実行できることを保証する。
  const all = neDom as unknown as Record<string, (...a: unknown[]) => unknown>;

  it("全ヘルパーが自己完結しており、関数ソース文字列として実行できる", () => {
    const doc = mount(COLUMN_SELECT_HTML + TENPO_HTML + RESULT_LIST_HTML + SEARCH_DIALOG_HTML);
    const names = Object.keys(all);
    expect(names.length).toBeGreaterThanOrEqual(12);
    for (const name of names) {
      const src = `(${all[name].toString()})`;
      // 外部スコープを一切持たないクロージャとして再構築する（＝ブラウザ側と同条件）
      const rebuilt = new Function("document", "getComputedStyle", "Event", `return ${src}(document, [], null);`);
      expect(() => rebuilt(doc, globalThis.getComputedStyle, globalThis.Event), name).not.toThrow();
    }
  });

  it("輸送形式でも実処理が同じ結果になる（domFindDownloadTarget）", () => {
    const doc = mount(COLUMN_SELECT_HTML);
    const rebuilt = new Function(
      "document",
      `return (${all.domFindDownloadTarget.toString()})(document, ["syohin_basic"], "syohin_basic", "i");`,
    );
    expect(rebuilt(doc)).toMatchObject({ found: true, fileName: "syohin_basic" });
  });
});
