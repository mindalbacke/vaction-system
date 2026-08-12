import type { DashboardSnapshot, Employee, LeaveRequest, NewsProgram } from "@/lib/domain";

export const demoEmployees: Employee[] = [
  { id: "e1", name: "김민준", role: "음향보조", shift: "A", shiftStart: "09:00", shiftEnd: "18:00", studioEligible: true, substituteEligible: true, rotationStartDate: "2026-08-03", rotationStartShift: "A" },
  { id: "e2", name: "박서연", role: "조명보조", shift: "R", shiftStart: "13:00", shiftEnd: "21:00", studioEligible: true, substituteEligible: true, leavePart: "후반" },
  { id: "e3", name: "이도윤", role: "음향보조", shift: "U", shiftStart: "16:00", shiftEnd: "01:00", studioEligible: true, substituteEligible: true, rotationStartDate: "2026-08-03", rotationStartShift: "U" },
  { id: "e4", name: "최지우", role: "중계보조", shift: "A", shiftStart: "09:00", shiftEnd: "18:00", studioEligible: false, substituteEligible: true, relay: { start: "14:00", end: "18:00" } },
  { id: "e5", name: "정하린", role: "중계보조", shift: "A", shiftStart: "09:00", shiftEnd: "18:00", studioEligible: false, substituteEligible: true },
  { id: "e6", name: "한예준", role: "서무", shift: "A", shiftStart: "09:00", shiftEnd: "18:00", studioEligible: false, substituteEligible: false },
];

export const demoPrograms: NewsProgram[] = [
  { id: "p1", name: "9:30 뉴스", broadcastStart: "09:30", broadcastEnd: "09:40", requiredStart: "09:10", requiredEnd: "09:50", requiredStaff: 1, live: true },
  { id: "p2", name: "12시 뉴스", broadcastStart: "12:00", broadcastEnd: "12:20", requiredStart: "11:40", requiredEnd: "12:30", requiredStaff: 1, live: true },
  { id: "p3", name: "2시 뉴스외전", broadcastStart: "14:00", broadcastEnd: "16:00", requiredStart: "13:30", requiredEnd: "16:20", requiredStaff: 2, live: true },
  { id: "p4", name: "5시 뉴스와 경제", broadcastStart: "17:00", broadcastEnd: "17:10", requiredStart: "16:40", requiredEnd: "17:20", requiredStaff: 2, live: true },
  { id: "p5", name: "뉴스데스크", broadcastStart: "19:40", broadcastEnd: "20:40", requiredStart: "19:20", requiredEnd: "20:50", requiredStaff: 2, live: true, changed: true },
];

export function createDemoSnapshot(date: string): DashboardSnapshot {
  const leaves: LeaveRequest[] = [{
    id: "l1", employeeId: "e2", employeeName: "박서연", leaveDate: date, part: "후반",
    start: "14:00", end: "18:00", status: "대근자 미지정", note: "개인 일정",
  }];
  return {
    date,
    employees: demoEmployees,
    leaves,
    substitutes: [{
      id: "s1", leaveId: "l1", requesterId: "e2", requesterName: "박서연",
      part: "후반", start: "13:30", end: "17:20", candidates: [], newsNames: ["2시 뉴스외전", "5시 뉴스와 경제"], status: "대근자 미지정",
    }],
    unavailabilities: [],
    databaseConnected: false,
  };
}
