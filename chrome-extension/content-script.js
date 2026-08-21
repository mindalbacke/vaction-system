/* global chrome */
(() => {
  const contentVersion = "0.4.2";
  if (globalThis.__halfdayHelperContentScriptLoaded === contentVersion) return;
  globalThis.__halfdayHelperContentScriptLoaded = contentVersion;

  const text = (element) => (element?.textContent || "").replace(/\s+/g, " ").trim();

  function setValue(element, value) {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value");
    if (descriptor?.set) descriptor.set.call(element, value);
    else element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.style.outline = "3px solid #de6d58";
    element.style.outlineOffset = "2px";
  }

  function rowInputs(label) {
    const candidates = [...document.querySelectorAll("tr, li, div")]
      .filter((element) => text(element).includes(label))
      .sort((a, b) => text(a).length - text(b).length);
    for (const candidate of candidates) {
      const inputs = [...candidate.querySelectorAll("input:not([type=hidden]), textarea, select")];
      if (inputs.length) return inputs;
    }
    return [];
  }

  function numberFromCell(value) {
    const match = String(value ?? "").replaceAll(",", "").match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  function compactBalance(bodyText, label) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = bodyText.match(new RegExp(`${escaped}\\s*(\\d+(?:\\.\\d+)?)\\s*\\/\\s*(\\d+(?:\\.\\d+)?)`));
    if (!match) return null;
    const remaining = Number(match[1]);
    const total = Number(match[2]);
    return { total, used: Math.max(0, total - remaining), registered: null, remaining };
  }

  function tableBalance(headers, rows, label) {
    const index = headers.findIndex((value) => value.includes(label));
    if (index < 0) return null;
    return {
      total: numberFromCell(rows.base?.[index]),
      used: numberFromCell(rows.used?.[index]),
      registered: numberFromCell(rows.registered?.[index]),
      remaining: numberFromCell(rows.remaining?.[index]),
    };
  }

  function normalizedDate(value) {
    const match = String(value ?? "").match(/\d{4}[.-]\d{2}[.-]\d{2}/);
    return match ? match[0].replaceAll(".", "-") : null;
  }

  function readVacationHistory() {
    const records = new Map();
    for (const table of document.querySelectorAll("table")) {
      const rows = [...table.querySelectorAll("tr")];
      const headerIndex = rows.findIndex((row) => {
        const value = text(row);
        return value.includes("휴가유형") && value.includes("시작일") && value.includes("종료일");
      });
      if (headerIndex < 0) continue;
      const headers = [...rows[headerIndex].cells].map(text);
      const typeIndex = headers.findIndex((value) => value.includes("휴가유형"));
      const startIndex = headers.findIndex((value) => value.includes("시작일"));
      const endIndex = headers.findIndex((value) => value.includes("종료일"));
      if (typeIndex < 0 || startIndex < 0 || endIndex < 0) continue;
      for (const row of rows.slice(headerIndex + 1)) {
        const cells = [...row.cells].map(text);
        const startDate = normalizedDate(cells[startIndex]);
        const endDate = normalizedDate(cells[endIndex]);
        const leaveType = cells[typeIndex];
        if (!startDate || !endDate || !leaveType || leaveType.includes("휴가유형")) continue;
        const days = numberFromCell(cells[endIndex + 1]);
        const key = `${leaveType}|${startDate}|${endDate}|${days ?? ""}`;
        records.set(key, { leaveType, startDate, endDate, days });
      }
    }
    return [...records.values()].sort((a, b) => b.startDate.localeCompare(a.startDate));
  }

  function refreshHrBalance() {
    const controls = [...document.querySelectorAll("button, input[type=button], input[type=submit], a")];
    const target = controls.find((element) => text(element) === "조회" || String(element.value || "").trim() === "조회");
    if (!target) return { found: false };
    target.click();
    return { found: true, message: "인사정보 조회를 실행했습니다." };
  }

  function readBalance() {
    const bodyText = text(document.body);
    const leaveBalances = {
      annual: compactBalance(bodyText, "연차휴가"),
      substitute: compactBalance(bodyText, "대휴"),
    };

    for (const table of document.querySelectorAll("table")) {
      const rows = [...table.querySelectorAll("tr")];
      const header = rows.find((row) => text(row).includes("연차휴가") || text(row).includes("대휴"));
      const base = rows.find((row) => /^기본(?:\s|$)/.test(text(row)));
      const used = rows.find((row) => /^사용(?:\s|$)/.test(text(row)));
      const registered = rows.find((row) => /^등록(?:\s|$)/.test(text(row)));
      const remain = rows.find((row) => /^잔여(?:\s|$)/.test(text(row)));
      if (!header || !remain) continue;
      const headers = [...header.querySelectorAll("th, td")].map(text);
      const values = {
        base: base ? [...base.querySelectorAll("th, td")].map(text) : null,
        used: used ? [...used.querySelectorAll("th, td")].map(text) : null,
        registered: registered ? [...registered.querySelectorAll("th, td")].map(text) : null,
        remaining: [...remain.querySelectorAll("th, td")].map(text),
      };
      leaveBalances.annual = tableBalance(headers, values, "연차휴가") || leaveBalances.annual;
      leaveBalances.substitute = tableBalance(headers, values, "대휴") || leaveBalances.substitute;
    }

    for (const balance of Object.values(leaveBalances)) {
      if (balance && !Number.isFinite(balance.used) && Number.isFinite(balance.total) && Number.isFinite(balance.remaining)) {
        balance.used = Math.max(0, balance.total - balance.remaining);
      }
    }

    const annual = leaveBalances.annual;
    const substitute = leaveBalances.substitute;
    const found = Object.values(leaveBalances).some((balance) => Number.isFinite(balance?.remaining));

    return {
      found,
      leaveBalances,
      annualTotal: Number.isFinite(annual?.total) ? annual.total : null,
      annualUsed: Number.isFinite(annual?.used) ? annual.used : null,
      annualRemaining: Number.isFinite(annual?.remaining) ? annual.remaining : null,
      substituteRemaining: Number.isFinite(substitute?.remaining) ? substitute.remaining : null,
      vacationHistory: readVacationHistory().filter((item) => !String(item.leaveType || "").includes("보건")),
      historyText: bodyText,
      pageTitle: document.title,
    };
  }

  function fillLogin({ username, password }) {
    const passwordInput = [...document.querySelectorAll('input[type="password"]')]
      .find((input) => !input.disabled && input.offsetParent !== null);
    if (!passwordInput) return { found: false };
    const formInputs = passwordInput.form
      ? [...passwordInput.form.querySelectorAll('input:not([type="hidden"]):not([type="password"])')]
      : [];
    const pageInputs = [...document.querySelectorAll('input:not([type="hidden"]):not([type="password"])')];
    const inputs = [...formInputs, ...pageInputs].filter((input, index, list) => (
      list.indexOf(input) === index && !input.disabled && input.offsetParent !== null
    ));
    const usernameInput = inputs.find((input) => input.autocomplete === "username")
      || inputs.find((input) => /user.?id|login.?id|employee|emp|sabun|사번|아이디|^id$/i.test(`${input.name} ${input.id} ${input.placeholder}`))
      || inputs.find((input) => input.type === "text" || input.type === "email");
    if (!usernameInput) return { found: false };
    setValue(usernameInput, username);
    setValue(passwordInput, password);
    passwordInput.scrollIntoView({ behavior: "smooth", block: "center" });
    return { found: true, pageTitle: document.title, origin: window.location.origin };
  }

  function fillApplication({ applicationDate, leaveType: applicationLeaveType = "연차휴가" }) {
    const leaveTypeInputs = rowInputs("휴가종류");
    const leaveType = leaveTypeInputs.find((element) => element.tagName === "SELECT")
      || [...document.querySelectorAll("select")].find((select) => [...select.options].some((option) => text(option).includes("연차휴가")));
    let selectedLeaveType = false;
    if (leaveType) {
      const targetOption = [...leaveType.options].find((option) => text(option).includes(applicationLeaveType));
      if (targetOption) {
        setValue(leaveType, targetOption.value);
        selectedLeaveType = true;
      }
    }

    let dateInputs = rowInputs("휴가기간").filter((element) => element.tagName === "INPUT");
    if (dateInputs.length < 2) {
      dateInputs = [...document.querySelectorAll('input[type="text"]')].filter((input) => /^\d{4}[.-]\d{2}[.-]\d{2}$/.test(input.value));
    }
    const formattedDate = applicationDate.replaceAll("-", ".");
    dateInputs.slice(0, 2).forEach((input) => setValue(input, formattedDate));

    const reasonInputs = rowInputs("휴가사유");
    const reasonInput = reasonInputs.find((element) => element.tagName === "TEXTAREA" || element.tagName === "INPUT");
    if (reasonInput) setValue(reasonInput, "");

    const found = Boolean(leaveType && selectedLeaveType && dateInputs.length >= 2);
    (reasonInput || leaveType || dateInputs[0])?.scrollIntoView({ behavior: "smooth", block: "center" });
    return {
      found,
      fields: { leaveType: selectedLeaveType, dates: dateInputs.length >= 2, reasonCleared: Boolean(reasonInput) },
      message: found
        ? `${applicationLeaveType}와 신청일을 입력하고 휴가 사유를 비웠습니다.`
        : "일부 입력칸을 찾지 못했습니다. 휴가신청 화면인지 확인해 주세요.",
    };
  }

  function openApplicationPage() {
    const controls = [...document.querySelectorAll("a, button, input[type=button], input[type=submit]")];
    const target = controls.find((element) => {
      const value = `${text(element)} ${String(element.value || "")}`.trim();
      return value.includes("파견휴가신청");
    });
    if (!target) return { found: false };
    target.click();
    return { found: true, message: "파견휴가신청 화면을 열었습니다." };
  }

  function submitApplication(application) {
    const filled = fillApplication(application);
    if (!filled.found) return filled;
    const controls = [...document.querySelectorAll("button, input[type=button], input[type=submit], a")];
    const save = controls.find((element) => text(element) === "저장" || String(element.value || "").trim() === "저장");
    if (!save) return { found: false, message: "신청 내용은 입력했지만 저장 버튼을 찾지 못했습니다." };
    save.click();
    return { found: true, submitted: true, message: "인사정보 저장 버튼을 실행했습니다." };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    try {
      if (message.type === "PING_HR_HELPER") sendResponse({ found: true, ready: true, url: window.location.href });
      else if (message.type === "REFRESH_HR") sendResponse(refreshHrBalance());
      else if (message.type === "READ_HR") sendResponse(readBalance());
      else if (message.type === "FILL_LOGIN") sendResponse(fillLogin(message));
      else if (message.type === "FILL_APPLICATION") sendResponse(fillApplication(message.application));
      else if (message.type === "OPEN_APPLICATION_PAGE") sendResponse(openApplicationPage());
      else if (message.type === "SUBMIT_APPLICATION") sendResponse(submitApplication(message.application));
    } catch (error) {
      sendResponse({ found: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  });

  const publishSnapshot = () => {
    const snapshot = readBalance();
    if (snapshot.found) chrome.runtime.sendMessage({ type: "HR_SNAPSHOT", snapshot }).catch(() => {});
  };
  window.setTimeout(publishSnapshot, 1200);
  window.setTimeout(publishSnapshot, 3500);
})();
