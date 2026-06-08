import { RefreshCw } from "lucide-react";

/**
 * Painel de atendimento encerrado — reabrir / metadados (protocolo, setor).
 */
export default function ClosedAttendancePanel({
  atendenteNome = "outro usuário",
  protocolo = "-",
  setor = "Sem setor",
  showReopenCta = false,
  reopenBusy = false,
  onReopen,
}) {
  return (
    <div className="wa-closedAttendance-panel" role="region" aria-label="Atendimento finalizado">
      <span className="wa-messages-blocked-icon" aria-hidden="true">
        <RefreshCw size={22} strokeWidth={2.25} />
      </span>
      <strong className="wa-closedAttendance-title">
        Este atendimento foi encerrado por {atendenteNome}.
      </strong>
      <p className="wa-closedAttendance-sub">
        O histórico permanece visível abaixo. Reabra o atendimento para enviar novas mensagens.
      </p>
      <div className="wa-closedAttendance-meta" aria-label="Dados do atendimento encerrado">
        <div className="wa-closedAttendance-metaItem">
          <span className="wa-closedAttendance-metaLabel">Encerrado por</span>
          <span className="wa-closedAttendance-metaValue">{atendenteNome}</span>
        </div>
        <div className="wa-closedAttendance-metaItem">
          <span className="wa-closedAttendance-metaLabel">Protocolo</span>
          <span className="wa-closedAttendance-metaValue">{protocolo || "-"}</span>
        </div>
        <div className="wa-closedAttendance-metaItem">
          <span className="wa-closedAttendance-metaLabel">Setor</span>
          <span className="wa-closedAttendance-metaValue">{setor}</span>
        </div>
      </div>
      {showReopenCta ? (
        <button
          type="button"
          className="wa-btn wa-btn-primary wa-btn-assumir-destaque wa-closedAttendance-reopenBtn wa-closedAttendance-reopenBtn--hero"
          onClick={onReopen}
          disabled={reopenBusy}
        >
          <RefreshCw size={20} strokeWidth={2.4} aria-hidden="true" />
          <span>{reopenBusy ? "Reabrindo..." : "Reabrir atendimento"}</span>
        </button>
      ) : null}
    </div>
  );
}
