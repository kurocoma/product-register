// 「0件」誤判定の回帰テスト（実機 2026-07-30 で発生した取りこぼしの再発防止）。
//
// NE のヘッダーには、グローバル検索用の非表示テンプレートが常に埋まっている:
//   <script type="text/template" id="no-result-template">
//     <li class="no-result"><i>条件に一致する検索結果はありませんでした。</i></li>
//   </script>
// 0件判定を textContent で行うと、検索結果テーブルが描画される前にこの文言を掴んで
// 「0件」と確定し、実際には 775 件ある一覧を取り逃がす（空CSV防止のガードが逆に働く）。
// 表示テキスト（innerText 相当）だけを見ること・コンテナが見えていればそちらを優先することを固定する。
// なお jsdom は innerText を実装しないため、ここで通るのは script/style/template を除いた
// textContent 代替経路。実ブラウザでは innerText がそもそも script を含まないので同じ結果になる。
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// 本番と同じ .mjs 実体を読む（フィクスチャ乖離を防ぐ）。
const helpersSrc = readFileSync(path.join(process.cwd(), "scripts", "ne-dom-helpers.mjs"), "utf8");

type SearchResult = {
  containerId: string | null;
  entries: number | null;
  pageItems: number | null;
  currentPage: number;
  countText: string;
  rowCount: number;
} | null;

/** self-contained 制約（page.evaluate へ関数ソースを送る）を守れているかを含めて検証する。 */
function loadHelper(name: string): (doc: Document, ...args: unknown[]) => unknown {
  const m = new RegExp(`export function ${name}\\(([\\s\\S]*?)\\n\\}\\n`, "m").exec(helpersSrc);
  if (!m) throw new Error(`${name} が見つかりません`);
  const src = `function ${name}(${m[1]}\n}`;
  return new Function(`${src}; return ${name};`)() as (doc: Document, ...args: unknown[]) => unknown;
}

const domReadSearchResult = loadHelper("domReadSearchResult") as (doc: Document, ids: string[]) => SearchResult;

/** NE ヘッダーの非表示テンプレート（実機 HTML から転記）。 */
const NO_RESULT_TEMPLATE = `
  <script type="text/template" id="no-result-template">
    <li class="no-result"><i>条件に一致する検索結果はありませんでした。</i></li>
  </script>
`;

/** vitest の jsdom 環境の document に HTML を流し込む（既存 ne-dom-helpers.test.ts と同じ流儀）。 */
function docOf(html: string): Document {
  document.body.innerHTML = html;
  return document;
}

describe("domReadSearchResult: 非表示テンプレートを0件と誤読しない", () => {
  it("結果テーブル描画前（コンテナ非表示）でも、テンプレート文言だけでは0件と断定しない", () => {
    const doc = docOf(`
      ${NO_RESULT_TEMPLATE}
      <div id="search_syouhin_result" class="ne-table-container" style="display: none;"></div>
    `);
    // null＝「まだ判断できない」。呼び出し側はコンテナ出現を待ち続ける。
    expect(domReadSearchResult(doc, ["search_syouhin_result"])).toBeNull();
  });

  it("描画後は data-entries を読む（実機の775件が0件に潰れない）", () => {
    const doc = docOf(`
      ${NO_RESULT_TEMPLATE}
      <div id="search_syouhin_result" class="ne-table-container" style="display: block;">
        <div id="search_syouhin_result-pagination-top" data-current-page="1" data-entries="775" data-page-items="1000">
          <span class="pagenation-count">全775件中1-775を表示</span>
        </div>
        <table><tbody><tr></tr><tr></tr></tbody></table>
      </div>
    `);
    expect(domReadSearchResult(doc, ["search_syouhin_result"])).toMatchObject({
      containerId: "search_syouhin_result",
      entries: 775,
      pageItems: 1000,
      countText: "全775件中1-775を表示",
      rowCount: 2,
    });
  });

  it("本当に0件のときは（表示テキストに文言があるので）0件として返す", () => {
    const doc = docOf(`
      ${NO_RESULT_TEMPLATE}
      <div id="search_syouhin_result" class="ne-table-container" style="display: none;"></div>
      <p>検索結果がありません</p>
    `);
    expect(domReadSearchResult(doc, ["search_syouhin_result"])).toMatchObject({ containerId: null, entries: 0 });
  });

  it("表示中のコンテナは0件文言より優先される（古い文言が残っていても取りこぼさない）", () => {
    const doc = docOf(`
      <p>検索結果がありません</p>
      <div id="search_setsyohin_result" class="ne-table-container" style="display: block;">
        <div id="search_setsyohin_result-pagination-top" data-current-page="1" data-entries="42" data-page-items="1000">
          <span class="pagenation-count">全42件中1-42を表示</span>
        </div>
        <table><tbody><tr></tr></tbody></table>
      </div>
    `);
    expect(domReadSearchResult(doc, ["search_setsyohin_result"])).toMatchObject({
      containerId: "search_setsyohin_result",
      entries: 42,
    });
  });

  it("style も noscript も無い素の0件表示を拾える", () => {
    expect(domReadSearchResult(docOf("<div>該当するデータはありません</div>"), ["missing"])).toMatchObject({
      containerId: null,
      entries: 0,
    });
  });
});
