// Yahoo lib モジュールの実機検証: 認証→命名→uploadLibImage→公開URL確認→deleteLibImage(後始末)。
// 実行: npx tsx tests/verify_yahoo_lib.mjs
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { getYahooConfig, getYahooAccessToken } from "../lib/yahoo/auth.ts";
import { uploadLibImage, deleteLibImage } from "../lib/yahoo/lib-image-client.ts";
import { buildYahooLibFileName, validateYahooFileName } from "../lib/yahoo/lib-path.ts";
import { makeProduct } from "../lib/product/schema.ts";

// .env.local を process.env へ流し込む（モジュールが process.env を読むため）
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (l, c, d) => { if (!c) fail++; console.log(`${c ? "✅" : "❌"} ${l}${d ? "  " + d : ""}`); };

// 命名(純粋)検証
const p = makeProduct({ ne_code: "t002-2542-1" });
check("1枚目 = {ne_code}.jpg", buildYahooLibFileName(p, 1).fileName === "t002-2542-1.jpg", buildYahooLibFileName(p, 1).fileName);
check("2枚目 = {ne_code}_2.jpg", buildYahooLibFileName(p, 2).fileName === "t002-2542-1_2.jpg", buildYahooLibFileName(p, 2).fileName);
check("publicUrl が lib/okimarumarket", buildYahooLibFileName(p, 1).publicUrl === "https://shopping.c.yimg.jp/lib/okimarumarket/t002-2542-1.jpg", buildYahooLibFileName(p, 1).publicUrl);
check("validate 正常", validateYahooFileName("t002-2542-1.jpg").ok === true);
check("validate 全角NG", validateYahooFileName("あ.jpg").ok === false);

// 認証→アップロード往復
const cfg = getYahooConfig();
check("getYahooConfig 取得", !!cfg, cfg ? `seller=${cfg.sellerId}` : "env不足");
if (cfg) {
  const token = await getYahooAccessToken(cfg);
  check("アクセストークン取得", !!token, `len=${token.length}`);

  const TEST = "zzz-yahoo-mod-test.jpg";
  const jpeg = await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 200, g: 120, b: 40 } } }).jpeg().toBuffer();

  const up = await uploadLibImage(token, cfg.sellerId, { fileName: TEST, jpeg });
  check("uploadLibImage OK", up.ok, up.ok ? "" : up.message);

  await sleep(2500);
  const head = await fetch(`https://shopping.c.yimg.jp/lib/okimarumarket/${TEST}`, { method: "HEAD" });
  check("公開URLに反映(HEAD 200)", head.status === 200, `HEAD ${head.status}`);

  await sleep(1500);
  const del = await deleteLibImage(token, cfg.sellerId, TEST);
  check("deleteLibImage 後始末", del.ok, del.message);
}

console.log(fail === 0 ? "\n🎉 Yahoo lib モジュール 全検証パス（後始末完了）" : `\n⚠ ${fail}件失敗`);
process.exit(fail === 0 ? 0 : 1);
