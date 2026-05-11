import { useCallback, useEffect, useRef, useState } from "react";

/** Arraste máximo visual (px) — bolha volta com mola ao soltar. */
const MAX_SHIFT = 76;
/** Distância horizontal mínima para disparar “modo responder”. */
const ACTIVATE_THRESHOLD = 52;
/** Se o gesto vertical passar disso primeiro, assume rolagem — cancela swipe. */
const VERT_ABORT_PX = 26;
/** Movimento horizontal mínimo para travar eixo em “horizontal”. */
const HORIZ_LOCK_PX = 12;
const HORIZ_RATIO = 1.18;

const COMMIT_DEBOUNCE_MS = 400;

function shouldIgnoreSwipeTarget(target) {
  if (!target || typeof target.closest !== "function") return true;
  return !!target.closest(
    [
      "button",
      "a",
      "input",
      "textarea",
      "select",
      "label",
      "audio",
      "video",
      ".wa-msgMenuBtn",
      ".wa-reactionBtn",
      ".wa-reactionPicker",
      ".wa-reactionPicker-btn",
      ".wa-bubble-imgLink",
      ".wa-bubble-videoLink",
      ".wa-replyCtx",
      ".wa-bubble-fileAction",
      ".wa-audioPlayBtn",
      '[role="slider"]',
    ].join(",")
  );
}

/**
 * Envolve a bolha em mobile: arrastar na direção da conversa (entrada → direita, saída → esquerda)
 * ativa responder. Usa pointer events + touch-action: pan-y para não roubar rolagem vertical.
 */
export function SwipeReplyTrack({ enabled, outgoing, onCommit, gestureBlocked, children }) {
  const shiftRef = useRef(0);
  const [shift, setShift] = useState(0);
  const [spring, setSpring] = useState(true);
  const dragRef = useRef(null);
  const lastCommitRef = useRef(0);

  const resetVisual = useCallback((animate) => {
    setSpring(animate !== false);
    shiftRef.current = 0;
    setShift(0);
  }, []);

  useEffect(() => {
    if (!enabled) resetVisual(false);
  }, [enabled, resetVisual]);

  const handlePointerDown = useCallback(
    (e) => {
      if (!enabled || gestureBlocked) return;
      if (e.button !== 0) return;
      if (shouldIgnoreSwipeTarget(e.target)) return;

      dragRef.current = {
        pointerId: e.pointerId,
        x0: e.clientX,
        y0: e.clientY,
        axis: null,
      };
      setSpring(false);
    },
    [enabled, gestureBlocked]
  );

  const handlePointerMove = useCallback(
    (e) => {
      const d = dragRef.current;
      if (!d || d.pointerId !== e.pointerId) return;

      const dx = e.clientX - d.x0;
      const dy = e.clientY - d.y0;

      if (!d.axis) {
        if (Math.abs(dy) > VERT_ABORT_PX && Math.abs(dy) >= Math.abs(dx) * 1.08) {
          dragRef.current = null;
          resetVisual(true);
          return;
        }
        if (Math.abs(dx) > HORIZ_LOCK_PX && Math.abs(dx) >= Math.abs(dy) * HORIZ_RATIO) {
          d.axis = "h";
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch (_) {}
        } else {
          return;
        }
      }

      if (d.axis !== "h") return;

      let next = 0;
      if (outgoing) {
        next = dx < 0 ? Math.max(dx, -MAX_SHIFT) : 0;
      } else {
        next = dx > 0 ? Math.min(dx, MAX_SHIFT) : 0;
      }
      shiftRef.current = next;
      setShift(next);
    },
    [outgoing, resetVisual]
  );

  const handlePointerUp = useCallback(
    (e) => {
      const d = dragRef.current;
      if (!d || d.pointerId !== e.pointerId) return;

      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch (_) {}

      const horizontal = d.axis === "h";
      const mag = Math.abs(shiftRef.current);

      dragRef.current = null;

      if (horizontal && mag >= ACTIVATE_THRESHOLD) {
        const now = Date.now();
        if (now - lastCommitRef.current > COMMIT_DEBOUNCE_MS) {
          lastCommitRef.current = now;
          try {
            onCommit?.();
          } catch (_) {}
        }
      }

      resetVisual(true);
    },
    [onCommit, resetVisual]
  );

  const handlePointerCancel = useCallback(
    (e) => {
      const d = dragRef.current;
      if (!d || d.pointerId !== e.pointerId) return;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch (_) {}
      dragRef.current = null;
      resetVisual(true);
    },
    [resetVisual]
  );

  if (!enabled) {
    return children;
  }

  return (
    <div
      className="wa-swipeReplyTrack"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      style={{ touchAction: "pan-y" }}
    >
      <div
        className={`wa-swipeReplyShift ${spring ? "wa-swipeReplyShift--spring" : ""}`}
        style={{
          transform: `translateX(${shift}px)`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
