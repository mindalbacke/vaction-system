"use client";

import { useActionState, useState } from "react";
import { changeLeavePin, type LeaveBalanceActionState, unlockLeaveBalance, updateLeaveBalance } from "@/app/actions";
import type { EmployeeRole } from "@/lib/domain";

type BalanceEmployee = { id: string; name: string; role: EmployeeRole };
const initialState: LeaveBalanceActionState = { status: "idle", message: "" };

function ProtectedBalancePanel({ employee, year, connected }: { employee: BalanceEmployee; year: number; connected: boolean }) {
  const [pin, setPin] = useState("");
  const [accessState, accessAction, accessPending] = useActionState(unlockLeaveBalance, initialState);
  const [updateState, updateAction, updatePending] = useActionState(updateLeaveBalance, initialState);
  const [pinState, pinAction, pinPending] = useActionState(changeLeavePin, initialState);
  const balanceCandidate = updateState.balance ?? accessState.balance;
  const balance = pinState.status !== "success" && balanceCandidate?.employeeId === employee.id ? balanceCandidate : undefined;

  return (
    <div className="balance-lock-panel">
      <form action={accessAction} className="balance-unlock-form">
        <input type="hidden" name="employeeId" value={employee.id} />
        <input type="hidden" name="year" value={year} />
        <label>PIN 번호<input type="password" name="pin" value={pin} onChange={(event) => setPin(event.target.value)} inputMode="numeric" pattern="[0-9]{4}" maxLength={4} autoComplete="current-password" placeholder="숫자 4자리" required /></label>
        <button disabled={!connected || accessPending}>{accessPending ? "확인 중" : "휴가 확인"}</button>
      </form>

      {!balance && accessState.status !== "idle" ? <p className={`form-feedback ${accessState.status}`} role="status">{accessState.message}</p> : null}
      {pinState.status !== "idle" ? <p className={`form-feedback ${pinState.status}`} role="status">{pinState.message}</p> : null}

      {balance ? (
        <div className="unlocked-balance">
          <div className="balance-summary" role="status">
            <div><span>총 휴가</span><b>{balance.totalDays.toFixed(1)}</b></div>
            <div><span>사용</span><b>{balance.usedDays.toFixed(1)}</b></div>
            <div><span>남은 휴가</span><b>{balance.remainingDays.toFixed(1)}</b></div>
          </div>

          <form action={updateAction} className="balance-edit-form">
            <input type="hidden" name="employeeId" value={employee.id} />
            <input type="hidden" name="year" value={year} />
            <input type="hidden" name="pin" value={pin} />
            <label>남은 휴가 수정<input type="number" name="remainingDays" defaultValue={balance.remainingDays} min="0" max="365" step="0.5" required /></label>
            <button disabled={updatePending}>{updatePending ? "수정 중" : "수정"}</button>
          </form>
          {updateState.status !== "idle" ? <p className={`form-feedback ${updateState.status}`} role="status">{updateState.message}</p> : null}

          <details className="pin-change">
            <summary>PIN 번호 변경</summary>
            <form action={pinAction}>
              <input type="hidden" name="employeeId" value={employee.id} />
              <input type="hidden" name="currentPin" value={pin} />
              <label>새 PIN<input type="password" name="newPin" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} placeholder="숫자 4자리" required /></label>
              <label>새 PIN 확인<input type="password" name="confirmPin" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} placeholder="한 번 더 입력" required /></label>
              <button disabled={pinPending}>{pinPending ? "변경 중" : "PIN 변경"}</button>
            </form>
          </details>
        </div>
      ) : null}
    </div>
  );
}

export function LeaveBalanceManager({ employees, year, connected }: { employees: BalanceEmployee[]; year: number; connected: boolean }) {
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? "");
  const employee = employees.find((item) => item.id === employeeId);

  return (
    <section className="simple-card balance-card">
      <div className="simple-section-title compact">
        <div><h2>개인 휴가 잔여량</h2><p>본인 PIN을 입력해야 휴가 정보가 표시됩니다. 최초 PIN은 0000이며 확인 후 변경할 수 있습니다.</p></div>
      </div>
      <label className="balance-employee-select">직원<select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>{employees.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.role}</option>)}</select></label>
      {employee ? <ProtectedBalancePanel employee={employee} year={year} connected={connected} key={employee.id} /> : null}
    </section>
  );
}
