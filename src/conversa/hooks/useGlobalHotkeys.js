import { useEffect } from "react";

export function useGlobalHotkeys({ onToggleTimeline, onFocusInput, onEscape, disabled }) {
  useEffect(() => {
    function onKeyDown(e) {
      const k = String(e.key || "").toLowerCase();

      /* ESC sempre ativo: fecha overlay ou sai da conversa (mesmo durante loading). */
      if (k === "escape") {
        if (e.defaultPrevented) return;
        e.preventDefault();
        onEscape?.();
        return;
      }

      if (disabled) return;

      if ((e.ctrlKey || e.metaKey) && k === "k") {
        e.preventDefault();
        onFocusInput?.();
      }

      if ((e.ctrlKey || e.metaKey) && k === "h") {
        e.preventDefault();
        onToggleTimeline?.();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onToggleTimeline, onFocusInput, onEscape, disabled]);
}
