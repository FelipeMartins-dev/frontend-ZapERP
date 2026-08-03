import { useLayoutEffect, useRef } from "react";
import { isNearBottom } from "../scrollUtils";
import { isOutgoingMessage } from "../utils/conversaViewHelpers";
import { isPendingOutgoingTemp } from "../conversaStore";

function scheduleFrame(fn) {
  if (typeof requestAnimationFrame === "function") {
    return requestAnimationFrame(fn);
  }
  if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
    return window.setTimeout(fn, 16);
  }
  return setTimeout(fn, 16);
}

function cancelFrame(id) {
  if (!id) return;
  if (typeof cancelAnimationFrame === "function") {
    try {
      cancelAnimationFrame(id);
      return;
    } catch {
      /* fallback abaixo */
    }
  }
  try {
    clearTimeout(id);
  } catch {
    /* ignore */
  }
}

function canRunProgrammaticSnap(opts = {}) {
  if (typeof opts.canSnap === "function" && !opts.canSnap()) return false;
  return true;
}

export function snapThreadToBottom(container, virtualListRef, opts = {}) {
  if (!canRunProgrammaticSnap(opts)) return;

  const min = opts.min === true;
  const gentle = opts.gentle === true && !min;
  const nearThreshold = opts.nearThreshold ?? 120;
  const alreadyNear = container && isNearBottom(container, nearThreshold);
  const hasVirtualEnd =
    virtualListRef?.current && typeof virtualListRef.current.scrollToEnd === "function";
  const followUpFrame = opts.followUpFrame !== false;

  const scrollContainerToBottom = () => {
    if (!canRunProgrammaticSnap(opts)) return;
    if (!container) return;
    try {
      container.scrollTop = container.scrollHeight;
    } catch {
      /* ignore */
    }
  };
  const scrollVirtualToEnd = () => {
    if (!canRunProgrammaticSnap(opts)) return;
    if (!hasVirtualEnd) return;
    try {
      virtualListRef.current.scrollToEnd({ align: "end", behavior: "auto" });
    } catch {
      /* ignore */
    }
  };

  /** Envio otimista / abertura: um sync (+ opcional 1 rAF para medição do virtualizer). */
  if (min) {
    if (hasVirtualEnd) {
      scrollVirtualToEnd();
      scrollContainerToBottom();
      if (followUpFrame) {
        scheduleFrame(() => {
          scrollVirtualToEnd();
          scrollContainerToBottom();
        });
      }
    } else {
      scrollContainerToBottom();
      if (followUpFrame) scheduleFrame(scrollContainerToBottom);
    }
    return;
  }

  if (gentle && alreadyNear) {
    if (hasVirtualEnd) {
      scrollVirtualToEnd();
      scrollContainerToBottom();
    }
    else scrollContainerToBottom();
    return;
  }

  if (hasVirtualEnd) {
    scrollVirtualToEnd();
    scrollContainerToBottom();
    if (!gentle && followUpFrame) {
      scheduleFrame(() => {
        scrollVirtualToEnd();
        scrollContainerToBottom();
      });
    }
    return;
  }

  if (container) {
    const apply = () => {
      if (!canRunProgrammaticSnap(opts)) return;
      try {
        container.scrollTop = container.scrollHeight;
      } catch {
        /* ignore */
      }
    };
    apply();
    if (!gentle && followUpFrame) {
      scheduleFrame(apply);
    }
  }
}

export function useAutoScroll({
  conversaId,
  loading,
  lastMsgKey,
  lastMsg,
  myUserId,
  messagesContainerRef,
  shouldStickToBottomRef,
  virtualListRef,
  mensagensCount = 0,
  suppressAutoScrollRef,
  userScrollLockRef,
  cancelOpenSnapPendingRef,
}) {
  const prevConversaIdRef = useRef(null);
  const prevLastKeyRef = useRef(null);
  const pendingJumpToBottomRef = useRef(false);
  const anchorLatestUntilMsgsRef = useRef(false);
  const prevLoadingForSnapRef = useRef(loading);
  const prevSnapConversaKeyRef = useRef(null);
  const openSnapInProgressRef = useRef(false);

  function isUserScrollLocked() {
    return userScrollLockRef?.current === true;
  }

  function snapGuardOpts(extra = {}) {
    return {
      canSnap: () => !isUserScrollLocked() && !suppressAutoScrollRef?.current,
      ...extra,
    };
  }

  function cancelOpenSnapPending() {
    pendingJumpToBottomRef.current = false;
    anchorLatestUntilMsgsRef.current = false;
    openSnapInProgressRef.current = false;
  }

  useLayoutEffect(() => {
    if (cancelOpenSnapPendingRef) {
      cancelOpenSnapPendingRef.current = cancelOpenSnapPending;
    }
    return () => {
      if (cancelOpenSnapPendingRef) cancelOpenSnapPendingRef.current = null;
    };
  }, [cancelOpenSnapPendingRef]);

  useLayoutEffect(() => {
    if (suppressAutoScrollRef?.current) return;
    const conversaIdAtual = conversaId ? String(conversaId) : null;
    const container = messagesContainerRef?.current;

    if (!conversaIdAtual) {
      prevConversaIdRef.current = null;
      prevLastKeyRef.current = null;
      pendingJumpToBottomRef.current = false;
      anchorLatestUntilMsgsRef.current = false;
      openSnapInProgressRef.current = false;
      return;
    }

    if (!prevConversaIdRef.current) {
      prevConversaIdRef.current = conversaIdAtual;
      prevLastKeyRef.current = lastMsgKey;
      shouldStickToBottomRef.current = true;
      pendingJumpToBottomRef.current = true;
      anchorLatestUntilMsgsRef.current = true;
      openSnapInProgressRef.current = false;
      return;
    }

    if (prevConversaIdRef.current !== conversaIdAtual) {
      prevConversaIdRef.current = conversaIdAtual;
      prevLastKeyRef.current = lastMsgKey;
      shouldStickToBottomRef.current = true;
      pendingJumpToBottomRef.current = true;
      anchorLatestUntilMsgsRef.current = true;
      openSnapInProgressRef.current = false;
      return;
    }

    if (lastMsgKey && lastMsgKey !== prevLastKeyRef.current) {
      if (isUserScrollLocked()) {
        prevLastKeyRef.current = lastMsgKey;
        return;
      }
      const fromMe =
        isOutgoingMessage(lastMsg) ||
        lastMsg?.fromMe === true ||
        (myUserId != null && lastMsg?.autor_usuario_id != null && String(lastMsg.autor_usuario_id) === String(myUserId));
      const pendingOwn = fromMe && isPendingOutgoingTemp(lastMsg);
      const shouldAutoScroll = Boolean(shouldStickToBottomRef.current || fromMe);
      if (shouldAutoScroll && container && !isUserScrollLocked()) {
        const near = isNearBottom(container, 200);
        const guard = snapGuardOpts({ followUpFrame: !pendingOwn });
        if (pendingOwn && near) {
          snapThreadToBottom(container, virtualListRef, { min: true, ...guard });
        } else if (shouldStickToBottomRef.current || (fromMe && near)) {
          snapThreadToBottom(container, virtualListRef, {
            gentle: Boolean(fromMe && near),
            nearThreshold: 200,
            followUpFrame: false,
            ...guard,
          });
        }
      }
    }

    prevLastKeyRef.current = lastMsgKey;
  }, [
    conversaId,
    lastMsgKey,
    lastMsg,
    myUserId,
    messagesContainerRef,
    shouldStickToBottomRef,
    virtualListRef,
    suppressAutoScrollRef,
    userScrollLockRef,
  ]);

  useLayoutEffect(() => {
    if (suppressAutoScrollRef?.current) return;
    if (!conversaId) return;
    const convKey = String(conversaId);
    if (prevSnapConversaKeyRef.current !== convKey) {
      prevSnapConversaKeyRef.current = convKey;
      prevLoadingForSnapRef.current = loading;
    }
    const becameReady = prevLoadingForSnapRef.current === true && loading === false;
    prevLoadingForSnapRef.current = loading;
    if (loading) return;

    const shouldSnapLatest =
      pendingJumpToBottomRef.current ||
      anchorLatestUntilMsgsRef.current ||
      (becameReady && mensagensCount > 0);

    if (!shouldSnapLatest) return;
    if (mensagensCount === 0) return;

    const userReadingHistory = isUserScrollLocked();

    if (userReadingHistory) {
      cancelOpenSnapPending();
      return;
    }

    if (pendingJumpToBottomRef.current) pendingJumpToBottomRef.current = false;
    anchorLatestUntilMsgsRef.current = false;

    shouldStickToBottomRef.current = true;
    /*
     * A abertura tem um unico dono: este hook. Um snap sincrono posiciona antes do paint e
     * um unico rAF absorve a primeira medicao do virtualizer. Redimensionamentos posteriores
     * de midia sao tratados pelo ResizeObserver do thread, sem manter timers concorrentes
     * alterando scrollTop depois que a conversa ja esta visivel.
     */
    openSnapInProgressRef.current = true;
    let cancelled = false;
    let rafStabilize = 0;

    const guard = snapGuardOpts();
    const snap = () => {
      if (cancelled || isUserScrollLocked()) return;
      if (!shouldStickToBottomRef.current) return;
      const c = messagesContainerRef?.current;
      snapThreadToBottom(c, virtualListRef, { min: true, followUpFrame: false, ...guard });
    };

    snap();
    rafStabilize = scheduleFrame(() => {
      if (!cancelled) {
        // O segundo e ultimo ajuste cobre a estimativa -> medicao real do ultimo item.
        // Depois deste ponto nenhuma rotina de abertura continua disputando o scroll.
        snap();
      }
      if (!cancelled) openSnapInProgressRef.current = false;
    });

    return () => {
      cancelled = true;
      cancelFrame(rafStabilize);
      openSnapInProgressRef.current = false;
    };
  }, [
    conversaId,
    loading,
    mensagensCount,
    messagesContainerRef,
    shouldStickToBottomRef,
    virtualListRef,
    suppressAutoScrollRef,
    userScrollLockRef,
    cancelOpenSnapPendingRef,
  ]);
}
