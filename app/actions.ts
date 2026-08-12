"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSql, isDatabaseConfigured } from "@/lib/db";

const leaveSchema = z.object({
  employeeId: z.string().uuid(),
  leaveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  part: z.enum(["전반", "후반"]),
  note: z.string().trim().max(300).optional(),
});

function requireDatabase() {
  if (!isDatabaseConfigured()) throw new Error("Neon 데이터베이스를 연결한 뒤 사용할 수 있습니다.");
  return getSql();
}

type PinVerification = {
  id: string; name: string; role: string; employeeNumber: string;
  valid: boolean; locked: boolean;
};

export type LeaveBalanceData = {
  employeeId: string; name: string; role: string; year: number;
  totalDays: number; usedDays: number; remainingDays: number;
};

export type LeaveBalanceActionState = {
  status: "idle" | "success" | "error";
  message: string;
  balance?: LeaveBalanceData;
};

async function verifyEmployeePin(employeeId: string, pin: string): Promise<PinVerification | null> {
  const sql = requireDatabase();
  const rows = await sql`
    SELECT e.id::text, e.name, e.role, e.employee_number,
      (SELECT COUNT(*) FROM login_attempts attempt
        WHERE attempt.employee_number = e.employee_number
          AND attempt.successful = false
          AND attempt.attempted_at > now() - INTERVAL '10 minutes') >= 5 AS locked,
      COALESCE(e.pin_hash = crypt(${pin}, e.pin_hash), false) AS pin_valid
    FROM employees e
    WHERE e.id = ${employeeId}::uuid AND e.active = true
  `;
  if (!rows.length) return null;
  const row = rows[0] as Record<string, unknown>;
  const locked = Boolean(row.locked);
  const valid = !locked && Boolean(row.pin_valid);
  await sql`
    INSERT INTO login_attempts (employee_number, successful)
    VALUES (${String(row.employee_number)}, ${valid})
  `;
  return {
    id: String(row.id), name: String(row.name), role: String(row.role),
    employeeNumber: String(row.employee_number), valid, locked,
  };
}

async function getProtectedLeaveBalance(employee: PinVerification, year: number): Promise<LeaveBalanceData> {
  const rows = await requireDatabase()`
    SELECT COALESCE(total_days, 0)::float8 AS total_days,
      COALESCE(used_days, 0)::float8 AS used_days,
      COALESCE(remaining_days, 0)::float8 AS remaining_days
    FROM employees employee
    LEFT JOIN leave_balances balance ON balance.employee_id = employee.id AND balance.year = ${year}
    WHERE employee.id = ${employee.id}::uuid
  `;
  const row = rows[0] as Record<string, unknown>;
  return {
    employeeId: employee.id, name: employee.name, role: employee.role, year,
    totalDays: Number(row.total_days), usedDays: Number(row.used_days), remainingDays: Number(row.remaining_days),
  };
}

function pinError(verification: PinVerification | null): LeaveBalanceActionState {
  if (verification?.locked) return { status: "error", message: "PIN을 여러 번 잘못 입력했습니다. 10분 후 다시 시도해 주세요." };
  return { status: "error", message: "PIN 번호가 올바르지 않습니다." };
}

export type LeaveActionState = { status: "idle" | "success" | "error"; message: string };

export async function createLeave(_previousState: LeaveActionState, formData: FormData): Promise<LeaveActionState> {
  try {
    const input = leaveSchema.parse({
      employeeId: formData.get("employeeId"),
      leaveDate: formData.get("leaveDate"),
      part: formData.get("part"),
      note: formData.get("note") || undefined,
    });
    const sql = requireDatabase();
    const result = await sql`
    WITH audio_order AS (
      SELECT id, row_number() OVER (ORDER BY employee_number) - 1 AS audio_rank
      FROM employees WHERE active = true AND role = '음향보조'
    ), employee_base AS (
      SELECT e.id, e.role, audio_order.audio_rank,
        rotation.start_date AS rotation_start_date,
        rotation.start_shift AS rotation_start_shift
      FROM employees e
      LEFT JOIN audio_order ON audio_order.id = e.id
      LEFT JOIN audio_rotation_settings rotation ON rotation.employee_id = e.id
      WHERE e.id = ${input.employeeId}::uuid AND e.active = true
    ), effective_employee AS (
      SELECT id, role,
        CASE
          WHEN role = '조명보조' THEN 'R'
          WHEN role <> '음향보조' THEN 'A'
          WHEN rotation_start_date IS NOT NULL THEN
            CASE WHEN mod(mod(floor((${input.leaveDate}::date - rotation_start_date) / 14.0)::int, 2) + 2, 2) = 0
              THEN rotation_start_shift
              ELSE CASE WHEN rotation_start_shift = 'A' THEN 'U' ELSE 'A' END END
          WHEN mod(mod((audio_rank + floor((${input.leaveDate}::date - DATE '2026-08-03') / 14.0)::int)::int, 2) + 2, 2) = 0 THEN 'U'
          ELSE 'A'
        END AS shift_name
      FROM employee_base
    ), selected_shift AS (
      SELECT employee.id AS employee_id, employee.role, employee.shift_name, shift.*
      FROM effective_employee employee
      JOIN shift_types shift ON shift.name = employee.shift_name
      WHERE NOT (employee.shift_name = 'U' AND ${input.part} = '후반')
    ), inserted_leave AS (
      INSERT INTO leave_requests (
        employee_id, leave_date, leave_type, start_datetime, end_datetime,
        status, substitute_required, notes
      )
      SELECT employee_id, ${input.leaveDate}::date, ${input.part},
        (${input.leaveDate}::date + CASE WHEN ${input.part} = '전반' THEN morning_leave_start ELSE afternoon_leave_start END) AT TIME ZONE 'Asia/Seoul',
        (
          ${input.leaveDate}::date
          + CASE WHEN
              (CASE WHEN ${input.part} = '전반' THEN morning_leave_end ELSE afternoon_leave_end END)
              <= (CASE WHEN ${input.part} = '전반' THEN morning_leave_start ELSE afternoon_leave_start END)
            THEN 1 ELSE 0 END
          + CASE WHEN ${input.part} = '전반' THEN morning_leave_end ELSE afternoon_leave_end END
        ) AT TIME ZONE 'Asia/Seoul',
        '등록 완료', role NOT IN ('서무', '중계보조'), ${input.note ?? null}
      FROM selected_shift
      RETURNING *
    ), leave_with_coverage AS (
      SELECT leave.*,
        COALESCE(coverage.coverage_start, leave.start_datetime) AS substitute_start,
        COALESCE(coverage.coverage_end, leave.end_datetime) AS substitute_end
      FROM inserted_leave leave
      LEFT JOIN LATERAL (
        SELECT
          min(dns.actual_start_datetime - make_interval(mins => dns.preparation_minutes)) AS coverage_start,
          max(dns.actual_end_datetime + make_interval(mins => dns.cleanup_minutes)) AS coverage_end
        FROM daily_news_schedules dns
        JOIN news_program_templates template ON template.id = dns.program_template_id
        WHERE dns.schedule_date = leave.leave_date AND dns.cancelled = false
          AND NOT (
            (leave.start_datetime AT TIME ZONE 'Asia/Seoul')::time >= TIME '16:00'
            AND template.program_name = '2시 뉴스외전'
          )
          AND dns.actual_start_datetime - make_interval(mins => dns.preparation_minutes) < leave.end_datetime
          AND dns.actual_end_datetime + make_interval(mins => dns.cleanup_minutes) > leave.start_datetime
      ) coverage ON true
    ), inserted_substitute AS (
      INSERT INTO substitute_requests (
        leave_request_id, requester_id, start_datetime, end_datetime, status
      )
      SELECT leave_with_coverage.id, leave_with_coverage.employee_id,
        leave_with_coverage.substitute_start, leave_with_coverage.substitute_end, '대근자 미지정'
      FROM leave_with_coverage
      JOIN employees requester ON requester.id = leave_with_coverage.employee_id
      WHERE requester.role NOT IN ('서무', '중계보조')
      RETURNING *
    ), leave_audit AS (
      INSERT INTO audit_logs (user_id, action_type, target_table, target_id, after_data)
      SELECT NULL::uuid, '반차 등록', 'leave_requests', id, to_jsonb(inserted_leave) FROM inserted_leave
    ), substitute_audit AS (
      INSERT INTO audit_logs (user_id, action_type, target_table, target_id, after_data)
      SELECT NULL::uuid, '대근 공석 생성', 'substitute_requests', id, to_jsonb(inserted_substitute) FROM inserted_substitute
    )
    SELECT id::text FROM inserted_leave
    `;
    if (!result.length) {
      return { status: "error", message: "U 근무자는 후반 반차를 사용할 수 없습니다. 전반 반차를 선택해 주세요." };
    }
    revalidatePath("/");
    revalidatePath("/board");
    return { status: "success", message: "반차가 등록되었습니다." };
  } catch (error) {
    console.error("Leave registration failed", error);
    if (error instanceof z.ZodError) {
      return { status: "error", message: "직원, 날짜와 반차 시간을 다시 확인해 주세요." };
    }
    const message = error instanceof Error ? error.message : "";
    if (message.includes("uq_active_leave") || message.includes("duplicate key")) {
      return { status: "error", message: "이미 같은 날짜와 시간대에 등록된 반차가 있습니다." };
    }
    if (message.includes("반차 잔액이 부족")) {
      return { status: "error", message: "남은 휴가가 부족합니다. 개인 휴가 잔여량을 먼저 수정해 주세요." };
    }
    return { status: "error", message: "반차를 등록하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}

export type SubstituteAcceptActionState = { status: "idle" | "success" | "error"; message: string };

export async function acceptSubstitute(_previousState: SubstituteAcceptActionState, formData: FormData): Promise<SubstituteAcceptActionState> {
  try {
    const input = z.object({
      requestId: z.string().uuid(),
      employeeId: z.string().uuid(),
    }).parse({ requestId: formData.get("requestId"), employeeId: formData.get("employeeId") });
    const result = await requireDatabase()`
      WITH target AS (
        SELECT request.*
        FROM substitute_requests request
        JOIN leave_requests leave ON leave.id = request.leave_request_id AND leave.cancelled = false
        WHERE request.id = ${input.requestId}::uuid AND request.status <> '반차 취소'
      ), eligible AS (
        SELECT employee.id, target.id AS request_id
        FROM employees employee, target
        WHERE employee.id = ${input.employeeId}::uuid
          AND employee.active = true
          AND (
            employee.substitute_eligible = true
            OR (
              employee.role = '서무'
              AND (target.start_datetime AT TIME ZONE 'Asia/Seoul')::date = (target.end_datetime AT TIME ZONE 'Asia/Seoul')::date
              AND (target.end_datetime AT TIME ZONE 'Asia/Seoul')::time <= TIME '13:00'
            )
          )
          AND employee.id <> target.requester_id
          AND NOT EXISTS (
            SELECT 1 FROM substitute_candidates duplicate
            WHERE duplicate.substitute_request_id = target.id AND duplicate.employee_id = employee.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM leave_requests leave
            WHERE leave.employee_id = employee.id AND leave.cancelled = false
              AND leave.start_datetime < target.end_datetime AND leave.end_datetime > target.start_datetime
          )
          AND NOT EXISTS (
            SELECT 1 FROM substitute_candidates occupied_candidate
            JOIN substitute_requests occupied ON occupied.id = occupied_candidate.substitute_request_id
            JOIN leave_requests occupied_leave ON occupied_leave.id = occupied.leave_request_id AND occupied_leave.cancelled = false
            WHERE occupied_candidate.employee_id = employee.id
              AND occupied.id <> target.id
              AND occupied.start_datetime < target.end_datetime AND occupied.end_datetime > target.start_datetime
          )
          AND NOT EXISTS (
            SELECT 1 FROM substitute_unavailability unavailable
            WHERE unavailable.employee_id = employee.id
              AND unavailable.start_datetime < target.end_datetime
              AND unavailable.end_datetime > target.start_datetime
          )
      ), reserved AS (
        UPDATE substitute_requests request
        SET candidate_count = request.candidate_count + 1, updated_at = now()
        FROM eligible
        WHERE request.id = eligible.request_id AND request.candidate_count < 2
        RETURNING request.id AS request_id, eligible.id AS employee_id, request.candidate_count AS priority
      ), inserted AS (
        INSERT INTO substitute_candidates (substitute_request_id, employee_id, priority)
        SELECT request_id, employee_id, priority FROM reserved
        RETURNING *
      ), changed AS (
        UPDATE substitute_requests request SET
          substitute_employee_id = CASE WHEN inserted.priority = 1 THEN inserted.employee_id ELSE request.substitute_employee_id END,
          status = CASE WHEN inserted.priority = 2 THEN '대근 후보 등록 완료' ELSE '대근 후보 모집 중' END,
          responded_at = CASE WHEN inserted.priority = 1 THEN now() ELSE request.responded_at END,
          updated_at = now()
        FROM inserted WHERE request.id = inserted.substitute_request_id
        RETURNING request.*
      ), audit AS (
        INSERT INTO audit_logs (user_id, action_type, target_table, target_id, after_data)
        SELECT NULL::uuid, '대근 후보 ' || inserted.priority || '순위 등록', 'substitute_candidates', inserted.id, to_jsonb(inserted)
        FROM inserted
      )
      SELECT priority::int FROM inserted
    `;
    if (!result.length) return { status: "error", message: "후보가 이미 2명이거나, 중복 지원 또는 해당 시간의 근무·반차·대근 불가 일정 때문에 등록할 수 없습니다." };
    const priority = Number((result[0] as Record<string, unknown>).priority);
    revalidatePath("/");
    revalidatePath("/board");
    return { status: "success", message: `${priority}순위 대근 가능 후보로 등록했습니다.` };
  } catch (error) {
    if (error instanceof z.ZodError) return { status: "error", message: "대근 요청과 지원자를 다시 확인해 주세요." };
    console.error("Substitute candidate registration failed", error);
    return { status: "error", message: "대근 가능 후보를 등록하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}

export type UnavailabilityActionState = { status: "idle" | "success" | "error"; message: string };

export type CalendarEditActionState = { status: "idle" | "success" | "error"; message: string };

export async function updateCalendarLeave(_previousState: CalendarEditActionState, formData: FormData): Promise<CalendarEditActionState> {
  try {
    const input = leaveSchema.extend({ id: z.string().uuid() }).parse({
      id: formData.get("id"),
      leaveDate: formData.get("leaveDate"),
      part: formData.get("part"),
      note: formData.get("note") || undefined,
      employeeId: formData.get("employeeId"),
    });
    const result = await requireDatabase()`
      WITH audio_order AS (
        SELECT id, row_number() OVER (ORDER BY employee_number) - 1 AS audio_rank
        FROM employees WHERE active = true AND role = '음향보조'
      ), before_row AS (
        SELECT leave.*, employee.role, audio_order.audio_rank,
          rotation.start_date AS rotation_start_date,
          rotation.start_shift AS rotation_start_shift
        FROM leave_requests leave
        JOIN employees employee ON employee.id = leave.employee_id AND employee.active = true
        LEFT JOIN audio_order ON audio_order.id = employee.id
        LEFT JOIN audio_rotation_settings rotation ON rotation.employee_id = employee.id
        WHERE leave.id = ${input.id}::uuid AND leave.employee_id = ${input.employeeId}::uuid
          AND leave.cancelled = false
          AND EXTRACT(YEAR FROM leave.leave_date) = EXTRACT(YEAR FROM ${input.leaveDate}::date)
        FOR UPDATE OF leave
      ), effective_employee AS (
        SELECT *, CASE
          WHEN role = '조명보조' THEN 'R'
          WHEN role <> '음향보조' THEN 'A'
          WHEN rotation_start_date IS NOT NULL THEN
            CASE WHEN mod(mod(floor((${input.leaveDate}::date - rotation_start_date) / 14.0)::int, 2) + 2, 2) = 0
              THEN rotation_start_shift
              ELSE CASE WHEN rotation_start_shift = 'A' THEN 'U' ELSE 'A' END END
          WHEN mod(mod((audio_rank + floor((${input.leaveDate}::date - DATE '2026-08-03') / 14.0)::int)::int, 2) + 2, 2) = 0 THEN 'U'
          ELSE 'A'
        END AS shift_name
        FROM before_row
      ), selected_shift AS (
        SELECT employee.*, shift.morning_leave_start, shift.morning_leave_end,
          shift.afternoon_leave_start, shift.afternoon_leave_end
        FROM effective_employee employee
        JOIN shift_types shift ON shift.name = employee.shift_name
        WHERE NOT (employee.shift_name = 'U' AND ${input.part} = '후반')
      ), changed AS (
        UPDATE leave_requests leave SET
          leave_date = ${input.leaveDate}::date,
          leave_type = ${input.part},
          start_datetime = (${input.leaveDate}::date + CASE WHEN ${input.part} = '전반' THEN selected.morning_leave_start ELSE selected.afternoon_leave_start END) AT TIME ZONE 'Asia/Seoul',
          end_datetime = (${input.leaveDate}::date
            + CASE WHEN (CASE WHEN ${input.part} = '전반' THEN selected.morning_leave_end ELSE selected.afternoon_leave_end END)
              <= (CASE WHEN ${input.part} = '전반' THEN selected.morning_leave_start ELSE selected.afternoon_leave_start END)
              THEN 1 ELSE 0 END
            + CASE WHEN ${input.part} = '전반' THEN selected.morning_leave_end ELSE selected.afternoon_leave_end END) AT TIME ZONE 'Asia/Seoul',
          substitute_required = selected.role NOT IN ('서무', '중계보조'),
          notes = ${input.note ?? null}, status = '등록 완료', updated_at = now()
        FROM selected_shift selected
        WHERE leave.id = selected.id
        RETURNING leave.*, selected.role,
          selected.leave_date AS old_leave_date, selected.leave_type AS old_leave_type,
          to_jsonb(selected) AS before_data
      ), coverage AS (
        SELECT changed.*,
          COALESCE(news.coverage_start, changed.start_datetime) AS coverage_start,
          COALESCE(news.coverage_end, changed.end_datetime) AS coverage_end
        FROM changed
        LEFT JOIN LATERAL (
          SELECT min(schedule.actual_start_datetime - make_interval(mins => schedule.preparation_minutes)) AS coverage_start,
            max(schedule.actual_end_datetime + make_interval(mins => schedule.cleanup_minutes)) AS coverage_end
          FROM daily_news_schedules schedule
          JOIN news_program_templates template ON template.id = schedule.program_template_id
          WHERE schedule.schedule_date = changed.leave_date AND schedule.cancelled = false
            AND NOT ((changed.start_datetime AT TIME ZONE 'Asia/Seoul')::time >= TIME '16:00' AND template.program_name = '2시 뉴스외전')
            AND schedule.actual_start_datetime - make_interval(mins => schedule.preparation_minutes) < changed.end_datetime
            AND schedule.actual_end_datetime + make_interval(mins => schedule.cleanup_minutes) > changed.start_datetime
        ) news ON true
      ), cleared_candidates AS (
        DELETE FROM substitute_candidates candidate
        USING coverage
        WHERE candidate.substitute_request_id = coverage.id
          AND (coverage.old_leave_date <> coverage.leave_date OR coverage.old_leave_type <> coverage.leave_type)
        RETURNING candidate.id
      ), updated_request AS (
        UPDATE substitute_requests request SET
          start_datetime = coverage.coverage_start,
          end_datetime = coverage.coverage_end,
          substitute_employee_id = CASE WHEN coverage.old_leave_date <> coverage.leave_date OR coverage.old_leave_type <> coverage.leave_type THEN NULL ELSE request.substitute_employee_id END,
          status = CASE WHEN coverage.role IN ('서무', '중계보조') THEN '대근 불필요'
            WHEN coverage.old_leave_date <> coverage.leave_date OR coverage.old_leave_type <> coverage.leave_type THEN '대근자 미정'
            ELSE request.status END,
          responded_at = CASE WHEN coverage.old_leave_date <> coverage.leave_date OR coverage.old_leave_type <> coverage.leave_type THEN NULL ELSE request.responded_at END,
          candidate_count = CASE WHEN coverage.old_leave_date <> coverage.leave_date OR coverage.old_leave_type <> coverage.leave_type THEN 0 ELSE request.candidate_count END,
          updated_at = now()
        FROM coverage WHERE request.leave_request_id = coverage.id
        RETURNING request.id
      ), inserted_request AS (
        INSERT INTO substitute_requests (leave_request_id, requester_id, start_datetime, end_datetime, status)
        SELECT coverage.id, coverage.employee_id, coverage.coverage_start, coverage.coverage_end, '대근자 미정'
        FROM coverage
        WHERE coverage.role NOT IN ('서무', '중계보조')
          AND NOT EXISTS (SELECT 1 FROM substitute_requests request WHERE request.leave_request_id = coverage.id)
        RETURNING id
      ), audit AS (
        INSERT INTO audit_logs (user_id, action_type, target_table, target_id, before_data, after_data)
        SELECT NULL::uuid, '반차 수정', 'leave_requests', id, before_data, to_jsonb(changed) - 'before_data' FROM changed
      )
      SELECT id::text FROM changed
    `;
    if (!result.length) {
      return { status: "error", message: "수정할 수 없습니다. U 근무자는 후반 반차를 쓸 수 없으며 반차 연도는 기존과 같아야 합니다." };
    }
    revalidatePath("/");
    revalidatePath("/board");
    return { status: "success", message: "반차 정보를 수정했습니다. 날짜나 구분이 바뀌면 대근자는 다시 지정해야 합니다." };
  } catch (error) {
    console.error("Calendar leave update failed", error);
    if (error instanceof z.ZodError) return { status: "error", message: "날짜와 반차 구분을 다시 확인해 주세요." };
    const message = error instanceof Error ? error.message : "";
    if (message.includes("uq_active_leave") || message.includes("duplicate key")) return { status: "error", message: "같은 날짜와 시간대에 이미 등록된 반차가 있습니다." };
    return { status: "error", message: "반차 정보를 수정하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}

export async function updateSubstituteUnavailability(_previousState: CalendarEditActionState, formData: FormData): Promise<CalendarEditActionState> {
  try {
    const input = z.object({
      id: z.string().uuid(),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      start: z.string().regex(/^\d{2}:\d{2}$/),
      end: z.string().regex(/^\d{2}:\d{2}$/),
      reason: z.string().trim().min(2).max(200),
    }).refine((value) => value.endDate > value.startDate || (value.endDate === value.startDate && value.end > value.start), {
      message: "종료 날짜와 시간은 시작보다 늦어야 합니다.", path: ["endDate"],
    }).parse({
      id: formData.get("id"), startDate: formData.get("startDate"), endDate: formData.get("endDate"),
      start: formData.get("start"), end: formData.get("end"), reason: formData.get("reason"),
    });
    const result = await requireDatabase()`
      WITH before_row AS (
        SELECT * FROM substitute_unavailability WHERE id = ${input.id}::uuid FOR UPDATE
      ), changed AS (
        UPDATE substitute_unavailability unavailable SET
          start_datetime = (${input.startDate}::date + ${input.start}::time) AT TIME ZONE 'Asia/Seoul',
          end_datetime = (${input.endDate}::date + ${input.end}::time) AT TIME ZONE 'Asia/Seoul',
          reason_detail = ${input.reason}, updated_at = now()
        FROM before_row before
        WHERE unavailable.id = before.id
        RETURNING unavailable.*, to_jsonb(before) AS before_data
      )
      INSERT INTO audit_logs (user_id, action_type, target_table, target_id, before_data, after_data)
      SELECT NULL::uuid, '대근 불가 수정', 'substitute_unavailability', id, before_data, to_jsonb(changed) - 'before_data' FROM changed
      RETURNING target_id
    `;
    if (!result.length) return { status: "error", message: "해당 대근 불가 등록을 찾지 못했습니다." };
    revalidatePath("/");
    revalidatePath("/board");
    return { status: "success", message: "대근 불가 기간을 수정했습니다." };
  } catch (error) {
    if (error instanceof z.ZodError) return { status: "error", message: error.issues[0]?.message ?? "입력한 기간을 확인해 주세요." };
    console.error("Substitute unavailability update failed", error);
    return { status: "error", message: "대근 불가 정보를 수정하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}

export async function createSubstituteUnavailability(_previousState: UnavailabilityActionState, formData: FormData): Promise<UnavailabilityActionState> {
  try {
    const input = z.object({
      employeeId: z.string().uuid(),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      start: z.string().regex(/^\d{2}:\d{2}$/),
      end: z.string().regex(/^\d{2}:\d{2}$/),
      reason: z.string().trim().min(2).max(200),
    }).refine((value) => value.endDate > value.startDate || (value.endDate === value.startDate && value.end > value.start), {
      message: "종료 날짜와 시간은 시작보다 뒤여야 합니다.", path: ["endDate"],
    }).parse({
      employeeId: formData.get("employeeId"), startDate: formData.get("startDate"), endDate: formData.get("endDate"),
      start: formData.get("start"), end: formData.get("end"), reason: formData.get("reason"),
    });
    const result = await requireDatabase()`
      WITH employee AS (
        SELECT id FROM employees WHERE id = ${input.employeeId}::uuid AND active = true
      ), inserted AS (
        INSERT INTO substitute_unavailability (
          employee_id, start_datetime, end_datetime, reason_type, reason_detail
        )
        SELECT id,
          (${input.startDate}::date + ${input.start}::time) AT TIME ZONE 'Asia/Seoul',
          (${input.endDate}::date + ${input.end}::time) AT TIME ZONE 'Asia/Seoul',
          '대근 불가', ${input.reason}
        FROM employee
        RETURNING *
      )
      INSERT INTO audit_logs (user_id, action_type, target_table, target_id, after_data)
      SELECT NULL::uuid, '대근 불가 등록', 'substitute_unavailability', id, to_jsonb(inserted) FROM inserted
      RETURNING target_id
    `;
    if (!result.length) return { status: "error", message: "활성 직원만 대근 불가를 등록할 수 있습니다." };
    revalidatePath("/");
    revalidatePath("/board");
    return { status: "success", message: "대근 불가 기간을 저장했습니다." };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { status: "error", message: error.issues[0]?.message ?? "입력한 기간을 다시 확인해 주세요." };
    }
    console.error("Substitute unavailability save failed", error);
    return { status: "error", message: "대근 불가를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}

export async function removeSubstituteUnavailability(formData: FormData): Promise<void> {
  const id = z.string().uuid().parse(formData.get("id"));
  await requireDatabase()`
    WITH removed AS (
      DELETE FROM substitute_unavailability WHERE id = ${id}::uuid RETURNING *
    )
    INSERT INTO audit_logs (user_id, action_type, target_table, target_id, before_data)
    SELECT NULL::uuid, '대근 불가 해제', 'substitute_unavailability', id, to_jsonb(removed) FROM removed
  `;
  revalidatePath("/");
  revalidatePath("/board");
}

export async function unlockLeaveBalance(_previousState: LeaveBalanceActionState, formData: FormData): Promise<LeaveBalanceActionState> {
  try {
    const input = z.object({
      employeeId: z.string().uuid(),
      year: z.coerce.number().int().min(2020).max(2100),
      pin: z.string().regex(/^\d{4}$/, "PIN은 숫자 4자리입니다."),
    }).parse({ employeeId: formData.get("employeeId"), year: formData.get("year"), pin: formData.get("pin") });
    const verification = await verifyEmployeePin(input.employeeId, input.pin);
    if (!verification?.valid) return pinError(verification);
    return { status: "success", message: `${verification.name}님의 휴가 정보입니다.`, balance: await getProtectedLeaveBalance(verification, input.year) };
  } catch (error) {
    if (error instanceof z.ZodError) return { status: "error", message: "직원과 숫자 4자리 PIN을 확인해 주세요." };
    console.error("Leave balance unlock failed", error);
    return { status: "error", message: "휴가 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}

export async function updateLeaveBalance(_previousState: LeaveBalanceActionState, formData: FormData): Promise<LeaveBalanceActionState> {
  try {
    const input = z.object({
    employeeId: z.string().uuid(),
    year: z.coerce.number().int().min(2020).max(2100),
    pin: z.string().regex(/^\d{4}$/),
    remainingDays: z.coerce.number().min(0).max(365)
      .refine((value) => Number.isInteger(value * 2), "휴가 수는 0.5 단위로 입력해 주세요."),
  }).parse({
    employeeId: formData.get("employeeId"), year: formData.get("year"), pin: formData.get("pin"), remainingDays: formData.get("remainingDays"),
  });
  const verification = await verifyEmployeePin(input.employeeId, input.pin);
  if (!verification?.valid) return pinError(verification);
  const result = await requireDatabase()`
    WITH employee AS (
      SELECT id FROM employees WHERE id = ${input.employeeId}::uuid AND active = true
    ), before_row AS (
      SELECT * FROM leave_balances
      WHERE employee_id = ${input.employeeId}::uuid AND year = ${input.year}
    ), changed AS (
      INSERT INTO leave_balances (employee_id, year, total_days, used_days)
      SELECT id, ${input.year}, ${input.remainingDays}, 0 FROM employee
      ON CONFLICT (employee_id, year) DO UPDATE SET
        total_days = leave_balances.used_days + EXCLUDED.total_days,
        updated_at = now()
      RETURNING *
    ), audit AS (
      INSERT INTO audit_logs (user_id, action_type, target_table, target_id, before_data, after_data)
      SELECT NULL::uuid, '휴가 잔여량 수정', 'leave_balances', id,
        (SELECT to_jsonb(before_row) FROM before_row), to_jsonb(changed)
      FROM changed
    )
    SELECT id::text FROM changed
  `;
  if (!result.length) return { status: "error", message: "휴가 잔여량을 수정하지 못했습니다." };
  revalidatePath("/");
  return { status: "success", message: "휴가 잔여량을 수정했습니다.", balance: await getProtectedLeaveBalance(verification, input.year) };
  } catch (error) {
    if (error instanceof z.ZodError) return { status: "error", message: "휴가 수는 0.5 단위로 입력해 주세요." };
    console.error("Leave balance update failed", error);
    return { status: "error", message: "휴가 잔여량을 수정하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}

export async function changeLeavePin(_previousState: LeaveBalanceActionState, formData: FormData): Promise<LeaveBalanceActionState> {
  try {
    const input = z.object({
      employeeId: z.string().uuid(),
      currentPin: z.string().regex(/^\d{4}$/),
      newPin: z.string().regex(/^\d{4}$/),
      confirmPin: z.string().regex(/^\d{4}$/),
    }).refine((value) => value.newPin === value.confirmPin, { path: ["confirmPin"], message: "새 PIN이 일치하지 않습니다." }).parse({
      employeeId: formData.get("employeeId"), currentPin: formData.get("currentPin"),
      newPin: formData.get("newPin"), confirmPin: formData.get("confirmPin"),
    });
    const verification = await verifyEmployeePin(input.employeeId, input.currentPin);
    if (!verification?.valid) return pinError(verification);
    await requireDatabase()`
      WITH changed AS (
        UPDATE employees SET pin_hash = crypt(${input.newPin}, gen_salt('bf')), updated_at = now()
        WHERE id = ${input.employeeId}::uuid RETURNING id
      )
      INSERT INTO audit_logs (user_id, action_type, target_table, target_id)
      SELECT NULL::uuid, '개인 휴가 PIN 변경', 'employees', id FROM changed
    `;
    return { status: "success", message: "PIN 번호를 변경했습니다." };
  } catch (error) {
    if (error instanceof z.ZodError) return { status: "error", message: error.issues[0]?.message ?? "PIN은 숫자 4자리입니다." };
    console.error("Leave PIN change failed", error);
    return { status: "error", message: "PIN 번호를 변경하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}

export async function cancelLeave(formData: FormData): Promise<void> {
  const id = z.string().uuid().parse(formData.get("id"));
  const sql = requireDatabase();
  await sql`
    WITH before_row AS (
      SELECT * FROM leave_requests
      WHERE id = ${id}::uuid AND cancelled = false
      FOR UPDATE
    ), cancelled_substitute AS (
      UPDATE substitute_requests sr
      SET status = '반차 취소', updated_at = now()
      FROM before_row br WHERE sr.leave_request_id = br.id
      RETURNING sr.id
    ), updated AS (
      UPDATE leave_requests lr
      SET cancelled = true, status = '취소', updated_at = now()
      FROM before_row br WHERE lr.id = br.id
      RETURNING lr.*, to_jsonb(br) AS before_data
    )
    INSERT INTO audit_logs (user_id, action_type, target_table, target_id, before_data, after_data)
    SELECT NULL, '반차 취소', 'leave_requests', id, before_data, to_jsonb(updated) - 'before_data' FROM updated
  `;
  revalidatePath("/");
  revalidatePath("/board");
}
