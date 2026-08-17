/** point-boost の永続化層。settings / runs / results の CRUD と、実行対象（楽天掲載済み商品）の取得。
 * supabase クライアントは注入式: HTTPルートはセッションクライアント（RLS）、
 * 定期実行スクリプトは service role クライアント＋明示 userId で使う（常に user_id で絞る）。 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { dbRowToProductInput, mallPresence, productVariants, type ProductRow } from "@/lib/product";
import {
  DEFAULT_POINT_BOOST_SETTINGS,
  type BoostTarget,
  type PointBoostSettings,
  type ProductResult,
  type RunTotals,
} from "./types";

const PAGE_SIZE = 1000;

/** 設定を取得（未保存なら既定値）。 */
export async function getPointBoostSettings(
  supabase: SupabaseClient,
  userId: string,
): Promise<PointBoostSettings> {
  const { data, error } = await supabase
    .from("point_boost_settings")
    .select("enabled, plus_rate, max_rate, compare_top_n, campaign_days")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ...DEFAULT_POINT_BOOST_SETTINGS };
  return {
    enabled: !!data.enabled,
    plus_rate: data.plus_rate ?? DEFAULT_POINT_BOOST_SETTINGS.plus_rate,
    max_rate: data.max_rate ?? DEFAULT_POINT_BOOST_SETTINGS.max_rate,
    compare_top_n: data.compare_top_n ?? DEFAULT_POINT_BOOST_SETTINGS.compare_top_n,
    campaign_days: data.campaign_days ?? DEFAULT_POINT_BOOST_SETTINGS.campaign_days,
  };
}

/** 設定を保存（upsert）。 */
export async function upsertPointBoostSettings(
  supabase: SupabaseClient,
  userId: string,
  settings: PointBoostSettings,
): Promise<void> {
  const { error } = await supabase.from("point_boost_settings").upsert({
    user_id: userId,
    ...settings,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

/** 実行レコードを作成し runId を返す。 */
export async function createRun(
  supabase: SupabaseClient,
  userId: string,
  opts: { trigger: "manual" | "scheduled"; dryRun: boolean },
): Promise<string> {
  const { data, error } = await supabase
    .from("point_boost_runs")
    .insert({ user_id: userId, trigger: opts.trigger, dry_run: opts.dryRun, status: "running" })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

/** 実行レコードを完了状態にする。 */
export async function finishRun(
  supabase: SupabaseClient,
  runId: string,
  patch: Partial<RunTotals> & { status: "done" | "error"; error?: string },
): Promise<void> {
  const { error } = await supabase
    .from("point_boost_runs")
    .update({ ...patch, finished_at: new Date().toISOString() })
    .eq("id", runId);
  if (error) throw error;
}

/** 商品別結果をまとめて保存（50件ずつ分割 insert）。 */
export async function insertResults(
  supabase: SupabaseClient,
  userId: string,
  runId: string,
  results: ProductResult[],
): Promise<void> {
  const rows = results.map((r) => ({
    run_id: runId,
    user_id: userId,
    product_id: r.product_id,
    ne_code: r.ne_code,
    product_name: r.product_name,
    rakuten_manage_number: r.rakuten_manage_number,
    search_keyword: r.search_keyword,
    keyword_type: r.keyword_type,
    matched_count: r.matched_count,
    competitors: r.competitors,
    competitor_max_rate: r.competitor_max_rate,
    current_rate: r.current_rate,
    target_rate: r.target_rate,
    capped: r.capped,
    action: r.action,
    detail: r.detail,
  }));
  for (let i = 0; i < rows.length; i += 50) {
    const { error } = await supabase.from("point_boost_results").insert(rows.slice(i, i + 50));
    if (error) throw error;
  }
}

export type RunRow = {
  id: string;
  trigger: string;
  dry_run: boolean;
  status: string;
  started_at: string;
  finished_at: string | null;
  total_targets: number;
  boosted_count: number;
  cleared_count: number;
  unchanged_count: number;
  no_competitor_count: number;
  skipped_count: number;
  error_count: number;
  error: string;
};

/** 実行履歴（新しい順）。 */
export async function listRuns(
  supabase: SupabaseClient,
  userId: string,
  limit = 20,
): Promise<RunRow[]> {
  const { data, error } = await supabase
    .from("point_boost_runs")
    .select("*")
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as RunRow[];
}

export type ResultRow = ProductResult & { id: string; run_id: string; created_at: string };

/** 1回の実行の商品別結果。 */
export async function listResultsForRun(
  supabase: SupabaseClient,
  userId: string,
  runId: string,
): Promise<ResultRow[]> {
  const { data, error } = await supabase
    .from("point_boost_results")
    .select("*")
    .eq("user_id", userId)
    .eq("run_id", runId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ResultRow[];
}

/** 実行対象 = 楽天掲載済み（mallPresence().rakuten）かつ商品管理番号を持つ商品。
 * products を1000件ずつページングし、SKU（variants）の JAN・価格も添えて返す。
 * 復元(zod)に失敗した行は壊れ行として黙ってスキップせず ne_code を invalid に積む。 */
export async function fetchRakutenTargets(
  supabase: SupabaseClient,
  userId: string,
  limit?: number,
): Promise<{ targets: BoostTarget[]; invalid: string[] }> {
  const targets: BoostTarget[] = [];
  const invalid: string[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("user_id", userId)
      .order("ne_code", { ascending: true })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as ProductRow[];
    for (const row of rows) {
      try {
        const p = dbRowToProductInput(row);
        if (!mallPresence(p).rakuten) continue;
        const manageNumber = (p.rakuten_manage_number ?? "").trim();
        if (!manageNumber) continue; // 掲載フラグのみで番号不明の旧データは対象外（結果に出さない）
        const skus = productVariants(p).map((v) => ({
          janCode: (v.jan_code || p.jan_code || "").trim(),
          sellingPrice: v.selling_price || p.selling_price || 0,
          label: v.variation_value || v.ne_code || p.ne_code,
        }));
        targets.push({
          productId: row.id,
          neCode: p.ne_code,
          productName: p.product_name,
          displayName: p.display_name || p.product_name,
          manageNumber,
          skus,
        });
      } catch {
        invalid.push(String(row.ne_code ?? row.id));
      }
      if (limit && targets.length >= limit) return { targets, invalid };
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return { targets, invalid };
}
