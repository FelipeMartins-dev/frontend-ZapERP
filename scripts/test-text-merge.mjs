/**
 * Regressão: várias mensagens de texto seguidas não devem sumir nem fundir incorretamente.
 * Executar: node scripts/test-text-merge.mjs
 */
import {
  mergeMessageIntoListForTest,
  finalizeMensagensList,
} from "../src/conversa/conversaOutboundMediaMerge.js";

const CONV = 99;

function textTemp(tempId, body, msOffset = 0) {
  return {
    tempId,
    client_temp_id: tempId,
    conversa_id: CONV,
    direcao: "out",
    tipo: "texto",
    texto: body,
    conteudo: body,
    status: "pending",
    status_mensagem: "pending",
    criado_em: new Date(Date.now() + msOffset).toISOString(),
  };
}

function textConfirmed(id, tempId, body, msOffset = 0) {
  return {
    id,
    client_temp_id: tempId,
    conversa_id: CONV,
    direcao: "out",
    tipo: "texto",
    texto: body,
    conteudo: body,
    status: "sent",
    status_mensagem: "sent",
    criado_em: new Date(Date.now() + msOffset).toISOString(),
  };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function countText(list) {
  return list.filter((m) => String(m?.tipo || "").toLowerCase() === "texto").length;
}

let list = [];

// 1) Três otimistas com textos diferentes permanecem
list = mergeMessageIntoListForTest(list, CONV, textTemp("temp-t1", "Olá", 0));
list = mergeMessageIntoListForTest(list, CONV, textTemp("temp-t2", "Tudo bem?", 1));
list = mergeMessageIntoListForTest(list, CONV, textTemp("temp-t3", "Preciso de ajuda", 2));
assert(countText(list) === 3, `esperado 3 textos otimistas, obteve ${countText(list)}`);

// 2) Duas mensagens com o MESMO texto ("oi") devem permanecer separadas
list = [];
list = mergeMessageIntoListForTest(list, CONV, textTemp("temp-o1", "oi", 0));
list = mergeMessageIntoListForTest(list, CONV, textTemp("temp-o2", "oi", 1));
assert(countText(list) === 2, `duas "oi" otimistas devem permanecer, obteve ${countText(list)}`);

// 3) Confirmar a 1ª "oi" não remove a 2ª pendente
list = mergeMessageIntoListForTest(list, CONV, textConfirmed(801, "temp-o1", "oi", 0));
assert(countText(list) === 2, `após confirmar 1ª oi, esperado 2 textos, obteve ${countText(list)}`);
assert(list.some((m) => m.tempId === "temp-o2" && !m.id), "2ª oi otimista ainda pendente");

// 4) Confirmar a 2ª "oi"
list = mergeMessageIntoListForTest(list, CONV, textConfirmed(802, "temp-o2", "oi", 1));
assert(countText(list) === 2, `após confirmar 2ª oi, esperado 2 textos, obteve ${countText(list)}`);
assert(list.filter((m) => String(m.id) === "801").length === 1, "id 801 único");
assert(list.filter((m) => String(m.id) === "802").length === 1, "id 802 único");

// 5) finalizeMensagensList não remove textos distintos confirmados
list = finalizeMensagensList(list);
assert(countText(list) === 2, `finalize deve manter 2 textos, obteve ${countText(list)}`);

// 6) Segunda confirmação com mesmo texto não funde na primeira (cross-merge)
list = [];
list = mergeMessageIntoListForTest(list, CONV, textConfirmed(811, null, "ok", 0));
list = mergeMessageIntoListForTest(list, CONV, textConfirmed(812, null, "ok", 1));
assert(countText(list) === 2, `duas "ok" confirmadas distintas, obteve ${countText(list)}`);
assert(list.filter((m) => String(m.id) === "811").length === 1, "811 único");
assert(list.filter((m) => String(m.id) === "812").length === 1, "812 único");

// 7) Ordem cronológica preservada
const ids = list.map((m) => m.id);
assert(ids[0] === 811 && ids[1] === 812, `ordem incorreta: ${ids.join(",")}`);

console.log("OK — regressão de merge de textos passou (7 cenários).");
