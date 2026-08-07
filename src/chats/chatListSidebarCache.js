/**

 * Snapshot leve da lista lateral (metadados de linha) — stale-while-revalidate após F5.

 * Chave por escopo empresa:usuário (`buildChatListFiltersScopeKey`).

 * Não persiste arrays de mensagens da thread nem conteúdo além do preview da última linha.

 */

const SIDEBAR_TTL_MS = 2 * 60 * 1000;
const FILTER_ROWS_TTL_MS = 45 * 1000;

const STORAGE_PREFIX = "zap_erp_chat_sidebar_v1";
const FILTER_ROWS_STORAGE_PREFIX = "zap_erp_chat_rows_by_filter_v1";

/** Cabe várias páginas após "Carregar mais" (antes 120 truncava o snapshot). */
const MAX_CHATS = 400;



function storageKey(scopeKey) {

  return `${STORAGE_PREFIX}:${scopeKey}`;

}

function filterRowsStorageKey(scopeKey, filterKey) {

  return `${FILTER_ROWS_STORAGE_PREFIX}:${scopeKey}:${filterKey}`;

}

function safeSessionKeys() {

  if (typeof sessionStorage === "undefined") return [];

  try {

    return Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.key(i)).filter(Boolean);

  } catch {

    return [];

  }

}



function trimPreviewText(msg) {

  if (!msg || typeof msg !== "object") return msg;

  const texto = msg.texto ?? msg.conteudo ?? msg.ultima_mensagem_preview ?? null;

  const s = texto != null ? String(texto) : "";

  const clipped = s.length > 280 ? `${s.slice(0, 280)}…` : s;

  return {

    id: msg.id,

    whatsapp_id: msg.whatsapp_id,

    tipo: msg.tipo,

    direcao: msg.direcao,

    status: msg.status,

    status_mensagem: msg.status_mensagem,

    criado_em: msg.criado_em,

    texto: clipped || null,

    conteudo: clipped || null,

    ultima_mensagem_preview: msg.ultima_mensagem_preview,

    nome_arquivo: msg.nome_arquivo,

  };

}



/** Remove campos pesados / thread completa antes de gravar na sessão. */

export function sanitizeChatRowForSidebarCache(chat) {

  if (!chat || chat.id == null) return null;

  const u = chat.ultima_mensagem;

  const tags = Array.isArray(chat.tags)

    ? chat.tags.slice(0, 3).map((t) =>

        t && typeof t === "object"

          ? { id: t.id, nome: t.nome, cor: t.cor }

          : t

      )

    : undefined;

  return {

    id: chat.id,

    cliente_id: chat.cliente_id,

    sem_conversa: chat.sem_conversa,

    contato_nome: chat.contato_nome,

    nome_contato_cache: chat.nome_contato_cache,

    cliente_nome: chat.cliente_nome,

    nome_grupo: chat.nome_grupo,

    telefone: chat.telefone,

    telefone_exibivel: chat.telefone_exibivel,

    foto_perfil: chat.foto_perfil,

    foto_perfil_contato_cache: chat.foto_perfil_contato_cache,

    foto_grupo: chat.foto_grupo,

    unread_count: chat.unread_count,

    unread: chat.unread,

    tem_novas_mensagens: chat.tem_novas_mensagens,

    tem_novas_mensagens_em_atendimento: chat.tem_novas_mensagens_em_atendimento,

    lida: chat.lida,

    status_atendimento: chat.status_atendimento,

    status_atendimento_real: chat.status_atendimento_real,

    exibir_badge_aberta: chat.exibir_badge_aberta,

    finalizacao_motivo: chat.finalizacao_motivo,

    aguardando_cliente_desde: chat.aguardando_cliente_desde,

    atendente_id: chat.atendente_id,

    atendente_nome: chat.atendente_nome,

    departamento_id: chat.departamento_id,

    departamento: chat.departamento

      ? { id: chat.departamento.id, nome: chat.departamento.nome }

      : undefined,

    setor: chat.setor,

    fixada: chat.fixada,

    silenciado: chat.silenciado,

    silenciada: chat.silenciada,

    favorita: chat.favorita,

    ultima_atividade: chat.ultima_atividade,

    ultima_mensagem: u ? trimPreviewText(u) : null,

    tags,

  };

}



function slimList(arr) {

  return (Array.isArray(arr) ? arr : [])

    .map(sanitizeChatRowForSidebarCache)

    .filter(Boolean)

    .slice(0, MAX_CHATS);

}



function readParsed(scopeKey) {

  if (typeof sessionStorage === "undefined" || !scopeKey) return null;

  try {

    const raw = sessionStorage.getItem(storageKey(scopeKey));

    if (!raw) return null;

    const parsed = JSON.parse(raw);

    if (!parsed || Date.now() - (parsed.t || 0) > SIDEBAR_TTL_MS) {

      sessionStorage.removeItem(storageKey(scopeKey));

      return null;

    }

    return parsed;

  } catch {

    return null;

  }

}



/**

 * @returns {{ chats: object[], minhaFila: object[]|null, minhaFilaCount: number|null, emAtendimentoBadgeCount: number|null, aguardandoClienteBadgeCount: number|null, mensagensDisparadasCount: number|null }|null}

 */

export function hydrateChatListSidebarFromSession(scopeKey) {

  const parsed = readParsed(scopeKey);

  if (!parsed) return null;

  const chats = Array.isArray(parsed.chats) ? parsed.chats.slice(0, MAX_CHATS) : [];

  /** Nunca reutilizar `chats` (Todas) como Minha fila — abas têm escopos distintos. */
  const minhaFila = Array.isArray(parsed.minhaFila)
    ? parsed.minhaFila.slice(0, MAX_CHATS)
    : null;

  return {

    chats,

    minhaFila,

    minhaFilaCount:
      typeof parsed.minhaFilaCount === "number"
        ? parsed.minhaFilaCount
        : minhaFila != null
          ? minhaFila.length
          : null,

    emAtendimentoBadgeCount:

      typeof parsed.emAtendimentoBadgeCount === "number"

        ? parsed.emAtendimentoBadgeCount

        : null,

    aguardandoClienteBadgeCount:

      typeof parsed.aguardandoClienteBadgeCount === "number"

        ? parsed.aguardandoClienteBadgeCount

        : null,

    mensagensDisparadasCount:

      typeof parsed.mensagensDisparadasCount === "number"

        ? parsed.mensagensDisparadasCount

        : null,

  };

}

export function hydrateChatListRowsForFilterFromSession(scopeKey, filterKey) {

  if (typeof sessionStorage === "undefined" || !scopeKey || !filterKey) return null;

  try {

    const key = filterRowsStorageKey(scopeKey, filterKey);

    const raw = sessionStorage.getItem(key);

    if (!raw) return null;

    const parsed = JSON.parse(raw);

    if (!parsed || Date.now() - (parsed.t || 0) > FILTER_ROWS_TTL_MS) {

      sessionStorage.removeItem(key);

      return null;

    }

    const rows = Array.isArray(parsed.rows) ? parsed.rows.slice(0, MAX_CHATS) : [];

    return rows.length ? rows : null;

  } catch {

    return null;

  }

}

export function persistChatListRowsForFilterToSession(scopeKey, filterKey, rows) {

  if (typeof sessionStorage === "undefined" || !scopeKey || !filterKey) return;

  const slim = slimList(rows);

  if (!slim.length) return;

  try {

    sessionStorage.setItem(

      filterRowsStorageKey(scopeKey, filterKey),

      JSON.stringify({ t: Date.now(), rows: slim })

    );

  } catch {

    /* quota */

  }

}

export function clearChatListRowsFilterSessionCache(scopeKey) {

  if (typeof sessionStorage === "undefined") return;

  const prefix = scopeKey

    ? `${FILTER_ROWS_STORAGE_PREFIX}:${scopeKey}:`

    : `${FILTER_ROWS_STORAGE_PREFIX}:`;

  for (const key of safeSessionKeys()) {

    if (key.startsWith(prefix)) {

      try {

        sessionStorage.removeItem(key);

      } catch {

        /* ignore */

      }

    }

  }

}

export function clearChatListSidebarSessionCache() {

  if (typeof sessionStorage === "undefined") return;

  for (const key of safeSessionKeys()) {

    if (key.startsWith(`${STORAGE_PREFIX}:`) || key.startsWith(`${FILTER_ROWS_STORAGE_PREFIX}:`)) {

      try {

        sessionStorage.removeItem(key);

      } catch {

        /* ignore */

      }

    }

  }

}



/** Persiste lista geral + metadados de aba Minha fila e contadores de chips (sem mensagens). */

export function persistChatListSidebarToSession(scopeKey, chats, extras = {}) {

  if (typeof sessionStorage === "undefined" || !scopeKey) return;

  const arr = Array.isArray(chats) ? chats : [];

  if (arr.length === 0 && !extras?.minhaFila?.length) return;

  try {

    const slim = slimList(arr);

    const minhaFila = extras.minhaFila != null ? slimList(extras.minhaFila) : undefined;

    sessionStorage.setItem(

      storageKey(scopeKey),

      JSON.stringify({

        t: Date.now(),

        chats: slim.length ? slim : minhaFila || [],

        ...(minhaFila?.length ? { minhaFila } : {}),

        ...(extras.minhaFilaCount != null ? { minhaFilaCount: extras.minhaFilaCount } : {}),

        ...(extras.emAtendimentoBadgeCount != null

          ? { emAtendimentoBadgeCount: extras.emAtendimentoBadgeCount }

          : {}),

        ...(extras.aguardandoClienteBadgeCount != null

          ? { aguardandoClienteBadgeCount: extras.aguardandoClienteBadgeCount }

          : {}),

        ...(extras.mensagensDisparadasCount != null

          ? { mensagensDisparadasCount: extras.mensagensDisparadasCount }

          : {}),

      })

    );

  } catch {

    /* quota */

  }

}


