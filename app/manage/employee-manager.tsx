"use client";

import { type FormEvent, useState } from "react";
import {
  createEmployee,
  toggleEmployeeActive,
  updateEmployee,
  type EmployeeMutationResult,
  type ManagedEmployee,
} from "@/app/manage-actions";

const roles: ManagedEmployee["role"][] = ["음향보조", "조명보조", "중계보조", "서무"];

type Feedback = { tone: "success" | "error"; text: string } | null;

function failedResult(error: unknown): EmployeeMutationResult {
  console.error("Employee request failed", error);
  return { ok: false, error: "네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." };
}

export function EmployeeManager({ initialEmployees, connected }: { initialEmployees: ManagedEmployee[]; connected: boolean }) {
  const [employees, setEmployees] = useState(initialEmployees);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const optimisticId = `new-${Date.now()}`;
    const optimisticEmployee: ManagedEmployee = {
      id: optimisticId,
      name: String(formData.get("name") ?? "").trim(),
      role: String(formData.get("role")) as ManagedEmployee["role"],
      active: true,
    };

    setFeedback(null);
    setBusyId(optimisticId);
    setEmployees((current) => [optimisticEmployee, ...current]);

    let result: EmployeeMutationResult;
    try {
      result = await createEmployee(formData);
    } catch (error) {
      result = failedResult(error);
    }

    if (result.ok) {
      setEmployees((current) => current.map((employee) => employee.id === optimisticId ? result.employee : employee));
      form.reset();
      setFeedback({ tone: "success", text: `${result.employee.name}님을 등록했습니다.` });
    } else {
      setEmployees((current) => current.filter((employee) => employee.id !== optimisticId));
      setFeedback({ tone: "error", text: result.error });
    }
    setBusyId(null);
  }

  async function handleUpdate(event: FormEvent<HTMLFormElement>, employee: ManagedEmployee) {
    event.preventDefault();
    const form = event.currentTarget;
    const editor = form.closest("details");
    const formData = new FormData(form);
    const optimisticEmployee: ManagedEmployee = {
      ...employee,
      name: String(formData.get("name") ?? "").trim(),
      role: String(formData.get("role")) as ManagedEmployee["role"],
    };

    setFeedback(null);
    setBusyId(employee.id);
    setEmployees((current) => current.map((item) => item.id === employee.id ? optimisticEmployee : item));

    let result: EmployeeMutationResult;
    try {
      result = await updateEmployee(formData);
    } catch (error) {
      result = failedResult(error);
    }

    if (result.ok) {
      setEmployees((current) => current.map((item) => item.id === employee.id ? result.employee : item));
      editor?.removeAttribute("open");
      setFeedback({ tone: "success", text: `${result.employee.name}님의 이름과 역할을 저장했습니다.` });
    } else {
      setEmployees((current) => current.map((item) => item.id === employee.id ? employee : item));
      setFeedback({ tone: "error", text: result.error });
    }
    setBusyId(null);
  }

  async function handleToggle(employee: ManagedEmployee) {
    const formData = new FormData();
    formData.set("id", employee.id);
    setFeedback(null);
    setBusyId(employee.id);
    setEmployees((current) => current.map((item) => item.id === employee.id ? { ...item, active: !item.active } : item));

    let result: EmployeeMutationResult;
    try {
      result = await toggleEmployeeActive(formData);
    } catch (error) {
      result = failedResult(error);
    }

    if (result.ok) {
      setEmployees((current) => current.map((item) => item.id === employee.id ? result.employee : item));
      setFeedback({ tone: "success", text: `${result.employee.name}님의 상태를 변경했습니다.` });
    } else {
      setEmployees((current) => current.map((item) => item.id === employee.id ? employee : item));
      setFeedback({ tone: "error", text: result.error });
    }
    setBusyId(null);
  }

  return (
    <div className="manage-layout narrow">
      <section className="manage-card">
        <div className="manage-card-head"><div><p className="section-kicker">NEW MEMBER</p><h2>직원 등록</h2></div></div>
        <form className="manage-form" onSubmit={handleCreate}>
          <label>이름<input name="name" minLength={2} maxLength={30} required /></label>
          <label>담당 업무<select name="role">{roles.map((role) => <option key={role}>{role}</option>)}</select></label>
          <button disabled={!connected || busyId !== null}>{busyId?.startsWith("new-") ? "등록 중…" : "직원 등록"}</button>
          <small>등록 즉시 공동 목록에 추가됩니다.</small>
        </form>
      </section>

      <section className="manage-card">
        <div className="manage-card-head"><div><h2>직원 목록</h2></div><span>{employees.length}명</span></div>
        {feedback && <p className={`employee-feedback ${feedback.tone}`} role="status" aria-live="polite">{feedback.text}</p>}
        <div className="manage-list employee-manage-list">
          {employees.map((employee) => {
            const pending = busyId === employee.id || employee.id.startsWith("new-");
            return (
              <article key={employee.id} aria-busy={pending}>
                <span className="avatar">{employee.name.slice(-2)}</span>
                <div><b>{employee.name}</b><small>{employee.role}</small></div>
                <span className={employee.active ? "active-label" : "inactive-label"}>{pending ? "저장 중" : employee.active ? "재직" : "비활성"}</span>
                {!employee.id.startsWith("new-") && (
                  <details className="row-editor">
                    <summary>수정</summary>
                    <form key={`${employee.name}-${employee.role}`} onSubmit={(event) => handleUpdate(event, employee)}>
                      <input type="hidden" name="id" value={employee.id} />
                      <input name="name" defaultValue={employee.name} minLength={2} maxLength={30} aria-label={`${employee.name} 이름`} required />
                      <select name="role" defaultValue={employee.role} aria-label={`${employee.name} 담당 업무`}>{roles.map((role) => <option key={role}>{role}</option>)}</select>
                      <button disabled={!connected || pending}>{pending ? "저장 중…" : "저장"}</button>
                      <button type="button" className="ghost" disabled={!connected || pending} onClick={() => handleToggle(employee)}>{employee.active ? "비활성" : "활성"}</button>
                    </form>
                  </details>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
