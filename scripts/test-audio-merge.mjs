/**
 * Regressão: vários áudios outbound não devem sumir nem duplicar após merge.
 * Executar: node scripts/test-audio-merge.mjs
 */
import { mergeMessageIntoListForTest } from "../src/conversa/conversaOutboundMediaMerge.js";

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
  return list.filter((m) => String(m?.tipo || "").toLowerCase() === "audio").length;
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

console.log("OK — regressão de merge de áudios passou (7 cenários).");
