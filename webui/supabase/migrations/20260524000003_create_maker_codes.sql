CREATE TABLE maker_codes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES auth.users NOT NULL,
  maker_code text NOT NULL,
  maker_name text NOT NULL,
  product_code_prefix text DEFAULT '',
  UNIQUE (user_id, maker_code)
);
