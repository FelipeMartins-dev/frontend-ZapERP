import { useEffect } from "react";

export function useGlobalHotkeys({ onToggleTimeline, onFocusInput, onEscape, disabled }) {
  useEffect(() => {
    if (disabled) return;

    function onKeyDown(e) {
      const k = String(e.key || "").toLowerCase();

      if ((e.ctrlKey || e.metaKey) && k === "k") {
        e.preventDefault();
        onFocusInput?.();
      }

      if ((e.ctrlKey || e.metaKey) && k === "h") {
        e.preventDefault();
        onToggleTimeline?.();
      }

      if (k === "escape") {
        e.preventDefault();
        onEscape?.();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onToggleTimeline, onFocusInput, onEscape, disabled]);
}
