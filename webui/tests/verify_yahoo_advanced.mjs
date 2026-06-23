// detectAdvanced 経由（buildYahooUpdateParams.advanced）の検出精度を検証する（オフライン）。
// 空の入れ子は検出しない / 実体ある reserve・spec・variation・options は検出する。
// 実行: npx tsx tests/verify_yahoo_advanced.mjs
import { buildYahooUpdateParams } from "../lib/converters/yahoo-patch.ts";
import { makeProduct } from "../lib/product/schema.ts";

let fail = 0;
const check = (l, c, d) => { if (!c) fail++; console.log(`${c ? "✅" : "❌"} ${l}${d ? "  " + d : ""}`); };
const p = makeProduct({ ne_code: "x", display_name: "A", yahoo_path: "P", yahoo_category_id: "1", selling_price: 100 });
const adv = (xml) => buildYahooUpdateParams(xml, [], p, { sellerId: "s" }).advanced;

const base = (extra) => `<Result><ItemCode>x</ItemCode><Name><![CDATA[A]]></Name><ProductCategory>1</ProductCategory><Price>100</Price>${extra}</Result>`;

// 空の予約（probe実機と同形）→ 検出しない
const emptyReserve = `<ReservePrices><ReservePrice><ReservePrice></ReservePrice><ReserveSalePrice></ReserveSalePrice><ReserveMemberPrice></ReserveMemberPrice><ReserveSellingPeriodStart></ReserveSellingPeriodStart><ReserveSellingPeriodEnd></ReserveSellingPeriodEnd></ReservePrice></ReservePrices>`;
check("空Reserveは非検出", !adv(base(emptyReserve)).includes("reserve"), JSON.stringify(adv(base(emptyReserve))));

// 特価のみの予約（通常価格は空）→ 旧正規表現では取りこぼした。検出されるべき。
const saleOnlyReserve = `<ReservePrices><ReservePrice><ReservePrice></ReservePrice><ReserveSalePrice>980</ReserveSalePrice></ReservePrice></ReservePrices>`;
check("特価のみReserveを検出", adv(base(saleOnlyReserve)).includes("reserve"), JSON.stringify(adv(base(saleOnlyReserve))));

// 空Spec/Variation → 非検出
check("空Spec/Variationは非検出", adv(base("<Spec1></Spec1><Variation1></Variation1>")).length === 0, JSON.stringify(adv(base("<Spec1></Spec1><Variation1></Variation1>"))));

// フラットSpec実体 → 検出
check("フラットSpec実体を検出", adv(base("<Spec1>10:20</Spec1>")).includes("spec"), JSON.stringify(adv(base("<Spec1>10:20</Spec1>"))));

// コンテナSpec（子要素あり）→ 検出
check("コンテナSpec実体を検出", adv(base("<Spec1><SpecId>10</SpecId></Spec1>")).includes("spec"), JSON.stringify(adv(base("<Spec1><SpecId>10</SpecId></Spec1>"))));

// GroupingId / options
check("GroupingId実体を検出", adv(base("<GroupingId>g-1</GroupingId>")).includes("grouping"), "");
check("options実体を検出", adv(base("<Options><Option name='色'></Option></Options>")).includes("options"), "");

// 何もなし → 空
check("素商品はadvancedなし", adv(base("")).length === 0, JSON.stringify(adv(base(""))));

console.log(fail === 0 ? "\n🎉 detectAdvanced 検証パス" : `\n⚠ ${fail}件失敗`);
process.exit(fail === 0 ? 0 : 1);
