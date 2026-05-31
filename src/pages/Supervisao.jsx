import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import EmptyState from "../components/feedback/EmptyState";
import {
  getClientesPendentesSupervisao,
  getRelatorioDiarioSupervisao,
  getMovimentacaoFuncionarioSupervisao,
  getResumoSupervisao,
} from "../api/supervisaoService";
import SupervisaoTopCards from "../supervisao/components/SupervisaoTopCards";
import SupervisaoFilters from "../supervisao/components/SupervisaoFilters";
import ClientesPendentesPanel from "../supervisao/components/ClientesPendentesPanel";
import RankingEquipePanel from "../supervisao/components/RankingEquipePanel";
import RelatorioDiarioPanel from "../supervisao/components/RelatorioDiarioPanel";
import {
  normalizePendente,
  safeDisplayText,
  sortPendentes,
  toArray,
  toIsoDate,
  toNumber,
} from "../supervisao/supervisaoUtils";
import { isGroupConversation } from "../utils/conversaUtils";
import "./supervisao.css";

const INITIAL_FILTERS = {
  busca: "",
  atendenteId: "",
  departamento: "",
  nivel: "",
  somenteAtrasados: false,
  periodo: "hoje",
  data: toIsoDate(new Date()),
};

export default function Supervisao() {
  const navigate = useNavigate();
  const [resumo, setResumo] = useState({});
  const [clientesPendentesRaw, setClientesPendentesRaw] = useState([]);
  const [relatorioDiario, setRelatorioDiario] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [filtros, setFiltros] = useState(INITIAL_FILTERS);
  const [funcionarioAtivo, setFuncionarioAtivo] = useState(null);
  const [movimentacao, setMovimentacao] = useState(null);
  const [loadingMovimentacao, setLoadingMovimentacao] = useState(false);

  const dataRelatorio = filtros.data || toIsoDate(new Date());

  const carregarDados = useCallback(async () => {
    let isFirstLoad = false;
    setError("");
    setRefreshing(true);
    try {
      isFirstLoad = loading;
      const [resumoData, pendentesData, relatorioData] = await Promise.all([
        getResumoSupervisao(),
        getClientesPendentesSupervisao(),
        getRelatorioDiarioSupervisao(dataRelatorio),
      ]);
      setResumo(resumoData || {});
      const pendentesLista = Array.isArray(pendentesData) ? pendentesData : [];
      setClientesPendentesRaw(pendentesLista.filter((item) => !isGroupConversation(item)));
      setRelatorioDiario(relatorioData || {});
    } catch (err) {
      setError(err?.response?.data?.error || "Não foi possível carregar a central de supervisão.");
    } finally {
      if (isFirstLoad) setLoading(false);
      setRefreshing(false);
      setLoading(false);
    }
  }, [dataRelatorio, loading]);

  useEffect(() => {
    void carregarDados();
    const timer = setInterval(() => {
      void carregarDados();
    }, 30000);
    return () => clearInterval(timer);
  }, [carregarDados]);

  const slaMinutos = toNumber(resumo?.sla_minutos ?? resumo?.slaMinutos ?? 30, 30);

  const clientesPendentes = useMemo(
    () => sortPendentes(clientesPendentesRaw.map((item) => normalizePendente(item, slaMinutos))),
    [clientesPendentesRaw, slaMinutos]
  );

  const pendentesOrdenados = useMemo(
    () =>
      clientesPendentes.filter((item) => {
        if (filtros.atendenteId && String(item?.atendente_id ?? item?.funcionario_id ?? "") !== String(filtros.atendenteId)) {
          return false;
        }
        if (filtros.departamento && String(item.departamentoNome || "").toLowerCase() !== String(filtros.departamento).toLowerCase()) {
          return false;
        }
        if (filtros.nivel && item.nivel !== filtros.nivel) return false;
        if (filtros.somenteAtrasados && item.minutosAguardando < 30) return false;
        if (filtros.busca) {
          const q = filtros.busca.toLowerCase();
          const hay = `${item.clienteNome} ${item.telefone} ${item.resumoConversa}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      }),
    [clientesPendentes, filtros]
  );

  const equipeHoje = useMemo(() => {
    const rankingRelatorio = toArray(relatorioDiario, ["ranking_funcionarios"]);
    if (rankingRelatorio.length > 0) return rankingRelatorio;
    return toArray(resumo, ["equipe_hoje", "equipeHoje", "funcionarios", "atendentes"]);
  }, [resumo, relatorioDiario]);

  const cards = useMemo(
    () => [
      {
        key: "aguardando",
        label: "Aguardando funcionário",
        accent: "primary",
        value: toNumber(
          resumo?.aguardando_funcionario ??
            resumo?.aguardandoFuncionario ??
            resumo?.cards?.aguardando_funcionario ??
            pendentesOrdenados.length
        ),
      },
      {
        key: "atrasados",
        label: "Atrasados > 30 min",
        accent: "warning",
        value: toNumber(resumo?.cards?.atrasados_30min ?? resumo?.atrasados_30min ?? resumo?.atrasados ?? 0),
      },
    ],
    [resumo, pendentesOrdenados.length]
  );

  const departamentos = useMemo(
    () => toArray(relatorioDiario, ["departamentos_maior_demanda"]),
    [relatorioDiario]
  );
  const atendentes = useMemo(
    () => toArray(resumo, ["equipe_hoje", "equipeHoje", "funcionarios", "atendentes", "usuarios"]),
    [resumo]
  );

  async function abrirMovimentacao(funcionario) {
    if (!funcionario?.id) return;
    setFuncionarioAtivo(funcionario);
    setLoadingMovimentacao(true);
    try {
      const data = await getMovimentacaoFuncionarioSupervisao(funcionario.id);
      setMovimentacao(data);
    } catch {
      setMovimentacao(null);
    } finally {
      setLoadingMovimentacao(false);
    }
  }

  function abrirConversa(conversaId) {
    if (!conversaId) return;
    navigate("/atendimento", { state: { openConversaId: conversaId } });
  }

  function onChangeFiltro(key, value) {
    setFiltros((prev) => ({ ...prev, [key]: value }));
  }

  function onResetFiltros() {
    setFiltros({ ...INITIAL_FILTERS, data: toIsoDate(new Date()) });
  }

  if (loading) {
    return (
      <div className="supervisao-page supervisao-page--loading">
        <div className="supervisao-skeleton-row supervisao-skeleton-row--hero" />
        <div className="supervisao-skeleton-grid supervisao-skeleton-grid--kpis">
          <div className="supervisao-skeleton-card" />
          <div className="supervisao-skeleton-card" />
        </div>
        <div className="supervisao-skeleton-grid supervisao-skeleton-grid--main">
          <div className="supervisao-skeleton-card supervisao-skeleton-card--tall" />
          <div className="supervisao-skeleton-card supervisao-skeleton-card--tall" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="supervisao-page">
        <div className="supervisao-error">
          <p>{error}</p>
          <button type="button" className="supervisao-secondary-btn" onClick={() => void carregarDados()}>
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="supervisao-page">
      <header className="supervisao-header">
        <div className="supervisao-header-inner">
          <p className="supervisao-header-eyebrow">Central operacional</p>
          <h1>Supervisão</h1>
          <p className="supervisao-header-desc">
            Acompanhe clientes aguardando resposta e o desempenho da equipe em tempo real.
          </p>
          {refreshing ? (
            <p className="supervisao-refreshing" role="status">
              Atualizando dados…
            </p>
          ) : null}
        </div>
      </header>

      <SupervisaoTopCards cards={cards} />

      <SupervisaoFilters
        filtros={filtros}
        onChangeFiltro={onChangeFiltro}
        atendentes={atendentes}
        departamentos={departamentos}
        onReset={onResetFiltros}
      />

      <section className="supervisao-grid">
        <ClientesPendentesPanel clientes={pendentesOrdenados} onAbrirConversa={abrirConversa} />
        <RankingEquipePanel equipe={equipeHoje} onAbrirMovimentacao={abrirMovimentacao} />
      </section>

      <RelatorioDiarioPanel relatorio={relatorioDiario} onAbrirConversa={abrirConversa} />

      {pendentesOrdenados.length === 0 ? (
        <div className="supervisao-panel supervisao-panel--raised supervisao-note-empty">
          <EmptyState title="Todos os atendimentos estão dentro do prazo." description="" />
        </div>
      ) : null}

      {funcionarioAtivo ? (
        <div className="supervisao-modal-backdrop" onClick={() => setFuncionarioAtivo(null)}>
          <div className="supervisao-modal" onClick={(e) => e.stopPropagation()}>
            <header>
              <h3>Movimentação do funcionário</h3>
              <p>{safeDisplayText(funcionarioAtivo?.nome ?? funcionarioAtivo?.name, "")}</p>
            </header>
            {loadingMovimentacao ? (
              <p>Carregando detalhes...</p>
            ) : (
              <>
                <div className="supervisao-modal-grid">
                  <div>
                    <strong>Resumo do dia</strong>
                    <p>
                      {safeDisplayText(
                        movimentacao?.resumo_conversa ?? movimentacao?.resumo,
                        "Sem resumo disponível."
                      )}
                    </p>
                  </div>
                  <div>
                    <strong>Conversas em aberto</strong>
                    <p>{toNumber(movimentacao?.conversas_em_aberto ?? movimentacao?.conversasEmAberto ?? 0)}</p>
                  </div>
                </div>
                <div>
                  <strong>Eventos importantes</strong>
                  <ul className="supervisao-eventos">
                    {toArray(movimentacao, ["eventos", "movimentacoes"]).map((evento, idx) => (
                      <li key={`${String(evento?.id ?? idx)}`}>
                        {safeDisplayText(evento?.descricao ?? evento?.tipo, "Evento")}{" "}
                        <small>{safeDisplayText(evento?.hora ?? evento?.criado_em, "")}</small>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
