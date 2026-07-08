import { useConversaStore } from "../conversa/conversaStore"
import { isAppUiFullyFocusedForSuppress, isConversationRouteActive } from "../notifications/chatNotificationService"
import { schedulePushSubscriptionSync } from "./deferredPushSync"
import { shouldDeferLocalNotificationToWebPush } from "./pushPlatform"

const OPEN_CONVERSATION_EVENT = "zaperp:open-conversation-from-notification"
let initialized = false

function normalize(value) {
  if (value == null) return ""
  return String(value).trim()
}

function extractConversaIdFromPath(openPath) {
  const raw = normalize(openPath)
  if (!raw) return ""
  try {
    const url = new URL(raw, window.location.origin)
    return normalize(url.searchParams.get("conversa") || url.searchParams.get("conversa_id"))
  } catch {
    return ""
  }
}

function isSuppressedForFocusedConversation(conversaId) {
  const cid = normalize(conversaId)
  if (!cid) return false
  if (!isAppUiFullyFocusedForSuppress()) return false
  if (!isConversationRouteActive(window.location?.pathname || "")) return false
  const selectedId = useConversaStore.getState().selectedId
  return normalize(selectedId) === cid
}

/** Em desktop com permissão concedida, o cliente vivo já mostra o card local (Notification API). */
function clientCanShowLocalDesktopCard() {
  if (shouldDeferLocalNotificationToWebPush()) return false
  try {
    return typeof Notification !== "undefined" && Notification.permission === "granted"
  } catch (_) {
    return false
  }
}

/**
 * Decide se este cliente vivo pede ao Service Worker para NÃO mostrar o card do Web Push.
 * Só clientes vivos respondem a tempo (o SW usa timeout curto); telemóvel suspenso não responde
 * → o push é mostrado como fallback. Aqui suprimimos quando:
 *  - a conversa está aberta e em foco (já suprimimos som/card local), ou
 *  - é um desktop vivo que vai mostrar o card local a partir do socket (evita card duplicado).
 */
function shouldSuppressWebPushForThisClient(conversaId) {
  if (isSuppressedForFocusedConversation(conversaId)) return true
  if (clientCanShowLocalDesktopCard()) return true
  return false
}

function navigateInsideApp(openPath) {
  const raw = normalize(openPath)
  if (!raw) return
  try {
    const url = new URL(raw, window.location.origin)
    if (url.origin !== window.location.origin) {
      window.location.assign(raw)
      return
    }

    const conversaId = normalize(url.searchParams.get("conversa") || url.searchParams.get("conversa_id"))
    if (conversaId) {
      window.dispatchEvent(
        new CustomEvent(OPEN_CONVERSATION_EVENT, {
          detail: { conversaId },
        })
      )
      try {
        window.focus()
      } catch (_) {}
      return
    }

    const next = `${url.pathname}${url.search}${url.hash}`
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`
    if (next !== current) {
      window.history.pushState({}, "", next)
      window.dispatchEvent(new PopStateEvent("popstate"))
    }

    try {
      window.focus()
    } catch (_) {}
  } catch {
    window.location.assign(raw)
  }
}

function handleServiceWorkerMessage(event) {
  const type = normalize(event?.data?.type)
  if (!type) return

  if (type === "ZAP_PUSH_SUPPRESS_CHECK") {
    const conversaId = normalize(event?.data?.payload?.conversaId)
    const suppress = shouldSuppressWebPushForThisClient(conversaId)
    try {
      const port = event?.ports?.[0]
      if (port && typeof port.postMessage === "function") {
        port.postMessage({ suppress })
      }
    } catch (_) {}
    return
  }

  if (type === "ZAP_PUSH_NAVIGATE") {
    const openPath = normalize(event?.data?.openPath)
    if (!openPath) return
    navigateInsideApp(openPath)
    return
  }

  if (type === "ZAP_PUSH_RESYNC_REQUIRED") {
    schedulePushSubscriptionSync()
  }
}

export function initServiceWorkerBridge() {
  if (initialized) return
  initialized = true

  if (typeof window === "undefined" || typeof navigator === "undefined") return
  if (!navigator.serviceWorker) return

  navigator.serviceWorker.addEventListener("message", handleServiceWorkerMessage)
}
