import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Phone, User } from "lucide-react";
import { criarCliente } from "../api/configService";
import { parsePostClientesResponse } from "../api/parseCriarClienteResponse";
import { useNotificationStore } from "../notifications/notificationStore";
import {
  AJUDA_TELEFONE_PADRAO,
  EXEMPLO_TELEFONE_PADRAO,
  digitsOnly,
  formatBrPhoneDisplay,
  isPlausibleBrPhoneDigits,
} from "./phoneBrFormat";
import { fetchWhatsappInstancesAtendimento, whatsappInstanceLabel } from "./whatsappInstancesService";
import "./novoContatoModal.css";

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {(conversa: object | null, extra?: { cliente?: import('../api/clientes.types').ClienteBasico | null }) => void} [props.onSuccess]
 */
export default function NovoContatoModal({ open, onClose, onSuccess }) {
  const showToast = useNotificationStore((s) => s.showToast);
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [abrirConversa, setAbrirConversa] = useState(true);
  const [assumir, setAssumir] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [clientError, setClientError] = useState("");
  const [apiError, setApiError] = useState(null);
  const [whatsappInstances, setWhatsappInstances] = useState([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState("");
  const [loadingInstances, setLoadingInstances] = useState(false);

  const telefoneRef = useRef(null);
  const overlayRef = useRef(null);
  const idBase = useId();
  const helpId = `${idBase}-help`;
  const nomeId = `${idBase}-nome`;
  const telId = `${idBase}-tel`;
  const chkAbrirId = `${idBase}-abrir`;
  const chkAssumirId = `${idBase}-assumir`;
  const instId = `${idBase}-whatsapp-instance`;

  const needsInstancePicker = whatsappInstances.length > 1;
  const mustPickInstance = needsInstancePicker && (abrirConversa || assumir);

  const resetApiHints = useCallback(() => {
    setApiError(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    setNome("");
    setTelefone("");
    setAbrirConversa(true);
    setAssumir(false);
    setSubmitting(false);
    setClientError("");
    setApiError(null);
    setWhatsappInstances([]);
    setSelectedInstanceId("");
    setLoadingInstances(false);
    const t = requestAnimationFrame(() => {
      telefoneRef.current?.focus();
    });
    return () => cancelAnimationFrame(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingInstances(true);
    fetchWhatsappInstancesAtendimento({ silent: true })
      .then((list) => {
        if (cancelled) return;
        const active = Array.isArray(list) ? list.filter((i) => i && i.ativo !== false) : [];
        setWhatsappInstances(active);
        if (active.length === 1) {
          setSelectedInstanceId(String(active[0].id));
        }
      })
      .catch(() => {
        if (!cancelled) setWhatsappInstances([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingInstances(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape" && !submitting) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose, submitting]);

  function handleTelChange(e) {
    const v = e.target.value;
    setTelefone(formatBrPhoneDisplay(v));
    setClientError("");
    resetApiHints();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmedNome = nome.trim();
    const telDigits = digitsOnly(telefone);

    if (!telDigits) {
      setClientError("Informe o número com DDD.");
      telefoneRef.current?.focus();
      return;
    }

    if (!isPlausibleBrPhoneDigits(telDigits)) {
      setClientError("O número parece incompleto. Use DDD + telefone (10 ou 11 dígitos) ou inclua o código 55.");
      telefoneRef.current?.focus();
      return;
    }

    if (mustPickInstance && !selectedInstanceId) {
      setClientError("Selecione por qual número WhatsApp deseja iniciar a conversa.");
      return;
    }

    setClientError("");
    setSubmitting(true);
    resetApiHints();

    try {
      /** @type {import('../api/clientes.types').CriarClientePayload} */
      const payload = {
        telefone: String(telefone || "").trim(),
      };
      if (trimmedNome) payload.nome = trimmedNome;
      if (assumir) {
        payload.assumir = true;
      } else if (abrirConversa) {
        payload.abrir_conversa = true;
      }
      if (selectedInstanceId && (abrirConversa || assumir)) {
        payload.whatsapp_instance_id = Number(selectedInstanceId);
      }

      const data = await criarCliente(payload);
      const parsed = parsePostClientesResponse(data);

      if (parsed.codigo === "SELECIONE_WHATSAPP_INSTANCE" || data?.codigo === "SELECIONE_WHATSAPP_INSTANCE") {
        const fromApi = data?.whatsapp_instances ?? parsed.whatsapp_instances;
        if (Array.isArray(fromApi) && fromApi.length) setWhatsappInstances(fromApi);
        setClientError("Selecione por qual número WhatsApp deseja iniciar a conversa.");
        return;
      }

      if (parsed.conversa_aviso) {
        showToast({
          type: "warning",
          title: "Conversa",
          message: parsed.conversa_aviso,
        });
      }
      if (parsed.assumir_erro) {
        showToast({
          type: "warning",
          title: "Assumir atendimento",
          message:
            parsed.assumir_status != null
              ? `${parsed.assumir_erro} (${parsed.assumir_status})`
              : parsed.assumir_erro,
        });
      }

      if (parsed.conversa?.id != null) {
        onSuccess?.(parsed.conversa, { cliente: parsed.cliente });
        onClose();
        return;
      }

      if (parsed.cliente?.id != null) {
        onSuccess?.(null, { cliente: parsed.cliente });
        onClose();
        return;
      }

      setApiError({
        detalhe: "O servidor respondeu sem dados do cliente. Atualize a lista e tente novamente.",
        exemplos: [],
      });
    } catch (err) {
      const status = err?.response?.status;
      const fallback =
        err?.response?.data?.erro ||
        err?.response?.data?.error ||
        err?.response?.data?.detalhe ||
        (status ? `Erro ${status}` : err?.message || "Não foi possível salvar o contato.");
      setApiError({ detalhe: fallback, exemplos: [] });
    } finally {
      setSubmitting(false);
    }
  }

  const submitLabel = assumir ? "Salvar e atender" : abrirConversa ? "Iniciar conversa" : "Salvar contato";
  const submittingLabel = assumir ? "Assumindo…" : abrirConversa ? "Abrindo…" : "Salvando…";

  const helpLinhaExtra = apiError?.formato_esperado ? String(apiError.formato_esperado) : null;
  const exemploApi = Array.isArray(apiError?.exemplos) && apiError.exemplos.length > 0 ? apiError.exemplos[0] : null;

  if (!open) return null;

  const node = (
    <div
      ref={overlayRef}
      className="ncm-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === overlayRef.current && !submitting) onClose();
      }}
    >
      <div
        className="ncm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${idBase}-heading`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ncm-head">
          <div className="ncm-title-block">
            <div className="ncm-icon" aria-hidden>
              <Phone size={22} strokeWidth={1.75} />
            </div>
            <div>
              <h2 className="ncm-title" id={`${idBase}-heading`}>
                Novo contato
              </h2>
              <p className="ncm-subtitle">Digite o número com DDD. O sistema aceita com ou sem máscara.</p>
            </div>
          </div>
          <button type="button" className="ncm-close" onClick={() => !submitting && onClose()} aria-label="Fechar">
            ×
          </button>
        </div>

        <form className="ncm-body" onSubmit={handleSubmit} noValidate>
          <div className="ncm-field">
            <label className="ncm-label-row" htmlFor={nomeId}>
              <User size={16} strokeWidth={1.75} />
              Nome <span style={{ fontWeight: 400, color: "var(--ds-text-tertiary)" }}>(opcional)</span>
            </label>
            <input
              id={nomeId}
              name="nome"
              type="text"
              className="ncm-input"
              autoComplete="name"
              placeholder="Como aparecerá na conversa"
              value={nome}
              onChange={(e) => {
                setNome(e.target.value);
                resetApiHints();
              }}
              disabled={submitting}
            />
          </div>

          <div className="ncm-field">
            <label className="ncm-label-row" htmlFor={telId}>
              <Phone size={16} strokeWidth={1.75} />
              Telefone
            </label>
            <input
              ref={telefoneRef}
              id={telId}
              name="telefone"
              type="tel"
              inputMode="tel"
              className="ncm-input"
              autoComplete="tel-national"
              placeholder="Ex.: (11) 98765-4321 ou +55 11 98765-4321"
              value={telefone}
              onChange={handleTelChange}
              disabled={submitting}
              aria-required="true"
              aria-invalid={!!(clientError || apiError)}
              aria-describedby={helpId}
            />
            <p id={helpId} className="ncm-help">
              {AJUDA_TELEFONE_PADRAO}
              <span className="ncm-example">{EXEMPLO_TELEFONE_PADRAO}</span>
            </p>
          </div>

          {mustPickInstance ? (
            <div className="ncm-field">
              <label className="ncm-label-row" htmlFor={instId}>
                Número WhatsApp
              </label>
              <select
                id={instId}
                className="ncm-input"
                value={selectedInstanceId}
                onChange={(e) => {
                  setSelectedInstanceId(e.target.value);
                  resetApiHints();
                }}
                disabled={submitting || loadingInstances}
                aria-required="true"
              >
                <option value="">
                  {loadingInstances ? "Carregando números…" : "Selecione o número"}
                </option>
                {whatsappInstances.map((inst) => (
                  <option key={String(inst.id)} value={String(inst.id)}>
                    {whatsappInstanceLabel(inst) || `WhatsApp #${inst.id}`}
                  </option>
                ))}
              </select>
              <p className="ncm-help">Este contato pode conversar por mais de um número da empresa.</p>
            </div>
          ) : null}

          <div className="ncm-field ncm-field--checks" role="group" aria-label="Opções ao salvar">
            <label className="ncm-check" htmlFor={chkAbrirId}>
              <input
                id={chkAbrirId}
                type="checkbox"
                checked={assumir || abrirConversa}
                disabled={submitting || assumir}
                aria-describedby={assumir ? `${chkAbrirId}-hint` : undefined}
                onChange={(e) => {
                  setAbrirConversa(e.target.checked);
                  resetApiHints();
                }}
              />
              <span>Abrir conversa ao salvar</span>
            </label>
            {assumir ? (
              <p className="ncm-help ncm-help--indent" id={`${chkAbrirId}-hint`}>
                Incluído ao assumir o atendimento.
              </p>
            ) : null}
            <label className="ncm-check" htmlFor={chkAssumirId}>
              <input
                id={chkAssumirId}
                type="checkbox"
                checked={assumir}
                disabled={submitting}
                onChange={(e) => {
                  const on = e.target.checked;
                  setAssumir(on);
                  resetApiHints();
                }}
              />
              <span>Assumir e atender agora</span>
            </label>
          </div>

          {apiError?.detalhe ? (
            <div className="ncm-alert" role="alert">
              <strong>{apiError.detalhe}</strong>
              {exemploApi ? <span className="ncm-example" style={{ display: "block", marginTop: 6 }}>Exemplo aceito: {exemploApi}</span> : null}
              {helpLinhaExtra ? <span style={{ display: "block", marginTop: 6 }}>{helpLinhaExtra}</span> : null}
            </div>
          ) : null}

          {clientError ? (
            <div className="ncm-alert" role="alert">
              {clientError}
            </div>
          ) : null}

          <div className="ncm-footer">
            <button type="button" className="ncm-btn ncm-btn--ghost" onClick={() => !submitting && onClose()} disabled={submitting}>
              Cancelar
            </button>
            <button type="submit" className="ncm-btn ncm-btn--primary" disabled={submitting}>
              {submitting ? (
                <>
                  <span className="ncm-spin" aria-hidden />
                  {submittingLabel}
                </>
              ) : (
                submitLabel
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
