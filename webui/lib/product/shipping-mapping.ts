import type { SupabaseClient } from "@supabase/supabase-js";

/** 楽天 配送方法セット番号(shippingMethodGroup) → Yahoo postage_set を解決する。
 *  指定キーの行が無ければ既定行(rakuten_shipping_group='')へフォールバック。どちらも無ければ null。
 *  （楽天は既定便だと shippingMethodGroup を返さない＝空になるため、既定行で全体を賄える） */
export async function fetchYahooPostageSet(
  supabase: SupabaseClient,
  rakutenShippingGroup: string,
): Promise<string | null> {
  const key = (rakutenShippingGroup ?? "").trim();

  const lookup = async (k: string): Promise<string | null> => {
    // マッピング未投入・テーブル未適用・取得失敗は「該当なし(null)→既定維持」として扱う
    // （移行を壊さない。例外も握りつぶして安全側へ）。
    try {
      const { data, error } = await supabase
        .from("rakuten_yahoo_shipping_mapping")
        .select("yahoo_postage_set")
        .eq("rakuten_shipping_group", k)
        .maybeSingle();
      if (error) return null;
      const v = data?.yahoo_postage_set;
      return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
    } catch {
      return null;
    }
  };

  if (key !== "") {
    const hit = await lookup(key);
    if (hit !== null) return hit;
  }
  return lookup(""); // 既定行
}

/** 楽天 納期管理番号(normalDeliveryDateId) → Yahoo 発送日数(lead_time) を解決する。
 *  指定キーの行が無ければ既定行(rakuten_delivery_date_id='')へフォールバック。どちらも無ければ null。 */
export async function fetchYahooLeadTime(
  supabase: SupabaseClient,
  rakutenDeliveryDateId: string,
): Promise<number | null> {
  const key = (rakutenDeliveryDateId ?? "").trim();

  const lookup = async (k: string): Promise<number | null> => {
    // マッピング未投入・テーブル未適用・取得失敗は「該当なし(null)→既定維持」として扱う。
    try {
      const { data, error } = await supabase
        .from("rakuten_yahoo_leadtime_mapping")
        .select("lead_time")
        .eq("rakuten_delivery_date_id", k)
        .maybeSingle();
      if (error) return null;
      const v = data?.lead_time;
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    } catch {
      return null;
    }
  };

  if (key !== "") {
    const hit = await lookup(key);
    if (hit !== null) return hit;
  }
  return lookup("");
}
