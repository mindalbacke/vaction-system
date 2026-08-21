"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSql, isDatabaseConfigured } from "@/lib/db";

function ensureDb() {
  if (!isDatabaseConfigured()) throw new Error("Neon 데이터베이스를 연결한 뒤 사용할 수 있습니다.");
  return getSql();
}

export type ManagedEmployee = {
  id: string;
  name: string;
  role: "서무" | "음향보조" | "조명보조" | "중계보조";
  active: boolean;
};

export type EmployeeMutationResult =
  | { ok: true; employee: ManagedEmployee }
  | { ok: false; error: string };

export type EmployeeDeletionResult =
  | { ok: true; id: string; name: string }
  | { ok: false; error: string };

function employeeMutationError(error: unknown): EmployeeMutationResult {
  console.error("Employee mutation failed", error);
  return { ok: false, error: "저장하지 못했습니다. 입력값과 연결 상태를 확인해 주세요." };
}

export async function createEmployee(formData: FormData) {
  try {
    const input = z.object({
      name: z.string().trim().min(2).max(30),
      role: z.enum(["서무", "음향보조", "조명보조", "중계보조"]),
    }).parse({
      name: formData.get("name"), role: formData.get("role"),
    });
    const studio = input.role === "음향보조" || input.role === "조명보조";
    const substitute = input.role !== "서무";
    const rows = await ensureDb()`
      WITH inserted AS (
        INSERT INTO employees (name, employee_number, role, studio_work_eligible, substitute_eligible)
        VALUES (${input.name}, 'member-' || gen_random_uuid()::text, ${input.role}, ${studio}, ${substitute})
        RETURNING *
      ), balance AS (
        INSERT INTO leave_balances (employee_id, year, total_days, used_days)
        SELECT id, EXTRACT(YEAR FROM CURRENT_DATE)::int, 10, 0 FROM inserted
      ), audit AS (
        INSERT INTO audit_logs (user_id, action_type, target_table, target_id, after_data)
        SELECT NULL::uuid, '직원 등록', 'employees', id, to_jsonb(inserted) FROM inserted
      )
      SELECT id::text, name, role, active FROM inserted
    `;
    const row = rows[0] as Record<string, unknown>;
    revalidatePath("/");
    return { ok: true, employee: { id: String(row.id), name: String(row.name), role: row.role as ManagedEmployee["role"], active: Boolean(row.active) } } satisfies EmployeeMutationResult;
  } catch (error) {
    return employeeMutationError(error);
  }
}

export async function assignShift(formData: FormData) {
  const input = z.object({
    employeeId: z.string().uuid(), shiftId: z.string().uuid(),
    workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).parse({ employeeId: formData.get("employeeId"), shiftId: formData.get("shiftId"), workDate: formData.get("workDate") });
  const result = await ensureDb()`
    WITH employee AS (
      SELECT id FROM employees WHERE id = ${input.employeeId}::uuid AND role = '음향보조' AND active = true
    ), shift AS (
      SELECT * FROM shift_types WHERE id = ${input.shiftId}::uuid AND name IN ('A', 'U') AND active = true
    ),
    changed AS (
      INSERT INTO daily_assignments (employee_id, work_date, shift_type_id, start_datetime, end_datetime)
      SELECT employee.id, ${input.workDate}::date, shift.id,
        (${input.workDate}::date + shift.start_time) AT TIME ZONE 'Asia/Seoul',
        ((${input.workDate}::date + CASE WHEN shift.crosses_midnight THEN 1 ELSE 0 END) + shift.end_time) AT TIME ZONE 'Asia/Seoul'
      FROM employee CROSS JOIN shift
      ON CONFLICT (employee_id, work_date, assignment_type) DO UPDATE SET
        shift_type_id = EXCLUDED.shift_type_id, start_datetime = EXCLUDED.start_datetime,
        end_datetime = EXCLUDED.end_datetime, updated_at = now()
      RETURNING *
    )
    INSERT INTO audit_logs (user_id, action_type, target_table, target_id, after_data)
    SELECT NULL::uuid, '근무 배정', 'daily_assignments', id, to_jsonb(changed) FROM changed
    RETURNING target_id
  `;
  if (!result.length) throw new Error("음향보조 직원은 A 또는 U 근무만 선택할 수 있습니다.");
  revalidatePath("/");
  revalidatePath("/manage");
}

export async function saveAudioRotation(formData: FormData) {
  const input = z.object({
    employeeId: z.string().uuid(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startShift: z.enum(["A", "U"]),
  }).parse({
    employeeId: formData.get("employeeId"),
    startDate: formData.get("startDate"),
    startShift: formData.get("startShift"),
  });
  const result = await ensureDb()`
    WITH employee AS (
      SELECT id FROM employees
      WHERE id = ${input.employeeId}::uuid AND role = '음향보조' AND active = true
    ), before_row AS (
      SELECT * FROM audio_rotation_settings
      WHERE employee_id = ${input.employeeId}::uuid
    ), changed AS (
      INSERT INTO audio_rotation_settings (employee_id, start_date, start_shift)
      SELECT id, ${input.startDate}::date, ${input.startShift} FROM employee
      ON CONFLICT (employee_id) DO UPDATE SET
        start_date = EXCLUDED.start_date,
        start_shift = EXCLUDED.start_shift,
        updated_at = now()
      RETURNING *
    ), audit AS (
      INSERT INTO audit_logs (user_id, action_type, target_table, target_id, before_data, after_data)
      SELECT NULL::uuid, '음향 2주 교대 기준 저장', 'audio_rotation_settings', employee_id,
        (SELECT to_jsonb(before_row) FROM before_row), to_jsonb(changed)
      FROM changed
    )
    SELECT employee_id::text FROM changed
  `;
  if (!result.length) throw new Error("활성 음향보조 직원만 교대 기준을 저장할 수 있습니다.");
  revalidatePath("/");
  revalidatePath("/manage");
}

export async function updateNewsSchedule(formData: FormData) {
  const input = z.object({
    id: z.string().uuid(), scheduleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/),
    preparation: z.coerce.number().int().min(0).max(180), cleanup: z.coerce.number().int().min(0).max(180),
    staff: z.coerce.number().int().min(1).max(10),
  }).parse({
    id: formData.get("id"), scheduleDate: formData.get("scheduleDate"), start: formData.get("start"),
    end: formData.get("end"), preparation: formData.get("preparation"), cleanup: formData.get("cleanup"), staff: formData.get("staff"),
  });
  await ensureDb()`
    WITH before_row AS (SELECT * FROM daily_news_schedules WHERE id = ${input.id}::uuid),
    changed AS (
      UPDATE daily_news_schedules dns SET
        actual_start_datetime = (${input.scheduleDate}::date + ${input.start}::time) AT TIME ZONE 'Asia/Seoul',
        actual_end_datetime = ((${input.scheduleDate}::date + CASE WHEN ${input.end}::time <= ${input.start}::time THEN 1 ELSE 0 END) + ${input.end}::time) AT TIME ZONE 'Asia/Seoul',
        preparation_minutes = ${input.preparation}, cleanup_minutes = ${input.cleanup},
        required_staff = ${input.staff}, schedule_changed = true, updated_at = now()
      FROM before_row br WHERE dns.id = br.id
      RETURNING dns.*, to_jsonb(br) AS before_data
    )
    INSERT INTO audit_logs (user_id, action_type, target_table, target_id, before_data, after_data)
    SELECT NULL::uuid, '뉴스 편성 수정', 'daily_news_schedules', id, before_data, to_jsonb(changed) - 'before_data' FROM changed
  `;
  revalidatePath("/");
  revalidatePath("/manage");
}

export async function createRelay(formData: FormData) {
  const input = z.object({
    title: z.string().trim().min(2).max(100), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/),
    employeeId: z.string().uuid(), location: z.string().trim().max(100).optional(),
  }).parse({
    title: formData.get("title"), date: formData.get("date"), start: formData.get("start"),
    end: formData.get("end"), employeeId: formData.get("employeeId"), location: formData.get("location") || undefined,
  });
  await ensureDb()`
    WITH inserted AS (
      INSERT INTO relay_schedules (title, start_datetime, end_datetime, location)
      VALUES (
        ${input.title}, (${input.date}::date + ${input.start}::time) AT TIME ZONE 'Asia/Seoul',
        ((${input.date}::date + CASE WHEN ${input.end}::time <= ${input.start}::time THEN 1 ELSE 0 END) + ${input.end}::time) AT TIME ZONE 'Asia/Seoul',
        ${input.location ?? null}
      ) RETURNING *
    ), member AS (
      INSERT INTO relay_schedule_members (relay_schedule_id, employee_id)
      SELECT id, ${input.employeeId}::uuid FROM inserted
    )
    INSERT INTO audit_logs (user_id, action_type, target_table, target_id, after_data)
    SELECT NULL::uuid, '중계 일정 등록', 'relay_schedules', id, to_jsonb(inserted) FROM inserted
  `;
  revalidatePath("/");
  revalidatePath("/manage");
}

export async function respondSubstitute(formData: FormData) {
  const input = z.object({ id: z.string().uuid(), response: z.enum(["수락", "거절"]) }).parse({ id: formData.get("id"), response: formData.get("response") });
  await ensureDb()`
    WITH changed AS (
    UPDATE substitute_requests SET
      status = CASE WHEN ${input.response} = '수락' THEN '대근 확정' ELSE '대근 거절' END,
      responded_at = now(), updated_at = now()
    WHERE id = ${input.id}::uuid
    RETURNING *
    )
    INSERT INTO audit_logs (user_id, action_type, target_table, target_id, after_data)
    SELECT NULL::uuid, '대근 ' || ${input.response}, 'substitute_requests', id, to_jsonb(changed) FROM changed
  `;
  revalidatePath("/");
  revalidatePath("/manage");
}

export async function createUnavailability(formData: FormData) {
  const input = z.object({
    employeeId: z.string().uuid(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    start: z.string().regex(/^\d{2}:\d{2}$/),
    end: z.string().regex(/^\d{2}:\d{2}$/),
    reason: z.enum(["개인 일정", "업무 수행 곤란", "기타"]),
    detail: z.string().trim().max(200).optional(),
  }).parse({
    employeeId: formData.get("employeeId"), date: formData.get("date"), start: formData.get("start"), end: formData.get("end"),
    reason: formData.get("reason"), detail: formData.get("detail") || undefined,
  });
  await ensureDb()`
    WITH inserted AS (
      INSERT INTO substitute_unavailability (employee_id, start_datetime, end_datetime, reason_type, reason_detail)
      VALUES (
        ${input.employeeId}::uuid,
        (${input.date}::date + ${input.start}::time) AT TIME ZONE 'Asia/Seoul',
        ((${input.date}::date + CASE WHEN ${input.end}::time <= ${input.start}::time THEN 1 ELSE 0 END) + ${input.end}::time) AT TIME ZONE 'Asia/Seoul',
        ${input.reason}, ${input.detail ?? null}
      ) RETURNING *
    )
    INSERT INTO audit_logs (user_id, action_type, target_table, target_id, after_data)
    SELECT NULL::uuid, '대근 불가 등록', 'substitute_unavailability', id, to_jsonb(inserted) FROM inserted
  `;
  revalidatePath("/manage");
}

export async function createSubstituteRequest(formData: FormData) {
  const input = z.object({
    leaveId: z.string().uuid(),
    newsScheduleId: z.string().uuid(),
    substituteEmployeeId: z.string().uuid(),
  }).parse({
    leaveId: formData.get("leaveId"),
    newsScheduleId: formData.get("newsScheduleId"),
    substituteEmployeeId: formData.get("substituteEmployeeId"),
  });
  const result = await ensureDb()`
    WITH leave_row AS (
      SELECT * FROM leave_requests
      WHERE id = ${input.leaveId}::uuid AND cancelled = false
    ), target_range AS (
      SELECT dns.*,
        dns.actual_start_datetime - make_interval(mins => dns.preparation_minutes) AS needed_start,
        dns.actual_end_datetime + make_interval(mins => dns.cleanup_minutes) AS needed_end
      FROM daily_news_schedules dns WHERE dns.id = ${input.newsScheduleId}::uuid
    ), candidate AS (
      SELECT e.* FROM employees e, target_range tr
      WHERE e.id = ${input.substituteEmployeeId}::uuid AND e.active = true
        AND e.substitute_eligible = true AND e.role <> '서무'
        AND NOT EXISTS (
          SELECT 1 FROM daily_assignments da
          WHERE da.employee_id = e.id AND da.start_datetime < tr.needed_end AND da.end_datetime > tr.needed_start
        )
        AND NOT EXISTS (
          SELECT 1 FROM leave_requests lr
          WHERE lr.employee_id = e.id AND lr.cancelled = false
            AND lr.start_datetime < tr.needed_end AND lr.end_datetime > tr.needed_start
        )
        AND NOT EXISTS (
          SELECT 1 FROM substitute_unavailability su
          WHERE su.employee_id = e.id AND su.start_datetime < tr.needed_end AND su.end_datetime > tr.needed_start
        )
        AND NOT EXISTS (
          SELECT 1 FROM relay_schedule_members rsm JOIN relay_schedules rs ON rs.id = rsm.relay_schedule_id
          WHERE rsm.employee_id = e.id AND rs.start_datetime < tr.needed_end AND rs.end_datetime > tr.needed_start
        )
    ), inserted AS (
      INSERT INTO substitute_requests (
        leave_request_id, news_schedule_id, requester_id, substitute_employee_id,
        start_datetime, end_datetime, status
      )
      SELECT lr.id, tr.id, lr.employee_id, c.id, tr.needed_start, tr.needed_end, '대근 요청 중'
      FROM leave_row lr, target_range tr, candidate c
      RETURNING *
    )
    INSERT INTO audit_logs (user_id, action_type, target_table, target_id, after_data)
    SELECT NULL::uuid, '대근 요청', 'substitute_requests', id, to_jsonb(inserted) FROM inserted
    RETURNING target_id
  `;
  if (!result.length) throw new Error("선택한 직원은 해당 시간에 대근할 수 없습니다.");
  revalidatePath("/");
  revalidatePath("/manage");
}

export async function updateEmployee(formData: FormData) {
  try {
    const input = z.object({
      id: z.string().uuid(), name: z.string().trim().min(2).max(30),
      role: z.enum(["서무", "음향보조", "조명보조", "중계보조"]),
    }).parse({ id: formData.get("id"), name: formData.get("name"), role: formData.get("role") });
    const studio = input.role === "음향보조" || input.role === "조명보조";
    const substitute = input.role !== "서무";
    const rows = await ensureDb()`
      WITH before_row AS (SELECT * FROM employees WHERE id = ${input.id}::uuid),
      changed AS (
        UPDATE employees e SET name = ${input.name}, role = ${input.role},
          studio_work_eligible = ${studio}, substitute_eligible = ${substitute}, updated_at = now()
        FROM before_row br WHERE e.id = br.id
        RETURNING e.*, to_jsonb(br) AS before_data
      ), audit AS (
        INSERT INTO audit_logs (user_id, action_type, target_table, target_id, before_data, after_data)
        SELECT NULL::uuid, '직원 수정', 'employees', id, before_data, to_jsonb(changed) - 'before_data' FROM changed
      )
      SELECT id::text, name, role, active FROM changed
    `;
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) return { ok: false, error: "해당 직원을 찾을 수 없습니다." } satisfies EmployeeMutationResult;
    revalidatePath("/");
    return { ok: true, employee: { id: String(row.id), name: String(row.name), role: row.role as ManagedEmployee["role"], active: Boolean(row.active) } } satisfies EmployeeMutationResult;
  } catch (error) {
    return employeeMutationError(error);
  }
}

export async function toggleEmployeeActive(formData: FormData) {
  try {
    const id = z.string().uuid().parse(formData.get("id"));
    const rows = await ensureDb()`
      WITH before_row AS (SELECT * FROM employees WHERE id = ${id}::uuid),
      changed AS (
        UPDATE employees e SET active = NOT e.active, updated_at = now()
        FROM before_row br WHERE e.id = br.id
        RETURNING e.*, to_jsonb(br) AS before_data
      ), audit AS (
        INSERT INTO audit_logs (user_id, action_type, target_table, target_id, before_data, after_data)
        SELECT NULL::uuid, '직원 상태 변경', 'employees', id, before_data, to_jsonb(changed) - 'before_data' FROM changed
      )
      SELECT id::text, name, role, active FROM changed
    `;
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) return { ok: false, error: "해당 직원을 찾을 수 없습니다." } satisfies EmployeeMutationResult;
    revalidatePath("/");
    return { ok: true, employee: { id: String(row.id), name: String(row.name), role: row.role as ManagedEmployee["role"], active: Boolean(row.active) } } satisfies EmployeeMutationResult;
  } catch (error) {
    return employeeMutationError(error);
  }
}

export async function deleteEmployee(formData: FormData): Promise<EmployeeDeletionResult> {
  try {
    const id = z.string().uuid().parse(formData.get("id"));
    const rows = await ensureDb()`
      WITH before_row AS (
        SELECT * FROM employees WHERE id = ${id}::uuid AND deleted_at IS NULL
      ), changed AS (
        UPDATE employees employee
        SET active = false, deleted_at = now(), updated_at = now()
        FROM before_row
        WHERE employee.id = before_row.id
        RETURNING employee.id, employee.name, to_jsonb(before_row) AS before_data, to_jsonb(employee) AS after_data
      ), audit AS (
        INSERT INTO audit_logs (user_id, action_type, target_table, target_id, before_data, after_data)
        SELECT NULL::uuid, '직원 삭제', 'employees', id, before_data, after_data FROM changed
      )
      SELECT id::text, name FROM changed
    `;
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) return { ok: false, error: "이미 삭제되었거나 해당 직원을 찾을 수 없습니다." };
    revalidatePath("/");
    revalidatePath("/manage");
    revalidatePath("/schedule");
    return { ok: true, id: String(row.id), name: String(row.name) };
  } catch (error) {
    console.error("Employee deletion failed", error);
    return { ok: false, error: "직원을 삭제하지 못했습니다. 연결 상태를 확인해 주세요." };
  }
}

export async function cancelRelay(formData: FormData) {
  const id = z.string().uuid().parse(formData.get("id"));
  await ensureDb()`
    WITH changed AS (
      UPDATE relay_schedules SET cancelled = true, updated_at = now()
      WHERE id = ${id}::uuid AND cancelled = false RETURNING *
    )
    INSERT INTO audit_logs (user_id, action_type, target_table, target_id, after_data)
    SELECT NULL::uuid, '중계 일정 취소', 'relay_schedules', id, to_jsonb(changed) FROM changed
  `;
  revalidatePath("/");
  revalidatePath("/manage");
}

export async function cancelNewsSchedule(formData: FormData) {
  const id = z.string().uuid().parse(formData.get("id"));
  await ensureDb()`
    WITH changed AS (
      UPDATE daily_news_schedules SET cancelled = true, updated_at = now()
      WHERE id = ${id}::uuid AND cancelled = false RETURNING *
    )
    INSERT INTO audit_logs (user_id, action_type, target_table, target_id, after_data)
    SELECT NULL::uuid, '뉴스 편성 취소', 'daily_news_schedules', id, to_jsonb(changed) FROM changed
  `;
  revalidatePath("/");
  revalidatePath("/manage");
}

export async function loadDefaultSchedules(formData: FormData) {
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(formData.get("date"));
  await ensureDb()`
    WITH inserted AS (
      INSERT INTO daily_news_schedules (
        schedule_date, program_template_id, actual_start_datetime, actual_end_datetime,
        preparation_minutes, cleanup_minutes, required_staff, live_broadcast
      )
      SELECT ${date}::date, id,
        (${date}::date + default_start_time) AT TIME ZONE 'Asia/Seoul',
        ((${date}::date + default_start_time) + make_interval(mins => default_duration_minutes)) AT TIME ZONE 'Asia/Seoul',
        preparation_minutes, cleanup_minutes, required_staff, true
      FROM news_program_templates WHERE active = true AND default_start_time IS NOT NULL
      ON CONFLICT (schedule_date, program_template_id) DO UPDATE SET
        actual_start_datetime = EXCLUDED.actual_start_datetime,
        actual_end_datetime = EXCLUDED.actual_end_datetime,
        preparation_minutes = EXCLUDED.preparation_minutes,
        cleanup_minutes = EXCLUDED.cleanup_minutes,
        required_staff = EXCLUDED.required_staff,
        cancelled = false,
        schedule_changed = false,
        updated_at = now()
      RETURNING *
    )
    INSERT INTO audit_logs (user_id, action_type, target_table, target_id, after_data)
    SELECT NULL::uuid, '기본 편성 불러오기', 'daily_news_schedules', id, to_jsonb(inserted) FROM inserted
  `;
  revalidatePath("/");
  revalidatePath("/manage");
}
