import { useCallback } from "react";
import { getMessageListReactKey } from "./conversaStore";
import { ConversaMessageVirtualList } from "./ConversaMessageVirtualList";
import ThreadRow from "./ThreadRow";
import { messageRowVisualSignature } from "./threadRowCompare";

/**
 * Lista virtualizada de mensagens + estados vazios/bloqueado + carregar histórico.
 * Scroll container (.wa-messages) permanece no ConversaView.
 */
export default function ConversaThread({
  virtualThreadRef,
  messagesContainerRef,
  scrollThreadId,
  conversaId,
  headerCompact,
  mensagensComSeparadores,
  mensagens,
  loading,
  loadingMore,
  hasMore,
  cursor,
  conversa,
  showAssumeEmptyCta,
  assumeEmptyBusy,
  onAssumeEmpty,
  onLoadOlderMessagesClick,
  onVirtualContentResize,
  BubbleComponent,
  zapSeenMsgKeysRef,
  zapMsgsInitialPassRef,
  isGroup,
  avatarUrl,
  nome,
  selectMode,
  selectedSet,
  pinnedSet,
  starredSet,
  localReactions,
  reactionLoading,
  myUserId,
  mostrarNomeAoCliente,
  swipeReplyEnabled,
  compactMessageUx,
  onToggleSelected,
  onInfo,
  onReply,
  onCopy,
  onForward,
  onTogglePin,
  onToggleStar,
  onStartSelect,
  onDeleteForMe,
  onDeleteForEveryone,
  onJumpToReply,
  onOpenMedia,
  onReact,
  onRemoveReaction,
  onConversarContact,
  onAdicionarGrupoContact,
}) {
  const threadConversaId = scrollThreadId ?? conversaId;
  /** Igual ao ConversaView anterior: chave React da bolha usa conversaId carregado, não só selectedId. */
  const messageKeyConversaId = conversaId;

  const renderItem = useCallback(
    (item) => {
      if (!item) return null;

      if (item.__type === "day") {
        return (
          <ThreadRow
            item={item}
            messageKey={item.id}
            messageVisualSig=""
            BubbleComponent={BubbleComponent}
            zapSeenMsgKeysRef={zapSeenMsgKeysRef}
            zapMsgsInitialPassRef={zapMsgsInitialPassRef}
            isGroup={isGroup}
            peerAvatarUrl={avatarUrl}
            peerName={nome}
            selectMode={selectMode}
            isSelected={false}
            isPinned={false}
            isStarred={false}
            reactionForMessage={undefined}
            reactionLoadingForMessage={false}
            currentUserId={myUserId}
            mostrarNomeAoCliente={mostrarNomeAoCliente}
            swipeReplyEnabled={swipeReplyEnabled}
            mobileMessageChrome={compactMessageUx}
            menuUsesBottomSheet={compactMessageUx}
            onToggleSelected={onToggleSelected}
            onInfo={onInfo}
            onReply={onReply}
            onCopy={onCopy}
            onForward={onForward}
            onTogglePin={onTogglePin}
            onToggleStar={onToggleStar}
            onStartSelect={onStartSelect}
            onDeleteForMe={onDeleteForMe}
            onDeleteForEveryone={onDeleteForEveryone}
            onJumpToReply={onJumpToReply}
            onOpenMedia={onOpenMedia}
            onReact={onReact}
            onRemoveReaction={onRemoveReaction}
            onConversarContact={onConversarContact}
            onAdicionarGrupoContact={onAdicionarGrupoContact}
          />
        );
      }

      const messageKey = getMessageListReactKey(item, messageKeyConversaId);
      const messageVisualSig = messageRowVisualSignature(item);

      return (
        <ThreadRow
          item={item}
          messageKey={messageKey}
          messageVisualSig={messageVisualSig}
          BubbleComponent={BubbleComponent}
          zapSeenMsgKeysRef={zapSeenMsgKeysRef}
          zapMsgsInitialPassRef={zapMsgsInitialPassRef}
          isGroup={isGroup}
          peerAvatarUrl={avatarUrl}
          peerName={nome}
          selectMode={selectMode}
          isSelected={selectedSet.has(String(messageKey))}
          isPinned={pinnedSet.has(String(messageKey))}
          isStarred={starredSet.has(String(messageKey))}
          reactionForMessage={localReactions[String(messageKey)] || item.__reaction}
          reactionLoadingForMessage={Boolean(reactionLoading[String(messageKey)])}
          currentUserId={myUserId}
          mostrarNomeAoCliente={mostrarNomeAoCliente}
          swipeReplyEnabled={swipeReplyEnabled}
          mobileMessageChrome={compactMessageUx}
          menuUsesBottomSheet={compactMessageUx}
          onToggleSelected={onToggleSelected}
          onInfo={onInfo}
          onReply={onReply}
          onCopy={onCopy}
          onForward={onForward}
          onTogglePin={onTogglePin}
          onToggleStar={onToggleStar}
          onStartSelect={onStartSelect}
          onDeleteForMe={onDeleteForMe}
          onDeleteForEveryone={onDeleteForEveryone}
          onJumpToReply={onJumpToReply}
          onOpenMedia={onOpenMedia}
          onReact={onReact}
          onRemoveReaction={onRemoveReaction}
          onConversarContact={onConversarContact}
          onAdicionarGrupoContact={onAdicionarGrupoContact}
        />
      );
    },
    [
      messageKeyConversaId,
      BubbleComponent,
      zapSeenMsgKeysRef,
      zapMsgsInitialPassRef,
      isGroup,
      avatarUrl,
      nome,
      selectMode,
      selectedSet,
      pinnedSet,
      starredSet,
      localReactions,
      reactionLoading,
      myUserId,
      mostrarNomeAoCliente,
      swipeReplyEnabled,
      compactMessageUx,
      onToggleSelected,
      onInfo,
      onReply,
      onCopy,
      onForward,
      onTogglePin,
      onToggleStar,
      onStartSelect,
      onDeleteForMe,
      onDeleteForEveryone,
      onJumpToReply,
      onOpenMedia,
      onReact,
      onRemoveReaction,
      onConversarContact,
      onAdicionarGrupoContact,
    ]
  );

  if (conversa?.mensagens_bloqueadas) {
    return (
      <div className="wa-messages-empty">
        <div className="wa-messages-emptyCard wa-messages-emptyCard--blocked">
          <span className="wa-messages-blocked-icon" aria-hidden="true">
            🔒
          </span>
          <strong>
            Este atendimento foi assumido por{" "}
            {conversa?.atendente_nome?.trim() ? conversa.atendente_nome : "outro usuário"}.
          </strong>
        </div>
      </div>
    );
  }

  if (loading && mensagensComSeparadores.length === 0) {
    return (
      <div className="wa-messages-empty">
        <div className="wa-messages-emptyCard wa-messages-emptyCard--loading">
          <p className="wa-messages-emptyText">Carregando mensagens…</p>
        </div>
      </div>
    );
  }

  if (mensagensComSeparadores.length === 0) {
    return (
      <div className="wa-messages-empty">
        <div className="wa-messages-emptyCard">
          <p className="wa-messages-emptyText">Sem mensagens ainda.</p>
          {showAssumeEmptyCta ? (
            <button
              type="button"
              className="wa-btn wa-btn-primary wa-btn-assumir-destaque"
              onClick={onAssumeEmpty}
              disabled={assumeEmptyBusy}
            >
              {assumeEmptyBusy ? "Assumindo…" : "Assumir"}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <>
      {!conversa?.mensagens_bloqueadas && Array.isArray(mensagens) && mensagens.length > 0 && !loading ? (
        <div className="wa-loadOlderHistory">
          {hasMore && cursor ? (
            <button
              type="button"
              className="wa-loadOlderBtn"
              onClick={onLoadOlderMessagesClick}
              disabled={loadingMore}
              aria-busy={loadingMore}
              title="Carrega o lote anterior de mensagens. Também pode rolar até ao topo da conversa."
              aria-label={loadingMore ? "Carregando mensagens antigas" : "Carregar mensagens antigas"}
            >
              Carregar mensagens antigas
            </button>
          ) : !hasMore ? (
            <p className="wa-loadOlderEnd" role="status">
              Todas as mensagens foram carregadas
            </p>
          ) : null}
        </div>
      ) : null}
      {loadingMore ? (
        <div className="wa-historyLoading" role="status" aria-live="polite" aria-label="Carregando histórico">
          <span className="wa-historyLoading-bar" />
        </div>
      ) : null}
      <ConversaMessageVirtualList
        key={`wa-thread-${String(threadConversaId ?? "")}`}
        ref={virtualThreadRef}
        scrollRef={messagesContainerRef}
        overscan={headerCompact ? 12 : 16}
        conversaId={threadConversaId}
        items={mensagensComSeparadores}
        onVirtualContentResize={onVirtualContentResize}
        renderItem={renderItem}
      />
    </>
  );
}
