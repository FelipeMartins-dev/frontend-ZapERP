import React from "react";
import ReactDOM from "react-dom/client";
import AppRoutes from "./routes/AppRoutes";
import ErrorBoundary from "./components/ErrorBoundary";
import { useAuthStore } from "./auth/authStore";
import { initPushSubscriptionLifecycle } from "./push/pushSubscriptionLifecycle";
import { initServiceWorkerBridge } from "./push/swBridge";
import { initNativeFcmBridge } from "./push/nativeFcmBridge";
import { initMicStreamLifecycle } from "./media/micStreamService";
import "./styles/theme.css";
import "./styles/app.css";

useAuthStore.getState().restore();

initNativeFcmBridge();

function applyTheme() {
  const saved = localStorage.getItem("theme");
  const fallback =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)")?.matches
      ? "dark"
      : "light";
  document.documentElement.setAttribute("data-theme", saved || fallback);
}

applyTheme();
initServiceWorkerBridge();
initMicStreamLifecycle();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AppRoutes />
    </ErrorBoundary>
  </React.StrictMode>
);

if (import.meta.env.PROD && typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/service-worker.js", { scope: "/" })
      .then(() => initPushSubscriptionLifecycle())
      .catch(() => {});
  });
}
