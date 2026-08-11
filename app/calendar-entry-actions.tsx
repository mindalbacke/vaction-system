"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  cancelLeave,
  removeSubstituteUnavailability,
  type CalendarEditActionState,
  updateCalendarLeave,
  updateSubstituteUnavailability,
} from "@/app/actions";
import type { LeavePart } from "@/lib/domain";

type LeaveEntry = {
  type: "leave";
  id: string;
  employeeId: string;
  employeeName: string;
  leaveDate: string;
  part: LeavePart;
  note?: string;
};

type UnavailabilityEntry = {
  type: "unavailability";
  id: string;
  employeeName: string;
  startDate: string;
  endDate: string;
  start: string;
  end: string;
  reason: string;
};

type CalendarEntry = LeaveEntry | UnavailabilityEntry;
const initialState: CalendarEditActionState = { status: "idle", message: "" };

export function CalendarEntryActions({
  entry,
  className,
  text,
  title,
  list = false,
}: {
  entry: CalendarEntry;
  className?: string;
  text: string;
  title: string;
  list?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [startDate, setStartDate] = useState(entry.type === "unavailability" ? entry.startDate : "");
  const [endDate, setEndDate] = useState(entry.type === "unavailability" ? entry.endDate : "");
  const [leaveState, leaveAction, leavePending] = useActionState(updateCalendarLeave, initialState);
  const [unavailableState, unavailableAction, unavailablePending] = useActionState(updateSubstituteUnavailability, initialState);
  const state = entry.type === "leave" ? leaveState : unavailableState;
  const pending = entry.type === "leave" ? leavePending : unavailablePending;

  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state.status]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  const cancelLabel = entry.type === "leave" ? "반차 취소" : "대근 불가 해제";

  return (
    <>
      <button
        type="button"
        className={`${className ?? ""}${list ? " entry-list-edit" : " calendar-entry-trigger"}`}
        title={`${title} · 우클릭 또는 눌러서 수정/취소`}
        onClick={(event) => { event.preventDefault(); event.stopPropagation(); setOpen(true); }}
        onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setOpen(true); }}
      >{text}</button>

      {open ? (
        <div className="entry-editor-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
          <section className="entry-editor" role="dialog" aria-modal="true" aria-labelledby={`entry-editor-${entry.id}`} onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <b id={`entry-editor-${entry.id}`}>{entry.type === "leave" ? "반차 수정" : "대근 불가 수정"}</b>
                <span>{entry.employeeName}</span>
              </div>
              <button type="button" className="entry-editor-close" onClick={() => setOpen(false)} aria-label="닫기" autoFocus>×</button>
            </header>

            {entry.type === "leave" ? (
              <form action={leaveAction} className="entry-editor-form">
                <input type="hidden" name="id" value={entry.id} />
                <input type="hidden" name="employeeId" value={entry.employeeId} />
                <label>날짜<input type="date" name="leaveDate" defaultValue={entry.leaveDate} min={`${entry.leaveDate.slice(0, 4)}-01-01`} max={`${entry.leaveDate.slice(0, 4)}-12-31`} required /></label>
                <fieldset>
                  <legend>반차 구분</legend>
                  <label><input type="radio" name="part" value="전반" defaultChecked={entry.part === "전반"} /> 전반</label>
                  <label><input type="radio" name="part" value="후반" defaultChecked={entry.part === "후반"} /> 후반</label>
                </fieldset>
                <label>비고<input name="note" defaultValue={entry.note ?? ""} maxLength={300} placeholder="선택 입력" /></label>
                <button className="entry-save-button" disabled={pending}>{pending ? "수정 중…" : "수정 저장"}</button>
              </form>
            ) : (
              <form action={unavailableAction} className="entry-editor-form">
                <input type="hidden" name="id" value={entry.id} />
                <div className="entry-editor-date-row">
                  <label>시작 날짜<input type="date" name="startDate" value={startDate} onChange={(event) => {
                    const nextStart = event.target.value;
                    setStartDate(nextStart);
                    if (endDate < nextStart) setEndDate(nextStart);
                  }} required /></label>
                  <label>종료 날짜<input type="date" name="endDate" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} required /></label>
                </div>
                <div className="entry-editor-date-row">
                  <label>시작 시간<input type="time" name="start" defaultValue={entry.start} required /></label>
                  <label>종료 시간<input type="time" name="end" defaultValue={entry.end} required /></label>
                </div>
                <label>비고<input name="reason" defaultValue={entry.reason} minLength={2} maxLength={200} required /></label>
                <button className="entry-save-button" disabled={pending}>{pending ? "수정 중…" : "수정 저장"}</button>
              </form>
            )}

            {state.status !== "idle" ? <p className={`form-feedback ${state.status}`} role="status">{state.message}</p> : null}

            <form
              action={entry.type === "leave" ? cancelLeave : removeSubstituteUnavailability}
              className="entry-delete-form"
              onSubmit={(event) => {
                if (!window.confirm(`${entry.employeeName}님의 ${cancelLabel}를 진행할까요?`)) event.preventDefault();
              }}
            >
              <input type="hidden" name="id" value={entry.id} />
              <button>{cancelLabel}</button>
            </form>
            {entry.type === "leave" ? <small className="entry-editor-help">날짜나 반차 구분을 바꾸면 기존 대근 지정은 안전을 위해 해제됩니다.</small> : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
