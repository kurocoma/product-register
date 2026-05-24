CREATE TABLE history (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES auth.users NOT NULL,
  action text NOT NULL CHECK (action IN ('create', 'edit', 'csv_export', 'delete')),
  product_id uuid REFERENCES products ON DELETE SET NULL,
  detail jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_history_user_id ON history(user_id, created_at DESC);
