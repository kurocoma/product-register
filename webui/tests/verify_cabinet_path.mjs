// cabinet-path.ts の振る舞い検証（.test.ts はガード保護のため tsx 経由の検証スクリプトで代替）。
// 実行: npx tsx tests/verify_cabinet_path.mjs
import { buildCabinetFileName, validateCabinetFileName } from "../lib/converters/cabinet-path.ts";
import { makeProduct } from "../lib/product/schema.ts";

let fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const ok = g === w;
  if (!ok) fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${ok ? "" : `  got=${g} want=${w}`}`);
};

const p = makeProduct({ ne_code: "t002-2542-1", maker_code: "t002", jan_code: "4955028002542" });

eq("main index=1 → {ne_code} @thum02", buildCabinetFileName(p, { kind: "main", index: 1 }),
  { folder: "thum02", folderId: 10502933, name: "t002-2542-1", filePath: "t002-2542-1.jpg" });
eq("main index=2 → {base}_2", buildCabinetFileName(p, { kind: "main", index: 2 }),
  { folder: "thum02", folderId: 10502933, name: "t002-2542_2", filePath: "t002-2542_2.jpg" });
eq("main index=3 → {base}_3 name", buildCabinetFileName(p, { kind: "main", index: 3 }).name, "t002-2542_3");
eq("wb → wb-{base} @wb01", buildCabinetFileName(p, { kind: "wb" }),
  { folder: "wb01", folderId: 8266494, name: "wb-t002-2542", filePath: "wb-t002-2542.jpg" });

eq("validate 正常(11+.jpg=15byte)", validateCabinetFileName("t002-2542_2").ok, true);
eq("validate wb 正常(12+.jpg=16byte)", validateCabinetFileName("wb-t002-2542").ok, true);
eq("validate 大文字NG", validateCabinetFileName("T002").ok, false);
eq("validate 拡張子込み20byte超過NG(17base)", validateCabinetFileName("a".repeat(17)).ok, false);
eq("validate 16base+.jpg=20byteはOK", validateCabinetFileName("a".repeat(16)).ok, true);
eq("validate 全角NG", validateCabinetFileName("あ").ok, false);
eq("validate 空白NG", validateCabinetFileName("a b").ok, false);
eq("validate ドットNG", validateCabinetFileName("a.b").ok, false);

console.log(fail === 0 ? "\n🎉 cabinet-path 全検証パス" : `\n⚠ ${fail}件失敗`);
process.exit(fail === 0 ? 0 : 1);
