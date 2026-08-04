/**
 * Fila de saída persistente para mensagens de texto enviadas sem conexão.
 *
 * Motivo: a bolha otimista vive apenas no estado do zustand e num Map em memória
 * (conversaStore). Sem conexão a requisição nunca chega ao backend, então não existe
 * linha no banco — ao recarregar a página a bolha desaparece e a mensagem é perdida.
 * Aqui a intenção de envio é gravada no localStorage e sobrevive ao F5.
 *
 * Regras:
 * - o tempId é o client_temp_id do envio original e é preservado no reenvio,
 *   para o backend deduplicar caso a primeira tentativa tenha chegado;
 * - a ordem é a de inserção e o flush para na primeira falha de rede, para não
 *   entregar mensagens fora de sequência;
 * - o item sai da fila somente após confirmação do backend (ou falha definitiva).
 */

import { classifyOutboundAxiosError, OUTBOUND_ERROR_KIND } from "./outboundSendError.js";

export const OUTBOX_STORAGE_KEY = "zap:outbox:text:v1";
const MAX_ITEMS = 100;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Depois disso a mensagem vira falha visível: melhor avisar que tentar para sempre. */
export const OUTBOX_MAX_ATTEMPTS = 8;

/** Status/flag proprios da espera por conexao (relogio, nunca erro). */
export const OUTBOX_STATUS = "aguardando_conexao";

function getStorage() {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function sanitizeItem(raw) {
  const tempId = raw?.tempId != null ? String(raw.tempId).trim() : "";
  const conversaId = raw?.conversaId != null ? String(raw.conversaId).trim() : "";
  const texto = typeof raw?.texto === "string" ? raw.texto : "";
  if (!tempId || !conversaId || !texto.trim()) return null;
  const enfileiradoEm = Number(raw?.enfileiradoEm);
  return {
    tempId,
    conversaId,
    texto,
    replyMeta: raw?.replyMeta && typeof raw.replyMeta === "object" ? raw.replyMeta : null,
    criadoEm: typeof raw?.criadoEm === "string" && raw.criadoEm ? raw.criadoEm : new Date().toISOString(),
    enfileiradoEm: Number.isFinite(enfileiradoEm) ? enfileiradoEm : Date.now(),
    tentativas: Number.isFinite(Number(raw?.tentativas)) ? Number(raw.tentativas) : 0,
    ultimoErro: raw?.ultimoErro ? String(raw.ultimoErro).slice(0, 300) : null,
  };
}

export function readOutbox() {
  const storage = getStorage();
  if (!storage) return [];
  let parsed = null;
  try {
    const raw = storage.getItem(OUTBOX_STORAGE_KEY);
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const agora = Date.now();
  const vistos = new Set();
  const limpos = [];
  for (const raw of parsed) {
    const item = sanitizeItem(raw);
    if (!item) continue;
    if (agora - item.enfileiradoEm > TTL_MS) continue;
    if (vistos.has(item.tempId)) continue;
    vistos.add(item.tempId);
    limpos.push(item);
  }
  return limpos.slice(-MAX_ITEMS);
}

function writeOutbox(items) {
  const storage = getStorage();
  if (!storage) return false;
  try {
    const lista = (Array.isArray(items) ? items : []).slice(-MAX_ITEMS);
    if (lista.length === 0) storage.removeItem(OUTBOX_STORAGE_KEY);
    else storage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(lista));
    return true;
  } catch {
    // Cota estourada ou storage indisponivel: nao pode derrubar o envio.
    return false;
  }
}

/** Idempotente por tempId: uma nova tentativa do mesmo envio nao duplica a fila. */
export function enqueueOutboxText({ conversaId, texto, tempId, replyMeta = null, criadoEm = null } = {}) {
  const item = sanitizeItem({
    tempId,
    conversaId,
    texto,
    replyMeta,
    criadoEm,
    enfileiradoEm: Date.now(),
    tentativas: 0,
  });
  if (!item) return null;
  const atual = readOutbox();
  const idx = atual.findIndex((i) => i.tempId === item.tempId);
  if (idx >= 0) {
    // Mantem a posicao original para nao furar a ordem da fila.
    const preservado = { ...atual[idx], texto: item.texto, replyMeta: item.replyMeta };
    const next = [...atual];
    next[idx] = preservado;
    writeOutbox(next);
    return preservado;
  }
  writeOutbox([...atual, item]);
  return item;
}

export function removeFromOutbox(tempId) {
  const alvo = tempId != null ? String(tempId).trim() : "";
  if (!alvo) return false;
  const atual = readOutbox();
  const next = atual.filter((i) => i.tempId !== alvo);
  if (next.length === atual.length) return false;
  writeOutbox(next);
  return true;
}

export function markOutboxAttempt(tempId, { erro = null } = {}) {
  const alvo = tempId != null ? String(tempId).trim() : "";
  if (!alvo) return null;
  const atual = readOutbox();
  const idx = atual.findIndex((i) => i.tempId === alvo);
  if (idx < 0) return null;
  const atualizado = {
    ...atual[idx],
    tentativas: Number(atual[idx].tentativas || 0) + 1,
    ultimoErro: erro ? String(erro).slice(0, 300) : atual[idx].ultimoErro,
  };
  const next = [...atual];
  next[idx] = atualizado;
  writeOutbox(next);
  return atualizado;
}

export function listOutboxForConversa(conversaId) {
  const alvo = conversaId != null ? String(conversaId).trim() : "";
  if (!alvo) return [];
  return readOutbox().filter((i) => i.conversaId === alvo);
}

export function outboxHasItems() {
  return readOutbox().length > 0;
}

/** Campos aplicados na bolha para exibir "Aguardando conexão" com relógio. */
export function outboxPendingMessageFields(item = {}) {
  return {
    status: OUTBOX_STATUS,
    status_mensagem: OUTBOX_STATUS,
    aguardando_conexao: true,
    envio_erro: false,
    envio_incerto: false,
    envio_demorado: false,
    client_temp_id: item?.tempId,
    erro_mensagem: "Aguardando conexão. Será enviada automaticamente quando a internet voltar.",
  };
}

function normalizeOutboxConversaId(conversaId) {
  if (typeof conversaId === "number" && Number.isFinite(conversaId)) return conversaId;
  const raw = String(conversaId ?? "").trim();
  if (!raw) return conversaId;
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    return Number.isSafeInteger(n) ? n : raw;
  }
  return raw;
}

/** Bolha otimista reconstruída a partir do item persistido (sobrevive ao F5). */
export function buildOutboxBubble(item) {
  const sanitized = sanitizeItem(item);
  if (!sanitized) return null;
  return {
    tempId: sanitized.tempId,
    client_temp_id: sanitized.tempId,
    conversa_id: normalizeOutboxConversaId(sanitized.conversaId),
    texto: sanitized.texto,
    tipo: "texto",
    direcao: "out",
    criado_em: sanitized.criadoEm,
    ...(sanitized.replyMeta ? { reply_meta: sanitized.replyMeta } : {}),
    ...outboxPendingMessageFields(sanitized),
  };
}

/**
 * Injeta/atualiza bolhas da fila offline na lista da conversa.
 * Idempotente por tempId: nao duplica se a bolha ja estiver na tela.
 */
export function hydrateOutboxBubblesForConversa(conversaId, existingList = []) {
  const items = listOutboxForConversa(conversaId);
  if (!items.length) return Array.isArray(existingList) ? existingList : [];
  const next = Array.isArray(existingList) ? [...existingList] : [];
  const indexByTemp = new Map();
  for (let i = 0; i < next.length; i++) {
    const m = next[i];
    const tid = String(m?.tempId || m?.client_temp_id || "").trim();
    if (tid) indexByTemp.set(tid, i);
  }
  for (const item of items) {
    const tid = String(item.tempId);
    const idx = indexByTemp.get(tid);
    if (idx != null) {
      const prev = next[idx];
      // Nao sobrescrever mensagem ja persistida no backend.
      if (prev?.id != null || prev?.whatsapp_id) continue;
      next[idx] = {
        ...prev,
        ...outboxPendingMessageFields(item),
        texto: item.texto,
        ...(item.replyMeta ? { reply_meta: item.replyMeta } : {}),
      };
      continue;
    }
    const bubble = buildOutboxBubble(item);
    if (!bubble) continue;
    next.push(bubble);
    indexByTemp.set(tid, next.length - 1);
  }
  return next;
}

export function isBrowserOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function isFalhaDeRede(classified) {
  return (
    classified?.kind === OUTBOUND_ERROR_KIND.OFFLINE ||
    classified?.kind === OUTBOUND_ERROR_KIND.TIMEOUT ||
    classified?.kind === OUTBOUND_ERROR_KIND.UNKNOWN ||
    (classified?.kind === OUTBOUND_ERROR_KIND.HTTP && classified?.uncertain === true)
  );
}

let flushEmAndamento = false;

/**
 * Reenvia a fila em ordem. A propria tentativa e o teste de acessibilidade da API:
 * se falhar por rede, para e mantem tudo enfileirado.
 *
 * @param {object} deps
 * @param {(item: object) => Promise<any>} deps.sendText executa o POST reaproveitando o tempId
 * @param {(item: object, res: any) => void} [deps.onConfirmado] backend confirmou
 * @param {(item: object, classified: object) => void} [deps.onFalhaDefinitiva] nao adianta insistir
 * @param {() => boolean} [deps.estaOffline]
 */
export async function flushOutbox({ sendText, onConfirmado, onFalhaDefinitiva, estaOffline } = {}) {
  if (typeof sendText !== "function") return { enviadas: 0, restantes: readOutbox().length, parou: "sem_sender" };
  if (flushEmAndamento) return { enviadas: 0, restantes: readOutbox().length, parou: "em_andamento" };
  if (typeof estaOffline === "function" && estaOffline()) {
    return { enviadas: 0, restantes: readOutbox().length, parou: "offline" };
  }

  flushEmAndamento = true;
  let enviadas = 0;
  let parou = null;
  try {
    // Releitura a cada volta: o storage pode ter mudado em outra aba.
    for (let guard = 0; guard < MAX_ITEMS; guard++) {
      const fila = readOutbox();
      if (!fila.length) break;
      const item = fila[0];
      try {
        const res = await sendText(item);
        removeFromOutbox(item.tempId);
        enviadas += 1;
        try {
          onConfirmado?.(item, res);
        } catch {
          /* callback de UI nao pode travar a fila */
        }
      } catch (err) {
        const classified = classifyOutboundAxiosError(err);
        const atualizado = markOutboxAttempt(item.tempId, { erro: classified.message });
        const tentativas = Number(atualizado?.tentativas || 0);
        const desistir = !isFalhaDeRede(classified) || tentativas >= OUTBOX_MAX_ATTEMPTS;
        if (desistir) {
          removeFromOutbox(item.tempId);
          try {
            onFalhaDefinitiva?.(item, classified);
          } catch {
            /* ignore */
          }
          // Erro do item, nao da rede: segue para o proximo.
          if (!isFalhaDeRede(classified)) continue;
        }
        parou = isFalhaDeRede(classified) ? "rede" : "erro_item";
        if (isFalhaDeRede(classified)) break;
      }
    }
  } finally {
    flushEmAndamento = false;
  }
  return { enviadas, restantes: readOutbox().length, parou };
}

export function _resetOutboxForTests() {
  flushEmAndamento = false;
  const storage = getStorage();
  try {
    storage?.removeItem(OUTBOX_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
