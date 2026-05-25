function endOfLocalDay(date) {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d
}

/**
 * Espelha `calcularPagamentoPrazoAte` do backend (otimista na lista antes do POST).
 * @param {string} prazo — hoje | amanha | 4h | data
 * @param {string} [dataIso] — YYYY-MM-DD quando prazo=data
 * @returns {string|null} ISO
 */
export function calcularPagamentoPrazoAteIso(prazo, dataIso) {
  const key = String(prazo || '').trim().toLowerCase()
  const now = new Date()
  let ate = null

  if (key === '4h') {
    ate = new Date(now.getTime() + 4 * 60 * 60 * 1000)
  } else if (key === 'hoje') {
    ate = endOfLocalDay(now)
  } else if (key === 'amanha') {
    const amanha = new Date(now)
    amanha.setDate(amanha.getDate() + 1)
    ate = endOfLocalDay(amanha)
  } else if (key === 'data') {
    const raw = String(dataIso || '').trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const parsed = new Date(`${raw}T12:00:00`)
      if (!Number.isNaN(parsed.getTime())) ate = endOfLocalDay(parsed)
    }
  }

  if (!ate || Number.isNaN(ate.getTime())) return null
  return ate.toISOString()
}

/**
 * Patch otimista para lista + conversa aberta ao clicar em Aguardar pagamento.
 * @param {number|string} conversaId
 * @param {{ prazo?: string, data?: string }} prazoOpts
 */
export function buildPatchAguardandoPagamentoOptimista(conversaId, prazoOpts) {
  const prazoNorm = String(prazoOpts?.prazo || '').trim().toLowerCase()
  const ateIso = calcularPagamentoPrazoAteIso(prazoNorm, prazoOpts?.data)
  if (!ateIso) return null
  return {
    id: conversaId,
    status_atendimento: 'pagamento_pendente',
    status_atendimento_real: 'pagamento_pendente',
    pagamento_prazo_ate: ateIso,
    pagamento_prazo_origem: prazoNorm,
    aguardando_cliente_desde: null,
    pagamento_concluido_em: null,
    exibir_badge_aberta: false,
  }
}

/**
 * Rótulo compacto do prazo de pagamento para badges (ex.: 4h, 5h, 1dia).
 * Baseado no tempo restante até `pagamento_prazo_ate`, com atalhos por origem.
 *
 * @param {string|Date|null|undefined} prazoAteIso
 * @param {string} [prazoOrigem] — hoje | amanha | 4h | data
 * @param {number} [nowMs]
 * @returns {string|null}
 */
export function formatPrazoPagamentoCompacto(prazoAteIso, prazoOrigem, nowMs = Date.now()) {
  const orig = String(prazoOrigem || '').trim().toLowerCase()
  const ateMs = prazoAteIso ? new Date(prazoAteIso).getTime() : NaN

  if (orig === '4h') {
    if (!Number.isFinite(ateMs)) return '4h'
    const diff = ateMs - nowMs
    if (diff <= 0) return null
    const h = Math.max(1, Math.ceil(diff / 3600000))
    return `${h}h`
  }

  if (orig === 'amanha' && Number.isFinite(ateMs)) {
    const diff = ateMs - nowMs
    if (diff <= 0) return null
    if (diff >= 20 * 3600000) return '1dia'
    return formatRemainingMs(diff)
  }

  if (!Number.isFinite(ateMs)) {
    if (orig === 'hoje') return 'hoje'
    if (orig === 'amanha') return '1dia'
    return null
  }

  const diff = ateMs - nowMs
  if (diff <= 0) return null
  return formatRemainingMs(diff)
}

/** @param {number} ms */
function formatRemainingMs(ms) {
  const min = Math.ceil(ms / 60000)
  if (min < 60) return `${min}min`
  const h = Math.ceil(ms / 3600000)
  if (h < 24) return `${h}h`
  const d = Math.ceil(ms / 86400000)
  if (d === 1) return '1dia'
  return `${d}d`
}

/**
 * Texto completo para title/aria (data/hora do prazo).
 * @param {string|Date|null|undefined} prazoAteIso
 */
export function formatPrazoPagamentoTooltip(prazoAteIso) {
  if (!prazoAteIso) return ''
  const d = new Date(prazoAteIso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}
