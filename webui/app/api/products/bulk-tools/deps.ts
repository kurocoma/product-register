import type { SupabaseClient } from "@supabase/supabase-js";
import { getRakutenCredentialsFromEnv } from "@/lib/rakuten";
import {
  getYahooConfig,
  getYahooAccessToken,
  getItem as getYahooItem,
  editItem as editYahooItem,
  reservePublish,
} from "@/lib/yahoo";
import { makeRakutenRmsDeps, withCallTimeout, SALE_SUPPORT_CALL_TIMEOUT_MS } from "@/lib/sale-support";
import {
  dbRowToProductInput,
  upsertProduct,
  type ProductInput,
  type ProductRow,
} from "@/lib/product";
import { recordHistory } from "@/lib/history";
import { mallPresence } from "@/lib/product";
import type { BulkDbDeps, BulkPlanItem, RakutenClientDeps, YahooClientDeps } from "@/lib/bulk-tools";

/** 一括ツール3ルート共用の実 deps（sale-support の deps.ts と同じ構成）。
 * DB は RLS（auth.uid()=user_id）前提だが user_id で明示絞り込みする。 */

async function findByManage(
  supabase: SupabaseClient,
  userId: string,
  manageNumber: string,
): Promise<{ id: string; product: ProductInput } | null> {
  // 実管理番号（extra->>rakuten_manage_number）優先 → NEコード（migrate/sale-support と同じ照合順）。
  let { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("user_id", userId)
    .eq("extra->>rakuten_manage_number", manageNumber)
    .limit(1);
  if (error) throw new Error(error.message);
  if (!data?.length) {
    ({ data, error } = await supabase
      .from("products")
      .select("*")
      .eq("user_id", userId)
      .eq("ne_code", manageNumber)
      .limit(1));
    if (error) throw new Error(error.message);
  }
  if (!data?.length) return null;
  const row = data[0] as ProductRow;
  return { id: String(row.id), product: dbRowToProductInput(row) };
}

async function findByJan(
  supabase: SupabaseClient,
  userId: string,
  jan: string,
): Promise<{ id: string; product: ProductInput }[]> {
  // 商品レベル（products.jan_code）と SKU レベル（extra.variants[].jan_code）の両方を引く。
  // variants は extra JSONB 内のため、JSONB 包含（@>）で「jan_code が一致する要素を含む配列」を検索する。
  const q1 = await supabase.from("products").select("*").eq("user_id", userId).eq("jan_code", jan);
  if (q1.error) throw new Error(q1.error.message);
  const q2 = await supabase
    .from("products")
    .select("*")
    .eq("user_id", userId)
    .contains("extra", { variants: [{ jan_code: jan }] });
  if (q2.error) throw new Error(q2.error.message);
  const byId = new Map<string, { id: string; product: ProductInput }>();
  for (const raw of [...(q1.data ?? []), ...(q2.data ?? [])]) {
    const row = raw as ProductRow;
    const id = String(row.id);
    if (!byId.has(id)) byId.set(id, { id, product: dbRowToProductInput(row) });
  }
  return [...byId.values()];
}

export function makeBulkDbDeps(supabase: SupabaseClient, userId: string): BulkDbDeps {
  return {
    findByManage: (mn) => findByManage(supabase, userId, mn),
    findByJan: (jan) => findByJan(supabase, userId, jan),
    saveProduct: async (id, product) => {
      await upsertProduct(supabase, product, id, { authenticatedUserId: userId });
    },
    recordHistory: (productId, detail) => recordHistory(supabase, "edit", productId, detail, userId),
  };
}

/** 楽天クライアント（per-call 30sタイムアウト＋QPS 400msペーシング＋429再試行。sale-support と共用）。 */
export function makeBulkRakutenClient(): RakutenClientDeps | null {
  const cred = getRakutenCredentialsFromEnv();
  if (!cred) return null;
  return makeRakutenRmsDeps(cred);
}

/** Yahoo クライアント（per-call 30sタイムアウト。反映予約は全反映 mode=1）。 */
export async function makeBulkYahooClient(): Promise<{ client: YahooClientDeps | null; error?: string }> {
  const cfg = getYahooConfig();
  if (!cfg) return { client: null, error: "Yahoo 認証情報が未設定です" };
  try {
    const token = await getYahooAccessToken(cfg);
    const t = SALE_SUPPORT_CALL_TIMEOUT_MS;
    return {
      client: {
        sellerId: cfg.sellerId,
        getItem: (code) => withCallTimeout(getYahooItem(token, cfg.sellerId, code), t, `Yahoo getItem ${code}`),
        editItem: (params) =>
          withCallTimeout(editYahooItem(token, params), t, `Yahoo editItem ${params.item_code ?? ""}`),
        reservePublish: () =>
          withCallTimeout(reservePublish(token, cfg.sellerId, 1), t, "Yahoo reservePublish"),
      },
    };
  } catch (e) {
    return {
      client: null,
      error: (e instanceof Error ? e.message : String(e)) + "（リフレッシュトークン失効時は再認証）",
    };
  }
}

/** commit 用のモールクライアント準備。実行対象に掲載商品があるモールの認証が
 * 用意できない場合は「DBだけ更新されてモール未反映」の乖離を作らないよう実行前に中止する。 */
export async function prepareMallClients(
  plans: BulkPlanItem[],
): Promise<
  | { ok: true; rakuten: RakutenClientDeps | null; yahoo: YahooClientDeps | null }
  | { ok: false; error: string; status: number }
> {
  const targets = plans.filter((p) => p.status === "plan" && p.mutated);
  const needRakuten = targets.some((p) => mallPresence(p.mutated!).rakuten);
  // 反映予約は「Yahoo への更新があった場合のみ」実行するため、掲載対象が無ければ認証も要求しない。
  const needYahoo = targets.some((p) => mallPresence(p.mutated!).yahoo);
  const rakuten = makeBulkRakutenClient();
  if (needRakuten && !rakuten) {
    return { ok: false, error: "楽天 ESA 認証情報が未設定です", status: 500 };
  }
  let yahoo: YahooClientDeps | null = null;
  if (needYahoo) {
    const y = await makeBulkYahooClient();
    if (!y.client) {
      return { ok: false, error: y.error ?? "Yahoo 認証情報が未設定です", status: 502 };
    }
    yahoo = y.client;
  }
  return { ok: true, rakuten, yahoo };
}
