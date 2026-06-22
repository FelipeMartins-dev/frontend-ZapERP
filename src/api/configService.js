import api from './http'

export async function getEmpresa() {
  const { data } = await api.get('/config/empresa')
  return data
}

export async function putEmpresa(payload) {
  const { data } = await api.put('/config/empresa', payload)
  return data
}

export async function uploadLogoEmpresa(file) {
  const formData = new FormData()
  formData.append('logo', file)
  const { data } = await api.post('/config/empresa/logo', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

export async function deleteLogoEmpresa() {
  const { data } = await api.delete('/config/empresa/logo')
  return data
}

export async function getPlanos() {
  const { data } = await api.get('/config/planos')
  return data || []
}

export async function getAuditoria(limit = 100) {
  const { data } = await api.get('/config/auditoria', { params: { limit } })
  return data || []
}

// Auditoria (registrar ação) — se o backend suportar.
export async function registrarAuditoria(payload) {
  const { data } = await api.post('/config/auditoria', payload)
  return data
}

// Usuário logado (perfil)
export async function getUsuarioMe(config = {}) {
  const { data } = await api.get('/usuarios/me', { skipAuthLogout: true, ...config })
  return data
}

export async function patchUsuarioMe(payload) {
  const { data } = await api.patch('/usuarios/me', payload)
  return data
}

// Usuários (admin)
export async function getUsuarios() {
  const { data } = await api.get('/usuarios')
  return data || []
}

export async function criarUsuario(payload) {
  const { data } = await api.post('/usuarios', payload)
  return data
}

export async function atualizarUsuario(id, payload) {
  const { data } = await api.put(`/usuarios/${id}`, payload)
  return data
}

export async function redefinirSenha(id, nova_senha) {
  await api.post(`/usuarios/${id}/redefinir-senha`, { nova_senha })
}

export async function excluirUsuario(id) {
  await api.delete(`/usuarios/${id}`)
}

// Departamentos
export async function getDepartamentos() {
  const { data } = await api.get('/dashboard/departamentos')
  return data || []
}

export async function criarDepartamento(nome) {
  const { data } = await api.post('/dashboard/departamentos', { nome })
  return data
}

export async function atualizarDepartamento(id, nome) {
  const { data } = await api.put(`/dashboard/departamentos/${id}`, { nome })
  return data
}

export async function excluirDepartamento(id) {
  await api.delete(`/dashboard/departamentos/${id}`)
}

export async function getDepartamentoGrupos(id) {
  const { data } = await api.get(`/dashboard/departamentos/${id}/grupos`)
  return data || { grupos: [] }
}

export async function atualizarDepartamentoGrupos(id, conversa_ids) {
  const { data } = await api.put(`/dashboard/departamentos/${id}/grupos`, { conversa_ids })
  return data
}

// Tags
export async function getTags() {
  const { data } = await api.get('/tags')
  return Array.isArray(data) ? data : (data?.tags || [])
}

export async function criarTag(nome, cor) {
  const { data } = await api.post('/tags', { nome, cor })
  return data?.tag || data
}

export async function atualizarTag(id, nome, cor) {
  const { data } = await api.put(`/tags/${id}`, { nome, cor })
  return data?.tag || data
}

export async function excluirTag(id) {
  await api.delete(`/tags/${id}`)
}

// Respostas salvas
export async function getRespostasSalvas(departamentoId, { contexto } = {}) {
  const params = {}
  if (departamentoId) params.departamento_id = departamentoId
  if (contexto) params.contexto = contexto
  const { data } = await api.get('/dashboard/respostas-salvas', { params })
  return data || []
}

export async function criarRespostaSalva(payload) {
  const { data } = await api.post('/dashboard/respostas-salvas', payload)
  return data
}

export async function atualizarRespostaSalva(id, payload) {
  const { data } = await api.put(`/dashboard/respostas-salvas/${id}`, payload)
  return data
}

export async function excluirRespostaSalva(id) {
  await api.delete(`/dashboard/respostas-salvas/${id}`)
}

// Multi-tenant WhatsApp (phone_number_id → company)
export async function getEmpresasWhatsapp() {
  const { data } = await api.get('/config/empresas-whatsapp', { skipGlobal500Toast: true })
  return data || []
}

export async function addEmpresaWhatsapp(payload) {
  const { data } = await api.post('/config/empresas-whatsapp', payload)
  return data
}

export async function removeEmpresaWhatsapp(id) {
  await api.delete(`/config/empresas-whatsapp/${id}`)
}

// Clientes (conectado à tabela clientes do banco)
export async function getClientes(params = {}) {
  const { data } = await api.get('/clientes', { params })
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.clientes)) return data.clientes
  if (Array.isArray(data?.items)) return data.items
  if (Array.isArray(data?.data)) return data.data
  return []
}

export async function getClientesComTotal(params = {}) {
  const response = await api.get('/clientes', { params })
  const data = Array.isArray(response?.data) ? response.data : []
  const rawTotal =
    response?.headers?.["x-total-count"] ??
    response?.headers?.["X-Total-Count"] ??
    response?.headers?.["x_total_count"] ??
    null
  const parsedTotal = Number(rawTotal)

  return {
    clientes: data,
    total: Number.isFinite(parsedTotal) ? parsedTotal : data.length,
  }
}

// Cliente por ID (quando o backend disponibiliza /clientes/:id).
// Mantém fallback no caller caso o endpoint não exista.
export async function getCliente(id) {
  const { data } = await api.get(`/clientes/${id}`)
  return data
}

/**
 * POST /clientes — cadastro de cliente; aceita flags opcionais `abrir_conversa` e `assumir`.
 * @param {import('./clientes.types').CriarClientePayload} payload
 * @returns {Promise<import('./clientes.types').CriarClienteResponse>}
 */
export async function criarCliente(payload) {
  const { data } = await api.post('/clientes', payload)
  return data
}

export async function atualizarCliente(id, payload) {
  const { data } = await api.put(`/clientes/${id}`, payload)
  return data
}

export async function excluirCliente(id) {
  await api.delete(`/clientes/${id}`)
}

/** Apaga todos os clientes da empresa (conversas mantidas, cliente_id=null) */
export async function excluirTodosClientes() {
  const { data } = await api.delete('/clientes/todos')
  return data
}

// Tags do cliente
export async function getClienteTags(clienteId) {
  const { data } = await api.get(`/clientes/${clienteId}/tags`)
  return data || []
}

export async function addClienteTag(clienteId, tagId) {
  const { data } = await api.post(`/clientes/${clienteId}/tags`, { tagId })
  return data
}

export async function removeClienteTag(clienteId, tagId) {
  const { data } = await api.delete(`/clientes/${clienteId}/tags/${tagId}`)
  return data
}

// Operacional - configurações e auditoria
export async function getOperacional() {
  const { data } = await api.get('/config/operacional')
  return data
}

export async function putOperacional(payload) {
  const { data } = await api.put('/config/operacional', payload)
  return data
}

export async function getAuditoriaEventos(params = {}) {
  const { data } = await api.get('/config/auditoria-eventos', { params })
  return data?.eventos || []
}

// Operacional - Jobs
export async function getJobs(status) {
  const { data } = await api.get('/jobs', { params: status ? { status } : {} })
  return data?.jobs || []
}

export async function postJobSyncContatos() {
  const { data } = await api.post('/jobs/sync-contatos')
  return data
}

export async function postJobSyncFotos() {
  const { data } = await api.post('/jobs/sync-fotos')
  return data
}

export async function retryJob(id) {
  await api.post(`/jobs/${id}/retry`)
}

export async function pauseAllJobs() {
  await api.post('/jobs/pause-all')
}

export async function resumeAllJobs() {
  await api.post('/jobs/resume-all')
}
