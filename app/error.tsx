"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="error-page">
      <span>!</span>
      <h1>화면을 불러오지 못했어요</h1>
      <p>Neon 연결과 데이터베이스 스키마 적용 여부를 확인해 주세요.</p>
      <button onClick={() => reset()}>다시 시도</button>
    </main>
  );
}
