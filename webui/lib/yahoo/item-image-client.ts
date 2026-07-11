/** Yahoo!ショッピング 商品画像(item image)API クライアント。
 * - uploadItemImage: POST multipart, seller_id は GET パラメータ, file は multipart。
 *   ファイル名で商品コードと紐づく（メイン={code}.jpg / 詳細={code}_{1..20}.jpg）。
 *   追加画像(lib)と違い「未反映」でアップロードされるため、別途反映(reservePublish)が必要。
 * 公式: https://developer.yahoo.co.jp/webapi/shopping/uploadItemImage.html */

const BASE = "https://circus.shopping.yahooapis.jp/ShoppingWebService/V1";

function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`, "i"));
  return m ? m[1] : "";
}

export type ItemImageUploadResult = { ok: true; name: string } | { ok: false; message: string };

/** 商品画像を1枚アップロードする（2MB以内・JPEG推奨。processForCabinet で整形してから渡す）。
 * 並列リクエスト不可のため呼び出し側は逐次実行すること。 */
export async function uploadItemImage(
  accessToken: string,
  sellerId: string,
  opts: { fileName: string; jpeg: Buffer },
): Promise<ItemImageUploadResult> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(opts.jpeg)], { type: "image/jpeg" }), opts.fileName);

  const res = await fetch(`${BASE}/uploadItemImage?seller_id=${encodeURIComponent(sellerId)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  const body = await res.text();
  const status = tag(body, "Status");
  if (res.status === 200 && status === "OK") {
    return { ok: true, name: tag(body, "Name") || opts.fileName };
  }
  return { ok: false, message: tag(body, "Message") || `HTTP ${res.status}: ${body.slice(0, 120)}` };
}
