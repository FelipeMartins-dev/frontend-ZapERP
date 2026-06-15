/**
 * Regressão: envios sequenciais (texto, áudio, imagem) não devem sumir da lista.
 * Executar: node scripts/test-sequential-messages.mjs
 */
import { mergeMessageIntoListForTest } from "../src/conversa/conversaOutboundMediaMerge.js";

const CONV = 42;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function txtTemp(tempId, text, off = 0) {
  return {
    tempId,
    client_temp_id: tempId,
    conversa_id: CONV,
    direcao: "out",
    tipo: "texto",
    texto: text,
    conteudo: text,
    status: "pending",
    status_mensagem: "pending",
    criado_em: new Date(Date.now() + off).toISOString(),
  };
}

function txtConfirmed(id, text, off = 0, clientTempId = null) {
  return {
    id,
    ...(clientTempId ? { client_temp_id: clientTempId } : {}),
    conversa_id: CONV,
    direcao: "out",
    tipo: "texto",
    texto: text,
    conteudo: text,
    status: "sent",
    status_mensagem: "sent",
    criado_em: new Date(Date.now() + off).toISOString(),
  };
}

function imgTemp(tempId, name, size, off = 0) {
  return {
    tempId,
    client_temp_id: tempId,
    conversa_id: CONV,
    direcao: "out",
    tipo: "imagem",
    texto: "(imagem)",
    conteudo: "(imagem)",
    nome_arquivo: name,
    tamanho: size,
    file_last_modified: size,
    status: "pending",
    status_mensagem: "pending",
    criado_em: new Date(Date.now() + off).toISOString(),
    url: `blob:${tempId}`,
    _optimisticBlobUrl: `blob:${tempId}`,
  };
}

function audioTemp(tempId, size, off = 0) {
  return {
    tempId,
    client_temp_id: tempId,
    conversa_id: CONV,
    direcao: "out",
    tipo: "audio",
    texto: "(áudio)",
    conteudo: "(áudio)",
    nome_arquivo: "audio.webm",
    tamanho: size,
    file_last_modified: size,
    status: "pending",
    status_mensagem: "pending",
    criado_em: new Date(Date.now() + off).toISOString(),
    url: `blob:${tempId}`,
    _optimisticBlobUrl: `blob:${tempId}`,
  };
}

// 1) Dois textos iguais seguidos permanecem ao confirmar o 1º
let list = [txtTemp("t1", "ok", 0), txtTemp("t2", "ok", 1)];
list = mergeMessageIntoListForTest(list, CONV, txtConfirmed(201, "ok", 0));
assert(list.length === 2, `confirmar 1º 'ok': esperado 2, obteve ${list.length}`);
assert(list.some((m) => m.tempId === "t1" && String(m.id) === "201"), "t1 reconciliado");
assert(list.some((m) => m.tempId === "t2" && !m.id), "t2 ainda pendente");

// 2) Confirmar o 2º 'ok' não remove o 1º
list = mergeMessageIntoListForTest(list, CONV, txtConfirmed(202, "ok", 1));
assert(list.length === 2, `confirmar 2º 'ok': esperado 2, obteve ${list.length}`);
assert(list.some((m) => String(m.id) === "201"), "1º confirmado intacto");
assert(list.some((m) => String(m.id) === "202"), "2º confirmado intacto");

// 3) Textos distintos em sequência + confirmações socket (FIFO por texto)
list = [txtTemp("a1", "hello", 0), txtTemp("a2", "world", 1), txtTemp("a3", "!", 2)];
list = mergeMessageIntoListForTest(list, CONV, txtConfirmed(301, "hello", 0));
list = mergeMessageIntoListForTest(list, CONV, txtConfirmed(302, "world", 1));
list = mergeMessageIntoListForTest(list, CONV, txtConfirmed(303, "!", 2));
assert(list.length === 3, `3 textos confirmados: esperado 3, obteve ${list.length}`);

// 4) Mix texto + áudio + imagem — nada some ao confirmar em ordem
list = [];
list = mergeMessageIntoListForTest(list, CONV, txtTemp("m1", "msg1", 0));
list = mergeMessageIntoListForTest(list, CONV, txtTemp("m2", "msg2", 1));
list = mergeMessageIntoListForTest(list, CONV, audioTemp("au1", 1000, 2));
list = mergeMessageIntoListForTest(list, CONV, imgTemp("im1", "photo.jpg", 1000, 3));
assert(list.length === 4, `4 otimistas: esperado 4, obteve ${list.length}`);
list = mergeMessageIntoListForTest(list, CONV, txtConfirmed(401, "msg1", 0));
list = mergeMessageIntoListForTest(list, CONV, txtConfirmed(402, "msg2", 1));
list = mergeMessageIntoListForTest(list, CONV, {
  id: 403,
  client_temp_id: "au1",
  conversa_id: CONV,
  direcao: "out",
  tipo: "audio",
  texto: "(áudio)",
  nome_arquivo: "audio.mp3",
  tamanho: 1000,
  status: "sent",
  criado_em: list.find((m) => m.tempId === "au1")?.criado_em,
  url: "/uploads/403.mp3",
});
list = mergeMessageIntoListForTest(list, CONV, {
  id: 404,
  client_temp_id: "im1",
  conversa_id: CONV,
  direcao: "out",
  tipo: "imagem",
  texto: "(imagem)",
  nome_arquivo: "photo.jpg",
  tamanho: 1000,
  status: "sent",
  criado_em: list.find((m) => m.tempId === "im1")?.criado_em,
  url: "/uploads/404.jpg",
});
assert(list.length === 4, `mix confirmado: esperado 4, obteve ${list.length}`);

// 5) Duas imagens com mesmo nome de arquivo permanecem distintas
list = [imgTemp("i1", "photo.jpg", 1000, 0), imgTemp("i2", "photo.jpg", 2000, 1)];
list = mergeMessageIntoListForTest(list, CONV, {
  id: 501,
  client_temp_id: "i1",
  conversa_id: CONV,
  direcao: "out",
  tipo: "imagem",
  texto: "(imagem)",
  nome_arquivo: "photo.jpg",
  tamanho: 1000,
  status: "sent",
  criado_em: list[0].criado_em,
  url: "/uploads/501.jpg",
});
assert(list.length === 2, `2 imagens após confirmar 1ª: esperado 2, obteve ${list.length}`);
assert(list.some((m) => m.tempId === "i2" && !m.id), "2ª imagem otimista intacta");

// 6) Inbound áudio: socket republica mesma mensagem com URL (sem duplicar)
const inAudioTs = new Date().toISOString();
list = [];
list = mergeMessageIntoListForTest(list, CONV, {
  id: 701,
  whatsapp_id: "wa-in-audio-1",
  conversa_id: CONV,
  direcao: "in",
  tipo: "audio",
  texto: "(áudio)",
  criado_em: inAudioTs,
});
list = mergeMessageIntoListForTest(list, CONV, {
  id: 701,
  whatsapp_id: "wa-in-audio-1",
  conversa_id: CONV,
  direcao: "in",
  tipo: "audio",
  texto: "(áudio)",
  nome_arquivo: "voice.ogg",
  tamanho: 12000,
  criado_em: inAudioTs,
  url: "/uploads/in-701.ogg",
});
assert(
  list.filter((m) => String(m.id) === "701").length === 1,
  "inbound áudio com mesmo id não deve duplicar"
);
assert(
  list.find((m) => String(m.id) === "701")?.url === "/uploads/in-701.ogg",
  "URL da mídia inbound deve fundir na bolha existente"
);

// 7) Inbound imagem: placeholder depois URL completa (mesmo whatsapp_id)
const inImgTs = new Date().toISOString();
list = mergeMessageIntoListForTest(list, CONV, {
  whatsapp_id: "wa-in-img-1",
  conversa_id: CONV,
  direcao: "in",
  tipo: "imagem",
  texto: "(imagem)",
  criado_em: inImgTs,
});
list = mergeMessageIntoListForTest(list, CONV, {
  id: 702,
  whatsapp_id: "wa-in-img-1",
  conversa_id: CONV,
  direcao: "in",
  tipo: "imagem",
  texto: "(imagem)",
  nome_arquivo: "photo-in.jpg",
  criado_em: inImgTs,
  url: "/uploads/in-702.jpg",
});
assert(
  list.filter((m) => String(m.whatsapp_id) === "wa-in-img-1").length === 1,
  "inbound imagem com mesmo whatsapp_id não deve duplicar"
);

// 8) Chatbot: dois ecos automaticos identicos em poucos segundos nao devem duplicar visualmente
const botTs = new Date().toISOString();
const botMenu = `Opcao invalida. Por favor, responda apenas com o numero do setor desejado.

1 - Suporte
2 - Comercial
3 - Financeiro
4 - Administrativo

Responda com o numero da opcao desejada.`;
list = [];
list = mergeMessageIntoListForTest(list, CONV, {
  id: 801,
  conversa_id: CONV,
  direcao: "out",
  tipo: "texto",
  origem: "chatbot_triage",
  texto: botMenu,
  conteudo: botMenu,
  status: "sent",
  criado_em: botTs,
});
list = mergeMessageIntoListForTest(list, CONV, {
  id: 802,
  conversa_id: CONV,
  direcao: "out",
  tipo: "texto",
  origem: "chatbot_triage",
  texto: botMenu,
  conteudo: botMenu,
  status: "sent",
  criado_em: new Date(new Date(botTs).getTime() + 1000).toISOString(),
});
assert(list.length === 1, `chatbot duplicado: esperado 1, obteve ${list.length}`);

// 9) Manual: duas mensagens humanas iguais continuam sendo duas mensagens reais
const manualLong = "Mensagem manual longa repetida pelo atendente para confirmar o mesmo procedimento ao cliente.";
list = [];
list = mergeMessageIntoListForTest(list, CONV, {
  id: 811,
  conversa_id: CONV,
  direcao: "out",
  tipo: "texto",
  usuario_id: 7,
  texto: manualLong,
  conteudo: manualLong,
  status: "sent",
  criado_em: botTs,
});
list = mergeMessageIntoListForTest(list, CONV, {
  id: 812,
  conversa_id: CONV,
  direcao: "out",
  tipo: "texto",
  usuario_id: 7,
  texto: manualLong,
  conteudo: manualLong,
  status: "sent",
  criado_em: new Date(new Date(botTs).getTime() + 1000).toISOString(),
});
assert(list.length === 2, `manual repetido: esperado 2, obteve ${list.length}`);

console.log("OK - regressao de mensagens sequenciais passou (9 cenarios).");
