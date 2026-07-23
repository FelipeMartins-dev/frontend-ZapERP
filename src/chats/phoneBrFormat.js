/** Formatação leve BR para exibição enquanto digita (máscara opcional). */
const MAX_DIGITS = 13;

export function digitsOnly(v) {
  return String(v || "").replace(/\D/g, "");
}

/** Limita a 13 dígitos (55 + DDD + celular 9 ou fixo 8). */
export function formatBrPhoneDisplay(raw) {
  const d = digitsOnly(raw).slice(0, MAX_DIGITS);
  if (!d) return "";

  if (d.startsWith("55")) {
    const r = d.slice(2);
    if (r.length === 0) return "+55";
    let out = "+55 (";
    out += r.slice(0, 2);
    if (r.length <= 2) {
      return out + (r.length === 2 ? ") " : "");
    }
    const n = r.slice(2);
    out += ") ";
    if (n.length <= 8) {
      if (n.length <= 4) return out + n;
      return `${out}${n.slice(0, 4)}-${n.slice(4)}`;
    }
    return `${out}${n.slice(0, 5)}-${n.slice(5, 9)}`;
  }

  const dd = d.slice(0, 2);
  const n = d.slice(2);
  let out = "(" + dd;
  if (d.length >= 2) out += ")";
  if (n.length === 0) return out;
  out += " ";
  if (n.length <= 8) {
    if (n.length <= 4) return out + n;
    return `${out}${n.slice(0, 4)}-${n.slice(4)}`;
  }
  return `${out}${n.slice(0, 5)}-${n.slice(5, 9)}`;
}

/** Validação leve antes do POST: vazio bloqueado no cliente; formato plausível BR. */
export function isPlausibleBrPhoneDigits(d) {
  if (!d || d.length < 10) return false;
  if (d.startsWith("55")) {
    return d.length >= 12 && d.length <= 13;
  }
  return d.length >= 10 && d.length <= 11;
}

export function normalizeBrPhoneForSubmit(raw) {
  const d = digitsOnly(raw);
  if (!isPlausibleBrPhoneDigits(d)) return "";
  return d.startsWith("55") ? d : `55${d}`;
}

export const AJUDA_TELEFONE_PADRAO =
  "Número brasileiro com DDD: 10 ou 11 dígitos (fixo ou celular), com ou sem o código 55. Máscaras e espaços são aceitos.";

export const EXEMPLO_TELEFONE_PADRAO = "Ex.: (11) 98765-4321 ou +55 11 98765-4321";
