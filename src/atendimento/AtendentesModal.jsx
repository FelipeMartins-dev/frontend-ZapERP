import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  listarAtendentesDisponiveisConversa,
  adicionarAtendenteConversa,
  removerAtendenteConversa,
} from "../conversa/conversaService";

function initials(nome) {
  if (!nome) return "?";
  const parts = String(nome).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function ParticipanteRow({ p, onRemove, removendo }) {
  const isPrincipal = p.tipo === "principal";
  const nome = p.usuario?.nome || `Usuário ${p.usuario_id}`;
  const perfil = p.usuario?.perfil || "";

  return (
    <div className={`wa-participante${isPrincipal ? " wa-participante--principal" : ""}`}>
      <div className="wa-participante-avatar">{initials(nome)}</div>
      <div className="wa-participante-info">
        <div className="wa-participante-nome">
          {nome}
          {isPrincipal && (
            <span className="wa-participante-crown" title="Responsável principal" aria-label="Responsável principal">
              👑
            </span>
          )}
        </div>
        <div className="wa-participante-role">
          {isPrincipal ? "Responsável" : perfil || "Co-atendente"}
        </div>
      </div>
      {!isPrincipal && (
        <button
          type="button"
          className="wa-participante-remove"
          onClick={() => onRemove(p.usuario_id)}
          disabled={removendo === p.usuario_id}
          title={`Remover ${nome} do atendimento`}
        >
          {removendo === p.usuario_id ? "…" : "✕"}
        </button>
      )}
    </div>
  );
}

export default function AtendentesModal({ conversaId, participantes, podeAdicionar = true, onClose, onParticipanteChange }) {
  const [disponiveis, setDisponiveis] = useState([]);
  const [loadingDisponiveis, setLoadingDisponiveis] = useState(false);
  const [busca, setBusca] = useState("");
  const [adicionando, setAdicionando] = useState(null);
  const [removendo, setRemovendo] = useState(null);
  const [erro, setErro] = useState("");

  const principal = participantes.find((p) => p.tipo === "principal") ?? null;
  const coAtendentes = participantes.filter((p) => p.tipo === "participante");

  const participantesIds = useMemo(
    () => new Set(participantes.map((p) => Number(p.usuario_id))),
    [participantes]
  );

  const carregarDisponiveis = useCallback(async () => {
    if (!conversaId) return;
    setLoadingDisponiveis(true);
    try {
      const rows = await listarAtendentesDisponiveisConversa(conversaId);
      setDisponiveis(Array.isArray(rows) ? rows : []);
    } catch (_) {
      setDisponiveis([]);
    } finally {
      setLoadingDisponiveis(false);
    }
  }, [conversaId]);

  useEffect(() => {
    carregarDisponiveis();
  }, [carregarDisponiveis]);

  // Fecha com ESC
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const disponiveisFiltrados = useMemo(() => {
    const q = busca.toLowerCase().trim();
    return disponiveis.filter((u) => {
      if (participantesIds.has(Number(u.id))) return false;
      if (!q) return true;
      return (u.nome || "").toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q);
    });
  }, [disponiveis, participantesIds, busca]);

  const handleAdicionar = async (uid) => {
    setErro("");
    setAdicionando(uid);
    try {
      await adicionarAtendenteConversa(conversaId, uid);
      onParticipanteChange();
      await carregarDisponiveis();
    } catch (e) {
      setErro(e?.response?.data?.error || e?.message || "Erro ao adicionar atendente");
    } finally {
      setAdicionando(null);
    }
  };

  const handleRemover = async (uid) => {
    setErro("");
    setRemovendo(uid);
    try {
      await removerAtendenteConversa(conversaId, uid);
      onParticipanteChange();
      await carregarDisponiveis();
    } catch (e) {
      setErro(e?.response?.data?.error || e?.message || "Erro ao remover atendente");
    } finally {
      setRemovendo(null);
    }
  };

  const modal = (
    <div className="wa-atendentesModal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="wa-atendentesModal" role="dialog" aria-modal="true" aria-label="Atendentes da conversa">
        {/* Header */}
        <div className="wa-atendentesModal-header">
          <h2 className="wa-atendentesModal-title">Atendentes</h2>
          <button type="button" className="wa-atendentesModal-close" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="wa-atendentesModal-body">
          {/* Responsável principal */}
          <div className="wa-atendentesSection">
            <div className="wa-atendentesSection-label">Responsável</div>
            {principal ? (
              <ParticipanteRow p={principal} onRemove={() => {}} removendo={null} />
            ) : (
              <div className="wa-atendentes-empty">Nenhum responsável ainda</div>
            )}
          </div>

          {/* Co-atendentes */}
          <div className="wa-atendentesSection">
            <div className="wa-atendentesSection-label">
              Co-atendentes {coAtendentes.length > 0 ? `· ${coAtendentes.length}` : ""}
            </div>
            {coAtendentes.length === 0 ? (
              <div className="wa-atendentes-empty">Nenhum co-atendente</div>
            ) : (
              coAtendentes.map((p) => (
                <ParticipanteRow
                  key={p.id ?? p.usuario_id}
                  p={p}
                  onRemove={handleRemover}
                  removendo={removendo}
                />
              ))
            )}
          </div>

          {/* Erro global */}
          {erro ? (
            <div style={{ color: "#ef4444", fontSize: 13, marginBottom: 8 }}>{erro}</div>
          ) : null}

          {/* Adicionar co-atendente */}
          {podeAdicionar ? (
            <div className="wa-atendentes-addSection">
              <div className="wa-atendentesSection-label">Adicionar co-atendente</div>
              <div className="wa-atendentes-searchWrap">
                <input
                  type="search"
                  className="wa-atendentes-searchInput"
                  placeholder="Buscar pelo nome do atendente…"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  autoComplete="off"
                  autoFocus
                />
              </div>
              {loadingDisponiveis ? (
                <div className="wa-atendentes-loadingList">Carregando…</div>
              ) : disponiveisFiltrados.length === 0 ? (
                <div className="wa-atendentes-noResults">
                  {busca ? "Nenhum resultado para a busca" : "Todos os atendentes já participam"}
                </div>
              ) : (
                disponiveisFiltrados.map((u) => (
                  <div key={u.id} className="wa-atendentes-disponivel">
                    <div className="wa-participante-avatar" style={{ width: 32, height: 32, fontSize: 12 }}>
                      {initials(u.nome)}
                    </div>
                    <div className="wa-atendentes-disponivel-info">
                      <span className="wa-atendentes-disponivel-nome">{u.nome || u.email}</span>
                      {u.perfil && <span className="wa-atendentes-disponivel-perfil">{u.perfil}</span>}
                    </div>
                    <button
                      type="button"
                      className="wa-atendentes-adicionarBtn"
                      onClick={() => handleAdicionar(u.id)}
                      disabled={adicionando === u.id}
                    >
                      {adicionando === u.id ? "Adicionando…" : "Adicionar"}
                    </button>
                  </div>
                ))
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
