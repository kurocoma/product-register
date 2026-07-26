// [3/4] しまのや 楽天→Yahoo 一括反映（2026-07-26）: 本反映（editItem / setStock のみ）。
//
// ユーザー確定方針（2026-07-26）:
//   - reservePublish（全反映予約＝ストア公開反映）は実行しない。公開は保留し、ユーザーが完了報告を見て判断する。
//   - 画像リンク切れは反映を止めない（報告のみ。image-check.json 側で記録）。
//   - 途中の承認ゲートなし。
// 恒久ルール:
//   - 楽天 getItem から最新を取込んでから反映する（read-before-write。/api/fetch/rakuten POST）。
//   - per-call タイムアウト（外部API 30s。アプリのAPIルートは外部API2本を内包するため 60s）。
//     タイムアウトは当該itemのみ failed 扱いで全体は継続する。
//   - 10〜20件チャンクで逐次処理。1件ごとに sync-results.json へ保存し、成功済みは再実行時に自動スキップ（RESUME）。
//   - 秘密値は出力しない。
//
// 実行: cd webui && npx tsx tests/shimanoya_yahoo_sync_apply.mjs
//   ONLY=r0101-1,r113-1  対象を絞る / FORCE=1 成功済みも再実行 / DRY=1 反映せず差分確認のみ
import path from "node:path";
import { existsSync } from "node:fs";
import { getItem as getYahooItem, setStock } from "../lib/yahoo/item-client.ts";
import { dbRowToProductInput } from "../lib/product/repository.ts";
import {
  TARGETS, WORK_DIR, BACKUP_DIR, API_TIMEOUT_MS, CHUNK_SIZE, BASE,
  ensureWorkDir, loadEnv, fetchWithTimeout, withTimeout, getAdmin, loadTargets, makeCookieFactory,
  yahooAuth, writeAuthBlocked, chunk, readJson, writeJson, appendJsonl, readJsonl, xmlTag, sleep, nowIso,
} from "./shimanoya_yahoo_sync_common.mjs";

loadEnv();
ensureWorkDir();

const ROUTE_TIMEOUT_MS = API_TIMEOUT_MS * 2;
const DRY = process.env.DRY === "1";
const FORCE = process.env.FORCE === "1";
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",").map((s) => s.trim()).filter(Boolean)) : null;

const RESULTS_FILE = path.join(WORK_DIR, DRY ? "sync-results.dryrun.json" : "sync-results.json");
const SENT_FILE = path.join(WORK_DIR, DRY ? "sent-params.dryrun.jsonl" : "sent-params.jsonl");
const BACKUP_YAHOO = path.join(BACKUP_DIR, "yahoo-current.jsonl");
const BACKUP_DB = path.join(BACKUP_DIR, "app-db-current-rows.jsonl");

// --- 事前条件: バックアップが取れていること（変更前の復元手段なしに書き込まない） ---
if (!existsSync(BACKUP_YAHOO) || !existsSync(BACKUP_DB)) {
  console.error("バックアップがありません。先に実行してください: npx tsx tests/shimanoya_yahoo_sync_backup.mjs");
  process.exit(2);
}

const admin = getAdmin();
const { found } = await loadTargets(admin);
const cookieFor = await makeCookieFactory(admin);

// --- 事前条件: Yahoo 認証（失効時はユーザー操作が必要な旨を残して停止） ---
let cfg, token;
try {
  ({ cfg, token } = await yahooAuth());
} catch (e) {
  const msg = String(e?.message ?? e);
  writeAuthBlocked("apply", msg);
  console.error(`Yahoo認証に失敗しました。反映を中止します。\n  ${msg}`);
  process.exit(2);
}

// --- 事前条件: アプリのAPIルート（差分判定・ガード・履歴記録を通すため必須） ---
try {
  await fetchWithTimeout(`${BASE}/api/update/yahoo/health-check`, {}, API_TIMEOUT_MS, "dev server");
} catch (e) {
  console.error(`アプリ(${BASE})へ接続できません: ${String(e?.message ?? e)}\n  先に dev server を起動してください`);
  process.exit(2);
}

// --- 再実行(RESUME): 既に ok の manage は再送しない ---
const prev = readJson(RESULTS_FILE, null);
const prevByManage = new Map((prev?.results ?? []).map((r) => [r.manage, r]));
const results = [];
const doneOk = new Set(FORCE ? [] : [...prevByManage.values()].filter((r) => r.status === "ok").map((r) => r.manage));
if (doneOk.size) console.log(`RESUME: 成功済み ${doneOk.size}件をスキップします（FORCE=1 で再実行）`);

const createdProductIds = [];

function save() {
  const merged = [...prevByManage.values()].filter((r) => !results.some((x) => x.manage === r.manage)).concat(results);
  merged.sort((a, b) => TARGETS.indexOf(a.manage) - TARGETS.indexOf(b.manage));
  writeJson(RESULTS_FILE, {
    ranAt: nowIso(),
    base: BASE,
    dryRun: DRY,
    reservePublish: "未実行（公開保留・2026-07-26 ユーザー確定方針）",
    chunkSize: CHUNK_SIZE,
    timeoutMs: { externalApi: API_TIMEOUT_MS, appRoute: ROUTE_TIMEOUT_MS },
    total: TARGETS.length,
    ok: merged.filter((r) => r.status === "ok").length,
    ng: merged.filter((r) => r.status === "ng").length,
    skip: merged.filter((r) => r.status === "skip").length,
    createdProductIds,
    results: merged,
  });
}

/** 楽天からアプリDBへ最新取込（read-before-write）。1回だけ再試行する。 */
async function pullFromRakuten(productId, cookie) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await fetchWithTimeout(`${BASE}/api/fetch/rakuten/${productId}`, {
        method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: "{}",
      }, ROUTE_TIMEOUT_MS, "fetch rakuten");
      const j = await r.json();
      if (r.ok && j.ok) return { ok: true, imported: j.imported ?? [], key: j.key };
      // 404(楽天に無い)等は再試行しても同じ
      if (r.status === 404) return { ok: false, error: j.error ?? "楽天に該当商品が存在しません", status: 404 };
      if (attempt === 2) return { ok: false, error: j.error ?? `HTTP ${r.status}`, status: r.status };
    } catch (e) {
      if (attempt === 2) return { ok: false, error: String(e?.message ?? e) };
    }
    await sleep(800);
  }
  return { ok: false, error: "不明" };
}

/** 変更前後の ProductInput 差分（フィールド名＋短縮値）。 */
function diffInputs(before, after) {
  const out = [];
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const k of keys) {
    const b = JSON.stringify(before?.[k] ?? null);
    const a = JSON.stringify(after?.[k] ?? null);
    if (b !== a) out.push({ field: k, before: trunc(b), after: trunc(a) });
  }
  return out;
}
const trunc = (s, n = 120) => (String(s ?? "").length > n ? String(s).slice(0, n) + "…" : String(s ?? ""));

const targets = TARGETS.filter((m) => (!ONLY || ONLY.has(m)) && !doneOk.has(m));
const chunks = chunk(targets, CHUNK_SIZE);
console.log(`反映対象 ${targets.length}件 / 全 ${TARGETS.length}件（チャンク ${CHUNK_SIZE}件 × ${chunks.length}）${DRY ? " ※DRY-RUN" : ""}`);
console.log("reservePublish（全反映予約）は実行しません。公開は保留です。\n");

let i = 0;
for (const [ci, group] of chunks.entries()) {
  for (const manage of group) {
    i++;
    const label = `[${i}/${targets.length}] ${manage}`;
    const rec = { manage, chunk: ci + 1, status: "ng", timestamp: nowIso() };
    try {
      // ---- 0) アプリDBの該当商品を解決。無ければ楽天から取込んで作成する ----
      let t = found.get(manage);
      if (!t) {
        const anyOwner = [...found.values()][0]?.row.user_id;
        if (!anyOwner) throw new Error("ログインに使う所有者ユーザーを特定できません");
        const cookie = await cookieFor(anyOwner);
        const ir = await fetchWithTimeout(`${BASE}/api/import/rakuten`, {
          method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ code: manage }),
        }, ROUTE_TIMEOUT_MS, "import rakuten");
        const ij = await ir.json();
        if (!ir.ok || !ij.ok) throw new Error(`楽天からのアプリ取込に失敗: ${ij.error ?? `HTTP ${ir.status}`}`);
        rec.importedToApp = { productId: ij.productId, neCode: ij.neCode, existed: ij.existed === true };
        if (!ij.existed) createdProductIds.push(ij.productId);
        const { data: row } = await admin.from("products").select("*").eq("id", ij.productId).single();
        t = { row, input: dbRowToProductInput(row), manage, matchedBy: "imported" };
        console.log(`${label} アプリに未登録 → 楽天から取込み作成（NEコード ${ij.neCode}）`);
      }
      rec.productId = t.row.id;
      rec.itemCode = t.input.ne_code;
      const cookie = await cookieFor(t.row.user_id);

      // ---- 1) read-before-write: 楽天の現在値をアプリDBへ取込む ----
      const beforeInput = dbRowToProductInput((await admin.from("products").select("*").eq("id", t.row.id).single()).data);
      const pull = await pullFromRakuten(t.row.id, cookie);
      const afterRow = (await admin.from("products").select("*").eq("id", t.row.id).single()).data;
      const afterInput = dbRowToProductInput(afterRow);
      rec.rakutenPull = {
        ok: pull.ok, error: pull.error, manageNumber: pull.key,
        changedFields: pull.ok ? diffInputs(beforeInput, afterInput) : [],
      };
      if (!pull.ok) {
        rec.warnings = [...(rec.warnings ?? []), `楽天の最新取込に失敗（アプリDB現在値を起点に反映）: ${pull.error}`];
        console.log(`${label} 楽天取込NG: ${String(pull.error).slice(0, 90)}（DB現在値で続行）`);
      } else if (rec.rakutenPull.changedFields.length) {
        console.log(`${label} 楽天取込OK（DB更新 ${rec.rakutenPull.changedFields.length}項目）`);
      }
      rec.itemCode = afterInput.ne_code;

      // ---- 2) Yahoo 側の現在値（存在確認＋在庫数）----
      const got = await withTimeout(getYahooItem(token, cfg.sellerId, afterInput.ne_code), API_TIMEOUT_MS, `getItem ${afterInput.ne_code}`);
      if (!got.exists) {
        rec.status = "skip";
        rec.reason = `Yahooに商品コード「${afterInput.ne_code}」が存在しません（新規出品が必要。本作業は既存商品の反映=editItem/setStockのみ・公開保留のため対象外）`;
        results.push(rec); save();
        console.log(`${label} skip: Yahooに未登録`);
        await sleep(200);
        continue;
      }
      const mallQuantity = Number(xmlTag(got.raw, "Quantity") || "0");
      rec.yahooQuantityBefore = Number.isFinite(mallQuantity) ? mallQuantity : null;
      // 取込作成した商品はバックアップに無いので、この時点の現在値を退避へ追記する（復元可能性の担保）。
      // 再実行で二重に積まないよう、既に同じ manage の退避があれば追記しない（最初の＝変更前の値を残す）。
      if (rec.importedToApp && !readJsonl(BACKUP_YAHOO).some((r) => r.manage === manage)) {
        appendJsonl(BACKUP_YAHOO, { manage, itemCode: afterInput.ne_code, productId: t.row.id, exists: true, fetchedAt: nowIso(), raw: got.raw });
      }

      // ---- 3) 反映プレビュー（dry-run 差分・送信予定パラメータ）----
      const pr = await fetchWithTimeout(`${BASE}/api/update/yahoo/${t.row.id}`, { headers: { Cookie: cookie } }, ROUTE_TIMEOUT_MS, "update GET");
      const pj = await pr.json();
      if (!pr.ok || !pj.ok) {
        rec.status = "ng";
        rec.phase = "preview";
        rec.error = pj.error ?? `HTTP ${pr.status}`;
        results.push(rec); save();
        console.log(`${label} プレビューNG: ${String(rec.error).slice(0, 120)}`);
        await sleep(200);
        continue;
      }
      // ---- 3.5) 価格の異常変動ガード ----
      // 楽天側のSKUデータ不整合（同一 merchantDefinedSkuId の重複など）を掴むと、1袋商品に5袋の価格が
      // 載るなど桁違いの価格改定になり得る。2倍以上/半額以下の変更は送らず保留し、レポートで要判断にする。
      // （ユーザー方針「承認ゲートなし」は途中で処理を止めないことであり、明らかな異常値の無検査送信ではない）
      const nextPrice = Number(pj.willSend?.price ?? 0);
      const curPrice = Number(xmlTag(got.raw, "Price") || 0);
      if (curPrice > 0 && nextPrice > 0 && (nextPrice >= curPrice * 2 || nextPrice <= curPrice / 2)) {
        rec.status = "skip";
        rec.phase = "priceGuard";
        rec.priceGuard = { mallPrice: curPrice, plannedPrice: nextPrice, ratio: Math.round((nextPrice / curPrice) * 100) / 100 };
        rec.reason = `価格が異常に変動するため保留（Yahoo現在 ${curPrice}円 → 送信予定 ${nextPrice}円 / ${rec.priceGuard.ratio}倍）。楽天のSKU紐付けを確認してください`;
        rec.changedFields = (pj.changedFields ?? []).map((c) => ({ field: c.field, before: trunc(c.before), after: trunc(c.after) }));
        results.push(rec); save();
        console.log(`${label} 価格ガードで保留: ${curPrice} → ${nextPrice}`);
        await sleep(200);
        continue;
      }

      rec.hasChanges = pj.hasChanges === true;
      rec.changedFields = (pj.changedFields ?? []).map((c) => ({ field: c.field, before: trunc(c.before), after: trunc(c.after) }));
      rec.advanced = pj.advanced ?? [];
      rec.subscriptionErrors = pj.subscriptionErrors ?? [];
      rec.skippedFields = pj.skipped ?? [];
      appendJsonl(SENT_FILE, { manage, itemCode: afterInput.ne_code, at: nowIso(), hasChanges: rec.hasChanges, params: pj.willSend });

      if (DRY) {
        rec.status = "skip";
        rec.reason = `DRY-RUN（差分 ${rec.changedFields.length}項目・送信せず）`;
        results.push(rec); save();
        console.log(`${label} dry-run: 差分 ${rec.changedFields.length}項目 / advanced ${rec.advanced.length}`);
        await sleep(150);
        continue;
      }

      // ---- 4) 反映（editItem）。submit を送らないので reservePublish は呼ばれない ----
      const po = await fetchWithTimeout(`${BASE}/api/update/yahoo/${t.row.id}`, {
        method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: "{}",
      }, ROUTE_TIMEOUT_MS, "update POST");
      const oj = await po.json();
      if (!po.ok || !oj.ok) {
        rec.status = "ng";
        rec.phase = "editItem";
        rec.error = oj.error ?? `HTTP ${po.status}`;
        results.push(rec); save();
        console.log(`${label} 反映NG: ${String(rec.error).slice(0, 160)}`);
        await sleep(200);
        continue;
      }
      rec.status = "ok";
      rec.phase = oj.noChange ? "noChange" : "editItem";
      rec.noChange = oj.noChange === true;
      rec.appliedFields = oj.changedFields ?? [];
      if ((oj.warnings ?? []).length) rec.warnings = [...(rec.warnings ?? []), ...oj.warnings];
      rec.submitted = oj.submitted === true; // 常に false（submit を送っていない＝reservePublish 未実行）

      // ---- 5) 在庫（setStock）。アプリDBに在庫の管理値がある商品だけ送る ----
      //      在庫はモール側の実運用値であり、アプリに値が無い商品へ 0 等を送ると在庫を壊すため送らない。
      const dbStock = typeof afterInput.stock_quantity === "number" ? afterInput.stock_quantity : null;
      if (dbStock === null) {
        rec.stock = { sent: false, reason: "アプリDBに在庫の管理値がないため Yahoo 現在値を維持", mallQuantity: rec.yahooQuantityBefore };
      } else if (dbStock === rec.yahooQuantityBefore) {
        rec.stock = { sent: false, reason: "在庫数が一致（送信不要）", quantity: dbStock, mallQuantity: rec.yahooQuantityBefore };
      } else {
        try {
          const st = await withTimeout(setStock(token, cfg.sellerId, afterInput.ne_code, dbStock), API_TIMEOUT_MS, `setStock ${afterInput.ne_code}`);
          rec.stock = { sent: true, ok: st.ok, quantity: dbStock, mallQuantity: rec.yahooQuantityBefore, message: st.message };
          if (!st.ok) rec.warnings = [...(rec.warnings ?? []), `setStock 失敗: ${st.message}`];
        } catch (e) {
          rec.stock = { sent: true, ok: false, quantity: dbStock, error: String(e?.message ?? e) };
          rec.warnings = [...(rec.warnings ?? []), `setStock 例外: ${String(e?.message ?? e)}`];
        }
      }
      results.push(rec); save();
      console.log(`${label} 反映OK（${rec.noChange ? "変更なし" : `${rec.appliedFields.length}項目`}${rec.stock?.sent ? ` / 在庫${rec.stock.quantity}` : ""}）`);
    } catch (e) {
      rec.status = "ng";
      rec.phase = rec.phase ?? "exception";
      rec.error = String(e?.message ?? e);
      results.push(rec); save();
      console.log(`${label} 例外: ${String(e?.message ?? e).slice(0, 160)}`);
    }
    await sleep(250);
  }
  console.log(`--- チャンク ${ci + 1}/${chunks.length} 完了（${RESULTS_FILE} に保存済み） ---`);
}

save();
const final = readJson(RESULTS_FILE);
console.log(`\n反映完了: OK ${final.ok} / NG ${final.ng} / SKIP ${final.skip}（対象 ${final.total}件）`);
console.log("reservePublish（全反映予約）は実行していません。Yahoo フロントへの公開は保留のままです。");
for (const r of final.results.filter((x) => x.status !== "ok")) {
  console.log(`  ${r.status.toUpperCase()} ${r.manage}: ${String(r.error ?? r.reason ?? "").slice(0, 160)}`);
}
console.log(`→ ${RESULTS_FILE}`);
