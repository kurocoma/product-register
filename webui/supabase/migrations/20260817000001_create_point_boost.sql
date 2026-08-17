-- ポイント変倍最適化（point-boost）: 設定・実行履歴・商品別結果の3テーブル
-- 既存 products と同じく public スキーマ・user_id + RLS（本人のみ全操作）。
-- 適用: cd webui && node scripts/apply_sql.mjs supabase/migrations/20260817000001_create_point_boost.sql

CREATE TABLE IF NOT EXISTS point_boost_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users,
  -- 自動実行（scheduled）の安全弁。手動実行は無効中でも可（動作確認用）
  enabled boolean NOT NULL DEFAULT false,
  -- 競合最大倍率にいくつ上乗せするか（決定事項: +1）
  plus_rate integer NOT NULL DEFAULT 1,
  -- 上限倍率（決定事項: 3倍。ポイント原資は店舗負担のためコストガード）
  max_rate integer NOT NULL DEFAULT 3,
  -- 最安値上位何店の倍率を比較対象にするか
  compare_top_n integer NOT NULL DEFAULT 3,
  -- pointCampaign の適用日数（1日2回の実行で都度延長される）
  campaign_days integer NOT NULL DEFAULT 7,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS point_boost_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  trigger text NOT NULL DEFAULT 'manual',   -- manual | scheduled
  dry_run boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'running',   -- running | done | error
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  total_targets integer NOT NULL DEFAULT 0,
  boosted_count integer NOT NULL DEFAULT 0,
  cleared_count integer NOT NULL DEFAULT 0,
  unchanged_count integer NOT NULL DEFAULT 0,
  no_competitor_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  error text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_point_boost_runs_user ON point_boost_runs(user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS point_boost_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES point_boost_runs(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users NOT NULL,
  product_id uuid,
  ne_code text NOT NULL DEFAULT '',
  product_name text NOT NULL DEFAULT '',
  rakuten_manage_number text NOT NULL DEFAULT '',
  search_keyword text NOT NULL DEFAULT '',
  keyword_type text NOT NULL DEFAULT 'jan', -- jan | name
  matched_count integer NOT NULL DEFAULT 0,
  -- 競合スナップショット（価格昇順の上位、{shopCode,shopName,itemName,itemPrice,pointRate,itemUrl}[]）
  competitors jsonb NOT NULL DEFAULT '[]',
  competitor_max_rate integer,
  current_rate integer,
  target_rate integer,
  capped boolean NOT NULL DEFAULT false,
  -- boosted | cleared | unchanged | no_competitor | skipped | error
  action text NOT NULL DEFAULT 'skipped',
  detail text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_point_boost_results_run ON point_boost_results(run_id);
CREATE INDEX IF NOT EXISTS idx_point_boost_results_user ON point_boost_results(user_id, created_at DESC);

-- RLS（既存 products と同パターン: 本人のみ全操作）
ALTER TABLE point_boost_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE point_boost_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE point_boost_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own point_boost_settings" ON point_boost_settings;
CREATE POLICY "Users can manage own point_boost_settings" ON point_boost_settings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can manage own point_boost_runs" ON point_boost_runs;
CREATE POLICY "Users can manage own point_boost_runs" ON point_boost_runs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can manage own point_boost_results" ON point_boost_results;
CREATE POLICY "Users can manage own point_boost_results" ON point_boost_results
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
