import { memo, useCallback, useEffect, useMemo } from "react";
import { shallow } from "zustand/shallow";
import { useChatStore } from "./chatsStore";
import { chatListsStoreEquivalent } from "./chatListStoreCompare";
import { useConversaStore } from "../conversa/conversaStore";
import { isGroupConversation } from "../utils/conversaUtils";
import { useNotificationStore } from "../notifications/notificationStore";
import { useConversationActionMenu } from "./useConversationActionMenu";
import { useChatListFilters } from "./hooks/useChatListFilters";
import { useChatListCounts } from "./hooks/useChatListCounts";
import { rowPrefs } from "./chatListRowAtendimento";
import {
  mergePrefsFromPatchResponse,
  toggleFavoriteConversation,
  toggleMuteConversation,
  togglePinConversation,
} from "./conversationActionsService";
import { initZapDomEnhancements } from "./zapDomEnhancements";
import { CHAT_LIST_VIRTUAL_THRESHOLD } from "./ChatListRows";
import ChatListToolbar from "./ChatListToolbar";
import ChatListRowsPane from "./ChatListRowsPane";

/**
 * Único bloco que assina `chats` na store.
 * Toolbar (busca/chips) e linhas ficam em filhos memoizados para reduzir re-render em cascata.
 */
function ChatListBody({
  scrollRef,
  scrollSaveRef,
  scrollTopNoncePrevRef,
  searchRef,
  searchClearNonce,
  onSearchDebounced,
  isMobileLayout,
  rowCurrentUserId,
  user,
  separarMensagensDisparadasLigado,
  debouncedSearch,
  statusFilter,
  tagFilter,
  departamentoFilter,
  atendenteFilter,
  mineOnly,
  order,
  tab,
  minhaFilaList,
  adminAtendenteFilterId,
  onlyFinalizadasAusencia,
  aguardandoClienteOnly,
  pagamentosPendentesOnly,
  emAtrasoOnly,
  isFinanceiroUser,
  pendentesFuncionarioSet,
  minhaFilaCount,
  emAtendimentoBadgeCount,
  aguardandoClienteBadgeCount,
  pagamentosPendentesBadgeCount,
  emAtrasoBadgeCount,
  mensagensDisparadasCount,
  supervisaoResumo,
  pendentesFuncionarioIds,
  zapFilterSkeleton,
  setZapFilterSkeleton,
  adminPorFuncionarioAtivo,
  atendentes,
  adminAtendentePanelOpen,
  setAdminAtendentePanelOpen,
  setAdminAtendenteFilterId,
  clearAdminAtendenteFilter,
  setShowNovoMenu,
  setShowFilters,
  setTab,
  setNovoContatoModalOpen,
  onSelect,
  onOpenClienteSemConversa,
  onRequestConfirmClear,
  onRequestConfirmDelete,
  onReloadList,
  listRefreshing = false,
  middleSlot = null,
  filtersPanelSlot = null,
  conversaIdsPendenciaAtiva = null,
}) {
  const chats = useChatStore((s) => s.chats || [], chatListsStoreEquivalent);
  const chatsLength = chats?.length ?? 0;
  const hasStoreChats = chatsLength > 0;
  const { loading, chatListScrollToTopNonce } = useChatStore(
    (s) => ({
      loading: s.loading,
      chatListScrollToTopNonce: s.chatListScrollToTopNonce ?? 0,
    }),
    shallow
  );

  const showToast = useNotificationStore((s) => s.showToast);

  const { chatsFiltrados } = useChatListFilters({
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
    conversaIdsPendenciaAtiva,
  });

  const {
    total,
    countHoje,
    countAbertas,
    countEmAtendimento,
    countFinalizadas,
    countFinalizadasAuto,
    countAguardandoCliente,
    countAguardandoFuncionario,
    aguardandoFuncionarioVisualState,
  } = useChatListCounts({
    chats,
    emAtendimentoBadgeCount,
    aguardandoClienteBadgeCount,
    supervisaoResumo,
    pendentesFuncionarioIds,
  });

  const filteredCount = chatsFiltrados.length;

  useEffect(() => {
    if (!zapFilterSkeleton) return undefined;
    const t = window.setTimeout(() => setZapFilterSkeleton(false), 220);
    return () => window.clearTimeout(t);
  }, [zapFilterSkeleton, filteredCount, setZapFilterSkeleton]);

  useEffect(() => {
    if (isMobileLayout && chatsLength >= CHAT_LIST_VIRTUAL_THRESHOLD) {
      return undefined;
    }
    const cleanup = initZapDomEnhancements(document.querySelector(".chat-list-root") || document);
    return cleanup;
  }, [isMobileLayout, chatsLength]);

  const visibleConversationIds = useMemo(
    () => chatsFiltrados.map((c) => String(c?.id)).filter(Boolean),
    [chatsFiltrados]
  );

  const { openConversationId, anchorRect, openMenu, closeMenu } = useConversationActionMenu({
    visibleConversationIds,
    resetKey: `${tab}-${adminAtendenteFilterId ?? ""}`,
  });

  const openMenuChat = useMemo(
    () => chatsFiltrados.find((c) => String(c?.id) === String(openConversationId)) || null,
    [chatsFiltrados, openConversationId]
  );

  const menuActions = useMemo(() => {
    const chat = openMenuChat;
    if (!chat) return [];
    const isGroup = isGroupConversation(chat);
    const p = rowPrefs(chat);
    return [
      {
        id: "mute",
        label: p.silenciado ? "Remover silêncio" : "Silenciar notificações",
        icon: "🔕",
        visible: true,
        disabled: false,
      },
      {
        id: "pin",
        label: p.fixada ? "Desafixar conversa" : "Fixar conversa",
        icon: "📌",
        visible: true,
        disabled: false,
      },
      {
        id: "favorite",
        label: p.favorita ? "Remover dos favoritos" : "Adicionar aos Favoritos",
        icon: "★",
        visible: true,
        disabled: false,
      },
      {
        id: "clear",
        label: "Limpar conversa",
        icon: "🧹",
        visible: true,
        disabled: false,
      },
      {
        id: "delete",
        label: "Apagar conversa",
        icon: "🗑",
        danger: true,
        visible: true,
        disabled: isGroup,
        tooltip: isGroup ? "Grupos não podem ser apagados por esta ação." : undefined,
      },
    ];
  }, [openMenuChat]);

  const onTabMinhaFila = useCallback(() => setTab("minha_fila"), [setTab]);
  const onTabTodas = useCallback(() => setTab("todas"), [setTab]);
  const onTabHoje = useCallback(() => setTab("hoje"), [setTab]);
  const onTabAbertas = useCallback(() => setTab("abertas"), [setTab]);
  const onTabMensagensDisparadas = useCallback(() => setTab("mensagens_disparadas"), [setTab]);
  const onTabEmAtendimento = useCallback(() => setTab("em_atendimento"), [setTab]);
  const onTabFinalizadas = useCallback(() => setTab("finalizadas"), [setTab]);
  const onTabFinalizadasAuto = useCallback(() => setTab("finalizadas_auto"), [setTab]);
  const onTabAguardandoCliente = useCallback(() => setTab("aguardando_cliente"), [setTab]);
  const onTabPagamentosPendentes = useCallback(() => setTab("pagamentos_pendentes"), [setTab]);
  const onTabEmAtraso = useCallback(() => setTab("em_atraso"), [setTab]);
  const onTabAguardandoFuncionario = useCallback(() => setTab("aguardando_funcionario"), [setTab]);

  const onAdminSelectUser = useCallback(
    (u) => {
      if (u?.id == null) return;
      setAdminAtendenteFilterId(String(u.id));
    },
    [setAdminAtendenteFilterId]
  );

  const onAdminBeforeOpen = useCallback(() => {
    setShowNovoMenu(false);
    setShowFilters(false);
    closeMenu();
  }, [setShowNovoMenu, setShowFilters, closeMenu]);

  const onNovoContato = useCallback(() => setNovoContatoModalOpen(true), [setNovoContatoModalOpen]);

  const handleMenuAction = useCallback(
    async (action) => {
      if (!action || action.disabled || !openMenuChat?.id) return;
      const chatId = openMenuChat.id;
      const prefs = rowPrefs(openMenuChat);
      const currentSelectedId = useConversaStore.getState().selectedId;
      const isOpenConversation = String(currentSelectedId || "") === String(chatId);

      if (action.id === "clear") {
        onRequestConfirmClear({ chatId, isOpenConversation });
        closeMenu();
        return;
      }
      if (action.id === "delete") {
        onRequestConfirmDelete({ chatId, isOpenConversation });
        closeMenu();
        return;
      }

      closeMenu();

      try {
        if (action.id === "mute") {
          const nextMuted = !prefs.silenciado;
          useChatStore.getState().updateChat({ id: chatId, silenciado: nextMuted });
          const data = await toggleMuteConversation(chatId, nextMuted);
          useChatStore.getState().updateChat({ id: chatId, ...mergePrefsFromPatchResponse(data) });
          showToast({
            type: "success",
            title: nextMuted ? "Notificações silenciadas" : "Silêncio removido",
            message: nextMuted ? "Esta conversa foi silenciada." : "Esta conversa voltou a notificar.",
          });
          return;
        }
        if (action.id === "pin") {
          const nextPinned = !prefs.fixada;
          useChatStore
            .getState()
            .updateChat({
              id: chatId,
              fixada: nextPinned,
              fixada_em: nextPinned ? new Date().toISOString() : null,
            });
          const data = await togglePinConversation(chatId, nextPinned);
          useChatStore.getState().updateChat({ id: chatId, ...mergePrefsFromPatchResponse(data) });
          showToast({
            type: "success",
            title: nextPinned ? "Conversa fixada" : "Conversa desafixada",
            message: nextPinned
              ? "A conversa subiu para o topo da lista."
              : "A conversa voltou à ordenação padrão.",
          });
          return;
        }
        if (action.id === "favorite") {
          const nextFavorite = !prefs.favorita;
          useChatStore.getState().updateChat({ id: chatId, favorita: nextFavorite });
          const data = await toggleFavoriteConversation(chatId, nextFavorite);
          useChatStore.getState().updateChat({ id: chatId, ...mergePrefsFromPatchResponse(data) });
          showToast({
            type: "success",
            title: nextFavorite ? "Favorito adicionado" : "Favorito removido",
            message: nextFavorite
              ? "Conversa marcada como favorita."
              : "Conversa removida dos favoritos.",
          });
        }
      } catch (e) {
        const msg =
          e?.response?.data?.error ||
          e?.response?.data?.message ||
          e?.message ||
          "Não foi possível concluir esta ação.";
        showToast({
          type: "error",
          title: "Falha ao executar ação",
          message: msg,
        });
        onReloadList();
      }
    },
    [openMenuChat, closeMenu, showToast, onRequestConfirmClear, onRequestConfirmDelete, onReloadList]
  );

  return (
    <>
      <ChatListToolbar
        searchRef={searchRef}
        searchClearNonce={searchClearNonce}
        onSearchDebounced={onSearchDebounced}
        tab={tab}
        user={user}
        separarMensagensDisparadasLigado={separarMensagensDisparadasLigado}
        minhaFilaCount={minhaFilaCount}
        total={total}
        countHoje={countHoje}
        countAbertas={countAbertas}
        countEmAtendimento={countEmAtendimento}
        countFinalizadas={countFinalizadas}
        countFinalizadasAuto={countFinalizadasAuto}
        countAguardandoCliente={countAguardandoCliente}
        isFinanceiroUser={isFinanceiroUser}
        countPagamentosPendentes={pagamentosPendentesBadgeCount}
        countEmAtraso={emAtrasoBadgeCount}
        countAguardandoFuncionario={countAguardandoFuncionario}
        aguardandoFuncionarioVisualState={aguardandoFuncionarioVisualState}
        mensagensDisparadasCount={mensagensDisparadasCount}
        listRefreshing={listRefreshing}
        loading={loading}
        hasStoreChats={hasStoreChats}
        filteredCount={filteredCount}
        adminPorFuncionarioAtivo={adminPorFuncionarioAtivo}
        atendentes={atendentes}
        adminAtendenteFilterId={adminAtendenteFilterId}
        adminAtendentePanelOpen={adminAtendentePanelOpen}
        onAdminPanelOpenChange={setAdminAtendentePanelOpen}
        onAdminSelectUser={onAdminSelectUser}
        onAdminClear={clearAdminAtendenteFilter}
        onAdminBeforeOpen={onAdminBeforeOpen}
        onTabMinhaFila={onTabMinhaFila}
        onTabTodas={onTabTodas}
        onTabHoje={onTabHoje}
        onTabAbertas={onTabAbertas}
        onTabMensagensDisparadas={onTabMensagensDisparadas}
        onTabEmAtendimento={onTabEmAtendimento}
        onTabFinalizadas={onTabFinalizadas}
        onTabFinalizadasAuto={onTabFinalizadasAuto}
        onTabAguardandoCliente={onTabAguardandoCliente}
        onTabPagamentosPendentes={onTabPagamentosPendentes}
        onTabEmAtraso={onTabEmAtraso}
        onTabAguardandoFuncionario={onTabAguardandoFuncionario}
        middleSlot={middleSlot}
        filtersPanelSlot={filtersPanelSlot}
      />

      <ChatListRowsPane
        scrollRef={scrollRef}
        scrollSaveRef={scrollSaveRef}
        scrollTopNoncePrevRef={scrollTopNoncePrevRef}
        chatsFiltrados={chatsFiltrados}
        loading={loading}
        hasStoreChats={hasStoreChats}
        tab={tab}
        minhaFilaList={minhaFilaList}
        adminPorFuncionarioAtivo={adminPorFuncionarioAtivo}
        zapFilterSkeleton={zapFilterSkeleton}
        isMobileLayout={isMobileLayout}
        rowCurrentUserId={rowCurrentUserId}
        chatListScrollToTopNonce={chatListScrollToTopNonce}
        onSelect={onSelect}
        onOpenClienteSemConversa={onOpenClienteSemConversa}
        openConversationId={openConversationId}
        onToggleMenu={openMenu}
        pendentesFuncionarioSet={pendentesFuncionarioSet}
        onNovoContato={onNovoContato}
        menuIsOpen={!!openConversationId}
        menuAnchorRect={anchorRect}
        menuActions={menuActions}
        onMenuClose={closeMenu}
        onMenuAction={handleMenuAction}
      />
    </>
  );
}

export default memo(ChatListBody);
