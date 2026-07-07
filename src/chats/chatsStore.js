import { create } from "zustand"
import {
  chatListsStoreEquivalent,
  chatListIdsInOrder,
  chatRowStoreMergeUnchanged,
  normalizeMensagemStatusKey,
  ultimaMensagemRefsEqual,
} from "./chatListStoreCompare"
import { chatRowStableKey } from "./chatRowStableKey"
import { getChatListSortTimestampMs, sortChatListByRecent, pickNewerMessage } from "./chatListRowAtendimento"

/** Chave canônica para dedupe: conv id ou escopo instância + contato */
function canonicalKey(c) {
  return chatRowStableKey(c)
}

/** Debounce + teto: vários eventos socket seguidos → no máximo um GET /chats por janela */
let chatListResyncDebounceTimer = null
let chatListResyncMaxWaitTimer = null
let chatListResyncWindowStart = 0
const CHAT_LIST_RESYNC_DEBOUNCE_MS = 180
const CHAT_LIST_RESYNC_MAX_WAIT_MS = 700

/** Ordena conversas por última mensagem/atividade DESC (mais recente no topo). */
function sortConversasByRecent(arr) {
  return sortChatListByRecent(arr)
}

/** Remove duplicatas: mantém a que tem telefone (não lid), ultima_atividade maior, nome/foto preenchidos */
function dedupeConversas(list) {
  if (!Array.isArray(list) || list.length === 0) return list
  const byKey = new Map()
  for (const c of list) {
    const key = canonicalKey(c)
    if (!key || key === "id-") {
      byKey.set(`uniq-${c?.id ?? Math.random()}`, c)
      continue
    }
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, c)
      continue
    }
    const hasPhone = (x) => {
      const t = x?.telefone ?? x?.numero ?? x?.phone ?? ""
      const s = String(t || "").trim()
      return s && !s.toLowerCase().startsWith("lid:")
    }
    const ts = (x) => getChatListSortTimestampMs(x)
    const hasName = (x) => !!(x?.contato_nome ?? x?.nome_contato_cache ?? x?.nome_grupo ?? "").trim()
    const hasFoto = (x) => !!(x?.foto_perfil ?? x?.foto_perfil_contato_cache ?? "").trim()
    let keep = c
    if (hasPhone(existing) && !hasPhone(c)) keep = existing
    else if (!hasPhone(existing) && hasPhone(c)) keep = c
    else if (ts(c) > ts(existing)) keep = c
    else if (ts(c) === ts(existing) && (hasName(c) || hasFoto(c)) && !(hasName(existing) && hasFoto(existing))) keep = c
    else keep = existing
    byKey.set(key, keep)
  }
  return Array.from(byKey.values())
}

export const useChatStore = create((set, get) => ({
  /* =========================================
     STATE
  ========================================= */
  chats: [],
  loading: false,
  /** Incrementado após assumir/encerrar — ChatList rola ao topo (últimas conversas). */
  chatListScrollToTopNonce: 0,
  /**
   * Incrementado após eventos em tempo real que alteram fila / setor / atendente.
   * ChatList escuta e chama `load()` (que também atualiza Minha fila via refreshMinhaFila).
   */
  chatListResyncNonce: 0,
  chatListOptimisticMutation: null,
  chatListOptimisticMutationNonce: 0,

  requestChatListScrollToTop: () =>
    set((s) => ({ chatListScrollToTopNonce: (s.chatListScrollToTopNonce || 0) + 1 })),

  requestChatListResync: () => {
    const now = Date.now()
    if (!chatListResyncWindowStart) chatListResyncWindowStart = now

    const flushResync = () => {
      chatListResyncDebounceTimer = null
      chatListResyncMaxWaitTimer = null
      chatListResyncWindowStart = 0
      set((s) => ({ chatListResyncNonce: (s.chatListResyncNonce || 0) + 1 }))
    }

    if (chatListResyncDebounceTimer) clearTimeout(chatListResyncDebounceTimer)
    const elapsed = now - chatListResyncWindowStart
    const debounceDelay = Math.min(
      CHAT_LIST_RESYNC_DEBOUNCE_MS,
      Math.max(0, CHAT_LIST_RESYNC_MAX_WAIT_MS - elapsed)
    )
    chatListResyncDebounceTimer = setTimeout(flushResync, debounceDelay)

    if (!chatListResyncMaxWaitTimer) {
      chatListResyncMaxWaitTimer = setTimeout(flushResync, CHAT_LIST_RESYNC_MAX_WAIT_MS)
    }
  },

  emitChatListOptimisticMutation: (mutation) => {
    if (!mutation?.id) return
    set((s) => ({
      chatListOptimisticMutation: mutation,
      chatListOptimisticMutationNonce: (s.chatListOptimisticMutationNonce || 0) + 1,
    }))
  },

  /* =========================================
     BASE
  ========================================= */
  setChats: (chats) => {
    const arr = typeof chats === "function" ? null : (chats || [])
    if (arr) {
      const next = sortConversasByRecent(dedupeConversas(arr))
      if (chatListsStoreEquivalent(get().chats, next)) return
      set({ chats: next })
    } else {
      set((state) => {
        const next = sortConversasByRecent(dedupeConversas(chats(state.chats || []) || []))
        if (chatListsStoreEquivalent(state.chats, next)) return state
        return { chats: next }
      })
    }
  },
  setLoading: (loading) => {
    const next = !!loading
    if (get().loading === next) return
    set({ loading: next })
  },

  /** Adiciona ou atualiza conversa na lista (evita duplicar; remove "sem conversa" do mesmo cliente).
   * Ao mesclar com item existente, preserva contato_nome e foto_perfil se o payload não trouxer valor
   * (evita trocar nome/foto por "Conversa" e null em atualizações parciais via socket). */
  addChat: (chat) => {
    if (!chat?.id) return
    let chats = get().chats || []
    const idx = chats.findIndex(c => String(c.id) === String(chat.id))
    const existing = idx >= 0 ? chats[idx] : null
    // Preserva unread_count local quando o servidor não envia (ex.: resposta de fetchChatById) — evita zerar badge após nova_mensagem
    const unread =
      chat.unread_count != null || chat.unread != null
        ? Number(chat.unread_count ?? chat.unread) || 0
        : (existing ? Number(existing.unread_count ?? existing.unread) || 0 : 0)
    const merged = { ...chat, unread_count: unread }
    if (chat.cliente_id != null) {
      const chatInstance = chat?.whatsapp_instance_id ?? chat?.whatsappInstanceId ?? null
      chats = chats.filter((c) => {
        if (!c.sem_conversa || String(c.cliente_id) !== String(chat.cliente_id)) return true
        if (chatInstance == null) return false
        const rowInstance = c?.whatsapp_instance_id ?? c?.whatsappInstanceId ?? null
        return rowInstance != null && String(rowInstance) !== String(chatInstance)
      })
    }
    const nomeNorm = (v) => (v != null && String(v).trim() !== '' && String(v).trim().toLowerCase() !== 'name' ? String(v).trim() : null)
    const fotoNorm = (v) => (v != null && String(v).trim().startsWith('http') ? String(v).trim() : null)
    // NUNCA usar chatName/senderName — vêm da última mensagem e podem ser o nome do atendente (ex.: "Miguel") em msgs outbound
    const mergedNome = merged.contato_nome != null && merged.contato_nome !== '' ? merged.contato_nome
      : nomeNorm(merged.nome_contato_cache) ?? nomeNorm(merged.cliente?.nome) ?? nomeNorm(merged.clientes?.nome) ?? null
    const mergedFoto = merged.foto_perfil !== undefined && merged.foto_perfil != null ? merged.foto_perfil
      : fotoNorm(merged.foto_perfil_contato_cache) ?? fotoNorm(merged.cliente?.foto_perfil) ?? null
    const newIdx = chats.findIndex(c => String(c.id) === String(chat.id))
    if (newIdx >= 0) {
      const next = [...chats]
      const existing = next[newIdx]
      const nomeAtual = (existing.contato_nome || existing.nome || existing.nome_contato_cache || "").trim()
      const nomeNovo = (mergedNome || "").trim()
      // NOME IMUTÁVEL: se já temos nome válido (não "Conversa"), NUNCA trocar
      const manterNome = nomeAtual && nomeAtual !== "Conversa" && nomeAtual.toLowerCase() !== "conversa"
      const nomeGrupoValido = (v) => v != null && String(v).trim() !== "" && !String(v).toLowerCase().startsWith("lid:")
      const updated = {
        ...existing,
        ...merged,
        contato_nome: manterNome ? nomeAtual : (nomeNovo && nomeNovo !== "Conversa" ? nomeNovo : existing.contato_nome ?? mergedNome),
        foto_perfil: (existing.foto_perfil && String(existing.foto_perfil).trim()) || mergedFoto || existing.foto_perfil,
        nome_grupo: nomeGrupoValido(merged.nome_grupo) ? merged.nome_grupo : (existing.nome_grupo ?? merged.nome_grupo),
        foto_grupo: (merged.foto_grupo && String(merged.foto_grupo).trim().startsWith("http")) ? merged.foto_grupo : (existing.foto_grupo ?? merged.foto_grupo),
        // Preservar metadados quando payload é parcial (envio otimista)
        cliente: merged.cliente !== undefined ? merged.cliente : existing.cliente,
        telefone: merged.telefone !== undefined ? merged.telefone : existing.telefone,
        telefone_exibivel: merged.telefone_exibivel !== undefined ? merged.telefone_exibivel : existing.telefone_exibivel,
      }
      next[newIdx] = updated
      const sorted = sortConversasByRecent(dedupeConversas(next))
      if (chatListsStoreEquivalent(chats, sorted)) return
      set({ chats: sorted })
    } else {
      const newChat = {
        ...merged,
        contato_nome: mergedNome ?? merged.contato_nome ?? undefined,
        foto_perfil: mergedFoto ?? merged.foto_perfil ?? undefined
      }
      set({ chats: sortConversasByRecent(dedupeConversas([newChat, ...chats])) })
    }
  },

  /* =========================================
     🔥 PATCH GENÉRICO (usado pelo socket)
     conversa_atualizada: merge defensivo — nunca sobrescrever com undefined ou string vazio
     ultima_mensagem: usa payload.ultima_mensagem para preview (sem refetch)
  ========================================= */
  /** @returns {boolean} false se nada mudou na lista; true se aplicou patch */
  updateChat: (partial) => {
    if (!partial?.id) return false

    const chats = get().chats || []
    const idx = chats.findIndex(c => String(c.id) === String(partial.id))

    // NUNCA adicionar conversa nova via socket — evita vazamento entre setores
    if (idx === -1) return false

    const next = [...chats]
    const cur = next[idx]
    const merged = { ...cur }

    // conversa_atualizada: merge defensivo — nunca sobrescrever com undefined ou string vazio
    // telefone e cliente_id vêm ao enviar msg para deduplicação estável
    const skipKeys = new Set(["contato_nome", "nome_contato_cache", "foto_perfil", "nome_grupo", "foto_grupo"])
    const isEmptyStr = (v) => typeof v === "string" && v.trim() === ""
    for (const k of Object.keys(partial)) {
      if (k === "id" || skipKeys.has(k)) continue
      const v = partial[k]
      if (v === undefined) continue
      if (isEmptyStr(v) && cur[k] != null && !isEmptyStr(cur[k])) continue
      merged[k] = v
    }
    if (partial.nome_contato_cache != null && String(partial.nome_contato_cache).trim() !== "") {
      merged.contato_nome = partial.nome_contato_cache
      merged.nome_contato_cache = partial.nome_contato_cache
    } else if (partial.contato_nome != null && String(partial.contato_nome).trim() !== "") {
      merged.contato_nome = partial.contato_nome
      merged.nome_contato_cache = partial.nome_contato_cache ?? partial.contato_nome
    }
    if (partial.foto_perfil != null && String(partial.foto_perfil).trim() !== "") {
      merged.foto_perfil = partial.foto_perfil
      merged.foto_perfil_contato_cache = partial.foto_perfil_contato_cache ?? partial.foto_perfil
    } else if (partial.foto_perfil_contato_cache != null && String(partial.foto_perfil_contato_cache).trim() !== "") {
      merged.foto_perfil_contato_cache = partial.foto_perfil_contato_cache
      merged.foto_perfil = merged.foto_perfil || partial.foto_perfil_contato_cache
    }
    // Grupos: nunca sobrescrever nome_grupo/foto_grupo com vazio
    if (partial.nome_grupo != null && String(partial.nome_grupo).trim() !== "" && !String(partial.nome_grupo).toLowerCase().startsWith("lid:")) {
      merged.nome_grupo = partial.nome_grupo
    } else if ((!partial.nome_grupo || String(partial.nome_grupo || "").trim() === "") && (cur.nome_grupo != null && String(cur.nome_grupo).trim() !== "")) {
      merged.nome_grupo = cur.nome_grupo
    }
    if (partial.foto_grupo != null && String(partial.foto_grupo).trim().startsWith("http")) {
      merged.foto_grupo = partial.foto_grupo
    } else if (!partial.foto_grupo && cur.foto_grupo) {
      merged.foto_grupo = cur.foto_grupo
    }

    // ultima_mensagem_preview: só preview na lista — NUNCA adicionar às mensagens (não tem id)
    if (partial.ultima_mensagem_preview != null) {
      merged.ultima_mensagem_preview = partial.ultima_mensagem_preview
      merged.ultima_mensagem = partial.ultima_mensagem_preview
      if (partial.ultima_mensagem_preview?.criado_em) merged.ultima_atividade = partial.ultima_mensagem_preview.criado_em
    }
    // ultima_mensagem: se vier sem id, tratar como preview (retrocompatibilidade)
    if (partial.ultima_mensagem != null) {
      if (partial.ultima_mensagem.id != null && partial.ultima_mensagem.id !== "") {
        merged.ultima_mensagem = partial.ultima_mensagem
        if (partial.ultima_mensagem?.criado_em) merged.ultima_atividade = partial.ultima_mensagem.criado_em
      } else {
        merged.ultima_mensagem_preview = partial.ultima_mensagem
        merged.ultima_mensagem = partial.ultima_mensagem
        if (partial.ultima_mensagem?.criado_em) merged.ultima_atividade = partial.ultima_mensagem.criado_em
      }
    }
    if (partial.ultima_atividade != null) merged.ultima_atividade = partial.ultima_atividade

    const ultimaMerged = pickNewerMessage(
      cur.ultima_mensagem,
      merged.ultima_mensagem,
      cur.ultima_mensagem_preview,
      merged.ultima_mensagem_preview
    )
    if (ultimaMerged) {
      merged.ultima_mensagem = ultimaMerged
      merged.ultima_mensagem_preview = ultimaMerged
    }
    const actMs = Math.max(getChatListSortTimestampMs(cur), getChatListSortTimestampMs(merged))
    if (actMs > 0) merged.ultima_atividade = new Date(actMs).toISOString()

    if (partial.tem_novas_mensagens === true) {
      merged.tem_novas_mensagens = true
      merged.lida = false
    }
    if (partial.exibir_badge_aberta !== undefined) merged.exibir_badge_aberta = !!partial.exibir_badge_aberta
    if ("reaberta_por_falta_interacao" in partial) {
      merged.reaberta_por_falta_interacao = partial.reaberta_por_falta_interacao === true
    }
    if ("reaberta_falta_interacao_em" in partial) {
      merged.reaberta_falta_interacao_em = partial.reaberta_falta_interacao_em ?? null
      merged.reaberta_por_falta_interacao = Boolean(partial.reaberta_falta_interacao_em)
    }
    if (Array.isArray(partial.tags)) merged.tags = partial.tags
    if ("tem_novas_mensagens_em_atendimento" in partial) {
      merged.tem_novas_mensagens_em_atendimento = partial.tem_novas_mensagens_em_atendimento
    }

    // Setor / responsável: merge explícito — null limpa (não usar ?? com valor antigo)
    if ("departamento_id" in partial) merged.departamento_id = partial.departamento_id
    if ("atendente_id" in partial) merged.atendente_id = partial.atendente_id
    if ("atendente_nome" in partial) merged.atendente_nome = partial.atendente_nome
    if ("departamento" in partial) merged.departamento = partial.departamento
    if ("departamento_id" in partial && partial.departamento_id == null) {
      merged.setor = null
      merged.departamento = null
      merged.departamentos = null
    }

    if (chatRowStoreMergeUnchanged(cur, merged)) {
      const sortedProbe = sortConversasByRecent(next)
      if (
        chatListIdsInOrder(chats) === chatListIdsInOrder(sortedProbe) &&
        chatListsStoreEquivalent(chats, sortedProbe)
      ) {
        return false
      }
    }

    next[idx] = merged
    const sorted = sortConversasByRecent(next)
    if (chatListsStoreEquivalent(chats, sorted)) return false
    set({ chats: sorted })
    return true
  },

  /** Atualiza nome/foto — SÓ quando vazios. Nome é imutável: nunca trocar o existente. */
  updateChatContato: (conversa_id, { contato_nome, foto_perfil }) => {
    if (conversa_id == null) return
    const chats = get().chats || []
    const idx = chats.findIndex(c => String(c.id) === String(conversa_id))
    if (idx === -1) return
    const cur = chats[idx]
    const patch = {}
    if (contato_nome != null && String(contato_nome).trim() !== "" && (!cur?.contato_nome || !String(cur.contato_nome).trim()))
      patch.contato_nome = contato_nome
    if (foto_perfil != null && String(foto_perfil).trim() !== "" && (!cur?.foto_perfil || !String(cur.foto_perfil).trim()))
      patch.foto_perfil = foto_perfil
    if (Object.keys(patch).length === 0) return
    const next = [...chats]
    next[idx] = { ...cur, ...patch, nome_contato_cache: patch.contato_nome ?? cur.nome_contato_cache }
    set({ chats: sortConversasByRecent(next) })
  },

  /** Só preenche nome/foto quando vazio — evita sobrescrever com dados inconsistentes */
  updateChatContatoSeVazio: (conversa_id, { contato_nome, foto_perfil }) => {
    if (conversa_id == null) return
    const chats = get().chats || []
    const idx = chats.findIndex(c => String(c.id) === String(conversa_id))
    if (idx === -1) return
    const cur = chats[idx]
    const patch = {}
    if (contato_nome != null && (!cur?.contato_nome || !String(cur.contato_nome).trim())) patch.contato_nome = contato_nome
    if (foto_perfil != null && (!cur?.foto_perfil || !String(cur.foto_perfil).trim())) patch.foto_perfil = foto_perfil
    if (Object.keys(patch).length === 0) return
    const next = [...chats]
    next[idx] = { ...cur, ...patch }
    set({ chats: next })
  },

  /* =========================================
     TAGS
  ========================================= */
  adicionarTag: (conversa_id, tag) =>
    set((state) => ({
      chats: state.chats.map(c =>
        String(c.id) === String(conversa_id)
          ? {
              ...c,
              tags: (c.tags || []).some((t) => String(t.id) === String(tag?.id))
                ? (c.tags || [])
                : [...(c.tags || []), tag]
            }
          : c
      )
    })),

  removerTag: (conversa_id, tag_id) =>
    set((state) => ({
      chats: state.chats.map(c =>
        String(c.id) === String(conversa_id)
          ? {
              ...c,
              tags: (c.tags || []).filter(t => String(t.id) !== String(tag_id))
            }
          : c
      )
    })),

  /* =========================================
     🔥 MENSAGEM / PREVIEW
  ========================================= */
  setUltimaMensagem: (conversa_id, msg) =>
    set((state) => {
      const idx = state.chats.findIndex((c) => String(c.id) === String(conversa_id))
      if (idx < 0) return state
      const cur = state.chats[idx]
      const prevUm = cur?.ultima_mensagem
      if (
        prevUm &&
        ultimaMensagemRefsEqual(prevUm, msg) &&
        normalizeMensagemStatusKey(prevUm) === normalizeMensagemStatusKey(msg)
      ) {
        return state
      }
      const atividade = msg?.criado_em || cur.ultima_atividade
      const atividadeChanged = String(cur.ultima_atividade ?? "") !== String(atividade ?? "")
      const dirOut =
        msg?.direcao === "out" || msg?.fromMe === true || String(msg?.direcao || "").toLowerCase() === "outbound"
      const mergedRow = {
        ...cur,
        ultima_mensagem: msg,
        ultima_mensagem_preview: msg,
        ultima_atividade: atividade,
        ...(dirOut ? { tem_novas_mensagens_em_atendimento: false } : {}),
      }
      const next = [...state.chats]
      next[idx] = mergedRow
      if (!atividadeChanged) {
        return { chats: next }
      }
      const sorted = sortConversasByRecent(next)
      if (chatListsStoreEquivalent(state.chats, sorted)) return state
      return { chats: sorted }
    }),

  /* =========================================
     🔥 ORDENAR (TotalChat behavior)
     sobe conversa quando recebe msg — em um único set() evita "piscar"
  ========================================= */
  bumpChatToTop: (conversa_id) => {
    const chats = get().chats || []
    const idx = chats.findIndex(c => String(c.id) === String(conversa_id))
    if (idx < 0) return
    if (idx === 0) return

    const item = chats[idx]
    const next = [item, ...chats.filter((_, i) => i !== idx)]
    set({ chats: next })
  },

  /** Atualiza ultima_mensagem E move para o topo em uma única operação — evita contato "sumir" */
  setUltimaMensagemEBump: (conversa_id, msg, rowPatch = null) => {
    set((state) => {
      const chats = state.chats || []
      const idx = chats.findIndex((c) => String(c.id) === String(conversa_id))
      if (idx < 0) return state
      const cur = chats[idx]
      const isOptimistic =
        msg?.client_temp_id != null ||
        msg?.tempId != null ||
        msg?.temp_id != null
      const candidate = msg ? { ...(cur.ultima_mensagem || {}), ...msg } : cur.ultima_mensagem
      const curTs = new Date(cur?.ultima_mensagem?.criado_em || 0).getTime()
      const nextTs = new Date(candidate?.criado_em || 0).getTime()
      const useCandidate =
        !cur?.ultima_mensagem ||
        isOptimistic ||
        !Number.isFinite(curTs) ||
        !Number.isFinite(nextTs) ||
        nextTs >= curTs
      const mergedUm = useCandidate ? candidate : cur.ultima_mensagem
      const atividadeMs = Math.max(
        getChatListSortTimestampMs({ ...cur, ultima_mensagem: mergedUm, ultima_mensagem_preview: mergedUm }),
        new Date(msg?.criado_em || 0).getTime() || 0
      )
      const atividade = atividadeMs > 0 ? new Date(atividadeMs).toISOString() : cur.ultima_atividade
      const dirOut =
        mergedUm?.direcao === "out" ||
        mergedUm?.fromMe === true ||
        String(mergedUm?.direcao || "").toLowerCase() === "outbound"
      const extra = rowPatch && typeof rowPatch === "object" ? rowPatch : {}
      const updated = chats.map((c) =>
        String(c.id) === String(conversa_id)
          ? {
              ...c,
              ultima_mensagem: mergedUm,
              ultima_mensagem_preview: mergedUm,
              ultima_atividade: atividade,
              ...(dirOut ? { tem_novas_mensagens_em_atendimento: false } : {}),
              ...extra,
            }
          : c
      )
      const sorted = sortConversasByRecent(updated)
      if (chatListsStoreEquivalent(state.chats, sorted)) return state
      return { chats: sorted }
    })
  },

  /* =========================================
     🔥 UNREAD (PADRÃO BACKEND)
     usa unread_count (não unread)
  ========================================= */
  setUnread: (conversa_id, count) =>
    set((state) => {
      const target = Number(count) || 0;
      const idx = state.chats.findIndex((c) => String(c.id) === String(conversa_id));
      if (idx < 0) return state;
      if (Number(state.chats[idx]?.unread_count ?? 0) === target) return state;
      const chats = state.chats.slice();
      chats[idx] = { ...chats[idx], unread_count: target };
      return { chats };
    }),

  incUnread: (conversa_id, inc = 1) =>
    set((state) => ({
      chats: state.chats.map(c => {
        if (String(c.id) !== String(conversa_id)) return c
        const cur = Number(c.unread_count || 0)
        return { ...c, unread_count: cur + Number(inc) }
      })
    })),

  /** Para nova_mensagem direcao 'in': incrementa unread + tem_novas_mensagens + lida=false */
  incUnreadComBadge: (conversa_id, inc = 1) =>
    set((state) => ({
      chats: state.chats.map(c => {
        if (String(c.id) !== String(conversa_id)) return c
        const cur = Number(c.unread_count || 0)
        return {
          ...c,
          unread_count: cur + Number(inc),
          tem_novas_mensagens: true,
          lida: false,
        }
      })
    })),

  clearUnread: (conversa_id) =>
    set((state) => ({
      chats: state.chats.map(c =>
        String(c.id) === String(conversa_id)
          ? { ...c, unread_count: 0 }
          : c
      )
    })),

  /* =========================================
     🔥 REMOVER CHAT (opcional futuro)
  ========================================= */
  removeChat: (conversa_id) =>
    set((state) => ({
      chats: state.chats.filter(c => String(c.id) !== String(conversa_id))
    })),

  /* =========================================
     RESET
  ========================================= */
  limpar: () =>
    set({
      chats: [],
      loading: false,
      chatListResyncNonce: 0,
      chatListOptimisticMutation: null,
      chatListOptimisticMutationNonce: 0,
    })
}))
