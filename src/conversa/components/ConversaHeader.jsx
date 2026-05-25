import { memo } from "react";
import AtendimentoActions from "../../atendimento/AtendimentoActions";
import SendToCrmChatButton, { IconFunnelSend } from "../SendToCrmChatButton";
import { safeString } from "../utils/conversaViewHelpers";
import { IconClock, IconMore, IconTag, IconContact } from "../conversaViewIcons";

/**
 * Cabeçalho da conversa (avatar, meta, ações). Lógica e estados permanecem no ConversaView.
 */
function ConversaHeader({
  headerRef,
  onBack,
  isGroup,
  headerCompact,
  headerCrmAtivoLayout,
  nome,
  avatar,
  avatarUrl,
  showAvatarImg,
  onAvatarError,
  onAvatarClick,
  badge,
  showPagamentoConcluidoBadge = false,
  encerramentoAusenciaHint,
  headerSetorBelowStatus,
  setorAtual,
  podeTransferirSetor,
  onOpenTransferirSetor,
  isSomeoneTyping,
  podeGerenciarTags,
  tagsOpen,
  onToggleTagPanel,
  conversaId,
  showTimeline,
  onToggleTimeline,
  mostrarEnviarCrm,
  sendCrmRef,
  canConsultarProdutos,
  showProdutosPanel,
  onOpenProdutosPanel,
  onOpenClienteSide,
}) {
  return (
    <div
      ref={headerRef}
      className={`wa-header ${isGroup ? "wa-header--group" : ""} ${headerCompact && !isGroup ? "wa-header--atendMobile" : ""} ${headerCompact && !isGroup && headerCrmAtivoLayout ? "wa-header--crmAtivo" : ""}`}
    >
      <button
        type="button"
        className="wa-header-back"
        onClick={onBack}
        aria-label="Voltar para lista de conversas"
        title="Voltar"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5" />
          <polyline points="12 19 5 12 12 5" />
        </svg>
      </button>
      <div className="wa-header-left">
        <div className="wa-avatarWrap">
          <button
            type="button"
            className="wa-avatarButton"
            onClick={onAvatarClick}
            disabled={!showAvatarImg}
            title={showAvatarImg ? "Ver foto ampliada" : undefined}
            aria-label={showAvatarImg ? `Ver foto ampliada de ${safeString(nome) || "contato"}` : undefined}
          >
            <div className="wa-avatar" aria-hidden="true">
              {showAvatarImg ? (
                <img
                  src={avatarUrl}
                  alt=""
                  className="wa-avatar-img"
                  referrerPolicy="no-referrer"
                  onError={onAvatarError}
                />
              ) : (
                avatar
              )}
            </div>
          </button>
        </div>
        <div className="wa-header-info">
          <div className="wa-header-titleBlock">
            <div className="wa-header-titleRow">
              <span className="wa-header-name" title={nome}>
                {nome}
              </span>
            </div>
            <div className="wa-header-metaBlock">
              <div className="wa-header-metaStrip" aria-label="Status da conversa">
                {badge || showPagamentoConcluidoBadge ? (
                  <span className="wa-header-statusStack">
                    {badge ? (
                      <span
                        className="wa-status-pill wa-status-pill--meta"
                        style={{
                          background: badge.bg,
                          borderColor: badge.border,
                          color: badge.color,
                        }}
                        title={encerramentoAusenciaHint || badge.text}
                      >
                        {badge.text}
                      </span>
                    ) : null}
                    {showPagamentoConcluidoBadge ? (
                      <span
                        className="wa-status-pill wa-status-pill--pagamento-concluido-sub"
                        title="Pagamento confirmado neste atendimento"
                      >
                        Pagamento concluído
                      </span>
                    ) : null}
                  </span>
                ) : null}
                {!headerSetorBelowStatus &&
                  !isGroup &&
                  (setorAtual ? (
                    <>
                      {badge || showPagamentoConcluidoBadge ? (
                        <span className="wa-header-metaSep" aria-hidden="true" />
                      ) : null}
                      <span className="wa-header-metaItem" title={setorAtual}>
                        Setor: {setorAtual}
                      </span>
                      {podeTransferirSetor ? (
                        <button
                          type="button"
                          className="wa-header-setorBtn"
                          onClick={onOpenTransferirSetor}
                          title="Transferir para outro setor"
                        >
                          <span className="wa-setorBtn-label wa-setorBtn-label--full">Transferir setor</span>
                          <span className="wa-setorBtn-label wa-setorBtn-label--short">Trocar</span>
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <>
                      {badge || showPagamentoConcluidoBadge ? (
                        <span className="wa-header-metaSep" aria-hidden="true" />
                      ) : null}
                      <span className="wa-header-metaItem wa-muted">Sem setor</span>
                      {podeTransferirSetor ? (
                        <button
                          type="button"
                          className="wa-header-setorBtn"
                          onClick={onOpenTransferirSetor}
                          title="Definir setor"
                        >
                          <span className="wa-setorBtn-label wa-setorBtn-label--full">Definir setor</span>
                          <span className="wa-setorBtn-label wa-setorBtn-label--short">Setor</span>
                        </button>
                      ) : null}
                    </>
                  ))}
                {isGroup ? (
                  <>
                    {badge ? <span className="wa-header-metaSep" aria-hidden="true" /> : null}
                    <span className="wa-header-metaItem wa-muted">Grupo</span>
                  </>
                ) : null}
              </div>
              {headerSetorBelowStatus && !isGroup ? (
                <div className="wa-header-setorRow" aria-label="Setor da conversa">
                  {setorAtual ? (
                    <>
                      <span className="wa-header-metaItem" title={setorAtual}>
                        Setor: {setorAtual}
                      </span>
                      {podeTransferirSetor ? (
                        <button
                          type="button"
                          className="wa-header-setorBtn"
                          onClick={onOpenTransferirSetor}
                          title="Transferir para outro setor"
                        >
                          <span className="wa-setorBtn-label wa-setorBtn-label--full">Transferir setor</span>
                          <span className="wa-setorBtn-label wa-setorBtn-label--short">Trocar</span>
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <span className="wa-header-metaItem wa-muted">Sem setor</span>
                      {podeTransferirSetor ? (
                        <button
                          type="button"
                          className="wa-header-setorBtn"
                          onClick={onOpenTransferirSetor}
                          title="Definir setor"
                        >
                          <span className="wa-setorBtn-label wa-setorBtn-label--full">Definir setor</span>
                          <span className="wa-setorBtn-label wa-setorBtn-label--short">Setor</span>
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}
            </div>
          </div>
          {isSomeoneTyping ? (
            <div className="wa-header-typingRow">
              <span className="wa-typing-dots">
                digitando
                <span className="wa-typing-dots-inner">
                  <span className="wa-typing-dot">.</span>
                  <span className="wa-typing-dot">.</span>
                  <span className="wa-typing-dot">.</span>
                </span>
              </span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="wa-header-right">
        <div className="wa-header-innerRow">
          <div className="wa-header-iconsLine">
            {!headerCompact && !isGroup && podeGerenciarTags ? (
              <button
                type="button"
                className={`wa-header-btn wa-tagsBtn ${tagsOpen ? "isActive" : ""}`}
                onClick={onToggleTagPanel}
                disabled={!conversaId}
                title="Tags do cliente"
                aria-label="Tags do cliente"
              >
                <IconTag />
              </button>
            ) : null}

            {(!headerCompact || isGroup) ? (
              <button
                onClick={onToggleTimeline}
                title="Histórico de atendimentos (Ctrl/Cmd + H)"
                className={`wa-header-btn wa-header-historyBtn ${showTimeline ? "isActive" : ""}`}
                type="button"
                aria-label="Histórico"
              >
                <IconClock />
              </button>
            ) : null}

            {!isGroup && conversaId && mostrarEnviarCrm ? (
              <SendToCrmChatButton
                ref={sendCrmRef}
                conversaId={conversaId}
                hideToolbarButton={headerCompact}
                isGroup={isGroup}
                crmEnabled={mostrarEnviarCrm}
              />
            ) : null}
            {!headerCompact && !isGroup && conversaId && canConsultarProdutos ? (
              <button
                type="button"
                className={`wa-header-btn wa-productsQuickBtn ${showProdutosPanel ? "isActive" : ""}`}
                onClick={onOpenProdutosPanel}
                title="Consultar produtos"
                aria-label="Consultar produtos"
              >
                <span aria-hidden="true">📦</span>
              </button>
            ) : null}
          </div>

          {!isGroup ? (
            <div className="wa-header-actionsRow">
              <div className="wa-actions">
                <AtendimentoActions
                  compactToolbar={headerCompact}
                  overflowTop={
                    headerCompact
                      ? (close) => (
                          <>
                            <button
                              type="button"
                              className="wa-atendToolbar-sheetBtn"
                              onClick={() => {
                                onToggleTimeline();
                                close();
                              }}
                            >
                              <span className="wa-atendToolbar-sheetIcon" aria-hidden="true">
                                <IconClock />
                              </span>
                              <span className="wa-atendToolbar-sheetLabel">Histórico de atendimentos</span>
                            </button>
                            {podeGerenciarTags ? (
                              <button
                                type="button"
                                className="wa-atendToolbar-sheetBtn"
                                onClick={() => {
                                  onToggleTagPanel();
                                  close();
                                }}
                                disabled={!conversaId}
                              >
                                <span className="wa-atendToolbar-sheetIcon" aria-hidden="true">
                                  <IconTag />
                                </span>
                                <span className="wa-atendToolbar-sheetLabel">Tags do cliente</span>
                              </button>
                            ) : null}
                            {!isGroup && conversaId && mostrarEnviarCrm ? (
                              <button
                                type="button"
                                className="wa-atendToolbar-sheetBtn"
                                onClick={() => {
                                  try {
                                    sendCrmRef.current?.open?.();
                                  } catch (_) {}
                                  close();
                                }}
                              >
                                <span className="wa-atendToolbar-sheetIcon" aria-hidden="true">
                                  <IconFunnelSend />
                                </span>
                                <span className="wa-atendToolbar-sheetLabel">Enviar ao CRM</span>
                              </button>
                            ) : null}
                            {!isGroup && conversaId && canConsultarProdutos ? (
                              <button
                                type="button"
                                className="wa-atendToolbar-sheetBtn"
                                onClick={() => {
                                  onOpenProdutosPanel();
                                  close();
                                }}
                              >
                                <span className="wa-atendToolbar-sheetIcon" aria-hidden="true">
                                  📦
                                </span>
                                <span className="wa-atendToolbar-sheetLabel">Consultar produtos</span>
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="wa-atendToolbar-sheetBtn"
                              onClick={() => {
                                onOpenClienteSide();
                                close();
                              }}
                            >
                              <span className="wa-atendToolbar-sheetIcon" aria-hidden="true">
                                <IconContact />
                              </span>
                              <span className="wa-atendToolbar-sheetLabel">Dados do contato</span>
                            </button>
                          </>
                        )
                      : undefined
                  }
                />
              </div>
            </div>
          ) : null}

          {headerCompact && !isGroup ? null : (
            <button
              title="Mais opções"
              className="wa-header-btn wa-header-moreBtn"
              type="button"
              onClick={onOpenClienteSide}
              aria-label="Dados do contato e mais opções"
            >
              <IconMore />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(ConversaHeader);
