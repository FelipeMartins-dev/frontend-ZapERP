import { useMemo } from "react";
import { getAguardandoFuncionarioVisualState } from "../chatListCounts";

const EMPTY_COUNTS = {
  total: 0,
  minha_fila: 0,
  hoje: 0,
  abertas: 0,
  em_atendimento: 0,
  finalizadas: 0,
  por_ausencia: 0,
  aguardando_cliente: 0,
  aguardando_atendente: 0,
  pagamentos_pendentes: 0,
  em_atraso: 0,
  mensagens_disparadas: 0,
};

/**
 * Contadores dos chips/KPIs — prioriza GET /chats/counts (totais reais no backend).
 */
export function useChatListCounts({
  chatFilterCounts,
  supervisaoResumo,
  pendentesFuncionarioIds,
  separarMensagensDisparadasLigado,
}) {
  const counts = chatFilterCounts || EMPTY_COUNTS;

  const total = Number(counts.total) || 0;
  const countHoje = Number(counts.hoje) || 0;
  const countAbertas = Number(counts.abertas) || 0;
  const countEmAtendimento = Number(counts.em_atendimento) || 0;
  const countFinalizadas = Number(counts.finalizadas) || 0;
  const countFinalizadasAuto = Number(counts.por_ausencia) || 0;
  const countAguardandoCliente = Number(counts.aguardando_cliente) || 0;
  const countAguardandoAtendente = Number(counts.aguardando_atendente) || 0;
  const countPagamentosPendentes = Number(counts.pagamentos_pendentes) || 0;
  const countEmAtraso = Number(counts.em_atraso) || 0;
  const mensagensDisparadasCount = separarMensagensDisparadasLigado
    ? Number(counts.mensagens_disparadas) || 0
    : 0;
  const minhaFilaCount = Number(counts.minha_fila) || 0;

  const countAguardandoFuncionario = useMemo(
    () =>
      Number(
        supervisaoResumo?.aguardando_funcionario ??
          supervisaoResumo?.aguardandoFuncionario ??
          (pendentesFuncionarioIds || []).length
      ) || 0,
    [supervisaoResumo, pendentesFuncionarioIds]
  );

  const aguardandoFuncionarioVisualState = getAguardandoFuncionarioVisualState(
    countAguardandoFuncionario
  );

  return {
    minhaFilaCount,
    total,
    countHoje,
    countAbertas,
    countEmAtendimento,
    countFinalizadas,
    countFinalizadasAuto,
    countAguardandoCliente,
    countAguardandoAtendente,
    countPagamentosPendentes,
    countEmAtraso,
    countAguardandoFuncionario,
    mensagensDisparadasCount,
    aguardandoFuncionarioVisualState,
  };
}

/** Total real do filtro ativo (hint "X de Y"). */
export function getActiveFilterTotalCount({
  tab,
  counts,
  activeListTotalCount,
  adminPorFuncionarioAtivo,
  countAguardandoFuncionario,
}) {
  if (adminPorFuncionarioAtivo) return null;

  const fromList =
    activeListTotalCount != null && Number.isFinite(Number(activeListTotalCount))
      ? Math.max(0, Math.floor(Number(activeListTotalCount)))
      : null;

  // Prioriza o total da query ativa (header X-Chat-List-Total-Count) — reflete busca, status e aba exatos.
  if (fromList != null) return fromList;

  const c = counts || EMPTY_COUNTS;
  const byTab = {
    minha_fila: Number(c.minha_fila) || 0,
    todas: Number(c.total) || 0,
    hoje: Number(c.hoje) || 0,
    abertas: Number(c.abertas) || 0,
    em_atendimento: Number(c.em_atendimento) || 0,
    finalizadas: Number(c.finalizadas) || 0,
    finalizadas_auto: Number(c.por_ausencia) || 0,
    aguardando_cliente: Number(c.aguardando_cliente) || 0,
    aguardando_atendente: Number(c.aguardando_atendente) || 0,
    pagamentos_pendentes: Number(c.pagamentos_pendentes) || 0,
    em_atraso: Number(c.em_atraso) || 0,
    mensagens_disparadas: Number(c.mensagens_disparadas) || 0,
    aguardando_funcionario: Number(countAguardandoFuncionario) || 0,
  };
  if (Object.prototype.hasOwnProperty.call(byTab, tab)) {
    return byTab[tab];
  }
  return null;
}
