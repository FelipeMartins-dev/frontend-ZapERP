import { MessageSquarePlus, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import ZapERPLogo from "../brand/ZapERPLogo";
import Button from "../components/ui/Button";
import "../components/ui/button.css";
import { ZAPERP_FOCUS_CHAT_SEARCH_EVENT } from "./atendimentoUiEvents";
import "./atendimentoEmptyState.css";

function TechOrnament({ side = "left" }) {
  return (
    <span
      className={`atendimento-empty__ornament atendimento-empty__ornament--${side}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 160 48" preserveAspectRatio="none" focusable="false">
        <path d="M0 24 H54 M54 24 V10 H78 M78 10 H104 M104 10 V24 H160" />
        <path d="M28 24 V38 H52 M52 38 H76 M76 38 V24" />
        <path d="M118 24 V14 H140" />
        <circle cx="54" cy="24" r="2.1" />
        <circle cx="78" cy="10" r="1.7" />
        <circle cx="104" cy="10" r="1.7" />
        <circle cx="52" cy="38" r="1.7" />
        <circle cx="118" cy="24" r="1.5" className="is-pulse" />
        <circle cx="140" cy="14" r="1.3" />
      </svg>
    </span>
  );
}

/**
 * Área central quando nenhuma conversa está selecionada.
 * Lista à esquerda permanece; sem dashboard/métricas.
 */
export default function AtendimentoEmptyState() {
  const navigate = useNavigate();

  const handleNovaConversa = () => {
    navigate("/atendimento", { state: { openNovoContatoModal: true } });
  };

  const handleBuscarConversa = () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(ZAPERP_FOCUS_CHAT_SEARCH_EVENT));
    }
  };

  return (
    <div className="atendimento-empty" role="status" aria-live="polite">
      <div className="atendimento-empty__glow" aria-hidden="true" />
      <div className="atendimento-empty__grid" aria-hidden="true" />

      <div className="atendimento-empty__inner">
        <div className="atendimento-empty__brand">
          <TechOrnament side="left" />
          <div className="atendimento-empty__logo">
            <ZapERPLogo
              variant="horizontal"
              size="lg"
              tone="full"
              interactive
              title="ZapERP — Atendimento inteligente"
              name="ZapERP"
              tagline="Atendimento inteligente"
            />
          </div>
          <TechOrnament side="right" />
        </div>

        <div className="atendimento-empty__panel">
          <h2 className="atendimento-empty__title">Nenhuma conversa selecionada</h2>
          <p className="atendimento-empty__desc">
            Selecione uma conversa na lista ou inicie um novo atendimento.
          </p>

          <div className="atendimento-empty__divider" aria-hidden="true">
            <span />
            <i />
            <span />
          </div>

          <div className="atendimento-empty__actions">
            <Button
              type="button"
              variant="primary"
              className="atendimento-empty__btn atendimento-empty__btn--primary"
              onClick={handleNovaConversa}
            >
              <MessageSquarePlus size={18} strokeWidth={1.75} aria-hidden />
              Nova conversa
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="atendimento-empty__btn atendimento-empty__btn--secondary"
              onClick={handleBuscarConversa}
            >
              <Search size={18} strokeWidth={1.75} aria-hidden />
              Buscar conversa
            </Button>
          </div>
        </div>

        <p className="atendimento-empty__hint">
          Atalho: pressione <kbd className="atendimento-empty__kbd">ESC</kbd> para sair de uma
          conversa.
        </p>
      </div>
    </div>
  );
}
