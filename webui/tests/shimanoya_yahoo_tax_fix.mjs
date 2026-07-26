// [追加作業1] しまのや Yahoo 税率不一致の修正（ユーザー裁定 2026-07-26）。
//
//   r0101-1 / r1101-1 / r113-1 … 軽減税率 8% が正。Yahoo へ taxrate_type=0.08 と
//                                 8%基準の税込価格（切り捨て）を editItem で送る。
//   r126-1                     … 10% が正。Yahoo は既に 10% のため変更しない。
//                                 アプリDBの tax_rate が 8% のままなら 10% へ更新する。
//
// アプリの「反映」経路は tax_rate を差分項目に持たない（EDITABLE_FIELDS 外）ため editItem では
// 自動補正されない。ここでは getItem の現在値をラウンドトリップした上で税率と価格だけを上書きする
// （他項目は現在値を維持＝最小差分）。
//
// 安全ルール: reservePublish は呼ばない / per-call 30s タイムアウト / 結果JSONへ保存 / 秘密値非出力。
// 実行: cd webui && npx tsx tests/shimanoya_yahoo_tax_fix.mjs   （DRY=1 で送信せず送信予定値のみ確認）
import path from "node:path";
import { getItem as getYahooItem, editItem } from "../lib/yahoo/item-client.ts";
import { xmlToEditItemParams } from "../lib/converters/yahoo-patch.ts";
import { fitYahooFieldLimits } from "../lib/yahoo/item-mapper.ts";
import { yahooTaxInclusive } from "../lib/converters/yahoo-tax.ts";
import { displayPrice } from "../lib/product/schema.ts";
import { upsertProduct, dbRowToProductInput } from "../lib/product/repository.ts";
import {
  WORK_DIR, API_TIMEOUT_MS,
  ensureWorkDir, loadEnv, withTimeout, getAdmin, loadTargets,
  yahooAuth, writeAuthBlocked, writeJson, readJson, xmlTag, sleep, nowIso,
} from "./shimanoya_yahoo_sync_common.mjs";

loadEnv();
ensureWorkDir();

const DRY = process.env.DRY === "1";
// ONLY=r126-1 で対象を絞れる（部分再実行）。前回の結果は manage 単位でマージして残す。
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",").map((s) => s.trim()).filter(Boolean)) : null;
const RESULTS_FILE = path.join(WORK_DIR, DRY ? "tax-fix.dryrun.json" : "tax-fix-results.json");
const BACKUP_FILE = path.join(WORK_DIR, "backup", "tax-fix-backup.json");

/** ユーザー裁定: manage → 正しい税率(%) と、どちら側を直すか。 */
const RULING = [
  { manage: "r0101-1", correctRate: 8, fix: "yahoo" },
  { manage: "r1101-1", correctRate: 8, fix: "yahoo" },
  { manage: "r113-1", correctRate: 8, fix: "yahoo" },
  { manage: "r126-1", correctRate: 10, fix: "appdb" },
];

const admin = getAdmin();
const { found } = await loadTargets(admin);

let cfg, token;
try {
  ({ cfg, token } = await yahooAuth());
} catch (e) {
  const msg = String(e?.message ?? e);
  writeAuthBlocked("tax-fix", msg);
  console.error(`Yahoo認証に失敗しました。中止します。\n  ${msg}`);
  process.exit(2);
}

/** Yahoo が外部リンクを中継ページ(bouncer)へ書き換えた形を元URLへ戻す。
 *  ラウンドトリップ送信で中継URLが二重に包まれるのを防ぐ。 */
function unwrapBouncer(s) {
  return String(s ?? "").replace(
    /https:\/\/shopping\.yahoo\.co\.jp\/stores\/wrap\/bouncer\.html\?dest_path=([^"'\s>]+)/g,
    (_, u) => { try { return decodeURIComponent(u); } catch { return u; } },
  );
}

const results = [];
const backup = [];

for (const rule of RULING) {
  if (ONLY && !ONLY.has(rule.manage)) continue;
  const t = found.get(rule.manage);
  const rec = { manage: rule.manage, correctRate: rule.correctRate, fix: rule.fix, status: "ng", timestamp: nowIso() };
  if (!t) {
    rec.status = "skip";
    rec.reason = "アプリDBに該当商品がありません";
    results.push(rec);
    console.log(`${rule.manage} skip: アプリDBに該当なし`);
    continue;
  }
  const p = t.input;
  rec.productId = t.row.id;
  rec.itemCode = p.ne_code;

  try {
    // ---- A) Yahoo 側を直す（軽減8%が正の商品）----
    if (rule.fix === "yahoo") {
      const got = await withTimeout(getYahooItem(token, cfg.sellerId, p.ne_code), API_TIMEOUT_MS, `getItem ${p.ne_code}`);
      if (!got.exists) {
        rec.status = "ng";
        rec.error = "Yahooに該当商品がありません";
        results.push(rec);
        console.log(`${rule.manage} NG: Yahooに商品なし`);
        continue;
      }
      rec.before = {
        taxrateType: xmlTag(got.raw, "TaxrateType"),
        price: xmlTag(got.raw, "Price"),
        originalPrice: xmlTag(got.raw, "OriginalPrice"),
      };
      // 現在値を完全復元 → 税率と価格だけ上書き（他項目は据え置き）
      const { params } = xmlToEditItemParams(got.raw, cfg.sellerId);
      if (params.caption) params.caption = unwrapBouncer(params.caption);
      if (params.sp_additional) params.sp_additional = unwrapBouncer(params.sp_additional);
      params.taxrate_type = String(rule.correctRate / 100);
      params.price = String(yahooTaxInclusive(p.selling_price, rule.correctRate));
      params.original_price = String(yahooTaxInclusive(displayPrice(p), rule.correctRate));
      const body = fitYahooFieldLimits(params);
      rec.willSend = { taxrate_type: body.taxrate_type, price: body.price, original_price: body.original_price };

      if (DRY) {
        rec.status = "skip";
        rec.reason = "DRY-RUN（送信せず）";
        results.push(rec);
        console.log(`${rule.manage} dry-run: 税率 ${rec.before.taxrateType}→${body.taxrate_type} / 価格 ${rec.before.price}→${body.price}`);
        continue;
      }

      const r = await withTimeout(editItem(token, body), API_TIMEOUT_MS, `editItem ${p.ne_code}`);
      if (!r.ok) {
        rec.status = "ng";
        rec.error = r.message;
        results.push(rec);
        console.log(`${rule.manage} 送信NG: ${String(r.message).slice(0, 160)}`);
        continue;
      }
      if ((r.warnings ?? []).length) rec.warnings = r.warnings;

      // 読み戻し確認
      await sleep(800);
      const back = await withTimeout(getYahooItem(token, cfg.sellerId, p.ne_code), API_TIMEOUT_MS, `getItem ${p.ne_code}`);
      rec.after = {
        taxrateType: xmlTag(back.raw, "TaxrateType"),
        price: xmlTag(back.raw, "Price"),
        originalPrice: xmlTag(back.raw, "OriginalPrice"),
      };
      const okRate = rec.after.taxrateType === body.taxrate_type;
      const okPrice = rec.after.price === body.price;
      rec.status = okRate && okPrice ? "ok" : "ng";
      if (!okRate) rec.error = `税率区分が反映されていません（期待 ${body.taxrate_type} / 実際 ${rec.after.taxrateType}）`;
      else if (!okPrice) rec.error = `価格が反映されていません（期待 ${body.price} / 実際 ${rec.after.price}）`;
      results.push(rec);
      console.log(`${rule.manage} ${rec.status === "ok" ? "修正OK" : "検証NG"}: 税率 ${rec.before.taxrateType}→${rec.after.taxrateType} / 価格 ${rec.before.price}→${rec.after.price}`);
      await sleep(300);
      continue;
    }

    // ---- B) アプリDB側を直す（Yahoo の 10% が正の商品）----
    const row = (await admin.from("products").select("*").eq("id", t.row.id).single()).data;
    const current = dbRowToProductInput(row);
    const got = await withTimeout(getYahooItem(token, cfg.sellerId, p.ne_code), API_TIMEOUT_MS, `getItem ${p.ne_code}`);
    rec.before = {
      appTaxRate: current.tax_rate,
      mallTaxrateType: got.exists ? xmlTag(got.raw, "TaxrateType") : null,
      mallPrice: got.exists ? xmlTag(got.raw, "Price") : null,
    };
    rec.mallUnchanged = true; // 裁定どおり Yahoo 側は変更しない
    if (current.tax_rate === rule.correctRate) {
      rec.status = "ok";
      rec.reason = "アプリDBの税率は既に正しい値です（変更なし）";
      results.push(rec);
      console.log(`${rule.manage} 変更なし: アプリDB税率は既に ${rule.correctRate}%`);
      continue;
    }
    // 変更前の行を退避（既存 app-db-current-rows.jsonl とは別に、この修正専用の控えを残す）
    backup.push({ manage: rule.manage, productId: t.row.id, savedAt: nowIso(), row });

    if (DRY) {
      rec.status = "skip";
      rec.reason = `DRY-RUN（アプリDB税率 ${current.tax_rate}% → ${rule.correctRate}% を保存せず）`;
      results.push(rec);
      console.log(`${rule.manage} dry-run: アプリDB税率 ${current.tax_rate}% → ${rule.correctRate}%`);
      continue;
    }
    writeJson(BACKUP_FILE, backup); // 保存の直前に必ずバックアップを書き出す
    // service role クライアントにはログインセッションが無いため、所有者IDを明示して repository 経由で保存する
    // （履歴 recordHistory もこのIDで記録される）。
    const saved = await upsertProduct(admin, { ...current, tax_rate: rule.correctRate }, t.row.id, {
      authenticatedUserId: t.row.user_id,
    });
    const reread = dbRowToProductInput((await admin.from("products").select("*").eq("id", saved.id).single()).data);
    rec.after = { appTaxRate: reread.tax_rate };
    rec.status = reread.tax_rate === rule.correctRate ? "ok" : "ng";
    if (rec.status === "ng") rec.error = `アプリDBの税率が更新されていません（実際 ${reread.tax_rate}）`;
    // 影響の申し送り: 税抜価格は据え置きのため、10%換算の税込額と Yahoo 現在価格に差が出る
    const expectedInclusive = yahooTaxInclusive(reread.selling_price, rule.correctRate);
    rec.note =
      `アプリDBの税抜 ${reread.selling_price}円 × ${rule.correctRate}% = 税込 ${expectedInclusive}円。` +
      `Yahoo の現在価格は ${rec.before.mallPrice}円で ${expectedInclusive - Number(rec.before.mallPrice)}円の差があります（裁定により Yahoo 価格は変更していません）。` +
      `また楽天側は ${current.tax_rate}% のままです（楽天の修正は本作業のスコープ外）。`;
    results.push(rec);
    console.log(`${rule.manage} アプリDB税率 ${current.tax_rate}% → ${reread.tax_rate}%（Yahoo は変更せず）`);
  } catch (e) {
    rec.status = "ng";
    rec.error = String(e?.message ?? e);
    results.push(rec);
    console.log(`${rule.manage} 例外: ${String(e?.message ?? e).slice(0, 160)}`);
  }
}

if (!DRY && backup.length) writeJson(BACKUP_FILE, backup);
// 部分再実行でも全4件の結果が残るよう、前回結果に今回分を上書きマージする
const prev = readJson(RESULTS_FILE, null)?.results ?? [];
const merged = prev.filter((r) => !results.some((x) => x.manage === r.manage)).concat(results);
merged.sort((a, b) => RULING.findIndex((r) => r.manage === a.manage) - RULING.findIndex((r) => r.manage === b.manage));
results.length = 0;
results.push(...merged);
writeJson(RESULTS_FILE, {
  ranAt: nowIso(),
  reservePublish: "未実行（公開保留）",
  ruling: "r0101-1/r1101-1/r113-1=軽減8%が正（Yahooを修正） / r126-1=10%が正（アプリDBを修正・Yahooは変更しない）",
  rakutenScope: "楽天側の税率修正はスコープ外・要ユーザー対応",
  ok: results.filter((r) => r.status === "ok").length,
  ng: results.filter((r) => r.status === "ng").length,
  skip: results.filter((r) => r.status === "skip").length,
  results,
});
console.log(`\n税率修正 完了: OK ${results.filter((r) => r.status === "ok").length} / NG ${results.filter((r) => r.status === "ng").length} / SKIP ${results.filter((r) => r.status === "skip").length}`);
console.log(`→ ${RESULTS_FILE}`);
