import { MessageSquarePlus, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import ZapERPLogo from "../brand/ZapERPLogo";
import Button from "../components/ui/Button";
import "../components/ui/button.css";
import { ZAPERP_FOCUS_CHAT_SEARCH_EVENT } from "./atendimentoUiEvents";
import "./atendimentoEmptyState.css";

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
      <div className="atendimento-empty__inner">
        <div className="atendimento-empty__logo" aria-hidden>
          <ZapERPLogo
            variant="compact"
            size="sm"
            tone="mono"
            interactive={false}
            title="ZapERP"
            name="ZapERP"
            tagline=""
          />
        </div>

        <h2 className="atendimento-empty__title">Nenhuma conversa selecionada</h2>
        <p className="atendimento-empty__desc">
          Selecione uma conversa na lista ou inicie um novo atendimento.
        </p>

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

        <p className="atendimento-empty__hint">
          Atalho: pressione ESC para sair de uma conversa.
        </p>
      </div>
    </div>
  );
}
