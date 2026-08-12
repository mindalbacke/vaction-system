ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS schedule_color smallint;

WITH ranked AS (
  SELECT id, mod(row_number() OVER (ORDER BY role, employee_number) - 1, 12)::smallint AS color_index
  FROM employees
  WHERE role IN ('음향보조', '조명보조', '중계보조')
)
UPDATE employees employee
SET schedule_color = ranked.color_index
FROM ranked
WHERE employee.id = ranked.id AND employee.schedule_color IS NULL;

UPDATE employees SET schedule_color = 0 WHERE schedule_color IS NULL;

ALTER TABLE employees
  ALTER COLUMN schedule_color SET DEFAULT 0,
  ALTER COLUMN schedule_color SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'employees_schedule_color_check'
  ) THEN
    ALTER TABLE employees
      ADD CONSTRAINT employees_schedule_color_check CHECK (schedule_color BETWEEN 0 AND 11);
  END IF;
END $$;
