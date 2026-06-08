import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { shallow } from "zustand/shallow";
import { useChatStore } from "../chatsStore";
import {
  fetchMinhasPendenciasCategoria,
  fetchMinhasPendenciasResumo,
  PENDENCIA_CATEGORIAS,
} from "../minhasPendenciasService";

const EMPTY_RESUMO = {
  transferidosParaVoce: 0,
  aguardandoSuaResposta: 0,
  emAtraso: 0,
};

/**
 * Contadores e filtro clicável de pendências — confia 100% no backend.
 */
export function useMinhasPendencias(scopeKey) {
  const [minhasPendencias, setMinhasPendencias] = useState(EMPTY_RESUMO);
  const [pendenciaAtiva, setPendenciaAtiva] = useState(null);
  const [conversaIdsRaw, setConversaIdsRaw] = useState([]);
  const [loadingPendencias, setLoadingPendencias] = useState(false);
  const [loadingPendenciaCategoria, setLoadingPendenciaCategoria] = useState(false);

  const pendenciaAtivaRef = useRef(pendenciaAtiva);
  pendenciaAtivaRef.current = pendenciaAtiva;
  const categoriaRequestIdRef = useRef(0);

  const chatListResyncNonce = useChatStore((s) => s.chatListResyncNonce ?? 0, shallow);

  const conversaIdsPendenciaAtiva = useMemo(() => {
    if (!pendenciaAtiva) return null;
    return new Set(conversaIdsRaw.map(String));
  }, [pendenciaAtiva, conversaIdsRaw]);

  const refreshContadores = useCallback(async () => {
    setLoadingPendencias(true);
    try {
      const resumo = await fetchMinhasPendenciasResumo();
      setMinhasPendencias(resumo);
    } catch {
      /* mantém último valor — não zera contadores em falha transitória */
    } finally {
      setLoadingPendencias(false);
    }
  }, []);

  const refreshCategoria = useCallback(async (categoria) => {
    if (!categoria) return;
    const requestId = ++categoriaRequestIdRef.current;
    setLoadingPendenciaCategoria(true);
    try {
      const detalhe = await fetchMinhasPendenciasCategoria(categoria);
      if (requestId !== categoriaRequestIdRef.current) return;
      setConversaIdsRaw(detalhe.conversa_ids);
    } catch {
      if (requestId !== categoriaRequestIdRef.current) return;
      setConversaIdsRaw([]);
    } finally {
      if (requestId === categoriaRequestIdRef.current) setLoadingPendenciaCategoria(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    await refreshContadores();
    const ativa = pendenciaAtivaRef.current;
    if (ativa) {
      await refreshCategoria(ativa);
    }
  }, [refreshContadores, refreshCategoria]);

  const onPendenciaClick = useCallback(
    async (categoria) => {
      if (!PENDENCIA_CATEGORIAS[categoria]) return;

      if (pendenciaAtivaRef.current === categoria) {
        categoriaRequestIdRef.current += 1;
        setPendenciaAtiva(null);
        setConversaIdsRaw([]);
        return;
      }

      setPendenciaAtiva(categoria);
      setConversaIdsRaw([]);
      setLoadingPendenciaCategoria(true);
      const requestId = ++categoriaRequestIdRef.current;
      try {
        const detalhe = await fetchMinhasPendenciasCategoria(categoria);
        if (requestId !== categoriaRequestIdRef.current) return;
        setConversaIdsRaw(detalhe.conversa_ids);
      } catch {
        if (requestId !== categoriaRequestIdRef.current) return;
        setConversaIdsRaw([]);
      } finally {
        if (requestId === categoriaRequestIdRef.current) setLoadingPendenciaCategoria(false);
      }
    },
    []
  );

  const clearPendenciaAtiva = useCallback(() => {
    categoriaRequestIdRef.current += 1;
    setPendenciaAtiva(null);
    setConversaIdsRaw([]);
    setLoadingPendenciaCategoria(false);
  }, []);

  useEffect(() => {
    if (!scopeKey) return;
    categoriaRequestIdRef.current += 1;
    setPendenciaAtiva(null);
    setConversaIdsRaw([]);
    setMinhasPendencias(EMPTY_RESUMO);
    void refreshContadores();
  }, [scopeKey, refreshContadores]);

  useEffect(() => {
    if (!chatListResyncNonce) return;
    void refresh();
  }, [chatListResyncNonce, refresh]);

  return {
    minhasPendencias,
    pendenciaAtiva,
    loadingPendencias,
    loadingPendenciaCategoria,
    conversaIdsPendenciaAtiva,
    onPendenciaClick,
    clearPendenciaAtiva,
    refresh,
  };
}
