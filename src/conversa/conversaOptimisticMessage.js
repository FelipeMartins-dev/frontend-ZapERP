import { useChatStore } from "../chats/chatsStore";
import {
  fileToPreviewURL,
  getAudioFilename,
  isAudioFile,
  isImageFile,
  isVideoFile,
} from "./utils/conversaViewHelpers";

/** @returns {string} */
export function createOptimisticTempId() {
  return `temp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeOptimisticConversaId(conversaId) {
  if (typeof conversaId === "number" && Number.isFinite(conversaId)) return conversaId;
  const raw = String(conversaId ?? "").trim();
  if (!raw) return conversaId;
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    return Number.isSafeInteger(n) ? n : raw;
  }
  return conversaId;
}

export function inferTipoFromFile(file, opts = {}) {
  if (!file) return "arquivo";
  if (opts.forceStickerType) return "sticker";
  if (isAudioFile(file)) return "audio";
  if (isVideoFile(file)) return "video";
  if (isImageFile(file)) return "imagem";
  return "arquivo";
}

function previewLabelForTipo(tipo, file, caption) {
  const leg = String(caption || "").trim();
  if (leg) return leg;
  const t = String(tipo || "").toLowerCase();
  if (t === "audio" || t === "ptt" || t === "voice") return "(áudio)";
  if (t === "video" || t === "vídeo") return "(vídeo)";
  if (t === "imagem" || t === "sticker") return "(imagem)";
  return file?.name || "arquivo";
}

/**
 * Bolha outbound imediata (texto ou mídia local).
 * @param {object} params
 */
export function buildOptimisticOutgoingMessage(params) {
  const conversaId = params?.conversaId;
  const normalizedConversaId = normalizeOptimisticConversaId(conversaId);
  const tempId = params?.tempId || createOptimisticTempId();
  const now = new Date().toISOString();
  const base = {
    tempId,
    conversa_id: normalizedConversaId,
    direcao: "out",
    status: "pending",
    status_mensagem: "pending",
    criado_em: now,
    reply_meta: params?.replyMeta || undefined,
  };

  const file = params?.file;
  if (file) {
    const tipo = inferTipoFromFile(file, { forceStickerType: params?.forceStickerType });
    let blobUrl = null;
    try {
      blobUrl = fileToPreviewURL(file);
    } catch {
      blobUrl = null;
    }
    const nome = isAudioFile(file) ? getAudioFilename(file) : file?.name || "arquivo";
    const preview = previewLabelForTipo(tipo, file, params?.caption);
    return {
      ...base,
      tipo,
      texto: preview,
      conteudo: preview,
      nome_arquivo: nome,
      tamanho: file.size,
      ...(blobUrl
        ? { url: blobUrl, url_absoluta: blobUrl, _optimisticBlobUrl: blobUrl }
        : {}),
    };
  }

  const body = String(params?.texto ?? params?.conteudo ?? "").trim();
  return {
    ...base,
    tipo: "texto",
    texto: body,
    conteudo: body,
  };
}

/** Revoga blob local após URL definitiva do servidor. */
export function revokeOptimisticBlobFromMessage(msg) {
  const blob = msg?._optimisticBlobUrl;
  if (!blob || !String(blob).startsWith("blob:")) return;
  try {
    URL.revokeObjectURL(blob);
  } catch {
    /* ignore */
  }
}

export function cleanupOptimisticBlobFields(merged) {
  if (!merged || typeof merged !== "object") return merged;
  const url = merged.url || merged.url_absoluta;
  const hasServerUrl =
    url != null && String(url).trim() !== "" && !String(url).startsWith("blob:");
  if (!hasServerUrl) return merged;
  revokeOptimisticBlobFromMessage(merged);
  if (!merged._optimisticBlobUrl) return merged;
  const next = { ...merged };
  delete next._optimisticBlobUrl;
  return next;
}

/** Normaliza corpo da API POST /chats/:id/arquivo para reconciliação. */
export function normalizeArquivoApiToMessage(data, conversaId) {
  if (!data || typeof data !== "object") return null;
  const m = data.mensagem && typeof data.mensagem === "object" ? data.mensagem : data;
  if (!m || typeof m !== "object") return null;
  return {
    ...m,
    conversa_id: m.conversa_id ?? conversaId,
    direcao: m.direcao ?? "out",
  };
}

function forwardBodyFromSource(src) {
  const t = String(src?.texto || src?.conteudo || "").trim();
  if (t) return `[Encaminhado]\n${t}`;
  const url = src?.url_absoluta || src?.url;
  const nome = String(src?.nome_arquivo || "").trim();
  if (url) return `[Encaminhado]\n${nome ? `${nome}\n` : ""}${url}`;
  return "[Encaminhado]";
}

/**
 * Bolhas outbound imediatas ao encaminhar (uma por mensagem de origem).
 * @param {number|string} destConversaId
 * @param {object[]} sourceMsgs
 */
export function buildOptimisticForwardMessages(destConversaId, sourceMsgs) {
  if (destConversaId == null || !Array.isArray(sourceMsgs) || !sourceMsgs.length) return [];
  const cid = normalizeOptimisticConversaId(destConversaId);
  const baseMs = Date.now();
  return sourceMsgs.map((src, idx) => {
    const tempId = createOptimisticTempId();
    const tipoRaw = String(src?.tipo || "texto").toLowerCase();
    const tipo = tipoRaw === "vídeo" ? "video" : tipoRaw;
    const isText = tipo === "texto" || !tipo;
    const body = isText ? forwardBodyFromSource(src) : previewLabelForTipo(tipo, null, forwardBodyFromSource(src));
    const criado_em = new Date(baseMs + idx).toISOString();
    const out = {
      tempId,
      conversa_id: cid,
      direcao: "out",
      status: "pending",
      status_mensagem: "pending",
      criado_em,
      encaminhado: true,
      tipo: isText ? "texto" : tipo,
      texto: body,
      conteudo: body,
    };
    const url = src?.url_absoluta || src?.url;
    if (url && !String(url).startsWith("blob:")) {
      out.url = url;
      out.url_absoluta = src?.url_absoluta || url;
    }
    if (src?.nome_arquivo) out.nome_arquivo = src.nome_arquivo;
    if (src?.tamanho != null) out.tamanho = src.tamanho;
    return out;
  });
}

/** Insere otimistas no thread aberto + preview na lista; retorna tempIds na ordem. */
export function pushOptimisticForwardToDest(destConversaId, sourceMsgs, conversaMeta, storeActions) {
  const built = buildOptimisticForwardMessages(destConversaId, sourceMsgs);
  if (!built.length) return [];
  const isOpen =
    storeActions?.selectedId != null &&
    String(storeActions.selectedId) === String(destConversaId);
  built.forEach((m) => {
    if (isOpen && typeof storeActions?.anexarMensagemImediata === "function") {
      storeActions.anexarMensagemImediata(m);
    }
    bumpChatListWithOptimisticMessage(destConversaId, m, conversaMeta);
  });
  return built.map((m) => m.tempId);
}

/** Reconcilia tempIds com resposta do POST /encaminhar (single ou batch). */
export function reconcileForwardOptimisticTemps(tempIds, apiOutcome, reconciliarMensagem) {
  if (!tempIds?.length || typeof reconciliarMensagem !== "function") return;
  if (!apiOutcome) return;

  if (apiOutcome.kind === "single" && apiOutcome.mensagem) {
    reconciliarMensagem(tempIds[0], apiOutcome.mensagem);
    return;
  }

  if (apiOutcome.kind === "batch" && Array.isArray(apiOutcome.encaminhamentos)) {
    const items = apiOutcome.encaminhamentos;
    for (let i = 0; i < tempIds.length && i < items.length; i++) {
      const item = items[i];
      if (!item?.ok) continue;
      const real = item.mensagem ?? item.message ?? item.msg;
      if (real) reconciliarMensagem(tempIds[i], real);
    }
  }
}

/** Atualiza preview na lista lateral (mesma regra do envio de texto). */
export function bumpChatListWithOptimisticMessage(conversaId, optimisticMsg, conversaMeta) {
  if (!conversaId || !optimisticMsg) return;
  const chatStore = useChatStore.getState();
  const chats = chatStore.chats || [];
  const jaNaLista = chats.some((c) => String(c?.id) === String(conversaId));
  if (!jaNaLista && conversaMeta) {
    const nome =
      conversaMeta?.contato_nome ||
      conversaMeta?.nome_contato_cache ||
      conversaMeta?.cliente_nome ||
      conversaMeta?.nome_grupo;
    chatStore.addChat({
      id: conversaId,
      contato_nome: nome || undefined,
      foto_perfil: conversaMeta?.foto_perfil,
      ultima_mensagem: optimisticMsg,
    });
  }
  if (typeof chatStore.setUltimaMensagemEBump === "function") {
    chatStore.setUltimaMensagemEBump(conversaId, optimisticMsg);
  } else {
    chatStore.setUltimaMensagem(conversaId, optimisticMsg);
    chatStore.bumpChatToTop(conversaId);
  }
}
