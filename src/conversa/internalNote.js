/**
 * Nota interna ("mensagem invisível") — referência única no frontend.
 * Espelha backend/helpers/internalNote.js. O backend é a fonte de verdade:
 * estas constantes existem só para identificar a linha e renderizá-la.
 */

export const INTERNAL_NOTE_TIPO = "internal_note";
export const INTERNAL_NOTE_DIRECAO = "interna";
export const INTERNAL_NOTE_MAX_LEN = 4000;

/** Verdadeiro para qualquer mensagem/payload que represente uma nota interna. */
export function isInternalNote(msg) {
  if (!msg || typeof msg !== "object") return false;
  if (String(msg.tipo || "").toLowerCase() === INTERNAL_NOTE_TIPO) return true;
  return String(msg.direcao || "").toLowerCase() === INTERNAL_NOTE_DIRECAO;
}
