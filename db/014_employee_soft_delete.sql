ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_employees_not_deleted
  ON employees(active, role, name)
  WHERE deleted_at IS NULL;
