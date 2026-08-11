-- 기존 반차도 단순 대근 흐름에서 바로 보이도록 공석 요청을 보완합니다.
UPDATE leave_requests
SET substitute_required = true, updated_at = now()
WHERE cancelled = false AND substitute_required = false;

INSERT INTO substitute_requests (
  leave_request_id, requester_id, start_datetime, end_datetime, status
)
SELECT lr.id, lr.employee_id, lr.start_datetime, lr.end_datetime, '대근자 미지정'
FROM leave_requests lr
WHERE lr.cancelled = false
  AND NOT EXISTS (
    SELECT 1 FROM substitute_requests sr WHERE sr.leave_request_id = lr.id
  );
