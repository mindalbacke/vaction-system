export const DEFAULT_SITE_URL = "https://teum-half-day.halfday-ops.workers.dev";

export function formatKoreanDate(date) {
  return String(date).replaceAll("-", ".");
}

export function makePairId(firstId, secondId) {
  return [firstId, secondId].sort().join("--");
}

export function normalizeLeaveType(value) {
  return value === "대휴" ? "대휴" : "연차휴가";
}

export function normalizeApplications(applications) {
  return (applications || []).map((item) => ({ ...item, leaveType: normalizeLeaveType(item.leaveType), reason: "" }));
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
    leaveType: "연차휴가",
    halfDaySummary: details,
    reason: "",
    marker: `[반차관리:${marker}]`,
    status: "ready",
    createdAt: new Date().toISOString(),
  };
}

export function reconcileApplications(applications, halfDays, history = "") {
  const currentIds = new Set(halfDays.map((item) => item.id));
  return applications.map((application) => {
    if (application.halfDayIds.some((id) => !currentIds.has(id))) {
      return { ...application, status: "needs-review" };
    }
    const linked = currentLinkedHalfDays(application, halfDays);
    const scheduleUpdate = {
      halfDaySummary: linked.length === application.halfDayIds.length
        ? linked.map((item) => `${formatKoreanDate(item.date).slice(5)} ${item.part}`).join(" / ")
        : application.halfDaySummary || "",
      ...(["ready", "filled"].includes(application.status) && linked.length === application.halfDayIds.length
        ? { applicationDate: linked[0].date }
        : {}),
    };
    const matchedByMarker = typeof history === "string" && application.marker && history.includes(application.marker);
    const matchedByHistory = Array.isArray(history) && history.some((item) => (
      item.startDate === application.applicationDate
      && String(item.leaveType || "").includes(application.leaveType || "연차휴가")
    ));
    if (matchedByMarker || matchedByHistory) {
      return { ...application, ...scheduleUpdate, status: "confirmed", confirmedAt: application.confirmedAt || new Date().toISOString() };
    }
    return { ...application, ...scheduleUpdate };
  });
}

function currentLinkedHalfDays(application, halfDays) {
  return application.halfDayIds
    .map((id) => halfDays.find((item) => item.id === id))
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
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

export function getHalfDayUsageSummary(halfDays) {
  const count = Array.isArray(halfDays) ? halfDays.length : 0;
  return { count, usedDays: count * 0.5 };
}

export function getProjectedLeaveRemaining(officialRemaining, registeredDays, localPendingDays) {
  if (!Number.isFinite(officialRemaining)) return null;
  const registered = Number.isFinite(registeredDays) ? Math.max(0, registeredDays) : 0;
  const localPending = Number.isFinite(localPendingDays) ? Math.max(0, localPendingDays) : 0;
  return Math.max(0, officialRemaining - Math.max(registered, localPending));
}

export function makeSiteSnapshot(settings, halfDays, applications, hrSnapshot) {
  const cleanHrSnapshot = hrSnapshot ? {
    ...hrSnapshot,
    leaveBalances: hrSnapshot.leaveBalances ? {
      annual: hrSnapshot.leaveBalances.annual || null,
      substitute: hrSnapshot.leaveBalances.substitute || null,
    } : null,
    vacationHistory: (hrSnapshot.vacationHistory || []).filter((item) => !String(item.leaveType || "").includes("보건")),
  } : null;
  if (cleanHrSnapshot) delete cleanHrSnapshot.healthRemaining;
  return {
    employeeId: settings?.employeeId || "",
    hrSnapshot: cleanHrSnapshot,
    pending: getPendingSummary(halfDays, applications),
    applicationCounts: {
      ready: applications.filter((item) => item.status === "ready" || item.status === "filled").length,
      submitted: applications.filter((item) => item.status === "submitted").length,
      confirmed: applications.filter((item) => item.status === "confirmed").length,
      needsReview: applications.filter((item) => item.status === "needs-review").length,
    },
    applications: applications.map((item) => ({
      id: item.id,
      applicationDate: item.applicationDate,
      leaveType: normalizeLeaveType(item.leaveType),
      halfDaySummary: item.halfDaySummary || "",
      reason: "",
      status: item.status,
    })),
  };
}
