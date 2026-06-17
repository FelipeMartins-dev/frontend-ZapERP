import { makeIncomingDedupeKey } from "./chatNotificationService"

const OPEN_CONVERSATION_EVENT = "zaperp:open-conversation-from-notification"

/** Segunda linha de defesa se notify for chamado duas vezes para o mesmo evento (TTL curto). */
const DESKTOP_EXTRA_DEDUPE_MS = 8000
const desktopShownKeys = new Map()
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

function focusAppWindow() {
  try {
    window.focus()
  } catch (_) {}
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

  try {
    const notification = new Notification(title, {
      body,
      icon,
      tag,
      renotify: false,
      requireInteraction: false,
      silent: false,
      data: {
        conversaId,
        messageId: mid || null,
      },
    })

    notification.onclick = () => {
      focusAppWindow()
      dispatchOpenConversation(conversaId)
      try {
        notification.close()
      } catch (_) {}
    }

    const autoCloseMs = 12_000
    setTimeout(() => {
      try {
        notification.close()
      } catch (_) {}
    }, autoCloseMs)

    return { shown: true, reason: "ok" }
  } catch {
    return { shown: false, reason: "creation_failed" }
  }
}

export function getOpenConversationNotificationEventName() {
  return OPEN_CONVERSATION_EVENT
}
