"use client";

export function ThemeToggle() {
  function toggleTheme() {
    const root = document.documentElement;
    const nextTheme = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = nextTheme;
    localStorage.setItem("halfday-theme", nextTheme);
  }

  return (
    <button className="theme-toggle" type="button" onClick={toggleTheme} aria-label="라이트 모드와 다크 모드 전환">
      <span className="theme-light-icon" aria-hidden="true">☀</span>
      <span className="theme-dark-icon" aria-hidden="true">☾</span>
    </button>
  );
}
