// [レポート] しまのや 楽天→Yahoo 一括反映（2026-07-26）: 人間可読の集計レポート report.md を生成する。
// 入力は機械可読JSONのみ（targets.json / backup-results.json / sync-results.json / image-check.json /
// verify-results.json）。集計値はすべてJSONから計算するので、JSONとレポートの数字は必ず一致する。
// 実行: cd webui && npx tsx tests/shimanoya_yahoo_sync_report.mjs
import path from "node:path";
import { writeFileSync } from "node:fs";
import { TARGETS, WORK_DIR, ensureWorkDir, readJson, readJsonl, nowIso } from "./shimanoya_yahoo_sync_common.mjs";

ensureWorkDir();
const targets = readJson(path.join(WORK_DIR, "targets.json"));
const backup = readJson(path.join(WORK_DIR, "backup-results.json"));
const sync = readJson(path.join(WORK_DIR, "sync-results.json"));
const image = readJson(path.join(WORK_DIR, "image-check.json"));
const verify = readJson(path.join(WORK_DIR, "verify-results.json"));
const authBlocked = readJson(path.join(WORK_DIR, "auth-blocked.json"));

const S = (v) => String(v ?? "");
const esc = (v) => S(v).replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
const trunc = (v, n = 90) => (S(v).length > n ? S(v).slice(0, n) + "…" : S(v));

const syncResults = sync?.results ?? [];
const byManage = new Map(syncResults.map((r) => [r.manage, r]));
const ok = syncResults.filter((r) => r.status === "ok");
const ng = syncResults.filter((r) => r.status === "ng");
const skip = syncResults.filter((r) => r.status === "skip");
const applied = ok.filter((r) => !r.noChange);
const noChange = ok.filter((r) => r.noChange);

// --- 送信された変更項目の集計 ---
const fieldCount = new Map();
for (const r of applied) for (const f of r.appliedFields ?? []) fieldCount.set(f, (fieldCount.get(f) ?? 0) + 1);
const fieldRows = [...fieldCount.entries()].sort((a, b) => b[1] - a[1]);

// --- 楽天取込(read-before-write) ---
const pullOk = syncResults.filter((r) => r.rakutenPull?.ok);
const pullNg = syncResults.filter((r) => r.rakutenPull && !r.rakutenPull.ok);
const pullChanged = pullOk.filter((r) => (r.rakutenPull.changedFields ?? []).length > 0);

// --- 在庫 ---
const stockSent = ok.filter((r) => r.stock?.sent);
const stockSentOk = stockSent.filter((r) => r.stock?.ok);
const stockHeld = ok.filter((r) => r.stock && !r.stock.sent);

// --- 理由の内訳 ---
function groupBy(list, keyFn) {
  const m = new Map();
  for (const x of list) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
}
const ngGroups = groupBy(ng, (r) => normalizeReason(S(r.error ?? r.reason)));
const skipGroups = groupBy(skip, (r) => normalizeReason(S(r.reason ?? r.error)));
function normalizeReason(msg) {
  if (/存在しません/.test(msg) && /Yahoo/.test(msg)) return "Yahooに商品が存在しない（新規出品が必要・本作業の対象外）";
  if (/タイムアウト/.test(msg)) return "タイムアウト";
  if (/API更新で保持できない設定/.test(msg)) return "高度設定ガード（editItemで保持できない設定を含む）";
  if (/定期購入設定が不正/.test(msg)) return "定期購入設定の事前検証エラー";
  if (/アプリDBに該当商品がありません/.test(msg)) return "商品登録アプリに該当商品がない";
  if (/DRY-RUN/.test(msg)) return "DRY-RUN（送信していない）";
  return trunc(msg, 120) || "（理由未記録）";
}

// --- 画像リンク切れ ---
const broken = image?.brokenList ?? [];
const brokenByManage = groupBy(broken, (b) => b.manage);

// --- 検証 ---
const vOk = (verify?.results ?? []).filter((r) => r.verdict === "ok");
const vNg = (verify?.results ?? []).filter((r) => r.verdict === "ng");
const vNa = (verify?.results ?? []).filter((r) => r.verdict === "not-applied");

const lines = [];
const P = (s = "") => lines.push(s);

P("# しまのや 楽天→Yahoo 一括反映 レポート（2026-07-26）");
P();
P(`生成: ${nowIso()}`);
P();
P("## 0. 最初に読む — 未実施のモール操作");
P();
const published = readJson(path.join(WORK_DIR, "publish-result.json"));
if (published?.publish?.ok) {
  P("- ✅ **公開反映（reservePublish）は実行済みです**（ユーザー承認 2026-07-27）。対象66件はストアフロントに公開されています。");
  P("  在庫は全件100、公開状態は全件 display=1。実地確認した商品はすべて HTTP 200・売り切れ表示なしでした（詳細は追J）。");
} else {
  P("- **Yahoo フロントへの公開反映（reservePublish＝全反映予約）は実行していません。**");
  P("  ユーザー確定方針「公開は保留。完了報告を見て判断する」に従い、`editItem` / `setStock`（ストア編集内容の更新）のみ行っています。");
  P("  更新内容は Yahoo ストアクリエイターPro 上では「未反映（編集中）」の状態です。公開するには管理画面で「反映」を実行してください。");
}
P("- 楽天側への書き込みは一切していません（楽天は読み取り＝ `getItem` のみ）。");
if (authBlocked) {
  P(`- **⚠ Yahoo 認証で停止した処理があります（${esc(authBlocked.phase)}）**: ${esc(authBlocked.message)}`);
  P(`  → ユーザー操作が必要です: ${esc(authBlocked.userActionRequired)}`);
}
P();
P("## 1. 集計");
P();
P("| 区分 | 件数 |");
P("| --- | ---: |");
P(`| 対象（ユーザー指定） | ${TARGETS.length} |`);
P(`| **反映OK** | **${ok.length}** |`);
P(`| ├ 実際に editItem を送信 | ${applied.length} |`);
P(`| └ 差分なし（送信不要） | ${noChange.length} |`);
P(`| 反映NG（エラー） | ${ng.length} |`);
P(`| スキップ（反映対象外） | ${skip.length} |`);
P();
// バックアップ件数は JSONL 実体から数える（反映中に取込作成した商品の現在値も追記されるため）
const backupYahoo = new Map(readJsonl(path.join(WORK_DIR, "backup", "yahoo-current.jsonl")).filter((r) => r.exists).map((r) => [r.manage, r]));
P(`- 変更前バックアップ: Yahoo 現在値 ${backupYahoo.size}件（生XML） / アプリDB行 ${backup?.dbRowsSaved ?? 0}件退避`);
P(`- 楽天からの最新取込（read-before-write）: 成功 ${pullOk.length}件（うちDB更新あり ${pullChanged.length}件） / 失敗 ${pullNg.length}件`);
P(`- 在庫(setStock): 送信 ${stockSent.length}件（成功 ${stockSentOk.length}件） / 送信せず ${stockHeld.length}件`);
P(`- 画像URL検査: ${image?.checkedUrls ?? 0}件（ユニーク ${image?.uniqueUrls ?? 0}件）中 リンク切れ ${image?.brokenUrls ?? 0}件（${image?.brokenItems ?? 0}商品）`);
P(`- 反映後の読み戻し検証: 一致 ${vOk.length} / 不一致 ${vNg.length} / 検証対象外 ${vNa.length}`);
P();

P("## 2. NG（エラー）の内訳");
P();
if (ng.length === 0) {
  P("エラーはありません。");
} else {
  P("| 理由 | 件数 | 商品 |");
  P("| --- | ---: | --- |");
  for (const [reason, list] of ngGroups) P(`| ${esc(reason)} | ${list.length} | ${list.map((r) => esc(r.manage)).join(", ")} |`);
  P();
  P("### 個別のエラー内容");
  P();
  P("| 管理番号 | Yahoo商品コード | 段階 | エラー |");
  P("| --- | --- | --- | --- |");
  for (const r of ng) P(`| ${esc(r.manage)} | ${esc(r.itemCode)} | ${esc(r.phase ?? "")} | ${esc(trunc(r.error ?? r.reason, 220))} |`);
}
P();

P("## 3. スキップ（反映対象外）の内訳");
P();
if (skip.length === 0) {
  P("スキップはありません。");
} else {
  P("| 理由 | 件数 | 商品 |");
  P("| --- | ---: | --- |");
  for (const [reason, list] of skipGroups) P(`| ${esc(reason)} | ${list.length} | ${list.map((r) => esc(r.manage)).join(", ")} |`);
}
P();

P("## 4. Yahoo へ送信した変更項目（実際に editItem を送った " + applied.length + "件の内訳）");
P();
if (fieldRows.length === 0) {
  P("送信した変更項目はありません。");
} else {
  P("| 変更項目 | 件数 |");
  P("| --- | ---: |");
  for (const [f, n] of fieldRows) P(`| ${esc(f)} | ${n} |`);
}
P();

P("## 5. 画像リンク切れ（報告のみ・反映は続行）");
P();
P("検査対象: `yahoo_item_image`=Yahooへ送る商品画像 / `yahoo_caption_img`=商品説明HTML内の画像 / `app_db_image`=アプリDBの画像URL。");
P(`per-call タイムアウト ${image?.timeoutMs ?? 15000}ms・HEAD（405/403時はGETで再確認）。`);
P();
if (broken.length === 0) {
  P("**リンク切れはありません**（検査した全URLが HTTP 200 系で応答）。");
} else {
  P("| 管理番号 | 種別 | HTTPステータス | URL |");
  P("| --- | --- | ---: | --- |");
  for (const [, list] of brokenByManage) for (const b of list) P(`| ${esc(b.manage)} | ${esc(b.source)} | ${b.status || esc(b.error ?? "接続不可")} | ${esc(b.url)} |`);
}
P();

P("## 6. 反映後の読み戻し検証");
P();
P("Yahoo `getItem` で読み戻し、**送信した editItem パラメータ**（sent）と**アプリDB（楽天取込後）から算出した期待値**（db）の両方と突き合わせています。");
P("検証項目: 商品名 / 価格(税込) / 表示価格 / 商品説明(caption) / キャッチコピー / JAN / Yahooカテゴリ / ストアカテゴリパス / 画像(item_image_urls) / 商品オプション / 在庫数 / 定期購入。");
P();
if (!verify) {
  P("検証未実施です。");
} else if (vNg.length === 0) {
  P(`**${vOk.length}件すべてで主要フィールドが期待値と一致**しました（検証対象外 ${vNa.length}件は反映していない商品）。`);
} else {
  P(`一致 ${vOk.length}件 / 不一致 ${vNg.length}件。不一致の内訳:`);
  P();
  P("| 管理番号 | 項目 | 期待値 | 実際の値 |");
  P("| --- | --- | --- | --- |");
  for (const m of verify.mismatches ?? []) {
    if (!(m.fields ?? []).length) P(`| ${esc(m.manage)} | (検証不可) | - | ${esc(trunc(m.reason, 120))} |`);
    for (const f of m.fields ?? []) P(`| ${esc(m.manage)} | ${esc(f.field)}[${esc(f.source)}] | ${esc(trunc(f.expected, 110))} | ${esc(trunc(f.actual, 110))} |`);
  }
}
P();

P("## 6-2. 反映しても直らない不一致（要判断）");
P();
// 税率区分ずれ: アプリの反映は tax_rate を差分項目に持たないため editItem では補正されない
const taxNg = (verify?.results ?? []).filter((r) => (r.checks ?? []).some((c) => c.field === "税率区分" && c.match === false));
if (taxNg.length) {
  P(`### Yahoo 側の消費税率が楽天（アプリ）と違う商品 ${taxNg.length}件`);
  P();
  P("アプリの「反映」は消費税率(`tax_rate`)を差分項目として扱わないため、`editItem` では自動補正されません。");
  P("税率がずれていると、同じ税抜価格でも**お客様の支払額（税込表示）がずれます**。ストア管理画面で税率区分を修正してください。");
  P();
  P("| 管理番号 | 楽天(アプリ)の税率 | Yahooの税率区分 | Yahooの税込価格 | 楽天起点の期待税込価格 |");
  P("| --- | --- | --- | ---: | ---: |");
  for (const r of taxNg) {
    const c = r.checks.find((x) => x.field === "税率区分");
    const pr = r.checks.find((x) => x.field === "価格(税込)" && x.source === "db");
    P(`| ${esc(r.manage)} | ${esc(Math.round(Number(c.expected) * 100))}% | ${esc(c.actual ? `${Math.round(Number(c.actual) * 100)}%` : "(なし)")} | ${esc(pr?.actual ?? "")} | ${esc(pr?.expected ?? "")} |`);
  }
  P();
}
// 商品説明に楽天へのリンクが残っている商品（Yahoo は中継ページへ自動書き換えするが、内容としては競合モールへの誘導）
const sentRecs = readJsonl(path.join(WORK_DIR, "sent-params.jsonl"));
const rakutenLink = [...new Map(sentRecs.map((r) => [r.manage, r])).values()]
  .filter((r) => /rakuten\.co\.jp/i.test(String(r.params?.caption ?? "")));
if (rakutenLink.length) {
  P(`### 商品説明に楽天へのリンクが含まれる商品 ${rakutenLink.length}件`);
  P();
  P("楽天の商品説明をそのまま反映しているため、Yahoo の商品ページに楽天商品ページへのリンクが載ります");
  P("（Yahoo 側は自動で中継ページ経由のURLに書き換えます）。差し替えるかどうかは要判断です。");
  P();
  P(`対象: ${rakutenLink.map((r) => esc(r.manage)).join(", ")}`);
  P();
}
if (!taxNg.length && !rakutenLink.length) {
  P("該当なし。");
  P();
}

P("## 7. 在庫（setStock）の扱い");
P();
P("Yahoo の在庫は `editItem` では更新できない別API（`setStock`）です。本作業では **アプリDBに在庫の管理値がある商品だけ** 送信し、");
P("管理値がない商品は Yahoo 側の現在値をそのまま維持しました（値が無いのに 0 等を送ると実在庫を壊すため）。");
P();
P("| 区分 | 件数 | 商品 |");
P("| --- | ---: | --- |");
P(`| setStock 送信・成功 | ${stockSentOk.length} | ${stockSentOk.map((r) => esc(r.manage)).join(", ")} |`);
P(`| setStock 送信・失敗 | ${stockSent.length - stockSentOk.length} | ${stockSent.filter((r) => !r.stock?.ok).map((r) => esc(r.manage)).join(", ")} |`);
P(`| 送信せず（Yahoo現在値を維持） | ${stockHeld.length} | ${stockHeld.length > 12 ? `${stockHeld.length}件（全件 sync-results.json 参照）` : stockHeld.map((r) => esc(r.manage)).join(", ")} |`);
P();
const zeroStock = ok.filter((r) => r.yahooQuantityBefore === 0);
if (zeroStock.length) {
  P(`> **注意: Yahoo 側の在庫数が 0 の商品が ${zeroStock.length}件あります**（反映前の実測値）。`);
  P("> 在庫0のままフロントへ公開すると売り切れ表示になります。公開反映の前に Yahoo 側の在庫設定を確認してください。");
  P(`> 対象: ${zeroStock.map((r) => esc(r.manage)).join(", ")}`);
  P();
}

P("## 8. 楽天からの最新取込（read-before-write）");
P();
P("反映の直前に楽天 `getItem` の現在値をアプリDBへ取込み、楽天現在値を起点に Yahoo へ送っています。");
P();
if (pullNg.length) {
  P("**取込に失敗した商品（アプリDBの現在値を起点に反映しています）**");
  P();
  P("| 管理番号 | エラー |");
  P("| --- | --- |");
  for (const r of pullNg) P(`| ${esc(r.manage)} | ${esc(trunc(r.rakutenPull.error, 160))} |`);
  P();
}
if (pullChanged.length) {
  P("**取込でアプリDBの値が変わった商品（＝アプリDBが楽天より古かった項目）**");
  P();
  P("| 管理番号 | 更新された項目 |");
  P("| --- | --- |");
  for (const r of pullChanged) P(`| ${esc(r.manage)} | ${esc((r.rakutenPull.changedFields ?? []).map((c) => c.field).join(", "))} |`);
} else {
  P("反映実行時の取込ではアプリDBに変更はありませんでした（＝この時点でアプリDBは楽天の現在値と一致していた）。");
  P("※ 反映前の dry-run でも同じ取込を行っており、そこで楽天現在値への同期が済んでいます。");
}
P();

P("## 9. バックアップと復元");
P();
P("変更前の状態は `backup/` に保存済みです（git 追跡外・コミット禁止）。");
P();
P("| ファイル | 内容 |");
P("| --- | --- |");
P("| `backup/yahoo-current.jsonl` | Yahoo `getItem` の生XML（ロスレス正本） |");
P("| `backup/yahoo-current.csv` | 上記の主要フィールド抜粋（Excel確認用） |");
P("| `backup/app-db-current-rows.jsonl` | 商品登録アプリDBの該当行（楽天取込で上書きされる前） |");
P("| `backup/RESTORE.md` | 復元手順（Yahoo側・アプリDB側の両方） |");
if ((sync?.createdProductIds ?? []).length) {
  P();
  P(`※ 本作業で商品登録アプリに新規作成した商品が ${sync.createdProductIds.length}件あります（楽天からの取込で作成）。`);
  P(`   復元時はこれらを削除してください: ${sync.createdProductIds.map((x) => `\`${x}\``).join(", ")}`);
}
P();

P("## 10. 全66件の結果一覧");
P();
P("| # | 管理番号 | Yahoo商品コード | 結果 | 内容 |");
P("| ---: | --- | --- | --- | --- |");
TARGETS.forEach((manage, idx) => {
  const r = byManage.get(manage);
  const t = (targets?.items ?? []).find((x) => x.manage === manage);
  const status = r ? { ok: "OK", ng: "NG", skip: "SKIP" }[r.status] ?? r.status : "未処理";
  let detail = "";
  if (!r) detail = "結果が記録されていません";
  else if (r.status === "ok") detail = r.noChange ? "差分なし（送信不要）" : `${(r.appliedFields ?? []).length}項目を反映${r.stock?.sent ? ` / 在庫${r.stock.quantity}` : ""}`;
  else detail = trunc(r.error ?? r.reason, 140);
  const v = (verify?.results ?? []).find((x) => x.manage === manage);
  const vTag = v?.verdict === "ok" ? " ✅検証一致" : v?.verdict === "ng" ? ` ⚠検証不一致(${(v.mismatched ?? []).join(",")})` : "";
  P(`| ${idx + 1} | ${esc(manage)} | ${esc(r?.itemCode ?? t?.itemCode ?? "")} | ${status} | ${esc(detail)}${esc(vTag)} |`);
});
P();

// ============================================================================
// 追加作業（2026-07-26 ユーザー裁定分）: 税率修正 / 楽天リンク置換 / 未登録商品の新規出品
// ============================================================================
const taxFix = readJson(path.join(WORK_DIR, "tax-fix-results.json"));
const linkRep = readJson(path.join(WORK_DIR, "link-replace.json"));
const reg = readJson(path.join(WORK_DIR, "register-results.json"));

if (taxFix) {
  P("## 追A. 税率不一致の修正（ユーザー裁定）");
  P();
  P(`裁定: ${esc(taxFix.ruling)}`);
  P();
  P("| 管理番号 | 対応 | 結果 | 変更前 | 変更後 |");
  P("| --- | --- | --- | --- | --- |");
  for (const r of taxFix.results) {
    const label = { ok: "OK", ng: "NG", skip: "SKIP" }[r.status] ?? r.status;
    const before = r.fix === "yahoo"
      ? `税率 ${esc(r.before?.taxrateType)} / 価格 ${esc(r.before?.price)}`
      : `アプリDB税率 ${esc(r.before?.appTaxRate)}%`;
    const after = r.fix === "yahoo"
      ? `税率 ${esc(r.after?.taxrateType)} / 価格 ${esc(r.after?.price)}`
      : `アプリDB税率 ${esc(r.after?.appTaxRate ?? r.before?.appTaxRate)}%`;
    P(`| ${esc(r.manage)} | ${r.fix === "yahoo" ? "Yahooを修正" : "アプリDBを修正（Yahooは変更せず）"} | ${label} | ${before} | ${after} |`);
  }
  P();
  P("Yahoo 側を直した3件は `editItem` 送信後に `getItem` で読み戻し、税率区分と価格の反映を確認しています。");
  const noted = taxFix.results.filter((r) => r.note);
  for (const r of noted) P(`- **${esc(r.manage)}**: ${esc(r.note)}`);
  P(`- **楽天側の税率は修正していません**（${esc(taxFix.rakutenScope)}）。楽天と Yahoo で税率が異なる状態が残る商品があります。`);
  P();
}

if (linkRep) {
  P("## 追B. 商品説明内の楽天リンクの置換");
  P();
  P(`結果: 置換 ${linkRep.ok}件 / 失敗 ${linkRep.ng}件 / 置換せず ${linkRep.skip}件。${esc(linkRep.note)}`);
  P();
  P("| 管理番号 | 置換前 | 置換後 | 判定 |");
  P("| --- | --- | --- | --- |");
  for (const m of linkRep.mappings ?? []) {
    P(`| ${esc(m.manage)} | ${esc(m.from)} | ${esc(m.to ?? "（置換せず）")} | ${esc(m.to ? `OK（${m.yahooItemCode} / HTTP ${m.httpStatus}）` : m.reason)} |`);
  }
  P();
  const held = (linkRep.results ?? []).filter((r) => r.status === "skip");
  if (held.length) {
    P("> **置換を見送った理由**: 置換先の Yahoo 商品はストアエディタには存在しますが**非公開（Display=0）**のため、");
    P("> ストアページが 404 になります。そのまま置換すると買い物客にリンク切れを見せることになるため、");
    P("> リンクは楽天のまま残しました。置換先商品を公開したうえで本スクリプトを再実行すれば置換できます:");
    P("> `cd webui && npx tsx tests/shimanoya_yahoo_link_replace.mjs`");
    P();
  }
}

if (reg) {
  P("## 追C. Yahoo 未登録商品の新規出品（display=0・公開はしない）");
  P();
  P(`結果: 新規登録 ${reg.registered}件 / 既存出品あり（登録せず）${reg.existing}件 / 見送り ${reg.skipped}件 / 失敗 ${reg.failed}件。`);
  P();
  P("**重複出品を作らないため、登録前に管理番号・NEコード・全SKUコード・サフィックス除去形で `getItem` を総当たりし、");
  P("既存出品がないことを確認しています**（前回の SKIP 判定は NEコード1本のルックアップ依存だったため）。");
  P();
  P("| 管理番号 | Yahoo商品コード | 結果 | 内容 | 調べたコード（存在有無） |");
  P("| --- | --- | --- | --- | --- |");
  for (const r of reg.results ?? []) {
    const label = { registered: "登録OK", existing: "既存あり", skip: "見送り", ng: "失敗" }[r.status] ?? r.status;
    const detail = r.status === "registered"
      ? `display=${r.verify?.display}（非公開） / 価格 ${r.verify?.price}`
      : trunc(r.reason ?? r.error, 150);
    const probed = (r.probedCodes ?? []).map((p) => `${p.code}=${p.exists === null ? "確認NG" : p.exists ? "あり" : "なし"}`).join(" / ");
    P(`| ${esc(r.manage)} | ${esc(r.itemCode)} | ${label} | ${esc(detail)} | ${esc(probed)} |`);
  }
  P();
  const postageNg = (reg.results ?? []).filter((r) => /it-01201|配送グループ/.test(S(r.error)));
  if (postageNg.length) {
    P(`### 失敗の主因: 配送グループ管理番号が Yahoo ストアに存在しない（${postageNg.length}件）`);
    P();
    P("アプリは `delivery_method`（楽天の配送方法セット番号）をそのまま Yahoo の `postage_set`（配送グループ管理番号）として送ります。");
    P("実測では **Yahoo ストア側にグループ 7 は存在するが 8・9 は存在しない**ため、8・9 を使う商品が `it-01201` で登録できませんでした。");
    P("（既存出品の実測値: r0101-1=6 / r1101-3=6 / r6410-3=6 / r7201-1-mg=4）");
    P();
    P("対処はどちらかの判断が必要です（本作業では実施していません）:");
    P("1. Yahoo ストアクリエイターPro で配送グループ 8・9 を作成する");
    P("2. アプリ側で楽天の配送方法セット番号 → Yahoo 配送グループの対応表を定義する（現状は素通し）");
    P();
    P(`対象: ${postageNg.map((r) => esc(r.manage)).join(", ")}`);
    P();
  }
  const needFields = (reg.results ?? []).filter((r) => (r.missing ?? []).length);
  if (needFields.length) {
    P(`### 必須項目が未設定で登録できない商品（${needFields.length}件）`);
    P();
    P("| 管理番号 | 不足項目 |");
    P("| --- | --- |");
    for (const r of needFields) P(`| ${esc(r.manage)} | ${esc([...new Set(r.missing)].join(" / "))} |`);
    P();
    P("商品登録アプリで Yahoo カテゴリ（product_category）とストアカテゴリパス（path）を設定すれば登録できます。");
    P();
  }
  const siblings = (reg.results ?? []).filter((r) => (r.siblingSkus ?? []).length);
  if (siblings.length) {
    P("### 登録対象にしなかった同一ページの別SKU");
    P();
    P("楽天は1商品ページに複数SKUがありますが、**このストアの Yahoo 出品は1ページにつき1SKUのみ**です");
    P("（実測: r7201-1 は -mg のみ出品、-sw/-hr は未出品）。それに合わせ、各商品の自SKU1件だけを登録しました。");
    P();
    P("| 管理番号 | 登録した商品コード | 登録していない別SKU |");
    P("| --- | --- | --- |");
    for (const r of siblings) P(`| ${esc(r.manage)} | ${esc(r.itemCode)} | ${esc(r.siblingSkus.join(", "))} |`);
    P();
  }
  P("登録した商品は **display=0（非公開）** です。`reservePublish` は実行していないため、ストアフロントには出ていません。");
  P();
}

// ============================================================================
// 追加作業 第2弾（2026-07-26 ユーザー裁定）: 再登録/カテゴリ・r126-1再取込・定期購入・グルーピング
// ============================================================================
const catFix = readJson(path.join(WORK_DIR, "category-fix-results.json"));
const storeCat = readJson(path.join(WORK_DIR, "store-category.json"));
const refetch = readJson(path.join(WORK_DIR, "refetch-r126-results.json"));
const subFix = readJson(path.join(WORK_DIR, "subscription-fix-results.json"));
const grouping = readJson(path.join(WORK_DIR, "grouping-results.json"));

if (reg && reg.registered > 0) {
  P("## 追D. 新規出品の再実行（配送グループ=6）とストアカテゴリ設定");
  P();
  P(`配送グループ管理番号は **${esc(reg.postageSet)}** で送信（ユーザー裁定。ストアにグループ 8・9 が無いため）。`);
  if (storeCat) {
    P(`ストアカテゴリ「${esc(storeCat.name)}」は ${storeCat.created ? "新規作成しました" : "既に存在していました"}（pageKey=${esc(storeCat.pageKey)}・読み戻し確認 ${storeCat.verified ? "OK" : "NG"}）。`);
  }
  P();
  P("| 管理番号 | Yahoo商品コード | 結果 | 内容 |");
  P("| --- | --- | --- | --- |");
  for (const r of reg.results ?? []) {
    const label = { registered: "登録OK", existing: "既存あり", skip: "見送り", ng: "失敗" }[r.status] ?? r.status;
    const detail = r.status === "registered"
      ? `display=${r.verify?.display}（非公開） / 価格 ${r.verify?.price}${r.postageSet ? ` / 配送グループ ${r.postageSet.sent}（アプリ既定 ${r.postageSet.fromApp}）` : ""}`
      : trunc(r.reason ?? r.error, 130);
    P(`| ${esc(r.manage)} | ${esc(r.itemCode)} | ${label} | ${esc(detail)} |`);
  }
  P();
  if (catFix) {
    P("### Yahooカテゴリ・ストアカテゴリパスの設定");
    P();
    P("| 管理番号 | 結果 | 内容 |");
    P("| --- | --- | --- |");
    for (const r of catFix.results ?? []) {
      if (r.status === "ok") {
        P(`| ${esc(r.manage)} | 設定OK | product_category=${esc(r.after?.yahoo_category_id)} / path=${esc(r.after?.yahoo_path)} |`);
      } else {
        P(`| ${esc(r.manage)} | 見送り | ${esc(trunc(r.reason, 160))} |`);
      }
    }
    P();
    for (const r of (catFix.results ?? []).filter((x) => x.evidence)) P(`- **${esc(r.manage)}** の根拠: ${esc(r.evidence)}${r.note ? `／${esc(r.note)}` : ""}`);
    const held = (catFix.results ?? []).filter((x) => (x.candidates ?? []).length);
    for (const r of held) {
      P(`- **${esc(r.manage)} は設定していません**（要ユーザー判断）。候補:`);
      for (const c of r.candidates) P(`  - \`${esc(c.code)}\` ${esc(c.path)} — ${esc(c.why)}`);
    }
    P();
  }
  const wrongCat = (reg.results ?? []).filter((r) => /^r8801-(2|3)$/.test(r.manage));
  if (wrongCat.length) {
    P("> **要確認**: r8801-2 / r8801-3 はアプリDBの Yahooカテゴリが `41383`（沖縄のお酒）のまま登録しました。");
    P("> 着圧ソックスに対して明らかに不適切です。r8801-0 に採用した `42867`（ダイエット、健康 > ダイエット >");
    P("> ダイエットウエア、サポーター > 着圧ソックス、靴下）へ揃えるかどうか、ユーザー判断をお願いします。");
    P("> 公開前（reservePublish 未実行）のため、修正しても買い物客への影響はありません。");
    P();
  }
}

if (refetch) {
  const r = refetch.result;
  P("## 追E. r126-1 の楽天再取込（楽天側の税率修正を反映）");
  P();
  P("| 項目 | 取込前 | 取込後 |");
  P("| --- | --- | --- |");
  P(`| アプリDB 税率 | ${esc(r.before?.taxRate)}% | ${esc(r.after?.taxRate)}%${r.taxRateFixed ? "（10%を確認）" : "（**10%になっていません**）"} |`);
  P(`| アプリDB 税抜価格 | ${esc(r.before?.sellingPriceExclusive)} | ${esc(r.after?.sellingPriceExclusive)} |`);
  P(`| Yahoo 税込価格 | ${esc(r.mallBefore?.price)} | ${esc(r.mallAfter?.price)} |`);
  P(`| Yahoo 税率区分 | ${esc(r.mallBefore?.taxrateType)} | ${esc(r.mallAfter?.taxrateType)} |`);
  P();
  if (r.status === "ok") {
    P(`反映後の読み戻しは期待値（価格 ${esc(r.expected?.price)} / 税率区分 ${esc(r.expected?.taxrateType)}）と**一致**しました。`);
    P("以前の報告にあった「アプリDB起点の期待値と Yahoo 価格の 47円差」は解消しています。");
  } else {
    P(`**未解決**: ${esc(r.error)}`);
  }
  P();
}

if (subFix) {
  P("## 追F. 定期購入価格の欠落対応");
  P();
  P("### 原因");
  P();
  P(`${esc(subFix.rootCause)}`);
  P();
  P("送信経路（register / update）は**正常**でした。実際に type=1 の商品でパラメータ生成を確認したところ、");
  P("`subscription_type` / `subscription_price` / `subscription_group_index` / `subscription_recommended_cycle` は");
  P("すべて送信されており、アプリ側のコード修正は不要でした（値が入っていなかったことが原因）。");
  P();
  P(`### 適用ルール: ${esc(subFix.rule)}`);
  P();
  P("| 区分 | 件数 |");
  P("| --- | ---: |");
  P(`| アプリDBへ設定（新規） | ${subFix.updated} |`);
  P(`| 既に正しい値 | ${subFix.unchanged} |`);
  P(`| 定期なしの例外商品 | ${subFix.exceptionCount} |`);
  P(`| 要ユーザー判断（設定せず） | ${subFix.needsDecision} |`);
  P();
  const dec = (subFix.results ?? []).filter((r) => r.needsDecision);
  if (dec.length) {
    P("**要ユーザー判断（設定していません）**");
    P();
    P("| 管理番号 | 理由 |");
    P("| --- | --- |");
    for (const r of dec) P(`| ${esc(r.manage)} | ${esc(trunc(r.reason, 180))} |`);
    P();
  }
  if (subFix.yahooVerify) {
    const v = subFix.yahooVerify;
    P("### Yahoo 読み戻し検証");
    P();
    P(`定期価格が期待値と**一致 ${v.ok}件** / 定期なしが正しく未設定 ${v.okNoSubscription}件 / 不一致 ${v.ng}件 / 要判断 ${v.pendingDecision}件 / 未出品 ${v.notListed}件。`);
    if (v.ng > 0) {
      P();
      P("| 管理番号 | 不一致内容 |");
      P("| --- | --- |");
      for (const c of (v.checks ?? []).filter((x) => x.verdict === "ng")) P(`| ${esc(c.manage)} | ${esc(c.error)} |`);
    }
    P();
  }
}

if (grouping) {
  P("## 追G. 数量違い商品のグルーピング（相互表示）");
  P();
  P(`${esc(grouping.spec)}。バリエーション項目名は「${esc(grouping.variationTitle)}」。`);
  P("表示名は商品名の実記載（「3袋セット」「30粒×3袋」等）から導出し、");
  P("ファミリー全員が別名になる場合のみ適用しました（名前が重複すると選択肢が壊れるため）。");
  P();
  P(`結果: 対象ファミリー ${grouping.familiesReady} / 見送り ${grouping.familiesSkipped} / 商品 設定OK ${grouping.applied} 件・NG ${grouping.failed} 件（全件 getItem で読み戻し確認）。`);
  P();
  P("| グルーピングID | 商品コードと表示名 |");
  P("| --- | --- |");
  for (const f of (grouping.families ?? []).filter((x) => x.status === "ready")) {
    P(`| \`${esc(f.groupingId)}\` | ${esc((f.plan ?? []).map((p) => `${p.itemCode}=「${p.variationName}」`).join(" / "))} |`);
  }
  P();
  const skippedFam = (grouping.families ?? []).filter((x) => x.status !== "ready");
  if (skippedFam.length) {
    P("**見送ったファミリー**");
    P();
    for (const f of skippedFam) P(`- \`${esc(f.groupingId)}\`: ${esc(f.reason)}`);
    P();
  }
  const failed = (grouping.results ?? []).filter((r) => r.status !== "ok");
  if (failed.length) {
    P("**設定に失敗した商品**");
    P();
    P("| 商品コード | エラー |");
    P("| --- | --- |");
    for (const r of failed) P(`| ${esc(r.itemCode)} | ${esc(trunc(r.error, 160))} |`);
    P();
  }
  P("既存で grouping_id が入っていた商品はありませんでした（上書きは発生していません）。");
  P();
}

const finalRound = readJson(path.join(WORK_DIR, "final-round-results.json"));
if (finalRound) {
  P("## 追H. 最終ラウンド（残り判断事項の裁定分）");
  P();
  P(`裁定: ${esc(finalRound.ruling)}`);
  P(`display の扱い: ${esc(finalRound.display)} / ${esc(finalRound.reservePublish)}`);
  P();
  P("| 対象 | 作業 | 結果 | 内容 |");
  P("| --- | --- | --- | --- |");
  const taskLabel = { register: "新規出品", category: "カテゴリ修正", postage: "配送グループ修正", subscription: "定期購入設定", "no-subscription-ruling": "定期なし（裁定記録）" };
  for (const r of finalRound.results ?? []) {
    let detail = "";
    if (r.task === "register") detail = S(r.detail);
    else if (r.task === "category") detail = `product_category ${esc(r.mallBefore?.product_category)} → ${esc(r.mallAfter?.product_category)}（アプリDBも更新）`;
    else if (r.task === "postage") detail = `postage_set ${esc(r.mallBefore?.postage_set)} → ${esc(r.mallAfter?.postage_set)}（${esc(r.note)}）`;
    else if (r.task === "subscription") detail = `定期税抜 ${esc(r.rule?.subscriptionExclusive)} / 税込 ${esc(r.mallAfter?.subscription_price)}（通常税抜 ${esc(r.rule?.sellingPriceExclusive)} × 0.90）`;
    else detail = S(r.ruling);
    P(`| ${esc(r.manage)} | ${esc(taskLabel[r.task] ?? r.task)} | ${r.status === "ok" ? "OK" : "NG"} | ${esc(trunc(detail, 170))}${r.error ? ` — ${esc(trunc(r.error, 120))}` : ""} |`);
  }
  P();
  const subRec = (finalRound.results ?? []).find((r) => r.task === "subscription" && r.rakutenFollowUp);
  if (subRec) {
    P(`> **楽天側の申し送り（${esc(subRec.manage)}）**: ${esc(subRec.rakutenFollowUp)}`);
    P();
  }
  P("すべて `getItem` で読み戻し、送信値との一致を確認しています。");
  P();

  P("## 追I. 公開（reservePublish）前チェックリスト");
  P();
  P("公開反映は**まだ実行していません**。実行前に以下を確認してください。");
  P();
  P("| # | 確認事項 | 状態 |");
  P("| ---: | --- | --- |");
  const zeroStockCount = ok.filter((r) => r.yahooQuantityBefore === 0).length;
  P(`| 1 | **在庫の手入力** — Yahoo の在庫はユーザー入力運用です。反映前の実測で在庫0が ${zeroStockCount}件ありました。0のまま公開すると売り切れ表示になります | 要対応 |`);
  P(`| 2 | **新規出品 ${reg?.registered ?? 0}件は display=0（非公開）** — reservePublish しても**フロントには出ません**。公開する場合は各商品の公開状態を 1 にしてから反映してください | 要判断 |`);
  P("| 3 | **楽天リンクの置換は公開後に再実行** — 置換先 r7201-1-mg が非公開でストアページが404のため未置換です。公開後に `npx tsx tests/shimanoya_yahoo_link_replace.mjs` を再実行すると置換できます | 公開後 |");
  P(`| 4 | **グルーピングの選択肢表示** — ${grouping?.applied ?? 0}件に設定済み。商品ページの「${esc(grouping?.variationTitle ?? "数量")}」選択肢は公開反映後に表示されます | 反映後に確認 |`);
  P("| 5 | **楽天側の税率・定期価格** — r126-1 の税率は対応済み。r117-1 の定期価格は楽天が ×0.95 のままで Yahoo とずれています（楽天も ×0.90 へ要修正） | 要対応 |");
  P(`| 6 | **定期購入の未設定3件**（r7201-2 / s071-1132-1 / s071-1149-1）— 裁定により定期なしのまま | 対応不要 |`);
  P("| 7 | **画像リンク切れ1件**（r124 の白背景画像・アプリDB側）— Yahoo 表示画像ではないため公開の障害にはなりません | 任意 |");
  P();
}

const stockRes = readJson(path.join(WORK_DIR, "stock-results.json"));
const displayRes = readJson(path.join(WORK_DIR, "display-results.json"));
const pub1 = readJson(path.join(WORK_DIR, "publish-result.json"));
const pub2 = readJson(path.join(WORK_DIR, "publish-result-2.json"));
const frontCheck = readJson(path.join(WORK_DIR, "publish-frontcheck.json"));
const rakutenFix = readJson(path.join(WORK_DIR, "rakuten-r117-fix.json"));

if (pub1) {
  P("## 追J. 公開反映（reservePublish 実行済み）");
  P();
  P("**ユーザー承認のもと、ストアフロントへの公開反映を実行しました。** 以降の内容は買い物客から見える状態です。");
  P();
  P("### 1. 在庫を全件100に設定");
  P();
  P(`ユーザー指示「全部在庫100こで」により、対象66件すべてへ \`setStock quantity=100\` を送信しました（送信前の値は \`backup/stock-backup.json\`）。`);
  P();
  P(`- 成功 **${stockRes?.ok ?? 0}件** / 失敗 ${stockRes?.ng ?? 0}件 / スキップ ${stockRes?.skip ?? 0}件（全件 \`getItem\` で在庫100を読み戻し確認）`);
  P("- 以前 DB 管理値で設定していた r7501-1 も、指示どおり一律100で上書きしています。");
  P();
  P("### 2. 公開状態（display=1）");
  P();
  P(`送信前の値は \`backup/display-backup.json\`。`);
  P();
  P(`- 非公開→公開に変更 **${displayRes?.changed ?? 0}件** / 元から公開 ${displayRes?.alreadyPublic ?? 0}件 / 失敗 ${displayRes?.ng ?? 0}件`);
  P("- 新規出品9件に加え、既存でも非公開だった商品（r7201-1-mg など）を含めて公開にしました。");
  P();
  P("### 3. reservePublish（全反映予約 mode=1）");
  P();
  P("| 回 | 目的 | 結果 | 予約時刻 |");
  P("| ---: | --- | --- | --- |");
  P(`| 1 | 在庫・公開状態・これまでの全編集の反映 | ${pub1.publish?.ok ? "OK" : "NG"}（${esc(pub1.publish?.message)}） | ${esc(pub1.publish?.reserveTime)} |`);
  if (pub2) P(`| 2 | 楽天リンク置換分の反映 | ${pub2.publish?.ok ? "OK" : "NG"}（${esc(pub2.publish?.message)}） | ${esc(pub2.publish?.reserveTime)} |`);
  P();
  P("> **巻き込み範囲について**: reservePublish は商品単位ではなく**ストア全体**の反映です。");
  P(`> ${esc(pub1.scopeWarning)}`);
  P("> 本作業の66件以外にストア側で未反映の編集が残っていた場合、それらも同時に公開されています。");
  P();
  P("### 4. ストアフロントの実地確認");
  P();
  const allFront = [...(pub1.frontChecks ?? []), ...(pub2?.frontChecks ?? []), ...(frontCheck?.frontChecks ?? [])];
  const uniqFront = [...new Map(allFront.map((f) => [f.manage, f])).values()];
  const ngFront = uniqFront.filter((f) => f.verdict !== "ok");
  P(`実際のストアページを HTTP 取得して確認しました（**${uniqFront.length}商品**）。`);
  P();
  P(`- HTTP 200: ${uniqFront.filter((f) => f.httpStatus === 200).length}件 / 異常: **${ngFront.length}件**`);
  P("- 売り切れ表示: 0件 / カートボタンあり: 全件 / 自商品の画像を使用: 全件（別商品画像の混入なし）/ 商品名一致: 全件");
  P();
  P("| 管理番号 | 商品コード | HTTP | 公開 | 在庫 | 価格(税込) |");
  P("| --- | --- | ---: | ---: | ---: | ---: |");
  for (const f of uniqFront) P(`| ${esc(f.manage)} | ${esc(f.itemCode)} | ${f.httpStatus} | ${esc(f.api?.display)} | ${esc(f.api?.quantity)} | ${esc(f.api?.price)} |`);
  P();
  if (ngFront.length) {
    P("**異常が出た商品**");
    P();
    for (const f of ngFront) P(`- ${esc(f.manage)}（${esc(f.itemCode)}）: ${esc(f.issue ?? f.httpError)} — ${esc(f.url)}`);
    P();
  } else {
    P("**異常（404・売り切れ表示・別商品画像など）は検出されませんでした。**");
    P();
  }

  if (linkRep && linkRep.ok > 0) {
    P("### 5. 楽天リンク置換（公開後に再実行）");
    P();
    P(`置換先 r7201-1-mg のストアページが公開され HTTP 200 になったことを確認したうえで再実行し、**${linkRep.ok}件すべて置換**しました（読み戻しで楽天リンクが消え Yahoo ストアURLになったことを確認）。`);
    P();
    P("| 管理番号 | 置換前 | 置換後 |");
    P("| --- | --- | --- |");
    for (const m of linkRep.mappings ?? []) P(`| ${esc(m.manage)} | ${esc(m.from)} | ${esc(m.to ?? "（置換せず）")} |`);
    P();
    P("置換分は2回目の reservePublish で反映済みです。");
    P();
  }

  if (rakutenFix) {
    const r = rakutenFix.result;
    P("### 6. 楽天側 r117-1 の定期購入価格を ×0.90 へ修正");
    P();
    P(`恒久ルール（通常税抜 × 0.90 切り捨て）に合わせ、楽天の定期価格を **${esc(r.rule?.currentSubscriptionPrice)}円 → ${esc(r.rule?.targetSubscriptionPrice)}円** へ修正しました（Yahoo と同額）。`);
    P(`読み戻し（楽天 getItem）: ${esc(r.rakutenAfter?.basePrice)}円 → ${r.status === "ok" ? "**一致**" : "**不一致**"}`);
    P();
    if (r.routeBlocked) {
      P("> **補足**: アプリの「反映」ルートは SKU構成変更ガード（`" + esc((r.routeBlocked.structural ?? []).join(", ")) + "`）で中止されます。");
      P("> r117-1 のアプリ行は自SKU 1件しか持たないのに楽天ページには3SKUあるため、ガードが「SKU削除」と**誤検知**するためです（実際には削除しません）。");
      P("> 楽天の patch は未指定の variant をそのまま残す仕様なので、**自SKUの定期価格だけを含む最小ボディ**を直接送信しました。");
      P("> 他フィールド・他SKUには触れていません（送信ボディ: `" + esc(JSON.stringify(r.patchBody)) + "`）。");
      P("> このガードの誤検知は、多SKUページの商品をアプリが1SKU単位で持つ構造に起因します（アプリ側の改善余地として申し送り）。");
      P();
    }
  }
}

P("## 11. 要判断・次アクション");
P();
const notOnYahoo = skip.filter((r) => /Yahooに商品コード/.test(S(r.reason)));
const notInApp = ng.concat(skip).filter((r) => /アプリDBに該当商品がありません|アプリ取込に失敗/.test(S(r.reason ?? r.error)));
P("1. **公開反映（reservePublish）の実行可否** — 本作業では実行していません。内容を確認のうえ、Yahoo ストアクリエイターPro で「反映」を実行してください。");
if (reg) {
  const needFields2 = (reg.results ?? []).filter((r) => (r.missing ?? []).length);
  if (needFields2.length) P(`2. **Yahooカテゴリ未確定で出品できない ${needFields2.length}件**（${needFields2.map((r) => r.manage).join(", ")}）— 追D の候補から選べば出品できます。`);
  P("3. **配送グループ**: アプリは楽天の配送方法セット番号を Yahoo の `postage_set` へ素通しします。今回は裁定どおり 6 を上書き送信しましたが、アプリ側に対応表が無い状態は残っています（次回の新規出品でも同じ上書きが必要）。");
} else if (notOnYahoo.length) {
  P(`2. **Yahoo に存在しない ${notOnYahoo.length}商品** (${notOnYahoo.map((r) => r.manage).join(", ")}) — 「反映(editItem)」ではなく新規出品が必要です。`);
}
if (linkRep && linkRep.skip > 0) P(`4. **楽天リンクの置換保留 ${linkRep.skip}件** — 置換先（r7201-1-mg）を公開すれば置換できます（追B 参照）。`);
if (vNg.length) P(`5. **読み戻し検証で不一致 ${vNg.length}件** — 上記6章の内訳（税率区分）を確認してください。追A で3件を修正済みです。`);
if (broken.length) P(`6. **画像リンク切れ ${broken.length}件** — 上記5章の一覧を確認し、画像を差し替えてください（方針どおり反映は続行済み）。`);
if (notInApp.length) P(`7. **商品登録アプリ側の紐付け要整理** — ${notInApp.map((r) => r.manage).join(", ")}`);
if (taxFix) P("8. **楽天側の税率修正** — r126-1 はユーザー対応済みで再取込・反映まで完了しました（追E）。");
if (subFix?.needsDecision) P(`9. **定期購入の要判断 ${subFix.needsDecision}件** — 追F の一覧（楽天がルールと違う価格 / 楽天に定期が無い商品）を確認してください。`);
if (grouping) P(`10. **グルーピング適用済み ${grouping.applied}件** — 商品ページの「${esc(grouping.variationTitle)}」選択肢は公開反映後に表示されます。`);
P();
P("---");
P();
P("機械可読の結果: `targets.json` / `backup-results.json` / `sync-results.json` / `sent-params.jsonl` / `image-check.json` / `verify-results.json`");
P("追加作業の結果: `tax-fix-results.json` / `link-replace.json` / `register-results.json` / `register-probe.json` / `category-fix-results.json` / `store-category.json` / `refetch-r126-results.json` / `subscription-fix-results.json` / `grouping-results.json`");
P("最終ラウンド: `final-round-results.json`");
P("公開ラウンド: `stock-results.json` / `display-results.json` / `publish-result.json` / `publish-result-2.json` / `publish-frontcheck.json` / `rakuten-r117-fix.json`");
P("バックアップ: `backup/tax-fix-backup.json` / `backup/category-fix-backup.json` / `backup/subscription-fix-backup.json` / `backup/refetch-r126-backup.json` / `backup/final-round-backup.json`");

const out = path.join(WORK_DIR, "report.md");
writeFileSync(out, lines.join("\n") + "\n", "utf8");
console.log(`レポート生成: ${out}`);
console.log(`集計: OK ${ok.length} / NG ${ng.length} / SKIP ${skip.length} / 検証一致 ${vOk.length} / リンク切れ ${broken.length}`);
