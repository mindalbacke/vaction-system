CREATE TABLE IF NOT EXISTS audio_rotation_settings (
  employee_id uuid PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  start_shift text NOT NULL CHECK (start_shift IN ('A', 'U')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

WITH ranked_audio AS (
  SELECT id, row_number() OVER (ORDER BY employee_number) - 1 AS audio_rank
  FROM employees
  WHERE role = '음향보조'
)
INSERT INTO audio_rotation_settings (employee_id, start_date, start_shift)
SELECT id, DATE '2026-08-03', CASE WHEN mod(audio_rank, 2) = 0 THEN 'U' ELSE 'A' END
FROM ranked_audio
ON CONFLICT (employee_id) DO NOTHING;

WITH news_coverage AS (
  SELECT sr.id,
    min(dns.actual_start_datetime - make_interval(mins => dns.preparation_minutes)) AS coverage_start,
    max(dns.actual_end_datetime + make_interval(mins => dns.cleanup_minutes)) AS coverage_end
  FROM substitute_requests sr
  JOIN leave_requests lr ON lr.id = sr.leave_request_id
  JOIN daily_news_schedules dns
    ON dns.schedule_date = lr.leave_date AND dns.cancelled = false
    AND dns.actual_start_datetime - make_interval(mins => dns.preparation_minutes) < lr.end_datetime
    AND dns.actual_end_datetime + make_interval(mins => dns.cleanup_minutes) > lr.start_datetime
  GROUP BY sr.id
)
UPDATE substitute_requests sr
SET start_datetime = news_coverage.coverage_start,
    end_datetime = news_coverage.coverage_end,
    updated_at = now()
FROM news_coverage
WHERE sr.id = news_coverage.id;
