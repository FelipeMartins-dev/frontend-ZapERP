import { memo, useCallback, useEffect, useRef, useState } from "react";
import AtendimentoActions from "../../atendimento/AtendimentoActions";
import SendToCrmChatButton, { IconFunnelSend } from "../SendToCrmChatButton";
import { safeString } from "../utils/conversaViewHelpers";
import { IconClock, IconMore, IconTag, IconContact, IconSearch } from "../conversaViewIcons";

function HeaderOverflowSheetBtn({ icon, label, onClick, disabled = false }) {
  return (
    <button
      type="button"
      className="wa-atendToolbar-sheetBtn"
      onClick={onClick}
      disabled={disabled}
    >
      <span className="wa-atendToolbar-sheetIcon" aria-hidden="true">
        {icon}
      </span>
      <span className="wa-atendToolbar-sheetLabel">{label}</span>
    </button>
  );
}

/**
 * Cabeçalho da conversa (avatar, meta, ações). Lógica e estados permanecem no ConversaView.
 */
function ConversaHeader({
  headerRef,
  onBack,
  isGroup,
  headerCompact,
  headerAtendCompact = false,
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
  onOpenMessageSearch,
}) {
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuWrapRef = useRef(null);

  const closeMoreMenu = useCallback(() => setMoreMenuOpen(false), []);

  useEffect(() => {
    if (!moreMenuOpen) return undefined;
    const onDocDown = (e) => {
      if (moreMenuWrapRef.current?.contains(e.target)) return;
      setMoreMenuOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setMoreMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreMenuOpen]);

  const renderTagsHistoryProductsItems = useCallback(
    (close) => (
      <>
        <HeaderOverflowSheetBtn
          icon={<IconClock />}
          label="Histórico de movimentações"
          onClick={() => {
            onToggleTimeline();
            close();
          }}
        />
        {!isGroup && podeGerenciarTags ? (
          <HeaderOverflowSheetBtn
            icon={<IconTag />}
            label="Tags do cliente"
            disabled={!conversaId}
            onClick={() => {
              onToggleTagPanel();
              close();
            }}
          />
        ) : null}
        {!isGroup && conversaId && canConsultarProdutos ? (
          <HeaderOverflowSheetBtn
            icon={<span aria-hidden="true">📦</span>}
            label="Consultar produtos"
            onClick={() => {
              onOpenProdutosPanel();
              close();
            }}
          />
        ) : null}
      </>
    ),
    [
      canConsultarProdutos,
      conversaId,
      isGroup,
      onOpenProdutosPanel,
      onToggleTagPanel,
      onToggleTimeline,
      podeGerenciarTags,
    ]
  );

  const renderSetorControls = () => {
    if (isGroup) return null;
    if (setorAtual) {
      return (
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
      );
    }
    return (
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
    );
  };

  const renderCompactOverflowTop = useCallback(
    (close) => (
      <>
        {conversaId ? (
          <HeaderOverflowSheetBtn
            icon={<IconSearch />}
            label="Pesquisar mensagens"
            onClick={() => {
              onOpenMessageSearch();
              close();
            }}
          />
        ) : null}
        {renderTagsHistoryProductsItems(close)}
        {!isGroup && conversaId && mostrarEnviarCrm ? (
          <HeaderOverflowSheetBtn
            icon={<IconFunnelSend />}
            label="Enviar ao CRM"
            onClick={() => {
              try {
                sendCrmRef.current?.open?.();
              } catch (_) {}
              close();
            }}
          />
        ) : null}
        <HeaderOverflowSheetBtn
          icon={<IconContact />}
          label="Dados do contato"
          onClick={() => {
            onOpenClienteSide();
            close();
          }}
        />
      </>
    ),
    [
      conversaId,
      isGroup,
      mostrarEnviarCrm,
      onOpenClienteSide,
      onOpenMessageSearch,
      renderTagsHistoryProductsItems,
      sendCrmRef,
    ]
  );

  return (
    <div
      ref={headerRef}
      className={`wa-header ${isGroup ? "wa-header--group" : ""} ${headerAtendCompact && !isGroup ? "wa-header--atendMobile" : ""} ${headerAtendCompact && !isGroup && headerCrmAtivoLayout ? "wa-header--crmAtivo" : ""}`}
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
                {!headerSetorBelowStatus && !headerCompact && !isGroup ? (
                  <>
                    {badge || showPagamentoConcluidoBadge ? (
                      <span className="wa-header-metaSep" aria-hidden="true" />
                    ) : null}
                    {renderSetorControls()}
                  </>
                ) : null}
                {isGroup ? (
                  <>
                    {badge ? <span className="wa-header-metaSep" aria-hidden="true" /> : null}
                    <span className="wa-header-metaItem wa-muted">Grupo</span>
                  </>
                ) : null}
              </div>
              {headerSetorBelowStatus && !headerCompact && !isGroup ? (
                <div className="wa-header-setorRow" aria-label="Setor da conversa">
                  {renderSetorControls()}
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

      {headerCompact && !isGroup ? (
        <div className="wa-header-mobileRow2" aria-label="Setor e ações de atendimento">
          <div className="wa-header-mobileRow2-sector">{renderSetorControls()}</div>
          <div className="wa-header-mobileRow2-actions">
            <div className="wa-actions">
              <AtendimentoActions
                compactToolbar={headerAtendCompact}
                splitCompactHeader
                overflowTop={headerAtendCompact ? renderCompactOverflowTop : undefined}
              />
            </div>
          </div>
        </div>
      ) : null}

      <div className="wa-header-right">
        <div className="wa-header-innerRow">
          <div className="wa-header-iconsLine">
            {conversaId && (!headerAtendCompact || isGroup) ? (
              <button
                type="button"
                className="wa-header-btn wa-header-searchBtn"
                onClick={onOpenMessageSearch}
                title="Pesquisar mensagens"
                aria-label="Pesquisar mensagens nesta conversa"
              >
                <IconSearch />
              </button>
            ) : null}

            {!isGroup && conversaId && mostrarEnviarCrm ? (
              <SendToCrmChatButton
                ref={sendCrmRef}
                conversaId={conversaId}
                hideToolbarButton={headerAtendCompact}
                isGroup={isGroup}
                crmEnabled={mostrarEnviarCrm}
              />
            ) : null}
          </div>

          {!isGroup && !headerCompact ? (
            <div className="wa-header-actionsRow">
              <div className="wa-actions">
                <AtendimentoActions
                  compactToolbar={headerAtendCompact}
                  overflowTop={headerAtendCompact ? renderCompactOverflowTop : undefined}
                />
              </div>
            </div>
          ) : null}

          {headerAtendCompact && !isGroup ? null : (
            <div className="wa-header-moreWrap" ref={moreMenuWrapRef}>
              <button
                title="Mais opções"
                className={`wa-header-btn wa-header-moreBtn ${moreMenuOpen || tagsOpen || showTimeline || showProdutosPanel ? "isActive" : ""}`}
                type="button"
                aria-expanded={moreMenuOpen}
                aria-haspopup="menu"
                aria-label="Mais opções"
                onClick={() => setMoreMenuOpen((v) => !v)}
              >
                <IconMore />
              </button>
              {moreMenuOpen ? (
                <>
                  <div
                    className="wa-atendToolbar-backdrop"
                    aria-hidden="true"
                    onClick={closeMoreMenu}
                  />
                  <div className="wa-atendToolbar-dropdown wa-header-moreDropdown" role="menu" aria-label="Mais opções">
                    <div className="wa-atendToolbar-menuExtras">
                      {renderTagsHistoryProductsItems(closeMoreMenu)}
                      <HeaderOverflowSheetBtn
                        icon={<IconContact />}
                        label="Dados do contato"
                        onClick={() => {
                          onOpenClienteSide();
                          closeMoreMenu();
                        }}
                      />
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(ConversaHeader);
