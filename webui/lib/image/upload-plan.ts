/** 楽天/Yahooの画像枠の上限（image_url_1〜20 に対応）。 */
export const MAX_IMAGE_SLOTS = 20;

/** 開始番号と枚数から各ファイルの番号を割り当てる。indexed=false（楽天 白背景wb）は全て null。
 * 楽天/Yahooの画像枠は20が上限なので、20を超える分の枚数 overflow も返す
 * （indices には範囲内(1〜20)に収まる分の番号だけが入る）。 */
export function planUploadIndices(
  fileCount: number,
  startIndex: number,
  opts: { indexed: boolean },
): { indices: (number | null)[]; overflow: number } {
  if (fileCount <= 0) return { indices: [], overflow: 0 };
  if (!opts.indexed) {
    // 楽天wb は番号を割り当てない（従来どおり index を送らず番号も進めない）
    return { indices: Array.from({ length: fileCount }, () => null), overflow: 0 };
  }
  const indices: (number | null)[] = [];
  let overflow = 0;
  for (let i = 0; i < fileCount; i += 1) {
    const n = startIndex + i;
    if (n >= 1 && n <= MAX_IMAGE_SLOTS) {
      indices.push(n);
    } else {
      overflow += 1;
    }
  }
  return { indices, overflow };
}
