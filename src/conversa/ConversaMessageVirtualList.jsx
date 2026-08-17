import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { getMessageListReactKey } from "./conversaStore";

/*
 * Chamado pelo `estimateSize` \u2014 ou seja, por item, a cada passagem de medi\u00e7\u00e3o do
 * virtualizador. Ver a nota g\u00e9mea em ThreadRow.jsx: recorta a 1.\u00aa linha sem partir o corpo
 * todo e s\u00f3 faz `normalize("NFD")` se a linha j\u00e1 contiver "movimenta".
 */
function isInternalMovementEstimate(item) {
  if (!item) return false;
  if (item?.mensagem_interna === true) return true;
  if (String(item?.tipo || "").toLowerCase() === "movimentacao_interna_atendimento") return true;
  const raw = String(item?.texto ?? item?.conteudo ?? "").trim();
  if (!raw) return false;
  const nl = raw.indexOf("\n");
  const lower = (nl === -1 ? raw : raw.slice(0, nl)).toLowerCase();
  if (!lower.includes("movimenta")) return false;
  return lower
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .includes("movimentacao interna");
}

function estimateThreadRowSize(item, mobileThread) {
  if (!item) return mobileThread ? 112 : 96;
  if (item.__type === "day") return mobileThread ? 34 : 32;
  if (isInternalMovementEstimate(item)) return mobileThread ? 116 : 98;
  const tipo = String(item.tipo || "").toLowerCase();
  if (tipo === "sticker") return mobileThread ? 132 : 140;
  /* Alinhado à caixa reservada da imagem (width + aspect-ratio no CSS): reduz a correção
     do measureElement na abertura, que era parte do "pulo". */
  if (["imagem", "image", "video"].includes(tipo)) return mobileThread ? 300 : 320;
  if (["audio", "ptt", "voice"].includes(tipo)) return mobileThread ? 72 : 68;
  if (["documento", "document", "arquivo", "file"].includes(tipo)) return mobileThread ? 76 : 72;
  const text = String(item.texto ?? item.conteudo ?? item.message ?? item.body ?? "");
  const lines = Math.max(1, Math.ceil(text.length / (mobileThread ? 38 : 44)));
  return Math.min(mobileThread ? 320 : 360, (mobileThread ? 52 : 48) + lines * (mobileThread ? 18 : 20));
}

/**
 * Thread de mensagens com virtualização dinâmica (altura medida por linha).
 * O scroll fica no elemento pai (.wa-messages).
 */
export const ConversaMessageVirtualList = forwardRef(function ConversaMessageVirtualList(
  { items, scrollRef, overscan = 12, mobileThread = false, renderItem, onVirtualContentResize, conversaId },
  ref
) {
  const innerRootRef = useRef(null);
  const scrollMarginRef = useRef(0);
  const [scrollMargin, setScrollMargin] = useState(0);
  const isScrollingRef = useRef(false);
  const pendingScrollMarginRef = useRef(null);
  const applyMarginFnRef = useRef(null);
  const count = Array.isArray(items) ? items.length : 0;

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef?.current ?? null,
    estimateSize: (index) => estimateThreadRowSize(items[index], mobileThread),
    overscan,
    scrollMargin,
    scrollPaddingStart: 12,
    scrollPaddingEnd: 16,
    isScrollingResetDelay: mobileThread ? 280 : 200,
    useAnimationFrameWithResizeObserver: mobileThread,
    getItemKey: (index) => {
      const item = items[index];
      if (!item) return `row-${index}`;
      if (item.__type === "day") return `day-${item.id}-${index}`;
      if (conversaId != null && conversaId !== "") return getMessageListReactKey(item, conversaId);
      const id = item.id ?? item.tempId ?? item.whatsapp_id ?? index;
      return `msg-${String(id)}-${index}`;
    },
  });

  useLayoutEffect(() => {
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => {
      if (isScrollingRef.current || instance.isScrolling) return false;
      const scrollEl = scrollRef?.current;
      if (!scrollEl) return false;
      const margin = scrollMarginRef.current;
      const scrollTop = scrollEl.scrollTop;
      const viewportBottom = scrollTop + scrollEl.clientHeight;
      const distanceToBottom = scrollEl.scrollHeight - viewportBottom;
      const readingHistory = distanceToBottom > 120;
      if (readingHistory) {
        const itemBottom = item.end + margin;
        return itemBottom <= scrollTop;
      }
      /*
       * Perto do fim, o ConversaView é o único responsável por manter a âncora inferior.
       * Se o virtualizer também compensar cada medição de bolha, as duas correções se
       * somam e produzem o "pulo" visível (principalmente em envio otimista e mídia).
       */
      return false;
    };
  }, [virtualizer, scrollRef]);

  useLayoutEffect(() => {
    const scrollEl = scrollRef?.current;
    const root = innerRootRef.current;
    if (!scrollEl || !root) return undefined;

    let marginTimer = 0;
    const applyMargin = (next) => {
      const prev = scrollMarginRef.current;
      if (prev === next) return;
      const scrollEl = scrollRef?.current;
      if (scrollEl && !isScrollingRef.current) {
        const delta = next - prev;
        if (delta !== 0) {
          /*
           * Perto do fim, o ConversaView/useAutoScroll é dono da âncora inferior.
           * Compensar scrollTop aqui + snapIfStickBottom somava dois ajustes e
           * gerava “pulo” na abertura (banner/load-older mudam o offsetTop).
           */
          const distanceToBottom =
            scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
          if (distanceToBottom > 120) {
            try {
              scrollEl.scrollTop = Math.max(0, scrollEl.scrollTop + delta);
            } catch {
              /* ignore */
            }
          }
        }
      }
      scrollMarginRef.current = next;
      setScrollMargin((prevState) => (prevState === next ? prevState : next));
    };

    applyMarginFnRef.current = applyMargin;

    const syncMargin = () => {
      const next = Math.max(0, Math.round(root.offsetTop));
      if (isScrollingRef.current) {
        pendingScrollMarginRef.current = next;
        return;
      }
      if (mobileThread) {
        window.clearTimeout(marginTimer);
        marginTimer = window.setTimeout(() => applyMargin(next), 48);
        return;
      }
      applyMargin(next);
    };

    syncMargin();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncMargin) : null;
    ro?.observe(scrollEl);
    return () => {
      window.clearTimeout(marginTimer);
      ro?.disconnect();
      if (applyMarginFnRef.current === applyMargin) applyMarginFnRef.current = null;
    };
  }, [scrollRef, count, mobileThread]);

  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex: (index, options) => {
        if (index < 0 || index >= count) return;
        virtualizer.scrollToIndex(index, options);
      },
      scrollToEnd: (options) => {
        if (count <= 0) return;
        virtualizer.scrollToIndex(count - 1, {
          align: "end",
          behavior: "auto",
          ...(options && typeof options === "object" ? options : {}),
        });
        const scrollEl = scrollRef?.current;
        if (scrollEl) {
          try {
            scrollEl.scrollTop = scrollEl.scrollHeight;
          } catch {
            /* ignore */
          }
        }
      },
      getScrollAnchor: () => {
        const scrollEl = scrollRef?.current;
        const virtualItems = virtualizer.getVirtualItems();
        if (!scrollEl || !virtualItems.length) return null;
        const margin = scrollMarginRef.current;
        const scrollTop = scrollEl.scrollTop;
        const first =
          virtualItems.find((item) => item.end + margin >= scrollTop + 1) ??
          virtualItems[0];
        return {
          index: first.index,
          scrollTop: scrollEl.scrollTop,
          itemStart: first.start,
          margin,
        };
      },
      restoreAfterPrepend: (anchor, prependedCount) => {
        const scrollEl = scrollRef?.current;
        if (!scrollEl || !anchor || prependedCount <= 0) return;
        const newIndex = anchor.index + prependedCount;
        if (newIndex < 0 || newIndex >= count) return;
        const prevOffsetInViewport = anchor.itemStart + anchor.margin - anchor.scrollTop;
        virtualizer.scrollToIndex(newIndex, { align: "start", behavior: "auto" });
        const apply = () => {
          const row = virtualizer.getVirtualItems().find((v) => v.index === newIndex);
          if (!row) return;
          const margin = anchor.margin ?? scrollMarginRef.current;
          scrollEl.scrollTop = Math.max(0, row.start + margin - prevOffsetInViewport);
        };
        apply();
        requestAnimationFrame(apply);
        requestAnimationFrame(apply);
      },
    }),
    [virtualizer, count]
  );

  useEffect(() => {
    const scrollEl = scrollRef?.current;
    if (!scrollEl) return undefined;

    let scrollEndTimer = 0;
    const flushResizeAfterScroll = () => {
      if (pendingScrollMarginRef.current != null) {
        applyMarginFnRef.current?.(pendingScrollMarginRef.current);
        pendingScrollMarginRef.current = null;
      }
    };

    const onScroll = () => {
      if (!isScrollingRef.current) {
        isScrollingRef.current = true;
        scrollEl.classList.add("is-scrolling");
      }
      window.clearTimeout(scrollEndTimer);
      scrollEndTimer = window.setTimeout(() => {
        isScrollingRef.current = false;
        scrollEl.classList.remove("is-scrolling");
        flushResizeAfterScroll();
      }, mobileThread ? 80 : 180);
    };

    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scrollEl.removeEventListener("scroll", onScroll);
      window.clearTimeout(scrollEndTimer);
      scrollEl.classList.remove("is-scrolling");
    };
  }, [scrollRef, onVirtualContentResize, mobileThread]);

  const prevCountRef = useRef(0);
  useLayoutEffect(() => {
    /*
     * O snap de abertura pertence exclusivamente ao useAutoScroll (ConversaView).
     * Antes, ao aparecer o 1º lote (prev === 0 && count > 0), este componente também
     * disparava scrollToIndex(count-1) + scrollTop = scrollHeight — no desktop os dois
     * snaps corriam juntos e, reagindo às remedições do virtualizer, produziam o "pulo"
     * (ir ao topo e voltar ao fim). O mobile já pulava este trecho; agora o desktop
     * também, deixando uma única fonte de âncora na abertura.
     */
    prevCountRef.current = count;
  }, [count]);

  useLayoutEffect(() => {
    if (!onVirtualContentResize) return undefined;
    const el = innerRootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;

    const run = () => { onVirtualContentResize(); };
    const schedule = () => {
      /*
       * ResizeObserver roda após o layout e antes do paint. Reancorar aqui evita
       * expor 1–2 frames com espaço vazio; o antigo duplo rAF tornava o salto visível.
       */
      run();
    };

    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    schedule();
    return () => {
      ro.disconnect();
    };
  }, [onVirtualContentResize, count, mobileThread]);

  if (count === 0) return null;

  return (
    <div
      ref={innerRootRef}
      className="wa-messages-virtual-root"
      style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}
    >
      {virtualizer.getVirtualItems().map((vRow) => (
        <div
          key={vRow.key}
          data-index={vRow.index}
          ref={virtualizer.measureElement}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            maxWidth: "100%",
            transform: `translate3d(0, ${vRow.start}px, 0)`,
          }}
        >
          {renderItem(items[vRow.index], vRow.index)}
        </div>
      ))}
    </div>
  );
});

function getStaticItemKey(item, index, conversaId) {
  if (!item) return `row-${index}`;
  if (item.__type === "day") return `day-${item.id}-${index}`;
  if (conversaId != null && conversaId !== "") return getMessageListReactKey(item, conversaId);
  const id = item.id ?? item.tempId ?? item.whatsapp_id ?? index;
  return `msg-${String(id)}-${index}`;
}

/**
 * Lista natural para mobile: evita transforms/medição dinâmica da virtualização durante toque.
 * O lote atual é pequeno o bastante para render direto e o scroll nativo fica mais previsível.
 * Renderiza no máximo MOBILE_STATIC_MAX itens para evitar acúmulo de nós DOM em sessões longas.
 */
const MOBILE_STATIC_MAX = 60;

export const ConversaMessageStaticList = forwardRef(function ConversaMessageStaticList(
  { items, scrollRef, renderItem, onVirtualContentResize, conversaId },
  ref
) {
  const rootRef = useRef(null);
  const count = Array.isArray(items) ? items.length : 0;
  const offset = count > MOBILE_STATIC_MAX ? count - MOBILE_STATIC_MAX : 0;
  const visibleItems = useMemo(
    () => (offset > 0 ? items.slice(offset) : items),
    [items, offset]
  );

  const getRowByIndex = (index) => rootRef.current?.querySelector?.(`[data-index="${index}"]`) ?? null;
  const getRowByKey = (key) => {
    if (!key || !rootRef.current) return null;
    return Array.from(rootRef.current.children || []).find(
      (row) => row.getAttribute("data-row-key") === String(key)
    ) ?? null;
  };

  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex: (index, options = {}) => {
        const scrollEl = scrollRef?.current;
        const root = rootRef.current;
        const row = getRowByIndex(index);
        if (!scrollEl || !root || !row) return;
        const align = options?.align || "start";
        const rowTop = row.offsetTop - root.offsetTop;
        let top = rowTop;
        if (align === "end") {
          top = rowTop + row.offsetHeight - scrollEl.clientHeight;
        } else if (align === "center") {
          top = rowTop - (scrollEl.clientHeight - row.offsetHeight) / 2;
        }
        try {
          scrollEl.scrollTo({ top: Math.max(0, top), behavior: options?.behavior || "auto" });
        } catch {
          scrollEl.scrollTop = Math.max(0, top);
        }
      },
      scrollToEnd: () => {
        const scrollEl = scrollRef?.current;
        if (!scrollEl) return;
        try {
          scrollEl.scrollTop = scrollEl.scrollHeight;
        } catch {
          /* ignore */
        }
      },
      getScrollAnchor: () => {
        const scrollEl = scrollRef?.current;
        const root = rootRef.current;
        if (!scrollEl || !root) return null;
        const viewport = scrollEl.getBoundingClientRect();
        const rows = Array.from(root.children || []);
        const first =
          rows.find((row) => row.getBoundingClientRect().bottom >= viewport.top + 1) ??
          rows[0];
        if (!first) return null;
        return {
          index: Number(first.getAttribute("data-index")) || 0,
          key: first.getAttribute("data-row-key") || null,
          offset: first.getBoundingClientRect().top - viewport.top,
          scrollTop: scrollEl.scrollTop,
          scrollHeight: scrollEl.scrollHeight,
        };
      },
      restoreAfterPrepend: (anchor, prependedCount) => {
        const scrollEl = scrollRef?.current;
        if (!scrollEl || !anchor || prependedCount <= 0) return;
        const newIndex = anchor.index + prependedCount;
        if (newIndex < 0 || newIndex >= count) return;
        const apply = () => {
          const row = getRowByKey(anchor.key) || getRowByIndex(newIndex);
          if (!row) return;
          const viewport = scrollEl.getBoundingClientRect();
          const currentOffset = row.getBoundingClientRect().top - viewport.top;
          scrollEl.scrollTop += currentOffset - (anchor.offset ?? 0);
        };
        apply();
        requestAnimationFrame(apply);
        requestAnimationFrame(apply);
      },
    }),
    [count, scrollRef]
  );

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !onVirtualContentResize || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => {
      onVirtualContentResize();
    });
    ro.observe(root);
    return () => {
      ro.disconnect();
    };
  }, [onVirtualContentResize, count]);

  if (count === 0) return null;

  return (
    <div ref={rootRef} className="wa-messages-static-root">
      {visibleItems.map((item, i) => {
        const absIndex = offset + i;
        const rowKey = getStaticItemKey(item, absIndex, conversaId);
        return (
          <div
            key={rowKey}
            data-index={absIndex}
            data-row-key={rowKey}
            className="wa-messages-static-row"
          >
            {renderItem(item, absIndex)}
          </div>
        );
      })}
    </div>
  );
});
