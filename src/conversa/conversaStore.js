import { create } from "zustand"
import {
  getChatById,
  assumirChat,
  transferirChat,
  encerrarChat,
  reabrirChat,
  listarAtendimentos,
  marcarAguardandoClienteChat,
  marcarAguardandoPagamentoChat,
  retomarAtendimentoChat,
} from "./conversaService"
import { getSocket, leaveConversa, joinConversaIfNeeded } from "../socket/socket"
import { useChatStore } from "../chats/chatsStore"
import { buildPatchAguardandoPagamentoOptimista } from "../utils/pagamentoPrazoFormat"
import { getStatusAtendimentoEffective } from "../utils/conversaUtils"
import { normalizeMensagemStatusKey } from "../chats/chatListStoreCompare"
import { attachReplyMeta } from "./replyMeta"
import {
  cleanupOptimisticBlobFields,
  revokeOptimisticBlobFromMessage,
} from "./conversaOptimisticMessage"

/** Primeira página + loadMore: 50 mensagens equilibra tempo de resposta e cobertura do histórico (backend limita a 200). */
const PAGE_LIMIT = 50

/** PATCH de status_mensagem: evita set quando ticks já estão no mesmo nível. */
function mensagemStatusPatchChanges(cur, merged, partial) {
  if (!cur || !merged || !partial) return true
  if (normalizeMensagemStatusKey(cur) !== normalizeMensagemStatusKey(merged)) return true
  if (
    partial.whatsapp_id != null &&
    String(cur?.whatsapp_id ?? "") !== String(merged?.whatsapp_id ?? "")
  ) {
    return true
  }
  const keys = Object.keys(partial)
  if (keys.every((k) => ["status", "status_mensagem", "whatsapp_id"].includes(k))) {
    return false
  }
  for (const k of keys) {
    if (k === "status" || k === "status_mensagem" || k === "whatsapp_id") continue
    if (merged[k] !== cur[k]) return true
  }
  return false
}

function mensagensBelongToConversa(mensagens, conversaId) {
  const cid = String(conversaId)
  return (mensagens || []).every((m) => {
    const mid = m?.conversa_id
    return mid == null || String(mid) === cid
  })
}

/** Só reaproveita cache local se for exatamente a mesma conversa (evita mensagens de outro contato no mobile). */
function canReuseClientStateForConversa(state, normalizedId) {
  if (normalizedId == null) return false
  const nid = String(normalizedId)
  if (state.selectedId == null || String(state.selectedId) !== nid) return false
  if (!state.conversa || state.conversa.id == null || String(state.conversa.id) !== nid) return false
  if (!mensagensBelongToConversa(state.mensagens, normalizedId)) return false
  return true
}

function filterMensagensForConversa(mensagens, conversaId) {
  const cid = String(conversaId)
  return (mensagens || []).filter((m) => {
    const mid = m?.conversa_id
    return mid == null || String(mid) === cid
  })
}

/** ID estável — evita corromper IDs numéricos grandes (Number perde precisão). */
function normalizeConversaId(id) {
  if (id == null || id === "") return null
  if (typeof id === "number" && Number.isFinite(id)) return id
  const s = String(id).trim()
  if (!s) return null
  if (/^\d+$/.test(s)) {
    const n = Number(s)
    if (Number.isSafeInteger(n)) return n
    return s
  }
  return s
}

/** LRU leve: mensagens por conversa — reabrir sem esperar GET após voltar à lista. */
const conversaMensagensCache = new Map()
const CONVERSA_MENSAGENS_CACHE_MAX = 48
const CONVERSA_MENSAGENS_CACHE_TTL_MS = 45 * 60 * 1000

function trimConversaMensagensCache() {
  while (conversaMensagensCache.size > CONVERSA_MENSAGENS_CACHE_MAX) {
    const oldest = conversaMensagensCache.keys().next().value
    if (oldest == null) break
    conversaMensagensCache.delete(oldest)
  }
}

function readConversaMensagensCache(conversaId) {
  if (conversaId == null) return null
  const key = String(conversaId)
  const entry = conversaMensagensCache.get(key)
  if (!entry) return null
  if (Date.now() - (entry.savedAt || 0) > CONVERSA_MENSAGENS_CACHE_TTL_MS) {
    conversaMensagensCache.delete(key)
    return null
  }
  if (!entry.mensagens?.length) return null
  if (!mensagensBelongToConversa(entry.mensagens, conversaId)) return null
  return entry
}

function writeConversaMensagensCache(conversaId, snapshot) {
  if (conversaId == null || !snapshot?.mensagens?.length) return
  if (!mensagensBelongToConversa(snapshot.mensagens, conversaId)) return
  conversaMensagensCache.set(String(conversaId), {
    mensagens: snapshot.mensagens,
    conversa: snapshot.conversa,
    cursor: snapshot.cursor ?? null,
    cursorId: snapshot.cursorId ?? null,
    hasMore: snapshot.hasMore !== false,
    tags: Array.isArray(snapshot.tags) ? snapshot.tags : [],
    savedAt: Date.now(),
  })
  trimConversaMensagensCache()
}

function persistCurrentConversaToCache(state) {
  const cid = state?.selectedId ?? state?.conversa?.id
  if (cid == null || !(state?.mensagens?.length > 0)) return
  writeConversaMensagensCache(cid, {
    mensagens: state.mensagens,
    conversa: state.conversa,
    cursor: state.cursor,
    cursorId: state.cursorId,
    hasMore: state.hasMore,
    tags: state.tags,
  })
}

/** Cancela GET anterior e ignora respostas obsoletas ao trocar de conversa rápido (mobile). */
let carregarConversaGeneration = 0
let carregarConversaAbortController = null
/** Preenchido em `create()` — permite refresh mobile pós-abertura fora do closure do store. */
let conversaStoreGetState = null

function isAbortError(err) {
  if (!err) return false
  if (err.name === "AbortError" || err.name === "CanceledError") return true
  if (err.code === "ERR_CANCELED") return true
  return false
}

function cancelCarregarConversaInFlight() {
  if (carregarConversaAbortController) {
    try {
      carregarConversaAbortController.abort()
    } catch (_) {
      /* ignore */
    }
    carregarConversaAbortController = null
  }
}

function isMobileViewport() {
  if (typeof window === "undefined") return false
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 640px)").matches
  )
}

/** Reforço após abrir conversa — mesmo efeito do refresh manual (silencioso). */
function scheduleSilentRefreshAfterOpen(normalizedId, generation, opts = {}) {
  if (typeof window === "undefined") return
  /* Mobile: segundo GET + merge pesado logo após abrir congela a UI; socket cobre atualizações. */
  if (isMobileViewport()) return
  /* Primeiro GET já trouxe mensagens: adia/evita 2º GET competindo com a abertura. */
  if (opts.skipIfMessagesLoaded) return

  const run = () => {
    const getState = conversaStoreGetState
    if (!getState) return
    if (generation !== carregarConversaGeneration) return
    if (String(getState().selectedId) !== String(normalizedId)) return
    const st = getState()
    if (st.loading || st.loadError) return
    getState().refresh({ silent: true })
  }

  /* Após abertura: refresh silencioso em idle — não compete com merge do GET inicial. */
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(run, { timeout: 3000 })
    return
  }
  window.setTimeout(run, 1200)
}

/** Ordem de chegada monotônica — desempate final quando timestamps coincidem (burst / segundo truncado).
 * Base alta: mensagens vindas da API usam índices pequenos (1…N); temps/socket novos usam este contador. */
const RUNTIME_INSERT_SEQ_BASE = 10_000_000
let stableInsertSeqCounter = RUNTIME_INSERT_SEQ_BASE
function allocStableInsertSeq() {
  return stableInsertSeqCounter++
}

function mergeStableSeq(existingMsg, incomingMsg, fallbackOrd) {
  const ex = existingMsg?._stableInsertSeq
  const inc = incomingMsg?._stableInsertSeq
  const highPreserve = (v) => v != null && Number.isFinite(Number(v)) && Number(v) >= RUNTIME_INSERT_SEQ_BASE
  if (highPreserve(ex)) return Number(ex)
  if (highPreserve(inc)) return Number(inc)

  const nums = []
  if (ex != null && Number.isFinite(Number(ex))) nums.push(Number(ex))
  if (inc != null && Number.isFinite(Number(inc))) nums.push(Number(inc))
  if (fallbackOrd != null && Number.isFinite(Number(fallbackOrd))) nums.push(Number(fallbackOrd))
  if (nums.length === 0) return allocStableInsertSeq()
  return Math.min(...nums)
}

function toMillis(value) {
  if (!value) return NaN
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : NaN
}

/** Reconciliação por texto só para bolhas de chat — evita fundir "(áudio)"/mídia na mensagem de texto errada. */
function isTipoTextoParaReconciliarPorConteudo(msg) {
  const t = String(msg?.tipo ?? "").toLowerCase().trim()
  return t === "" || t === "texto" || t === "chat"
}

function isOutgoingLike(msg) {
  const dir = String(msg?.direcao || "").toLowerCase().trim()
  if (dir === "out") return true
  if (dir === "in") return false
  if (dir === "sent" || dir === "sending" || dir === "outbound" || dir === "enviado" || dir === "enviada") return true
  if (dir === "received" || dir === "inbound" || dir === "recebido" || dir === "recebida") return false
  const fromMe = msg?.fromMe ?? msg?.from_me ?? msg?.isFromMe ?? msg?.is_from_me
  if (fromMe === true || fromMe === 1 || String(fromMe).toLowerCase() === "true") return true
  if (fromMe === false || fromMe === 0 || String(fromMe).toLowerCase() === "false") return false
  return false
}

/** Chave estável quando id/whatsapp_id/tempId ausentes — evita sumir mensagens no merge/refresh. */
export function stableSyntheticMessageKey(m, conversaId) {
  const textoSnippet = String(m?.texto ?? m?.conteudo ?? "").slice(0, 160)
  const tipo = String(m?.tipo ?? "")
  const rem = String(m?.remetente_nome ?? m?.remetente_telefone ?? m?.pushname ?? "")
  const ts = String(m?.criado_em ?? "")
  const dir = isOutgoingLike(m) ? "o" : "i"
  const fileHint = String(m?.nome_arquivo ?? m?.filename ?? "").slice(0, 96)
  const urlTail = String(m?.url ?? m?.url_absoluta ?? "")
    .split("/")
    .pop()
    ?.slice(0, 96) ?? ""
  const dur =
    m?.audio_duracao_sec ??
    m?.audioDuracaoSec ??
    m?.duracao_segundos ??
    ""
  return `syn:${conversaId}:${dir}:${ts}:${tipo}:${rem}:${fileHint}:${urlTail}:${dur}:${textoSnippet}`
}

/** Chave única para Map dedupe (lista + merge API). */
export function mapDedupeKey(m, conversaId) {
  const conv = String(conversaId ?? "")
  const waRaw = m?.whatsapp_id ?? m?.wamid ?? m?.wa_message_id ?? null
  if (waRaw != null && String(waRaw).trim() !== "") return `wa-${conv}-${String(waRaw)}`
  if (m?.id != null && String(m.id).trim() !== "") return `id-${String(m.id)}`
  if (m?.tempId != null && String(m.tempId).trim() !== "") return `temp-${String(m.tempId)}`
  const syn = stableSyntheticMessageKey(m, conversaId)
  const seq = Number(m?._stableInsertSeq)
  // Sem id/wa/temp, só o fingerprint sintético pode colidir (ex.: várias saídas no mesmo segundo).
  if (Number.isFinite(seq)) return `syn-${conv}-seq${seq}-${syn}`
  return syn
}

/** Duas linhas com o mesmo `mapDedupeKey` devem fundir só se forem a mesma mensagem lógica (UPSERT). */
function canMergeDedupeEntries(prev, incoming) {
  if (!prev || !incoming) return true
  if (prev.tempId && incoming.tempId && String(prev.tempId) === String(incoming.tempId)) return true
  const pid = prev.id != null && String(prev.id).trim() !== "" ? String(prev.id) : null
  const iid = incoming.id != null && String(incoming.id).trim() !== "" ? String(incoming.id) : null
  if (pid && iid) return pid === iid
  const pwa = prev.whatsapp_id != null && String(prev.whatsapp_id).trim() !== "" ? String(prev.whatsapp_id) : null
  const iwa = incoming.whatsapp_id != null && String(incoming.whatsapp_id).trim() !== "" ? String(incoming.whatsapp_id) : null
  if (pwa && iwa) return pwa === iwa
  if (iid && !pid) return true
  if (pid && !iid) return true
  if (iwa && !pwa) return true
  if (pwa && !iwa) return true
  return false
}

/** Mesma bolha lógica com chaves diferentes (ex.: otimista temp-* vs socket id-*). */
function areLikelySameMessageBubble(prev, incoming) {
  if (!prev || !incoming) return false
  if (prev.tempId && incoming.tempId && String(prev.tempId) === String(incoming.tempId)) return true
  const pwa = prev.whatsapp_id != null && String(prev.whatsapp_id).trim() !== "" ? String(prev.whatsapp_id) : null
  const iwa = incoming.whatsapp_id != null && String(incoming.whatsapp_id).trim() !== "" ? String(incoming.whatsapp_id) : null
  if (pwa && iwa && pwa === iwa) return true
  const pid = prev.id != null && String(prev.id).trim() !== "" ? String(prev.id) : null
  const iid = incoming.id != null && String(incoming.id).trim() !== "" ? String(incoming.id) : null
  if (pid && iid && pid === iid) return true
  if (!isOutgoingLike(prev) || !isOutgoingLike(incoming)) return false
  const recentMs = 90_000
  const now = Date.now()
  const tsP = toMillis(prev?.criado_em)
  const tsI = toMillis(incoming?.criado_em)
  if (!Number.isFinite(tsP) || !Number.isFinite(tsI)) return false
  if (Math.abs(tsP - tsI) > recentMs) return false
  const textoP = (prev.texto || prev.conteudo || "").toString().trim()
  const textoI = (incoming.texto || incoming.conteudo || "").toString().trim()
  if (textoP && textoI && textoP === textoI) {
    return isTipoTextoParaReconciliarPorConteudo(prev) && isTipoTextoParaReconciliarPorConteudo(incoming)
  }
  const tipoP = String(prev.tipo || "").toLowerCase().trim()
  const tipoI = String(incoming.tipo || "").toLowerCase().trim()
  if (tipoP && tipoP === tipoI && isMediaTipo(tipoP)) {
    const nomeP = String(prev.nome_arquivo || "").trim()
    const nomeI = String(incoming.nome_arquivo || "").trim()
    if (nomeP && nomeI && nomeP === nomeI) return true
  }
  if (isOutgoingMediaReconcilePair(prev, incoming)) return true
  if (isOutgoingAudioReconcilePair(prev, incoming)) return true
  return false
}

function findMergeableMapKey(map, copy) {
  if (!map || !copy) return null
  for (const [key, prev] of map.entries()) {
    if (!prev) continue
    if (areLikelySameMessageBubble(prev, copy)) return key
  }
  return null
}

/** Remove otimistas órfãos quando já existe a mensagem confirmada (id/whatsapp_id). */
function pruneRedundantOutgoingTemps(list) {
  if (!Array.isArray(list) || list.length < 2) return list
  const recentMs = 90_000
  const now = Date.now()
  const confirmed = list.filter((m) => {
    if (!isOutgoingLike(m) || m?.tempId) return false
    const idOk = m.id != null && String(m.id).trim() !== ""
    const waOk = m.whatsapp_id != null && String(m.whatsapp_id).trim() !== ""
    return idOk || waOk
  })
  if (!confirmed.length) return list
  return list.filter((m) => {
    if (!m?.tempId || !isOutgoingLike(m)) return true
    const idOk = m.id != null && String(m.id).trim() !== ""
    const waOk = m.whatsapp_id != null && String(m.whatsapp_id).trim() !== ""
    if (idOk || waOk) return true
    const ts = toMillis(m?.criado_em)
    if (!Number.isFinite(ts) || now - ts >= recentMs) return true
    return !confirmed.some((c) => areLikelySameMessageBubble(m, c))
  })
}

function pruneRedundantOutgoingMediaEchoes(list) {
  if (!Array.isArray(list) || list.length < 2) return list
  const media = list
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => isOutgoingLike(m) && mediaFamilyFromMsg(m))
  if (media.length < 2) return list

  const confirmed = media.filter(({ m }) => {
    const waOk = m?.whatsapp_id != null && String(m.whatsapp_id).trim() !== ""
    return waOk && !m?.tempId
  })
  if (!confirmed.length) return list

  const remove = new Set()
  const recentMs = 20_000
  for (const { m, i } of media) {
    if (m?.tempId) continue
    if (m?.whatsapp_id != null && String(m.whatsapp_id).trim() !== "") continue
    const localCrmMedia = m?.autor_usuario_id != null || isLocalUploadMediaMessage(m)
    if (!localCrmMedia) continue
    const family = mediaFamilyFromMsg(m)
    const ts = toMillis(m?.criado_em)
    if (!Number.isFinite(ts)) continue
    const matches = confirmed.filter(({ m: c }) => {
      if (mediaFamilyFromMsg(c) !== family) return false
      const tc = toMillis(c?.criado_em)
      if (!Number.isFinite(tc) || Math.abs(tc - ts) > recentMs) return false
      return true
    })
    const localMatches = media.filter(({ m: other }) => {
      if (other?.tempId) return false
      if (other?.whatsapp_id != null && String(other.whatsapp_id).trim() !== "") return false
      if (!(other?.autor_usuario_id != null || isLocalUploadMediaMessage(other))) return false
      if (mediaFamilyFromMsg(other) !== family) return false
      const to = toMillis(other?.criado_em)
      return Number.isFinite(to) && Math.abs(to - ts) <= recentMs
    })
    if (matches.length === 1 && localMatches.length === 1) remove.add(i)
  }
  if (!remove.size) return list
  return list.filter((_, i) => !remove.has(i))
}

function finalizeMensagensList(list) {
  return sortMensagensChronological(pruneRedundantOutgoingMediaEchoes(pruneRedundantOutgoingTemps(list)))
}

/** Chave estável para React (evita colisão e remount errado). */
export function getMessageListReactKey(m, conversaId) {
  if (!m) return "unknown"
  if (m.tempId != null && String(m.tempId).trim() !== "") return String(m.tempId)
  if (m.id != null && String(m.id).trim() !== "") return String(m.id)
  if (m.whatsapp_id != null && String(m.whatsapp_id).trim() !== "") return `wa-${String(m.whatsapp_id)}`
  const syn = stableSyntheticMessageKey(m, conversaId)
  const seq = Number.isFinite(Number(m._stableInsertSeq)) ? String(m._stableInsertSeq) : ""
  return seq ? `${syn}·seq${seq}` : syn
}

function normalizeMsgForStore(msg) {
  if (!msg || typeof msg !== "object") return msg
  const n = { ...msg }
  const idMissing = n.id == null || String(n.id).trim() === ""
  if (idMissing) {
    const mid = n.mensagem_id ?? n.message_id ?? n.messageId ?? n.msg_id
    if (mid != null && String(mid).trim() !== "") n.id = mid
  }
  const waMissing = n.whatsapp_id == null || String(n.whatsapp_id).trim() === ""
  if (waMissing) {
    const wa = n.wamid ?? n.wa_message_id ?? n.whatsapp_message_id
    if (wa != null && String(wa).trim() !== "") n.whatsapp_id = wa
  }
  const altTs = n.created_at ?? n.timestamp ?? n.data_criacao ?? n.ts
  let ms = toMillis(n.criado_em)
  if (!Number.isFinite(ms)) ms = toMillis(altTs)
  if (!Number.isFinite(ms) && typeof altTs === "number" && Number.isFinite(altTs)) ms = altTs
  if (!Number.isFinite(ms)) {
    n.criado_em = new Date().toISOString()
  } else if (!n.criado_em || !String(n.criado_em).trim()) {
    n.criado_em = new Date(ms).toISOString()
  }
  return n
}

/**
 * Remove tempId em linhas novas vindas só do servidor (sem bolha otimista prévia).
 * Merge in-place de envio do usuário usa finalizeMergedMessageRow (mantém tempId para UI estável).
 */
function stripTempIdWhenPersisted(msg) {
  if (!msg || typeof msg !== "object") return msg
  const idOk = msg.id != null && String(msg.id).trim() !== ""
  const waOk = msg.whatsapp_id != null && String(msg.whatsapp_id).trim() !== ""
  if (!idOk && !waOk) return msg
  const next = { ...msg }
  delete next.tempId
  return next
}

/** Merge in-place preservando tempId da bolha otimista (chave React + lastMsgKey estáveis). */
function finalizeMergedMessageRow(prev, merged) {
  let row = cleanupOptimisticBlobFields(mergeMsgPreferringTombstone(prev, merged))
  if (prev?.tempId) return { ...row, tempId: prev.tempId }
  return stripTempIdWhenPersisted(row)
}

/** Otimista ainda sem id/whatsapp — candidato a reconciliação por texto. */
export function isPendingOutgoingTemp(m) {
  if (!m?.tempId || !isOutgoingLike(m)) return false
  const idOk = m.id != null && String(m.id).trim() !== ""
  const waOk = m.whatsapp_id != null && String(m.whatsapp_id).trim() !== ""
  return !idOk && !waOk
}

/** Mantém placeholder local “apagada para todos” se a API devolver o corpo antigo sem flag. */
function mergeMsgPreferringTombstone(prev, mergedCandidate) {
  if (!prev) return mergedCandidate
  if (!mergedCandidate) return prev
  if (prev.apagada_para_todos && !mergedCandidate.apagada_para_todos) return prev
  return mergedCandidate
}

const MEDIA_TIPOS = new Set(["imagem", "sticker", "audio", "voice", "video", "arquivo", "ptt", "documento"])
const AUDIO_FAMILY_TIPOS = new Set(["audio", "voice", "ptt"])

function isMediaTipo(tipo) {
  return MEDIA_TIPOS.has(String(tipo || "").toLowerCase().trim())
}

function isAudioFamilyTipo(tipo) {
  return AUDIO_FAMILY_TIPOS.has(String(tipo || "").toLowerCase().trim())
}

function hasPersistedMessageIdentity(m) {
  const idOk = m?.id != null && String(m.id).trim() !== ""
  const waOk = m?.whatsapp_id != null && String(m.whatsapp_id).trim() !== ""
  return idOk || waOk
}

/** Familia de midia usada para reconciliar optimistic + socket/API sem misturar tipos diferentes. */
function mediaFamilyFromMsg(m) {
  const tipo = String(m?.tipo || "").toLowerCase().trim()
  if (isAudioFamilyTipo(tipo)) return "audio"
  if (tipo === "imagem" || tipo === "image" || tipo === "sticker") return "imagem"
  if (tipo === "video" || tipo === "vídeo") return "video"
  if (tipo === "arquivo" || tipo === "documento" || tipo === "document" || tipo === "file") return "arquivo"
  return ""
}

function mediaFileBaseName(m) {
  const raw = String(m?.nome_arquivo || m?.filename || "").trim()
  if (!raw) return ""
  const clean = raw.split(/[?#]/)[0].split(/[\\/]/).pop() || raw
  return clean
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\.[a-z0-9]{2,5}$/i, "")
}

function mediaUrlTail(m) {
  const raw = String(m?.url || m?.url_absoluta || "").trim()
  if (!raw || raw.startsWith("blob:")) return ""
  return raw.split(/[?#]/)[0].split("/").pop()?.toLowerCase() || ""
}

function isLocalUploadMediaMessage(m) {
  const raw = String(m?.url || m?.url_absoluta || "").trim()
  return raw.startsWith("/uploads/")
}

function sameMediaStrongHint(prev, incoming) {
  const prevName = mediaFileBaseName(prev)
  const incomingName = mediaFileBaseName(incoming)
  if (prevName && incomingName && prevName === incomingName) return true
  const prevUrl = mediaUrlTail(prev)
  const incomingUrl = mediaUrlTail(incoming)
  if (prevUrl && incomingUrl && prevUrl === incomingUrl) return true
  const prevSize = prev?.tamanho ?? prev?.tamanho_bytes ?? null
  const incomingSize = incoming?.tamanho ?? incoming?.tamanho_bytes ?? null
  if (
    prevSize != null &&
    incomingSize != null &&
    Number.isFinite(Number(prevSize)) &&
    Number(prevSize) === Number(incomingSize)
  ) {
    return true
  }
  return false
}

/** Otimista de audio + confirmacao (socket/HTTP): nomes/tipos podem divergir (audio vs voice). */
function isOutgoingAudioReconcilePair(prev, incoming) {
  if (!prev || !incoming) return false
  if (!isOutgoingLike(prev) || !isOutgoingLike(incoming)) return false
  if (!isAudioFamilyTipo(prev.tipo) || !isAudioFamilyTipo(incoming.tipo)) return false
  const recentMs = 90_000
  const tsP = toMillis(prev?.criado_em)
  const tsI = toMillis(incoming?.criado_em)
  if (!Number.isFinite(tsP) || !Number.isFinite(tsI)) return false
  if (Math.abs(tsP - tsI) > recentMs) return false
  const prevPending = isPendingOutgoingTemp(prev)
  const incPending = isPendingOutgoingTemp(incoming)
  const prevPersist = hasPersistedMessageIdentity(prev)
  const incPersist = hasPersistedMessageIdentity(incoming)
  return (prevPending && incPersist) || (incPending && prevPersist)
}

function isOutgoingMediaReconcilePair(prev, incoming, opts = {}) {
  if (!prev || !incoming) return false
  if (!isOutgoingLike(prev) || !isOutgoingLike(incoming)) return false
  const prevFamily = mediaFamilyFromMsg(prev)
  const incomingFamily = mediaFamilyFromMsg(incoming)
  if (!prevFamily || !incomingFamily || prevFamily !== incomingFamily) return false
  const prevPending = isPendingOutgoingTemp(prev)
  const incPending = isPendingOutgoingTemp(incoming)
  const prevPersist = hasPersistedMessageIdentity(prev)
  const incPersist = hasPersistedMessageIdentity(incoming)
  if (!((prevPending && incPersist) || (incPending && prevPersist))) return false

  const recentMs = opts.allowLoose ? 15_000 : 120_000
  const tsP = toMillis(prev?.criado_em)
  const tsI = toMillis(incoming?.criado_em)
  if (!Number.isFinite(tsP) || !Number.isFinite(tsI)) return false
  if (Math.abs(tsP - tsI) > recentMs) return false

  if (sameMediaStrongHint(prev, incoming)) return true
  return opts.allowLoose === true
}

function dedupeRowsByPersistedIdentity(list, keepIdx) {
  const row = list[keepIdx]
  if (!row) return list
  const id = row.id != null && String(row.id).trim() !== "" ? String(row.id) : null
  const wa =
    row.whatsapp_id != null && String(row.whatsapp_id).trim() !== ""
      ? String(row.whatsapp_id)
      : null
  if (!id && !wa) return list
  return list.filter((m, i) => {
    if (i === keepIdx) return true
    if (id && m?.id != null && String(m.id) === id) return false
    if (wa && m?.whatsapp_id != null && String(m.whatsapp_id) === wa) return false
    return true
  })
}

function hasRenderableUrl(m) {
  if (!m) return false
  const u = m.url || m.url_absoluta
  return u != null && String(u).trim() !== ""
}

/**
 * Se a API devolver mensagem de mídia sem URL (link expirado, campo omitido, etc.),
 * mantém url/nome do que já estava no cliente — evita “sumir” foto/áudio após refresh ou merge.
 */
function preserveLocalMediaFields(prev, merged) {
  if (!merged) return merged
  if (!prev) return merged
  const tipo = String(merged.tipo || prev.tipo || "").toLowerCase().trim()
  if (!isMediaTipo(tipo)) return merged
  if (hasRenderableUrl(merged)) return merged
  if (!hasRenderableUrl(prev)) return merged
  const next = { ...merged }
  if (!next.tipo || String(next.tipo).trim() === "") next.tipo = prev.tipo
  next.url = prev.url
  next.url_absoluta = prev.url_absoluta
  if (prev.nome_arquivo) next.nome_arquivo = prev.nome_arquivo
  if (prev.thumbnail_url) next.thumbnail_url = prev.thumbnail_url
  return next
}

/** Evita que `criado_em` do servidor (às vezes mais antigo que o relógio local) empurre a bolha para cima na ordenação. */
function pickLaterCriadoEmIso(existing, incoming) {
  const te = toMillis(existing?.criado_em)
  const ti = toMillis(incoming?.criado_em)
  if (!Number.isFinite(te)) return incoming?.criado_em ?? existing?.criado_em
  if (!Number.isFinite(ti)) return existing?.criado_em ?? incoming?.criado_em
  return new Date(Math.max(te, ti)).toISOString()
}

/** Ordem cronológica estável (evita “sumir” / saltos quando timestamps coincidem). */
function sortMensagensChronological(arr) {
  return [...(arr || [])].sort((a, b) => {
    const ta = toMillis(a?.criado_em) || 0
    const tb = toMillis(b?.criado_em) || 0
    if (ta !== tb) return ta - tb
    const ida = Number(a?.id)
    const idb = Number(b?.id)
    if (Number.isFinite(ida) && Number.isFinite(idb) && ida !== idb) return ida - idb
    const sid = String(a?.id ?? "").localeCompare(String(b?.id ?? ""))
    if (sid !== 0) return sid
    const wa = String(a?.whatsapp_id || "").localeCompare(String(b?.whatsapp_id || ""))
    if (wa !== 0) return wa
    const tt = String(a?.tempId || "").localeCompare(String(b?.tempId || ""))
    if (tt !== 0) return tt
    const fn = String(a?.nome_arquivo || "").localeCompare(String(b?.nome_arquivo || ""))
    if (fn !== 0) return fn
    const ur = String(a?.url || a?.url_absoluta || "").localeCompare(String(b?.url || b?.url_absoluta || ""))
    if (ur !== 0) return ur
    const seqa = Number(a?._stableInsertSeq)
    const seqb = Number(b?._stableInsertSeq)
    if (Number.isFinite(seqa) && Number.isFinite(seqb) && seqa !== seqb) return seqa - seqb
    const conv = String(a?.conversa_id ?? b?.conversa_id ?? "")
    return stableSyntheticMessageKey(a, conv).localeCompare(stableSyntheticMessageKey(b, conv))
  })
}

/** Incorpora uma mensagem na lista (sem ordenar). Usado em lote pelo flush de `anexarMensagem`. */
function applyAnexarOneToList(list, convId, msg) {
  msg = normalizeMsgForStore(msg)
  if (!msg || !convId) return list

  const findExisting = () => {
    if (msg.id != null && String(msg.id).trim() !== "") {
      const byId = list.findIndex((m) => String(m.id) === String(msg.id))
      if (byId >= 0) return byId
    }
    const waId = msg.whatsapp_id || null
    if (waId && convId) {
      const byWa = list.findIndex(
        (m) =>
          (m.conversa_id == null || String(m.conversa_id) === String(convId)) &&
          String(m.whatsapp_id || "") === String(waId)
      )
      if (byWa >= 0) return byWa
    }
    if (msg.tempId) {
      const byTemp = list.findIndex((m) => String(m.tempId) === String(msg.tempId))
      if (byTemp >= 0) return byTemp
    }
    return -1
  }

  const existingIdx = findExisting()
  if (existingIdx >= 0) {
    const existing = list[existingIdx]
    const merged = preserveLocalMediaFields(existing, { ...existing, ...msg })
    if (convId) merged.conversa_id = convId
    if (msg.id && !existing.id) merged.id = msg.id
    if (msg.whatsapp_id && !existing.whatsapp_id) merged.whatsapp_id = msg.whatsapp_id
    if (msg.status != null) merged.status = msg.status
    if (msg.status_mensagem != null) merged.status_mensagem = msg.status_mensagem
    if (isOutgoingLike(existing) && isOutgoingLike(msg)) {
      merged.criado_em = pickLaterCriadoEmIso(existing, msg)
    }
    merged._stableInsertSeq = mergeStableSeq(existing, msg, null)
    const next = [...list]
    next[existingIdx] = finalizeMergedMessageRow(existing, merged)
    return next
  }

  const isFromMe = isOutgoingLike(msg)
  const textoIn = (msg.texto || msg.conteudo || "").toString().trim()
  const recentMs = 90_000
  const now = Date.now()

  if (isFromMe && mediaFamilyFromMsg(msg) && hasPersistedMessageIdentity(msg)) {
    const mergePendingMediaAt = (i) => {
      const m = list[i]
      const merged = preserveLocalMediaFields(m, { ...m, ...msg, conversa_id: convId })
      if (msg.id) merged.id = msg.id
      if (msg.whatsapp_id) merged.whatsapp_id = msg.whatsapp_id
      if (msg.status != null) merged.status = msg.status
      if (msg.status_mensagem != null) merged.status_mensagem = msg.status_mensagem
      merged.criado_em = pickLaterCriadoEmIso(m, msg)
      merged._stableInsertSeq = mergeStableSeq(m, msg, null)
      const next = [...list]
      next[i] = finalizeMergedMessageRow(m, merged)
      return dedupeRowsByPersistedIdentity(next, i)
    }

    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i]
      if (!isPendingOutgoingTemp(m) || !mediaFamilyFromMsg(m)) continue
      if (!isOutgoingMediaReconcilePair(m, msg) && !isOutgoingAudioReconcilePair(m, msg)) continue
      return mergePendingMediaAt(i)
    }

    const looseCandidates = []
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i]
      if (!isPendingOutgoingTemp(m) || !mediaFamilyFromMsg(m)) continue
      if (!isOutgoingMediaReconcilePair(m, msg, { allowLoose: true })) continue
      looseCandidates.push(i)
    }
    if (looseCandidates.length === 1) {
      return mergePendingMediaAt(looseCandidates[0])
    }
  }

  if (isFromMe && textoIn && isTipoTextoParaReconciliarPorConteudo(msg)) {
    const candidates = []
    for (let i = 0; i < list.length; i++) {
      const m = list[i]
      if (!isPendingOutgoingTemp(m)) continue
      if (!isTipoTextoParaReconciliarPorConteudo(m)) continue
      const ts = toMillis(m?.criado_em)
      if (!Number.isFinite(ts) || now - ts >= recentMs) continue
      const textoMatch = (m.texto || m.conteudo || "").toString().trim() === textoIn
      if (!textoMatch) continue
      candidates.push({ i, ts, seq: Number.isFinite(Number(m._stableInsertSeq)) ? Number(m._stableInsertSeq) : Infinity })
    }
    let replaceIdx = -1
    if (candidates.length === 1) {
      replaceIdx = candidates[0].i
    } else if (candidates.length > 1) {
      const tsIn = toMillis(msg?.criado_em)
      let best = candidates[0]
      for (const c of candidates) {
        if (!Number.isFinite(tsIn)) {
          if (c.ts < best.ts || (c.ts === best.ts && c.seq < best.seq)) best = c
        } else {
          const d = Math.abs(c.ts - tsIn)
          const bd = Math.abs(best.ts - tsIn)
          if (d < bd || (d === bd && c.seq < best.seq)) best = c
        }
      }
      replaceIdx = best.i
    }
    if (replaceIdx >= 0) {
      const existing = list[replaceIdx]
      const merged = preserveLocalMediaFields(existing, { ...existing, ...msg, conversa_id: convId })
      if (msg.id) merged.id = msg.id
      if (msg.whatsapp_id) merged.whatsapp_id = msg.whatsapp_id
      if (msg.status != null) merged.status = msg.status
      if (msg.status_mensagem != null) merged.status_mensagem = msg.status_mensagem
      merged.criado_em = pickLaterCriadoEmIso(existing, msg)
      merged._stableInsertSeq = mergeStableSeq(existing, msg, null)
      const next = [...list]
      next[replaceIdx] = finalizeMergedMessageRow(existing, merged)
      return next
    }
  }

  const isFromMeAlt = isOutgoingLike(msg)
  const textoParaCenarioId = (msg.texto || msg.conteudo || "").toString().trim()
  if (msg.id && isFromMeAlt && textoParaCenarioId && isTipoTextoParaReconciliarPorConteudo(msg)) {
    const recentMsC3 = 90_000
    const nowC3 = Date.now()
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i]
      if (!isOutgoingLike(m)) continue
      if (m?.tempId) continue
      const ts = toMillis(m?.criado_em)
      if (!Number.isFinite(ts) || nowC3 - ts > recentMsC3) break
      const textoMatch = (m.texto || m.conteudo || "").toString().trim() === textoParaCenarioId
      if (m.whatsapp_id && !m.id && textoMatch) {
        const merged = preserveLocalMediaFields(m, { ...m, ...msg, conversa_id: convId })
        if (isOutgoingLike(m) && isOutgoingLike(msg)) merged.criado_em = pickLaterCriadoEmIso(m, msg)
        const order = { pending: 0, sent: 1, delivered: 2, read: 3, played: 4 }
        const mVal = order[String(m?.status_mensagem || m?.status || "").toLowerCase()] ?? 0
        const msgVal = order[String(msg?.status_mensagem || msg?.status || "").toLowerCase()] ?? 0
        if (mVal > msgVal) {
          merged.status = m.status
          merged.status_mensagem = m.status_mensagem
        }
        merged._stableInsertSeq = mergeStableSeq(m, msg, null)
        const next = [...list]
        next[i] = finalizeMergedMessageRow(m, merged)
        return next
      }
    }
  }

  const newMsg = normalizeMsgForStore({ ...msg })
  if (convId) newMsg.conversa_id = convId
  const semChavePersistida =
    (newMsg.id == null || String(newMsg.id).trim() === "") &&
    (newMsg.whatsapp_id == null || String(newMsg.whatsapp_id).trim() === "") &&
    (newMsg.tempId == null || String(newMsg.tempId).trim() === "")
  if (semChavePersistida && !Number.isFinite(Number(newMsg._stableInsertSeq))) {
    newMsg._stableInsertSeq = allocStableInsertSeq()
  }
  const newK = mapDedupeKey(newMsg, convId)
  const candNew = stripTempIdWhenPersisted(newMsg)

  const dupIdx = list.findIndex((m) => mapDedupeKey(m, convId) === newK)
  if (dupIdx >= 0) {
    const prevRow = list[dupIdx]
    if (canMergeDedupeEntries(prevRow, candNew)) {
      let mergedNew = preserveLocalMediaFields(prevRow, mergeMsgPreferringTombstone(prevRow, candNew))
      if (isOutgoingLike(prevRow) && isOutgoingLike(candNew)) {
        mergedNew.criado_em = pickLaterCriadoEmIso(prevRow, candNew)
      }
      mergedNew._stableInsertSeq = mergeStableSeq(prevRow, candNew, null)
      const next = [...list]
      next[dupIdx] = finalizeMergedMessageRow(prevRow, mergedNew)
      return next
    }
  }

  const crossIdx = list.findIndex(
    (m, i) =>
      i !== dupIdx &&
      areLikelySameMessageBubble(m, candNew)
  )
  if (crossIdx >= 0) {
    const prevRow = list[crossIdx]
    let mergedNew = preserveLocalMediaFields(prevRow, mergeMsgPreferringTombstone(prevRow, candNew))
    if (isOutgoingLike(prevRow) && isOutgoingLike(candNew)) {
      mergedNew.criado_em = pickLaterCriadoEmIso(prevRow, candNew)
    }
    mergedNew._stableInsertSeq = mergeStableSeq(prevRow, candNew, null)
    const next = [...list]
    next[crossIdx] = finalizeMergedMessageRow(prevRow, mergedNew)
    return next
  }

  const appended = { ...candNew, _stableInsertSeq: mergeStableSeq(null, candNew, null) }
  return [...list, stripTempIdWhenPersisted(appended)]
}

function mergeDedupeRows(prev, incoming, ord) {
  const cand = prev ? { ...prev, ...incoming } : incoming
  let merged = preserveLocalMediaFields(prev, mergeMsgPreferringTombstone(prev, cand))
  if (prev && isOutgoingLike(prev) && isOutgoingLike(incoming)) {
    merged.criado_em = pickLaterCriadoEmIso(prev, incoming)
  }
  merged._stableInsertSeq = mergeStableSeq(prev || null, incoming, ord)
  return prev ? finalizeMergedMessageRow(prev, merged) : stripTempIdWhenPersisted(merged)
}

function putMensagemInDedupeMap(map, raw, conversaId, ord) {
  if (!raw) return
  const copy = normalizeMsgForStore({ ...raw, conversa_id: conversaId })
  const k = mapDedupeKey(copy, conversaId)
  const prev = map.get(k)

  if (prev && !canMergeDedupeEntries(prev, copy)) {
    const altKey = findMergeableMapKey(map, copy)
    if (altKey) {
      map.set(altKey, mergeDedupeRows(map.get(altKey), copy, ord))
      return
    }
    let altK = `${k}::__split_${ord}`
    let n = 0
    while (map.has(altK) && n < 500) altK = `${k}::__split_${ord}_${++n}`
    map.set(altK, mergeMsgPreferringTombstone(null, { ...copy, _stableInsertSeq: mergeStableSeq(null, copy, ord) }))
    return
  }

  if (!prev) {
    const altKey = findMergeableMapKey(map, copy)
    if (altKey) {
      map.set(altKey, mergeDedupeRows(map.get(altKey), copy, ord))
      return
    }
  }

  map.set(k, mergeDedupeRows(prev || null, copy, ord))
}

function getCurrentUserFromStorage() {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem("zap_erp_auth") : null
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.user ?? null
  } catch {
    return null
  }
}

/**
 * O responsável pela conversa deve ver o histórico completo.
 * Após transferência, API/socket costumam omitir `mensagens_bloqueadas: false`, mantendo o estado antigo no cliente.
 */
function resolveMensagensBloqueadasForViewer(conversaLike, apiSaysBlocked) {
  const me = getCurrentUserFromStorage()?.id
  const aid = conversaLike?.atendente_id
  if (me != null && aid != null && String(aid) === String(me)) return false
  return !!apiSaysBlocked
}

/** Shell mínimo da conversa a partir da lista — mobile abre o painel sem ficar preso no loading. */
function pickConversaShellFromChatList(normalizedId) {
  try {
    const chats = useChatStore.getState?.().chats || []
    const fromList = chats.find?.((c) => String(c?.id) === String(normalizedId))
    if (fromList) return { ...fromList, id: normalizedId }
  } catch (_) {}
  return { id: normalizedId }
}

export const useConversaStore = create((set, get) => {
  conversaStoreGetState = get
  const pendingAnexar = []
  let anexarFlushScheduled = false

  function discardPendingAnexar() {
    pendingAnexar.splice(0)
    anexarFlushScheduled = false
  }

  function takeAndApplyAnexarBatch() {
    anexarFlushScheduled = false
    const batch = pendingAnexar.splice(0)
    if (!batch.length) return
    set((state) => {
      let list = [...(state.mensagens || [])]
      const before = list.length
      const convFb = state.conversa?.id ?? state.selectedId
      /* Envio otimista único no fim: evita re-sort/prune no mesmo frame (pulo visual). */
      if (batch.length === 1) {
        const lone = normalizeMsgForStore({ ...batch[0] })
        const cid = lone?.conversa_id ?? convFb
        if (cid && isPendingOutgoingTemp(lone)) {
          const nextList = applyAnexarOneToList(list, cid, lone)
          const appended =
            nextList.length === list.length + 1 &&
            isPendingOutgoingTemp(nextList[nextList.length - 1])
          const mergedInPlace =
            nextList.length === list.length &&
            nextList.some((m) => m?.tempId && String(m.tempId) === String(lone.tempId))
          if (appended || mergedInPlace) {
            return { mensagens: nextList }
          }
        }
      }
      for (const raw of batch) {
        const m = normalizeMsgForStore(raw)
        const cid = m?.conversa_id ?? convFb
        if (!cid) continue
        list = applyAnexarOneToList(list, cid, m)
      }
      const sorted = finalizeMensagensList(list)
      if (import.meta.env.DEV && sorted.length < before) {
        console.warn("[conversaStore] flush anexar reduziu mensagens (inesperado)", {
          antes: before,
          depois: sorted.length,
          conversaId: convFb,
          lote: batch.length,
        })
      }
      return { mensagens: sorted }
    })
  }

  function scheduleAnexarFlush() {
    if (anexarFlushScheduled) return
    anexarFlushScheduled = true
    queueMicrotask(takeAndApplyAnexarBatch)
  }

  return {
  selectedId: null,
  conversa: null,
  mensagens: [],
  tags: [],
  loading: false,
  loadError: null,

  // ⭐ LOCK REALTIME
  lockedBy: null,

  // paginação (cursor = criado_em da mensagem mais antiga do lote DB; cursorId desempate)
  cursor: null,
  cursorId: null,
  hasMore: true,
  loadingMore: false,

  // timeline/auditoria
  atendimentos: [],
  atendimentosLoading: false,
  atendimentosLoadedFor: null,

  // Indicador de digitação em tempo real: { [conversaId]: { usuario_id, nome, expiresAt } }
  typing: {},

  /** Texto enfileirado para colar no composer (ex.: painel de produtos na lista de chats). */
  composerAppendQueue: null,

  /** Registrado pelo ConversaView — preserva scroll do thread ao Assumir (evita “pulo” ao topo). */
  _messagesScrollPreserve: { begin: null, end: null, release: null },
  registerMessagesScrollPreserve: (handlers) =>
    set({
      _messagesScrollPreserve: handlers
        ? {
            begin: handlers.begin ?? null,
            end: handlers.end ?? null,
            release: handlers.release ?? null,
          }
        : { begin: null, end: null, release: null },
    }),

  setSelectedId: (id) => {
    if (id == null || id === "") {
      cancelCarregarConversaInFlight()
      carregarConversaGeneration += 1
      const prevId = get().selectedId
      persistCurrentConversaToCache(get())
      set({
        selectedId: null,
        loading: false,
        loadError: null,
        loadingMore: false,
        conversa: null,
        mensagens: [],
        tags: [],
        cursor: null,
        cursorId: null,
        hasMore: true,
      })
      if (prevId) {
        const pid = prevId
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(() => leaveConversa(pid))
        } else {
          leaveConversa(pid)
        }
      }
      return
    }
    set({ selectedId: id })
  },

  queueComposerAppend: (text) => {
    const t = String(text || "").trim()
    if (!t) return
    set({ composerAppendQueue: t })
  },

  clearComposerAppendQueue: () => set({ composerAppendQueue: null }),

  /** Define quem está digitando na conversa (via WebSocket typing_start). Expira em 5s. */
  setTyping: (conversa_id, payload) => {
    if (!conversa_id) return
    const id = String(conversa_id)
    const expiresAt = Date.now() + 5000
    set((state) => ({
      typing: {
        ...state.typing,
        [id]: payload ? { ...payload, expiresAt } : undefined,
      },
    }))
  },

  /** Remove indicador de digitação (typing_stop ou timeout). */
  clearTyping: (conversa_id) => {
    if (!conversa_id) return
    set((state) => {
      const next = { ...state.typing }
      delete next[String(conversa_id)]
      return { typing: next }
    })
  },

  /* =====================================================
     CARREGAR CONVERSA
  ===================================================== */
  carregarConversa: async (id) => {
    const normalizedId = normalizeConversaId(id)
    if (!normalizedId) return

    const stEarly = get()
    if (
      canReuseClientStateForConversa(stEarly, normalizedId) &&
      !stEarly.loading &&
      !stEarly.loadError
    ) {
      joinConversaIfNeeded(normalizedId)
      const socketEarly = getSocket?.()
      if (socketEarly) {
        socketEarly.emit("marcar_conversa_lida", { conversa_id: normalizedId })
      }
      useChatStore.getState().clearUnread(normalizedId)
      return
    }

    const cachedEarly = readConversaMensagensCache(normalizedId)

    cancelCarregarConversaInFlight()
    const generation = ++carregarConversaGeneration
    const abortController = new AbortController()
    carregarConversaAbortController = abortController

    const prevId = get().selectedId
    if (prevId && String(prevId) !== String(normalizedId)) {
      persistCurrentConversaToCache(get())
      leaveConversa(prevId)
    }
    joinConversaIfNeeded(normalizedId)

    discardPendingAnexar()

    const st0 = get()
    const reuseClient = canReuseClientStateForConversa(st0, normalizedId)
    const hasCached =
      !reuseClient && cachedEarly?.mensagens?.length > 0
    const conversaShell = pickConversaShellFromChatList(normalizedId)
    const conversaShellWithId = { ...conversaShell, id: normalizedId }
    const mensagensSnapshotParaMerge = reuseClient
      ? [...(st0.mensagens || [])]
      : hasCached
        ? [...cachedEarly.mensagens]
        : []

    set({
      loading: reuseClient || hasCached ? false : true,
      selectedId: normalizedId,
      loadError: null,
      conversa: reuseClient
        ? st0.conversa
        : hasCached && cachedEarly.conversa
          ? { ...cachedEarly.conversa, id: normalizedId }
          : conversaShellWithId,
      mensagens: reuseClient ? st0.mensagens : hasCached ? cachedEarly.mensagens : [],
      cursor: reuseClient || hasCached ? (reuseClient ? st0.cursor : cachedEarly.cursor) : null,
      cursorId:
        reuseClient || hasCached ? (reuseClient ? st0.cursorId : cachedEarly.cursorId) : null,
      hasMore: reuseClient || hasCached ? (reuseClient ? st0.hasMore : cachedEarly.hasMore) : true,
      tags: reuseClient ? st0.tags : hasCached ? cachedEarly.tags || [] : [],
      lockedBy: null,
      atendimentos: [],
      atendimentosLoading: false,
      atendimentosLoadedFor: null,
    })

    try {
      const data = await getChatById(normalizedId, {
        limit: PAGE_LIMIT,
        signal: abortController.signal,
      })

      if (generation !== carregarConversaGeneration) return
      if (String(get().selectedId) !== String(normalizedId)) return

      let conversa = data?.conversa ? data.conversa : (data ?? null)
      if (!conversa || conversa.id == null) {
        conversa = {
          ...conversaShellWithId,
          ...(conversa && typeof conversa === "object" ? conversa : {}),
          id: normalizedId,
        }
      }
      let apiMensagens = data?.mensagens ?? conversa?.mensagens ?? []
      const tags = data?.tags ?? conversa?.tags ?? []

      const rawBlockedCarregar = data?.mensagens_bloqueadas ?? conversa?.mensagens_bloqueadas ?? false
      const atendente_nome = data?.atendente_nome ?? conversa?.atendente_nome ?? null
      if (conversa) {
        conversa = { ...conversa, atendente_nome }
      }

      const nextCursor = data?.next_cursor ?? conversa?.next_cursor ?? null
      const nextCursorIdRaw = data?.next_cursor_id ?? conversa?.next_cursor_id
      const nextCursorId =
        nextCursorIdRaw !== undefined && nextCursorIdRaw !== null && String(nextCursorIdRaw).trim() !== ""
          ? Number(nextCursorIdRaw)
          : null

      if (Array.isArray(apiMensagens)) {
        const byKey = new Map()
        apiMensagens.forEach((raw, idx) => {
          if (!raw) return
          const copy = normalizeMsgForStore({ ...raw, conversa_id: normalizedId })
          const k = mapDedupeKey(copy, normalizedId)
          const prev = byKey.get(k)
          const cand = prev ? { ...prev, ...copy } : copy
          let merged = preserveLocalMediaFields(prev, mergeMsgPreferringTombstone(prev, cand))
          merged._stableInsertSeq = mergeStableSeq(prev || null, copy, idx + 1)
          byKey.set(k, merged)
        })
        apiMensagens = sortMensagensChronological(Array.from(byKey.values()))
      } else {
        apiMensagens = []
      }

      // Mantém nome/foto sincronizados com a lista de conversas:
      // se o backend ainda não devolveu contato_nome/foto_perfil atualizados,
      // aproveita o que já está no chatStore para o mesmo id.
      try {
        const chats = useChatStore.getState?.().chats || []
        const fromList = chats.find?.((c) => String(c.id) === String(normalizedId))
        if (fromList) {
          const merged = { ...conversa }
          if (!merged.contato_nome && fromList.contato_nome) merged.contato_nome = fromList.contato_nome
          if (!merged.contato_nome && fromList.nome_contato_cache) merged.contato_nome = fromList.nome_contato_cache
          if (!merged.contato_nome && fromList.cliente?.nome) merged.contato_nome = fromList.cliente.nome
          if (!merged.cliente_nome && (fromList.contato_nome || fromList.nome || fromList.nome_contato_cache)) {
            merged.cliente_nome = fromList.contato_nome || fromList.nome || fromList.nome_contato_cache
          }
          if (!merged.foto_perfil && fromList.foto_perfil) merged.foto_perfil = fromList.foto_perfil
          if (!merged.foto_perfil && fromList.foto_perfil_contato_cache) merged.foto_perfil = fromList.foto_perfil_contato_cache
          if (!merged.nome_grupo && fromList.nome_grupo) merged.nome_grupo = fromList.nome_grupo
          if (!merged.cliente && fromList.cliente) merged.cliente = fromList.cliente
          conversa = merged
        }
      } catch (_) {}

      if (conversa) {
        conversa = {
          ...conversa,
          mensagens_bloqueadas: resolveMensagensBloqueadasForViewer(conversa, rawBlockedCarregar),
        }
      }

      /* Flush da fila realtime antes do merge — evita perder otimistas/socket só na fila.
         Mescla o que já está no cliente durante o GET com o lote da API (mesmo critério do refresh). */
      takeAndApplyAnexarBatch()
      const currentClientMessages = get().mensagens || []
      const clientSnapshotBase =
        mensagensSnapshotParaMerge.length > 0
          ? get()._mergeMensagensFromApi(mensagensSnapshotParaMerge, currentClientMessages, normalizedId)
          : currentClientMessages
      const clientSnapshot = filterMensagensForConversa(clientSnapshotBase, normalizedId)
      const blockedViewer = !!conversa?.mensagens_bloqueadas
      let mensagens = blockedViewer ? [] : get()._mergeMensagensFromApi(clientSnapshot, apiMensagens, normalizedId)
      mensagens = filterMensagensForConversa(attachReplyMeta(normalizedId, mensagens), normalizedId)

      /* Revalida após processamento síncrono — troca rápida no mobile pode invalidar o lote. */
      if (generation !== carregarConversaGeneration) return
      if (String(get().selectedId) !== String(normalizedId)) return

      const nextState = {
        conversa: conversa ? { ...conversa, id: normalizedId } : conversaShellWithId,
        mensagens,
        tags: Array.isArray(tags) ? tags : [],
        loading: false,
        loadError: null,
        cursor: nextCursor,
        cursorId: Number.isFinite(nextCursorId) ? nextCursorId : null,
        hasMore: !!nextCursor,
      }
      set(nextState)
      writeConversaMensagensCache(normalizedId, nextState)

      const socket = getSocket?.()
      if (socket) {
        joinConversaIfNeeded(normalizedId)
        socket.emit("marcar_conversa_lida", { conversa_id: normalizedId })
      }
      useChatStore.getState().clearUnread(normalizedId)
      if (
        conversa?.status_atendimento != null ||
        conversa?.status_atendimento_real != null ||
        conversa?.aguardando_cliente_desde !== undefined ||
        conversa?.exibir_badge_aberta !== undefined
      ) {
        useChatStore.getState().updateChat({
          id: normalizedId,
          status_atendimento: conversa?.status_atendimento,
          status_atendimento_real: conversa?.status_atendimento_real,
          aguardando_cliente_desde: conversa?.aguardando_cliente_desde,
          exibir_badge_aberta: conversa?.exibir_badge_aberta,
        })
      }

      const skipSilentRefresh =
        !blockedViewer && Array.isArray(apiMensagens) && apiMensagens.length > 0
      scheduleSilentRefreshAfterOpen(normalizedId, generation, {
        skipIfMessagesLoaded: skipSilentRefresh,
      })
    } catch (err) {
      if (isAbortError(err)) return
      if (generation !== carregarConversaGeneration) return
      if (String(get().selectedId) !== String(normalizedId)) return
      const msg = err?.response?.data?.error || err?.message || "Erro ao carregar conversa"
      console.error("Erro ao carregar conversa:", err)
      set({ loading: false, loadError: msg, conversa: conversaShellWithId })
    } finally {
      if (carregarConversaAbortController === abortController) {
        carregarConversaAbortController = null
      }
      if (generation !== carregarConversaGeneration) return
      if (String(get().selectedId ?? "") !== String(normalizedId)) return
      if (get().loading) {
        set({
          loading: false,
          conversa: get().conversa || conversaShellWithId,
        })
      }
    }
  },

  /* =====================================================
     REFRESH
  ===================================================== */
  /** UPSERT: mescla mensagens da API com as existentes. Preserva mensagens que chegaram via socket e ainda não estão na API (evita "aparecer e sumir"). */
  _mergeMensagensFromApi: (existing, fromApi, conversaId) => {
    if (!Array.isArray(fromApi)) fromApi = []
    existing = filterMensagensForConversa(existing, conversaId)
    const map = new Map()
    let batchOrd = 0
    const put = (raw) => {
      if (!raw) return
      const ord = ++batchOrd
      putMensagemInDedupeMap(map, raw, conversaId, ord)
    }
    existing.forEach(put)
    fromApi.forEach(put)
    return finalizeMensagensList(Array.from(map.values()))
  },

  refresh: async (opts = {}) => {
    const id = get().selectedId
    if (!id) return

    const silent = opts?.silent === true
    if (!silent) set({ loading: true })

    try {
      const data = await getChatById(id, { limit: PAGE_LIMIT })

      if (String(get().selectedId) !== String(id)) return

      let conversa = data?.conversa ? data.conversa : (data ?? null)
      const apiMensagens = data?.mensagens ?? conversa?.mensagens ?? []
      const tags = data?.tags ?? conversa?.tags ?? []

      // Backend: quando assumida por outro atendente, mensagens vêm vazias e mensagens_bloqueadas=true
      const rawBlockedRefresh = data?.mensagens_bloqueadas ?? conversa?.mensagens_bloqueadas ?? false
      const atendente_nome = data?.atendente_nome ?? conversa?.atendente_nome ?? null
      let mensagens_bloqueadas = false
      if (conversa) {
        mensagens_bloqueadas = resolveMensagensBloqueadasForViewer(
          { ...conversa, atendente_nome },
          rawBlockedRefresh
        )
        conversa = { ...conversa, mensagens_bloqueadas, atendente_nome }
      }

      const nextCursor = data?.next_cursor ?? conversa?.next_cursor ?? null
      const nextCursorIdRaw = data?.next_cursor_id ?? conversa?.next_cursor_id
      const nextCursorId =
        nextCursorIdRaw !== undefined && nextCursorIdRaw !== null && String(nextCursorIdRaw).trim() !== ""
          ? Number(nextCursorIdRaw)
          : null

      // Preserva nome, telefone e foto — dados fixos do contato não devem mudar após refresh
      let merged = conversa
      try {
        const current = get().conversa
        const chats = useChatStore.getState?.().chats || []
        const fromList = chats.find?.((c) => String(c.id) === String(id))
        const sources = [conversa, current, fromList].filter(Boolean)
        if (sources.length > 1) {
          merged = { ...conversa }
          const pick = (f) => {
            for (const s of sources) {
              const v = s?.[f] ?? s?.cliente?.[f === "telefone_exibivel" ? "telefone" : f]
              if (v != null && String(v).trim() !== "") return v
            }
            return null
          }
          if (!merged.contato_nome) merged.contato_nome = pick("contato_nome") ?? fromList?.nome_contato_cache ?? fromList?.cliente?.nome
          if (!merged.cliente_nome) merged.cliente_nome = pick("cliente_nome") ?? pick("contato_nome")
          if (!merged.telefone && !merged.telefone_exibivel) merged.telefone_exibivel = pick("telefone_exibivel") ?? pick("telefone") ?? pick("cliente_telefone")
          if (!merged.telefone_exibivel && merged.telefone) merged.telefone_exibivel = merged.telefone
          if (!merged.foto_perfil) merged.foto_perfil = pick("foto_perfil") ?? fromList?.foto_perfil_contato_cache
          if (!merged.nome_grupo) merged.nome_grupo = pick("nome_grupo")
          if (!merged.cliente) merged.cliente = fromList?.cliente
        }
      } catch (_) {}

      /* MERGE num único set após flush da fila — estado mais recente (lista + fila). */
      takeAndApplyAnexarBatch()
      set((state) => {
        const existing = state.mensagens || []
        let mensagens = mensagens_bloqueadas ? [] : get()._mergeMensagensFromApi(existing, apiMensagens, id)
        mensagens = attachReplyMeta(id, mensagens)
        return {
          conversa: merged,
          mensagens,
          tags,
          loading: false,
          cursor: nextCursor,
          cursorId: Number.isFinite(nextCursorId) ? nextCursorId : null,
          hasMore: !!nextCursor,
        }
      })

      if (
        merged?.status_atendimento != null ||
        merged?.status_atendimento_real != null ||
        merged?.aguardando_cliente_desde !== undefined ||
        merged?.exibir_badge_aberta !== undefined
      ) {
        useChatStore.getState().updateChat({
          id,
          status_atendimento: merged?.status_atendimento,
          status_atendimento_real: merged?.status_atendimento_real,
          aguardando_cliente_desde: merged?.aguardando_cliente_desde,
          exibir_badge_aberta: merged?.exibir_badge_aberta,
        })
      }
    } catch (err) {
      console.error("Erro ao atualizar conversa:", err)
      set({ loading: false })
    }
  },

  /* =====================================================
     PAGINAÇÃO
  ===================================================== */
  loadMore: async () => {
    const { selectedId, cursor, cursorId, hasMore, loadingMore, conversa } = get()
    if (!selectedId || !hasMore || !cursor || loadingMore) return
    if (conversa?.mensagens_bloqueadas) return

    set({ loadingMore: true })

    try {
      const data = await getChatById(selectedId, {
        cursor,
        cursorId,
        limit: PAGE_LIMIT,
      })

      if (String(get().selectedId) !== String(selectedId)) {
        set({ loadingMore: false })
        return
      }

      const conversa = data?.conversa ? data.conversa : (data ?? null)
      const mais = data?.mensagens ?? conversa?.mensagens ?? []

      const nextCursor = data?.next_cursor ?? conversa?.next_cursor ?? null
      const nextCursorIdRaw = data?.next_cursor_id ?? conversa?.next_cursor_id
      const nextCursorId =
        nextCursorIdRaw !== undefined && nextCursorIdRaw !== null && String(nextCursorIdRaw).trim() !== ""
          ? Number(nextCursorIdRaw)
          : null

      set((state) => {
        const atual = state.mensagens || []
        /** Mesma estratégia de `_mergeMensagensFromApi`: temp sem `id` não pode usar só String(m.id) (colapsa em "undefined"). */
        const map = new Map()
        let batchOrd = 0
        const put = (raw) => {
          if (!raw) return
          const ord = ++batchOrd
          putMensagemInDedupeMap(map, raw, selectedId, ord)
        }
        ;(mais || []).forEach(put)
        atual.forEach(put)
        const sorted = finalizeMensagensList(Array.from(map.values()))
        return {
          mensagens: attachReplyMeta(selectedId, sorted),
          cursor: nextCursor,
          cursorId: Number.isFinite(nextCursorId) ? nextCursorId : null,
          hasMore: !!nextCursor,
          loadingMore: false,
        }
      })
    } catch (e) {
      console.error("Erro loadMore:", e)
      set({ loadingMore: false })
    }
  },

  /* =====================================================
     MENSAGENS — UPSERT (dedupe + merge)
     Várias chegadas no mesmo instante são enfileiradas e aplicadas num único `set`,
     para não haver corrida em que um `anexarMensagem` lê a lista antiga e sobrescreve o outro.
  ===================================================== */
  _sortMensagensByCriadoEmAsc: (arr) => sortMensagensChronological(arr),

  anexarMensagem: (msg) => {
    if (msg == null) return
    const probe = normalizeMsgForStore({ ...msg })
    const conversaId = probe?.conversa_id ?? get().conversa?.id
    if (!conversaId) return
    pendingAnexar.push(msg)
    scheduleAnexarFlush()
  },

  /** Envio otimista do usuário: aplica na mesma tick (sem esperar microtask). */
  anexarMensagemImediata: (msg) => {
    if (msg == null) return
    const probe = normalizeMsgForStore({ ...msg })
    const conversaId = probe?.conversa_id ?? get().conversa?.id
    if (!conversaId) return
    pendingAnexar.push(msg)
    takeAndApplyAnexarBatch()
  },

  /** Substitui mensagem temp (optimistic) pela real quando API retorna.
   * Se temp não existir (socket chegou primeiro), faz merge via anexarMensagem. */
  reconciliarMensagem: (tempId, realMsg) => {
    if (!tempId || !realMsg) return
    takeAndApplyAnexarBatch()
    let replaced = false
    set((state) => {
      const list = state.mensagens || []
      const idx = list.findIndex((m) => String(m.tempId) === String(tempId))
      if (idx >= 0) {
        replaced = true
        const next = [...list]
        const mergedRec = normalizeMsgForStore({ ...realMsg, conversa_id: state.conversa?.id })
        const prevRow = list[idx]
        const flat = preserveLocalMediaFields(prevRow, { ...prevRow, ...mergedRec })
        if (isOutgoingLike(prevRow) && isOutgoingLike(mergedRec)) {
          /* Mantém timestamp local da bolha — evita reordenar no reconcile HTTP/socket. */
          flat.criado_em = prevRow.criado_em ?? flat.criado_em
        }
        let tomb = mergeMsgPreferringTombstone(prevRow, flat)
        tomb._stableInsertSeq = mergeStableSeq(prevRow, flat, null)
        next[idx] = finalizeMergedMessageRow(prevRow, tomb)
        return { mensagens: dedupeRowsByPersistedIdentity(next, idx) }
      }
      return state
    })
    if (!replaced) {
      get().anexarMensagem(realMsg)
    }
  },

  /** Atualiza mensagem(ns) por id, whatsapp_id ou tempId.
   * status_mensagem: atualiza TODAS as mensagens que correspondam a mensagem_id OU whatsapp_id na conversa. */
  patchMensagem: (mensagemId, partial, opts = {}) => {
    const hasIdentifier = (mensagemId != null && mensagemId !== "") || partial?.whatsapp_id || partial?.tempId
    const hasStatus = partial?.status_mensagem != null || partial?.status != null
    if (!hasIdentifier && !hasStatus) return
    if (!partial || (Object.keys(partial).length === 0)) return
    const { whatsapp_id: optsWhatsappId } = opts
    set((state) => {
      const list = state.mensagens || []
      // Sempre filtra pela conversa SELECIONADA — conversa_id do payload pode vir em formato diferente
      const convId = state.conversa?.id ?? state.selectedId
      const waId = optsWhatsappId ?? partial?.whatsapp_id

      // Índices de TODAS as mensagens que correspondem: mensagem_id OU whatsapp_id na mesma conversa
      // Inclui mensagens sem conversa_id (optimistic) — lista é sempre da conversa selecionada
      const indices = new Set()
      list.forEach((m, i) => {
        if (convId && m.conversa_id != null && String(m.conversa_id) !== String(convId)) return
        if (mensagemId != null && mensagemId !== "" && String(m.id) === String(mensagemId)) indices.add(i)
        else if (waId && String(m.whatsapp_id) === String(waId)) indices.add(i)
        else if (partial?.tempId && String(m.tempId) === String(partial.tempId)) indices.add(i)
      })

      // Fallback: status_mensagem pode chegar antes de nova_mensagem ou sem identificadores
      // Atualiza última msg "out" recente (últimos 60s)
      if (indices.size === 0 && hasStatus && convId && list.length > 0) {
        const now = Date.now()
        const recentMs = 60_000
        let fallbackIdx = -1
        for (let i = list.length - 1; i >= 0; i--) {
          const m = list[i]
          if (!isOutgoingLike(m)) continue
          const ts = toMillis(m?.criado_em)
          if (!Number.isFinite(ts) || now - ts > recentMs) break
          // Match: tem id/whatsapp_id OU é a última out recente (tempId ou id)
          const hasMatch = (waId && String(m.whatsapp_id) === String(waId)) ||
            (mensagemId && String(m.id) === String(mensagemId))
          if (hasMatch || !m.whatsapp_id) {
            fallbackIdx = i
            break
          }
        }
        if (fallbackIdx >= 0) indices.add(fallbackIdx)
      }

      if (indices.size === 0) return state
      const next = [...list]
      let changed = false
      indices.forEach((i) => {
        const cur = next[i]
        if (cur?.apagada_para_todos) {
          const allow = {}
          if (partial.status != null) allow.status = partial.status
          if (partial.status_mensagem != null) allow.status_mensagem = partial.status_mensagem
          if (Object.keys(allow).length === 0) return
          const merged = preserveLocalMediaFields(cur, { ...cur, ...allow })
          if (!mensagemStatusPatchChanges(cur, merged, allow)) return
          next[i] = merged
          changed = true
          return
        }
        const merged = preserveLocalMediaFields(cur, { ...cur, ...partial })
        if (!mensagemStatusPatchChanges(cur, merged, partial)) return
        next[i] = merged
        changed = true
      })
      if (!changed) return state
      return { mensagens: next }
    })
  },

  /** Substitui só o registro com esse id — não afeta outras mensagens. */
  marcarMensagemApagadaParaTodos: (mensagemId, opts = {}) => {
    const targetId = mensagemId != null ? String(mensagemId).trim() : ""
    if (!targetId) return
    const me = getCurrentUserFromStorage()?.id
    set((state) => {
      const list = state.mensagens || []
      const idx = list.findIndex((m) => m?.id != null && String(m.id) === targetId)
      if (idx < 0) return state
      const prev = list[idx]
      if (prev.apagada_para_todos) return state
      const euQueApaguei = opts.euQueApaguei === true
      const souAutor =
        prev?.autor_usuario_id != null && me != null && String(prev.autor_usuario_id) === String(me)
      const texto =
        euQueApaguei || souAutor
          ? "Você apagou esta mensagem para todos."
          : "Esta mensagem foi apagada para todos."
      const next = [...list]
      /* Mantém tipo e URLs de mídia no painel (histórico interno); o texto informa revogação no WhatsApp. */
      next[idx] = stripTempIdWhenPersisted({
        ...prev,
        texto,
        conteudo: texto,
        apagada_para_todos: true,
        reply_meta: null,
        mensagem_respondida_id: null,
        encaminhado: false,
      })
      return { mensagens: next }
    })
  },

  removerMensagem: (mensagemId) => {
    if (mensagemId == null) return
    set((state) => {
      const list = state.mensagens || []
      const next = list.filter((m) => String(m.id) !== String(mensagemId))
      if (next.length === list.length) return state
      return { mensagens: next }
    })
  },

  /** Remove mensagem temp (optimistic) — preferir marcarMensagemTempErro para falhas de envio. */
  removerMensagemTemp: (tempId) => {
    if (!tempId) return
    takeAndApplyAnexarBatch()
    set((state) => {
      const list = state.mensagens || []
      const idx = list.findIndex((m) => String(m.tempId) === String(tempId))
      if (idx < 0) return state
      const row = list[idx]
      revokeOptimisticBlobFromMessage(row)
      const next = list.filter((m) => String(m.tempId) !== String(tempId))
      return { mensagens: next }
    })
  },

  /** Mantém a bolha visível com ticks de erro (reenvio = PR futura). */
  marcarMensagemTempErro: (tempId, opts = {}) => {
    if (!tempId) return
    takeAndApplyAnexarBatch()
    const errStatus = opts?.status_mensagem ?? opts?.status ?? "erro"
    set((state) => {
      const list = state.mensagens || []
      const idx = list.findIndex((m) => String(m.tempId) === String(tempId))
      if (idx < 0) return state
      const next = [...list]
      next[idx] = {
        ...list[idx],
        status: errStatus,
        status_mensagem: errStatus,
        envio_erro: true,
        ...(opts?.erro_mensagem ? { erro_mensagem: String(opts.erro_mensagem) } : {}),
      }
      return { mensagens: next }
    })
  },

  setTags: (tags) => set({ tags: tags || [] }),

  /* =====================================================
     AÇÕES DE ATENDIMENTO
  ===================================================== */
  assumirConversa: async (conversaId) => {
    const preserve = get()._messagesScrollPreserve
    const chatStore = useChatStore.getState()
    const row = (chatStore.chats || []).find((c) => String(c.id) === String(conversaId))
    const openConv = get().conversa
    const src = row || (openConv && String(openConv.id) === String(conversaId) ? openConv : null)
    const me = getCurrentUserFromStorage()
    const optimistic = {
      id: conversaId,
      status_atendimento: "em_atendimento",
      status_atendimento_real: "em_atendimento",
      exibir_badge_aberta: false,
      mensagens_bloqueadas: false,
      atendente_nome: me?.nome ?? null,
      ...(me?.id != null ? { atendente_id: me.id } : {}),
    }
    preserve?.begin?.()
    const schedulePreserveEnd = () => {
      const run = (phase) => {
        const handlers = get()._messagesScrollPreserve
        if (phase === "restore") handlers?.end?.()
        else if (phase === "release") handlers?.release?.()
      }
      run("restore")
      if (typeof queueMicrotask === "function") queueMicrotask(() => run("restore"))
      if (typeof window !== "undefined") {
        window.requestAnimationFrame?.(() => run("restore"))
        window.setTimeout(() => run("restore"), 0)
        window.setTimeout(() => run("restore"), 80)
        window.setTimeout(() => run("release"), 200)
      } else {
        run("release")
      }
    }
    get().patchConversa(optimistic)
    chatStore.updateChat(optimistic)
    try {
      const data = await assumirChat(conversaId)
      const payload = data?.conversa ?? data ?? {}
      const patch = { ...optimistic, ...payload, id: conversaId }
      get().patchConversa(patch)
      useChatStore.getState().updateChat(patch)
      useChatStore.getState().requestChatListResync()
      set({ atendimentosLoadedFor: null })
    } catch (err) {
      if (src) {
        const revert = {
          id: conversaId,
          status_atendimento: src.status_atendimento,
          status_atendimento_real: src.status_atendimento_real,
          exibir_badge_aberta: src.exibir_badge_aberta,
          mensagens_bloqueadas: src.mensagens_bloqueadas,
          atendente_nome: src.atendente_nome,
          atendente_id: src.atendente_id,
        }
        get().patchConversa(revert)
        useChatStore.getState().updateChat(revert)
      }
      throw err
    } finally {
      schedulePreserveEnd()
    }
  },

  transferirConversa: async (conversaId, novoAtendenteId, observacao = null) => {
    await transferirChat(conversaId, Number(novoAtendenteId), observacao)
    await get().refresh()
    useChatStore.getState().requestChatListResync()
    set({ atendimentosLoadedFor: null })
  },

  encerrarConversa: async (conversaId) => {
    const chatStore = useChatStore.getState()
    const row = (chatStore.chats || []).find((c) => String(c.id) === String(conversaId))
    const openConv = get().conversa
    const src = row || (openConv && String(openConv.id) === String(conversaId) ? openConv : null)
    const currentTags = Array.isArray(src?.tags)
      ? src.tags
      : Array.isArray(get().tags)
        ? get().tags
        : undefined
    const optimistic = {
      id: conversaId,
      status_atendimento: "fechada",
      status_atendimento_real: "fechada",
      exibir_badge_aberta: false,
      finalizacao_motivo: null,
      finalizada_automaticamente: false,
      finalizada_automaticamente_em: null,
      ...(currentTags ? { tags: currentTags } : {}),
      pagamento_concluido_em: null,
      pagamento_prazo_ate: null,
      pagamento_prazo_origem: null,
      aguardando_cliente_desde: null,
    }
    get().patchConversa(optimistic)
    chatStore.updateChat(optimistic)
    chatStore.emitChatListOptimisticMutation?.({
      type: "encerrar_conversa",
      id: conversaId,
      removeFromMinhaFila: true,
      patch: optimistic,
    })
    try {
      const data = await encerrarChat(conversaId)
      const payload = data?.conversa ?? data ?? {}
      const patch = { ...optimistic, ...payload, id: conversaId }
      get().patchConversa(patch)
      useChatStore.getState().updateChat(patch)
      useChatStore.getState().requestChatListResync()
      set({ atendimentosLoadedFor: null })
    } catch (err) {
      if (src) {
        const revert = {
          id: conversaId,
          status_atendimento: src.status_atendimento,
          status_atendimento_real: src.status_atendimento_real,
          exibir_badge_aberta: src.exibir_badge_aberta,
          mensagens_bloqueadas: src.mensagens_bloqueadas,
          atendente_nome: src.atendente_nome,
          atendente_id: src.atendente_id,
          aguardando_cliente_desde: src.aguardando_cliente_desde,
          pagamento_concluido_em: src.pagamento_concluido_em,
          pagamento_prazo_ate: src.pagamento_prazo_ate,
          pagamento_prazo_origem: src.pagamento_prazo_origem,
        }
        get().patchConversa(revert)
        useChatStore.getState().updateChat(revert)
        useChatStore.getState().emitChatListOptimisticMutation?.({
          type: "encerrar_conversa_revert",
          id: conversaId,
          restoreMinhaFila: true,
          row: row ? { ...row, ...revert } : null,
          patch: revert,
        })
      }
      throw err
    }
  },

  reabrirConversa: async (conversaId) => {
    const chatStore = useChatStore.getState()
    const row = (chatStore.chats || []).find((c) => String(c.id) === String(conversaId))
    const openConv = get().conversa
    const src = row || (openConv && String(openConv.id) === String(conversaId) ? openConv : null)
    const me = getCurrentUserFromStorage()
    const optimistic = {
      id: conversaId,
      status_atendimento: "em_atendimento",
      status_atendimento_real: "em_atendimento",
      exibir_badge_aberta: false,
      mensagens_bloqueadas: false,
      atendente_nome: me?.nome ?? null,
      ...(me?.id != null ? { atendente_id: me.id } : {}),
      aguardando_cliente_desde: null,
      pagamento_concluido_em: null,
      pagamento_prazo_ate: null,
      pagamento_prazo_origem: null,
    }
    get().patchConversa(optimistic)
    chatStore.updateChat(optimistic)
    try {
      const data = await reabrirChat(conversaId)
      const payload = data?.conversa ?? data ?? {}
      const patch = { ...optimistic, ...payload, id: conversaId }
      get().patchConversa(patch)
      useChatStore.getState().updateChat(patch)
      useChatStore.getState().requestChatListResync()
      set({ atendimentosLoadedFor: null })
    } catch (err) {
      if (src) {
        const revert = {
          id: conversaId,
          status_atendimento: src.status_atendimento,
          status_atendimento_real: src.status_atendimento_real,
          exibir_badge_aberta: src.exibir_badge_aberta,
          mensagens_bloqueadas: src.mensagens_bloqueadas,
          atendente_nome: src.atendente_nome,
          atendente_id: src.atendente_id,
          aguardando_cliente_desde: src.aguardando_cliente_desde,
          pagamento_concluido_em: src.pagamento_concluido_em,
          pagamento_prazo_ate: src.pagamento_prazo_ate,
          pagamento_prazo_origem: src.pagamento_prazo_origem,
        }
        get().patchConversa(revert)
        useChatStore.getState().updateChat(revert)
      }
      throw err
    }
  },

  marcarAguardandoClienteConversa: async (conversaId) => {
    const chatStore = useChatStore.getState()
    const chats = chatStore.chats || []
    const row = chats.find((c) => String(c.id) === String(conversaId))
    const openConv = get().conversa
    const src = row || (openConv && String(openConv.id) === String(conversaId) ? openConv : null)
    const optimistic = {
      id: conversaId,
      status_atendimento: "aguardando_cliente",
      status_atendimento_real: "aguardando_cliente",
      aguardando_cliente_desde: new Date().toISOString(),
      exibir_badge_aberta: false,
      ui_status_optimistic_at: Date.now(),
    }
    const revertStatus = {
      status_atendimento: src?.status_atendimento,
      status_atendimento_real: src?.status_atendimento_real,
      aguardando_cliente_desde: src?.aguardando_cliente_desde,
      exibir_badge_aberta: src?.exibir_badge_aberta,
      ui_status_optimistic_at: src?.ui_status_optimistic_at ?? null,
    }

    get().patchConversa(optimistic)
    chatStore.updateChat(optimistic)

    try {
      const data = await marcarAguardandoClienteChat(conversaId)
      const payload = data?.conversa ?? data ?? {}
      const patch = { ...optimistic, ...payload, id: conversaId }
      get().patchConversa(patch)
      useChatStore.getState().updateChat(patch)
      useChatStore.getState().requestChatListResync()
      set({ atendimentosLoadedFor: null })
    } catch (err) {
      if (src) {
        const revert = { id: conversaId, ...revertStatus }
        get().patchConversa(revert)
        useChatStore.getState().updateChat(revert)
      }
      throw err
    }
  },

  marcarAguardandoPagamentoConversa: async (conversaId, prazoOpts) => {
    const optimistic = buildPatchAguardandoPagamentoOptimista(conversaId, prazoOpts)
    const chatStore = useChatStore.getState()
    const chats = chatStore.chats || []
    const row = chats.find((c) => String(c.id) === String(conversaId))
    const openConv = get().conversa
    const revertStatus = {
      status_atendimento: row?.status_atendimento ?? openConv?.status_atendimento,
      status_atendimento_real: row?.status_atendimento_real ?? openConv?.status_atendimento_real,
      pagamento_prazo_ate: row?.pagamento_prazo_ate ?? openConv?.pagamento_prazo_ate,
      pagamento_prazo_origem: row?.pagamento_prazo_origem ?? openConv?.pagamento_prazo_origem,
      aguardando_cliente_desde: row?.aguardando_cliente_desde ?? openConv?.aguardando_cliente_desde,
      pagamento_concluido_em: row?.pagamento_concluido_em ?? openConv?.pagamento_concluido_em,
      exibir_badge_aberta: row?.exibir_badge_aberta ?? openConv?.exibir_badge_aberta,
    }

    if (optimistic) {
      get().patchConversa(optimistic)
      chatStore.updateChat(optimistic)
    }

    try {
      const data = await marcarAguardandoPagamentoChat(conversaId, prazoOpts)
      const payload = data?.conversa ?? data ?? {}
      const patch = { ...(optimistic || {}), ...payload, id: conversaId }
      get().patchConversa(patch)
      useChatStore.getState().updateChat(patch)
      useChatStore.getState().requestChatListResync()
      set({ atendimentosLoadedFor: null })
    } catch (err) {
      if (optimistic) {
        const revert = { id: conversaId, ...revertStatus }
        get().patchConversa(revert)
        useChatStore.getState().updateChat(revert)
      }
      throw err
    }
  },

  retomarAtendimentoConversa: async (conversaId) => {
    const chatStore = useChatStore.getState()
    const chats = chatStore.chats || []
    const row = chats.find((c) => String(c.id) === String(conversaId))
    const openConv = get().conversa
    const src = row || (openConv && String(openConv.id) === String(conversaId) ? openConv : null)
    const st = getStatusAtendimentoEffective(src)

    let optimistic = null
    if (st === "pagamento_pendente" || st === "em_atraso") {
      optimistic = {
        id: conversaId,
        status_atendimento: "em_atendimento",
        status_atendimento_real: "em_atendimento",
        pagamento_concluido_em: new Date().toISOString(),
        pagamento_prazo_ate: null,
        pagamento_prazo_origem: null,
        aguardando_cliente_desde: null,
      }
    } else if (st === "aguardando_cliente") {
      optimistic = {
        id: conversaId,
        status_atendimento: "em_atendimento",
        status_atendimento_real: "em_atendimento",
        aguardando_cliente_desde: null,
      }
    }

    const revertStatus = {
      status_atendimento: src?.status_atendimento,
      status_atendimento_real: src?.status_atendimento_real,
      pagamento_concluido_em: src?.pagamento_concluido_em,
      pagamento_prazo_ate: src?.pagamento_prazo_ate,
      pagamento_prazo_origem: src?.pagamento_prazo_origem,
      aguardando_cliente_desde: src?.aguardando_cliente_desde,
    }

    if (optimistic) {
      get().patchConversa(optimistic)
      chatStore.updateChat(optimistic)
    }

    try {
      const data = await retomarAtendimentoChat(conversaId)
      const payload = data?.conversa ?? data ?? {}
      const patch = { ...(optimistic || {}), ...payload, id: conversaId }
      get().patchConversa(patch)
      useChatStore.getState().updateChat(patch)
      useChatStore.getState().requestChatListResync()
      set({ atendimentosLoadedFor: null })
    } catch (err) {
      if (optimistic && src) {
        const revert = { id: conversaId, ...revertStatus }
        get().patchConversa(revert)
        useChatStore.getState().updateChat(revert)
      }
      throw err
    }
  },

  /* =====================================================
     TIMELINE
  ===================================================== */
  carregarAtendimentos: async (conversaId) => {
    const id = conversaId ?? get().selectedId
    if (!id) return

    set({ atendimentosLoading: true })

    const data = await listarAtendimentos(id)

    set({
      atendimentos: data || [],
      atendimentosLoading: false,
      atendimentosLoadedFor: id,
    })
  },

  /* =====================================================
     PATCHES SOCKET
  ===================================================== */
  patchConversa: (partial) => {
    if (!partial?.id) return
    let shouldReloadMessages = false
    const fixedFields = ["contato_nome", "nome_contato_cache", "cliente_nome", "telefone", "telefone_exibivel", "cliente_telefone", "nome_grupo", "foto_perfil", "foto_perfil_contato_cache", "exibir_badge_aberta", "status_atendimento", "status_atendimento_real"]
    const preserveOptional = ["mensagens_bloqueadas", "atendente_nome"]
    set((state) => {
      if (!state.conversa || String(state.conversa.id) !== String(partial.id))
        return state
      const cur = state.conversa
      const merged = { ...cur, ...partial }
      for (const k of preserveOptional) {
        if (merged[k] === undefined && cur[k] !== undefined) merged[k] = cur[k]
      }
      // conversa_atualizada: merge defensivo — só atualizar se vier valor definido (prioridade nome_contato_cache)
      const nomeValido = (v) => v != null && String(v).trim() !== ""
      const temNomePayload = nomeValido(partial.nome_contato_cache) || nomeValido(partial.contato_nome)
      const temFotoPayload = partial.foto_perfil != null && String(partial.foto_perfil).trim() !== ""
      if (nomeValido(partial.nome_contato_cache)) {
        merged.contato_nome = partial.nome_contato_cache
        merged.nome_contato_cache = partial.nome_contato_cache
      } else if (nomeValido(partial.contato_nome)) {
        merged.contato_nome = partial.contato_nome
      }
      if (temFotoPayload) merged.foto_perfil = partial.foto_perfil
      // Não sobrescrever com vazio: quando payload tem valor vazio e cur tem valor, restaurar
      if (!temNomePayload && (cur.contato_nome != null && String(cur.contato_nome).trim() !== ""))
        merged.contato_nome = cur.contato_nome
      if (!temFotoPayload && (cur.foto_perfil != null && String(cur.foto_perfil).trim() !== ""))
        merged.foto_perfil = cur.foto_perfil
      for (const k of fixedFields) {
        if (k === "contato_nome" || k === "foto_perfil" || k === "foto_perfil_contato_cache") continue
        const newVal = partial[k]
        const isEmpty = newVal == null || String(newVal || "").trim() === ""
        if (isEmpty && (cur[k] != null && String(cur[k] || "").trim() !== ""))
          merged[k] = cur[k]
      }
      // Setor / responsável: reaplicar depois do merge defensivo — null deve remover vínculo
      if ("departamento_id" in partial) merged.departamento_id = partial.departamento_id
      if ("atendente_id" in partial) merged.atendente_id = partial.atendente_id
      if ("atendente_nome" in partial) merged.atendente_nome = partial.atendente_nome
      if ("aguardando_cliente_desde" in partial) merged.aguardando_cliente_desde = partial.aguardando_cliente_desde
      if ("pagamento_prazo_ate" in partial) merged.pagamento_prazo_ate = partial.pagamento_prazo_ate
      if ("pagamento_prazo_origem" in partial) merged.pagamento_prazo_origem = partial.pagamento_prazo_origem
      if ("pagamento_concluido_em" in partial) merged.pagamento_concluido_em = partial.pagamento_concluido_em
      if ("status_atendimento_real" in partial) merged.status_atendimento_real = partial.status_atendimento_real
      if ("departamento" in partial) merged.departamento = partial.departamento
      if ("departamento_id" in partial && partial.departamento_id == null) {
        merged.setor = null
        merged.departamento = null
        merged.departamentos = null
      }
      merged.mensagens_bloqueadas = resolveMensagensBloqueadasForViewer(merged, merged.mensagens_bloqueadas)
      const prevBlocked = cur.mensagens_bloqueadas === true
      const becameUnblocked = prevBlocked && !merged.mensagens_bloqueadas
      const me = getCurrentUserFromStorage()?.id
      const wasAssignee = me != null && cur.atendente_id != null && String(cur.atendente_id) === String(me)
      const nowAssignee = me != null && merged.atendente_id != null && String(merged.atendente_id) === String(me)
      const becameAssignee = nowAssignee && !wasAssignee
      const msgs = state.mensagens || []
      if ((becameUnblocked || becameAssignee) && msgs.length === 0) shouldReloadMessages = true
      return { conversa: merged }
    })
    if (shouldReloadMessages) {
      queueMicrotask(() => {
        if (String(get().selectedId) !== String(partial.id)) return
        get().refresh({ silent: true })
      })
    }
  },

  // ⭐ LOCK REALTIME
  patchLock: ({ conversa_id, locked_by }) => {
    const { selectedId } = get()
    if (String(selectedId) !== String(conversa_id)) return
    set({ lockedBy: locked_by ?? null })
  },

  /* =====================================================
     LIMPAR
  ===================================================== */
  limpar: () => {
    cancelCarregarConversaInFlight()
    carregarConversaGeneration += 1
    discardPendingAnexar()
    set({
      selectedId: null,
      conversa: null,
      mensagens: [],
      tags: [],
      loading: false,
      cursor: null,
      cursorId: null,
      hasMore: true,
      loadingMore: false,
      lockedBy: null,
      atendimentos: [],
      atendimentosLoading: false,
      atendimentosLoadedFor: null,
    })
  },
}
})
