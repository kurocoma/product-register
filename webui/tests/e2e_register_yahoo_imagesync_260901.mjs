// 260901修正依頼-2 実機E2E: 「Yahooへ登録」の画像自動転送（it-14091 自動解消）検証。
//
// 再現シナリオ: 楽天から取込んだ商品（image_url_N = 楽天CDNの実URL・Yahoo lib 未転送）を
// commitYahooRegister すると、修正前は it-14091 で登録全体が失敗していた。
// 修正後は editItem の前に lib へ自動転送し、成功 index のみで item_image_urls を再構築する。
//
// 安全規約: item_code は zzz 系 / display=0（非公開）/ reservePublish は呼ばない /
// 後始末で deleteItem + deleteLibImage。
// 実行: cd webui && npx tsx tests/e2e_register_yahoo_imagesync_260901.mjs
import { makeProduct } from "../lib/product/schema.ts";
import { getYahooAccessToken } from "../lib/yahoo/auth.ts";
import { getItem, editItem, setStock, reservePublish, deleteItem } from "../lib/yahoo/item-client.ts";
import { deleteLibImage } from "../lib/yahoo/lib-image-client.ts";
import { commitYahooRegister } from "../lib/register/yahoo-register-service.ts";
import { syncYahooLibImages } from "../lib/register/yahoo-image-sync.ts";
import { buildYahooItemImageUrls } from "../lib/converters/image-url.ts";
import { loadEnv, yahooAuth, sleep } from "./shimanoya_yahoo_sync_common.mjs";

loadEnv();
const CODE = "zzz-2542";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const { cfg, token } = await yahooAuth();

// 楽天取込商品を再現: image_url_N は楽天CDNの実URL（Yahoo lib には存在しない）
const product = makeProduct({
  ne_code: CODE,
  jan_code: "4955028002542",
  display_name: "zzzテスト 画像自動転送検証（削除予定）",
  image_count: 2,
  image_url_1: "https://image.rakuten.co.jp/ichiban-okinawa/cabinet/newima/shohin03/4953693442304.jpg",
  image_url_2: "https://image.rakuten.co.jp/ichiban-okinawa/cabinet/kumiso/2010-0917-002.jpg",
});

// 前回残骸の掃除（存在しなくてもOK）
await deleteItem(token, cfg.sellerId, CODE).catch(() => {});
await sleep(1000);

// upsertProduct だけ no-op に差し替え（DBを汚さない）。他は実物 = 修正コードの実経路を通す。
const deps = {
  getAccessToken: getYahooAccessToken,
  getItem,
  editItem,
  setStock,
  reservePublish,
  upsertProduct: async () => ({}),
  syncImages: syncYahooLibImages,
  buildImageUrls: buildYahooItemImageUrls,
};

const r = await commitYahooRegister({}, cfg, product, "e2e-dummy", { forceDisplay: "0" }, deps);
check("commitYahooRegister 成功（it-14091 が出ない）", r.ok === true, JSON.stringify(r).slice(0, 300));

if (r.ok) {
  await sleep(2000);
  const got = await getItem(token, cfg.sellerId, CODE);
  check("getItem: 登録された", got.exists, "");
  const display = got.raw.match(/<Display>(\d)<\/Display>/)?.[1];
  check("display=0（非公開のまま）", display === "0", `Display=${display}`);
  const imgRefs = [...got.raw.matchAll(/<(?:Image|LibImage\d+)><!\[CDATA\[([^\]]*)\]\]>/g)].map((m) => m[1]);
  const flat = imgRefs.join(";") || got.raw.match(/zzz-2542[^<;"]*\.jpg/g)?.join(";") || "";
  check(
    "画像参照が lib の zzz-2542 系ファイルを指す",
    /zzz-2542(_2)?\.jpg/.test(got.raw),
    flat.slice(0, 200) || "(生XMLに zzz-2542*.jpg 参照が見つからない)",
  );
}

// 後始末: 商品削除 + lib 画像削除
const del = await deleteItem(token, cfg.sellerId, CODE);
check("後始末: deleteItem", del.ok, del.message);
const delImg1 = await deleteLibImage(token, cfg.sellerId, "zzz-2542.jpg");
const delImg2 = await deleteLibImage(token, cfg.sellerId, "zzz-2542_2.jpg");
check("後始末: deleteLibImage ×2", delImg1.ok && delImg2.ok, `${delImg1.message} / ${delImg2.message}`);

const failed = results.filter((x) => !x.ok);
console.log(`\n結果: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
