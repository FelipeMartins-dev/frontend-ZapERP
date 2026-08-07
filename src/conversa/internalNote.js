export const INTERNAL_NOTE_TIPO = "internal_note";
export const INTERNAL_NOTE_DIRECAO = "interna";
export const INTERNAL_NOTE_MAX_LEN = 4000;

/**
 * Retorna true se a mensagem é uma nota interna.
 * Aceita tanto o objeto do banco quanto o objeto enriquecido.
 */
export function isInternalNote(msg) {
  if (!msg || typeof msg !== "object") return false;
  return (
    String(msg.tipo || "").toLowerCase() === INTERNAL_NOTE_TIPO ||
    String(msg.direcao || "").toLowerCase() === INTERNAL_NOTE_DIRECAO ||
    String(msg.status || "").toLowerCase() === INTERNAL_NOTE_DIRECAO
  );
}
