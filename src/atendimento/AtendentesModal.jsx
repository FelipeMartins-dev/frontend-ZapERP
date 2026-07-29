import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { IconCrown, IconSearch, IconUserMinus, IconUserPlus, IconUsers } from "@tabler/icons-react";
import {
  adicionarAtendenteConversa,
  listarAtendentesDisponiveisConversa,
  removerAtendenteConversa,
} from "../conversa/conversaService";

function safeStr(v) {
  return v == null ? "" : String(v);
}

function nomeDoParticipante(p) {
  return safeStr(p?.usuario?.nome).trim() || safeStr(p?.usuario?.email).trim() || `Usuário ${p?.usuario_id ?? ""}`;
}

function iniciais(nome) {
  const partes = safeStr(nome).trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return `${partes[0][0]}${partes[partes.length - 1][0]}`.toUpperCase();
}

/**
 * Modal de participantes do atendimento.
 *
 * Mostra o responsável principal (que só muda por transferência), os
 * co-atendentes, busca para adicionar e remoção. Toda regra é validada de novo
 * no backend — aqui as permissões só evitam oferecer uma ação que seria negada.
 */
export default function AtendentesModal({
  open,
  onClose,
  conversaId,
  principal,
  coAtendentes,
  loading,
  onReload,
  meuUserId,
  meuPerfil,
  conversaEncerrada = false,
  showToast,
}) {
  const [busca, setBusca] = useState("");
  const [disponiveis, setDisponiveis] = useState([]);
  const [disponiveisLoading, setDisponiveisLoading] = useState(false);
  const [disponiveisErro, setDisponiveisErro] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const role = safeStr(meuPerfil).toLowerCase();
  const souPrincipal = principal?.usuario_id != null && String(principal.usuario_id) === String(meuUserId);
  const souPrivilegiado = role === "admin" || role === "administrador" || role === "supervisor";

  /** Backend: admin/supervisor, o principal, ou o próprio participante saindo. */
  const podeRemover = useCallback(
    (participante) => {
      if (!participante?.usuario_id) return false;
      if (souPrivilegiado || souPrincipal) return true;
      return String(participante.usuario_id) === String(meuUserId);
    },
    [meuUserId, souPrincipal, souPrivilegiado]
  );

  /** Adicionar exige conversa aberta e responsável definido (mesma regra do backend). */
  const podeAdicionar = !conversaEncerrada && principal?.usuario_id != null;

  const carregarDisponiveis = useCallback(async () => {
    if (!conversaId) return;
    setDisponiveisLoading(true);
    setDisponiveisErro(null);
    try {
      const data = await listarAtendentesDisponiveisConversa(conversaId);
      setDisponiveis(Array.isArray(data) ? data : []);
    } catch (e) {
      setDisponiveis([]);
      setDisponiveisErro(e?.response?.data?.error || "Não foi possível carregar os atendentes.");
    } finally {
      setDisponiveisLoading(false);
    }
  }, [conversaId]);

  useEffect(() => {
    if (!open) {
      setBusca("");
      setDisponiveis([]);
      setDisponiveisErro(null);
      return;
    }
    if (podeAdicionar) carregarDisponiveis();
  }, [open, podeAdicionar, carregarDisponiveis]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape" && busyId == null) onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, busyId]);

  const disponiveisFiltrados = useMemo(() => {
    const termo = safeStr(busca).trim().toLowerCase();
    if (!termo) return disponiveis;
    return disponiveis.filter((u) =>
      `${safeStr(u.nome)} ${safeStr(u.email)} ${safeStr(u.perfil)}`.toLowerCase().includes(termo)
    );
  }, [busca, disponiveis]);

  const handleAdicionar = useCallback(
    async (usuarioId) => {
      const uid = Number(usuarioId);
      if (!Number.isFinite(uid) || uid <= 0 || busyId != null) return;
      setBusyId(uid);
      try {
        const res = await adicionarAtendenteConversa(conversaId, uid);
        setBusca("");
        await Promise.all([onReload?.(), carregarDisponiveis()]);
        showToast?.({
          type: "success",
          title: "Atendente adicionado",
          message: `${res?.usuario?.nome || "Atendente"} agora participa deste atendimento.`,
        });
      } catch (e) {
        showToast?.({
          type: "error",
          title: "Falha ao adicionar",
          message: e?.response?.data?.error || "Tente novamente.",
        });
      } finally {
        setBusyId(null);
      }
    },
    [busyId, carregarDisponiveis, conversaId, onReload, showToast]
  );

  const handleRemover = useCallback(
    async (participante) => {
      const uid = Number(participante?.usuario_id);
      if (!Number.isFinite(uid) || uid <= 0 || busyId != null) return;
      setBusyId(uid);
      try {
        await removerAtendenteConversa(conversaId, uid);
        await Promise.all([onReload?.(), podeAdicionar ? carregarDisponiveis() : Promise.resolve()]);
        showToast?.({
          type: "success",
          title: String(uid) === String(meuUserId) ? "Você saiu do atendimento" : "Atendente removido",
          message:
            String(uid) === String(meuUserId)
              ? "Você não recebe mais as atualizações desta conversa."
              : `${nomeDoParticipante(participante)} não participa mais deste atendimento.`,
        });
      } catch (e) {
        showToast?.({
          type: "error",
          title: "Falha ao remover",
          message: e?.response?.data?.error || "Tente novamente.",
        });
      } finally {
        setBusyId(null);
      }
    },
    [busyId, carregarDisponiveis, conversaId, meuUserId, onReload, podeAdicionar, showToast]
  );

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="wa-modalOverlay"
      role="dialog"
      aria-modal="true"
      aria-label="Atendentes da conversa"
      onMouseDown={() => {
        if (busyId == null) onClose?.();
      }}
    >
      <div className="wa-modal wa-atendentesModal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="wa-modal-head">
          <div className="wa-modal-title">
            <IconUsers size={18} strokeWidth={1.9} aria-hidden="true" />
            <span>Atendentes</span>
          </div>
          <button
            type="button"
            className="wa-header-btn"
            onClick={() => busyId == null && onClose?.()}
            aria-label="Fechar"
            title="Fechar"
            style={{ width: 34, height: 34 }}
          >
            ✕
          </button>
        </div>

        <div className="wa-modal-body wa-atendentesModal-body">
          {/* --- Responsável principal --- */}
          <div className="wa-atendentesSection">
            <div className="wa-atendentesSection-title">Responsável principal</div>
            {principal ? (
              <div className="wa-participante wa-participante--principal">
                <span className="wa-participante-avatar" aria-hidden="true">
                  {iniciais(nomeDoParticipante(principal))}
                </span>
                <div className="wa-participante-info">
                  <div className="wa-participante-nome">
                    {nomeDoParticipante(principal)}
                    {String(principal.usuario_id) === String(meuUserId) ? (
                      <span className="wa-participante-voce">você</span>
                    ) : null}
                  </div>
                  <div className="wa-participante-meta">
                    {safeStr(principal.usuario?.email) || safeStr(principal.usuario?.perfil) || "Atendente"}
                  </div>
                </div>
                <span className="wa-participante-badgePrincipal" title="Responsável principal do atendimento">
                  <IconCrown size={13} strokeWidth={2} aria-hidden="true" />
                  Principal
                </span>
              </div>
            ) : (
              <div className="wa-atendentesEmpty">
                Ninguém assumiu esta conversa ainda. Assuma ou transfira para definir o responsável.
              </div>
            )}
            <p className="wa-atendentesHint">
              O responsável principal só muda por <strong>Transferir</strong> — ele não pode ser removido aqui.
            </p>
          </div>

          {/* --- Co-atendentes --- */}
          <div className="wa-atendentesSection">
            <div className="wa-atendentesSection-title">
              Co-atendentes {coAtendentes.length > 0 ? `(${coAtendentes.length})` : ""}
            </div>
            {loading && coAtendentes.length === 0 ? (
              <div className="wa-atendentesEmpty">Carregando participantes…</div>
            ) : coAtendentes.length === 0 ? (
              <div className="wa-atendentesEmpty">
                Nenhum co-atendente. Adicione abaixo para que outra pessoa acompanhe e responda esta conversa.
              </div>
            ) : (
              <div className="wa-participanteList" role="list">
                {coAtendentes.map((p) => {
                  const uid = Number(p.usuario_id);
                  const souEu = String(uid) === String(meuUserId);
                  const removivel = podeRemover(p);
                  return (
                    <div className="wa-participante" key={uid} role="listitem">
                      <span className="wa-participante-avatar" aria-hidden="true">
                        {iniciais(nomeDoParticipante(p))}
                      </span>
                      <div className="wa-participante-info">
                        <div className="wa-participante-nome">
                          {nomeDoParticipante(p)}
                          {souEu ? <span className="wa-participante-voce">você</span> : null}
                        </div>
                        <div className="wa-participante-meta">
                          {safeStr(p.usuario?.email) || safeStr(p.usuario?.perfil) || "Atendente"}
                          {p.adicionado_por_usuario?.nome ? ` · adicionado por ${p.adicionado_por_usuario.nome}` : ""}
                        </div>
                      </div>
                      {removivel ? (
                        <button
                          type="button"
                          className="wa-participante-remover"
                          onClick={() => handleRemover(p)}
                          disabled={busyId != null}
                          title={souEu ? "Sair do atendimento" : "Remover do atendimento"}
                          aria-label={souEu ? "Sair do atendimento" : `Remover ${nomeDoParticipante(p)} do atendimento`}
                        >
                          <IconUserMinus size={15} strokeWidth={1.9} aria-hidden="true" />
                          <span>{busyId === uid ? "…" : souEu ? "Sair" : "Remover"}</span>
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* --- Adicionar --- */}
          <div className="wa-atendentesSection">
            <div className="wa-atendentesSection-title">Adicionar atendente</div>
            {!podeAdicionar ? (
              <div className="wa-atendentesEmpty">
                {conversaEncerrada
                  ? "Reabra o atendimento para adicionar participantes."
                  : "Assuma a conversa antes de adicionar outro atendente."}
              </div>
            ) : (
              <>
                <div className="wa-atendentesSearch">
                  <IconSearch size={15} strokeWidth={1.9} aria-hidden="true" />
                  <input
                    className="wa-transferSearch"
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Buscar por nome, e-mail ou perfil"
                    aria-label="Buscar atendente para adicionar"
                  />
                </div>
                {disponiveisErro ? (
                  <div className="wa-atendentesEmpty">{disponiveisErro}</div>
                ) : disponiveisLoading ? (
                  <div className="wa-atendentesEmpty">Carregando atendentes…</div>
                ) : disponiveisFiltrados.length === 0 ? (
                  <div className="wa-atendentesEmpty">
                    {busca ? "Nenhum atendente encontrado." : "Todos os atendentes já participam desta conversa."}
                  </div>
                ) : (
                  <div className="wa-participanteList" role="list">
                    {disponiveisFiltrados.map((u) => {
                      const uid = Number(u.usuario_id ?? u.id);
                      return (
                        <button
                          type="button"
                          key={uid}
                          className="wa-participante wa-participante--add"
                          onClick={() => handleAdicionar(uid)}
                          disabled={busyId != null}
                          role="listitem"
                          title={safeStr(u.email) || safeStr(u.nome)}
                        >
                          <span className="wa-participante-avatar" aria-hidden="true">
                            {iniciais(u.nome || u.email)}
                          </span>
                          <div className="wa-participante-info">
                            <div className="wa-participante-nome">{u.nome || u.email || "Atendente"}</div>
                            <div className="wa-participante-meta">{safeStr(u.email) || safeStr(u.perfil)}</div>
                          </div>
                          <span className="wa-participante-add" aria-hidden="true">
                            <IconUserPlus size={15} strokeWidth={1.9} />
                            <span>{busyId === uid ? "…" : "Adicionar"}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
