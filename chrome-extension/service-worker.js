/* global chrome */
import { makeSiteSnapshot, reconcileApplications } from "./shared.js";

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

  if (message.type !== "HR_SNAPSHOT" || !message.snapshot?.found) return;
  void (async () => {
    const stored = await chrome.storage.local.get([
      "halfDayHelperApplications", "halfDayHelperHalfDays",
    ]);
    const applications = reconcileApplications(
      stored.halfDayHelperApplications || [],
      stored.halfDayHelperHalfDays || [],
      message.snapshot.historyText || "",
    );
    await chrome.storage.local.set({
      halfDayHelperApplications: applications,
      halfDayHelperHrSnapshot: {
        annualTotal: message.snapshot.annualTotal,
        annualUsed: message.snapshot.annualUsed,
        annualRemaining: message.snapshot.annualRemaining,
        substituteRemaining: message.snapshot.substituteRemaining,
        syncedAt: new Date().toISOString(),
      },
    });
  })();
});
