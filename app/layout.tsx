import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "반차관리",
  description: "방송기술팀의 반차와 대근 공백을 한눈에 관리합니다.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <Script id="theme-init" strategy="beforeInteractive">{`
        try {
          var savedTheme = localStorage.getItem('halfday-theme');
          document.documentElement.dataset.theme = savedTheme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        } catch (_) {}
      `}</Script>
      <body>{children}</body>
    </html>
  );
}
