import { memo } from "react";
import { IconHeadset } from "@tabler/icons-react";
import { isSupervisorOrAdmin } from "../auth/permissions";
import AdminAtendenteFilter from "./AdminAtendenteFilter";
import { ChatListSearchBox } from "./ChatListSearchBox";
import { Icon, Chip } from "./chatListUiPrimitives";
import "./minhasPendencias.css";

function isAppAdmin(user) {
  return isSupervisorOrAdmin(user);
}

/**
 * Busca + chips + hint — sem assinatura de `chats` (só props escalares estáveis).
 */
function ChatListToolbar({
  searchRef,
  searchClearNonce,
  onSearchDebounced,
  tab,
  user,
  separarMensagensDisparadasLigado,
  minhaFilaCount,
  total,
  countHoje,
  countAbertas,
  countEmAtendimento,
  countFinalizadas,
  countFinalizadasAuto,
  countAguardandoCliente,
  countAguardandoAtendente,
  isFinanceiroUser,
  countPagamentosPendentes,
  countEmAtraso,
  countAguardandoFuncionario,
  aguardandoFuncionarioVisualState,
  mensagensDisparadasCount,
  listRefreshing,
  loading,
  hasStoreChats,
  filteredCount,
  activeFilterTotalCount,
  adminPorFuncionarioAtivo,
  atendentes,
  adminAtendenteFilterId,
  adminAtendentePanelOpen,
  onAdminPanelOpenChange,
  onAdminSelectUser,
  onAdminClear,
  onAdminBeforeOpen,
  onTabMinhaFila,
  onTabTodas,
  onTabAguardandoAtendente,
  onTabHoje,
  onTabAbertas,
  onTabMensagensDisparadas,
  onTabEmAtendimento,
  onTabFinalizadas,
  onTabFinalizadasAuto,
  onTabAguardandoCliente,
  onTabPagamentosPendentes,
  onTabEmAtraso,
  onTabAguardandoFuncionario,
  middleSlot = null,
  filtersPanelSlot = null,
  hasActivePendencia = false,
  onSuporteClick = null,
  suporteBusy = false,
}) {
  const isMainChipActive = (targetTab) => !hasActivePendencia && tab === targetTab;
  const hintLoading = loading && !hasStoreChats;
  const totalForHint =
    activeFilterTotalCount != null && Number.isFinite(Number(activeFilterTotalCount))
      ? Number(activeFilterTotalCount)
      : null;
  const displayedTotalForHint = totalForHint != null ? Math.max(totalForHint, filteredCount) : null;
  const hintText = hintLoading
    ? "Carregando…"
    : listRefreshing
      ? "Atualizando…"
      : adminPorFuncionarioAtivo
        ? `${filteredCount} conversas`
        : displayedTotalForHint != null
          ? `${filteredCount} de ${displayedTotalForHint}`
          : `${filteredCount} conversas`;

  return (
    <div className="chat-list-toolbar">
      <div className="chat-list-search-wrap chat-list-toolbar-row--search">
        <div className="chat-list-search-row">
          <div className="chat-list-search-box">
            <Icon size={14}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path
                  d="M10.5 18a7.5 7.5 0 1 1 7.5-7.5A7.5 7.5 0 0 1 10.5 18Zm9 3-5.2-5.2"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </Icon>

            <ChatListSearchBox
              ref={searchRef}
              clearNonce={searchClearNonce}
              onDebounced={onSearchDebounced}
              placeholder="Buscar por nome ou telefone"
              className="chat-list-search-input"
            />
          </div>
          {isAppAdmin(user) ? (
            <AdminAtendenteFilter
              usuarios={atendentes}
              selectedUserId={adminAtendenteFilterId}
              open={adminAtendentePanelOpen}
              onOpenChange={onAdminPanelOpenChange}
              onBeforeOpen={onAdminBeforeOpen}
              onSelectUser={onAdminSelectUser}
              onClear={onAdminClear}
            />
          ) : null}
        </div>
      </div>

      <div className="chat-list-chips-wrap chat-list-chips-wrap--compact">
        <div className="chat-list-chips-scroll" role="presentation">
          <div
            className="chat-list-chips chat-list-chips--scroll"
            role="group"
            aria-label="Filtros de conversa"
          >
            {!user?.atendimento_modo_simples ? (
              <Chip variant="primary" active={isMainChipActive("minha_fila")} onClick={onTabMinhaFila} count={minhaFilaCount}>
                Minha fila
              </Chip>
            ) : null}
            <Chip active={isMainChipActive("todas")} onClick={onTabTodas} count={total}>
              Todas
            </Chip>
            {user?.atendimento_modo_simples ? (
              <>
                <Chip
                  variant="primary"
                  active={isMainChipActive("aguardando_atendente")}
                  onClick={onTabAguardandoAtendente}
                  className="chat-list-chip--aguardando-atendente"
                  count={countAguardandoAtendente}
                >
                  Aguardando atendente
                </Chip>
                <Chip
                  active={isMainChipActive("aguardando_cliente")}
                  onClick={onTabAguardandoCliente}
                  className="chat-list-chip--aguardando-cliente"
                  count={countAguardandoCliente}
                >
                  Aguardando cliente
                </Chip>
              </>
            ) : null}
            {!user?.atendimento_modo_simples ? (
              <>
                <Chip active={isMainChipActive("hoje")} onClick={onTabHoje} count={countHoje}>
                  Hoje
                </Chip>
                <Chip active={isMainChipActive("abertas")} onClick={onTabAbertas} count={countAbertas}>
                  Abertas
                </Chip>
                {separarMensagensDisparadasLigado ? (
                  <Chip active={isMainChipActive("mensagens_disparadas")} onClick={onTabMensagensDisparadas} count={mensagensDisparadasCount}>
                    Mensagens Disparadas
                  </Chip>
                ) : null}
                <Chip active={isMainChipActive("em_atendimento")} onClick={onTabEmAtendimento} count={countEmAtendimento}>
                  Em atendimento
                </Chip>
                <Chip active={isMainChipActive("finalizadas")} onClick={onTabFinalizadas} count={countFinalizadas}>
                  Finalizadas
                </Chip>
                <Chip active={isMainChipActive("finalizadas_auto")} onClick={onTabFinalizadasAuto} count={countFinalizadasAuto}>
                  Por ausência
                </Chip>
                <Chip active={isMainChipActive("aguardando_cliente")} onClick={onTabAguardandoCliente} count={countAguardandoCliente}>
                  Aguardando cliente
                </Chip>
                {isFinanceiroUser ? (
                  <>
                    <Chip
                      active={isMainChipActive("pagamentos_pendentes")}
                      onClick={onTabPagamentosPendentes}
                      className="chat-list-chip--pagamento-pendente"
                      count={countPagamentosPendentes}
                    >
                      Pagamentos pendentes
                    </Chip>
                    <Chip
                      active={isMainChipActive("em_atraso")}
                      onClick={onTabEmAtraso}
                      className="chat-list-chip--em-atraso"
                      count={countEmAtraso}
                    >
                      Em atraso
                    </Chip>
                  </>
                ) : null}
                {isSupervisorOrAdmin(user) ? (
                  <Chip
                    active={isMainChipActive("aguardando_funcionario")}
                    onClick={onTabAguardandoFuncionario}
                    className={`chat-list-chip--aguardando-funcionario is-${aguardandoFuncionarioVisualState}`}
                    count={countAguardandoFuncionario}
                  >
                    Aguardando atendente
                    {aguardandoFuncionarioVisualState === "critical" ? (
                      <span className="chat-list-chip-critical-dot" aria-hidden="true" />
                    ) : null}
                  </Chip>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </div>

      {typeof onSuporteClick === "function" ? (
        <div className="chat-list-toolbar-suporte-row">
          <button
            type="button"
            className="suporte-zaperp-btn"
            onClick={onSuporteClick}
            disabled={suporteBusy}
            aria-busy={suporteBusy || undefined}
            title="Abrir conversa com o Suporte ZapERP"
          >
            <IconHeadset size={16} stroke={1.75} className="suporte-zaperp-btn__icon" aria-hidden="true" />
            <span className="suporte-zaperp-btn__label">
              {suporteBusy ? "Abrindo…" : "Suporte ZapERP"}
            </span>
          </button>
        </div>
      ) : null}

      <div className="chat-list-toolbar-row--meta">
        {middleSlot ? <div className="chat-list-toolbar-meta-left">{middleSlot}</div> : null}
        <div className="chat-list-search-hint chat-list-toolbar-meta-count" aria-live="polite">
          <span>{hintText}</span>
        </div>
      </div>

      {filtersPanelSlot}
    </div>
  );
}

function toolbarPropsAreEqual(prev, next) {
  if (prev.tab !== next.tab) return false;
  if (prev.listRefreshing !== next.listRefreshing) return false;
  if (prev.loading !== next.loading) return false;
  if (prev.hasStoreChats !== next.hasStoreChats) return false;
  if (prev.filteredCount !== next.filteredCount) return false;
  if (prev.activeFilterTotalCount !== next.activeFilterTotalCount) return false;
  if (prev.adminPorFuncionarioAtivo !== next.adminPorFuncionarioAtivo) return false;
  if (prev.separarMensagensDisparadasLigado !== next.separarMensagensDisparadasLigado) return false;
  if (prev.minhaFilaCount !== next.minhaFilaCount) return false;
  if (prev.total !== next.total) return false;
  if (prev.countHoje !== next.countHoje) return false;
  if (prev.countAbertas !== next.countAbertas) return false;
  if (prev.countEmAtendimento !== next.countEmAtendimento) return false;
  if (prev.countFinalizadas !== next.countFinalizadas) return false;
  if (prev.countFinalizadasAuto !== next.countFinalizadasAuto) return false;
  if (prev.countAguardandoCliente !== next.countAguardandoCliente) return false;
  if (prev.countAguardandoAtendente !== next.countAguardandoAtendente) return false;
  if (prev.isFinanceiroUser !== next.isFinanceiroUser) return false;
  if (prev.countPagamentosPendentes !== next.countPagamentosPendentes) return false;
  if (prev.countEmAtraso !== next.countEmAtraso) return false;
  if (prev.countAguardandoFuncionario !== next.countAguardandoFuncionario) return false;
  if (prev.mensagensDisparadasCount !== next.mensagensDisparadasCount) return false;
  if (prev.aguardandoFuncionarioVisualState !== next.aguardandoFuncionarioVisualState) return false;
  if (prev.searchClearNonce !== next.searchClearNonce) return false;
  if (prev.adminAtendenteFilterId !== next.adminAtendenteFilterId) return false;
  if (prev.adminAtendentePanelOpen !== next.adminAtendentePanelOpen) return false;
  if (prev.user?.id !== next.user?.id) return false;
  if (prev.user?.role !== next.user?.role) return false;
  if (prev.user?.perfil !== next.user?.perfil) return false;
  if (prev.user?.atendimento_modo_simples !== next.user?.atendimento_modo_simples) return false;
  if (prev.atendentes !== next.atendentes) return false;
  if (prev.middleSlot !== next.middleSlot) return false;
  if (prev.filtersPanelSlot !== next.filtersPanelSlot) return false;
  if (prev.hasActivePendencia !== next.hasActivePendencia) return false;
  if (prev.onSuporteClick !== next.onSuporteClick) return false;
  if (prev.suporteBusy !== next.suporteBusy) return false;
  if (prev.searchRef !== next.searchRef) return false;
  if (prev.onSearchDebounced !== next.onSearchDebounced) return false;
  if (prev.onTabMinhaFila !== next.onTabMinhaFila) return false;
  if (prev.onTabTodas !== next.onTabTodas) return false;
  if (prev.onTabAguardandoAtendente !== next.onTabAguardandoAtendente) return false;
  if (prev.onTabHoje !== next.onTabHoje) return false;
  if (prev.onTabAbertas !== next.onTabAbertas) return false;
  if (prev.onTabMensagensDisparadas !== next.onTabMensagensDisparadas) return false;
  if (prev.onTabEmAtendimento !== next.onTabEmAtendimento) return false;
  if (prev.onTabFinalizadas !== next.onTabFinalizadas) return false;
  if (prev.onTabFinalizadasAuto !== next.onTabFinalizadasAuto) return false;
  if (prev.onTabAguardandoCliente !== next.onTabAguardandoCliente) return false;
  if (prev.onTabPagamentosPendentes !== next.onTabPagamentosPendentes) return false;
  if (prev.onTabEmAtraso !== next.onTabEmAtraso) return false;
  if (prev.onTabAguardandoFuncionario !== next.onTabAguardandoFuncionario) return false;
  if (prev.onAdminPanelOpenChange !== next.onAdminPanelOpenChange) return false;
  if (prev.onAdminSelectUser !== next.onAdminSelectUser) return false;
  if (prev.onAdminClear !== next.onAdminClear) return false;
  if (prev.onAdminBeforeOpen !== next.onAdminBeforeOpen) return false;
  return true;
}

export default memo(ChatListToolbar, toolbarPropsAreEqual);
