"use client";

import { useActionState, useEffect, useState } from "react";
import { changeLeavePin, type LeaveBalanceActionState, unlockLeaveBalance } from "@/app/actions";
import type { EmployeeRole } from "@/lib/domain";

type BalanceEmployee = { id: string; name: string; role: EmployeeRole };
const initialState: LeaveBalanceActionState = { status: "idle", message: "" };

type ExtensionSnapshot = {
  employeeId: string;
  hrSnapshot: { annualUsed: number | null; annualRemaining: number | null; syncedAt: string } | null;
  pending: { pendingCount: number; pendingDays: number };
  applicationCounts: { ready: number; confirmed: number; needsReview: number };
};

function ExtensionLeaveHelperPanel({ employeeId, unlocked }: { employeeId: string; unlocked: boolean }) {
  const [snapshot, setSnapshot] = useState<ExtensionSnapshot | null>(null);
  const [extensionReady, setExtensionReady] = useState(false);

  useEffect(() => {
    const requestSnapshot = () => window.postMessage({ source: "halfday-site", type: "HALFDAY_HELPER_REQUEST" }, window.location.origin);
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin || event.data?.source !== "halfday-extension") return;
      if (event.data.type === "HALFDAY_HELPER_READY") {
        setExtensionReady(true);
        requestSnapshot();
      }
      if (event.data.type === "HALFDAY_HELPER_SNAPSHOT") {
        setExtensionReady(true);
        setSnapshot(event.data.snapshot as ExtensionSnapshot);
      }
    };
    window.addEventListener("message", handleMessage);
    window.addEventListener("focus", requestSnapshot);
    requestSnapshot();
    return () => {
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("focus", requestSnapshot);
    };
  }, []);

  const openHelper = () => window.postMessage({ source: "halfday-site", type: "HALFDAY_HELPER_OPEN" }, window.location.origin);
  const matchesEmployee = snapshot?.employeeId === employeeId;
  const official = snapshot?.hrSnapshot?.annualRemaining;
  const available = typeof official === "number" ? Math.max(0, official - snapshot!.pending.pendingDays) : null;

  return (
    <div className="extension-helper-panel">
      <div className="extension-helper-head">
        <div><b>인사정보 반차 도우미</b><span>잔여량과 신청 기록은 이 Chrome에서만 표시됩니다.</span></div>
        <button type="button" onClick={openHelper}>반차 도우미 열기</button>
      </div>

      {!extensionReady ? <p className="extension-helper-notice">확장 프로그램을 설치하거나 새 버전으로 다시 로드해 주세요.</p> : null}
      {extensionReady && !matchesEmployee ? <p className="extension-helper-notice">확장 프로그램에서 현재 선택한 직원으로 연결해 주세요.</p> : null}
      {extensionReady && matchesEmployee && !unlocked ? <p className="extension-helper-notice">개인 PIN을 확인하면 인사정보 잔여량과 신청 기록이 표시됩니다.</p> : null}

      {extensionReady && matchesEmployee && unlocked && snapshot ? (
        <>
          <div className="extension-balance-summary" role="status">
            <div><span>공식 사용량</span><b>{typeof snapshot.hrSnapshot?.annualUsed === "number" ? `${snapshot.hrSnapshot.annualUsed.toFixed(1)}일` : "미확인"}</b></div>
            <div><span>공식 잔여량</span><b>{typeof official === "number" ? `${official.toFixed(1)}일` : "미확인"}</b></div>
            <div><span>미반영 반차</span><b>{snapshot.pending.pendingCount}건 · {snapshot.pending.pendingDays.toFixed(1)}일</b></div>
            <div><span>참고 가능량</span><b>{available !== null ? `${available.toFixed(1)}일` : "미확인"}</b></div>
          </div>
          <div className="extension-application-summary">
            <span>신청 준비 <b>{snapshot.applicationCounts.ready}</b></span>
            <span>신청 확인 <b>{snapshot.applicationCounts.confirmed}</b></span>
            <span>확인 필요 <b>{snapshot.applicationCounts.needsReview}</b></span>
          </div>
          <small>{snapshot.hrSnapshot?.syncedAt ? `인사정보 확인: ${new Date(snapshot.hrSnapshot.syncedAt).toLocaleString("ko-KR")}` : "반차 도우미에서 인사정보 잔여량을 먼저 확인해 주세요."}</small>
        </>
      ) : null}
    </div>
  );
}

function ProtectedBalancePanel({ employee, year, connected }: { employee: BalanceEmployee; year: number; connected: boolean }) {
  const [pin, setPin] = useState("");
  const [accessState, accessAction, accessPending] = useActionState(unlockLeaveBalance, initialState);
  const [pinState, pinAction, pinPending] = useActionState(changeLeavePin, initialState);
  const unlocked = pinState.status !== "success" && accessState.balance?.employeeId === employee.id;

  return (
    <div className="balance-lock-panel">
      <ExtensionLeaveHelperPanel employeeId={employee.id} unlocked={unlocked} />
      <form action={accessAction} className="balance-unlock-form">
        <input type="hidden" name="employeeId" value={employee.id} />
        <input type="hidden" name="year" value={year} />
        <label>PIN 번호<input type="password" name="pin" value={pin} onChange={(event) => setPin(event.target.value)} inputMode="numeric" pattern="[0-9]{4}" maxLength={4} autoComplete="current-password" placeholder="숫자 4자리" required /></label>
        <button disabled={!connected || accessPending}>{accessPending ? "확인 중" : "휴가 확인"}</button>
      </form>

      {!unlocked && accessState.status !== "idle" ? <p className={`form-feedback ${accessState.status}`} role="status">{accessState.message}</p> : null}
      {pinState.status !== "idle" ? <p className={`form-feedback ${pinState.status}`} role="status">{pinState.message}</p> : null}

      {unlocked ? (
        <div className="unlocked-balance">
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
