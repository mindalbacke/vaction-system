export type EmployeeRole = "서무" | "음향보조" | "조명보조" | "중계보조";
export type ShiftCode = "A" | "R" | "U" | "휴무" | "중계";
export type LeavePart = "전반" | "후반";

export interface TimeRange { start: string; end: string }
export interface Employee {
  id: string; name: string; role: EmployeeRole;
  shift: ShiftCode; shiftStart: string; shiftEnd: string;
  studioEligible: boolean; substituteEligible: boolean;
  leavePart?: LeavePart; relay?: TimeRange;
  rotationStartDate?: string; rotationStartShift?: "A" | "U";
}
export interface NewsProgram {
  id: string; name: string; broadcastStart: string; broadcastEnd: string;
  requiredStart: string; requiredEnd: string; requiredStaff: number;
  live: boolean; changed?: boolean;
}
export interface LeaveRequest {
  id: string; employeeId: string; employeeName: string; leaveDate: string;
  part: LeavePart; start: string; end: string; status: string; note?: string;
}
export interface SubstituteRequest {
  id: string; leaveId: string;
  requesterId: string; requesterName: string;
  part: LeavePart; start: string; end: string;
  substituteId?: string; substituteName?: string;
  candidates: SubstituteCandidateResponse[];
  newsNames: string[];
  status: string;
}
export interface SubstituteCandidateResponse {
  employeeId: string; employeeName: string; priority: 1 | 2;
}
export interface SubstituteUnavailability {
  id: string; employeeId: string; employeeName: string;
  startDate: string; endDate: string;
  start: string; end: string; dayStart: string; dayEnd: string; reason: string;
}
export interface MonthlyLeave {
  id: string; employeeId: string; employeeName: string; leaveDate: string; part: LeavePart;
  note?: string;
  substituteCandidates: SubstituteCandidateResponse[];
  substituteName?: string; substituteRequired: boolean;
}
export interface MonthlyUnavailability {
  id: string; employeeId: string; employeeName: string;
  startDate: string; endDate: string; start: string; end: string; reason: string;
}
export interface Shortage {
  programId: string; programName: string; requiredRange: TimeRange;
  requiredStaff: number; availableStaff: number; shortageCount: number;
  availableEmployeeIds: string[];
}
export interface DashboardSnapshot {
  date: string; employees: Employee[];
  leaves: LeaveRequest[]; substitutes: SubstituteRequest[];
  unavailabilities: SubstituteUnavailability[];
  databaseConnected: boolean;
}

export interface ScheduleEmployee {
  id: string;
  name: string;
  role: EmployeeRole;
  color: number;
}

export interface DailyWorkAssignment {
  employeeId: string;
  employeeName: string;
  role: EmployeeRole;
  workDate: string;
  shift: Extract<ShiftCode, "A" | "R" | "U"> | "직접";
  start: string;
  end: string;
}

export interface AudioAPeriod {
  employeeId: string;
  employeeName: string;
  startDate: string;
  endDate: string;
}
