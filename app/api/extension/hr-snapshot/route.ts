import { z } from "zod";
import { getSql, isDatabaseConfigured } from "@/lib/db";

export const dynamic = "force-dynamic";

const nullableNumber = z.number().min(0).max(999).nullable();
const balanceSchema = z.object({
  total: nullableNumber,
  used: nullableNumber,
  registered: nullableNumber,
  remaining: nullableNumber,
}).nullable();
const applicationSchema = z.object({
  id: z.string().min(1).max(200),
  applicationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  leaveType: z.enum(["연차휴가", "대휴"]).optional(),
  halfDaySummary: z.string().max(200).optional(),
  reason: z.string().max(500),
  status: z.enum(["ready", "filled", "submitted", "confirmed", "needs-review"]),
});
const historySchema = z.object({
  leaveType: z.string().max(50),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days: nullableNumber.optional(),
});
const requestSchema = z.object({
  employeeId: z.string().uuid(),
  pin: z.string().regex(/^\d{4}$/),
  snapshot: z.object({
    employeeId: z.string().uuid(),
    hrSnapshot: z.object({
      leaveBalances: z.object({ annual: balanceSchema, substitute: balanceSchema }).nullable().optional(),
      annualTotal: nullableNumber.optional(),
      annualUsed: nullableNumber.optional(),
      annualRemaining: nullableNumber.optional(),
      substituteRemaining: nullableNumber.optional(),
      vacationHistory: z.array(historySchema).max(500).optional(),
      syncedAt: z.string().datetime(),
    }).nullable(),
    pending: z.object({ pendingCount: z.number().int().min(0), pendingDays: z.number().min(0) }),
    applicationCounts: z.object({
      ready: z.number().int().min(0), submitted: z.number().int().min(0).optional(),
      confirmed: z.number().int().min(0), needsReview: z.number().int().min(0),
    }),
    applications: z.array(applicationSchema).max(200).optional(),
  }),
}).refine((value) => value.employeeId === value.snapshot.employeeId, { message: "직원 정보가 일치하지 않습니다." });

const responseHeaders = {
  "Cache-Control": "no-store, max-age=0",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: responseHeaders });
}

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) {
    return Response.json({ error: "데이터베이스가 연결되지 않았습니다." }, { status: 503, headers: responseHeaders });
  }

  try {
    const input = requestSchema.parse(await request.json());
    const sql = getSql();
    const rows = await sql`
      SELECT employee.id::text, employee.employee_number,
        (SELECT COUNT(*) FROM login_attempts attempt
          WHERE attempt.employee_number = employee.employee_number
            AND attempt.successful = false
            AND attempt.attempted_at > now() - INTERVAL '10 minutes') >= 5 AS locked,
        COALESCE(employee.pin_hash = crypt(${input.pin}, employee.pin_hash), false) AS pin_valid
      FROM employees employee
      WHERE employee.id = ${input.employeeId}::uuid AND employee.active = true
    `;
    if (!rows.length) return Response.json({ error: "직원 정보를 찾을 수 없습니다." }, { status: 404, headers: responseHeaders });

    const employee = rows[0] as Record<string, unknown>;
    const valid = !Boolean(employee.locked) && Boolean(employee.pin_valid);
    await sql`INSERT INTO login_attempts (employee_number, successful) VALUES (${String(employee.employee_number)}, ${valid})`;
    if (!valid) {
      return Response.json({ error: employee.locked ? "PIN 입력이 여러 번 실패했습니다. 10분 후 다시 시도해 주세요." : "PIN 번호가 올바르지 않습니다." }, { status: 401, headers: responseHeaders });
    }

    const snapshotJson = JSON.stringify(input.snapshot);
    await sql`
      INSERT INTO hr_leave_snapshots (employee_id, snapshot, hr_synced_at, updated_at)
      VALUES (${input.employeeId}::uuid, ${snapshotJson}::jsonb, ${input.snapshot.hrSnapshot?.syncedAt ?? null}::timestamptz, now())
      ON CONFLICT (employee_id) DO UPDATE SET
        snapshot = EXCLUDED.snapshot,
        hr_synced_at = EXCLUDED.hr_synced_at,
        updated_at = now()
    `;
    return Response.json({ ok: true, syncedAt: new Date().toISOString() }, { headers: responseHeaders });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "전송할 휴가 정보의 형식이 올바르지 않습니다." }, { status: 400, headers: responseHeaders });
    }
    console.error("HR leave snapshot sync failed", error);
    return Response.json({ error: "휴가 정보를 저장하지 못했습니다." }, { status: 500, headers: responseHeaders });
  }
}
