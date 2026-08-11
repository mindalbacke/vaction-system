INSERT INTO shift_types (name, start_time, end_time, crosses_midnight, morning_leave_start, morning_leave_end, afternoon_leave_start, afternoon_leave_end)
VALUES
  ('A','09:00','18:00',false,'09:00','13:00','14:00','18:00'),
  ('R','13:00','21:00',false,'13:00','17:00','17:00','21:00'),
  ('U','16:00','01:00',true,'16:00','20:00',NULL,NULL)
ON CONFLICT (name) DO UPDATE SET
  start_time = EXCLUDED.start_time,
  end_time = EXCLUDED.end_time,
  crosses_midnight = EXCLUDED.crosses_midnight,
  morning_leave_start = EXCLUDED.morning_leave_start,
  morning_leave_end = EXCLUDED.morning_leave_end,
  afternoon_leave_start = EXCLUDED.afternoon_leave_start,
  afternoon_leave_end = EXCLUDED.afternoon_leave_end,
  active = true;

INSERT INTO employees (name, employee_number, role, studio_work_eligible, substitute_eligible)
VALUES
  ('김민준','24017','음향보조',true,true),
  ('박서연','23108','조명보조',true,true),
  ('이도윤','22031','음향보조',true,true),
  ('최지우','25102','중계보조',false,true),
  ('정하린','24113','중계보조',false,true),
  ('한예준','21004','서무',false,false)
ON CONFLICT (employee_number) DO NOTHING;

INSERT INTO leave_balances (employee_id, year, total_days, used_days)
SELECT id, EXTRACT(YEAR FROM CURRENT_DATE)::int, 10,
  CASE employee_number WHEN '24017' THEN 2.5 WHEN '23108' THEN 5.5 WHEN '22031' THEN 3.5 ELSE 2 END
FROM employees
ON CONFLICT (employee_id, year) DO NOTHING;

INSERT INTO news_program_templates (program_name, default_start_time, default_duration_minutes, preparation_minutes, cleanup_minutes, required_staff)
VALUES
  ('9:30 뉴스','09:30',10,20,10,1),
  ('12시 뉴스','12:00',20,20,10,1),
  ('2시 뉴스외전','14:00',120,30,20,2),
  ('5시 뉴스와 경제','17:00',10,20,10,2),
  ('뉴스데스크','19:40',60,20,10,2),
  ('뉴스 25','00:10',20,20,10,1)
ON CONFLICT (program_name) DO UPDATE SET required_staff = EXCLUDED.required_staff;

WITH today_shifts(employee_number, shift_name) AS (
  VALUES ('24017','A'),('23108','R'),('22031','U'),('25102','A'),('24113','A'),('21004','A')
)
INSERT INTO daily_assignments (employee_id, work_date, shift_type_id, start_datetime, end_datetime)
SELECT e.id, CURRENT_DATE, s.id,
  (CURRENT_DATE + s.start_time) AT TIME ZONE 'Asia/Seoul',
  ((CURRENT_DATE + CASE WHEN s.crosses_midnight THEN 1 ELSE 0 END) + s.end_time) AT TIME ZONE 'Asia/Seoul'
FROM today_shifts t JOIN employees e USING (employee_number) JOIN shift_types s ON s.name = t.shift_name
ON CONFLICT (employee_id, work_date, assignment_type) DO NOTHING;

INSERT INTO daily_news_schedules (
  schedule_date, program_template_id, actual_start_datetime, actual_end_datetime,
  preparation_minutes, cleanup_minutes, required_staff, live_broadcast
)
SELECT CURRENT_DATE, id,
  (CURRENT_DATE + default_start_time) AT TIME ZONE 'Asia/Seoul',
  ((CURRENT_DATE + default_start_time) + make_interval(mins => default_duration_minutes)) AT TIME ZONE 'Asia/Seoul',
  preparation_minutes, cleanup_minutes, required_staff, true
FROM news_program_templates
WHERE program_name <> '뉴스 25'
ON CONFLICT (schedule_date, program_template_id) DO NOTHING;
