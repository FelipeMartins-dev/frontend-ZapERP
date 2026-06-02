/**
 * Tempo de espera na lista de conversas: minutos até 59; a partir de 60, em horas inteiras.
 */
export function formatEsperaDuracaoFromMinutes(mins, opts = {}) {
  const { format = "default", wordUnit = false } = opts;
  const m = Number.isFinite(mins) ? Math.max(0, Math.floor(mins)) : 0;

  if (m < 60) {
    if (format === "hud") {
      return m < 1 ? "• <1m" : `• ${m}m`;
    }
    if (m < 1) return wordUnit ? "< 1 min" : "<1m";
    return wordUnit ? `${m}\u00a0min` : `${m}m`;
  }

  const h = Math.floor(m / 60);
  if (format === "hud") return `• ${h}h`;
  return wordUnit ? `${h}\u00a0h` : `${h}h`;
}

export function formatEsperaDuracaoTooltip(mins, date) {
  const m = Number.isFinite(mins) ? Math.max(0, Math.floor(mins)) : 0;
  const unit = m >= 60 ? `${Math.floor(m / 60)} h` : `${m} min`;
  const desde = date instanceof Date && !Number.isNaN(date.getTime())
    ? date.toLocaleString("pt-BR")
    : "";
  return desde ? `${unit} — desde ${desde}` : unit;
}
