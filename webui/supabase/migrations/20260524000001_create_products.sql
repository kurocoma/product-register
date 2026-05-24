CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES auth.users NOT NULL,
  ne_code text NOT NULL,
  jan_code text NOT NULL,
  maker_code text NOT NULL,
  product_type text NOT NULL,
  quantity int NOT NULL,
  product_name text NOT NULL,
  display_name text NOT NULL,
  tax_rate int NOT NULL CHECK (tax_rate IN (8, 10)),
  cost_price int DEFAULT 0,
  selling_price int NOT NULL,
  shipping_type text NOT NULL,
  image_count int NOT NULL,
  delivery_method int NOT NULL,
  lead_time int NOT NULL,
  mall_category_id text NOT NULL,
  store_category text DEFAULT '',
  yahoo_category_id text DEFAULT '',
  yahoo_path text DEFAULT '',
  unit text DEFAULT '',
  yahoo_grouping_enabled bool NOT NULL DEFAULT false,
  yahoo_variation_title text DEFAULT '',
  description_pc text DEFAULT '',
  description_sp text DEFAULT '',
  catch_copy_pc text DEFAULT '',
  catch_copy_yahoo text DEFAULT '',
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, ne_code)
);

CREATE INDEX idx_products_user_id ON products(user_id);
CREATE INDEX idx_products_ne_code ON products(user_id, ne_code);
