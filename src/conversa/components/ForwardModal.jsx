import { createPortal } from "react-dom";
import { FORWARD_DEST_MAX } from "../conversaConstants";
import { safeString } from "../utils/conversaViewHelpers";
import { IconClose } from "../conversaViewIcons";
import {
  IconArrowForwardUp,
  IconMessage2,
  IconSearch,
  IconUser,
  IconUsers,
} from "@tabler/icons-react";

const AVATAR_PALETTES = [
  { bg: "rgba(136,99,207,0.18)", color: "#8863cf" },
  { bg: "rgba(47,158,226,0.18)", color: "#2f9ee2" },
  { bg: "rgba(0,168,132,0.18)", color: "#00a884" },
  { bg: "rgba(226,68,92,0.15)", color: "#e2445c" },
  { bg: "rgba(214,152,62,0.18)", color: "#d6983e" },
  { bg: "rgba(77,178,201,0.18)", color: "#4db2c9" },
];

function getAvatar(name) {
  const s = String(name || "").trim();
  const parts = s.split(/\s+/);
  const initials =
    parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : (s.slice(0, 2) || "?").toUpperCase();
  const palette = AVATAR_PALETTES[(s.charCodeAt(0) || 0) % AVATAR_PALETTES.length];
  return { initials, ...palette };
}

function Avatar({ name, size = 36 }) {
  const { initials, bg, color } = getAvatar(name);
  return (
    <span
      className="wa-forwardAvatar"
      style={{ width: size, height: size, minWidth: size, background: bg, color }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

/**
 * Modal de encaminhamento de mensagens. Estado e regras de envio permanecem no pai.
 */
export default function ForwardModal({
  open,
  forwardMsgs,
  forwardPreviewLabel,
  forwardQuery,
  onForwardQueryChange,
  forwardSending,
  forwardSelectedConversaIds,
  forwardMax10Msg,
  forwardMultiProgress,
  forwardColaboradoresLoading,
  forwardColaboradoresFiltered,
  forwardCandidates,
  forwardClientesLoading,
  forwardClientes,
  onClose,
  onConfirmForwardToColaborador,
  onToggleForwardConversaSelect,
  onConfirmForwardTo,
  onConfirmForwardToCliente,
  onConfirmForwardToMany,
}) {
  if (!open || !forwardMsgs?.length) return null;

  const selCount = forwardSelectedConversaIds.length;

  return createPortal(
    <div
      className="wa-modalOverlay wa-forwardOverlay"
      role="dialog"
      aria-label="Encaminhar mensagens"
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return;
        onClose?.();
      }}
    >
      <div className="wa-modal wa-forwardModal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="wa-forwardSheetHandle" aria-hidden="true" />

        {/* Header */}
        <div className="wa-modal-head">
          <div className="wa-forwardHeadLeft">
            <div className="wa-modal-title">Encaminhar</div>
            <div className="wa-forwardHeadCounter" aria-live="polite">
              {selCount > 0
                ? `${selCount} selecionada(s) · até ${FORWARD_DEST_MAX} destinos`
                : `Selecione até ${FORWARD_DEST_MAX} destinos`}
            </div>
          </div>
          <button type="button" className="wa-iconBtn" onClick={onClose} title="Fechar">
            <IconClose />
          </button>
        </div>

        <div className="wa-modal-body wa-forwardBody">
          {/* Preview da mensagem */}
          <div className="wa-forwardPreviewChip">
            <IconArrowForwardUp size={13} strokeWidth={2.2} aria-hidden="true" />
            <span>{forwardPreviewLabel}</span>
          </div>

          {/* Dica compacta */}
          <p className="wa-forwardTip">
            Toque em <strong>Apenas esta</strong> para envio direto, ou marque conversas e clique em{" "}
            <strong>Encaminhar selecionados</strong>.
          </p>

          {/* Busca */}
          <div className="wa-forwardSearchWrap">
            <IconSearch
              size={15}
              strokeWidth={1.8}
              className="wa-forwardSearchIcon"
              aria-hidden="true"
            />
            <input
              className="wa-input wa-forwardSearch"
              value={forwardQuery}
              onChange={(e) => onForwardQueryChange?.(e.target.value)}
              placeholder="Buscar por nome ou telefone..."
              aria-label="Buscar contato"
              autoFocus
            />
          </div>

          {/* Colaboradores */}
          <div className="wa-forwardSection">
            <div className="wa-forwardSectionTitle">
              <IconUsers size={12} strokeWidth={2} aria-hidden="true" />
              Colaboradores
            </div>
            {forwardColaboradoresLoading ? (
              <div className="wa-muted wa-forwardEmpty">Carregando…</div>
            ) : forwardColaboradoresFiltered.length === 0 ? (
              <div className="wa-muted wa-forwardEmpty">Nenhum colaborador disponível.</div>
            ) : (
              <div className="wa-forwardList">
                {forwardColaboradoresFiltered.map((colab) => {
                  const uid = colab?.id ?? colab?.user_id ?? colab?.usuario_id;
                  const nome =
                    safeString(colab?.nome ?? colab?.name ?? colab?.full_name) || "Colaborador";
                  const email = safeString(colab?.email);
                  return (
                    <button
                      key={`colab-${uid != null ? String(uid) : nome}`}
                      type="button"
                      className="wa-forwardItem"
                      onClick={() => onConfirmForwardToColaborador?.(colab)}
                      title={`Encaminhar para ${nome} (chat interno)`}
                      disabled={forwardSending || uid == null}
                    >
                      <Avatar name={nome} />
                      <div className="wa-forwardItem-info">
                        <div className="wa-forwardItem-name">{nome}</div>
                        {email ? <div className="wa-forwardItem-sub">{email}</div> : null}
                        <span className="wa-forwardBadge wa-forwardBadge--internal">
                          Chat interno
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Conversas */}
          <div className="wa-forwardSection">
            <div className="wa-forwardSectionHead">
              <div className="wa-forwardSectionTitle">
                <IconMessage2 size={12} strokeWidth={2} aria-hidden="true" />
                Conversas
              </div>
              <span className="wa-forwardSectionCap">máx. {FORWARD_DEST_MAX}</span>
            </div>
            {forwardMax10Msg ? (
              <p className="wa-forwardMaxHint" role="status" aria-live="polite">
                {forwardMax10Msg}
              </p>
            ) : null}
            {forwardCandidates.length === 0 ? (
              <div className="wa-muted wa-forwardEmpty">
                {forwardQuery.trim() ? "Nenhuma conversa encontrada." : "Carregando conversas…"}
              </div>
            ) : (
              <div className="wa-forwardList">
                {forwardCandidates.map((c) => {
                  const n =
                    safeString(
                      c?.contato_nome || c?.nome || c?.cliente?.nome || c?.telefone
                    ) || "Conversa";
                  const telLinha = safeString(
                    c?.telefone_exibivel ?? c?.telefoneExibivel ?? c?.telefone
                  );
                  const atNome = safeString(c?.atendente_nome ?? c?.atendenteNome).trim();
                  const atMail = safeString(c?.atendente_email ?? c?.atendenteEmail).trim();
                  const atendenteTitle = [atNome ? `Atendente: ${atNome}` : "", atMail]
                    .filter(Boolean)
                    .join(" · ");
                  const idStr = String(c.id);
                  const sel = forwardSelectedConversaIds.includes(idStr);
                  return (
                    <div
                      key={`conv-${c.id}`}
                      className={`wa-forwardItem wa-forwardItem--row ${sel ? "isSelected" : ""}`}
                    >
                      <label className="wa-forwardItem-checkLabel">
                        <input
                          type="checkbox"
                          className="wa-forwardItem-check"
                          checked={sel}
                          onChange={() => onToggleForwardConversaSelect?.(c.id)}
                          disabled={forwardSending}
                          aria-label={`Incluir conversa: ${n}`}
                        />
                      </label>
                      <button
                        type="button"
                        className="wa-forwardItem-main"
                        onClick={() => !forwardSending && onToggleForwardConversaSelect?.(c.id)}
                        disabled={forwardSending}
                      >
                        <Avatar name={n} size={34} />
                        <div className="wa-forwardItem-info">
                          <div className="wa-forwardItem-name">{n}</div>
                          {telLinha ? (
                            <div className="wa-forwardItem-sub">{telLinha}</div>
                          ) : null}
                          {atNome ? (
                            <div
                              className="wa-forwardItem-atendente"
                              title={atendenteTitle || undefined}
                            >
                              {atNome}
                            </div>
                          ) : (
                            <div className="wa-forwardItem-atendente wa-forwardItem-atendente--empty">
                              Sem atendente
                            </div>
                          )}
                        </div>
                      </button>
                      <button
                        type="button"
                        className="wa-forwardItem-solo"
                        onClick={() => onConfirmForwardTo?.(c.id)}
                        disabled={forwardSending}
                        title="Encaminhar somente para esta conversa"
                      >
                        Apenas esta
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Clientes */}
          <div className="wa-forwardSection">
            <div className="wa-forwardSectionTitle">
              <IconUser size={12} strokeWidth={2} aria-hidden="true" />
              Clientes
            </div>
            {forwardClientesLoading ? (
              <div className="wa-muted wa-forwardEmpty">Buscando…</div>
            ) : forwardClientes.length === 0 ? (
              <div className="wa-muted wa-forwardEmpty">
                {safeString(forwardQuery).trim().length >= 2
                  ? "Nenhum cliente encontrado."
                  : "Digite pelo menos 2 caracteres para buscar."}
              </div>
            ) : (
              <div className="wa-forwardList">
                {forwardClientes.slice(0, 60).map((c) => {
                  const n = safeString(c?.nome || c?.telefone) || "Cliente";
                  return (
                    <button
                      key={`cli-${c.id}`}
                      type="button"
                      className="wa-forwardItem"
                      onClick={() => onConfirmForwardToCliente?.(c)}
                      title={`Encaminhar para ${n}`}
                      disabled={forwardSending}
                    >
                      <Avatar name={n} />
                      <div className="wa-forwardItem-info">
                        <div className="wa-forwardItem-name">{n}</div>
                        {c?.telefone ? (
                          <div className="wa-forwardItem-sub">{String(c.telefone)}</div>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="wa-forwardFooter">
          <button type="button" className="wa-btn wa-btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="wa-btn wa-btn-primary"
            onClick={onConfirmForwardToMany}
            disabled={selCount < 1}
          >
            {selCount > 0 ? `Encaminhar (${selCount})` : "Encaminhar selecionados"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
