"use client";

import { addDays, format, parseISO } from "date-fns";
import { ko } from "date-fns/locale";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { saveAudioAPeriod, saveDailyWorkSchedule, saveScheduleEmployeeColors, saveWorkSchedulePeriod, setAudioAMonthExclusion, type ScheduleActionState } from "@/app/schedule-actions";
import type { DailyWorkAssignment, ScheduleEmployee } from "@/lib/domain";

const initialState: ScheduleActionState = { status: "idle", message: "" };

export function LegacyScheduleDayEditor({ date, employees, assignments, connected }: {
  date: string; employees: ScheduleEmployee[]; assignments: DailyWorkAssignment[]; connected: boolean;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(saveDailyWorkSchedule, initialState);
  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.status]);
  const selected = new Set(assignments.map((assignment) => assignment.employeeId));

  return (
    <section className="simple-card schedule-editor-card" id="day-editor">
      <div className="schedule-editor-title">
        <div><h2>{format(parseISO(date), "M월 d일 EEEE", { locale: ko })} 근무자</h2><p>근무하는 사람을 선택한 뒤 저장하세요.</p></div>
        <span>{selected.size}명</span>
      </div>
      <form action={action} className="schedule-day-form">
        <input type="hidden" name="workDate" value={date} />
        <div className="schedule-employee-options">
          {employees.map((employee) => {
            const assignment = assignments.find((item) => item.employeeId === employee.id);
            return (
              <label key={employee.id}>
                <input type="checkbox" name="employeeIds" value={employee.id} defaultChecked={selected.has(employee.id)} />
                <span><b>{employee.name}</b><small>{employee.role}{assignment ? ` · ${assignment.shift} ${assignment.start}–${assignment.end}` : ""}</small></span>
              </label>
            );
          })}
        </div>
        <button disabled={!connected || pending}>{pending ? "저장 중…" : "이날 근무표 저장"}</button>
      </form>
      {state.status !== "idle" ? <p className={`form-feedback ${state.status}`} role="status">{state.message}</p> : null}
    </section>
  );
}

type DayMode = "A" | "R" | "U" | "CUSTOM";
type DaySelection = { selected: boolean; mode: DayMode; startTime: string; endTime: string };

export function ScheduleDayEditor({ date, employees, assignments, connected }: {
  date: string; employees: ScheduleEmployee[]; assignments: DailyWorkAssignment[]; connected: boolean;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(saveDailyWorkSchedule, initialState);
  const [selections, setSelections] = useState<Record<string, DaySelection>>(() => Object.fromEntries(employees.map((employee) => {
    const assignment = assignments.find((item) => item.employeeId === employee.id);
    return [employee.id, {
      selected: Boolean(assignment),
      mode: assignment?.shift === "직접" ? "CUSTOM" : assignment?.shift ?? (employee.role === "조명보조" ? "R" : "A"),
      startTime: assignment?.start ?? "09:00",
      endTime: assignment?.end ?? "18:00",
    }];
  })));
  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.status]);
  const selectedCount = Object.values(selections).filter((selection) => selection.selected).length;
  const updateSelection = (employeeId: string, changes: Partial<DaySelection>) => {
    setSelections((current) => ({ ...current, [employeeId]: { ...current[employeeId], ...changes } }));
  };

  return (
    <section className="simple-card schedule-editor-card" id="day-editor">
      <div className="schedule-editor-title">
        <div><h2>{format(parseISO(date), "M월 d일 EEEE", { locale: ko })} 근무자</h2><p>근무자를 선택하고 각 사람의 A·R·U 또는 직접 시간을 지정하세요.</p></div>
        <span>{selectedCount}명</span>
      </div>
      <form action={action} className="schedule-day-form">
        <input type="hidden" name="workDate" value={date} />
        {employees.flatMap((employee) => {
          const selection = selections[employee.id];
          return selection.selected ? [<input type="hidden" name="assignmentEntries" value={JSON.stringify({ employeeId: employee.id, mode: selection.mode, startTime: selection.startTime, endTime: selection.endTime })} key={`entry-${employee.id}`} />] : [];
        })}
        <div className="schedule-day-employee-options">
          {employees.map((employee) => {
            const selection = selections[employee.id];
            return (
              <article className={`schedule-day-employee-card${selection.selected ? " selected" : ""}`} key={employee.id}>
                <label className="schedule-day-person" htmlFor={`day-employee-${employee.id}`}>
                  <input id={`day-employee-${employee.id}`} type="checkbox" checked={selection.selected} onChange={(event) => updateSelection(employee.id, { selected: event.target.checked })} />
                  <span><b>{employee.name}</b><small>{employee.role}</small></span>
                </label>
                <div className="schedule-day-shift-toggles" aria-label={`${employee.name} 근무형태`}>
                  {(["A", "R", "U"] as const).map((mode) => <button type="button" disabled={!selection.selected} aria-pressed={selection.mode === mode} className={selection.mode === mode ? "selected" : ""} onClick={() => updateSelection(employee.id, { mode })} key={mode}>{mode}</button>)}
                  <button type="button" disabled={!selection.selected} aria-pressed={selection.mode === "CUSTOM"} className={selection.mode === "CUSTOM" ? "selected custom" : "custom"} onClick={() => updateSelection(employee.id, { mode: "CUSTOM" })}>{selection.startTime}부터 {selection.endTime}</button>
                </div>
                {selection.selected && selection.mode === "CUSTOM" ? (
                  <div className="schedule-day-custom-times">
                    <label>시작<input type="time" value={selection.startTime} onChange={(event) => updateSelection(employee.id, { startTime: event.target.value })} required /></label>
                    <label>종료<input type="time" value={selection.endTime} onChange={(event) => updateSelection(employee.id, { endTime: event.target.value })} required /></label>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
        <button disabled={!connected || pending}>{pending ? "저장 중…" : "이날 근무표 저장"}</button>
      </form>
      {state.status !== "idle" ? <p className={`form-feedback ${state.status}`} role="status">{state.message}</p> : null}
    </section>
  );
}

export function AudioAPeriodEditor({ date, month, excluded, employees, connected }: { date: string; month: string; excluded: boolean; employees: ScheduleEmployee[]; connected: boolean }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(saveAudioAPeriod, initialState);
  const [exclusionState, exclusionAction, exclusionPending] = useActionState(setAudioAMonthExclusion, initialState);
  const [startDate, setStartDate] = useState(date);
  useEffect(() => { if (state.status === "success" || exclusionState.status === "success") router.refresh(); }, [router, state.status, exclusionState.status]);
  const audioEmployees = employees.filter((employee) => employee.role === "음향보조");

  return (
    <section className="simple-card schedule-editor-card audio-period-editor">
      <div className="schedule-editor-title"><div><h2>음향 A 담당 2주 설정</h2><p>시작일 포함 14일간 선택한 사람이 A 근무를 합니다.</p></div></div>
      <form action={action} className="audio-period-form">
        <label>시작일<input type="date" name="startDate" value={startDate} onChange={(event) => setStartDate(event.target.value)} required /></label>
        <label>A 담당자<select name="employeeId" required>{audioEmployees.map((employee) => <option value={employee.id} key={employee.id}>{employee.name}</option>)}</select></label>
        <div className="audio-period-preview"><span>저장 기간</span><b>{startDate} – {format(addDays(parseISO(startDate), 13), "yyyy-MM-dd")}</b></div>
        <button disabled={!connected || pending || !audioEmployees.length}>{pending ? "저장 중…" : "2주 A 담당 저장"}</button>
      </form>
      {state.status !== "idle" ? <p className={`form-feedback ${state.status}`} role="status">{state.message}</p> : null}
      <div className={`audio-month-exclusion${excluded ? " excluded" : ""}`}>
        <div><b>{month} 음향 A 2주</b><span>{excluded ? "이 달은 해제되어 캘린더에 표시되지 않습니다." : "이 달만 해제해도 다른 달의 2주 교대는 유지됩니다."}</span></div>
        <form action={exclusionAction}>
          <input type="hidden" name="month" value={month} />
          <input type="hidden" name="operation" value={excluded ? "restore" : "exclude"} />
          <button disabled={!connected || exclusionPending}>{exclusionPending ? "처리 중…" : excluded ? "이 달 A 표시 복구" : "이 달 A 2주 해제"}</button>
        </form>
      </div>
      {exclusionState.status !== "idle" ? <p className={`form-feedback ${exclusionState.status}`} role="status">{exclusionState.message}</p> : null}
    </section>
  );
}

type PeriodMode = "A" | "R" | "U" | "CUSTOM";

export function SchedulePeriodEditor({ date, employees, connected }: {
  date: string; employees: ScheduleEmployee[]; connected: boolean;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(saveWorkSchedulePeriod, initialState);
  const [startDate, setStartDate] = useState(date);
  const [endDate, setEndDate] = useState(date);
  const [mode, setMode] = useState<PeriodMode>("A");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("18:00");
  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.status]);

  return (
    <section className="simple-card schedule-editor-card schedule-period-editor">
      <div className="schedule-editor-title">
        <div><h2>연속 근무 등록</h2><p>근무자와 기간을 고르면 같은 근무가 날짜별로 저장되고 캘린더 바가 이어집니다.</p></div>
      </div>
      <form action={action} className="schedule-period-form">
        <label>근무자<select name="employeeId" required>{employees.map((employee) => <option value={employee.id} key={employee.id}>{employee.name} · {employee.role}</option>)}</select></label>
        <div className="schedule-period-dates">
          <label>시작일<input type="date" name="startDate" value={startDate} onChange={(event) => { setStartDate(event.target.value); if (endDate < event.target.value) setEndDate(event.target.value); }} required /></label>
          <label>종료일<input type="date" name="endDate" min={startDate} value={endDate} onChange={(event) => setEndDate(event.target.value)} required /></label>
        </div>
        <fieldset className="schedule-shift-fieldset">
          <legend>근무형태</legend>
          <input type="hidden" name="mode" value={mode} />
          <div className="schedule-shift-toggles">
            {(["A", "R", "U"] as const).map((shift) => (
              <button type="button" aria-pressed={mode === shift} className={mode === shift ? "selected" : ""} onClick={() => setMode(shift)} key={shift}>{shift}</button>
            ))}
            <button type="button" aria-pressed={mode === "CUSTOM"} className={mode === "CUSTOM" ? "selected custom" : "custom"} onClick={() => setMode("CUSTOM")}>{startTime}부터 {endTime}</button>
          </div>
        </fieldset>
        <div className={`schedule-custom-times${mode === "CUSTOM" ? " visible" : ""}`} aria-hidden={mode !== "CUSTOM"}>
          <label>시작 시간<input type="time" name="startTime" value={startTime} onChange={(event) => setStartTime(event.target.value)} required /></label>
          <label>종료 시간<input type="time" name="endTime" value={endTime} onChange={(event) => setEndTime(event.target.value)} required /></label>
        </div>
        <small className="schedule-period-help">같은 근무자의 기존 일정이 겹치면 새 설정으로 바뀝니다. 최대 93일까지 한 번에 등록할 수 있습니다.</small>
        <button disabled={!connected || pending || !employees.length}>{pending ? "저장 중…" : "연속 근무 저장"}</button>
      </form>
      {state.status !== "idle" ? <p className={`form-feedback ${state.status}`} role="status">{state.message}</p> : null}
    </section>
  );
}

export function ScheduleColorEditor({ employees, connected }: { employees: ScheduleEmployee[]; connected: boolean }) {
  const router = useRouter();
  const [colors, setColors] = useState<Record<string, number>>(() => Object.fromEntries(employees.map((employee) => [employee.id, employee.color])));
  const [state, action, pending] = useActionState(saveScheduleEmployeeColors, initialState);
  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.status]);

  return (
    <section className="simple-card schedule-editor-card schedule-color-editor">
      <div className="schedule-editor-title"><div><h2>근무자 표시 색상</h2><p>각 직원의 캘린더 바 색상을 12색 중에서 선택하세요.</p></div></div>
      <form action={action} className="schedule-color-form">
        <div className="schedule-color-rows">
          {employees.map((employee) => (
            <fieldset key={employee.id}>
              <legend><b>{employee.name}</b><span>{employee.role}</span></legend>
              <input type="hidden" name="colors" value={`${employee.id}:${colors[employee.id]}`} />
              <div className="schedule-color-palette">
                {Array.from({ length: 12 }, (_, color) => (
                  <button
                    type="button"
                    className={`schedule-color-choice schedule-color-${color}${colors[employee.id] === color ? " selected" : ""}`}
                    aria-label={`${employee.name} 색상 ${color + 1}`}
                    aria-pressed={colors[employee.id] === color}
                    onClick={() => setColors((current) => ({ ...current, [employee.id]: color }))}
                    key={color}
                  />
                ))}
              </div>
            </fieldset>
          ))}
        </div>
        <button disabled={!connected || pending}>{pending ? "저장 중…" : "근무자 색상 저장"}</button>
      </form>
      {state.status !== "idle" ? <p className={`form-feedback ${state.status}`} role="status">{state.message}</p> : null}
    </section>
  );
}
