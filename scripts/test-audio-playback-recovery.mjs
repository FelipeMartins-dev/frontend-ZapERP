/**
 * Regressão das decisões de recuperação do AudioWavePlayer + refresh do token do /media/proxy.
 *
 * Protege as regras puras que decidem "para qual fonte ir" e "quando desistir" (audioPlaybackRecovery)
 * e a reescrita do access_token na URL do proxy no (re)load (refreshProxyMediaToken). São a parte
 * frágil que futuras mudanças de resume/mobile podem regredir sem que o build acuse (frontend sem
 * eslint; esbuild não pega lógica errada).
 *
 * Executar: node --import ./scripts/vite-env-shim.mjs scripts/test-audio-playback-recovery.mjs
 */
import {
  nextSourceIndexOnError,
  shouldGiveUpOnError,
  planReloadOnPlayFailure,
  classifyStallRecovery,
  planReloadOnStall,
  needsReloadBeforeResume,
} from "../src/conversa/utils/audioPlaybackRecovery.js";
import { refreshProxyMediaToken, getMediaPlaybackUrl } from "../src/conversa/utils/conversaViewHelpers.js";

let falhas = 0;
function checar(nome, condicao, detalhe) {
  if (condicao) return;
  falhas += 1;
  console.error(`FALHOU: ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── nextSourceIndexOnError ────────────────────────────────────────────────────
// Há próxima fonte → avança, independente da janela do clique.
checar("erro: avança quando há próxima fonte",
  nextSourceIndexOnError({ sourceIdx: 0, sourceCount: 2, autoWindowOpen: false }) === 1);
// Última fonte, usuário esperando (janela aberta) e >1 fonte → volta ao início para fechar o ciclo.
checar("erro: última fonte com clique ativo volta ao 0",
  nextSourceIndexOnError({ sourceIdx: 1, sourceCount: 2, autoWindowOpen: true }) === 0);
// Última fonte SEM clique ativo → fica onde está (nada de rede em segundo plano).
checar("erro: última fonte sem clique fica parada",
  nextSourceIndexOnError({ sourceIdx: 1, sourceCount: 2, autoWindowOpen: false }) === 1);
// Fonte única, mesmo com clique ativo → não há para onde ir (count>1 falha).
checar("erro: fonte única não reinicia",
  nextSourceIndexOnError({ sourceIdx: 0, sourceCount: 1, autoWindowOpen: true }) === 0);

// ── shouldGiveUpOnError ───────────────────────────────────────────────────────
checar("teto: uma volta completa (tentativas > fontes) desiste",
  shouldGiveUpOnError({ tentativas: 3, sourceCount: 2 }) === true);
checar("teto: ainda dentro da volta não desiste",
  shouldGiveUpOnError({ tentativas: 2, sourceCount: 2 }) === false);

// ── planReloadOnPlayFailure (play() rejeitou) ────────────────────────────────
checar("play falho: avança com próxima fonte",
  eq(planReloadOnPlayFailure({ sourceIdx: 0, sourceCount: 3 }), { type: "advance", sourceIdx: 1 }));
checar("play falho: na última fonte volta ao 0 (reset)",
  eq(planReloadOnPlayFailure({ sourceIdx: 2, sourceCount: 3 }), { type: "reset", sourceIdx: 0 }));
checar("play falho: fonte única força nonce",
  eq(planReloadOnPlayFailure({ sourceIdx: 0, sourceCount: 1 }), { type: "nonce" }));

// ── classifyStallRecovery ─────────────────────────────────────────────────────
checar("stall: tempo andou → noop",
  classifyStallRecovery({ paused: false, ended: false, seeking: false, progressed: true, alreadyRecovered: false }) === "noop");
checar("stall: pausado → noop",
  classifyStallRecovery({ paused: true, ended: false, seeking: false, progressed: false, alreadyRecovered: false }) === "noop");
checar("stall: buscando (seek) → noop",
  classifyStallRecovery({ paused: false, ended: false, seeking: true, progressed: false, alreadyRecovered: false }) === "noop");
checar("stall: 1ª vez travado → recover",
  classifyStallRecovery({ paused: false, ended: false, seeking: false, progressed: false, alreadyRecovered: false }) === "recover");
checar("stall: travado de novo → giveup",
  classifyStallRecovery({ paused: false, ended: false, seeking: false, progressed: false, alreadyRecovered: true }) === "giveup");

// ── planReloadOnStall (sem ramo de reset, diferente do play-failure) ──────────
checar("stall: avança com próxima fonte",
  eq(planReloadOnStall({ sourceIdx: 0, sourceCount: 2 }), { type: "advance", sourceIdx: 1 }));
checar("stall: na última fonte recarrega por nonce (nunca reseta para 0)",
  eq(planReloadOnStall({ sourceIdx: 1, sourceCount: 2 }), { type: "nonce" }));
checar("stall: fonte única → nonce",
  eq(planReloadOnStall({ sourceIdx: 0, sourceCount: 1 }), { type: "nonce" }));

// ── needsReloadBeforeResume (resume robusto no mobile) ───────────────────────
// Erro no elemento → sempre recarrega.
checar("resume: erro força reload",
  needsReloadBeforeResume({ hasError: true, readyState: 4, positionCovered: true, currentTime: 3 }) === true);
// HAVE_NOTHING (0) → recarrega.
checar("resume: readyState 0 força reload",
  needsReloadBeforeResume({ hasError: false, readyState: 0, positionCovered: false, currentTime: 0 }) === true);
// Buffer suficiente à frente (>=3) E posição coberta → NÃO recarrega (caminho rápido comum).
checar("resume: readyState 4 com buffer não recarrega",
  needsReloadBeforeResume({ hasError: false, readyState: 4, positionCovered: true, currentTime: 3 }) === false);
checar("resume: readyState 3 com buffer não recarrega",
  needsReloadBeforeResume({ hasError: false, readyState: 3, positionCovered: true, currentTime: 3 }) === false);
// readyState alto mentiroso + buffer vazio no meio → reload (Chrome mobile após pause).
checar("resume: readyState 3 sem buffer no meio força reload",
  needsReloadBeforeResume({ hasError: false, readyState: 3, positionCovered: false, currentTime: 3 }) === true);
checar("resume: readyState 4 sem buffer no meio força reload",
  needsReloadBeforeResume({ hasError: false, readyState: 4, positionCovered: false, currentTime: 3 }) === true);
// O bug clássico: pausado no meio, metadados apenas (readyState 1), posição sem buffer → reload.
checar("resume: buffer liberado no meio da faixa força reload",
  needsReloadBeforeResume({ hasError: false, readyState: 1, positionCovered: false, currentTime: 5 }) === true);
// Primeiro play (posição 0) com metadados: NÃO recarrega — play() já dispara o fetch como antes.
checar("resume: primeiro play (posição 0) não recarrega",
  needsReloadBeforeResume({ hasError: false, readyState: 1, positionCovered: false, currentTime: 0 }) === false);
// readyState 2 com a posição coberta → não recarrega.
checar("resume: readyState 2 com posição coberta não recarrega",
  needsReloadBeforeResume({ hasError: false, readyState: 2, positionCovered: true, currentTime: 5 }) === false);

// ── refreshProxyMediaToken ────────────────────────────────────────────────────
// URL do proxy montada com o token atual; simula rotação do JWT e confere que o (re)load usa o novo.
{
  const proxyUrlAntiga = getMediaPlaybackUrl("https://media.ultramsg.com/i/audio.ogg", null);
  checar("setup: proxy trouxe o token inicial", proxyUrlAntiga.includes("access_token=token-de-teste"), proxyUrlAntiga);

  globalThis.localStorage.setItem("zap_erp_auth", JSON.stringify({ token: "token-NOVO" }));
  const atualizada = refreshProxyMediaToken(proxyUrlAntiga);
  checar("proxy: token reescrito com o valor novo do storage",
    atualizada.includes("access_token=token-NOVO") && !atualizada.includes("token-de-teste"), atualizada);
  checar("proxy: parâmetro url preservado intacto",
    atualizada.includes("url=https%3A%2F%2Fmedia.ultramsg.com%2Fi%2Faudio.ogg"), atualizada);
  // restaura para não afetar outros asserts
  globalThis.localStorage.setItem("zap_erp_auth", JSON.stringify({ token: "token-de-teste" }));
}
// Fontes que NÃO são proxy voltam inalteradas (nenhum reload espúrio).
checar("blob volta inalterado", refreshProxyMediaToken("blob:http://app.local/abc") === "blob:http://app.local/abc");
checar("/uploads volta inalterado",
  refreshProxyMediaToken("https://api.teste.local/uploads/123-audio.ogg") === "https://api.teste.local/uploads/123-audio.ogg");
checar("URL direta do provedor volta inalterada",
  refreshProxyMediaToken("https://media.ultramsg.com/i/audio.ogg") === "https://media.ultramsg.com/i/audio.ogg");
// Proxy SEM token na query não é tocado (nada a atualizar).
checar("proxy sem token volta inalterado",
  refreshProxyMediaToken("https://api.teste.local/media/proxy?url=https%3A%2F%2Fx.com%2Fa.ogg")
    === "https://api.teste.local/media/proxy?url=https%3A%2F%2Fx.com%2Fa.ogg");
checar("entrada vazia volta vazia", refreshProxyMediaToken("") === "");

if (falhas > 0) {
  console.error(`\n${falhas} teste(s) falharam.`);
  process.exit(1);
}
console.log("OK — regressão de recuperação/token do player passou (36 asserts).");
