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

function isAlertaSemRespostaUnavailable(err) {
  return err?.response?.status === 404
}

export async function getAlertaSemRespostaConfig() {
  try {
    const { data } = await api.get('/config/alerta-sem-resposta', { silent: true })
    return data || {}
  } catch (err) {
    if (isAlertaSemRespostaUnavailable(err)) return null
    throw err
  }
}

export async function putAlertaSemRespostaConfig(payload) {
  try {
    const { data } = await api.put('/config/alerta-sem-resposta', payload, { silent: true })
    return data?.config || data || {}
  } catch (err) {
    if (isAlertaSemRespostaUnavailable(err)) {
      const e = new Error('Recurso de alertas de atendimento indisponivel no servidor.')
      e.code = 'ALERTA_SEM_RESPOSTA_UNAVAILABLE'
      throw e
    }
    throw err
  }
}

export async function getAlertaSemRespostaEventos(params = {}) {
  try {
    const { data } = await api.get('/config/alerta-sem-resposta/eventos', { params, silent: true })
    return data?.eventos || []
  } catch (err) {
    if (isAlertaSemRespostaUnavailable(err)) return []
    throw err
  }
}

export async function processarAlertaSemResposta(dryRun = true) {
  try {
    const { data } = await api.post('/config/alerta-sem-resposta/processar', { dry_run: dryRun }, { silent: true })
    return data
  } catch (err) {
    if (isAlertaSemRespostaUnavailable(err)) {
      const e = new Error('Recurso de alertas de atendimento indisponivel no servidor.')
      e.code = 'ALERTA_SEM_RESPOSTA_UNAVAILABLE'
      throw e
    }
    throw err
  }
}
