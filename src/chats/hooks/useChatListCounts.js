import { useMemo, useRef } from "react";
import { computeBaseCounts, getAguardandoFuncionarioVisualState } from "../chatListCounts";
import { chatListsStoreEquivalent } from "../chatListStoreCompare";

/**
 * Contadores dos chips/KPIs da lista (base em `chats` + badges vindos de GET dedicados).
 * Não altera filtros nem chatsFiltrados.
 */
export function useChatListCounts({
  chats,
  emAtendimentoBadgeCount,
  aguardandoClienteBadgeCount,
  supervisaoResumo,
  pendentesFuncionarioIds,
}) {
  const baseCountsCacheRef = useRef({ chats: null, baseCounts: null });

  const baseCounts = useMemo(() => {
    const cache = baseCountsCacheRef.current;
    if (cache.chats && chatListsStoreEquivalent(cache.chats, chats)) {
      return cache.baseCounts;
    }
    const next = computeBaseCounts(chats);
    baseCountsCacheRef.current = { chats, baseCounts: next };
    return next;
  }, [chats]);

  const total = baseCounts.total;
  const countHoje = baseCounts.hoje;
  const countAbertas = baseCounts.abertas;
  const countEmAtendimento = emAtendimentoBadgeCount;
  const countFinalizadas = baseCounts.finalizadas;
  const countFinalizadasAuto = baseCounts.finalizadasAuto;
  /** Chip: sempre vem do GET dedicado `aguardando_cliente=1` (escopo backend), não do length da lista atual. */
  const countAguardandoCliente = aguardandoClienteBadgeCount;
  const countAguardandoFuncionario =
    Number(
      supervisaoResumo?.aguardando_funcionario ??
        supervisaoResumo?.aguardandoFuncionario ??
        (pendentesFuncionarioIds || []).length
    ) || 0;
  const aguardandoFuncionarioVisualState = getAguardandoFuncionarioVisualState(
    countAguardandoFuncionario
  );

  return {
    baseCounts,
    total,
    countHoje,
    countAbertas,
    countEmAtendimento,
    countFinalizadas,
    countFinalizadasAuto,
    countAguardandoCliente,
    countAguardandoFuncionario,
    aguardandoFuncionarioVisualState,
  };
}
