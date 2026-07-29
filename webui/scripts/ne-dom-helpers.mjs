// NE（ネクストエンジン）画面を操作するための純DOM関数群。
//
// 設計上の制約（守らないと本番で壊れる）:
//   1. すべて **self-contained**（モジュールスコープの識別子を一切参照しない）。
//      ne-master-download.mjs は `page.evaluate("(" + fn.toString() + ")(document, …)")`
//      の形でブラウザへ関数ソースを送り込むため、外部参照があると ReferenceError になる。
//   2. 第1引数は必ず `document`。これにより jsdom（vitest）でそのまま単体テストできる。
//   3. 戻り値は構造化クローン可能な素の値のみ（DOM ノードを返さない）。
//
// DOM の根拠は依頼ノートのスクリーンショット（2026-07-29）:
//   - 詳細検索: select[name="select_target"] の option
//       value=0「商品情報単位で検索」/ value=1「セット商品情報単位で検索」/ value=2「ページ情報単位で検索」
//   - 一覧: div#search_syouhin_result 等 .ne-table-container、
//       div#<container>-pagination-top[data-current-page][data-entries][data-page-items] > span.pagenation-count + ul.pagination
//   - 全チェック: button.btn.btn-small.ne-table-check-all
//   - 一括DL: form[name="select_column"] 内 input[type=radio][name="tenpo_code_list[]"][value=0]「商品管理」
//   - 項目選択: div.panel.panel-exec-download > … > button.btn.btn-primary.download[data-file-name="syohin_basic"]

/** 空白を潰してトリムする（各関数内で再定義する。self-contained 制約のため共有しない）。 */

/**
 * 「検索する対象を選択」の select を、option の表示テキスト一致で選択する。
 * select_option / fill は NE の再描画で効かないため、selected を直接立てて change を bubbles 付きで飛ばす。
 * @returns {{ok:true,name:string,id:string,value:string}|{ok:false,available:string[][]}}
 */
export function domSelectSearchTarget(document, wantedTexts, preferredSelector) {
  const norm = (v) => (v || "").replace(/\s+/g, " ").trim();
  const wants = (wantedTexts || []).map(norm).filter(Boolean);
  let preferred = [];
  if (preferredSelector) {
    try {
      preferred = Array.from(document.querySelectorAll(preferredSelector));
    } catch {
      preferred = [];
    }
  }
  const selects = [...preferred, ...Array.from(document.querySelectorAll("select"))];
  for (const select of selects) {
    const options = Array.from(select.options || []);
    const texts = options.map((o) => norm(o.textContent));
    if (!wants.length || !wants.every((w) => texts.includes(w))) continue;
    for (const o of options) o.selected = wants.includes(norm(o.textContent));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, name: select.getAttribute("name") || "", id: select.id || "", value: select.value };
  }
  return {
    ok: false,
    available: selects.slice(0, 8).map((s) => Array.from(s.options || []).map((o) => norm(o.textContent))),
  };
}

/**
 * 表示中の検索結果コンテナを1つ選び、ページング情報を読む。
 * 見つからず「結果はありません」等が出ていれば entries:0、判断できなければ null（＝まだ待つ）。
 * @returns {{containerId:string|null,entries:number|null,pageItems:number|null,currentPage:number,countText:string,rowCount:number}|null}
 */
export function domReadSearchResult(document, containerIds) {
  const attrNum = (el, name) => {
    if (!el) return null;
    const raw = el.getAttribute(name);
    if (raw == null || raw === "") return null;
    const n = Number(String(raw).replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  for (const id of containerIds || []) {
    const c = document.getElementById(id);
    if (!c) continue;
    const inlineHidden = /display\s*:\s*none/i.test(c.getAttribute("style") || "");
    let computedHidden = false;
    try {
      computedHidden = typeof getComputedStyle === "function" && getComputedStyle(c).display === "none";
    } catch {
      computedHidden = false;
    }
    if (inlineHidden || computedHidden) continue;
    const pager = document.getElementById(id + "-pagination-top") || c.querySelector(".ne-table-pagination");
    const countEl = pager ? pager.querySelector(".pagenation-count") : null;
    return {
      containerId: id,
      entries: attrNum(pager, "data-entries"),
      pageItems: attrNum(pager, "data-page-items"),
      currentPage: attrNum(pager, "data-current-page") ?? 1,
      countText: countEl ? (countEl.textContent || "").trim() : "",
      rowCount: c.querySelectorAll("table tbody tr").length,
    };
  }
  // 0件文言の判定は **表示テキストだけ** を見る。NE のヘッダーには
  // <script type="text/template" id="no-result-template">…検索結果はありませんでした…</script>
  // （グローバル検索用の非表示テンプレート）が常に埋まっており、textContent を見ると
  // 検索結果の描画前に必ず「0件」と誤判定して 775 件の一覧を取り逃がす。
  let body = "";
  if (document.body) {
    body = document.body.innerText || "";
    if (!body) {
      // innerText が使えない環境（jsdom 等）は script/style/template を除いた textContent で代替する
      const parts = [];
      const walk = (node) => {
        for (const child of Array.from(node.childNodes || [])) {
          if (child.nodeType === 3) {
            parts.push(child.nodeValue || "");
            continue;
          }
          if (child.nodeType !== 1) continue;
          const tag = child.tagName ? child.tagName.toLowerCase() : "";
          if (tag === "script" || tag === "style" || tag === "template" || tag === "noscript") continue;
          walk(child);
        }
      };
      walk(document.body);
      body = parts.join(" ");
    }
  }
  // 「0件」だけを見ると「全1000件中」に誤反応するため、0件を表す語形に限定する
  if (/結果はありません|該当するデータはありません|検索結果がありません|全0件/.test(body)) {
    return { containerId: null, entries: 0, pageItems: null, currentPage: 1, countText: "", rowCount: 0 };
  }
  return null;
}

/**
 * ページャの実体（a / button / input）を列挙する。NE はページが1枚のとき ul.pagination が空になるため、
 * 「→」や番号リンクがどう実装されているかは実機を見ないと分からない。probe モードの主目的の1つ。
 * @returns {{found:boolean,currentPage:number|null,entries:number|null,pageItems:number|null,links:object[],html:string}}
 */
export function domReadPagination(document, containerId) {
  const attrNum = (el, name) => {
    if (!el) return null;
    const raw = el.getAttribute(name);
    if (raw == null || raw === "") return null;
    const n = Number(String(raw).replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  const container = document.getElementById(containerId);
  const pager =
    document.getElementById(containerId + "-pagination-top") ||
    (container ? container.querySelector(".ne-table-pagination") : null);
  if (!pager) return { found: false, currentPage: null, entries: null, pageItems: null, links: [], html: "" };
  const links = Array.from(pager.querySelectorAll("a, button, input")).map((el) => ({
    tag: el.tagName.toLowerCase(),
    type: el.getAttribute("type") || "",
    text: ((el.textContent || "") + " " + (el.getAttribute("value") || "")).replace(/\s+/g, " ").trim(),
    className: el.getAttribute("class") || "",
    dataPage: el.getAttribute("data-page"),
    href: el.getAttribute("href"),
    name: el.getAttribute("name") || "",
    disabled: el.hasAttribute("disabled") || /\bdisabled\b/.test(el.getAttribute("class") || ""),
  }));
  return {
    found: true,
    currentPage: attrNum(pager, "data-current-page"),
    entries: attrNum(pager, "data-entries"),
    pageItems: attrNum(pager, "data-page-items"),
    links,
    html: (pager.outerHTML || "").slice(0, 4000),
  };
}

/** 一覧の表示件数プルダウン（select#page_sel）を最大値にする。無い画面では false。 */
export function domMaximizePageSize(document) {
  const s = document.querySelector("select#page_sel");
  if (!s) return { changed: false, value: null };
  const values = Array.from(s.options || [])
    .map((o) => o.value)
    .filter((v) => /^\d+$/.test(v));
  if (!values.length) return { changed: false, value: s.value };
  const target = values.reduce((a, b) => (Number(b) > Number(a) ? b : a));
  if (s.value === target) return { changed: false, value: target };
  s.value = target;
  s.dispatchEvent(new Event("change", { bubbles: true }));
  return { changed: true, value: target };
}

/** モーダル背景・Cookie バナー等、クリックを遮る要素を除去する。 */
export function domRemoveBackdrops(document) {
  const sels = [".modal-backdrop", "#cm-ov", "#cc--main", ".bootbox", ".popover", ".tooltip", "#blockui"];
  let removed = 0;
  for (const sel of sels) {
    document.querySelectorAll(sel).forEach((e) => {
      e.remove();
      removed++;
    });
  }
  if (document.body) document.body.classList.remove("modal-open");
  return removed;
}

/** 一括ダウンロード画面の店舗ラジオを列挙する（probe 用・非破壊）。 */
export function domListTenpoRadios(document) {
  const norm = (v) => (v || "").replace(/\s+/g, " ").trim();
  return Array.from(document.querySelectorAll('input[type="radio"][name="tenpo_code_list[]"]')).map((r) => ({
    value: r.value,
    checked: !!r.checked,
    label: norm((r.closest && r.closest("label") ? r.closest("label").textContent : null) || (r.parentElement ? r.parentElement.textContent : "")),
  }));
}

/**
 * 店舗選択で「商品管理」ラジオを選択する（依頼手順 5）。
 * ラジオ自体が無い画面（＝店舗選択段が無い）は present:false を返し、呼び出し側は素通りする。
 */
export function domSelectShohinKanri(document) {
  const norm = (v) => (v || "").replace(/\s+/g, " ").trim();
  const labelOf = (r) =>
    norm((r.closest && r.closest("label") ? r.closest("label").textContent : null) || (r.parentElement ? r.parentElement.textContent : ""));
  const radios = Array.from(document.querySelectorAll('input[type="radio"][name="tenpo_code_list[]"]'));
  if (!radios.length) return { present: false, ok: false, label: null, labels: [] };
  const target = radios.find((r) => r.value === "0" || /商品管理/.test(labelOf(r)));
  if (!target) return { present: true, ok: false, label: null, labels: radios.map(labelOf) };
  if (!target.checked) {
    for (const r of radios) r.checked = false;
    target.checked = true;
    target.dispatchEvent(new Event("change", { bubbles: true }));
    target.dispatchEvent(new Event("click", { bubbles: true }));
  }
  const checked = radios.find((r) => r.checked) || target;
  return {
    present: true,
    ok: /商品管理/.test(labelOf(checked)) || checked.value === "0",
    label: labelOf(checked),
    labels: radios.map(labelOf),
  };
}

/** 畳まれている項目パネル（bootstrap collapse）を開く。閉じたままだと中のチェックボックスを操作できない。 */
export function domExpandPanels(document) {
  let opened = 0;
  document.querySelectorAll(".panel-collapse.collapse:not(.in)").forEach((e) => {
    e.classList.add("in");
    opened++;
  });
  return opened;
}

/**
 * 項目選択画面で全項目にチェックを入れる（依頼手順 6）。
 * 「全チェック」ボタンが効かない/無い画面でも確実に立てるため、素のチェックボックスを直接操作する。
 */
export function domCheckAllCheckboxes(document) {
  // 除外は **name ベース** で判定する。class に "all" を含むかで弾くと、
  // 正規の項目チェックボックス（例: class="… small"→将来 "all" を含む命名）まで落としかねないため。
  // 送信されない（name 空）＝制御用、または全チェック用の名前を持つものだけを除外する。
  const isControl = (b) => {
    const name = (b.getAttribute("name") || "").trim();
    if (name === "") return true;
    return /^(all|check[_-]?all|select[_-]?all|toggle[_-]?all)(\[\])?$/i.test(name);
  };
  const boxes = Array.from(document.querySelectorAll('input[type="checkbox"]')).filter(
    (b) => !b.disabled && !isControl(b),
  );
  let changed = 0;
  for (const b of boxes) {
    if (!b.checked) {
      b.checked = true;
      b.dispatchEvent(new Event("change", { bubbles: true }));
      b.dispatchEvent(new Event("click", { bubbles: true }));
      changed++;
    }
  }
  return { total: boxes.length, changed, checked: boxes.filter((b) => b.checked).length };
}

/** 項目選択画面にあるCSV（data-file-name）を列挙する。probe と失敗時診断の両方で使う。 */
export function domListDownloadTargets(document) {
  const norm = (v) => (v || "").replace(/\s+/g, " ").trim();
  return Array.from(document.querySelectorAll("[data-file-name]")).map((el) => {
    const panel = el.closest ? el.closest(".panel") : null;
    const heading = panel ? panel.querySelector(".panel-heading") : null;
    return {
      fileName: el.getAttribute("data-file-name") || "",
      tag: el.tagName.toLowerCase(),
      className: el.getAttribute("class") || "",
      panelHeading: heading ? norm(heading.textContent).slice(0, 80) : "",
    };
  });
}

/** パネル見出しを列挙する（data-file-name が付いていない画面の手掛かり）。 */
export function domListPanelHeadings(document) {
  const norm = (v) => (v || "").replace(/\s+/g, " ").trim();
  return Array.from(document.querySelectorAll(".panel-heading")).map((e) => norm(e.textContent).slice(0, 80));
}

/**
 * 目的のCSVのダウンロードボタンを特定する。
 * 1) data-file-name 完全一致 → 2) data-file-name の正規表現一致 → 3) パネル見出しの正規表現一致。
 * 見つからないときは画面上の候補（fileNames/panels）を返し、呼び出し側が診断メッセージに使う。
 */
export function domFindDownloadTarget(document, fileNames, patternSource, patternFlags) {
  const norm = (v) => (v || "").replace(/\s+/g, " ").trim();
  const all = Array.from(document.querySelectorAll("[data-file-name]"));
  for (const name of fileNames || []) {
    const hit = all.find((el) => el.getAttribute("data-file-name") === name);
    if (hit) return { found: true, by: "data-file-name", fileName: name };
  }
  let re = null;
  if (patternSource) {
    try {
      re = new RegExp(patternSource, patternFlags || "i");
    } catch {
      re = null;
    }
  }
  if (re) {
    const hit = all.find((el) => re.test(el.getAttribute("data-file-name") || ""));
    if (hit) return { found: true, by: "data-file-name-pattern", fileName: hit.getAttribute("data-file-name") };
    const panels = Array.from(document.querySelectorAll(".panel"));
    for (let i = 0; i < panels.length; i++) {
      const h = panels[i].querySelector(".panel-heading");
      const text = h ? norm(h.textContent) : "";
      if (re.test(text) && panels[i].querySelector("button.download, button.btn-primary")) {
        return { found: true, by: "panel-heading", panelIndex: i, panelHeading: text };
      }
    }
  }
  return {
    found: false,
    fileNames: all.map((el) => el.getAttribute("data-file-name")).filter(Boolean),
    panels: Array.from(document.querySelectorAll(".panel-heading")).map((e) => norm(e.textContent).slice(0, 60)),
  };
}
