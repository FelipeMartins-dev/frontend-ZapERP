import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { isNearBottom } from "../scrollUtils";
import { isOutgoingMessage } from "../utils/conversaViewHelpers";
import { isPendingOutgoingTemp } from "../conversaStore";

export function snapThreadToBottom(container, virtualListRef, opts = {}) {
  const min = opts.min === true;
  const gentle = opts.gentle === true && !min;
  const nearThreshold = opts.nearThreshold ?? 120;
  const alreadyNear = container && isNearBottom(container, nearThreshold);
  const scrollContainerToBottom = () => {
    if (!container) return;
    try {
      container.scrollTop = container.scrollHeight;
    } catch {
      /* ignore */
    }
  };
  const scrollVirtualToEnd = () => {
    const v = virtualListRef?.current;
    if (v && typeof v.scrollToEnd === "function") {
      try {
        v.scrollToEnd({ align: "end", behavior: "auto" });
      } catch {
        /* ignore */
      }
    }
  };

  /** Envio otimista no fim: um único sync — mantém viewport na última mensagem sem cadeia agressiva. */
  if (min) {
    scrollVirtualToEnd();
    scrollContainerToBottom();
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(scrollContainerToBottom);
    }
    return;
  }

  if (gentle && alreadyNear) {
    scrollContainerToBottom();
    return;
  }

  scrollVirtualToEnd();
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
      requestAnimationFrame(apply);
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
}) {
  const prevConversaIdRef = useRef(null);
  const prevLastKeyRef = useRef(null);
  /** Após `carregarConversa`, o painel de mensagens só tem altura real quando `loading` vira false — scroll antes disso não chega ao fim. */
  const pendingJumpToBottomRef = useRef(false);
  /** Segundo passe quando a lista ainda estava vazia no 1º snap (virtualizer mede altura só depois). */
  const anchorLatestUntilMsgsRef = useRef(false);
  const prevLoadingForSnapRef = useRef(loading);
  const prevSnapConversaKeyRef = useRef(null);

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
      return;
    }

    // primeira conversa / primeira seleção desta sessão no painel
    if (!prevConversaIdRef.current) {
      prevConversaIdRef.current = conversaIdAtual;
      prevLastKeyRef.current = lastMsgKey;
      shouldStickToBottomRef.current = true;
      pendingJumpToBottomRef.current = true;
      anchorLatestUntilMsgsRef.current = true;
      return;
    }

    // troca de conversa
    if (prevConversaIdRef.current !== conversaIdAtual) {
      prevConversaIdRef.current = conversaIdAtual;
      prevLastKeyRef.current = lastMsgKey;
      shouldStickToBottomRef.current = true;
      pendingJumpToBottomRef.current = true;
      anchorLatestUntilMsgsRef.current = true;
      return;
    }

    // novas mensagens (mesma conversa)
    if (lastMsgKey && lastMsgKey !== prevLastKeyRef.current) {
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
      if (!shouldStickToBottomRef.current) return;
      snapThreadToBottom(container, virtualListRef);
    };

    /* Mobile: poucos passes curtos — ancora nas últimas mensagens ao abrir conversa. */
    if (mobileLike) {
      const snapHard = () => {
        if (!shouldStickToBottomRef.current) return;
        snapThreadToBottom(container, virtualListRef, { min: true });
      };
      snapHard();
      const rafOnce = requestAnimationFrame(snapHard);
      const t1 = window.setTimeout(snapHard, 60);
      const t2 = window.setTimeout(snapHard, 180);
      const t3 = window.setTimeout(snapHard, 380);
      return () => {
        cancelAnimationFrame(rafOnce);
        window.clearTimeout(t1);
        window.clearTimeout(t2);
        window.clearTimeout(t3);
      };
    }

    const rafCap = 10;
    const stickMax = 18;

    snap();
    let n = 0;
    const chain = () => {
      n += 1;
      snap();
      if (n < rafCap) requestAnimationFrame(chain);
    };
    requestAnimationFrame(chain);
    const t1 = window.setTimeout(snap, 0);
    const t2 = window.setTimeout(snap, 120);
    const t3 = window.setTimeout(snap, 380);

    let rafStick = 0;
    let stickAttempts = 0;
    const tryStickOpen = () => {
      const c = messagesContainerRef?.current;
      stickAttempts += 1;
      if (!c || stickAttempts > stickMax) return;
      if (!shouldStickToBottomRef.current) return;
      if (!isNearBottom(c, 200)) {
        snap();
        rafStick = requestAnimationFrame(tryStickOpen);
      }
    };
    rafStick = requestAnimationFrame(tryStickOpen);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      if (t3) window.clearTimeout(t3);
      if (rafStick) cancelAnimationFrame(rafStick);
    };
  }, [
    conversaId,
    loading,
    mensagensCount,
    messagesContainerRef,
    shouldStickToBottomRef,
    virtualListRef,
    suppressAutoScrollRef,
  ]);
}
