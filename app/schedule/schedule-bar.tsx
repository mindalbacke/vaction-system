"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { saveScheduleEmployeeColors, type ScheduleActionState } from "@/app/schedule-actions";

const initialState: ScheduleActionState = { status: "idle", message: "" };

export function ScheduleBar({ employeeId, employeeName, color, className, text, title, variant = "employee" }: {
  employeeId: string; employeeName: string; color: number; className: string; text: string; title: string; variant?: "employee" | "rotation";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selectedColor, setSelectedColor] = useState(color);
  const [state, action, pending] = useActionState(saveScheduleEmployeeColors, initialState);

  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state.status]);

  const colorClass = variant === "rotation" ? `schedule-rotation-color-${color % 4}` : `schedule-color-${color}`;
  if (variant === "rotation") {
    return <span className={`${className} schedule-rotation-bar ${colorClass}`} title={title}>{text}</span>;
  }

  return (
    <>
      <button type="button" className={`${className} ${colorClass}`} title={`${title} · 눌러서 색상 변경`} onClick={() => setOpen(true)}>{text}</button>
      {open ? (
        <div className="entry-editor-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
          <section className="entry-editor schedule-bar-color-dialog" role="dialog" aria-modal="true" aria-labelledby={`schedule-color-${employeeId}`} onMouseDown={(event) => event.stopPropagation()}>
            <header><div><b id={`schedule-color-${employeeId}`}>근무자 색상 변경</b><span>{employeeName}</span></div><button type="button" className="entry-editor-close" onClick={() => setOpen(false)} aria-label="닫기">×</button></header>
            <form action={action} className="schedule-bar-color-form">
              <input type="hidden" name="colors" value={`${employeeId}:${selectedColor}`} />
              <div className="schedule-color-palette">
                {Array.from({ length: 12 }, (_, nextColor) => <button type="button" className={`schedule-color-choice schedule-color-${nextColor}${selectedColor === nextColor ? " selected" : ""}`} aria-label={`색상 ${nextColor + 1}`} aria-pressed={selectedColor === nextColor} onClick={() => setSelectedColor(nextColor)} key={nextColor} />)}
              </div>
              <button className="entry-save-button" disabled={pending}>{pending ? "저장 중…" : "이 색상으로 저장"}</button>
            </form>
            {state.status !== "idle" ? <p className={`form-feedback ${state.status}`} role="status">{state.message}</p> : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
