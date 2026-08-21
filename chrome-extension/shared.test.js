import { describe, expect, it } from "vitest";
import { getHalfDayUsageSummary, getPendingSummary, getProjectedLeaveRemaining, makeApplication, makeSiteSnapshot, reconcileApplications } from "./shared.js";

const halfDays = [
  { id: "aaaaaaaa-0000-0000-0000-000000000000", date: "2026-08-20", part: "후반" },
  { id: "bbbbbbbb-0000-0000-0000-000000000000", date: "2026-08-12", part: "전반" },
];

describe("휴가 1일 묶음", () => {
  it("서로 다른 두 반차 중 빠른 날짜를 신청일로 사용한다", () => {
    const application = makeApplication(halfDays);
    expect(application.applicationDate).toBe("2026-08-12");
    expect(application.halfDayIds).toEqual([halfDays[1].id, halfDays[0].id]);
    expect(application.halfDaySummary).toBe("08.12 전반 / 08.20 후반");
    expect(application.leaveType).toBe("연차휴가");
    expect(application.reason).toBe("");
  });

  it("신청 확인 전 반차는 0.5일씩 참고 가능량에서 차감한다", () => {
    const application = makeApplication(halfDays);
    expect(getPendingSummary(halfDays, [application])).toEqual({ pendingCount: 2, pendingDays: 1 });
    application.status = "confirmed";
    expect(getPendingSummary(halfDays, [application])).toEqual({ pendingCount: 0, pendingDays: 0 });
  });

  it("반차 사용 기록을 건수와 일수로 계산한다", () => {
    expect(getHalfDayUsageSummary(halfDays)).toEqual({ count: 2, usedDays: 1 });
  });

  it("결재 전 등록량과 로컬 반차를 중복 차감하지 않고 예상 잔여량을 계산한다", () => {
    expect(getProjectedLeaveRemaining(7, 1, 1)).toBe(6);
    expect(getProjectedLeaveRemaining(7, 0, 1)).toBe(6);
    expect(getProjectedLeaveRemaining(7, 1.5, 1)).toBe(5.5);
  });

  it("인사정보 신청 내역에서 식별 문구를 찾으면 신청 확인으로 바꾼다", () => {
    const application = makeApplication(halfDays);
    const reconciled = reconcileApplications([application], halfDays, `신청 내역 ${application.marker}`);
    expect(reconciled[0].status).toBe("confirmed");
  });

  it("선택한 휴가 종류와 첫 반차 날짜가 인사정보 기록에 있으면 신청 확인으로 바꾼다", () => {
    const application = { ...makeApplication(halfDays), leaveType: "대휴" };
    const reconciled = reconcileApplications([application], halfDays, [
      { leaveType: "대휴", startDate: "2026-08-12", endDate: "2026-08-12", days: 1 },
    ]);
    expect(reconciled[0].status).toBe("confirmed");
  });

  it("승인된 휴가 신청일은 유지하고 변경된 두 번째 반차 일정만 요약에 반영한다", () => {
    const application = { ...makeApplication(halfDays), status: "confirmed" };
    const changedHalfDays = [halfDays[1], { ...halfDays[0], date: "2026-09-22", part: "전반" }];
    const [reconciled] = reconcileApplications([application], changedHalfDays);
    expect(reconciled.applicationDate).toBe("2026-08-12");
    expect(reconciled.halfDaySummary).toBe("08.12 전반 / 09.22 전반");
  });

  it("제출 전 반차 일정을 바꾸면 가장 빠른 날짜를 새 신청일로 사용한다", () => {
    const application = makeApplication(halfDays);
    const changedHalfDays = [
      { ...halfDays[0], date: "2026-09-22" },
      { ...halfDays[1], date: "2026-09-10" },
    ];
    const [reconciled] = reconcileApplications([application], changedHalfDays);
    expect(reconciled.applicationDate).toBe("2026-09-10");
    expect(reconciled.halfDaySummary).toBe("09.10 전반 / 09.22 후반");
  });

  it("사이트 동기화용 자료에는 선택 직원의 휴가 현황과 신청 상태만 포함한다", () => {
    const ready = makeApplication(halfDays);
    const confirmed = { ...ready, id: "confirmed", status: "confirmed" };
    const snapshot = makeSiteSnapshot(
      { employeeId: "employee-1", siteUrl: "https://example.com" },
      halfDays,
      [ready, confirmed],
      {
        leaveBalances: {
          annual: { total: 10, used: 3, registered: 0, remaining: 7 },
          substitute: { total: 17, used: 0, registered: 0, remaining: 17 },
          health: { total: 1, used: 0, registered: 0, remaining: 1 },
        },
        annualTotal: 10, annualUsed: 3, annualRemaining: 7, syncedAt: "2026-08-12T00:00:00.000Z",
      },
    );
    expect(snapshot.employeeId).toBe("employee-1");
    expect(snapshot.pending).toEqual({ pendingCount: 0, pendingDays: 0 });
    expect(snapshot.applicationCounts).toEqual({ ready: 1, submitted: 0, confirmed: 1, needsReview: 0 });
    expect(snapshot.applications[0]).toMatchObject({ applicationDate: "2026-08-12", leaveType: "연차휴가", reason: "", status: "ready" });
    expect(snapshot.hrSnapshot).toMatchObject({ annualTotal: 10, annualUsed: 3, annualRemaining: 7 });
    expect(snapshot.hrSnapshot.leaveBalances).toMatchObject({
      substitute: { remaining: 17 },
    });
    expect(snapshot.hrSnapshot.leaveBalances).not.toHaveProperty("health");
    expect(snapshot.hrSnapshot).not.toHaveProperty("healthRemaining");
    expect(snapshot).not.toHaveProperty("siteUrl");
  });
});
