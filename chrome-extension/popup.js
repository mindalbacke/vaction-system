/* global chrome */
import {
  DEFAULT_SITE_URL,
  getHalfDayUsageSummary,
  getPendingSummary,
  getProjectedLeaveRemaining,
  getSelectableHalfDays,
  makeApplication,
  makeSiteSnapshot,
  normalizeApplications,
  normalizeLeaveType,
  reconcileApplications,
} from "./shared.js";

const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.id, element]));
const HR_URL = "https://insa.mbc.co.kr/";
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

function formatFullDate(value) {
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" }).format(new Date(`${value}T00:00:00+09:00`));
}

function todayInKorea() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date());
}

function statusLabel(status) {
  return ({ ready: "신청 준비", filled: "입력 완료", submitted: "결재 대기", confirmed: "신청 확인", "needs-review": "확인 필요" })[status] || status;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function legacyBalance(total, used, remaining) {
  return [total, used, remaining].some(Number.isFinite) ? { total, used, registered: null, remaining } : null;
}

function formatBalanceMeta(balance) {
  if (!balance) return "사용량 미확인";
  const details = [];
  if (Number.isFinite(balance.used)) details.push(`사용(결재완료) ${balance.used}일`);
  if (Number.isFinite(balance.registered)) details.push(`결재대기 ${balance.registered}일`);
  if (Number.isFinite(balance.total)) details.push(`기본 ${balance.total}일`);
  return details.join(" · ") || "사용량 미확인";
}

function renderBalance(balance, valueElement, metaElement) {
  valueElement.textContent = Number.isFinite(balance?.remaining) ? `잔여 ${balance.remaining}일` : "미확인";
  metaElement.textContent = formatBalanceMeta(balance);
}

async function saveLocal() {
  await chrome.storage.local.set({
    halfDayHelperSettings: state.settings,
    halfDayHelperHalfDays: state.halfDays,
    halfDayHelperApplications: state.applications,
    halfDayHelperHrSnapshot: state.hrSnapshot,
  });
}

async function syncCloudSnapshot() {
  const pin = (await chrome.storage.session.get("halfDayHelperPin")).halfDayHelperPin || elements.pin.value.trim();
  if (!state.settings.employeeId || !state.hrSnapshot || !/^\d{4}$/.test(pin)) return { ok: false, skipped: true };
  const snapshot = makeSiteSnapshot(state.settings, state.halfDays, state.applications, state.hrSnapshot);
  const response = await fetch(`${state.settings.siteUrl}/api/extension/hr-snapshot`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employeeId: state.settings.employeeId, pin, snapshot }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Neon에 휴가 정보를 동기화하지 못했습니다.");
  return data;
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
      <div class="application-head"><b>${escapeHtml(formatDate(item.applicationDate))} · ${escapeHtml(normalizeLeaveType(item.leaveType))} 1일</b><span class="status ${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status))}</span></div>
      ${item.halfDaySummary ? `<p>묶은 반차: ${escapeHtml(item.halfDaySummary)}</p>` : ""}
      <label class="application-type">신청할 휴가
        <select data-action="leave-type" ${item.status === "submitted" || item.status === "confirmed" ? "disabled" : ""}>
          ${["연차휴가", "대휴"].map((type) => `<option ${type === normalizeLeaveType(item.leaveType) ? "selected" : ""}>${type}</option>`).join("")}
        </select>
      </label>
      <div class="application-actions">
        <button data-action="submit" class="primary" ${item.status === "submitted" || item.status === "confirmed" || item.status === "needs-review" ? "disabled" : ""}>인사정보 신청</button>
        <button data-action="confirm" ${item.status !== "submitted" ? "disabled" : ""}>신청 확인</button>
        <button data-action="cancel" class="danger">신청 취소</button>
      </div>
    </article>`).join("") : "아직 묶은 반차가 없습니다.";

  const halfDayUsage = getHalfDayUsageSummary(state.halfDays);
  const halfDayHistory = [...state.halfDays].sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  elements.halfDayUsageSummary.textContent = `${halfDayUsage.usedDays}일 · ${halfDayUsage.count}건`;
  elements.halfDayHistoryList.className = `list${halfDayHistory.length ? "" : " empty"}`;
  elements.halfDayHistoryList.innerHTML = halfDayHistory.length ? halfDayHistory.map((item) => {
    const application = state.applications.find((entry) => entry.halfDayIds.includes(item.id));
    const applicationStatus = application ? statusLabel(application.status) : "휴가 묶기 전";
    const editable = Boolean(application) && item.date >= todayInKorea();
    const revisions = item.revisions || [];
    return `<article class="history-entry half-day-history" data-id="${escapeHtml(item.id)}">
      <div class="history-entry-main"><b>${escapeHtml(formatFullDate(item.date))}</b><span>${escapeHtml(item.part)} · ${escapeHtml(applicationStatus)}</span></div>
      <strong>0.5일</strong>
      ${application ? `<button data-action="edit-half-day" ${editable ? "" : "disabled"}>${editable ? "일정 수정" : "수정 불가"}</button>` : ""}
      ${revisions.length ? `<div class="revision-list"><b>수정 내역</b>${revisions.map((revision) => `<span>${escapeHtml(formatFullDate(revision.oldDate))} ${escapeHtml(revision.oldPart)} → ${escapeHtml(formatFullDate(revision.newDate))} ${escapeHtml(revision.newPart)}<small>${escapeHtml(new Date(revision.changedAt).toLocaleString("ko-KR"))}</small></span>`).join("")}</div>` : ""}
      ${editable ? `<div class="half-day-edit" hidden>
        <label>새 날짜<input type="date" value="${escapeHtml(item.date)}" min="${todayInKorea()}"></label>
        <label>반차 구분<select><option ${item.part === "전반" ? "selected" : ""}>전반</option><option ${item.part === "후반" ? "selected" : ""}>후반</option></select></label>
        <button data-action="save-half-day" class="primary">저장</button><button data-action="close-half-day">닫기</button>
      </div>` : ""}
    </article>`;
  }).join("") : "사용한 반차 기록이 없습니다.";

  const vacationHistory = [...(state.hrSnapshot?.vacationHistory || [])]
    .filter((item) => !String(item.leaveType || "").includes("보건"))
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
  elements.vacationHistoryCount.textContent = `${vacationHistory.length}건`;
  elements.vacationHistoryList.className = `list${vacationHistory.length ? "" : " empty"}`;
  elements.vacationHistoryList.innerHTML = vacationHistory.length ? vacationHistory.map((item) => {
    const range = item.startDate === item.endDate ? formatFullDate(item.startDate) : `${formatFullDate(item.startDate)}–${formatFullDate(item.endDate)}`;
    const days = Number.isFinite(item.days) ? `${item.days}일` : "일수 미확인";
    return `<article class="history-entry"><b>${escapeHtml(item.leaveType)}</b><span>${escapeHtml(range)}</span><strong>${escapeHtml(days)}</strong></article>`;
  }).join("") : "인사정보에서 확인된 휴가 기록이 없습니다.";

  const pending = getPendingSummary(state.halfDays, state.applications);
  elements.pendingBalance.textContent = `${pending.pendingCount}건 (${pending.pendingDays}일)`;
  const balances = state.hrSnapshot?.leaveBalances;
  const annual = balances?.annual || legacyBalance(state.hrSnapshot?.annualTotal, state.hrSnapshot?.annualUsed, state.hrSnapshot?.annualRemaining);
  const substitute = balances?.substitute || legacyBalance(null, null, state.hrSnapshot?.substituteRemaining);
  const official = annual?.remaining;
  renderBalance(annual, elements.annualBalance, elements.annualBalanceMeta);
  renderBalance(substitute, elements.substituteBalance, elements.substituteBalanceMeta);
  const projectedRemaining = getProjectedLeaveRemaining(official, annual?.registered, pending.pendingDays);
  elements.availableBalance.textContent = Number.isFinite(projectedRemaining) ? `${projectedRemaining}일` : "-";
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
  const tabs = await chrome.tabs.query({ url: "https://insa.mbc.co.kr/*" });
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
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      result = await sendToHrFrames(message, preferredTab);
    } catch (error) {
      lastError = error;
    }
    if (result.responses.some((response) => response.found)) return result;
    if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 750));
  }
  if (lastError && !result.responses.length) throw lastError;
  return result;
}

elements.employee.addEventListener("change", async () => {
  state.settings.employeeId = elements.employee.value;
  state.halfDays = [];
  await saveLocal();
  render();
});

async function refreshHalfDays() {
  try {
    const pin = elements.pin.value.trim();
    if (!state.settings.employeeId || !/^\d{4}$/.test(pin)) throw new Error("직원과 숫자 4자리 PIN을 입력해 주세요.");
    const currentYear = new Date().getFullYear();
    const response = await fetch(`${state.settings.siteUrl}/api/extension/half-days`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId: state.settings.employeeId, pin, from: "2000-01-01", to: `${currentYear + 1}-12-31` }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "반차 내역을 불러오지 못했습니다.");
    state.halfDays = data.halfDays;
    state.applications = reconcileApplications(state.applications, state.halfDays);
    await chrome.storage.session.set({ halfDayHelperPin: pin });
    await saveLocal();
    await syncCloudSnapshot();
    render();
    setNotice(`${data.employee.name}님의 반차 ${data.halfDays.length}건을 확인했습니다.`, "success");
    return true;
  } catch (error) {
    setNotice(error.message, "error");
    return false;
  }
}

elements.syncHalfDays.addEventListener("click", refreshHalfDays);

elements.halfDayHistoryList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  const article = button?.closest("[data-id]");
  if (!button || !article) return;
  const editor = article.querySelector(".half-day-edit");
  if (button.dataset.action === "edit-half-day") {
    if (editor) editor.hidden = false;
    return;
  }
  if (button.dataset.action === "close-half-day") {
    if (editor) editor.hidden = true;
    return;
  }
  if (button.dataset.action !== "save-half-day" || !editor) return;
  try {
    const pin = (await chrome.storage.session.get("halfDayHelperPin")).halfDayHelperPin || elements.pin.value.trim();
    if (!state.settings.employeeId || !/^\d{4}$/.test(pin)) throw new Error("직원과 숫자 4자리 PIN을 확인해 주세요.");
    const newDate = editor.querySelector('input[type="date"]').value;
    const newPart = editor.querySelector("select").value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) throw new Error("새 반차 날짜를 선택해 주세요.");
    if (!window.confirm(`${formatFullDate(newDate)} ${newPart} 반차로 변경할까요?\n인사정보에 승인된 휴가 1일 신청일은 바뀌지 않습니다.`)) return;
    button.disabled = true;
    const response = await fetch(`${state.settings.siteUrl}/api/extension/half-days`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId: state.settings.employeeId, pin, halfDayId: article.dataset.id, newDate, newPart }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "반차 일정을 수정하지 못했습니다.");
    await refreshHalfDays();
    setNotice(data.message, "success", elements.halfDayHistoryList);
  } catch (error) {
    button.disabled = false;
    setNotice(error.message, "error", button);
  }
});

elements.makePair.addEventListener("click", async () => {
  try {
    const selectedIds = [...elements.halfDayList.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
    if (new Set(selectedIds).size !== 2) throw new Error("사이트에서 불러온 반차 중 서로 다른 두 건을 선택해 주세요.");
    const selected = state.halfDays.filter((item) => selectedIds.includes(item.id));
    const application = makeApplication(selected);
    if (state.applications.some((item) => item.id === application.id)) throw new Error("이미 묶은 반차 조합입니다.");
    state.applications.push(application);
    await saveLocal();
    await syncCloudSnapshot();
    render();
    setNotice(`${formatDate(application.applicationDate)}에 휴가 1일로 신청할 준비를 만들었습니다.`, "success");
  } catch (error) { setNotice(error.message, "error"); }
});

elements.openHr.addEventListener("click", async () => {
  const existing = await findHrTab();
  if (existing?.id) await focusTab(existing);
  else await chrome.tabs.create({ url: HR_URL });
});

elements.fillLogin.addEventListener("click", async () => {
  try {
    const username = elements.hrUsername.value.trim();
    const password = elements.hrPassword.value;
    if (!username || !password) throw new Error("인사정보 아이디와 비밀번호를 입력해 주세요.");
    let hrTab = await findHrTab();
    if (!hrTab) {
      hrTab = await chrome.tabs.create({ url: HR_URL, active: false });
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
    let hrTab = await findHrTab();
    if (!hrTab?.id) throw new Error("인사정보 탭을 먼저 열어 주세요.");
    try {
      const refresh = await sendToHrFrames({ type: "REFRESH_HR" }, hrTab);
      if (refresh.responses.some((response) => response.found)) await new Promise((resolve) => setTimeout(resolve, 1200));
    } catch { /* 조회 중 화면이 이동하면 아래 재연결 단계에서 처리합니다. */ }
    hrTab = await chrome.tabs.get(hrTab.id);
    const { responses } = await sendToHrFramesWithRetry({ type: "READ_HR" }, 10, hrTab);
    const balance = responses.find((response) => response.found);
    if (!balance) {
      const connectedFrames = responses.length;
      throw new Error(connectedFrames
        ? `인사정보 ${connectedFrames}개 화면에는 연결됐지만 휴가사용현황 표를 찾지 못했습니다. 파견휴가신청의 휴가사용현황 화면을 열어 주세요.`
        : "인사정보 화면에 연결하지 못했습니다. 인사정보 탭을 새로고침해 주세요.");
    }
    const vacationHistory = balance.vacationHistory || [];
    state.hrSnapshot = {
      leaveBalances: balance.leaveBalances,
      annualTotal: balance.annualTotal,
      annualUsed: balance.annualUsed,
      annualRemaining: balance.annualRemaining,
      substituteRemaining: balance.substituteRemaining,
      vacationHistory: vacationHistory.filter((item) => !String(item.leaveType || "").includes("보건")),
      syncedAt: new Date().toISOString(),
    };
    state.applications = reconcileApplications(state.applications, state.halfDays, vacationHistory);
    await saveLocal();
    await syncCloudSnapshot();
    render();
    const labels = [balance.leaveBalances?.annual && "연차", balance.leaveBalances?.substitute && "대휴"].filter(Boolean);
    setNotice(`${labels.join("·") || "휴가"} 사용·잔여량을 확인했습니다.`, "success");
  } catch (error) { setNotice(error.message, "error"); }
});

elements.applicationList.addEventListener("change", async (event) => {
  const select = event.target.closest('select[data-action="leave-type"]');
  const article = select?.closest("[data-id]");
  if (!select || !article) return;
  const application = state.applications.find((item) => item.id === article.dataset.id);
  if (!application) return;
  application.leaveType = select.value;
  application.reason = "";
  await saveLocal();
  try {
    await syncCloudSnapshot();
    render();
    setNotice(`${application.leaveType}로 신청하도록 저장했습니다.`, "success", select);
  } catch (error) { setNotice(error.message, "error", select); }
});

elements.applicationList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  const article = button?.closest("[data-id]");
  if (!button || !article) return;
  const application = state.applications.find((item) => item.id === article.dataset.id);
  if (!application) return;
  try {
    if (button.dataset.action === "submit") {
      if (!window.confirm(`${application.applicationDate}에 ${application.leaveType || "연차휴가"} 1일을 신청할까요?\n휴가 사유는 빈칸으로 등록됩니다.`)) return;
      const result = await chrome.runtime.sendMessage({ type: "SUBMIT_APPLICATION", applicationId: application.id });
      if (!result?.ok) throw new Error(result?.error || "인사정보에 신청하지 못했습니다.");
      application.status = "submitted";
      application.submittedAt = new Date().toISOString();
      setNotice(result.message, "success", button);
    } else if (button.dataset.action === "confirm") {
      if (!window.confirm("인사정보에 신청된 내용을 확인 완료로 표시할까요?")) return;
      application.status = "confirmed";
      application.confirmedAt = new Date().toISOString();
      setNotice("인사정보 신청 확인으로 기록했습니다.", "success", button);
    } else if (button.dataset.action === "cancel") {
      const submitted = application.status === "submitted" || application.status === "confirmed";
      const warning = submitted
        ? "도우미의 신청 기록과 반차 묶음을 취소합니다. 이미 인사정보에 저장된 신청은 인사정보에서 별도로 취소해야 합니다. 계속할까요?"
        : "신청 기록과 반차 묶음을 취소할까요? 두 반차는 다시 선택할 수 있게 됩니다.";
      if (!window.confirm(warning)) return;
      state.applications = state.applications.filter((item) => item.id !== application.id);
      setNotice(submitted ? "도우미 기록을 취소했습니다. 인사정보 신청은 별도로 취소해 주세요." : "신청 기록을 취소했습니다.", "success", button);
    }
    await saveLocal();
    await syncCloudSnapshot();
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
  state.applications = normalizeApplications(stored.halfDayHelperApplications || []);
  state.hrSnapshot = stored.halfDayHelperHrSnapshot || null;
  const session = await chrome.storage.session.get("halfDayHelperPin");
  elements.pin.value = session.halfDayHelperPin || "";
  render();
  try {
    await loadEmployees();
    if (state.settings.employeeId && session.halfDayHelperPin) elements.syncHalfDays.click();
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
