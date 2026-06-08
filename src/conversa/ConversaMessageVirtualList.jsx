import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { getMessageListReactKey } from "./conversaStore";

function estimateThreadRowSize(item, mobileThread) {
  if (!item) return mobileThread ? 112 : 96;
  if (item.__type === "day") return mobileThread ? 34 : 32;
  const tipo = String(item.tipo || "").toLowerCase();
  if (["imagem", "image", "video", "sticker"].includes(tipo)) return mobileThread ? 200 : 240;
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
  const resizeAfterScrollRef = useRef(false);
  const resizeThrottleRef = useRef(0);
  const count = Array.isArray(items) ? items.length : 0;

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef?.current ?? null,
    estimateSize: (index) => estimateThreadRowSize(items[index], mobileThread),
    overscan,
    scrollMargin,
    scrollPaddingStart: 12,
    scrollPaddingEnd: 16,
    isScrollingResetDelay: mobileThread ? 320 : 200,
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
    const scrollEl = scrollRef?.current;
    const root = innerRootRef.current;
    if (!scrollEl || !root) return undefined;

    const syncMargin = () => {
      const next = Math.max(0, Math.round(root.offsetTop));
      scrollMarginRef.current = next;
      setScrollMargin((prev) => (prev === next ? prev : next));
    };

    syncMargin();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncMargin) : null;
    ro?.observe(scrollEl);
    return () => ro?.disconnect();
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
      },
      /** Âncora da 1ª linha visível — restaurar posição após prepend (loadMore). */
      getScrollAnchor: () => {
        const scrollEl = scrollRef?.current;
        const virtualItems = virtualizer.getVirtualItems();
        if (!scrollEl || !virtualItems.length) return null;
        const first = virtualItems[0];
        return {
          index: first.index,
          scrollTop: scrollEl.scrollTop,
          itemStart: first.start,
          margin: scrollMarginRef.current,
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
          scrollEl.scrollTop = Math.max(0, row.start + scrollMarginRef.current - prevOffsetInViewport);
        };

        apply();
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
      if (!resizeAfterScrollRef.current || !onVirtualContentResize) return;
      resizeAfterScrollRef.current = false;
      onVirtualContentResize();
    };
    const onScroll = () => {
      isScrollingRef.current = true;
      scrollEl.classList.add("is-scrolling");
      window.clearTimeout(scrollEndTimer);
      scrollEndTimer = window.setTimeout(() => {
        isScrollingRef.current = false;
        scrollEl.classList.remove("is-scrolling");
        flushResizeAfterScroll();
      }, mobileThread ? 280 : 180);
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
    const prev = prevCountRef.current;
    prevCountRef.current = count;
    if (prev === 0 && count > 0) {
      requestAnimationFrame(() => {
        if (count <= 0) return;
        virtualizer.scrollToIndex(count - 1, { align: "end", behavior: "auto" });
      });
    }
  }, [count, virtualizer]);

  useLayoutEffect(() => {
    if (!onVirtualContentResize) return undefined;
    const el = innerRootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    let rafOuter = 0;
    let rafInner = 0;
    const run = () => {
      onVirtualContentResize();
    };
    const schedule = () => {
      if (isScrollingRef.current) {
        resizeAfterScrollRef.current = true;
        return;
      }
      if (mobileThread) {
        const now = Date.now();
        if (now - resizeThrottleRef.current < 160) return;
        resizeThrottleRef.current = now;
      }
      if (rafOuter || rafInner) return;
      rafOuter = requestAnimationFrame(() => {
        rafOuter = 0;
        rafInner = requestAnimationFrame(() => {
          rafInner = 0;
          run();
        });
      });
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    schedule();
    return () => {
      ro.disconnect();
      if (rafOuter) cancelAnimationFrame(rafOuter);
      if (rafInner) cancelAnimationFrame(rafInner);
    };
  }, [onVirtualContentResize, count, mobileThread]);

  if (count === 0) return null;

  return (
    <div
      ref={innerRootRef}
      className="wa-messages-virtual-root"
      style={{
        height: virtualizer.getTotalSize(),
        width: "100%",
        position: "relative",
      }}
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
