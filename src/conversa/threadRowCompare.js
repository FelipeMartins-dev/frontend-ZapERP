/**
 * Comparação para React.memo do ThreadRow — evita re-render quando só outras linhas mudam.
 * Não compara callbacks (assumidos estáveis via useCallback no pai).
 */

function safeStr(v) {
  return v == null ? "" : String(v);
}

/** Campos que afetam render visual da bolha (sem comparar objeto msg inteiro por referência). */
export function messageRowVisualSignature(item) {
  if (!item || item.__type !== "msg") return "";
  return [
    safeStr(item.id),
    safeStr(item.tempId),
    safeStr(item.whatsapp_id),
    safeStr(item.status ?? item.status_mensagem),
    safeStr(item.tipo),
    safeStr(item.texto ?? item.conteudo).slice(0, 512),
    safeStr(item.url ?? item.url_absoluta).slice(0, 200),
    safeStr(item.nome_arquivo).slice(0, 120),
    item.apagada_para_todos ? "1" : "0",
    item.__showRemetente ? "1" : "0",
    safeStr(item.__reaction),
    item.__captionBundleTop ? "1" : "0",
    item.__captionBundleFollow ? "1" : "0",
    safeStr(item.remetente_nome),
    safeStr(item.remetente_telefone),
    safeStr(item.criado_em),
    safeStr(item.direcao),
    safeStr(item.editado),
  ].join("\u0001");
}

export function threadRowPropsAreEqual(prev, next) {
  if (prev.item.__type !== next.item.__type) return false;

  if (prev.item.__type === "day") {
    return prev.item.id === next.item.id && prev.item.label === next.item.label;
  }

  if (prev.messageKey !== next.messageKey) return false;
  if (prev.messageVisualSig !== next.messageVisualSig) return false;
  if (prev.allowEnterAnimation !== next.allowEnterAnimation) return false;

  if (prev.isSelected !== next.isSelected) return false;
  if (prev.selectMode !== next.selectMode) return false;
  if (prev.isPinned !== next.isPinned) return false;
  if (prev.isStarred !== next.isStarred) return false;
  if (prev.reactionForMessage !== next.reactionForMessage) return false;
  if (prev.reactionLoadingForMessage !== next.reactionLoadingForMessage) return false;
  if (prev.zapAnimateIn !== next.zapAnimateIn) return false;

  if (prev.isGroup !== next.isGroup) return false;
  if (prev.peerAvatarUrl !== next.peerAvatarUrl) return false;
  if (prev.peerName !== next.peerName) return false;
  if (prev.currentUserId !== next.currentUserId) return false;
  if (prev.mostrarNomeAoCliente !== next.mostrarNomeAoCliente) return false;
  if (prev.swipeReplyEnabled !== next.swipeReplyEnabled) return false;
  if (prev.mobileMessageChrome !== next.mobileMessageChrome) return false;
  if (prev.menuUsesBottomSheet !== next.menuUsesBottomSheet) return false;

  return true;
}
