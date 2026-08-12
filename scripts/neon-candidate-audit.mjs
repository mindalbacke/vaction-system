import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL이 설정되지 않았습니다.");
const sql = neon(process.env.DATABASE_URL);

const [summary] = await sql`
  SELECT
    COUNT(*)::int AS candidate_count,
    COUNT(DISTINCT substitute_request_id)::int AS request_count,
    COUNT(*) FILTER (WHERE priority = 1)::int AS first_priority_count,
    COUNT(*) FILTER (WHERE priority = 2)::int AS second_priority_count
  FROM substitute_candidates
`;

const violations = await sql`
  SELECT substitute_request_id::text
  FROM substitute_candidates
  GROUP BY substitute_request_id
  HAVING COUNT(*) > 2 OR COUNT(DISTINCT priority) <> COUNT(*) OR COUNT(DISTINCT employee_id) <> COUNT(*)
`;

const counterMismatches = await sql`
  SELECT request.id::text
  FROM substitute_requests request
  WHERE request.candidate_count <> (
    SELECT COUNT(*) FROM substitute_candidates candidate WHERE candidate.substitute_request_id = request.id
  )
`;

const activeLeaveDates = await sql`
  SELECT DISTINCT leave.leave_date
  FROM leave_requests leave
  JOIN substitute_requests request ON request.leave_request_id = leave.id
  WHERE leave.cancelled = false
  ORDER BY leave.leave_date DESC
  LIMIT 5
`;

console.log(JSON.stringify({
  candidateCount: summary.candidate_count,
  requestCount: summary.request_count,
  firstPriorityCount: summary.first_priority_count,
  secondPriorityCount: summary.second_priority_count,
  violationCount: violations.length,
  counterMismatchCount: counterMismatches.length,
  activeLeaveDates: activeLeaveDates.map((row) => row.leave_date),
}));
