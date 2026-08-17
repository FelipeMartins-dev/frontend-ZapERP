import { memo } from "react";
import { ArrowLeftRight, EyeOff, ShieldCheck, StickyNote, UserCheck } from "lucide-react";
import DaySeparator from "./DaySeparator";
import { threadRowPropsAreEqual } from "./threadRowCompare";
import { formatHora } from "./utils/conversaViewHelpers";
import { isInternalNote } from "./internalNote";

/*
 * Corre para TODAS as mensagens normais (as duas verifica\u00e7\u00f5es baratas acima falham nelas) e,
 * pior, o mesmo teste vive no `estimateSize` do virtualizador \u2014 chamado item a item a cada
 * medi\u00e7\u00e3o. A vers\u00e3o antiga fazia `trim()` + `split()` do corpo inteiro e `normalize("NFD")`,
 * que \u00e9 das opera\u00e7\u00f5es de string mais caras que h\u00e1.
 *
 * Agora: recorta a 1.\u00aa linha sem partir o corpo todo e s\u00f3 decomp\u00f5e acentos se a linha j\u00e1
 * contiver "movimenta" \u2014 prefixo comum a "movimenta\u00e7\u00e3o" e "movimentacao", portanto um
 * superconjunto seguro (nenhuma movimenta\u00e7\u00e3o real escapa ao filtro).
 */
function textLooksInternalMovement(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  const nl = raw.indexOf("\n");
  const firstLine = (nl === -1 ? raw : raw.slice(0, nl)).trim() || raw;
  const lower = firstLine.toLowerCase();
  if (!lower.includes("movimenta")) return false;
  const normalized = lower.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return normalized.includes("movimentacao interna");
}

function isInternalMovementMessage(item) {
  return item?.mensagem_interna === true ||
    String(item?.tipo || "").toLowerCase() === "movimentacao_interna_atendimento" ||
    textLooksInternalMovement(item?.texto || item?.conteudo || item?.message || item?.body);
}

function InternalMovementCard({ item, zapAnimateIn }) {
  const meta = item?.movimentacao_interna && typeof item.movimentacao_interna === "object"
    ? item.movimentacao_interna
    : {};
  const rawText = String(item?.texto || "");
  const fallbackBody = rawText.split("\n").slice(1).join("\n").trim();
  const title = meta.titulo || "Movimentação interna";
  const body = meta.corpo || fallbackBody || "Este atendimento teve uma movimentação interna.";
  const footer = meta.rodape || "Mensagem invisível para o cliente.";
  const action = String(meta.acao || (body.toLowerCase().includes("assumiu") ? "assumiu" : "transferiu")).toLowerCase();
  const isAssume = action === "assumiu";
  const ActionIcon = isAssume ? UserCheck : ArrowLeftRight;

  return (
    <div
      className={`wa-row wa-row-internalMovement${zapAnimateIn ? " zap-message-enter" : ""}`}
      data-msg-id={item?.id}
      role="note"
      aria-label="Movimentação interna"
    >
      <div className={`wa-internalMovement-card ${isAssume ? "is-assume" : "is-transfer"}`}>
        <span className="wa-internalMovement-icon" aria-hidden="true">
          <ActionIcon size={15} strokeWidth={2.25} />
        </span>
        <div className="wa-internalMovement-content">
          <div className="wa-internalMovement-kicker">
            <ShieldCheck size={11} strokeWidth={2.2} />
            <span>Registro interno</span>
          </div>
          <div className="wa-internalMovement-title">{title}</div>
          <div className="wa-internalMovement-body">{body}</div>
          <div className="wa-internalMovement-footer">
            <span>{footer}</span>
            <span className="wa-internalMovement-time">{formatHora(item?.criado_em)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function InternalNoteCard({ item, zapAnimateIn }) {
  const nome = item?.usuario_nome || item?.remetente_nome || null;
  const texto = String(item?.texto || "");

  return (
    <div
      className={`wa-row wa-row-internalNote${zapAnimateIn ? " zap-message-enter" : ""}`}
      data-msg-id={item?.id}
      role="note"
      aria-label="Nota interna"
    >
      <div className="wa-internalNote-card">
        <div className="wa-internalNote-head">
          <span className="wa-internalNote-icon" aria-hidden="true">
            <StickyNote size={13} strokeWidth={2.2} />
          </span>
          <span className="wa-internalNote-kicker">NOTA INTERNA</span>
          {nome ? <span className="wa-internalNote-autor">· {nome}</span> : null}
          <span className="wa-internalNote-time">{formatHora(item?.criado_em)}</span>
        </div>
        <div className="wa-internalNote-body">{texto}</div>
        <div className="wa-internalNote-footer">
          <EyeOff size={11} strokeWidth={2} />
          <span>O cliente não recebeu esta mensagem</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Uma linha do thread virtualizado: separador de dia ou bolha de mensagem.
 * BubbleComponent vem do ConversaView (referência estável) para evitar mover ~800 linhas nesta etapa.
 */
function ThreadRow({
  item,
  messageKey,
  messageVisualSig: _messageVisualSigForMemo,
  allowEnterAnimation = false,
  BubbleComponent,
  zapSeenMsgKeysRef,
  zapMsgsInitialPassRef,
  isGroup,
  peerAvatarUrl,
  peerName,
  selectMode,
  isSelected,
  isPinned,
  isStarred,
  reactionForMessage,
  reactionLoadingForMessage,
  showMobileReactionPicker,
  currentUserId,
  mostrarNomeAoCliente,
  swipeReplyEnabled,
  mobileMessageChrome,
  menuUsesBottomSheet,
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
  onReenviarAudio,
  onReenviarFalha,
  onReact,
  onRemoveReaction,
  onConversarContact,
  onAdicionarGrupoContact,
}) {
  if (!item) return null;

  if (item.__type === "day") {
    return <DaySeparator label={item.label} />;
  }

  if (!BubbleComponent) return null;

  const seenMsgKeys = zapSeenMsgKeysRef?.current;
  const isInitialPass = zapMsgsInitialPassRef?.current === true;

  let zapAnimateIn = false;
  /* Só anima mensagens novas no fim do thread — histórico revelado no scroll não anima (evita jank). */
  if (
    allowEnterAnimation &&
    !mobileMessageChrome &&
    !isInitialPass &&
    seenMsgKeys &&
    messageKey != null &&
    !seenMsgKeys.has(messageKey)
  ) {
    zapAnimateIn = true;
  }
  if (seenMsgKeys && messageKey != null) {
    seenMsgKeys.add(messageKey);
  }

  if (isInternalNote(item)) {
    return <InternalNoteCard item={item} zapAnimateIn={zapAnimateIn} />;
  }

  if (isInternalMovementMessage(item)) {
    return <InternalMovementCard item={item} zapAnimateIn={zapAnimateIn} />;
  }

  return (
    <BubbleComponent
      msg={item}
      zapAnimateIn={zapAnimateIn}
      showRemetente={Boolean(item.__showRemetente)}
      isGroup={isGroup}
      peerAvatarUrl={peerAvatarUrl}
      peerName={peerName}
      selectMode={selectMode}
      selected={isSelected}
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
      isPinned={isPinned}
      isStarred={isStarred}
      currentUserId={currentUserId}
      onJumpToReply={onJumpToReply}
      onOpenMedia={onOpenMedia}
      onReenviarAudio={onReenviarAudio}
      onReenviarFalha={onReenviarFalha}
      localReaction={reactionForMessage}
      onReact={onReact}
      onRemoveReaction={onRemoveReaction}
      reactionBusy={reactionLoadingForMessage}
      showMobileReactionPicker={showMobileReactionPicker}
      onConversarContact={onConversarContact}
      onAdicionarGrupoContact={onAdicionarGrupoContact}
      mostrarNomeAoCliente={mostrarNomeAoCliente}
      swipeReplyEnabled={swipeReplyEnabled}
      captionBundleTop={Boolean(item.__captionBundleTop)}
      captionBundleFollow={Boolean(item.__captionBundleFollow)}
      mobileMessageChrome={mobileMessageChrome}
      menuUsesBottomSheet={menuUsesBottomSheet}
    />
  );
}

export default memo(ThreadRow, threadRowPropsAreEqual);
