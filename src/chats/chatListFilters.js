import { isSupervisorOrAdmin } from "../auth/permissions";
import {
  getStatusAtendimentoEffective,
  isAguardandoClienteManual,
  isGroupConversation,
} from "../utils/conversaUtils";
import { getDisplayName, getPhone } from "./chatListDisplay";
import { getLastMessage, isConversaAguardandoFuncionario } from "./chatListRowAtendimento";
import { chatListsStoreEquivalent } from "./chatListStoreCompare";

export function digitsOnly(v) {
  return String(v || "").replace(/\D/g, "");
}

export function isToday(dateLike) {
  if (!dateLike) return false;
  const d = new Date(dateLike);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/**
 * A aba "Minha fila" usa `minhaFilaList` (GET `/chats?minha_fila=1`), separado do array `chats`.
 * Fixar em "Todas" atualiza só `chats` via store — sem mesclar aqui, o pin não aparece nem no topo em Minha fila.
 */
export function mergeMinhaFilaPrefsFromChats(rows, chatsCanon) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const canon = Array.isArray(chatsCanon) ? chatsCanon : [];
  const byId = new Map(canon.filter((c) => c?.id != null).map((c) => [String(c.id), c]));
  const toMs = (v) => {
    if (!v) return 0;
    const n = new Date(v).getTime();
    return Number.isFinite(n) ? n : 0;
  };
  const copyDefined = (target, source, keys) => {
    for (const key of keys) {
      if (source?.[key] !== undefined) target[key] = source[key];
    }
  };
  return rows.map((row) => {
    const c = byId.get(String(row?.id));
    if (!c) return row;
    const silenciadoMerged =
      c.silenciado !== undefined || c.silenciada !== undefined
        ? !!(c.silenciado ?? c.silenciada)
        : !!(row.silenciado ?? row.silenciada);
    const rowActivityMs = toMs(row?.ultima_atividade ?? row?.ultima_mensagem?.criado_em ?? row?.criado_em);
    const canonActivityMs = toMs(c?.ultima_atividade ?? c?.ultima_mensagem?.criado_em ?? c?.criado_em);
    const canonHasNewerActivity = canonActivityMs > 0 && canonActivityMs >= rowActivityMs;
    const canonStatusPatchMs = Number(c?.ui_status_optimistic_at || 0);
    const rowStatusPatchMs = Number(row?.ui_status_optimistic_at || 0);
    const hasNewerOptimisticStatus = canonStatusPatchMs > rowStatusPatchMs;
    const live = {};
    if (canonHasNewerActivity) {
      copyDefined(live, c, [
        "ultima_mensagem",
        "ultima_mensagem_preview",
        "ultima_atividade",
        "tem_novas_mensagens",
        "lida",
        "tem_novas_mensagens_em_atendimento",
      ]);
    }
    if (canonHasNewerActivity || hasNewerOptimisticStatus) {
      copyDefined(live, c, [
        "status_atendimento",
        "status_atendimento_real",
        "aguardando_cliente_desde",
        "exibir_badge_aberta",
        "pagamento_prazo_ate",
        "pagamento_prazo_origem",
        "pagamento_concluido_em",
        "finalizacao_motivo",
        "finalizada_automaticamente",
        "ui_status_optimistic_at",
      ]);
    }
    return {
      ...row,
      ...live,
      fixada: c.fixada !== undefined ? !!c.fixada : !!row.fixada,
      fixada_em: c.fixada_em !== undefined ? c.fixada_em : row.fixada_em,
      silenciado: silenciadoMerged,
      silenciada: silenciadoMerged,
      favorita: c.favorita !== undefined ? !!c.favorita : !!row.favorita,
    };
  });
}

/** Chip “Abertas”: apenas conversas com `status_atendimento === aberta` (fila / não assumidas). */
export function conversaContaComoAbertaNoChip(c) {
  const s = getStatusAtendimentoEffective(c);
  if (s !== "aberta") return false;
  if (c?.exibir_badge_aberta === false) return false;
  return true;
}

/**
 * Modo admin por funcionário (payload pode ter vários status_atendimento).
 * Inclui só conversas assumidas por esse utilizador; grupos e itens sem atendente_id ficam de fora.
 */
export function conversaMatchesAdminAtendenteFilter(c, selectedUserId) {
  if (isGroupConversation(c)) return false;
  if (c?.atendente_id == null) return false;
  return String(c.atendente_id) === String(selectedUserId);
}

function isAppAdmin(user) {
  return isSupervisorOrAdmin(user);
}

/**
 * Lista filtrada/ordenada exibida em ChatListRows (mesma lógica que estava no useMemo do ChatList).
 */
export function computeChatsFiltrados({
  chats,
  minhaFilaList,
  debouncedSearch,
  statusFilter,
  tagFilter,
  departamentoFilter,
  atendenteFilter,
  mineOnly,
  order,
  tab,
  user,
  adminAtendenteFilterId,
  onlyFinalizadasAusencia,
  aguardandoClienteOnly,
  pagamentosPendentesOnly,
  emAtrasoOnly,
  pendentesFuncionarioSet,
}) {
  /**
   * Filtro admin por funcionário (GET só com atendente_id): ignora chips de aba e minha_fila — prioridade única no fetch e aqui.
   */
  const adminPorFuncionario =
    adminAtendenteFilterId != null && String(adminAtendenteFilterId).trim() !== "";

  let list = adminPorFuncionario
    ? [...(Array.isArray(chats) ? chats : [])]
    : tab === "minha_fila"
      ? minhaFilaList == null
        ? []
        : mergeMinhaFilaPrefsFromChats([...minhaFilaList], chats)
      : Array.isArray(chats)
        ? [...chats]
        : [];

  // tabs rápidas (minha_fila vem filtrada do backend com minha_fila=1); desativadas no modo adminPorFuncionario
  if (!adminPorFuncionario) {
    if (tab === "hoje") {
      list = list.filter((c) => {
        const last = getLastMessage(c);
        const ts = last?.criado_em || c?.criado_em;
        return isToday(ts);
      });
    } else if (tab === "abertas") {
      list = list.filter((c) => conversaContaComoAbertaNoChip(c));
    } else if (tab === "em_atendimento") {
      list = list.filter((c) => getStatusAtendimentoEffective(c) === "em_atendimento");
    } else if (tab === "finalizadas") {
      list = list.filter((c) => getStatusAtendimentoEffective(c) === "fechada");
    } else if (tab === "finalizadas_auto") {
      list = list.filter(
        (c) =>
          getStatusAtendimentoEffective(c) === "fechada" &&
          (String(c?.finalizacao_motivo) === "ausencia_cliente" || c?.finalizada_automaticamente === true)
      );
    } else if (tab === "aguardando_cliente") {
      list = list.filter((c) => {
        if (isAguardandoClienteManual(c) && c?.atendente_id != null) return true;
        return (
          getStatusAtendimentoEffective(c) === "em_atendimento" &&
          c?.aguardando_cliente_desde != null &&
          c?.atendente_id != null
        );
      });
    } else if (tab === "pagamentos_pendentes") {
      list = list.filter(
        (c) => getStatusAtendimentoEffective(c) === "pagamento_pendente" && c?.atendente_id != null
      );
    } else if (tab === "em_atraso") {
      list = list.filter(
        (c) => getStatusAtendimentoEffective(c) === "em_atraso" && c?.atendente_id != null
      );
    } else if (tab === "aguardando_funcionario") {
      list = list.filter((c) => isConversaAguardandoFuncionario(c, pendentesFuncionarioSet));
    }
  }

  if (adminPorFuncionario) {
    if (tab === "abertas") {
      list = list.filter((c) => conversaContaComoAbertaNoChip(c));
    }
    if (tab === "finalizadas_auto" || onlyFinalizadasAusencia) {
      list = list.filter(
        (c) =>
          getStatusAtendimentoEffective(c) === "fechada" &&
          (String(c?.finalizacao_motivo) === "ausencia_cliente" || c?.finalizada_automaticamente === true)
      );
    }
  }

  const skipStatusFilterRow =
    tab === "abertas" ||
    tab === "mensagens_disparadas" ||
    tab === "finalizadas_auto" ||
    onlyFinalizadasAusencia ||
    tab === "aguardando_cliente" ||
    tab === "pagamentos_pendentes" ||
    tab === "em_atraso" ||
    aguardandoClienteOnly ||
    pagamentosPendentesOnly ||
    emAtrasoOnly;

  // filtros avançados — status (no modo admin: omitir status na API; aqui não reaplicar o select para não esconder estados)
  if (adminPorFuncionario) {
    list = list.filter((c) => conversaMatchesAdminAtendenteFilter(c, adminAtendenteFilterId));
  } else if (statusFilter !== "todos" && !skipStatusFilterRow) {
    list = list.filter((c) => getStatusAtendimentoEffective(c) === statusFilter);
  }

  if (!adminPorFuncionario && onlyFinalizadasAusencia && tab !== "finalizadas_auto") {
    list = list.filter(
      (c) =>
        getStatusAtendimentoEffective(c) === "fechada" &&
        (String(c?.finalizacao_motivo) === "ausencia_cliente" || c?.finalizada_automaticamente === true)
    );
  }
  if (!adminPorFuncionario && aguardandoClienteOnly && tab !== "aguardando_cliente") {
    list = list.filter((c) => {
      if (isAguardandoClienteManual(c) && c?.atendente_id != null) return true;
      return (
        getStatusAtendimentoEffective(c) === "em_atendimento" &&
        c?.aguardando_cliente_desde != null &&
        c?.atendente_id != null
      );
    });
  }
  if (!adminPorFuncionario && pagamentosPendentesOnly && tab !== "pagamentos_pendentes") {
    list = list.filter(
      (c) => getStatusAtendimentoEffective(c) === "pagamento_pendente" && c?.atendente_id != null
    );
  }
  if (!adminPorFuncionario && emAtrasoOnly && tab !== "em_atraso") {
    list = list.filter(
      (c) => getStatusAtendimentoEffective(c) === "em_atraso" && c?.atendente_id != null
    );
  }
  if (tagFilter !== "todas") {
    list = list.filter((c) => (c?.tags || []).some((t) => String(t.id) === String(tagFilter)));
  }

  if (mineOnly && user?.id && !adminPorFuncionario) {
    list = list.filter((c) => String(c.atendente_id) === String(user.id));
  }

  // Filtros por setor/atendente: alinhar lista ao estado local após Socket (ex.: departamento_id vira null)
  if (isAppAdmin(user) && departamentoFilter !== "todos") {
    list = list.filter((c) => String(c?.departamento_id ?? "") === String(departamentoFilter));
  }
  if (!adminPorFuncionario && atendenteFilter !== "todos" && !aguardandoClienteOnly && tab !== "aguardando_cliente") {
    list = list.filter((c) => String(c?.atendente_id ?? "") === String(atendenteFilter));
  }

  // busca
  const termRaw = String(debouncedSearch || "").trim();
  const term = termRaw.toLowerCase();
  const termDigits = digitsOnly(termRaw);
  if (term) {
    list = list.filter((c) => {
      const title = getDisplayName(c).toLowerCase();
      const phone = String(getPhone(c) || "").toLowerCase();
      const telRaw = c?.telefone_exibivel || c?.cliente_telefone || c?.telefone || "";
      const telDigits = digitsOnly(telRaw);

      const matchName = title.includes(term);
      const matchPhone =
        termDigits && (digitsOnly(phone).includes(termDigits) || telDigits.includes(termDigits));

      return matchName || matchPhone;
    });
  }

  // ordenação: apenas por data (mais recente no topo) — contador de não lidas no item não altera a ordem
  list.sort((a, b) => {
    const aPinned = a?.fixada === true ? 1 : 0;
    const bPinned = b?.fixada === true ? 1 : 0;
    if (aPinned !== bPinned) return bPinned - aPinned;
    if (a?.sem_conversa && !b?.sem_conversa) return 1;
    if (!a?.sem_conversa && b?.sem_conversa) return -1;
    if (a?.sem_conversa && b?.sem_conversa) {
      const na = (a.contato_nome || "").toString().toLowerCase();
      const nb = (b.contato_nome || "").toString().toLowerCase();
      return na.localeCompare(nb);
    }
    const aTs = new Date(
      a?.ultima_mensagem?.criado_em || getLastMessage(a)?.criado_em || a?.ultima_atividade || a?.criado_em || 0
    ).getTime();
    const bTs = new Date(
      b?.ultima_mensagem?.criado_em || getLastMessage(b)?.criado_em || b?.ultima_atividade || b?.criado_em || 0
    ).getTime();
    return order === "antigas" ? aTs - bTs : bTs - aTs;
  });

  return list;
}

function setsHaveSameIds(a, b) {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  if (typeof a.size !== "number" || typeof b.size !== "number") return false;
  if (a.size !== b.size) return false;
  for (const id of a) {
    if (!b.has(id)) return false;
  }
  return true;
}

/** Dependências de UI/filtro (exceto arrays de conversas). */
export function buildChatListUiFilterDeps(params) {
  const user = params.user;
  return {
    debouncedSearch: params.debouncedSearch,
    statusFilter: params.statusFilter,
    tagFilter: params.tagFilter,
    departamentoFilter: params.departamentoFilter,
    atendenteFilter: params.atendenteFilter,
    mineOnly: params.mineOnly,
    order: params.order,
    tab: params.tab,
    userId: user?.id,
    userRole: user?.role,
    userPerfil: user?.perfil,
    adminAtendenteFilterId: params.adminAtendenteFilterId,
    onlyFinalizadasAusencia: params.onlyFinalizadasAusencia,
    aguardandoClienteOnly: params.aguardandoClienteOnly,
    pagamentosPendentesOnly: params.pagamentosPendentesOnly,
    emAtrasoOnly: params.emAtrasoOnly,
  };
}

export function areChatListUiFilterDepsEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.debouncedSearch === b.debouncedSearch &&
    a.statusFilter === b.statusFilter &&
    a.tagFilter === b.tagFilter &&
    a.departamentoFilter === b.departamentoFilter &&
    a.atendenteFilter === b.atendenteFilter &&
    a.mineOnly === b.mineOnly &&
    a.order === b.order &&
    a.tab === b.tab &&
    a.userId === b.userId &&
    a.userRole === b.userRole &&
    a.userPerfil === b.userPerfil &&
    a.adminAtendenteFilterId === b.adminAtendenteFilterId &&
    a.onlyFinalizadasAusencia === b.onlyFinalizadasAusencia &&
    a.aguardandoClienteOnly === b.aguardandoClienteOnly &&
    a.pagamentosPendentesOnly === b.pagamentosPendentesOnly &&
    a.emAtrasoOnly === b.emAtrasoOnly
  );
}

function canReuseFilteredChatList(cache, params) {
  if (!cache?.list) return false;
  if (!areChatListUiFilterDepsEqual(cache.ui, buildChatListUiFilterDeps(params))) return false;
  if (!setsHaveSameIds(cache.pendentesFuncionarioSet, params.pendentesFuncionarioSet)) return false;

  const adminPorFuncionario =
    params.adminAtendenteFilterId != null && String(params.adminAtendenteFilterId).trim() !== "";

  if (adminPorFuncionario) {
    return chatListsStoreEquivalent(cache.chats, params.chats);
  }
  if (params.tab === "minha_fila") {
    return (
      chatListsStoreEquivalent(cache.minhaFilaList, params.minhaFilaList) &&
      chatListsStoreEquivalent(cache.chats, params.chats)
    );
  }
  return chatListsStoreEquivalent(cache.chats, params.chats);
}

/**
 * Mesma saída que computeChatsFiltrados; reutiliza array anterior se entrada equivalente.
 * @param {{ current: object|null }} cacheRef
 */
export function computeChatsFiltradosCached(cacheRef, params) {
  const cache = cacheRef?.current;
  if (canReuseFilteredChatList(cache, params)) {
    return cache.list;
  }
  const list = computeChatsFiltrados(params);
  cacheRef.current = {
    list,
    ui: buildChatListUiFilterDeps(params),
    chats: params.chats,
    minhaFilaList: params.minhaFilaList,
    pendentesFuncionarioSet: params.pendentesFuncionarioSet,
  };
  return list;
}
