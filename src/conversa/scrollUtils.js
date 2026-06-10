export function isNearBottom(container, thresholdPx = 120) {
  if (!container) return true;
  const threshold = Number.isFinite(Number(thresholdPx)) ? Number(thresholdPx) : 120;
  const scrollHeight = Number(container.scrollHeight) || 0;
  const clientHeight = Number(container.clientHeight) || 0;
  const scrollTop = Math.max(0, Number(container.scrollTop) || 0);
  if (scrollHeight <= 0 || clientHeight <= 0) return true;
  const distanceToBottom = scrollHeight - (scrollTop + clientHeight);
  return distanceToBottom <= threshold;
}

export function scrollToBottom(container, behavior = "auto") {
  if (!container) return;
  const mobileLike =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 640px)").matches;
  const mode = mobileLike || behavior !== "smooth" ? "auto" : "smooth";
  try {
    container.scrollTo({ top: container.scrollHeight, behavior: mode });
  } catch {
    try {
      container.scrollTop = container.scrollHeight;
    } catch {
      /* ignore */
    }
  }
}

export function captureMessagesScrollAnchor(container) {
  if (!container) return null;
  return {
    top: Number(container.scrollTop) || 0,
    height: Number(container.scrollHeight) || 0,
  };
}

export function restoreMessagesScrollAnchor(container, snap) {
  if (!container || !snap) return;
  const diff = Number(container.scrollHeight) - Number(snap.height) || 0;
  const maxTop = Math.max(0, Number(container.scrollHeight) - Number(container.clientHeight));
  const nextTop = Math.min(maxTop, Math.max(0, Number(snap.top) + diff));
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
