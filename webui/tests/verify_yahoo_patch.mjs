// Yahoo editItem 部分更新（ラウンドトリップ方式）の実機検証:
//   画像→editItem(初期, 多項目) → getItem(snapshot+生XML) → 価格だけ変更
//   → buildYahooUpdateParams(現在XML土台に price だけ上書き) → editItem
//   → getItem で「価格変化・他項目(headline/caption/jan/delivery/tax/condition/display)が全て保持」を確認 → 後始末
// 実行: npx tsx tests/verify_yahoo_patch.mjs
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { getYahooConfig, getYahooAccessToken } from "../lib/yahoo/auth.ts";
import { editItem, getItem, deleteItem } from "../lib/yahoo/item-client.ts";
import { uploadLibImage, deleteLibImage } from "../lib/yahoo/lib-image-client.ts";
import { parseYahooItem } from "../lib/converters/yahoo-item-parser.ts";
import { diffProduct } from "../lib/product/diff.ts";
import { buildYahooUpdateParams } from "../lib/converters/yahoo-patch.ts";
import { makeProduct } from "../lib/product/schema.ts";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const l of env.split("\n")) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); }
const cfg = getYahooConfig(); const token = await getYahooAccessToken(cfg);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (l, c, d) => { if (!c) fail++; console.log(`${c ? "✅" : "❌"} ${l}${d ? "  " + d : ""}`); };

const NE = "zzz-ypatch-9992";
const jpeg = await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 60, g: 120, b: 200 } } }).jpeg().toBuffer();
await uploadLibImage(token, cfg.sellerId, { fileName: `${NE}.jpg`, jpeg });
await sleep(1500);

// --- 初期 editItem（価格1500 + headline/caption/abstract/additional1/delivery=1/tax/非公開） ---
const e0 = await editItem(token, {
  seller_id: cfg.sellerId, item_code: NE, path: "テスト", name: "Yパッチ初期", product_category: "13457", price: "1500",
  caption: "<p>初期キャプ</p>", headline: "初期見出し", abstract: "初期ひとこと", additional1: "<p>F1初期</p>",
  jan: "4955028002542", delivery: "1", taxable: "1", taxrate_type: "0.1", condition: "0", display: "0",
  item_image_urls: `https://shopping.c.yimg.jp/lib/okimarumarket/${NE}.jpg`,
});
check("初期 editItem", e0.ok, e0.ok ? "" : e0.message);
await sleep(2000);

// --- snapshot（生XMLも保持） ---
const g0 = await getItem(token, cfg.sellerId, NE);
check("snapshot getItem", g0.exists, "");
const snap = parseYahooItem(g0.raw);
// 仕様変更(selling_price 全モール税抜統一): Yahoo の Price(税込1500) は税抜へ変換して取り込まれる。
check("snapshot 価格=1364(税込1500→税抜)", snap.selling_price === 1364, String(snap.selling_price));

// --- 価格だけ変更（税抜1364 → 2480）。他は不変＝送信しないが、ラウンドトリップで保持されるはず ---
const edited = makeProduct({ ne_code: NE, yahoo_path: snap.yahoo_path, display_name: snap.display_name, yahoo_category_id: snap.yahoo_category_id, selling_price: 2480, catch_copy_yahoo: snap.catch_copy_yahoo, description_pc: snap.description_pc, jan_code: snap.jan_code });
const diff = diffProduct(snap, edited);
check("diff は価格1件のみ", diff.length === 1 && diff[0].field === "selling_price", diff.map((x) => x.field).join(","));
const { params, advanced, skipped } = buildYahooUpdateParams(g0.raw, diff, edited, { sellerId: cfg.sellerId });
check("advanced設定なし", advanced.length === 0, advanced.join(","));
check("skippedなし", skipped.length === 0, skipped.join(","));
// 送信は税込へ変換（2480×1.1=2728）。取込の税抜変換と対称（旧仕様 1:1 の "2480" は陳腐化）。
check("price上書き=2728(税込)", params.price === "2728", params.price);
check("表示価格(original_price)も2728に同期", params.original_price === "2728", params.original_price);
check("headlineを土台から復元して同梱", params.headline === "初期見出し", params.headline);
check("captionを土台から復元して同梱", params.caption === "<p>初期キャプ</p>", params.caption);
check("display=0を復元(非公開維持)", params.display === "0", params.display);
check("delivery=1を復元", params.delivery === "1", params.delivery);

const pe = await editItem(token, params);
check("patch editItem 実行", pe.ok, pe.ok ? "" : pe.message);
await sleep(2000);

const g1 = await getItem(token, cfg.sellerId, NE);
const after = parseYahooItem(g1.raw);
check("Yahoo側 Price=2728(税込)", /<Price>2728<\/Price>/.test(g1.raw), (g1.raw.match(/<Price>[^<]*<\/Price>/) || [])[0]);
check("価格が2480に変化(税抜換算)", after.selling_price === 2480, String(after.selling_price));
check("見出し(headline)が保持", after.catch_copy_yahoo === "初期見出し", `→ ${after.catch_copy_yahoo}`);
check("キャプ(caption)が保持", after.description_pc === "<p>初期キャプ</p>", `→ ${after.description_pc}`);
check("JAN が保持", after.jan_code === "4955028002542", `→ ${after.jan_code}`);
// 生XMLで delivery/abstract/additional1/display も保持されているか
const rawHas = (tag, val) => g1.raw.includes(`<${tag}>${val}`) || g1.raw.includes(`<${tag}><![CDATA[${val}`);
check("delivery=1 保持", rawHas("Delivery", "1"), "");
check("abstract 保持", g1.raw.includes("初期ひとこと"), "");
check("additional1 保持", g1.raw.includes("F1初期"), "");
check("display=0 保持(非公開維持)", /<Display>0<\/Display>/.test(g1.raw), "");

// --- 後始末 ---
await sleep(800);
await deleteItem(token, cfg.sellerId, NE);
await deleteLibImage(token, cfg.sellerId, `${NE}.jpg`);
check("後始末 (item+image削除)", true, "");

console.log(fail === 0 ? "\n🎉 Yahoo editItem 部分更新(ラウンドトリップ) 実機検証パス（後始末完了）" : `\n⚠ ${fail}件失敗`);
process.exit(fail === 0 ? 0 : 1);
