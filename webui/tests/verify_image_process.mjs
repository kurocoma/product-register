// image/process.ts の振る舞い検証（.test.ts はガード保護のため tsx 検証で代替）。
// 実行: npx tsx tests/verify_image_process.mjs
import sharp from "sharp";
import { processForCabinet } from "../lib/image/process.ts";

let fail = 0;
const check = (label, cond, detail) => {
  if (!cond) fail++;
  console.log(`${cond ? "✅" : "❌"} ${label}${detail ? "  " + detail : ""}`);
};

const makePng = (w, h, alpha = 0) =>
  sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha } } })
    .png().toBuffer();

// 1) 長辺3840px以内へ縮小しJPEGで返す
{
  const out = await processForCabinet(await makePng(5000, 3000), { kind: "main" });
  const m = await sharp(out).metadata();
  check("JPEGで返る", m.format === "jpeg", `format=${m.format}`);
  check("長辺<=3840px", Math.max(m.width, m.height) <= 3840, `${m.width}x${m.height}`);
}

// 2) 出力は2MB以内（巨大画像でも収束）
{
  const out = await processForCabinet(await makePng(3840, 3840), { kind: "main" });
  check("2MB以内", out.length <= 2 * 1024 * 1024, `${(out.length / 1024 / 1024).toFixed(2)}MB`);
}

// 3) 小さい画像は拡大されない
{
  const out = await processForCabinet(await makePng(600, 400), { kind: "main" });
  const m = await sharp(out).metadata();
  check("拡大しない(600x400維持)", m.width === 600 && m.height === 400, `${m.width}x${m.height}`);
}

// 4) 透過は白背景で平坦化（透過PNG→JPEGで白）
{
  const out = await processForCabinet(await makePng(400, 400, 0), { kind: "wb" });
  const stats = await sharp(out).stats();
  const ch = stats.channels; // R,G,B の平均が高い=白
  const avg = (ch[0].mean + ch[1].mean + ch[2].mean) / 3;
  check("透過→白背景", avg > 240, `平均輝度=${avg.toFixed(0)}`);
}

console.log(fail === 0 ? "\n🎉 image/process 全検証パス" : `\n⚠ ${fail}件失敗`);
process.exit(fail === 0 ? 0 : 1);
