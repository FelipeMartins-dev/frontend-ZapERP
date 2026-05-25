import { getStatusAtendimentoEffective } from "../utils/conversaUtils";
import { conversaContaComoAbertaNoChip, isToday } from "./chatListFilters";
import { getLastMessage } from "./chatListRowAtendimento";

/**
 * KPIs derivados da lista base `chats` (não usa lista filtrada nem busca).
 * Mesma regra que estava no useMemo de baseCounts do ChatList.
 */
export function computeBaseCounts(chats) {
  const list = Array.isArray(chats) ? chats : [];
  let hoje = 0;
  let abertas = 0;
  let finalizadas = 0;
  let finalizadasAuto = 0;

  for (const c of list) {
    const last = getLastMessage(c);
    const ts = last?.criado_em || c?.criado_em;
    if (isToday(ts)) hoje += 1;
    if (conversaContaComoAbertaNoChip(c)) abertas += 1;

    if (getStatusAtendimentoEffective(c) === "fechada") {
      finalizadas += 1;
      if (
        String(c?.finalizacao_motivo) === "ausencia_cliente" ||
        c?.finalizada_automaticamente === true
      ) {
        finalizadasAuto += 1;
      }
    }
  }

  return {
    total: list.length,
    hoje,
    abertas,
    finalizadas,
    finalizadasAuto,
  };
}

/** Estado visual do chip “Aguardando funcionário” (mesmas faixas do ChatList). */
export function getAguardandoFuncionarioVisualState(count) {
  const n = Number(count) || 0;
  if (n >= 10) return "critical";
  if (n >= 4) return "attention";
  return "neutral";
}
