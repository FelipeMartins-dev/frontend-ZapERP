import { useCallback, useMemo } from "react";
import { Archive } from "lucide-react";
import { getMessageListReactKey } from "./conversaStore";
import { getStatusAtendimentoEffective, isClosedAttendanceStatus } from "../utils/conversaUtils";
import { ConversaMessageStaticList, ConversaMessageVirtualList } from "./ConversaMessageVirtualList";
import ThreadRow from "./ThreadRow";
import { messageRowVisualSignature } from "./threadRowCompare";
import ClosedAttendancePanel from "./ClosedAttendancePanel";

const EMPTY_SET = new Set();
const EMPTY_OBJECT = Object.freeze({});
const EMPTY_ARRAY = Object.freeze([]);

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
  const messageKeyConversaId = conversaId ?? threadConversaId;

  const safeMensagensComSeparadores = Array.isArray(mensagensComSeparadores)
    ? mensagensComSeparadores
    : EMPTY_ARRAY;
  const safeMensagens = Array.isArray(mensagens) ? mensagens : EMPTY_ARRAY;
  const safeSelectedSet = selectedSet instanceof Set ? selectedSet : EMPTY_SET;
  const safePinnedSet = pinnedSet instanceof Set ? pinnedSet : EMPTY_SET;
  const safeStarredSet = starredSet instanceof Set ? starredSet : EMPTY_SET;
  const safeLocalReactions =
    localReactions && typeof localReactions === "object" ? localReactions : EMPTY_OBJECT;
  const safeReactionLoading =
    reactionLoading && typeof reactionLoading === "object" ? reactionLoading : EMPTY_OBJECT;

  const threadRowCount = safeMensagensComSeparadores.length;

  const renderItem = useCallback(
    (item, index) => {
      if (!item) return null;
      const allowEnterAnimation = index >= threadRowCount - 2;

      if (item.__type === "day") {
        return (
          <ThreadRow
            item={item}
            messageKey={item.id}
            messageVisualSig=""
            allowEnterAnimation={allowEnterAnimation}
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
          allowEnterAnimation={allowEnterAnimation}
          BubbleComponent={BubbleComponent}
          zapSeenMsgKeysRef={zapSeenMsgKeysRef}
          zapMsgsInitialPassRef={zapMsgsInitialPassRef}
          isGroup={isGroup}
          peerAvatarUrl={avatarUrl}
          peerName={nome}
          selectMode={selectMode}
          isSelected={safeSelectedSet.has(String(messageKey))}
          isPinned={safePinnedSet.has(String(messageKey))}
          isStarred={safeStarredSet.has(String(messageKey))}
          reactionForMessage={safeLocalReactions[String(messageKey)] || item.__reaction}
          reactionLoadingForMessage={Boolean(safeReactionLoading[String(messageKey)])}
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
      threadRowCount,
      messageKeyConversaId,
      BubbleComponent,
      zapSeenMsgKeysRef,
      zapMsgsInitialPassRef,
      isGroup,
      avatarUrl,
      nome,
      selectMode,
      safeSelectedSet,
      safePinnedSet,
      safeStarredSet,
      safeLocalReactions,
      safeReactionLoading,
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

  const closedMeta = useMemo(() => {
    const atendenteNome = firstFilled(conversa?.atendente_nome, conversa?.atendente?.nome) || "outro usuário";
    const protocolo =
      firstFilled(
        conversa?.protocolo,
        conversa?.protocolo_atendimento,
        conversa?.atendimento_protocolo,
        conversa?.ultimo_protocolo
      ) || extractProtocolFromMessages(safeMensagens);
    const setor =
      firstFilled(conversa?.setor, conversa?.departamento?.nome, conversa?.departamentos?.nome) || "Sem setor";
    return { atendenteNome, protocolo, setor };
  }, [conversa, safeMensagens]);

  const statusAtendimento = String(getStatusAtendimentoEffective(conversa) ?? "").toLowerCase();
  const isClosedConversation = isClosedAttendanceStatus(statusAtendimento);
  const showClosedBanner = isClosedConversation && !isGroup;

  const closedBanner = showClosedBanner ? (
    <div className="wa-closedAttendance-banner">
      <ClosedAttendancePanel
        atendenteNome={closedMeta.atendenteNome}
        showReopenCta={showReopenClosedCta}
        reopenBusy={reopenClosedBusy}
        onReopen={onReopenClosed}
      />
    </div>
  ) : null;

  if (conversa?.mensagens_bloqueadas) {
    const atendenteNome = closedMeta.atendenteNome;

    return (
      <div className="wa-messages-empty">
        <div className="wa-messages-emptyCard wa-messages-emptyCard--blocked">
          <span className="wa-messages-blocked-icon" aria-hidden="true">
            <Archive size={20} strokeWidth={2.25} />
          </span>
          <strong>{`Este atendimento foi assumido por ${atendenteNome}.`}</strong>
        </div>
      </div>
    );
  }

  if (loading && safeMensagensComSeparadores.length === 0) {
    return (
      <>
        {closedBanner}
        <div className="wa-messages-empty">
          <div className="wa-messages-emptyCard wa-messages-emptyCard--loading">
            <p className="wa-messages-emptyText">Carregando mensagens…</p>
          </div>
        </div>
      </>
    );
  }

  if (safeMensagensComSeparadores.length === 0) {
    return (
      <>
        {closedBanner}
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
      </>
    );
  }

  return (
    <>
      {closedBanner}
      {!conversa?.mensagens_bloqueadas && safeMensagens.length > 0 && !loading ? (
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
      {headerCompact ? (
        <ConversaMessageStaticList
          key={`wa-thread-static-${String(threadConversaId ?? "")}`}
          ref={virtualThreadRef}
          scrollRef={messagesContainerRef}
          conversaId={threadConversaId}
          items={safeMensagensComSeparadores}
          onVirtualContentResize={onVirtualContentResize}
          renderItem={renderItem}
        />
      ) : (
        <ConversaMessageVirtualList
          key={`wa-thread-${String(threadConversaId ?? "")}`}
          ref={virtualThreadRef}
          scrollRef={messagesContainerRef}
          overscan={10}
          mobileThread={false}
          conversaId={threadConversaId}
          items={safeMensagensComSeparadores}
          onVirtualContentResize={onVirtualContentResize}
          renderItem={renderItem}
        />
      )}
    </>
  );
}
