// buildImportedProduct の純粋ユニットテスト（API不要）。
// 識別子復元・JAN13桁・baseCode再現性（楽天往復の冪等キー）を網羅検証する。
// 実行: npx tsx tests/verify_mall_import.mjs
import { buildImportedProduct } from "../lib/converters/mall-import.ts";
import { buildRakutenManageNumber } from "../lib/converters/rakuten-api.ts";
import { baseCodeOf } from "../lib/converters/rakuten.ts";

let fail = 0;
const check = (l, c, d) => { if (!c) fail++; console.log(`${c ? "✅" : "❌"} ${l}${d ? "  " + d : ""}`); };

// --- 楽天: 13桁JANが管理番号末尾と一致 → maker逆算・実JAN採用 ---
{
  const r = buildImportedProduct("rakuten", "zzv-2542", {
    ne_code: "sku-1", display_name: "商品A", mall_category_id: "553575",
    selling_price: 1980, jan_code: "4955028002542", shipping_type: "送料無料",
  });
  check("楽天/JANあり: ok", r.ok, !r.ok ? r.error : "");
  if (r.ok) {
    const p = r.product;
    check("楽天/JANあり: maker逆算", p.maker_code === "zzv", p.maker_code);
    check("楽天/JANあり: 実JAN採用", p.jan_code === "4955028002542", p.jan_code);
    check("楽天/JANあり: ne_code=variant", p.ne_code === "sku-1", p.ne_code);
    check("楽天/JANあり: baseCode再現", baseCodeOf(p) === "zzv-2542", baseCodeOf(p));
    check("楽天/JANあり: manageNumber再現", buildRakutenManageNumber(p) === "zzv-2542", buildRakutenManageNumber(p));
    check("楽天/JANあり: 価格反映", p.selling_price === 1980, String(p.selling_price));
    check("楽天/JANあり: 表示名反映", p.display_name === "商品A", p.display_name);
    check("楽天/JANあり: 送料反映", p.shipping_type === "送料無料", p.shipping_type);
  }
}

// --- 楽天: JANなし → ダミー13桁JAN・maker は正規表現で抽出 ---
{
  const r = buildImportedProduct("rakuten", "abc-7777", { ne_code: "sku-2", display_name: "商品B", selling_price: 500 });
  check("楽天/JANなし: ok", r.ok, !r.ok ? r.error : "");
  if (r.ok) {
    const p = r.product;
    check("楽天/JANなし: maker抽出", p.maker_code === "abc", p.maker_code);
    check("楽天/JANなし: ダミーJAN13桁", /^\d{13}$/.test(p.jan_code) && p.jan_code === "0000000007777", p.jan_code);
    check("楽天/JANなし: baseCode再現", baseCodeOf(p) === "abc-7777", baseCodeOf(p));
    check("楽天/JANなし: manageNumber再現", buildRakutenManageNumber(p) === "abc-7777", buildRakutenManageNumber(p));
  }
}

// --- 楽天: 内部にハイフンを含む maker でも再現する ---
{
  const r = buildImportedProduct("rakuten", "a-b-c-2542", { display_name: "X", jan_code: "4955028002542" });
  check("楽天/多段ハイフン: ok", r.ok, !r.ok ? r.error : "");
  if (r.ok) {
    const p = r.product;
    check("楽天/多段ハイフン: maker=a-b-c", p.maker_code === "a-b-c", p.maker_code);
    check("楽天/多段ハイフン: baseCode再現", baseCodeOf(p) === "a-b-c-2542", baseCodeOf(p));
    check("楽天/多段ハイフン: ne_code=code(variant欠落時)", p.ne_code === "a-b-c-2542", p.ne_code);
  }
}

// --- 楽天: 形式不一致 → 拒否 ---
{
  const r1 = buildImportedProduct("rakuten", "noformat", {});
  check("楽天/形式不一致(ハイフンなし): 拒否", !r1.ok, r1.ok ? "通ってしまった" : "");
  const r2 = buildImportedProduct("rakuten", "abc-12", {});
  check("楽天/形式不一致(下4桁でない): 拒否", !r2.ok, r2.ok ? "通ってしまった" : "");
}

// --- 楽天: JAN末尾が管理番号と不一致 → ダミーJANで baseCode を優先再現 ---
{
  // 管理番号 zzv-2542 だが mallJAN 末尾は 9999 → 末尾優先(baseCode再現)のためダミー化
  const r = buildImportedProduct("rakuten", "zzv-2542", { display_name: "Z", jan_code: "4955028009999" });
  check("楽天/JAN末尾不一致: ok", r.ok, !r.ok ? r.error : "");
  if (r.ok) {
    const p = r.product;
    check("楽天/JAN末尾不一致: baseCode再現を優先", baseCodeOf(p) === "zzv-2542", baseCodeOf(p));
    check("楽天/JAN末尾不一致: ダミーJAN13桁", /^\d{13}$/.test(p.jan_code) && p.jan_code === "0000000002542", p.jan_code);
  }
}

// --- Yahoo: JANあり ---
{
  const r = buildImportedProduct("yahoo", "yc-1", {
    ne_code: "yc-1", display_name: "Y", yahoo_category_id: "13457", selling_price: 1280, jan_code: "4955028002542",
  });
  check("Yahoo/JANあり: ok", r.ok, !r.ok ? r.error : "");
  if (r.ok) {
    const p = r.product;
    check("Yahoo/JANあり: ne_code=code", p.ne_code === "yc-1", p.ne_code);
    check("Yahoo/JANあり: maker空", p.maker_code === "", `[${p.maker_code}]`);
    check("Yahoo/JANあり: 実JAN採用", p.jan_code === "4955028002542", p.jan_code);
    check("Yahoo/JANあり: カテゴリ反映", p.yahoo_category_id === "13457", p.yahoo_category_id);
    check("Yahoo/JANあり: delivery_method=1", p.delivery_method === 1, String(p.delivery_method));
  }
}

// --- Yahoo: JANなし → 13桁ゼロ ---
{
  const r = buildImportedProduct("yahoo", "yc-2", { ne_code: "yc-2", display_name: "Y2" });
  check("Yahoo/JANなし: ok", r.ok, !r.ok ? r.error : "");
  if (r.ok) {
    const p = r.product;
    check("Yahoo/JANなし: JAN=13桁ゼロ", p.jan_code === "0000000000000", p.jan_code);
    check("Yahoo/JANなし: 価格デフォルト0", p.selling_price === 0, String(p.selling_price));
    check("Yahoo/JANなし: 名称=code(表示名欠落時はcode)", p.display_name === "Y2", p.display_name);
  }
}

// --- 楽天: 使用不可文字(日本語/空白/スラッシュ)を含む code は拒否（baseCode が楽天規約に反するため） ---
{
  const bad = ["商品-2542", "a b-2542", "a/b-2542"];
  for (const code of bad) {
    const r = buildImportedProduct("rakuten", code, { jan_code: "4955028002542" });
    check(`楽天/使用不可文字 "${code}": 拒否`, !r.ok, r.ok ? "通ってしまった" : "");
  }
}

// --- 楽天: メーカーコード空(先頭ハイフン)は JAN有無に関わらず拒否（分岐の非対称を解消） ---
{
  const r1 = buildImportedProduct("rakuten", "-2542", { jan_code: "4955028002542" });
  check("楽天/空メーカー(JANあり): 拒否", !r1.ok, r1.ok ? "通ってしまった" : "");
  const r2 = buildImportedProduct("rakuten", "-2542", {});
  check("楽天/空メーカー(JANなし): 拒否", !r2.ok, r2.ok ? "通ってしまった" : "");
}

// --- 楽天: JAN に前後空白があっても trim して実JANを採用（ダミー化しない） ---
{
  const r = buildImportedProduct("rakuten", "zzv-2542", { display_name: "W", jan_code: "  4955028002542  " });
  check("楽天/JAN前後空白: ok", r.ok, !r.ok ? r.error : "");
  if (r.ok) {
    check("楽天/JAN前後空白: trim後の実JAN採用", r.product.jan_code === "4955028002542", r.product.jan_code);
    check("楽天/JAN前後空白: baseCode再現", baseCodeOf(r.product) === "zzv-2542", baseCodeOf(r.product));
  }
}

// --- 共通: 小数価格は整数へ丸めて取込継続（422で全体を落とさない） ---
{
  const r1 = buildImportedProduct("rakuten", "abc-1234", { display_name: "P", selling_price: 1980.5 });
  check("楽天/小数価格: ok(落とさない)", r1.ok, !r1.ok ? r1.error : "");
  if (r1.ok) check("楽天/小数価格: 整数へ丸め", r1.product.selling_price === 1981, String(r1.product.selling_price));
  const r2 = buildImportedProduct("yahoo", "yc-x", { display_name: "P", selling_price: 1408.0 });
  check("Yahoo/小数なし: ok", r2.ok && r2.product.selling_price === 1408, r2.ok ? String(r2.product.selling_price) : r2.error);
}

// --- 共通: 全ケースで jan_code は必ず13桁（dbRowToProductInput 再parse が落ちない不変条件） ---
{
  const codes = [
    buildImportedProduct("rakuten", "m-0001", { jan_code: "4900000000001" }),
    buildImportedProduct("rakuten", "m-0002", {}),
    buildImportedProduct("yahoo", "yz", {}),
  ];
  const allJan13 = codes.every((r) => r.ok && /^\d{13}$/.test(r.product.jan_code));
  check("共通: 生成商品の jan_code は常に13桁", allJan13, "");
}

console.log(fail === 0 ? "\n🎉 buildImportedProduct ユニット 全パス" : `\n⚠ ${fail}件失敗`);
process.exit(fail === 0 ? 0 : 1);
