// [4/4] しまのや 楽天→Yahoo 一括反映（2026-07-26）: 反映後の読み戻し検証（読み取り専用）。
// Yahoo getItem で実際の現在値を読み戻し、主要フィールドを2系統の期待値と突き合わせる。
//   sent  … 反映で実際に送った editItem パラメータ（sent-params.jsonl）＝「送った通りに入ったか」
//   db    … アプリDB（楽天取込後）の値から算出した期待値＝「楽天起点の値が正しく入ったか」
// 検証項目: 商品名 / 価格(税込) / 表示価格 / 商品説明(caption) / キャッチコピー / JAN /
//           Yahooカテゴリ / ストアカテゴリパス / 画像(item_image_urls) / 商品オプション / 在庫数 / 定期購入
// 実行: cd webui && npx tsx tests/shimanoya_yahoo_sync_verify.mjs
import path from "node:path";
import { getItem as getYahooItem } from "../lib/yahoo/item-client.ts";
import { dbRowToProductInput } from "../lib/product/repository.ts";
import { yahooTaxInclusive } from "../lib/converters/yahoo-tax.ts";
import { fitYahooFieldLimits } from "../lib/yahoo/item-mapper.ts";
import { displayPrice } from "../lib/product/schema.ts";
import {
  TARGETS, WORK_DIR, API_TIMEOUT_MS, CHUNK_SIZE,
  ensureWorkDir, loadEnv, withTimeout, getAdmin, yahooAuth, writeAuthBlocked,
  chunk, readJson, writeJson, readJsonl, xmlTag, xmlImageUrls, sleep, nowIso,
} from "./shimanoya_yahoo_sync_common.mjs";

loadEnv();
ensureWorkDir();

const admin = getAdmin();
const sync = readJson(path.join(WORK_DIR, "sync-results.json"));
if (!sync) {
  console.error("sync-results.json がありません。先に反映を実行してください: npx tsx tests/shimanoya_yahoo_sync_apply.mjs");
  process.exit(2);
}
const syncByManage = new Map(sync.results.map((r) => [r.manage, r]));
// 同一manageが複数回記録され得る（再実行）ため、最後に送った内容を採用する
const sentByManage = new Map();
for (const rec of readJsonl(path.join(WORK_DIR, "sent-params.jsonl"))) sentByManage.set(rec.manage, rec);

let cfg, token;
try {
  ({ cfg, token } = await yahooAuth());
} catch (e) {
  const msg = String(e?.message ?? e);
  writeAuthBlocked("verify", msg);
  console.error(`Yahoo認証に失敗しました。検証を中止します。\n  ${msg}`);
  process.exit(2);
}

/** Yahoo 側で必ず起きる正規化を吸収した比較用の正規化。
 *  - 前後の空白除去 / 連続空白の圧縮（Yahoo は末尾スペースを落とす）
 *  - 波ダッシュ U+301C 〜 → 全角チルダ U+FF5E ～（Yahoo が保存時に置換する。260726実測）
 *  これらは「送った内容が入っていない」ではないため不一致に数えない。 */
const normalize = (s) =>
  String(s ?? "")
    // 外部リンクは Yahoo が中継ページ(bouncer)へ自動書き換えする → 元URLへ戻して比較する
    .replace(/https:\/\/shopping\.yahoo\.co\.jp\/stores\/wrap\/bouncer\.html\?dest_path=([^"'\s>]+)/g, (_, u) => {
      try { return decodeURIComponent(u); } catch { return u; }
    })
    .replace(/〜/g, "～")
    .replace(/\s+/g, " ")
    .trim();

/** getItem XML の <Options> を editItem の options 書式（name#v1,v2|...）へ。sent と比較するため。 */
function optionsFromXml(xml) {
  const container = xml.match(/<Options>([\s\S]*?)<\/Options>/i);
  if (!container) return "";
  const attr = (s, name) => s.match(new RegExp(`${name}="([^"]*)"`, "i"))?.[1] ?? "";
  const parts = [];
  for (const m of container[1].matchAll(/<Option\b([^>]*)>([\s\S]*?)<\/Option>/gi)) {
    const name = attr(m[1], "name");
    const values = [...m[2].matchAll(/<Value\b([^>]*?)\/>/gi)].map((vm) => attr(vm[1], "name")).filter(Boolean);
    if (name && values.length) parts.push(`${name}#${values.join(",")}`);
  }
  return parts.join("|");
}

const results = [];
const chunks = chunk(TARGETS, CHUNK_SIZE);
let i = 0;
for (const [ci, group] of chunks.entries()) {
  for (const manage of group) {
    i++;
    const label = `[${i}/${TARGETS.length}] ${manage}`;
    const sr = syncByManage.get(manage);
    const entry = { manage, chunk: ci + 1, itemCode: sr?.itemCode ?? null, syncStatus: sr?.status ?? "unknown", checks: [], timestamp: nowIso() };
    if (!sr || sr.status !== "ok") {
      entry.verdict = "not-applied";
      entry.reason = sr?.reason ?? sr?.error ?? "反映されていません";
      results.push(entry);
      console.log(`${label} 検証対象外（${entry.reason ? String(entry.reason).slice(0, 70) : sr?.status}）`);
      continue;
    }
    try {
      const got = await withTimeout(getYahooItem(token, cfg.sellerId, sr.itemCode), API_TIMEOUT_MS, `getItem ${sr.itemCode}`);
      if (!got.exists) {
        entry.verdict = "ng";
        entry.reason = "読み戻しで商品が取得できません";
        results.push(entry);
        console.log(`${label} 読み戻しNG: 取得不可`);
        continue;
      }
      const xml = got.raw;
      const sent = sentByManage.get(manage)?.params ?? {};
      const row = sr.productId ? (await admin.from("products").select("*").eq("id", sr.productId).single()).data : null;
      const p = row ? dbRowToProductInput(row) : null;

      /** 1項目の検証を積む。expected が null/undefined の項目は「期待値なし」でスキップ扱い。 */
      const add = (field, source, expected, actual) => {
        if (expected === undefined || expected === null || expected === "") {
          entry.checks.push({ field, source, skipped: true, reason: "期待値なし（送信対象外）", actual: short(actual) });
          return;
        }
        const exact = String(expected) === String(actual);
        const loose = normalize(expected) === normalize(actual);
        entry.checks.push({
          field, source,
          // Yahoo 側の正規化（末尾スペース除去・波ダッシュ置換）だけの差は一致扱いにする
          match: exact || loose,
          normalizedOnly: !exact && loose,
          expected: short(expected), actual: short(actual),
        });
      };

      // --- 送信値 vs モール読み戻し ---
      add("商品名", "sent", sent.name, xmlTag(xml, "Name"));
      add("価格(税込)", "sent", sent.price, xmlTag(xml, "Price"));
      add("表示価格(税込)", "sent", sent.original_price, xmlTag(xml, "OriginalPrice"));
      add("キャッチコピー", "sent", sent.headline, xmlTag(xml, "Headline"));
      add("商品説明(caption)", "sent", sent.caption, xmlTag(xml, "Caption"));
      add("JAN", "sent", sent.jan, xmlTag(xml, "Jan"));
      add("Yahooカテゴリ", "sent", sent.product_category, xmlTag(xml, "ProductCategory"));
      add("ストアカテゴリパス", "sent", sent.path, (xml.match(/<Path[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/Path>/i) || [])[1]);
      add("画像(item_image_urls)", "sent", sent.item_image_urls, xmlImageUrls(xml).join(";"));
      add("商品オプション", "sent", sent.options, optionsFromXml(xml));
      add("定期購入タイプ", "sent", sent.subscription_type, xmlTag(xml, "SubscriptionType"));
      add("定期購入価格", "sent", sent.subscription_price, xmlTag(xml, "SubscriptionPrice"));

      // --- アプリDB（楽天取込後）から算出した期待値 vs モール読み戻し ---
      if (p) {
        add("価格(税込)", "db", String(yahooTaxInclusive(p.selling_price, p.tax_rate)), xmlTag(xml, "Price"));
        add("表示価格(税込)", "db", String(yahooTaxInclusive(displayPrice(p), p.tax_rate)), xmlTag(xml, "OriginalPrice"));
        add("JAN", "db", p.jan_code, xmlTag(xml, "Jan"));
        add("Yahooカテゴリ", "db", p.yahoo_category_id, xmlTag(xml, "ProductCategory"));
        // 税率区分（軽減8% / 標準10%）。アプリの反映は tax_rate を差分項目に持たないため
        // Yahoo 側の税率がずれていても自動補正されない。ずれは価格ずれに直結するので明示検証する。
        add("税率区分", "db", String(p.tax_rate / 100), xmlTag(xml, "TaxrateType"));
        // 商品名は Yahoo の使用不可文字の除去・文字数上限で整形される（fitYahooFieldLimits）。
        // 生の display_name ではなく「整形後の期待値」と突き合わせる（register/update と同一ロジック）。
        add("商品名(整形後)", "db", fitYahooFieldLimits({ name: p.display_name }).name, xmlTag(xml, "Name"));
      }

      // --- 在庫（editItem 対象外。setStock を送った場合のみ期待値がある） ---
      const quantity = xmlTag(xml, "Quantity");
      if (sr.stock?.sent && sr.stock?.ok) {
        add("在庫数", "sent", String(sr.stock.quantity), quantity);
      } else {
        entry.checks.push({
          field: "在庫数", source: "sent", skipped: true,
          reason: sr.stock?.reason ?? "setStock 未送信（Yahoo現在値を維持）",
          expected: sr.yahooQuantityBefore != null ? String(sr.yahooQuantityBefore) : null,
          actual: quantity,
          match: sr.yahooQuantityBefore != null ? String(sr.yahooQuantityBefore) === String(quantity) : undefined,
        });
      }

      const failed = entry.checks.filter((c) => !c.skipped && c.match === false);
      entry.verdict = failed.length === 0 ? "ok" : "ng";
      entry.mismatched = failed.map((c) => `${c.field}[${c.source}]`);
      results.push(entry);
      console.log(`${label} ${entry.verdict === "ok" ? "一致" : `不一致 ${failed.length}項目: ${entry.mismatched.join(", ")}`}`);
    } catch (e) {
      entry.verdict = "ng";
      entry.reason = String(e?.message ?? e);
      results.push(entry);
      console.log(`${label} 例外: ${String(e?.message ?? e).slice(0, 120)}`);
    }
    await sleep(180);
  }
  console.log(`--- チャンク ${ci + 1}/${chunks.length} 完了 ---`);
}

function short(v, n = 200) {
  const s = v === null || v === undefined ? "" : String(v);
  return s.length > n ? s.slice(0, n) + `…(全${s.length}字)` : s;
}

const ok = results.filter((r) => r.verdict === "ok").length;
const ng = results.filter((r) => r.verdict === "ng").length;
const na = results.filter((r) => r.verdict === "not-applied").length;
writeJson(path.join(WORK_DIR, "verify-results.json"), {
  ranAt: nowIso(),
  note: "sent=反映で送ったeditItemパラメータ / db=アプリDB(楽天取込後)から算出した期待値。両方をYahoo読み戻し値と突き合わせている。",
  total: TARGETS.length, ok, ng, notApplied: na,
  mismatches: results.filter((r) => r.verdict === "ng").map((r) => ({
    manage: r.manage, itemCode: r.itemCode, reason: r.reason,
    fields: r.checks.filter((c) => !c.skipped && c.match === false).map((c) => ({ field: c.field, source: c.source, expected: c.expected, actual: c.actual, whitespaceOnly: c.whitespaceOnly })),
  })),
  results,
});
console.log(`\n検証完了: 一致 ${ok} / 不一致 ${ng} / 反映対象外 ${na}（対象 ${TARGETS.length}件）`);
for (const r of results.filter((x) => x.verdict === "ng")) console.log(`  不一致 ${r.manage}: ${(r.mismatched ?? []).join(", ") || r.reason}`);
console.log(`→ ${path.join(WORK_DIR, "verify-results.json")}`);
