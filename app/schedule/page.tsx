import { ChevronLeft } from "lucide-react";
import { isValid, parseISO } from "date-fns";
import Image from "next/image";
import Link from "next/link";
import moleIcon from "@/app/mole-icon.png";
import { BoardAutoRefresh } from "@/app/board-auto-refresh";
import { AudioAPeriodEditor, ScheduleColorEditor, ScheduleDayEditor, SchedulePeriodEditor } from "@/app/schedule/schedule-editors";
import { ScheduleCalendar } from "@/app/schedule/schedule-calendar";
import { ThemeToggle } from "@/app/theme-toggle";
import { getCalendarHolidays } from "@/lib/korean-holidays";
import { getMonthlyWorkSchedule } from "@/lib/schedule-repository";

export const dynamic = "force-dynamic";

function todayInKorea() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

function safeMonth(value: string | undefined, fallback: string) {
  return value && /^\d{4}-\d{2}$/.test(value) && isValid(parseISO(`${value}-01`)) ? value : fallback.slice(0, 7);
}

function safeDate(value: string | undefined, month: string, fallback: string) {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value) && isValid(parseISO(value)) && value.startsWith(month)) return value;
  return fallback.startsWith(month) ? fallback : `${month}-01`;
}

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ month?: string; date?: string }> }) {
  const query = await searchParams;
  const today = todayInKorea();
  const month = safeMonth(query.month, today);
  const date = safeDate(query.date, month, today);
  const data = await getMonthlyWorkSchedule(month);
  const holidays = getCalendarHolidays(month);
  const selectedAssignments = data.assignments.filter((assignment) => assignment.workDate === date);

  return (
    <main className="board-shell schedule-shell">
      <header className="simple-header board-header">
        <div className="board-title"><span className="brand-icon"><Image src={moleIcon} alt="" priority /></span><div><b>월간 근무표</b><small>날짜별 근무자와 음향 A 교대를 설정합니다.</small></div></div>
        <div className="header-actions"><BoardAutoRefresh context="근무표" /><ThemeToggle /><Link className="back-link" href="/"><ChevronLeft size={19} /> 반차관리</Link></div>
      </header>
      <ScheduleCalendar month={month} selectedDate={date} assignments={data.assignments} audioPeriods={data.audioPeriods} employees={data.employees} holidays={holidays} />
      <div className="schedule-editor-grid">
        <ScheduleDayEditor key={`day-${date}`} date={date} employees={data.employees} assignments={selectedAssignments} connected={data.databaseConnected} />
        <AudioAPeriodEditor key={`audio-${date}`} date={date} month={month} excluded={data.audioMonthExcluded} employees={data.employees} connected={data.databaseConnected} />
      </div>
      <SchedulePeriodEditor key={`period-${date}`} date={date} employees={data.employees} connected={data.databaseConnected} />
      <ScheduleColorEditor employees={data.employees} connected={data.databaseConnected} />
    </main>
  );
}
