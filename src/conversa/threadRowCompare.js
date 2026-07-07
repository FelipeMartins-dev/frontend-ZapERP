/**
 * Comparação para React.memo do ThreadRow — evita re-render quando só outras linhas mudam.
 * Não compara callbacks (assumidos estáveis via useCallback no pai).
 */

function safeStr(v) {
  return v == null ? "" : String(v);
}

function safeReplySig(replyMeta) {
  if (!replyMeta || typeof replyMeta !== "object") return "";
  return [
    safeStr(replyMeta.replyToId ?? replyMeta.id ?? replyMeta.messageId),
    safeStr(replyMeta.name ?? replyMeta.senderName).slice(0, 120),
    safeStr(replyMeta.snippet ?? replyMeta.text ?? replyMeta.body).slice(0, 240),
    safeStr(replyMeta.thumb ?? replyMeta.thumbnail ?? replyMeta.url).slice(0, 200),
    safeStr(replyMeta.tipo ?? replyMeta.type),
  ].join("\u0002");
}

/** Campos que afetam render visual da bolha (sem comparar objeto msg inteiro por referência). */
export function messageRowVisualSignature(item) {
  if (!item || item.__type !== "msg") return "";
  return [
    safeStr(item.id),
    safeStr(item.tempId),
    safeStr(item.client_temp_id),
    safeStr(item.whatsapp_id),
    safeStr(item.status ?? item.status_mensagem),
    safeStr(item.tipo),
    safeStr(item.texto ?? item.conteudo).slice(0, 512),
    safeStr(item._optimisticBlobUrl).slice(0, 200),
    safeStr(item.url).slice(0, 200),
    safeStr(item.url_absoluta).slice(0, 200),
    safeStr(item.media_url ?? item.mediaUrl).slice(0, 200),
    safeStr(item.file_url ?? item.fileUrl).slice(0, 200),
    safeStr(item.download_url ?? item.downloadUrl).slice(0, 200),
    safeStr(item.nome_arquivo).slice(0, 120),
    safeStr(item.tamanho ?? item.tamanho_bytes),
    safeStr(item.file_last_modified),
    item.apagada_para_todos ? "1" : "0",
    item.encaminhado ? "1" : "0",
    item.__showRemetente ? "1" : "0",
    safeStr(item.__reaction),
    item.__captionBundleTop ? "1" : "0",
    item.__captionBundleFollow ? "1" : "0",
    safeStr(item.remetente_nome),
    safeStr(item.remetente_telefone),
    safeStr(item.usuario_nome),
    item.enviado_por_usuario ? "1" : "0",
    safeStr(item.criado_em),
    safeStr(item.direcao),
    safeStr(item.editado),
    safeReplySig(item.reply_meta),
    safeStr(item.location_live),
    item.location_meta ? JSON.stringify(item.location_meta) : "",
  ].join("\u0001");
}

export function threadRowPropsAreEqual(prev, next) {
  const prevItem = prev?.item;
  const nextItem = next?.item;

  if (!prevItem || !nextItem) return prevItem === nextItem;
  if (prevItem.__type !== nextItem.__type) return false;

  if (prevItem.__type === "day") {
    return prevItem.id === nextItem.id && prevItem.label === nextItem.label;
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
