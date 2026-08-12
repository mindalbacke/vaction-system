"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const REFRESH_INTERVAL = 60_000;

export function BoardAutoRefresh({ context = "반차 현황" }: { context?: string }) {
  const router = useRouter();

  useEffect(() => {
    const refresh = () => router.refresh();
    const timer = window.setInterval(refresh, REFRESH_INTERVAL);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [router]);

  return <span className="auto-refresh-status" title={`60초마다 최신 ${context}을 불러옵니다.`}><i aria-hidden="true" /> 1분 자동 갱신</span>;
}
