export const DEFAULT_SITE_URL = "https://teum-half-day.halfday-ops.workers.dev";

export function formatKoreanDate(date) {
  return String(date).replaceAll("-", ".");
}

export function makePairId(firstId, secondId) {
  return [firstId, secondId].sort().join("--");
}

export function makeApplication(halfDays) {
  if (!Array.isArray(halfDays) || halfDays.length !== 2) {
    throw new Error("반차를 정확히 두 건 선택해 주세요.");
  }
  const ordered = [...halfDays].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const marker = ordered.map((item) => item.id.slice(0, 6)).join("+");
  const details = ordered.map((item) => `${formatKoreanDate(item.date).slice(5)} ${item.part}`).join(" / ");
  return {
    id: makePairId(ordered[0].id, ordered[1].id),
    halfDayIds: ordered.map((item) => item.id),
    applicationDate: ordered[0].date,
    reason: `파견직 반차 대체 신청(${details}) [반차관리:${marker}]`,
    marker: `[반차관리:${marker}]`,
    status: "ready",
    createdAt: new Date().toISOString(),
  };
}

export function reconcileApplications(applications, halfDays, historyText = "") {
  const currentIds = new Set(halfDays.map((item) => item.id));
  return applications.map((application) => {
    if (application.halfDayIds.some((id) => !currentIds.has(id))) {
      return { ...application, status: "needs-review" };
    }
    if (application.marker && historyText.includes(application.marker)) {
      return { ...application, status: "confirmed", confirmedAt: new Date().toISOString() };
    }
    return application;
  });
}

export function getPendingSummary(halfDays, applications) {
  const confirmedIds = new Set(
    applications.filter((item) => item.status === "confirmed").flatMap((item) => item.halfDayIds),
  );
  const pendingCount = halfDays.filter((item) => !confirmedIds.has(item.id)).length;
  return { pendingCount, pendingDays: pendingCount * 0.5 };
}

export function getSelectableHalfDays(halfDays, applications) {
  const reservedIds = new Set(
    applications.filter((item) => item.status !== "needs-review").flatMap((item) => item.halfDayIds),
  );
  return halfDays.filter((item) => !reservedIds.has(item.id));
}
