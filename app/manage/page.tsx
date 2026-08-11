import { ChevronLeft, Repeat2, Users } from "lucide-react";
import Link from "next/link";
import { AudioRotationForm } from "@/app/manage/audio-rotation-form";
import { EmployeeManager } from "@/app/manage/employee-manager";
import { ThemeToggle } from "@/app/theme-toggle";
import { isDatabaseConfigured } from "@/lib/db";
import { getManagedEmployees } from "@/lib/manage-repository";
import { getDashboardSnapshot } from "@/lib/repository";

export const dynamic = "force-dynamic";

function todayInKorea() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

export default async function ManagePage() {
  const date = todayInKorea();
  const [employees, snapshot] = await Promise.all([getManagedEmployees(), getDashboardSnapshot(date)]);
  const audioEmployees = snapshot.employees.filter((employee) => employee.role === "음향보조");

  return (
    <main className="simple-shell manage-simple-shell">
      <header className="simple-header">
        <Link className="back-link" href="/"><ChevronLeft size={20} /> 반차관리로 돌아가기</Link>
        <div className="header-actions"><ThemeToggle /><span className={isDatabaseConfigured() ? "connection-pill connected" : "connection-pill"}>
          {isDatabaseConfigured() ? "Neon 연결됨" : "데모 모드"}
        </span></div>
      </header>

      <section className="simple-card rotation-card">
        <div className="simple-section-title">
          <span className="title-icon green"><Repeat2 size={24} /></span>
          <div><h1>근무 시간</h1><p>매일 입력하지 않아도 역할과 2주 교대 규칙으로 자동 계산됩니다.</p></div>
        </div>
        <div className="fixed-rule-row">
          <span><b>서무·중계보조</b>09:00–18:00 고정</span>
          <span><b>조명보조</b>13:00–21:00 고정</span>
          <span><b>음향보조</b>A/U 14일 자동 교대</span>
        </div>
        <div className="audio-rotation-settings">
          <div className="rotation-settings-head"><h2>음향 교대 기준 등록</h2><p>기준일부터 14일간 선택한 근무를 하고, 다음 14일은 반대 근무로 자동 전환됩니다.</p></div>
          {audioEmployees.map((employee) => (
            <AudioRotationForm employee={employee} connected={isDatabaseConfigured()} key={employee.id} />
          ))}
        </div>
        <div className="rotation-preview">
          {snapshot.employees.map((employee) => (
            <article key={employee.id}>
              <div><b>{employee.name}</b><span>{employee.role}</span></div>
              <strong>{employee.shift}</strong><time>{employee.shiftStart}–{employee.shiftEnd}</time>
            </article>
          ))}
        </div>
      </section>

      <div className="people-title"><Users size={25} /><div><h2>직원 관리</h2><p>이름과 역할만 등록하면 근무 시간이 자동 적용됩니다.</p></div></div>
      <EmployeeManager initialEmployees={employees} connected={isDatabaseConfigured()} />
    </main>
  );
}
