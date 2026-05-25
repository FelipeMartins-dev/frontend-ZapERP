import { createPortal } from "react-dom";
import { getDisplayName } from "../../chats/chatList";
import { IconClose } from "../conversaViewIcons";

export default function AddToGroupModal({
  open,
  contactNome,
  grupos,
  loading,
  sending,
  onClose,
  onSelectGroup,
}) {
  if (!open) return null;

  return createPortal(
    <div
      className="wa-modalOverlay"
      role="dialog"
      aria-label="Adicionar a um grupo"
      onMouseDown={() => {
        if (sending) return;
        onClose?.();
      }}
    >
      <div className="wa-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="wa-modal-head">
          <div className="wa-modal-title">Adicionar {contactNome || "contato"} a um grupo</div>
          <button type="button" className="wa-iconBtn" onClick={onClose} disabled={sending} title="Fechar">
            <IconClose />
          </button>
        </div>
        <div className="wa-modal-body">
          <div className="wa-modal-row" style={{ maxHeight: 260, overflowY: "auto", paddingRight: 4 }}>
            {loading ? (
              <div className="wa-muted">Carregando grupos...</div>
            ) : grupos.length === 0 ? (
              <div className="wa-muted">Nenhum grupo encontrado.</div>
            ) : (
              <div className="wa-forwardList">
                {grupos.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    className="wa-forwardItem"
                    disabled={sending}
                    onClick={() => onSelectGroup?.(g)}
                  >
                    <div className="wa-forwardItem-name">{getDisplayName(g)}</div>
                    <div className="wa-forwardItem-sub">Grupo</div>
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
