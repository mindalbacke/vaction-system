"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { changeLeavePin, type LeaveBalanceActionState, unlockLeaveBalance } from "@/app/actions";
import type { EmployeeRole } from "@/lib/domain";

type BalanceEmployee = { id: string; name: string; role: EmployeeRole };
const initialState: LeaveBalanceActionState = { status: "idle", message: "" };

type HrLeaveBalance = { total: number | null; used: number | null; registered: number | null; remaining: number | null };
type ExtensionApplication = { id: string; applicationDate: string; leaveType?: "연차휴가" | "대휴"; halfDaySummary?: string; reason: string; status: string };

type ExtensionSnapshot = {
  employeeId: string;
  hrSnapshot: {
    leaveBalances?: { annual: HrLeaveBalance | null; substitute: HrLeaveBalance | null } | null;
    annualTotal?: number | null; annualUsed: number | null; annualRemaining: number | null;
    substituteRemaining?: number | null; syncedAt: string;
  } | null;
  pending: { pendingCount: number; pendingDays: number };
  applicationCounts: { ready: number; submitted?: number; confirmed: number; needsReview: number };
  applications?: ExtensionApplication[];
};

function applicationLeaveType(value: string | undefined): "연차휴가" | "대휴" {
  return value === "대휴" ? "대휴" : "연차휴가";
}

function legacyBalance(total: number | null | undefined, used: number | null | undefined, remaining: number | null | undefined): HrLeaveBalance | null {
  return [total, used, remaining].some((value) => typeof value === "number")
    ? { total: total ?? null, used: used ?? null, registered: null, remaining: remaining ?? null }
    : null;
}

function OfficialLeaveCard({ label, balance }: { label: string; balance: HrLeaveBalance | null }) {
  const details = [
    typeof balance?.used === "number" ? `사용(결재완료) ${balance.used.toFixed(1)}일` : null,
    typeof balance?.registered === "number" ? `결재대기 ${balance.registered.toFixed(1)}일` : null,
    typeof balance?.total === "number" ? `기본 ${balance.total.toFixed(1)}일` : null,
  ].filter(Boolean).join(" · ");
  return <div><span>{label}</span><b>{typeof balance?.remaining === "number" ? `잔여 ${balance.remaining.toFixed(1)}일` : "미확인"}</b><small>{details || "사용량 미확인"}</small></div>;
}

function ExtensionLeaveHelperPanel({ employeeId, unlocked, cloudSnapshot }: { employeeId: string; unlocked: boolean; cloudSnapshot?: unknown | null }) {
  const [snapshot, setSnapshot] = useState<ExtensionSnapshot | null>(null);
  const [extensionReady, setExtensionReady] = useState(false);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [submitFeedback, setSubmitFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const submitRequestId = useRef<string | null>(null);
  const mutationRequestId = useRef<string | null>(null);
  const [mutatingId, setMutatingId] = useState<string | null>(null);

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
      if (event.data.type === "HALFDAY_HELPER_SUBMIT_RESULT" && event.data.requestId === submitRequestId.current) {
        const result = event.data.result as { ok: boolean; message?: string; error?: string };
        setSubmittingId(null);
        setSubmitFeedback({ tone: result.ok ? "success" : "error", text: result.ok ? result.message || "인사정보에 신청했습니다." : result.error || "신청하지 못했습니다." });
        submitRequestId.current = null;
        requestSnapshot();
      }
      if (event.data.type === "HALFDAY_HELPER_MUTATION_RESULT" && event.data.requestId === mutationRequestId.current) {
        const result = event.data.result as { ok: boolean; message?: string; error?: string };
        setMutatingId(null);
        setSubmitFeedback({ tone: result.ok ? "success" : "error", text: result.ok ? result.message || "신청 기록을 수정했습니다." : result.error || "신청 기록을 수정하지 못했습니다." });
        mutationRequestId.current = null;
        requestSnapshot();
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
  const submitApplication = (application: ExtensionApplication) => {
    const confirmed = window.confirm(`${application.applicationDate}에 ${applicationLeaveType(application.leaveType)} 1일을 신청합니다.\n휴가 사유는 빈칸으로 등록됩니다.\n\n인사정보 저장까지 진행할까요?`);
    if (!confirmed) return;
    const requestId = crypto.randomUUID();
    submitRequestId.current = requestId;
    setSubmittingId(application.id);
    setSubmitFeedback(null);
    window.postMessage({ source: "halfday-site", type: "HALFDAY_HELPER_SUBMIT", requestId, applicationId: application.id }, window.location.origin);
  };
  const mutateApplication = (type: "UPDATE" | "CONFIRM" | "CANCEL", application: ExtensionApplication, leaveType?: string) => {
    if (type === "CONFIRM" && !window.confirm("인사정보 신청을 확인 완료로 표시할까요?")) return;
    if (type === "CANCEL") {
      const submitted = application.status === "submitted" || application.status === "confirmed";
      const warning = submitted
        ? "도우미의 신청 기록과 반차 묶음을 취소합니다. 이미 인사정보에 저장된 신청은 인사정보에서 별도로 취소해야 합니다. 계속할까요?"
        : "신청 기록과 반차 묶음을 취소할까요? 두 반차는 다시 선택할 수 있게 됩니다.";
      if (!window.confirm(warning)) return;
    }
    const requestId = crypto.randomUUID();
    mutationRequestId.current = requestId;
    setMutatingId(application.id);
    setSubmitFeedback(null);
    window.postMessage({
      source: "halfday-site",
      type: `HALFDAY_HELPER_${type}_APPLICATION`,
      requestId,
      applicationId: application.id,
      leaveType,
    }, window.location.origin);
  };
  const matchesEmployee = snapshot?.employeeId === employeeId;
  const savedSnapshot = cloudSnapshot as ExtensionSnapshot | null | undefined;
  const displayedSnapshot = matchesEmployee && snapshot ? snapshot : savedSnapshot?.employeeId === employeeId ? savedSnapshot : null;
  const balances = displayedSnapshot?.hrSnapshot?.leaveBalances;
  const annual = balances?.annual || legacyBalance(displayedSnapshot?.hrSnapshot?.annualTotal, displayedSnapshot?.hrSnapshot?.annualUsed, displayedSnapshot?.hrSnapshot?.annualRemaining);
  const substitute = balances?.substitute || legacyBalance(null, null, displayedSnapshot?.hrSnapshot?.substituteRemaining);
  const official = annual?.remaining;
  const registered = typeof annual?.registered === "number" ? Math.max(0, annual.registered) : 0;
  const available = typeof official === "number" && displayedSnapshot ? Math.max(0, official - Math.max(registered, displayedSnapshot.pending.pendingDays)) : null;

  return (
    <div className="extension-helper-panel">
      <div className="extension-helper-head">
        <div><b>인사정보 반차 도우미</b><span>확인한 휴가 정보는 Neon에 안전하게 동기화됩니다.</span></div>
        <button type="button" onClick={openHelper}>반차 도우미 열기</button>
      </div>

      {!extensionReady ? <p className="extension-helper-notice">확장 프로그램을 설치하거나 새 버전으로 다시 로드해 주세요.</p> : null}
      {extensionReady && !matchesEmployee ? <p className="extension-helper-notice">확장 프로그램에서 현재 선택한 직원으로 연결해 주세요.</p> : null}
      {extensionReady && matchesEmployee && !unlocked ? <p className="extension-helper-notice">개인 PIN을 확인하면 인사정보 잔여량과 신청 기록이 표시됩니다.</p> : null}

      {unlocked && displayedSnapshot ? (
        <>
          <div className="extension-leave-types" role="status">
            <OfficialLeaveCard label="연차휴가" balance={annual} />
            <OfficialLeaveCard label="대휴" balance={substitute} />
          </div>
          <div className="extension-balance-summary" role="status">
            <div><span>미반영 반차</span><b>{displayedSnapshot.pending.pendingCount}건 · {displayedSnapshot.pending.pendingDays.toFixed(1)}일</b></div>
            <div><span>결재 전 예상 잔여</span><b>{available !== null ? `${available.toFixed(1)}일` : "미확인"}</b></div>
          </div>
          <div className="extension-application-summary">
            <span>신청 준비 <b>{displayedSnapshot.applicationCounts.ready}</b></span>
            <span>결재 대기 <b>{displayedSnapshot.applicationCounts.submitted ?? 0}</b></span>
            <span>신청 확인 <b>{displayedSnapshot.applicationCounts.confirmed}</b></span>
            <span>확인 필요 <b>{displayedSnapshot.applicationCounts.needsReview}</b></span>
          </div>
          <div className="extension-submit-list">
            <b>휴가 1일 신청</b>
            {displayedSnapshot.applications?.length ? displayedSnapshot.applications.map((application) => {
              const actionable = application.status === "ready" || application.status === "filled";
              const status = application.status === "submitted" ? "결재 대기" : application.status === "confirmed" ? "신청 확인" : application.status === "needs-review" ? "확인 필요" : "신청 가능";
              const interactive = matchesEmployee && snapshot;
              const leaveType = applicationLeaveType(application.leaveType);
              return (
                <article key={application.id}>
                  <div className="extension-submit-main">
                    <strong>{application.applicationDate} · {leaveType} 1일</strong>
                    {application.halfDaySummary ? <span>묶은 반차: {application.halfDaySummary}</span> : null}
                    <select
                      aria-label={`${application.applicationDate} 신청 휴가 종류`}
                      value={leaveType}
                      disabled={!interactive || !actionable || mutatingId !== null}
                      onChange={(event) => mutateApplication("UPDATE", application, event.target.value)}
                    >
                      <option>연차휴가</option><option>대휴</option>
                    </select>
                  </div>
                  <div className="extension-submit-actions">
                    {actionable ? <button type="button" disabled={!interactive || submittingId !== null || mutatingId !== null} onClick={() => submitApplication(application)}>
                      {submittingId === application.id ? "신청 중…" : "인사정보 신청"}
                    </button> : null}
                    {application.status === "submitted" ? <button type="button" disabled={!interactive || mutatingId !== null} onClick={() => mutateApplication("CONFIRM", application)}>신청 확인</button> : null}
                    {application.status === "confirmed" || application.status === "needs-review" ? <span>{status}</span> : null}
                    <button type="button" className="danger" disabled={!interactive || mutatingId !== null} onClick={() => mutateApplication("CANCEL", application)}>신청 취소</button>
                  </div>
                </article>
              );
            }) : <p>반차 두 건을 먼저 묶어 주세요.</p>}
          </div>
          {submitFeedback ? <p className={`extension-submit-feedback ${submitFeedback.tone}`} role="status">{submitFeedback.text}</p> : null}
          <small>{displayedSnapshot.hrSnapshot?.syncedAt ? `Neon 동기화 기준: ${new Date(displayedSnapshot.hrSnapshot.syncedAt).toLocaleString("ko-KR")}` : "반차 도우미에서 인사정보 잔여량을 먼저 확인해 주세요."}</small>
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
      <ExtensionLeaveHelperPanel employeeId={employee.id} unlocked={unlocked} cloudSnapshot={accessState.balance?.hrSnapshot} />
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
