import { CalendarDays, ChevronLeft } from "lucide-react";
import { isValid, parseISO } from "date-fns";
import Link from "next/link";
import { BoardAutoRefresh } from "@/app/board-auto-refresh";
import { MonthlyCalendar } from "@/app/monthly-calendar";
import { ThemeToggle } from "@/app/theme-toggle";
import { getMonthlyLeaves, getMonthlyUnavailabilities } from "@/lib/repository";

export const dynamic = "force-dynamic";

function currentMonth() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" })
    .format(new Date())
    .slice(0, 7);
}

function safeMonth(value?: string) {
  return value && /^\d{4}-\d{2}$/.test(value) && isValid(parseISO(`${value}-01`)) ? value : currentMonth();
}

export default async function BoardPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month: requestedMonth } = await searchParams;
  const month = safeMonth(requestedMonth);
  const [leaves, unavailabilities] = await Promise.all([
    getMonthlyLeaves(`${month}-01`),
    getMonthlyUnavailabilities(`${month}-01`),
  ]);

  return (
    <main className="board-shell">
      <header className="simple-header board-header">
        <div className="board-title"><span><CalendarDays size={25} /></span><div><b>반차 전광판</b><small>월간 반차 현황을 한눈에 확인하세요.</small></div></div>
        <div className="header-actions"><BoardAutoRefresh /><ThemeToggle /><Link className="back-link" href="/"><ChevronLeft size={19} /> 반차관리</Link></div>
      </header>
      <MonthlyCalendar month={month} leaves={leaves} unavailabilities={unavailabilities} expanded mode="board" />
    </main>
  );
}
