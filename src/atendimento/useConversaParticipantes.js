import { useCallback, useEffect, useRef, useState } from "react";
import { listarAtendentesConversa } from "../conversa/conversaService";
import { getSocket } from "../socket/socket";

/**
 * Carrega e mantém a lista de participantes de uma conversa.
 * Re-busca quando: conversaId muda, atendenteId muda (cobre o caso "Assumir"),
 * ou chega evento de socket de participação.
 */
export function useConversaParticipantes(conversaId, atendenteId = null) {
  const [participantes, setParticipantes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [carregado, setCarregado] = useState(false);
  const abortRef = useRef(null);

  const load = useCallback(async () => {
    if (!conversaId) {
      setParticipantes([]);
      setCarregado(false);
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    try {
      const rows = await listarAtendentesConversa(conversaId);
      if (!ctrl.signal.aborted) {
        setParticipantes(Array.isArray(rows) ? rows : []);
        setCarregado(true);
      }
    } catch (_) {
      if (!ctrl.signal.aborted) {
        setParticipantes([]);
        setCarregado(true);
      }
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, [conversaId]);

  // Re-carrega quando conversaId ou atendenteId mudam
  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load, atendenteId]);

  // Socket: re-carrega em eventos de participação
  useEffect(() => {
    if (!conversaId) return;
    const socket = getSocket();
    if (!socket) return;

    const handlers = {
      conversa_atendente_adicionado: (p) => {
        if (Number(p?.conversa_id) === Number(conversaId)) load();
      },
      conversa_atendente_removido: (p) => {
        if (Number(p?.conversa_id) === Number(conversaId)) load();
      },
      conversa_participantes_atualizados: (p) => {
        if (Number(p?.conversa_id) === Number(conversaId)) load();
      },
    };

    for (const [ev, fn] of Object.entries(handlers)) socket.on(ev, fn);
    return () => {
      for (const [ev, fn] of Object.entries(handlers)) socket.off(ev, fn);
    };
  }, [conversaId, load]);

  const principal = participantes.find((p) => p.tipo === "principal") ?? null;
  const coAtendentes = participantes.filter((p) => p.tipo === "participante");
  const total = participantes.length;

  return { participantes, principal, coAtendentes, total, loading, carregado, reload: load };
}
