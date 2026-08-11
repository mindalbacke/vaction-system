import type { Employee, LeaveRequest, NewsProgram, Shortage, TimeRange } from "@/lib/domain";

const MINUTES_PER_DAY = 24 * 60;

export function timeToMinutes(value: string, end = false): number {
  const [hour, minute] = value.split(":").map(Number);
  const result = hour * 60 + minute;
  return end && result <= 5 * 60 ? result + MINUTES_PER_DAY : result;
}

export function overlaps(a: TimeRange, b: TimeRange): boolean {
  const aStart = timeToMinutes(a.start);
  const aEnd = timeToMinutes(a.end, true);
  let bStart = timeToMinutes(b.start);
  let bEnd = timeToMinutes(b.end, true);
  if (aEnd > MINUTES_PER_DAY && bEnd <= MINUTES_PER_DAY && bStart < 5 * 60) {
    bStart += MINUTES_PER_DAY;
    bEnd += MINUTES_PER_DAY;
  }
  return aStart < bEnd && aEnd > bStart;
}

export function isEmployeeAvailable(employee: Employee, range: TimeRange, leaves: LeaveRequest[]): boolean {
  if (!employee.studioEligible || employee.role === "서무" || employee.shift === "휴무") return false;
  if (!overlaps({ start: employee.shiftStart, end: employee.shiftEnd }, range)) return false;
  if (leaves.some((leave) => leave.employeeId === employee.id && leave.status !== "취소" && overlaps({ start: leave.start, end: leave.end }, range))) return false;
  if (employee.role === "중계보조" && employee.relay && overlaps(employee.relay, range)) return false;
  return true;
}

export function calculateShortages(programs: NewsProgram[], employees: Employee[], leaves: LeaveRequest[]): Shortage[] {
  return programs.map((program) => {
    const range = { start: program.requiredStart, end: program.requiredEnd };
    const available = employees.filter((employee) => isEmployeeAvailable(employee, range, leaves));
    return {
      programId: program.id,
      programName: program.name,
      requiredRange: range,
      requiredStaff: program.requiredStaff,
      availableStaff: available.length,
      shortageCount: Math.max(0, program.requiredStaff - available.length),
      availableEmployeeIds: available.map((employee) => employee.id),
    };
  });
}

export function getLeaveRange(shift: Employee["shift"], part: "전반" | "후반"): TimeRange {
  const ranges: Partial<Record<Employee["shift"], Partial<Record<"전반" | "후반", TimeRange>>>> = {
    A: { 전반: { start: "09:00", end: "13:00" }, 후반: { start: "14:00", end: "18:00" } },
    R: { 전반: { start: "13:00", end: "17:00" }, 후반: { start: "17:00", end: "21:00" } },
    U: { 전반: { start: "16:00", end: "20:00" } },
  };
  const range = ranges[shift]?.[part];
  if (shift === "U" && part === "후반") throw new Error("U 근무자는 전반 반차만 사용할 수 있습니다.");
  if (!range) throw new Error("반차를 등록할 수 없는 근무 유형입니다.");
  return range;
}

export function shouldIncludeNewsCoverage(programName: string, leaveStart: string): boolean {
  return !(programName === "2시 뉴스외전" && timeToMinutes(leaveStart) >= timeToMinutes("16:00"));
}

function minutesToTime(value: number): string {
  const normalized = ((value % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

export function getReferenceSubstituteShift(shift: TimeRange, coverage: TimeRange): TimeRange {
  const shiftStart = timeToMinutes(shift.start);
  const shiftEnd = timeToMinutes(shift.end, true);
  const duration = shiftEnd - shiftStart;
  const coverageStart = timeToMinutes(coverage.start);
  const coverageEnd = timeToMinutes(coverage.end, true);

  if (coverageEnd - coverageStart > duration) {
    return { start: minutesToTime(coverageStart), end: minutesToTime(coverageEnd) };
  }

  let referenceStart = shiftStart;
  let referenceEnd = shiftEnd;
  if (coverageEnd > referenceEnd) {
    referenceEnd = coverageEnd;
    referenceStart = referenceEnd - duration;
  }
  if (coverageStart < referenceStart) {
    referenceStart = coverageStart;
    referenceEnd = referenceStart + duration;
  }
  return { start: minutesToTime(referenceStart), end: minutesToTime(referenceEnd) };
}
