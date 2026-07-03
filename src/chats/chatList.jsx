import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { shallow } from "zustand/shallow";
import { useMatchMedia } from "../hooks/useMatchMedia";
import {
  fetchChats,
  fetchChatCounts,
  getChatsPageMeta,
  abrirConversaCliente,
  getZapiStatus,
  postFinalizacaoAusenciaLote,
} from "./chatService";
import { useChatStore } from "./chatsStore";
import { useConversaStore } from "../conversa/conversaStore";
import { listarTags } from "../api/tagService";
import { useAuthStore } from "../auth/authStore";
import { isSupervisorOrAdmin } from "../auth/permissions";
import {
  isGroupConversation,
  getStatusAtendimentoEffective,
  isAguardandoClienteManual,
  isVCardText,
  parseVCardMeta,
} from "../utils/conversaUtils";
import api from "../api/http";
import { useNavigate, useLocation } from "react-router-dom";
import { useNotificationStore } from "../notifications/notificationStore";
import ConfirmDialog from "../components/feedback/ConfirmDialog";
import "../components/feedback/empty-state.css";
import "../components/feedback/skeleton.css";
import "../components/ui/button.css";
import "./chatList.css";
import "./chatList.chips-premium.css";
import "../styles/zap-animations.css";
import NovoContatoModal from "./NovoContatoModal";
const ProdutoConsultaPanel = lazy(() => import("../conversa/ProdutoConsultaPanel"));
export { getDisplayName } from "./chatListDisplay";
import {
  getLastMessage,
  isConversaAguardandoCliente,
  isConversaAguardandoFuncionario,
  isConversaEmAtendimentoBadge,
  isConversaPagamentoPendente,
  isConversaEmAtrasoPagamento,
} from "./chatListRowAtendimento";
import { isUsuarioSetorFinanceiro } from "../utils/financeiroSector";
import { useAdminAtendenteFilter } from "./useAdminAtendenteFilter";
import { scheduleAfterInitialPaint } from "./scheduleAfterInitialPaint";
import {
  buildChatListFiltersScopeKey,
  getChatListFiltersDataCache,
  hydrateChatListFiltersFromSession,
  loadChatListAtendentesOnce,
  loadChatListFiltersDataOnce,
  setChatListFiltersScope,
} from "./chatListFiltersData";
import {
  clearChatListRowsFilterSessionCache,
  hydrateChatListRowsForFilterFromSession,
  hydrateChatListSidebarFromSession,
  persistChatListSidebarToSession,
  persistChatListRowsForFilterToSession,
} from "./chatListSidebarCache";
import {
  resetAuxBadgeRequestsForScope,
  runAuxBadgeFetch,
} from "./chatListAuxBadgeRequests";
import ChatListBody from "./ChatListBody";
import ChatListHeaderBar from "./ChatListHeaderBar";
import ChatListAdvancedFiltersPanel from "./ChatListAdvancedFiltersPanel";
import MinhasPendenciasCard from "./MinhasPendenciasCard";
import { useMinhasPendencias } from "./hooks/useMinhasPendencias";
import { markPushEntryReady } from "../push/deferredPushSync";
import { getClientesPendentesSupervisao, getResumoSupervisao } from "../api/supervisaoService";
import { clearConversation, deleteConversation } from "./conversationActionsService";
import { chatRowStableKey } from "./chatRowStableKey";

/** Admin UI (filtro lateral por funcionário): aceita role/perfil legado. */
function isAppAdmin(user) {
  return isSupervisorOrAdmin(user);
}

function countDistinctConversas(list) {
  const arr = Array.isArray(list) ? list : [];
  const byKey = new Set();
  arr.forEach((c) => {
    const key = chatRowStableKey(c);
    if (key) byKey.add(String(key));
  });
  return byKey.size;
}

const CONFIRM_LOTE_AUSENCIA = "FINALIZAR_LOTE_AUSENCIA_CLIENTE";
const CHAT_LIST_PAGE_LIMIT = 80;
const MOBILE_ZAPI_STATUS_DELAY_MS = 3200;
const MOBILE_SECONDARY_REFRESH_DELAY_MS = 2800;
const MOBILE_COUNTS_DELAY_MS = 2600;
const MOBILE_FILTERS_BOOT_DELAY_MS = 3600;
const MOBILE_FILTERS_PREWARM_DELAY_MS = 5200;
const MOBILE_SUPERVISAO_POLL_DELAY_MS = 6000;
const MOBILE_PENDENCIAS_INITIAL_DELAY_MS = 2600;
const MOBILE_PENDENCIAS_RESYNC_DELAY_MS = 1400;
const OPTIMISTIC_MINHA_FILA_REMOVE_TTL_MS = 12000;
const TABS_HIDE_OPTIMISTIC_CLOSED = new Set([
  "minha_fila",
  "abertas",
  "em_atendimento",
  "aguardando_cliente",
  "aguardando_funcionario",
  "pagamentos_pendentes",
  "em_atraso",
]);

function isClosedAttendancePatch(patch) {
  const status = String(
    patch?.status_atendimento_real ?? patch?.status_atendimento ?? ""
  ).toLowerCase();
  return status === "fechada" || status === "encerrada";
}

function shouldHideOptimisticClosedFromTab(tab, mutation) {
  if (mutation?.type !== "encerrar_conversa") return false;
  if (!isClosedAttendancePatch(mutation?.patch)) return false;
  return TABS_HIDE_OPTIMISTIC_CLOSED.has(String(tab || ""));
}

function getOptimisticRemovedRow(entry) {
  return entry && typeof entry === "object" && "row" in entry ? entry.row : entry;
}

function pruneExpiredOptimisticRemoved(map) {
  const now = Date.now();
  for (const [id, entry] of map.entries()) {
    if (entry?.expiresAt != null && Number(entry.expiresAt) <= now) {
      map.delete(id);
    }
  }
}

function getChatSortTs(c) {
  return (
    c?.ultima_mensagem?.criado_em ||
    getLastMessage(c)?.criado_em ||
    c?.ultima_atividade ||
    c?.criado_em ||
    0
  );
}

function sortChatRowsByOrder(list, order) {
  return [...(Array.isArray(list) ? list : [])].sort((a, b) =>
    order === "antigas"
      ? new Date(getChatSortTs(a)) - new Date(getChatSortTs(b))
      : new Date(getChatSortTs(b)) - new Date(getChatSortTs(a))
  );
}

function dedupeChatRowsByStableKey(list) {
  const byKey = new Map();
  (Array.isArray(list) ? list : []).forEach((c) => {
    const key = chatRowStableKey(c);
    if (!byKey.has(key)) byKey.set(key, c);
  });
  return Array.from(byKey.values());
}

function mergeChatRowsPreservingCurrent(current, incoming, order) {
  const byKey = new Map();
  const put = (row, preferIncoming = false) => {
    if (!row) return;
    const key = chatRowStableKey(row);
    const prev = byKey.get(key);
    byKey.set(key, prev && preferIncoming ? { ...prev, ...row } : prev || row);
  };
  (Array.isArray(current) ? current : []).forEach((row) => put(row, false));
  (Array.isArray(incoming) ? incoming : []).forEach((row) => put(row, true));
  return sortChatRowsByOrder(Array.from(byKey.values()), order);
}

function rowStillBelongsToEmAtendimentoLiveScope(row, { user, adminAtendenteFilterId, pendentesFuncionarioSet }) {
  if (!row || row.sem_conversa || isGroupConversation(row)) return false;
  const belongsToEmAtendimento =
    isConversaAguardandoCliente(row) ||
    isConversaAguardandoFuncionario(row, pendentesFuncionarioSet) ||
    isConversaEmAtendimentoBadge(row);
  if (!belongsToEmAtendimento) return false;

  const filtroAtendenteAtivo =
    adminAtendenteFilterId != null && String(adminAtendenteFilterId).trim() !== "";
  if (filtroAtendenteAtivo) {
    return row.atendente_id != null && String(row.atendente_id) === String(adminAtendenteFilterId);
  }

  if (isAppAdmin(user)) return true;

  return (
    row.atendente_id != null &&
    user?.id != null &&
    String(row.atendente_id) === String(user.id)
  );
}

function mergeEmAtendimentoBackgroundRows(current, incoming, order, opts) {
  const incomingKeys = new Set(
    (Array.isArray(incoming) ? incoming : [])
      .map((row) => chatRowStableKey(row))
      .filter(Boolean)
  );
  const preserved = (Array.isArray(current) ? current : []).filter((row) => {
    const key = chatRowStableKey(row);
    if (!key || incomingKeys.has(key)) return false;
    return rowStillBelongsToEmAtendimentoLiveScope(row, opts);
  });
  if (!preserved.length) return incoming;
  return mergeChatRowsPreservingCurrent(preserved, incoming, order);
}

function buildChatListPageState(data) {
  const meta = getChatsPageMeta(data);
  return {
    hasMore: Boolean(meta?.hasMore && meta?.nextCursor),
    nextCursor: meta?.nextCursor || null,
    nextCursorId: meta?.nextCursorId ?? null,
    totalCount: meta?.totalCount ?? null,
    loading: false,
    error: "",
  };
}

function buildCountsQueryParams({
  tagFilter,
  departamentoFilter,
  dataInicio,
  dataFim,
  debouncedSearch,
  adminAtendenteFilterId,
}) {
  const adminPorFuncionario =
    adminAtendenteFilterId != null && String(adminAtendenteFilterId).trim() !== "";
  const searchTerm = String(debouncedSearch || "").trim();
  const params = {
    tag_id: tagFilter !== "todas" ? tagFilter : undefined,
    departamento_id: departamentoFilter !== "todos" ? departamentoFilter : undefined,
    data_inicio: dataInicio || undefined,
    data_fim: dataFim || undefined,
    palavra: searchTerm || undefined,
  };
  if (adminPorFuncionario) {
    const aid = Number(adminAtendenteFilterId);
    params.atendente_id =
      Number.isFinite(aid) && aid > 0 ? aid : adminAtendenteFilterId;
  }
  return params;
}

function isAbortError(err) {
  return (
    err?.name === "AbortError" ||
    err?.name === "CanceledError" ||
    err?.code === "ERR_CANCELED"
  );
}

function isNetworkError(err) {
  return (
    err?.code === "ERR_NETWORK" ||
    err?.message === "Network Error" ||
    err?.request?.status === 0
  );
}

/** IDs de conversas individuais em atendimento (para assistente de lote por ausência). */
function collectEmAtendimentoIdsFromChats(list, max = 50) {
  return (Array.isArray(list) ? list : [])
    .filter((c) => !isGroupConversation(c) && c?.id && !c.sem_conversa)
    .filter((c) => getStatusAtendimentoEffective(c) === "em_atendimento" && c.atendente_id != null)
    .map((c) => Number(c.id))
    .filter((n) => Number.isFinite(n) && n > 0)
    .slice(0, max);
}

export default function ChatList() {
  const { setChats, setLoading, setUnread, addChat } = useChatStore(
    (s) => ({
      setChats: s.setChats,
      setLoading: s.setLoading,
      setUnread: s.setUnread,
      addChat: s.addChat,
    }),
    shallow
  );

  const navigate = useNavigate();
  const location = useLocation();

  const carregarConversa = useConversaStore((s) => s.carregarConversa);
  const queueComposerAppend = useConversaStore((s) => s.queueComposerAppend);
  const isMobileLayout = useMatchMedia("(max-width: 640px)");
  const listLoading = useChatStore((s) => s.loading);
  const hasListRows = useChatStore((s) => (s.chats?.length ?? 0) > 0);

  const { user, rowCurrentUserId, separarMensagensDisparadasLigado, userRole } = useAuthStore(
    (s) => {
      const u = s.user;
      return {
        user: u,
        rowCurrentUserId: u?.id != null ? Number(u.id) : null,
        separarMensagensDisparadasLigado: u?.separar_mensagens_disparadas === true,
        userRole: String(u?.role || u?.perfil || "").toLowerCase(),
      };
    },
    shallow
  );

  const filterScopeKey = useMemo(() => buildChatListFiltersScopeKey(user), [user]);
  const {
    minhasPendencias,
    pendenciaAtiva,
    loadingPendencias,
    loadingPendenciaCategoria,
    conversaIdsPendenciaAtiva,
    onPendenciaClick,
    clearPendenciaAtiva,
    refresh: refreshMinhasPendencias,
  } = useMinhasPendencias(filterScopeKey, {
    skipInitial: isMobileLayout,
    initialDelayMs: isMobileLayout ? MOBILE_PENDENCIAS_INITIAL_DELAY_MS : 0,
    resyncDelayMs: isMobileLayout ? MOBILE_PENDENCIAS_RESYNC_DELAY_MS : 0,
  });
  const refreshMinhasPendenciasRef = useRef(refreshMinhasPendencias);
  refreshMinhasPendenciasRef.current = refreshMinhasPendencias;
  const conversaIdsPendenciaQuery = useMemo(() => {
    if (conversaIdsPendenciaAtiva == null) return null;
    const ids = Array.from(conversaIdsPendenciaAtiva)
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n) && n > 0);
    return ids.length > 0 ? ids.join(",") : "0";
  }, [conversaIdsPendenciaAtiva]);
  const [listRefreshing, setListRefreshing] = useState(false);
  const sessionBootRef = useRef(null);
  const auxScopeKeyRef = useRef(null);
  const canConsultarProdutos = ["admin", "supervisor", "atendente"].includes(userRole);
  const canVerSyncProdutos = ["admin", "supervisor"].includes(userRole);
  const canSincronizarProdutos = userRole === "admin";

  const {
    selectedUserId: adminAtendenteFilterId,
    setSelectedUserId: setAdminAtendenteFilterId,
    panelOpen: adminAtendentePanelOpen,
    setPanelOpen: setAdminAtendentePanelOpen,
    clearSelection: clearAdminAtendenteFilter,
  } = useAdminAtendenteFilter();

  const searchRef = useRef(null);

  const scrollRef = useRef(null);
  const scrollSaveRef = useRef(0);
  const scrollTopNoncePrevRef = useRef(0);
  const loadRequestIdRef = useRef(0);
  const loadAbortRef = useRef(null);
  const countsAbortRef = useRef(null);
  const countsRequestIdRef = useRef(0);
  const mobileCountsBootSkippedRef = useRef(false);
  /** Evita GET /chats paralelos quando vários resyncs disparam load() na mesma janela */
  const loadInFlightRef = useRef(false);
  const loadQueuedRef = useRef(null);
  /** Evita resync do socket logo após load() principal (login/F5). */
  const lastLoadFinishedAtRef = useRef(0);
  const loadSecondaryScheduleCancelRef = useRef(null);
  const lastListParamsRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => { scrollSaveRef.current = el.scrollTop; };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // busca: termo debounced no pai (filtro); digitação fica no filho para não re-renderizar a lista inteira
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [searchClearNonce, setSearchClearNonce] = useState(0);
  const [chatListPage, setChatListPage] = useState({
    hasMore: false,
    nextCursor: null,
    nextCursorId: null,
    totalCount: null,
    loading: false,
    error: "",
  });
  const [chatFilterCounts, setChatFilterCounts] = useState(null);
  const [activeListTotalCount, setActiveListTotalCount] = useState(null);
  const chatListPageRef = useRef(chatListPage);
  chatListPageRef.current = chatListPage;
  const handleSearchDebounced = useCallback((t) => {
    setDebouncedSearch(t);
  }, []);

  const [statusFilter, setStatusFilter] = useState("todos");
  const [allTags, setAllTags] = useState([]);
  const [tagFilter, setTagFilter] = useState("todas");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [atendentes, setAtendentes] = useState([]);
  const [atendenteFilter, setAtendenteFilter] = useState("todos");
  const [departamentos, setDepartamentos] = useState(() => {
    const cached = getChatListFiltersDataCache()?.departamentos;
    return Array.isArray(cached) ? cached : [];
  });
  const isFinanceiroUser = useMemo(
    () => isUsuarioSetorFinanceiro(user, departamentos),
    [user, departamentos]
  );
  const isFinanceiroUserRef = useRef(isFinanceiroUser);
  isFinanceiroUserRef.current = isFinanceiroUser;
  const financeiroBadgesPrimedRef = useRef(false);
  const [departamentoFilter, setDepartamentoFilter] = useState("todos");
  const [mineOnly, setMineOnly] = useState(false);
  const [order, setOrder] = useState("recentes");
  const [showFilters, setShowFilters] = useState(false);
  const [filtersAuxLoading, setFiltersAuxLoading] = useState(false);
  /** Filtro avançado: conversas fechadas com finalização por ausência (reforça query GET /chats). */
  const [onlyFinalizadasAusencia, setOnlyFinalizadasAusencia] = useState(false);
  /** Filtro avançado: conversas em atendimento com humano aguardando resposta do cliente. */
  const [aguardandoClienteOnly, setAguardandoClienteOnly] = useState(false);
  /** Financeiro: filtros avançados de cobrança (somente setor Financeiro). */
  const [pagamentosPendentesOnly, setPagamentosPendentesOnly] = useState(false);
  const [emAtrasoOnly, setEmAtrasoOnly] = useState(false);
  /** GET /chats?tempo_parado= — conversas com aguardando_cliente_desde acima do limite (backend). */
  const [tempoParadoFilter, setTempoParadoFilter] = useState("");
  const [loteAusenciaBusy, setLoteAusenciaBusy] = useState(false);
  const [loteAusenciaMsg, setLoteAusenciaMsg] = useState("");
  const [loteAusenciaConfirm, setLoteAusenciaConfirm] = useState("");

  const [novoContatoModalOpen, setNovoContatoModalOpen] = useState(false);
  const [showProdutosPanel, setShowProdutosPanel] = useState(false);
  const [confirmClear, setConfirmClear] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  // menu "Novo" (botão +)
  const [showNovoMenu, setShowNovoMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const novoBtnRef = useRef(null);
  const novoMenuRef = useRef(null);

  // tabs estilo WhatsApp (chip row)
  // todas | hoje | abertas | minha_fila | em_atendimento | finalizadas | finalizadas_auto | aguardando_cliente | aguardando_funcionario
  const [tab, setTab] = useState("minha_fila");
  const handlePendenciaClick = useCallback(
    (categoria) => {
      setTab("todas");
      void onPendenciaClick(categoria);
    },
    [onPendenciaClick, setTab]
  );
  const [zapFilterSkeleton, setZapFilterSkeleton] = useState(false);
  const tabRef = useRef(tab);
  tabRef.current = tab;

  useEffect(() => {
    if (tab === "nao_lidas") setTab("todas");
  }, [tab]);

  useEffect(() => {
    if (!isSupervisorOrAdmin(user) && tab === "aguardando_funcionario") {
      setTab("minha_fila");
    }
  }, [user, tab]);

  useEffect(() => {
    if (!separarMensagensDisparadasLigado && tab === "mensagens_disparadas") {
      setTab("minha_fila");
    }
  }, [separarMensagensDisparadasLigado, tab]);

  useEffect(() => {
    if (!isFinanceiroUser && (tab === "pagamentos_pendentes" || tab === "em_atraso")) {
      setTab("minha_fila");
    }
  }, [isFinanceiroUser, tab]);

  useEffect(() => {
    if (!separarMensagensDisparadasLigado && statusFilter === "mensagem_disparada") {
      setStatusFilter("todos");
    }
  }, [separarMensagensDisparadasLigado, statusFilter]);

  /** GET /chats?minha_fila=1 — fila do atendente (abertas + em atendimento comigo); sem status_atendimento na query. */
  const [minhaFilaList, setMinhaFilaList] = useState(null);
  const minhaFilaListRef = useRef(null);
  const optimisticRemovedMinhaFilaRef = useRef(new Map());
  const filterRequestKeyRef = useRef("");
  minhaFilaListRef.current = minhaFilaList;
  const filterOptimisticRemovedMinhaFila = useCallback((list) => {
    const arr = Array.isArray(list) ? list : [];
    const removed = optimisticRemovedMinhaFilaRef.current;
    if (!removed?.size) return arr;
    pruneExpiredOptimisticRemoved(removed);
    if (!removed.size) return arr;
    return arr.filter((c) => !removed.has(String(c?.id)));
  }, []);
  const [minhaFilaCount, setMinhaFilaCount] = useState(0);
  /** Contador do chip “Em atendimento”: sempre GET /chats?status_atendimento=em_atendimento (escopo backend). */
  const [emAtendimentoBadgeCount, setEmAtendimentoBadgeCount] = useState(0);
  /** Contador do chip “Aguardando cliente”: sempre GET /chats?aguardando_cliente=1 (escopo do backend), nunca length de “Todas”. */
  const [aguardandoClienteBadgeCount, setAguardandoClienteBadgeCount] = useState(0);
  const [pagamentosPendentesBadgeCount, setPagamentosPendentesBadgeCount] = useState(0);
  const [emAtrasoBadgeCount, setEmAtrasoBadgeCount] = useState(0);
  /** Contador do chip “Mensagens Disparadas”: GET /chats?status_atendimento=mensagem_disparada (escopo backend). */
  const [mensagensDisparadasCount, setMensagensDisparadasCount] = useState(0);

  const filterRequestKey = [
    tab,
    debouncedSearch,
    tagFilter,
    departamentoFilter,
    statusFilter,
    atendenteFilter,
    dataInicio,
    dataFim,
    mineOnly ? "mine" : "all",
    order,
    adminAtendenteFilterId ?? "",
    onlyFinalizadasAusencia ? "auto" : "",
    aguardandoClienteOnly ? "aguardando" : "",
    pagamentosPendentesOnly ? "pag-pendente" : "",
    emAtrasoOnly ? "em-atraso" : "",
    tempoParadoFilter,
    conversaIdsPendenciaQuery ?? "",
    separarMensagensDisparadasLigado ? "sep-disparadas" : "",
    filterScopeKey,
  ].join("|");

  useEffect(() => {
    if (!filterRequestKeyRef.current) {
      filterRequestKeyRef.current = filterRequestKey;
      return;
    }
    if (filterRequestKeyRef.current === filterRequestKey) return;
    filterRequestKeyRef.current = filterRequestKey;
    setZapFilterSkeleton(true);
    setActiveListTotalCount(null);
    setChatListPage({
      hasMore: false,
      nextCursor: null,
      nextCursorId: null,
      totalCount: null,
      loading: false,
      error: "",
    });
    setChats([]);
    if (tab === "minha_fila") {
      setMinhaFilaList(null);
    }
  }, [filterRequestKey, tab, setChats]);

  /** Hidratação antes da pintura: lista + Minha fila + filtros auxiliares (F5). */
  useLayoutEffect(() => {
    if (!filterScopeKey) return;
    if (auxScopeKeyRef.current !== filterScopeKey) {
      auxScopeKeyRef.current = filterScopeKey;
      resetAuxBadgeRequestsForScope(filterScopeKey);
    }
    setChatListFiltersScope(filterScopeKey);
    if (hydrateChatListFiltersFromSession(filterScopeKey)) {
      const cached = getChatListFiltersDataCache();
      setAllTags(cached.tags ?? []);
      setAtendentes(cached.atendentes ?? []);
      setDepartamentos(cached.departamentos ?? []);
    }
    if (sessionBootRef.current === filterScopeKey) return;
    sessionBootRef.current = filterScopeKey;
    const boot = hydrateChatListSidebarFromSession(filterScopeKey);
    if (!boot?.chats?.length) return;
    if (!(useChatStore.getState().chats?.length > 0)) {
      setChats(boot.chats);
    }
    if (boot.minhaFila != null) {
      setMinhaFilaList((prev) => (prev == null ? filterOptimisticRemovedMinhaFila(boot.minhaFila) : prev));
    }
    if (boot.minhaFilaCount != null) {
      setMinhaFilaCount(boot.minhaFilaCount);
    }
    if (boot.emAtendimentoBadgeCount != null) {
      setEmAtendimentoBadgeCount(boot.emAtendimentoBadgeCount);
    }
    if (boot.aguardandoClienteBadgeCount != null) {
      setAguardandoClienteBadgeCount(boot.aguardandoClienteBadgeCount);
    }
    if (boot.mensagensDisparadasCount != null) {
      setMensagensDisparadasCount(boot.mensagensDisparadasCount);
    }
  }, [filterScopeKey, setChats, filterOptimisticRemovedMinhaFila]);

  /** Supervisão: resumo para badge e lista de conversas pendentes do funcionário. */
  const [supervisaoResumo, setSupervisaoResumo] = useState(null);
  const [pendentesFuncionarioIds, setPendentesFuncionarioIds] = useState([]);
  const pendentesFuncionarioSet = useMemo(
    () => new Set((pendentesFuncionarioIds || []).map((x) => String(x))),
    [pendentesFuncionarioIds]
  );
  const pendentesFuncionarioIdsRef = useRef(pendentesFuncionarioIds);
  pendentesFuncionarioIdsRef.current = pendentesFuncionarioIds;

  // Status de conexão Z-API: null=não verificado, true=conectado, false=desconectado
  const [zapiConnected, setZapiConnected] = useState(null);
  const [zapiStatusLoaded, setZapiStatusLoaded] = useState(false);

  const showToast = useNotificationStore((s) => s.showToast);
  useEffect(() => {
    if (location.state?.openNovoContatoModal) {
      setNovoContatoModalOpen(true);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, location.pathname, navigate]);

  useEffect(() => {
    setAdminAtendentePanelOpen(false);
  }, [location.pathname, setAdminAtendentePanelOpen]);

  useEffect(() => {
    if (!isAppAdmin(user)) clearAdminAtendenteFilter();
  }, [user?.perfil, user?.role, clearAdminAtendenteFilter]);

  // Status UltraMSG (nome legado getZapiStatus) só após paint/idle, sem competir com GET da lista.
  useEffect(() => {
    let cancelled = false;

    const delay = isMobileLayout ? MOBILE_ZAPI_STATUS_DELAY_MS : 400;
    const cancelStatus = scheduleAfterInitialPaint(() => {
      getZapiStatus()
        .then((s) => {
          if (cancelled) return;
          setZapiConnected(s?.connected === true);
          setZapiStatusLoaded(true);
        })
        .catch(() => {
          if (!cancelled) setZapiStatusLoaded(true);
        });
    }, delay);

    return () => {
      cancelled = true;
      cancelStatus();
    };
  }, [isMobileLayout]);

  // Atualização automática da lista (nomes, novas conversas) a cada 5 min — evita "refresh" constante
  useEffect(() => {
    const interval = setInterval(() => loadRef.current?.(), 300_000);
    return () => clearInterval(interval);
  }, []);

  const refreshChatFilterCounts = useCallback(async (opts = {}) => {
    const requestId = ++countsRequestIdRef.current;
    countsAbortRef.current?.abort();
    const controller = new AbortController();
    countsAbortRef.current = controller;
    try {
      const params = buildCountsQueryParams({
        tagFilter,
        departamentoFilter,
        dataInicio,
        dataFim,
        debouncedSearch,
        adminAtendenteFilterId,
      });
      const data = await fetchChatCounts(params, {
        signal: controller.signal,
        silent: opts.silent === true,
      });
      if (requestId !== countsRequestIdRef.current) return;
      setChatFilterCounts(data || null);
      if (data?.minha_fila != null) {
        setMinhaFilaCount((prev) => {
          const next = Number(data.minha_fila) || 0;
          return prev === next ? prev : next;
        });
      }
    } catch (e) {
      if (isAbortError(e)) return;
      if (import.meta.env?.DEV && opts.silent !== true) {
        console.warn("Contadores de conversas indisponiveis; mantendo valores atuais.", e);
      }
    }
  }, [
    tagFilter,
    departamentoFilter,
    dataInicio,
    dataFim,
    debouncedSearch,
    adminAtendenteFilterId,
  ]);

  const refreshMinhaFila = useCallback(async () => {
    try {
      const t = tabRef.current;
      const finalAutoQuery = t === "finalizadas_auto" || onlyFinalizadasAusencia;
      /** Só minha_fila=1 aqui — nunca misturar com aguardando_cliente (endpoint com escopo próprio). */
      const params = {
        minha_fila: true,
        tag_id: tagFilter !== "todas" ? tagFilter : undefined,
        departamento_id: departamentoFilter !== "todos" ? departamentoFilter : undefined,
        atendente_id: atendenteFilter !== "todos" ? atendenteFilter : undefined,
        data_inicio: dataInicio || undefined,
        data_fim: dataFim || undefined,
        incluir_todos_clientes: undefined,
      };
      if (finalAutoQuery) {
        params.status_atendimento = "fechada";
        params.finalizacao_motivo = "ausencia_cliente";
      }
      if (tempoParadoFilter) params.tempo_parado = tempoParadoFilter;
      params.limit = CHAT_LIST_PAGE_LIMIT;
      const data = await fetchChats(params, { silent: true });
      const list = filterOptimisticRemovedMinhaFila(Array.isArray(data) ? data : []);
      const pageMeta = getChatsPageMeta(data);
      const count = pageMeta.totalCount ?? countDistinctConversas(list);
      setMinhaFilaCount((prev) => (prev === count ? prev : count));
      if (tabRef.current === "minha_fila") {
        setMinhaFilaList(list);
      }
      persistChatListSidebarToSession(filterScopeKey, useChatStore.getState().chats || [], {
        minhaFila: list,
        minhaFilaCount: count,
      });
    } catch (e) {
      console.error("Erro ao carregar Minha fila:", e);
    }
  }, [tagFilter, departamentoFilter, atendenteFilter, dataInicio, dataFim, onlyFinalizadasAusencia, tempoParadoFilter, filterScopeKey, filterOptimisticRemovedMinhaFila]);

  const refreshEmAtendimentoBadge = useCallback(async () => {
    try {
      const adminPorFuncionario =
        adminAtendenteFilterId != null && String(adminAtendenteFilterId).trim() !== "";
      let params;
      if (adminPorFuncionario) {
        const aid = Number(adminAtendenteFilterId);
        const atendenteIdQuery =
          Number.isFinite(aid) && aid > 0 ? aid : adminAtendenteFilterId;
        params = {
          status_atendimento: "em_atendimento",
          atendente_id: atendenteIdQuery,
          tag_id: tagFilter !== "todas" ? tagFilter : undefined,
          departamento_id: departamentoFilter !== "todos" ? departamentoFilter : undefined,
          data_inicio: dataInicio || undefined,
          data_fim: dataFim || undefined,
          incluir_todos_clientes: undefined,
        };
      } else {
        params = {
          status_atendimento: "em_atendimento",
          tag_id: tagFilter !== "todas" ? tagFilter : undefined,
          departamento_id: departamentoFilter !== "todos" ? departamentoFilter : undefined,
          data_inicio: dataInicio || undefined,
          data_fim: dataFim || undefined,
          incluir_todos_clientes: undefined,
        };
      }
      const data = await fetchChats(params);
      const list = Array.isArray(data) ? data : [];
      const apenasEmAtendimento = list.filter((c) => isConversaEmAtendimentoBadge(c));
      const n = countDistinctConversas(apenasEmAtendimento);
      setEmAtendimentoBadgeCount((prev) => (prev === n ? prev : n));
      persistChatListSidebarToSession(filterScopeKey, useChatStore.getState().chats || [], {
        emAtendimentoBadgeCount: n,
      });
    } catch (e) {
      console.error("Erro ao carregar contagem Em atendimento:", e);
    }
  }, [
    adminAtendenteFilterId,
    tagFilter,
    departamentoFilter,
    dataInicio,
    dataFim,
    filterScopeKey,
  ]);

  const refreshAguardandoClienteBadge = useCallback(async () => {
    try {
      const adminPorFuncionario =
        adminAtendenteFilterId != null && String(adminAtendenteFilterId).trim() !== "";
      let params;
      if (adminPorFuncionario) {
        const aid = Number(adminAtendenteFilterId);
        const atendenteIdQuery =
          Number.isFinite(aid) && aid > 0 ? aid : adminAtendenteFilterId;
        params = {
          aguardando_cliente: "1",
          atendente_id: atendenteIdQuery,
          tag_id: tagFilter !== "todas" ? tagFilter : undefined,
          departamento_id: departamentoFilter !== "todos" ? departamentoFilter : undefined,
          data_inicio: dataInicio || undefined,
          data_fim: dataFim || undefined,
          incluir_todos_clientes: undefined,
        };
      } else {
        // Sem "Por funcionário": respeitar escopo padrão da sessão no backend.
        params = {
          aguardando_cliente: "1",
          tag_id: tagFilter !== "todas" ? tagFilter : undefined,
          departamento_id: departamentoFilter !== "todos" ? departamentoFilter : undefined,
          data_inicio: dataInicio || undefined,
          data_fim: dataFim || undefined,
          incluir_todos_clientes: undefined,
        };
      }
      const data = await fetchChats(params);
      const list = Array.isArray(data) ? data : [];
      const apenasAguardando = list.filter((c) => isConversaAguardandoCliente(c));
      const n = countDistinctConversas(apenasAguardando);
      setAguardandoClienteBadgeCount((prev) => (prev === n ? prev : n));
      persistChatListSidebarToSession(filterScopeKey, useChatStore.getState().chats || [], {
        aguardandoClienteBadgeCount: n,
      });
    } catch (e) {
      console.error("Erro ao carregar contagem Aguardando cliente:", e);
    }
  }, [
    adminAtendenteFilterId,
    tagFilter,
    departamentoFilter,
    atendenteFilter,
    dataInicio,
    dataFim,
    filterScopeKey,
  ]);

  const refreshPagamentosPendentesBadge = useCallback(async () => {
    if (!isFinanceiroUser) {
      setPagamentosPendentesBadgeCount((prev) => (prev === 0 ? prev : 0));
      return;
    }
    try {
      const params = {
        pagamento_pendente: "1",
        tag_id: tagFilter !== "todas" ? tagFilter : undefined,
        departamento_id: departamentoFilter !== "todos" ? departamentoFilter : undefined,
        data_inicio: dataInicio || undefined,
        data_fim: dataFim || undefined,
        incluir_todos_clientes: undefined,
      };
      const data = await fetchChats(params);
      const list = Array.isArray(data) ? data : [];
      const n = countDistinctConversas(list.filter((c) => isConversaPagamentoPendente(c)));
      setPagamentosPendentesBadgeCount((prev) => (prev === n ? prev : n));
    } catch (e) {
      console.error("Erro ao carregar contagem Pagamentos pendentes:", e);
    }
  }, [isFinanceiroUser, tagFilter, departamentoFilter, dataInicio, dataFim]);

  const refreshEmAtrasoBadge = useCallback(async () => {
    if (!isFinanceiroUser) {
      setEmAtrasoBadgeCount((prev) => (prev === 0 ? prev : 0));
      return;
    }
    try {
      const params = {
        em_atraso: "1",
        tag_id: tagFilter !== "todas" ? tagFilter : undefined,
        departamento_id: departamentoFilter !== "todos" ? departamentoFilter : undefined,
        data_inicio: dataInicio || undefined,
        data_fim: dataFim || undefined,
        incluir_todos_clientes: undefined,
      };
      const data = await fetchChats(params);
      const list = Array.isArray(data) ? data : [];
      const n = countDistinctConversas(list.filter((c) => isConversaEmAtrasoPagamento(c)));
      setEmAtrasoBadgeCount((prev) => (prev === n ? prev : n));
    } catch (e) {
      console.error("Erro ao carregar contagem Em atraso:", e);
    }
  }, [isFinanceiroUser, tagFilter, departamentoFilter, dataInicio, dataFim]);

  const refreshMensagensDisparadasBadge = useCallback(async () => {
    if (!separarMensagensDisparadasLigado) {
      setMensagensDisparadasCount((prev) => (prev === 0 ? prev : 0));
      return;
    }
    try {
      const params = {
        status_atendimento: "mensagem_disparada",
        tag_id: tagFilter !== "todas" ? tagFilter : undefined,
        departamento_id: departamentoFilter !== "todos" ? departamentoFilter : undefined,
        data_inicio: dataInicio || undefined,
        data_fim: dataFim || undefined,
        incluir_todos_clientes: "0",
      };
      const data = await fetchChats(params);
      const list = Array.isArray(data) ? data : [];
      const n = countDistinctConversas(list);
      setMensagensDisparadasCount((prev) => (prev === n ? prev : n));
      persistChatListSidebarToSession(filterScopeKey, useChatStore.getState().chats || [], {
        mensagensDisparadasCount: n,
      });
    } catch (e) {
      console.error("Erro ao carregar contagem Mensagens Disparadas:", e);
    }
  }, [tagFilter, departamentoFilter, dataInicio, dataFim, separarMensagensDisparadasLigado, filterScopeKey]);

  const refreshSupervisaoData = useCallback(async () => {
    if (!isSupervisorOrAdmin(user)) {
      setSupervisaoResumo(null);
      setPendentesFuncionarioIds([]);
      return;
    }
    try {
      const [resumoData, pendentesData] = await Promise.all([
        getResumoSupervisao(),
        getClientesPendentesSupervisao(),
      ]);
      setSupervisaoResumo(resumoData || {});
      const ids = (Array.isArray(pendentesData) ? pendentesData : [])
        .map((item) => String(item?.conversa_id ?? item?.conversaId ?? ""))
        .filter(Boolean);
      setPendentesFuncionarioIds(ids);
    } catch {
      setPendentesFuncionarioIds([]);
    }
  }, [user]);

  /** Primeira carga de supervisão vem após GET principal (runSecondaryRefreshes); aqui só o polling periódico. */
  useEffect(() => {
    if (!isSupervisorOrAdmin(user)) return undefined;
    let intervalId;
    const delay = isMobileLayout ? MOBILE_SUPERVISAO_POLL_DELAY_MS : 800;
    const cancelSchedule = scheduleAfterInitialPaint(() => {
      intervalId = window.setInterval(() => {
        void runAuxBadgeFetch(filterScopeKey, "supervisao", () => refreshSupervisaoData());
      }, 30000);
    }, delay);
    return () => {
      cancelSchedule();
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [user, refreshSupervisaoData, filterScopeKey, isMobileLayout]);

  async function load(opts = {}) {
    if (loadInFlightRef.current) {
      const foreground = opts.background !== true;
      if (!foreground) {
        loadQueuedRef.current = { background: true };
        return;
      }
      setZapFilterSkeleton(true);
    }
    loadInFlightRef.current = true;
    const requestId = ++loadRequestIdRef.current;
    loadAbortRef.current?.abort();
    const abortController = new AbortController();
    loadAbortRef.current = abortController;
    loadSecondaryScheduleCancelRef.current?.();
    loadSecondaryScheduleCancelRef.current = null;
    const hasVisibleChats = (useChatStore.getState().chats?.length ?? 0) > 0;
    const background =
      opts.background === true || (opts.background !== false && hasVisibleChats);
    if (!background) {
      setLoading(true);
      setListRefreshing((prev) => (prev ? false : prev));
    } else {
      setListRefreshing((prev) => (prev ? prev : true));
    }
    try {
      /** Modo admin por funcionário: prioridade sobre status/minha_fila/atendente dos filtros avançados — ver chatsFiltrados. */
      const adminPorFuncionario =
        adminAtendenteFilterId != null && String(adminAtendenteFilterId).trim() !== "";

      const finalAutoQuery = tab === "finalizadas_auto" || onlyFinalizadasAusencia;
      const aguardandoQuery = tab === "aguardando_cliente" || aguardandoClienteOnly;
      const pagamentoPendenteQuery =
        isFinanceiroUser && (tab === "pagamentos_pendentes" || pagamentosPendentesOnly);
      const emAtrasoQuery = isFinanceiroUser && (tab === "em_atraso" || emAtrasoOnly);
      const searchTerm = String(debouncedSearch || "").trim();
      const includeAllForSearch = searchTerm ? "1" : undefined;

      let params;
      if (adminPorFuncionario) {
        /** Contrato API: `atendente_id` numérico (usuarios.id); omitir status_atendimento / minha_fila. */
        const aid = Number(adminAtendenteFilterId);
        const atendenteIdQuery =
          Number.isFinite(aid) && aid > 0 ? aid : adminAtendenteFilterId;
        params = {
          atendente_id: atendenteIdQuery,
          tag_id: tagFilter !== "todas" ? tagFilter : undefined,
          departamento_id: departamentoFilter !== "todos" ? departamentoFilter : undefined,
          data_inicio: dataInicio || undefined,
          data_fim: dataFim || undefined,
          palavra: searchTerm || undefined,
          incluir_todos_clientes: includeAllForSearch,
          limit: CHAT_LIST_PAGE_LIMIT,
        };
        if (finalAutoQuery) {
          params.finalizacao_motivo = "ausencia_cliente";
        }
        if (aguardandoQuery) {
          params.aguardando_cliente = "1";
        }
      } else {
        params = {
          tag_id: tagFilter !== "todas" ? tagFilter : undefined,
          departamento_id: departamentoFilter !== "todos" ? departamentoFilter : undefined,
          status_atendimento: statusFilter !== "todos" ? statusFilter : undefined,
          atendente_id: atendenteFilter !== "todos" ? atendenteFilter : undefined,
          data_inicio: dataInicio || undefined,
          data_fim: dataFim || undefined,
          palavra: searchTerm || undefined,
          incluir_todos_clientes: includeAllForSearch,
          limit: CHAT_LIST_PAGE_LIMIT,
        };
        if (tab === "minha_fila") {
          params.minha_fila = "1";
          delete params.status_atendimento;
          if (finalAutoQuery) {
            params.status_atendimento = "fechada";
            params.finalizacao_motivo = "ausencia_cliente";
          }
        } else if (aguardandoQuery) {
          params.aguardando_cliente = "1";
          delete params.status_atendimento;
          // Escopo por sessão; atendente_id só quando gestor usa "Por funcionário".
          delete params.atendente_id;
        } else if (pagamentoPendenteQuery) {
          params.pagamento_pendente = "1";
          delete params.status_atendimento;
          delete params.atendente_id;
        } else if (emAtrasoQuery) {
          params.em_atraso = "1";
          delete params.status_atendimento;
          delete params.atendente_id;
        } else if (finalAutoQuery) {
          params.status_atendimento = "fechada";
          params.finalizacao_motivo = "ausencia_cliente";
        } else if (tab === "abertas") {
          params.status_atendimento = "aberta";
        } else if (tab === "em_atendimento") {
          params.status_atendimento = "em_atendimento";
        } else if (tab === "finalizadas") {
          params.status_atendimento = "fechada";
        } else if (tab === "hoje") {
          params.hoje = "1";
          delete params.status_atendimento;
        } else if (tab === "mensagens_disparadas" && separarMensagensDisparadasLigado) {
          params.status_atendimento = "mensagem_disparada";
        } else if (tab === "aguardando_funcionario" && isSupervisorOrAdmin(user)) {
          const ids = (pendentesFuncionarioIdsRef.current || [])
            .map((x) => Number(x))
            .filter((n) => Number.isFinite(n) && n > 0);
          params.conversa_ids = ids.length > 0 ? ids.join(",") : "0";
          delete params.status_atendimento;
          delete params.atendente_id;
        }
      }

      if (tempoParadoFilter) params.tempo_parado = tempoParadoFilter;
      if (conversaIdsPendenciaQuery != null) {
        params.conversa_ids = conversaIdsPendenciaQuery;
      }
      lastListParamsRef.current = { ...params };

      /** Lista estrita: só o que a API devolveu — o merge com `prev` não pode reintroduzir conversas de outras abas. */
      const strictMensagemDisparadaQuery =
        separarMensagensDisparadasLigado &&
        String(params.status_atendimento || "").toLowerCase() === "mensagem_disparada";

      const minhaFilaTab = !adminPorFuncionario && tab === "minha_fila";
      if (!background && isMobileLayout) {
        const cachedRows = hydrateChatListRowsForFilterFromSession(filterScopeKey, filterRequestKey);
        if (cachedRows?.length) {
          const cachedList = sortChatRowsByOrder(dedupeChatRowsByStableKey(cachedRows), order);
          if (minhaFilaTab) {
            setMinhaFilaList((prev) => (Array.isArray(prev) && prev.length > 0 ? prev : cachedList));
            setChats((prev) => (Array.isArray(prev) && prev.length > 0 ? prev : cachedList));
          } else {
            setChats((prev) => (Array.isArray(prev) && prev.length > 0 ? prev : cachedList));
          }
        }
      }
      const data = await fetchChats(params, { signal: abortController.signal });
      if (requestId !== loadRequestIdRef.current) return;
      let list = Array.isArray(data) ? data : [];
      if (minhaFilaTab || TABS_HIDE_OPTIMISTIC_CLOSED.has(String(tabRef.current || ""))) {
        list = filterOptimisticRemovedMinhaFila(list);
      }
      const pageState = buildChatListPageState(data);
      setChatListPage(pageState);
      if (pageState.totalCount != null) {
        setActiveListTotalCount(pageState.totalCount);
      }
      if (!adminPorFuncionario && mineOnly && user?.id && !isAppAdmin(user)) {
        list = list.filter((c) => String(c.atendente_id) === String(user.id));
      }
      // Desduplicar por id (conversas) ou por cliente_id (clientes sem conversa) — NÃO descartar itens com id null
      list = sortChatRowsByOrder(dedupeChatRowsByStableKey(list), order);
      if (!adminPorFuncionario && tabRef.current === "minha_fila") {
        setMinhaFilaList(list);
      }
      // Merge defensivo: nunca sobrescrever contato_nome/foto_perfil com undefined ou string vazia. Preserva chats locais não retornados pela API.
      setChats((prev) => {
        if (requestId !== loadRequestIdRef.current) return prev;
        const arr = Array.isArray(prev) ? prev : [];
        const byIdPrev = new Map(arr.map((c) => [String(c.id), c]));
        const fromApi = new Set(list.map((c) => String(c?.id)).filter(Boolean));
        const nomeUsuario = (user?.nome ?? user?.name ?? "").trim().toLowerCase();
        const merged = list.map((c) => {
          const existing = c?.id != null ? byIdPrev.get(String(c.id)) : null;
          let nomeApi = (c?.contato_nome ?? c?.nome ?? "").trim();
          const nomeContatoCache = (c?.nome_contato_cache ?? "").trim();
          const nomeCliente = (c?.cliente?.nome ?? c?.clientes?.nome ?? "").trim();
          if (nomeUsuario && nomeApi.toLowerCase() === nomeUsuario) {
            nomeApi = nomeContatoCache || nomeCliente || nomeApi;
          }
          const nomeJaExiste = (existing?.contato_nome || existing?.nome || "").trim();
          const contato_nome = nomeApi || nomeJaExiste || nomeContatoCache || nomeCliente || existing?.contato_nome || c?.contato_nome || c?.nome;
          const fotoApi = c?.foto_perfil != null && String(c.foto_perfil).trim().startsWith("http") ? String(c.foto_perfil).trim() : null;
          const fotoExisting = existing?.foto_perfil && String(existing.foto_perfil).trim().startsWith("http") ? String(existing.foto_perfil).trim() : null;
          const foto_perfil = fotoApi ?? (c?.foto_perfil === null ? null : fotoExisting);
          const uApi = c?.ultima_mensagem;
          const uPrev = existing?.ultima_mensagem;
          const sameMsg = uPrev && uApi && (String(uPrev.id) === String(uApi.id) || String(uPrev.whatsapp_id) === String(uApi.whatsapp_id) || (uPrev.criado_em && uApi.criado_em && String(uPrev.criado_em) === String(uApi.criado_em)));
          const ultima = (sameMsg && uPrev) ? { ...uApi, ...uPrev } : uApi || uPrev;
          return {
            ...c,
            contato_nome,
            foto_perfil,
            nome_grupo: c?.nome_grupo || existing?.nome_grupo,
            cliente: c?.cliente || existing?.cliente,
            ultima_mensagem: ultima,
            ultima_atividade: ultima?.criado_em || c?.ultima_atividade || existing?.ultima_atividade,
          };
        });
        const extra = arr.filter((c) => c?.id != null && !fromApi.has(String(c.id)));
        const strictListTabs = new Set([
          "todas",
          "minha_fila",
          "hoje",
          "abertas",
          "em_atendimento",
          "finalizadas",
          "finalizadas_auto",
          "aguardando_cliente",
          "aguardando_funcionario",
          "pagamentos_pendentes",
          "em_atraso",
        ]);
        if (tab === "em_atendimento" && background) {
          return mergeEmAtendimentoBackgroundRows(arr, merged, order, {
            user,
            adminAtendenteFilterId,
            pendentesFuncionarioSet,
          });
        }
        if (strictListTabs.has(tab)) return merged;
        if (aguardandoQuery) return merged;
        if (tempoParadoFilter) return merged;
        if (strictMensagemDisparadaQuery) return merged;
        if (extra.length === 0) return merged;
        const getTs = (x) => x?.ultima_mensagem?.criado_em || x?.ultima_atividade || x?.criado_em || 0;
        const combined = [...merged, ...extra];
        combined.sort((a, b) => (order === "antigas" ? getTs(a) - getTs(b) : getTs(b) - getTs(a)));
        return combined;
      });
      if (requestId === loadRequestIdRef.current) {
        if (!background) markPushEntryReady();
        if (isMobileLayout && list.length > 0) {
          persistChatListRowsForFilterToSession(filterScopeKey, filterRequestKey, list);
        }
        const storeChats = useChatStore.getState().chats || [];
        persistChatListSidebarToSession(filterScopeKey, storeChats, {
          emAtendimentoBadgeCount,
          aguardandoClienteBadgeCount,
          mensagensDisparadasCount,
        });
      }
      const rid = requestId;
      const minhaFilaAuxPrimed =
        !adminPorFuncionario && tabRef.current === "minha_fila";
      const runSecondaryRefreshes = () => {
        if (rid !== loadRequestIdRef.current) return;
        const scope = filterScopeKey;
        void runAuxBadgeFetch(scope, "chatCounts", () => refreshChatFilterCounts({ silent: true }));
        void runAuxBadgeFetch(scope, "supervisao", () => refreshSupervisaoData());
        void refreshMinhasPendenciasRef.current?.();
      };
      if (minhaFilaAuxPrimed) {
        persistChatListSidebarToSession(filterScopeKey, useChatStore.getState().chats || [], {
          minhaFila: list,
          chatFilterCounts,
        });
      }
      const secondaryRefreshDelay = isMobileLayout
        ? MOBILE_SECONDARY_REFRESH_DELAY_MS
        : tabRef.current === "todas" ? 450 : 120;
      loadSecondaryScheduleCancelRef.current = scheduleAfterInitialPaint(
        runSecondaryRefreshes,
        secondaryRefreshDelay
      );
    } catch (e) {
      if (isAbortError(e)) return;
      if (requestId !== loadRequestIdRef.current) return;
      if (!isNetworkError(e)) {
        console.error("Erro ao carregar conversas:", e);
      }
      if (!(useChatStore.getState().chats?.length > 0)) {
        setChats([]);
      }
      setChatListPage((prev) => ({
        ...prev,
        loading: false,
        error: e?.response?.data?.error || e?.message || "Erro ao carregar conversas.",
      }));
    } finally {
      if (requestId === loadRequestIdRef.current) {
        setLoading(false);
        setListRefreshing((prev) => (prev ? false : prev));
        setZapFilterSkeleton(false);
        lastLoadFinishedAtRef.current = Date.now();
        loadInFlightRef.current = false;
        if (loadQueuedRef.current) {
          const queuedOpts = loadQueuedRef.current;
          loadQueuedRef.current = null;
          queueMicrotask(() => loadRef.current?.(queuedOpts));
        }
      }
    }
  }

  useEffect(() => {
    load();
  }, [
    tab,
    debouncedSearch,
    tagFilter,
    departamentoFilter,
    statusFilter,
    atendenteFilter,
    dataInicio,
    dataFim,
    mineOnly,
    order,
    adminAtendenteFilterId,
    onlyFinalizadasAusencia,
    aguardandoClienteOnly,
    pagamentosPendentesOnly,
    emAtrasoOnly,
    tempoParadoFilter,
    conversaIdsPendenciaQuery,
    separarMensagensDisparadasLigado,
    isFinanceiroUser,
    filterScopeKey,
  ]);

  // loadRef para sync/interval — deve estar definido antes dos effects que o usam
  const loadRef = useRef(load);
  loadRef.current = load;

  const handleLoadMoreChats = useCallback(async () => {
    const page = chatListPageRef.current;
    const baseParams = lastListParamsRef.current;
    if (!baseParams || !page?.hasMore || !page?.nextCursor || page.loading) return;

    const requestId = loadRequestIdRef.current;
    setChatListPage((prev) => ({ ...prev, loading: true, error: "" }));

    try {
      const data = await fetchChats(
        {
          ...baseParams,
          cursor: page.nextCursor,
          cursorId: page.nextCursorId,
          limit: CHAT_LIST_PAGE_LIMIT,
        },
        { signal: loadAbortRef.current?.signal }
      );
      if (requestId !== loadRequestIdRef.current) return;

      const adminPorFuncionario =
        adminAtendenteFilterId != null && String(adminAtendenteFilterId).trim() !== "";
      let list = Array.isArray(data) ? data : [];
      if (TABS_HIDE_OPTIMISTIC_CLOSED.has(String(tabRef.current || ""))) {
        list = filterOptimisticRemovedMinhaFila(list);
      }
      if (!adminPorFuncionario && mineOnly && user?.id && !isAppAdmin(user)) {
        list = list.filter((c) => String(c.atendente_id) === String(user.id));
      }
      list = sortChatRowsByOrder(dedupeChatRowsByStableKey(list), order);
      setChatListPage(buildChatListPageState(data));

      if (!adminPorFuncionario && tabRef.current === "minha_fila") {
        setMinhaFilaList((prev) => {
          const merged = mergeChatRowsPreservingCurrent(prev || [], list, order);
          persistChatListSidebarToSession(filterScopeKey, useChatStore.getState().chats || [], {
            minhaFila: merged,
          });
          return merged;
        });
        return;
      }

      setChats((prev) => mergeChatRowsPreservingCurrent(prev || [], list, order));
      persistChatListSidebarToSession(filterScopeKey, useChatStore.getState().chats || [], {
        emAtendimentoBadgeCount,
        aguardandoClienteBadgeCount,
        mensagensDisparadasCount,
      });
    } catch (e) {
      if (isAbortError(e)) return;
      const msg =
        e?.response?.data?.error ||
        e?.response?.data?.message ||
        e?.message ||
        "Não foi possível carregar mais conversas.";
      setChatListPage((prev) => ({ ...prev, loading: false, error: String(msg) }));
    }
  }, [
    adminAtendenteFilterId,
    mineOnly,
    user?.id,
    order,
    setChats,
    filterScopeKey,
    emAtendimentoBadgeCount,
    aguardandoClienteBadgeCount,
    mensagensDisparadasCount,
    filterOptimisticRemovedMinhaFila,
  ]);

  useEffect(() => {
    return () => {
      loadSecondaryScheduleCancelRef.current?.();
      loadSecondaryScheduleCancelRef.current = null;
    };
  }, []);

  const handleLoteAusenciaSimular = useCallback(async () => {
    setLoteAusenciaMsg("");
    const ids = collectEmAtendimentoIdsFromChats(useChatStore.getState().chats);
    if (!ids.length) {
      setLoteAusenciaMsg("Nenhuma conversa em atendimento na lista atual.");
      return;
    }
    setLoteAusenciaBusy(true);
    try {
      const r = await postFinalizacaoAusenciaLote({ conversa_ids: ids, dry_run: true });
      const res = Array.isArray(r?.resultados) ? r.resultados : [];
      const ok = res.filter((x) => x.ok).length;
      setLoteAusenciaMsg(`Simulação: ${ok} de ${ids.length} conversa(s) elegível(is) ao critério do servidor.`);
    } catch (e) {
      const msg = e?.response?.data?.error || e?.message || "Falha na simulação";
      showToast({ type: "error", title: "Lote por ausência", message: String(msg) });
      setLoteAusenciaMsg(String(msg));
    } finally {
      setLoteAusenciaBusy(false);
    }
  }, [showToast]);

  const handleLoteAusenciaExecutar = useCallback(async () => {
    setLoteAusenciaMsg("");
    const ids = collectEmAtendimentoIdsFromChats(useChatStore.getState().chats);
    if (!ids.length) {
      setLoteAusenciaMsg("Nenhuma conversa em atendimento na lista atual.");
      return;
    }
    if (String(loteAusenciaConfirm).trim() !== CONFIRM_LOTE_AUSENCIA) {
      showToast({
        type: "info",
        title: "Confirmação necessária",
        message: `Digite exatamente: ${CONFIRM_LOTE_AUSENCIA}`,
      });
      return;
    }
    setLoteAusenciaBusy(true);
    try {
      const r = await postFinalizacaoAusenciaLote({
        conversa_ids: ids,
        dry_run: false,
        execute: true,
        confirm: CONFIRM_LOTE_AUSENCIA,
      });
      const res = Array.isArray(r?.resultados) ? r.resultados : [];
      const ok = res.filter((x) => x.ok).length;
      setLoteAusenciaMsg(`Concluído: ${ok} conversa(s) processada(s).`);
      setLoteAusenciaConfirm("");
      loadRef.current?.();
    } catch (e) {
      const msg = e?.response?.data?.error || e?.message || "Falha na execução";
      showToast({ type: "error", title: "Lote por ausência", message: String(msg) });
      setLoteAusenciaMsg(String(msg));
    } finally {
      setLoteAusenciaBusy(false);
    }
  }, [showToast, loteAusenciaConfirm]);

  const chatListResyncNonce = useChatStore((s) => s.chatListResyncNonce);
  useEffect(() => {
    if (!chatListResyncNonce) return;
    if (loadInFlightRef.current) {
      loadQueuedRef.current = { background: true };
      void refreshChatFilterCounts({ silent: true });
      if (isMobileLayout) clearChatListRowsFilterSessionCache(filterScopeKey);
      return;
    }
    const hasVisibleChats = (useChatStore.getState().chats?.length ?? 0) > 0;
    if (hasVisibleChats && Date.now() - lastLoadFinishedAtRef.current < 2500) {
      void refreshChatFilterCounts({ silent: true });
      if (isMobileLayout) clearChatListRowsFilterSessionCache(filterScopeKey);
      return;
    }
    loadRef.current?.({ background: true });
    void refreshChatFilterCounts({ silent: true });
    if (isMobileLayout) clearChatListRowsFilterSessionCache(filterScopeKey);
  }, [chatListResyncNonce, refreshChatFilterCounts, isMobileLayout, filterScopeKey]);

  /** Supervisão: ao atualizar IDs pendentes, refetch da aba "Aguardando atendente". */
  useEffect(() => {
    if (tabRef.current !== "aguardando_funcionario") return;
    if (!isSupervisorOrAdmin(user)) return;
    loadRef.current?.({ background: true });
  }, [pendentesFuncionarioIds, user]);

  const chatListOptimisticMutationNonce = useChatStore((s) => s.chatListOptimisticMutationNonce);
  useEffect(() => {
    if (!chatListOptimisticMutationNonce) return;
    const mutation = useChatStore.getState().chatListOptimisticMutation;
    if (!mutation?.id) return;
    const id = String(mutation.id);
    const patch = mutation.patch && typeof mutation.patch === "object" ? mutation.patch : null;
    const hideClosedFromActiveList = shouldHideOptimisticClosedFromTab(tabRef.current, mutation);

    if (hideClosedFromActiveList) {
      setChats((prev) => (Array.isArray(prev) ? prev.filter((c) => String(c?.id) !== id) : []));
    } else if (patch) {
      setChats((prev) =>
        (Array.isArray(prev) ? prev : []).map((c) =>
          String(c?.id) === id
            ? {
                ...c,
                ...patch,
                tags: Array.isArray(patch.tags) ? patch.tags : c.tags,
              }
            : c
        )
      );
      const currentMinhaFila = Array.isArray(minhaFilaListRef.current) ? minhaFilaListRef.current : null;
      if (currentMinhaFila?.some((c) => String(c?.id) === id)) {
        setMinhaFilaList(
          currentMinhaFila.map((c) =>
            String(c?.id) === id
              ? {
                  ...c,
                  ...patch,
                  tags: Array.isArray(patch.tags) ? patch.tags : c.tags,
                }
              : c
          )
        );
      }
    }

    if (mutation.removeFromMinhaFila) {
      const current = Array.isArray(minhaFilaListRef.current) ? minhaFilaListRef.current : null;
      const rowForRestore = mutation.row || (patch ? { id, ...patch } : null);
      const existingRemovedEntry = optimisticRemovedMinhaFilaRef.current.get(id);
      const removalReason =
        existingRemovedEntry?.reason === "encerrar_conversa" ? "encerrar_conversa" : mutation.type || null;
      const removalExpiresAt =
        existingRemovedEntry?.reason === "encerrar_conversa" && existingRemovedEntry?.expiresAt != null
          ? existingRemovedEntry.expiresAt
          : Date.now() + OPTIMISTIC_MINHA_FILA_REMOVE_TTL_MS;
      if (rowForRestore) {
        optimisticRemovedMinhaFilaRef.current.set(id, {
          row: rowForRestore,
          reason: removalReason,
          expiresAt: removalExpiresAt,
        });
      }
      if (current) {
        const removed = current.find((c) => String(c?.id) === id);
        const next = current.filter((c) => String(c?.id) !== id);
        if (removed) {
          optimisticRemovedMinhaFilaRef.current.set(id, {
            row: removed,
            reason: removalReason,
            expiresAt: removalExpiresAt,
          });
        }
        if (removed && next.length !== current.length) {
          setMinhaFilaList(next);
          const nextCount = countDistinctConversas(next);
          setMinhaFilaCount((prev) => (prev === nextCount ? prev : nextCount));
        }
      }
    }

    if (mutation.restoreMinhaFila) {
      const removedEntry = optimisticRemovedMinhaFilaRef.current.get(id);
      const isCloseTombstone = removedEntry?.reason === "encerrar_conversa";
      const isAllowedCloseRestore =
        mutation.type === "encerrar_conversa_revert" || mutation.type === "reabrir_conversa";
      if (isCloseTombstone && !isAllowedCloseRestore) {
        return;
      }
      optimisticRemovedMinhaFilaRef.current.delete(id);
      const current = Array.isArray(minhaFilaListRef.current) ? minhaFilaListRef.current : [];
      if (!current.some((c) => String(c?.id) === id)) {
        const restored = mutation.row || getOptimisticRemovedRow(removedEntry);
        if (restored) {
          const next = [restored, ...current];
          setMinhaFilaList(next);
          const nextCount = countDistinctConversas(next);
          setMinhaFilaCount((prev) => (prev === nextCount ? prev : nextCount));
        }
      }
    }
  }, [chatListOptimisticMutationNonce, setChats]);

  useEffect(() => {
    function onSyncContatos() {
      loadRef.current?.();
    }
    window.addEventListener("zapi_sync_contatos", onSyncContatos);
    return () => window.removeEventListener("zapi_sync_contatos", onSyncContatos);
  }, []);

  const applyFiltersDataToState = useCallback((data) => {
    setAllTags(data?.tags ?? []);
    setAtendentes(data?.atendentes ?? []);
    setDepartamentos(data?.departamentos ?? []);
  }, []);

  /**
   * Departamentos no mount: chips/filtros Financeiro dependem do nome "Financeiro" na lista.
   * Antes só carregava ao abrir o painel de filtros ou após F5 (sessionStorage).
   */
  useEffect(() => {
    if (!filterScopeKey) return undefined;
    financeiroBadgesPrimedRef.current = false;
    const cached = getChatListFiltersDataCache();
    if (Array.isArray(cached?.departamentos) && cached.departamentos.length > 0) {
      setDepartamentos(cached.departamentos);
      return undefined;
    }
    let cancelled = false;
    const run = () => {
      loadChatListFiltersDataOnce({ listarTags, api, scopeKey: filterScopeKey }).then((data) => {
        if (cancelled || !data) return;
        if (Array.isArray(data.departamentos) && data.departamentos.length > 0) {
          setDepartamentos(data.departamentos);
        }
      });
    };
    if (isMobileLayout) {
      const cancel = scheduleAfterInitialPaint(run, MOBILE_FILTERS_BOOT_DELAY_MS);
      return () => {
        cancelled = true;
        cancel();
      };
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [filterScopeKey, isMobileLayout]);

  useEffect(() => {
    if (!filterScopeKey) return undefined;
    if (isMobileLayout && !hasListRows) {
      mobileCountsBootSkippedRef.current = true;
      return undefined;
    }
    if (isMobileLayout && mobileCountsBootSkippedRef.current) {
      mobileCountsBootSkippedRef.current = false;
      return undefined;
    }
    let cancelled = false;
    const delay = isMobileLayout ? MOBILE_COUNTS_DELAY_MS : 0;
    const run = () => {
      if (!cancelled) void refreshChatFilterCounts();
    };
    if (delay > 0) {
      const cancel = scheduleAfterInitialPaint(run, delay);
      return () => {
        cancelled = true;
        cancel();
      };
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [
    filterScopeKey,
    tagFilter,
    departamentoFilter,
    dataInicio,
    dataFim,
    debouncedSearch,
    adminAtendenteFilterId,
    refreshChatFilterCounts,
    isMobileLayout,
    hasListRows,
  ]);

  /** Tags/atendentes/setores: sob demanda ao abrir painel; fetch imediato se cache incompleto. */
  useEffect(() => {
    if (!showFilters) return undefined;
    const cached = getChatListFiltersDataCache();
    if (cached.tags != null) setAllTags(cached.tags);
    if (cached.atendentes != null) setAtendentes(cached.atendentes);
    if (cached.departamentos != null) setDepartamentos(cached.departamentos);
    if (cached.tags != null && cached.atendentes != null && cached.departamentos != null) {
      setFiltersAuxLoading(false);
      return undefined;
    }
    let cancelled = false;
    setFiltersAuxLoading(true);
    loadChatListFiltersDataOnce({ listarTags, api, scopeKey: filterScopeKey })
      .then((data) => {
        if (cancelled) return;
        applyFiltersDataToState(data);
      })
      .finally(() => {
        if (!cancelled) setFiltersAuxLoading(false);
      });
    return () => {
      cancelled = true;
      setFiltersAuxLoading(false);
    };
  }, [showFilters, filterScopeKey, applyFiltersDataToState]);

  /** Pré-aquece tags/atendentes em idle (departamentos já no mount para chips Financeiro). */
  useEffect(() => {
    if (listLoading && !hasListRows) return undefined;
    const cached = getChatListFiltersDataCache();
    if (cached.tags != null && cached.atendentes != null && cached.departamentos != null) {
      return undefined;
    }
    let cancelled = false;
    const delay = isMobileLayout
      ? MOBILE_FILTERS_PREWARM_DELAY_MS
      : hasListRows ? 400 : 900;
    const cancel = scheduleAfterInitialPaint(() => {
      loadChatListFiltersDataOnce({ listarTags, api, scopeKey: filterScopeKey }).then((data) => {
        if (cancelled) return;
        if (Array.isArray(data?.departamentos) && data.departamentos.length > 0) {
          setDepartamentos((prev) => (prev.length > 0 ? prev : data.departamentos));
        }
      });
    }, delay);
    return () => {
      cancelled = true;
      cancel();
    };
  }, [listLoading, hasListRows, filterScopeKey, isMobileLayout]);

  /** Admin “Por funcionário”: só /usuarios, ao abrir o painel (não no mount). */
  useEffect(() => {
    if (!adminAtendentePanelOpen || !isAppAdmin(user)) return undefined;
    const cached = getChatListFiltersDataCache();
    if (cached.atendentes != null) {
      if (atendentes.length === 0) setAtendentes(cached.atendentes);
      return undefined;
    }
    let cancelled = false;
    loadChatListAtendentesOnce(api, filterScopeKey).then((list) => {
      if (!cancelled) setAtendentes(list);
    });
    return () => {
      cancelled = true;
    };
  }, [adminAtendentePanelOpen, user, atendentes.length, filterScopeKey]);

  // atalhos
  useEffect(() => {
    function onKeyDown(e) {
      const k = e.key.toLowerCase();

      if (e.ctrlKey && k === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }

      if (e.ctrlKey && k === "f") {
        e.preventDefault();
        setShowFilters((v) => !v);
      }

      if (k === "escape") {
        if (novoContatoModalOpen) {
          setNovoContatoModalOpen(false);
          return;
        }
        if (adminAtendentePanelOpen) {
          setAdminAtendentePanelOpen(false);
          return;
        }
        // ESC: fecha filtros e limpa busca
        clearAdminAtendenteFilter();
        setShowFilters(false);
        setSearchClearNonce((n) => n + 1);
        setDebouncedSearch("");
        setStatusFilter("todos");
        setTagFilter("todas");
        setDepartamentoFilter("todos");
        setMineOnly(false);
        setOrder("recentes");
        setTab("minha_fila");
        setTempoParadoFilter("");
        setLoteAusenciaMsg("");
        setLoteAusenciaConfirm("");
        setShowNovoMenu(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    novoContatoModalOpen,
    adminAtendentePanelOpen,
    setAdminAtendentePanelOpen,
    clearAdminAtendenteFilter,
  ]);

  // posiciona menu abaixo do botão Novo
  useEffect(() => {
    if (!showNovoMenu || !novoBtnRef.current) return;
    const updatePosition = () => {
      const btn = novoBtnRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const menuWidth = Math.min(240, Math.max(160, window.innerWidth - 16));
      const left = Math.min(
        Math.max(8, rect.right - menuWidth),
        Math.max(8, window.innerWidth - menuWidth - 8)
      );
      const top = Math.min(
        Math.max(8, rect.bottom + 6),
        Math.max(8, window.innerHeight - 168)
      );
      setMenuPosition({ top, left, width: menuWidth });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [showNovoMenu]);

  // fecha menu "Novo" ao clicar fora
  useEffect(() => {
    if (!showNovoMenu) return;

    function onPointerDown(e) {
      const btn = novoBtnRef.current;
      const menu = novoMenuRef.current;
      const target = e.target;
      if (!target) return;

      if (btn && btn.contains(target)) return;
      if (menu && menu.contains(target)) return;

      setShowNovoMenu(false);
    }

    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [showNovoMenu]);

  const emitNovoAction = useCallback(
    (type) => {
      setShowNovoMenu(false);

      if (type === "novo_contato") {
        setNovoContatoModalOpen(true);
        return;
      }

      const routes = {
        novo_grupo: "/atendimento/novo-grupo",
        nova_comunidade: "/atendimento/nova-comunidade",
      };

      const path = routes[type];
      if (path) navigate(path);
    },
    [navigate]
  );

  const handleToggleNovoMenu = useCallback((e) => {
    e.stopPropagation();
    setShowNovoMenu((v) => !v);
  }, []);

  const handleToggleFilters = useCallback(() => {
    setShowFilters((v) => !v);
  }, []);

  const handleOpenProdutos = useCallback(() => {
    setShowProdutosPanel(true);
  }, []);

  const handleNovoContatoMenu = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      emitNovoAction("novo_contato");
    },
    [emitNovoAction]
  );

  const handleNovoGrupoMenu = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      emitNovoAction("novo_grupo");
    },
    [emitNovoAction]
  );

  const handleNovaComunidadeMenu = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      emitNovoAction("nova_comunidade");
    },
    [emitNovoAction]
  );

  const handleSelecionarConversa = useCallback((chatId) => {
    if (chatId == null || chatId === undefined || chatId === "") return;
    const st = useConversaStore.getState();
    if (
      String(st.selectedId ?? "") === String(chatId) &&
      st.conversa?.id != null &&
      String(st.conversa.id) === String(chatId) &&
      !st.loading &&
      !st.loadError
    ) {
      return;
    }
    if (isMobileLayout) {
      scrollSaveRef.current = scrollRef.current?.scrollTop ?? 0;
    }
    carregarConversa(chatId);
  }, [carregarConversa, isMobileLayout]);

  const handleOpenClienteSemConversa = useCallback(async (cliente_id, whatsapp_instance_id) => {
    if (!cliente_id) return;
    try {
      const { conversa } = await abrirConversaCliente(cliente_id, whatsapp_instance_id);
      if (conversa?.id) {
        addChat(conversa);
        if (typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches) {
          scrollSaveRef.current = 0;
          if (scrollRef.current) scrollRef.current.scrollTop = 0;
        }
        carregarConversa(conversa.id);
      }
    } catch (e) {
      console.error("Erro ao abrir conversa do cliente:", e);
    }
  }, [addChat, carregarConversa]);

  const onRequestConfirmClear = useCallback((payload) => {
    setConfirmClear(payload);
  }, []);

  const onRequestConfirmDelete = useCallback((payload) => {
    setConfirmDelete(payload);
  }, []);

  const onReloadList = useCallback(() => {
    loadRef.current?.({ background: true });
  }, []);

  const runConfirmedClear = useCallback(async () => {
    if (!confirmClear?.chatId) return;
    const { chatId, isOpenConversation } = confirmClear;
    setConfirmClear(null);
    try {
      await clearConversation(chatId);
      useChatStore.getState().updateChat({
        id: chatId,
        ultima_mensagem: null,
        ultima_mensagem_preview: null,
        unread_count: 0,
        tem_novas_mensagens: false,
        tem_novas_mensagens_em_atendimento: false,
      });
      if (isOpenConversation) {
        useConversaStore.setState({ mensagens: [] });
      }
      showToast({
        type: "success",
        title: "Conversa limpa",
        message: "As mensagens foram removidas com sucesso.",
      });
      loadRef.current?.();
    } catch (e) {
      const msg = e?.response?.data?.error || e?.response?.data?.message || e?.message || "Não foi possível limpar a conversa.";
      showToast({ type: "error", title: "Falha ao limpar", message: msg });
      loadRef.current?.();
    }
  }, [confirmClear, showToast]);

  const runConfirmedDelete = useCallback(async () => {
    if (!confirmDelete?.chatId) return;
    const { chatId, isOpenConversation } = confirmDelete;
    setConfirmDelete(null);
    try {
      await deleteConversation(chatId);
      useChatStore.getState().removeChat(chatId);
      if (isOpenConversation) {
        useConversaStore.setState({
          selectedId: null,
          conversa: null,
          mensagens: [],
          tags: [],
        });
      }
      showToast({
        type: "success",
        title: "Conversa apagada",
        message: "A conversa foi removida da lista.",
      });
      loadRef.current?.();
    } catch (e) {
      const msg = e?.response?.data?.error || e?.response?.data?.message || e?.message || "Não foi possível apagar a conversa.";
      showToast({ type: "error", title: "Falha ao apagar", message: msg });
      loadRef.current?.();
    }
  }, [confirmDelete, showToast]);

  const adminPorFuncionarioAtivo =
    adminAtendenteFilterId != null && String(adminAtendenteFilterId).trim() !== "";

  const showSetorFilter = isAppAdmin(user);
  const showAusenciaLote = isSupervisorOrAdmin(user);

  const handleOnlyFinalizadasAusenciaChange = useCallback((on) => {
    setOnlyFinalizadasAusencia(on);
    if (on) setStatusFilter("fechada");
  }, []);

  const advancedFiltersSlot = useMemo(
    () => (
      <ChatListAdvancedFiltersPanel
        open={showFilters}
        filtersAuxLoading={filtersAuxLoading}
        separarMensagensDisparadasLigado={separarMensagensDisparadasLigado}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        tagFilter={tagFilter}
        onTagFilterChange={setTagFilter}
        allTags={allTags}
        showSetorFilter={showSetorFilter}
        departamentoFilter={departamentoFilter}
        onDepartamentoFilterChange={setDepartamentoFilter}
        departamentos={departamentos}
        atendenteFilter={atendenteFilter}
        onAtendenteFilterChange={setAtendenteFilter}
        atendentes={atendentes}
        dataInicio={dataInicio}
        onDataInicioChange={setDataInicio}
        dataFim={dataFim}
        onDataFimChange={setDataFim}
        mineOnly={mineOnly}
        onMineOnlyChange={setMineOnly}
        onlyFinalizadasAusencia={onlyFinalizadasAusencia}
        onOnlyFinalizadasAusenciaChange={handleOnlyFinalizadasAusenciaChange}
        aguardandoClienteOnly={aguardandoClienteOnly}
        onAguardandoClienteOnlyChange={setAguardandoClienteOnly}
        showFinanceiroFilters={isFinanceiroUser}
        pagamentosPendentesOnly={pagamentosPendentesOnly}
        onPagamentosPendentesOnlyChange={setPagamentosPendentesOnly}
        emAtrasoOnly={emAtrasoOnly}
        onEmAtrasoOnlyChange={setEmAtrasoOnly}
        order={order}
        onOrderChange={setOrder}
        tempoParadoFilter={tempoParadoFilter}
        onTempoParadoFilterChange={setTempoParadoFilter}
        showAusenciaLote={showAusenciaLote}
        loteAusenciaBusy={loteAusenciaBusy}
        loteAusenciaMsg={loteAusenciaMsg}
        loteAusenciaConfirm={loteAusenciaConfirm}
        onLoteAusenciaConfirmChange={setLoteAusenciaConfirm}
        loteAusenciaConfirmPhrase={CONFIRM_LOTE_AUSENCIA}
        onLoteAusenciaSimular={handleLoteAusenciaSimular}
        onLoteAusenciaExecutar={handleLoteAusenciaExecutar}
      />
    ),
    [
      showFilters,
      filtersAuxLoading,
      separarMensagensDisparadasLigado,
      statusFilter,
      tagFilter,
      allTags,
      showSetorFilter,
      departamentoFilter,
      departamentos,
      atendenteFilter,
      atendentes,
      dataInicio,
      dataFim,
      mineOnly,
      onlyFinalizadasAusencia,
      handleOnlyFinalizadasAusenciaChange,
      aguardandoClienteOnly,
      isFinanceiroUser,
      pagamentosPendentesOnly,
      emAtrasoOnly,
      order,
      tempoParadoFilter,
      showAusenciaLote,
      loteAusenciaBusy,
      loteAusenciaMsg,
      loteAusenciaConfirm,
      handleLoteAusenciaSimular,
      handleLoteAusenciaExecutar,
    ]
  );

  const toolbarMetaLeftSlot = useMemo(
    () => (
      <MinhasPendenciasCard
        minhasPendencias={minhasPendencias}
        pendenciaAtiva={pendenciaAtiva}
        loadingPendencias={loadingPendencias}
        loadingPendenciaCategoria={loadingPendenciaCategoria}
        onPendenciaClick={handlePendenciaClick}
      />
    ),
    [
      minhasPendencias,
      pendenciaAtiva,
      loadingPendencias,
      loadingPendenciaCategoria,
      handlePendenciaClick,
    ]
  );

  return (
    <div className="chat-list-root">
      {zapiStatusLoaded && zapiConnected === false && (
        <div className="chat-list-zapi-alert" role="alert">
          <span className="chat-list-zapi-alert__icon" aria-hidden>⚠️</span>
          <span>
            WhatsApp desconectado — mensagens não serão entregues.{" "}
            <button
              type="button"
              className="chat-list-zapi-alert__link"
              onClick={() => navigate("/configuracoes")}
            >
              Reconectar
            </button>
          </span>
        </div>
      )}
      <ChatListHeaderBar
        novoBtnRef={novoBtnRef}
        showNovoMenu={showNovoMenu}
        menuPosition={menuPosition}
        novoMenuRef={novoMenuRef}
        onToggleNovoMenu={handleToggleNovoMenu}
        onToggleFilters={handleToggleFilters}
        onNovoContato={handleNovoContatoMenu}
        onNovoGrupo={handleNovoGrupoMenu}
        onNovaComunidade={handleNovaComunidadeMenu}
        canConsultarProdutos={canConsultarProdutos}
        onOpenProdutos={handleOpenProdutos}
      />

      <ChatListBody
        scrollRef={scrollRef}
        scrollSaveRef={scrollSaveRef}
        scrollTopNoncePrevRef={scrollTopNoncePrevRef}
        searchRef={searchRef}
        searchClearNonce={searchClearNonce}
        onSearchDebounced={handleSearchDebounced}
        isMobileLayout={isMobileLayout}
        rowCurrentUserId={rowCurrentUserId}
        user={user}
        separarMensagensDisparadasLigado={separarMensagensDisparadasLigado}
        debouncedSearch={debouncedSearch}
        statusFilter={statusFilter}
        tagFilter={tagFilter}
        departamentoFilter={departamentoFilter}
        atendenteFilter={atendenteFilter}
        mineOnly={mineOnly}
        order={order}
        tab={tab}
        minhaFilaList={minhaFilaList}
        chatFilterCounts={chatFilterCounts}
        activeListTotalCount={activeListTotalCount}
        adminAtendenteFilterId={adminAtendenteFilterId}
        onlyFinalizadasAusencia={onlyFinalizadasAusencia}
        aguardandoClienteOnly={aguardandoClienteOnly}
        pagamentosPendentesOnly={pagamentosPendentesOnly}
        emAtrasoOnly={emAtrasoOnly}
        isFinanceiroUser={isFinanceiroUser}
        pendentesFuncionarioSet={pendentesFuncionarioSet}
        minhaFilaCount={minhaFilaCount}
        emAtendimentoBadgeCount={emAtendimentoBadgeCount}
        aguardandoClienteBadgeCount={aguardandoClienteBadgeCount}
        pagamentosPendentesBadgeCount={pagamentosPendentesBadgeCount}
        emAtrasoBadgeCount={emAtrasoBadgeCount}
        mensagensDisparadasCount={mensagensDisparadasCount}
        supervisaoResumo={supervisaoResumo}
        pendentesFuncionarioIds={pendentesFuncionarioIds}
        zapFilterSkeleton={zapFilterSkeleton}
        setZapFilterSkeleton={setZapFilterSkeleton}
        adminPorFuncionarioAtivo={adminPorFuncionarioAtivo}
        atendentes={atendentes}
        adminAtendentePanelOpen={adminAtendentePanelOpen}
        setAdminAtendentePanelOpen={setAdminAtendentePanelOpen}
        setAdminAtendenteFilterId={setAdminAtendenteFilterId}
        clearAdminAtendenteFilter={clearAdminAtendenteFilter}
        setShowNovoMenu={setShowNovoMenu}
        setShowFilters={setShowFilters}
        setTab={setTab}
        onClearPendenciaAtiva={clearPendenciaAtiva}
        setNovoContatoModalOpen={setNovoContatoModalOpen}
        onSelect={handleSelecionarConversa}
        onOpenClienteSemConversa={handleOpenClienteSemConversa}
        onRequestConfirmClear={onRequestConfirmClear}
        onRequestConfirmDelete={onRequestConfirmDelete}
        onReloadList={onReloadList}
        canLoadMoreChats={chatListPage.hasMore}
        loadingMoreChats={chatListPage.loading}
        loadMoreChatsError={chatListPage.error}
        onLoadMoreChats={handleLoadMoreChats}
        listRefreshing={listRefreshing}
        middleSlot={toolbarMetaLeftSlot}
        filtersPanelSlot={advancedFiltersSlot}
        conversaIdsPendenciaAtiva={conversaIdsPendenciaAtiva}
        hasActivePendencia={!!pendenciaAtiva}
      />

      <ConfirmDialog
        open={confirmClear != null}
        title="Limpar esta conversa?"
        confirmLabel="Limpar mensagens"
        cancelLabel="Cancelar"
        onCancel={() => setConfirmClear(null)}
        onConfirm={() => {
          void runConfirmedClear();
        }}
      >
        <p style={{ margin: 0 }}>
          Todas as mensagens serão removidas. A conversa permanece na lista.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmDelete != null}
        title="Apagar conversa permanentemente?"
        confirmLabel="Apagar"
        cancelLabel="Cancelar"
        danger
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          void runConfirmedDelete();
        }}
      >
        <p style={{ margin: 0 }}>
          Esta ação não pode ser desfeita. O histórico e dados vinculados podem ser removidos conforme as regras do sistema.
        </p>
      </ConfirmDialog>

      {showProdutosPanel && canConsultarProdutos ? (
        <Suspense fallback={null}>
          <ProdutoConsultaPanel
            open
            onClose={() => setShowProdutosPanel(false)}
            canViewSyncStatus={canVerSyncProdutos}
            canTriggerManualSync={canSincronizarProdutos}
            showToast={showToast}
            onEnviarParaConversa={(template) => queueComposerAppend(template)}
          />
        </Suspense>
      ) : null}

      <NovoContatoModal
        open={novoContatoModalOpen}
        onClose={() => setNovoContatoModalOpen(false)}
        onSuccess={(conversa, extra) => {
          if (conversa?.id) {
            addChat(conversa);
            load();
            carregarConversa(conversa.id);
            setUnread(conversa.id, 0);
            showToast({
              type: "success",
              title: "Contato pronto",
              message: "Conversa iniciada. Você já pode enviar mensagens.",
            });
            return;
          }
          if (extra?.cliente?.id != null) {
            load();
            showToast({
              type: "success",
              title: "Cliente cadastrado",
              message: "O contato foi salvo. Abra a conversa depois pelo telefone ou pela lista de clientes.",
            });
          }
        }}
      />
    </div>
  );
}
