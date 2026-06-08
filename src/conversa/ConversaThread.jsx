import { useCallback } from "react";
import { Archive, RefreshCw } from "lucide-react";
import { getMessageListReactKey } from "./conversaStore";
import { getStatusAtendimentoEffective, isClosedAttendanceStatus } from "../utils/conversaUtils";
import { ConversaMessageVirtualList } from "./ConversaMessageVirtualList";
import ThreadRow from "./ThreadRow";
import { messageRowVisualSignature } from "./threadRowCompare";

function firstFilled(...values) {
  for (const value of values) {
    const text = value == null ? "" : String(value).trim();
    if (text) return text;
  }
  return "";
}

function extractProtocolFromMessages(mensagens) {
  if (!Array.isArray(mensagens)) return "";
  for (let i = mensagens.length - 1; i >= 0; i -= 1) {
    const text = firstFilled(mensagens[i]?.texto, mensagens[i]?.conteudo, mensagens[i]?.message, mensagens[i]?.body);
    if (!text) continue;
    const match = text.match(/protocolo\D{0,24}(\d{2,})/i);
    if (match?.[1]) return match[1];
  }
  return "";
}

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
  showReopenClosedCta,
  reopenClosedBusy,
  onReopenClosed,
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
    const status = String(getStatusAtendimentoEffective(conversa) ?? "").toLowerCase();
    const isClosed = isClosedAttendanceStatus(status);
    const atendenteNome = firstFilled(conversa?.atendente_nome, conversa?.atendente?.nome) || "outro usuário";
    const protocolo =
      firstFilled(
        conversa?.protocolo,
        conversa?.protocolo_atendimento,
        conversa?.atendimento_protocolo,
        conversa?.ultimo_protocolo
      ) || extractProtocolFromMessages(mensagens);
    const setor = firstFilled(conversa?.setor, conversa?.departamento?.nome, conversa?.departamentos?.nome) || "Sem setor";
    const blockedIcon = isClosed ? <RefreshCw size={20} strokeWidth={2.25} /> : <Archive size={20} strokeWidth={2.25} />;

    return (
      <div className="wa-messages-empty">
        <div className={`wa-messages-emptyCard wa-messages-emptyCard--blocked ${isClosed ? "wa-messages-emptyCard--closed" : ""}`}>
          <span className="wa-messages-blocked-icon" aria-hidden="true">
            {blockedIcon}
          </span>
          <strong>
            {isClosed
              ? `Este atendimento foi encerrado por ${atendenteNome}.`
              : `Este atendimento foi assumido por ${atendenteNome}.`}
          </strong>
          {isClosed ? (
            <div className="wa-closedAttendance-meta" aria-label="Dados do atendimento encerrado">
              <div className="wa-closedAttendance-metaItem">
                <span className="wa-closedAttendance-metaLabel">Encerrado por</span>
                <span className="wa-closedAttendance-metaValue">{atendenteNome}</span>
              </div>
              <div className="wa-closedAttendance-metaItem">
                <span className="wa-closedAttendance-metaLabel">Protocolo</span>
                <span className="wa-closedAttendance-metaValue">{protocolo || "-"}</span>
              </div>
              <div className="wa-closedAttendance-metaItem">
                <span className="wa-closedAttendance-metaLabel">Setor</span>
                <span className="wa-closedAttendance-metaValue">{setor}</span>
              </div>
            </div>
          ) : null}
          {isClosed && showReopenClosedCta ? (
            <button
              type="button"
              className="wa-btn wa-btn-primary wa-closedAttendance-reopenBtn"
              onClick={onReopenClosed}
              disabled={reopenClosedBusy}
            >
              <RefreshCw size={16} strokeWidth={2.35} aria-hidden="true" />
              <span>{reopenClosedBusy ? "Reabrindo..." : "Reabrir"}</span>
            </button>
          ) : null}
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
        overscan={headerCompact ? 5 : 16}
        mobileThread={headerCompact}
        conversaId={threadConversaId}
        items={mensagensComSeparadores}
        onVirtualContentResize={onVirtualContentResize}
        renderItem={renderItem}
      />
    </>
  );
}
