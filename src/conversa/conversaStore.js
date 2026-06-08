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
import { revokeOptimisticBlobFromMessage } from "./conversaOptimisticMessage"
import {
  stableSyntheticMessageKey,
  mapDedupeKey,
  getMessageListReactKey,
  isPendingOutgoingTemp,
  applyAnexarOneToList,
  finalizeMensagensList,
  putMensagemInDedupeMap,
} from "./conversaOutboundMediaMerge.js"

export { stableSyntheticMessageKey, mapDedupeKey, getMessageListReactKey, isPendingOutgoingTemp }

/** Primeira página + loadMore: 100 mensagens, alinhado ao contrato atual de histórico paginado. */
const PAGE_LIMIT = 100

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
        let flat = preserveLocalMediaFields(prevRow, { ...prevRow, ...mergedRec })
        if (!flat.tipo && prevRow.tipo) flat.tipo = prevRow.tipo
        if (!hasRenderableUrl(flat) && hasRenderableUrl(prevRow)) {
          flat = preserveLocalMediaFields(prevRow, flat)
        }
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
      departamento_id: null,
      setor: null,
      departamento: null,
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
          departamento_id: src.departamento_id ?? null,
          setor: src.setor ?? null,
          departamento: src.departamento ?? null,
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

/** Regressão manual/automática — merge de mensagens na lista (scripts/test-audio-merge.mjs). */
export function mergeMessageIntoListForTest(list, convId, msg) {
  const next = applyAnexarOneToList(Array.isArray(list) ? [...list] : [], convId, msg)
  return finalizeMensagensList(next)
}
