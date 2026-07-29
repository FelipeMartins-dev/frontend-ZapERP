import api from "../api/http";

/**
 * Salva uma observação interna no chat/cliente.
 */
export const salvarObservacao = (id, observacao) =>
  api.put(`/chats/${id}/observacao`, { observacao });

/** * Atualiza nome exibido na conversa (cache) e no cadastro do cliente vinculado, sem criar duplicata. 
 */
export async function atualizarNomeContatoConversa(conversaId, nome) {
  const id = conversaId != null ? String(conversaId) : "";
  if (!id) throw new Error("conversaId inválido");
  const { data } = await api.put(`/chats/${id}/nome-contato`, { nome: String(nome || "").trim() });
  return data;
}

/**
 * Vincula um cliente existente a uma conversa (testa variações comuns de rotas/fallbacks).
 */
export async function vincularClienteConversa(conversaId, cliente_id) {
  const id = conversaId != null ? String(conversaId) : "";
  if (!id) throw new Error("conversaId inválido");
  if (cliente_id == null || cliente_id === "") throw new Error("cliente_id inválido");

  // Proteção contra falsy (evita que ID 0 ou "0" vire string por acidente ou cause falhas)
  const parsedId = Number(cliente_id);
  const body = { cliente_id: Number.isNaN(parsedId) ? String(cliente_id) : parsedId };

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
      // Se for "rota não encontrada (404)" ou "método não permitido (405)", tenta o próximo fallback
      if (st === 404 || st === 405) continue;
      throw e;
    }
  }
  throw lastErr || new Error("Não foi possível vincular cliente à conversa.");
}

/**
 * Busca uma conversa/chat pelo ID. Suporta paginação via query params nativos do Axios.
 */
export async function getChatById(conversaId, opts = {}) {
  const params = {};
  if (opts?.cursor) params.cursor = String(opts.cursor);
  if (opts?.cursorId != null && opts?.cursorId !== "") params.cursor_id = String(opts.cursorId);
  
  const limit = Number(opts?.limit);
  if (Number.isFinite(limit) && limit > 0) params.limit = limit;

  const config = { params };
  if (opts?.signal) config.signal = opts.signal;

  const { data } = await api.get(`/chats/${conversaId}`, config);
  return data;
}

/** * Mantido para compatibilidade com o código legado do sistema.
 */
export async function fetchConversa(conversaId) {
  return getChatById(conversaId);
}

/**
 * Realiza buscas textuais de mensagens históricas dentro de um chat específico.
 */
export async function buscarMensagensNaConversa(conversaId, opts = {}) {
  const id = conversaId != null ? String(conversaId) : "";
  if (!id) throw new Error("conversaId inválido");

  const params = {};
  if (opts?.q) params.q = String(opts.q).trim();
  if (opts?.cursor) params.cursor = String(opts.cursor);
  if (opts?.cursorId != null && opts?.cursorId !== "") params.cursor_id = String(opts.cursorId);
  if (opts?.limit) params.limit = String(opts.limit);

  const config = { params };
  if (opts?.signal) config.signal = opts.signal;

  const { data } = await api.get(`/chats/${id}/messages/search`, config);
  return data;
}

/**
 * Envia uma mensagem de texto simples ou com metadados de resposta (Reply).
 */
export async function enviarMensagem(conversaId, texto, reply_meta, client_temp_id) {
  const body = { texto };
  if (reply_meta && typeof reply_meta === "object") body.reply_meta = reply_meta;
  if (client_temp_id != null && String(client_temp_id).trim() !== "") {
    body.client_temp_id = String(client_temp_id).trim();
  }
  const { data } = await api.post(`/chats/${conversaId}/mensagens`, body);
  return data;
}

/**
 * Cria uma nota interna ("mensagem invisível") na conversa.
 * Rota própria: nunca passa pelo caminho de envio ao WhatsApp.
 * Retorna a linha já persistida — o backend só emite o realtime depois de gravar.
 */
export async function criarNotaInterna(conversaId, texto) {
  const id = conversaId != null ? String(conversaId) : "";
  if (!id) throw new Error("conversaId inválido");
  const conteudo = String(texto ?? "").trim();
  if (!conteudo) throw new Error("Escreva o conteúdo da nota interna.");
  const { data } = await api.post(`/chats/${id}/notas-internas`, { texto: conteudo });
  return data;
}

/**
 * Envia um link estruturado com metadados de preview na conversa.
 */
export async function enviarLink(conversaId, { url, titulo, descricao, imagem, texto, reply_meta } = {}) {
  const linkUrl = String(url || "").trim();
  if (!linkUrl) throw new Error("URL obrigatória");
  
  const body = {
    texto: texto || linkUrl,
    link: {
      linkUrl,
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

/**
 * Exclui/deleta uma mensagem específica por ID.
 */
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
 * Encaminha uma ou mais mensagens nativamente por ID via API.
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
 * Encaminha um arquivo baixando seu binário local e re-enviando via upload (Fallback de segurança).
 */
export async function encaminharArquivo(conversaId, msg, getMediaUrl) {
  const resolve = (url, urlAbsoluta) => {
    if (getMediaUrl) return getMediaUrl(url, urlAbsoluta);
    return urlAbsoluta || url || "";
  };
  const mediaUrl =
    resolve(msg?.url, msg?.url_absoluta) ||
    resolve(msg?.media_url ?? msg?.mediaUrl, null) ||
    resolve(msg?.file_url ?? msg?.fileUrl, null) ||
    resolve(msg?.download_url ?? msg?.downloadUrl, null);
  if (!mediaUrl) throw new Error("URL do arquivo não disponível.");

  const urlToFetch = /^https?:\/\//i.test(mediaUrl)
    ? mediaUrl
    : (mediaUrl.startsWith("/") ? mediaUrl : `/${mediaUrl}`);

  const { data: blob } = await api.get(urlToFetch, { responseType: "blob" });
  const nomeArquivo = String(msg?.nome_arquivo || "arquivo").trim() || "arquivo";
  const file = new File([blob], nomeArquivo, { type: blob.type || "application/octet-stream" });

  const formData = new FormData();
  formData.append("file", file, nomeArquivo);
  formData.append("encaminhado", "true");

  // CORREÇÃO: Removida a propriedade de cabeçalho legada obsoleta do jQuery. 
  // O Axios configura e injeta nativamente o Content-Type multipart/form-data com boundary ao receber FormData.
  const { data } = await api.post(`/chats/${conversaId}/arquivo`, formData);
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

/**
 * Transfere o chat para outro atendente interno.
 */
export async function transferirChat(conversaId, novo_atendente_id, observacao) {
  if (novo_atendente_id == null || novo_atendente_id === "") {
    throw new Error("O ID do novo atendente é obrigatório para transferência.");
  }
  const paraId = Number(novo_atendente_id);
  if (!Number.isFinite(paraId) || paraId <= 0) {
    throw new Error("ID do novo atendente inválido.");
  }

  const body = {
    para_usuario_id: paraId,
    observacao: observacao || null,
  };

  const { data } = await api.post(`/chats/${conversaId}/transferir`, body);
  return data;
}

export async function listarAtendentesDisponiveisConversa(conversaId) {
  const { data } = await api.get(`/chats/${conversaId}/atendentes-disponiveis`);
  return Array.isArray(data) ? data : [];
}

export async function listarAtendentesConversa(conversaId) {
  const { data } = await api.get(`/chats/${conversaId}/atendentes`);
  return Array.isArray(data) ? data : [];
}

export async function adicionarAtendenteConversa(conversaId, usuarioId) {
  const paraId = Number(usuarioId);
  if (!Number.isFinite(paraId) || paraId <= 0) {
    throw new Error("Atendente invalido.");
  }
  const { data } = await api.post(`/chats/${conversaId}/atendentes`, { usuario_id: paraId });
  return data;
}

/** Remove um co-atendente. O responsável principal só muda por transferência (backend recusa). */
export async function removerAtendenteConversa(conversaId, usuarioId) {
  const uid = Number(usuarioId);
  if (!Number.isFinite(uid) || uid <= 0) {
    throw new Error("Atendente inválido.");
  }
  const { data } = await api.delete(`/chats/${conversaId}/atendentes/${uid}`);
  return data;
}

/** Modo simples: remove da fila Aguardando atendente sem enviar mensagem. */
export async function marcarLidaModoSimplesChat(conversaId) {
  const id = conversaId != null ? String(conversaId) : "";
  if (!id) throw new Error("conversaId inválido");
  const { data } = await api.post(`/chats/${id}/marcar-lida-modo-simples`);
  return data;
}

/** Marca o atendimento humano como aguardando resposta do cliente. */
export async function marcarAguardandoClienteChat(conversaId) {
  const { data } = await api.post(`/chats/${conversaId}/aguardando-cliente`);
  return data;
}

/** * Retoma o atendimento de aguardando_cliente de volta para em_atendimento.
 */
export async function retomarAtendimentoChat(conversaId) {
  const { data } = await api.post(`/chats/${conversaId}/retomar-atendimento`);
  return data;
}

/** * Financeiro: marca cobrança ativa/pendente com prazo determinado.
 */
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
  return data;
}

/**
 * Envia coordenadas de localização geográfica.
 */
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

/**
 * Compartilha/Envia um card de contato para a conversa.
 */
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

// TAGS INTERNAS DA CONVERSA
export async function adicionarTagConversa(conversaId, tagId) {
  const { data } = await api.post(`/chats/${conversaId}/tags`, { tag_id: tagId });
  return data;
}

export async function removerTagConversa(conversaId, tagId) {
  const { data } = await api.delete(`/chats/${conversaId}/tags/${tagId}`);
  return data;
}
