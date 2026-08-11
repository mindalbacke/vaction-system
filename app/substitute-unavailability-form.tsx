"use client";

import { useActionState, useState } from "react";
import { createSubstituteUnavailability, type UnavailabilityActionState } from "@/app/actions";

type UnavailabilityEmployee = { id: string; name: string; role: string };
const initialState: UnavailabilityActionState = { status: "idle", message: "" };

export function SubstituteUnavailabilityForm({ employees, date, connected }: { employees: UnavailabilityEmployee[]; date: string; connected: boolean }) {
  const [startDate, setStartDate] = useState(date);
  const [endDate, setEndDate] = useState(date);
  const [state, formAction, pending] = useActionState(createSubstituteUnavailability, initialState);

  return (
    <form action={formAction} className="unavailable-form">
      <label>직원<select name="employeeId" required>{employees.map((employee) => <option value={employee.id} key={employee.id}>{employee.name} · {employee.role}</option>)}</select></label>
      <label>시작 날짜<input type="date" name="startDate" value={startDate} onChange={(event) => {
        const nextStart = event.target.value;
        setStartDate(nextStart);
        if (endDate < nextStart) setEndDate(nextStart);
      }} required /></label>
      <label>종료 날짜<input type="date" name="endDate" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} required /></label>
      <label>시작<input type="time" name="start" defaultValue="09:00" required /></label>
      <label>종료<input type="time" name="end" defaultValue="18:00" required /></label>
      <label className="unavailable-reason">비고<input name="reason" minLength={2} maxLength={200} placeholder="예: 병원 진료, 개인 일정" required /></label>
      <button disabled={!connected || !employees.length || pending}>{pending ? "저장 중" : "등록"}</button>
      {state.status !== "idle" ? <p className={`form-feedback unavailable-feedback ${state.status}`} role="status">{state.message}</p> : null}
    </form>
  );
}
