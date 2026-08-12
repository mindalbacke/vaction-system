import { addDays, addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, parseISO, startOfMonth, startOfWeek } from "date-fns";
import { ko } from "date-fns/locale";
import { CalendarClock, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { ScheduleBar } from "@/app/schedule/schedule-bar";
import type { AudioAPeriod, DailyWorkAssignment, ScheduleEmployee } from "@/lib/domain";
import type { CalendarHoliday } from "@/lib/korean-holidays";
import { isSameWorkBlock } from "@/lib/work-schedule";

export function ScheduleCalendar({ month, selectedDate, assignments, audioPeriods, employees, holidays }: {
  month: string; selectedDate: string; assignments: DailyWorkAssignment[]; audioPeriods: AudioAPeriod[]; employees: ScheduleEmployee[]; holidays: CalendarHoliday[];
}) {
  const monthDate = parseISO(`${month}-01`);
  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(monthDate), { weekStartsOn: 0 }),
    end: endOfWeek(endOfMonth(monthDate), { weekStartsOn: 0 }),
  });
  const assignmentsByDate = new Map<string, DailyWorkAssignment[]>();
  for (const assignment of assignments) {
    const items = assignmentsByDate.get(assignment.workDate) ?? [];
    items.push(assignment);
    assignmentsByDate.set(assignment.workDate, items);
  }
  const assignmentByEmployeeDate = new Map(assignments.map((assignment) => [`${assignment.employeeId}:${assignment.workDate}`, assignment]));
  const assignedEmployeeIds = new Set(assignments.map((assignment) => assignment.employeeId));
  const scheduledEmployees = employees.filter((employee) => assignedEmployeeIds.has(employee.id));
  const employeeColorById = new Map(employees.map((employee) => [employee.id, employee.color]));
  const audioRotationColorById = new Map(employees.filter((employee) => employee.role === "음향보조").map((employee, index) => [employee.id, index]));
  const holidaysByDate = new Map<string, CalendarHoliday[]>();
  for (const holiday of holidays) {
    const items = holidaysByDate.get(holiday.date) ?? [];
    items.push(holiday);
    holidaysByDate.set(holiday.date, items);
  }
  const periodLanes = new Map<string, number>();
  const laneEnds: string[] = [];
  for (const period of audioPeriods) {
    let lane = laneEnds.findIndex((endDate) => endDate < period.startDate);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = period.endDate;
    periodLanes.set(`${period.employeeId}-${period.startDate}`, lane);
  }
  const monthLink = (amount: number) => {
    const next = format(addMonths(monthDate, amount), "yyyy-MM");
    return { pathname: "/schedule", query: { month: next, date: `${next}-01` } };
  };

  return (
    <section className="simple-card schedule-calendar-card" aria-labelledby="schedule-calendar-title">
      <header className="calendar-head">
        <div><CalendarClock size={24} /><h1 id="schedule-calendar-title">{format(monthDate, "yyyy년 M월", { locale: ko })} 근무표</h1></div>
        <nav aria-label="월 이동">
          <Link href={monthLink(-1)} aria-label="이전 달"><ChevronLeft size={21} /></Link>
          <Link href={monthLink(1)} aria-label="다음 달"><ChevronRight size={21} /></Link>
        </nav>
      </header>
      <div className="schedule-legend">
        <span><i className="schedule-rotation-color-0" />음향 A 2주</span>
        {employees.map((employee) => <span key={employee.id}><i className={`schedule-color-${employee.color}`} />{employee.name}</span>)}
      </div>
      <div className="calendar-weekdays" aria-hidden="true">{["일", "월", "화", "수", "목", "금", "토"].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="calendar-grid schedule-calendar-grid">
        {days.map((day) => {
          const dayKey = format(day, "yyyy-MM-dd");
          const isWeekend = day.getDay() === 0 || day.getDay() === 6;
          const dayHolidays = holidaysByDate.get(dayKey) ?? [];
          const dayAssignments = assignmentsByDate.get(dayKey) ?? [];
          const dayAssignmentByEmployee = new Map(dayAssignments.map((assignment) => [assignment.employeeId, assignment]));
          const activePeriods = isWeekend ? [] : audioPeriods.filter((period) => period.startDate <= dayKey && period.endDate >= dayKey);
          const periodByLane = new Map(activePeriods.map((period) => [periodLanes.get(`${period.employeeId}-${period.startDate}`) ?? 0, period]));
          const highestLane = Math.max(-1, ...periodByLane.keys());
          return (
            <div className={`calendar-day schedule-day${isSameMonth(day, monthDate) ? "" : " outside"}${dayKey === selectedDate ? " selected" : ""}${dayHolidays.length ? " holiday" : ""}${day.getDay() === 0 ? " sunday" : ""}`} key={dayKey}>
              <Link className="schedule-date-link" href={{ pathname: "/schedule", query: { month: dayKey.slice(0, 7), date: dayKey }, hash: "day-editor" }} aria-label={`${dayKey} 근무자 설정`}>
                <time dateTime={dayKey}>{format(day, "d")}</time><span>설정</span>
              </Link>
              {dayHolidays.length ? <div className="schedule-holidays">{dayHolidays.map((holiday) => <strong key={`${holiday.date}-${holiday.name}`}>{holiday.name}</strong>)}</div> : null}
              <div className="schedule-a-bars">
                {Array.from({ length: highestLane + 1 }, (_, lane) => {
                  const period = periodByLane.get(lane);
                  if (!period) return <span className="schedule-a-placeholder" aria-hidden="true" key={`empty-${dayKey}-${lane}`} />;
                  const starts = period.startDate === dayKey || day.getDay() === 1;
                  const ends = period.endDate === dayKey || day.getDay() === 5;
                  const color = audioRotationColorById.get(period.employeeId) ?? 0;
                  return <ScheduleBar employeeId={period.employeeId} employeeName={period.employeeName} color={color} variant="rotation" className={`schedule-a-bar${starts ? " starts" : ""}${ends ? " ends" : ""}`} title={`${period.employeeName} · 음향 A 2주 · ${period.startDate}–${period.endDate}`} text={starts ? `${period.employeeName} · A(2주)` : "\u00a0"} key={`${period.employeeId}-${period.startDate}`} />;
                })}
              </div>
              <div className="schedule-work-bars">
                {dayAssignments.length ? scheduledEmployees.map((employee) => {
                  const assignment = dayAssignmentByEmployee.get(employee.id);
                  if (!assignment) return <span className="schedule-work-placeholder" aria-hidden="true" key={`${dayKey}-${employee.id}`} />;
                  const previousDate = format(addDays(day, -1), "yyyy-MM-dd");
                  const nextDate = format(addDays(day, 1), "yyyy-MM-dd");
                  const starts = day.getDay() === 0 || !isSameWorkBlock(assignment, assignmentByEmployeeDate.get(`${assignment.employeeId}:${previousDate}`));
                  const ends = day.getDay() === 6 || !isSameWorkBlock(assignment, assignmentByEmployeeDate.get(`${assignment.employeeId}:${nextDate}`));
                  const workLabel = assignment.shift === "직접" ? `${assignment.start}부터 ${assignment.end}` : assignment.shift;
                  return <ScheduleBar employeeId={assignment.employeeId} employeeName={assignment.employeeName} color={employeeColorById.get(assignment.employeeId) ?? 0} className={`schedule-a-bar${starts ? " starts" : ""}${ends ? " ends" : ""}`} title={`${assignment.role} · ${workLabel} · ${assignment.workDate}`} text={starts ? `${assignment.employeeName} · ${workLabel}` : "\u00a0"} key={assignment.employeeId} />;
                }) : null}
                {!dayAssignments.length ? <em>근무자 미설정</em> : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
