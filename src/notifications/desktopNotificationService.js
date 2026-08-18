import { makeIncomingDedupeKey } from "./chatNotificationService"

const OPEN_CONVERSATION_EVENT = "zaperp:open-conversation-from-notification"
const OPEN_HELPDESK_TICKET_EVENT = "zaperp:open-helpdesk-ticket-from-notification"

/** Segunda linha de defesa se notify for chamado duas vezes para o mesmo evento (TTL curto). */
const DESKTOP_EXTRA_DEDUPE_MS = 8000
const desktopShownKeys = new Map()
const helpDeskShownKeys = new Map()
const MAX_DESKTOP_KEYS = 400

function normalize(value) {
  if (value == null) return ""
  return String(value).trim()
}

function cleanupDesktopKeys(now = Date.now()) {
  for (const [key, exp] of desktopShownKeys.entries()) {
    if (exp <= now) desktopShownKeys.delete(key)
  }
}

function trimDesktopKeysIfNeeded() {
  cleanupDesktopKeys(Date.now())
  if (desktopShownKeys.size <= MAX_DESKTOP_KEYS) return
  const overflow = desktopShownKeys.size - MAX_DESKTOP_KEYS + 80
  let removed = 0
  for (const k of desktopShownKeys.keys()) {
    desktopShownKeys.delete(k)
    if (++removed >= overflow) break
  }
}

/**
 * Evita duas chamadas à Notification API para o mesmo payload num curto intervalo.
 * A decisão principal continua em shouldNotifyIncomingMessage + dedupe no chatNotificationService.
 */
function tryClaimDesktopSlot(msg) {
  const key = makeIncomingDedupeKey(msg)
  const now = Date.now()
  cleanupDesktopKeys(now)
  const exp = desktopShownKeys.get(key)
  if (exp && exp > now) return false
  desktopShownKeys.set(key, now + DESKTOP_EXTRA_DEDUPE_MS)
  trimDesktopKeysIfNeeded()
  return true
}

function tryClaimHelpDeskDesktopSlot(notification) {
  const id = normalize(notification?.id)
  const ticketId = normalize(notification?.ticket_id)
  const tipo = normalize(notification?.tipo)
  const key = id ? `helpdesk-${id}` : `helpdesk-${ticketId}-${tipo}`
  const now = Date.now()
  const exp = helpDeskShownKeys.get(key)
  if (exp && exp > now) return false
  helpDeskShownKeys.set(key, now + DESKTOP_EXTRA_DEDUPE_MS)
  if (helpDeskShownKeys.size > MAX_DESKTOP_KEYS) {
    const oldest = helpDeskShownKeys.keys().next().value
    if (oldest) helpDeskShownKeys.delete(oldest)
  }
  return true
}

export function hasDesktopNotificationSupport() {
  return typeof window !== "undefined" && "Notification" in window
}

function toPublicAsset(url) {
  const v = normalize(url)
  if (!v) return "/brand/pwa-192.png"
  if (v.startsWith("http://") || v.startsWith("https://")) return v
  if (v.startsWith("/")) return v
  return `/${v}`
}

function buildMessagePreview(msg) {
  const tipo = normalize(msg?.tipo).toLowerCase()
  const textoBruto = normalize(msg?.texto || msg?.conteudo)
  if (textoBruto) return textoBruto.slice(0, 140)
  if (tipo === "imagem") return "📷 Imagem"
  if (tipo === "video") return "🎬 Vídeo"
  if (tipo === "sticker") return "🎭 Figurinha"
  if (tipo === "audio") return "🎵 Áudio"
  if (tipo === "voice") return "🎵 Áudio"
  if (tipo === "arquivo") return "📎 Arquivo"
  if (tipo === "location") return "📍 Localização"
  return "Nova mensagem"
}

function dispatchOpenConversation(conversaId) {
  if (typeof window === "undefined") return
  const id = normalize(conversaId)
  if (!id) return
  window.dispatchEvent(
    new CustomEvent(OPEN_CONVERSATION_EVENT, {
      detail: { conversaId: id },
    })
  )
}

function dispatchOpenHelpDeskTicket(ticketId) {
  if (typeof window === "undefined") return
  const id = normalize(ticketId)
  if (!id) return
  window.dispatchEvent(
    new CustomEvent(OPEN_HELPDESK_TICKET_EVENT, {
      detail: { ticketId: id },
    })
  )
}

function focusAppWindow() {
  try {
    window.focus()
  } catch (_) {}
}

/** Tempo até o card nativo sumir sozinho (não deve ficar fixo na tela). */
const NOTIFICATION_AUTO_CLOSE_MS = 4_000

/**
 * setTimeout de página sofre throttling intensivo em aba oculta (lotes de 1/min após ~5min
 * em segundo plano) — exatamente o cenário em que o card aparece, deixando-o "fixo" na tela.
 * Timer dentro de um Worker dedicado não é throttled pela visibilidade da aba.
 */
function scheduleAutoClose(callback, delayMs) {
  try {
    const src = "self.onmessage=function(e){setTimeout(function(){self.postMessage(1);self.close()},e.data)}"
    const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }))
    const worker = new Worker(url)
    worker.onmessage = () => {
      try {
        worker.terminate()
      } catch (_) {}
      try {
        URL.revokeObjectURL(url)
      } catch (_) {}
      callback()
    }
    worker.postMessage(delayMs)
  } catch (_) {
    setTimeout(callback, delayMs)
  }
}

/**
 * Notificação nativa do sistema (Notification API).
 * Limitações reais: o SO/navegador pode agrupar, omitir som ou não mostrar em modo “Não incomodar”,
 * mesmo com permissão concedida.
 *
 * Chamado apenas após shouldNotifyIncomingMessage — não repetir aqui regras de inbound/histórico/foco.
 *
 * @returns {Promise<{ shown: boolean, reason: string }>}
 */
export async function notifyIncomingDesktopMessage({ msg, contatoNome, avatarUrl }) {
  if (!hasDesktopNotificationSupport()) {
    return { shown: false, reason: "unsupported" }
  }

  const conversaId = normalize(msg?.conversa_id)
  if (!conversaId) {
    return { shown: false, reason: "missing_conversation" }
  }

  if (Notification.permission === "denied") {
    return { shown: false, reason: "permission_denied" }
  }

  if (Notification.permission === "default") {
    try {
      const perm = await Notification.requestPermission()
      if (perm !== "granted") {
        return { shown: false, reason: perm === "denied" ? "permission_denied" : "permission_blocked" }
      }
    } catch {
      return { shown: false, reason: "permission_failed" }
    }
  }

  if (!tryClaimDesktopSlot(msg)) {
    return { shown: false, reason: "duplicate_desktop_guard" }
  }

  const title = normalize(contatoNome) || "Nova mensagem"
  const body = buildMessagePreview(msg)
  const icon = toPublicAsset(avatarUrl)
  const mid = normalize(msg?.id || msg?.mensagem_id || msg?.whatsapp_id)
  const tag = mid ? `zap-desk-${mid}` : `zap-desk-c${conversaId}-${Date.now()}`
  const openUrl = `/atendimento?conversa=${encodeURIComponent(conversaId)}`
  const data = {
    conversaId,
    messageId: mid || null,
    // Consumido pelo notificationclick do Service Worker (sw.js) quando o card vem por lá.
    openUrl,
    url: openUrl,
  }

  try {
    const notification = new Notification(title, {
      body,
      icon,
      tag,
      renotify: false,
      requireInteraction: false,
      silent: false,
      data,
    })

    notification.onclick = () => {
      focusAppWindow()
      dispatchOpenConversation(conversaId)
      try {
        notification.close()
      } catch (_) {}
    }

    scheduleAutoClose(() => {
      try {
        notification.close()
      } catch (_) {}
    }, NOTIFICATION_AUTO_CLOSE_MS)

    return { shown: true, reason: "ok" }
  } catch {
    // Alguns ambientes restringem o construtor Notification() a partir da página.
    // Fallback: mostrar via Service Worker (registration.showNotification), que é o
    // caminho mais robusto quando a aba está em segundo plano. O clique é tratado pelo
    // notificationclick do sw.js, que navega para a conversa (data.openUrl).
    const shownViaSw = await tryShowViaServiceWorker(title, { body, icon, tag, data })
    return shownViaSw
      ? { shown: true, reason: "ok_service_worker" }
      : { shown: false, reason: "creation_failed" }
  }
}

/** Exibe no Windows o evento do HelpDesk usando o mesmo mecanismo das mensagens do WhatsApp. */
export async function notifyHelpDeskDesktopNotification({ notification }) {
  if (!hasDesktopNotificationSupport()) {
    return { shown: false, reason: "unsupported" }
  }

  const ticketId = normalize(notification?.ticket_id)
  if (!ticketId) return { shown: false, reason: "missing_ticket" }
  if (Notification.permission === "denied") {
    return { shown: false, reason: "permission_denied" }
  }
  if (Notification.permission === "default") {
    try {
      const permission = await Notification.requestPermission()
      if (permission !== "granted") {
        return { shown: false, reason: permission === "denied" ? "permission_denied" : "permission_blocked" }
      }
    } catch {
      return { shown: false, reason: "permission_failed" }
    }
  }
  if (!tryClaimHelpDeskDesktopSlot(notification)) {
    return { shown: false, reason: "duplicate_desktop_guard" }
  }

  const title = normalize(notification?.titulo) || "Atualização no HelpDesk"
  const body = normalize(notification?.mensagem) || `Chamado #${ticketId}`
  const tag = `zaperp-helpdesk-${normalize(notification?.id) || `${ticketId}-${normalize(notification?.tipo)}`}`
  const openUrl = `/helpdesk?ticket=${encodeURIComponent(ticketId)}`
  const data = { ticketId, openUrl, url: openUrl }
  const options = {
    body,
    icon: "/brand/pwa-192.png",
    tag,
    renotify: false,
    requireInteraction: false,
    silent: false,
    data,
  }

  try {
    const desktopNotification = new Notification(title, options)
    desktopNotification.onclick = () => {
      focusAppWindow()
      dispatchOpenHelpDeskTicket(ticketId)
      try {
        desktopNotification.close()
      } catch (_) {}
    }
    scheduleAutoClose(() => {
      try {
        desktopNotification.close()
      } catch (_) {}
    }, NOTIFICATION_AUTO_CLOSE_MS)
    return { shown: true, reason: "ok" }
  } catch {
    const shownViaSw = await tryShowViaServiceWorker(title, options)
    return shownViaSw
      ? { shown: true, reason: "ok_service_worker" }
      : { shown: false, reason: "creation_failed" }
  }
}

async function tryShowViaServiceWorker(title, { body, icon, tag, data }) {
  try {
    if (typeof navigator === "undefined" || !navigator.serviceWorker) return false
    const reg =
      (await navigator.serviceWorker.getRegistration()) ||
      (await navigator.serviceWorker.ready)
    if (!reg || typeof reg.showNotification !== "function") return false
    await reg.showNotification(title, {
      body,
      icon,
      tag,
      renotify: false,
      requireInteraction: false,
      silent: false,
      data,
    })
    scheduleAutoClose(async () => {
      try {
        const notifs = await reg.getNotifications({ tag })
        notifs.forEach((n) => {
          try {
            n.close()
          } catch (_) {}
        })
      } catch (_) {}
    }, NOTIFICATION_AUTO_CLOSE_MS)
    return true
  } catch {
    return false
  }
}

export function getOpenConversationNotificationEventName() {
  return OPEN_CONVERSATION_EVENT
}

export function getOpenHelpDeskNotificationEventName() {
  return OPEN_HELPDESK_TICKET_EVENT
}
