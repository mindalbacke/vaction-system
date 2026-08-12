import { z } from "zod";
import { getSql, isDatabaseConfigured } from "@/lib/db";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  employeeId: z.string().uuid(),
  pin: z.string().regex(/^\d{4}$/),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).refine((value) => value.from <= value.to, { message: "조회 기간이 올바르지 않습니다." });

const responseHeaders = {
  "Cache-Control": "no-store, max-age=0",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

    return Response.json({
      employee: { id: String(employee.id), name: String(employee.name), role: String(employee.role) },
      halfDays: rows.map((row) => ({
        id: String(row.id),
        date: String(row.leave_date),
        part: String(row.leave_type),
        createdAt: String(row.created_at),
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
