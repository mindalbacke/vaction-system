"use client";

import { useActionState, useState } from "react";
import { acceptSubstitute, type SubstituteAcceptActionState } from "@/app/actions";

type SubstituteCandidate = {
  id: string; name: string; role: string; referenceStart: string; referenceEnd: string;
};

const initialState: SubstituteAcceptActionState = { status: "idle", message: "" };

export function SubstituteAcceptForm({ requestId, candidates, connected, nextPriority }: { requestId: string; candidates: SubstituteCandidate[]; connected: boolean; nextPriority: 1 | 2 }) {
  const [employeeId, setEmployeeId] = useState(candidates[0]?.id ?? "");
  const [state, formAction, pending] = useActionState(acceptSubstitute, initialState);
  const selected = candidates.find((candidate) => candidate.id === employeeId);

  return (
    <form action={formAction} className="substitute-accept-form">
      <input type="hidden" name="requestId" value={requestId} />
      <label>
        대근 가능한 사람
        <select name="employeeId" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} required>
          {candidates.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name} · {candidate.role}</option>)}
        </select>
      </label>
      <button disabled={!connected || !candidates.length || pending}>{pending ? "등록 중…" : `${nextPriority}순위로 대근 가능`}</button>
      {selected ? (
        <div className="ex-reference" role="note">
          <span>EX 참고 근무시간</span><b>{selected.referenceStart}–{selected.referenceEnd}</b><small>기존 근무 구간 길이를 유지해 대근 뉴스를 포함한 시간입니다.</small>
        </div>
      ) : null}
      {state.status !== "idle" ? <p className={`form-feedback substitute-feedback ${state.status}`} role="status">{state.message}</p> : null}
    </form>
  );
}
