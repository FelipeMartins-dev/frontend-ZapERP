import { createPortal } from "react-dom";
import { FORWARD_DEST_MAX } from "../conversaConstants";
import { safeString } from "../utils/conversaViewHelpers";
import { IconClose } from "../conversaViewIcons";

/**
 * Modal de encaminhamento de mensagens. Estado e regras de envio permanecem no pai.
 */
export default function ForwardModal({
  open,
  forwardMsgs,
  forwardPreviewLabel,
  forwardQuery,
  onForwardQueryChange,
  forwardSending,
  forwardSelectedConversaIds,
  forwardMax10Msg,
  forwardMultiProgress,
  forwardColaboradoresLoading,
  forwardColaboradoresFiltered,
  forwardCandidates,
  forwardClientesLoading,
  forwardClientes,
  onClose,
  onConfirmForwardToColaborador,
  onToggleForwardConversaSelect,
  onConfirmForwardTo,
  onConfirmForwardToCliente,
  onConfirmForwardToMany,
}) {
  if (!open || !forwardMsgs?.length) return null;

  return createPortal(
    <div
      className="wa-modalOverlay wa-forwardOverlay"
      role="dialog"
      aria-label="Encaminhar mensagens"
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return;
        onClose?.();
      }}
    >
      <div className="wa-modal wa-forwardModal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="wa-forwardSheetHandle" aria-hidden="true" />
        <div className="wa-modal-head">
          <div className="wa-forwardHeadLeft">
            <div className="wa-modal-title">
              {forwardMsgs.length > 1 ? `Encaminhar (${forwardMsgs.length})` : "Encaminhar"}
            </div>
            <div className="wa-forwardHeadCounter" aria-live="polite">
              {forwardSelectedConversaIds.length} selecionada(s) · até {FORWARD_DEST_MAX} destinos
            </div>
          </div>
          <button
            type="button"
            className="wa-iconBtn"
            onClick={onClose}
            title="Fechar"
          >
            <IconClose />
          </button>
        </div>
        <div className="wa-modal-body wa-forwardBody">
          <div className="wa-forwardHint">
            <div className="wa-forwardPreview" title={forwardPreviewLabel}>
              {forwardPreviewLabel}
            </div>
            <ol className="wa-forwardSteps">
              <li>
                Marque uma ou mais conversas e toque em <strong>Encaminhar selecionados</strong> no rodapé.
              </li>
              <li>
                Para <strong>um destino só</strong>, use <strong>Apenas esta</strong> na linha da conversa.
              </li>
              <li>
                <strong>Chat interno</strong> (colaborador) ou <strong>cliente</strong> na busca: toque no cartão para
                encaminhar direto.
              </li>
            </ol>
          </div>

          <input
            className="wa-input wa-forwardSearch"
            value={forwardQuery}
            onChange={(e) => onForwardQueryChange?.(e.target.value)}
            placeholder="Buscar por nome/telefone..."
            aria-label="Buscar contato"
            autoFocus
          />

          <div className="wa-forwardSection">
            <div className="wa-forwardSectionTitle">Colaboradores</div>
            {forwardColaboradoresLoading ? (
              <div className="wa-muted" style={{ padding: "10px 4px" }}>
                Carregando…
              </div>
            ) : forwardColaboradoresFiltered.length === 0 ? (
              <div className="wa-muted" style={{ padding: "10px 4px" }}>
                Nenhum colaborador disponível para encaminhar.
              </div>
            ) : (
              <div className="wa-forwardList">
                {forwardColaboradoresFiltered.map((colab) => {
                  const uid = colab?.id ?? colab?.user_id ?? colab?.usuario_id;
                  const nome = safeString(colab?.nome ?? colab?.name ?? colab?.full_name) || "Colaborador";
                  const email = safeString(colab?.email);
                  return (
                    <button
                      key={`colab-${uid != null ? String(uid) : nome}`}
                      type="button"
                      className="wa-forwardItem"
                      onClick={() => onConfirmForwardToColaborador?.(colab)}
                      title={`Encaminhar para ${nome} (chat interno)`}
                      disabled={forwardSending || uid == null}
                    >
                      <div className="wa-forwardItem-name">{nome}</div>
                      {email ? <div className="wa-forwardItem-sub">{email}</div> : null}
                      <div className="wa-forwardItem-atendente">Chat interno</div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="wa-forwardSection" style={{ marginTop: 14 }}>
            <div className="wa-forwardSectionHead">
              <div className="wa-forwardSectionTitle">Conversas</div>
              <span className="wa-forwardSectionCap" aria-hidden="true">
                máx. {FORWARD_DEST_MAX} destinos
              </span>
            </div>
            {forwardMax10Msg ? (
              <p className="wa-forwardMaxHint" role="status" aria-live="polite">
                {forwardMax10Msg}
              </p>
            ) : null}
            {forwardCandidates.length === 0 ? (
              <div className="wa-muted" style={{ padding: "10px 4px" }}>
                {forwardQuery.trim() ? "Nenhuma conversa encontrada." : "Carregando conversas…"}
              </div>
            ) : (
              <div className="wa-forwardList">
                {forwardCandidates.map((c) => {
                  const n = safeString(c?.contato_nome || c?.nome || c?.cliente?.nome || c?.telefone) || "Conversa";
                  const telLinha = safeString(c?.telefone_exibivel ?? c?.telefoneExibivel ?? c?.telefone);
                  const atNome = safeString(c?.atendente_nome ?? c?.atendenteNome).trim();
                  const atMail = safeString(c?.atendente_email ?? c?.atendenteEmail).trim();
                  const atendenteTitle = [atNome ? `Atendente: ${atNome}` : "", atMail].filter(Boolean).join(" · ");
                  const idStr = String(c.id);
                  const sel = forwardSelectedConversaIds.includes(idStr);
                  return (
                    <div
                      key={`conv-${c.id}`}
                      className={`wa-forwardItem wa-forwardItem--row ${sel ? "isSelected" : ""}`}
                    >
                      <div className="wa-forwardItem-rowMain">
                        <label className="wa-forwardItem-checkLabel">
                          <input
                            type="checkbox"
                            className="wa-forwardItem-check"
                            checked={sel}
                            onChange={() => onToggleForwardConversaSelect?.(c.id)}
                            disabled={forwardSending}
                            aria-label={`Incluir conversa: ${n}`}
                          />
                        </label>
                        <button
                          type="button"
                          className="wa-forwardItem-main"
                          onClick={() => !forwardSending && onToggleForwardConversaSelect?.(c.id)}
                          disabled={forwardSending}
                        >
                          <div className="wa-forwardItem-name">{n}</div>
                          {telLinha ? <div className="wa-forwardItem-sub">{telLinha}</div> : null}
                          {atNome ? (
                            <div className="wa-forwardItem-atendente" title={atendenteTitle || undefined}>
                              Atendente: {atNome}
                            </div>
                          ) : (
                            <div className="wa-forwardItem-atendente wa-forwardItem-atendente--empty">
                              Sem atendente atribuído
                            </div>
                          )}
                        </button>
                      </div>
                      <button
                        type="button"
                        className="wa-btn wa-btn-ghost wa-forwardItem-solo"
                        onClick={() => onConfirmForwardTo?.(c.id)}
                        disabled={forwardSending}
                        title="Encaminhar somente para esta conversa (um destino)"
                      >
                        Apenas esta
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="wa-forwardSection" style={{ marginTop: 14 }}>
            <div className="wa-forwardSectionTitle">Clientes</div>
            {forwardClientesLoading ? (
              <div className="wa-muted" style={{ padding: "10px 4px" }}>
                Buscando…
              </div>
            ) : forwardClientes.length === 0 ? (
              <div className="wa-muted" style={{ padding: "10px 4px" }}>
                {safeString(forwardQuery).trim().length >= 2
                  ? "Nenhum cliente encontrado."
                  : "Digite pelo menos 2 caracteres para buscar."}
              </div>
            ) : (
              <div className="wa-forwardList">
                {forwardClientes.slice(0, 60).map((c) => {
                  const n = safeString(c?.nome || c?.telefone) || "Cliente";
                  return (
                    <button
                      key={`cli-${c.id}`}
                      type="button"
                      className="wa-forwardItem"
                      onClick={() => onConfirmForwardToCliente?.(c)}
                      title={`Encaminhar para ${n}`}
                      disabled={forwardSending}
                    >
                      <div className="wa-forwardItem-name">{n}</div>
                      {c?.telefone ? <div className="wa-forwardItem-sub">{String(c.telefone)}</div> : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        <div className="wa-forwardFooter">
          <button type="button" className="wa-btn wa-btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="wa-btn wa-btn-primary"
            onClick={onConfirmForwardToMany}
            disabled={forwardSelectedConversaIds.length < 1}
          >
            {`Encaminhar selecionados${
              forwardSelectedConversaIds.length ? ` (${forwardSelectedConversaIds.length})` : ""
            }`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
