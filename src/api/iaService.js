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

export async function getAlertaSemRespostaConfig() {
  const { data } = await api.get('/config/alerta-sem-resposta')
  return data || {}
}

export async function putAlertaSemRespostaConfig(payload) {
  const { data } = await api.put('/config/alerta-sem-resposta', payload)
  return data?.config || data || {}
}

export async function getAlertaSemRespostaEventos(params = {}) {
  const { data } = await api.get('/config/alerta-sem-resposta/eventos', { params })
  return data?.eventos || []
}

export async function processarAlertaSemResposta(dryRun = true) {
  const { data } = await api.post('/config/alerta-sem-resposta/processar', { dry_run: dryRun })
  return data
}
