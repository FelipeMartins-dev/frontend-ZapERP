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

export function snapThreadToBottom(container, virtualListRef, opts = {}) {
  const min = opts.min === true;
  const gentle = opts.gentle === true && !min;
  const nearThreshold = opts.nearThreshold ?? 120;
  const alreadyNear = container && isNearBottom(container, nearThreshold);
  const hasVirtualEnd =
    virtualListRef?.current && typeof virtualListRef.current.scrollToEnd === "function";
  const scrollContainerToBottom = () => {
    if (!container) return;
    try {
      container.scrollTop = container.scrollHeight;
    } catch {
      /* ignore */
    }
  };
  const scrollVirtualToEnd = () => {
    if (!hasVirtualEnd) return;
    try {
      virtualListRef.current.scrollToEnd({ align: "end", behavior: "auto" });
    } catch {
      /* ignore */
    }
  };

  /** Envio otimista no fim: um único sync — mantém viewport na última mensagem sem cadeia agressiva. */
  if (min) {
    if (hasVirtualEnd) {
      scrollVirtualToEnd();
      scheduleFrame(scrollVirtualToEnd);
    } else {
      scrollContainerToBottom();
      scheduleFrame(scrollContainerToBottom);
    }
    return;
  }

  if (gentle && alreadyNear) {
    if (hasVirtualEnd) scrollVirtualToEnd();
    else scrollContainerToBottom();
    return;
  }

  if (hasVirtualEnd) {
    scrollVirtualToEnd();
    if (!gentle) scheduleFrame(scrollVirtualToEnd);
    return;
  }

  if (container) {
    const apply = () => {
      try {
        container.scrollTop = container.scrollHeight;
      } catch {
        /* ignore */
      }
    };
    apply();
    if (!gentle) {
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
  /** Contagem bruta no store — quando passa de 0 a N após o load, força novo snap até às mensagens mais recentes. */
  mensagensCount = 0,
  /** Quando true (ex.: Assumir), não reancora o scroll — a tela permanece onde estava. */
  suppressAutoScrollRef,
  /** true enquanto o dedo está no thread — bloqueia snap programático que “puxa” o scroll de volta. */
  userScrollLockRef,
}) {
  const prevConversaIdRef = useRef(null);
  const prevLastKeyRef = useRef(null);
  /** Após `carregarConversa`, o painel de mensagens só tem altura real quando `loading` vira false — scroll antes disso não chega ao fim. */
  const pendingJumpToBottomRef = useRef(false);
  /** Segundo passe quando a lista ainda estava vazia no 1º snap (virtualizer mede altura só depois). */
  const anchorLatestUntilMsgsRef = useRef(false);
  const prevLoadingForSnapRef = useRef(loading);
  const prevSnapConversaKeyRef = useRef(null);
  const openSnapInProgressRef = useRef(false);
  const initialAnchorDoneRef = useRef(false);

  function isUserScrollLocked() {
    return userScrollLockRef?.current === true;
  }

  // useLayoutEffect síncrono: ancora o scroll na base ANTES do browser pintar.
  // Isso elimina a "animação visível" (smooth scroll que jogava a tela pra cima
  // quando o usuário enviava uma mensagem). Para mensagens próprias / stick-to-bottom
  // a nova bolha simplesmente aparece colada no fundo — sem movimento perceptível.
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
      initialAnchorDoneRef.current = false;
      return;
    }

    // primeira conversa / primeira seleção desta sessão no painel
    if (!prevConversaIdRef.current) {
      prevConversaIdRef.current = conversaIdAtual;
      prevLastKeyRef.current = lastMsgKey;
      shouldStickToBottomRef.current = true;
      pendingJumpToBottomRef.current = true;
      anchorLatestUntilMsgsRef.current = true;
      openSnapInProgressRef.current = false;
      initialAnchorDoneRef.current = false;
      return;
    }

    // troca de conversa
    if (prevConversaIdRef.current !== conversaIdAtual) {
      prevConversaIdRef.current = conversaIdAtual;
      prevLastKeyRef.current = lastMsgKey;
      shouldStickToBottomRef.current = true;
      pendingJumpToBottomRef.current = true;
      anchorLatestUntilMsgsRef.current = true;
      openSnapInProgressRef.current = false;
      initialAnchorDoneRef.current = false;
      return;
    }

    // novas mensagens (mesma conversa)
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
      if (shouldAutoScroll && container) {
        const near = isNearBottom(container, 200);
        if (pendingOwn && near) {
          snapThreadToBottom(container, virtualListRef, { min: true });
        } else {
          snapThreadToBottom(container, virtualListRef, {
            gentle: Boolean(fromMe && near),
            nearThreshold: 200,
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

  // Ao abrir/trocar conversa: ancora nas últimas mensagens UMA vez ao ficar pronto (não reexecuta a cada nova msg).
  // Menos rAF/timers no mobile = scroll tátil mais livre depois de entrar.
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
    if (isUserScrollLocked()) return;

    /* Lista ainda vazia: mantém flags para reancorar quando as mensagens chegarem do GET/merge. */
    if (mensagensCount === 0) return;

    const container = messagesContainerRef?.current;
    if (pendingJumpToBottomRef.current) pendingJumpToBottomRef.current = false;
    anchorLatestUntilMsgsRef.current = false;

    shouldStickToBottomRef.current = true;
    const mobileLike =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(max-width: 640px)").matches;

    const snap = () => {
      if (!shouldStickToBottomRef.current || isUserScrollLocked()) return;
      snapThreadToBottom(container, virtualListRef);
    };

    /* Mobile: um snap + um rAF — timers extras puxavam o scroll de volta e travavam o arraste para cima. */
    if (mobileLike) {
      openSnapInProgressRef.current = true;
      const snapHard = () => {
        if (!shouldStickToBottomRef.current || isUserScrollLocked()) return;
        snapThreadToBottom(container, virtualListRef, { min: true });
      };
      snapHard();
      const rafOnce = scheduleFrame(() => {
        snapHard();
        openSnapInProgressRef.current = false;
        initialAnchorDoneRef.current = true;
      });
      return () => {
        cancelFrame(rafOnce);
        openSnapInProgressRef.current = false;
      };
    }

    openSnapInProgressRef.current = true;

    const rafCap = 10;
    const stickMax = 18;

    let cancelled = false;

    snap();
    let rafChain = 0;
    let n = 0;
    const chain = () => {
      if (cancelled) return;
      n += 1;
      snap();
      if (n < rafCap) {
        rafChain = scheduleFrame(chain);
      }
    };
    rafChain = scheduleFrame(chain);

    const t1 = window.setTimeout(() => {
      if (!cancelled) snap();
    }, 0);
    const t2 = window.setTimeout(() => {
      if (!cancelled) snap();
    }, 120);
    const t3 = window.setTimeout(() => {
      if (!cancelled) snap();
    }, 380);

    let rafStick = 0;
    let stickAttempts = 0;
    const tryStickOpen = () => {
      if (cancelled) return;
      const c = messagesContainerRef?.current;
      stickAttempts += 1;
      if (!c || stickAttempts > stickMax) return;
      if (!shouldStickToBottomRef.current) return;
      if (!isNearBottom(c, 200)) {
        snap();
        rafStick = scheduleFrame(tryStickOpen);
      }
    };
    rafStick = scheduleFrame(tryStickOpen);

    initialAnchorDoneRef.current = true;
    openSnapInProgressRef.current = false;

    return () => {
      cancelled = true;
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      cancelFrame(rafChain);
      cancelFrame(rafStick);
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
  ]);
}
