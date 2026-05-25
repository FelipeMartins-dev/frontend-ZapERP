import { createPortal } from "react-dom";
import { IconClose } from "../conversaViewIcons";

export default function ShareLocationModal({
  open,
  geoLoading,
  geoError,
  lat,
  lng,
  nome,
  endereco,
  sending,
  onClose,
  onLatChange,
  onLngChange,
  onNomeChange,
  onEnderecoChange,
  onSend,
}) {
  if (!open) return null;

  return createPortal(
    <div
      className="wa-modalOverlay"
      role="dialog"
      aria-label="Enviar localização"
      onMouseDown={() => {
        if (sending) return;
        onClose?.();
      }}
    >
      <div className="wa-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="wa-modal-head">
          <div className="wa-modal-title">Enviar localização</div>
          <button type="button" className="wa-iconBtn" onClick={() => !sending && onClose?.()} title="Fechar">
            <IconClose />
          </button>
        </div>
        <div className="wa-modal-body">
          {geoLoading ? <div className="wa-muted">Obtendo localização…</div> : null}
          {geoError ? <div className="wa-modal-row wa-modal-row--hint">{geoError}</div> : null}
          <div className="wa-modal-row">
            <span className="wa-modal-label">Latitude</span>
            <input
              className="wa-input"
              inputMode="decimal"
              value={lat}
              onChange={(e) => onLatChange?.(e.target.value)}
              placeholder="-19.5"
              disabled={sending}
              autoComplete="off"
            />
          </div>
          <div className="wa-modal-row">
            <span className="wa-modal-label">Longitude</span>
            <input
              className="wa-input"
              inputMode="decimal"
              value={lng}
              onChange={(e) => onLngChange?.(e.target.value)}
              placeholder="-44.0"
              disabled={sending}
              autoComplete="off"
            />
          </div>
          <div className="wa-modal-row">
            <span className="wa-modal-label">Nome do local (opcional)</span>
            <input
              className="wa-input"
              value={nome}
              onChange={(e) => onNomeChange?.(e.target.value)}
              placeholder="Ex.: nome do estabelecimento"
              disabled={sending}
            />
          </div>
          <div className="wa-modal-row">
            <span className="wa-modal-label">Endereço (opcional)</span>
            <input
              className="wa-input"
              value={endereco}
              onChange={(e) => onEnderecoChange?.(e.target.value)}
              placeholder="Ex.: Rua, número"
              disabled={sending}
            />
          </div>
          <div className="wa-modal-row wa-modal-row--actions">
            <button type="button" className="wa-btn" disabled={sending} onClick={onClose}>
              Cancelar
            </button>
            <button
              type="button"
              className="wa-btn wa-btn-primary"
              disabled={sending || geoLoading}
              onClick={onSend}
            >
              {sending ? "Enviando…" : "Enviar"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
