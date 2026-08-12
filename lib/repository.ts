import type { Employee, LeaveRequest, MonthlyLeave, MonthlyUnavailability, SubstituteCandidateResponse, SubstituteRequest, SubstituteUnavailability } from "@/lib/domain";
import { getSql, isDatabaseConfigured } from "@/lib/db";
import { createDemoSnapshot } from "@/lib/demo-data";
import { getAudioShift } from "@/lib/rotation";

type DbRow = Record<string, unknown>;

function parseSubstituteCandidates(value: unknown): SubstituteCandidateResponse[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const row = candidate as Record<string, unknown>;
    const priority = Number(row.priority);
    if ((priority !== 1 && priority !== 2) || !row.employeeId || !row.employeeName) return [];
    return [{ employeeId: String(row.employeeId), employeeName: String(row.employeeName), priority } as SubstituteCandidateResponse];
  });
}

function resolveShift(row: DbRow, date: string, audioIndex: number): Pick<Employee, "shift" | "shiftStart" | "shiftEnd"> {
  if (row.role === "조명보조") return { shift: "R", shiftStart: "13:00", shiftEnd: "21:00" };
  if (row.role !== "음향보조") return { shift: "A", shiftStart: "09:00", shiftEnd: "18:00" };

  const startDate = row.rotation_start_date ? String(row.rotation_start_date) : undefined;
  const startShift = row.rotation_start_shift === "A" || row.rotation_start_shift === "U"
    ? row.rotation_start_shift : undefined;
  const shift = getAudioShift(date, audioIndex, startDate, startShift);
  return shift === "U"
    ? { shift, shiftStart: "16:00", shiftEnd: "01:00" }
    : { shift, shiftStart: "09:00", shiftEnd: "18:00" };
}

export async function getDashboardSnapshot(date: string) {
  if (!isDatabaseConfigured()) return createDemoSnapshot(date);
  const sql = getSql();
  const [employeeRows, leaveRows, substituteRows, unavailabilityRows] = await Promise.all([
    sql`
      SELECT e.id::text, e.name, e.employee_number, e.role,
        e.studio_work_eligible, e.substitute_eligible,
        rotation.start_date::text AS rotation_start_date,
        rotation.start_shift AS rotation_start_shift,
        lr.leave_type AS leave_part
      FROM employees e
      LEFT JOIN audio_rotation_settings rotation ON rotation.employee_id = e.id
      LEFT JOIN leave_requests lr
        ON lr.employee_id = e.id AND lr.leave_date = ${date}::date AND lr.cancelled = false
      WHERE e.active = true
      ORDER BY e.role, e.employee_number
    `,
    sql`
      SELECT lr.id::text, lr.employee_id::text, e.name AS employee_name,
        lr.leave_date::text, lr.leave_type,
        to_char(lr.start_datetime AT TIME ZONE 'Asia/Seoul','HH24:MI') AS start_time,
        to_char(lr.end_datetime AT TIME ZONE 'Asia/Seoul','HH24:MI') AS end_time,
        lr.status, lr.notes
      FROM leave_requests lr
      JOIN employees e ON e.id = lr.employee_id
      WHERE lr.leave_date = ${date}::date AND lr.cancelled = false
      ORDER BY lr.created_at DESC
    `,
    sql`
      SELECT sr.id::text, sr.leave_request_id::text AS leave_id,
        requester.id::text AS requester_id, requester.name AS requester_name,
        lr.leave_type,
        substitute.id::text AS substitute_id, substitute.name AS substitute_name,
        candidate_list.candidates,
        coverage.news_names,
        to_char(COALESCE(coverage.coverage_start, sr.start_datetime) AT TIME ZONE 'Asia/Seoul','HH24:MI') AS calculated_start,
        to_char(COALESCE(coverage.coverage_end, sr.end_datetime) AT TIME ZONE 'Asia/Seoul','HH24:MI') AS calculated_end,
        sr.status
      FROM substitute_requests sr
      JOIN leave_requests lr ON lr.id = sr.leave_request_id AND lr.cancelled = false
      JOIN employees requester ON requester.id = sr.requester_id
      LEFT JOIN employees substitute ON substitute.id = sr.substitute_employee_id
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object(
          'employeeId', candidate_employee.id::text,
          'employeeName', candidate_employee.name,
          'priority', candidate.priority
        ) ORDER BY candidate.priority) AS candidates
        FROM substitute_candidates candidate
        JOIN employees candidate_employee ON candidate_employee.id = candidate.employee_id
        WHERE candidate.substitute_request_id = sr.id
      ) candidate_list ON true
      LEFT JOIN LATERAL (
        SELECT string_agg(npt.program_name, '|||' ORDER BY dns.actual_start_datetime) AS news_names,
          min(dns.actual_start_datetime - make_interval(mins => dns.preparation_minutes)) AS coverage_start,
          max(dns.actual_end_datetime + make_interval(mins => dns.cleanup_minutes)) AS coverage_end
        FROM daily_news_schedules dns
        JOIN news_program_templates npt ON npt.id = dns.program_template_id
        WHERE dns.schedule_date = lr.leave_date AND dns.cancelled = false
          AND NOT (
            (lr.start_datetime AT TIME ZONE 'Asia/Seoul')::time >= TIME '16:00'
            AND npt.program_name = '2시 뉴스외전'
          )
          AND dns.actual_start_datetime - make_interval(mins => dns.preparation_minutes) < lr.end_datetime
          AND dns.actual_end_datetime + make_interval(mins => dns.cleanup_minutes) > lr.start_datetime
      ) coverage ON true
      WHERE lr.leave_date = ${date}::date
      ORDER BY sr.created_at DESC
    `,
    sql`
      SELECT su.id::text, su.employee_id::text, e.name AS employee_name,
        (su.start_datetime AT TIME ZONE 'Asia/Seoul')::date::text AS start_date,
        (su.end_datetime AT TIME ZONE 'Asia/Seoul')::date::text AS end_date,
        to_char(su.start_datetime AT TIME ZONE 'Asia/Seoul','HH24:MI') AS start_time,
        to_char(su.end_datetime AT TIME ZONE 'Asia/Seoul','HH24:MI') AS end_time,
        CASE WHEN (su.start_datetime AT TIME ZONE 'Asia/Seoul')::date < ${date}::date
          THEN '00:00' ELSE to_char(su.start_datetime AT TIME ZONE 'Asia/Seoul','HH24:MI') END AS day_start,
        CASE WHEN (su.end_datetime AT TIME ZONE 'Asia/Seoul')::date > ${date}::date
          THEN '23:59' ELSE to_char(su.end_datetime AT TIME ZONE 'Asia/Seoul','HH24:MI') END AS day_end,
        COALESCE(NULLIF(su.reason_detail, ''), su.reason_type) AS reason
      FROM substitute_unavailability su
      JOIN employees e ON e.id = su.employee_id
      WHERE su.start_datetime < ((${date}::date + 1) AT TIME ZONE 'Asia/Seoul')
        AND su.end_datetime > (${date}::date AT TIME ZONE 'Asia/Seoul')
      ORDER BY su.start_datetime, e.name
    `,
  ]);

  let audioIndex = 0;
  const employees: Employee[] = (employeeRows as DbRow[]).map((row) => {
    const index = row.role === "음향보조" ? audioIndex++ : 0;
    return {
      id: String(row.id), name: String(row.name), role: row.role as Employee["role"],
      ...resolveShift(row, date, index),
      studioEligible: Boolean(row.studio_work_eligible),
      substituteEligible: Boolean(row.substitute_eligible),
      leavePart: row.leave_part ? row.leave_part as Employee["leavePart"] : undefined,
      rotationStartDate: row.rotation_start_date ? String(row.rotation_start_date) : undefined,
      rotationStartShift: row.rotation_start_shift === "A" || row.rotation_start_shift === "U" ? row.rotation_start_shift : undefined,
    };
  });
  const leaves: LeaveRequest[] = (leaveRows as DbRow[]).map((row) => ({
    id: String(row.id), employeeId: String(row.employee_id), employeeName: String(row.employee_name),
    leaveDate: String(row.leave_date), part: row.leave_type as LeaveRequest["part"],
    start: String(row.start_time), end: String(row.end_time), status: String(row.status),
    note: row.notes ? String(row.notes) : undefined,
  }));
  const substitutes: SubstituteRequest[] = (substituteRows as DbRow[]).map((row) => ({
    id: String(row.id), leaveId: String(row.leave_id),
    requesterId: String(row.requester_id), requesterName: String(row.requester_name),
    part: row.leave_type as SubstituteRequest["part"], start: String(row.calculated_start), end: String(row.calculated_end),
    substituteId: row.substitute_id ? String(row.substitute_id) : undefined,
    substituteName: row.substitute_name ? String(row.substitute_name) : undefined,
    candidates: parseSubstituteCandidates(row.candidates),
    newsNames: row.news_names ? String(row.news_names).split("|||") : [],
    status: String(row.status),
  }));
  const unavailabilities: SubstituteUnavailability[] = (unavailabilityRows as DbRow[]).map((row) => ({
    id: String(row.id), employeeId: String(row.employee_id), employeeName: String(row.employee_name),
    startDate: String(row.start_date), endDate: String(row.end_date),
    start: String(row.start_time), end: String(row.end_time), dayStart: String(row.day_start), dayEnd: String(row.day_end), reason: String(row.reason),
  }));

  return { date, employees, leaves, substitutes, unavailabilities, databaseConnected: true };
}

export async function getMonthlyLeaves(month: string): Promise<MonthlyLeave[]> {
  if (!isDatabaseConfigured()) return [];
  const rows = await getSql()`
    SELECT lr.id::text, lr.employee_id::text, e.name AS employee_name, e.role,
      lr.leave_date::text, lr.leave_type, lr.notes, substitute.name AS substitute_name,
      candidate_list.candidates
    FROM leave_requests lr
    JOIN employees e ON e.id = lr.employee_id
    LEFT JOIN substitute_requests request ON request.leave_request_id = lr.id
      AND request.status <> '반차 취소'
    LEFT JOIN employees substitute ON substitute.id = request.substitute_employee_id
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object(
        'employeeId', candidate_employee.id::text,
        'employeeName', candidate_employee.name,
        'priority', candidate.priority
      ) ORDER BY candidate.priority) AS candidates
      FROM substitute_candidates candidate
      JOIN employees candidate_employee ON candidate_employee.id = candidate.employee_id
      WHERE candidate.substitute_request_id = request.id
    ) candidate_list ON true
    WHERE lr.leave_date >= ${month}::date
      AND lr.leave_date < (${month}::date + INTERVAL '1 month')
      AND lr.cancelled = false
    ORDER BY lr.leave_date, e.name
  `;
  return (rows as DbRow[]).map((row) => ({
    id: String(row.id), employeeId: String(row.employee_id), employeeName: String(row.employee_name),
    leaveDate: String(row.leave_date), part: row.leave_type as MonthlyLeave["part"],
    note: row.notes ? String(row.notes) : undefined,
    substituteCandidates: parseSubstituteCandidates(row.candidates),
    substituteName: row.substitute_name ? String(row.substitute_name) : undefined,
    substituteRequired: row.role !== "서무" && row.role !== "중계보조",
  }));
}

export async function getMonthlyUnavailabilities(month: string): Promise<MonthlyUnavailability[]> {
  if (!isDatabaseConfigured()) return [];
  const rows = await getSql()`
    SELECT unavailable.id::text, unavailable.employee_id::text, employee.name AS employee_name,
      (unavailable.start_datetime AT TIME ZONE 'Asia/Seoul')::date::text AS start_date,
      (unavailable.end_datetime AT TIME ZONE 'Asia/Seoul')::date::text AS end_date,
      to_char(unavailable.start_datetime AT TIME ZONE 'Asia/Seoul', 'HH24:MI') AS start_time,
      to_char(unavailable.end_datetime AT TIME ZONE 'Asia/Seoul', 'HH24:MI') AS end_time,
      COALESCE(NULLIF(unavailable.reason_detail, ''), unavailable.reason_type) AS reason
    FROM substitute_unavailability unavailable
    JOIN employees employee ON employee.id = unavailable.employee_id
    WHERE (unavailable.start_datetime AT TIME ZONE 'Asia/Seoul')::date < (${month}::date + INTERVAL '1 month')::date
      AND (unavailable.end_datetime AT TIME ZONE 'Asia/Seoul')::date >= ${month}::date
    ORDER BY unavailable.start_datetime, employee.name
  `;
  return (rows as DbRow[]).map((row) => ({
    id: String(row.id), employeeId: String(row.employee_id), employeeName: String(row.employee_name),
    startDate: String(row.start_date), endDate: String(row.end_date),
    start: String(row.start_time), end: String(row.end_time), reason: String(row.reason),
  }));
}

export async function getSubstituteUnavailabilityList(fromDate: string): Promise<SubstituteUnavailability[]> {
  if (!isDatabaseConfigured()) return [];
  const rows = await getSql()`
    SELECT unavailable.id::text, unavailable.employee_id::text, employee.name AS employee_name,
      (unavailable.start_datetime AT TIME ZONE 'Asia/Seoul')::date::text AS start_date,
      (unavailable.end_datetime AT TIME ZONE 'Asia/Seoul')::date::text AS end_date,
      to_char(unavailable.start_datetime AT TIME ZONE 'Asia/Seoul', 'HH24:MI') AS start_time,
      to_char(unavailable.end_datetime AT TIME ZONE 'Asia/Seoul', 'HH24:MI') AS end_time,
      to_char(unavailable.start_datetime AT TIME ZONE 'Asia/Seoul', 'HH24:MI') AS day_start,
      to_char(unavailable.end_datetime AT TIME ZONE 'Asia/Seoul', 'HH24:MI') AS day_end,
      COALESCE(NULLIF(unavailable.reason_detail, ''), unavailable.reason_type) AS reason
    FROM substitute_unavailability unavailable
    JOIN employees employee ON employee.id = unavailable.employee_id
    WHERE (unavailable.end_datetime AT TIME ZONE 'Asia/Seoul')::date >= ${fromDate}::date
    ORDER BY unavailable.start_datetime, employee.name
    LIMIT 100
  `;
  return (rows as DbRow[]).map((row) => ({
    id: String(row.id), employeeId: String(row.employee_id), employeeName: String(row.employee_name),
    startDate: String(row.start_date), endDate: String(row.end_date),
    start: String(row.start_time), end: String(row.end_time),
    dayStart: String(row.day_start), dayEnd: String(row.day_end), reason: String(row.reason),
  }));
}
