/** 楽天市場商品検索API（楽天ウェブサービス IchibaItem/Search）クライアント。
 * RMS とは別系統の認証。2026年のインフラ刷新後は applicationId（UUID形式）に加えて
 * accessKey が必須（credentials.ts の getRakutenApplicationIdFromEnv / getRakutenWebServiceAccessKeyFromEnv）。
 * 競合店の価格・ポイント倍率（pointRate）の取得に使う。
 * 注意: JAN専用の検索パラメータは無く、keyword に JAN を渡す間接突合になる
 * （ヒットの妥当性検証は lib/point-boost/matcher.ts 側で行う）。 */

// 旧 app.rakuten.co.jp/.../20220601 は2026年の刷新（移行期間 2026-02-10〜05-13）で廃止済み
const BASE = "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701";

/** formatVersion=2 のレスポンス items[] のうち本機能が使うフィールド。 */
export type IchibaSearchItem = {
  itemName: string;
  itemCode: string;   // "shopCode:商品ID"
  itemPrice: number;  // 税込価格
  pointRate: number;  // ポイント倍率（1 = 通常1倍）
  shopCode: string;
  shopName: string;
  itemUrl: string;
  postageFlag?: number; // 0=送料込 / 1=送料別
  availability?: number; // 1=販売可能
};

export type IchibaSearchResult =
  | { ok: true; items: IchibaSearchItem[]; totalCount: number }
  | { ok: false; status: number; message: string };

export type IchibaSearchParams = {
  keyword: string;
  /** 取得件数（既定30 = APIの最大値） */
  hits?: number;
  page?: number;
  /** 既定 "+itemPrice"（価格昇順 = 最安値検索） */
  sort?: string;
};

/** 楽天ウェブサービスの認証情報（2026年刷新後は両方必須）。 */
export type IchibaSearchAuth = {
  applicationId: string;
  accessKey: string;
};

/** 商品検索。価格昇順（最安値順）が既定。エラーは throw せず判別可能ユニオンで返す。 */
export async function searchIchibaItems(
  auth: IchibaSearchAuth,
  params: IchibaSearchParams,
): Promise<IchibaSearchResult> {
  const q = new URLSearchParams({
    applicationId: auth.applicationId,
    keyword: params.keyword,
    hits: String(params.hits ?? 30),
    page: String(params.page ?? 1),
    sort: params.sort ?? "+itemPrice",
    // 販売可能な商品のみ（売り切れは出面の競合にならない）
    availability: "1",
    formatVersion: "2",
  });
  let res: Response;
  let text: string;
  try {
    // accessKey はヘッダで渡す（URLに載せない = アクセスログ・エラーメッセージへの露出を防ぐ）
    res = await fetch(`${BASE}?${q.toString()}`, { headers: { accessKey: auth.accessKey } });
    text = await res.text();
  } catch (e) {
    // ネットワーク断も throw せず判別ユニオンで返す（呼び出し側の連続失敗ブレーカーを効かせる）
    return { ok: false, status: 0, message: `ネットワークエラー: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (res.status !== 200) {
    return { ok: false, status: res.status, message: formatIchibaError(text, res.status) };
  }
  try {
    const json = JSON.parse(text) as { items?: unknown[]; Items?: unknown[]; count?: number };
    // 2026年刷新後のキーは小文字 items（旧APIの大文字 Items にもフォールバックして両対応）
    const items = (json.items ?? json.Items ?? [])
      .map(normalizeItem)
      .filter((it): it is IchibaSearchItem => it !== null);
    return { ok: true, items, totalCount: json.count ?? items.length };
  } catch {
    return { ok: false, status: res.status, message: "レスポンスのJSON解析に失敗しました" };
  }
}

/** 検索APIのレート制限（429）/一時障害（503）応答か。createQpsPacer の isLimited 述語に使う。 */
export function isIchibaRateLimited(result: IchibaSearchResult): boolean {
  return !result.ok && (result.status === 429 || result.status === 503);
}

function normalizeItem(raw: unknown): IchibaSearchItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const itemName = typeof r.itemName === "string" ? r.itemName : "";
  const shopCode = typeof r.shopCode === "string" ? r.shopCode : "";
  if (!itemName || !shopCode) return null;
  return {
    itemName,
    itemCode: typeof r.itemCode === "string" ? r.itemCode : "",
    itemPrice: toNumber(r.itemPrice),
    pointRate: toNumber(r.pointRate) || 1,
    shopCode,
    shopName: typeof r.shopName === "string" ? r.shopName : "",
    itemUrl: typeof r.itemUrl === "string" ? r.itemUrl : "",
    postageFlag: typeof r.postageFlag === "number" ? r.postageFlag : undefined,
    availability: typeof r.availability === "number" ? r.availability : undefined,
  };
}

function toNumber(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return 0;
}

/** エラーレスポンス（{error, error_description}）を表示用文字列へ。 */
function formatIchibaError(text: string, status: number): string {
  try {
    const j = JSON.parse(text) as { error?: string; error_description?: string };
    if (j.error || j.error_description) {
      return `${j.error ?? ""}: ${j.error_description ?? ""}`.replace(/^: /, "").trim();
    }
  } catch {
    /* テキストのまま */
  }
  return `HTTP ${status}`;
}
