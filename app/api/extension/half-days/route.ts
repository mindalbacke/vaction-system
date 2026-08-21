import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getSql, isDatabaseConfigured } from "@/lib/db";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  employeeId: z.string().uuid(),
  pin: z.string().regex(/^\d{4}$/),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).refine((value) => value.from <= value.to, { message: "조회 기간이 올바르지 않습니다." });

const updateSchema = z.object({
  employeeId: z.string().uuid(),
  pin: z.string().regex(/^\d{4}$/),
  halfDayId: z.string().uuid(),
  newDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  newPart: z.enum(["전반", "후반"]),
});

const responseHeaders = {
  "Cache-Control": "no-store, max-age=0",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: responseHeaders });
}

export async function GET() {
  if (!isDatabaseConfigured()) {
    return Response.json({ employees: [] }, { headers: responseHeaders });
  }

  const rows = await getSql()`
    SELECT id::text, name, role
    FROM employees
    WHERE active = true
    ORDER BY name
  `;

  return Response.json({
    employees: rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      role: String(row.role),
    })),
  }, { headers: responseHeaders });
}

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) {
    return Response.json({ error: "데이터베이스가 연결되지 않았습니다." }, { status: 503, headers: responseHeaders });
  }

  try {
    const input = requestSchema.parse(await request.json());
    const sql = getSql();
    const employees = await sql`
      SELECT employee.id::text, employee.name, employee.role, employee.employee_number,
        (SELECT COUNT(*) FROM login_attempts attempt
          WHERE attempt.employee_number = employee.employee_number
            AND attempt.successful = false
            AND attempt.attempted_at > now() - INTERVAL '10 minutes') >= 5 AS locked,
        COALESCE(employee.pin_hash = crypt(${input.pin}, employee.pin_hash), false) AS pin_valid
      FROM employees employee
      WHERE employee.id = ${input.employeeId}::uuid AND employee.active = true
    `;

    if (!employees.length) {
      return Response.json({ error: "직원 정보를 찾을 수 없습니다." }, { status: 404, headers: responseHeaders });
    }

    const employee = employees[0] as Record<string, unknown>;
    const locked = Boolean(employee.locked);
    const valid = !locked && Boolean(employee.pin_valid);
    await sql`
      INSERT INTO login_attempts (employee_number, successful)
      VALUES (${String(employee.employee_number)}, ${valid})
    `;

    if (!valid) {
      return Response.json({
        error: locked ? "PIN 입력이 여러 번 틀렸습니다. 10분 후 다시 시도해 주세요." : "PIN 번호가 올바르지 않습니다.",
      }, { status: 401, headers: responseHeaders });
    }

    const rows = await sql`
      SELECT request.id::text, request.leave_date::text, request.leave_type,
        request.created_at::text
      FROM leave_requests request
      WHERE request.employee_id = ${input.employeeId}::uuid
        AND request.cancelled = false
        AND request.leave_date BETWEEN ${input.from}::date AND ${input.to}::date
      ORDER BY request.leave_date, request.created_at
    `;
    const revisionRows = await sql`
      SELECT audit.target_id::text AS half_day_id,
        audit.before_data->>'leave_date' AS old_date,
        audit.before_data->>'leave_type' AS old_part,
        audit.after_data->>'leave_date' AS new_date,
        audit.after_data->>'leave_type' AS new_part,
        audit.created_at::text AS changed_at
      FROM audit_logs audit
      JOIN leave_requests request ON request.id = audit.target_id
      WHERE request.employee_id = ${input.employeeId}::uuid
        AND audit.target_table = 'leave_requests'
        AND audit.action_type IN ('반차 수정', '반차 일정 수정')
      ORDER BY audit.created_at DESC
    `;

    return Response.json({
      employee: { id: String(employee.id), name: String(employee.name), role: String(employee.role) },
      halfDays: rows.map((row) => ({
        id: String(row.id),
        date: String(row.leave_date),
        part: String(row.leave_type),
        createdAt: String(row.created_at),
        revisions: revisionRows.filter((revision) => String(revision.half_day_id) === String(row.id)).map((revision) => ({
          oldDate: String(revision.old_date), oldPart: String(revision.old_part),
          newDate: String(revision.new_date), newPart: String(revision.new_part), changedAt: String(revision.changed_at),
        })),
      })),
      syncedAt: new Date().toISOString(),
    }, { headers: responseHeaders });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "직원, PIN 또는 조회 기간을 확인해 주세요." }, { status: 400, headers: responseHeaders });
    }
    console.error("Extension half-day sync failed", error);
    return Response.json({ error: "반차 내역을 불러오지 못했습니다." }, { status: 500, headers: responseHeaders });
  }
}

export async function PATCH(request: Request) {
  if (!isDatabaseConfigured()) {
    return Response.json({ error: "데이터베이스가 연결되지 않았습니다." }, { status: 503, headers: responseHeaders });
  }

  try {
    const input = updateSchema.parse(await request.json());
    const sql = getSql();
    const employees = await sql`
      SELECT employee.id::text, employee.employee_number,
        (SELECT COUNT(*) FROM login_attempts attempt
          WHERE attempt.employee_number = employee.employee_number
            AND attempt.successful = false
            AND attempt.attempted_at > now() - INTERVAL '10 minutes') >= 5 AS locked,
        COALESCE(employee.pin_hash = crypt(${input.pin}, employee.pin_hash), false) AS pin_valid
      FROM employees employee
      WHERE employee.id = ${input.employeeId}::uuid AND employee.active = true
    `;
    if (!employees.length) return Response.json({ error: "직원 정보를 찾을 수 없습니다." }, { status: 404, headers: responseHeaders });
    const employee = employees[0] as Record<string, unknown>;
    const valid = !Boolean(employee.locked) && Boolean(employee.pin_valid);
    await sql`INSERT INTO login_attempts (employee_number, successful) VALUES (${String(employee.employee_number)}, ${valid})`;
    if (!valid) {
      return Response.json({ error: employee.locked ? "PIN 입력이 여러 번 틀렸습니다. 10분 후 다시 시도해 주세요." : "PIN 번호가 올바르지 않습니다." }, { status: 401, headers: responseHeaders });
    }

    const currentRows = await sql`
      SELECT leave_date::text, leave_type
      FROM leave_requests
      WHERE id = ${input.halfDayId}::uuid AND employee_id = ${input.employeeId}::uuid AND cancelled = false
    `;
    if (!currentRows.length) return Response.json({ error: "수정할 반차를 찾을 수 없습니다." }, { status: 404, headers: responseHeaders });
    const todayRows = await sql`SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date::text AS today`;
    const today = String(todayRows[0].today);
    if (String(currentRows[0].leave_date) < today) {
      return Response.json({ error: "이미 지난 반차는 수정할 수 없습니다." }, { status: 409, headers: responseHeaders });
    }
    if (input.newDate < today) {
      return Response.json({ error: "새 반차 날짜는 오늘 이후로 선택해 주세요." }, { status: 409, headers: responseHeaders });
    }

    const result = await sql`
      WITH audio_order AS (
        SELECT id, row_number() OVER (ORDER BY employee_number) - 1 AS audio_rank
        FROM employees WHERE active = true AND role = '음향보조'
      ), before_row AS (
        SELECT leave.*, employee.role, audio_order.audio_rank,
          rotation.start_date AS rotation_start_date, rotation.start_shift AS rotation_start_shift
        FROM leave_requests leave
        JOIN employees employee ON employee.id = leave.employee_id AND employee.active = true
        LEFT JOIN audio_order ON audio_order.id = employee.id
        LEFT JOIN audio_rotation_settings rotation ON rotation.employee_id = employee.id
        WHERE leave.id = ${input.halfDayId}::uuid AND leave.employee_id = ${input.employeeId}::uuid
          AND leave.cancelled = false
          AND leave.leave_date >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date
          AND ${input.newDate}::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date
          AND EXTRACT(YEAR FROM leave.leave_date) = EXTRACT(YEAR FROM ${input.newDate}::date)
        FOR UPDATE OF leave
      ), effective_employee AS (
        SELECT *, CASE
          WHEN role = '조명보조' THEN 'R'
          WHEN role <> '음향보조' THEN 'A'
          WHEN rotation_start_date IS NOT NULL THEN CASE
            WHEN mod(mod(floor((${input.newDate}::date - rotation_start_date) / 14.0)::int, 2) + 2, 2) = 0 THEN rotation_start_shift
            ELSE CASE WHEN rotation_start_shift = 'A' THEN 'U' ELSE 'A' END END
          WHEN mod(mod((audio_rank + floor((${input.newDate}::date - DATE '2026-08-03') / 14.0)::int)::int, 2) + 2, 2) = 0 THEN 'U'
          ELSE 'A' END AS shift_name
        FROM before_row
      ), selected_shift AS (
        SELECT employee.*, shift.morning_leave_start, shift.morning_leave_end,
          shift.afternoon_leave_start, shift.afternoon_leave_end
        FROM effective_employee employee JOIN shift_types shift ON shift.name = employee.shift_name
        WHERE NOT (employee.shift_name = 'U' AND ${input.newPart} = '후반')
      ), changed AS (
        UPDATE leave_requests leave SET
          leave_date = ${input.newDate}::date, leave_type = ${input.newPart},
          start_datetime = (${input.newDate}::date + CASE WHEN ${input.newPart} = '전반' THEN selected.morning_leave_start ELSE selected.afternoon_leave_start END) AT TIME ZONE 'Asia/Seoul',
          end_datetime = (${input.newDate}::date
            + CASE WHEN (CASE WHEN ${input.newPart} = '전반' THEN selected.morning_leave_end ELSE selected.afternoon_leave_end END)
              <= (CASE WHEN ${input.newPart} = '전반' THEN selected.morning_leave_start ELSE selected.afternoon_leave_start END) THEN 1 ELSE 0 END
            + CASE WHEN ${input.newPart} = '전반' THEN selected.morning_leave_end ELSE selected.afternoon_leave_end END) AT TIME ZONE 'Asia/Seoul',
          substitute_required = selected.role NOT IN ('서무', '중계보조'), status = '등록 완료', updated_at = now()
        FROM selected_shift selected WHERE leave.id = selected.id
        RETURNING leave.*, selected.role, selected.leave_date AS old_leave_date,
          selected.leave_type AS old_leave_type, to_jsonb(selected) AS before_data
      ), coverage AS (
        SELECT changed.*, COALESCE(news.coverage_start, changed.start_datetime) AS coverage_start,
          COALESCE(news.coverage_end, changed.end_datetime) AS coverage_end
        FROM changed LEFT JOIN LATERAL (
          SELECT min(schedule.actual_start_datetime - make_interval(mins => schedule.preparation_minutes)) AS coverage_start,
            max(schedule.actual_end_datetime + make_interval(mins => schedule.cleanup_minutes)) AS coverage_end
          FROM daily_news_schedules schedule JOIN news_program_templates template ON template.id = schedule.program_template_id
          WHERE schedule.schedule_date = changed.leave_date AND schedule.cancelled = false
            AND NOT ((changed.start_datetime AT TIME ZONE 'Asia/Seoul')::time >= TIME '16:00' AND template.program_name = '2시 뉴스외전')
            AND schedule.actual_start_datetime - make_interval(mins => schedule.preparation_minutes) < changed.end_datetime
            AND schedule.actual_end_datetime + make_interval(mins => schedule.cleanup_minutes) > changed.start_datetime
        ) news ON true
      ), cleared_candidates AS (
        DELETE FROM substitute_candidates candidate USING substitute_requests request, coverage
        WHERE request.leave_request_id = coverage.id AND candidate.substitute_request_id = request.id
          AND (coverage.old_leave_date <> coverage.leave_date OR coverage.old_leave_type <> coverage.leave_type)
      ), updated_request AS (
        UPDATE substitute_requests request SET start_datetime = coverage.coverage_start, end_datetime = coverage.coverage_end,
          substitute_employee_id = CASE WHEN coverage.old_leave_date <> coverage.leave_date OR coverage.old_leave_type <> coverage.leave_type THEN NULL ELSE request.substitute_employee_id END,
          status = CASE WHEN coverage.role IN ('서무', '중계보조') THEN '대근 불필요'
            WHEN coverage.old_leave_date <> coverage.leave_date OR coverage.old_leave_type <> coverage.leave_type THEN '대근자 미정' ELSE request.status END,
          responded_at = CASE WHEN coverage.old_leave_date <> coverage.leave_date OR coverage.old_leave_type <> coverage.leave_type THEN NULL ELSE request.responded_at END,
          candidate_count = CASE WHEN coverage.old_leave_date <> coverage.leave_date OR coverage.old_leave_type <> coverage.leave_type THEN 0 ELSE request.candidate_count END,
          updated_at = now()
        FROM coverage WHERE request.leave_request_id = coverage.id
      ), inserted_request AS (
        INSERT INTO substitute_requests (leave_request_id, requester_id, start_datetime, end_datetime, status)
        SELECT coverage.id, coverage.employee_id, coverage.coverage_start, coverage.coverage_end, '대근자 미정'
        FROM coverage WHERE coverage.role NOT IN ('서무', '중계보조')
          AND NOT EXISTS (SELECT 1 FROM substitute_requests request WHERE request.leave_request_id = coverage.id)
      ), audit AS (
        INSERT INTO audit_logs (user_id, action_type, target_table, target_id, before_data, after_data)
        SELECT ${input.employeeId}::uuid, '반차 일정 수정', 'leave_requests', id, before_data, to_jsonb(changed) - 'before_data' FROM changed
      )
      SELECT id::text, leave_date::text, leave_type FROM changed
    `;
    if (!result.length) {
      return Response.json({ error: "수정할 수 없습니다. U 근무자는 후반 반차를 쓸 수 없으며 같은 연도 안에서 변경해 주세요." }, { status: 409, headers: responseHeaders });
    }
    revalidatePath("/");
    revalidatePath("/board");
    return Response.json({ ok: true, message: "반차 일정을 수정했습니다. 대근 후보는 새 날짜 기준으로 다시 지정해 주세요." }, { headers: responseHeaders });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "수정할 날짜와 반차 구분을 확인해 주세요." }, { status: 400, headers: responseHeaders });
    const message = error instanceof Error ? error.message : "";
    if (message.includes("uq_active_leave") || message.includes("duplicate key")) {
      return Response.json({ error: "같은 날짜와 시간대에 이미 등록된 반차가 있습니다." }, { status: 409, headers: responseHeaders });
    }
    console.error("Extension half-day update failed", error);
    return Response.json({ error: "반차 일정을 수정하지 못했습니다." }, { status: 500, headers: responseHeaders });
  }
}
