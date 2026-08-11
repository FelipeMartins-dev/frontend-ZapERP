/**
 * Regressao: midias outbound nao devem duplicar quando socket/API chegam sem client_temp_id.
 * Executar: node scripts/test-media-merge.mjs
 */
import { mergeMessageIntoListForTest } from "../src/conversa/conversaOutboundMediaMerge.js";

const CONV = 77;
const OTHER = 88;
const baseTs = Date.now();

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function mediaTemp(tempId, tipo = "imagem", off = 0, opts = {}) {
  const texto = tipo === "video" ? "(video)" : tipo === "arquivo" ? "arquivo.pdf" : "(imagem)";
  return {
    tempId,
    client_temp_id: tempId,
    conversa_id: opts.conversa_id ?? CONV,
    direcao: "out",
    tipo,
    texto,
    conteudo: texto,
    nome_arquivo: opts.nome_arquivo ?? (tipo === "arquivo" ? "arquivo.pdf" : "foto-original.jpg"),
    tamanho: opts.tamanho ?? 1234,
    file_last_modified: opts.file_last_modified ?? 4567,
    status: "pending",
    status_mensagem: "pending",
    criado_em: new Date(baseTs + off).toISOString(),
    url: `blob:${tempId}`,
    url_absoluta: `blob:${tempId}`,
    _optimisticBlobUrl: `blob:${tempId}`,
  };
}

function mediaConfirmed(id, tipo = "imagem", off = 0, opts = {}) {
  const texto = tipo === "video" ? "(video)" : tipo === "arquivo" ? "arquivo.pdf" : "(imagem)";
  const ext = tipo === "video" ? "mp4" : tipo === "arquivo" ? "pdf" : "jpg";
  return {
    id,
    ...(opts.client_temp_id ? { client_temp_id: opts.client_temp_id } : {}),
    conversa_id: opts.conversa_id ?? CONV,
    direcao: "out",
    tipo,
    texto,
    conteudo: texto,
    nome_arquivo: opts.nome_arquivo ?? `provider-${id}.${ext}`,
    tamanho: opts.tamanho,
    status: opts.status ?? "sent",
    status_mensagem: opts.status_mensagem ?? opts.status ?? "sent",
    criado_em: new Date(baseTs + off).toISOString(),
    url: opts.url ?? `/uploads/${id}.${ext}`,
    url_absoluta: opts.url_absoluta ?? opts.url ?? `/uploads/${id}.${ext}`,
    ...(opts.whatsapp_id ? { whatsapp_id: opts.whatsapp_id } : {}),
  };
}

function countFamily(list, tipo) {
  return list.filter((m) => String(m.tipo) === String(tipo)).length;
}

// 1) Uma unica foto pendente deve fundir com eco sem client_temp_id, mesmo se o nome vier diferente.
let list = [];
list = mergeMessageIntoListForTest(list, CONV, mediaTemp("tmp-img-1", "imagem", 0));
list = mergeMessageIntoListForTest(
  list,
  CONV,
  mediaConfirmed(501, "imagem", 1000, { nome_arquivo: "ultramsg-501.jpg" })
);
assert(list.length === 1, `foto unica sem client_temp_id deve reconciliar, obteve ${list.length}`);
assert(String(list[0].id) === "501", "foto reconciliada deve receber id real");
assert(list[0].tempId === "tmp-img-1", "foto reconciliada deve preservar tempId da UI");
assert(String(list[0].url).includes("/uploads/501.jpg"), "foto reconciliada deve usar URL persistida");

// 2) Socket duplicado do mesmo evento continua sendo uma unica linha.
list = mergeMessageIntoListForTest(
  list,
  CONV,
  mediaConfirmed(501, "imagem", 1200, { nome_arquivo: "ultramsg-501.jpg" })
);
assert(list.length === 1, `socket duplicado da foto deve ser ignorado/mesclado, obteve ${list.length}`);

// 3) Duas fotos pendentes sem client_temp_id no eco nao devem ser adivinhadas como uma so.
list = [];
list = mergeMessageIntoListForTest(list, CONV, mediaTemp("tmp-img-a", "imagem", 0, { nome_arquivo: "igual.jpg", tamanho: 111 }));
list = mergeMessageIntoListForTest(list, CONV, mediaTemp("tmp-img-b", "imagem", 1, { nome_arquivo: "igual.jpg", tamanho: 111 }));
list = mergeMessageIntoListForTest(
  list,
  CONV,
  mediaConfirmed(601, "imagem", 1000, { nome_arquivo: "provider.jpg" })
);
assert(list.length === 3, `duas fotos pendentes sem temp explicito nao devem colapsar, obteve ${list.length}`);
assert(countFamily(list, "imagem") === 3, "eco sem identidade nao deve remover foto pendente errada");

// 4) Duas fotos iguais com client_temp_id explicito viram duas mensagens reais distintas.
list = [];
list = mergeMessageIntoListForTest(list, CONV, mediaTemp("tmp-same-a", "imagem", 0, { nome_arquivo: "same.jpg", tamanho: 999 }));
list = mergeMessageIntoListForTest(list, CONV, mediaTemp("tmp-same-b", "imagem", 1, { nome_arquivo: "same.jpg", tamanho: 999 }));
list = mergeMessageIntoListForTest(
  list,
  CONV,
  mediaConfirmed(701, "imagem", 1000, { client_temp_id: "tmp-same-a", nome_arquivo: "same.jpg", tamanho: 999 })
);
list = mergeMessageIntoListForTest(
  list,
  CONV,
  mediaConfirmed(702, "imagem", 1100, { client_temp_id: "tmp-same-b", nome_arquivo: "same.jpg", tamanho: 999 })
);
assert(list.length === 2, `duas fotos iguais com temp explicito devem ficar em 2 linhas, obteve ${list.length}`);
assert(list.some((m) => String(m.id) === "701" && m.tempId === "tmp-same-a"), "primeira foto igual reconciliada");
assert(list.some((m) => String(m.id) === "702" && m.tempId === "tmp-same-b"), "segunda foto igual reconciliada");

// 5) O mesmo fallback vale para video e documento quando ha uma unica midia pendente.
for (const tipo of ["video", "arquivo"]) {
  list = [];
  list = mergeMessageIntoListForTest(list, CONV, mediaTemp(`tmp-${tipo}`, tipo, 0));
  list = mergeMessageIntoListForTest(
    list,
    CONV,
    mediaConfirmed(tipo === "video" ? 801 : 802, tipo, 1000, { nome_arquivo: `provider-${tipo}` })
  );
  assert(list.length === 1, `${tipo} unico sem client_temp_id deve reconciliar, obteve ${list.length}`);
  assert(list[0].tempId === `tmp-${tipo}`, `${tipo} reconciliado deve preservar tempId`);
  if (tipo === "video") {
    assert(!list[0]._optimisticBlobUrl, "video confirmado deve encerrar o preview otimista");
    assert(String(list[0].url).includes("/uploads/801.mp4"), "video confirmado deve usar a URL persistida");
  }
}

// 6) Nunca reconciliar midia entre conversas diferentes.
list = [];
list = mergeMessageIntoListForTest(list, CONV, mediaTemp("tmp-other", "imagem", 0));
list = mergeMessageIntoListForTest(
  list,
  CONV,
  mediaConfirmed(901, "imagem", 1000, { conversa_id: OTHER, nome_arquivo: "other.jpg" })
);
assert(list.length === 1, "confirmacao de outra conversa nao deve entrar nem reconciliar");
assert(!list[0].id, "temp da conversa atual deve permanecer pendente");

console.log("OK - regressao de merge de midias passou (6 cenarios).");
