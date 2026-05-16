import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { postLeadFromConversa } from "../api/crmService";
import { useNotificationStore } from "../notifications/notificationStore";

export function IconFunnelSend() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 5h16l-6 7v7l-4 2v-9L4 5z" />
      <path d="M12 12l4 4" />
      <path d="M16 12v4h-4" />
    </svg>
  );
}

function IconCheckMini() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function IconSpinnerMini() {
  return (
    <svg className="wa-crmSendBtn-spinnerSvg" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.22" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function getApiError(e) {
  const status = e?.response?.status;
  const data = e?.response?.data;
  const code = data?.code;
  const msg = data?.error || e?.message;
  if (status === 403 && (code === "CRM_DISABLED" || String(msg || "").includes("CRM"))) {
    return "O CRM está desativado para esta empresa. Peça ao administrador para ativar em Configurações.";
  }
  return msg || "Não foi possível enviar ao CRM.";
}

const SendToCrmChatButton = forwardRef(function SendToCrmChatButton(
  { conversaId, hideToolbarButton = false, isGroup = false, crmEnabled = true },
  ref
) {
  const navigate = useNavigate();
  const showToast = useNotificationStore((s) => s.showToast);

  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [observacoes, setObservacoes] = useState("");
  const [criarNotaResumo, setCriarNotaResumo] = useState(true);
  const [successFlash, setSuccessFlash] = useState(false);
  const successTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, []);

  const openModal = useCallback(() => {
    setModalOpen(true);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      open: () => {
        if (!conversaId || isGroup || crmEnabled === false) return;
        openModal();
      },
    }),
    [conversaId, isGroup, crmEnabled, openModal]
  );

  const leadNavigate = useCallback(
    (leadId) => {
      if (leadId == null) return;
      navigate(`/crm/leads/${leadId}`);
    },
    [navigate]
  );

  const showSuccessToast = useCallback(
    (title, message, leadId, tone = "success") => {
      showToast({
        type: tone,
        title,
        message,
        actionLabel: leadId != null ? "Abrir no CRM" : undefined,
        onAction: leadId != null ? () => leadNavigate(leadId) : undefined,
      });
    },
    [leadNavigate, showToast]
  );

  async function handleSubmit(e) {
    e?.preventDefault?.();
    if (!conversaId || loading || crmEnabled === false) return;
    setLoading(true);
    try {
      const body = {
        ...(observacoes.trim() ? { observacoes: observacoes.trim() } : {}),
        criar_nota_com_resumo: criarNotaResumo,
      };
      const { status, data } = await postLeadFromConversa(Number(conversaId), body);
      const leadId = data?.lead?.id != null ? Number(data.lead.id) : null;
      const fc = data?.from_conversa || {};

      setModalOpen(false);
      setObservacoes("");

      if (status === 201) {
        if (successTimerRef.current) clearTimeout(successTimerRef.current);
        setSuccessFlash(true);
        successTimerRef.current = setTimeout(() => {
          setSuccessFlash(false);
          successTimerRef.current = null;
        }, 1400);
        showSuccessToast(
          "Enviado ao CRM",
          fc.tags_sincronizadas != null
            ? `Lead criado. Tags sincronizadas: ${fc.tags_sincronizadas}.`
            : "Lead criado a partir desta conversa.",
          leadId,
          "success"
        );
        return;
      }

      if (status === 200) {
        const dup = fc.duplicate === true;
        showSuccessToast(
          dup ? "Já estava no CRM — atualizado" : "CRM atualizado",
          dup
            ? "O lead existente foi sincronizado (tags e última interação)."
            : "Dados do lead foram atualizados.",
          leadId,
          "info"
        );
        return;
      }

      if (status === 409) {
        const msg = data?.error || "Já existe um lead para esta conversa.";
        showToast({
          type: "warning",
          title: "Lead já vinculado",
          message: msg,
          actionLabel: leadId != null ? `Abrir lead #${leadId}` : undefined,
          onAction: leadId != null ? () => leadNavigate(leadId) : undefined,
        });
        return;
      }
    } catch (err) {
      showToast({
        type: "error",
        title: "Erro ao enviar ao CRM",
        message: getApiError(err),
      });
    } finally {
      setLoading(false);
    }
  }

  if (isGroup || !conversaId || crmEnabled === false) {
    return null;
  }

  const modal =
    modalOpen &&
    createPortal(
      <div
        className="wa-modalOverlay"
        role="presentation"
        onMouseDown={() => {
          if (!loading) setModalOpen(false);
        }}
      >
        <div
          className="wa-modal wa-crmSendModal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="wa-crmSend-title"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="wa-modal-head">
            <div className="wa-modal-title" id="wa-crmSend-title">
              Enviar ao CRM
            </div>
            <button
              type="button"
              className="wa-header-btn"
              onClick={() => !loading && setModalOpen(false)}
              disabled={loading}
              aria-label="Fechar"
              title="Fechar"
              style={{ width: 34, height: 34 }}
            >
              ✕
            </button>
          </div>
          <form className="wa-modal-body" onSubmit={handleSubmit}>
            <p className="wa-crmSend-hint">
              O contato passa a ser lead no funil. As tags da conversa são copiadas por predefinição; pode acrescentar uma nota
              para a equipa comercial.
            </p>
            <label className="wa-crmSend-label" htmlFor="wa-crmSend-obs">
              Nota para o comercial (opcional)
            </label>
            <textarea
              id="wa-crmSend-obs"
              className="wa-crmSend-textarea"
              rows={3}
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              placeholder="Contexto, próximos passos, objeções…"
              disabled={loading}
            />
            <label className="wa-crmSend-check">
              <input
                type="checkbox"
                checked={criarNotaResumo}
                onChange={(e) => setCriarNotaResumo(e.target.checked)}
                disabled={loading}
              />
              Incluir resumo das mensagens na nota interna
            </label>
            <div className="wa-modal-row wa-modal-row--actions" style={{ marginTop: 12 }}>
              <button type="button" className="wa-btn-secondary" onClick={() => !loading && setModalOpen(false)} disabled={loading}>
                Cancelar
              </button>
              <button type="submit" className="wa-btn-primary" disabled={loading} aria-busy={loading}>
                {loading ? "A enviar…" : "Confirmar envio"}
              </button>
            </div>
          </form>
        </div>
      </div>,
      document.body
    );

  const headerBusy = loading;
  const iconEl = headerBusy ? <IconSpinnerMini /> : successFlash ? <IconCheckMini /> : <IconFunnelSend />;

  return (
    <>
      {!hideToolbarButton ? (
        <button
          type="button"
          className={`wa-header-btn wa-crmSendBtn zap-action-btn ${successFlash ? "wa-crmSendBtn--successPulse" : ""}`}
          onClick={openModal}
          disabled={!conversaId || headerBusy}
          title="Enviar conversa ao CRM"
          aria-label="Enviar conversa ao CRM"
          aria-busy={headerBusy}
        >
          <span className="wa-crmSendBtn-icon" aria-hidden>
            {iconEl}
          </span>
          <span className="wa-crmSendBtn-label">{headerBusy ? "A enviar…" : "Enviar ao CRM"}</span>
        </button>
      ) : null}
      {modal}
    </>
  );
});

export default SendToCrmChatButton;
