-- 楽天ジャンル → Yahoo!ショッピングカテゴリ マッピング。
-- 楽天ジャンルID(=モール基本カテゴリID)ごとに、推定された Yahoo カテゴリを1件保持する
-- 全ユーザー共通の参照マスタ。決定的アルゴリズム + LLM 判定のハイブリッドで生成
-- (docs/rakuten_yahoo_category_mapping.csv / scripts/build_full_category_mapping.py)。
CREATE TABLE IF NOT EXISTS rakuten_yahoo_category_mapping (
  genre_id text PRIMARY KEY,                 -- 楽天ジャンルID（=mall_category_id）。1ジャンル1行。
  rakuten_path text DEFAULT '',              -- 楽天ジャンルの階層パス（CD・DVD >> Blu-ray >> ...）
  yahoo_category_id text DEFAULT '',         -- 紐付けた Yahoo カテゴリID（該当なしは空）
  yahoo_category_name text DEFAULT '',       -- Yahoo カテゴリ末端名
  yahoo_path text DEFAULT '',                -- Yahoo カテゴリの階層パス（食品 > ... > 泡盛）
  confidence text DEFAULT '',                -- 確度（高 / 中 / 低 / なし）
  match_method text DEFAULT ''               -- 手法（deterministic-* / llm / no-candidate）
);

-- 参照マスタ: 認証済みユーザーは全件 SELECT 可。書き込みは Service Role / 直接DB接続のみ。
ALTER TABLE rakuten_yahoo_category_mapping ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated can read category mapping" ON rakuten_yahoo_category_mapping;
CREATE POLICY "Authenticated can read category mapping" ON rakuten_yahoo_category_mapping
  FOR SELECT USING (auth.role() = 'authenticated');
