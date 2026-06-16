-- 楽天市場 商品属性リスト（ichiba_attribute_list）。
-- ジャンルID(=モール基本カテゴリID)ごとの推奨属性項目・単位・必須区分を保持する全ユーザー共通の参照マスタ。
CREATE TABLE IF NOT EXISTS rakuten_genre_attributes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  genre_id text NOT NULL,                 -- ジャンルID（楽天カテゴリID）
  path_name text DEFAULT '',              -- パス名（CD・DVD >> Blu-ray >> ...）
  item_name text NOT NULL,                -- 項目名（日本語）
  requirement text DEFAULT '',            -- 必須/任意（必須・いずれか必須・ナビゲーション用任意・商品ページ用任意）
  input_method text DEFAULT '',           -- 入力方式（記述式・選択式）
  has_choices boolean DEFAULT false,      -- 推奨値・選択肢の有無
  has_unit boolean DEFAULT false,         -- 単位有無
  recommended_unit text DEFAULT '',       -- 楽天推奨単位（例: 分）
  unit_choices text DEFAULT '',           -- 楽天推奨単位一覧（パイプ区切り 例: 分|時間）
  max_length integer,                     -- 最大文字数
  multiple_allowed boolean DEFAULT false, -- 複数値可不可
  sort_order integer DEFAULT 0            -- 並び順
);

-- ジャンルIDで属性一覧を並び順つきで引くための複合インデックス
CREATE INDEX IF NOT EXISTS idx_rga_genre_id ON rakuten_genre_attributes(genre_id, sort_order);

-- 参照マスタ: 認証済みユーザーは全件 SELECT 可。書き込みは Service Role のみ（ポリシー無し=anon/auth は不可）。
ALTER TABLE rakuten_genre_attributes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated can read genre attributes" ON rakuten_genre_attributes;
CREATE POLICY "Authenticated can read genre attributes" ON rakuten_genre_attributes
  FOR SELECT USING (auth.role() = 'authenticated');
