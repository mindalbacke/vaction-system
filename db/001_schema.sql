CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  employee_number text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('서무','음향보조','조명보조','중계보조')),
  studio_work_eligible boolean NOT NULL DEFAULT false,
  substitute_eligible boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shift_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  start_time time NOT NULL,
  end_time time NOT NULL,
  crosses_midnight boolean NOT NULL DEFAULT false,
  morning_leave_start time,
  morning_leave_end time,
  afternoon_leave_start time,
  afternoon_leave_end time,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  work_date date NOT NULL,
  shift_type_id uuid REFERENCES shift_types(id),
  start_datetime timestamptz NOT NULL,
  end_datetime timestamptz NOT NULL,
  assignment_type text NOT NULL DEFAULT '근무',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(employee_id, work_date, assignment_type)
);

CREATE TABLE IF NOT EXISTS leave_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  year integer NOT NULL,
  total_days numeric(5,1) NOT NULL DEFAULT 0,
  used_days numeric(5,1) NOT NULL DEFAULT 0,
  remaining_days numeric(5,1) GENERATED ALWAYS AS (total_days - used_days) STORED,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(employee_id, year),
  CHECK (used_days >= 0 AND used_days <= total_days)
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  leave_date date NOT NULL,
  leave_type text NOT NULL CHECK (leave_type IN ('전반','후반')),
  start_datetime timestamptz NOT NULL,
  end_datetime timestamptz NOT NULL,
  status text NOT NULL DEFAULT '등록 완료',
  substitute_required boolean NOT NULL DEFAULT false,
  cancelled boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_leave ON leave_requests(employee_id, leave_date, leave_type) WHERE cancelled = false;

CREATE TABLE IF NOT EXISTS news_program_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_name text NOT NULL UNIQUE,
  default_start_time time,
  default_duration_minutes integer NOT NULL,
  preparation_minutes integer NOT NULL DEFAULT 0,
  cleanup_minutes integer NOT NULL DEFAULT 0,
  required_staff integer NOT NULL CHECK (required_staff > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_news_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_date date NOT NULL,
  program_template_id uuid NOT NULL REFERENCES news_program_templates(id),
  actual_start_datetime timestamptz NOT NULL,
  actual_end_datetime timestamptz NOT NULL,
  preparation_minutes integer NOT NULL,
  cleanup_minutes integer NOT NULL,
  required_staff integer NOT NULL,
  live_broadcast boolean NOT NULL DEFAULT true,
  schedule_changed boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(schedule_date, program_template_id)
);

CREATE TABLE IF NOT EXISTS relay_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  start_datetime timestamptz NOT NULL,
  end_datetime timestamptz NOT NULL,
  location text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS relay_schedule_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relay_schedule_id uuid NOT NULL REFERENCES relay_schedules(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(relay_schedule_id, employee_id)
);

CREATE TABLE IF NOT EXISTS substitute_unavailability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  start_datetime timestamptz NOT NULL,
  end_datetime timestamptz NOT NULL,
  reason_type text NOT NULL,
  reason_detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS substitute_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leave_request_id uuid NOT NULL REFERENCES leave_requests(id),
  news_schedule_id uuid REFERENCES daily_news_schedules(id),
  requester_id uuid NOT NULL REFERENCES employees(id),
  substitute_employee_id uuid REFERENCES employees(id),
  start_datetime timestamptz NOT NULL,
  end_datetime timestamptz NOT NULL,
  status text NOT NULL DEFAULT '대근자 미지정',
  response_note text,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shortage_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_date date NOT NULL,
  news_schedule_id uuid NOT NULL REFERENCES daily_news_schedules(id),
  start_datetime timestamptz NOT NULL,
  end_datetime timestamptz NOT NULL,
  required_staff integer NOT NULL,
  available_staff integer NOT NULL,
  shortage_count integer NOT NULL,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES employees(id),
  action_type text NOT NULL,
  target_table text NOT NULL,
  target_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION update_leave_balance() RETURNS trigger AS $$
DECLARE target_year integer;
BEGIN
  target_year := EXTRACT(YEAR FROM COALESCE(NEW.leave_date, OLD.leave_date));
  IF TG_OP = 'INSERT' AND NEW.cancelled = false THEN
    UPDATE leave_balances SET used_days = used_days + 0.5, updated_at = now()
      WHERE employee_id = NEW.employee_id AND year = target_year AND remaining_days >= 0.5;
    IF NOT FOUND THEN RAISE EXCEPTION '반차 잔액이 부족합니다.'; END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.cancelled = false AND NEW.cancelled = true THEN
    UPDATE leave_balances SET used_days = GREATEST(0, used_days - 0.5), updated_at = now()
      WHERE employee_id = NEW.employee_id AND year = target_year;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_leave_balance ON leave_requests;
CREATE TRIGGER trg_leave_balance
AFTER INSERT OR UPDATE OF cancelled ON leave_requests
FOR EACH ROW EXECUTE FUNCTION update_leave_balance();

CREATE INDEX IF NOT EXISTS idx_assignments_date ON daily_assignments(work_date);
CREATE INDEX IF NOT EXISTS idx_leave_date ON leave_requests(leave_date) WHERE cancelled = false;
CREATE INDEX IF NOT EXISTS idx_news_date ON daily_news_schedules(schedule_date);
CREATE INDEX IF NOT EXISTS idx_relay_range ON relay_schedules(start_datetime, end_datetime);
