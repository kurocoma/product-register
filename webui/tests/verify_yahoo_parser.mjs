// parseYahooItem の実機検証: テスト商品(画像→editItem)→getItem(XML)→parse→期待値→後始末。
// 実行: npx tsx tests/verify_yahoo_parser.mjs
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { getYahooConfig, getYahooAccessToken } from "../lib/yahoo/auth.ts";
import { editItem, getItem, deleteItem } from "../lib/yahoo/item-client.ts";
import { uploadLibImage, deleteLibImage } from "../lib/yahoo/lib-image-client.ts";
import { parseYahooItem } from "../lib/converters/yahoo-item-parser.ts";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const l of env.split("\n")) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); }
const cfg = getYahooConfig(); const token = await getYahooAccessToken(cfg);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (l, c, d) => { if (!c) fail++; console.log(`${c ? "✅" : "❌"} ${l}${d ? "  " + d : ""}`); };

const NE = "zzz-yparse-9993";
const jpeg = await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 80, g: 160, b: 80 } } }).jpeg().toBuffer();
await uploadLibImage(token, cfg.sellerId, { fileName: `${NE}.jpg`, jpeg });
await sleep(1500);
const e = await editItem(token, { seller_id: cfg.sellerId, item_code: NE, path: "テスト", name: "Yahooパース検証", product_category: "13457", price: "1500", caption: "<p>キャプ確認</p>", headline: "見出し確認", jan: "4955028002542", display: "0", item_image_urls: `https://shopping.c.yimg.jp/lib/okimarumarket/${NE}.jpg` });
check("テスト商品 editItem", e.ok, e.ok ? "" : e.message);
await sleep(2000);

const g = await getItem(token, cfg.sellerId, NE);
check("getItem 取得", g.exists, "");
const p = parseYahooItem(g.raw);
check("ne_code = ItemCode", p.ne_code === NE, p.ne_code);
check("display_name = Name", p.display_name === "Yahooパース検証", p.display_name);
check("yahoo_category_id", p.yahoo_category_id === "13457", p.yahoo_category_id);
// 仕様変更(selling_price 全モール税抜統一): Yahoo の Price(税込1500) は税抜 1364 へ変換して取り込む。
check("selling_price(税込1500→税抜1364)", p.selling_price === 1364, String(p.selling_price));
check("catch_copy_yahoo = Headline", p.catch_copy_yahoo === "見出し確認", p.catch_copy_yahoo);
check("description_pc = Caption", p.description_pc === "<p>キャプ確認</p>", p.description_pc);
check("jan_code = Jan", p.jan_code === "4955028002542", p.jan_code);
check("yahoo_path = Path", p.yahoo_path === "テスト", p.yahoo_path);

await sleep(800);
await deleteItem(token, cfg.sellerId, NE);
await deleteLibImage(token, cfg.sellerId, `${NE}.jpg`);
check("後始末 (item+image削除)", true, "");

console.log(fail === 0 ? "\n🎉 parseYahooItem 実機検証パス（後始末完了）" : `\n⚠ ${fail}件失敗`);
process.exit(fail === 0 ? 0 : 1);
