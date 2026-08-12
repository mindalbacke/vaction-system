"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSql, isDatabaseConfigured } from "@/lib/db";

export type ScheduleActionState = { status: "idle" | "success" | "error"; message: string };

function requireDatabase() {
  if (!isDatabaseConfigured()) throw new Error("Neon 데이터베이스가 연결되어 있지 않습니다.");
  return getSql();
}

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const monthSchema = z.string().regex(/^\d{4}-\d{2}$/);
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export async function saveWorkSchedulePeriod(_previous: ScheduleActionState, formData: FormData): Promise<ScheduleActionState> {
  try {
    const input = z.object({
      employeeId: z.string().uuid(),
      startDate: dateSchema,
      endDate: dateSchema,
      mode: z.enum(["A", "R", "U", "CUSTOM"]),
      startTime: timeSchema,
      endTime: timeSchema,
    }).parse({
      employeeId: formData.get("employeeId"),
      startDate: formData.get("startDate"),
      endDate: formData.get("endDate"),
      mode: formData.get("mode"),
      startTime: formData.get("startTime"),
      endTime: formData.get("endTime"),
    });
    const start = new Date(`${input.startDate}T00:00:00Z`);
    const end = new Date(`${input.endDate}T00:00:00Z`);
    const dayCount = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
    if (dayCount < 1 || dayCount > 93) {
      return { status: "error", message: "기간은 시작일부터 93일 이내로 선택해 주세요." };
    }

    const result = await requireDatabase()`
      WITH target AS (
        SELECT id
        FROM employees
        WHERE id = ${input.employeeId}::uuid
          AND active = true
          AND role IN ('음향보조', '조명보조', '중계보조')
      ), selected_shift AS (
        SELECT id, start_time, end_time, crosses_midnight
        FROM shift_types
        WHERE name = ${input.mode} AND active = true
      ), dates AS (
        SELECT day::date AS work_date
        FROM generate_series(${input.startDate}::date, ${input.endDate}::date, interval '1 day') day
      ), prepared AS (
        SELECT target.id AS employee_id, dates.work_date,
          CASE WHEN ${input.mode} = 'CUSTOM' THEN NULL ELSE selected_shift.id END AS shift_type_id,
          CASE WHEN ${input.mode} = 'CUSTOM' THEN ${input.startTime}::time ELSE selected_shift.start_time END AS start_time,
          CASE WHEN ${input.mode} = 'CUSTOM' THEN ${input.endTime}::time ELSE selected_shift.end_time END AS end_time,
          CASE WHEN ${input.mode} = 'CUSTOM'
            THEN ${input.endTime}::time <= ${input.startTime}::time
            ELSE selected_shift.crosses_midnight
          END AS crosses_midnight
        FROM target
        CROSS JOIN dates
        LEFT JOIN selected_shift ON true
        WHERE ${input.mode} = 'CUSTOM' OR selected_shift.id IS NOT NULL
      ), changed AS (
        INSERT INTO daily_assignments (
          employee_id, work_date, shift_type_id, start_datetime, end_datetime, assignment_type
        )
        SELECT employee_id, work_date, shift_type_id,
          (work_date + start_time) AT TIME ZONE 'Asia/Seoul',
          ((work_date + CASE WHEN crosses_midnight THEN 1 ELSE 0 END) + end_time) AT TIME ZONE 'Asia/Seoul',
          '근무'
        FROM prepared
        ON CONFLICT (employee_id, work_date, assignment_type) DO UPDATE SET
          shift_type_id = EXCLUDED.shift_type_id,
          start_datetime = EXCLUDED.start_datetime,
          end_datetime = EXCLUDED.end_datetime,
          updated_at = now()
        RETURNING id
      )
      SELECT count(*)::int AS changed_count FROM changed
    `;
    const changedCount = Number((result[0] as Record<string, unknown>)?.changed_count ?? 0);
    if (changedCount !== dayCount) throw new Error("직원 또는 근무형태를 찾지 못했습니다.");
    revalidatePath("/schedule");
    const modeLabel = input.mode === "CUSTOM" ? `${input.startTime}부터 ${input.endTime}` : input.mode;
    return { status: "success", message: `${dayCount}일간 ${modeLabel} 근무를 저장했습니다.` };
  } catch (error) {
    console.error("Work schedule period save failed", error);
    return { status: "error", message: "연속 근무를 저장하지 못했습니다. 입력값을 확인하고 다시 시도해 주세요." };
  }
}

export async function saveDailyWorkScheduleLegacy(_previous: ScheduleActionState, formData: FormData): Promise<ScheduleActionState> {
  try {
    const input = z.object({
      workDate: dateSchema,
      employeeIds: z.array(z.string().uuid()).max(100),
    }).parse({
      workDate: formData.get("workDate"),
      employeeIds: formData.getAll("employeeIds"),
    });
    const selectedJson = JSON.stringify(input.employeeIds);
    await requireDatabase()`
      WITH removed AS (
        DELETE FROM daily_assignments assignment
        USING employees employee
        WHERE assignment.employee_id = employee.id
          AND assignment.work_date = ${input.workDate}::date
          AND assignment.assignment_type = '근무'
          AND employee.role IN ('음향보조', '조명보조', '중계보조')
        RETURNING assignment.id
      ), selected AS (
        SELECT value::uuid AS employee_id
        FROM jsonb_array_elements_text(${selectedJson}::jsonb)
      ), employee_shift AS (
        SELECT employee.id AS employee_id,
          CASE
            WHEN employee.role = '조명보조' THEN 'R'
            WHEN employee.role = '음향보조' THEN
              CASE WHEN mod(abs(floor((${input.workDate}::date - COALESCE(rotation.start_date, DATE '2026-08-03'))::numeric / 14))::int, 2) = 0
                THEN COALESCE(rotation.start_shift,
                  CASE WHEN mod(row_number() OVER (PARTITION BY employee.role ORDER BY employee.employee_number) - 1, 2) = 0 THEN 'U' ELSE 'A' END)
                ELSE CASE WHEN COALESCE(rotation.start_shift,
                  CASE WHEN mod(row_number() OVER (PARTITION BY employee.role ORDER BY employee.employee_number) - 1, 2) = 0 THEN 'U' ELSE 'A' END) = 'A' THEN 'U' ELSE 'A' END
              END
            ELSE 'A'
          END AS shift_name
        FROM employees employee
        JOIN selected ON selected.employee_id = employee.id
        LEFT JOIN audio_rotation_settings rotation ON rotation.employee_id = employee.id
        WHERE employee.active = true AND employee.role IN ('음향보조', '조명보조', '중계보조')
      ), inserted AS (
        INSERT INTO daily_assignments (
          employee_id, work_date, shift_type_id, start_datetime, end_datetime, assignment_type
        )
        SELECT employee_shift.employee_id, ${input.workDate}::date, shift.id,
          (${input.workDate}::date + shift.start_time) AT TIME ZONE 'Asia/Seoul',
          ((${input.workDate}::date + CASE WHEN shift.crosses_midnight THEN 1 ELSE 0 END) + shift.end_time) AT TIME ZONE 'Asia/Seoul',
          '근무'
        FROM employee_shift
        JOIN shift_types shift ON shift.name = employee_shift.shift_name AND shift.active = true
        RETURNING id
      )
      SELECT (SELECT count(*) FROM removed)::int AS removed_count,
        (SELECT count(*) FROM inserted)::int AS inserted_count
    `;
    revalidatePath("/schedule");
    return { status: "success", message: "이날 근무표를 저장했습니다." };
  } catch (error) {
    console.error("Daily work schedule save failed", error);
    return { status: "error", message: "근무표를 저장하지 못했습니다. 다시 시도해 주세요." };
  }
}

const dailyWorkEntrySchema = z.object({
  employeeId: z.string().uuid(),
  mode: z.enum(["A", "R", "U", "CUSTOM"]),
  startTime: timeSchema,
  endTime: timeSchema,
});

export async function saveDailyWorkSchedule(_previous: ScheduleActionState, formData: FormData): Promise<ScheduleActionState> {
  try {
    const workDate = dateSchema.parse(formData.get("workDate"));
    const entries = z.array(dailyWorkEntrySchema).max(20).refine(
      (items) => new Set(items.map((item) => item.employeeId)).size === items.length,
      "동일한 근무자가 중복되었습니다.",
    ).parse(formData.getAll("assignmentEntries").map((entry) => JSON.parse(String(entry))));
    const selectedJson = JSON.stringify(entries);
    const result = await requireDatabase()`
      WITH removed AS (
        DELETE FROM daily_assignments assignment
        USING employees employee
        WHERE assignment.employee_id = employee.id
          AND assignment.work_date = ${workDate}::date
          AND assignment.assignment_type = '근무'
          AND employee.role IN ('음향보조', '조명보조', '중계보조')
        RETURNING assignment.id
      ), selected AS (
        SELECT
          (entry->>'employeeId')::uuid AS employee_id,
          entry->>'mode' AS mode,
          (entry->>'startTime')::time AS custom_start,
          (entry->>'endTime')::time AS custom_end
        FROM jsonb_array_elements(${selectedJson}::jsonb) entry
      ), prepared AS (
        SELECT employee.id AS employee_id, selected.mode,
          CASE WHEN selected.mode = 'CUSTOM' THEN NULL ELSE shift.id END AS shift_type_id,
          CASE WHEN selected.mode = 'CUSTOM' THEN selected.custom_start ELSE shift.start_time END AS start_time,
          CASE WHEN selected.mode = 'CUSTOM' THEN selected.custom_end ELSE shift.end_time END AS end_time,
          CASE WHEN selected.mode = 'CUSTOM'
            THEN selected.custom_end <= selected.custom_start
            ELSE shift.crosses_midnight
          END AS crosses_midnight
        FROM selected
        JOIN employees employee ON employee.id = selected.employee_id
          AND employee.active = true
          AND employee.role IN ('음향보조', '조명보조', '중계보조')
        LEFT JOIN shift_types shift ON shift.name = selected.mode AND shift.active = true
        WHERE selected.mode = 'CUSTOM' OR shift.id IS NOT NULL
      ), inserted AS (
        INSERT INTO daily_assignments (
          employee_id, work_date, shift_type_id, start_datetime, end_datetime, assignment_type
        )
        SELECT employee_id, ${workDate}::date, shift_type_id,
          (${workDate}::date + start_time) AT TIME ZONE 'Asia/Seoul',
          ((${workDate}::date + CASE WHEN crosses_midnight THEN 1 ELSE 0 END) + end_time) AT TIME ZONE 'Asia/Seoul',
          '근무'
        FROM prepared
        RETURNING id
      )
      SELECT (SELECT count(*) FROM removed)::int AS removed_count,
        (SELECT count(*) FROM inserted)::int AS inserted_count
    `;
    const insertedCount = Number((result[0] as Record<string, unknown>)?.inserted_count ?? 0);
    if (insertedCount !== entries.length) throw new Error("직원 또는 근무형태를 찾지 못했습니다.");
    revalidatePath("/schedule");
    return { status: "success", message: `이날 근무자 ${entries.length}명의 근무형태를 저장했습니다.` };
  } catch (error) {
    console.error("Daily work schedule save failed", error);
    return { status: "error", message: "근무표를 저장하지 못했습니다. 근무형태와 시간을 확인해 주세요." };
  }
}

export async function saveAudioAPeriod(_previous: ScheduleActionState, formData: FormData): Promise<ScheduleActionState> {
  try {
    const input = z.object({ employeeId: z.string().uuid(), startDate: dateSchema }).parse({
      employeeId: formData.get("employeeId"), startDate: formData.get("startDate"),
    });
    const result = await requireDatabase()`
      WITH target AS (
        SELECT id FROM employees
        WHERE id = ${input.employeeId}::uuid AND role = '음향보조' AND active = true
      ), active_audio AS (
        SELECT id FROM employees WHERE role = '음향보조' AND active = true
      ), changed AS (
        INSERT INTO audio_rotation_settings (employee_id, start_date, start_shift)
        SELECT audio.id, ${input.startDate}::date,
          CASE WHEN audio.id = ${input.employeeId}::uuid THEN 'A' ELSE 'U' END
        FROM active_audio audio
        WHERE EXISTS (SELECT 1 FROM target)
        ON CONFLICT (employee_id) DO UPDATE SET
          start_date = EXCLUDED.start_date,
          start_shift = EXCLUDED.start_shift,
          updated_at = now()
        RETURNING employee_id
      )
      SELECT count(*)::int AS changed_count FROM changed
    `;
    if (Number((result[0] as Record<string, unknown>)?.changed_count ?? 0) === 0) throw new Error("음향보조 직원을 찾지 못했습니다.");
    revalidatePath("/");
    revalidatePath("/manage");
    revalidatePath("/schedule");
    return { status: "success", message: "선택한 날부터 2주간 A 담당자로 저장했습니다." };
  } catch (error) {
    console.error("Audio A period save failed", error);
    return { status: "error", message: "음향 A 담당 기간을 저장하지 못했습니다. 다시 시도해 주세요." };
  }
}

export async function setAudioAMonthExclusion(_previous: ScheduleActionState, formData: FormData): Promise<ScheduleActionState> {
  try {
    const input = z.object({ month: monthSchema, operation: z.enum(["exclude", "restore"]) }).parse({
      month: formData.get("month"), operation: formData.get("operation"),
    });
    const sql = requireDatabase();
    if (input.operation === "exclude") {
      await sql`
        INSERT INTO audio_rotation_month_exclusions (month_start)
        VALUES ((${input.month} || '-01')::date)
        ON CONFLICT (month_start) DO NOTHING
      `;
    } else {
      await sql`
        DELETE FROM audio_rotation_month_exclusions
        WHERE month_start = ((${input.month} || '-01')::date)
      `;
    }
    revalidatePath("/schedule");
    return input.operation === "exclude"
      ? { status: "success", message: `${input.month} 음향 A 2주 표시를 해제했습니다.` }
      : { status: "success", message: `${input.month} 음향 A 2주 표시를 복구했습니다.` };
  } catch (error) {
    console.error("Audio A month exclusion save failed", error);
    return { status: "error", message: "선택한 달의 음향 A 설정을 변경하지 못했습니다. 다시 시도해 주세요." };
  }
}

export async function saveScheduleEmployeeColors(_previous: ScheduleActionState, formData: FormData): Promise<ScheduleActionState> {
  try {
    const colorEntry = z.string().regex(/^[0-9a-f-]{36}:(?:[0-9]|1[01])$/i);
    const entries = z.array(colorEntry).min(1).max(20).parse(formData.getAll("colors"));
    const selections = entries.map((entry) => {
      const separator = entry.lastIndexOf(":");
      return { employeeId: entry.slice(0, separator), color: Number(entry.slice(separator + 1)) };
    });
    const selectionJson = JSON.stringify(selections);
    const result = await requireDatabase()`
      WITH selections AS (
        SELECT (item->>'employeeId')::uuid AS employee_id, (item->>'color')::smallint AS color_index
        FROM jsonb_array_elements(${selectionJson}::jsonb) item
      ), changed AS (
        UPDATE employees employee
        SET schedule_color = selections.color_index, updated_at = now()
        FROM selections
        WHERE employee.id = selections.employee_id
          AND employee.active = true
          AND employee.role IN ('음향보조', '조명보조', '중계보조')
        RETURNING employee.id
      )
      SELECT count(*)::int AS changed_count FROM changed
    `;
    if (Number((result[0] as Record<string, unknown>)?.changed_count ?? 0) !== selections.length) throw new Error("일부 직원을 찾지 못했습니다.");
    revalidatePath("/schedule");
    return { status: "success", message: "근무자별 색상을 저장했습니다." };
  } catch (error) {
    console.error("Schedule employee color save failed", error);
    return { status: "error", message: "색상을 저장하지 못했습니다. 다시 시도해 주세요." };
  }
}
