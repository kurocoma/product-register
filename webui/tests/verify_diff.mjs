// diffProduct の検証（純粋ロジック）。実行: npx tsx tests/verify_diff.mjs
import { diffProduct } from "../lib/product/diff.ts";
import { makeProduct } from "../lib/product/schema.ts";

let fail = 0;
const check = (l, c, d) => { if (!c) fail++; console.log(`${c ? "✅" : "❌"} ${l}${d ? "  " + d : ""}`); };

const snap = { display_name: "旧名", selling_price: 1000, description_pc: "<p>旧</p>" };
const edited = makeProduct({ display_name: "新名", selling_price: 1500, description_pc: "<p>旧</p>" });

const d = diffProduct(snap, edited);
check("変更2件(name,price)", d.length === 2, `${d.length}件: ${d.map((x) => x.field).join(",")}`);
check("display_name 変更検出", d.some((x) => x.field === "display_name" && x.after === "新名"), "");
check("selling_price 変更検出", d.some((x) => x.field === "selling_price" && x.before === 1000 && x.after === 1500), "");
check("description_pc 不変は除外", !d.some((x) => x.field === "description_pc"), "");

// snapshot に無い項目は判定しない（誤検知防止）
const d2 = diffProduct({ selling_price: 1000 }, makeProduct({ selling_price: 1000, display_name: "X" }));
check("snapshot未取得項目は差分なし", d2.length === 0, `${d2.length}件`);

console.log(fail === 0 ? "\n🎉 diffProduct 検証パス" : `\n⚠ ${fail}件失敗`);
process.exit(fail === 0 ? 0 : 1);
