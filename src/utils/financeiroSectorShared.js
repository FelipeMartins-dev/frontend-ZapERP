/** Compartilhado front/back (lógica espelhada no helper Node). */
export function normalizarNomeSetor(nome) {
  return String(nome || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

export function isNomeSetorFinanceiro(nome) {
  return normalizarNomeSetor(nome) === 'financeiro'
}
