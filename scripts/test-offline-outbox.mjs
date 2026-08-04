/**
 * Fila offline de texto: persistencia, ordem, deduplicacao e reenvio seguro.
 * Executar: node scripts/test-offline-outbox.mjs
 */

// localStorage nao existe no Node: stub minimo antes de importar o modulo.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
  clear: () => void store.clear(),
};

const {
  OUTBOX_STORAGE_KEY,
  OUTBOX_MAX_ATTEMPTS,
  OUTBOX_STATUS,
  readOutbox,
  enqueueOutboxText,
  removeFromOutbox,
  markOutboxAttempt,
  listOutboxForConversa,
  outboxHasItems,
  outboxPendingMessageFields,
  buildOutboxBubble,
  hydrateOutboxBubblesForConversa,
  flushOutbox,
  _resetOutboxForTests,
} = await import("../src/conversa/offlineOutbox.js");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function erroDeRede() {
  const err = new Error("Network Error");
  err.code = "ERR_NETWORK";
  return err;
}

function erroDeValidacao() {
  const err = new Error("Request failed");
  err.response = { status: 400, data: { error: "Texto obrigatorio" } };
  return err;
}

function erroDeServidor() {
  const err = new Error("Request failed");
  err.response = { status: 500, data: {} };
  return err;
}

// 1) Enfileira e persiste
_resetOutboxForTests();
const item = enqueueOutboxText({ conversaId: 10, texto: "Oi", tempId: "tmp-1" });
assert(item?.tempId === "tmp-1", "deveria enfileirar item");
assert(readOutbox().length === 1, "fila deveria ter 1 item");
assert(store.has(OUTBOX_STORAGE_KEY), "deveria gravar no localStorage");

// 2) Sobrevive a "recarga": ler de novo do storage devolve o item
const serializado = store.get(OUTBOX_STORAGE_KEY);
assert(JSON.parse(serializado)[0].texto === "Oi", "texto deveria persistir cru no storage");
assert(readOutbox()[0].tempId === "tmp-1", "item deveria sobreviver a releitura");

// 3) Idempotencia por tempId: reenfileirar nao duplica nem muda a posicao
enqueueOutboxText({ conversaId: 10, texto: "Oi", tempId: "tmp-2" });
enqueueOutboxText({ conversaId: 10, texto: "Oi editado", tempId: "tmp-1" });
const aposDedupe = readOutbox();
assert(aposDedupe.length === 2, "nao deveria duplicar item com mesmo tempId");
assert(aposDedupe[0].tempId === "tmp-1", "posicao original deveria ser preservada");
assert(aposDedupe[0].texto === "Oi editado", "texto deveria ser atualizado");

// 4) Filtro por conversa e contagem
enqueueOutboxText({ conversaId: 99, texto: "Outra conversa", tempId: "tmp-3" });
assert(listOutboxForConversa(10).length === 2, "deveria filtrar por conversa");
assert(listOutboxForConversa(99).length === 1, "deveria filtrar a outra conversa");
assert(outboxHasItems() === true, "deveria indicar fila nao vazia");

// 5) Campos de exibicao: relogio, nunca erro
const campos = outboxPendingMessageFields({ tempId: "tmp-1" });
assert(campos.status === OUTBOX_STATUS, "status deveria ser aguardando_conexao");
assert(campos.aguardando_conexao === true, "flag de espera deveria estar ligada");
assert(campos.envio_erro === false, "nao deveria marcar erro");
assert(campos.client_temp_id === "tmp-1", "deveria preservar client_temp_id");

// 6) Remocao explicita
assert(removeFromOutbox("tmp-3") === true, "deveria remover item existente");
assert(removeFromOutbox("inexistente") === false, "remover inexistente deveria ser no-op");

// 7) Flush em ordem, removendo somente apos confirmacao
_resetOutboxForTests();
enqueueOutboxText({ conversaId: 10, texto: "Primeira", tempId: "a" });
enqueueOutboxText({ conversaId: 10, texto: "Segunda", tempId: "b" });
enqueueOutboxText({ conversaId: 10, texto: "Terceira", tempId: "c" });
const ordemEnviada = [];
const confirmados = [];
let r = await flushOutbox({
  sendText: async (it) => {
    ordemEnviada.push(it.tempId);
    return { id: `srv-${it.tempId}` };
  },
  onConfirmado: (it, res) => confirmados.push([it.tempId, res.id]),
});
assert(ordemEnviada.join(",") === "a,b,c", `ordem deveria ser a,b,c (foi ${ordemEnviada.join(",")})`);
assert(r.enviadas === 3, "deveria enviar 3");
assert(readOutbox().length === 0, "fila deveria esvaziar apos confirmacao");
assert(confirmados.length === 3 && confirmados[0][1] === "srv-a", "deveria confirmar com resposta do backend");

// 8) Falha de rede no meio: para e preserva ordem e itens restantes
_resetOutboxForTests();
enqueueOutboxText({ conversaId: 10, texto: "Primeira", tempId: "a" });
enqueueOutboxText({ conversaId: 10, texto: "Segunda", tempId: "b" });
enqueueOutboxText({ conversaId: 10, texto: "Terceira", tempId: "c" });
const tentadas = [];
r = await flushOutbox({
  sendText: async (it) => {
    tentadas.push(it.tempId);
    if (it.tempId === "b") throw erroDeRede();
    return { id: `srv-${it.tempId}` };
  },
});
assert(tentadas.join(",") === "a,b", `deveria parar em b (tentou ${tentadas.join(",")})`);
assert(r.enviadas === 1, "apenas a primeira deveria ter sido enviada");
assert(r.parou === "rede", "deveria reportar parada por rede");
const restantes = readOutbox();
assert(restantes.length === 2, "b e c deveriam permanecer na fila");
assert(restantes[0].tempId === "b" && restantes[1].tempId === "c", "ordem restante deveria ser b,c");
assert(restantes[0].tentativas === 1, "tentativa deveria ser contabilizada");

// 9) Offline: nao tenta nada e mantem a fila intacta
r = await flushOutbox({ sendText: async () => ({ id: 1 }), estaOffline: () => true });
assert(r.enviadas === 0 && r.parou === "offline", "deveria abortar quando offline");
assert(readOutbox().length === 2, "fila deveria permanecer intacta offline");

// 10) Erro definitivo do item (validacao): sai da fila, avisa e segue os demais
_resetOutboxForTests();
enqueueOutboxText({ conversaId: 10, texto: "Invalida", tempId: "ruim" });
enqueueOutboxText({ conversaId: 10, texto: "Boa", tempId: "boa" });
const definitivas = [];
r = await flushOutbox({
  sendText: async (it) => {
    if (it.tempId === "ruim") throw erroDeValidacao();
    return { id: "srv-boa" };
  },
  onFalhaDefinitiva: (it, cls) => definitivas.push([it.tempId, cls.kind]),
});
assert(definitivas.length === 1 && definitivas[0][0] === "ruim", "deveria reportar falha definitiva do item ruim");
assert(r.enviadas === 1, "a mensagem boa deveria seguir");
assert(readOutbox().length === 0, "fila deveria esvaziar");

// 11) Teto de tentativas: erro de rede repetido acaba virando falha visivel
_resetOutboxForTests();
enqueueOutboxText({ conversaId: 10, texto: "Insistente", tempId: "x" });
for (let i = 0; i < OUTBOX_MAX_ATTEMPTS - 1; i++) markOutboxAttempt("x", { erro: "rede" });
assert(readOutbox()[0].tentativas === OUTBOX_MAX_ATTEMPTS - 1, "deveria acumular tentativas");
const desistiu = [];
r = await flushOutbox({
  sendText: async () => {
    throw erroDeRede();
  },
  onFalhaDefinitiva: (it) => desistiu.push(it.tempId),
});
assert(desistiu.join(",") === "x", "deveria desistir apos o teto de tentativas");
assert(readOutbox().length === 0, "item deveria sair da fila ao desistir");

// 12) HTTP 500 conta como rede (incerto): mantem na fila para nova tentativa
_resetOutboxForTests();
enqueueOutboxText({ conversaId: 10, texto: "Servidor caiu", tempId: "s5" });
r = await flushOutbox({
  sendText: async () => {
    throw erroDeServidor();
  },
});
assert(r.parou === "rede", "500 deveria ser tratado como incerto/rede");
assert(readOutbox().length === 1, "item deveria permanecer na fila apos 500");

// 13) Flush concorrente nao duplica envio
_resetOutboxForTests();
enqueueOutboxText({ conversaId: 10, texto: "Unica", tempId: "u1" });
let chamadas = 0;
const sendLento = async () => {
  chamadas += 1;
  await new Promise((res) => setTimeout(res, 20));
  return { id: "srv-u1" };
};
const [r1, r2] = await Promise.all([flushOutbox({ sendText: sendLento }), flushOutbox({ sendText: sendLento })]);
assert(chamadas === 1, `envio deveria ocorrer uma unica vez (ocorreu ${chamadas})`);
assert(
  (r1.parou === "em_andamento") !== (r2.parou === "em_andamento"),
  "exatamente um flush deveria ser bloqueado por concorrencia"
);
assert(readOutbox().length === 0, "fila deveria esvaziar");

// 14) Itens corrompidos no storage nao derrubam a leitura
store.set(OUTBOX_STORAGE_KEY, JSON.stringify([{ lixo: true }, null, { tempId: "ok", conversaId: "1", texto: "vale" }]));
const saneados = readOutbox();
assert(saneados.length === 1 && saneados[0].tempId === "ok", "deveria descartar registros invalidos");
store.set(OUTBOX_STORAGE_KEY, "{isso nao e json");
assert(readOutbox().length === 0, "JSON invalido deveria virar fila vazia");

// 15) Hidratacao: reconstrói bolha a partir do storage (cenario F5)
_resetOutboxForTests();
enqueueOutboxText({
  conversaId: 10,
  texto: "Sobrevive F5",
  tempId: "tmp-f5",
  criadoEm: "2026-08-04T18:00:00.000Z",
});
const bubble = buildOutboxBubble(readOutbox()[0]);
assert(bubble?.tempId === "tmp-f5", "bolha deveria preservar tempId");
assert(bubble?.client_temp_id === "tmp-f5", "bolha deveria preservar client_temp_id");
assert(bubble?.status === OUTBOX_STATUS, "bolha hidratada deveria aguardar conexao");
assert(bubble?.texto === "Sobrevive F5", "texto deveria ser restaurado");
const hidratada = hydrateOutboxBubblesForConversa(10, [{ id: 1, conversa_id: 10, texto: "ja no banco", direcao: "out" }]);
assert(hidratada.length === 2, "deveria acrescentar bolha offline a lista da API");
assert(hidratada.some((m) => m.tempId === "tmp-f5"), "tempId offline deveria aparecer apos hidratar");
// Idempotente: hidratar de novo nao duplica
const hidratada2 = hydrateOutboxBubblesForConversa(10, hidratada);
assert(hidratada2.filter((m) => m.tempId === "tmp-f5").length === 1, "nao deveria duplicar bolha offline");
// Conversa errada nao recebe o item
assert(hydrateOutboxBubblesForConversa(99, []).length === 0, "nao deveria hidratar em outra conversa");

// 16) Apos confirmacao do backend, flag aguardando_conexao nao pode segurar o relogio
const { clearStaleOutboundWaitFlags } = await import("../src/conversa/conversaOutboundMediaMerge.js");
const stale = clearStaleOutboundWaitFlags({
  id: 99,
  tempId: "tmp-f5",
  status: "sent",
  status_mensagem: "sent",
  aguardando_conexao: true,
  envio_incerto: true,
  erro_mensagem: "Aguardando conexão. Será enviada automaticamente quando a internet voltar.",
});
assert(stale.aguardando_conexao === false, "flag offline deveria cair apos sent");
assert(stale.envio_incerto === false, "envio_incerto deveria cair apos sent");
assert(!stale.erro_mensagem, "mensagem de espera offline deveria ser removida");
assert(stale.status === "sent", "status sent deveria permanecer");

console.log("OK: fila offline persistente (16 cenarios)");
