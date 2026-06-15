import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useConversaStore } from "../conversa/conversaStore";
import { chatRowListStoreKey } from "./chatListStoreCompare";
import { CHAT_LIST_ROW_GAP, estimateChatListRowSize } from "./chatListRowAtendimento";
import MemoChatRow from "./ChatListRow";
import { useWhatsappInstancesStore } from "./whatsappInstancesStore";
import { chatRowStableKey } from "./chatRowStableKey";

/** A partir deste tamanho, lista virtualizada (crítico na aba Todas no mobile). */
export const CHAT_LIST_VIRTUAL_THRESHOLD = 48;

function renderChatListRow(c, selectedId, props) {
  const id = c?.id;
  const clienteSemConv = Boolean(c?.sem_conversa && c?.cliente_id);
  if (!clienteSemConv && (id == null || id === "")) return null;
  const active =
    !clienteSemConv &&
    id != null &&
    selectedId != null &&
    String(selectedId) === String(id);

  const rowKey = chatRowStableKey(c) || (clienteSemConv ? `sem-${c.cliente_id}` : String(id));

  return (
    <MemoChatRow
      key={rowKey}
      chat={c}
      active={active}
      onSelect={props.onSelect}
      onOpenClienteSemConversa={props.onOpenClienteSemConversa}
      currentUserId={props.currentUserId}
      isMenuOpen={String(props.openConversationId) === String(c?.id)}
      onToggleMenu={props.onToggleMenu}
      pendentesFuncionarioSet={props.pendentesFuncionarioSet}
      minuteTick={props.minuteTick}
      showWhatsappInstanceUi={props.showWhatsappInstanceUi}
    />
  );
}

const ChatListRows = memo(function ChatListRows({
  chatsFiltrados,
  isMobileLayout,
  scrollRef,
  scrollSaveRef,
  scrollTopNoncePrevRef,
  chatListScrollToTopNonce,
  onSelect,
  onOpenClienteSemConversa,
  currentUserId,
  openConversationId,
  onToggleMenu,
  pendentesFuncionarioSet,
}) {
  const showWhatsappInstanceUi = useWhatsappInstancesStore((s) => s.hasMultiple);
  const mobileSelectedId = useConversaStore((s) => (isMobileLayout ? s.selectedId : null));
  const selectedIdHighlight = useConversaStore((s) => (isMobileLayout ? null : s.selectedId));
  const mobileConversaAberta = isMobileLayout && mobileSelectedId != null;
  const useVirtual = chatsFiltrados.length >= CHAT_LIST_VIRTUAL_THRESHOLD;

  const [minuteTick, setMinuteTick] = useState(() => Date.now());
  useEffect(() => {
    const ms = 60000 - (Date.now() % 60000) + 25;
    let intervalId;
    const timeoutId = setTimeout(() => {
      setMinuteTick(Date.now());
      intervalId = setInterval(() => setMinuteTick(Date.now()), 60000);
    }, ms);
    return () => {
      clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  const onToggleMenuRef = useRef(onToggleMenu);
  onToggleMenuRef.current = onToggleMenu;
  const stableOnToggleMenu = useCallback((conversationId, triggerEl) => {
    onToggleMenuRef.current?.(conversationId, triggerEl);
  }, []);

  const rowProps = useMemo(
    () => ({
      onSelect,
      onOpenClienteSemConversa,
      currentUserId,
      openConversationId,
      onToggleMenu: stableOnToggleMenu,
      pendentesFuncionarioSet,
      minuteTick,
      showWhatsappInstanceUi,
    }),
    [
      onSelect,
      onOpenClienteSemConversa,
      currentUserId,
      openConversationId,
      stableOnToggleMenu,
      pendentesFuncionarioSet,
      minuteTick,
      showWhatsappInstanceUi,
    ]
  );

  const prevMobileSelectedRef = useRef(mobileSelectedId);

  const chatsLayoutKey = useMemo(
    () => chatsFiltrados.map((c) => chatRowListStoreKey(c)).join("\n"),
    [chatsFiltrados]
  );

  const estimateRowSize = useCallback(
    (index) =>
      estimateChatListRowSize(chatsFiltrados[index], isMobileLayout, pendentesFuncionarioSet),
    [chatsFiltrados, isMobileLayout, pendentesFuncionarioSet]
  );

  const virtualizer = useVirtualizer({
    count: chatsFiltrados.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: estimateRowSize,
    gap: CHAT_LIST_ROW_GAP,
    overscan: isMobileLayout ? 6 : 10,
    scrollPaddingStart: 4,
    scrollPaddingEnd: 8,
    /* Mobile: adia remeasure após o dedo soltar — reduz thrash sem desativar medição real. */
    isScrollingResetDelay: isMobileLayout ? 220 : 150,
    getItemKey: (index) => {
      const c = chatsFiltrados[index];
      if (!c) return `row-${index}`;
      return chatRowStableKey(c);
    },
  });

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const n = chatListScrollToTopNonce;
    if (n !== scrollTopNoncePrevRef.current) {
      scrollTopNoncePrevRef.current = n;
      if (n > 0) {
        scrollSaveRef.current = 0;
        requestAnimationFrame(() => {
          if (scrollRef.current) scrollRef.current.scrollTop = 0;
        });
      }
      prevMobileSelectedRef.current = mobileSelectedId;
      return;
    }

    const prevMobile = prevMobileSelectedRef.current;
    prevMobileSelectedRef.current = mobileSelectedId;

    /* Só restaura scroll ao voltar da conversa no mobile — não a cada update da lista. */
    if (isMobileLayout && prevMobile != null && mobileSelectedId == null) {
      const saved = scrollSaveRef.current;
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = saved;
      });
    }
  }, [
    chatListScrollToTopNonce,
    mobileSelectedId,
    isMobileLayout,
    scrollRef,
    scrollSaveRef,
    scrollTopNoncePrevRef,
  ]);

  const rowsClassName = mobileConversaAberta
    ? "chat-list-rows chat-list-rows--conversa-aberta"
    : useVirtual
      ? "chat-list-rows chat-list-rows--virtual"
      : "chat-list-rows";

  if (useVirtual) {
    const virtualItems = virtualizer.getVirtualItems();
    return (
      <div className={rowsClassName} aria-hidden={mobileConversaAberta ? true : undefined}>
        <div
          className="chat-list-rows-virtual-inner"
          style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}
        >
          {virtualItems.map((virtualRow) => {
            const c = chatsFiltrados[virtualRow.index];
            if (!c) return null;
            const id = c?.id;
            const clienteSemConv = Boolean(c?.sem_conversa && c?.cliente_id);
            const rowKey = clienteSemConv ? `sem-${c.cliente_id}` : String(id ?? virtualRow.index);
            return (
              <div
                key={rowKey}
                data-index={virtualRow.index}
                className="chat-list-row-virtual-slot"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: virtualRow.size,
                  transform: `translate3d(0, ${virtualRow.start}px, 0)`,
                }}
              >
                {renderChatListRow(c, selectedIdHighlight, rowProps)}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className={rowsClassName} aria-hidden={mobileConversaAberta ? true : undefined}>
      {chatsFiltrados.map((c) => renderChatListRow(c, selectedIdHighlight, rowProps))}
    </div>
  );
}, (prev, next) => {
  const prevLayout = (prev.chatsFiltrados || []).map((c) => chatRowListStoreKey(c)).join("\n");
  const nextLayout = (next.chatsFiltrados || []).map((c) => chatRowListStoreKey(c)).join("\n");
  return (
  prevLayout === nextLayout &&
  prev.isMobileLayout === next.isMobileLayout &&
  prev.scrollRef === next.scrollRef &&
  prev.scrollSaveRef === next.scrollSaveRef &&
  prev.scrollTopNoncePrevRef === next.scrollTopNoncePrevRef &&
  prev.chatListScrollToTopNonce === next.chatListScrollToTopNonce &&
  prev.onSelect === next.onSelect &&
  prev.onOpenClienteSemConversa === next.onOpenClienteSemConversa &&
  prev.currentUserId === next.currentUserId &&
  prev.openConversationId === next.openConversationId &&
  prev.onToggleMenu === next.onToggleMenu &&
  prev.pendentesFuncionarioSet === next.pendentesFuncionarioSet
  );
});

export default ChatListRows;
