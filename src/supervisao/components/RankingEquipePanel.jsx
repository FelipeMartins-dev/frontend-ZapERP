import EmptyState from "../../components/feedback/EmptyState";
import {
  formatTempoMedioRespostaMinutos,
  pickConversasEmAtendimento,
  pickFinalizadasHoje,
  safeDisplayText,
  toNumber,
} from "../supervisaoUtils";

export default function RankingEquipePanel({ equipe, onAbrirMovimentacao }) {
  return (
    <div className="supervisao-panel supervisao-panel--raised">
      <div className="supervisao-panel-head">
        <h2>Ranking da equipe</h2>
        {equipe.length > 0 ? <span className="supervisao-panel-count">{equipe.length}</span> : null}
      </div>
      {equipe.length === 0 ? (
        <EmptyState title="Sem dados de equipe hoje." description="" />
      ) : (
        <div className="supervisao-team-grid">
          {equipe.map((funcionario, index) => {
            const nome = safeDisplayText(funcionario?.nome ?? funcionario?.name, "Atendente");
            const inicial = nome.trim().charAt(0).toUpperCase() || "?";
            const conversasEmAtendimento = pickConversasEmAtendimento(funcionario);
            const semResposta = toNumber(
              funcionario?.sem_resposta ?? funcionario?.clientes_sem_resposta ?? funcionario?.pendentes ?? 0,
              0
            );
            const finalizadasHoje = pickFinalizadasHoje(funcionario);
            const tempoMedio =
              funcionario?.tempo_medio_resposta_minutos ?? funcionario?.tempoMedioRespostaMinutos ?? null;

            return (
              <button
                key={String(funcionario?.id ?? funcionario?.usuario_id ?? index)}
                type="button"
                className="supervisao-team-card"
                onClick={() => onAbrirMovimentacao(funcionario)}
              >
                <span className="supervisao-team-rank" aria-hidden>
                  {index + 1}
                </span>
                <span className="supervisao-team-avatar" aria-hidden>
                  {inicial}
                </span>
                <div className="supervisao-team-card-body">
                  <span className="supervisao-team-name">{nome}</span>
                  <ul className="supervisao-team-stats">
                    <li>
                      <span className="supervisao-team-stat-label">Conversas em atendimento</span>
                      <span className="supervisao-team-stat-value">{conversasEmAtendimento}</span>
                    </li>
                    <li>
                      <span className="supervisao-team-stat-label">Sem resposta</span>
                      <span className="supervisao-team-stat-value">{semResposta}</span>
                    </li>
                    <li>
                      <span className="supervisao-team-stat-label">Finalizadas hoje</span>
                      <span className="supervisao-team-stat-value">{finalizadasHoje}</span>
                    </li>
                    <li>
                      <span className="supervisao-team-stat-label">Tempo médio de resposta</span>
                      <span className="supervisao-team-stat-value">{formatTempoMedioRespostaMinutos(tempoMedio)}</span>
                    </li>
                  </ul>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
