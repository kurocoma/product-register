/** Yahoo!ショッピング 商品API クライアント（editItem / submitItem / getItem / deleteItem）。
 * 認証は OAuth 2.0 Bearer のみ（公開鍵署名は editItem に不要＝トークン延命用、docs/Yahoo/01 で確認）。
 * editItem は form(application/x-www-form-urlencoded)、レスポンスは XML。 */

const BASE = "https://circus.shopping.yahooapis.jp/ShoppingWebService/V1";

function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`, "i"));
  return m ? m[1] : "";
}

/** XML から Warning/Error を収集する。 */
function collectMessages(xml: string, kind: "Warning" | "Error"): string[] {
  return [...xml.matchAll(new RegExp(`<${kind}>([\\s\\S]*?)</${kind}>`, "gi"))].map((m) => {
    const code = (m[1].match(/<Code>([^<]*)<\/Code>/i) || [])[1] || "";
    const msg = (m[1].match(/<Message>([^<]*)<\/Message>/i) || [])[1] || "";
    const target = (m[1].match(/<Target>([^<]*)<\/Target>/i) || [])[1] || "";
    return [target, code, msg].filter(Boolean).join(": ");
  });
}

export type EditItemResult =
  | { ok: true; warnings: string[] }
  | { ok: false; message: string; warnings: string[]; errors: string[] };

/** 商品を新規登録/更新する（editItem）。省略項目はデフォルト上書きされる点に注意。 */
export async function editItem(
  accessToken: string,
  params: Record<string, string>,
): Promise<EditItemResult> {
  const res = await fetch(`${BASE}/editItem`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const body = await res.text();
  const status = tag(body, "Status");
  const warnings = collectMessages(body, "Warning");
  if (res.status === 200 && status === "OK") return { ok: true, warnings };
  return { ok: false, message: status || `HTTP ${res.status}`, warnings, errors: collectMessages(body, "Error") };
}

/** 商品1件をフロントへ反映する（submitItem）。 */
export async function submitItem(
  accessToken: string,
  sellerId: string,
  itemCode: string,
): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(`${BASE}/submitItem`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ seller_id: sellerId, item_code: itemCode }),
  });
  const body = await res.text();
  const status = tag(body, "Status");
  return { ok: res.status === 200 && status === "OK", message: status || `HTTP ${res.status}` };
}

/** 商品を取得する（getItem）。存在しなければ null。差分プレビュー/マージ用。 */
export async function getItem(
  accessToken: string,
  sellerId: string,
  itemCode: string,
): Promise<{ exists: boolean; raw: string }> {
  const res = await fetch(
    `${BASE}/getItem?seller_id=${encodeURIComponent(sellerId)}&item_code=${encodeURIComponent(itemCode)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const body = await res.text();
  // エラー(存在しない等)は Status=NG or Error。存在判定は Name/ItemCode の有無で大まかに。
  const exists = res.status === 200 && /<Name>|<ItemCode>/i.test(body) && tag(body, "Status") !== "NG";
  return { exists, raw: body };
}

/** 商品を削除する（deleteItem）。テスト後始末用。 */
export async function deleteItem(
  accessToken: string,
  sellerId: string,
  itemCode: string,
): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(`${BASE}/deleteItem`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ seller_id: sellerId, item_code: itemCode }),
  });
  const body = await res.text();
  const status = tag(body, "Status");
  return { ok: res.status === 200 && status === "OK", message: status || `HTTP ${res.status}` };
}
