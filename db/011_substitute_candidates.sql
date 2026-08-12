CREATE TABLE IF NOT EXISTS substitute_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  substitute_request_id uuid NOT NULL REFERENCES substitute_requests(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id),
  priority smallint NOT NULL CHECK (priority IN (1, 2)),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(substitute_request_id, employee_id),
  UNIQUE(substitute_request_id, priority)
);

ALTER TABLE substitute_requests
  ADD COLUMN IF NOT EXISTS candidate_count smallint NOT NULL DEFAULT 0
  CHECK (candidate_count BETWEEN 0 AND 2);

CREATE INDEX IF NOT EXISTS idx_substitute_candidates_employee
  ON substitute_candidates(employee_id, substitute_request_id);

INSERT INTO substitute_candidates (substitute_request_id, employee_id, priority, created_at)
SELECT request.id, request.substitute_employee_id, 1, COALESCE(request.responded_at, request.updated_at)
FROM substitute_requests request
WHERE request.substitute_employee_id IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE substitute_requests request
SET status = CASE
  WHEN request.status = '반차 취소' THEN request.status
  WHEN (SELECT COUNT(*) FROM substitute_candidates candidate WHERE candidate.substitute_request_id = request.id) >= 2
    THEN '대근 후보 등록 완료'
  ELSE '대근 후보 모집 중'
END,
candidate_count = (SELECT COUNT(*) FROM substitute_candidates candidate WHERE candidate.substitute_request_id = request.id),
updated_at = now()
WHERE EXISTS (
  SELECT 1 FROM substitute_candidates candidate WHERE candidate.substitute_request_id = request.id
);
