import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import "./ConfirmDialog.css";

/**
 * Confirmação modal acessível (overlay + foco).
 * @param {object} props
 * @param {boolean} props.open
 * @param {string} props.title
 * @param {import('react').ReactNode} props.children
 * @param {string} [props.confirmLabel]
 * @param {string} [props.cancelLabel]
 * @param {boolean} [props.danger]
 * @param {() => void} props.onConfirm
 * @param {() => void} props.onCancel
 */
export default function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  danger = false,
  onConfirm,
  onCancel,
}) {
  const idBase = useId();
  const titleId = `${idBase}-title`;
  const cancelRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const t = requestAnimationFrame(() => cancelRef.current?.focus?.());
    return () => cancelAnimationFrame(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        onCancel?.();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onCancel]);

  if (!open) return null;

  return createPortal(
    <div
      className="ds-confirm-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel?.();
      }}
    >
      <div
        className="ds-confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="ds-confirm-title">
          {title}
        </h2>
        <div className="ds-confirm-body">{children}</div>
        <div className="ds-confirm-actions">
          <button ref={cancelRef} type="button" className="ds-confirm-btn ds-confirm-btn--ghost" onClick={() => onCancel?.()}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`ds-confirm-btn ${danger ? "ds-confirm-btn--danger" : "ds-confirm-btn--primary"}`}
            onClick={() => onConfirm?.()}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
