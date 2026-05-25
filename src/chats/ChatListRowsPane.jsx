import { memo } from "react";
import EmptyState from "../components/feedback/EmptyState";
import { SkeletonChatList } from "../components/feedback/Skeleton";
import ConversationActionMenu from "./ConversationActionMenu";
import ChatListRows from "./ChatListRows";

/**
 * Área rolável + linhas — re-render quando `chatsFiltrados` ou estado de lista mudam.
 */
function ChatListRowsPane({
  scrollRef,
  scrollSaveRef,
  scrollTopNoncePrevRef,
  chatsFiltrados,
  loading,
  hasStoreChats,
  tab,
  minhaFilaList,
  adminPorFuncionarioAtivo,
  zapFilterSkeleton,
  isMobileLayout,
  rowCurrentUserId,
  chatListScrollToTopNonce,
  onSelect,
  onOpenClienteSemConversa,
  openConversationId,
  onToggleMenu,
  pendentesFuncionarioSet,
  onNovoContato,
  menuIsOpen,
  menuAnchorRect,
  menuActions,
  onMenuClose,
  onMenuAction,
}) {
  const filteredLen = chatsFiltrados.length;

  return (
    <>
      <div ref={scrollRef} className="chat-list-list chat-list-scroll">
        {loading && !hasStoreChats ? (
          <SkeletonChatList />
        ) : !adminPorFuncionarioAtivo && tab === "minha_fila" && minhaFilaList === null ? (
          <SkeletonChatList />
        ) : filteredLen === 0 ? (
          <div className="chat-list-empty-wrap">
            <EmptyState
              title="Nenhuma conversa encontrada"
              description="Suas conversas aparecerão aqui quando você receber mensagens ou iniciar um atendimento."
              actionLabel="Criar novo contato"
              action={onNovoContato}
            />
          </div>
        ) : zapFilterSkeleton ? (
          <div className="zap-skeleton-list" aria-hidden="true">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={`zap-skel-${i}`} className="zap-skeleton-card" />
            ))}
          </div>
        ) : (
          <ChatListRows
            chatsFiltrados={chatsFiltrados}
            isMobileLayout={isMobileLayout}
            scrollRef={scrollRef}
            scrollSaveRef={scrollSaveRef}
            scrollTopNoncePrevRef={scrollTopNoncePrevRef}
            chatListScrollToTopNonce={chatListScrollToTopNonce}
            onSelect={onSelect}
            onOpenClienteSemConversa={onOpenClienteSemConversa}
            currentUserId={rowCurrentUserId}
            openConversationId={openConversationId}
            onToggleMenu={onToggleMenu}
            pendentesFuncionarioSet={pendentesFuncionarioSet}
          />
        )}
      </div>

      <ConversationActionMenu
        isOpen={menuIsOpen}
        anchorRect={menuAnchorRect}
        actions={menuActions}
        onRequestClose={onMenuClose}
        onAction={onMenuAction}
      />
    </>
  );
}

function rowsPanePropsAreEqual(prev, next) {
  if (prev.chatsFiltrados !== next.chatsFiltrados) return false;
  if (prev.loading !== next.loading) return false;
  if (prev.hasStoreChats !== next.hasStoreChats) return false;
  if (prev.tab !== next.tab) return false;
  if (prev.minhaFilaList !== next.minhaFilaList) return false;
  if (prev.adminPorFuncionarioAtivo !== next.adminPorFuncionarioAtivo) return false;
  if (prev.zapFilterSkeleton !== next.zapFilterSkeleton) return false;
  if (prev.isMobileLayout !== next.isMobileLayout) return false;
  if (prev.rowCurrentUserId !== next.rowCurrentUserId) return false;
  if (prev.chatListScrollToTopNonce !== next.chatListScrollToTopNonce) return false;
  if (prev.openConversationId !== next.openConversationId) return false;
  if (prev.menuIsOpen !== next.menuIsOpen) return false;
  if (prev.menuAnchorRect !== next.menuAnchorRect) return false;
  if (prev.menuActions !== next.menuActions) return false;
  if (prev.pendentesFuncionarioSet !== next.pendentesFuncionarioSet) return false;
  if (prev.scrollRef !== next.scrollRef) return false;
  if (prev.scrollSaveRef !== next.scrollSaveRef) return false;
  if (prev.scrollTopNoncePrevRef !== next.scrollTopNoncePrevRef) return false;
  if (prev.onSelect !== next.onSelect) return false;
  if (prev.onOpenClienteSemConversa !== next.onOpenClienteSemConversa) return false;
  if (prev.onToggleMenu !== next.onToggleMenu) return false;
  if (prev.onNovoContato !== next.onNovoContato) return false;
  if (prev.onMenuClose !== next.onMenuClose) return false;
  if (prev.onMenuAction !== next.onMenuAction) return false;
  return true;
}

export default memo(ChatListRowsPane, rowsPanePropsAreEqual);
