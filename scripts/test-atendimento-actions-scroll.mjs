/**
 * Regressao: acoes de atendimento (assumir/encerrar/reabrir/aguardar/retomar/transferir)
 * nao podem fazer o historico "pular".
 *
 * Encerrar insere o banner "atendimento encerrado" no topo da thread e a linha de aviso do
 * composer; reabrir remove os dois. Como `.wa-messages` usa `overflow-anchor: none`, o
 * browser nao compensa: sem reancoragem o conteudo salta dezenas de px.
 *
 * Executar: node scripts/test-atendimento-actions-scroll.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  captureMessagesScrollAnchor,
  restoreMessagesScrollAnchor,
  isNearBottom,
} from "../src/conversa/scrollUtils.js";

const here = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(join(here, "..", "src", p), "utf8");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Container de scroll falso, com o clamp de scrollTop que o browser aplica. */
function makeContainer({ scrollHeight, clientHeight, scrollTop }) {
  const el = { scrollHeight, clientHeight, _top: 0 };
  Object.defineProperty(el, "scrollTop", {
    get() {
      return this._top;
    },
    set(v) {
      const max = Math.max(0, this.scrollHeight - this.clientHeight);
      this._top = Math.min(max, Math.max(0, Number(v) || 0));
    },
  });
  el.scrollTop = scrollTop;
  return el;
}

let casos = 0;

/* ---------------------------------------------------------------------------
 * 1) Encerrar enquanto o atendente le historico: banner entra no topo (+62px de
 *    conteudo). Sem reancorar, o trecho lido desce 62px.
 * ------------------------------------------------------------------------- */
{
  const BANNER = 62;
  const el = makeContainer({ scrollHeight: 4000, clientHeight: 700, scrollTop: 1200 });
  const snap = captureMessagesScrollAnchor(el);
  assert(snap.top === 1200 && snap.height === 4000, "ancora deve gravar top e scrollHeight");

  el.scrollHeight += BANNER; // banner entra ANTES do conteudo visivel
  assert(el.scrollTop === 1200, "sem reancoragem o browser mantem scrollTop (conteudo desce)");

  restoreMessagesScrollAnchor(el, snap);
  assert(
    el.scrollTop === 1200 + BANNER,
    `apos encerrar o trecho lido deve ficar parado (esperado ${1200 + BANNER}, obtido ${el.scrollTop})`
  );
  casos += 1;
}

/* ---------------------------------------------------------------------------
 * 2) Reabrir: banner sai, conteudo encolhe. A ancora tem de subir o mesmo tanto.
 * ------------------------------------------------------------------------- */
{
  const BANNER = 62;
  const el = makeContainer({ scrollHeight: 4062, clientHeight: 700, scrollTop: 1262 });
  const snap = captureMessagesScrollAnchor(el);
  el.scrollHeight -= BANNER;
  restoreMessagesScrollAnchor(el, snap);
  assert(
    el.scrollTop === 1200,
    `apos reabrir o trecho lido deve ficar parado (esperado 1200, obtido ${el.scrollTop})`
  );
  casos += 1;
}

/* ---------------------------------------------------------------------------
 * 3) Caso normal: o atendente esta colado ao fim quando clica Encerrar. O aviso do
 *    composer aparece e ENCOLHE a viewport (clientHeight), sem mexer no conteudo.
 *
 *    A ancora sozinha nao resolve este caso — ela compensa crescimento de conteudo,
 *    nao reducao de viewport — e deixaria a ultima mensagem cortada. Por isso o
 *    ConversaView guarda `atBottom` e, nesse caso, reancora ao fim em vez de repor
 *    o scrollTop absoluto. Este cenario fixa as duas metades do contrato.
 * ------------------------------------------------------------------------- */
{
  const HINT = 20;
  const el = makeContainer({ scrollHeight: 4000, clientHeight: 700, scrollTop: 3300 });
  assert(isNearBottom(el, 120), "cenario deve comecar colado ao fim");
  const snap = captureMessagesScrollAnchor(el);

  el.clientHeight -= HINT; // linha "Reabra o atendimento para enviar mensagens"
  restoreMessagesScrollAnchor(el, snap);
  assert(
    el.scrollHeight - el.scrollTop - el.clientHeight === HINT,
    "a ancora absoluta sozinha deixa a ultima mensagem cortada — dai o ramo atBottom"
  );

  el.scrollTop = el.scrollHeight; // o que snapThreadToBottom({ min: true }) faz
  assert(
    el.scrollHeight - el.scrollTop - el.clientHeight === 0,
    "com o ramo atBottom quem estava no fim continua no fim"
  );
  casos += 1;
}

/* ---------------------------------------------------------------------------
 * 3b) Invariante: o handler de reancoragem do ConversaView tem de distinguir
 *     "estava no fim" de "estava a ler historico".
 * ------------------------------------------------------------------------- */
{
  const view = src("conversa/ConversaView.jsx");
  const bloco = view.slice(
    view.indexOf("registerMessagesScrollPreserve") - 2600,
    view.indexOf("registerMessagesScrollPreserve") + 200
  );
  assert(/atBottom/.test(bloco), "os handlers de preserve devem guardar `atBottom`");
  assert(
    /snapThreadToBottom\(/.test(bloco) && /restoreMessagesScrollAnchor\(/.test(bloco),
    "preserve deve reancorar ao fim OU repor a ancora, conforme `atBottom`"
  );
  casos += 1;
}

/* ---------------------------------------------------------------------------
 * 4) A ancora nunca pode passar do limite de scroll do container.
 * ------------------------------------------------------------------------- */
{
  const el = makeContainer({ scrollHeight: 1500, clientHeight: 700, scrollTop: 700 });
  const snap = captureMessagesScrollAnchor(el);
  el.scrollHeight = 900; // conversa limpa / mensagens apagadas
  restoreMessagesScrollAnchor(el, snap);
  assert(el.scrollTop <= 900 - 700, `scrollTop deve respeitar o maximo (obtido ${el.scrollTop})`);
  assert(el.scrollTop >= 0, "scrollTop nunca pode ser negativo");
  casos += 1;
}

/* ---------------------------------------------------------------------------
 * 5) Invariante de codigo: TODAS as acoes de atendimento passam pela reancoragem.
 *    Antes so `assumirConversa` preservava a posicao — encerrar/reabrir/aguardar/
 *    retomar/transferir saltavam.
 * ------------------------------------------------------------------------- */
{
  const store = src("conversa/conversaStore.js");
  const acoes = [
    "assumirConversa",
    "transferirConversa",
    "encerrarConversa",
    "reabrirConversa",
    "marcarAguardandoClienteConversa",
    "marcarAguardandoPagamentoConversa",
    "retomarAtendimentoConversa",
  ];
  for (const acao of acoes) {
    const re = new RegExp(`${acao}:\\s*async[^\\n]*\\n\\s*withMessagesScrollPreserved\\(`);
    assert(re.test(store), `${acao} deve correr dentro de withMessagesScrollPreserved`);
  }
  assert(
    /registerMessagesScrollPreserve/.test(src("conversa/ConversaView.jsx")),
    "ConversaView deve registar os handlers de reancoragem"
  );
  casos += acoes.length;
}

/* ---------------------------------------------------------------------------
 * 6) `transferirConversa` tem de usar refresh silencioso: o refresh normal liga
 *    `loading`, o thread mostra skeleton e o useAutoScroll re-snapa ao fim —
 *    quem estava a ler historico era atirado para a ultima mensagem.
 * ------------------------------------------------------------------------- */
{
  const store = src("conversa/conversaStore.js");
  const bloco = store.slice(
    store.indexOf("transferirConversa:"),
    store.indexOf("encerrarConversa:")
  );
  assert(bloco.length > 0, "bloco de transferirConversa nao encontrado");
  assert(
    /refresh\(\{\s*silent:\s*true\s*\}\)/.test(bloco),
    "transferirConversa deve usar refresh({ silent: true })"
  );
  casos += 1;
}

/* ---------------------------------------------------------------------------
 * 7) Abrir conversa por ?conversa= nao pode empilhar historico: `replace` e opcao
 *    do 2.o argumento de navigate() — dentro do objeto de destino era ignorado.
 * ------------------------------------------------------------------------- */
{
  const page = src("pages/Atendimento.jsx");
  assert(
    !/navigate\(\{[^}]*replace:/.test(page),
    "navigate() nao pode receber `replace` dentro do objeto de destino"
  );
  assert(
    /navigate\(\s*\{\s*pathname:\s*"\/atendimento",\s*search:\s*""\s*\}\s*,\s*\{\s*replace:\s*true\s*\}\s*\)/.test(
      page
    ),
    "abertura por ?conversa= deve substituir a entrada de historico"
  );
  casos += 1;
}

console.log(`OK - acoes de atendimento mantem o scroll ancorado (${casos} cenarios).`);
