-- 楽天 納期管理番号(normalDeliveryDateId) → Yahoo!ショッピング 発送日数(lead-time) マッピング。
-- 楽天 items.get は「納期管理番号(ID)」のみ返し日数そのものは返さないため、ID→日数 をここで定める。
-- rakuten_delivery_date_id='' を「既定」行として使う。
-- 全ユーザー共通の参照マスタ。CSV/値で seed（docs/しまのや/rakuten_yahoo_leadtime_mapping.csv）。
CREATE TABLE IF NOT EXISTS rakuten_yahoo_leadtime_mapping (
  rakuten_delivery_date_id text PRIMARY KEY, -- 楽天 normalDeliveryDateId（""=既定行）
  lead_time integer DEFAULT 1,               -- Yahoo へ送る発送日数(lead-time-instock/outstock)
  note text DEFAULT ''
);

-- 参照マスタ: 認証済みユーザーは全件 SELECT 可。書き込みは Service Role / 直接DB接続のみ。
ALTER TABLE rakuten_yahoo_leadtime_mapping ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated can read leadtime mapping" ON rakuten_yahoo_leadtime_mapping;
CREATE POLICY "Authenticated can read leadtime mapping" ON rakuten_yahoo_leadtime_mapping
  FOR SELECT USING (auth.role() = 'authenticated');
