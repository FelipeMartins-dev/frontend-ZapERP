/**
 * Banner discreto de atendimento encerrado — texto curto + reabrir compacto.
 */
export default function ClosedAttendancePanel({
  atendenteNome = "outro usuário",
  showReopenCta = false,
  reopenBusy = false,
  onReopen,
}) {
  return (
    <div className="wa-closedAttendance-panel" role="region" aria-label="Atendimento finalizado">
      <p className="wa-closedAttendance-text">
        Este atendimento foi encerrado por {atendenteNome}.
      </p>
      {showReopenCta ? (
        <button
          type="button"
          className="wa-closedAttendance-reopenBtn"
          onClick={onReopen}
          disabled={reopenBusy}
        >
          {reopenBusy ? "Reabrindo..." : "Reabrir atendimento"}
        </button>
      ) : null}
    </div>
  );
}
