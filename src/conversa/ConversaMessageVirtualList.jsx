import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { getMessageListReactKey } from "./conversaStore";

/**
 * Thread de mensagens com virtualização dinâmica (altura medida por linha).
 * O scroll fica no elemento pai (.wa-messages).
 */
export const ConversaMessageVirtualList = forwardRef(function ConversaMessageVirtualList(
  { items, scrollRef, overscan = 12, renderItem, onVirtualContentResize, conversaId },
  ref
) {
  const innerRootRef = useRef(null);
  const isScrollingRef = useRef(false);
  const resizeAfterScrollRef = useRef(false);
  const count = Array.isArray(items) ? items.length : 0;

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef?.current ?? null,
    estimateSize: () => 96,
    overscan,
    scrollPaddingStart: 12,
    scrollPaddingEnd: 16,
    getItemKey: (index) => {
      const item = items[index];
      if (!item) return `row-${index}`;
      if (item.__type === "day") return `day-${item.id}-${index}`;
      if (conversaId != null && conversaId !== "") return getMessageListReactKey(item, conversaId);
      const id = item.id ?? item.tempId ?? item.whatsapp_id ?? index;
      return `msg-${String(id)}-${index}`;
    },
  });

  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex: (index, options) => {
        if (index < 0 || index >= count) return;
        virtualizer.scrollToIndex(index, options);
      },
      /** Ancora na última linha (mensagens recentes) — necessário ao abrir conversa com alturas dinâmicas. */
      scrollToEnd: (options) => {
        if (count <= 0) return;
        virtualizer.scrollToIndex(count - 1, {
          align: "end",
          behavior: "auto",
          ...(options && typeof options === "object" ? options : {}),
        });
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
      }, 150);
    };
    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scrollEl.removeEventListener("scroll", onScroll);
      window.clearTimeout(scrollEndTimer);
      scrollEl.classList.remove("is-scrolling");
    };
  }, [scrollRef, onVirtualContentResize]);

  useLayoutEffect(() => {
    if (!onVirtualContentResize) return undefined;
    const el = innerRootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    let rafOuter = 0;
    let rafInner = 0;
    const run = () => {
      onVirtualContentResize();
    };
    /** Coalesce medições; durante scroll tátil adia snap (menos “puxões” no thread). */
    const schedule = () => {
      if (isScrollingRef.current) {
        resizeAfterScrollRef.current = true;
        return;
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
  }, [onVirtualContentResize, count]);

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
