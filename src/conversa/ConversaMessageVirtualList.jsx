import { forwardRef, useImperativeHandle } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

/**
 * Thread de mensagens com virtualização dinâmica (altura medida por linha).
 * O scroll fica no elemento pai (.wa-messages).
 */
export const ConversaMessageVirtualList = forwardRef(function ConversaMessageVirtualList(
  { items, scrollRef, overscan = 12, renderItem },
  ref
) {
  const count = Array.isArray(items) ? items.length : 0;

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef?.current ?? null,
    estimateSize: () => 92,
    overscan,
    getItemKey: (index) => {
      const item = items[index];
      if (!item) return `row-${index}`;
      if (item.__type === "day") return `day-${item.id}-${index}`;
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

  if (count === 0) return null;

  return (
    <div
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
            transform: `translateY(${vRow.start}px)`,
          }}
        >
          {renderItem(items[vRow.index], vRow.index)}
        </div>
      ))}
    </div>
  );
});
