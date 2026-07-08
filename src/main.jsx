import React from "react";
import ReactDOM from "react-dom/client";
import AppRoutes from "./routes/AppRoutes";
import ErrorBoundary from "./components/ErrorBoundary";
import { useAuthStore } from "./auth/authStore";
import { initPushSubscriptionLifecycle } from "./push/pushSubscriptionLifecycle";
import { initServiceWorkerBridge } from "./push/swBridge";
import { initNativeFcmBridge } from "./push/nativeFcmBridge";
import { initNotificationDiagnostics } from "./push/notificationDiagnostics";
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
initNotificationDiagnostics();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AppRoutes />
    </ErrorBoundary>
  </React.StrictMode>
);

if (import.meta.env.PROD && typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    // updateViaCache: "none" força o navegador a ignorar o cache HTTP ao verificar o SW
    // E os seus importScripts (/sw.js contém toda a lógica de push). Sem isto, muitos clientes
    // continuam a correr uma versão antiga do sw.js — notificação "não chega independente da versão".
    navigator.serviceWorker
      .register("/service-worker.js", { scope: "/", updateViaCache: "none" })
      .then((reg) => {
        // Puxa proativamente a versão mais recente do SW a cada carregamento.
        try {
          reg?.update?.().catch(() => {});
        } catch (_) {
          /* ignore */
        }
        initPushSubscriptionLifecycle();
      })
      .catch(() => {});
  });
}
