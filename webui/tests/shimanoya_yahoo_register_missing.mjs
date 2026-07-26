// [追加作業3] しまのや Yahoo 未登録商品の新規出品（公開はしない）。
//
// 前回 SKIP になった商品を Yahoo に新規登録する。ただし前回の SKIP 判定は ne_code 1本の
// ルックアップ依存だったため、**登録前に必ず「別コードで既存出品がないか」を総当たりで検証**する
// （実例: r8801-0 → ne_code r8801-0-1 / r7201-2 → r7201-2-mg2 のようなサフィックス付きコード）。
// 重複出品を作らないことが最優先。既存が見つかった商品は登録せず報告に回す。
//
// 安全ルール（前回踏襲）:
//   - reservePublish は呼ばない。display=0（非表示）で登録し、公開はユーザー判断に残す。
//   - 外部API呼び出しは per-call タイムアウト（30s）。失敗は当該itemのみ failed で全体は継続。
//   - 10〜20件チャンク・1件ごとに結果JSONへ保存。秘密値は出力しない。
//   - 多SKUページでも「その商品自身のSKU（ne_code）」1件だけを登録する
//     （yahooItemsForProduct は全SKUを展開するため、そのまま使うと1商品で3出品作ってしまう）。
//
// 実行: cd webui && npx tsx tests/shimanoya_yahoo_register_missing.mjs
//   PROBE=1 既存出品の調査のみで登録しない / ONLY=r8801-0,... 対象を絞る
import path from "node:path";
import { getItem as getYahooItem, editItem } from "../lib/yahoo/item-client.ts";
import { buildYahooEditItemParams, validateEditItemParams, fitYahooFieldLimits } from "../lib/yahoo/item-mapper.ts";
import { yahooItemsForProduct } from "../lib/product/yahoo-split.ts";
import {
  WORK_DIR, API_TIMEOUT_MS, CHUNK_SIZE, BASE,
  ensureWorkDir, loadEnv, fetchWithTimeout, withTimeout, getAdmin, loadTargets, makeCookieFactory,
  yahooAuth, writeAuthBlocked, chunk, readJson, writeJson, sleep, nowIso,
} from "./shimanoya_yahoo_sync_common.mjs";

loadEnv();
ensureWorkDir();

const ROUTE_TIMEOUT_MS = API_TIMEOUT_MS * 2;
const PROBE = process.env.PROBE === "1";
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",").map((s) => s.trim()).filter(Boolean)) : null;
/** 新規出品の配送グループ管理番号（2026-07-26 ユーザー裁定: 6）。空文字でアプリ既定値のまま。 */
const POSTAGE_SET = process.env.POSTAGE_SET ?? "6";
const RESULTS_FILE = path.join(WORK_DIR, PROBE ? "register-probe.json" : "register-results.json");

const sync = readJson(path.join(WORK_DIR, "sync-results.json"));
if (!sync) {
  console.error("sync-results.json がありません。先に反映を実行してください。");
  process.exit(2);
}
let targets = sync.results.filter((r) => r.status === "skip").map((r) => r.manage);
if (ONLY) targets = targets.filter((m) => ONLY.has(m));
console.log(`対象（前回SKIP）: ${targets.length}件${PROBE ? " ※調査のみ・登録しません" : ""}`);

const admin = getAdmin();
const { found } = await loadTargets(admin);
const cookieFor = await makeCookieFactory(admin);

let cfg, token;
try {
  ({ cfg, token } = await yahooAuth());
} catch (e) {
  const msg = String(e?.message ?? e);
  writeAuthBlocked("register", msg);
  console.error(`Yahoo認証に失敗しました。中止します。\n  ${msg}`);
  process.exit(2);
}

/** 「同じ商品が別コードで既に出品されていないか」を調べる候補コードを組み立てる。 */
function candidateCodes(manage, input) {
  const codes = new Set();
  const add = (v) => {
    const s = String(v ?? "").trim();
    if (s) codes.add(s);
  };
  add(manage);
  add(input.ne_code);
  add(input.rakuten_variant_id);
  for (const v of input.variants ?? []) {
    add(v.ne_code);
    add(v.sku_manage_number);
  }
  // サフィックス除去形（r8801-0-1 → r8801-0 / r7201-2-mg2 → r7201-2）
  for (const c of [...codes]) {
    const cut = c.replace(/-[^-]+$/, "");
    if (cut && cut !== c) add(cut);
  }
  // 管理番号にモール側サフィックスが付く形（r8801-0 → r8801-0-1）も試す
  add(`${manage}-1`);
  return [...codes];
}

// 再実行(RESUME): 既に登録済みの manage は再送しない（結果はマージして残す）。
const prevResults = readJson(RESULTS_FILE, null)?.results ?? [];
const alreadyRegistered = new Set(
  process.env.FORCE === "1" ? [] : prevResults.filter((r) => r.status === "registered").map((r) => r.manage),
);
if (alreadyRegistered.size) {
  console.log(`RESUME: 登録済み ${alreadyRegistered.size}件をスキップします（FORCE=1 で再実行）`);
  targets = targets.filter((m) => !alreadyRegistered.has(m));
}

const results = []; // 今回実行分だけを積む（保存時に前回分とマージする）
/** 前回結果 + 今回結果（同じ manage は今回を優先）。 */
function mergedResults() {
  return prevResults.filter((p) => !results.some((r) => r.manage === p.manage)).concat(results);
}
function save() {
  const all = mergedResults();
  writeJson(RESULTS_FILE, {
    ranAt: nowIso(),
    mode: PROBE ? "probe" : "register",
    reservePublish: "未実行（公開保留）",
    display: "0（非表示で登録）",
    postageSet: POSTAGE_SET || "(アプリ既定値)",
    total: all.length,
    registered: all.filter((r) => r.status === "registered").length,
    existing: all.filter((r) => r.status === "existing").length,
    skipped: all.filter((r) => r.status === "skip").length,
    failed: all.filter((r) => r.status === "ng").length,
    results: all,
  });
}

const chunks = chunk(targets, CHUNK_SIZE);
let i = 0;
for (const [ci, group] of chunks.entries()) {
  for (const manage of group) {
    i++;
    const label = `[${i}/${targets.length}] ${manage}`;
    const rec = { manage, chunk: ci + 1, status: "ng", probedCodes: [], timestamp: nowIso() };
    try {
      const t = found.get(manage);
      if (!t) {
        rec.status = "skip";
        rec.reason = "商品登録アプリに該当商品がありません";
        results.push(rec); save();
        console.log(`${label} skip: アプリDBに該当なし`);
        continue;
      }
      const input = t.input;
      rec.productId = t.row.id;
      rec.itemCode = input.ne_code;
      rec.variantCount = (input.variants ?? []).length;

      // ---- 1) 既存出品の総当たり調査（重複出品防止の要）----
      for (const code of candidateCodes(manage, input)) {
        try {
          const g = await withTimeout(getYahooItem(token, cfg.sellerId, code), API_TIMEOUT_MS, `getItem ${code}`);
          rec.probedCodes.push({ code, exists: g.exists, name: g.exists ? (g.raw.match(/<Name>([^<]*)<\/Name>/i) || [])[1] ?? "" : undefined });
        } catch (e) {
          rec.probedCodes.push({ code, exists: null, error: String(e?.message ?? e) });
        }
        await sleep(120);
      }
      const hits = rec.probedCodes.filter((p) => p.exists === true);
      const probeErrors = rec.probedCodes.filter((p) => p.exists === null);
      if (probeErrors.length) {
        rec.status = "skip";
        rec.reason = `既存出品の確認に失敗したコードがあるため登録を見送りました（重複出品防止）: ${probeErrors.map((p) => p.code).join(", ")}`;
        results.push(rec); save();
        console.log(`${label} skip: 既存確認NG（${probeErrors.length}コード）`);
        continue;
      }
      if (hits.length) {
        rec.status = "existing";
        rec.existingCodes = hits.map((h) => h.code);
        rec.reason = `別コードで既に出品されています（${hits.map((h) => h.code).join(", ")}）。重複出品を避けるため新規登録しません。アプリのNEコード（${input.ne_code}）と紐付けキーが異なるため、update 経路にも載りません（要ユーザー判断）`;
        results.push(rec); save();
        console.log(`${label} 既存出品あり: ${rec.existingCodes.join(", ")} → 登録せず報告`);
        continue;
      }

      // ---- 2) 登録するのは「この商品自身のSKU」1件だけ ----
      const skuItems = yahooItemsForProduct(input);
      const own = skuItems.find((x) => String(x.ne_code).trim() === String(input.ne_code).trim()) ?? (skuItems.length === 1 ? skuItems[0] : null);
      if (!own) {
        rec.status = "skip";
        rec.reason = `この商品のNEコード（${input.ne_code}）に一致するSKUが variants にありません`;
        results.push(rec); save();
        console.log(`${label} skip: 自SKU不明`);
        continue;
      }
      rec.siblingSkus = skuItems.filter((x) => x.ne_code !== own.ne_code).map((x) => x.ne_code);

      // ---- 3) 必須項目の検証（不足があれば登録しない）----
      const params = fitYahooFieldLimits(buildYahooEditItemParams(own, { sellerId: cfg.sellerId, forUpdate: false }));
      params.display = "0"; // 非表示で登録（公開はユーザー判断）
      // 配送グループ（postage_set）: アプリは楽天の配送方法セット番号を素通しするが、Yahoo ストアには
      // グループ 8・9 が存在せず it-01201 になる。ユーザー裁定（2026-07-26）で新規出品は 6 を使う。
      if (POSTAGE_SET) {
        rec.postageSet = { sent: POSTAGE_SET, fromApp: params.postage_set ?? null };
        params.postage_set = POSTAGE_SET;
      }
      const valid = validateEditItemParams(params);
      if (!valid.ok) {
        rec.status = "skip";
        rec.missing = valid.missing;
        rec.reason = `新規出品に必要な項目が不足しています: ${valid.missing.join(" / ")}`;
        results.push(rec); save();
        console.log(`${label} skip: 必須不足（${valid.missing.join(", ")}）`);
        continue;
      }
      rec.willSend = { item_code: params.item_code, name: params.name, price: params.price, product_category: params.product_category, path: params.path, display: params.display, item_image_urls: params.item_image_urls };

      if (PROBE) {
        rec.status = "skip";
        rec.reason = "PROBE（調査のみ・登録していません）";
        results.push(rec); save();
        console.log(`${label} 登録可能（未登録・必須項目OK / 兄弟SKU ${rec.siblingSkus.length}件は対象外）`);
        continue;
      }

      // ---- 4) 画像を Yahoo 画像ライブラリへ転送（item_image_urls の参照先を用意）----
      try {
        const ur = await fetchWithTimeout(`${BASE}/api/upload/yahoo-sync/${t.row.id}`, {
          method: "POST", headers: { Cookie: await cookieFor(t.row.user_id), "Content-Type": "application/json" }, body: "{}",
        }, ROUTE_TIMEOUT_MS, "yahoo-sync");
        const uj = await ur.json();
        rec.imageSync = { ok: ur.ok && uj.ok, uploaded: (uj.uploaded ?? []).length, failed: uj.failed ?? [], error: uj.error };
        if (!rec.imageSync.ok) rec.warnings = [...(rec.warnings ?? []), `画像転送に失敗: ${uj.error ?? `HTTP ${ur.status}`}`];
        // 画像が Yahoo 側で参照可能になるまで少し待つ（直後に editItem すると it-14091 になる）
        if (rec.imageSync.ok) await sleep(2500);
      } catch (e) {
        rec.imageSync = { ok: false, error: String(e?.message ?? e) };
        rec.warnings = [...(rec.warnings ?? []), `画像転送で例外: ${String(e?.message ?? e)}`];
      }

      // ---- 5) 新規登録（editItem・display=0）。reservePublish は呼ばない ----
      // it-14091（追加画像への紐づけ失敗）は画像の反映待ちで起きることがあるため1回だけ再試行する。
      let r = await withTimeout(editItem(token, params), API_TIMEOUT_MS, `editItem ${params.item_code}`);
      if (!r.ok && /it-14091/i.test(r.message ?? "")) {
        rec.retriedAfterImageWait = true;
        await sleep(5000);
        r = await withTimeout(editItem(token, params), API_TIMEOUT_MS, `editItem ${params.item_code} (retry)`);
      }
      if (!r.ok) {
        rec.status = "ng";
        rec.error = r.message;
        rec.errors = r.errors;
        results.push(rec); save();
        console.log(`${label} 登録NG: ${String(r.message).slice(0, 160)}`);
        await sleep(300);
        continue;
      }
      if ((r.warnings ?? []).length) rec.warnings = [...(rec.warnings ?? []), ...r.warnings];

      // ---- 6) 読み戻し確認 ----
      const back = await withTimeout(getYahooItem(token, cfg.sellerId, params.item_code), API_TIMEOUT_MS, `getItem ${params.item_code}`);
      rec.verify = {
        exists: back.exists,
        name: back.exists ? (back.raw.match(/<Name>([^<]*)<\/Name>/i) || [])[1] ?? "" : "",
        price: back.exists ? (back.raw.match(/<Price>([^<]*)<\/Price>/i) || [])[1] ?? "" : "",
        display: back.exists ? (back.raw.match(/<Display>([^<]*)<\/Display>/i) || [])[1] ?? "" : "",
      };
      rec.status = back.exists ? "registered" : "ng";
      if (!back.exists) rec.error = "登録は成功しましたが読み戻しで取得できません";
      results.push(rec); save();
      console.log(`${label} 登録OK（display=${rec.verify.display} 非公開 / 価格 ${rec.verify.price}）`);
    } catch (e) {
      rec.status = "ng";
      rec.error = String(e?.message ?? e);
      results.push(rec); save();
      console.log(`${label} 例外: ${String(e?.message ?? e).slice(0, 160)}`);
    }
    await sleep(250);
  }
  console.log(`--- チャンク ${ci + 1}/${chunks.length} 完了 ---`);
}

save();
const f = readJson(RESULTS_FILE);
console.log(`\n完了: 新規登録 ${f.registered} / 既存あり(登録せず) ${f.existing} / 見送り ${f.skipped} / 失敗 ${f.failed}`);
console.log("reservePublish は実行していません。登録した商品は display=0（非表示）です。");
console.log(`→ ${RESULTS_FILE}`);
