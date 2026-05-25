import { createPortal } from "react-dom";
import { IconClose } from "../conversaViewIcons";

export default function CallModal({
  open,
  duration,
  sending,
  conversaId,
  onClose,
  onDurationChange,
  onConfirm,
}) {
  if (!open) return null;

  return createPortal(
    <div
      className="wa-modalOverlay"
      role="dialog"
      aria-label="Registrar ligação"
      onMouseDown={() => {
        if (sending) return;
        onClose?.();
      }}
    >
      <div className="wa-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="wa-modal-head">
          <div className="wa-modal-title">Ligar pelo WhatsApp</div>
          <button type="button" className="wa-iconBtn" onClick={() => !sending && onClose?.()} title="Fechar">
            <IconClose />
          </button>
        </div>
        <div className="wa-modal-body">
          <div className="wa-modal-row">
            <span className="wa-modal-label">Duração (segundos)</span>
            <input
              type="number"
              min={1}
              max={15}
              className="wa-input"
              value={duration}
              onChange={(e) => onDurationChange?.(e.target.value)}
            />
          </div>
          <div className="wa-modal-row">
            <p className="wa-modal-value">
              Registraremos uma ligação via WhatsApp nesta conversa. Isso não inicia a chamada no seu dispositivo,
              apenas registra no histórico.
            </p>
          </div>
        </div>
        <div className="wa-modal-body" style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="wa-btn wa-btn-ghost" disabled={sending} onClick={() => !sending && onClose?.()}>
            Cancelar
          </button>
          <button
            type="button"
            className="wa-btn wa-btn-primary"
            disabled={sending || !conversaId}
            onClick={onConfirm}
          >
            {sending ? "Registrando..." : "Iniciar ligação"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
