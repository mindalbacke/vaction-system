-- 개인 휴가 조회용 최초 PIN. 기존에 변경한 PIN은 유지합니다.
UPDATE employees
SET pin_hash = crypt('0000', gen_salt('bf')), updated_at = now()
WHERE pin_hash IS NULL;

-- 서무 반차는 대근이 필요하지 않습니다. 기존 미지정 요청도 정리합니다.
DELETE FROM substitute_requests request
USING leave_requests leave, employees employee
WHERE request.leave_request_id = leave.id
  AND leave.employee_id = employee.id
  AND employee.role = '서무'
  AND request.substitute_employee_id IS NULL;

UPDATE leave_requests leave
SET substitute_required = false, updated_at = now()
FROM employees employee
WHERE leave.employee_id = employee.id
  AND employee.role = '서무'
  AND leave.substitute_required = true;

-- U 근무 반차(16시 시작) 대근 범위에서는 이미 끝난 2시 뉴스외전을 제외합니다.
WITH corrected_coverage AS (
  SELECT request.id,
    COALESCE(min(schedule.actual_start_datetime - make_interval(mins => schedule.preparation_minutes)) FILTER (
      WHERE NOT ((leave.start_datetime AT TIME ZONE 'Asia/Seoul')::time >= TIME '16:00' AND template.program_name = '2시 뉴스외전')
    ), leave.start_datetime) AS coverage_start,
    COALESCE(max(schedule.actual_end_datetime + make_interval(mins => schedule.cleanup_minutes)) FILTER (
      WHERE NOT ((leave.start_datetime AT TIME ZONE 'Asia/Seoul')::time >= TIME '16:00' AND template.program_name = '2시 뉴스외전')
    ), leave.end_datetime) AS coverage_end
  FROM substitute_requests request
  JOIN leave_requests leave ON leave.id = request.leave_request_id
  LEFT JOIN daily_news_schedules schedule
    ON schedule.schedule_date = leave.leave_date
    AND schedule.cancelled = false
    AND schedule.actual_start_datetime - make_interval(mins => schedule.preparation_minutes) < leave.end_datetime
    AND schedule.actual_end_datetime + make_interval(mins => schedule.cleanup_minutes) > leave.start_datetime
  LEFT JOIN news_program_templates template ON template.id = schedule.program_template_id
  GROUP BY request.id, leave.start_datetime, leave.end_datetime
)
UPDATE substitute_requests request
SET start_datetime = coverage.coverage_start,
    end_datetime = coverage.coverage_end,
    updated_at = now()
FROM corrected_coverage coverage
WHERE request.id = coverage.id;
