import EmptyState from "../../components/feedback/EmptyState";
import { formatTempoMinutos, resolveDepartamentoNome, safeDisplayText, toNumber } from "../supervisaoUtils";

export default function RelatorioDiarioPanel({ relatorio, onAbrirConversa }) {
  const totais = relatorio?.totais ?? {};
  const departamentos = Array.isArray(relatorio?.departamentos_maior_demanda)
    ? relatorio.departamentos_maior_demanda
    : [];
  const clientesCriticos = Array.isArray(relatorio?.clientes_criticos) ? relatorio.clientes_criticos : [];
  const maxDemanda = Math.max(1, ...departamentos.map((d) => toNumber(d?.quantidade ?? d?.total ?? 0)));

  return (
    <section className="supervisao-panel supervisao-panel--raised supervisao-panel--wide">
      <div className="supervisao-panel-head">
        <h2>Relatório diário</h2>
      </div>

      <div className="supervisao-relatorio-totais">
        <article>
          <strong>{toNumber(totais?.atendimentos ?? totais?.total_atendimentos ?? 0)}</strong>
          <span>Atendimentos</span>
        </article>
        <article>
          <strong>{toNumber(totais?.atrasados ?? 0)}</strong>
          <span>Atrasados</span>
        </article>
        <article>
          <strong>{formatTempoMinutos(toNumber(totais?.tempo_medio_resposta_minutos ?? 0))}</strong>
          <span>Tempo médio</span>
        </article>
      </div>

      <div className="supervisao-relatorio-grid">
        <div className="supervisao-relatorio-departamentos">
          <h3>Departamentos com maior demanda</h3>
          {departamentos.length === 0 ? (
            <EmptyState title="Sem demanda por departamento hoje." description="" />
          ) : (
            <ul>
              {departamentos.map((item, idx) => {
                const qtd = toNumber(item?.quantidade ?? item?.total ?? 0);
                const width = Math.max(8, Math.round((qtd / maxDemanda) * 100));
                return (
                  <li key={String(item?.departamento_id ?? item?.nome ?? idx)}>
                    <div className="supervisao-bar-label">
                      <span>{resolveDepartamentoNome(item?.departamento ?? item)}</span>
                      <strong>{qtd}</strong>
                    </div>
                    <div className="supervisao-bar-track">
                      <div className="supervisao-bar-fill" style={{ width: `${width}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="supervisao-relatorio-criticos">
          <h3>Clientes críticos</h3>
          {clientesCriticos.length === 0 ? (
            <EmptyState title="Sem clientes críticos no período." description="" />
          ) : (
            <ul>
              {clientesCriticos.slice(0, 6).map((item, idx) => (
                <li key={String(item?.conversa_id ?? item?.id ?? idx)}>
                  <div>
                    <strong>{safeDisplayText(item?.cliente_nome ?? item?.cliente?.nome, "Cliente")}</strong>
                    <span>
                      {formatTempoMinutos(
                        item?.minutos_aguardando ?? item?.tempo_aguardando_minutos ?? 0
                      )}{" "}
                      aguardando
                    </span>
                  </div>
                  <button type="button" onClick={() => onAbrirConversa(item?.conversa_id ?? item?.conversaId)}>
                    Abrir conversa
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
