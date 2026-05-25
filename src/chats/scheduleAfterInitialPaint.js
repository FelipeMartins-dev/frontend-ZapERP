/**
 * Agenda trabalho após o primeiro paint, preferindo idle (não compete com GET da lista).
 * @param {() => void} callback
 * @param {number} delayMs atraso mínimo antes de considerar idle/timeout
 * @returns {() => void} cancel
 */
export function scheduleAfterInitialPaint(callback, delayMs = 0) {
  if (typeof window === "undefined") return () => {};

  let cancelled = false;
  let delayTimeoutId = null;
  let fallbackTimeoutId = null;
  let idleId = null;

  const run = () => {
    if (cancelled) return;

    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(
        () => {
          if (!cancelled) callback();
        },
        { timeout: 2500 }
      );
    } else {
      fallbackTimeoutId = window.setTimeout(() => {
        if (!cancelled) callback();
      }, 0);
    }
  };

  delayTimeoutId = window.setTimeout(run, Math.max(0, delayMs));

  return () => {
    cancelled = true;
    if (delayTimeoutId != null) window.clearTimeout(delayTimeoutId);
    if (fallbackTimeoutId != null) window.clearTimeout(fallbackTimeoutId);
    if (idleId != null && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(idleId);
    }
  };
}
