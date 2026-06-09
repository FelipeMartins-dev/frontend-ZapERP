import api from './http'

export async function getConfig() {
  const { data } = await api.get('/ia/config')
  return data
}

export async function putConfig(config) {
  const { data } = await api.put('/ia/config', config)
  return data
}

export async function testarAdminAtendimentoAlerta() {
  const { data } = await api.post('/ia/admin-atendimento-alerta/testar')
  return data
}

export async function getRegras() {
  const { data } = await api.get('/ia/regras')
  return data || []
}

export async function postRegra(payload) {
  const { data } = await api.post('/ia/regras', payload)
  return data
}

export async function putRegra(id, payload) {
  const { data } = await api.put(`/ia/regras/${id}`, payload)
  return data
}

export async function deleteRegra(id) {
  await api.delete(`/ia/regras/${id}`)
}

export async function getLogs(limit = 50) {
  const { data } = await api.get('/ia/logs', { params: { limit } })
  return data || []
}

const ALERTA_SEM_RESPOSTA_UNAVAILABLE_KEY = 'zap_erp_alerta_sem_resposta_unavailable'

function isAlertaSemRespostaUnavailable(err) {
  return err?.response?.status === 404
}

function isAlertaSemRespostaEventosSoftFail(err) {
  const status = err?.response?.status
  const msg = String(err?.response?.data?.error || err?.message || '').toLowerCase()
  return status === 500 && msg.includes('permission denied')
}

function markAlertaSemRespostaUnavailable() {
  try {
    sessionStorage.setItem(ALERTA_SEM_RESPOSTA_UNAVAILABLE_KEY, '1')
  } catch (_) {
    /* ignore */
  }
}

function isAlertaSemRespostaMarkedUnavailable() {
  try {
    return sessionStorage.getItem(ALERTA_SEM_RESPOSTA_UNAVAILABLE_KEY) === '1'
  } catch (_) {
    return false
  }
}

function throwAlertaSemRespostaUnavailable() {
  const e = new Error('Recurso de alertas de atendimento indisponivel no servidor.')
  e.code = 'ALERTA_SEM_RESPOSTA_UNAVAILABLE'
  throw e
}

/** Evita chamadas repetidas quando o backend ainda nao publicou as rotas /config/alerta-sem-resposta. */
export function isAlertaSemRespostaApiEnabled() {
  const raw = String(import.meta.env.VITE_ALERTA_SEM_RESPOSTA_ENABLED ?? '').trim().toLowerCase()
  if (raw === '0' || raw === 'false' || raw === 'off') return false
  return !isAlertaSemRespostaMarkedUnavailable()
}

export async function getAlertaSemRespostaConfig() {
  if (!isAlertaSemRespostaApiEnabled()) return null
  try {
    const { data } = await api.get('/config/alerta-sem-resposta', { silent: true })
    return data || {}
  } catch (err) {
    if (isAlertaSemRespostaUnavailable(err)) {
      markAlertaSemRespostaUnavailable()
      return null
    }
    throw err
  }
}

export async function putAlertaSemRespostaConfig(payload) {
  if (!isAlertaSemRespostaApiEnabled()) throwAlertaSemRespostaUnavailable()
  try {
    const { data } = await api.put('/config/alerta-sem-resposta', payload, { silent: true })
    return data?.config || data || {}
  } catch (err) {
    if (isAlertaSemRespostaUnavailable(err)) {
      markAlertaSemRespostaUnavailable()
      throwAlertaSemRespostaUnavailable()
    }
    throw err
  }
}

export async function getAlertaSemRespostaEventos(params = {}) {
  if (!isAlertaSemRespostaApiEnabled()) return []
  try {
    const { data } = await api.get('/config/alerta-sem-resposta/eventos', { params, silent: true })
    return data?.eventos || []
  } catch (err) {
    if (isAlertaSemRespostaUnavailable(err)) {
      markAlertaSemRespostaUnavailable()
      return []
    }
    if (isAlertaSemRespostaEventosSoftFail(err)) return []
    throw err
  }
}

export async function processarAlertaSemResposta(dryRun = true) {
  if (!isAlertaSemRespostaApiEnabled()) throwAlertaSemRespostaUnavailable()
  try {
    const { data } = await api.post('/config/alerta-sem-resposta/processar', { dry_run: dryRun }, { silent: true })
    return data
  } catch (err) {
    if (isAlertaSemRespostaUnavailable(err)) {
      markAlertaSemRespostaUnavailable()
      throwAlertaSemRespostaUnavailable()
    }
    throw err
  }
}
