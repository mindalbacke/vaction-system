/* global chrome */
import {
  DEFAULT_SITE_URL,
  getPendingSummary,
  getSelectableHalfDays,
  makeApplication,
  reconcileApplications,
} from "./shared.js";

const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.id, element]));
let state = { settings: { siteUrl: DEFAULT_SITE_URL, employeeId: "" }, halfDays: [], applications: [], hrSnapshot: null };
let feedbackTimer = null;

function setNotice(message, type = "", anchor = null) {
  const bubble = elements.feedbackBubble;
  const target = anchor || (document.activeElement instanceof HTMLElement && document.activeElement !== document.body
    ? document.activeElement
    : elements.readHr);
  if (!message || !target) {
    bubble.hidden = true;
    return;
  }
  bubble.textContent = message;
  bubble.className = `feedback-bubble ${type}`.trim();
  bubble.hidden = false;
  const targetRect = target.getBoundingClientRect();
  const bubbleRect = bubble.getBoundingClientRect();
  const left = Math.max(8, Math.min(window.innerWidth - bubbleRect.width - 8, targetRect.left));
  let top = targetRect.bottom + window.scrollY + 9;
  if (targetRect.bottom + bubbleRect.height + 18 > window.innerHeight) {
    top = targetRect.top + window.scrollY - bubbleRect.height - 9;
    bubble.classList.add("above");
  }
  bubble.style.left = `${left}px`;
  bubble.style.top = `${top}px`;
  bubble.style.setProperty("--arrow-left", `${Math.max(12, Math.min(bubbleRect.width - 18, targetRect.left - left + 18))}px`);
  if (feedbackTimer) window.clearTimeout(feedbackTimer);
  feedbackTimer = window.setTimeout(() => { bubble.hidden = true; }, type === "error" ? 8000 : 5000);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" }).format(new Date(`${value}T00:00:00+09:00`));
}

function statusLabel(status) {
  return ({ ready: "신청 준비", filled: "입력 완료", confirmed: "신청 확인", "needs-review": "확인 필요" })[status] || status;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

async function saveLocal() {
  await chrome.storage.local.set({
    halfDayHelperSettings: state.settings,
    halfDayHelperHalfDays: state.halfDays,
    halfDayHelperApplications: state.applications,
    halfDayHelperHrSnapshot: state.hrSnapshot,
  });
}

function render() {
  elements.siteUrl.value = state.settings.siteUrl;
  if (state.settings.employeeId) elements.employee.value = state.settings.employeeId;
  const selectable = getSelectableHalfDays(state.halfDays, state.applications);
  elements.halfDayList.className = `list${selectable.length ? "" : " empty"}`;
  elements.halfDayList.innerHTML = selectable.length ? selectable.map((item) => `
    <label class="half-day">
      <input type="checkbox" value="${escapeHtml(item.id)}">
      <span><b>${escapeHtml(formatDate(item.date))}</b><em>${escapeHtml(item.part)}</em></span>
    </label>`).join("") : "묶을 수 있는 반차가 없습니다.";

  elements.applicationList.className = `list${state.applications.length ? "" : " empty"}`;
  elements.applicationList.innerHTML = state.applications.length ? [...state.applications].reverse().map((item) => `
    <article class="application" data-id="${escapeHtml(item.id)}">
      <div class="application-head"><b>${escapeHtml(formatDate(item.applicationDate))} · 휴가 1일</b><span class="status ${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status))}</span></div>
      <p>${escapeHtml(item.reason)}</p>
      <div class="application-actions">
        <button data-action="fill" ${item.status === "confirmed" || item.status === "needs-review" ? "disabled" : ""}>신청 화면 채우기</button>
        <button data-action="confirm" class="primary" ${item.status === "confirmed" || item.status === "needs-review" ? "disabled" : ""}>신청 확인됨</button>
      </div>
    </article>`).join("") : "아직 묶은 반차가 없습니다.";

  const pending = getPendingSummary(state.halfDays, state.applications);
  elements.pendingBalance.textContent = `${pending.pendingCount}건 (${pending.pendingDays}일)`;
  const official = state.hrSnapshot?.annualRemaining;
  const officialUsed = state.hrSnapshot?.annualUsed;
  elements.officialUsed.textContent = Number.isFinite(officialUsed) ? `${officialUsed}일` : "-";
  elements.officialBalance.textContent = Number.isFinite(official) ? `${official}일` : "-";
  elements.availableBalance.textContent = Number.isFinite(official) ? `${Math.max(0, official - pending.pendingDays)}일` : "-";
  elements.hrSyncedAt.textContent = state.hrSnapshot?.syncedAt
    ? `마지막 인사정보 확인: ${new Date(state.hrSnapshot.syncedAt).toLocaleString("ko-KR")}`
    : "인사정보 휴가사용현황 화면에서 확인 버튼을 눌러 주세요.";
}

async function loadEmployees() {
  const response = await fetch(`${state.settings.siteUrl}/api/extension/half-days`, { cache: "no-store" });
  if (!response.ok) throw new Error("직원 목록을 불러오지 못했습니다.");
  const data = await response.json();
  elements.employee.innerHTML = '<option value="">이름을 선택하세요</option>' + data.employees
    .map((employee) => `<option value="${escapeHtml(employee.id)}">${escapeHtml(employee.name)} · ${escapeHtml(employee.role)}</option>`).join("");
  elements.employee.value = state.settings.employeeId || "";
}

async function findHrTab() {
  const tabs = await chrome.tabs.query({ url: ["https://insa.mbc.co.kr/*", "https://*.mbc.co.kr/*"] });
  return tabs.find((tab) => tab.active)
    || tabs.find((tab) => /로그인|login|sign.?in/i.test(`${tab.title} ${tab.url}`))
    || tabs.at(-1)
    || null;
}

async function focusTab(tab) {
  if (!tab?.id) return;
  if (typeof tab.windowId === "number") await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.update(tab.id, { active: true });
}

async function waitForTabReady(tabId, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      window.clearInterval(poll);
      chrome.tabs.onUpdated.removeListener(listener);
      callback(value);
    };
    const check = async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === "complete") finish(resolve, tab);
      } catch {
        finish(reject, new Error("인사정보 탭이 닫혔습니다. 다시 시도해 주세요."));
      }
    };
    const timeout = window.setTimeout(() => {
      finish(reject, new Error("인사정보 로그인 화면 로딩 시간이 초과됐습니다. 다시 시도해 주세요."));
    }, timeoutMs);
    const poll = window.setInterval(check, 300);
    const listener = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      finish(resolve, tab);
    };
    chrome.tabs.onUpdated.addListener(listener);
    void check();
  });
}

async function sendMessageToHrFrames(tab, message) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
  const responses = [];
  for (const frame of frames || [{ frameId: 0 }]) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, message, { frameId: frame.frameId });
      if (response) responses.push(response);
    } catch { /* 아직 연결되지 않았거나 다른 출처인 프레임은 건너뜁니다. */ }
  }
  return responses;
}

async function injectHrContentScript(tab) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
  let injected = 0;
  for (const frame of frames || [{ frameId: 0, url: tab.url }]) {
    try {
      const url = new URL(frame.url || tab.url || "");
      if (url.hostname !== "mbc.co.kr" && !url.hostname.endsWith(".mbc.co.kr")) continue;
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [frame.frameId] },
        files: ["content-script.js"],
      });
      injected += 1;
    } catch { /* 접근 가능한 인사정보 프레임만 연결합니다. */ }
  }
  return injected;
}

async function sendToHrFrames(message, preferredTab = null) {
  const tab = preferredTab || await findHrTab();
  if (!tab?.id) throw new Error("인사정보 탭을 먼저 열어 주세요.");
  let responses = await sendMessageToHrFrames(tab, message);
  if (!responses.length) {
    const injected = await injectHrContentScript(tab);
    if (!injected) throw new Error("인사정보 화면에 연결하지 못했습니다. 주소가 insa.mbc.co.kr인지 확인해 주세요.");
    await new Promise((resolve) => setTimeout(resolve, 250));
    responses = await sendMessageToHrFrames(tab, message);
  }
  return { tab, responses };
}

async function sendToHrFramesWithRetry(message, attempts = 4, preferredTab = null) {
  let result = { tab: null, responses: [] };
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    result = await sendToHrFrames(message, preferredTab);
    if (result.responses.some((response) => response.found)) return result;
    if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return result;
}

elements.employee.addEventListener("change", async () => {
  state.settings.employeeId = elements.employee.value;
  state.halfDays = [];
  await saveLocal();
  render();
});

elements.syncHalfDays.addEventListener("click", async () => {
  try {
    const pin = elements.pin.value.trim();
    if (!state.settings.employeeId || !/^\d{4}$/.test(pin)) throw new Error("직원과 숫자 4자리 PIN을 입력해 주세요.");
    const currentYear = new Date().getFullYear();
    const response = await fetch(`${state.settings.siteUrl}/api/extension/half-days`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId: state.settings.employeeId, pin, from: `${currentYear - 1}-01-01`, to: `${currentYear + 1}-12-31` }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "반차 내역을 불러오지 못했습니다.");
    state.halfDays = data.halfDays;
    state.applications = reconcileApplications(state.applications, state.halfDays);
    await chrome.storage.session.set({ halfDayHelperPin: pin });
    await saveLocal();
    render();
    setNotice(`${data.employee.name}님의 반차 ${data.halfDays.length}건을 확인했습니다.`, "success");
  } catch (error) { setNotice(error.message, "error"); }
});

elements.makePair.addEventListener("click", async () => {
  try {
    const selectedIds = [...elements.halfDayList.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
    const selected = state.halfDays.filter((item) => selectedIds.includes(item.id));
    const application = makeApplication(selected);
    if (state.applications.some((item) => item.id === application.id)) throw new Error("이미 묶은 반차 조합입니다.");
    state.applications.push(application);
    await saveLocal();
    render();
    setNotice(`${formatDate(application.applicationDate)}에 휴가 1일로 신청할 준비를 만들었습니다.`, "success");
  } catch (error) { setNotice(error.message, "error"); }
});

elements.openHr.addEventListener("click", async () => {
  const existing = await findHrTab();
  if (existing?.id) await focusTab(existing);
  else await chrome.tabs.create({ url: "https://insa.mbc.co.kr/index_frame.jsp" });
});

elements.fillLogin.addEventListener("click", async () => {
  try {
    const username = elements.hrUsername.value.trim();
    const password = elements.hrPassword.value;
    if (!username || !password) throw new Error("인사정보 아이디와 비밀번호를 입력해 주세요.");
    let hrTab = await findHrTab();
    if (!hrTab) {
      hrTab = await chrome.tabs.create({ url: "https://insa.mbc.co.kr/index_frame.jsp", active: false });
    }
    if (!hrTab.id) throw new Error("인사정보 탭을 만들지 못했습니다.");
    hrTab = await waitForTabReady(hrTab.id);
    const { responses } = await sendToHrFramesWithRetry({ type: "FILL_LOGIN", username, password }, 6, hrTab);
    elements.hrPassword.value = "";
    if (!responses.some((response) => response.found)) throw new Error("로그인 입력칸을 찾지 못했습니다. 로그인 화면을 열어 주세요.");
    setNotice("로그인칸을 채웠습니다. 로그인 버튼은 직접 눌러 주세요.", "success");
    await focusTab(hrTab);
  } catch (error) { elements.hrPassword.value = ""; setNotice(error.message, "error", elements.fillLogin); }
});

elements.readHr.addEventListener("click", async () => {
  try {
    const { responses } = await sendToHrFrames({ type: "READ_HR" });
    const balance = responses.find((response) => response.found);
    if (!balance) {
      const connectedFrames = responses.length;
      throw new Error(connectedFrames
        ? `인사정보 ${connectedFrames}개 화면에는 연결됐지만 휴가사용현황 표를 찾지 못했습니다. 파견휴가신청의 휴가사용현황 화면을 열어 주세요.`
        : "인사정보 화면에 연결하지 못했습니다. 인사정보 탭을 새로고침해 주세요.");
    }
    const historyText = responses.map((response) => response.historyText || "").join(" ");
    state.hrSnapshot = {
      annualTotal: balance.annualTotal,
      annualUsed: balance.annualUsed,
      annualRemaining: balance.annualRemaining,
      substituteRemaining: balance.substituteRemaining,
      syncedAt: new Date().toISOString(),
    };
    state.applications = reconcileApplications(state.applications, state.halfDays, historyText);
    await saveLocal();
    render();
    const usedText = Number.isFinite(balance.annualUsed) ? `사용 ${balance.annualUsed}일, ` : "";
    setNotice(`공식 연차 ${usedText}잔여 ${balance.annualRemaining}일을 확인했습니다.`, "success");
  } catch (error) { setNotice(error.message, "error"); }
});

elements.applicationList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  const article = button?.closest("[data-id]");
  if (!button || !article) return;
  const application = state.applications.find((item) => item.id === article.dataset.id);
  if (!application) return;
  try {
    if (button.dataset.action === "fill") {
      const { responses } = await sendToHrFrames({ type: "FILL_APPLICATION", application });
      const result = responses.find((response) => response.found);
      if (!result) throw new Error("신청 입력칸을 찾지 못했습니다. 파견휴가신청 화면을 열어 주세요.");
      application.status = "filled";
      application.filledAt = new Date().toISOString();
      setNotice(result.message, "success");
    } else if (button.dataset.action === "confirm") {
      application.status = "confirmed";
      application.confirmedAt = new Date().toISOString();
      setNotice("인사정보 신청 확인으로 기록했습니다.", "success");
    }
    await saveLocal();
    render();
  } catch (error) { setNotice(error.message, "error"); }
});

elements.saveSettings.addEventListener("click", async () => {
  try {
    const url = new URL(elements.siteUrl.value.trim());
    state.settings.siteUrl = url.origin;
    await saveLocal();
    await loadEmployees();
    setNotice("반차관리 사이트 주소를 저장했습니다.", "success");
  } catch { setNotice("올바른 사이트 주소를 입력해 주세요.", "error"); }
});

async function initialize() {
  const stored = await chrome.storage.local.get([
    "halfDayHelperSettings", "halfDayHelperHalfDays", "halfDayHelperApplications", "halfDayHelperHrSnapshot",
  ]);
  state.settings = { siteUrl: DEFAULT_SITE_URL, employeeId: "", ...(stored.halfDayHelperSettings || {}) };
  state.halfDays = stored.halfDayHelperHalfDays || [];
  state.applications = stored.halfDayHelperApplications || [];
  state.hrSnapshot = stored.halfDayHelperHrSnapshot || null;
  const session = await chrome.storage.session.get("halfDayHelperPin");
  elements.pin.value = session.halfDayHelperPin || "";
  render();
  try {
    await loadEmployees();
  } catch (error) { setNotice(error.message, "error", elements.employee); }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.halfDayHelperHrSnapshot) return;
  state.hrSnapshot = changes.halfDayHelperHrSnapshot.newValue || null;
  render();
  if (state.hrSnapshot?.annualRemaining !== undefined) {
    setNotice("인사정보 사용·잔여 휴가가 자동으로 반영됐습니다.", "success", elements.readHr);
  }
});

initialize();
