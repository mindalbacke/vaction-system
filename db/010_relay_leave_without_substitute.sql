-- 중계보조 반차는 대근이 필요하지 않습니다.
DELETE FROM substitute_requests request
USING leave_requests leave, employees employee
WHERE request.leave_request_id = leave.id
  AND leave.employee_id = employee.id
  AND employee.role = '중계보조'
  AND leave.cancelled = false;

UPDATE leave_requests leave
SET substitute_required = false, updated_at = now()
FROM employees employee
WHERE leave.employee_id = employee.id
  AND employee.role = '중계보조'
  AND leave.substitute_required = true;
