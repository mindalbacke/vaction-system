import { Ban, CalendarClock, CalendarDays, Check, ChevronLeft, ChevronRight, Settings, Tv, Umbrella } from "lucide-react";
import { addDays, format, isValid, parseISO } from "date-fns";
import { ko } from "date-fns/locale";
import Image from "next/image";
import Link from "next/link";
import moleIcon from "@/app/mole-icon.png";
import { cancelLeave } from "@/app/actions";
import { CalendarEntryActions } from "@/app/calendar-entry-actions";
import { LeaveForm } from "@/app/leave-form";
import { LeaveBalanceManager } from "@/app/leave-balance-manager";
import { MonthlyCalendar } from "@/app/monthly-calendar";
import { SubstituteAcceptForm } from "@/app/substitute-accept-form";
import { SubstituteUnavailabilityForm } from "@/app/substitute-unavailability-form";
import { ThemeToggle } from "@/app/theme-toggle";
import type { DashboardSnapshot, MonthlyLeave, MonthlyUnavailability, SubstituteUnavailability } from "@/lib/domain";
import { getDashboardSnapshot, getMonthlyLeaves, getMonthlyUnavailabilities, getRegisteredLeaves, getSubstituteUnavailabilityList } from "@/lib/repository";
import { getReferenceSubstituteShift, overlaps } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

function safeDate(value?: string) {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value) && isValid(parseISO(value))) return value;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

function dateHref(date: string, amount: number) {
  return `/?date=${format(addDays(parseISO(date), amount), "yyyy-MM-dd")}`;
}

function Dashboard({ snapshot, registeredLeaves, calendarMonth, monthlyLeaves, monthlyUnavailabilities, unavailabilityList }: { snapshot: DashboardSnapshot; registeredLeaves: MonthlyLeave[]; calendarMonth?: string; monthlyLeaves: MonthlyLeave[]; monthlyUnavailabilities: MonthlyUnavailability[]; unavailabilityList: SubstituteUnavailability[] }) {
  const { date, employees, leaves, substitutes, unavailabilities } = snapshot;
  const substituteByLeave = new Map(substitutes.map((request) => [request.leaveId, request]));
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));

  return (
    <main className="simple-shell">
      <header className="simple-header">
        <div className="simple-header-left">
          <Link className="simple-brand" href="/">
            <span className="brand-icon"><Image src={moleIcon} alt="" priority /></span>
            <div><b>반차관리</b></div>
          </Link>
          <Link className="settings-link schedule-link" href={{ pathname: "/schedule", query: { month: date.slice(0, 7), date } }} target="_blank" rel="noopener noreferrer"><CalendarClock size={19} /> 근무표</Link>
        </div>
        <div className="header-actions">
          <ThemeToggle />
          <Link className="settings-link board-link" href={{ pathname: "/board", query: { month: date.slice(0, 7) } }}><Tv size={19} /> 전광판</Link>
          <Link className="settings-link" href="/manage"><Settings size={19} /> 직원 관리</Link>
        </div>
      </header>

      <section className="simple-date-nav" aria-label="날짜 이동">
        <a href={dateHref(date, -1)} aria-label="이전 날짜"><ChevronLeft /></a>
        <div><b>{format(parseISO(date), "M월 d일 EEEE", { locale: ko })}</b><span>{format(parseISO(date), "yyyy년")}</span></div>
        <a href={dateHref(date, 1)} aria-label="다음 날짜"><ChevronRight /></a>
        <Link className="today-link-simple" href="/">오늘</Link>
        <Link className="calendar-link-simple" href={{ pathname: "/", query: { date, calendar: "1", month: date.slice(0, 7) } }}><CalendarDays size={17} /> 월간</Link>
      </section>

      {calendarMonth ? <MonthlyCalendar month={calendarMonth} selectedDate={date} leaves={monthlyLeaves} unavailabilities={monthlyUnavailabilities} mode="inline" /> : null}

      <div className="simple-grid">
        <section className="simple-card register-card">
          <div className="simple-section-title">
            <span className="title-icon coral"><Umbrella size={24} /></span>
            <div><h1>반차 등록</h1><p>등록하면 대근 공석도 자동으로 올라옵니다.</p></div>
          </div>
          <LeaveForm
            employees={employees.map(({ id, name, shift }) => ({ id, name, shift }))}
            date={date}
            connected={snapshot.databaseConnected}
          />
        </section>

        <section className="simple-card leave-board" aria-labelledby="leave-board-title">
          <div className="simple-section-title">
            <span className="title-icon blue"><Check size={24} /></span>
            <div><h2 id="leave-board-title">반차·대근 현황</h2><p>{registeredLeaves.length ? `등록된 반차 ${registeredLeaves.length}건을 날짜별로 보여줍니다.` : "등록된 반차가 없습니다."}</p></div>
          </div>

          <div className="leave-feed">
            {registeredLeaves.map((leaveSummary) => {
              const leave = leaves.find((item) => item.id === leaveSummary.id);
              const isSelectedDate = leaveSummary.leaveDate === date && leave !== undefined;
              const displayLeave = leave ?? {
                id: leaveSummary.id,
                employeeId: leaveSummary.employeeId,
                employeeName: leaveSummary.employeeName,
                leaveDate: leaveSummary.leaveDate,
                part: leaveSummary.part,
                start: "",
                end: "",
                status: "",
                note: leaveSummary.note,
              };
              const request = isSelectedDate ? substituteByLeave.get(displayLeave.id) : undefined;
              const leaveEmployee = employeeById.get(displayLeave.employeeId);
              const substituteRequired = leaveSummary.substituteRequired;
              const eligibleEmployees = employees.filter((employee) =>
                employee.id !== displayLeave.employeeId
                && !request?.candidates.some((candidate) => candidate.employeeId === employee.id)
                && (employee.substituteEligible || (employee.role === "서무" && request !== undefined && request.end <= "13:00"))
                && !employee.leavePart
                && !unavailabilities.some((unavailable) =>
                  unavailable.employeeId === employee.id
                  && request
                  && overlaps({ start: unavailable.dayStart, end: unavailable.dayEnd }, { start: request.start, end: request.end })
                )
              );
              const candidateOptions = request ? eligibleEmployees.map((employee) => {
                const reference = getReferenceSubstituteShift(
                  { start: employee.shiftStart, end: employee.shiftEnd },
                  { start: request.start, end: request.end },
                );
                return { id: employee.id, name: employee.name, role: employee.role, referenceStart: reference.start, referenceEnd: reference.end };
              }) : [];
              const rankedCandidates = request?.candidates.map((candidate) => {
                const employee = employeeById.get(candidate.employeeId);
                const reference = employee ? getReferenceSubstituteShift(
                  { start: employee.shiftStart, end: employee.shiftEnd },
                  { start: request.start, end: request.end },
                ) : undefined;
                return { ...candidate, role: employee?.role, reference };
              }) ?? [];
              return (
                <article className="leave-feed-item" key={displayLeave.id}>
                  <div className="leave-date-row">
                    <time dateTime={displayLeave.leaveDate}>{format(parseISO(displayLeave.leaveDate), "yyyy년 M월 d일 EEEE", { locale: ko })}</time>
                    <div className="leave-date-actions">
                      {!isSelectedDate && <Link href={{ pathname: "/", query: { date: displayLeave.leaveDate } }}>이 날짜 상세보기</Link>}
                      <form action={cancelLeave} className="cancel-leave-form">
                        <input type="hidden" name="id" value={displayLeave.id} />
                        <button disabled={!snapshot.databaseConnected}>반차 취소</button>
                      </form>
                    </div>
                  </div>
                  <div className="leave-person">
                    <span className="simple-avatar">{displayLeave.employeeName.slice(-2)}</span>
                    <div><b>{displayLeave.employeeName}님이 {displayLeave.part} 반차를 사용합니다.</b><span>{isSelectedDate ? `${displayLeave.start}–${displayLeave.end}` : `${displayLeave.part} 반차`}{displayLeave.note ? ` · ${displayLeave.note}` : ""}</span></div>
                  </div>

                  {substituteRequired && request && (
                    <div className="news-coverage">
                      <div><small>담당 뉴스</small><b>{request.newsNames.length ? request.newsNames.join(" · ") : "겹치는 뉴스 없음"}</b></div>
                      <div><small>필수 대근 구간</small><b>{request.start}–{request.end}</b></div>
                    </div>
                  )}

                  {!substituteRequired ? (
                    <p className="substitute-not-required">{leaveEmployee?.role ?? "해당 직무"} 반차는 대근이 필요하지 않습니다.</p>
                  ) : request ? (
                    <div className="substitute-candidate-section">
                      {rankedCandidates.length ? (
                        <div className="substitute-rank-list" aria-label="대근 가능 후보 순위">
                          {rankedCandidates.map((candidate) => (
                            <div className={`substitute-rank rank-${candidate.priority}`} key={candidate.employeeId}>
                              <strong>{candidate.priority}순위</strong>
                              <span><b>{candidate.employeeName}</b>{candidate.role ? ` · ${candidate.role}` : ""}</span>
                              <small>필수 {request.start}–{request.end}{candidate.reference ? ` · EX ${candidate.reference.start}–${candidate.reference.end}` : ""}</small>
                            </div>
                          ))}
                        </div>
                      ) : <p className="substitute-pending">아직 대근 가능 후보가 없습니다.</p>}
                      {rankedCandidates.length < 2 ? (
                        <SubstituteAcceptForm requestId={request.id} candidates={candidateOptions} connected={snapshot.databaseConnected} nextPriority={(rankedCandidates.length + 1) as 1 | 2} />
                      ) : <p className="substitute-candidate-full"><Check size={17} /> 1·2순위 후보 등록이 완료되었습니다.</p>}
                    </div>
                  ) : leaveSummary.substituteCandidates.length ? (
                    <div className="substitute-rank-list" aria-label="대근 가능 후보 순위">
                      {leaveSummary.substituteCandidates.map((candidate) => (
                        <div className={`substitute-rank rank-${candidate.priority}`} key={candidate.employeeId}>
                          <strong>{candidate.priority}순위</strong>
                          <span><b>{candidate.employeeName}</b></span>
                        </div>
                      ))}
                    </div>
                  ) : <p className="substitute-pending">아직 대근 가능 후보가 없습니다.</p>}
                </article>
              );
            })}
            {!registeredLeaves.length && <div className="simple-empty"><Umbrella size={30} /><b>반차 사용자가 없습니다.</b><span>위에서 바로 등록할 수 있습니다.</span></div>}
          </div>
        </section>
      </div>

      <section className="simple-card unavailable-card">
        <div className="simple-section-title compact">
          <span className="title-icon coral"><Ban size={23} /></span>
          <div><h2>대근 불가 등록</h2><p>불가능한 시간과 이유를 등록하면 해당 대근 후보에서 자동 제외됩니다.</p></div>
        </div>
        <SubstituteUnavailabilityForm employees={employees.map(({ id, name, role }) => ({ id, name, role }))} date={date} connected={snapshot.databaseConnected} />
        <h3 className="unavailable-list-title">현재·예정 대근 불가 목록 <span>{unavailabilityList.length}건</span></h3>
        <div className="unavailable-list">
          {unavailabilityList.map((unavailable) => (
            <article key={unavailable.id}>
              <span className="simple-avatar">{unavailable.employeeName.slice(-2)}</span>
              <div><b>{unavailable.employeeName} · 대근 불가</b><span>{unavailable.startDate} {unavailable.start}–{unavailable.endDate} {unavailable.end} · {unavailable.reason}</span></div>
              <CalendarEntryActions
                entry={{ type: "unavailability", id: unavailable.id, employeeName: unavailable.employeeName, startDate: unavailable.startDate, endDate: unavailable.endDate, start: unavailable.start, end: unavailable.end, reason: unavailable.reason }}
                text="수정·해제"
                title={`${unavailable.employeeName} 대근 불가 관리`}
                list
              />
            </article>
          ))}
          {!unavailabilityList.length && <p className="unavailable-empty">현재 진행 중이거나 예정된 대근 불가가 없습니다.</p>}
        </div>
      </section>

      <LeaveBalanceManager employees={employees.map(({ id, name, role }) => ({ id, name, role }))} year={Number(date.slice(0, 4))} connected={snapshot.databaseConnected} />

      <section className="simple-card roster-card">
        <div className="simple-section-title compact">
          <div><h2>오늘 근무</h2><p>음향보조는 등록한 교대 기준일부터 2주마다 A/U가 자동 전환됩니다.</p></div>
        </div>
        <div className="simple-roster">
          {employees.map((employee) => (
            <article key={employee.id}>
              <span className="simple-avatar">{employee.name.slice(-2)}</span>
              <div><b>{employee.name}</b><span>{employee.role}</span></div>
              <strong>{employee.shift}</strong>
              <time>{employee.shiftStart}–{employee.shiftEnd}</time>
              {employee.leavePart && <em>{employee.leavePart} 반차</em>}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

export default async function Page({ searchParams }: { searchParams: Promise<{ date?: string; calendar?: string; month?: string }> }) {
  const { date: requestedDate, calendar, month } = await searchParams;
  const date = safeDate(requestedDate);
  const calendarMonth = calendar === "1" && month && /^\d{4}-\d{2}$/.test(month) && isValid(parseISO(`${month}-01`)) ? month : undefined;
  const [snapshot, registeredLeaves, monthlyLeaves, monthlyUnavailabilities, unavailabilityList] = await Promise.all([
    getDashboardSnapshot(date),
    getRegisteredLeaves(),
    calendarMonth ? getMonthlyLeaves(`${calendarMonth}-01`) : Promise.resolve([]),
    calendarMonth ? getMonthlyUnavailabilities(`${calendarMonth}-01`) : Promise.resolve([]),
    getSubstituteUnavailabilityList(date),
  ]);
  return <Dashboard snapshot={snapshot} registeredLeaves={registeredLeaves} calendarMonth={calendarMonth} monthlyLeaves={monthlyLeaves} monthlyUnavailabilities={monthlyUnavailabilities} unavailabilityList={unavailabilityList} />;
}
