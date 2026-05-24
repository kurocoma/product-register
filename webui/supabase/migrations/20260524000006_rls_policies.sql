-- products
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own products" ON products
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- settings
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own settings" ON settings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- maker_codes
ALTER TABLE maker_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own maker codes" ON maker_codes
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- history
ALTER TABLE history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own history" ON history
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own history" ON history
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- product_templates
ALTER TABLE product_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own templates" ON product_templates
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
