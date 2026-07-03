import { memo } from "react";

const TEMPO_PARADO_CHIPS = [
  { v: "", l: "Todos" },
  { v: "2h", l: "+2h" },
  { v: "12h", l: "+12h" },
  { v: "24h", l: "+24h" },
  { v: "7d", l: "+7d" },
  { v: "30d", l: "+30d" },
];

/**
 * Painel de filtros avançados — isolado para não recriar JSX no pai a cada render.
 * `open={false}` não monta conteúdo (comportamento igual ao slot condicional anterior).
 */
function ChatListAdvancedFiltersPanel({
  open,
  filtersAuxLoading,
  separarMensagensDisparadasLigado,
  statusFilter,
  onStatusFilterChange,
  tagFilter,
  onTagFilterChange,
  allTags,
  showSetorFilter,
  departamentoFilter,
  onDepartamentoFilterChange,
  departamentos,
  atendenteFilter,
  onAtendenteFilterChange,
  atendentes,
  dataInicio,
  onDataInicioChange,
  dataFim,
  onDataFimChange,
  mineOnly,
  onMineOnlyChange,
  onlyFinalizadasAusencia,
  onOnlyFinalizadasAusenciaChange,
  aguardandoClienteOnly,
  onAguardandoClienteOnlyChange,
  showFinanceiroFilters,
  pagamentosPendentesOnly,
  onPagamentosPendentesOnlyChange,
  emAtrasoOnly,
  onEmAtrasoOnlyChange,
  order,
  onOrderChange,
  tempoParadoFilter,
  onTempoParadoFilterChange,
  showAusenciaLote,
  loteAusenciaBusy,
  loteAusenciaMsg,
  loteAusenciaConfirm,
  onLoteAusenciaConfirmChange,
  loteAusenciaConfirmPhrase,
  onLoteAusenciaSimular,
  onLoteAusenciaExecutar,
}) {
  if (!open) return null;

  return (
    <div className="chat-list-filters" aria-busy={filtersAuxLoading || undefined}>
      {filtersAuxLoading ? (
        <div className="chat-list-ausencia-lote-msg" role="status">
          Carregando opções…
        </div>
      ) : null}
      <div className="chat-list-filters-row">
        <label className="chat-list-field">
          <span>Status</span>
          <select
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value)}
            className="chat-list-select"
          >
            <option value="todos">Todos</option>
            <option value="aberta">Aberta</option>
            {separarMensagensDisparadasLigado ? (
              <option value="mensagem_disparada">Mensagem disparada</option>
            ) : null}
            <option value="em_atendimento">Em atendimento</option>
            <option value="aguardando_cliente">Aguardando cliente</option>
            <option value="fechada">Fechada</option>
          </select>
        </label>
        <label className="chat-list-field">
          <span>Tag</span>
          <select
            value={tagFilter}
            onChange={(e) => onTagFilterChange(e.target.value)}
            className="chat-list-select"
          >
            <option value="todas">Todas</option>
            {allTags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome}
              </option>
            ))}
          </select>
        </label>
        {showSetorFilter ? (
          <label className="chat-list-field">
            <span>Setor</span>
            <select
              value={departamentoFilter}
              onChange={(e) => onDepartamentoFilterChange(e.target.value)}
              className="chat-list-select"
            >
              <option value="todos">Todos</option>
              {departamentos.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nome}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="chat-list-field">
          <span>Atendente</span>
          <select
            value={atendenteFilter}
            onChange={(e) => onAtendenteFilterChange(e.target.value)}
            className="chat-list-select"
          >
            <option value="todos">Todos</option>
            {atendentes.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nome || u.email}
              </option>
            ))}
          </select>
        </label>
        <label className="chat-list-field">
          <span>Data início</span>
          <input
            type="date"
            value={dataInicio}
            onChange={(e) => onDataInicioChange(e.target.value)}
            className="chat-list-select"
          />
        </label>
        <label className="chat-list-field">
          <span>Data fim</span>
          <input
            type="date"
            value={dataFim}
            onChange={(e) => onDataFimChange(e.target.value)}
            className="chat-list-select"
          />
        </label>
        <label className="chat-list-check">
          <input type="checkbox" checked={mineOnly} onChange={(e) => onMineOnlyChange(e.target.checked)} />
          <span>Minhas conversas</span>
        </label>
        <label className="chat-list-check">
          <input
            type="checkbox"
            checked={onlyFinalizadasAusencia}
            onChange={(e) => onOnlyFinalizadasAusenciaChange(e.target.checked)}
          />
          <span title="Restringe às conversas encerradas automaticamente por falta de resposta do cliente">
            Só finalizadas por ausência
          </span>
        </label>
        <label className="chat-list-check">
          <input
            type="checkbox"
            checked={aguardandoClienteOnly}
            onChange={(e) => onAguardandoClienteOnlyChange(e.target.checked)}
          />
          <span title="Conversas em atendimento com atendente, aguardando retorno do cliente após mensagem da equipe">
            Aguardando resposta do cliente
          </span>
        </label>
        {showFinanceiroFilters ? (
          <>
            <label className="chat-list-check">
              <input
                type="checkbox"
                checked={pagamentosPendentesOnly}
                onChange={(e) => onPagamentosPendentesOnlyChange(e.target.checked)}
              />
              <span title="Cobrança enviada — aguardando pagamento dentro do prazo">
                Pagamentos pendentes
              </span>
            </label>
            <label className="chat-list-check">
              <input
                type="checkbox"
                checked={emAtrasoOnly}
                onChange={(e) => onEmAtrasoOnlyChange(e.target.checked)}
              />
              <span title="Prazo de pagamento vencido — necessária nova cobrança">
                Em atraso
              </span>
            </label>
          </>
        ) : null}
        <label className="chat-list-field">
          <span>Ordem</span>
          <select value={order} onChange={(e) => onOrderChange(e.target.value)} className="chat-list-select">
            <option value="recentes">Mais recentes</option>
            <option value="antigas">Mais antigas</option>
          </select>
        </label>
      </div>
      <div className="chat-list-filters-row chat-list-filters-row--tempo-parado">
        <span className="chat-list-field-label">Tempo parado</span>
        <div className="chat-list-tempo-parado-chips" role="group" aria-label="Filtro por tempo parado">
          {TEMPO_PARADO_CHIPS.map(({ v, l }) => (
            <button
              key={v || "none"}
              type="button"
              className={`chat-list-tempo-chip${tempoParadoFilter === v ? " is-on" : ""}`}
              onClick={() => onTempoParadoFilterChange(v)}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      {showAusenciaLote ? (
        <div className="chat-list-ausencia-lote">
          <div className="chat-list-ausencia-lote-head">
            <span className="chat-list-ausencia-lote-title">Ausência — lote</span>
            <span className="chat-list-ausencia-lote-sub">Até 50 conversas em atendimento da lista atual</span>
          </div>
          <div className="chat-list-ausencia-lote-row">
            <button
              type="button"
              className="chat-list-ausencia-lote-btn"
              disabled={loteAusenciaBusy}
              onClick={() => void onLoteAusenciaSimular()}
            >
              Simular
            </button>
            <input
              type="text"
              className="chat-list-ausencia-lote-input"
              value={loteAusenciaConfirm}
              onChange={(e) => onLoteAusenciaConfirmChange(e.target.value)}
              placeholder={loteAusenciaConfirmPhrase}
              aria-label="Texto de confirmação para executar o lote"
            />
            <button
              type="button"
              className="chat-list-ausencia-lote-btn chat-list-ausencia-lote-btn--primary"
              disabled={loteAusenciaBusy}
              onClick={() => void onLoteAusenciaExecutar()}
            >
              Executar
            </button>
          </div>
          {loteAusenciaMsg ? <div className="chat-list-ausencia-lote-msg">{loteAusenciaMsg}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function panelPropsAreEqual(prev, next) {
  if (prev.open !== next.open) return false;
  if (prev.filtersAuxLoading !== next.filtersAuxLoading) return false;
  if (prev.separarMensagensDisparadasLigado !== next.separarMensagensDisparadasLigado) return false;
  if (prev.statusFilter !== next.statusFilter) return false;
  if (prev.tagFilter !== next.tagFilter) return false;
  if (prev.showSetorFilter !== next.showSetorFilter) return false;
  if (prev.departamentoFilter !== next.departamentoFilter) return false;
  if (prev.atendenteFilter !== next.atendenteFilter) return false;
  if (prev.dataInicio !== next.dataInicio) return false;
  if (prev.dataFim !== next.dataFim) return false;
  if (prev.mineOnly !== next.mineOnly) return false;
  if (prev.onlyFinalizadasAusencia !== next.onlyFinalizadasAusencia) return false;
  if (prev.aguardandoClienteOnly !== next.aguardandoClienteOnly) return false;
  if (prev.showFinanceiroFilters !== next.showFinanceiroFilters) return false;
  if (prev.pagamentosPendentesOnly !== next.pagamentosPendentesOnly) return false;
  if (prev.emAtrasoOnly !== next.emAtrasoOnly) return false;
  if (prev.order !== next.order) return false;
  if (prev.tempoParadoFilter !== next.tempoParadoFilter) return false;
  if (prev.showAusenciaLote !== next.showAusenciaLote) return false;
  if (prev.loteAusenciaBusy !== next.loteAusenciaBusy) return false;
  if (prev.loteAusenciaMsg !== next.loteAusenciaMsg) return false;
  if (prev.loteAusenciaConfirm !== next.loteAusenciaConfirm) return false;
  if (prev.loteAusenciaConfirmPhrase !== next.loteAusenciaConfirmPhrase) return false;
  if (prev.allTags !== next.allTags) return false;
  if (prev.atendentes !== next.atendentes) return false;
  if (prev.departamentos !== next.departamentos) return false;
  if (prev.onStatusFilterChange !== next.onStatusFilterChange) return false;
  if (prev.onTagFilterChange !== next.onTagFilterChange) return false;
  if (prev.onDepartamentoFilterChange !== next.onDepartamentoFilterChange) return false;
  if (prev.onAtendenteFilterChange !== next.onAtendenteFilterChange) return false;
  if (prev.onDataInicioChange !== next.onDataInicioChange) return false;
  if (prev.onDataFimChange !== next.onDataFimChange) return false;
  if (prev.onMineOnlyChange !== next.onMineOnlyChange) return false;
  if (prev.onOnlyFinalizadasAusenciaChange !== next.onOnlyFinalizadasAusenciaChange) return false;
  if (prev.onAguardandoClienteOnlyChange !== next.onAguardandoClienteOnlyChange) return false;
  if (prev.onPagamentosPendentesOnlyChange !== next.onPagamentosPendentesOnlyChange) return false;
  if (prev.onEmAtrasoOnlyChange !== next.onEmAtrasoOnlyChange) return false;
  if (prev.onOrderChange !== next.onOrderChange) return false;
  if (prev.onTempoParadoFilterChange !== next.onTempoParadoFilterChange) return false;
  if (prev.onLoteAusenciaConfirmChange !== next.onLoteAusenciaConfirmChange) return false;
  if (prev.onLoteAusenciaSimular !== next.onLoteAusenciaSimular) return false;
  if (prev.onLoteAusenciaExecutar !== next.onLoteAusenciaExecutar) return false;
  return true;
}

export default memo(ChatListAdvancedFiltersPanel, panelPropsAreEqual);
