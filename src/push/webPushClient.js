import api from "../api/http"
import { getApiBaseUrl } from "../api/baseUrl"

/** Ative logs detalhados: `localStorage.setItem('zaperp_push_debug','1')` e recarregue. */
export function isPushDiagEnabled() {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem("zaperp_push_debug") === "1"
  } catch {
    return false
  }
}

function pushDiag(...args) {
  if (!isPushDiagEnabled()) return
  try {
    console.debug("[push][diag]", ...args)
  } catch {
    /* ignore */
  }
}

/** Evita pendura se não existir SW (ex.: dev sem registo de SW). */
export async function getPushServiceWorkerRegistration() {
  if (typeof navigator === "undefined" || !navigator.serviceWorker) return null
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error("sw_ready_timeout")), 12_000)),
    ])
  } catch (e) {
    pushDiag("getPushServiceWorkerRegistration:", e?.message || e)
    return null
  }
}

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

/**
 * Compara a chave (applicationServerKey) usada para criar a subscription atual com a chave
 * pública VAPID que o servidor serve agora. Se o servidor trocou de chave, a subscription antiga
 * fica inutilizável (o push service devolve 403 VapidPkeyMismatch) e o push falha silenciosamente
 * para sempre — é preciso re-subscrever com a chave nova.
 *
 * Nota: alguns navegadores (ex.: Firefox antigo) não expõem `options.applicationServerKey`.
 * Nesse caso não conseguimos verificar, então assumimos "igual" para não destruir uma
 * subscription que pode estar boa (evita churn desnecessário).
 */
function applicationServerKeyMatches(sub, publicKeyBase64) {
  try {
    const existing = sub?.options?.applicationServerKey
    if (!existing) return true // navegador não expõe a chave: não dá para verificar
    const existingArr = new Uint8Array(existing)
    const current = urlBase64ToUint8Array(publicKeyBase64)
    if (existingArr.length !== current.length) return false
    for (let i = 0; i < current.length; i += 1) {
      if (existingArr[i] !== current[i]) return false
    }
    return true
  } catch {
    return true // em erro, não arriscar destruir subscription potencialmente válida
  }
}

/**
 * Garante uma subscription válida para a chave VAPID atual do servidor.
 * Se a subscription existente foi criada com outra chave, desfaz e re-subscreve — é isto que
 * faz a notificação voltar a chegar "independente da versão" após rotação de chave VAPID.
 */
async function ensureSubscriptionForServerKey(reg, publicKeyBase64) {
  let sub = await reg.pushManager.getSubscription()

  if (sub && !applicationServerKeyMatches(sub, publicKeyBase64)) {
    pushDiag("ensureSubscriptionForServerKey: applicationServerKey mudou — re-subscrevendo")
    try {
      await unregisterPushTokenOnServer(sub)
    } catch {
      /* ignore */
    }
    await sub.unsubscribe().catch(() => {})
    sub = null
    lastPushSend = { sig: "", at: 0 }
  }

  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKeyBase64),
    })
  }

  return sub
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
  const endpoints = ["/usuarios/push/vapid-public-key", "/users/push/vapid-public-key"]
  for (const ep of endpoints) {
    try {
      const res = await fetch(`${base}${ep}`)
      const json = await res.json().catch(() => ({}))
      if (res.ok && json?.publicKey) {
        pushDiag("fetchVapidPublicKey: ok", { ep })
        return { ok: true, ...json }
      }
      if (json?.enabled === false) {
        pushDiag("fetchVapidPublicKey: servidor desativou VAPID", { ep })
        return { ok: false, ...json }
      }
    } catch (e) {
      pushDiag("fetchVapidPublicKey: erro rede", ep, e?.message)
    }
  }
  pushDiag("fetchVapidPublicKey: sem chave")
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

/** Após troca de sessão, força novo envio ao backend (evita debounce bloquear o primeiro registo pós-login). */
export function resetPushRegistrationDebounce() {
  lastPushSend = { sig: "", at: 0 }
}

let lastNativeFcmSend = { sig: "", at: 0 }

/**
 * Registo de token FCM vindo do WebView / app Android nativo (FirebaseMessagingService → JavascriptInterface).
 * Não usa VAPID; o backend grava em `push_tokens`.
 */
export async function registerNativeFcmToken(token, plataforma = "android-native") {
  const t = String(token || "").trim()
  if (t.length < 10) {
    pushDiag("registerNativeFcmToken: token curto ou vazio")
    return { ok: false, reason: "invalid_token" }
  }
  if (!hasAuthToken()) {
    pushDiag("registerNativeFcmToken: sem sessão (zap_erp_auth)")
    return { ok: false, reason: "no_auth" }
  }
  const now = Date.now()
  if (lastNativeFcmSend.sig === t && now - lastNativeFcmSend.at < PUSH_SEND_DEBOUNCE_MS) {
    pushDiag("registerNativeFcmToken: debounce — mesmo token há pouco")
    return { ok: true, reason: "debounced" }
  }
  const { navegador, dispositivo } = getPushClientMeta()
  const payload = {
    token: t,
    plataforma: String(plataforma || "android-native").slice(0, 64),
    navegador,
    dispositivo,
  }
  try {
    pushDiag("registerNativeFcmToken: enviando ao backend", { plataforma: payload.plataforma, len: t.length })
    await api.post("/api/push/tokens", payload, { silent: true })
    lastNativeFcmSend = { sig: t, at: Date.now() }
    pushDiag("registerNativeFcmToken: servidor aceitou")
    return { ok: true }
  } catch (e) {
    const st = e?.response?.status
    const msg = e?.response?.data?.error || e?.message
    console.warn("[push] registerNativeFcmToken falhou", { status: st, message: msg })
    return { ok: false, reason: "request_failed", status: st }
  }
}

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
  if (lastPushSend.sig === sig && now - lastPushSend.at < PUSH_SEND_DEBOUNCE_MS) {
    pushDiag("sendPushTokenToBackend: debounce ativo, skip")
    return
  }

  const { navegador, dispositivo } = getPushClientMeta()
  const payload = {
    token,
    plataforma: "web-pwa",
    navegador,
    dispositivo,
  }

  try {
    pushDiag("sendPushTokenToBackend: POST /api/push/tokens (web-pwa)", { navegador, dispositivo })
    await api.post("/api/push/tokens", payload, { silent: true })
    lastPushSend = { sig, at: Date.now() }
    pushDiag("sendPushTokenToBackend: ok")
  } catch (e) {
    const st = e?.response?.status
    const msg = e?.response?.data?.error || e?.message
    console.warn("[push] falha ao registar subscription no servidor", { status: st, message: msg })
  }
}

/**
 * Solicita permissão (se necessário), subscreve push e envia token ao backend.
 */
export async function subscribeWebPush() {
  if (!pushSupported()) {
    pushDiag("subscribeWebPush: unsupported")
    return { ok: false, reason: "unsupported" }
  }

  const vapid = await fetchVapidPublicKey()
  if (!vapid.publicKey) {
    pushDiag("subscribeWebPush: sem chave VAPID no servidor", { enabled: vapid.enabled })
    return { ok: false, reason: vapid.enabled === false ? "server_disabled" : "no_public_key" }
  }

  const reg = await getPushServiceWorkerRegistration()
  if (!reg) {
    pushDiag("subscribeWebPush: sem Service Worker ativo")
    return { ok: false, reason: "no_service_worker" }
  }

  let permission = Notification.permission
  pushDiag("subscribeWebPush: permissão antes do pedido", { permission })
  if (permission === "default") {
    permission = await Notification.requestPermission()
    pushDiag("subscribeWebPush: permissão após pedido", { permission })
  }
  if (permission !== "granted") {
    return { ok: false, reason: permission === "denied" ? "permission_denied" : "permission_blocked" }
  }

  const sub = await ensureSubscriptionForServerKey(reg, vapid.publicKey)

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
  const reg = await getPushServiceWorkerRegistration()
  if (!reg) return { ok: true }
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
  if (!pushSupported()) {
    pushDiag("syncPushSubscriptionSilently: unsupported")
    return { ok: false, reason: "unsupported" }
  }
  if (!hasAuthToken()) {
    pushDiag("syncPushSubscriptionSilently: no_auth")
    return { ok: false, reason: "no_auth" }
  }
  if (Notification.permission !== "granted") {
    pushDiag("syncPushSubscriptionSilently: permission_not_granted", Notification.permission)
    return { ok: false, reason: "permission_not_granted" }
  }

  const vapid = await fetchVapidPublicKey()
  if (!vapid.publicKey) {
    pushDiag("syncPushSubscriptionSilently: no_public_key", { enabled: vapid.enabled })
    return { ok: false, reason: vapid.enabled === false ? "server_disabled" : "no_public_key" }
  }

  const reg = await getPushServiceWorkerRegistration()
  if (!reg) {
    pushDiag("syncPushSubscriptionSilently: sem Service Worker ativo")
    return { ok: false, reason: "no_service_worker" }
  }
  const sub = await ensureSubscriptionForServerKey(reg, vapid.publicKey)

  await sendPushTokenToBackend(sub)

  pushDiag("syncPushSubscriptionSilently: concluído")
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
    const reg = await getPushServiceWorkerRegistration()
    if (!reg) return false
    const sub = await reg.pushManager.getSubscription()
    return !!sub
  } catch {
    return false
  }
}
