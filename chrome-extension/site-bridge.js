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
    }
  });

  window.postMessage({ source: "halfday-extension", type: "HALFDAY_HELPER_READY" }, allowedOrigin);
})();
