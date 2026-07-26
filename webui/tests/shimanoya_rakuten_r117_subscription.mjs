// [楽天側修正] r117-1 の定期購入価格を恒久ルール ×0.90 切り捨てへ直す（ユーザー承認 2026-07-27）。
//
// 恒久ルール（auto-memory shimanoya-update-rules #4）: 定期価格 = 通常税抜 × 0.90 切り捨て。
// r117-1 は楽天が ×0.95（2593円）のままで、Yahoo（2457円）とずれている。
//
// 手順: 楽天取込（read-before-write） → 変更前バックアップ → DBの定期価格を更新
//       → 反映プレビューで「定期価格だけの差分」であることを確認 → patch 送信 → 楽天 getItem で読み戻し。
// 他フィールドは変更しない（差分が定期価格以外を含む場合は送信せず報告する）。
// 実行: cd webui && npx tsx tests/shimanoya_rakuten_r117_subscription.mjs   （DRY=1 で送信せず確認）
import path from "node:path";
import { getRakutenCredentialsFromEnv } from "../lib/rakuten/credentials.ts";
import { getItem as getRakutenItem, patchItem } from "../lib/rakuten/item-client.ts";
import { upsertProduct, dbRowToProductInput } from "../lib/product/repository.ts";
import {
  WORK_DIR, API_TIMEOUT_MS, BASE,
  ensureWorkDir, loadEnv, fetchWithTimeout, withTimeout, getAdmin, loadTargets, makeCookieFactory,
  writeJson, sleep, nowIso,
} from "./shimanoya_yahoo_sync_common.mjs";

loadEnv();
ensureWorkDir();

const ROUTE_TIMEOUT_MS = API_TIMEOUT_MS * 2;
const DRY = process.env.DRY === "1";
const MANAGE = process.env.ONLY || "r117-1";
const RESULTS_FILE = path.join(WORK_DIR, DRY ? "rakuten-r117-fix.dryrun.json" : "rakuten-r117-fix.json");
const BACKUP_FILE = path.join(WORK_DIR, "backup", "rakuten-r117-backup.json");

/** 楽天の定期価格として許容する差分フィールド名（これ以外が差分に出たら送信しない）。 */
const ALLOWED_DIFF = /subscription_base_price|定期価格|subscription/i;

const admin = getAdmin();
const { found } = await loadTargets(admin);
const cookieFor = await makeCookieFactory(admin);
const t = found.get(MANAGE);
if (!t) {
  console.error(`アプリDBに ${MANAGE} がありません`);
  process.exit(2);
}
const cred = getRakutenCredentialsFromEnv();
if (!cred) {
  console.error("楽天 ESA 認証情報が未設定です");
  process.exit(2);
}

const rec = { manage: MANAGE, productId: t.row.id, timestamp: nowIso() };
const cookie = await cookieFor(t.row.user_id);

// --- 1) read-before-write: 楽天の現在値をアプリへ取込む ---
if (!DRY) {
  try {
    const fr = await fetchWithTimeout(`${BASE}/api/fetch/rakuten/${t.row.id}`, {
      method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: "{}",
    }, ROUTE_TIMEOUT_MS, "fetch rakuten");
    const fj = await fr.json();
    rec.rakutenFetch = { ok: fr.ok && fj.ok, error: fj.error };
  } catch (e) {
    rec.rakutenFetch = { ok: false, error: String(e?.message ?? e) };
  }
  if (!rec.rakutenFetch.ok) {
    rec.status = "ng";
    rec.error = `楽天の取込に失敗: ${rec.rakutenFetch.error}`;
    writeJson(RESULTS_FILE, { ranAt: nowIso(), result: rec });
    console.error(rec.error);
    process.exit(2);
  }
}

const row = (await admin.from("products").select("*").eq("id", t.row.id).single()).data;
const current = dbRowToProductInput(row);
const target = Math.floor(current.selling_price * 0.9);
rec.rule = {
  sellingPriceExclusive: current.selling_price,
  currentSubscriptionPrice: current.subscription_base_price,
  targetSubscriptionPrice: target,
  variantCount: (current.variants ?? []).length,
};
console.log(`${MANAGE}: 通常税抜 ${current.selling_price} / 楽天定期 ${current.subscription_base_price} → ${target}（×0.90切り捨て）`);

if (current.subscription_base_price === target) {
  rec.status = "ok";
  rec.unchanged = true;
  rec.reason = "既にルールどおりの値です（変更なし）";
  writeJson(RESULTS_FILE, { ranAt: nowIso(), result: rec });
  console.log("既に ×0.90 の値のため変更しません。");
  process.exit(0);
}

// --- 2) 変更前バックアップ → DB更新（定期価格のみ。多SKUなら該当SKUも合わせる）---
if (!DRY) {
  writeJson(BACKUP_FILE, [{ manage: MANAGE, productId: t.row.id, savedAt: nowIso(), row }]);
  const patch = { subscription_base_price: target };
  if ((current.variants ?? []).length > 0) {
    patch.variants = current.variants.map((v) =>
      String(v.ne_code).trim() === String(current.ne_code).trim()
        ? { ...v, subscription_base_price: target }
        : v,
    );
  }
  await upsertProduct(admin, { ...current, ...patch }, t.row.id, { authenticatedUserId: t.row.user_id });
  const reread = dbRowToProductInput((await admin.from("products").select("*").eq("id", t.row.id).single()).data);
  rec.dbAfter = { subscription_base_price: reread.subscription_base_price };
  rec.dbOk = reread.subscription_base_price === target;
  console.log(`アプリDB更新: 定期価格 ${reread.subscription_base_price}（期待 ${target}）`);
}

// --- 3) 反映プレビューで差分を確認（定期価格以外が混ざっていたら送信しない）---
/** dev server はルート初回アクセスでコンパイルに失敗しHTMLの500を返すことがあるため1回だけ再試行する。 */
async function getJson(url) {
  let last = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetchWithTimeout(url, { headers: { Cookie: cookie } }, ROUTE_TIMEOUT_MS, "update GET");
    const text = await res.text();
    try {
      return { res, json: JSON.parse(text) };
    } catch {
      last = { status: res.status, head: text.slice(0, 120).replace(/\s+/g, " ") };
      await sleep(3000);
    }
  }
  throw new Error(`反映プレビューがJSONを返しません（HTTP ${last?.status}）: ${last?.head}`);
}
const { res: pr, json: pj } = await getJson(`${BASE}/api/update/rakuten/${t.row.id}`);
if (!pr.ok || !pj.ok) {
  rec.status = "ng";
  rec.error = `反映プレビューNG: ${pj.error ?? `HTTP ${pr.status}`}`;
  writeJson(RESULTS_FILE, { ranAt: nowIso(), result: rec });
  console.error(rec.error);
  process.exit(2);
}
rec.preview = {
  hasChanges: pj.hasChanges,
  changedFields: (pj.changedFields ?? []).map((c) => ({ field: c.field, before: c.before, after: c.after })),
  skipped: pj.skipped ?? [],
  structural: pj.structural ?? [],
};
const unexpected = rec.preview.changedFields.filter((c) => !ALLOWED_DIFF.test(c.field));
console.log(`プレビュー差分: ${rec.preview.changedFields.map((c) => c.field).join(", ") || "(なし)"}`);
if (unexpected.length) {
  rec.status = "skip";
  rec.reason = `定期価格以外の差分が含まれるため送信しません: ${unexpected.map((c) => c.field).join(", ")}`;
  writeJson(RESULTS_FILE, { ranAt: nowIso(), result: rec });
  console.error(rec.reason);
  process.exit(2);
}

// アプリの反映ルートは「SKU構成の変更」ガードで 409 になる。
// r117-1 のアプリ行は自SKU 1件しか持たないのに楽天ページには3SKUあるため、
// ガードが「SKU削除(r117-3, r117-5)」と誤検知するため（実際には削除しない）。
// 楽天 patch は未指定の variant をそのまま残す仕様なので、
// 「自SKUの定期価格だけ」を含む最小ボディを直接送る（他フィールド・他SKUには触れない）。
rec.routeBlocked = {
  structural: rec.preview.structural,
  reason: "アプリの反映ルートはSKU構成変更ガードで中止されるため、定期価格のみの最小 patch を直接送信した",
};
const patchBody = { variants: { [current.ne_code]: { subscriptionPrice: { basePrice: String(target) } } } };
rec.patchBody = patchBody;

if (DRY) {
  rec.status = "skip";
  rec.reason = "DRY-RUN（送信せず）";
  writeJson(RESULTS_FILE, { ranAt: nowIso(), dryRun: true, result: rec });
  console.log(`DRY-RUN のため送信しませんでした。送信予定ボディ: ${JSON.stringify(patchBody)}`);
  process.exit(0);
}

// --- 4) 楽天へ最小 patch を送信（定期価格のみ）---
const pres = await withTimeout(patchItem(cred, MANAGE, patchBody), API_TIMEOUT_MS, `patchItem ${MANAGE}`);
rec.apply = { ok: pres.ok, status: pres.status, message: pres.message };
if (!pres.ok) {
  rec.status = "ng";
  rec.error = `楽天への反映NG: ${pres.message}`;
  writeJson(RESULTS_FILE, { ranAt: nowIso(), result: rec });
  console.error(rec.error);
  process.exit(2);
}
console.log(`楽天へ反映: OK（定期価格のみの最小patch）`);

// --- 5) 楽天 getItem で読み戻し ---
await sleep(2000);
const got = await withTimeout(getRakutenItem(cred, MANAGE), API_TIMEOUT_MS, `rakuten getItem ${MANAGE}`);
const variants = got.json?.variants ?? {};
const mine = Object.entries(variants).find(([k, v]) => k === current.ne_code || v?.merchantDefinedSkuId === current.ne_code) ?? Object.entries(variants)[0];
const subPrice = mine?.[1]?.subscriptionPrice;
rec.rakutenAfter = {
  variantKey: mine?.[0] ?? null,
  subscriptionPrice: subPrice ?? null,
  basePrice: subPrice?.basePrice ?? null,
};
const actual = Number(rec.rakutenAfter.basePrice ?? NaN);
rec.status = actual === target ? "ok" : "ng";
if (rec.status === "ng") rec.error = `楽天の読み戻しが期待値と一致しません（期待 ${target} / 実際 ${rec.rakutenAfter.basePrice ?? "(取得できず)"}）`;

writeJson(RESULTS_FILE, {
  ranAt: nowIso(),
  rule: "定期価格 = 通常税抜 × 0.90 切り捨て（Yahoo と同値）",
  note: "他フィールドは変更していない（差分が定期価格のみであることをプレビューで確認してから送信）",
  result: rec,
});
console.log(`\n読み戻し: 楽天定期価格 ${rec.rakutenAfter.basePrice}（期待 ${target}）→ ${rec.status === "ok" ? "一致" : "不一致"}`);
console.log(`→ ${RESULTS_FILE}`);
