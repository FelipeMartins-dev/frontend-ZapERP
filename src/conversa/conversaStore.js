import { create } from "zustand"
import {
  getChatById,
  assumirChat,
  transferirChat,
  encerrarChat,
  reabrirChat,
  listarAtendimentos,
  marcarAguardandoClienteChat,
  retomarAtendimentoChat,
} from "./conversaService"
import { getSocket, leaveConversa, joinConversaIfNeeded } from "../socket/socket"
import { useChatStore } from "../chats/chatsStore"
import { attachReplyMeta } from "./replyMeta"

/** Primeira página + loadMore: 50 mensagens equilibra tempo de resposta e cobertura do histórico (backend limita a 200). */
const PAGE_LIMIT = 50

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
function scheduleSilentRefreshAfterOpen(normalizedId, generation) {
  if (typeof window === "undefined") return
  /* Mobile: segundo GET + merge pesado logo após abrir congela a UI; socket cobre atualizações. */
  if (isMobileViewport()) return

  const run = () => {
    const getState = conversaStoreGetState
    if (!getState) return
    if (generation !== carregarConversaGeneration) return
    if (String(getState().selectedId) !== String(normalizedId)) return
    const st = getState()
    if (st.loading || st.loadError) return
    getState().refresh({ silent: true })
  }

  queueMicrotask(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(run)
    })
  })
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
  if (canMergeDedupeEntries(prev, incoming)) return true
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
  if (!textoP || !textoI || textoP !== textoI) return false
  return isTipoTextoParaReconciliarPorConteudo(prev) && isTipoTextoParaReconciliarPorConteudo(incoming)
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
    const ts = toMillis(m?.criado_em)
    if (!Number.isFinite(ts) || now - ts >= recentMs) return true
    return !confirmed.some((c) => areLikelySameMessageBubble(m, c))
  })
}

function finalizeMensagensList(list) {
  return sortMensagensChronological(pruneRedundantOutgoingTemps(list))
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
 * Mensagem já confirmada (id ou whatsapp_id) não deve manter tempId — senão o FIFO de reconciliação
 * continua tratando a bolha como “pendente” e a próxima confirmação com o mesmo texto sobrescreve
 * a mensagem errada (parece que mensagens “somem”).
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

/** Mantém placeholder local “apagada para todos” se a API devolver o corpo antigo sem flag. */
function mergeMsgPreferringTombstone(prev, mergedCandidate) {
  if (!prev) return mergedCandidate
  if (!mergedCandidate) return prev
  if (prev.apagada_para_todos && !mergedCandidate.apagada_para_todos) return prev
  return mergedCandidate
}

const MEDIA_TIPOS = new Set(["imagem", "sticker", "audio", "voice", "video", "arquivo", "ptt", "documento"])

function isMediaTipo(tipo) {
  return MEDIA_TIPOS.has(String(tipo || "").toLowerCase().trim())
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
    next[existingIdx] = stripTempIdWhenPersisted(mergeMsgPreferringTombstone(existing, merged))
    return next
  }

  const isFromMe = isOutgoingLike(msg)
  const textoIn = (msg.texto || msg.conteudo || "").toString().trim()
  const recentMs = 90_000
  const now = Date.now()

  if (isFromMe && textoIn && isTipoTextoParaReconciliarPorConteudo(msg)) {
    const candidates = []
    for (let i = 0; i < list.length; i++) {
      const m = list[i]
      if (!m?.tempId || !isOutgoingLike(m)) continue
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
      next[replaceIdx] = stripTempIdWhenPersisted(mergeMsgPreferringTombstone(existing, merged))
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
        next[i] = stripTempIdWhenPersisted(mergeMsgPreferringTombstone(m, merged))
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
      next[dupIdx] = stripTempIdWhenPersisted(mergedNew)
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
    next[crossIdx] = stripTempIdWhenPersisted(mergedNew)
    return next
  }

  const appended = { ...candNew, _stableInsertSeq: mergeStableSeq(null, candNew, null) }
  return [...list, stripTempIdWhenPersisted(appended)]
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

  setSelectedId: (id) => {
    if (id == null || id === "") {
      cancelCarregarConversaInFlight()
      carregarConversaGeneration += 1
      const prevId = get().selectedId
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

    cancelCarregarConversaInFlight()
    const generation = ++carregarConversaGeneration
    const abortController = new AbortController()
    carregarConversaAbortController = abortController

    const prevId = get().selectedId
    if (prevId && String(prevId) !== String(normalizedId)) {
      leaveConversa(prevId)
    }
    joinConversaIfNeeded(normalizedId)

    discardPendingAnexar()

    const st0 = get()
    const reuseClient = canReuseClientStateForConversa(st0, normalizedId)
    const conversaShell = pickConversaShellFromChatList(normalizedId)
    const conversaShellWithId = { ...conversaShell, id: normalizedId }
    const mensagensSnapshotParaMerge = reuseClient ? [...(st0.mensagens || [])] : []

    set({
      loading: true,
      selectedId: normalizedId,
      loadError: null,
      conversa: reuseClient ? st0.conversa : conversaShellWithId,
      mensagens: reuseClient ? st0.mensagens : [],
      cursor: null,
      cursorId: null,
      hasMore: true,
      tags: reuseClient ? st0.tags : [],
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

      /* Mobile: libera a UI logo após o GET (merge pesado não pode segurar loading=true). */
      if (isMobileViewport()) {
        set({
          loading: false,
          conversa: conversaShellWithId,
          loadError: null,
        })
      }

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
      const clientSnapshot = filterMensagensForConversa(
        mensagensSnapshotParaMerge.length > 0 ? mensagensSnapshotParaMerge : get().mensagens || [],
        normalizedId
      )
      const blockedViewer = !!conversa?.mensagens_bloqueadas
      let mensagens = blockedViewer ? [] : get()._mergeMensagensFromApi(clientSnapshot, apiMensagens, normalizedId)
      mensagens = filterMensagensForConversa(attachReplyMeta(normalizedId, mensagens), normalizedId)

      /* Revalida após processamento síncrono — troca rápida no mobile pode invalidar o lote. */
      if (generation !== carregarConversaGeneration) return
      if (String(get().selectedId) !== String(normalizedId)) return

      set({
        conversa: conversa ? { ...conversa, id: normalizedId } : conversaShellWithId,
        mensagens,
        tags: Array.isArray(tags) ? tags : [],
        loading: false,
        loadError: null,
        cursor: nextCursor,
        cursorId: Number.isFinite(nextCursorId) ? nextCursorId : null,
        hasMore: !!nextCursor,
      })

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

      scheduleSilentRefreshAfterOpen(normalizedId, generation)
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
      const copy = normalizeMsgForStore({ ...raw, conversa_id: conversaId })
      const k = mapDedupeKey(copy, conversaId)
      const prev = map.get(k)
      if (prev && !canMergeDedupeEntries(prev, copy)) {
        const altKey = findMergeableMapKey(map, copy)
        if (altKey) {
          const prevAlt = map.get(altKey)
          const cand = prevAlt ? { ...prevAlt, ...copy } : copy
          let merged = preserveLocalMediaFields(prevAlt, mergeMsgPreferringTombstone(prevAlt, cand))
          if (prevAlt && isOutgoingLike(prevAlt) && isOutgoingLike(copy)) {
            merged.criado_em = pickLaterCriadoEmIso(prevAlt, copy)
          }
          merged._stableInsertSeq = mergeStableSeq(prevAlt || null, copy, ord)
          map.set(altKey, stripTempIdWhenPersisted(merged))
          return
        }
        let altK = `${k}::__split_${ord}`
        let n = 0
        while (map.has(altK) && n < 500) altK = `${k}::__split_${ord}_${++n}`
        const split = { ...copy, _stableInsertSeq: mergeStableSeq(null, copy, ord) }
        map.set(altK, mergeMsgPreferringTombstone(null, split))
        return
      }
      const cand = prev ? { ...prev, ...copy } : copy
      let merged = preserveLocalMediaFields(prev, mergeMsgPreferringTombstone(prev, cand))
      if (prev && isOutgoingLike(prev) && isOutgoingLike(copy)) {
        merged.criado_em = pickLaterCriadoEmIso(prev, copy)
      }
      merged._stableInsertSeq = mergeStableSeq(prev || null, copy, ord)
      map.set(k, merged)
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
          const copy = normalizeMsgForStore({ ...raw, conversa_id: selectedId })
          const k = mapDedupeKey(copy, selectedId)
          const prev = map.get(k)
          if (prev && !canMergeDedupeEntries(prev, copy)) {
            const altKey = findMergeableMapKey(map, copy)
            if (altKey) {
              const prevAlt = map.get(altKey)
              const cand = prevAlt ? { ...prevAlt, ...copy } : copy
              let merged = preserveLocalMediaFields(prevAlt, mergeMsgPreferringTombstone(prevAlt, cand))
              if (prevAlt && isOutgoingLike(prevAlt) && isOutgoingLike(copy)) {
                merged.criado_em = pickLaterCriadoEmIso(prevAlt, copy)
              }
              merged._stableInsertSeq = mergeStableSeq(prevAlt || null, copy, ord)
              map.set(altKey, stripTempIdWhenPersisted(merged))
              return
            }
            let altK = `${k}::__split_${ord}`
            let n = 0
            while (map.has(altK) && n < 500) altK = `${k}::__split_${ord}_${++n}`
            const split = { ...copy, _stableInsertSeq: mergeStableSeq(null, copy, ord) }
            map.set(altK, mergeMsgPreferringTombstone(null, split))
            return
          }
          const cand = prev ? { ...prev, ...copy } : copy
          let merged = preserveLocalMediaFields(prev, mergeMsgPreferringTombstone(prev, cand))
          if (prev && isOutgoingLike(prev) && isOutgoingLike(copy)) {
            merged.criado_em = pickLaterCriadoEmIso(prev, copy)
          }
          merged._stableInsertSeq = mergeStableSeq(prev || null, copy, ord)
          map.set(k, merged)
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
          flat.criado_em = pickLaterCriadoEmIso(prevRow, mergedRec)
        }
        let tomb = mergeMsgPreferringTombstone(prevRow, flat)
        tomb._stableInsertSeq = mergeStableSeq(prevRow, flat, null)
        next[idx] = stripTempIdWhenPersisted(tomb)
        return { mensagens: sortMensagensChronological(next) }
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
      indices.forEach((i) => {
        const cur = next[i]
        if (cur?.apagada_para_todos) {
          const allow = {}
          if (partial.status != null) allow.status = partial.status
          if (partial.status_mensagem != null) allow.status_mensagem = partial.status_mensagem
          if (Object.keys(allow).length === 0) return
          next[i] = preserveLocalMediaFields(cur, { ...cur, ...allow })
          return
        }
        next[i] = preserveLocalMediaFields(cur, { ...cur, ...partial })
      })
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

  /** Remove mensagem temp (optimistic) quando envio falha */
  removerMensagemTemp: (tempId) => {
    if (!tempId) return
    set((state) => {
      const list = state.mensagens || []
      const next = list.filter((m) => String(m.tempId) !== String(tempId))
      if (next.length === list.length) return state
      return { mensagens: next }
    })
  },

  setTags: (tags) => set({ tags: tags || [] }),

  /* =====================================================
     AÇÕES DE ATENDIMENTO
  ===================================================== */
  assumirConversa: async (conversaId) => {
    const data = await assumirChat(conversaId)
    const payload = data?.conversa ?? data ?? {}
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
    const patch = { ...optimistic, ...payload, id: conversaId }
    get().patchConversa(patch)
    useChatStore.getState().updateChat(patch)
    useChatStore.getState().requestChatListResync()
    set({ atendimentosLoadedFor: null })
  },

  transferirConversa: async (conversaId, novoAtendenteId, observacao = null) => {
    await transferirChat(conversaId, Number(novoAtendenteId), observacao)
    await get().refresh()
    useChatStore.getState().requestChatListResync()
    set({ atendimentosLoadedFor: null })
  },

  encerrarConversa: async (conversaId) => {
    const data = await encerrarChat(conversaId)
    const payload = data?.conversa ?? data ?? {}
    const optimistic = {
      id: conversaId,
      status_atendimento: "encerrada",
      exibir_badge_aberta: false,
    }
    const patch = { ...optimistic, ...payload, id: conversaId }
    get().patchConversa(patch)
    useChatStore.getState().updateChat(patch)
    useChatStore.getState().requestChatListResync()
    set({ atendimentosLoadedFor: null })
  },

  reabrirConversa: async (conversaId) => {
    const data = await reabrirChat(conversaId)
    const payload = data?.conversa ?? data ?? {}
    const optimistic = {
      id: conversaId,
      status_atendimento: "fila",
      exibir_badge_aberta: true,
      mensagens_bloqueadas: false,
      atendente_nome: null,
      atendente_id: null,
    }
    const patch = { ...optimistic, ...payload, id: conversaId }
    get().patchConversa(patch)
    useChatStore.getState().updateChat(patch)
    useChatStore.getState().requestChatListResync()
    set({ atendimentosLoadedFor: null })
  },

  marcarAguardandoClienteConversa: async (conversaId) => {
    const data = await marcarAguardandoClienteChat(conversaId)
    const payload = data?.conversa ?? data ?? {}
    const patch = { ...payload, id: conversaId }
    get().patchConversa(patch)
    useChatStore.getState().updateChat(patch)
    useChatStore.getState().requestChatListResync()
    set({ atendimentosLoadedFor: null })
  },

  retomarAtendimentoConversa: async (conversaId) => {
    const data = await retomarAtendimentoChat(conversaId)
    const payload = data?.conversa ?? data ?? {}
    const patch = { ...payload, id: conversaId }
    get().patchConversa(patch)
    useChatStore.getState().updateChat(patch)
    useChatStore.getState().requestChatListResync()
    set({ atendimentosLoadedFor: null })
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
