// [追加作業2] Yahoo 商品説明内の楽天リンクを Yahoo ストアの該当商品URLへ置換する（ユーザー裁定 2026-07-26）。
//
// 対象: r7801-1 / r7801-2 / r7801-3 / r7801-5（説明文に item.rakuten.co.jp へのリンクが残っている）。
// アプリDBの説明文は楽天用のため変更しない。**Yahoo へ送る値だけ**置換する。
//
// 手順: getItem の現在値をラウンドトリップ → 楽天リンクを検出 → 対応する Yahoo 商品の存在を getItem で確認
//       → ストアURLへ置換 → editItem → 読み戻しで楽天リンクが消えたことを確認。
// リンク先の Yahoo 商品が見つからない場合はその1本だけ置換せず、報告に残して他は続行する。
//
// 安全ルール: reservePublish は呼ばない / per-call 30s タイムアウト / 結果JSONへ保存 / 秘密値非出力。
// 実行: cd webui && npx tsx tests/shimanoya_yahoo_link_replace.mjs   （DRY=1 で送信せず対応表のみ作る）
import path from "node:path";
import { getItem as getYahooItem, editItem } from "../lib/yahoo/item-client.ts";
import { xmlToEditItemParams } from "../lib/converters/yahoo-patch.ts";
import { fitYahooFieldLimits } from "../lib/yahoo/item-mapper.ts";
import {
  WORK_DIR, API_TIMEOUT_MS, IMAGE_TIMEOUT_MS,
  ensureWorkDir, loadEnv, fetchWithTimeout, withTimeout, getAdmin, loadTargets,
  yahooAuth, writeAuthBlocked, writeJson, sleep, nowIso,
} from "./shimanoya_yahoo_sync_common.mjs";

loadEnv();
ensureWorkDir();

const DRY = process.env.DRY === "1";
const TARGETS = (process.env.ONLY || "r7801-1,r7801-2,r7801-3,r7801-5").split(",").map((s) => s.trim()).filter(Boolean);
const RESULTS_FILE = path.join(WORK_DIR, DRY ? "link-replace.dryrun.json" : "link-replace.json");

const admin = getAdmin();
const { found } = await loadTargets(admin);

let cfg, token;
try {
  ({ cfg, token } = await yahooAuth());
} catch (e) {
  const msg = String(e?.message ?? e);
  writeAuthBlocked("link-replace", msg);
  console.error(`Yahoo認証に失敗しました。中止します。\n  ${msg}`);
  process.exit(2);
}

/** Yahoo が外部リンクを中継ページ(bouncer)へ書き換えた形を元URLへ戻す（再送で二重に包まれるのを防ぐ）。 */
function unwrapBouncer(s) {
  return String(s ?? "").replace(
    /https:\/\/shopping\.yahoo\.co\.jp\/stores\/wrap\/bouncer\.html\?dest_path=([^"'\s>]+)/g,
    (_, u) => { try { return decodeURIComponent(u); } catch { return u; } },
  );
}

/** 楽天商品ページURL → 管理番号（例 https://item.rakuten.co.jp/ichiban-okinawa/r7201-1/ → r7201-1）。 */
function rakutenCodeFromUrl(url) {
  return url.match(/item\.rakuten\.co\.jp\/[^/]+\/([^/?#"'\s]+)/i)?.[1] ?? "";
}

/** 楽天管理番号 → Yahoo ストアの商品URL。
 *  「ストアエディタに存在する（getItem）」だけでは不十分で、**買い物客が開けること（ストアページが HTTP 200）**
 *  まで確認できたものだけを置換先に採用する。非公開(Display=0)の商品はストアページが 404 になるため、
 *  そのまま置換するとリンク切れを作ってしまう（260726実測: r7201-1-mg は Display=0 で 404）。 */
const urlCache = new Map();
async function resolveYahooUrl(rakutenCode) {
  if (urlCache.has(rakutenCode)) return urlCache.get(rakutenCode);
  const t = found.get(rakutenCode);
  const candidates = [...new Set([t?.input.ne_code, rakutenCode, ...(t?.input.variants ?? []).map((v) => v.ne_code)].filter(Boolean))];
  const probed = [];
  let out = null;
  for (const code of candidates) {
    let exists = false;
    let display = null;
    try {
      const g = await withTimeout(getYahooItem(token, cfg.sellerId, code), API_TIMEOUT_MS, `getItem ${code}`);
      exists = g.exists;
      if (g.exists) display = (g.raw.match(/<Display>([^<]*)<\/Display>/i) || [])[1] ?? "";
    } catch (e) {
      probed.push({ code, error: String(e?.message ?? e) });
      continue;
    }
    if (!exists) {
      probed.push({ code, exists: false });
      await sleep(120);
      continue;
    }
    const storeUrl = `https://store.shopping.yahoo.co.jp/${cfg.sellerId}/${code}.html`;
    let http = null;
    try {
      const r = await fetchWithTimeout(storeUrl, { method: "GET", redirect: "follow" }, IMAGE_TIMEOUT_MS, storeUrl);
      http = r.status;
    } catch (e) {
      http = String(e?.message ?? e);
    }
    probed.push({ code, exists: true, display, url: storeUrl, httpStatus: http });
    if (http === 200) {
      out = { rakutenCode, yahooItemCode: code, url: storeUrl, httpStatus: http, display, probed };
      break;
    }
    await sleep(120);
  }
  if (!out) {
    const shown = probed.find((p) => p.exists && p.httpStatus !== 200);
    out = {
      rakutenCode, yahooItemCode: null, url: null, probed,
      reason: shown
        ? `対応する Yahoo 商品（${shown.code}）は存在しますが非公開（Display=${shown.display}）でストアページが ${shown.httpStatus} のため、リンク切れを作らないよう置換しませんでした`
        : "対応する Yahoo 商品が見つかりません",
    };
  }
  urlCache.set(rakutenCode, out);
  return out;
}

const results = [];
const mappings = [];

for (const manage of TARGETS) {
  const t = found.get(manage);
  const rec = { manage, status: "ng", replacements: [], timestamp: nowIso() };
  if (!t) {
    rec.status = "skip";
    rec.reason = "アプリDBに該当商品がありません";
    results.push(rec);
    console.log(`${manage} skip: アプリDBに該当なし`);
    continue;
  }
  rec.itemCode = t.input.ne_code;
  try {
    const got = await withTimeout(getYahooItem(token, cfg.sellerId, t.input.ne_code), API_TIMEOUT_MS, `getItem ${t.input.ne_code}`);
    if (!got.exists) {
      rec.status = "ng";
      rec.error = "Yahooに該当商品がありません";
      results.push(rec);
      console.log(`${manage} NG: Yahooに商品なし`);
      continue;
    }
    const { params } = xmlToEditItemParams(got.raw, cfg.sellerId);
    const beforeCaption = unwrapBouncer(params.caption ?? "");
    const beforeSp = unwrapBouncer(params.sp_additional ?? "");

    const links = [...new Set([...`${beforeCaption}\n${beforeSp}`.matchAll(/https?:\/\/item\.rakuten\.co\.jp\/[^"'\s<>]+/gi)].map((m) => m[0]))];
    if (links.length === 0) {
      rec.status = "skip";
      rec.reason = "説明文に楽天リンクがありません（置換不要）";
      results.push(rec);
      console.log(`${manage} skip: 楽天リンクなし`);
      continue;
    }

    let caption = beforeCaption;
    let sp = beforeSp;
    let replaced = 0;
    for (const link of links) {
      const code = rakutenCodeFromUrl(link);
      const map = await resolveYahooUrl(code);
      mappings.push({ manage, from: link, rakutenCode: code, to: map.url, yahooItemCode: map.yahooItemCode, httpStatus: map.httpStatus, probedCodes: map.probed, reason: map.reason });
      if (!map.url) {
        rec.replacements.push({ from: link, to: null, skipped: true, reason: map.reason });
        console.log(`${manage} 置換せず: ${map.reason}`);
        continue;
      }
      const before = caption + sp;
      caption = caption.split(link).join(map.url);
      sp = sp.split(link).join(map.url);
      if (before !== caption + sp) replaced++;
      rec.replacements.push({ from: link, to: map.url, yahooItemCode: map.yahooItemCode, httpStatus: map.httpStatus });
    }

    if (replaced === 0) {
      rec.status = "skip";
      rec.reason = rec.replacements.find((x) => x.skipped)?.reason
        ?? "置換できるリンクがありませんでした（置換先のYahoo商品を特定できません）";
      results.push(rec);
      continue;
    }

    params.caption = caption;
    if (params.sp_additional) params.sp_additional = sp;
    const body = fitYahooFieldLimits(params);

    if (DRY) {
      rec.status = "skip";
      rec.reason = `DRY-RUN（${replaced}本の置換を送信せず）`;
      results.push(rec);
      console.log(`${manage} dry-run: ${replaced}本を置換予定`);
      continue;
    }

    const r = await withTimeout(editItem(token, body), API_TIMEOUT_MS, `editItem ${t.input.ne_code}`);
    if (!r.ok) {
      rec.status = "ng";
      rec.error = r.message;
      results.push(rec);
      console.log(`${manage} 送信NG: ${String(r.message).slice(0, 160)}`);
      continue;
    }
    if ((r.warnings ?? []).length) rec.warnings = r.warnings;

    // 読み戻し: 楽天リンクが消えて Yahoo ストアURLになっているか
    await sleep(800);
    const back = await withTimeout(getYahooItem(token, cfg.sellerId, t.input.ne_code), API_TIMEOUT_MS, `getItem ${t.input.ne_code}`);
    const afterCaption = unwrapBouncer((back.raw.match(/<Caption><!\[CDATA\[([\s\S]*?)\]\]><\/Caption>/i) || [])[1] ?? "");
    const leftover = [...new Set([...afterCaption.matchAll(/https?:\/\/item\.rakuten\.co\.jp\/[^"'\s<>]+/gi)].map((m) => m[0]))];
    const hasStoreLink = afterCaption.includes(`store.shopping.yahoo.co.jp/${cfg.sellerId}/`);
    rec.verify = { rakutenLinksLeft: leftover, hasYahooStoreLink: hasStoreLink };
    rec.status = leftover.length === 0 && hasStoreLink ? "ok" : "ng";
    if (rec.status === "ng") rec.error = leftover.length ? `楽天リンクが残っています: ${leftover.join(", ")}` : "Yahoo ストアURLが確認できません";
    results.push(rec);
    console.log(`${manage} ${rec.status === "ok" ? `置換OK（${replaced}本）` : `検証NG: ${rec.error}`}`);
    await sleep(300);
  } catch (e) {
    rec.status = "ng";
    rec.error = String(e?.message ?? e);
    results.push(rec);
    console.log(`${manage} 例外: ${String(e?.message ?? e).slice(0, 160)}`);
  }
}

writeJson(RESULTS_FILE, {
  ranAt: nowIso(),
  note: "アプリDBの説明文は変更していない（楽天用のため）。Yahoo へ送る値だけ置換した。",
  reservePublish: "未実行（公開保留）",
  ok: results.filter((r) => r.status === "ok").length,
  ng: results.filter((r) => r.status === "ng").length,
  skip: results.filter((r) => r.status === "skip").length,
  mappings,
  results,
});
console.log(`\nリンク置換 完了: OK ${results.filter((r) => r.status === "ok").length} / NG ${results.filter((r) => r.status === "ng").length} / SKIP ${results.filter((r) => r.status === "skip").length}`);
console.log(`→ ${RESULTS_FILE}`);
