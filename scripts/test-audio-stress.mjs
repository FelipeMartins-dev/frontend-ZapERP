/**
 * Teste de estresse: simula envio rápido de múltiplos áudios como no uso real
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
    file_last_modified: Date.now() + msOffset,
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
    status: "sent",
    status_mensagem: "sent",
    criado_em: new Date(Date.now() + msOffset).toISOString(),
    url: `/uploads/audio-${id}.mp3`,
    url_absoluta: `/uploads/audio-${id}.mp3`,
  };
}

function audioSocket(id, tempId, name, size, msOffset = 0) {
  return {
    id,
    client_temp_id: tempId,
    conversa_id: CONV,
    direcao: "out",
    tipo: "audio",
    texto: "(áudio)",
    nome_arquivo: name,
    tamanho: size,
    status: "delivered",
    status_mensagem: "delivered",
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

console.log("🎤 Teste de estresse - múltiplos áudios");

let list = [];

// Cenário 1: 5 áudios otimistas seguidos (simula gravação rápida)
console.log("📝 Enviando 5 áudios otimistas...");
const tempIds = [];
for (let i = 0; i < 5; i++) {
  const tempId = `temp-audio-${i}`;
  const name = `audio-${Date.now() + i}.webm`;
  tempIds.push(tempId);
  list = mergeMessageIntoListForTest(list, CONV, audioTemp(tempId, name, 1000 + i * 100, i));
}
assert(countAudios(list) === 5, `Esperado 5 áudios otimistas, obteve ${countAudios(list)}`);

// Cenário 2: Confirmações HTTP chegam fora de ordem
console.log("📡 Confirmações HTTP fora de ordem...");
list = mergeMessageIntoListForTest(list, CONV, audioConfirmed(903, tempIds[2], "audio-903.mp3", 1200, 2));
list = mergeMessageIntoListForTest(list, CONV, audioConfirmed(901, tempIds[0], "audio-901.mp3", 1000, 0));
list = mergeMessageIntoListForTest(list, CONV, audioConfirmed(905, tempIds[4], "audio-905.mp3", 1400, 4));
assert(countAudios(list) === 5, `Após 3 confirmações HTTP, esperado 5 áudios, obteve ${countAudios(list)}`);

// Cenário 3: Socket.io atualiza status em paralelo
console.log("🔌 Atualizações de status via socket...");
list = mergeMessageIntoListForTest(list, CONV, audioSocket(903, tempIds[2], "audio-903.mp3", 1200, 2));
list = mergeMessageIntoListForTest(list, CONV, audioSocket(901, tempIds[0], "audio-901.mp3", 1000, 0));
assert(countAudios(list) === 5, `Após socket updates, esperado 5 áudios, obteve ${countAudios(list)}`);

// Cenário 4: Confirmações restantes
console.log("✅ Confirmando áudios restantes...");
list = mergeMessageIntoListForTest(list, CONV, audioConfirmed(902, tempIds[1], "audio-902.mp3", 1100, 1));
list = mergeMessageIntoListForTest(list, CONV, audioConfirmed(904, tempIds[3], "audio-904.mp3", 1300, 3));
assert(countAudios(list) === 5, `Após todas confirmações, esperado 5 áudios, obteve ${countAudios(list)}`);

// Verificar que todos têm IDs únicos
const ids = list.filter(m => m.tipo === "audio").map(m => m.id).filter(Boolean);
const uniqueIds = new Set(ids);
assert(ids.length === uniqueIds.size, `IDs duplicados detectados: ${ids}`);

// Verificar que nenhum tempId foi perdido
const finalTempIds = list.filter(m => m.tipo === "audio").map(m => m.tempId).filter(Boolean);
tempIds.forEach(tid => {
  assert(finalTempIds.includes(tid), `TempId ${tid} foi perdido`);
});

console.log("✅ Teste de estresse passou - 5 áudios mantidos com integridade");

// Cenário 5: Áudios com nomes genéricos idênticos
console.log("🎯 Testando nomes genéricos idênticos...");
list = [];
const genericName = "audio-1733773200000.webm";
list = mergeMessageIntoListForTest(list, CONV, audioTemp("gen1", genericName, 2000, 0));
list = mergeMessageIntoListForTest(list, CONV, audioTemp("gen2", genericName, 3000, 50));
list = mergeMessageIntoListForTest(list, CONV, audioTemp("gen3", genericName, 2500, 100));
assert(countAudios(list) === 3, `3 áudios com nome idêntico devem permanecer separados, obteve ${countAudios(list)}`);

// Confirmação sem client_temp_id deve ser cautelosa
const unlinkedConfirm = {
  id: 999,
  conversa_id: CONV,
  direcao: "out",
  tipo: "audio",
  texto: "(áudio)",
  nome_arquivo: genericName,
  tamanho: 2000,
  status: "sent",
  criado_em: new Date().toISOString(),
  url: "/uploads/audio-999.mp3",
};
list = mergeMessageIntoListForTest(list, CONV, unlinkedConfirm);
assert(countAudios(list) >= 3, `Confirmação sem client_temp_id não deve remover otimistas válidos`);

console.log("✅ Todos os cenários de estresse passaram!");
console.log("🎉 Sistema de áudios está robusto contra duplicação/desaparecimento");