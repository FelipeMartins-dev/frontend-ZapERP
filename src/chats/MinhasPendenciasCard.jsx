import { memo } from "react";
import { PENDENCIA_CATEGORIAS } from "./minhasPendenciasService";
import "./minhasPendencias.css";

const ITENS = [
  {
    key: PENDENCIA_CATEGORIAS.transferidosParaVoce,
    label: "Transferidos",
    tone: "blue",
  },
  {
    key: PENDENCIA_CATEGORIAS.aguardandoSuaResposta,
    label: "Aguardando",
    tone: "amber",
  },
  {
    key: PENDENCIA_CATEGORIAS.emAtraso,
    label: "Atraso",
    tone: "red",
  },
];

function MinhasPendenciasCard({
  minhasPendencias,
  pendenciaAtiva,
  loadingPendencias,
  loadingPendenciaCategoria,
  onPendenciaClick,
}) {
  const resumo = minhasPendencias || {};
  const todosZero =
    (resumo.transferidosParaVoce || 0) === 0 &&
    (resumo.aguardandoSuaResposta || 0) === 0 &&
    (resumo.emAtraso || 0) === 0;

  return (
    <section
      className={`minhas-pendencias-card${todosZero ? " is-all-zero" : ""}${loadingPendencias ? " is-loading" : ""}`}
      aria-label="Minhas pendências"
    >
      <header className="minhas-pendencias-card__header">
        <span className="minhas-pendencias-card__icon" aria-hidden="true">
          🔔
        </span>
        <span className="minhas-pendencias-card__title">Minhas Pendências</span>
        {loadingPendencias ? (
          <span className="minhas-pendencias-card__loading-dot" aria-hidden="true" />
        ) : null}
      </header>

      <ul className="minhas-pendencias-card__list" role="list">
        {ITENS.map((item) => {
          const count = Number(resumo[item.key]) || 0;
          const isActive = pendenciaAtiva === item.key;
          const isZero = count === 0;
          const hasValue = count > 0;
          const isBusy = isActive && loadingPendenciaCategoria;

          return (
            <li key={item.key} className="minhas-pendencias-card__item">
              <button
                type="button"
                className={`minhas-pendencias-card__btn is-${item.tone}${isActive ? " is-active" : ""}${isZero ? " is-zero" : ""}${hasValue ? " is-has-value" : ""}`}
                onClick={() => onPendenciaClick(item.key)}
                aria-pressed={isActive}
                aria-busy={isBusy || undefined}
                title={`${item.label}: ${count}`}
              >
                <span className={`minhas-pendencias-card__dot is-${item.tone}`} aria-hidden="true" />
                <span className="minhas-pendencias-card__label">{item.label}</span>
                <span className="minhas-pendencias-card__count">{count}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function propsAreEqual(prev, next) {
  if (prev.pendenciaAtiva !== next.pendenciaAtiva) return false;
  if (prev.loadingPendencias !== next.loadingPendencias) return false;
  if (prev.loadingPendenciaCategoria !== next.loadingPendenciaCategoria) return false;
  if (prev.onPendenciaClick !== next.onPendenciaClick) return false;
  const a = prev.minhasPendencias || {};
  const b = next.minhasPendencias || {};
  return (
    a.transferidosParaVoce === b.transferidosParaVoce &&
    a.aguardandoSuaResposta === b.aguardandoSuaResposta &&
    a.emAtraso === b.emAtraso
  );
}

export default memo(MinhasPendenciasCard, propsAreEqual);
