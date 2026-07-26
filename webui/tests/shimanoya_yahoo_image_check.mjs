// [2/4] しまのや 楽天→Yahoo 一括反映（2026-07-26）: 画像リンク切れチェック（読み取り専用）。
// ユーザー確定方針: リンク切れは「報告のみで反映続行」。除外もスキップもしない。
// 検査対象（商品ごと）:
//   A) yahoo_item_image  … Yahoo へ送られる item_image_urls（getItem の Image + LibImage1..20 のラウンドトリップ値）
//   B) yahoo_caption_img … 送信する商品説明(caption/sp_additional)HTML 内の <img src>
//   C) app_db_image      … アプリDBの image_url_1..20 / 白背景画像（画像の元データ = R-Cabinet 等）
// 各URLは HEAD（405/403 等なら GET Range で再試行）で実際に HTTP 検証する。per-call 15s タイムアウト。
// 実行: cd webui && npx tsx tests/shimanoya_yahoo_image_check.mjs
import path from "node:path";
import {
  TARGETS, WORK_DIR, IMAGE_TIMEOUT_MS, API_TIMEOUT_MS, CHUNK_SIZE, BASE,
  ensureWorkDir, loadEnv, fetchWithTimeout, getAdmin, loadTargets, makeCookieFactory,
  chunk, writeJson, readJsonl, extractImgSrc, dbImageUrls, xmlImageUrls, sleep, nowIso,
} from "./shimanoya_yahoo_sync_common.mjs";

// 反映前後で2回走らせるため出力名を差し替えられる（既定: image-check.json）。
const OUT_NAME = process.env.OUT_NAME || "image-check.json";

loadEnv();
ensureWorkDir();

const ROUTE_TIMEOUT_MS = API_TIMEOUT_MS * 2; // アプリのAPIルートは外部API(Yahoo getItem等)を内包するため 30s×2

const admin = getAdmin();
const { found } = await loadTargets(admin);
const cookieFor = await makeCookieFactory(admin);
const backup = new Map(readJsonl(path.join(WORK_DIR, "backup", "yahoo-current.jsonl")).map((r) => [r.manage, r]));

/** URL単位の検査結果キャッシュ（同じ画像を何度も叩かない）。 */
const cache = new Map();
/** 画像URLの並列検査数（画像サーバの応答が遅いため。多すぎると弾かれるので控えめ）。 */
const PARALLEL = Number(process.env.IMAGE_PARALLEL || 8);

/** 同時実行数を絞った map。入力順で結果を返す。 */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

function checkUrl(url) {
  // 同一URLの同時リクエストも1本にまとめるため、結果ではなく Promise をキャッシュする。
  if (!cache.has(url)) cache.set(url, checkUrlOnce(url));
  return cache.get(url);
}

async function checkUrlOnce(url) {
  // 通信エラー/タイムアウト（status 0）は一時的な失敗のことがあるため 2 回まで再試行する。
  // 再試行せずに「リンク切れ」と報告すると誤検知になる（260726実測: 1件が再試行で 206 に回復）。
  let out;
  for (let attempt = 1; attempt <= 3; attempt++) {
    out = await requestOnce(url);
    if (out.ok || out.status !== 0) break;
    out.retried = attempt;
    await sleep(700 * attempt);
  }
  return out;
}

async function requestOnce(url) {
  try {
    const head = await fetchWithTimeout(url, { method: "HEAD", redirect: "follow" }, IMAGE_TIMEOUT_MS, url);
    if (head.ok) return { ok: true, status: head.status, method: "HEAD" };
    if ([403, 405, 501].includes(head.status)) {
      // HEAD 非対応サーバー向けフォールバック（先頭1バイトだけ GET）
      const get = await fetchWithTimeout(url, { method: "GET", headers: { Range: "bytes=0-0" }, redirect: "follow" }, IMAGE_TIMEOUT_MS, url);
      return { ok: get.ok || get.status === 206, status: get.status, method: "GET" };
    }
    return { ok: false, status: head.status, method: "HEAD" };
  } catch (e) {
    return { ok: false, status: 0, method: "HEAD", error: String(e?.message ?? e) };
  }
}

const results = [];
const chunks = chunk(TARGETS, CHUNK_SIZE);
let i = 0;
for (const [ci, group] of chunks.entries()) {
  for (const manage of group) {
    i++;
    const t = found.get(manage);
    const label = `[${i}/${TARGETS.length}] ${manage}`;
    const entry = { manage, chunk: ci + 1, itemCode: t?.input.ne_code ?? null, sources: {}, broken: [], checked: 0, timestamp: nowIso() };
    if (!t) {
      entry.note = "アプリDBに該当商品がありません（画像の取得元なし）";
      results.push(entry);
      console.log(`${label} skip: アプリDBに該当なし`);
      continue;
    }

    // A/B: Yahoo へ送信予定の画像。反映プレビュー(GET)の willSend を正とし、
    //      取得できない場合はバックアップの getItem 生XMLから復元する。
    let itemImageUrls = [];
    let captionImgs = [];
    try {
      const pr = await fetchWithTimeout(`${BASE}/api/update/yahoo/${t.row.id}`, { headers: { Cookie: await cookieFor(t.row.user_id) } }, ROUTE_TIMEOUT_MS, "update GET");
      const pj = await pr.json();
      if (pj.ok && pj.willSend) {
        itemImageUrls = String(pj.willSend.item_image_urls ?? "").split(";").map((s) => s.trim()).filter(Boolean);
        captionImgs = [...new Set([...extractImgSrc(pj.willSend.caption), ...extractImgSrc(pj.willSend.sp_additional)])];
        entry.previewSource = "willSend";
      } else {
        entry.previewError = pj.error ?? `HTTP ${pr.status}`;
      }
    } catch (e) {
      entry.previewError = String(e?.message ?? e);
    }
    if (itemImageUrls.length === 0 && backup.has(manage)) {
      const raw = backup.get(manage).raw ?? "";
      itemImageUrls = xmlImageUrls(raw);
      if (captionImgs.length === 0) captionImgs = [...new Set(extractImgSrc((raw.match(/<Caption><!\[CDATA\[([\s\S]*?)\]\]><\/Caption>/i) || [])[1] ?? ""))];
      if (!entry.previewSource) entry.previewSource = "backup-xml";
    }

    // C: アプリDBの画像URL（画像の元データ）
    const appUrls = dbImageUrls(t.input);

    const groups = [
      ["yahoo_item_image", itemImageUrls],
      ["yahoo_caption_img", captionImgs],
      ["app_db_image", appUrls],
    ];
    // 1商品あたり20〜30URLあるため並列で検査する（逐次だと画像サーバの応答待ちで数時間かかる）。
    for (const [source, urls] of groups) {
      const list = await mapLimit(urls, PARALLEL, async (url) => ({ url, ...(await checkUrl(url)) }));
      entry.checked += list.length;
      for (const r of list) if (!r.ok) entry.broken.push({ source, url: r.url, status: r.status, error: r.error });
      entry.sources[source] = list;
    }
    results.push(entry);
    console.log(`${label} 検査${entry.checked}件 / リンク切れ ${entry.broken.length}件${entry.previewError ? ` (プレビュー取得NG: ${String(entry.previewError).slice(0, 60)})` : ""}`);
    await sleep(120);
  }
  console.log(`--- チャンク ${ci + 1}/${chunks.length} 完了 ---`);
}

const brokenItems = results.filter((r) => r.broken.length > 0);
const totalChecked = results.reduce((a, r) => a + r.checked, 0);
const totalBroken = results.reduce((a, r) => a + r.broken.length, 0);
writeJson(path.join(WORK_DIR, OUT_NAME), {
  ranAt: nowIso(),
  policy: "リンク切れは報告のみ・反映は続行（2026-07-26 ユーザー確定方針）",
  timeoutMs: IMAGE_TIMEOUT_MS,
  total: TARGETS.length,
  checkedUrls: totalChecked,
  uniqueUrls: cache.size,
  brokenUrls: totalBroken,
  brokenItems: brokenItems.length,
  brokenList: brokenItems.flatMap((r) => r.broken.map((b) => ({ manage: r.manage, itemCode: r.itemCode, source: b.source, url: b.url, status: b.status, error: b.error }))),
  results,
});

console.log(`\n画像チェック完了: URL ${totalChecked}件（ユニーク ${cache.size}）/ リンク切れ ${totalBroken}件（${brokenItems.length}商品）`);
for (const r of brokenItems) for (const b of r.broken) console.log(`  リンク切れ ${r.manage} [${b.source}] HTTP ${b.status}${b.error ? ` (${b.error})` : ""} ${b.url}`);
console.log(`→ ${path.join(WORK_DIR, OUT_NAME)}`);
