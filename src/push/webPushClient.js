import api from "../api/http"
import { getApiBaseUrl } from "../api/baseUrl"

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

export function pushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  )
}

/** GET chave pública VAPID (sem auth). */
export async function fetchVapidPublicKey() {
  const base = getApiBaseUrl()
  const endpoints = ["/users/push/vapid-public-key", "/usuarios/push/vapid-public-key"]
  for (const ep of endpoints) {
    try {
      const res = await fetch(`${base}${ep}`)
      const json = await res.json().catch(() => ({}))
      if (res.ok && json?.publicKey) return { ok: true, ...json }
      if (json?.enabled === false) return { ok: false, ...json }
    } catch (_) {}
  }
  return { ok: false, publicKey: null }
}

/** Serialização estável do PushSubscription para o backend (Web Push padrão). */
export function serializePushSubscription(sub) {
  const json = sub?.toJSON?.() || {}
  return JSON.stringify({
    endpoint: json.endpoint,
    keys: json.keys,
    expirationTime: json.expirationTime,
  })
}

export function getPushClientMeta() {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : ""
  let navegador = "unknown"
  if (/Edg\//i.test(ua)) navegador = "Edge"
  else if (/OPR\//i.test(ua)) navegador = "Opera"
  else if (/Chrome|CriOS/i.test(ua) && !/Edg/i.test(ua)) navegador = "Chrome"
  else if (/Firefox/i.test(ua)) navegador = "Firefox"
  else if (/Safari/i.test(ua) && !/Chrome|CriOS|Edg/i.test(ua)) navegador = "Safari"

  let dispositivo = "desktop"
  if (/iPhone|iPod/i.test(ua)) dispositivo = "iphone"
  else if (/iPad/i.test(ua) || (typeof navigator !== "undefined" && navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) {
    dispositivo = "ipad"
  } else if (/Android/i.test(ua)) dispositivo = "android-mobile"

  return { navegador, dispositivo }
}

let lastPushSend = { sig: "", at: 0 }
const PUSH_SEND_DEBOUNCE_MS = 45_000

async function sendPushTokenToBackend(sub) {
  if (!sub) return
  const token = serializePushSubscription(sub)
  let sig = ""
  try {
    sig = sub.endpoint || token
  } catch (_) {
    sig = token
  }
  const now = Date.now()
  if (lastPushSend.sig === sig && now - lastPushSend.at < PUSH_SEND_DEBOUNCE_MS) return

  const { navegador, dispositivo } = getPushClientMeta()
  const payload = {
    token,
    plataforma: "web-pwa",
    navegador,
    dispositivo,
  }

  try {
    await api.post("/api/push/tokens", payload, { silent: true })
    lastPushSend = { sig, at: Date.now() }
  } catch (_) {
    /* falha silenciosa — não bloqueia login nem UI */
  }
}

/**
 * Solicita permissão (se necessário), subscreve push e envia token ao backend.
 */
export async function subscribeWebPush() {
  if (!pushSupported()) {
    return { ok: false, reason: "unsupported" }
  }

  const vapid = await fetchVapidPublicKey()
  if (!vapid.publicKey) {
    return { ok: false, reason: vapid.enabled === false ? "server_disabled" : "no_public_key" }
  }

  const reg = await navigator.serviceWorker.ready

  let permission = Notification.permission
  if (permission === "default") {
    permission = await Notification.requestPermission()
  }
  if (permission !== "granted") {
    return { ok: false, reason: permission === "denied" ? "permission_denied" : "permission_blocked" }
  }

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapid.publicKey),
  })

  await sendPushTokenToBackend(sub)

  return { ok: true }
}

async function unregisterPushTokenOnServer(sub) {
  const token = serializePushSubscription(sub)
  try {
    await api.delete("/api/push/tokens", { data: { token }, silent: true })
    return
  } catch (_) {}
  const json = sub?.toJSON?.() || {}
  const endpoints = ["/users/me/push/subscribe", "/usuarios/me/push/subscribe"]
  for (const ep of endpoints) {
    try {
      await api.delete(ep, { data: { endpoint: json.endpoint }, silent: true })
      break
    } catch (_) {}
  }
}

export async function unsubscribeWebPush() {
  if (!pushSupported()) return { ok: false, reason: "unsupported" }
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return { ok: true }
  await unregisterPushTokenOnServer(sub)
  await sub.unsubscribe().catch(() => {})
  lastPushSend = { sig: "", at: 0 }
  return { ok: true }
}

/**
 * Sincroniza subscription sem popup agressivo:
 * - só roda quando permissão já está "granted"
 * - cria subscription se necessário (sem re-pedir permissão)
 * - reenvia token ao backend para manter vínculo atualizado
 */
export async function syncPushSubscriptionSilently() {
  if (!pushSupported()) return { ok: false, reason: "unsupported" }
  if (!hasAuthToken()) return { ok: false, reason: "no_auth" }
  if (Notification.permission !== "granted") return { ok: false, reason: "permission_not_granted" }

  const vapid = await fetchVapidPublicKey()
  if (!vapid.publicKey) {
    return { ok: false, reason: vapid.enabled === false ? "server_disabled" : "no_public_key" }
  }

  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapid.publicKey),
    })
  }

  await sendPushTokenToBackend(sub)

  return { ok: true }
}

function hasAuthToken() {
  try {
    const raw = localStorage.getItem("zap_erp_auth")
    if (!raw) return false
    const parsed = JSON.parse(raw)
    return !!parsed?.token
  } catch {
    return false
  }
}

export async function hasActivePushSubscription() {
  if (!pushSupported()) return false
  if (Notification.permission !== "granted") return false
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    return !!sub
  } catch {
    return false
  }
}
