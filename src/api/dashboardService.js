import api from './http'

export async function getOverview(params = {}) {
  const { data } = await api.get('/dashboard/overview', { params })
  return data
}

export async function getDepartamentos() {
  const { data } = await api.get('/dashboard/departamentos')
  return data || []
}

export async function getRespostasSalvas(departamentoId = null) {
  const params = departamentoId ? { departamento_id: departamentoId } : {}
  const { data } = await api.get('/dashboard/respostas-salvas', { params })
  return data || []
}

export async function criarRespostaSalva(payload) {
  const { data } = await api.post('/dashboard/respostas-salvas', payload)
  return data
}

export async function getRelatorioConversas(params = {}) {
  const { data } = await api.get('/dashboard/relatorios/conversas', { params })
  return data || []
}

export async function getRelatorioMensagens(params = {}) {
  const { data } = await api.get('/dashboard/relatorios/mensagens', { params })
  return data || []
}

/** Faz download do arquivo (CSV, Excel ou PDF). Retorna nome do arquivo sugerido. */
export async function exportRelatorio(format, params = {}) {
  const f = (format || 'csv').toLowerCase()
  const { data } = await api.get('/dashboard/relatorios/export', {
    params: { ...params, format: f === 'excel' ? 'xlsx' : f },
    responseType: 'blob',
  })
  const ext = f === 'xlsx' || f === 'excel' ? 'xlsx' : f === 'pdf' ? 'pdf' : 'csv'
  const filename = `relatorio-conversas.${ext}`
  const url = URL.createObjectURL(new Blob([data]))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
  return filename
}

export async function getSlaConfig() {
  const { data } = await api.get('/dashboard/sla/config')
  return data
}

export async function setSlaConfig(payload) {
  const body = typeof payload === 'number' || typeof payload === 'string'
    ? { sla_minutos_sem_resposta: Number(payload) || 30 }
    : payload
  const { data } = await api.put('/dashboard/sla/config', body)
  return data
}

export async function getSlaAlertas() {
  const { data } = await api.get('/dashboard/sla/alertas')
  return data || { limite_min: 30, alertas: [] }
}

export async function getSlaResumo(params = {}) {
  const { data } = await api.get('/dashboard/sla/resumo', { params })
  return data || null
}

export async function getSlaDiaria(params = {}) {
  const { data } = await api.get('/dashboard/sla/diaria', { params })
  return data || null
}

export async function validateSlaConversa(conversaId) {
  const { data } = await api.get(`/dashboard/sla/validacao/${conversaId}`)
  return data
}

/** Exporta SLA (csv/xlsx) com os mesmos filtros da tela */
export async function exportSla(format = 'csv', params = {}, tipo = 'detalhado') {
  const f = (format || 'csv').toLowerCase()
  const { data } = await api.get('/dashboard/sla/export', {
    params: { ...params, format: f === 'excel' ? 'xlsx' : f, tipo },
    responseType: 'blob',
  })
  const ext = f === 'xlsx' || f === 'excel' ? 'xlsx' : 'csv'
  const filename = `sla-${tipo}.${ext}`
  const url = URL.createObjectURL(new Blob([data]))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
  return filename
}

/** Lista atendentes (para filtros de relatório) */
export async function getUsuarios() {
  const { data } = await api.get('/usuarios')
  return data || []
}
