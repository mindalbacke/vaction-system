"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveAudioRotation } from "@/app/manage-actions";

type AudioRotationEmployee = {
  id: string; name: string; shift: string; shiftStart: string; shiftEnd: string;
  rotationStartDate?: string; rotationStartShift?: "A" | "U";
};

export function AudioRotationForm({ employee, connected }: { employee: AudioRotationEmployee; connected: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setMessage(null);
    startTransition(async () => {
      try {
        await saveAudioRotation(data);
        setMessage({ ok: true, text: "저장되었습니다." });
        router.refresh();
      } catch (error) {
        console.error("Audio rotation save failed", error);
        setMessage({ ok: false, text: "저장하지 못했습니다. 다시 시도해 주세요." });
      }
    });
  }

  return (
    <form onSubmit={submit}>
      <input type="hidden" name="employeeId" value={employee.id} />
      <div className="rotation-person"><b>{employee.name}</b><span>현재 {employee.shift} · {employee.shiftStart}–{employee.shiftEnd}</span></div>
      <label>기준 시작일<input type="date" name="startDate" defaultValue={employee.rotationStartDate ?? "2026-08-03"} required /></label>
      <label>시작 근무<select name="startShift" defaultValue={employee.rotationStartShift ?? (employee.shift === "U" ? "U" : "A")}><option value="A">A · 09:00–18:00</option><option value="U">U · 16:00–01:00</option></select></label>
      <div className="rotation-save"><button disabled={!connected || pending}>{pending ? "저장 중" : "저장"}</button>{message ? <small className={message.ok ? "save-success" : "save-error"} role="status">{message.text}</small> : null}</div>
    </form>
  );
}
