import { createPortal } from "react-dom";
import { IconClose } from "../conversaViewIcons";

export default function PixConfigModal({
  open,
  tipoChave,
  chave,
  nomeRecebedor,
  mensagemPadrao,
  saving,
  loading,
  onClose,
  onTipoChaveChange,
  onChaveChange,
  onNomeRecebedorChange,
  onMensagemPadraoChange,
  onSave,
}) {
  if (!open) return null;

  return createPortal(
    <div
      className="wa-modalOverlay"
      role="dialog"
      aria-label="Configurar Pix"
      onMouseDown={() => !saving && onClose?.()}
    >
      <div className="wa-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="wa-modal-head">
          <div className="wa-modal-title">Configurar Pix</div>
          <button type="button" className="wa-iconBtn" onClick={onClose} title="Fechar" disabled={saving}>
            <IconClose />
          </button>
        </div>
        <div className="wa-modal-body">
          <div className="wa-field">
            <label className="wa-label">Tipo da chave Pix</label>
            <select
              className="wa-input"
              value={tipoChave}
              onChange={(e) => onTipoChaveChange?.(String(e.target.value || "").toLowerCase())}
              disabled={saving || loading}
            >
              <option value="cpf">CPF</option>
              <option value="cnpj">CNPJ</option>
              <option value="email">E-mail</option>
              <option value="telefone">Telefone</option>
              <option value="aleatoria">Chave aleatória</option>
            </select>
          </div>
          <div className="wa-field">
            <label className="wa-label">Chave Pix</label>
            <input
              className="wa-input"
              value={chave}
              onChange={(e) => onChaveChange?.(e.target.value)}
              placeholder="Digite a chave Pix"
              autoFocus
              disabled={saving || loading}
            />
          </div>
          <div className="wa-field">
            <label className="wa-label">Nome do recebedor/empresa</label>
            <input
              className="wa-input"
              value={nomeRecebedor}
              onChange={(e) => onNomeRecebedorChange?.(e.target.value)}
              placeholder="Nome exibido para pagamento"
              disabled={saving || loading}
            />
          </div>
          <div className="wa-field">
            <label className="wa-label">Mensagem padrão (opcional)</label>
            <textarea
              className="wa-input"
              rows={3}
              value={mensagemPadrao}
              onChange={(e) => onMensagemPadraoChange?.(e.target.value)}
              placeholder="Ex: Valor referente ao pedido #123"
              disabled={saving || loading}
            />
          </div>
        </div>
        <div className="wa-modal-footer">
          <button type="button" className="wa-btn wa-btn-ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button
            type="button"
            className="wa-btn wa-btn-primary"
            onClick={onSave}
            disabled={saving || loading}
          >
            {saving ? "Salvando..." : "Salvar Pix"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
