/** 楽天 RMS WEB SERVICE R-Cabinet API クライアント。
 * 認証は ESA（Authorization: ESA base64(serviceSecret:licenseKey)）。
 * エンドポイント・レスポンス構造は実機(ichiban-okinawa)で確認済み。 */

const API_BASE = "https://api.rms.rakuten.co.jp/es/1.0/cabinet";

export type RakutenCredentials = {
  serviceSecret: string;
  licenseKey: string;
};

/** ESA 認証ヘッダ値を生成する。"ESA " の後ろは半角スペース。 */
export function esaAuthHeader(serviceSecret: string, licenseKey: string): string {
  const token = Buffer.from(`${serviceSecret}:${licenseKey}`).toString("base64");
  return `ESA ${token}`;
}

function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`, "i"));
  return m ? m[1] : "";
}

/** files/search で既存ファイル名から所属フォルダ(FolderId/FolderPath)を逆引きする。
 * folders/get はページング上限(200/全241)で取りこぼすため、folderId 解決はこの方式が確実。 */
export async function searchFile(
  cred: RakutenCredentials,
  fileName: string,
): Promise<{ folderId: number; folderPath: string; filePath: string; fileUrl: string }[]> {
  const url = `${API_BASE}/files/search?fileName=${encodeURIComponent(fileName)}&limit=10`;
  const res = await fetch(url, { headers: { Authorization: esaAuthHeader(cred.serviceSecret, cred.licenseKey) } });
  const body = await res.text();
  if (res.status !== 200) {
    throw new Error(`files/search 失敗: HTTP ${res.status} ${tag(body, "message") || body.slice(0, 120)}`);
  }
  const files = [...body.matchAll(/<file>([\s\S]*?)<\/file>/g)].map((m) => ({
    folderId: Number(tag(m[1], "FolderId")),
    folderPath: tag(m[1], "FolderPath"),
    filePath: tag(m[1], "FilePath"),
    fileUrl: tag(m[1], "FileUrl"),
  }));
  return files;
}

export type CabinetFolder = { folderId: number; folderName: string; folderPath: string };

/** folders/get でフォルダ一覧を取得する（アップロード先の選択UI用）。
 * ページングを進め、1ページの件数が limit 未満になるか API がエラーを返した時点で打ち切る
 * （実機ではページング上限で全フォルダを取り切れないことがある = 取得できた分のみ返す）。 */
export async function listCabinetFolders(
  cred: RakutenCredentials,
  opts: { maxPages?: number } = {},
): Promise<CabinetFolder[]> {
  const maxPages = opts.maxPages ?? 5;
  const limit = 100;
  const out: CabinetFolder[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = `${API_BASE}/folders/get?offset=${page}&limit=${limit}`;
    const res = await fetch(url, { headers: { Authorization: esaAuthHeader(cred.serviceSecret, cred.licenseKey) } });
    const body = await res.text();
    if (res.status !== 200) break;
    const folders = [...body.matchAll(/<folder>([\s\S]*?)<\/folder>/g)].map((m) => ({
      folderId: Number(tag(m[1], "FolderId")),
      folderName: tag(m[1], "FolderName"),
      folderPath: tag(m[1], "FolderPath"),
    }));
    out.push(...folders);
    if (folders.length < limit) break;
  }
  return out;
}

/** 既知フォルダパス("/thum02"等)の FolderId を、その配下の既存ファイルから解決する。
 * sampleFileName はそのフォルダに必ず存在するファイル名(拡張子除く)を渡す。 */
export async function resolveFolderId(
  cred: RakutenCredentials,
  folderPath: string,
  sampleFileName: string,
): Promise<number | null> {
  const hits = await searchFile(cred, sampleFileName);
  const hit = hits.find((h) => h.folderPath === folderPath);
  return hit ? hit.folderId : null;
}

export type InsertResult = { ok: true; fileId: string; filePath: string } | { ok: false; message: string };

/** cabinet.file.insert で画像をアップロードする。
 * @param folderId  投入先フォルダの数値ID
 * @param filePath  公開ファイル名(拡張子込み, 半角小文字英数-_, 例 "t002-2542-1.jpg")。overWrite のキーになる
 * @param fileName  R-Cabinet 上の表示名(50バイト以内)
 * @param jpeg      JPEG バイナリ
 */
export async function insertCabinetFile(
  cred: RakutenCredentials,
  opts: { folderId: number; filePath: string; fileName: string; jpeg: Buffer; overWrite?: boolean },
): Promise<InsertResult> {
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<request><fileInsertRequest><file>` +
    `<folderId>${opts.folderId}</folderId>` +
    `<fileName>${opts.fileName}</fileName>` +
    `<filePath>${opts.filePath}</filePath>` +
    `<overWrite>${opts.overWrite === false ? "false" : "true"}</overWrite>` +
    `</file></fileInsertRequest></request>`;

  const form = new FormData();
  form.append("xml", xml);
  form.append("file", new Blob([new Uint8Array(opts.jpeg)], { type: "image/jpeg" }), opts.filePath);

  const res = await fetch(`${API_BASE}/file/insert`, {
    method: "POST",
    headers: { Authorization: esaAuthHeader(cred.serviceSecret, cred.licenseKey) },
    body: form,
  });
  const body = await res.text();
  const status = tag(body, "systemStatus");
  if (res.status === 200 && status === "OK") {
    return { ok: true, fileId: tag(body, "FileId"), filePath: opts.filePath };
  }
  return { ok: false, message: tag(body, "message") || `HTTP ${res.status}` };
}

/** cabinet.file.delete で画像を削除する（差し替え・後始末用）。
 * 注意: insert は multipart だが delete は「生XMLボディ + Content-Type: text/xml」で送る(実機確認済み)。 */
export async function deleteCabinetFile(
  cred: RakutenCredentials,
  fileId: string,
): Promise<{ ok: boolean; message: string }> {
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<request><fileDeleteRequest><file><fileId>${fileId}</fileId></file></fileDeleteRequest></request>`;
  const res = await fetch(`${API_BASE}/file/delete`, {
    method: "POST",
    headers: {
      Authorization: esaAuthHeader(cred.serviceSecret, cred.licenseKey),
      "Content-Type": "text/xml; charset=UTF-8",
    },
    body: xml,
  });
  const body = await res.text();
  return { ok: res.status === 200 && tag(body, "systemStatus") === "OK", message: tag(body, "message") || `HTTP ${res.status}` };
}
