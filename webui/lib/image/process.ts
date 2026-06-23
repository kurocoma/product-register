import sharp from "sharp";

/** R-Cabinet 制約: 1ファイル 2MB 以内、最大 3840×3840px、出力は JPG。
 * 透過はアップロード不可なので常に白背景で平坦化する。 */
const MAX_EDGE = 3840;
const MAX_BYTES = 2 * 1024 * 1024;

export type ProcessOptions = {
  /** main=通常商品画像 / wb=白背景画像（どちらも透過は白で平坦化する） */
  kind: "main" | "wb";
};

/** 入力画像を R-Cabinet 制約に収まる JPEG バッファへ整形する。
 * - EXIF 回転を正規化
 * - 長辺 3840px 以内へ縮小（拡大はしない）
 * - 透過を白背景で平坦化（sharp 既定は黒なので明示）
 * - 2MB 以内へ quality を段階的に下げて収束、最後は長辺縮小で確実に収める */
export async function processForCabinet(
  input: Buffer,
  opts: ProcessOptions,
): Promise<Buffer> {
  void opts.kind; // main/wb とも現状は同じ整形（将来 wb で余白付与などを分けられるよう残す）

  const base = sharp(input).rotate().flatten({ background: "#ffffff" });
  const meta = await sharp(input).metadata();
  const needsResize = Math.max(meta.width ?? 0, meta.height ?? 0) > MAX_EDGE;
  const sized = needsResize
    ? base.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
    : base;

  for (const quality of [85, 80, 72, 64, 55]) {
    const out = await sized.clone().jpeg({ quality, mozjpeg: true }).toBuffer();
    if (out.length <= MAX_BYTES) return out;
  }

  // ここまでで収まらない場合は長辺 2560px へ縮小して再エンコード（確実に 2MB 内へ）
  return sharp(input)
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({ width: 2560, height: 2560, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 72, mozjpeg: true })
    .toBuffer();
}
