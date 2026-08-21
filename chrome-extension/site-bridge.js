/* global chrome */
(() => {
  const allowedOrigin = window.location.origin;

  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.origin !== allowedOrigin || event.data?.source !== "halfday-site") return;

    if (event.data.type === "HALFDAY_HELPER_OPEN") {
      await chrome.runtime.sendMessage({ type: "OPEN_HELPER" });
      return;
    }

    if (event.data.type === "HALFDAY_HELPER_REQUEST") {
      const snapshot = await chrome.runtime.sendMessage({ type: "GET_SITE_SNAPSHOT" });
      window.postMessage({ source: "halfday-extension", type: "HALFDAY_HELPER_SNAPSHOT", snapshot }, allowedOrigin);
      return;
    }

    if (event.data.type === "HALFDAY_HELPER_SUBMIT") {
      const result = await chrome.runtime.sendMessage({ type: "SUBMIT_APPLICATION", applicationId: event.data.applicationId });
      window.postMessage({
        source: "halfday-extension",
        type: "HALFDAY_HELPER_SUBMIT_RESULT",
        requestId: event.data.requestId,
        result,
      }, allowedOrigin);
      return;
    }

    if (["HALFDAY_HELPER_UPDATE_APPLICATION", "HALFDAY_HELPER_CANCEL_APPLICATION", "HALFDAY_HELPER_CONFIRM_APPLICATION"].includes(event.data.type)) {
      const messageType = event.data.type === "HALFDAY_HELPER_UPDATE_APPLICATION"
        ? "UPDATE_APPLICATION"
        : event.data.type === "HALFDAY_HELPER_CONFIRM_APPLICATION" ? "CONFIRM_APPLICATION" : "CANCEL_APPLICATION";
      const result = await chrome.runtime.sendMessage({
        type: messageType,
        applicationId: event.data.applicationId,
        leaveType: event.data.leaveType,
      });
      window.postMessage({
        source: "halfday-extension",
        type: "HALFDAY_HELPER_MUTATION_RESULT",
        requestId: event.data.requestId,
        result,
      }, allowedOrigin);
    }
  });

  window.postMessage({ source: "halfday-extension", type: "HALFDAY_HELPER_READY" }, allowedOrigin);
})();
