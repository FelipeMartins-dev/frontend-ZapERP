import { schedulePushSubscriptionSync } from "./deferredPushSync"

const RESYNC_MIN_INTERVAL_MS = 60_000
const PERIODIC_RESYNC_MS = 10 * 60_000
let initialized = false
let running = false
let lastRunAt = 0

async function runSync(reason) {
  const now = Date.now()
  if (running) return
  if (now - lastRunAt < RESYNC_MIN_INTERVAL_MS) return
  running = true
  lastRunAt = now
  try {
    schedulePushSubscriptionSync()
  } catch (e) {
    console.warn("[push] sync lifecycle:", reason, e?.message || e)
  } finally {
    running = false
  }
}

export function initPushSubscriptionLifecycle() {
  if (initialized) return
  initialized = true

  if (typeof window === "undefined" || typeof navigator === "undefined" || !navigator.serviceWorker) return

  // Re-sincroniza no arranque (sessão já autenticada) e quando o SW troca de controlador.
  void runSync("init")
  navigator.serviceWorker.addEventListener("controllerchange", () => void runSync("controllerchange"))
  window.addEventListener("online", () => void runSync("online"))
  window.addEventListener("storage", (e) => {
    if (e?.key === "zap_erp_auth") void runSync("auth_storage_change")
  })

  // Re-sincroniza ao voltar para o app (caso o endpoint tenha mudado enquanto app estava suspenso).
  window.addEventListener("focus", () => void runSync("focus"))
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void runSync("visible")
  })
  window.setInterval(() => void runSync("periodic"), PERIODIC_RESYNC_MS)
}
