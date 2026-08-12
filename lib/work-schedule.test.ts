import { describe, expect, it } from "vitest";
import type { DailyWorkAssignment } from "./domain";
import { buildAudioAPeriods, isSameWorkBlock } from "./work-schedule";

describe("buildAudioAPeriods", () => {
  it("creates continuous 14-day A blocks", () => {
    expect(buildAudioAPeriods("2026-08-01", "2026-08-31", [{
      employeeId: "audio-1",
      employeeName: "김음향",
      audioIndex: 0,
      startDate: "2026-08-03",
      startShift: "A",
    }])).toEqual([
      { employeeId: "audio-1", employeeName: "김음향", startDate: "2026-08-03", endDate: "2026-08-16" },
      { employeeId: "audio-1", employeeName: "김음향", startDate: "2026-08-31", endDate: "2026-08-31" },
    ]);
  });

  it("shows the opposite employee during the same block", () => {
    const periods = buildAudioAPeriods("2026-08-03", "2026-08-30", [
      { employeeId: "a", employeeName: "A 담당", audioIndex: 0, startDate: "2026-08-03", startShift: "A" },
      { employeeId: "u", employeeName: "U 담당", audioIndex: 1, startDate: "2026-08-03", startShift: "U" },
    ]);
    expect(periods).toContainEqual({ employeeId: "a", employeeName: "A 담당", startDate: "2026-08-03", endDate: "2026-08-16" });
    expect(periods).toContainEqual({ employeeId: "u", employeeName: "U 담당", startDate: "2026-08-17", endDate: "2026-08-30" });
  });

  it("hides only excluded months and keeps adjacent month blocks", () => {
    expect(buildAudioAPeriods("2026-07-27", "2026-09-06", [{
      employeeId: "audio-1", employeeName: "음향 담당", audioIndex: 0,
      startDate: "2026-07-20", startShift: "A",
    }], ["2026-08"])).toEqual([
      { employeeId: "audio-1", employeeName: "음향 담당", startDate: "2026-07-27", endDate: "2026-07-31" },
    ]);
  });
});

describe("isSameWorkBlock", () => {
  const assignment: DailyWorkAssignment = {
    employeeId: "employee-1", employeeName: "근무자", role: "음향보조",
    workDate: "2026-08-10", shift: "A", start: "09:00", end: "18:00",
  };

  it("connects consecutive assignments with the same employee, type and time", () => {
    expect(isSameWorkBlock(assignment, { ...assignment, workDate: "2026-08-11" })).toBe(true);
  });

  it("starts a new bar when the type or direct time changes", () => {
    expect(isSameWorkBlock(assignment, { ...assignment, workDate: "2026-08-11", shift: "U", start: "16:00", end: "01:00" })).toBe(false);
    expect(isSameWorkBlock({ ...assignment, shift: "직접" }, { ...assignment, workDate: "2026-08-11", shift: "직접", end: "19:00" })).toBe(false);
  });
});
