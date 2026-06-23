/** Yahoo!ショッピング 追加画像(lib)API クライアント。実機(okimarumarket)で契約確認済み。
 * - uploadLibImage: POST multipart, seller_id は GET パラメータ, file は multipart。既定ディレクトリは「パーツ」。
 *   公開URLはフラット: https://shopping.c.yimg.jp/lib/{seller}/{fileName}
 * - deleteLibImage:  POST form, seller_id + file_name(カンマ区切り最大100)。自動本番反映。 */

const BASE = "https://circus.shopping.yahooapis.jp/ShoppingWebService/V1";

function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`, "i"));
  return m ? m[1] : "";
}

export type LibUploadResult = { ok: true } | { ok: false; message: string };

/** 追加画像を1枚アップロードする。fileName(拡張子込み)が公開URLのファイル名になる。 */
export async function uploadLibImage(
  accessToken: string,
  sellerId: string,
  opts: { fileName: string; jpeg: Buffer; directory?: string },
): Promise<LibUploadResult> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(opts.jpeg)], { type: "image/jpeg" }), opts.fileName);
  if (opts.directory) form.append("directory", opts.directory);

  const res = await fetch(`${BASE}/uploadLibImage?seller_id=${encodeURIComponent(sellerId)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  const body = await res.text();
  const status = tag(body, "Status");
  if (res.status === 200 && status === "OK") return { ok: true };
  return { ok: false, message: tag(body, "Message") || `HTTP ${res.status}: ${body.slice(0, 120)}` };
}

/** 追加画像を削除する（差し替え・後始末用）。file_name はファイル名(拡張子込み)。 */
export async function deleteLibImage(
  accessToken: string,
  sellerId: string,
  fileName: string,
): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(`${BASE}/deleteLibImage`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ seller_id: sellerId, file_name: fileName }),
  });
  const body = await res.text();
  // ResultSet > Result > Status / 失敗時は ErrorCode・ErrorMessage(または Message)
  const status = tag(body, "Status");
  return { ok: res.status === 200 && status === "OK", message: tag(body, "ErrorMessage") || tag(body, "Message") || status || `HTTP ${res.status}` };
}
