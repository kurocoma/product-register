// [公開反映] ストア全体をフロントへ反映する（reservePublish mode=1）。ユーザー承認済み（2026-07-27）。
//
// **注意（必ず読む）**: reservePublish は商品単位ではなく**ストア全体**の反映です。
// 本作業の66件以外にストア側で未反映の編集が残っていれば、それも同時に公開されます。
// Yahoo の API には「未反映の商品件数」を返す口が無いため、実行前に取得できる範囲
// （ストアカテゴリの EditingFlag / 予約状況 mode=3）を記録して残します。
//
// 実行後: 反映状況を確認し、代表商品のストアフロントURLを HTTP 検証（200 と在庫表示）する。
// 実行: cd webui && npx tsx tests/shimanoya_yahoo_publish.mjs
//   DRY=1 事前確認のみ（予約は実行しない） / VERIFY_ONLY=1 反映せずストアフロント確認だけ
import path from "node:path";
import { getItem as getYahooItem, reservePublish } from "../lib/yahoo/item-client.ts";
import { listStCategories } from "../lib/yahoo/st-category-client.ts";
import {
  WORK_DIR, API_TIMEOUT_MS, IMAGE_TIMEOUT_MS,
  ensureWorkDir, loadEnv, fetchWithTimeout, withTimeout, getAdmin, loadTargets,
  yahooAuth, writeAuthBlocked, writeJson, xmlTag, sleep, nowIso,
} from "./shimanoya_yahoo_sync_common.mjs";

loadEnv();
ensureWorkDir();

const DRY = process.env.DRY === "1";
const VERIFY_ONLY = process.env.VERIFY_ONLY === "1";
// 2回目の反映（リンク置換後）は OUT_NAME で別ファイルへ記録する。
const RESULTS_FILE = path.join(WORK_DIR, process.env.OUT_NAME || (DRY ? "publish-result.dryrun.json" : "publish-result.json"));
/** ストアフロント確認する代表商品（新規出品・税率修正・グルーピング設定を含める）。 */
const SPOT_CHECK = (process.env.SPOT_CHECK || "r9101-1,r8801-0,r0101-1,r113-1,r1101-5,r7201-1").split(",").map((s) => s.trim()).filter(Boolean);

const admin = getAdmin();
const { found } = await loadTargets(admin);

let cfg, token;
try {
  ({ cfg, token } = await yahooAuth());
} catch (e) {
  const msg = String(e?.message ?? e);
  writeAuthBlocked("publish", msg);
  console.error(`Yahoo認証に失敗しました。中止します。\n  ${msg}`);
  process.exit(2);
}

const out = { ranAt: nowIso(), dryRun: DRY, verifyOnly: VERIFY_ONLY, sellerId: "(非表示)" };

// --- 1) 実行前の状況を記録（巻き込み範囲の可視化） ---
if (!VERIFY_ONLY) {
  const pre = await withTimeout(reservePublish(token, cfg.sellerId, 3), API_TIMEOUT_MS, "reservePublish(mode=3)");
  out.beforeReservation = { ok: pre.ok, message: pre.message, reserveTime: pre.reserveTime ?? null };
  console.log(`予約状況(実行前): ${pre.ok ? "OK" : "NG"} ${pre.message}${pre.reserveTime ? ` / ${pre.reserveTime}` : ""}`);

  const cats = await withTimeout(listStCategories(token, cfg.sellerId), API_TIMEOUT_MS, "stCategoryList");
  out.storeCategories = cats.ok
    ? { total: cats.categories.length, note: "ストアカテゴリ一覧（第1階層）。商品側の未反映件数は API で取得できない" }
    : { error: cats.message };
  out.scopeWarning =
    "reservePublish はストア全体の反映。対象66件以外にストア側で未反映の編集があれば同時に公開される。" +
    "Yahoo API に商品単位の未反映件数を返す口が無いため、件数は確認できていない。";
  console.log(`※ ${out.scopeWarning}`);
}

// --- 2) 反映予約の実行 ---
if (!DRY && !VERIFY_ONLY) {
  const r = await withTimeout(reservePublish(token, cfg.sellerId, 1), API_TIMEOUT_MS, "reservePublish(mode=1)");
  out.publish = { ok: r.ok, message: r.message, reserveTime: r.reserveTime ?? null, executedAt: nowIso() };
  console.log(`reservePublish: ${r.ok ? "OK" : "NG"} ${r.message}${r.reserveTime ? ` / 予約 ${r.reserveTime}` : ""}`);
  if (!r.ok) {
    writeJson(RESULTS_FILE, out);
    console.error("反映予約に失敗しました。中止します。");
    process.exit(2);
  }
  // 反映は非同期。少し待ってから状況を再確認する。
  await sleep(20000);
  const post = await withTimeout(reservePublish(token, cfg.sellerId, 3), API_TIMEOUT_MS, "reservePublish(mode=3)");
  out.afterReservation = { ok: post.ok, message: post.message, reserveTime: post.reserveTime ?? null };
  console.log(`予約状況(実行後): ${post.ok ? "OK" : "NG"} ${post.message}`);
} else if (DRY) {
  out.publish = { skipped: true, reason: "DRY-RUN（reservePublish は実行していない）" };
}

// --- 3) ストアフロントの実地確認（HTTP 200 と在庫表示） ---
const storeUrl = (code) => `https://store.shopping.yahoo.co.jp/${cfg.sellerId}/${code}.html`;
async function checkFront(manage) {
  const t = found.get(manage);
  const rec = { manage, itemCode: t?.input.ne_code ?? null };
  if (!t) {
    rec.error = "アプリDBに該当商品がありません";
    return rec;
  }
  try {
    const got = await withTimeout(getYahooItem(token, cfg.sellerId, t.input.ne_code), API_TIMEOUT_MS, `getItem ${t.input.ne_code}`);
    rec.api = {
      exists: got.exists,
      display: got.exists ? xmlTag(got.raw, "Display") : null,
      quantity: got.exists ? xmlTag(got.raw, "Quantity") : null,
      price: got.exists ? xmlTag(got.raw, "Price") : null,
      taxrateType: got.exists ? xmlTag(got.raw, "TaxrateType") : null,
      groupingId: got.exists ? (xmlTag(got.raw, "GroupingId") || null) : null,
      name: got.exists ? xmlTag(got.raw, "Name").slice(0, 50) : null,
    };
  } catch (e) {
    rec.apiError = String(e?.message ?? e);
  }
  const url = storeUrl(rec.itemCode);
  rec.url = url;
  try {
    const r = await fetchWithTimeout(url, { method: "GET", redirect: "follow" }, IMAGE_TIMEOUT_MS, url);
    rec.httpStatus = r.status;
    const html = r.status === 200 ? await r.text() : "";
    if (html) {
      rec.frontSignals = {
        soldOut: /売り切れ|在庫切れ|SOLD\s*OUT/i.test(html),
        hasCartButton: /カートに入れる|カートに追加/.test(html),
        // 商品ページに自分の商品コードの画像が使われているか（別商品画像の混入検知）
        ownImage: new RegExp(`/lib/${cfg.sellerId}/${rec.itemCode}(_\\d+)?\\.jpg`, "i").test(html),
        titleMatchesName: rec.api?.name ? html.includes(rec.api.name.slice(0, 20)) : null,
      };
    }
  } catch (e) {
    rec.httpStatus = 0;
    rec.httpError = String(e?.message ?? e);
  }
  rec.verdict = rec.httpStatus === 200 && !rec.frontSignals?.soldOut ? "ok" : "ng";
  if (rec.httpStatus !== 200) rec.issue = `ストアページが HTTP ${rec.httpStatus}`;
  else if (rec.frontSignals?.soldOut) rec.issue = "売り切れ表示";
  return rec;
}

const front = [];
for (const manage of SPOT_CHECK) {
  const rec = await checkFront(manage);
  front.push(rec);
  console.log(`[フロント] ${manage} (${rec.itemCode}): HTTP ${rec.httpStatus} / display=${rec.api?.display} 在庫=${rec.api?.quantity} 価格=${rec.api?.price}${rec.issue ? ` — ${rec.issue}` : ""}`);
  await sleep(500);
}
out.frontChecks = front;
out.frontOk = front.filter((f) => f.verdict === "ok").length;
out.frontNg = front.filter((f) => f.verdict !== "ok").length;

writeJson(RESULTS_FILE, out);
console.log(`\nストアフロント確認: OK ${out.frontOk} / 異常 ${out.frontNg}`);
for (const f of front.filter((x) => x.verdict !== "ok")) console.log(`  異常 ${f.manage}: ${f.issue ?? f.httpError ?? "不明"} (${f.url})`);
console.log(`→ ${RESULTS_FILE}`);
