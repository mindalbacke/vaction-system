import { describe, expect, it } from "vitest";
import { getPendingSummary, makeApplication, reconcileApplications } from "./shared.js";

const halfDays = [
  { id: "aaaaaaaa-0000-0000-0000-000000000000", date: "2026-08-20", part: "후반" },
  { id: "bbbbbbbb-0000-0000-0000-000000000000", date: "2026-08-12", part: "전반" },
];

describe("휴가 1일 묶음", () => {
  it("서로 다른 두 반차 중 빠른 날짜를 신청일로 사용한다", () => {
    const application = makeApplication(halfDays);
    expect(application.applicationDate).toBe("2026-08-12");
    expect(application.halfDayIds).toEqual([halfDays[1].id, halfDays[0].id]);
    expect(application.reason).toContain("08.12 전반 / 08.20 후반");
  });

  it("신청 확인 전 반차는 0.5일씩 참고 가능량에서 차감한다", () => {
    const application = makeApplication(halfDays);
    expect(getPendingSummary(halfDays, [application])).toEqual({ pendingCount: 2, pendingDays: 1 });
    application.status = "confirmed";
    expect(getPendingSummary(halfDays, [application])).toEqual({ pendingCount: 0, pendingDays: 0 });
  });

  it("인사정보 신청 내역에서 식별 문구를 찾으면 신청 확인으로 바꾼다", () => {
    const application = makeApplication(halfDays);
    const reconciled = reconcileApplications([application], halfDays, `신청 내역 ${application.marker}`);
    expect(reconciled[0].status).toBe("confirmed");
  });
});
