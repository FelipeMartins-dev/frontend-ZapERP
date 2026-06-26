import { memo } from "react";
import { IconClose, IconForward } from "../conversaViewIcons";
import { IconTrash } from "@tabler/icons-react";

/**
 * Camada visual do modo seleção: overlay de escurecimento + barra de ações.
 * Estado, limites e handlers permanecem no ConversaView.
 */
function ConversaSelectionBar({
  open,
  forwardSelectIntent,
  compactMessageUx,
  selectedCount,
  forwardSending,
  onDismiss,
  onForward,
  onDelete,
}) {
  if (!open) return null;

  const hasSelection = selectedCount > 0;
  const forwardDisabled = !hasSelection || forwardSending;
  const deleteDisabled = !hasSelection;

  return (
    <>
      <div className="wa-messages-selectDim" aria-hidden />
      <div
        className={`wa-selectBar${forwardSelectIntent ? " wa-selectBar--forwardIntent" : ""}${
          compactMessageUx ? " wa-selectBar--compactUx" : ""
        }`}
        role="region"
        aria-label="Modo seleção"
      >
        <div className="wa-selectBar-left">
          <button
            type="button"
            className="wa-selectBar-close"
            onClick={onDismiss}
            title="Fechar"
            aria-label="Fechar seleção"
          >
            <IconClose />
          </button>
          {!compactMessageUx ? (
            <button type="button" className="wa-btn wa-btn-ghost" onClick={onDismiss}>
              Cancelar
            </button>
          ) : null}
          <span className="wa-selectBar-countBadge">
            {selectedCount} selecionada{selectedCount !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="wa-selectBar-actions">
          {forwardSelectIntent ? (
            <button
              type="button"
              className={`wa-btn wa-btn-primary${compactMessageUx ? " wa-selectBar-forwardFab" : ""}`}
              onClick={onForward}
              disabled={forwardDisabled}
              aria-label="Encaminhar mensagens selecionadas"
            >
              <IconForward />
              {!compactMessageUx ? <span className="wa-selectBar-forwardText"> Encaminhar…</span> : null}
            </button>
          ) : null}
          <button
            type="button"
            className="wa-btn wa-btn-danger wa-selectBar-deleteBtn"
            onClick={onDelete}
            disabled={deleteDisabled}
          >
            <IconTrash size={15} strokeWidth={1.8} aria-hidden="true" />
            Apagar
          </button>
        </div>
      </div>
    </>
  );
}

export default memo(ConversaSelectionBar);
