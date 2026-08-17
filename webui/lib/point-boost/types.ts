/** ポイント変倍最適化（point-boost）の共有型と既定値。要件: docs/point-boost/requirements.md */

export type PointBoostSettings = {
  /** 自動実行（scheduled）の安全弁。手動実行は無効中でも可（動作確認用） */
  enabled: boolean;
  /** 競合最大倍率への上乗せ（決定事項: +1） */
  plus_rate: number;
  /** 上限倍率（決定事項: 3倍。ポイント原資は店舗負担のためのコストガード） */
  max_rate: number;
  /** 最安値上位何店の倍率を比較するか */
  compare_top_n: number;
  /** pointCampaign の適用日数（実行のたびに延長される） */
  campaign_days: number;
};

export const DEFAULT_POINT_BOOST_SETTINGS: PointBoostSettings = {
  enabled: false,
  plus_rate: 1,
  max_rate: 3,
  compare_top_n: 3,
  campaign_days: 7,
};

/** 競合スナップショット1件（results.competitors jsonb に保存する形） */
export type Competitor = {
  shopCode: string;
  shopName: string;
  itemName: string;
  itemPrice: number;
  pointRate: number;
  itemUrl: string;
};

export type PointBoostAction =
  | "boosted"       // 変倍を設定/更新した（dry-run では「する予定」）
  | "cleared"       // 競合が弱くなったため解除した（/解除を試みた）
  | "unchanged"     // 既に目標倍率で適用中（期間も十分）
  | "no_competitor" // 有効な競合が見つからず現状維持
  | "skipped"       // 対象外（商品管理番号なし等）
  | "error";        // API エラー等

export type ProductResult = {
  product_id: string | null;
  ne_code: string;
  product_name: string;
  rakuten_manage_number: string;
  search_keyword: string;
  keyword_type: "jan" | "name";
  matched_count: number;
  competitors: Competitor[];
  competitor_max_rate: number | null;
  current_rate: number | null;
  target_rate: number | null;
  capped: boolean;
  action: PointBoostAction;
  detail: string;
};

export type RunTotals = {
  total_targets: number;
  boosted_count: number;
  cleared_count: number;
  unchanged_count: number;
  no_competitor_count: number;
  skipped_count: number;
  error_count: number;
};

export type RunSummary = {
  runId: string | null;
  dryRun: boolean;
  trigger: "manual" | "scheduled";
  status: "done" | "error" | "not_configured" | "disabled";
  message: string;
  totals: RunTotals;
  results: ProductResult[];
};

/** 実行対象1商品（repository.fetchRakutenTargets が products から組み立てる） */
export type BoostTarget = {
  productId: string;
  neCode: string;
  productName: string;
  displayName: string;
  manageNumber: string;
  /** SKU単位の突合キー（JAN と販売価格）。フラット商品は1件合成される */
  skus: { janCode: string; sellingPrice: number; label: string }[];
};
