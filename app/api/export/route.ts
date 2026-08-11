import { getDashboardSnapshot } from "@/lib/repository";

function escapeCell(value: string | number) {
  const text = String(value).replaceAll('"', '""');
  return `"${text}"`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  const snapshot = await getDashboardSnapshot(date);
  const header = ["직원명", "담당 업무", "근무", "근무시간", "반차", "중계일정"];
  const rows = snapshot.employees.map((employee) => [
    employee.name,
    employee.role,
    employee.shift,
    `${employee.shiftStart}~${employee.shiftEnd}`,
    employee.leavePart ? `${employee.leavePart} 반차` : "",
    employee.relay ? `${employee.relay.start}~${employee.relay.end}` : "",
  ]);
  const csv = "\uFEFF" + [header, ...rows].map((row) => row.map(escapeCell).join(",")).join("\r\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="schedule-${date}.csv"`,
    },
  });
}
