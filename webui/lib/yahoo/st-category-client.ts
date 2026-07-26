/** Yahoo!ショッピング ストアカテゴリAPI クライアント（stCategoryList / editStCategory）。
 * ストア独自のカテゴリツリー（editItem の `path` が指す先）を参照・作成する。
 * 認証は OAuth 2.0 Bearer。レスポンスは XML。仕様: docs/Yahoo/06-カテゴリ・ブランド管理.md §4-5。
 * フロント反映（reservePublish）は行わない — 呼び出し側の判断に委ねる。 */

const BASE = "https://circus.shopping.yahooapis.jp/ShoppingWebService/V1";

function tag(xml: string, name: string): string {
  const cdata = xml.match(new RegExp(`<${name}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${name}>`, "i"));
  if (cdata) return cdata[1].trim();
  const plain = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`, "i"));
  return plain ? plain[1].trim() : "";
}

/** XML から Error を収集する（Code/Message は CDATA のことがある）。 */
function collectErrors(xml: string): string[] {
  return [...xml.matchAll(/<Error>([\s\S]*?)<\/Error>/gi)].map((m) => {
    const code = tag(m[1], "Code");
    const msg = tag(m[1], "Message");
    return [code, msg].filter(Boolean).join(": ");
  });
}

export type StCategory = {
  pageKey: string;
  name: string;
  display: string;
  sortOrder: string;
};

/** ストアカテゴリの子カテゴリ一覧（page_key 省略で第1階層）。 */
export async function listStCategories(
  accessToken: string,
  sellerId: string,
  pageKey?: string,
): Promise<{ ok: true; categories: StCategory[] } | { ok: false; message: string }> {
  const q = new URLSearchParams({ seller_id: sellerId });
  if (pageKey) q.set("page_key", pageKey);
  const res = await fetch(`${BASE}/stCategoryList?${q.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await res.text();
  const errors = collectErrors(body);
  if (res.status !== 200 || errors.length > 0) {
    return { ok: false, message: errors.length ? errors.join(" / ") : `HTTP ${res.status}` };
  }
  const categories = [...body.matchAll(/<Result\b[^>]*>([\s\S]*?)<\/Result>/gi)].map((m) => ({
    pageKey: tag(m[1], "PageKey"),
    name: tag(m[1], "Name"),
    display: tag(m[1], "Display"),
    sortOrder: tag(m[1], "SortOrder"),
  })).filter((c) => c.pageKey || c.name);
  return { ok: true, categories };
}

export type EditStCategoryInput = {
  /** 省略/空 = 新規作成、指定 = 更新。新規時に任意のキーは指定できない（システム採番）。 */
  pageKey?: string;
  /** 新規時の親カテゴリ。省略で第1階層。 */
  parentPageKey?: string;
  /** カテゴリ名（全角20文字以内・同一階層で重複不可）。 */
  name: string;
  /** 公開状態。0=非表示 / 1=公開（既定 1）。 */
  display?: 0 | 1;
};

/** ストアカテゴリを作成/更新する（editStCategory）。フロント反映は行わない。 */
export async function editStCategory(
  accessToken: string,
  sellerId: string,
  input: EditStCategoryInput,
): Promise<{ ok: true; pageKey: string } | { ok: false; message: string }> {
  const form: Record<string, string> = { seller_id: sellerId, name: input.name };
  if (input.pageKey) form.page_key = input.pageKey;
  if (input.parentPageKey) form.parent_page_key = input.parentPageKey;
  if (input.display !== undefined) form.display = String(input.display);
  const res = await fetch(`${BASE}/editStCategory`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
  const body = await res.text();
  const errors = collectErrors(body);
  const status = tag(body, "Status");
  if (res.status !== 200 || errors.length > 0 || (status && status !== "OK")) {
    return { ok: false, message: errors.length ? errors.join(" / ") : status || `HTTP ${res.status}` };
  }
  // 新規作成時は採番された PageKey が返る。更新時は入力の page_key を返す。
  return { ok: true, pageKey: tag(body, "PageKey") || input.pageKey || "" };
}

/** 第1階層に指定名のカテゴリが無ければ作る（あればそれを返す）。冪等な入口。 */
export async function ensureTopLevelStCategory(
  accessToken: string,
  sellerId: string,
  name: string,
): Promise<{ ok: true; pageKey: string; created: boolean } | { ok: false; message: string }> {
  const list = await listStCategories(accessToken, sellerId);
  if (!list.ok) return list;
  const hit = list.categories.find((c) => c.name === name);
  if (hit) return { ok: true, pageKey: hit.pageKey, created: false };
  const made = await editStCategory(accessToken, sellerId, { name });
  if (!made.ok) return made;
  return { ok: true, pageKey: made.pageKey, created: true };
}
