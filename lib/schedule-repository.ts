import { endOfMonth, endOfWeek, format, parseISO, startOfMonth, startOfWeek } from "date-fns";
import type { DailyWorkAssignment, ScheduleEmployee } from "@/lib/domain";
import { getSql, isDatabaseConfigured } from "@/lib/db";
import { demoEmployees } from "@/lib/demo-data";
import { buildAudioAPeriods, type AudioRotationSetting } from "@/lib/work-schedule";

type Row = Record<string, unknown>;

export async function getMonthlyWorkSchedule(month: string) {
  const monthDate = parseISO(`${month}-01`);
  const rangeStart = format(startOfWeek(startOfMonth(monthDate), { weekStartsOn: 0 }), "yyyy-MM-dd");
  const rangeEnd = format(endOfWeek(endOfMonth(monthDate), { weekStartsOn: 0 }), "yyyy-MM-dd");

  if (!isDatabaseConfigured()) {
    const employees: ScheduleEmployee[] = demoEmployees
      .filter((employee) => employee.role === "음향보조" || employee.role === "조명보조" || employee.role === "중계보조")
      .map(({ id, name, role }, color) => ({ id, name, role, color: color % 12 }));
    const settings: AudioRotationSetting[] = demoEmployees
      .filter((employee) => employee.role === "음향보조")
      .map((employee, audioIndex) => ({
        employeeId: employee.id,
        employeeName: employee.name,
        audioIndex,
        startDate: employee.rotationStartDate,
        startShift: employee.rotationStartShift,
      }));
    return { employees, assignments: [], audioPeriods: buildAudioAPeriods(rangeStart, rangeEnd, settings), audioMonthExcluded: false, databaseConnected: false };
  }

  const sql = getSql();
  const [employeeRows, assignmentRows, exclusionRows] = await Promise.all([
    sql`
      SELECT employee.id::text, employee.name, employee.role, employee.schedule_color,
        rotation.start_date::text AS rotation_start_date,
        rotation.start_shift AS rotation_start_shift
      FROM employees employee
      LEFT JOIN audio_rotation_settings rotation ON rotation.employee_id = employee.id
      WHERE employee.active = true AND employee.role IN ('음향보조', '조명보조', '중계보조')
      ORDER BY employee.role, employee.employee_number
    `,
    sql`
      SELECT assignment.employee_id::text, employee.name AS employee_name, employee.role,
        assignment.work_date::text,
        COALESCE(shift.name, '직접') AS shift_name,
        to_char(assignment.start_datetime AT TIME ZONE 'Asia/Seoul', 'HH24:MI') AS start_time,
        to_char(assignment.end_datetime AT TIME ZONE 'Asia/Seoul', 'HH24:MI') AS end_time
      FROM daily_assignments assignment
      JOIN employees employee ON employee.id = assignment.employee_id AND employee.active = true
      LEFT JOIN shift_types shift ON shift.id = assignment.shift_type_id
      WHERE assignment.assignment_type = '근무'
        AND employee.role IN ('음향보조', '조명보조', '중계보조')
        AND assignment.work_date BETWEEN ${rangeStart}::date AND ${rangeEnd}::date
      ORDER BY assignment.work_date, employee.role, employee.employee_number
    `,
    sql`
      SELECT to_char(month_start, 'YYYY-MM') AS excluded_month
      FROM audio_rotation_month_exclusions
      WHERE month_start BETWEEN date_trunc('month', ${rangeStart}::date)::date
        AND date_trunc('month', ${rangeEnd}::date)::date
      ORDER BY month_start
    `,
  ]);

  const employees: ScheduleEmployee[] = (employeeRows as Row[]).map((row) => ({
    id: String(row.id), name: String(row.name), role: row.role as ScheduleEmployee["role"], color: Number(row.schedule_color),
  }));
  let audioIndex = 0;
  const settings: AudioRotationSetting[] = (employeeRows as Row[]).flatMap((row) => {
    if (row.role !== "음향보조") return [];
    return [{
      employeeId: String(row.id), employeeName: String(row.name), audioIndex: audioIndex++,
      startDate: row.rotation_start_date ? String(row.rotation_start_date) : undefined,
      startShift: row.rotation_start_shift === "A" || row.rotation_start_shift === "U" ? row.rotation_start_shift : undefined,
    }];
  });
  const assignments: DailyWorkAssignment[] = (assignmentRows as Row[]).map((row) => ({
    employeeId: String(row.employee_id), employeeName: String(row.employee_name), role: row.role as DailyWorkAssignment["role"],
    workDate: String(row.work_date), shift: row.shift_name as DailyWorkAssignment["shift"],
    start: String(row.start_time), end: String(row.end_time),
  }));

  const excludedMonths = (exclusionRows as Row[]).map((row) => String(row.excluded_month));
  return {
    employees,
    assignments,
    audioPeriods: buildAudioAPeriods(rangeStart, rangeEnd, settings, excludedMonths),
    audioMonthExcluded: excludedMonths.includes(month),
    databaseConnected: true,
  };
}
