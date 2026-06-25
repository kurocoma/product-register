-- 統合商品マスタ(Phase 1): ne_code をスパインに NE+Excel を統合する3テーブル
-- 既存 products と同じく無修飾(public)・user_id + RLS。

CREATE TABLE ne_item_master (
  user_id uuid REFERENCES auth.users NOT NULL,
  ne_code text NOT NULL,
  jan_code text NOT NULL DEFAULT '',
  name text NOT NULL DEFAULT '',
  selling_price integer,
  tax_rate integer,
  cost_price integer,
  category text NOT NULL DEFAULT '',
  supplier text NOT NULL DEFAULT '',
  is_set boolean NOT NULL DEFAULT false,
  is_discontinued boolean NOT NULL DEFAULT false,
  zaiko_renkei text NOT NULL DEFAULT '',
  daihyo_code text NOT NULL DEFAULT '',
  sources text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, ne_code)
);
CREATE INDEX idx_ne_item_master_jan ON ne_item_master(user_id, jan_code);

CREATE TABLE ne_set_composition (
  user_id uuid REFERENCES auth.users NOT NULL,
  set_ne_code text NOT NULL,
  component_ne_code text NOT NULL,
  suryo integer NOT NULL DEFAULT 1,
  set_name text NOT NULL DEFAULT '',
  set_price integer,
  tax_rate integer,
  PRIMARY KEY (user_id, set_ne_code, component_ne_code)
);
CREATE INDEX idx_ne_set_comp_component ON ne_set_composition(user_id, component_ne_code);

CREATE TABLE ne_mall_code (
  user_id uuid REFERENCES auth.users NOT NULL,
  ne_code text NOT NULL,
  mall text NOT NULL,
  manage_no text NOT NULL DEFAULT '',
  jan_code text NOT NULL DEFAULT '',
  PRIMARY KEY (user_id, ne_code, mall)
);
CREATE INDEX idx_ne_mall_code_ne ON ne_mall_code(user_id, ne_code);

-- RLS（既存 products と同パターン: 本人のみ全操作）
ALTER TABLE ne_item_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE ne_set_composition ENABLE ROW LEVEL SECURITY;
ALTER TABLE ne_mall_code ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own ne_item_master" ON ne_item_master
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can manage own ne_set_composition" ON ne_set_composition
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can manage own ne_mall_code" ON ne_mall_code
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
