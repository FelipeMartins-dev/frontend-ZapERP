export function isNearBottom(container, thresholdPx = 120) {
  if (!container) return true;
  const threshold = Number.isFinite(Number(thresholdPx)) ? Number(thresholdPx) : 120;
  const distanceToBottom = container.scrollHeight - (container.scrollTop + container.clientHeight);
  return distanceToBottom <= threshold;
}

export function scrollToBottom(container, behavior = "auto") {
  if (!container) return;
  const mode = behavior === "smooth" ? "smooth" : "auto";
  container.scrollTo({ top: container.scrollHeight, behavior: mode });
}

/** Ancora o fim do thread no rodapé visível (útil com flex + sentinel no fim do scroll). */
/** Guarda posição do thread antes de ações que remontam a lista (ex.: Assumir). */
export function captureMessagesScrollAnchor(container) {
  if (!container) return null;
  return {
    top: Number(container.scrollTop) || 0,
    height: Number(container.scrollHeight) || 0,
  };
}

/** Restaura posição após mudança de altura do conteúdo (merge/refresh/virtualizer). */
export function restoreMessagesScrollAnchor(container, snap) {
  if (!container || !snap) return;
  const diff = Number(container.scrollHeight) - Number(snap.height) || 0;
  const nextTop = Math.max(0, Number(snap.top) + diff);
  try {
    container.scrollTop = nextTop;
  } catch {
    /* ignore */
  }
}

export function scrollBottomAnchorIntoView(anchorEl) {
  if (!anchorEl || typeof anchorEl.scrollIntoView !== "function") return;
  try {
    anchorEl.scrollIntoView({ block: "end", inline: "nearest", behavior: "instant" });
  } catch {
    try {
      anchorEl.scrollIntoView(false);
    } catch {
      /* ignore */
    }
  }
}
