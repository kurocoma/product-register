// [検証ページ] 商品ページ検証用のローカル HTML を生成（product-page-verification skill の生成エンジン）。
//
// 重要（2026-07-30 ユーザー裁定）:
//   - Artifact は使わない。出力は**ローカル HTML ファイル**（file:// でブラウザ表示）。
//   - 横スクロールを出さない（1商品=2段のテーブル行。リンク・作業内容・記入欄は2段目に折り返す）。
//   - 修正指示の保存はブラウザ標準ダウンロード（Blob + a[download]）で Downloads へ。
//
// 入力 JSON（--input）:
//   { "slug": "shimanoya-<案件>-<YYYYMMDD>", "title": "…", "date": "YYYY-MM-DD",
//     "summary": ["作業サマリー行"],
//     "items": [ { "manage": "r55-1", "yahooCode": "r55-1"(省略可), "workNotes": ["…"] } ] }
// 出力 (--out 省略時): .codex-work/verify-pages/<slug>.html
//
// URL 規則（実URL確認済み）:
//   RMS編集    https://item.rms.rakuten.co.jp/rms-sku/shops/{SHOP_ID}/item/edit/{manage}
//   ストクリ編集 https://editor.store.yahoo.co.jp/RT/{SELLER}/PageEdit/index?page_key={yahooCode}&page_mode=Edit
//   楽天ページ  https://item.rakuten.co.jp/{STORE}/{manage}/
//   Yahooページ https://store.shopping.yahoo.co.jp/{SELLER}/{yahooCode}.html
//   アプリ編集  {WEBUI_BASE}/products/{id}
// 実行: cd webui && npx tsx tests/verify_page_build.mjs --input <in.json> [--out <out.html>]
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { dbRowToProductInput } from "../lib/product/repository.ts";
import { getItem as yahooGetItem } from "../lib/yahoo/item-client.ts";
import { ROOT, API_TIMEOUT_MS, loadEnv, getAdmin, yahooAuth, withTimeout, xmlTag, sleep } from "./shimanoya_yahoo_sync_common.mjs";

loadEnv();

// ストア定数（店舗が変わったらここを変更）
const RAKUTEN_SHOP_ID = "235545";
const RAKUTEN_STORE = "ichiban-okinawa";
const YAHOO_SELLER = "okimarumarket";
const WEBUI_BASE = process.env.VERIFY_WEBUI_BASE || "http://localhost:3000";
const YAHOO_CODE_MAP = path.join(ROOT, ".codex-work", "yahoo-code-map.json");
const PAGES_DIR = path.join(ROOT, ".codex-work", "verify-pages");

const args = process.argv.slice(2);
const argOf = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const inputPath = argOf("--input");
if (!inputPath) { console.error("使い方: --input <in.json> [--out <out.html>]"); process.exit(1); }

const input = JSON.parse(readFileSync(inputPath, "utf8"));
const slug = String(input.slug || "verify").replace(/[^a-zA-Z0-9_-]/g, "-");
mkdirSync(PAGES_DIR, { recursive: true });
if (!existsSync(path.join(PAGES_DIR, ".gitignore"))) writeFileSync(path.join(PAGES_DIR, ".gitignore"), "*\n");
const outPath = argOf("--out") || path.join(PAGES_DIR, `${slug}.html`);

const codeMap = existsSync(YAHOO_CODE_MAP) ? JSON.parse(readFileSync(YAHOO_CODE_MAP, "utf8")) : {};
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const gross = (net, r) => net + Math.floor((net * r) / 100);
const yen = (n) => (n == null ? "—" : Number(n).toLocaleString("ja-JP"));

const admin = getAdmin();
async function resolve(item) {
  const manage = item.manage.trim();
  const q = await admin.from("products").select("*").eq("ne_code", manage)
    .order("updated_at", { ascending: false }).limit(2);
  if (q.error) throw new Error(`DB照会エラー(${manage}): ${q.error.message}`);
  if ((q.data ?? []).length > 1) console.warn(`注意: ne_code=${manage} がDBに複数行あります（最新更新の行を使用）`);
  let row = q.data?.[0] ?? null;
  // DB の ne_code がサフィックス付き（例: r7201-1-mg）の場合は Yahoo コード側でも引く
  const altCode = item.yahooCode || codeMap[manage];
  if (!row && altCode && altCode !== manage) {
    const q2 = await admin.from("products").select("*").eq("ne_code", altCode)
      .order("updated_at", { ascending: false }).limit(1);
    row = q2.data?.[0] ?? null;
  }
  if (!row) {
    const { data: rows } = await admin.from("products").select("*");
    row = (rows ?? []).find((r) => {
      try { return (dbRowToProductInput(r).variants ?? []).some((v) => String(v?.ne_code ?? "").trim() === manage); }
      catch { return false; }
    }) ?? null;
  }
  const p = row ? dbRowToProductInput(row) : null;
  const r = p?.tax_rate ?? null;
  const net = p?.selling_price ?? null;
  // 定期税抜: 自SKU variant の subscription_base_price（楽天側）を優先し、無ければ商品の yahoo_subscription_price
  let subNet = null;
  if (p && r != null) {
    const ownVariant = (p.variants ?? []).find((v) => {
      const c = String(v?.ne_code ?? "").trim();
      return c === manage || c === (item.yahooCode || codeMap[manage] || "");
    });
    const cand = Number(ownVariant?.subscription_base_price ?? 0) || Number(p.yahoo_subscription_price ?? 0) || 0;
    if (cand > 0) subNet = cand;
  }
  return {
    manage, rakutenManage: item.rakutenManage || manage,
    yahooCode: item.yahooCode || codeMap[manage] || manage,
    name: p?.display_name ?? "（アプリDBに該当なし）",
    productId: row?.id ?? null,
    priceNet: net,
    priceIncl: p && net != null && r != null ? gross(net, r) : null,
    subNet,
    subIncl: subNet != null && r != null ? gross(subNet, r) : null,
    workNotes: item.workNotes ?? [],
    found: !!row,
  };
}

const resolved = [];
for (const item of input.items ?? []) resolved.push(await resolve(item));

// Yahoo 売価の実測取得（2026-07-31 要望）。認証失効・取得失敗時は DB 算出値へフォールバックし注記する。
// VERIFY_NO_YAHOO=1 で実測をスキップできる（オフライン生成用）。
let yahooLive = false;
if (process.env.VERIFY_NO_YAHOO !== "1") {
  try {
    const auth = await yahooAuth();
    yahooLive = true;
    for (const p of resolved) {
      try {
        const got = await withTimeout(
          yahooGetItem(auth.token, auth.cfg.sellerId, p.yahooCode), API_TIMEOUT_MS, `yahoo getItem ${p.yahooCode}`);
        if (got?.exists && got.raw) {
          p.yahooPriceIncl = Number(xmlTag(got.raw, "Price") || 0) || null;
          p.yahooSubIncl = Number(xmlTag(got.raw, "SubscriptionPrice") || 0) || null;
          p.yahooSource = "実測";
        } else {
          p.yahooPriceIncl = null;
          p.yahooSubIncl = null;
          p.yahooSource = "未出品";
        }
      } catch (e) {
        p.yahooPriceIncl = p.priceIncl;
        p.yahooSubIncl = p.subIncl;
        p.yahooSource = "DB算出";
        console.warn(`Yahoo取得失敗 ${p.yahooCode}: ${String(e?.message ?? e).slice(0, 80)}`);
      }
      await sleep(150);
    }
  } catch (e) {
    console.warn(`Yahoo認証不可のため実測をスキップ（DB算出値を表示）: ${String(e?.message ?? e).slice(0, 120)}`);
  }
}
if (!yahooLive) for (const p of resolved) { p.yahooPriceIncl = p.priceIncl; p.yahooSubIncl = p.subIncl; p.yahooSource = "DB算出"; }

const rowsHtml = resolved.map((p) => {
  const links = [
    ["RMS編集", `https://item.rms.rakuten.co.jp/rms-sku/shops/${RAKUTEN_SHOP_ID}/item/edit/${encodeURIComponent(p.rakutenManage)}`],
    ["ストクリ編集", `https://editor.store.yahoo.co.jp/RT/${YAHOO_SELLER}/PageEdit/index?page_key=${encodeURIComponent(p.yahooCode)}&page_mode=Edit`],
    ["楽天ページ", `https://item.rakuten.co.jp/${RAKUTEN_STORE}/${encodeURIComponent(p.rakutenManage)}/`],
    ["Yahooページ", `https://store.shopping.yahoo.co.jp/${YAHOO_SELLER}/${encodeURIComponent(p.yahooCode)}.html`],
    p.productId ? ["アプリ", `${WEBUI_BASE}/products/${p.productId}`] : null,
  ].filter(Boolean).map(([label, url]) =>
    `<a class="lnk" data-lnk="${esc(p.manage)}:${esc(label)}" href="${esc(url)}" target="_blank" rel="noopener">${label}</a>`).join("");
  const notes = p.workNotes.length
    ? `<ul>${p.workNotes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`
    : `<span class="mute">（個別作業の記録なし）</span>`;
  return `
  <tbody class="item" data-manage="${esc(p.manage)}">
    <tr class="r1">
      <td class="mn">${esc(p.manage)}</td>
      <td class="code">${esc(p.yahooCode)}</td>
      <td class="name" title="${esc(p.name)}">${esc(p.name)}${p.found ? "" : ' <span class="warnchip">DB未解決</span>'}</td>
      <td class="num net">${yen(p.priceNet)}</td>
      <td class="num">${yen(p.priceIncl)}</td>
      <td class="num${p.yahooPriceIncl != null && p.priceIncl != null && p.yahooPriceIncl !== p.priceIncl ? " mismatch" : ""}"${
        p.yahooSource && p.yahooSource !== "実測" ? ` title="${esc(p.yahooSource)}"` : ""}>${
        p.yahooSource === "未出品" ? '<span class="mute">未出品</span>' : yen(p.yahooPriceIncl)}${
        p.yahooSource === "DB算出" ? ' <span class="warnchip">DB算出</span>' : ""}</td>
      <td class="num net">${p.subNet != null ? yen(p.subNet) : '<span class="mute">—</span>'}</td>
      <td class="num">${p.subIncl != null ? yen(p.subIncl) : '<span class="mute">—</span>'}</td>
      <td class="num${p.yahooSource === "実測" && (p.yahooSubIncl ?? 0) !== (p.subIncl ?? 0) ? " mismatch" : ""}">${
        p.yahooSource === "未出品" ? '<span class="mute">未出品</span>'
        : p.yahooSubIncl != null ? yen(p.yahooSubIncl) : '<span class="mute">—</span>'}</td>
      <td class="chkc"><label><input type="checkbox" class="chk" data-key="${esc(p.manage)}"> 済</label></td>
    </tr>
    <tr class="r2">
      <td colspan="10">
        <div class="detail">
          <div class="links">${links}</div>
          <div class="work">${notes}</div>
          <textarea class="fix" data-key="${esc(p.manage)}" placeholder="修正が必要なら内容をここに（空欄=修正なし）"></textarea>
        </div>
      </td>
    </tr>
  </tbody>`;
}).join("\n");

const summaryHtml = (input.summary ?? []).map((s) => `<li>${esc(s)}</li>`).join("");

const html = `<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(input.title || "商品ページ検証")}</title>
<style>
  :root{--bg:#F6F7F5;--panel:#fff;--ink:#202623;--soft:#5C6660;--line:#DEE3DD;--line2:#C8CFC9;--acc:#245A50;--acc-soft:#E3EEEA;
    --ok-soft:#EAF4EE;--warn:#8A6100;--warn-soft:#F6EEDC;--mono:ui-monospace,Consolas,monospace;}
  @media (prefers-color-scheme: dark){:root{--bg:#141917;--panel:#1C2320;--ink:#E4E9E6;--soft:#98A39D;--line:#2B342F;--line2:#3A4540;
    --acc:#7CC3B4;--acc-soft:#20332E;--ok-soft:#1E2E27;--warn:#D6A759;--warn-soft:#362C18;}}
  *{box-sizing:border-box}
  body{background:var(--bg);color:var(--ink);margin:0;padding:1.6rem 1rem 5.5rem;line-height:1.6;
    font-family:"Hiragino Kaku Gothic ProN","Yu Gothic UI",Meiryo,system-ui,sans-serif;}
  main{max-width:74rem;margin:0 auto;display:grid;gap:.9rem;}
  h1{font-size:1.22rem;margin:0;}
  .meta{color:var(--soft);font-size:.82rem;font-family:var(--mono);}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:.85rem 1.15rem;}
  .card h2{font-size:.9rem;margin:0 0 .4rem;}
  .card ul{margin:0;padding-left:1.3em;font-size:.87rem;}
  .tablewrap{background:var(--panel);border:1px solid var(--line);border-radius:8px;}
  table{border-collapse:collapse;width:100%;font-size:.85rem;table-layout:auto;}
  thead th{position:sticky;top:0;z-index:5;background:var(--panel);font-size:.73rem;color:var(--soft);text-align:left;
    padding:.5rem .6rem;border-bottom:2px solid var(--line2);white-space:nowrap;box-shadow:0 1px 0 var(--line2);}
  thead th.num{text-align:right;}
  td{padding:.45rem .6rem;vertical-align:baseline;}
  tbody.item tr.r1 td{border-top:1px solid var(--line);}
  tbody.item.checked{background:var(--ok-soft);}
  .mn{font-family:var(--mono);font-weight:700;color:var(--acc);white-space:nowrap;}
  .code{font-family:var(--mono);color:var(--soft);white-space:nowrap;}
  .name{overflow-wrap:anywhere;font-size:.83rem;}
  .num{text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums;white-space:nowrap;}
  td.num{padding-left:.3rem;padding-right:.45rem;font-size:.82rem;}
  thead th{line-height:1.3;}
  .num.mismatch{color:var(--warn);font-weight:700;background:var(--warn-soft);}
  td.num.net{color:var(--soft);opacity:.75;}
  .chkc{white-space:nowrap;text-align:center;}
  .chkc label{cursor:pointer;display:inline-flex;gap:.3rem;align-items:center;font-size:.83rem;}
  .chkc input{width:1.1rem;height:1.1rem;accent-color:var(--acc);cursor:pointer;}
  tr.r2 td{padding-top:0;padding-bottom:.7rem;}
  .detail{display:flex;flex-wrap:wrap;gap:.6rem;align-items:flex-start;}
  .links{display:flex;flex-wrap:wrap;gap:.4rem;}
  .lnk{display:inline-block;padding:.22em .75em;border-radius:5px;background:var(--acc-soft);color:var(--acc);
    text-decoration:none;font-size:.8rem;font-weight:700;white-space:nowrap;}
  .lnk:hover{outline:1px solid var(--acc);}
  .lnk.visited{background:transparent;border:1px solid var(--line2);color:var(--soft);font-weight:400;}
  .lnk.visited::before{content:"✓ ";color:var(--acc);}
  .work{flex:1 1 16rem;font-size:.8rem;color:var(--soft);min-width:12rem;}
  .work ul{margin:0;padding-left:1.1em;}
  .warnchip{font-size:.72rem;background:var(--warn-soft);color:var(--warn);padding:.05em .5em;border-radius:4px;}
  .mute{color:var(--soft);font-size:.8rem;}
  textarea{flex:1 1 100%;min-height:2.1rem;border:1px dashed var(--line2);border-radius:5px;
    background:transparent;color:var(--ink);padding:.35rem .55rem;font-size:.83rem;font-family:inherit;resize:vertical;}
  textarea:focus{outline:2px solid var(--acc);border-style:solid;}
  .savebar{position:fixed;bottom:0;left:0;right:0;background:var(--panel);border-top:1px solid var(--line);
    padding:.6rem 1rem;display:flex;gap:.8rem;align-items:center;justify-content:center;flex-wrap:wrap;}
  button{background:var(--acc);color:#fff;border:0;border-radius:6px;padding:.5em 1.3em;font-size:.92rem;
    font-weight:700;cursor:pointer;font-family:inherit;}
  button.sub{background:transparent;color:var(--acc);border:1px solid var(--acc);}
  #status{font-size:.82rem;color:var(--soft);min-width:12rem;}
  @media (max-width:640px){
    thead{display:none}
    tbody.item tr.r1 td{display:inline-block;border-top:0;padding:.15rem .35rem;}
    tbody.item{display:block;border-top:1px solid var(--line);padding:.5rem .4rem;}
    tbody.item tr{display:block;}
    .name{display:block;}
  }
</style></head><body>
<main>
  <header>
    <h1>${esc(input.title || "商品ページ検証")}</h1>
    <p class="meta">${esc(input.date || "")} ・ 対象 ${resolved.length} 商品 ・ ${esc(slug)}</p>
  </header>
  <div class="card"><h2>作業サマリー</h2><ul>${summaryHtml}</ul></div>
  <div class="tablewrap">
    <table>
      <thead><tr>
        <th>商品管理番号</th><th>商品コード</th><th>商品名</th>
        <th class="num">売価税抜<br>(楽天)</th><th class="num">売価税込<br>(楽天)</th><th class="num" title="Yahoo getItem の実測値。楽天税込と違う場合は黄色表示">売価税込<br>(Yahoo)</th>
        <th class="num">定期税抜<br>(楽天)</th><th class="num">定期税込<br>(楽天)</th><th class="num" title="Yahoo getItem の実測値。楽天の定期税込と違う場合は黄色表示">定期税込<br>(Yahoo)</th>
        <th>確認済み</th>
      </tr></thead>
      ${rowsHtml}
    </table>
  </div>
  <div class="card"><h2>全体メモ（商品に紐づかない指示）</h2>
    <textarea id="globalMemo" style="width:100%" placeholder="全体への修正指示・気づきがあればここに"></textarea></div>
</main>
<div class="savebar">
  <span id="status">記入内容はこの端末に自動保存されます</span>
  <button id="saveBtn">修正指示ファイルを保存</button>
  <button id="copyBtn" class="sub">コピーする</button>
</div>
<script>
(function(){
  var SLUG=${JSON.stringify(slug)};
  var LS="verify:"+SLUG, state={};
  try{state=JSON.parse(localStorage.getItem(LS)||"{}")}catch(e){state={}}
  function persist(){try{localStorage.setItem(LS,JSON.stringify(state))}catch(e){}}
  document.querySelectorAll(".chk").forEach(function(c){
    var k=c.getAttribute("data-key");
    if(state["chk:"+k]){c.checked=true;c.closest("tbody").classList.add("checked");}
    c.addEventListener("change",function(){
      state["chk:"+k]=c.checked;persist();
      c.closest("tbody").classList.toggle("checked",c.checked);
    });
  });
  document.querySelectorAll("textarea").forEach(function(t){
    var k=t.id||("fix:"+t.getAttribute("data-key"));
    if(state["txt:"+k])t.value=state["txt:"+k];
    t.addEventListener("input",function(){state["txt:"+k]=t.value;persist();});
  });
  // リンクのクリック済み表示（色を変えて記録。開き直しても残る）
  document.querySelectorAll(".lnk").forEach(function(a){
    var k="lnk:"+a.getAttribute("data-lnk");
    if(state[k])a.classList.add("visited");
    a.addEventListener("click",function(){state[k]=true;persist();a.classList.add("visited");});
  });
  function collect(){
    var items=[];
    document.querySelectorAll("tbody.item").forEach(function(sec){
      var m=sec.getAttribute("data-manage");
      var fix=(sec.querySelector(".fix").value||"").trim();
      var chk=sec.querySelector(".chk").checked;
      if(fix||chk)items.push({manage:m,checked:chk,fix:fix||null});
    });
    return {slug:SLUG,savedAt:new Date().toISOString(),
      globalMemo:(document.getElementById("globalMemo").value||"").trim()||null,items:items};
  }
  var st=document.getElementById("status");
  document.getElementById("saveBtn").addEventListener("click",function(){
    var payload=collect();
    if(!payload.items.filter(function(i){return i.fix}).length&&!payload.globalMemo){
      st.textContent="修正指示の記入がありません（チェックのみは保存不要）";return;}
    var blob=new Blob([JSON.stringify(payload,null,1)],{type:"application/json"});
    var a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download="verify-fixes-"+SLUG+".json";
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(function(){URL.revokeObjectURL(a.href)},2000);
    st.textContent="Downloads に保存しました。チャットで「修正指示を読んで」と伝えてください。";
  });
  document.getElementById("copyBtn").addEventListener("click",function(){
    var text=JSON.stringify(collect(),null,1);
    (navigator.clipboard?navigator.clipboard.writeText(text):Promise.reject()).then(function(){
      st.textContent="コピーしました。チャットに貼り付けてください。";
    },function(){window.prompt("以下をコピーしてチャットに貼ってください",text);});
  });
})();
</script>
</body></html>`;

writeFileSync(outPath, html);
console.log(`生成完了: ${outPath}`);
console.log(`対象 ${resolved.length} 商品 / DB解決 ${resolved.filter((p) => p.found).length} / 未解決 ${resolved.filter((p) => !p.found).map((p) => p.manage).join(",") || "なし"}`);
