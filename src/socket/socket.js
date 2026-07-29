import { io } from "socket.io-client"
import { useChatStore } from "../chats/chatsStore"
import {
  normalizeMensagemStatusKey,
  ultimaMensagemRefsEqual,
} from "../chats/chatListStoreCompare"
import { useConversaStore } from "../conversa/conversaStore"
import { useNotificationStore } from "../notifications/notificationStore"
import { shouldNotifyIncomingMessage } from "../notifications/chatNotificationService"
import { notifyIncomingDesktopMessage } from "../notifications/desktopNotificationService"
import { hasActivePushSubscription } from "../push/webPushClient"
import { shouldDeferLocalNotificationToWebPush } from "../push/pushPlatform"
import { getApiBaseUrl } from "../api/baseUrl"
import { fetchChatById } from "../chats/chatService"
import { SOCKET_EVENTS } from "./events"
import {
  enqueueStatusMensagemEvent,
  flushStatusMensagemBatch,
  resetStatusMensagemBatch,
} from "./statusMensagemBatch"
import { getStatusAtendimentoEffective } from "../utils/conversaUtils"

const TYPING_EXPIRY_MS = 5000
const typingExpiryTimers = new Map()

/** Evita som duplo: após transferência, o destinatário ouve o som de handoff e suprime o beep de nova_mensagem uma vez. */
const suppressDefaultMessageSoundUntil = new Map()
const SUPPRESS_SOUND_TTL_MS = 20_000

/** @param {string|number|null|undefined} conversaId */
function markSuppressNovaMensagemSound(conversaId) {
  if (conversaId == null || conversaId === "") return
  suppressDefaultMessageSoundUntil.set(String(conversaId), Date.now() + SUPPRESS_SOUND_TTL_MS)
}

/**
 * Se ainda válido, remove a marca e retorna true (consumir som padrão de nova_mensagem).
 * @param {string|number|null|undefined} conversaId
 */
function consumeSuppressNovaMensagemSound(conversaId) {
  if (conversaId == null || conversaId === "") return false
  const key = String(conversaId)
  const exp = suppressDefaultMessageSoundUntil.get(key)
  if (exp == null) return false
  if (Date.now() > exp) {
    suppressDefaultMessageSoundUntil.delete(key)
    return false
  }
  suppressDefaultMessageSoundUntil.delete(key)
  return true
}

function applyDocumentTitle(unreadTotal) {
  if (typeof document === "undefined") return
  const base = "ZapERP — Atendimento inteligente"
  document.title = unreadTotal > 0 ? `(${unreadTotal}) ${base}` : base
}

let documentTitleRaf = null
function updateDocumentTitleFromChats() {
  if (typeof document === "undefined") return
  if (documentTitleRaf != null) return
  documentTitleRaf = requestAnimationFrame(() => {
    documentTitleRaf = null
    const chats = useChatStore.getState().chats || []
    const total = chats.reduce((acc, c) => acc + (Number(c.unread_count) || 0), 0)
    applyDocumentTitle(total)
  })
}

/**
 * Inbound: o backend retoma de `aguardando_cliente` → `em_atendimento` (manual) sem exigir refetch.
 * Aplica otimista na lista e no detalhe; alinha com `conversa_atualizada` se o backend emitir em seguida.
 * @param {string|number} conversaId
 * @param {any} msg
 */
function applyRetomadaSeAguardandoPorMensagemRecebida(conversaId, msg) {
  if (conversaId == null || conversaId === "") return
  if (isEmpresaModoSimplesAtivoCliente()) return
  if (msg?.fromMe) return
  const d = String(msg?.direcao || "").toLowerCase()
  if (d === "out" || d === "outbound" || d === "enviada" || d === "enviado") return
  if (d && d !== "in" && d !== "inbound" && d !== "recebida") return

  const convStore = useConversaStore.getState()
  const chatStore = useChatStore.getState()
  const chats = chatStore.chats || []
  const row = chats.find((c) => String(c.id) === String(conversaId))
  const aberto = convStore.selectedId && String(convStore.selectedId) === String(conversaId)
  const openConv = aberto ? convStore.conversa : null

  const rowStatus = row ? getStatusAtendimentoEffective(row) : ""
  const openStatus = openConv ? getStatusAtendimentoEffective(openConv) : ""
  const rowAguarda =
    row &&
    (rowStatus === "aguardando_cliente" ||
      (rowStatus === "em_atendimento" && row?.aguardando_cliente_desde != null))
  const openAguarda =
    openConv &&
    (openStatus === "aguardando_cliente" ||
      (openStatus === "em_atendimento" && openConv?.aguardando_cliente_desde != null))
  if (!rowAguarda && !openAguarda) return

  const patch = {
    id: conversaId,
    status_atendimento: "em_atendimento",
    status_atendimento_real: "em_atendimento",
    aguardando_cliente_desde: null,
  }
  if (row) chatStore.updateChat(patch)
  if (aberto) convStore.patchConversa(patch)
  chatStore.requestChatListResync()
}

// Som de notificação: tenta arquivo MP3, fallback para beep via Web Audio API
function playNotificationSound() {
  playFallbackBeep()
}

/** Mapeamento soundId (payload ui.soundId) → URL em /public */
const NOTIFICATION_SOUND_URL_BY_ID = {}

/**
 * @param {string} [soundId]
 */
function playNotificationSoundById(soundId) {
  const id = String(soundId || "").trim()
  const url = id ? NOTIFICATION_SOUND_URL_BY_ID[id] : null
  if (!url) {
    playNotificationSound()
    return
  }
  try {
    const audio = new Audio(url)
    audio.volume = 0.65
    audio.play().catch(() => playNotificationSound())
  } catch (_) {
    playNotificationSound()
  }
}

function playFallbackBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 880
    osc.type = "sine"
    gain.gain.setValueAtTime(0.3, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.15)
  } catch (_) {}
}

function getChatDisplayName(conversaId) {
  const chats = useChatStore.getState().chats || []
  const c = chats.find((x) => String(x.id) === String(conversaId))
  if (!c) return "Nova mensagem"
  // Grupos: nome_grupo tem prioridade
  const jid = c.remoteJid ?? c.telefone ?? c.phone ?? ""
  if (String(jid).endsWith("@g.us") || c.is_group || c.isGroup) {
    const gn = c?.nome_grupo ?? c?.contato_nome ?? c?.nome ?? ""
    if (String(gn || "").trim() && !String(gn).toLowerCase().startsWith("lid:")) return String(gn).trim()
  }
  const nome = c?.contato_nome || c?.nome || c?.cliente?.nome || c?.telefone
  return nome || "Nova mensagem"
}

function canNotifyByConversationOwnership(chat, currentUserId) {
  if (!chat || typeof chat !== "object") return false
  const status = getStatusAtendimentoEffective(chat)
  // Sem status na lista ainda (ex.: primeira mensagem antes do merge com o servidor): não bloquear alerta.
  if (!status) return true
  if (status === "aberta") return true
  if (status === "em_atendimento" || status === "aguardando_cliente") {
    if (currentUserId == null) return false
    return String(chat?.atendente_id ?? "") === String(currentUserId)
  }
  return false
}

/** Multi-tenant: company_id do usuário logado (evita circular com authStore) */
function getCurrentCompanyId() {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem("zap_erp_auth") : null
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const u = parsed?.user
    return u?.company_id ?? u?.empresa_id ?? null
  } catch {
    return null
  }
}

/** ID do usuário logado (string) para comparar com payloads do socket */
function getCurrentUserId() {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem("zap_erp_auth") : null
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const u = parsed?.user
    const id = u?.id ?? u?.usuario_id
    return id != null && id !== "" ? String(id) : null
  } catch {
    return null
  }
}

function getCurrentUserRole() {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem("zap_erp_auth") : null
    if (!raw) return ""
    const parsed = JSON.parse(raw)
    const u = parsed?.user
    return String(u?.role || u?.perfil || "").toLowerCase()
  } catch {
    return ""
  }
}

function isEmpresaModoSimplesAtivoCliente() {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem("zap_erp_auth") : null
    if (!raw) return false
    const parsed = JSON.parse(raw)
    return parsed?.user?.atendimento_modo_simples === true
  } catch {
    return false
  }
}

/**
 * Atualização otimista do modo simples ao receber nova_mensagem — evita janela morta
 * entre nova_mensagem e conversa_atualizada (ex.: após marcar como lida).
 */
function resolveOptimisticModoSimplesAguardando(msg) {
  if (!isEmpresaModoSimplesAtivoCliente() || !msg) return null
  const dir = String(msg?.direcao || "").toLowerCase().trim()
  const isOut =
    msg?.fromMe === true ||
    dir === "out" ||
    dir === "outbound" ||
    dir === "enviada" ||
    dir === "enviado"
  if (!isOut) return "atendente"
  const autorId =
    msg?.autor_usuario_id ??
    msg?.usuario_id ??
    msg?.user_id ??
    msg?.autor_id
  if (autorId != null && String(autorId).trim() !== "") return "cliente"
  const tempId = msg?.client_temp_id ?? msg?.clientTempId ?? msg?.temp_id
  if (tempId != null && String(tempId).trim() !== "") return "cliente"
  return null
}

function buildModoSimplesOptimisticPatch(msg) {
  const aguardando = resolveOptimisticModoSimplesAguardando(msg)
  if (!aguardando) return null
  return {
    modo_simples_aguardando: aguardando,
    atendimento_modo_simples: true,
  }
}

function applyModoSimplesOptimisticFromMessage(conversaId, msg) {
  const patch = buildModoSimplesOptimisticPatch(msg)
  if (!patch) return null
  const convStore = useConversaStore.getState()
  if (convStore.selectedId && String(convStore.selectedId) === String(conversaId)) {
    convStore.patchConversa({ id: conversaId, ...patch })
  }
  return patch
}

function canViewInternalAttendanceMessage() {
  const role = getCurrentUserRole()
  return role === "admin" || role === "administrador" || role === "supervisor"
}

/** Ignora evento se payload.company_id não bater com o do usuário (multi-tenant) */
function shouldIgnoreByCompany(payload) {
  const payloadCompany = payload?.company_id ?? payload?.empresa_id
  if (payloadCompany == null) return false
  const myCompany = getCurrentCompanyId()
  if (myCompany == null) return false
  return String(payloadCompany) !== String(myCompany)
}

/**
 * Normaliza payload de `nova_mensagem` para reduzir perdas de renderização quando o backend
 * usa aliases diferentes (chat_id/id/body/message/type/from_me).
 * Mantém compatibilidade total com o formato atual.
 * @param {any} raw
 */
function normalizeNovaMensagemPayload(raw) {
  if (!raw || typeof raw !== "object") return raw
  const nested = raw?.data && typeof raw.data === "object" ? raw.data : null
  const normalized = nested ? { ...raw, ...nested } : { ...raw }

  // conversa_id deve vir como ID real da conversa, ainda que em aliases do backend.
  // Não inferir por `id`, `chat_id`, telefone ou conversa aberta.
  const conversaId =
    normalized.conversa_id ??
    normalized.id_conversa ??
    normalized.conversation_id ??
    normalized.conversationId ??
    normalized.conversa?.id ??
    normalized.chat?.id ??
    null
  if (conversaId != null && conversaId !== "") normalized.conversa_id = conversaId

  // Texto pode vir em campos alternativos para mensagens inbound.
  const texto = normalized.texto ?? normalized.conteudo ?? normalized.body ?? normalized.message ?? normalized.text ?? normalized.caption
  if (texto != null && String(texto).trim() !== "") {
    if (normalized.texto == null || String(normalized.texto).trim() === "") normalized.texto = texto
    if (normalized.conteudo == null || String(normalized.conteudo).trim() === "") normalized.conteudo = texto
  }

  // Direção/autor pode vir como from_me/isFromMe; sem direção a UI pode classificar errado.
  const fromMeRaw = normalized.fromMe ?? normalized.from_me ?? normalized.isFromMe ?? normalized.is_from_me
  const fromMe =
    fromMeRaw === true ||
    fromMeRaw === 1 ||
    String(fromMeRaw).toLowerCase() === "true"
  const dirRaw = String(normalized?.direcao ?? "").trim()
  if (!dirRaw) normalized.direcao = fromMe ? "out" : "in"

  // Tipo pode vir como `type`/`messageType`.
  if (!normalized.tipo) {
    const t = String(normalized.type ?? normalized.messageType ?? "").toLowerCase().trim()
    if (t) {
      if (t === "image") normalized.tipo = "imagem"
      else if (t === "video") normalized.tipo = "video"
      else if (t === "document" || t === "file") normalized.tipo = "arquivo"
      else if (t === "audio") normalized.tipo = "audio"
      else if (t === "voice") normalized.tipo = "voice"
      else if (t === "ptt") normalized.tipo = "ptt"
      else if (t === "sticker") normalized.tipo = "sticker"
      else if (t === "location") normalized.tipo = "location"
      else if (t === "contact") normalized.tipo = "contact"
      else normalized.tipo = t
    }
  }

  const idMissing = normalized.id == null || String(normalized.id).trim() === ""
  if (idMissing) {
    const mid =
      normalized.mensagem_id ?? normalized.message_id ?? normalized.messageId ?? normalized.msg_id
    if (mid != null && String(mid).trim() !== "") normalized.id = mid
  }

  const waMissing = normalized.whatsapp_id == null || String(normalized.whatsapp_id).trim() === ""
  if (waMissing) {
    const wa = normalized.wamid ?? normalized.wa_message_id ?? normalized.whatsapp_message_id
    if (wa != null && String(wa).trim() !== "") normalized.whatsapp_id = wa
  }

  if (
    normalized.conversa_id != null &&
    normalized.id != null &&
    String(normalized.id).trim() !== "" &&
    String(normalized.id) === String(normalized.conversa_id)
  ) {
    delete normalized.id
  }

  const clientTempId =
    normalized.client_temp_id ?? normalized.clientTempId ?? normalized.temp_id ?? null
  if (clientTempId != null && String(clientTempId).trim() !== "") {
    normalized.client_temp_id = String(clientTempId).trim()
  }

  return normalized
}

/**
 * Encerrada/reaberta podem vir como `{ conversa: {...}, lista_realtime }`.
 * @param {unknown} payload
 */
function unwrapSocketChatPayload(payload) {
  if (!payload || typeof payload !== "object") return payload
  const conv = /** @type {any} */ (payload).conversa
  if (conv && typeof conv === "object" && (conv.id != null || conv.conversa_id != null)) {
    const cid = conv.id ?? conv.conversa_id
    return {
      ...conv,
      id: cid,
      lista_realtime: /** @type {any} */ (payload).lista_realtime ?? conv.lista_realtime,
    }
  }
  return payload
}

/**
 * Mudanças que exigem alinhar lista lateral + aba Minha fila com GET /chats.
 * @param {unknown} payload
 */
function payloadImpactaListaLateral(payload) {
  if (!payload || typeof payload !== "object") return false
  const lr = /** @type {any} */ (payload).lista_realtime
  if (lr && lr.minha_fila === true) return true
  if (lr && typeof lr === "object") {
    const m = lr.motivo ?? lr.motivo_lista ?? lr.motivos
    if (
      m === "manual_aguardando_cliente" ||
      m === "manual_retomar_em_atendimento"
    )
      return true
    if (
      Array.isArray(m) &&
      m.some(
        (x) =>
          x === "manual_aguardando_cliente" ||
          x === "manual_retomar_em_atendimento"
      )
    )
      return true
  }
  if (Object.prototype.hasOwnProperty.call(payload, "status_atendimento")) return true
  if (Object.prototype.hasOwnProperty.call(payload, "status_atendimento_real")) return true
  if (Object.prototype.hasOwnProperty.call(payload, "atendente_id")) return true
  if (Object.prototype.hasOwnProperty.call(payload, "departamento_id")) return true
  if (Object.prototype.hasOwnProperty.call(payload, "aguardando_cliente_desde")) return true
  if (Object.prototype.hasOwnProperty.call(payload, "modo_simples_aguardando")) return true
  return false
}

/** GET /chats ainda necessário mesmo se o merge local não alterou o card (ex.: Minha fila). */
function payloadForcaResyncLista(payload) {
  const lr = /** @type {any} */ (payload)?.lista_realtime
  return !!(lr && lr.minha_fila === true)
}

/**
 * Pede GET /chats quando fila/setor/atendente exige alinhar lista + Minha fila.
 * @returns {boolean} true se requestChatListResync foi chamado
 */
function requestChatListResyncIfLateralImpact(payload, listRowChanged) {
  if (
    payloadImpactaListaLateral(payload) &&
    (listRowChanged !== false || payloadForcaResyncLista(payload))
  ) {
    useChatStore.getState().requestChatListResync()
    return true
  }
  return false
}

function isGroupPayload(payload) {
  const tipo = String(payload?.tipo || "").toLowerCase()
  return payload?.is_group === true || tipo === "grupo" || String(payload?.telefone || "").includes("@g.us")
}

function shouldBeInMinhaFilaForCurrentUser(payload) {
  if (!payload || isGroupPayload(payload)) return false
  const myId = getCurrentUserId()
  const status = String(
    payload.status_atendimento_real ?? payload.status_atendimento ?? ""
  ).toLowerCase()
  const atendenteId = payload.atendente_id

  if (status === "fechada" || status === "encerrada" || status === "mensagem_disparada") return false
  if (status === "em_atendimento" || status === "aguardando_cliente" || status === "pagamento_pendente" || status === "em_atraso") {
    return myId != null && atendenteId != null && String(atendenteId) === String(myId)
  }
  if (status === "aberta") {
    if (atendenteId != null && myId != null && String(atendenteId) !== String(myId)) return false
    return payload.exibir_badge_aberta !== false
  }
  return false
}

function buildModoSimplesListRowFromPayload(payload, id) {
  if (!payload || id == null || id === "") return null
  const preview = payload.ultima_mensagem_preview ?? payload.ultima_mensagem ?? null
  const row = {
    id,
    contato_nome: payload.contato_nome ?? payload.nome_contato_cache ?? undefined,
    foto_perfil: payload.foto_perfil ?? undefined,
    ultima_mensagem: preview ?? undefined,
    ultima_mensagem_preview: preview ?? undefined,
    ultima_atividade: payload.ultima_atividade ?? preview?.criado_em ?? undefined,
    telefone: payload.telefone ?? undefined,
    cliente_id: payload.cliente_id ?? undefined,
    status_atendimento: payload.status_atendimento ?? undefined,
    unread_count: payload.unread_count ?? undefined,
    atendimento_modo_simples: payload.atendimento_modo_simples === true ? true : undefined,
  }
  if ("modo_simples_aguardando" in payload) row.modo_simples_aguardando = payload.modo_simples_aguardando
  if ("lida" in payload) row.lida = payload.lida
  if ("tem_novas_mensagens" in payload) row.tem_novas_mensagens = payload.tem_novas_mensagens
  if (!preview && !("modo_simples_aguardando" in payload)) return null
  return row
}

function upsertModoSimplesListRowFromPayload(chatStore, payload, id) {
  if (!isEmpresaModoSimplesAtivoCliente() || !payloadImpactaListaLateral(payload)) return false
  const chats = chatStore.chats || []
  if (chats.some((c) => String(c?.id) === String(id))) return false
  // Não inventar row a partir do payload — só após GET autorizado (escopo setor/atendente).
  void addChatIfAuthorized(chatStore, id)
  return false
}

/**
 * Adiciona conversa à lista somente se o backend autorizar (GET /chats/:id).
 * Evita vazamento visual entre setores via socket.
 */
async function addChatIfAuthorized(chatStore, conversaId) {
  if (conversaId == null || conversaId === "") return false
  const chats = chatStore.chats || []
  if (chats.some((c) => String(c?.id) === String(conversaId))) return false
  try {
    const data = await fetchChatById(conversaId)
    const chat = data?.conversa ?? data
    if (!chat?.id) return false
    // Re-checar: outra race pode ter inserido enquanto o fetch rodava
    const latest = chatStore.chats || []
    if (latest.some((c) => String(c?.id) === String(chat.id))) {
      chatStore.updateChat(chat)
      return true
    }
    chatStore.addChat(chat)
    return true
  } catch (_) {
    return false
  }
}

function emitMinhaFilaOptimisticMutation(rawPayload) {
  const payload = unwrapSocketChatPayload(rawPayload)
  const id = payload?.id ?? payload?.conversa_id
  if (id == null || id === "") return
  if (!payloadImpactaListaLateral(payload)) return

  const myId = getCurrentUserId()
  const lr = payload?.lista_realtime && typeof payload.lista_realtime === "object" ? payload.lista_realtime : null
  const motivo = String(lr?.motivo ?? payload?.motivo ?? "")
  const patch = {
    ...payload,
    id,
    ui_status_optimistic_at: Date.now(),
  }
  if (
    !patch.status_atendimento &&
    lr?.minha_fila === true &&
    (motivo === "recebeu_transferencia" || motivo === "transferencia_recebida") &&
    myId != null
  ) {
    patch.status_atendimento = "em_atendimento"
    patch.status_atendimento_real = "em_atendimento"
    patch.atendente_id = myId
  }
  const chatStore = useChatStore.getState()
  const existingRow = (chatStore.chats || []).find((c) => String(c?.id) === String(id))
  const decisionRow = existingRow ? { ...existingRow, ...patch } : patch
  const inMinhaFila = shouldBeInMinhaFilaForCurrentUser(decisionRow)
  useChatStore.getState().emitChatListOptimisticMutation({
    id,
    patch,
    removeFromMinhaFila: !inMinhaFila,
    restoreMinhaFila: inMinhaFila,
    row: decisionRow,
  })
}

function getMessagesScrollMetrics() {
  if (typeof document === "undefined") return null
  const container = document.querySelector(".wa-messages")
  if (!container) return null
  return {
    scrollTop: Number(container.scrollTop || 0),
    scrollHeight: Number(container.scrollHeight || 0),
    clientHeight: Number(container.clientHeight || 0),
  }
}

function logSocketConversaDebug(eventName, payload) {
  const selectedId = useConversaStore.getState().selectedId
  const payloadId = payload?.id ?? payload?.conversa_id ?? null
  if (selectedId == null || payloadId == null) return
  if (String(selectedId) !== String(payloadId)) return
  if (!import.meta.env.DEV) return
  console.debug(`[scroll-debug] socket:${eventName}`, {
    conversaId: payloadId,
    metrics: getMessagesScrollMetrics(),
  })
}

function logSocketMessageBoundary(eventName, payload) {
  if (!import.meta?.env?.DEV) return
  console.debug(`[message-boundary] socket:${eventName}`, {
    conversa_id: payload?.conversa_id ?? payload?.id_conversa ?? payload?.conversation_id,
    atendimento_id: payload?.atendimento_id,
    cliente_id: payload?.cliente_id,
    phone: payload?.phone ?? payload?.telefone ?? payload?.remetente_telefone ?? payload?.chatId,
    message_id: payload?.id ?? payload?.mensagem_id ?? payload?.message_id ?? payload?.whatsapp_id,
    selected_conversation_id: useConversaStore.getState().selectedId,
  })
}

let socket = null
let pushProbeCache = { at: 0, value: false }
/** Ref para idempotência de join — evita joins duplicados ao reconectar ou trocar conversa */
let currentConversationId = null
let socketAwakeListenersBound = false
let onWindowFocusReconnect = null
let onWindowOnlineReconnect = null
let onWindowPageShowReconnect = null
let onVisibilityReconnect = null

function tryReconnectSocket(reason) {
  if (!socket) return
  if (socket.connected || socket.active) return
  try {
    socket.connect()
    if (import.meta.env.DEV) {
      console.debug("[socket] reconnect trigger:", reason)
    }
  } catch (_) {}
}

async function shouldSkipLocalIncomingNotification() {
  if (typeof document === "undefined") return false
  if (document.visibilityState === "visible") return false
  // Desktop: sempre tentar Notification API em segundo plano (comportamento tipo WhatsApp Web).
  // Evita depender só do Web Push no PC, onde o alerta nativo costuma ser o que o utilizador espera.
  if (!shouldDeferLocalNotificationToWebPush()) return false
  const now = Date.now()
  if (now - pushProbeCache.at < 10_000) return pushProbeCache.value
  const active = await hasActivePushSubscription()
  pushProbeCache = { at: now, value: active }
  return active
}

function bindSocketAwakeListeners() {
  if (socketAwakeListenersBound) return
  socketAwakeListenersBound = true
  if (typeof window === "undefined" || typeof document === "undefined") return

  onWindowFocusReconnect = () => tryReconnectSocket("window_focus")
  onWindowOnlineReconnect = () => tryReconnectSocket("online")
  onWindowPageShowReconnect = () => tryReconnectSocket("pageshow")
  onVisibilityReconnect = () => {
    if (document.visibilityState === "visible") tryReconnectSocket("visibility_visible")
  }

  window.addEventListener("focus", onWindowFocusReconnect)
  window.addEventListener("online", onWindowOnlineReconnect)
  window.addEventListener("pageshow", onWindowPageShowReconnect)
  document.addEventListener("visibilitychange", onVisibilityReconnect)
}

function unbindSocketAwakeListeners() {
  if (typeof window === "undefined" || typeof document === "undefined") return
  if (onWindowFocusReconnect) window.removeEventListener("focus", onWindowFocusReconnect)
  if (onWindowOnlineReconnect) window.removeEventListener("online", onWindowOnlineReconnect)
  if (onWindowPageShowReconnect) window.removeEventListener("pageshow", onWindowPageShowReconnect)
  if (onVisibilityReconnect) document.removeEventListener("visibilitychange", onVisibilityReconnect)
  onWindowFocusReconnect = null
  onWindowOnlineReconnect = null
  onWindowPageShowReconnect = null
  onVisibilityReconnect = null
}

/** Emite leave da sala atual. Sempre usar antes de join em outra conversa. */
export function leaveConversa(id) {
  if (!id) return
  const s = String(id)
  if (currentConversationId === s) currentConversationId = null
  try {
    if (socket) socket.emit("leave_conversa", id)
  } catch (_) {}
}

/** Join idempotente: só emite se ainda não está na sala X. */
export function joinConversaIfNeeded(id) {
  if (!socket || !id) return
  const s = String(id)
  if (currentConversationId === s) return
  currentConversationId = s
  socket.emit("join_conversa", id)
}

/** Aplica um evento status_mensagem normalizado (conversa aberta + lista). */
function applyStatusMensagemEvent(evt) {
  const { mensagem_id, conversa_id, status: s, whatsapp_id, em_retry } = evt

  const convStore = useConversaStore.getState()
  const partial = { status_mensagem: s, status: s }
  if (whatsapp_id) partial.whatsapp_id = whatsapp_id
  if (em_retry != null) partial.em_retry = em_retry

  const selectedId = convStore.selectedId
  const isConversaAberta = selectedId != null
  const conversaIdMatch = conversa_id && String(conversa_id) === String(selectedId)
  if (isConversaAberta && conversaIdMatch) {
    convStore.patchMensagem(mensagem_id, partial, {
      conversa_id,
      whatsapp_id,
    })
  }

  if (conversa_id) {
    const chatStore = useChatStore.getState()
    const chats = chatStore.chats || []
    const idx = chats.findIndex((c) => String(c.id) === String(conversa_id))
    if (idx >= 0) {
      const cur = chats[idx]
      const u = cur?.ultima_mensagem
      const msgs = cur?.mensagens || cur?.messages || []
      const lastFromArray = Array.isArray(msgs) && msgs.length > 0 ? msgs[msgs.length - 1] : null
      const matchById = (m) => mensagem_id && String(m?.id) === String(mensagem_id)
      const matchByWa = (m) => whatsapp_id && String(m?.whatsapp_id) === String(whatsapp_id)
      const match = (m) => m && (matchById(m) || matchByWa(m))

      let targetMsg = null
      if (u && match(u)) targetMsg = u
      else if (lastFromArray && match(lastFromArray)) targetMsg = lastFromArray

      if (targetMsg) {
        const nextUm = { ...targetMsg, status_mensagem: s, status: s }
        if (whatsapp_id) nextUm.whatsapp_id = whatsapp_id
        if (em_retry != null) nextUm.em_retry = em_retry
        if (
          !(
            ultimaMensagemRefsEqual(targetMsg, nextUm) &&
            normalizeMensagemStatusKey(targetMsg) === normalizeMensagemStatusKey(nextUm)
          )
        ) {
          chatStore.setUltimaMensagem(conversa_id, nextUm)
        }
      }
    }
  }
}

export function initSocket(token) {
  if (socket) {
    const currentToken = socket.auth?.token
    if (currentToken === token) return socket
    disconnectSocket()
  }

  const base = getApiBaseUrl()

  socket = io(base, {
    auth: { token },
    transports: ["websocket", "polling"],
    reconnectionDelay: 500,
    reconnectionDelayMax: 3000,
  })

  if (import.meta.env.DEV) {
    socket.on("connect", () => {
      if (import.meta.env.DEV) console.debug("Socket conectado:", socket.id)
    })
    socket.on("disconnect", () => {
      if (import.meta.env.DEV) console.debug("Socket desconectado")
    })
  }

  resetStatusMensagemBatch()

  // Listeners idempotentes: remove antes de registrar (evita duplicar ao re-init)
  const off = (ev) => { try { socket?.off(ev) } catch (_) {} }
  off("typing_start")
  off("typing_stop")
  off("tag_adicionada")
  off("tag_removida")
  off("nova_conversa")
  off(SOCKET_EVENTS.MENSAGEM_INTERNA_ATENDIMENTO)
  off(SOCKET_EVENTS.NOVA_MENSAGEM)
  off("mensagem_excluida")
  off("mensagem_editada")
  off("mensagem_oculta")
  off("status_mensagem")
  off("mensagens_lidas")
  off("alerta_sem_resposta")
  off("alerta_sem_resposta_evento")
  off("zapi_sync_contatos")
  off("whatsapp_sync_mensagens_antigas")
  off("conversa_atualizada")
  off("conversa_prefs_atualizada")
  off("conversa_apagada")
  off("conversa_encerrada")
  off(SOCKET_EVENTS.CONVERSA_TRANSFERIDA)
  off("conversa_reaberta")
  off(SOCKET_EVENTS.CONVERSA_ATRIBUIDA)
  off("atualizar_conversa")
  off("contato_atualizado")

  socket.on("connect", () => {
    currentConversationId = null
    const companyId = getCurrentCompanyId()
    if (companyId != null) {
      try {
        socket.emit("join_empresa", { company_id: companyId, empresa_id: companyId })
      } catch (_) {}
    }
    const convId = useConversaStore.getState().selectedId
    if (convId) {
      joinConversaIfNeeded(convId)
      try {
        useConversaStore.getState().refresh?.({ silent: true })
      } catch (_) {}
    }
    useChatStore.getState().requestChatListResync?.({ force: true })
    updateDocumentTitleFromChats()
  })

  /* ===========================
     INDICADOR DE DIGITAÇÃO
  =========================== */
  socket.on("typing_start", (payload = {}) => {
    const { conversa_id, usuario_id, nome } = payload
    if (!conversa_id) return
    if (shouldIgnoreByCompany(payload)) return
    const _cid = String(conversa_id)
    useConversaStore.getState().setTyping(conversa_id, { usuario_id, nome })
    if (typingExpiryTimers.has(_cid)) clearTimeout(typingExpiryTimers.get(_cid))
    typingExpiryTimers.set(_cid, setTimeout(() => {
      typingExpiryTimers.delete(_cid)
      useConversaStore.getState().clearTyping(conversa_id)
    }, TYPING_EXPIRY_MS))
  })

  socket.on("typing_stop", (payload = {}) => {
    const { conversa_id } = payload
    if (!conversa_id) return
    if (shouldIgnoreByCompany(payload)) return
    const _cid = String(conversa_id)
    if (typingExpiryTimers.has(_cid)) {
      clearTimeout(typingExpiryTimers.get(_cid))
      typingExpiryTimers.delete(_cid)
    }
    useConversaStore.getState().clearTyping(conversa_id)
  })

  /* ===========================
     TAGS
  =========================== */
  socket.on("tag_adicionada", (payload = {}) => {
    const { conversa_id, tag } = payload
    if (!conversa_id) return
    if (shouldIgnoreByCompany(payload)) return

    useChatStore.getState().adicionarTag(conversa_id, tag)

    const convStore = useConversaStore.getState()
    if (String(convStore.selectedId) === String(conversa_id)) {
      const currentTags = convStore.tags || []
      const nextTags = currentTags.some((t) => String(t.id) === String(tag?.id))
        ? currentTags
        : [...currentTags, tag]
      convStore.setTags(nextTags)
    }
  })

  socket.on("tag_removida", (payload = {}) => {
    const { conversa_id, tag_id } = payload
    if (!conversa_id || !tag_id) return
    if (shouldIgnoreByCompany(payload)) return

    useChatStore.getState().removerTag(conversa_id, tag_id)

    const convStore = useConversaStore.getState()
    if (String(convStore.selectedId) === String(conversa_id)) {
      convStore.setTags((convStore.tags || []).filter(t => String(t.id) !== String(tag_id)))
    }
  })

  /* Nova conversa criada (ex.: primeira mensagem via webhook) — só adiciona se API autorizar */
  socket.on("nova_conversa", (payload) => {
    if (!payload?.id) return
    if (shouldIgnoreByCompany(payload)) return
    void addChatIfAuthorized(useChatStore.getState(), payload.id)
  })

  socket.on(SOCKET_EVENTS.MENSAGEM_INTERNA_ATENDIMENTO, (rawMsg) => {
    if (!canViewInternalAttendanceMessage()) return
    const msg = normalizeNovaMensagemPayload(rawMsg)
    const conversaId = msg?.conversa_id
    if (!conversaId) return
    if (shouldIgnoreByCompany(msg)) return

    const convStore = useConversaStore.getState()
    if (!convStore.selectedId || String(convStore.selectedId) !== String(conversaId)) return
    if (convStore.conversa?.mensagens_bloqueadas && String(convStore.conversa?.id) === String(conversaId)) return
    convStore.anexarMensagem(msg)
  })

  /* ===========================
     🔥 NOVA MENSAGEM (COM SOM + BADGE) — de-dup por whatsapp_id
  =========================== */
  socket.on(SOCKET_EVENTS.NOVA_MENSAGEM, (rawMsg) => {
    let msg = normalizeNovaMensagemPayload(rawMsg)
    logSocketMessageBoundary(SOCKET_EVENTS.NOVA_MENSAGEM, msg)
    const conversaId = msg?.conversa_id
    if (!conversaId) return
    if (shouldIgnoreByCompany(msg)) return

    const chatStore = useChatStore.getState()
    const convStore = useConversaStore.getState()
    const chats = chatStore.chats || []
    const jaNaLista = chats.some(c => String(c.id) === String(conversaId))

    /* Não fazer early-return por "jaExiste": anexarMensagem faz UPSERT — merge status/whatsapp_id se já existir */

    // Nome/foto do CONTATO (quem estamos conversando): usar sempre que vier no payload
    // Inbound: pushname do remetente. Outbound (envio pelo celular): sync UltraMSG traz nome/foto do destinatário
    const isOutbound = msg?.direcao === "out" || msg?.fromMe
    const nomeContato = (msg.chatName && String(msg.chatName).trim() && String(msg.chatName).trim() !== "name")
      ? String(msg.chatName).trim()
      : (msg.senderName && String(msg.senderName).trim() && String(msg.senderName).trim() !== "name")
        ? String(msg.senderName).trim()
        : null
    const fotoContato = (msg.senderPhoto && String(msg.senderPhoto).trim().startsWith("http")) ? String(msg.senderPhoto).trim()
      : (msg.photo && String(msg.photo).trim().startsWith("http")) ? String(msg.photo).trim()
        : null

    if (!jaNaLista) {
      // Não adicionar row inventada pelo socket — fetch autorizado (setor/atendente).
      // Preview/unread/bump só aplicam se a conversa já estiver na lista (setUltimaMensagemEBump no-op se idx<0).
      void addChatIfAuthorized(chatStore, conversaId).then((added) => {
        if (!added) return
        const store = useChatStore.getState()
        // O GET /chats/:id acabou de trazer unread_count do servidor; se a ultima_mensagem
        // retornada já é esta msg, o contador já a inclui — incrementar duplicaria o badge.
        const fetchedRow = (store.chats || []).find((c) => String(c?.id) === String(conversaId))
        const um = fetchedRow?.ultima_mensagem
        const serverJaContou = !!um && (
          (msg?.id != null && um?.id != null && String(um.id) === String(msg.id)) ||
          (msg?.whatsapp_id && um?.whatsapp_id && String(um.whatsapp_id) === String(msg.whatsapp_id))
        )
        if (typeof store.setUltimaMensagemEBump === "function") {
          store.setUltimaMensagemEBump(conversaId, msg)
        }
        if (!msg.fromMe && msg.direcao === "in" && !serverJaContou) {
          const isOpen =
            useConversaStore.getState().selectedId &&
            String(useConversaStore.getState().selectedId) === String(conversaId)
          if (!isOpen && typeof store.incUnreadComBadge === "function") {
            store.incUnreadComBadge(conversaId, 1)
          }
        }
        updateDocumentTitleFromChats()
      })
    } else {
      // Só preenche quando vazio — nome NUNCA troca uma vez definido
      if (nomeContato || fotoContato) {
        chatStore.updateChatContato(conversaId, {
          contato_nome: nomeContato || undefined,
          foto_perfil: fotoContato || undefined
        })
      }
      // Grupos: preencher nome_grupo quando vier na mensagem e o chat ainda não tiver
      const isGroup = msg?.isGroup || msg?.is_group || String(msg?.chatId ?? msg?.remoteJid ?? "").endsWith("@g.us")
      if (isGroup && nomeContato && String(nomeContato).trim() && String(nomeContato).toLowerCase() !== "name") {
        const chats = chatStore.chats || []
        const c = chats.find((x) => String(x.id) === String(conversaId))
        const nomeGrupoAtual = c?.nome_grupo
        if (!nomeGrupoAtual || !String(nomeGrupoAtual).trim() || String(nomeGrupoAtual).toLowerCase().startsWith("lid:")) {
          chatStore.updateChat({ id: conversaId, nome_grupo: nomeContato.trim(), is_group: true })
        }
      }
    }

    const modoSimplesRowPatch = applyModoSimplesOptimisticFromMessage(conversaId, msg)

    if (typeof chatStore.setUltimaMensagemEBump === "function") {
      chatStore.setUltimaMensagemEBump(conversaId, msg, modoSimplesRowPatch)
    } else {
      chatStore.setUltimaMensagem(conversaId, msg)
      if (modoSimplesRowPatch) chatStore.updateChat({ id: conversaId, ...modoSimplesRowPatch })
      chatStore.bumpChatToTop(conversaId)
    }

    applyRetomadaSeAguardandoPorMensagemRecebida(conversaId, msg)

    const isAberta =
      convStore.selectedId &&
      String(convStore.selectedId) === String(conversaId)

    const notificationDecision = shouldNotifyIncomingMessage({
      msg,
      selectedConversationId: convStore.selectedId,
      currentPathname: typeof window !== "undefined" ? window.location?.pathname : "",
    })
    const chatsLatest = chatStore.chats || []
    const chatAtual = chatsLatest.find((c) => String(c.id) === String(conversaId))
    const myUserId = getCurrentUserId()
    const canNotifyForThisConversation = canNotifyByConversationOwnership(chatAtual, myUserId)
    if (notificationDecision.notify && canNotifyForThisConversation) {
      const contato = getChatDisplayName(conversaId)
      const avatarUrl =
        chatAtual?.foto_perfil ||
        chatAtual?.foto_grupo ||
        chatAtual?.foto_perfil_contato_cache ||
        msg?.senderPhoto ||
        msg?.photo ||
        null
      const suppressPing = consumeSuppressNovaMensagemSound(conversaId)
      if (!suppressPing) {
        playNotificationSound()
      }
      void (async () => {
        if (await shouldSkipLocalIncomingNotification()) return
        await notifyIncomingDesktopMessage({
          msg,
          contatoNome: contato,
          avatarUrl,
        })
      })().catch(() => {})
    }

    /* ----------------------------------
       🔔 Atualizações de contador/título somente se conversa NÃO aberta
       incUnread só para direcao 'in' (mensagem recebida)
    ---------------------------------- */
    if (!isAberta) {
      if (jaNaLista && !msg.fromMe && msg.direcao === "in") {
        if (typeof chatStore.incUnreadComBadge === "function") {
          chatStore.incUnreadComBadge(conversaId, 1)
        } else {
          chatStore.incUnread(conversaId, 1)
        }
      }
      updateDocumentTitleFromChats()
      return
    }

    /* ----------------------------------
       conversa aberta → anexar msg e limpar indicador de digitação
       Ignora quando mensagens_bloqueadas (conversa assumida por outro atendente)
    ---------------------------------- */
    const convAberta = convStore.conversa
    if (convAberta?.mensagens_bloqueadas && String(convAberta?.id) === String(conversaId)) {
      return
    }
    convStore.clearTyping(conversaId)
    convStore.anexarMensagem(msg)
    if (!msg.fromMe && msg.direcao === "in" && !isEmpresaModoSimplesAtivoCliente()) {
      try {
        socket.emit("marcar_conversa_lida", { conversa_id: conversaId })
      } catch (_) {}
    }
  })

  /* ===========================
     🗑️ MENSAGEM EXCLUÍDA (realtime)
  =========================== */
  socket.on("mensagem_excluida", (payload = {}) => {
    const { conversa_id, mensagem_id, ultima_mensagem } = payload
    if (!conversa_id || !mensagem_id) return
    if (shouldIgnoreByCompany(payload)) return

    const chatStore = useChatStore.getState()
    chatStore.setUltimaMensagem(conversa_id, ultima_mensagem || null)

    const convStore = useConversaStore.getState()
    if (convStore.selectedId && String(convStore.selectedId) === String(conversa_id)) {
      convStore.marcarMensagemApagadaParaTodos(mensagem_id)
    }
  })

  /* ===========================
     ✏️ MENSAGEM EDITADA (WhatsApp)
     Atualiza apenas o texto da mensagem pelo id — nunca remove ou reordena
  =========================== */
  socket.on("mensagem_editada", (msg) => {
    if (!msg?.id) return
    if (shouldIgnoreByCompany(msg)) return
    const convStore = useConversaStore.getState()
    const selectedId = convStore.selectedId
    if (!selectedId) return
    const conversaId = msg?.conversa_id
    if (!conversaId || String(conversaId) !== String(selectedId)) return
    convStore.patchMensagem(msg.id, {
      texto: msg.texto ?? msg.conteudo,
      conteudo: msg.conteudo ?? msg.texto,
      editado: true,
    }, { conversa_id: conversaId })
  })

  /* Mensagem ocultada "pra mim" (somente usuário) */
  socket.on("mensagem_oculta", (payload = {}) => {
    const { conversa_id, mensagem_id } = payload
    if (!conversa_id || !mensagem_id) return
    if (shouldIgnoreByCompany(payload)) return
    const convStore = useConversaStore.getState()
    if (convStore.selectedId && String(convStore.selectedId) === String(conversa_id)) {
      convStore.removerMensagem(mensagem_id)
    }
  })

  /* ===========================
     ✅ STATUS DA MENSAGEM (Z-API) — fallback por whatsapp_id
     Sincroniza ticks em tempo real: conversa aberta + lista de chats
     Rajadas: fila 75ms + dedupe por mensagem (ver statusMensagemBatch.js)
  =========================== */
  socket.on("status_mensagem", (payload) => {
    enqueueStatusMensagemEvent(payload, applyStatusMensagemEvent, shouldIgnoreByCompany)
  })

  /* ===========================
     MENSAGENS LIDAS (igual WhatsApp: ao abrir a conversa marca como lida e remove notificação)
  =========================== */
  socket.on("mensagens_lidas", (payload = {}) => {
    const { conversa_id } = payload
    if (!conversa_id) return
    if (shouldIgnoreByCompany(payload)) return
    useChatStore.getState().setUnread(conversa_id, 0)
     // Limpa badges e flags de novas mensagens após o backend marcar como lida
    useChatStore.getState().updateChat({
      id: conversa_id,
      tem_novas_mensagens: false,
      tem_novas_mensagens_em_atendimento: false,
      lida: true,
      unread_count: 0,
    })
    updateDocumentTitleFromChats()
  })

  const alertaSemRespostaDedup = new Map()
  const ALERTA_SEM_RESPOSTA_DEDUP_MS = 8_000

  function shouldSkipDuplicateAlertaSemResposta(payload) {
    const key = `${payload?.conversa_id ?? ""}:${payload?.tipo ?? ""}:${payload?.nivel ?? ""}`
    const now = Date.now()
    const exp = alertaSemRespostaDedup.get(key)
    if (exp != null && now < exp) return true
    alertaSemRespostaDedup.set(key, now + ALERTA_SEM_RESPOSTA_DEDUP_MS)
    return false
  }

  function handleAlertaSemResposta(payload = {}, channel = "direto") {
    if (!payload?.conversa_id) return
    if (shouldIgnoreByCompany(payload)) return

    const myId = getCurrentUserId()
    const atendenteId =
      payload?.atendente_id != null && String(payload.atendente_id).trim() !== ""
        ? String(payload.atendente_id)
        : null
    // Backend emite `alerta_sem_resposta` na sala do atendente e `alerta_sem_resposta_evento` na empresa.
    if (channel === "evento" && atendenteId && myId && atendenteId === myId) return
    if (shouldSkipDuplicateAlertaSemResposta(payload)) return

    const tipo = String(payload.tipo || "")
    const isCritical = payload.nivel === "critico" || tipo === "alerta_critico"
    const isManager = payload.nivel === "gestor" || tipo === "gestor_notificado"
    playNotificationSound()
    useNotificationStore.getState().showToast({
      type: isCritical ? "warning" : "info",
      title: isManager ? "Gestor notificado" : (isCritical ? "Alerta critico" : "Atendimento sem resposta"),
      message: payload.mensagem || "Uma conversa esta aguardando resposta.",
      actionLabel: "Abrir",
      onAction: () => {
        if (typeof window !== "undefined") {
          window.location.href = `/atendimento?conversa=${encodeURIComponent(payload.conversa_id)}`
        }
      },
    })
  }

  socket.on("alerta_sem_resposta", (payload = {}) => handleAlertaSemResposta(payload, "direto"))
  socket.on("alerta_sem_resposta_evento", (payload = {}) => handleAlertaSemResposta(payload, "evento"))

  /* ===========================
     Z-API: SYNC DE CONTATOS FINALIZADO (auto)
     Toast apenas no início da sessão (primeira sincronização após conectar)
  =========================== */
  let syncToastJaMostradoNestaSessao = false
  socket.on("zapi_sync_contatos", (payload) => {
    try {
      const p = payload || {}
      const total = p.total_contatos ?? 0
      const criados = p.criados ?? 0
      const atualizados = p.atualizados ?? 0
      if (!syncToastJaMostradoNestaSessao) {
        syncToastJaMostradoNestaSessao = true
        useNotificationStore.getState().showToast({
          type: "success",
          title: "UltraMSG",
          message: `Contatos sincronizados: ${total} (${criados} novos, ${atualizados} atualizados).`,
        })
      }
    } catch (_) {}

    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      try {
        window.dispatchEvent(new CustomEvent("zapi_sync_contatos", { detail: payload }))
      } catch (_) {}
    }
  })

  socket.on("whatsapp_sync_mensagens_antigas", (payload) => {
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      try {
        window.dispatchEvent(new CustomEvent("whatsapp_sync_mensagens_antigas", { detail: payload }))
      } catch (_) {}
    }
    try {
      useChatStore.getState().requestChatListResync?.()
    } catch (_) {}
    try {
      const convStore = useConversaStore.getState()
      if (convStore.selectedId && typeof convStore.refresh === "function") {
        convStore.refresh({ silent: true })
      }
    } catch (_) {}
  })

  /* ===========================
     STATUS / AÇÕES DE ATENDIMENTO
     conversa_atualizada: merge defensivo na lista; NUNCA refetchar mensagens do chat aberto
     ultima_mensagem_preview: só preview na lista — NUNCA adicionar às mensagens do chat (não tem id)
  =========================== */
  function mergeSetorEAtendenteNoAlvo(alvo, payload) {
    if ("departamento_id" in payload) alvo.departamento_id = payload.departamento_id
    if ("atendente_id" in payload) alvo.atendente_id = payload.atendente_id
    if ("atendente_nome" in payload) alvo.atendente_nome = payload.atendente_nome
    if ("departamento" in payload) alvo.departamento = payload.departamento
    if ("departamento_id" in payload && payload.departamento_id == null) {
      alvo.setor = null
      alvo.departamento = null
      alvo.departamentos = null
    }
  }

  function handleConversaAtualizada(rawPayload) {
    const payload = unwrapSocketChatPayload(rawPayload)
    const id = payload?.id ?? payload?.conversa_id
    if (!id) return
    if (shouldIgnoreByCompany(payload)) return
    logSocketConversaDebug("conversa_atualizada", payload)
    emitMinhaFilaOptimisticMutation(payload)
    const chatStore = useChatStore.getState()
    const chats = chatStore.chats || []
    const idx = chats.findIndex((c) => String(c.id) === String(id))
    let listRowChanged = idx < 0
    if (idx < 0) {
      listRowChanged = upsertModoSimplesListRowFromPayload(chatStore, payload, id) || listRowChanged
    }
    if (idx >= 0) {
      const cur = chats[idx]
      const next = { ...cur }
      if (payload.ultima_atividade != null) next.ultima_atividade = payload.ultima_atividade
      if (payload.contato_nome != null && payload.contato_nome !== "") next.contato_nome = payload.contato_nome
      if (payload.nome_contato_cache != null && payload.nome_contato_cache !== "") next.nome_contato_cache = payload.nome_contato_cache
      if (payload.foto_perfil != null && payload.foto_perfil !== "") next.foto_perfil = payload.foto_perfil
      if (payload.foto_perfil_contato_cache != null && payload.foto_perfil_contato_cache !== "") next.foto_perfil_contato_cache = payload.foto_perfil_contato_cache
      if (payload.status_atendimento != null) next.status_atendimento = payload.status_atendimento
      if ("status_atendimento_real" in payload) next.status_atendimento_real = payload.status_atendimento_real
      if (payload.telefone != null) next.telefone = payload.telefone
      if (payload.cliente_id != null) next.cliente_id = payload.cliente_id
      if (payload.exibir_badge_aberta !== undefined) next.exibir_badge_aberta = !!payload.exibir_badge_aberta
      mergeSetorEAtendenteNoAlvo(next, payload)
      if (payload.ultima_mensagem_preview != null) {
        next.ultima_mensagem_preview = payload.ultima_mensagem_preview
        next.ultima_mensagem = payload.ultima_mensagem_preview
        if (payload.ultima_mensagem_preview?.criado_em) next.ultima_atividade = payload.ultima_mensagem_preview.criado_em
      }
      if (payload.ultima_mensagem != null && !payload.ultima_mensagem?.id) {
        next.ultima_mensagem_preview = payload.ultima_mensagem
        next.ultima_mensagem = payload.ultima_mensagem
        if (payload.ultima_mensagem?.criado_em) next.ultima_atividade = payload.ultima_mensagem.criado_em
      }
      if (payload.tem_novas_mensagens === true) {
        next.tem_novas_mensagens = true
        next.lida = false
      }
      if (payload.tem_novas_mensagens_em_atendimento !== undefined) {
        next.tem_novas_mensagens_em_atendimento = !!payload.tem_novas_mensagens_em_atendimento
      }
      const ausenciaKeys = [
        "finalizacao_motivo",
        "finalizada_automaticamente",
        "finalizada_automaticamente_em",
        "aguardando_cliente_desde",
        "ausencia_mensagem_enviada_em",
      ]
      for (const k of ausenciaKeys) {
        if (k in payload) next[k] = payload[k]
      }
      if ('modo_simples_aguardando' in payload) next.modo_simples_aguardando = payload.modo_simples_aguardando
      if (payload.atendimento_modo_simples === true) next.atendimento_modo_simples = true
      if ('unread_count' in payload) next.unread_count = payload.unread_count
      if ('lida' in payload) next.lida = payload.lida
      if (payload.tem_novas_mensagens === false) next.tem_novas_mensagens = false
      const prevSt = String(cur?.status_atendimento_real ?? cur?.status_atendimento ?? '').toLowerCase()
      const nextSt = String(payload?.status_atendimento ?? next.status_atendimento ?? '').toLowerCase()
      const mot = String(cur?.finalizacao_motivo ?? '').toLowerCase()
      const reaberturaAusenciaCliente =
        prevSt === 'fechada' &&
        mot === 'ausencia_cliente' &&
        (nextSt === 'aberta' || nextSt === 'em_atendimento')
      if (reaberturaAusenciaCliente) {
        next.ui_hint_reaberto_ausencia_cliente = Date.now()
      }
      listRowChanged = chatStore.updateChat({ id, ...next })
    }
    const convStore = useConversaStore.getState()
    if (String(convStore.selectedId) === String(id)) {
      convStore.patchConversa({ ...payload, id })
    }
    if (payloadImpactaListaLateral(payload)) {
      const cur = chats[idx]
      const prevSt = cur ? String(cur?.status_atendimento_real ?? cur?.status_atendimento ?? '').toLowerCase() : ''
      const nextSt = String(payload?.status_atendimento ?? '').toLowerCase()
      const mot = cur ? String(cur?.finalizacao_motivo ?? '').toLowerCase() : ''
      const skipResyncReaberturaAusencia =
        idx >= 0 &&
        prevSt === 'fechada' &&
        mot === 'ausencia_cliente' &&
        (nextSt === 'aberta' || nextSt === 'em_atendimento')
      if (!skipResyncReaberturaAusencia) {
        requestChatListResyncIfLateralImpact(payload, listRowChanged)
      }
    }
  }

  /** @returns {Promise<boolean>} true se pediu resync da lista (GET /chats via ChatList) */
  async function patchEverywhere(rawPayload) {
    const payload = unwrapSocketChatPayload(rawPayload)
    const rawId = payload?.id ?? payload?.conversa_id
    if (rawId == null || rawId === "") return false
    const p = { ...payload, id: rawId }
    logSocketConversaDebug("patch_everywhere", p)
    emitMinhaFilaOptimisticMutation(p)
    const chatStore = useChatStore.getState()
    const chats = chatStore.chats || []
    const idx = chats.findIndex((c) => String(c.id) === String(p.id))
    let listRowChanged = idx < 0
    if (idx >= 0) {
      listRowChanged = chatStore.updateChat(p)
    } else {
      try {
        await addChatIfAuthorized(chatStore, p.id)
      } catch (_) {}
    }
    const convStore = useConversaStore.getState()
    if (String(convStore.selectedId) === String(p.id)) {
      convStore.patchConversa(p)
    }
    return requestChatListResyncIfLateralImpact(p, listRowChanged)
  }

  socket.on("conversa_atualizada", handleConversaAtualizada)
  socket.on("conversa_prefs_atualizada", (payload) => {
    const id = payload?.conversa_id ?? payload?.id
    if (!id) return
    if (shouldIgnoreByCompany(payload)) return
    useChatStore.getState().updateChat({
      id,
      ...(payload?.silenciada !== undefined ? { silenciado: !!payload.silenciada } : {}),
      ...(payload?.fixada !== undefined ? { fixada: !!payload.fixada } : {}),
      ...(payload?.favorita !== undefined ? { favorita: !!payload.favorita } : {}),
      ...(payload?.fixada_em !== undefined ? { fixada_em: payload.fixada_em } : {}),
    })
  })
  socket.on("conversa_apagada", ({ id, conversa_id } = {}) => {
    const cid = id ?? conversa_id
    if (!cid) return
    useChatStore.getState().removeChat(cid)
    const convStore = useConversaStore.getState()
    if (String(convStore.selectedId || "") === String(cid)) {
      convStore.setSelectedId(null)
      useConversaStore.setState({
        conversa: null,
        mensagens: [],
        tags: [],
      })
    }
  })
  socket.on("conversa_encerrada", (payload) => {
    logSocketConversaDebug("conversa_encerrada", payload)
    patchEverywhere(payload)
  })
  socket.on(SOCKET_EVENTS.CONVERSA_TRANSFERIDA, (payload) => {
    const myId = getCurrentUserId()
    const suppressFor = payload?.suprimir_som_nova_mensagem_para_usuario_id
    if (myId != null && suppressFor != null && String(suppressFor) === String(myId)) {
      const cid = payload?.id ?? payload?.conversa_id
      markSuppressNovaMensagemSound(cid)
    }
    patchEverywhere(payload)
  })
  socket.on("conversa_reaberta", (payload) => {
    logSocketConversaDebug("conversa_reaberta", payload)
    patchEverywhere(payload)
  })
  socket.on(SOCKET_EVENTS.CONVERSA_ATRIBUIDA, async (payload) => {
    const p0 = unwrapSocketChatPayload(payload)
    if (shouldIgnoreByCompany(p0)) return
    const convId = p0?.id ?? p0?.conversa_id
    if (convId != null && convId !== "") {
      const resyncJaPedido = await patchEverywhere({ ...p0, id: convId })
      /* Fallback: merge local noop mas fila/setor/minha_fila ainda exigem GET /chats */
      if (!resyncJaPedido && payloadImpactaListaLateral(p0)) {
        useChatStore.getState().requestChatListResync()
      }
    }
    updateDocumentTitleFromChats()

    const motivo = String(p0?.motivo || "")
    const ui = p0?.ui && typeof p0.ui === "object" ? p0.ui : {}
    const isHandoff =
      motivo === "transferencia_recebida" ||
      ui.variant === "handoff"
    if (!isHandoff) return

    const soundId = ui.soundId || "atendimento-transferido"
    playNotificationSoundById(soundId)

    if (
      Array.isArray(ui.vibratePatternMs) &&
      typeof navigator !== "undefined" &&
      typeof navigator.vibrate === "function"
    ) {
      try {
        navigator.vibrate(ui.vibratePatternMs)
      } catch (_) {}
    }

    let title = ui.titulo
    let body = ui.corpo
    if (body == null || String(body).trim() === "") {
      const prev = p0.cliente_preview
      if (prev && typeof prev === "object") {
        const parts = [prev.nome, prev.telefone].filter(Boolean)
        body = parts.length ? parts.join(" · ") : "Nova conversa atribuída a você."
      } else {
        body = "Nova conversa atribuída a você."
      }
    }
    if (title == null || String(title).trim() === "") {
      const prev = p0.cliente_preview
      title = prev?.nome ? `Atendimento: ${prev.nome}` : "Conversa atribuída a você"
    }

    const toastType = ui.variant === "handoff" ? "handoff" : "info"
    useNotificationStore.getState().showToast({
      type: toastType,
      title,
      message: body,
    })

    const tabHidden = typeof document !== "undefined" && document.visibilityState === "hidden"
    if (tabHidden) {
      if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
        try {
          const tag = ui.tag != null && ui.tag !== "" ? String(ui.tag) : `conversa_atribuida_${convId}`
          const n = new Notification(title, {
            body,
            icon: "/brand/pwa-192.png",
            tag,
          })
          n.onclick = () => window.focus()
          setTimeout(() => n.close(), 5000)
        } catch (_) {}
      }
    }
  })

  /* Sinal do webhook Z-API: conversa teve atividade (status, transferência, etc.)
     Backend NÃO emite para mensagem nova (usa nova_mensagem).
     NUNCA refetchar mensagens do chat aberto — isso causa "aparecer e sumir".
     Apenas atualizar item na lista quando for outra conversa. */
  const atualizarDebounce = {}
  socket.on("atualizar_conversa", (rawPayload = {}) => {
    if (shouldIgnoreByCompany(rawPayload)) return
    const { id, removida } = rawPayload
    if (!id) return
    if (removida === true) {
      useChatStore.getState().removeChat(id)
      const convStore = useConversaStore.getState()
      if (String(convStore.selectedId || "") === String(id)) {
        convStore.setSelectedId(null)
        useConversaStore.setState({ conversa: null, mensagens: [], tags: [] })
      }
      return
    }
    logSocketConversaDebug("atualizar_conversa", { id })
    const key = String(id)
    if (atualizarDebounce[key]) clearTimeout(atualizarDebounce[key])
    atualizarDebounce[key] = setTimeout(async () => {
      delete atualizarDebounce[key]
      const chatStore = useChatStore.getState()
      let needsListResync = false
      try {
        const data = await fetchChatById(id)
        if (!data) {
          needsListResync = true
          return
        }
        const chat = data?.conversa ? data.conversa : data
        if (!chat?.id) {
          needsListResync = true
          return
        }
        emitMinhaFilaOptimisticMutation(chat)
        const wasInList = (chatStore.chats || []).some((c) => String(c.id) === String(id))
        chatStore.addChat(chat)
        const selectedId = useConversaStore.getState().selectedId
        if (String(id) === String(selectedId)) {
          const meta = { id: chat.id }
          mergeSetorEAtendenteNoAlvo(meta, chat)
          if ("status_atendimento" in chat) meta.status_atendimento = chat.status_atendimento
          if ("status_atendimento_real" in chat) meta.status_atendimento_real = chat.status_atendimento_real
          if ("aguardando_cliente_desde" in chat) meta.aguardando_cliente_desde = chat.aguardando_cliente_desde
          if ("exibir_badge_aberta" in chat) meta.exibir_badge_aberta = chat.exibir_badge_aberta
          if ("modo_simples_aguardando" in chat) meta.modo_simples_aguardando = chat.modo_simples_aguardando
          if (chat.atendimento_modo_simples === true) meta.atendimento_modo_simples = true
          if ("lida" in chat) meta.lida = chat.lida
          if ("unread_count" in chat) meta.unread_count = chat.unread_count
          useConversaStore.getState().patchConversa(meta)
        }
        /* fetchChatById + addChat bastam quando o sinal não impacta fila; senão alinha Minha fila */
        needsListResync =
          !wasInList ||
          payloadImpactaListaLateral(rawPayload) ||
          payloadForcaResyncLista(rawPayload)
      } catch (_) {
        needsListResync = true
      }
      if (needsListResync) {
        chatStore.requestChatListResync()
      }
    }, 180)
  })

  /* Nome e foto do contato atualizados pela API UltraMsg (tempo real) — name (nome salvo no celular) tem prioridade sobre pushname */
  socket.on("contato_atualizado", (payload = {}) => {
    const { conversa_id, contato_nome, nome_contato_cache, nome_grupo, foto_perfil, foto_perfil_contato_cache, foto_grupo } = payload
    if (conversa_id == null) return
    if (shouldIgnoreByCompany(payload)) return
    const nome = contato_nome ?? nome_contato_cache
    const foto = foto_perfil ?? foto_perfil_contato_cache
    if (nome != null || foto != null || nome_grupo != null || foto_grupo != null) {
      const patch = {
        id: conversa_id,
        contato_nome: nome || undefined,
        nome_contato_cache: nome || undefined,
        foto_perfil: foto || undefined,
        foto_perfil_contato_cache: foto || undefined
      }
      if (nome_grupo != null && String(nome_grupo).trim()) patch.nome_grupo = nome_grupo.trim()
      if (foto_grupo != null && String(foto_grupo).trim().startsWith("http")) patch.foto_grupo = foto_grupo
      useChatStore.getState().updateChat(patch)
    }
    const convStore = useConversaStore.getState()
    if (String(convStore.selectedId) === String(conversa_id) && (nome || foto)) {
      convStore.patchConversa({
        id: conversa_id,
        ...(nome && { contato_nome: nome, cliente_nome: nome, nome_contato_cache: nome }),
        ...(foto && { foto_perfil: foto, foto_perfil_contato_cache: foto })
      })
    }
  })

  bindSocketAwakeListeners()

  return socket
}

export function getSocket() {
  return socket
}

export function disconnectSocket() {
  flushStatusMensagemBatch(applyStatusMensagemEvent)

  try {
    typingExpiryTimers.forEach((id) => clearTimeout(id))
    typingExpiryTimers.clear()
  } catch (_) {}

  try {
    suppressDefaultMessageSoundUntil.clear()
  } catch (_) {}

  resetStatusMensagemBatch()

  try {
    socket?.removeAllListeners?.()
  } catch (_) {}

  currentConversationId = null
  unbindSocketAwakeListeners()
  socketAwakeListenersBound = false
  try {
    if (socket) socket.disconnect()
  } catch (_) {}
  socket = null
}

export { updateDocumentTitleFromChats, applyDocumentTitle }
export { SOCKET_EVENTS } from "./events"
