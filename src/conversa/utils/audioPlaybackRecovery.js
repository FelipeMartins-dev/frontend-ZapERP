/**
 * Decisões PURAS de recuperação de reprodução de áudio, extraídas do `AudioWavePlayer`
 * (ConversaBubble.jsx). O player em si depende de eventos do `<audio>` e de estado do React —
 * difícil de testar — mas as REGRAS de "para qual fonte ir" e "quando desistir" são pura aritmética.
 * Centralizá-las aqui dá um ponto único de verdade testável e protege futuras mudanças (ex.: resume
 * mais robusto no mobile) de regredir o comportamento já estável. Nenhuma destas funções toca o DOM,
 * refs ou timers: recebem números/booleanos e devolvem a decisão.
 */

/**
 * Índice da próxima fonte quando o elemento dispara `error` (preload/troca de fonte falhou).
 * - Ainda há candidato à frente → avança.
 * - Já no último E o usuário está esperando tocar (janela do clique aberta) e há mais de uma fonte →
 *   volta ao início para fechar o ciclo (senão o player ficava parado no candidato ruim).
 * - Caso contrário (fora de um pedido do usuário) → fica onde está, sem rede em segundo plano.
 */
export function nextSourceIndexOnError({ sourceIdx, sourceCount, autoWindowOpen }) {
  const idx = Number(sourceIdx) || 0;
  const count = Number(sourceCount) || 0;
  if (idx + 1 < count) return idx + 1;
  if (autoWindowOpen && count > 1) return 0;
  return idx;
}

/**
 * Teto de tentativas automáticas: chegou aqui significa que o usuário pediu para tocar e as fontes
 * já deram uma volta completa. Único ponto seguro para declarar "indisponível agora".
 */
export function shouldGiveUpOnError({ tentativas, sourceCount }) {
  return (Number(tentativas) || 0) > (Number(sourceCount) || 0);
}

/**
 * Plano de recarregamento quando `play()` REJEITA (clique falhou). Percorre os candidatos dentro do
 * mesmo clique; na fonte única, força reload por nonce.
 * Retorna { type: 'advance'|'reset'|'nonce', sourceIdx? }.
 */
export function planReloadOnPlayFailure({ sourceIdx, sourceCount }) {
  const idx = Number(sourceIdx) || 0;
  const count = Number(sourceCount) || 0;
  if (idx + 1 < count) return { type: "advance", sourceIdx: idx + 1 };
  if (idx !== 0) return { type: "reset", sourceIdx: 0 };
  return { type: "nonce" };
}

/**
 * Classifica o que fazer quando o vigia de stall dispara (play() resolveu mas o tempo não anda e
 * nenhum `error` veio).
 * - Pausado/terminado/buscando, ou o tempo já andou → 'noop' (falso alarme).
 * - Já recuperamos uma vez nesta fonte e continua parado → 'giveup' (marca indisponível).
 * - Primeira vez → 'recover'.
 */
export function classifyStallRecovery({ paused, ended, seeking, progressed, alreadyRecovered }) {
  if (paused || ended || seeking || progressed) return "noop";
  if (alreadyRecovered) return "giveup";
  return "recover";
}

/**
 * Plano de recarregamento na recuperação de stall. Diferente do play-failure: NÃO tem o ramo
 * "reset para 0" — só avança se houver próxima fonte, senão recarrega a atual por nonce.
 * Retorna { type: 'advance'|'nonce', sourceIdx? }.
 */
export function planReloadOnStall({ sourceIdx, sourceCount }) {
  const idx = Number(sourceIdx) || 0;
  const count = Number(sourceCount) || 0;
  if (idx + 1 < count) return { type: "advance", sourceIdx: idx + 1 };
  return { type: "nonce" };
}

/**
 * Decide se, ao despausar (`toggle` com `el.paused`), é preciso um `load()` antes do `play()`.
 * O mobile libera o buffer decodificado de um `<audio>` pausado/em segundo plano: o elemento
 * mantém `readyState >= 1` (metadados) mas não tem dado tocável na posição atual, e o `play()`
 * então trava mudo em vez de errar. `readyState === 0` já era coberto; aqui acrescentamos o caso
 * do buffer liberado NO MEIO da faixa (posição > 0 sem range que a cubra), preservando a posição.
 * readyState (HTML): 0 NOTHING, 1 METADATA, 2 CURRENT_DATA, 3 FUTURE_DATA, 4 ENOUGH_DATA.
 * Não força reload no início (posição 0): ali o `play()` já dispara o fetch como sempre — evita
 * recarregar à toa o primeiro play.
 */
export function needsReloadBeforeResume({ hasError, readyState, positionCovered, currentTime }) {
  if (hasError) return true;
  const rs = Number(readyState) || 0;
  if (rs === 0) return true; // HAVE_NOTHING
  if (rs >= 3) return false; // HAVE_FUTURE_DATA+: pode tocar à frente, não mexe
  if ((Number(currentTime) || 0) > 0 && !positionCovered) return true; // buffer liberado no meio
  return false;
}
