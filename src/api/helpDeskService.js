import api from './http'

const BASE = '/api/helpdesk'

export function helpDeskApiError(error) {
  return error?.response?.data?.error || error?.message || 'Erro ao comunicar com o servidor.'
}

export async function listTickets(params = {}) {
  const { data } = await api.get(`${BASE}/tickets`, { params })
  return data
}

export async function getTicket(id) {
  const { data } = await api.get(`${BASE}/tickets/${id}`)
  return data
}

export async function updateTicket(id, payload) {
  const { data } = await api.patch(`${BASE}/tickets/${id}`, payload)
  return data
}

export async function createTicket(payload) {
  const { data } = await api.post(`${BASE}/tickets`, payload)
  return data
}

export async function addTicketMessage(id, payload) {
  const { data } = await api.post(`${BASE}/tickets/${id}/messages`, payload)
  return data
}

export async function transferTicket(id, payload) {
  const { data } = await api.post(`${BASE}/tickets/${id}/transfer`, payload)
  return data
}

export async function assumeTicket(id) {
  const { data } = await api.post(`${BASE}/tickets/${id}/assume`)
  return data
}
