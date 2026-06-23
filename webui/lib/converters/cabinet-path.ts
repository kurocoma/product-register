import type { ProductInput } from "@/lib/product/schema";
import { baseCodeOf } from "./rakuten";
import { RCABINET_FOLDER } from "@/lib/rakuten/store";

/** アップロード対象の種別。
 * - main: 商品画像(thum02)。index=1 は {ne_code}、index>=2 は {base}_{index}
 * - wb:   白背景画像(wb01)。wb-{base}
 */
export type CabinetImageKind =
  | { kind: "main"; index: number }
  | { kind: "wb" };

export type CabinetTarget = {
  folder: string;
  folderId: number;
  /** 拡張子を除いたファイル名。CSV参照URL({base}/{name}.jpg)と一致させる確定的な値。 */
  name: string;
  /** API に渡す公開ファイル名(拡張子込み)。R-Cabinet の filePath。20バイト制約の対象。 */
  filePath: string;
};

/** 商品＋種別から R-Cabinet のアップロード先(フォルダ/folderId)と確定ファイル名を算出する。
 * 変換器(rakuten.ts)の命名規約と同一ロジック(baseCodeOf を共有)。 */
export function buildCabinetFileName(
  p: ProductInput,
  opts: CabinetImageKind,
): CabinetTarget {
  if (opts.kind === "wb") {
    const name = `wb-${baseCodeOf(p)}`;
    return { folder: RCABINET_FOLDER.wb01.path, folderId: RCABINET_FOLDER.wb01.folderId, name, filePath: `${name}.jpg` };
  }
  const name = opts.index <= 1 ? p.ne_code : `${baseCodeOf(p)}_${opts.index}`;
  return { folder: RCABINET_FOLDER.thum02.path, folderId: RCABINET_FOLDER.thum02.folderId, name, filePath: `${name}.jpg` };
}

/** R-Cabinet の公開ファイル名(filePath, 拡張子込み)制約を検証する。
 * 半角小文字英数 + ハイフン/アンダースコア + 末尾.jpg、全体20バイト以内。 */
export function validateCabinetFileName(
  name: string,
): { ok: true } | { ok: false; reason: string } {
  if (!name) return { ok: false, reason: "ファイル名が空です" };
  if (/[A-Z]/.test(name)) {
    return { ok: false, reason: "大文字は使用できません（半角小文字英数と -_ のみ）" };
  }
  if (!/^[a-z0-9_-]+$/.test(name)) {
    return { ok: false, reason: "使用できない文字が含まれています（半角小文字英数と -_ のみ）" };
  }
  const filePath = `${name}.jpg`;
  const bytes = Buffer.byteLength(filePath, "utf8");
  if (bytes > 20) {
    return { ok: false, reason: `ファイル名は拡張子込み20バイト以内です（${filePath} は ${bytes}バイト）` };
  }
  return { ok: true };
}
