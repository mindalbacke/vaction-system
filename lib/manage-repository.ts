import { getSql, isDatabaseConfigured } from "@/lib/db";
import { demoEmployees, demoPrograms } from "@/lib/demo-data";
import type { EmployeeRole } from "@/lib/domain";

type Row = Record<string, unknown>;

export async function getManagedEmployees() {
  if (!isDatabaseConfigured()) {
    return demoEmployees.map((employee) => ({ id: employee.id, name: employee.name, role: employee.role, active: true }));
  }
  const rows = await getSql()`SELECT id::text, name, role, active FROM employees ORDER BY active DESC, role, name`;
  return (rows as Row[]).map((row) => ({
    id: String(row.id), name: String(row.name), role: String(row.role) as EmployeeRole, active: Boolean(row.active),
  }));
}

export async function getManageData(date: string, includeAudit = false) {
  if (!isDatabaseConfigured()) {
    return {
      employees: demoEmployees.map((e) => ({ id: e.id, name: e.name, role: e.role, active: true })),
      shifts: [
        { id: "s1", name: "A", start: "09:00", end: "18:00" },
        { id: "s4", name: "U", start: "16:00", end: "01:00" },
      ],
      programs: demoPrograms.map((p) => ({
        id: p.id, name: p.name, start: p.broadcastStart, end: p.broadcastEnd,
        preparationMinutes: 20, cleanupMinutes: 10, requiredStaff: p.requiredStaff, changed: Boolean(p.changed),
      })),
      relays: [{ id: "r1", title: "지역 현장 중계", start: "14:00", end: "18:00", location: "현장", members: "최지우" }],
      substitutes: [],
      audits: [{ id: "a1", actor: "공동 사용자", action: "데모 데이터 확인", target: "dashboard", createdAt: `${date} 09:00` }],
    };
  }
  const sql = getSql();
  const [employeeRows, shiftRows, programRows, relayRows, substituteRows, auditRows] = await Promise.all([
    sql`SELECT id::text, name, role, active FROM employees ORDER BY active DESC, role, name`,
    sql`SELECT id::text, name, to_char(start_time,'HH24:MI') AS start_time, to_char(end_time,'HH24:MI') AS end_time FROM shift_types WHERE active = true AND name IN ('A','U') ORDER BY start_time`,
    sql`
      SELECT dns.id::text, npt.program_name,
        to_char(dns.actual_start_datetime AT TIME ZONE 'Asia/Seoul','HH24:MI') AS start_time,
        to_char(dns.actual_end_datetime AT TIME ZONE 'Asia/Seoul','HH24:MI') AS end_time,
        dns.preparation_minutes, dns.cleanup_minutes, dns.required_staff, dns.schedule_changed
      FROM daily_news_schedules dns JOIN news_program_templates npt ON npt.id = dns.program_template_id
      WHERE dns.schedule_date = ${date}::date AND dns.cancelled = false ORDER BY dns.actual_start_datetime
    `,
    sql`
      SELECT rs.id::text, rs.title,
        to_char(rs.start_datetime AT TIME ZONE 'Asia/Seoul','HH24:MI') AS start_time,
        to_char(rs.end_datetime AT TIME ZONE 'Asia/Seoul','HH24:MI') AS end_time,
        COALESCE(rs.location,'') AS location, string_agg(e.name, ', ' ORDER BY e.name) AS members
      FROM relay_schedules rs
      LEFT JOIN relay_schedule_members rsm ON rsm.relay_schedule_id = rs.id
      LEFT JOIN employees e ON e.id = rsm.employee_id
      WHERE (rs.start_datetime AT TIME ZONE 'Asia/Seoul')::date = ${date}::date AND rs.cancelled = false
      GROUP BY rs.id ORDER BY rs.start_datetime
    `,
    sql`
      SELECT sr.id::text, requester.name AS requester_name, substitute.name AS substitute_name,
        COALESCE(npt.program_name, '연속 대근') AS program_name, sr.status,
        to_char(sr.start_datetime AT TIME ZONE 'Asia/Seoul','HH24:MI') AS start_time,
        to_char(sr.end_datetime AT TIME ZONE 'Asia/Seoul','HH24:MI') AS end_time
      FROM substitute_requests sr
      JOIN employees requester ON requester.id = sr.requester_id
      LEFT JOIN employees substitute ON substitute.id = sr.substitute_employee_id
      LEFT JOIN daily_news_schedules dns ON dns.id = sr.news_schedule_id
      LEFT JOIN news_program_templates npt ON npt.id = dns.program_template_id
      WHERE (sr.start_datetime AT TIME ZONE 'Asia/Seoul')::date = ${date}::date
      ORDER BY sr.created_at DESC
    `,
    includeAudit ? sql`
      SELECT al.id::text, COALESCE(e.name, '공동 사용자') AS actor, al.action_type,
        al.target_table, to_char(al.created_at AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD HH24:MI') AS created_at
      FROM audit_logs al LEFT JOIN employees e ON e.id = al.user_id
      ORDER BY al.created_at DESC LIMIT 100
    ` : Promise.resolve([]),
  ]);
  return {
    employees: (employeeRows as Row[]).map((r) => ({ id: String(r.id), name: String(r.name), role: String(r.role) as EmployeeRole, active: Boolean(r.active) })),
    shifts: (shiftRows as Row[]).map((r) => ({ id: String(r.id), name: String(r.name), start: String(r.start_time), end: String(r.end_time) })),
    programs: (programRows as Row[]).map((r) => ({ id: String(r.id), name: String(r.program_name), start: String(r.start_time), end: String(r.end_time), preparationMinutes: Number(r.preparation_minutes), cleanupMinutes: Number(r.cleanup_minutes), requiredStaff: Number(r.required_staff), changed: Boolean(r.schedule_changed) })),
    relays: (relayRows as Row[]).map((r) => ({ id: String(r.id), title: String(r.title), start: String(r.start_time), end: String(r.end_time), location: String(r.location), members: String(r.members ?? "") })),
    substitutes: (substituteRows as Row[]).map((r) => ({ id: String(r.id), requesterName: String(r.requester_name), substituteName: String(r.substitute_name ?? "미지정"), programName: String(r.program_name), status: String(r.status), start: String(r.start_time), end: String(r.end_time) })),
    audits: (auditRows as Row[]).map((r) => ({ id: String(r.id), actor: String(r.actor), action: String(r.action_type), target: String(r.target_table), createdAt: String(r.created_at) })),
  };
}
