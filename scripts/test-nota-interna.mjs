/**
 * Regressao: nota interna ("mensagem invisivel").
 * Executar: npm run test:nota-interna
 * (usa o shim de import.meta.env, como os demais scripts que carregam modulos do app)
 *
 * Cobre:
 *  - identificacao da nota (tipo/direcao) sem confundir com mensagem normal;
 *  - deduplicacao por id: nota que chega pela resposta da API e pelo socket
 *    (duas abas, reconexao) nunca vira bolha duplicada;
 *  - nota nunca e agrupada como legenda de midia;
 *  - preview da lista rotula a nota em vez de exibi-la como mensagem do cliente;
 *  - nota nao conta como "movimentacao" da conversa (badge aberta / ociosa).
 */
import { mergeMessageIntoListForTest } from "../src/conversa/conversaOutboundMediaMerge.js";
import { isInternalNote, INTERNAL_NOTE_TIPO, INTERNAL_NOTE_DIRECAO } from "../src/conversa/internalNote.js";
import { isPlainCaptionFollowMessage } from "../src/conversa/utils/conversaViewHelpers.js";

const CONV = 101;
let cenarios = 0;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
  cenarios += 1;
}

function nota(id, texto, off = 0) {
  return {
    id,
    conversa_id: CONV,
    tipo: INTERNAL_NOTE_TIPO,
    direcao: INTERNAL_NOTE_DIRECAO,
    status: "interna",
    status_mensagem: "interna",
    whatsapp_id: null,
    texto,
    conteudo: texto,
    autor_usuario_id: 22,
    usuario_nome: "Ana",
    fromMe: false,
    enviado_por_usuario: false,
    criado_em: new Date(Date.now() + off).toISOString(),
  };
}

// ── 1) Identificacao ─────────────────────────────────────────────────────────

assert(isInternalNote(nota(1, "x")), "nota deve ser identificada");
assert(isInternalNote({ direcao: "interna" }), "direcao interna identifica nota");
assert(!isInternalNote({ tipo: "texto", direcao: "out" }), "mensagem enviada nao e nota");
assert(!isInternalNote({ tipo: "audio", direcao: "in" }), "audio recebido nao e nota");
assert(!isInternalNote(null), "null nao e nota");

// ── 2) Deduplicacao (duas abas / reconexao de socket) ────────────────────────

{
  // A aba do autor recebe a nota pela resposta da API e, logo depois, pelo socket.
  let list = [];
  list = mergeMessageIntoListForTest(list, CONV, nota(500, "combinar desconto"));
  list = mergeMessageIntoListForTest(list, CONV, nota(500, "combinar desconto"));
  assert(list.length === 1, `nota duplicada no merge por id (len=${list.length})`);
  assert(String(list[0].id) === "500", "id da nota preservado no merge");
}

{
  // Reconexao: a mesma nota chega de novo junto com uma mensagem normal.
  let list = [];
  list = mergeMessageIntoListForTest(list, CONV, nota(501, "checar estoque"));
  list = mergeMessageIntoListForTest(list, CONV, {
    id: 502,
    conversa_id: CONV,
    tipo: "texto",
    direcao: "in",
    texto: "bom dia",
    criado_em: new Date(Date.now() + 10).toISOString(),
  });
  list = mergeMessageIntoListForTest(list, CONV, nota(501, "checar estoque"));
  assert(list.length === 2, `reconexao duplicou linhas (len=${list.length})`);
  assert(list.filter((m) => isInternalNote(m)).length === 1, "nota duplicada apos reconexao");
}

{
  // Duas notas distintas de dois atendentes ao mesmo tempo continuam sendo duas linhas.
  let list = [];
  list = mergeMessageIntoListForTest(list, CONV, nota(600, "atendente A"));
  list = mergeMessageIntoListForTest(list, CONV, nota(601, "atendente B", 5));
  assert(list.length === 2, "notas simultaneas de atendentes diferentes devem coexistir");
}

{
  // Nota de OUTRA conversa nunca entra na lista da conversa aberta.
  let list = [];
  list = mergeMessageIntoListForTest(list, CONV, { ...nota(700, "outra conversa"), conversa_id: 999 });
  assert(list.length === 0, "nota de outra conversa vazou para a lista");
}

// ── 3) Nao e legenda de midia ────────────────────────────────────────────────

assert(
  isPlainCaptionFollowMessage({ tipo: "texto", texto: "legenda" }) === true,
  "texto comum continua sendo candidato a legenda"
);
assert(
  isPlainCaptionFollowMessage(nota(800, "nota logo apos uma foto")) === false,
  "nota interna nao pode ser agrupada como legenda de midia"
);

// ── 4) Preview da lista ──────────────────────────────────────────────────────

// Espelha a regra aplicada em ChatListRow.getPreview.
function previewDeUltimaMensagem(last) {
  if (isInternalNote(last)) {
    const texto = String(last?.texto || last?.conteudo || "").trim();
    return `Nota interna${texto ? `: ${texto.slice(0, 60)}` : ""}`;
  }
  const outPrefix = String(last?.direcao || "").toLowerCase() === "out" ? "Você: " : "";
  return `${outPrefix}${String(last?.texto || "")}`;
}

assert(
  previewDeUltimaMensagem(nota(900, "cliente pediu desconto")) === "Nota interna: cliente pediu desconto",
  "preview da nota deve ser rotulado"
);
assert(
  previewDeUltimaMensagem({ tipo: "texto", direcao: "out", texto: "ola" }) === "Você: ola",
  "preview de mensagem normal nao pode mudar"
);

// ── 5) Nao conta como movimentacao da conversa ───────────────────────────────

// Espelha a regra aplicada no backend (listarConversas / detalharChat).
const temMovimentacao = (msgs) => msgs.some((m) => !isInternalNote(m));

assert(temMovimentacao([nota(1000, "so nota")]) === false, "so nota nao e movimentacao");
assert(
  temMovimentacao([nota(1001, "nota"), { tipo: "texto", direcao: "in", texto: "oi" }]) === true,
  "mensagem real continua contando como movimentacao"
);

console.log(`OK — regressão de nota interna passou (${cenarios} cenários).`);
