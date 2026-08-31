/** 楽天 ItemAPI 2.0 クライアント（items.upsert / items.get / items.delete）。
 * 認証は ESA（R-Cabinet と同じ serviceSecret/licenseKey）。Content-Type: application/json。
 * 仕様: docs/楽天/02・04 で確認済み。upsert は PUT 全置換（201新規/204更新）。 */
import { esaAuthHeader, type RakutenCredentials } from "./cabinet-client";

const BASE = "https://api.rms.rakuten.co.jp/es/2.0";

/** 楽天エラーJSONを画面表示用メッセージへ整形する。
 * errors[].metadata.details[] の message（例: IE0418 の不足属性名）まで展開し、何が原因か分かるようにする。 */
function formatRakutenError(text: string, status: number): string {
  try {
    const j = JSON.parse(text);
    const errs = j.errors || j.error || [];
    if (Array.isArray(errs) && errs.length) {
      return errs
        .map((e: { code?: string; message?: string; metadata?: { details?: { message?: string }[] } }) => {
          let m = `${e.code || ""}: ${e.message || ""}`.trim();
          const details = e.metadata?.details;
          if (Array.isArray(details) && details.length) {
            const ds = details.map((d) => d.message || "").filter(Boolean).join(" / ");
            if (ds) m += ` — ${ds}`;
          }
          return m;
        })
        .join(" / ");
    }
    if (j.message) return String(j.message);
  } catch {
    /* テキストのまま */
  }
  return `HTTP ${status}`;
}

export type UpsertResult =
  | { ok: true; created: boolean; status: number }
  | { ok: false; status: number; message: string; body: string };

/** items.upsert（商品+SKU 登録/全置換）。 */
export async function upsertItem(
  cred: RakutenCredentials,
  manageNumber: string,
  body: Record<string, unknown>,
): Promise<UpsertResult> {
  const res = await fetch(`${BASE}/items/manage-numbers/${encodeURIComponent(manageNumber)}`, {
    method: "PUT",
    headers: {
      Authorization: esaAuthHeader(cred.serviceSecret, cred.licenseKey),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (res.status === 201 || res.status === 204) {
    return { ok: true, created: res.status === 201, status: res.status };
  }
  // エラーは JSON（errors[].code/message + metadata.details[]）
  return { ok: false, status: res.status, message: formatRakutenError(text, res.status), body: text.slice(0, 600) };
}

/** items.patch（商品の部分更新）。送ったフィールドだけ反映、未指定項目は保持（全置換しない）。
 * 仕様: docs/楽天/02。PATCH 同一エンドポイント。成功 204。 */
export async function patchItem(
  cred: RakutenCredentials,
  manageNumber: string,
  body: Record<string, unknown>,
): Promise<UpsertResult> {
  const res = await fetch(`${BASE}/items/manage-numbers/${encodeURIComponent(manageNumber)}`, {
    method: "PATCH",
    headers: {
      Authorization: esaAuthHeader(cred.serviceSecret, cred.licenseKey),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (res.status === 201 || res.status === 204) {
    return { ok: true, created: res.status === 201, status: res.status };
  }
  return { ok: false, status: res.status, message: formatRakutenError(text, res.status), body: text.slice(0, 600) };
}

/** items.get（商品取得）。存在すれば json に全文JSON。差分編集の取得元。 */
export async function getItem(
  cred: RakutenCredentials,
  manageNumber: string,
): Promise<{ exists: boolean; status: number; json: Record<string, unknown> | null; raw: string }> {
  const res = await fetch(`${BASE}/items/manage-numbers/${encodeURIComponent(manageNumber)}`, {
    headers: { Authorization: esaAuthHeader(cred.serviceSecret, cred.licenseKey) },
  });
  const raw = await res.text();
  let json: Record<string, unknown> | null = null;
  if (res.status === 200) {
    try { json = JSON.parse(raw); } catch { /* keep null */ }
  }
  return { exists: res.status === 200, status: res.status, json, raw };
}

/** items.search でシステム連携用SKU番号(merchantDefinedSkuId)から商品管理番号を引き当てる。
 * items.search は部分一致のため、結果のうち merchantDefinedSkuId が完全一致する variant を持つ商品の
 * manageNumber を返す。見つからなければ null。（管理番号≠NEコードの商品を NEコードで取込むため。
 * ※検索インデックス反映は最大24h遅延あり＝直近登録は引けないことがある。） */
export async function searchManageNumberBySku(
  cred: RakutenCredentials,
  sku: string,
): Promise<string | null> {
  const res = await fetch(`${BASE}/items/search?merchantDefinedSkuId=${encodeURIComponent(sku)}&hits=100`, {
    headers: { Authorization: esaAuthHeader(cred.serviceSecret, cred.licenseKey) },
  });
  if (res.status !== 200) return null;
  let json: { results?: { item?: { manageNumber?: string; variants?: Record<string, { merchantDefinedSkuId?: string }> } }[] };
  try {
    json = JSON.parse(await res.text());
  } catch {
    return null;
  }
  for (const r of json.results ?? []) {
    const variants = r.item?.variants;
    if (variants) {
      for (const v of Object.values(variants)) {
        if (v?.merchantDefinedSkuId === sku && r.item?.manageNumber) return r.item.manageNumber;
      }
    }
  }
  return null;
}

export type RakutenSearchHit = {
  manageNumber: string;
  title: string;
  /** 倉庫（非公開）に入っている商品か。 */
  hideItem: boolean;
};

/** items.search で商品名(title)の部分一致検索（260901修正依頼-1: 商品名からの取込用）。
 * 実測 2026-09-01: title=部分一致で results[].item.{manageNumber,title,hideItem} が返る。
 * ※検索インデックス反映は最大24h遅延（直近登録・改名した商品は引けないことがある）。 */
export async function searchItemsByTitle(
  cred: RakutenCredentials,
  title: string,
  hits = 20,
): Promise<{ ok: boolean; message?: string; results: RakutenSearchHit[] }> {
  const res = await fetch(
    `${BASE}/items/search?title=${encodeURIComponent(title)}&hits=${Math.max(1, Math.min(100, hits))}`,
    { headers: { Authorization: esaAuthHeader(cred.serviceSecret, cred.licenseKey) } },
  );
  const text = await res.text();
  if (res.status !== 200) {
    return { ok: false, message: formatRakutenError(text, res.status), results: [] };
  }
  try {
    const json = JSON.parse(text) as {
      results?: { item?: { manageNumber?: string; title?: string; hideItem?: boolean } }[];
    };
    const results = (json.results ?? [])
      .map((r) => r.item)
      .filter((i): i is { manageNumber: string; title?: string; hideItem?: boolean } => typeof i?.manageNumber === "string")
      .map((i) => ({ manageNumber: i.manageNumber, title: i.title ?? "", hideItem: i.hideItem === true }));
    return { ok: true, results };
  } catch {
    return { ok: false, message: "items.search 応答の解析に失敗しました", results: [] };
  }
}

/** items.delete（商品削除、テスト後始末用）。 */
export async function deleteItem(
  cred: RakutenCredentials,
  manageNumber: string,
): Promise<{ ok: boolean; status: number; message: string }> {
  const res = await fetch(`${BASE}/items/manage-numbers/${encodeURIComponent(manageNumber)}`, {
    method: "DELETE",
    headers: { Authorization: esaAuthHeader(cred.serviceSecret, cred.licenseKey) },
  });
  const text = await res.text();
  return { ok: res.status === 204 || res.status === 200, status: res.status, message: text.slice(0, 200) || `HTTP ${res.status}` };
}
