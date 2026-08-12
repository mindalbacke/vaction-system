/* global chrome */
import { reconcileApplications } from "./shared.js";

chrome.runtime.onMessage.addListener((message) => {
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
        annualRemaining: message.snapshot.annualRemaining,
        substituteRemaining: message.snapshot.substituteRemaining,
        syncedAt: new Date().toISOString(),
      },
    });
  })();
});
