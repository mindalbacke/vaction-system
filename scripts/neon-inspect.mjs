import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL이 설정되지 않았습니다.");
}

const sql = neon(databaseUrl);
const tables = await sql.query(
  "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
  [],
);
const tableNames = tables.map((row) => row.table_name);

let employeeCount = null;
let credentialCount = null;
let defaultPinCount = null;
let adminFlagCount = null;
if (tableNames.includes("employees")) {
  const rows = await sql.query(
    "SELECT COUNT(*)::int AS count, COUNT(pin_hash)::int AS credential_count, COUNT(*) FILTER (WHERE is_admin)::int AS admin_flag_count FROM employees",
    [],
  );
  employeeCount = rows[0].count;
  credentialCount = rows[0].credential_count;
  adminFlagCount = rows[0].admin_flag_count;
  const pinRows = await sql.query(
    "SELECT COUNT(*) FILTER (WHERE pin_hash = crypt('0000', pin_hash))::int AS count FROM employees WHERE active = true",
    [],
  );
  defaultPinCount = pinRows[0].count;
}

let authSessionCount = null;
if (tableNames.includes("auth_sessions")) {
  const rows = await sql.query("SELECT COUNT(*)::int AS count FROM auth_sessions", []);
  authSessionCount = rows[0].count;
}

let shiftRules = [];
if (tableNames.includes("shift_types")) {
  const rows = await sql.query(
    "SELECT name, to_char(start_time, 'HH24:MI') AS start, to_char(end_time, 'HH24:MI') AS end, active FROM shift_types WHERE name IN ('A','R','R1','U') ORDER BY name",
    [],
  );
  shiftRules = rows;
}

let audioRotations = [];
if (tableNames.includes("audio_rotation_settings")) {
  audioRotations = await sql.query(
    "SELECT e.name, e.role, ars.start_date::text AS start_date, ars.start_shift FROM audio_rotation_settings ars JOIN employees e ON e.id = ars.employee_id ORDER BY e.name",
    [],
  );
}

let leaveBalances = [];
if (tableNames.includes("leave_balances")) {
  leaveBalances = await sql.query(
    "SELECT e.name, lb.year, lb.total_days::text, lb.used_days::text, lb.remaining_days::text FROM leave_balances lb JOIN employees e ON e.id = lb.employee_id WHERE lb.year = EXTRACT(YEAR FROM CURRENT_DATE)::int ORDER BY e.name",
    [],
  );
}

let requestedAugustSixLeaves = [];
if (tableNames.includes("leave_requests") && tableNames.includes("employees")) {
  requestedAugustSixLeaves = await sql.query(
    "SELECT lr.id::text, e.name, lr.leave_date::text, lr.leave_type, lr.cancelled, lr.status FROM leave_requests lr JOIN employees e ON e.id = lr.employee_id WHERE lr.leave_date = DATE '2026-08-06' ORDER BY e.name",
    [],
  );
}

let noSubstituteRoleOpenCount = null;
if (tableNames.includes("substitute_requests") && tableNames.includes("leave_requests")) {
  const rows = await sql.query(
    "SELECT COUNT(*)::int AS count FROM substitute_requests request JOIN leave_requests leave ON leave.id = request.leave_request_id JOIN employees employee ON employee.id = leave.employee_id WHERE employee.role IN ('서무', '중계보조') AND leave.cancelled = false AND request.status <> '반차 취소'",
    [],
  );
  noSubstituteRoleOpenCount = rows[0].count;
}

console.log(
  JSON.stringify({
    connected: true,
    tableCount: tableNames.length,
    tables: tableNames,
    employeeCount,
    credentialCount,
    defaultPinCount,
    adminFlagCount,
    authSessionCount,
    shiftRules,
    audioRotations,
    leaveBalances,
    requestedAugustSixLeaves,
    noSubstituteRoleOpenCount,
  }),
);
