-- 楽天 配送方法セット番号(shippingMethodGroup) → Yahoo!ショッピング postage_set マッピング。
-- 楽天は「自動選択以外の設定がある時のみ」shippingMethodGroup を返すため、多くの商品は空になる。
-- rakuten_shipping_group='' を「既定」行として使い、空の商品はこの既定 postage_set で賄う。
-- 全ユーザー共通の参照マスタ。CSV/値で seed（docs/しまのや/rakuten_yahoo_shipping_mapping.csv）。
CREATE TABLE IF NOT EXISTS rakuten_yahoo_shipping_mapping (
  rakuten_shipping_group text PRIMARY KEY,   -- 楽天 shippingMethodGroup（""=既定便/未設定の商品向け既定行）
  yahoo_postage_set text DEFAULT '',         -- 紐付けた Yahoo postage_set ID
  note text DEFAULT ''
);

-- 参照マスタ: 認証済みユーザーは全件 SELECT 可。書き込みは Service Role / 直接DB接続のみ。
ALTER TABLE rakuten_yahoo_shipping_mapping ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated can read shipping mapping" ON rakuten_yahoo_shipping_mapping;
CREATE POLICY "Authenticated can read shipping mapping" ON rakuten_yahoo_shipping_mapping
  FOR SELECT USING (auth.role() = 'authenticated');
