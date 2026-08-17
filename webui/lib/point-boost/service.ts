/** ポイント変倍最適化の実行本体。IO（検索API・RMS API・DB）の編成のみを行い、
 * 判定は planner/matcher/rate-rule の純関数に委ねる。
 * supabase・資格情報は注入式: HTTPルート（セッション+RLS）と定期実行スクリプト
 * （service role + 明示 userId）の双方から同じ関数を使う。 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { rakutenTaxInclusive } from "@/lib/converters";
import {
  DEFAULT_RAKUTEN_STORE,
  createQpsPacer,
  getItem,
  isIchibaRateLimited,
  patchItem,
  searchIchibaItems,
  type IchibaSearchResult,
  type RakutenCredentials,
} from "@/lib/rakuten";
import { JAN_NAME_MATCH_THRESHOLD, filterCompetitors, normalizeNameKeyword } from "./matcher";
import { parsePointCampaign, buildBoostPatch } from "./point-campaign";
import { planProduct, type SkuCompetitors } from "./planner";
import {
  createRun,
  deleteResultsForRun,
  fetchRakutenTargets,
  finishRun,
  getPointBoostSettings,
  insertResults,
} from "./repository";
import type { BoostTarget, Competitor, ProductResult, RunSummary, RunTotals } from "./types";

export type PointBoostDeps = {
  supabase: SupabaseClient;
  userId: string;
  /** RMS ESA 認証（現状照会と変倍PATCHに必要） */
  rmsCred: RakutenCredentials | null;
  /** 楽天ウェブサービスの applicationId（競合検索に必要） */
  applicationId: string | null;
  /** 自店の shopCode（競合から除外する）。既定 DEFAULT_RAKUTEN_STORE */
  ownShopCode?: string;
  /** テスト注入用 */
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  log?: (msg: string) => void;
};

export type RunOptions = {
  /** 既定 true（照会のみ。RMS への PATCH は dryRun:false 明示時だけ） */
  dryRun?: boolean;
  trigger?: "manual" | "scheduled";
  /** 処理する商品数の上限（HTTPルートのタイムアウト対策。未指定 = 全件） */
  limit?: number;
};

/** 1商品あたり検索するSKU数の上限（実行時間の安全弁） */
const MAX_SKU_SEARCH = 5;
/** 検索APIエラーがこの回数連続したら実行を中断する（障害時に叩き続けない） */
const MAX_CONSECUTIVE_SEARCH_FAILURES = 5;
/** 結果に保存する競合スナップショットの件数 */
const MAX_COMPETITOR_SNAPSHOT = 5;

const emptyTotals = (): RunTotals => ({
  total_targets: 0,
  boosted_count: 0,
  cleared_count: 0,
  unchanged_count: 0,
  no_competitor_count: 0,
  skipped_count: 0,
  error_count: 0,
});

export async function runPointBoost(deps: PointBoostDeps, options: RunOptions = {}): Promise<RunSummary> {
  const dryRun = options.dryRun !== false; // 既定は dry-run（安全側）
  const trigger = options.trigger ?? "manual";
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  const ownShopCode = deps.ownShopCode ?? DEFAULT_RAKUTEN_STORE;

  const settings = await getPointBoostSettings(deps.supabase, deps.userId);

  // 自動実行の安全弁: 設定が無効なら何もしない（手動実行は動作確認のため通す）
  if (trigger === "scheduled" && !settings.enabled) {
    return {
      runId: null, dryRun, trigger, status: "disabled",
      message: "ポイント変倍の設定が無効のためスキップしました（画面の設定で有効にすると自動実行されます）",
      totals: emptyTotals(), results: [],
    };
  }
  if (!deps.applicationId) {
    return {
      runId: null, dryRun, trigger, status: "not_configured",
      message:
        "楽天ウェブサービスの applicationId が未設定です。https://webservice.rakuten.co.jp/ でアプリ登録し、webui/.env.local に RAKUTEN_APPLICATION_ID=... を追加してください",
      totals: emptyTotals(), results: [],
    };
  }
  if (!deps.rmsCred) {
    return {
      runId: null, dryRun, trigger, status: "not_configured",
      message: "楽天 ESA 認証情報（RAKUTEN_SERVICE_SECRET / RAKUTEN_LICENSE_KEY）が未設定です",
      totals: emptyTotals(), results: [],
    };
  }
  const applicationId = deps.applicationId;
  const rmsCred = deps.rmsCred;

  const runId = await createRun(deps.supabase, deps.userId, { trigger, dryRun });
  const totals = emptyTotals();
  const results: ProductResult[] = [];

  try {
    const { targets, invalid } = await fetchRakutenTargets(deps.supabase, deps.userId, options.limit);
    totals.total_targets = targets.length;
    log(`対象 ${targets.length} 件（復元失敗 ${invalid.length} 件）`);

    for (const neCode of invalid) {
      results.push(emptyResult(neCode, "error", "商品データの復元に失敗しました（スキーマ検証エラー）"));
      totals.error_count++;
    }

    // 楽天API負荷対策: 検索・RMSとも直列＋最低1100ms間隔（既存慣例）。同一キーワードはキャッシュ。
    const wsPace = createQpsPacer({ sleep: deps.sleep });
    const rmsPace = createQpsPacer({ sleep: deps.sleep });
    const searchCache = new Map<string, IchibaSearchResult>();
    let consecutiveSearchFailures = 0;

    const search = async (keyword: string): Promise<IchibaSearchResult> => {
      const cached = searchCache.get(keyword);
      if (cached) return cached;
      const result = await wsPace(
        () => searchIchibaItems(applicationId, { keyword }),
        isIchibaRateLimited,
      );
      // 成功時のみキャッシュ（一過性の429/503が run 全体に固定化されるのを防ぐ）
      if (result.ok) searchCache.set(keyword, result);
      consecutiveSearchFailures = result.ok ? 0 : consecutiveSearchFailures + 1;
      return result;
    };

    for (const target of targets) {
      if (consecutiveSearchFailures >= MAX_CONSECUTIVE_SEARCH_FAILURES) {
        throw new Error("検索APIのエラーが連続したため実行を中断しました（時間をおいて再実行してください）");
      }
      try {
        const r = await processTarget(target, {
          search, rmsPace, rmsCred, ownShopCode, settings, dryRun, now: now(),
        });
        results.push(r);
        totals[actionCountKey(r.action)]++;
      } catch (e) {
        results.push(emptyResult(target.neCode, "error", e instanceof Error ? e.message : String(e), target));
        totals.error_count++;
      }
    }

    await insertResults(deps.supabase, deps.userId, runId, results);
    await finishRun(deps.supabase, runId, { status: "done", ...totals });
    return {
      runId, dryRun, trigger, status: "done",
      message: dryRun
        ? `dry-run 完了: 対象${totals.total_targets}件 / 変倍予定${totals.boosted_count}件 / 変更なし${totals.unchanged_count}件`
        : `実行完了: 対象${totals.total_targets}件 / 変倍${totals.boosted_count}件 / 変更なし${totals.unchanged_count}件 / エラー${totals.error_count}件`,
      totals, results,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // 途中までの結果は保存を試みる。部分保存済みの可能性があるため先に消して冪等にする
    // （point_boost_results に unique 制約が無く、再insertだけだと二重登録になる）
    try {
      await deleteResultsForRun(deps.supabase, deps.userId, runId);
      await insertResults(deps.supabase, deps.userId, runId, results);
    } catch { /* noop */ }
    try { await finishRun(deps.supabase, runId, { status: "error", error: message, ...totals }); } catch { /* noop */ }
    return { runId, dryRun, trigger, status: "error", message, totals, results };
  }
}

type ProcessCtx = {
  search: (keyword: string) => Promise<IchibaSearchResult>;
  rmsPace: ReturnType<typeof createQpsPacer>;
  rmsCred: RakutenCredentials;
  ownShopCode: string;
  settings: Awaited<ReturnType<typeof getPointBoostSettings>>;
  dryRun: boolean;
  now: Date;
};

async function processTarget(target: BoostTarget, ctx: ProcessCtx): Promise<ProductResult> {
  // 1) SKUごとにJANで競合検索（同一JANはキャッシュで1回に集約される）。
  // JANは他店の説明文マッチで姉妹品等が混ざるため、税込換算した価格帯ガード＋緩い商品名検証を通す
  const skuCompetitors: SkuCompetitors[] = [];
  const searchErrors: string[] = [];
  for (const sku of target.skus.slice(0, MAX_SKU_SEARCH)) {
    if (!/^\d{13}$/.test(sku.janCode)) continue;
    const res = await ctx.search(sku.janCode);
    if (!res.ok) {
      searchErrors.push(`JAN ${sku.janCode}: ${res.message}`);
      continue;
    }
    skuCompetitors.push({
      keyword: sku.janCode,
      keywordType: "jan",
      competitors: filterCompetitors(res.items, {
        ownShopCode: ctx.ownShopCode,
        // 検索APIの itemPrice は税込・selling_price は税抜統一のため税込換算して比較する
        ownPrice: rakutenTaxInclusive(sku.sellingPrice, sku.taxRate),
        ownName: target.displayName,
        nameThreshold: JAN_NAME_MATCH_THRESHOLD,
      }),
    });
  }

  // 2) JANで有効な競合ゼロなら掲載商品名で1回だけ再検索（一致度で検証）。
  // 価格不明（repPrice=0）だと価格帯ガードが効かないため、その場合は名前検索しない（安全側）
  let keywordType: "jan" | "name" = "jan";
  const repSku = target.skus[0];
  const repPrice = repSku ? rakutenTaxInclusive(repSku.sellingPrice, repSku.taxRate) : 0;
  if (skuCompetitors.every((s) => s.competitors.length === 0) && repPrice > 0) {
    const nameKeyword = normalizeNameKeyword(target.displayName);
    if (nameKeyword) {
      const res = await ctx.search(nameKeyword);
      if (res.ok) {
        const competitors = filterCompetitors(res.items, {
          ownShopCode: ctx.ownShopCode,
          ownPrice: repPrice,
          ownName: target.displayName,
        });
        if (competitors.length > 0) {
          keywordType = "name";
          skuCompetitors.push({ keyword: nameKeyword, keywordType: "name", competitors });
        }
      } else {
        searchErrors.push(`商品名検索: ${res.message}`);
      }
    }
  }

  if (skuCompetitors.length === 0 && searchErrors.length > 0) {
    return emptyResult(target.neCode, "error", `競合検索に失敗しました: ${searchErrors.join(" / ")}`, target);
  }

  // 3) 現在の変倍状態を RMS から取得（404=商品なし は対象外、それ以外の失敗は error として区別）
  const item = await ctx.rmsPace(
    () => getItem(ctx.rmsCred, target.manageNumber),
    (r) => !r.exists && (r.status === 429 || r.status === 503),
  );
  if (!item.exists) {
    if (item.status === 404) {
      return emptyResult(
        target.neCode, "skipped",
        `楽天に商品が見つかりません（商品管理番号 ${target.manageNumber}）`,
        target,
      );
    }
    return emptyResult(
      target.neCode, "error",
      `RMS商品照会に失敗しました（商品管理番号 ${target.manageNumber} / HTTP ${item.status}）`,
      target,
    );
  }
  const current = parsePointCampaign(item.json);

  // 4) 計画（純関数）→ 反映
  const plan = planProduct(skuCompetitors, current, ctx.settings, ctx.now);
  let action: ProductResult["action"] = plan.action;
  let detail = plan.detail;

  if (!ctx.dryRun && plan.action === "boosted") {
    const patch = buildBoostPatch(plan.targetRate, ctx.now, ctx.settings.campaign_days);
    const res = await ctx.rmsPace(
      () => patchItem(ctx.rmsCred, target.manageNumber, patch),
      (r) => !r.ok && (r.status === 429 || r.status === 503),
    );
    if (!res.ok) {
      action = "error";
      detail = `変倍PATCHに失敗しました: ${res.message}`;
    }
  }

  const allCompetitors = skuCompetitors
    .flatMap((s) => s.competitors)
    .sort((a, b) => a.itemPrice - b.itemPrice);
  const snapshot: Competitor[] = dedupeByShop(allCompetitors).slice(0, MAX_COMPETITOR_SNAPSHOT);
  const keywords = [...new Set(skuCompetitors.map((s) => s.keyword))].join("、");

  return {
    product_id: target.productId,
    ne_code: target.neCode,
    product_name: target.productName,
    rakuten_manage_number: target.manageNumber,
    search_keyword: keywords,
    keyword_type: keywordType,
    matched_count: allCompetitors.length,
    competitors: snapshot,
    competitor_max_rate: plan.competitorMax,
    current_rate: current?.rate ?? null,
    target_rate: plan.targetRate,
    capped: plan.capped,
    action,
    detail: searchErrors.length > 0 ? `${detail}（一部検索失敗: ${searchErrors.join(" / ")}）` : detail,
  };
}

function dedupeByShop(list: Competitor[]): Competitor[] {
  const seen = new Set<string>();
  return list.filter((c) => {
    if (seen.has(c.shopCode)) return false;
    seen.add(c.shopCode);
    return true;
  });
}

function actionCountKey(action: ProductResult["action"]): keyof RunTotals {
  switch (action) {
    case "boosted": return "boosted_count";
    case "cleared": return "cleared_count";
    case "unchanged": return "unchanged_count";
    case "no_competitor": return "no_competitor_count";
    case "skipped": return "skipped_count";
    case "error": return "error_count";
  }
}

function emptyResult(
  neCode: string,
  action: ProductResult["action"],
  detail: string,
  target?: BoostTarget,
): ProductResult {
  return {
    product_id: target?.productId ?? null,
    ne_code: neCode,
    product_name: target?.productName ?? "",
    rakuten_manage_number: target?.manageNumber ?? "",
    search_keyword: "",
    keyword_type: "jan",
    matched_count: 0,
    competitors: [],
    competitor_max_rate: null,
    current_rate: null,
    target_rate: null,
    capped: false,
    action,
    detail,
  };
}
