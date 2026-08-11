"use client";

import { useActionState, useState } from "react";
import { createLeave, type LeaveActionState } from "@/app/actions";
import type { ShiftCode } from "@/lib/domain";

type LeaveEmployee = { id: string; name: string; shift: ShiftCode };

export function LeaveForm({ employees, date, connected }: { employees: LeaveEmployee[]; date: string; connected: boolean }) {
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? "");
  const [part, setPart] = useState<"전반" | "후반">("전반");
  const initialState: LeaveActionState = { status: "idle", message: "" };
  const [state, formAction, pending] = useActionState(createLeave, initialState);
  const selectedEmployee = employees.find((employee) => employee.id === employeeId);
  const isUShift = selectedEmployee?.shift === "U";

  return (
    <form action={formAction} className="leave-form">
      <label>
        직원
        <select
          name="employeeId"
          value={employeeId}
          onChange={(event) => {
            const nextId = event.target.value;
            setEmployeeId(nextId);
            if (employees.find((employee) => employee.id === nextId)?.shift === "U") setPart("전반");
          }}
          required
        >
          {employees.map((employee) => <option value={employee.id} key={employee.id}>{employee.name} · {employee.shift} · {employee.shift === "U" ? "16:00–01:00" : employee.shift === "R" ? "13:00–21:00" : "09:00–18:00"}</option>)}
        </select>
      </label>
      <label>날짜<input type="date" name="leaveDate" defaultValue={date} required /></label>
      <fieldset>
        <legend>사용 시간</legend>
        <label><input type="radio" name="part" value="전반" checked={part === "전반"} onChange={() => setPart("전반")} /> 전반</label>
        <label><input type="radio" name="part" value="후반" checked={part === "후반"} onChange={() => setPart("후반")} disabled={isUShift} /> 후반</label>
      </fieldset>
      {isUShift && <p className="shift-rule-notice" role="note">U 근무자는 전반 반차만 사용할 수 있습니다.</p>}
      <label>비고<input name="note" maxLength={300} placeholder="선택 입력" /></label>
      <button type="submit" disabled={!connected || !employees.length || pending}>{pending ? "등록 중" : "반차 바로 등록"}</button>
      {state.status !== "idle" ? <p className={`form-feedback ${state.status}`} role="status">{state.message}</p> : null}
      {!connected && <small>Neon 연결 후 등록 버튼이 활성화됩니다.</small>}
    </form>
  );
}
