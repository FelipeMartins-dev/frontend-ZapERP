import { useConversaStore } from "../conversa/conversaStore"
import { isAppUiFullyFocusedForSuppress, isConversationRouteActive } from "../notifications/chatNotificationService"
import { syncPushSubscriptionSilently } from "./webPushClient"

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
    const suppress = isSuppressedForFocusedConversation(conversaId)
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
    void syncPushSubscriptionSilently()
  }
}

export function initServiceWorkerBridge() {
  if (initialized) return
  initialized = true

  if (typeof window === "undefined" || typeof navigator === "undefined") return
  if (!navigator.serviceWorker) return

  navigator.serviceWorker.addEventListener("message", handleServiceWorkerMessage)
}
