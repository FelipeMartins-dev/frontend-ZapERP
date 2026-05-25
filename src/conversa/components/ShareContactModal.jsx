import { createPortal } from "react-dom";
import { safeString } from "../utils/conversaViewHelpers";
import { IconClose } from "../conversaViewIcons";

export default function ShareContactModal({
  open,
  query,
  onQueryChange,
  list,
  loading,
  sending,
  onClose,
  onSelectContact,
}) {
  if (!open) return null;

  return createPortal(
    <div
      className="wa-modalOverlay"
      role="dialog"
      aria-label="Enviar contato"
      onMouseDown={() => {
        if (sending) return;
        onClose?.();
      }}
    >
      <div className="wa-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="wa-modal-head">
          <div className="wa-modal-title">Enviar contato</div>
          <button type="button" className="wa-iconBtn" onClick={() => !sending && onClose?.()} title="Fechar">
            <IconClose />
          </button>
        </div>
        <div className="wa-modal-body">
          <div className="wa-modal-row">
            <input
              className="wa-input"
              placeholder="Buscar cliente por nome ou telefone..."
              value={query}
              onChange={(e) => onQueryChange?.(e.target.value)}
            />
          </div>
          <div className="wa-modal-row" style={{ maxHeight: 260, overflowY: "auto", paddingRight: 4 }}>
            {loading ? (
              <div className="wa-muted">Carregando contatos...</div>
            ) : list.length === 0 ? (
              <div className="wa-muted">Nenhum contato encontrado.</div>
            ) : (
              <div className="wa-forwardList">
                {list.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="wa-forwardItem"
                    disabled={sending}
                    onClick={() => onSelectContact?.(c)}
                  >
                    <div className="wa-forwardItem-name">{safeString(c.nome || c.telefone) || "Cliente"}</div>
                    {c.telefone ? <div className="wa-forwardItem-sub">{String(c.telefone)}</div> : null}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
