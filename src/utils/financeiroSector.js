import { isNomeSetorFinanceiro } from './financeiroSectorShared'

export { isNomeSetorFinanceiro }

/** IDs de departamentos do usuário (JWT / perfil). */
export function getUserDepartamentoIds(user) {
  if (!user) return []
  if (Array.isArray(user.departamento_ids) && user.departamento_ids.length > 0) {
    return user.departamento_ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
  }
  if (user.departamento_id != null) {
    const n = Number(user.departamento_id)
    return Number.isFinite(n) && n > 0 ? [n] : []
  }
  return []
}

/**
 * Usuário pertence ao setor Financeiro (qualquer dept com nome Financeiro).
 * @param {object} user
 * @param {Array<{id:number,nome:string}>} [departamentosLista] — cache da lista (Config / filtros)
 */
export function isUsuarioSetorFinanceiro(user, departamentosLista = []) {
  const ids = getUserDepartamentoIds(user)
  if (ids.length === 0) return false

  const deptList = Array.isArray(departamentosLista) ? departamentosLista : []
  const financeiroIds = new Set(
    deptList.filter((d) => isNomeSetorFinanceiro(d?.nome)).map((d) => String(d.id))
  )
  if (financeiroIds.size === 0) return false

  return ids.some((id) => financeiroIds.has(String(id)))
}

/** Conversa está em departamento Financeiro. */
export function isConversaSetorFinanceiro(conversa, departamentosLista = []) {
  const depId = conversa?.departamento_id ?? null
  if (depId == null) return false
  const deptList = Array.isArray(departamentosLista) ? departamentosLista : []
  const dep = deptList.find((d) => String(d.id) === String(depId))
  if (dep) return isNomeSetorFinanceiro(dep.nome)
  const nomeInline =
    conversa?.setor ||
    conversa?.departamentos?.nome ||
    conversa?.departamento?.nome ||
    ''
  return isNomeSetorFinanceiro(nomeInline)
}

/**
 * Botão/filtros de cobrança: qualquer atendente vinculado ao departamento "Financeiro".
 * (Não exige a conversa já estar no setor — conversa "Sem setor" pode receber o fluxo.)
 */
export function isAtendenteSetorFinanceiro(user, departamentosLista = []) {
  return isUsuarioSetorFinanceiro(user, departamentosLista)
}

/** Atendentes do Financeiro podem aguardar pagamento em qualquer conversa individual. */
export function podeUsarFluxoCobrancaFinanceira(user, _conversa, departamentosLista = []) {
  return isUsuarioSetorFinanceiro(user, departamentosLista)
}
