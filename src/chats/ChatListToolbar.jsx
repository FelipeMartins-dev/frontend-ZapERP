import { memo } from "react";
import { isSupervisorOrAdmin } from "../auth/permissions";
import AdminAtendenteFilter from "./AdminAtendenteFilter";
import { ChatListSearchBox } from "./ChatListSearchBox";
import { Icon, Chip } from "./chatListUiPrimitives";

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
}) {
  const hintLoading = loading && !hasStoreChats;
  const hintText = hintLoading
    ? "Carregando…"
    : listRefreshing
      ? "Atualizando…"
      : adminPorFuncionarioAtivo
        ? `${filteredCount} conversas`
        : tab === "minha_fila"
          ? `${filteredCount} de ${minhaFilaCount}`
          : tab === "aguardando_cliente"
            ? `${filteredCount} de ${countAguardandoCliente}`
            : tab === "pagamentos_pendentes"
              ? `${filteredCount} de ${countPagamentosPendentes}`
              : tab === "em_atraso"
                ? `${filteredCount} de ${countEmAtraso}`
                : `${filteredCount} de ${total}`;

  return (
    <>
      <div className="chat-list-search-wrap">
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
        <div className="chat-list-search-hint">
          <span>{hintText}</span>
        </div>
      </div>

      <div className="chat-list-chips-wrap">
        <div className="chat-list-chips chat-list-chips--primary" role="group" aria-label="Filtro principal">
          <Chip variant="primary" active={tab === "minha_fila"} onClick={onTabMinhaFila}>
            <span>Minha fila</span>
            <span className="chat-list-chip-count">{minhaFilaCount}</span>
          </Chip>
        </div>
        <div className="chat-list-chips chat-list-chips--secondary" role="group" aria-label="Outros filtros de conversa">
          <Chip active={tab === "todas"} onClick={onTabTodas}>
            <span>Todas</span>
            <span className="chat-list-chip-count">{total}</span>
          </Chip>
          <Chip active={tab === "hoje"} onClick={onTabHoje}>
            <span>Hoje</span>
            <span className="chat-list-chip-count">{countHoje}</span>
          </Chip>
          <Chip active={tab === "abertas"} onClick={onTabAbertas}>
            <span>Abertas</span>
            <span className="chat-list-chip-count">{countAbertas}</span>
          </Chip>
          {separarMensagensDisparadasLigado ? (
            <Chip active={tab === "mensagens_disparadas"} onClick={onTabMensagensDisparadas}>
              <span>Mensagens Disparadas</span>
              <span className="chat-list-chip-count">{mensagensDisparadasCount}</span>
            </Chip>
          ) : null}
          <Chip active={tab === "em_atendimento"} onClick={onTabEmAtendimento}>
            <span>Em atendimento</span>
            <span className="chat-list-chip-count">{countEmAtendimento}</span>
          </Chip>
          <Chip active={tab === "finalizadas"} onClick={onTabFinalizadas}>
            <span>Finalizadas</span>
            <span className="chat-list-chip-count">{countFinalizadas}</span>
          </Chip>
          <Chip active={tab === "finalizadas_auto"} onClick={onTabFinalizadasAuto}>
            <span>Por ausência</span>
            <span className="chat-list-chip-count">{countFinalizadasAuto}</span>
          </Chip>
          <Chip active={tab === "aguardando_cliente"} onClick={onTabAguardandoCliente}>
            <span>Aguardando cliente</span>
            <span className="chat-list-chip-count">{countAguardandoCliente}</span>
          </Chip>
          {isFinanceiroUser ? (
            <>
              <Chip
                active={tab === "pagamentos_pendentes"}
                onClick={onTabPagamentosPendentes}
                className="chat-list-chip--pagamento-pendente"
              >
                <span>Pagamentos pendentes</span>
                <span className="chat-list-chip-count">{countPagamentosPendentes}</span>
              </Chip>
              <Chip
                active={tab === "em_atraso"}
                onClick={onTabEmAtraso}
                className="chat-list-chip--em-atraso"
              >
                <span>Em atraso</span>
                <span className="chat-list-chip-count">{countEmAtraso}</span>
              </Chip>
            </>
          ) : null}
          {isSupervisorOrAdmin(user) && (
            <Chip
              active={tab === "aguardando_funcionario"}
              onClick={onTabAguardandoFuncionario}
              className={`chat-list-chip--aguardando-funcionario is-${aguardandoFuncionarioVisualState}`}
            >
              <span>Aguardando funcionario</span>
              <span className="chat-list-chip-count zap-counter-target">{countAguardandoFuncionario}</span>
              {aguardandoFuncionarioVisualState === "critical" ? (
                <span className="chat-list-chip-critical-dot" aria-hidden="true" />
              ) : null}
            </Chip>
          )}
          {isAppAdmin(user) && (
            <AdminAtendenteFilter
              usuarios={atendentes}
              selectedUserId={adminAtendenteFilterId}
              open={adminAtendentePanelOpen}
              onOpenChange={onAdminPanelOpenChange}
              onBeforeOpen={onAdminBeforeOpen}
              onSelectUser={onAdminSelectUser}
              onClear={onAdminClear}
            />
          )}
        </div>
      </div>

      {middleSlot}
    </>
  );
}

function toolbarPropsAreEqual(prev, next) {
  if (prev.tab !== next.tab) return false;
  if (prev.listRefreshing !== next.listRefreshing) return false;
  if (prev.loading !== next.loading) return false;
  if (prev.hasStoreChats !== next.hasStoreChats) return false;
  if (prev.filteredCount !== next.filteredCount) return false;
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
  if (prev.atendentes !== next.atendentes) return false;
  if (prev.middleSlot !== next.middleSlot) return false;
  if (prev.searchRef !== next.searchRef) return false;
  if (prev.onSearchDebounced !== next.onSearchDebounced) return false;
  if (prev.onTabMinhaFila !== next.onTabMinhaFila) return false;
  if (prev.onTabTodas !== next.onTabTodas) return false;
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
