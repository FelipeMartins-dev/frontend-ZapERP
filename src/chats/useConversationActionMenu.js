import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConversaStore } from "../conversa/conversaStore";

export function useConversationActionMenu({ visibleConversationIds, resetKey }) {
  const [openConversationId, setOpenConversationId] = useState(null);
  const [anchorRect, setAnchorRect] = useState(null);
  const [restoreFocusEl, setRestoreFocusEl] = useState(null);
  const restoreFocusRef = useRef(null);

  const closeMenu = useCallback(() => {
    setOpenConversationId(null);
    setAnchorRect(null);
    const target = restoreFocusRef.current;
    restoreFocusRef.current = null;
    setRestoreFocusEl(null);
    if (target && typeof target.focus === "function") {
      requestAnimationFrame(() => target.focus());
    }
  }, []);

  const openMenu = useCallback((conversationId, triggerEl) => {
    if (!conversationId || !triggerEl) return;
    const nextId = String(conversationId);
    if (openConversationId === nextId) {
      closeMenu();
      return;
    }
    const rect = triggerEl.getBoundingClientRect();
    restoreFocusRef.current = triggerEl;
    setRestoreFocusEl(triggerEl);
    setAnchorRect(rect);
    setOpenConversationId(nextId);
  }, [closeMenu, openConversationId]);

  useEffect(() => {
    if (!openConversationId) return;
    const onWindowChange = () => setAnchorRect((prev) => {
      if (!prev || !restoreFocusRef.current) return prev;
      return restoreFocusRef.current.getBoundingClientRect();
    });
    window.addEventListener("resize", onWindowChange);
    window.addEventListener("scroll", onWindowChange, true);
    return () => {
      window.removeEventListener("resize", onWindowChange);
      window.removeEventListener("scroll", onWindowChange, true);
    };
  }, [openConversationId]);

  /* Fecha o menu ao trocar conversa sem re-renderizar o ChatList inteiro. */
  useEffect(() => {
    if (!openConversationId) return undefined;
    return useConversaStore.subscribe((state, prevState) => {
      const next = state.selectedId;
      const prev = prevState?.selectedId;
      if (prev == null || next == null) return;
      if (String(prev) === String(next)) return;
      closeMenu();
    });
  }, [openConversationId, closeMenu]);

  useEffect(() => {
    if (!openConversationId) return;
    if (!Array.isArray(visibleConversationIds)) return;
    const exists = visibleConversationIds.some((id) => String(id) === String(openConversationId));
    if (!exists) closeMenu();
  }, [visibleConversationIds, openConversationId, closeMenu]);

  useEffect(() => {
    closeMenu();
  }, [resetKey, closeMenu]);

  return useMemo(() => ({
    openConversationId,
    anchorRect,
    restoreFocusEl,
    openMenu,
    closeMenu,
  }), [openConversationId, anchorRect, restoreFocusEl, openMenu, closeMenu]);
}


