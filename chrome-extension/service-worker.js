/* global chrome */
import { DEFAULT_SITE_URL, makeSiteSnapshot, normalizeApplications, reconcileApplications } from "./shared.js";

const HR_URL = "https://insa.mbc.co.kr/";
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function findHrTab() {
  const tabs = await chrome.tabs.query({ url: "https://insa.mbc.co.kr/*" });
  return tabs.find((tab) => tab.active) || tabs.at(-1) || null;
}

async function waitForTab(tabId, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") return tab;
    await wait(300);
  }
  throw new Error("인사정보 화면 로딩 시간이 초과됐습니다.");
}

async function sendToFrames(tab, message) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
  const responses = [];
  for (const frame of frames || [{ frameId: 0 }]) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, message, { frameId: frame.frameId });
      if (response) responses.push(response);
    } catch { /* 아직 연결되지 않은 프레임은 아래에서 다시 연결합니다. */ }
  }
  return responses;
}

async function injectContentScript(tab) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
  for (const frame of frames || [{ frameId: 0, url: tab.url }]) {
    try {
      const url = new URL(frame.url || tab.url || "");
      if (url.hostname !== "mbc.co.kr" && !url.hostname.endsWith(".mbc.co.kr")) continue;
      await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [frame.frameId] }, files: ["content-script.js"] });
    } catch { /* 접근 가능한 MBC 프레임에만 연결합니다. */ }
  }
}

async function sendWithRetry(tab, message, attempts = 8) {
  let responses = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      responses = await sendToFrames(tab, message);
      if (!responses.length) {
        await injectContentScript(tab);
        await wait(250);
        responses = await sendToFrames(tab, message);
      }
      if (responses.some((response) => response.found)) return responses;
    } catch { /* 화면 전환 중에는 잠시 기다린 뒤 다시 시도합니다. */ }
    if (attempt < attempts - 1) await wait(750);
  }
  return responses;
}

async function syncCloudSnapshot() {
  const stored = await chrome.storage.local.get([
    "halfDayHelperSettings", "halfDayHelperApplications", "halfDayHelperHalfDays", "halfDayHelperHrSnapshot",
  ]);
  const session = await chrome.storage.session.get("halfDayHelperPin");
  const settings = { siteUrl: DEFAULT_SITE_URL, employeeId: "", ...(stored.halfDayHelperSettings || {}) };
  if (!settings.employeeId || !stored.halfDayHelperHrSnapshot || !/^\d{4}$/.test(session.halfDayHelperPin || "")) return;
  const snapshot = makeSiteSnapshot(
    settings,
    stored.halfDayHelperHalfDays || [],
    stored.halfDayHelperApplications || [],
    stored.halfDayHelperHrSnapshot,
  );
  const response = await fetch(`${settings.siteUrl}/api/extension/hr-snapshot`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employeeId: settings.employeeId, pin: session.halfDayHelperPin, snapshot }),
  });
  if (!response.ok) throw new Error("Neon 휴가 정보 동기화에 실패했습니다.");
}

async function submitHrApplication(applicationId) {
  const stored = await chrome.storage.local.get(["halfDayHelperApplications"]);
  const applications = normalizeApplications(stored.halfDayHelperApplications || []);
  const application = applications.find((item) => item.id === applicationId);
  if (!application) throw new Error("신청할 반차 묶음을 찾지 못했습니다.");
  if (application.status === "submitted" || application.status === "confirmed") throw new Error("이미 인사정보에 신청한 기록입니다.");

  let tab = await findHrTab();
  if (!tab) tab = await chrome.tabs.create({ url: HR_URL, active: false });
  if (!tab?.id) throw new Error("인사정보 탭을 만들지 못했습니다.");
  tab = await waitForTab(tab.id);

  let filled = await sendWithRetry(tab, { type: "FILL_APPLICATION", application }, 2);
  if (!filled.some((response) => response.found)) {
    const opened = await sendWithRetry(tab, { type: "OPEN_APPLICATION_PAGE" }, 3);
    if (!opened.some((response) => response.found)) {
      throw new Error("인사정보 로그인 상태 또는 파견휴가신청 메뉴를 확인해 주세요. Chrome에서 한 번 로그인한 뒤 다시 시도해 주세요.");
    }
    await wait(1500);
    filled = await sendWithRetry(tab, { type: "FILL_APPLICATION", application }, 12);
  }
  if (!filled.some((response) => response.found)) throw new Error("파견휴가신청 입력칸을 찾지 못했습니다.");

  const submitted = await sendWithRetry(tab, { type: "SUBMIT_APPLICATION", application }, 3);
  const result = submitted.find((response) => response.submitted);
  if (!result) throw new Error(submitted.find((response) => response.message)?.message || "인사정보 저장 버튼을 찾지 못했습니다.");

  application.status = "submitted";
  application.submittedAt = new Date().toISOString();
  await chrome.storage.local.set({ halfDayHelperApplications: applications });
  await syncCloudSnapshot().catch(() => {});
  return { ok: true, message: "인사정보에 저장 요청을 전송했습니다. 결재 대기 수량을 새로고침해 확인해 주세요." };
}

async function updateApplication(applicationId, leaveType) {
  if (!["연차휴가", "대휴"].includes(leaveType)) throw new Error("휴가 종류를 확인해 주세요.");
  const stored = await chrome.storage.local.get(["halfDayHelperApplications"]);
  const applications = stored.halfDayHelperApplications || [];
  const application = applications.find((item) => item.id === applicationId);
  if (!application) throw new Error("신청 기록을 찾지 못했습니다.");
  if (application.status === "submitted" || application.status === "confirmed") throw new Error("이미 제출한 신청의 휴가 종류는 변경할 수 없습니다.");
  application.leaveType = leaveType;
  application.reason = "";
  await chrome.storage.local.set({ halfDayHelperApplications: applications });
  await syncCloudSnapshot().catch(() => {});
  return { ok: true, message: `${leaveType}로 저장했습니다.` };
}

async function cancelApplication(applicationId) {
  const stored = await chrome.storage.local.get(["halfDayHelperApplications"]);
  const applications = stored.halfDayHelperApplications || [];
  const application = applications.find((item) => item.id === applicationId);
  if (!application) throw new Error("신청 기록을 찾지 못했습니다.");
  const submitted = application.status === "submitted" || application.status === "confirmed";
  await chrome.storage.local.set({ halfDayHelperApplications: applications.filter((item) => item.id !== applicationId) });
  await syncCloudSnapshot().catch(() => {});
  return {
    ok: true,
    message: submitted ? "도우미 기록을 취소했습니다. 인사정보 신청은 별도로 취소해 주세요." : "신청 기록과 반차 묶음을 취소했습니다.",
  };
}

async function confirmApplication(applicationId) {
  const stored = await chrome.storage.local.get(["halfDayHelperApplications"]);
  const applications = stored.halfDayHelperApplications || [];
  const application = applications.find((item) => item.id === applicationId);
  if (!application) throw new Error("신청 기록을 찾지 못했습니다.");
  application.status = "confirmed";
  application.confirmedAt = new Date().toISOString();
  await chrome.storage.local.set({ halfDayHelperApplications: applications });
  await syncCloudSnapshot().catch(() => {});
  return { ok: true, message: "인사정보 신청 확인으로 기록했습니다." };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "OPEN_HELPER") {
    void chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") });
    return;
  }

  if (message.type === "GET_SITE_SNAPSHOT") {
    void (async () => {
      const stored = await chrome.storage.local.get([
        "halfDayHelperSettings", "halfDayHelperApplications", "halfDayHelperHalfDays", "halfDayHelperHrSnapshot",
      ]);
      sendResponse(makeSiteSnapshot(
        stored.halfDayHelperSettings,
        stored.halfDayHelperHalfDays || [],
        stored.halfDayHelperApplications || [],
        stored.halfDayHelperHrSnapshot,
      ));
    })();
    return true;
  }

  if (message.type === "SUBMIT_APPLICATION") {
    void submitHrApplication(message.applicationId)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message.type === "UPDATE_APPLICATION") {
    void updateApplication(message.applicationId, message.leaveType)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message.type === "CANCEL_APPLICATION") {
    void cancelApplication(message.applicationId)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message.type === "CONFIRM_APPLICATION") {
    void confirmApplication(message.applicationId)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message.type !== "HR_SNAPSHOT" || !message.snapshot?.found) return;
  void (async () => {
    const stored = await chrome.storage.local.get([
      "halfDayHelperApplications", "halfDayHelperHalfDays",
    ]);
    const applications = reconcileApplications(
      normalizeApplications(stored.halfDayHelperApplications || []),
      stored.halfDayHelperHalfDays || [],
      message.snapshot.vacationHistory || [],
    );
    await chrome.storage.local.set({
      halfDayHelperApplications: applications,
      halfDayHelperHrSnapshot: {
        leaveBalances: message.snapshot.leaveBalances || null,
        annualTotal: message.snapshot.annualTotal,
        annualUsed: message.snapshot.annualUsed,
        annualRemaining: message.snapshot.annualRemaining,
        substituteRemaining: message.snapshot.substituteRemaining,
        vacationHistory: (message.snapshot.vacationHistory || []).filter((item) => !String(item.leaveType || "").includes("보건")),
        syncedAt: new Date().toISOString(),
      },
    });
    await syncCloudSnapshot().catch(() => {});
  })();
});
