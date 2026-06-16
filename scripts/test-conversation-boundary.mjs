/**
 * Regressao: mensagens/midias nunca podem atravessar a fronteira de conversa.
 * Executar: node scripts/test-conversation-boundary.mjs
 */
import { mergeMessageIntoListForTest } from "../src/conversa/conversaOutboundMediaMerge.js";
import {
  enqueueStatusMensagemEvent,
  flushStatusMensagemBatch,
  resetStatusMensagemBatch,
} from "../src/socket/statusMensagemBatch.js";

const CONV_A = 101;
const CONV_B = 202;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function imgTemp(tempId, conversaId, off = 0) {
  return {
    tempId,
    client_temp_id: tempId,
    conversa_id: conversaId,
    direcao: "out",
    tipo: "imagem",
    texto: "(imagem)",
    conteudo: "(imagem)",
    nome_arquivo: "photo.jpg",
    tamanho: 1000,
    file_last_modified: 1000,
    status: "pending",
    status_mensagem: "pending",
    criado_em: new Date(Date.now() + off).toISOString(),
    url: `blob:${tempId}`,
    _optimisticBlobUrl: `blob:${tempId}`,
  };
}

function imgConfirmed(id, tempId, conversaId, off = 0) {
  return {
    id,
    client_temp_id: tempId,
    conversa_id: conversaId,
    direcao: "out",
    tipo: "imagem",
    texto: "(imagem)",
    conteudo: "(imagem)",
    nome_arquivo: "photo.jpg",
    tamanho: 1000,
    status: "sent",
    status_mensagem: "sent",
    criado_em: new Date(Date.now() + off).toISOString(),
    url: `/uploads/${id}.jpg`,
  };
}

function txt(id, conversaId, text = "ok", off = 0) {
  return {
    id,
    conversa_id: conversaId,
    direcao: "in",
    tipo: "texto",
    texto: text,
    conteudo: text,
    criado_em: new Date(Date.now() + off).toISOString(),
  };
}

// 1) Mensagem sem conversa_id e mensagem de outra conversa devem ser ignoradas.
let list = [];
list = mergeMessageIntoListForTest(list, CONV_A, { id: 1, tipo: "texto", texto: "sem conversa" });
assert(list.length === 0, "mensagem sem conversa_id nao deve entrar na lista");

list = mergeMessageIntoListForTest(list, CONV_A, txt(2, CONV_B, "conversa errada"));
assert(list.length === 0, "mensagem de conversa B nao deve entrar na lista A");

// 2) Cache/lista mista nao pode reconciliar tempId de A usando confirmacao de B.
list = [imgTemp("tmp-a", CONV_A, 0), imgTemp("tmp-b", CONV_B, 1)];
list = mergeMessageIntoListForTest(list, CONV_A, imgConfirmed(301, "tmp-b", CONV_A, 2));
assert(
  list.find((m) => m.tempId === "tmp-b" && String(m.conversa_id) === String(CONV_B) && !m.id),
  "temp de B deve permanecer intacto ao reconciliar A"
);
assert(
  list.some((m) => String(m.id) === "301" && String(m.conversa_id) === String(CONV_A)),
  "confirmacao de A deve criar/atualizar somente mensagem de A"
);

// 3) Confirmacao atrasada de A nao pode afetar lista/renderizacao da conversa B.
let listB = [imgTemp("tmp-b-2", CONV_B, 0)];
listB = mergeMessageIntoListForTest(listB, CONV_B, imgConfirmed(401, "tmp-a-2", CONV_A, 1));
assert(listB.length === 1, "confirmacao de A nao deve ser inserida na conversa B");
assert(listB[0].tempId === "tmp-b-2" && !listB[0].id, "temp de B deve continuar pendente");

// 4) Socket/status sem conversa_id deve ser ignorado antes de aplicar patch.
resetStatusMensagemBatch();
let applied = 0;
enqueueStatusMensagemEvent(
  { mensagem_id: 999, status: "delivered", whatsapp_id: "wa-sem-conversa" },
  () => {
    applied += 1;
  },
  () => false
);
flushStatusMensagemBatch(() => {
  applied += 1;
});
assert(applied === 0, "status socket sem conversa_id nao deve ser aplicado");

enqueueStatusMensagemEvent(
  { chat_id: CONV_A, mensagem_id: 1000, status: "delivered", whatsapp_id: "wa-chat-id-ambiguo" },
  () => {
    applied += 1;
  },
  () => false
);
flushStatusMensagemBatch(() => {
  applied += 1;
});
assert(applied === 0, "status socket apenas com chat_id ambiguo nao deve ser aplicado");

// 5) Socket/status com conversa_id real continua funcionando.
resetStatusMensagemBatch();
enqueueStatusMensagemEvent(
  { conversa_id: CONV_A, mensagem_id: 1001, status: "read", whatsapp_id: "wa-a" },
  (evt) => {
    assert(String(evt.conversa_id) === String(CONV_A), "status deve manter conversa_id real");
    applied += 1;
  },
  () => false
);
flushStatusMensagemBatch((evt) => {
  assert(String(evt.conversa_id) === String(CONV_A), "flush deve manter conversa_id real");
  applied += 1;
});
assert(applied === 1, `status com conversa_id deve aplicar uma vez, aplicou ${applied}`);

console.log("OK - regressao de fronteira de conversas passou (5 cenarios).");
