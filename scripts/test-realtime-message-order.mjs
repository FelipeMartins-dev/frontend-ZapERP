/**
 * Regressao: a ordem ao vivo deve ser identica ao GET apos F5, mesmo com socket fora
 * de sequencia, reconciliacao otimista e atualizacao tardia de midia.
 */
import {
  mergeMessageIntoListForTest,
  sortMensagensChronological,
} from "../src/conversa/conversaOutboundMediaMerge.js";

const CONV = 991;
const TS = "2026-08-18T14:30:00.000Z";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function ids(list) {
  return list.map((m) => String(m.id ?? m.tempId)).join("|");
}

// 1) O socket entrega 103, depois a midia atrasada 101, depois 102; F5 devolve id ASC.
let live = [];
for (const id of [103, 101, 102]) {
  live = mergeMessageIntoListForTest(live, CONV, {
    id,
    whatsapp_id: `wa-${id}`,
    conversa_id: CONV,
    direcao: "in",
    tipo: id === 101 ? "imagem" : "texto",
    texto: id === 101 ? "(imagem)" : `mensagem ${id}`,
    criado_em: TS,
    ...(id === 101 ? { url: "/uploads/101.jpg" } : {}),
  });
}
assert(ids(live) === "101|102|103", `socket fora de sequencia: ${ids(live)}`);

// 2) Atualizacao tardia da URL da mesma midia nao cria bolha nem muda a posicao.
live = mergeMessageIntoListForTest(live, CONV, {
  id: 101,
  whatsapp_id: "wa-101",
  conversa_id: CONV,
  direcao: "in",
  tipo: "imagem",
  texto: "(imagem)",
  criado_em: TS,
  url: "/media/r2/101.jpg",
});
assert(ids(live) === "101|102|103", `update de midia reposicionou/duplicou: ${ids(live)}`);
assert(live.filter((m) => String(m.id) === "101").length === 1, "update de midia duplicou a mensagem");
live = mergeMessageIntoListForTest(live, CONV, {
  id: 101,
  whatsapp_id: "wa-101",
  conversa_id: CONV,
  direcao: "in",
  tipo: "imagem",
  url: "/media/r2/101-final.jpg",
});
assert(ids(live) === "101|102|103", `update parcial de midia reposicionou: ${ids(live)}`);
assert(live[0].criado_em === TS, `update parcial trocou criado_em por agora: ${live[0].criado_em}`);

// 3) Confirmacao otimista adota o horario canonico do servidor e encontra sua posicao real.
live = mergeMessageIntoListForTest(live, CONV, {
  tempId: "temp-104",
  client_temp_id: "temp-104",
  conversa_id: CONV,
  direcao: "out",
  tipo: "texto",
  texto: "resposta",
  status: "pending",
  criado_em: "2026-08-18T14:31:20.000Z",
  _stableInsertSeq: 10000050,
});
live = mergeMessageIntoListForTest(live, CONV, {
  id: 104,
  client_temp_id: "temp-104",
  conversa_id: CONV,
  direcao: "out",
  tipo: "texto",
  texto: "resposta",
  status: "sent",
  criado_em: "2026-08-18T14:29:59.900Z",
});
assert(live.length === 4, `reconciliacao otimista duplicou: ${live.length}`);
assert(String(live[0].id) === "104", `timestamp local venceu o servidor: ${ids(live)}`);
assert(live[0].tempId === "temp-104", "reconciliacao deve preservar a chave React otimista");

// 4) Unix em segundos e ISO representam o mesmo instante e usam id como desempate.
const unixSeconds = Date.parse(TS) / 1000;
let normalized = [];
normalized = mergeMessageIntoListForTest(normalized, CONV, {
  id: 202,
  conversa_id: CONV,
  criado_em: TS,
});
normalized = mergeMessageIntoListForTest(normalized, CONV, {
  id: 201,
  conversa_id: CONV,
  criado_em: unixSeconds,
});
normalized = sortMensagensChronological(normalized);
assert(ids(normalized) === "201|202", `timestamp Unix em segundos foi interpretado incorretamente: ${ids(normalized)}`);

console.log("OK - ordem realtime canonica passou (4 cenarios).");
