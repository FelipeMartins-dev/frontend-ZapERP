import api from "./http";

/**
 * @typedef {Object} SupervisaoResumoPayload
 * @property {number=} atendimentos_abertos
 * @property {number=} aguardando_funcionario
 * @property {number=} atrasados
 * @property {number=} cards.atrasados_30min
 * @property {number=} tempo_medio_resposta_minutos
 * @property {number=} sla_minutos
 */

export async function getResumoSupervisao(options = {}) {
  const { data } = await api.get("/api/supervisao/resumo", {
    silent: options.silent === true,
    skipGlobal500Toast: true,
  });
  return data ?? {};
}

export async function getClientesPendentesSupervisao(options = {}) {
  const { data } = await api.get("/api/supervisao/clientes-pendentes", {
    silent: options.silent === true,
    skipGlobal500Toast: true,
  });
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.clientes)) return data.clientes;
  return [];
}

export async function getMovimentacaoFuncionarioSupervisao(usuarioId) {
  const { data } = await api.get(`/api/supervisao/funcionarios/${usuarioId}/movimentacao`);
  return data ?? {};
}

export async function getRelatorioDiarioSupervisao(data, options = {}) {
  const params = data ? { data } : undefined;
  const response = await api.get("/api/supervisao/relatorio-diario", {
    params,
    silent: options.silent === true,
    skipGlobal500Toast: true,
  });
  return response?.data ?? {};
}
