import { useCallback, useEffect, useRef, useState } from "react";
import { listarAtendentesConversa } from "../conversa/conversaService";
import { getSocket } from "../socket/socket";

/**
 * Participantes do atendimento (principal + co-atendentes) da conversa aberta.
 *
 * O backend já é a fonte da verdade: `GET /chats/:id/atendentes` devolve o
 * principal (conversas.atendente_id) seguido dos co-atendentes ativos, e só
 * responde para quem tem acesso à conversa.
 *
 * Realtime: o backend emite `conversa_atendente_adicionado` /
 * `conversa_atendente_removido` / `conversa_participantes_atualizados`.
 * Aqui apenas recarregamos a lista — nunca montamos participante no cliente,
 * para não divergir das regras de permissão do servidor.
 */
export function useConversaParticipantes(conversaId, atendenteId = null) {
  const [participantes, setParticipantes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [carregado, setCarregado] = useState(false);
  /** Conversa da requisição em voo: descarta resposta que chegou depois da troca de conversa. */
  const requestConversaRef = useRef(null);

  const reload = useCallback(async () => {
    const alvo = conversaId;
    if (!alvo) {
      setParticipantes([]);
      setCarregado(false);
      return [];
    }
    requestConversaRef.current = alvo;
    setLoading(true);
    try {
      const data = await listarAtendentesConversa(alvo);
      if (String(requestConversaRef.current) !== String(alvo)) return [];
      const lista = Array.isArray(data) ? data : [];
      setParticipantes(lista);
      setCarregado(true);
      return lista;
    } catch {
      if (String(requestConversaRef.current) === String(alvo)) {
        // Sem lista não escondemos o botão: ele abre o modal, que mostra o erro.
        setParticipantes([]);
        setCarregado(false);
      }
      return [];
    } finally {
      if (String(requestConversaRef.current) === String(alvo)) setLoading(false);
    }
  }, [conversaId]);

  useEffect(() => {
    if (!conversaId) {
      setParticipantes([]);
      setCarregado(false);
      return undefined;
    }
    let ativo = true;
    // `atendenteId` entra nas dependências de propósito: assumir e transferir trocam o
    // responsável principal SEM emitir evento de participante, então só o socket não
    // bastaria — o modal continuaria dizendo "assuma a conversa" logo após assumir.
    reload();

    const socket = getSocket();
    if (!socket) return () => { ativo = false; };

    const onMudanca = (payload) => {
      if (!ativo) return;
      if (payload?.conversa_id != null && String(payload.conversa_id) !== String(conversaId)) return;
      reload();
    };

    socket.on("conversa_atendente_adicionado", onMudanca);
    socket.on("conversa_atendente_removido", onMudanca);
    socket.on("conversa_participantes_atualizados", onMudanca);

    return () => {
      ativo = false;
      socket.off("conversa_atendente_adicionado", onMudanca);
      socket.off("conversa_atendente_removido", onMudanca);
      socket.off("conversa_participantes_atualizados", onMudanca);
    };
  }, [conversaId, atendenteId, reload]);

  const principal = participantes.find((p) => p?.tipo === "principal") || null;
  const coAtendentes = participantes.filter((p) => p?.tipo !== "principal");

  return {
    participantes,
    principal,
    coAtendentes,
    total: participantes.length,
    loading,
    carregado,
    reload,
  };
}
