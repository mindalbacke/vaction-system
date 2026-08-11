import { describe, expect, it } from "vitest";
import { calculateShortages, getLeaveRange, getReferenceSubstituteShift, overlaps, shouldIncludeNewsCoverage } from "./scheduling";
import type { Employee, NewsProgram } from "./domain";

const employee = (id: string, shift: Employee["shift"], start: string, end: string): Employee => ({
  id, name: id, role: "음향보조", shift, shiftStart: start, shiftEnd: end,
  studioEligible: true, substituteEligible: true,
});

describe("근무 계산", () => {
  it("서로 맞닿은 구간은 중복으로 보지 않는다", () => {
    expect(overlaps({ start: "09:00", end: "13:00" }, { start: "13:00", end: "14:00" })).toBe(false);
  });

  it("U 근무처럼 자정을 넘는 시간을 처리한다", () => {
    expect(overlaps({ start: "16:00", end: "01:00" }, { start: "00:20", end: "00:50" })).toBe(true);
    expect(getLeaveRange("U", "전반")).toEqual({ start: "16:00", end: "20:00" });
    expect(() => getLeaveRange("U", "후반")).toThrow("전반 반차만");
  });

  it("16시에 시작하는 U 반차 대근에서 2시 뉴스외전을 제외한다", () => {
    expect(shouldIncludeNewsCoverage("2시 뉴스외전", "16:00")).toBe(false);
    expect(shouldIncludeNewsCoverage("5시 뉴스와 경제", "16:00")).toBe(true);
    expect(shouldIncludeNewsCoverage("2시 뉴스외전", "14:00")).toBe(true);
  });

  it("A 근무자가 뉴스데스크까지 대근하면 기존 근무 구간 길이를 유지해 EX 시간을 늦춘다", () => {
    expect(getReferenceSubstituteShift(
      { start: "09:00", end: "18:00" },
      { start: "19:20", end: "20:50" },
    )).toEqual({ start: "11:50", end: "20:50" });
  });

  it("대근 구간이 기존 근무 안에 있으면 EX 시간을 그대로 유지한다", () => {
    expect(getReferenceSubstituteShift(
      { start: "16:00", end: "01:00" },
      { start: "19:20", end: "20:50" },
    )).toEqual({ start: "16:00", end: "01:00" });
  });

  it("반차자를 제외해 프로그램별 부족 인원을 계산한다", () => {
    const programs: NewsProgram[] = [{
      id: "desk", name: "뉴스데스크", broadcastStart: "19:40", broadcastEnd: "20:40",
      requiredStart: "19:20", requiredEnd: "20:50", requiredStaff: 2, live: true,
    }];
    const result = calculateShortages(
      programs,
      [employee("a", "R", "13:00", "21:00"), employee("b", "U", "16:00", "01:00")],
      [{ id: "l", employeeId: "a", employeeName: "a", leaveDate: "2026-08-05", part: "후반", start: "17:00", end: "21:00", status: "등록 완료" }],
    );
    expect(result[0].shortageCount).toBe(1);
    expect(result[0].availableEmployeeIds).toEqual(["b"]);
  });

  it("서무는 근무시간이 겹쳐도 스튜디오 인원에서 제외한다", () => {
    const clerk = { ...employee("clerk", "A", "09:00", "18:00"), role: "서무" as const };
    const program: NewsProgram = { id: "noon", name: "12시 뉴스", broadcastStart: "12:00", broadcastEnd: "12:20", requiredStart: "11:40", requiredEnd: "12:30", requiredStaff: 1, live: true };
    expect(calculateShortages([program], [clerk], [])[0].shortageCount).toBe(1);
  });

  it("반차와 겹치지 않는 프로그램에는 직원을 포함한다", () => {
    const program: NewsProgram = { id: "morning", name: "9:30 뉴스", broadcastStart: "09:30", broadcastEnd: "09:40", requiredStart: "09:10", requiredEnd: "09:50", requiredStaff: 1, live: true };
    const result = calculateShortages([program], [employee("a", "A", "09:00", "18:00")], [
      { id: "l", employeeId: "a", employeeName: "a", leaveDate: "2026-08-06", part: "후반", start: "14:00", end: "18:00", status: "등록 완료" },
    ]);
    expect(result[0].availableStaff).toBe(1);
  });

  it("서로 떨어진 프로그램 부족을 별도 항목으로 유지한다", () => {
    const programs: NewsProgram[] = [
      { id: "one", name: "오전", broadcastStart: "09:30", broadcastEnd: "09:40", requiredStart: "09:10", requiredEnd: "09:50", requiredStaff: 1, live: true },
      { id: "two", name: "저녁", broadcastStart: "19:40", broadcastEnd: "20:40", requiredStart: "19:20", requiredEnd: "20:50", requiredStaff: 2, live: true },
    ];
    const result = calculateShortages(programs, [], []);
    expect(result).toHaveLength(2);
    expect(result.map((item) => item.shortageCount)).toEqual([1, 2]);
  });
});
