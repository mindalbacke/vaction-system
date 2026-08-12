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

function setNotice(message, type = "") {
  elements.notice.textContent = message;
  elements.notice.className = `notice ${type}`.trim();
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
  const tabs = await chrome.tabs.query({ url: "https://insa.mbc.co.kr/*" });
  return tabs.find((tab) => tab.active) || tabs[0] || null;
}

async function sendToHrFrames(message) {
  const tab = await findHrTab();
  if (!tab?.id) throw new Error("인사정보 탭을 먼저 열어 주세요.");
  const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
  const responses = [];
  for (const frame of frames || [{ frameId: 0 }]) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, message, { frameId: frame.frameId });
      if (response) responses.push(response);
    } catch { /* 다른 출처의 프레임은 건너뜁니다. */ }
  }
  return { tab, responses };
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
  if (existing?.id) await chrome.tabs.update(existing.id, { active: true });
  else await chrome.tabs.create({ url: "https://insa.mbc.co.kr/index_frame.jsp" });
});

elements.fillLogin.addEventListener("click", async () => {
  try {
    const username = elements.hrUsername.value.trim();
    const password = elements.hrPassword.value;
    if (!username || !password) throw new Error("인사정보 아이디와 비밀번호를 입력해 주세요.");
    const { responses } = await sendToHrFrames({ type: "FILL_LOGIN", username, password });
    elements.hrPassword.value = "";
    if (!responses.some((response) => response.found)) throw new Error("로그인 입력칸을 찾지 못했습니다. 로그인 화면을 열어 주세요.");
    setNotice("로그인칸을 채웠습니다. 로그인 버튼은 직접 눌러 주세요.", "success");
  } catch (error) { elements.hrPassword.value = ""; setNotice(error.message, "error"); }
});

elements.readHr.addEventListener("click", async () => {
  try {
    const { responses } = await sendToHrFrames({ type: "READ_HR" });
    const balance = responses.find((response) => response.found);
    if (!balance) throw new Error("잔여량을 찾지 못했습니다. 휴가사용현황 화면을 열어 주세요.");
    const historyText = responses.map((response) => response.historyText || "").join(" ");
    state.hrSnapshot = { annualRemaining: balance.annualRemaining, substituteRemaining: balance.substituteRemaining, syncedAt: new Date().toISOString() };
    state.applications = reconcileApplications(state.applications, state.halfDays, historyText);
    await saveLocal();
    render();
    setNotice(`공식 연차 잔여량 ${balance.annualRemaining}일을 확인했습니다.`, "success");
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
    setNotice("준비되었습니다. 본인 이름과 PIN으로 반차를 불러오세요.");
  } catch (error) { setNotice(error.message, "error"); }
}

initialize();
