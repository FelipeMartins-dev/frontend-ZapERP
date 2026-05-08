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
