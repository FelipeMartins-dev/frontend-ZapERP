/**
 * Regressão: vários áudios outbound não devem sumir nem duplicar após merge.
 * Executar: node scripts/test-audio-merge.mjs
 */
import {
  mergeMessageIntoListForTest,
  putMensagemInDedupeMap,
  finalizeMensagensList,
} from "../src/conversa/conversaOutboundMediaMerge.js";

const CONV = 42;

function audioTemp(tempId, name, size, msOffset = 0) {
  return {
    tempId,
    conversa_id: CONV,
    direcao: "out",
    tipo: "audio",
    texto: "(áudio)",
    conteudo: "(áudio)",
    nome_arquivo: name,
    tamanho: size,
    file_last_modified: size,
    status: "pending",
    status_mensagem: "pending",
    criado_em: new Date(Date.now() + msOffset).toISOString(),
    url: `blob:local-${tempId}`,
    _optimisticBlobUrl: `blob:local-${tempId}`,
  };
}

function audioConfirmed(id, tempId, name, size, msOffset = 0) {
  return {
    id,
    client_temp_id: tempId,
    conversa_id: CONV,
    direcao: "out",
    tipo: "audio",
    texto: "(áudio)",
    nome_arquivo: name,
    tamanho: size,
    status: "pending",
    status_mensagem: "pending",
    criado_em: new Date(Date.now() + msOffset).toISOString(),
    url: `/uploads/audio-${id}.mp3`,
    url_absoluta: `/uploads/audio-${id}.mp3`,
  };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function countAudios(list) {
  return list.filter((m) => ["audio", "voice", "ptt"].includes(String(m?.tipo || "").toLowerCase())).length;
}

function ids(list) {
  return list.map((m) => m.tempId || m.id).join(",");
}

let list = [];

// 1) Dois otimistas seguidos permanecem
list = mergeMessageIntoListForTest(list, CONV, audioTemp("temp-a1", "audio-100.webm", 1000, 0));
list = mergeMessageIntoListForTest(list, CONV, audioTemp("temp-a2", "audio-200.webm", 2000, 1));
assert(countAudios(list) === 2, `esperado 2 áudios otimistas, obteve ${countAudios(list)}`);

// 2) Confirmação do 2º áudio não remove o 1º (client_temp_id explícito)
list = mergeMessageIntoListForTest(
  list,
  CONV,
  audioConfirmed(902, "temp-a2", "audio-200.mp3", 2000, 1)
);
assert(countAudios(list) === 2, `após confirmar a2, esperado 2 áudios, obteve ${countAudios(list)}`);
const a2 = list.find((m) => String(m.id) === "902");
assert(a2?.tempId === "temp-a2", "a2 deve manter tempId na bolha reconciliada");
assert(list.some((m) => m.tempId === "temp-a1" && !m.id), "a1 otimista ainda pendente");

// 3) Confirmação do 1º áudio
list = mergeMessageIntoListForTest(
  list,
  CONV,
  audioConfirmed(901, "temp-a1", "audio-100.mp3", 1000, 0)
);
assert(countAudios(list) === 2, `após confirmar a1, esperado 2 áudios, obteve ${countAudios(list)}`);
assert(list.filter((m) => String(m.id) === "901").length === 1, "exatamente uma linha id 901");
assert(list.filter((m) => String(m.id) === "902").length === 1, "exatamente uma linha id 902");

// 4) Terceiro áudio + confirmação rápida
list = mergeMessageIntoListForTest(list, CONV, audioTemp("temp-a3", "audio-300.webm", 3000, 2));
list = mergeMessageIntoListForTest(
  list,
  CONV,
  audioConfirmed(903, "temp-a3", "audio-300.mp3", 3000, 2)
);
assert(countAudios(list) === 3, `esperado 3 áudios finais, obteve ${countAudios(list)}: ${ids(list)}`);

// 5) client_temp_id errado não deve fundir no 1º pendente restante
list = [audioTemp("temp-x1", "audio-x.webm", 5000, 0), audioTemp("temp-x2", "audio-y.webm", 6000, 1)];
list = mergeMessageIntoListForTest(
  list,
  CONV,
  audioConfirmed(910, "temp-x2", "audio-y.mp3", 6000, 1)
);
const x1 = list.find((m) => m.tempId === "temp-x1");
const x2 = list.find((m) => m.tempId === "temp-x2" || String(m.id) === "910");
assert(x1 && !x1.id, "temp-x1 não deve receber id do áudio 2");
assert(x2 && String(x2.id) === "910", "temp-x2 deve ser reconciliado");

// 6) Nomes genéricos não devem causar merge incorreto
list = [
  audioTemp("temp-gen1", "audio-1733773200000.webm", 3000, 0),
  audioTemp("temp-gen2", "audio-1733773200000.webm", 4000, 100) // Mesmo nome, tamanho diferente
];
assert(countAudios(list) === 2, "áudios com mesmo nome genérico devem permanecer separados");

// 7) Confirmação sem client_temp_id para áudios com nomes iguais
list = mergeMessageIntoListForTest(
  list,
  CONV,
  { ...audioConfirmed(920, null, "audio-1733773200000.mp3", 3000, 0), client_temp_id: undefined }
);
assert(countAudios(list) === 2, "confirmação sem client_temp_id não deve fundir no áudio errado");

// 8) Segundo otimista após reconciliar o 1º não pode apagar id nem duplicar
list = [];
list = mergeMessageIntoListForTest(list, CONV, audioTemp("temp-b1", "audio-b1.webm", 7000, 0));
list = mergeMessageIntoListForTest(
  list,
  CONV,
  audioConfirmed(931, "temp-b1", "audio-b1.mp3", 7000, 0)
);
list = mergeMessageIntoListForTest(list, CONV, audioTemp("temp-b2", "audio-b2.webm", 8000, 50));
assert(countAudios(list) === 2, "2º otimista após reconciliar o 1º deve manter 2 áudios");
assert(list.some((m) => String(m.id) === "931"), "1º áudio confirmado deve manter id");

// 9) Eco id-only + refresh não duplica áudios já reconciliados
function mergeFromApi(existing, fromApi) {
  const map = new Map();
  let ord = 0;
  const put = (raw) => {
    if (!raw) return;
    putMensagemInDedupeMap(map, raw, CONV, ++ord);
  };
  existing.forEach(put);
  fromApi.forEach(put);
  return finalizeMensagensList(Array.from(map.values()));
}
list = [
  { ...audioConfirmed(941, "temp-c1", "audio-c1.mp3", 9000, 0), tempId: "temp-c1" },
  { id: 941, conversa_id: CONV, direcao: "out", tipo: "audio", texto: "(áudio)", url: "/uploads/941.mp3", criado_em: new Date().toISOString() },
  { ...audioConfirmed(942, "temp-c2", "audio-c2.mp3", 9500, 50), tempId: "temp-c2" },
];
list = mergeFromApi(list, [
  { id: 941, conversa_id: CONV, direcao: "out", tipo: "audio", texto: "(áudio)", url: "/uploads/941.mp3", criado_em: list[0].criado_em },
  { id: 942, conversa_id: CONV, direcao: "out", tipo: "audio", texto: "(áudio)", url: "/uploads/942.mp3", criado_em: list[2].criado_em },
]);
assert(countAudios(list) === 2, `refresh não deve duplicar áudios, obteve ${countAudios(list)}`);
assert(list.filter((m) => String(m.id) === "941").length === 1, "id 941 único após refresh");
assert(list.filter((m) => String(m.id) === "942").length === 1, "id 942 único após refresh");

// 10) Socket sem client_temp_id (nome/tipo divergentes) não duplica o otimista
list = [audioTemp("temp-s1", "audio-100.webm", 1000, 0)];
list = mergeMessageIntoListForTest(list, CONV, {
  id: 951,
  conversa_id: CONV,
  direcao: "out",
  tipo: "voice",
  texto: "(áudio)",
  nome_arquivo: "951.ogg",
  tamanho: 1000,
  status: "delivered",
  status_mensagem: "delivered",
  criado_em: list[0].criado_em,
  url: "/uploads/951.ogg",
});
assert(countAudios(list) === 1, `socket sem client_temp_id deve fundir, obteve ${countAudios(list)}`);
assert(String(list[0].id) === "951", "bolha reconciliada deve ter id do servidor");
assert(list[0].tempId === "temp-s1", "bolha reconciliada deve manter tempId da UI");

// 11) Com um único otimista pendente, socket sem client_temp_id ainda funde no bolha certa
list = [audioTemp("temp-r1", "audio-r1.webm", 1000, 0)];
list = mergeMessageIntoListForTest(
  list,
  CONV,
  audioConfirmed(961, "temp-r1", "audio-r1.mp3", 1000, 0)
);
list = mergeMessageIntoListForTest(list, CONV, audioTemp("temp-r2", "audio-r2.webm", 2000, 100));
list = mergeMessageIntoListForTest(list, CONV, {
  id: 962,
  conversa_id: CONV,
  direcao: "out",
  tipo: "voice",
  nome_arquivo: "962.ogg",
  tamanho: 2000,
  criado_em: list.find((m) => m.tempId === "temp-r2").criado_em,
  url: "/uploads/962.ogg",
});
assert(countAudios(list) === 2, `dois áudios após confirmar o 2º, obteve ${countAudios(list)}`);
assert(String(list.find((m) => m.tempId === "temp-r1")?.id) === "961", "1º áudio confirmado intacto");
const r2 = list.find((m) => String(m.id) === "962");
assert(r2?.tempId === "temp-r2", "2º áudio deve reconciliar no temp-r2");

// 12) Dois pendentes: confirmação do 1º sem client_temp_id NÃO pode fundir no 2º pendente
list = [
  audioTemp("temp-w1", "audio-w1.webm", 1000, 0),
  audioTemp("temp-w2", "audio-w2.webm", 2000, 100),
];
list = mergeMessageIntoListForTest(list, CONV, {
  id: 971,
  conversa_id: CONV,
  direcao: "out",
  tipo: "voice",
  nome_arquivo: "971.ogg",
  tamanho: 1000,
  criado_em: list[0].criado_em,
  url: "/uploads/971.ogg",
});
const w1 = list.find((m) => m.tempId === "temp-w1");
const w2 = list.find((m) => m.tempId === "temp-w2");
assert(w1 && !w1.id, "1º otimista não deve receber id via merge errado no 2º");
assert(w2 && !w2.id, "2º otimista deve permanecer intacto");
assert(countAudios(list) >= 2, "nenhum áudio deve sumir da lista");

// 13) finalizeMensagensList não remove áudios distintos (eco id-only + 2º otimista)
list = [];
list = mergeMessageIntoListForTest(list, CONV, audioTemp("temp-f1", "audio-f1.webm", 5000, 0));
list = mergeMessageIntoListForTest(
  list,
  CONV,
  audioConfirmed(981, "temp-f1", "audio-f1.mp3", 5000, 0)
);
list = mergeMessageIntoListForTest(list, CONV, audioTemp("temp-f2", "audio-f2.webm", 6000, 50));
list = mergeMessageIntoListForTest(list, CONV, {
  id: 981,
  conversa_id: CONV,
  direcao: "out",
  tipo: "voice",
  url: "/uploads/981.ogg",
  criado_em: list[0].criado_em,
});
list = finalizeMensagensList(list);
assert(countAudios(list) === 2, `finalize não deve remover áudios distintos, obteve ${countAudios(list)}`);
assert(list.some((m) => String(m.id) === "981" && m.tempId === "temp-f1"), "1º áudio intacto");
assert(list.some((m) => m.tempId === "temp-f2" && !m.id), "2º otimista intacto");

console.log("OK — regressão de merge de áudios passou (13 cenários).");
