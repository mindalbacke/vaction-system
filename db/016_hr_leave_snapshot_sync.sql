CREATE TABLE IF NOT EXISTS hr_leave_snapshots (
  employee_id uuid PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  snapshot jsonb NOT NULL,
  hr_synced_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hr_leave_snapshots_updated_at
  ON hr_leave_snapshots(updated_at DESC);
