import { createPortal } from "react-dom";
import { formatDia, formatHora, safeString } from "../utils/conversaViewHelpers";
import { snippetFromMsg } from "../utils/conversaMessageDisplay";
import { IconClose } from "../conversaViewIcons";

export default function MsgInfoModal({ open, msgInfo, onClose }) {
  if (!open || !msgInfo) return null;

  return createPortal(
    <div
      className="wa-modalOverlay"
      role="dialog"
      aria-label="Dados da mensagem"
      onMouseDown={onClose}
    >
      <div className="wa-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="wa-modal-head">
          <div className="wa-modal-title">Dados da mensagem</div>
          <button type="button" className="wa-iconBtn" onClick={onClose} title="Fechar">
            <IconClose />
          </button>
        </div>

        <div className="wa-modal-body">
          <div className="wa-modal-row">
            <span className="wa-modal-label">Conteúdo</span>
            <span className="wa-modal-value">{snippetFromMsg(msgInfo)}</span>
          </div>
          <div className="wa-modal-row">
            <span className="wa-modal-label">Horário</span>
            <span className="wa-modal-value">
              {formatDia(msgInfo?.criado_em)} {formatHora(msgInfo?.criado_em)}
            </span>
          </div>
          <div className="wa-modal-row">
            <span className="wa-modal-label">Status</span>
            <span className="wa-modal-value">
              {safeString(msgInfo?.status_mensagem || msgInfo?.status) || "enviada"}
            </span>
          </div>
          {safeString(msgInfo?.whatsapp_id) ? (
            <div className="wa-modal-row">
              <span className="wa-modal-label">ID WhatsApp</span>
              <span className="wa-modal-value wa-mono">{String(msgInfo.whatsapp_id)}</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}
