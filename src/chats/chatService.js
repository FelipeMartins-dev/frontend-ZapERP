// src/chats/chatService.js
import api from "../api/http";
import { criarCliente } from "../api/configService";
import { parsePostClientesResponse } from "../api/parseCriarClienteResponse";

/**
 * GET /chats pode devolver array cru ou objeto com conversas/chats/items.
 * @param {unknown} data
 * @returns {any[]}
 */
export function normalizeChatsResponse(data) {
  if (data == null) return [];
  if (Array.isArray(data)) return data;
  if (typeof data === "object") {
    const raw = data.conversas ?? data.chats ?? data.items ?? data.results;
    if (Array.isArray(raw)) return raw;
  }
  return [];
}

const CHAT_LIST_PAGE_META_KEY = "__chatListPageMeta";

function readHeader(headers, name) {
  if (!headers || !name) return undefined;
  const direct = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  if (direct !== undefined) return direct;
  const found = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return found ? headers[found] : undefined;
}

function parseHeaderBoolean(value) {
  const s = String(value ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "sim";
}

function attachChatsPageMeta(list, meta) {
  if (!Array.isArray(list)) return list;
  Object.defineProperty(list, CHAT_LIST_PAGE_META_KEY, {
    value: meta,
    enumerable: false,
    configurable: true,
  });
  return list;
}

export function getChatsPageMeta(list) {
  return Array.isArray(list)
    ? list[CHAT_LIST_PAGE_META_KEY] || {
        hasMore: false,
        nextCursor: null,
        nextCursorId: null,
      }
    : { hasMore: false, nextCursor: null, nextCursorId: null };
}

// 🔹 EXPORTS NOMEADOS (usados no ChatList.jsx)
// pesquisa avançada: tag_id, data_inicio, data_fim, status_atendimento, atendente_id, palavra
export async function fetchChats(params = {}) {
  const q = new URLSearchParams();
  if (params.tag_id != null && params.tag_id !== "" && params.tag_id !== "todas") q.set("tag_id", params.tag_id);
  if (params.departamento_id != null && params.departamento_id !== "" && params.departamento_id !== "todos") q.set("departamento_id", params.departamento_id);
  if (params.data_inicio) q.set("data_inicio", params.data_inicio);
  if (params.data_fim) q.set("data_fim", params.data_fim);
  if (params.status_atendimento && params.status_atendimento !== "todos") q.set("status_atendimento", params.status_atendimento);
  if (params.atendente_id != null && params.atendente_id !== "" && params.atendente_id !== "todos") q.set("atendente_id", params.atendente_id);
  if (params.palavra && String(params.palavra).trim()) q.set("palavra", String(params.palavra).trim());
  if (params.incluir_todos_clientes === true || params.incluir_todos_clientes === "1") q.set("incluir_todos_clientes", "1");
  if (params.incluir_colaboradores_encaminhar === true || params.incluir_colaboradores_encaminhar === "1") {
    q.set("incluir_colaboradores_encaminhar", "1");
  }
  if (params.minha_fila === true || params.minha_fila === 1 || params.minha_fila === "1") q.set("minha_fila", "1");
  if (params.finalizacao_motivo != null && String(params.finalizacao_motivo).trim()) {
    q.set("finalizacao_motivo", String(params.finalizacao_motivo).trim());
  }
  if (params.aguardando_cliente === true || params.aguardando_cliente === 1 || params.aguardando_cliente === "1") {
    q.set("aguardando_cliente", "1");
  }
  if (params.pagamento_pendente === true || params.pagamento_pendente === 1 || params.pagamento_pendente === "1") {
    q.set("pagamento_pendente", "1");
  }
  if (params.em_atraso === true || params.em_atraso === 1 || params.em_atraso === "1") {
    q.set("em_atraso", "1");
  }
  if (params.cursor) q.set("cursor", String(params.cursor));
  if (params.cursorId != null && params.cursorId !== "") q.set("cursor_id", String(params.cursorId));
  if (params.cursor_id != null && params.cursor_id !== "") q.set("cursor_id", String(params.cursor_id));
  if (params.limit != null && params.limit !== "") q.set("limit", String(params.limit));
  const tp = params.tempo_parado != null ? String(params.tempo_parado).trim().toLowerCase() : "";
  if (tp) q.set("tempo_parado", tp);
  const query = q.toString();
  const response = await api.get(`/chats${query ? `?${query}` : ""}`);
  const { data, headers } = response;
  const wantsCollab =
    params.incluir_colaboradores_encaminhar === true || params.incluir_colaboradores_encaminhar === "1";
  if (wantsCollab) return splitChatsEncaminharPayload(data);
  const list = normalizeChatsResponse(data);
  const meta = {
    hasMore:
      parseHeaderBoolean(readHeader(headers, "x-chat-list-has-more")) ||
      Boolean(data?.has_more ?? data?.hasMore),
    nextCursor:
      readHeader(headers, "x-chat-list-next-cursor") ??
      data?.next_cursor ??
      data?.nextCursor ??
      null,
    nextCursorId:
      readHeader(headers, "x-chat-list-next-cursor-id") ??
      data?.next_cursor_id ??
      data?.nextCursorId ??
      null,
  };
  return attachChatsPageMeta(list, meta);
}

/**
 * Resposta de GET /chats com `incluir_colaboradores_encaminhar=1`: objeto com conversas + colaboradores.
 * @param {unknown} data
 * @returns {{ conversas: any[]; colaboradores_encaminhar: any[] }}
 */
export function splitChatsEncaminharPayload(data) {
  if (data == null) return { conversas: [], colaboradores_encaminhar: [] };
  if (Array.isArray(data)) return { conversas: data, colaboradores_encaminhar: [] };
  if (typeof data !== "object") return { conversas: [], colaboradores_encaminhar: [] };
  const o = /** @type {Record<string, unknown>} */ (data);
  const rawConv = o.conversas ?? o.chats ?? o.items ?? o.results;
  const conversas = Array.isArray(rawConv) ? rawConv : [];
  const rawCol = o.colaboradores_encaminhar ?? o.colaboradoresEncaminhar ?? [];
  const colaboradores_encaminhar = Array.isArray(rawCol) ? rawCol : [];
  return { conversas, colaboradores_encaminhar };
}

export async function fetchChatById(id) {
  const { data } = await api.get(`/chats/${id}`);
  return data;
}

export async function enviarMensagem(id, texto) {
  const { data } = await api.post(`/chats/${id}/mensagens`, { texto });
  return data;
}

export async function aplicarTag(id, tag_id) {
  const { data } = await api.post(`/chats/${id}/tags`, { tag_id });
  return data;
}

export async function removerTag(id, tag_id) {
  const { data } = await api.delete(`/chats/${id}/tags/${tag_id}`);
  return data;
}
// ===============================
// GRUPOS / COMUNIDADES
// ===============================

export async function criarGrupo(nome) {
  const { data } = await api.post("/chats/grupos", { nome });
  return data;
}

export async function criarComunidade(nome) {
  const { data } = await api.post("/chats/comunidades", { nome });
  return data;
}
/**
 * Cria ou reutiliza conversa por telefone (BR).
 * Em 400, lança Error com `codigo`, `detalhe`, `formato_esperado`, `exemplos`, `isApiValidation`.
 */
export async function criarContato(nome, telefone) {
  const nomeTrim = nome != null ? String(nome).trim() : "";
  const body = { telefone };
  if (nomeTrim) body.nome = nomeTrim;

  try {
    const { data } = await api.post("/chats/contato", body);
    return data;
  } catch (err) {
    const status = err?.response?.status;
    const payload = err?.response?.data;
    if (status === 400 && payload && typeof payload === "object") {
      const msg =
        payload.detalhe ||
        payload.error ||
        "Não foi possível criar o contato. Verifique o número.";
      const e = new Error(msg);
      e.name = "ContatoApiError";
      e.codigo = payload.codigo;
      e.detalhe = payload.detalhe;
      e.formato_esperado = payload.formato_esperado;
      e.exemplos = Array.isArray(payload.exemplos) ? payload.exemplos : [];
      e.isApiValidation = true;
      throw e;
    }
    throw err;
  }
}

/** Extrai o objeto conversa da resposta POST /chats/contato (formatos variados). */
export function conversaFromContatoResponse(data) {
  if (!data) return null;
  if (data.id != null) return data;
  return data.conversa ?? data.chat ?? null;
}

/** Apenas dígitos para comparação de telefone. */
function digitsOnly(v) {
  return String(v ?? "").replace(/\D/g, "");
}

/**
 * Núcleo BR para comparar números (ignora DDI 55 e pequenas diferenças de tamanho).
 * @param {string} d — só dígitos
 */
function digitsCoreBr(d) {
  let x = String(d || "").replace(/\D/g, "");
  if (!x) return "";
  if (x.startsWith("55") && x.length >= 12) x = x.slice(2);
  return x;
}

/**
 * Variantes comuns enviadas à API / usadas na busca (evita falhar quando o número veio sem DDI).
 * @param {string} telefone
 * @returns {string[]}
 */
export function buildTelefoneVariantsForContato(telefone) {
  const raw = digitsOnly(telefone);
  if (!raw) return [];
  const out = [];
  const push = (v) => {
    if (v && !out.includes(v)) out.push(v);
  };
  push(raw);
  if (!raw.startsWith("55") && raw.length >= 10 && raw.length <= 11) {
    push(`55${raw}`);
  }
  if (raw.startsWith("55") && raw.length >= 12) {
    push(raw.slice(2));
  }
  return out;
}

/**
 * Encontra chat na lista cujo telefone bate com alguma variante.
 * @param {any[]} chats
 * @param {string[]} variants — dígitos
 */
function findChatMatchingTelefoneVariants(chats, variants) {
  if (!Array.isArray(chats) || !variants?.length) return null;
  const cores = variants.map((v) => digitsCoreBr(v)).filter(Boolean);
  for (const c of chats) {
    const fields = [
      c?.telefone,
      c?.cliente_telefone,
      c?.telefone_exibivel,
      c?.numero,
      c?.remoteJid,
      c?.telefone_normalizado,
    ];
    for (const f of fields) {
      const core = digitsCoreBr(f);
      if (!core) continue;
      for (const want of cores) {
        if (want === core || core.endsWith(want) || want.endsWith(core)) {
          return c;
        }
      }
    }
  }
  return null;
}

function pickClienteIdFromContatoResponse(created) {
  if (!created || typeof created !== "object") return null;
  if (created.cliente_id != null) return created.cliente_id;
  const cliente = created.cliente;
  if (cliente && typeof cliente === "object" && cliente.id != null) return cliente.id;
  return null;
}

/** Abre (ou cria) conversa para um cliente da lista — retorna a conversa para abrir no atendimento */
export async function abrirConversaCliente(cliente_id) {
  const { data } = await api.post("/chats/abrir-conversa", { cliente_id });
  return data;
}

/**
 * Quando POST /chats/contato falha (ex.: “não cadastrou cliente”), abre pelo mesmo caminho do modal Novo contato:
 * POST /clientes com `abrir_conversa` — encontra ou cria conversa só pelo número (estilo WhatsApp).
 */
async function abrirConversaViaPostClientes(nome, telefoneBruto, variants) {
  const tries = [];
  const raw = String(telefoneBruto ?? "").trim();
  if (raw) tries.push(raw);
  for (const v of variants || []) {
    const s = String(v ?? "").trim();
    if (s && !tries.includes(s)) tries.push(s);
  }
  let lastErr;
  for (const tel of tries) {
    try {
      const payload = {
        telefone: tel,
        abrir_conversa: true,
      };
      const nomeTrim = nome != null ? String(nome).trim() : "";
      if (nomeTrim) payload.nome = nomeTrim;

      const rawRes = await criarCliente(payload);
      const parsed = parsePostClientesResponse(rawRes);

      if (parsed.conversa?.id != null) {
        return { conversa: parsed.conversa };
      }

      const clienteId = parsed.cliente?.id;
      if (clienteId != null) {
        const opened = await abrirConversaCliente(clienteId);
        const conv =
          conversaFromContatoResponse(opened) ??
          (opened && typeof opened === "object" ? opened.conversa ?? opened.chat : null) ??
          (opened?.id != null ? opened : null);
        if (conv?.id) return { conversa: conv };
      }

      lastErr = new Error(
        parsed.conversa_aviso ||
          "O servidor não retornou uma conversa ao cadastrar o cliente para este número."
      );
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Não foi possível abrir a conversa pelo cadastro de cliente.");
}

/** Busca ou cria conversa pelo telefone (para cartão de contato compartilhado) */
export async function abrirConversaPorTelefone(nome, telefone) {
  const variants = buildTelefoneVariantsForContato(telefone);
  if (!variants.length) throw new Error("Telefone obrigatório");

  for (const palavra of variants) {
    try {
      const list = await fetchChats({ palavra, incluir_todos_clientes: true });
      const chat = findChatMatchingTelefoneVariants(Array.isArray(list) ? list : [], variants);
      if (chat?.id) return { conversa: chat };
    } catch {
      /* tenta próxima variante na busca */
    }
  }

  let lastErr;
  for (const telTry of variants) {
    try {
      const created = await criarContato(nome || "Contato", telTry);
      const convDirect = conversaFromContatoResponse(created);
      if (convDirect?.id) return { conversa: convDirect };

      const clienteId = pickClienteIdFromContatoResponse(created);
      if (clienteId != null) {
        const opened = await abrirConversaCliente(clienteId);
        const conv =
          conversaFromContatoResponse(opened) ??
          (opened && typeof opened === "object" ? opened.conversa ?? opened.chat : null) ??
          (opened?.id != null ? opened : null);
        if (!conv?.id) throw new Error("Não foi possível abrir a conversa.");
        return { conversa: conv };
      }

      lastErr = new Error("Resposta ao criar contato não trouxe conversa nem cliente.");
    } catch (e) {
      lastErr = e;
    }
  }

  try {
    return await abrirConversaViaPostClientes(nome, telefone, variants);
  } catch (e2) {
    /* Preferir mensagem da rota alternativa; senão mantém o erro de /chats/contato */
    throw e2 || lastErr;
  }
}

/** Sincroniza contatos do celular conectado (UltraMSG Get contacts) → clientes + fotos */
export async function sincronizarContatos() {
  const { data } = await api.post("/chats/sincronizar-contatos");
  return data;
}

/** Sincroniza fotos de perfil de todos os clientes (UltraMSG Get profile-picture) */
export async function sincronizarFotosPerfil() {
  const { data } = await api.post("/chats/sincronizar-fotos-perfil");
  return data;
}

/** Verifica se a instância UltraMSG está conectada ao WhatsApp */
export async function getZapiStatus() {
  const { data } = await api.get("/chats/zapi-status");
  return data;
}

/** Finalização por ausência em lote (supervisor/admin). Body: conversa_ids, dry_run?, execute?, confirm? */
export async function postFinalizacaoAusenciaLote(body) {
  const { data } = await api.post("/chats/finalizacao-ausencia-lote", body || {});
  return data;
}

// 🔹 DEFAULT EXPORT (usado no Atendimento.jsx e wrappers)
const chatService = {
  listar: fetchChats,
  detalhar: fetchChatById,
  enviarMensagem,
  aplicarTag,
  removerTag,
  postFinalizacaoAusenciaLote,

  // novos
  criarGrupo,
  criarComunidade,
  criarContato,
  conversaFromContatoResponse,

};


export default chatService;
