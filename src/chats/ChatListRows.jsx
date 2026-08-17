import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useConversaStore } from "../conversa/conversaStore";
import { useEmpresaStore } from "../auth/empresaStore";
import { CHAT_LIST_ROW_GAP, estimateChatListRowSize } from "./chatListRowAtendimento";
import MemoChatRow from "./ChatListRow";
import { useWhatsappInstancesStore } from "./whatsappInstancesStore";
import { chatRowStableKey } from "./chatRowStableKey";

/** A partir deste tamanho, lista virtualizada (crítico na aba Todas no mobile). */
export const CHAT_LIST_VIRTUAL_THRESHOLD = 24;

function renderChatListRow(c, selectedId, props) {
  const id = c?.id;
  const clienteSemConv = Boolean(c?.sem_conversa && c?.cliente_id);
  if (!clienteSemConv && (id == null || id === "")) return null;
  const active =
    !clienteSemConv &&
    id != null &&
    selectedId != null &&
    String(selectedId) === String(id);

  const rowKey = chatRowStableKey(c);

  return (
    <MemoChatRow
      key={rowKey}
      chat={c}
      active={active}
      onSelect={props.onSelect}
      onOpenClienteSemConversa={props.onOpenClienteSemConversa}
      currentUserId={props.currentUserId}
      currentUserName={props.currentUserName}
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
  chatsLayoutKey,
  isMobileLayout,
  scrollRef,
  scrollSaveRef,
  scrollTopNoncePrevRef,
  chatListScrollToTopNonce,
  onSelect,
  onOpenClienteSemConversa,
  currentUserId,
  currentUserName,
  openConversationId,
  onToggleMenu,
  pendentesFuncionarioSet,
}) {
  const showWhatsappInstanceUi = useWhatsappInstancesStore((s) => s.hasMultiple);
  const showAssigneeNames = useEmpresaStore((s) => s.empresa?.exibir_atendentes_no_card === true);
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
      currentUserName,
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
      currentUserName,
      openConversationId,
      stableOnToggleMenu,
      pendentesFuncionarioSet,
      minuteTick,
      showWhatsappInstanceUi,
    ]
  );

  const prevMobileSelectedRef = useRef(mobileSelectedId);

  const estimateRowSize = useCallback(
    (index) =>
      estimateChatListRowSize(chatsFiltrados[index], isMobileLayout, pendentesFuncionarioSet, showAssigneeNames),
    [chatsFiltrados, isMobileLayout, pendentesFuncionarioSet, showAssigneeNames]
  );

  const virtualizer = useVirtualizer({
    count: chatsFiltrados.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: estimateRowSize,
    gap: CHAT_LIST_ROW_GAP,
    overscan: isMobileLayout ? 4 : 10,
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

  /*
   * Aplica a posição ANTES do paint e repete no frame seguinte. Antes era só
   * `requestAnimationFrame`: ao voltar da conversa no mobile a lista aparecia um frame
   * inteiro no topo e só depois saltava para onde o atendente estava — o "pulo" ao usar o
   * voltar do aparelho. O frame extra fica como rede de segurança, para o caso de a altura
   * do virtualizador ainda não estar assente quando a coluna deixa de estar `display:none`.
   */
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;

    const aplicarScroll = (top) => {
      const alvo = scrollRef.current;
      if (alvo) alvo.scrollTop = top;
    };

    const n = chatListScrollToTopNonce;
    if (n !== scrollTopNoncePrevRef.current) {
      scrollTopNoncePrevRef.current = n;
      prevMobileSelectedRef.current = mobileSelectedId;
      if (n > 0) {
        scrollSaveRef.current = 0;
        aplicarScroll(0);
        const frame = requestAnimationFrame(() => aplicarScroll(0));
        return () => cancelAnimationFrame(frame);
      }
      return undefined;
    }

    const prevMobile = prevMobileSelectedRef.current;
    prevMobileSelectedRef.current = mobileSelectedId;

    /* Só restaura scroll ao voltar da conversa no mobile — não a cada update da lista. */
    if (isMobileLayout && prevMobile != null && mobileSelectedId == null) {
      const saved = scrollSaveRef.current;
      aplicarScroll(saved);
      const frame = requestAnimationFrame(() => aplicarScroll(saved));
      return () => cancelAnimationFrame(frame);
    }

    return undefined;
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
            // key === getItemKey — evita reuso do DOM do avatar no bump ao enviar.
            const slotKey = virtualRow.key;
            return (
              <div
                key={slotKey}
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
  return (
  prev.chatsLayoutKey === next.chatsLayoutKey &&
  prev.isMobileLayout === next.isMobileLayout &&
  prev.scrollRef === next.scrollRef &&
  prev.scrollSaveRef === next.scrollSaveRef &&
  prev.scrollTopNoncePrevRef === next.scrollTopNoncePrevRef &&
  prev.chatListScrollToTopNonce === next.chatListScrollToTopNonce &&
  prev.onSelect === next.onSelect &&
  prev.onOpenClienteSemConversa === next.onOpenClienteSemConversa &&
  prev.currentUserId === next.currentUserId &&
  prev.currentUserName === next.currentUserName &&
  prev.openConversationId === next.openConversationId &&
  prev.onToggleMenu === next.onToggleMenu &&
  prev.pendentesFuncionarioSet === next.pendentesFuncionarioSet
  );
});

export default ChatListRows;
