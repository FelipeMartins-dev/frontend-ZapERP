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

const PAGE_LIMIT = 100

function toMillis(value) {
  if (!value) return NaN
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : NaN
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
  return `syn:${conversaId}:${dir}:${ts}:${tipo}:${rem}:${textoSnippet}`
}

/** Chave única para Map dedupe (lista + merge API). */
export function mapDedupeKey(m, conversaId) {
  const conv = String(conversaId ?? "")
  if (m?.whatsapp_id != null && String(m.whatsapp_id).trim() !== "") return `wa-${conv}-${String(m.whatsapp_id)}`
  if (m?.id != null) return `id-${String(m.id)}`
  if (m?.tempId != null) return `temp-${String(m.tempId)}`
  return stableSyntheticMessageKey(m, conversaId)
}

/** Chave estável para React (evita colisão e remount errado). */
export function getMessageListReactKey(m, conversaId) {
  if (!m) return "unknown"
  if (m.tempId != null && String(m.tempId).trim() !== "") return String(m.tempId)
  if (m.id != null) return String(m.id)
  if (m.whatsapp_id != null && String(m.whatsapp_id).trim() !== "") return `wa-${String(m.whatsapp_id)}`
  return stableSyntheticMessageKey(m, conversaId)
}

function normalizeMsgForStore(msg) {
  if (!msg || typeof msg !== "object") return msg
  const n = { ...msg }
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

/** Ordem cronológica estável (evita “sumir” / saltos quando timestamps coincidem). */
function sortMensagensChronological(arr) {
  return [...(arr || [])].sort((a, b) => {
    const ta = toMillis(a?.criado_em) || 0
    const tb = toMillis(b?.criado_em) || 0
    if (ta !== tb) return ta - tb
    const ida = Number(a?.id)
    const idb = Number(b?.id)
    if (Number.isFinite(ida) && Number.isFinite(idb) && ida !== idb) return ida - idb
    const wa = String(a?.whatsapp_id || "").localeCompare(String(b?.whatsapp_id || ""))
    if (wa !== 0) return wa
    return String(a?.tempId || "").localeCompare(String(b?.tempId || ""))
  })
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

export const useConversaStore = create((set, get) => ({
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

  setSelectedId: (id) => set({ selectedId: id }),

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
    const normalizedId = id != null && id !== "" ? (Number(id) || String(id)) : null
    if (!normalizedId) return

    const prevId = get().selectedId
    if (prevId && String(prevId) !== String(normalizedId)) {
      leaveConversa(prevId)
    }
    joinConversaIfNeeded(normalizedId)

    set({
      loading: true,
      selectedId: normalizedId,
      loadError: null,
      cursor: null,
      cursorId: null,
      hasMore: true,
      mensagens: [],
      tags: [],
      conversa: null,
      lockedBy: null,

      atendimentos: [],
      atendimentosLoading: false,
      atendimentosLoadedFor: null,
    })

    try {
      const data = await getChatById(normalizedId, { limit: PAGE_LIMIT })

      // Evita aplicar resposta de conversa antiga se o usuário já trocou de conversa (race condition)
      if (String(get().selectedId) !== String(normalizedId)) return

      let conversa = data?.conversa ? data.conversa : (data ?? null)
      let mensagens = data?.mensagens ?? conversa?.mensagens ?? []
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

      if (Array.isArray(mensagens)) {
        const byKey = new Map()
        mensagens.forEach((raw) => {
          if (!raw) return
          const copy = normalizeMsgForStore({ ...raw, conversa_id: normalizedId })
          const k = mapDedupeKey(copy, normalizedId)
          const prev = byKey.get(k)
          byKey.set(k, prev ? { ...prev, ...copy } : copy)
        })
        mensagens = sortMensagensChronological(Array.from(byKey.values()))
      } else {
        mensagens = []
      }
      mensagens = attachReplyMeta(normalizedId, mensagens)

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

      set({
        conversa,
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
      // Sincroniza status na lista lateral com o header/detalhe (GET /chats/:id).
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
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || "Erro ao carregar conversa"
      console.error("Erro ao carregar conversa:", err)
      set({ loading: false, loadError: msg })
    }
  },

  /* =====================================================
     REFRESH
  ===================================================== */
  /** UPSERT: mescla mensagens da API com as existentes. Preserva mensagens que chegaram via socket e ainda não estão na API (evita "aparecer e sumir"). */
  _mergeMensagensFromApi: (existing, fromApi, conversaId) => {
    if (!Array.isArray(fromApi)) fromApi = []
    const map = new Map()
    const put = (raw) => {
      if (!raw) return
      const copy = normalizeMsgForStore({ ...raw, conversa_id: conversaId })
      const k = mapDedupeKey(copy, conversaId)
      const prev = map.get(k)
      map.set(k, prev ? { ...prev, ...copy } : copy)
    }
    existing.forEach(put)
    fromApi.forEach(put)
    return sortMensagensChronological(Array.from(map.values()))
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

      // MERGE: nunca substituir — preserva mensagens via nova_mensagem que ainda não estão na API
      // Quando mensagens_bloqueadas (assumida por outro), API envia vazio → substituir
      const existing = get().mensagens || []
      let mensagens = mensagens_bloqueadas
        ? []
        : get()._mergeMensagensFromApi(existing, apiMensagens, id)
      mensagens = attachReplyMeta(id, mensagens)

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

      set({
        conversa: merged,
        mensagens,
        tags,
        loading: false,
        cursor: nextCursor,
        cursorId: Number.isFinite(nextCursorId) ? nextCursorId : null,
        hasMore: !!nextCursor,
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
        const put = (raw) => {
          if (!raw) return
          const copy = normalizeMsgForStore({ ...raw, conversa_id: selectedId })
          const k = mapDedupeKey(copy, selectedId)
          const prev = map.get(k)
          map.set(k, prev ? { ...prev, ...copy } : copy)
        }
        ;(mais || []).forEach(put)
        atual.forEach(put)
        const sorted = sortMensagensChronological(Array.from(map.values()))
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
     Nunca append cego: verifica id OU (conversa_id + whatsapp_id).
     Após qualquer upsert: SEMPRE ordenar por criado_em ASC = última posição.
  ===================================================== */
  _sortMensagensByCriadoEmAsc: (arr) => sortMensagensChronological(arr),

  anexarMensagem: (msg) => {
    msg = normalizeMsgForStore(msg)
    const conversaId = msg?.conversa_id ?? get().conversa?.id
    if (!conversaId) return
    const key = mapDedupeKey(msg, conversaId)
    set((state) => {
      const list = state.mensagens || []
      const convId = state.conversa?.id ?? conversaId

      // UPSERT: por id OU por (conversa_id + whatsapp_id) — evita "aparecer e sumir"
      const findExisting = () => {
        if (msg.id != null) {
          const byId = list.findIndex((m) => String(m.id) === String(msg.id))
          if (byId >= 0) return byId
        }
        const waId = msg.whatsapp_id || null
        if (waId && convId) {
          const byWa = list.findIndex((m) => (m.conversa_id == null || String(m.conversa_id) === String(convId)) && String(m.whatsapp_id || "") === String(waId))
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
        // MERGE: atualizar campos (status, whatsapp_id, id se faltando)
        const existing = list[existingIdx]
        const merged = { ...existing, ...msg }
        if (convId) merged.conversa_id = convId
        if (msg.id && !existing.id) merged.id = msg.id
        if (msg.whatsapp_id && !existing.whatsapp_id) merged.whatsapp_id = msg.whatsapp_id
        if (msg.status != null) merged.status = msg.status
        if (msg.status_mensagem != null) merged.status_mensagem = msg.status_mensagem
        const next = [...list]
        next[existingIdx] = merged
        return { mensagens: get()._sortMensagensByCriadoEmAsc(next) }
      }

      // Reconciliação: socket nova_mensagem fromMe → SUBSTITUIR temp otimista, NUNCA duplicar
      // Funciona com whatsapp_id OU id (backend pode enviar um ou outro)
      const isFromMe = isOutgoingLike(msg)
      const textoIn = (msg.texto || msg.conteudo || "").toString().trim()
      const recentMs = 90_000
      const now = Date.now()

      if (isFromMe) {
        let replaceIdx = -1
        // 1) Procurar temp otimista (tempId, direcao out, recente)
        for (let i = list.length - 1; i >= 0; i--) {
          const m = list[i]
          if (m?.tempId && isOutgoingLike(m)) {
            const ts = toMillis(m?.criado_em)
            if (Number.isFinite(ts) && now - ts < recentMs) {
              const textoMatch = !textoIn || (m.texto || m.conteudo || "").toString().trim() === textoIn
              if (textoMatch) {
                replaceIdx = i
                break
              }
            }
          }
        }
        if (replaceIdx >= 0) {
          const existing = list[replaceIdx]
          const merged = { ...existing, ...msg, conversa_id: convId }
          if (msg.id) merged.id = msg.id
          if (msg.whatsapp_id) merged.whatsapp_id = msg.whatsapp_id
          if (msg.status != null) merged.status = msg.status
          if (msg.status_mensagem != null) merged.status_mensagem = msg.status_mensagem
          const tsExisting = toMillis(existing?.criado_em)
          const tsMsg = toMillis(msg?.criado_em)
          if (tsExisting > tsMsg || !msg.criado_em) merged.criado_em = existing.criado_em
          const next = [...list]
          next[replaceIdx] = merged
          return { mensagens: get()._sortMensagensByCriadoEmAsc(next) }
        }
      }

      // Cenário 3: API chegou depois do socket (reconciliarMensagem chama anexarMensagem)
      // Socket já substituiu temp; realMsg tem id da API mas nossa msg tem whatsapp_id sem id
      // Procurar msg "out" recente com whatsapp_id mas sem id → merge id + reply_meta da API
      const isFromMeAlt = isOutgoingLike(msg)
      if (msg.id && isFromMeAlt) {
        const now = Date.now()
        const recentMs = 90_000
        const textoIn = (msg.texto || msg.conteudo || "").toString().trim()
        for (let i = list.length - 1; i >= 0; i--) {
          const m = list[i]
          if (!isOutgoingLike(m)) continue
          if (m?.tempId) continue
          const ts = toMillis(m?.criado_em)
          if (!Number.isFinite(ts) || now - ts > recentMs) break
          const textoMatch = !textoIn || (m.texto || m.conteudo || "").toString().trim() === textoIn
          if (m.whatsapp_id && !m.id && textoMatch) {
            const merged = { ...m, ...msg, conversa_id: convId }
            // Preservar status mais avançado: socket pode ter "sent" enquanto API retorna "pending"
            const order = { pending: 0, sent: 1, delivered: 2, read: 3, played: 4 }
            const mVal = order[String(m?.status_mensagem || m?.status || "").toLowerCase()] ?? 0
            const msgVal = order[String(msg?.status_mensagem || msg?.status || "").toLowerCase()] ?? 0
            if (mVal > msgVal) {
              merged.status = m.status
              merged.status_mensagem = m.status_mensagem
            }
            const next = [...list]
            next[i] = merged
            return { mensagens: get()._sortMensagensByCriadoEmAsc(next) }
          }
        }
      }

      // Nova mensagem: adicionar com dedupe por Map (chaves estáveis — sem legacy-${i})
      const byKey = new Map()
      list.forEach((m) => {
        const mk = mapDedupeKey(m, convId)
        byKey.set(mk, m)
      })
      const newMsg = normalizeMsgForStore({ ...msg })
      if (convId) newMsg.conversa_id = convId
      const newK = mapDedupeKey(newMsg, convId)
      byKey.set(newK, newMsg)
      return { mensagens: get()._sortMensagensByCriadoEmAsc(Array.from(byKey.values())) }
    })
  },

  /** Substitui mensagem temp (optimistic) pela real quando API retorna.
   * Se temp não existir (socket chegou primeiro), faz merge via anexarMensagem. */
  reconciliarMensagem: (tempId, realMsg) => {
    if (!tempId || !realMsg) return
    let replaced = false
    set((state) => {
      const list = state.mensagens || []
      const idx = list.findIndex((m) => String(m.tempId) === String(tempId))
      if (idx >= 0) {
        replaced = true
        const next = [...list]
        next[idx] = { ...realMsg, conversa_id: state.conversa?.id }
        return { mensagens: get()._sortMensagensByCriadoEmAsc(next) }
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
        next[i] = { ...next[i], ...partial }
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
  limpar: () =>
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
    }),
}))
