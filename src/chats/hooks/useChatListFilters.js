import { useMemo, useRef } from "react";
import { computeChatsFiltradosCached, buildChatListUiFilterDeps } from "../chatListFilters";

/**
 * Busca debounced, abas, filtros avançados e ordenação da lista de conversas.
 * UI permanece no ChatList; lógica concentrada aqui.
 */
export function useChatListFilters({
  chats,
  minhaFilaList,
  debouncedSearch,
  statusFilter,
  tagFilter,
  departamentoFilter,
  atendenteFilter,
  mineOnly,
  order,
  tab,
  user,
  adminAtendenteFilterId,
  onlyFinalizadasAusencia,
  aguardandoClienteOnly,
  pagamentosPendentesOnly,
  emAtrasoOnly,
  pendentesFuncionarioSet,
  conversaIdsPendenciaAtiva,
}) {
  const filterCacheRef = useRef(null);

  const uiFilterDeps = useMemo(
    () =>
      buildChatListUiFilterDeps({
        debouncedSearch,
        statusFilter,
        tagFilter,
        departamentoFilter,
        atendenteFilter,
        mineOnly,
        order,
        tab,
        user,
        adminAtendenteFilterId,
        onlyFinalizadasAusencia,
        aguardandoClienteOnly,
        pagamentosPendentesOnly,
        emAtrasoOnly,
      }),
    [
      debouncedSearch,
      statusFilter,
      tagFilter,
      departamentoFilter,
      atendenteFilter,
      mineOnly,
      order,
      tab,
      user?.id,
      user?.role,
      user?.perfil,
      adminAtendenteFilterId,
      onlyFinalizadasAusencia,
      aguardandoClienteOnly,
      pagamentosPendentesOnly,
      emAtrasoOnly,
    ]
  );

  const chatsFiltrados = useMemo(
    () =>
      computeChatsFiltradosCached(filterCacheRef, {
        chats,
        minhaFilaList,
        debouncedSearch: uiFilterDeps.debouncedSearch,
        statusFilter: uiFilterDeps.statusFilter,
        tagFilter: uiFilterDeps.tagFilter,
        departamentoFilter: uiFilterDeps.departamentoFilter,
        atendenteFilter: uiFilterDeps.atendenteFilter,
        mineOnly: uiFilterDeps.mineOnly,
        order: uiFilterDeps.order,
        tab: uiFilterDeps.tab,
        user,
        adminAtendenteFilterId: uiFilterDeps.adminAtendenteFilterId,
        onlyFinalizadasAusencia: uiFilterDeps.onlyFinalizadasAusencia,
        aguardandoClienteOnly: uiFilterDeps.aguardandoClienteOnly,
        pagamentosPendentesOnly: uiFilterDeps.pagamentosPendentesOnly,
        emAtrasoOnly: uiFilterDeps.emAtrasoOnly,
        pendentesFuncionarioSet,
        conversaIdsPendenciaAtiva,
      }),
    [chats, minhaFilaList, uiFilterDeps, user, pendentesFuncionarioSet, conversaIdsPendenciaAtiva]
  );

  return { chatsFiltrados };
}
