/* global chrome */
(() => {
  if (globalThis.__halfdayHelperContentScriptLoaded) return;
  globalThis.__halfdayHelperContentScriptLoaded = true;

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

  function readBalance() {
    let annualTotal = null;
    let annualUsed = null;
    let annualRemaining = null;
    let substituteRemaining = null;
    const bodyText = text(document.body);
    const compactAnnual = bodyText.match(/연차휴가\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
    if (compactAnnual) {
      annualRemaining = Number(compactAnnual[1]);
      annualTotal = Number(compactAnnual[2]);
      annualUsed = Math.max(0, annualTotal - annualRemaining);
    }

    for (const table of document.querySelectorAll("table")) {
      const rows = [...table.querySelectorAll("tr")];
      const header = rows.find((row) => text(row).includes("연차휴가") && text(row).includes("대휴"));
      const base = rows.find((row) => /^기본(?:\s|$)/.test(text(row)));
      const used = rows.find((row) => /^사용(?:\s|$)/.test(text(row)));
      const remain = rows.find((row) => /^잔여(?:\s|$)/.test(text(row)));
      if (!header || !remain) continue;
      const headers = [...header.querySelectorAll("th, td")].map(text);
      const baseValues = base ? [...base.querySelectorAll("th, td")].map(text) : [];
      const usedValues = used ? [...used.querySelectorAll("th, td")].map(text) : [];
      const values = [...remain.querySelectorAll("th, td")].map(text);
      const annualIndex = headers.findIndex((value) => value.includes("연차휴가"));
      const substituteIndex = headers.findIndex((value) => value.includes("대휴"));
      if (annualIndex >= 0 && baseValues[annualIndex] !== undefined) annualTotal = Number(baseValues[annualIndex]);
      if (annualIndex >= 0 && usedValues[annualIndex] !== undefined) annualUsed = Number(usedValues[annualIndex]);
      if (annualIndex >= 0 && values[annualIndex] !== undefined) annualRemaining = Number(values[annualIndex]);
      if (substituteIndex >= 0 && values[substituteIndex] !== undefined) substituteRemaining = Number(values[substituteIndex]);
    }

    if (!Number.isFinite(annualUsed) && Number.isFinite(annualTotal) && Number.isFinite(annualRemaining)) {
      annualUsed = Math.max(0, annualTotal - annualRemaining);
    }

    return {
      found: annualRemaining !== null && Number.isFinite(annualRemaining),
      annualTotal: Number.isFinite(annualTotal) ? annualTotal : null,
      annualUsed: Number.isFinite(annualUsed) ? annualUsed : null,
      annualRemaining,
      substituteRemaining: Number.isFinite(substituteRemaining) ? substituteRemaining : null,
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

  function fillApplication({ applicationDate, reason }) {
    const leaveTypeInputs = rowInputs("휴가종류");
    const leaveType = leaveTypeInputs.find((element) => element.tagName === "SELECT")
      || [...document.querySelectorAll("select")].find((select) => [...select.options].some((option) => text(option).includes("연차휴가")));
    if (leaveType) {
      const annualOption = [...leaveType.options].find((option) => text(option).includes("연차휴가"));
      if (annualOption) setValue(leaveType, annualOption.value);
    }

    let dateInputs = rowInputs("휴가기간").filter((element) => element.tagName === "INPUT");
    if (dateInputs.length < 2) {
      dateInputs = [...document.querySelectorAll('input[type="text"]')].filter((input) => /^\d{4}[.-]\d{2}[.-]\d{2}$/.test(input.value));
    }
    const formattedDate = applicationDate.replaceAll("-", ".");
    dateInputs.slice(0, 2).forEach((input) => setValue(input, formattedDate));

    const reasonInputs = rowInputs("휴가사유");
    const reasonInput = reasonInputs.find((element) => element.tagName === "TEXTAREA" || element.tagName === "INPUT");
    if (reasonInput) setValue(reasonInput, reason);

    const found = Boolean(leaveType && dateInputs.length >= 2 && reasonInput);
    (reasonInput || leaveType || dateInputs[0])?.scrollIntoView({ behavior: "smooth", block: "center" });
    return {
      found,
      fields: { leaveType: Boolean(leaveType), dates: dateInputs.length >= 2, reason: Boolean(reasonInput) },
      message: found
        ? "신청 내용을 입력했습니다. 날짜와 사유를 확인한 뒤 저장 버튼은 직접 눌러 주세요."
        : "일부 입력칸을 찾지 못했습니다. 휴가신청 화면인지 확인해 주세요.",
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    try {
      if (message.type === "PING_HR_HELPER") sendResponse({ found: true, ready: true, url: window.location.href });
      else if (message.type === "READ_HR") sendResponse(readBalance());
      else if (message.type === "FILL_LOGIN") sendResponse(fillLogin(message));
      else if (message.type === "FILL_APPLICATION") sendResponse(fillApplication(message.application));
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
