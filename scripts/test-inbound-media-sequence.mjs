/**
 * Regressão: mídias RECEBIDAS do contato (áudio/foto) em sequência rápida não devem
 * ser fundidas numa única bolha quando já têm identidade persistida (id/whatsapp_id)
 * diferente — mesmo que dois áudios tenham a mesma duração, ou uma foto ainda não
 * tenha URL processada enquanto a anterior já tem.
 * Executar: node scripts/test-inbound-media-sequence.mjs
 */
import { mergeMessageIntoListForTest } from "../src/conversa/conversaOutboundMediaMerge.js";

const CONV = 77;

function inboundAudio(id, whatsappId, durSec, msOffset = 0, url = `/uploads/audio-${id}.mp3`) {
  return {
    id,
    whatsapp_id: whatsappId,
    conversa_id: CONV,
    direcao: "in",
    fromMe: false,
    tipo: "audio",
    texto: "(áudio)",
    audio_duracao_sec: durSec,
    criado_em: new Date(Date.now() + msOffset).toISOString(),
    url,
  };
}

function inboundImage(id, whatsappId, msOffset = 0, url = `/uploads/foto-${id}.jpg`) {
  return {
    id,
    whatsapp_id: whatsappId,
    conversa_id: CONV,
    direcao: "in",
    fromMe: false,
    tipo: "imagem",
    texto: "(imagem)",
    nome_arquivo: `foto-${id}.jpg`,
    criado_em: new Date(Date.now() + msOffset).toISOString(),
    url,
  };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function countByTipo(list, tipo) {
  return list.filter((m) => String(m?.tipo || "").toLowerCase() === tipo).length;
}

let list = [];

// 1) Dois áudios recebidos DIFERENTES (whatsapp_id distintos) com a MESMA duração
//    não podem ser fundidos — bug original: duração igual + whatsapp_id diferente
//    caía numa heurística fraca e perdia o 2º áudio.
list = mergeMessageIntoListForTest(list, CONV, inboundAudio(2001, "wa-2001", 3, 0));
list = mergeMessageIntoListForTest(list, CONV, inboundAudio(2002, "wa-2002", 3, 500));
assert(countByTipo(list, "audio") === 2, `esperado 2 áudios recebidos distintos, obteve ${countByTipo(list, "audio")}`);
assert(list.some((m) => String(m.id) === "2001"), "áudio 2001 deve permanecer");
assert(list.some((m) => String(m.id) === "2002"), "áudio 2002 deve permanecer");

// 2) Duas fotos DIFERENTES (whatsapp_id distintos) chegando uma com URL e a
//    seguinte momentaneamente sem URL (placeholder) não podem ser fundidas.
list = [];
list = mergeMessageIntoListForTest(list, CONV, inboundImage(3001, "wa-3001", 0, "/uploads/foto-3001.jpg"));
list = mergeMessageIntoListForTest(list, CONV, inboundImage(3002, "wa-3002", 500, ""));
assert(countByTipo(list, "imagem") === 2, `esperado 2 fotos recebidas distintas, obteve ${countByTipo(list, "imagem")}`);
assert(list.some((m) => String(m.id) === "3001"), "foto 3001 deve permanecer");
assert(list.some((m) => String(m.id) === "3002"), "foto 3002 deve permanecer");

// 3) Sequência maior: 5 áudios recebidos seguidos, durações repetidas de propósito.
list = [];
const durs = [2, 2, 3, 3, 2];
durs.forEach((d, i) => {
  list = mergeMessageIntoListForTest(list, CONV, inboundAudio(4000 + i, `wa-${4000 + i}`, d, i * 200));
});
assert(countByTipo(list, "audio") === 5, `esperado 5 áudios na sequência, obteve ${countByTipo(list, "audio")}`);

// 4) Caso legítimo (não pode regredir): MESMA mensagem chegando 2x —
//    primeiro sem URL (placeholder), depois com URL — mesmo id/whatsapp_id —
//    deve continuar sendo fundida numa única bolha.
list = [];
list = mergeMessageIntoListForTest(list, CONV, inboundImage(5001, "wa-5001", 0, ""));
list = mergeMessageIntoListForTest(list, CONV, inboundImage(5001, "wa-5001", 50, "/uploads/foto-5001.jpg"));
assert(countByTipo(list, "imagem") === 1, `eco legítimo (mesmo id) deve fundir em 1 bolha, obteve ${countByTipo(list, "imagem")}`);
assert(list[0].url === "/uploads/foto-5001.jpg", "bolha fundida deve ficar com a URL final");

console.log("OK — regressão de mídia recebida em sequência passou (4 cenários).");
