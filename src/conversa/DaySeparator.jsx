/** Separador de dia no thread de mensagens (estilo WhatsApp Web). */
export default function DaySeparator({ label }) {
  return (
    <div className="wa-daySep" role="separator" aria-label={`Mensagens do dia ${label}`}>
      <span className="wa-daySep-pill">{label}</span>
    </div>
  );
}
