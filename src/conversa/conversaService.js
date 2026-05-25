import api from "../api/http";

// Observação do cliente (rota existente no backend)
export const salvarObservacao = (id, observacao) =>
  api.put(`/chats/${id}/observacao`, { observacao });

/** Atualiza nome exibido na conversa (cache) e no cadastro do cliente vinculado, sem criar duplicata. */
export async function atualizarNomeContatoConversa(conversaId, nome) {
  const id = conversaId != null ? String(conversaId) : "";
  if (!id) throw new Error("conversaId inválido");
  const { data } = await api.put(`/chats/${id}/nome-contato`, { nome: String(nome || "").trim() });
  return data;
}

// Vincula um cliente existente a uma conversa (tenta variações comuns de rota).
export async function vincularClienteConversa(conversaId, cliente_id) {
  const id = conversaId != null ? String(conversaId) : "";
  if (!id) throw new Error("conversaId inválido");
  if (cliente_id == null || cliente_id === "") throw new Error("cliente_id inválido");

  const body = { cliente_id: Number(cliente_id) || String(cliente_id) };
  const tries = [
    () => api.put(`/chats/${id}/cliente`, body),
    () => api.put(`/chats/${id}/vincular-cliente`, body),
    () => api.put(`/chats/${id}`, body),
    () => api.patch(`/chats/${id}`, body),
  ];

  let lastErr = null;
  for (const fn of tries) {
    try {
      const { data } = await fn();
      return data;
    } catch (e) {
      lastErr = e;
      const st = e?.response?.status;
      // se for "rota não existe" ou "método não permitido", tenta a próxima
      if (st === 404 || st === 405) continue;
      throw e;
    }
  }
  throw lastErr || new Error("Não foi possível vincular cliente à conversa.");
}

// Responsável: use assumirChat(conversaId) ou transferirChat(conversaId, usuarioId)
// Não existe PUT /chats/:id/responsavel no backend.
// export const salvarResponsavel = ...

// Origem: rota não implementada no backend (sem PUT /chats/:id/origem).
// export const salvarOrigem = ...


// ✅ NOVO (compatível com o erro atual do store)
// Permite também paginação futura: cursor/limit (se seu backend suportar)
export async function getChatById(conversaId, opts = {}) {
  const params = new URLSearchParams();
  if (opts?.cursor) params.set("cursor", String(opts.cursor));
  if (opts?.cursorId != null && opts?.cursorId !== "") params.set("cursor_id", String(opts.cursorId));
  if (opts?.limit) params.set("limit", String(opts.limit));

  const qs = params.toString();
  const config = {};
  if (opts?.signal) config.signal = opts.signal;
  const { data } = await api.get(`/chats/${conversaId}${qs ? `?${qs}` : ""}`, config);
  return data;
}

// ✅ Mantido (não remover): compatibilidade com código antigo
export async function fetchConversa(conversaId) {
  return getChatById(conversaId);
}

export async function enviarMensagem(conversaId, texto, reply_meta) {
  const body = { texto };
  if (reply_meta && typeof reply_meta === "object") body.reply_meta = reply_meta;
  const { data } = await api.post(`/chats/${conversaId}/mensagens`, body);
  return data;
}

export async function enviarLink(conversaId, { url, titulo, descricao, imagem, texto, reply_meta } = {}) {
  const linkUrl = String(url || "").trim();
  if (!linkUrl) throw new Error("URL obrigatória");
  const body = {
    texto: texto || linkUrl,
    link: {
      url: linkUrl,
      ...(titulo ? { title: titulo } : {}),
      ...(descricao ? { description: descricao } : {}),
      ...(imagem ? { image: imagem } : {}),
    },
  };
  if (reply_meta && typeof reply_meta === "object") body.reply_meta = reply_meta;
  const { data } = await api.post(`/chats/${conversaId}/mensagens`, body);
  return data;
}

export async function getPixConfig() {
  const { data } = await api.get('/chats/pix-config');
  return data;
}

export async function putPixConfig(payload) {
  const { data } = await api.put('/chats/pix-config', payload || {});
  return data;
}

export async function enviarMensagemPix(conversaId) {
  const { data } = await api.post(`/chats/${conversaId}/pix`);
  return data;
}

export async function excluirMensagem(conversaId, mensagemId, opts = {}) {
  const params = {};
  if (opts?.scope) params.scope = String(opts.scope);
  const { data } = await api.delete(`/chats/${conversaId}/mensagens/${mensagemId}`, { params });
  return data;
}

const ENC_TIPO = "auto";
const ENC_MAX_IDS = 30;

function normalizeEncaminharIds(mensagemIdOrIds) {
  const raw = Array.isArray(mensagemIdOrIds) ? mensagemIdOrIds : [mensagemIdOrIds];
  const out = [];
  const seen = new Set();
  for (const x of raw) {
    const n = Number(x);
    if (!Number.isFinite(n) || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  if (out.length === 0) throw new Error("Nenhuma mensagem para encaminhar.");
  if (out.length > ENC_MAX_IDS) throw new Error(`No máximo ${ENC_MAX_IDS} mensagens por encaminhamento.`);
  return out;
}

/**
 * Encaminha mensagem(ns) via API backend — preserva tipo, url e metadados originais.
 * Uma mensagem: body com `mensagem_id`. Várias: `mensagem_ids` na ordem informada (sem duplicar).
 * @returns {Promise<
 *   | { kind: "single"; mensagem: any; raw: any }
 *   | { kind: "batch"; raw: any; total?: number; encaminhamentos: any[] }
 * >}
 */
export async function encaminharMensagemViaAPI(conversaId, mensagemIdOrIds) {
  const ids = normalizeEncaminharIds(mensagemIdOrIds);
  const body =
    ids.length === 1
      ? { mensagem_id: ids[0], tipo_encaminhamento: ENC_TIPO }
      : { mensagem_ids: ids, tipo_encaminhamento: ENC_TIPO };
  const { data } = await api.post(`/chats/${conversaId}/encaminhar`, body);

  if (ids.length === 1) {
    const mensagem = data?.mensagem ?? data;
    return {
      kind: "single",
      mensagem: mensagem ? { ...mensagem, encaminhado: true } : mensagem,
      raw: data,
    };
  }
  return {
    kind: "batch",
    raw: data,
    total: data?.total,
    encaminhamentos: Array.isArray(data?.encaminhamentos) ? data.encaminhamentos : [],
  };
}

/**
 * Encaminha um arquivo/mídia para outra conversa — re-envia o arquivo via re-upload.
 * Usado como fallback quando a API de encaminhamento não está disponível.
 */
export async function encaminharArquivo(conversaId, msg, getMediaUrl) {
  if (!msg?.url && !msg?.url_absoluta) throw new Error("Arquivo sem URL disponível para encaminhar.");
  const mediaUrl = msg?.url_absoluta || (getMediaUrl ? getMediaUrl(msg.url) : msg.url);
  if (!mediaUrl) throw new Error("URL do arquivo não disponível.");

  const urlToFetch = mediaUrl.startsWith("http") ? mediaUrl : (msg.url.startsWith("/") ? msg.url : `/${msg.url}`);
  const { data: blob } = await api.get(urlToFetch, { responseType: "blob" });
  const nomeArquivo = String(msg?.nome_arquivo || "arquivo").trim() || "arquivo";
  const file = new File([blob], nomeArquivo, { type: blob.type || "application/octet-stream" });

  const formData = new FormData();
  formData.append("file", file, nomeArquivo);
  formData.append("encaminhado", "true");

  // Content-Type: false remove o header para o browser definir multipart/form-data com boundary.
  const { data } = await api.post(`/chats/${conversaId}/arquivo`, formData, {
    headers: { "Content-Type": false },
  });
  return data;
}

export async function enviarReacao(conversaId, mensagemId, reaction) {
  const body = { reaction };
  const { data } = await api.post(`/chats/${conversaId}/mensagens/${mensagemId}/reacao`, body);
  return data;
}

export async function removerReacao(conversaId, mensagemId) {
  const { data } = await api.delete(`/chats/${conversaId}/mensagens/${mensagemId}/reacao`);
  return data;
}

export async function assumirChat(conversaId) {
  const { data } = await api.post(`/chats/${conversaId}/assumir`);
  return data;
}

export async function encerrarChat(conversaId) {
  const { data } = await api.post(`/chats/${conversaId}/encerrar`);
  return data;
}

export async function reabrirChat(conversaId) {
  const { data } = await api.post(`/chats/${conversaId}/reabrir`);
  return data;
}

// ✅ Mantido: compatível com seu backend
export async function transferirChat(conversaId, novo_atendente_id, observacao) {
  const body = {
    para_usuario_id: Number(novo_atendente_id),
    observacao: observacao || null,
  };

  const { data } = await api.post(`/chats/${conversaId}/transferir`, body);
  return data;
}

/** Marca atendimento humano como aguardando resposta do cliente (estado manual; distinto do job de ausência). */
export async function marcarAguardandoClienteChat(conversaId) {
  const { data } = await api.post(`/chats/${conversaId}/aguardando-cliente`);
  return data;
}

/** Volta de aguardando_cliente (manual) para em_atendimento. */
export async function retomarAtendimentoChat(conversaId) {
  const { data } = await api.post(`/chats/${conversaId}/retomar-atendimento`);
  return data;
}

/** Financeiro: marca cobrança com prazo (pagamento pendente). */
export async function marcarAguardandoPagamentoChat(conversaId, { prazo, data }) {
  const { data: res } = await api.post(`/chats/${conversaId}/aguardando-pagamento`, { prazo, data });
  return res;
}

export async function listarAtendimentos(conversaId) {
  const { data } = await api.get(`/chats/${conversaId}/atendimentos`);
  return data || [];
}

export async function puxarChatFila() {
  const { data } = await api.post("/chats/puxar");
  return data; // { conversa_id }
}

export async function enviarLocalizacao(conversaId, payload = {}) {
  if (conversaId == null) throw new Error("conversaId obrigatório");
  const lat = payload.lat ?? payload.latitude;
  const lng = payload.lng ?? payload.longitude;
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) throw new Error("Latitude e longitude obrigatórias");
  const body = { lat: la, lng: ln };
  const nome = payload.nome ?? payload.name ?? payload.placeName;
  const endereco = payload.endereco ?? payload.address;
  if (nome != null && String(nome).trim()) body.nome = String(nome).trim();
  if (endereco != null && String(endereco).trim()) body.endereco = String(endereco).trim();
  const { data } = await api.post(`/chats/${conversaId}/localizacao`, body);
  return data;
}

export async function enviarContato(conversaId, cliente_id, messageId) {
  const body = { cliente_id };
  if (messageId) body.messageId = messageId;
  const { data } = await api.post(`/chats/${conversaId}/contatos`, body);
  return data;
}

export async function registrarLigacao(conversaId, callDuration) {
  const body = {};
  if (callDuration != null) body.callDuration = callDuration;
  const { data } = await api.post(`/chats/${conversaId}/ligacao`, body);
  return data;
}

// TAGS
export async function adicionarTagConversa(conversaId, tagId) {
  const { data } = await api.post(`/chats/${conversaId}/tags`, { tag_id: tagId });
  return data;
}

export async function removerTagConversa(conversaId, tagId) {
  const { data } = await api.delete(`/chats/${conversaId}/tags/${tagId}`);
  return data;
}
