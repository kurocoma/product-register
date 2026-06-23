// buildImportedProduct の純粋ユニットテスト（API不要）。
// 識別子導出・JAN13桁・実管理番号の往復(rakuten_manage_number)・使用可能文字検証を網羅する。
// 楽天は「実際の管理番号を保存してそのまま往復」する方式（maker-JAN下4桁以外の書式でも取込可）。
// 実行: npx tsx tests/verify_mall_import.mjs
import { buildImportedProduct } from "../lib/converters/mall-import.ts";
import { buildRakutenManageNumber } from "../lib/converters/rakuten-api.ts";
import { baseCodeOf } from "../lib/converters/rakuten.ts";

let fail = 0;
const check = (l, c, d) => { if (!c) fail++; console.log(`${c ? "✅" : "❌"} ${l}${d ? "  " + d : ""}`); };

// --- 楽天: 規約どおり(maker-JAN下4桁) → 実JAN採用・maker導出・実管理番号を保存 ---
{
  const r = buildImportedProduct("rakuten", "zzv-2542", {
    ne_code: "zzz-2542-1", display_name: "商品A", mall_category_id: "553575",
    selling_price: 1980, jan_code: "4955028002542", shipping_type: "送料無料",
  });
  check("楽天/規約: ok", r.ok, !r.ok ? r.error : "");
  if (r.ok) {
    const p = r.product;
    check("楽天/規約: maker導出(NEコードから)", p.maker_code === "zzz", p.maker_code);
    check("楽天/規約: 実JAN採用", p.jan_code === "4955028002542", p.jan_code);
    check("楽天/規約: ne_code=variant", p.ne_code === "zzz-2542-1", p.ne_code);
    check("楽天/規約: 実管理番号を保存", p.rakuten_manage_number === "zzv-2542", p.rakuten_manage_number);
    check("楽天/規約: manageNumberは保存値で往復", buildRakutenManageNumber(p) === "zzv-2542", buildRakutenManageNumber(p));
    check("楽天/規約: 価格反映", p.selling_price === 1980, String(p.selling_price));
    check("楽天/規約: 表示名反映", p.display_name === "商品A", p.display_name);
    check("楽天/規約: 送料反映", p.shipping_type === "送料無料", p.shipping_type);
  }
}

// --- 楽天: 非規約な管理番号(maker-JAN下4桁以外)でも取込可・実管理番号で往復 ---
{
  // 管理番号は自由書式 "zzv-imp-legacy"。NEコード(variant)は規約どおり → maker は NEコードから導出。
  const r = buildImportedProduct("rakuten", "zzv-imp-legacy", {
    ne_code: "zzz-2542-9", display_name: "レガシー商品", selling_price: 3000, jan_code: "4955028002542",
  });
  check("楽天/非規約管理番号: ok(取込可)", r.ok, !r.ok ? r.error : "");
  if (r.ok) {
    const p = r.product;
    check("楽天/非規約: 実管理番号を保存", p.rakuten_manage_number === "zzv-imp-legacy", p.rakuten_manage_number);
    check("楽天/非規約: manageNumberが管理番号を往復", buildRakutenManageNumber(p) === "zzv-imp-legacy", buildRakutenManageNumber(p));
    check("楽天/非規約: maker=NEコードから導出(zzz)", p.maker_code === "zzz", p.maker_code);
    check("楽天/非規約: 実JAN採用", p.jan_code === "4955028002542", p.jan_code);
    check("楽天/非規約: ne_code=variant", p.ne_code === "zzz-2542-9", p.ne_code);
    // baseCodeOf(=zzz-2542) と管理番号(zzv-imp-legacy)が違っても、往復は保存値で行うので問題ない
    check("楽天/非規約: baseCodeとは独立に往復", baseCodeOf(p) !== buildRakutenManageNumber(p), `${baseCodeOf(p)} vs ${buildRakutenManageNumber(p)}`);
  }
}

// --- 楽天: ハイフンを含まない管理番号でも取込可 ---
{
  const r = buildImportedProduct("rakuten", "legacycode99", { display_name: "X", selling_price: 100 });
  check("楽天/ハイフンなし管理番号: ok", r.ok, !r.ok ? r.error : "");
  if (r.ok) {
    const p = r.product;
    check("楽天/ハイフンなし: 実管理番号を保存", p.rakuten_manage_number === "legacycode99", p.rakuten_manage_number);
    check("楽天/ハイフンなし: manageNumber往復", buildRakutenManageNumber(p) === "legacycode99", buildRakutenManageNumber(p));
    check("楽天/ハイフンなし: JAN=13桁ゼロ", p.jan_code === "0000000000000", p.jan_code);
    check("楽天/ハイフンなし: ne_code=code(variant欠落)", p.ne_code === "legacycode99", p.ne_code);
  }
}

// --- 楽天: JANなし・管理番号末尾4桁あり → その4桁でダミーJAN13桁 ---
{
  const r = buildImportedProduct("rakuten", "abc-7777", { ne_code: "abc-7777-1", display_name: "商品B", selling_price: 500 });
  check("楽天/JANなし: ok", r.ok, !r.ok ? r.error : "");
  if (r.ok) {
    const p = r.product;
    check("楽天/JANなし: ダミーJAN13桁(末尾4桁)", /^\d{13}$/.test(p.jan_code) && p.jan_code === "0000000007777", p.jan_code);
    check("楽天/JANなし: 実管理番号で往復", buildRakutenManageNumber(p) === "abc-7777", buildRakutenManageNumber(p));
  }
}

// --- 楽天: JAN末尾が管理番号と不一致でも、実JANを保持し往復は保存値で行う ---
{
  const r = buildImportedProduct("rakuten", "zzv-2542", { ne_code: "zzz-9999-1", display_name: "Z", jan_code: "4955028009999" });
  check("楽天/JAN末尾不一致: ok", r.ok, !r.ok ? r.error : "");
  if (r.ok) {
    const p = r.product;
    check("楽天/JAN末尾不一致: 実JANを保持(ダミー化しない)", p.jan_code === "4955028009999", p.jan_code);
    check("楽天/JAN末尾不一致: maker=NEコードから(zzz)", p.maker_code === "zzz", p.maker_code);
    check("楽天/JAN末尾不一致: 管理番号で往復", buildRakutenManageNumber(p) === "zzv-2542", buildRakutenManageNumber(p));
  }
}

// --- 楽天: 使用不可文字(日本語/空白/スラッシュ)を含む管理番号は拒否（楽天で使えない） ---
{
  const bad = ["商品-2542", "a b-2542", "a/b-2542", "a.b-2542"];
  for (const code of bad) {
    const r = buildImportedProduct("rakuten", code, { jan_code: "4955028002542" });
    check(`楽天/使用不可文字 "${code}": 拒否`, !r.ok, r.ok ? "通ってしまった" : "");
  }
}

// --- 楽天: 32文字超の管理番号は拒否（楽天の上限） ---
{
  const longCode = "a".repeat(33);
  const r = buildImportedProduct("rakuten", longCode, {});
  check("楽天/33文字: 拒否", !r.ok, r.ok ? "通ってしまった" : "");
}

// --- 楽天: JAN に前後空白があっても trim して実JANを採用 ---
{
  const r = buildImportedProduct("rakuten", "zzv-2542", { ne_code: "zzz-2542-1", display_name: "W", jan_code: "  4955028002542  " });
  check("楽天/JAN前後空白: ok", r.ok, !r.ok ? r.error : "");
  if (r.ok) check("楽天/JAN前後空白: trim後の実JAN採用", r.product.jan_code === "4955028002542", r.product.jan_code);
}

// --- Yahoo: JANあり（書式制約なし。rakuten_manage_numberは空） ---
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
    check("Yahoo/JANあり: rakuten_manage_number空", p.rakuten_manage_number === "", `[${p.rakuten_manage_number}]`);
    check("Yahoo/JANあり: delivery_method=1", p.delivery_method === 1, String(p.delivery_method));
  }
}

// --- Yahoo: 日本語等を含むコードでも可（Yahoo itemCode に楽天のような文字制約はない） ---
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

// --- 楽天: 取込した実画像URL(image_url_N)と枚数(image_count)を保持する ---
{
  const r = buildImportedProduct("rakuten", "zzv-2542", {
    ne_code: "zzz-2542-1", jan_code: "4955028002542", display_name: "IMG",
    image_count: 3,
    image_url_1: "https://image.rakuten.co.jp/ichiban-okinawa/cabinet/thum01/zzz-2542-1.jpg",
    image_url_2: "https://image.rakuten.co.jp/ichiban-okinawa/cabinet/08038533/4955028002542_2.jpg",
    image_url_3: "https://image.rakuten.co.jp/ichiban-okinawa/cabinet/08038533/4955028002542_3.jpg",
  });
  check("楽天/画像: ok", r.ok, !r.ok ? r.error : "");
  if (r.ok) {
    const p = r.product;
    check("楽天/画像: image_count反映", p.image_count === 3, String(p.image_count));
    check("楽天/画像: image_url_1(実URL・規約外thum01)保持", p.image_url_1.endsWith("/thum01/zzz-2542-1.jpg"), p.image_url_1);
    check("楽天/画像: image_url_2(JAN名)保持", p.image_url_2.endsWith("/4955028002542_2.jpg"), p.image_url_2);
  }
}

// --- 楽天: 識別子3種が全部別物(ppork5型)でも正しく分離保持する ---
{
  // 管理番号=ppork5, variantキー=ppork5, NEコード(merchantDefinedSkuId)=m043-3425-1 を想定。
  // parseRakutenItem が ne_code=merchantDefinedSkuId, rakuten_variant_id=variantキー を渡す。
  const r = buildImportedProduct("rakuten", "ppork5", {
    ne_code: "m043-3425-1", rakuten_variant_id: "ppork5",
    jan_code: "5707196114669", display_name: "ポーク", selling_price: 429,
  });
  check("楽天/識別子分離: ok", r.ok, !r.ok ? r.error : "");
  if (r.ok) {
    const p = r.product;
    check("楽天/識別子分離: ne_code=merchantDefinedSkuId", p.ne_code === "m043-3425-1", p.ne_code);
    check("楽天/識別子分離: rakuten_variant_id=variantキー", p.rakuten_variant_id === "ppork5", p.rakuten_variant_id);
    check("楽天/識別子分離: rakuten_manage_number=管理番号", p.rakuten_manage_number === "ppork5", p.rakuten_manage_number);
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
    buildImportedProduct("rakuten", "legacycode", {}),
    buildImportedProduct("yahoo", "yz", {}),
  ];
  const allJan13 = codes.every((r) => r.ok && /^\d{13}$/.test(r.product.jan_code));
  check("共通: 生成商品の jan_code は常に13桁", allJan13, "");
}

console.log(fail === 0 ? "\n🎉 buildImportedProduct ユニット 全パス" : `\n⚠ ${fail}件失敗`);
process.exit(fail === 0 ? 0 : 1);
