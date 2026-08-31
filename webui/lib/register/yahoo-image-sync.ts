/** Yahoo 登録前の画像準備（260901修正依頼-2: it-14091 の自動解消）。
 *
 * editItem の item_image_urls は Yahoo 追加画像(lib)に実在するファイルしか参照できない。
 * 楽天等から取込んだ商品は image_url_N が楽天CDN等の実URLのままなので、そのまま
 * 「Yahooへ登録」すると it-14091（追加画像への商品紐づけ登録/解除が行えませんでした）で
 * 登録全体が失敗する。migrate（楽天→Yahoo一括反映）の A1-A4 是正と同じ型を単品/一括の
 * 登録サービスにも提供する:
 *  A1) editItem の前に取込画像URL(image_url_1..image_count)を lib へ転送
 *  A2) アップロード成功 index のみで item_image_urls を再構築（壊れURLを参照しない）
 *  A4) それでも it-14091/im-02005 なら伝播ラグとみなし短い待機後1回だけリトライ
 *
 * 同等ロジックの既存実装: lib/migrate/executor.ts（deps注入）・app/api/upload/yahoo-sync
 * （手動転送ボタン。UI向けに fileName/publicUrl を返す契約のため統合していない）。 */

import type { ProductInput } from "@/lib/product/schema";
import type { EditItemResult } from "@/lib/yahoo/item-client";
import { uploadLibImage } from "@/lib/yahoo/lib-image-client";
import { buildYahooLibFileNameByCode, validateYahooFileName } from "@/lib/yahoo/lib-path";
import { processForCabinet } from "@/lib/image/process";

const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

export type YahooImageSyncResult = {
  /** 全件成功なら true（部分失敗・全失敗は false で error に理由）。 */
  ok: boolean;
  error?: string;
  /** アップロードに成功した画像 index 群（1始まり）。 */
  uploaded: number[];
};

/** 転送元の実画像URL（image_url_1..image_count の非空分）。 */
export function collectImageSources(product: ProductInput): { index: number; url: string }[] {
  const count = Math.max(1, Math.min(20, product.image_count || 1));
  const sources: { index: number; url: string }[] = [];
  for (let i = 1; i <= count; i++) {
    const u = (product as unknown as Record<string, unknown>)[`image_url_${i}`];
    if (typeof u === "string" && u.trim()) sources.push({ index: i, url: u.trim() });
  }
  return sources;
}

/** 取込んだ実画像URLを Yahoo 追加画像(lib)へ転送する。
 * imageCode = item_image_urls が参照するコード（lib ファイル名の基底。
 * YahooConverter は productVariants(p)[0].ne_code を使うため、呼び出し側で同じ値を渡す）。 */
export async function syncYahooLibImages(
  token: string,
  sellerId: string,
  product: ProductInput,
  imageCode: string,
): Promise<YahooImageSyncResult> {
  const sources = collectImageSources(product);
  if (sources.length === 0) {
    return { ok: false, error: "転送元の画像URL(image_url_N)がありません", uploaded: [] };
  }

  const failed: string[] = [];
  const uploaded: number[] = [];
  for (const s of sources) {
    try {
      const target = buildYahooLibFileNameByCode(imageCode, s.index);
      const fnValid = validateYahooFileName(target.fileName);
      if (!fnValid.ok) {
        failed.push(`#${s.index}: ${fnValid.reason}`);
        continue;
      }
      const resp = await fetch(s.url);
      if (!resp.ok) {
        failed.push(`#${s.index}: 画像取得失敗 (HTTP ${resp.status})`);
        continue;
      }
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.byteLength > MAX_IMAGE_BYTES) {
        failed.push(`#${s.index}: 画像が大きすぎます`);
        continue;
      }
      const jpeg = await processForCabinet(buf, { kind: "main" });
      const up = await uploadLibImage(token, sellerId, { fileName: target.fileName, jpeg });
      if (!up.ok) failed.push(`#${s.index}: ${up.message}`);
      else uploaded.push(s.index);
    } catch (e) {
      failed.push(`#${s.index}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return failed.length ? { ok: false, error: failed.join(" / "), uploaded } : { ok: true, uploaded };
}

/** editItem の失敗が画像紐づけ未伝播(it-14091)・画像未存在(im-02005)に該当するか。
 * lib アップロード直後の伝播ラグで一過性に出ることがある（migrate executor と同判定）。 */
export function isYahooImagePropagationError(edit: EditItemResult): boolean {
  if (edit.ok) return false;
  const hay = [edit.message, ...(edit.errors ?? [])].join(" ").toLowerCase();
  return hay.includes("it-14091") || hay.includes("im-02005");
}

/** リトライ前の待機(ms)。実測: 画像先行アップ + 1.5s 待機で it-14091 再発なし（資料§3）。 */
export const YAHOO_EDIT_RETRY_DELAY_MS = 1500;
