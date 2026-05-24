CREATE TABLE settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users,
  rakuten_store_id text DEFAULT '',
  rakuten_cabinet_url_base text DEFAULT '',
  yahoo_store_id text DEFAULT '',
  shopify_store_id text DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
