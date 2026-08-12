import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, parseISO, startOfMonth, startOfWeek } from "date-fns";
import { ko } from "date-fns/locale";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { CalendarEntryActions } from "@/app/calendar-entry-actions";
import type { MonthlyLeave, MonthlyUnavailability } from "@/lib/domain";

function substituteLabel(leave: MonthlyLeave) {
  if (!leave.substituteRequired) return "대근 불필요";
  if (!leave.substituteCandidates.length) return "대근 후보 미정";
  return leave.substituteCandidates.map((candidate) => `${candidate.priority}순위 ${candidate.employeeName}`).join(" · ");
}

export function MonthlyCalendar({ month, selectedDate, leaves, unavailabilities = [], expanded = false, mode = "board" }: { month: string; selectedDate?: string; leaves: MonthlyLeave[]; unavailabilities?: MonthlyUnavailability[]; expanded?: boolean; mode?: "board" | "inline" }) {
  const monthDate = parseISO(`${month}-01`);
  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(monthDate), { weekStartsOn: 0 }),
    end: endOfWeek(endOfMonth(monthDate), { weekStartsOn: 0 }),
  });
  const leavesByDate = new Map<string, MonthlyLeave[]>();
  for (const leave of leaves) {
    const current = leavesByDate.get(leave.leaveDate) ?? [];
    current.push(leave);
    leavesByDate.set(leave.leaveDate, current);
  }
  const unavailabilityLanes = new Map<string, number>();
  const laneEndDates: string[] = [];
  for (const item of [...unavailabilities].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.employeeName.localeCompare(b.employeeName))) {
    let lane = laneEndDates.findIndex((endDate) => endDate < item.startDate);
    if (lane === -1) lane = laneEndDates.length;
    laneEndDates[lane] = item.endDate;
    unavailabilityLanes.set(item.id, lane);
  }
  const monthLink = (amount: number) => {
    const next = format(addMonths(monthDate, amount), "yyyy-MM");
    return mode === "board"
      ? { pathname: "/board", query: { month: next } }
      : { pathname: "/", query: { date: `${next}-01`, calendar: "1", month: next } };
  };

  return (
    <section className={`simple-card calendar-card${expanded ? " calendar-expanded" : ""}`} aria-labelledby="monthly-calendar-title">
      <header className="calendar-head">
        <div><CalendarDays size={23} /><h2 id="monthly-calendar-title">{format(monthDate, "yyyy년 M월", { locale: ko })} 반차·대근 불가 현황</h2></div>
        <nav aria-label="월 이동">
          <Link href={monthLink(-1)} aria-label="이전 달"><ChevronLeft size={21} /></Link>
          <Link href={monthLink(1)} aria-label="다음 달"><ChevronRight size={21} /></Link>
          <Link href={mode === "board" ? "/" : { pathname: "/", query: { date: selectedDate } }} aria-label="월간 캘린더 닫기"><span aria-hidden="true">×</span></Link>
        </nav>
      </header>
      <div className="calendar-legend" aria-label="캘린더 색상 안내">
        <span><i className="leave-key" aria-hidden="true" />반차</span>
        <span><i className="unavailability-key" aria-hidden="true" />대근 불가</span>
      </div>
      <div className="calendar-weekdays" aria-hidden="true">
        {['일', '월', '화', '수', '목', '금', '토'].map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="calendar-grid">
        {days.map((day) => {
          const dayKey = format(day, "yyyy-MM-dd");
          const dayLeaves = leavesByDate.get(dayKey) ?? [];
          const dayUnavailabilities = unavailabilities.filter((item) => item.startDate <= dayKey && item.endDate >= dayKey);
          const dayUnavailabilityByLane = new Map(dayUnavailabilities.map((item) => [unavailabilityLanes.get(item.id) ?? 0, item]));
          const highestActiveLane = Math.max(-1, ...dayUnavailabilityByLane.keys());
          return (
            <div
              className={`calendar-day${isSameMonth(day, monthDate) ? "" : " outside"}${dayKey === selectedDate ? " selected" : ""}`}
              key={dayKey}
            >
              <Link
                className="calendar-date-link"
                href={mode === "board"
                  ? { pathname: "/", query: { date: dayKey } }
                  : { pathname: "/", query: { date: dayKey, calendar: "1", month } }}
                aria-label={`${dayKey} 상세 보기`}
              ><time dateTime={dayKey}>{format(day, "d")}</time></Link>
              <div className="calendar-day-content">
                <div className="calendar-leaves">
                  {dayLeaves.slice(0, expanded ? dayLeaves.length : 3).map((leave) => {
                    const coverage = substituteLabel(leave);
                    return <CalendarEntryActions
                      className="leave-bar"
                      title={`${leave.employeeName} · ${leave.part} 반차 · ${coverage}`}
                      text={`${leave.employeeName} · ${leave.part} 반차 · ${coverage}`}
                      entry={{ type: "leave", id: leave.id, employeeId: leave.employeeId, employeeName: leave.employeeName, leaveDate: leave.leaveDate, part: leave.part, note: leave.note }}
                      key={leave.id}
                    />;
                  })}
                  {!expanded && dayLeaves.length > 3 ? <small>+{dayLeaves.length - 3}명</small> : null}
                </div>
                <div className="calendar-unavailability-bars">
                  {Array.from({ length: highestActiveLane + 1 }, (_, lane) => {
                    const item = dayUnavailabilityByLane.get(lane);
                    if (!item) return <span className="unavailability-lane-placeholder" aria-hidden="true" key={`empty-${dayKey}-${lane}`} />;
                    const startsSegment = item.startDate === dayKey || day.getDay() === 0;
                    const endsSegment = item.endDate === dayKey || day.getDay() === 6;
                    return (
                      <CalendarEntryActions
                        className={`unavailability-bar${startsSegment ? " starts" : ""}${endsSegment ? " ends" : ""}`}
                        title={`${item.employeeName} · ${item.startDate}–${item.endDate} · ${item.reason}`}
                        text={startsSegment ? `${item.employeeName} 대근불가` : "\u00a0"}
                        entry={{ type: "unavailability", id: item.id, employeeName: item.employeeName, startDate: item.startDate, endDate: item.endDate, start: item.start, end: item.end, reason: item.reason }}
                        key={item.id}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
