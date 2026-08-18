import {
  getMessageTimestampMillis,
  normalizeMessageChronology,
  parseMessageTimestampMillis,
} from "../src/conversa/messageChronology.js";
import {
  getMessageListReactKey,
  mergeMessageIntoListForTest,
  sortMensagensChronological,
} from "../src/conversa/conversaOutboundMediaMerge.js";
import { pickHigherStatus } from "../src/socket/statusMensagemBatch.js";

const CONV = 91;
const T0 = Date.parse("2026-08-18T19:47:00.000Z");
const iso = (offset) => new Date(T0 + offset).toISOString();
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const row = (id, offset, extra = {}) => ({
  id,
  conversa_id: CONV,
  direcao: extra.direcao || "in",
  tipo: extra.tipo || "texto",
  texto: extra.texto || `m${id}`,
  message_timestamp: iso(offset),
  criado_em: iso(offset),
  ...extra,
});
const orderedIds = (list) => sortMensagensChronological(list).map((m) => Number(m.id));

// 1. texto -> texto
assert(orderedIds([row(2, 1_000), row(1, 0)]).join() === "1,2", "1 texto/texto");

// 2. imagem lenta -> texto: conclusão tardia não altera o timestamp original.
let list = [row(2, 1_000), row(1, 0, { tipo: "imagem", url: "/uploads/final.jpg" })];
assert(orderedIds(list).join() === "1,2", "2 imagem lenta antes do texto");

// 3. texto -> imagem
assert(orderedIds([row(4, 1_000, { tipo: "imagem" }), row(3, 0)]).join() === "3,4", "3 texto/imagem");

// 4. imagem lenta seguida por várias mensagens
list = [row(13, 3_000), row(10, 0, { tipo: "imagem" }), row(12, 2_000), row(11, 1_000)];
assert(orderedIds(list).join() === "10,11,12,13", "4 mídia lenta com rajada");

// 5. duas mídias processadas na ordem inversa
list = [row(21, 0, { tipo: "audio", url: "/uploads/a.ogg" }), row(22, 1_000, { tipo: "video", url: "/uploads/b.mp4" })];
assert(orderedIds(list.reverse()).join() === "21,22", "5 mídias concluídas fora de ordem");

// 6. otimista confirmada pela API
list = [{ tempId: "temp-1", client_temp_id: "temp-1", conversa_id: CONV, direcao: "out", tipo: "texto", texto: "oi", status: "pending", message_timestamp: iso(0), criado_em: iso(0) }];
list = mergeMessageIntoListForTest(list, CONV, row(31, 5, { direcao: "out", texto: "oi", client_temp_id: "temp-1", status: "sent" }));
assert(list.length === 1 && Number(list[0].id) === 31, "6 reconciliação API");

// 7. Socket.IO antes da resposta HTTP
list = mergeMessageIntoListForTest(list, CONV, row(31, 5, { direcao: "out", texto: "oi", client_temp_id: "temp-1", status: "delivered" }));
assert(list.length === 1, "7 socket antes da API sem duplicar");

// 8. webhook antes da resposta HTTP
list = [{ tempId: "temp-2", client_temp_id: "temp-2", conversa_id: CONV, direcao: "out", tipo: "imagem", texto: "(imagem)", message_timestamp: iso(10), criado_em: iso(10), url: "blob:temp-2" }];
list = mergeMessageIntoListForTest(list, CONV, row(32, 10, { direcao: "out", tipo: "imagem", texto: "(imagem)", client_temp_id: "temp-2", whatsapp_id: "wa32", url: "/uploads/32.jpg" }));
assert(list.length === 1 && list[0].whatsapp_id === "wa32", "8 webhook antes da API");

// 9. webhook duplicado
list = mergeMessageIntoListForTest(list, CONV, row(32, 10, { direcao: "out", tipo: "imagem", texto: "(imagem)", whatsapp_id: "wa32", url: "/uploads/32.jpg" }));
assert(list.length === 1, "9 webhook duplicado");

// 10. ACK atrasado de mensagem antiga: monotônico e sem mudar posição
const ackRows = [row(41, 0, { direcao: "out", status: "read" }), row(42, 1_000, { direcao: "out", status: "sent" })];
ackRows[0] = { ...ackRows[0], status: pickHigherStatus(ackRows[0].status, "delivered") };
assert(ackRows[0].status === "read" && orderedIds(ackRows).join() === "41,42", "10 ACK monotônico");

// 11. mesmo timestamp: id sequencial desempata
assert(orderedIds([row(52, 0), row(51, 0)]).join() === "51,52", "11 desempate por id");

// 12. histórico e realtime simultâneos
list = [row(61, 0), row(62, 1_000)];
list = mergeMessageIntoListForTest(list, CONV, row(63, 2_000));
list = mergeMessageIntoListForTest(list, CONV, row(62, 1_000));
assert(list.length === 3 && orderedIds(list).join() === "61,62,63", "12 histórico + realtime");

// 13. páginas antigas mescladas no lado errado ainda terminam ordenadas
list = [row(72, 2_000), row(73, 3_000)];
for (const old of [row(71, 1_000), row(70, 0)]) list = mergeMessageIntoListForTest(list, CONV, old);
assert(orderedIds(list).join() === "70,71,72,73", "13 paginação por cursor");

// 14. reconexão repetindo eventos
list = [row(81, 0, { whatsapp_id: "wa81" })];
list = mergeMessageIntoListForTest(list, CONV, row(81, 0, { whatsapp_id: "wa81" }));
assert(list.length === 1, "14 reconexão sem duplicar");

// 15. atualização da URL mantém timestamp, chave React e posição
const beforeMedia = row(82, 1_000, { tipo: "audio", whatsapp_id: "wa82", url: "https://provider/audio" });
const keyBefore = getMessageListReactKey(beforeMedia, CONV);
list = [row(81, 0), beforeMedia, row(83, 2_000)];
list = mergeMessageIntoListForTest(list, CONV, { ...beforeMedia, url: "/uploads/audio.ogg" });
const afterMedia = list.find((m) => Number(m.id) === 82);
assert(orderedIds(list).join() === "81,82,83" && getMessageListReactKey(afterMedia, CONV) === keyBefore, "15 mídia atualizada sem salto");

// 16/17. segundos e milissegundos
assert(parseMessageTimestampMillis(1_755_547_620) === 1_755_547_620_000, "16 timestamp em segundos");
assert(parseMessageTimestampMillis(1_755_547_620_000) === 1_755_547_620_000, "17 timestamp em ms");

// 18. ausente/inválido usa criado_em legado ou fallback controlado, nunca updated_at
const legacyValid = normalizeMessageChronology({ id: 89, message_timestamp: "inválido", criado_em: iso(123), updated_at: iso(9_999) }, T0);
const fallback = normalizeMessageChronology({ id: 90, updated_at: iso(9_999) }, T0);
assert(getMessageTimestampMillis(legacyValid) === T0 + 123 && getMessageTimestampMillis(fallback) === T0, "18 timestamp inválido/ausente");

console.log("OK - ordenação cronológica passou (18 cenários).");
