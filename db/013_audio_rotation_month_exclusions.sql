CREATE TABLE IF NOT EXISTS audio_rotation_month_exclusions (
  month_start date PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (month_start = date_trunc('month', month_start)::date)
);
