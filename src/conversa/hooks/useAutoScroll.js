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
  const openSnapUserCancelledRef = useRef(false);

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
    openSnapUserCancelledRef.current = true;
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
      openSnapUserCancelledRef.current = false;
      return;
    }

    if (prevConversaIdRef.current !== conversaIdAtual) {
      prevConversaIdRef.current = conversaIdAtual;
      prevLastKeyRef.current = lastMsgKey;
      shouldStickToBottomRef.current = true;
      pendingJumpToBottomRef.current = true;
      anchorLatestUntilMsgsRef.current = true;
      openSnapInProgressRef.current = false;
      openSnapUserCancelledRef.current = false;
      return;
    }

    if (lastMsgKey && lastMsgKey !== prevLastKeyRef.current) {
      if (openSnapInProgressRef.current || isUserScrollLocked()) {
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
    const mobileLike =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(max-width: 640px)").matches;

    openSnapInProgressRef.current = true;
    let cancelled = false;
    let rafChain = 0;
    let rafStick = 0;
    let rafOnce = 0;
    let t1 = 0;
    let t2 = 0;
    let t3 = 0;
    let t4 = 0;
    let t5 = 0;
    let finished = false;

    const finishOpenSnap = () => {
      if (finished || cancelled) return;
      finished = true;
      openSnapInProgressRef.current = false;
    };

    const guard = snapGuardOpts();
    const snap = ({ force = false } = {}) => {
      if (cancelled || isUserScrollLocked()) return;
      if (force && openSnapUserCancelledRef.current) return;
      if (!force && !shouldStickToBottomRef.current) return;
      const c = messagesContainerRef?.current;
      snapThreadToBottom(c, virtualListRef, { followUpFrame: false, ...guard });
    };

    if (mobileLike) {
      const snapHard = () => {
        if (cancelled || isUserScrollLocked()) return;
        if (!shouldStickToBottomRef.current) return;
        const c = messagesContainerRef?.current;
        snapThreadToBottom(c, virtualListRef, { min: true, followUpFrame: false, ...guard });
      };
      snapHard();
      rafOnce = scheduleFrame(() => {
        snapHard();
        finishOpenSnap();
      });
      return () => {
        cancelled = true;
        cancelFrame(rafOnce);
        openSnapInProgressRef.current = false;
      };
    }

    const rafCap = 6;
    const stickMax = 12;
    let n = 0;

    snap();
    const chain = () => {
      if (cancelled) return;
      n += 1;
      snap();
      if (n < rafCap) {
        rafChain = scheduleFrame(chain);
      } else {
        finishOpenSnap();
      }
    };
    rafChain = scheduleFrame(chain);

    t1 = window.setTimeout(() => {
      if (!cancelled) snap();
    }, 0);
    t2 = window.setTimeout(() => {
      if (!cancelled) snap();
    }, 120);
    t3 = window.setTimeout(() => {
      if (!cancelled) {
        snap();
        finishOpenSnap();
      }
    }, 380);
    t4 = window.setTimeout(() => {
      if (!cancelled) snap({ force: true });
    }, 800);
    t5 = window.setTimeout(() => {
      if (!cancelled) snap({ force: true });
    }, 1400);

    let stickAttempts = 0;
    const tryStickOpen = () => {
      if (cancelled || finished) return;
      const c = messagesContainerRef?.current;
      stickAttempts += 1;
      if (!c || stickAttempts > stickMax) {
        finishOpenSnap();
        return;
      }
      if (!shouldStickToBottomRef.current || isUserScrollLocked()) {
        finishOpenSnap();
        return;
      }
      if (isNearBottom(c, 200)) {
        finishOpenSnap();
        return;
      }
      snap();
      rafStick = scheduleFrame(tryStickOpen);
    };
    rafStick = scheduleFrame(tryStickOpen);

    return () => {
      cancelled = true;
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.clearTimeout(t4);
      window.clearTimeout(t5);
      cancelFrame(rafChain);
      cancelFrame(rafStick);
      cancelFrame(rafOnce);
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
