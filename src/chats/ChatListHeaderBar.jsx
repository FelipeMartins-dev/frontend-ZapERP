import { memo } from "react";
import { createPortal } from "react-dom";
import CompanyBrand from "../brand/CompanyBrand";
import { Icon } from "./chatListUiPrimitives";
import { useEmpresaStore } from "../auth/empresaStore";

function HeaderButton({ title, onClick, children, innerRef, disabled }) {
  return (
    <button
      ref={innerRef}
      onClick={onClick}
      className="chat-list-header-btn"
      title={title}
      aria-label={title}
      type="button"
      disabled={disabled}
    >
      {children}
    </button>
  );
}

/**
 * Cabeçalho fixo da lista (marca da empresa + ações).
 * Não assina `chats`; lê empresa do empresaStore globalmente.
 */
function ChatListHeaderBar({
  novoBtnRef,
  showNovoMenu,
  menuPosition,
  novoMenuRef,
  onToggleNovoMenu,
  onToggleFilters,
  onNovoContato,
  onNovoGrupo,
  onNovaComunidade,
  canConsultarProdutos,
  onOpenProdutos,
}) {
  const logoUrl   = useEmpresaStore((s) => s.empresa?.logo_url);
  const nome      = useEmpresaStore((s) => s.empresa?.nome);
  const nomeFonte = useEmpresaStore((s) => s.empresa?.nome_fonte);

  return (
    <header className="chat-list-header">
      <div className="chat-list-header-left">
        <CompanyBrand logoUrl={logoUrl} nome={nome} nomeFonte={nomeFonte} />
      </div>

      <div className="chat-list-header-actions">
        <HeaderButton
          innerRef={novoBtnRef}
          title="Novo contato, grupo ou comunidade"
          onClick={onToggleNovoMenu}
        >
          <Icon size={14}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 5v14M5 12h14"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </Icon>
        </HeaderButton>

        <HeaderButton title="Filtros e tags" onClick={onToggleFilters}>
          <Icon size={14}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path
                d="M4 6h16M7 12h10M10 18h4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </Icon>
        </HeaderButton>

        {canConsultarProdutos ? (
          <HeaderButton title="Consultar produtos" onClick={onOpenProdutos}>
            <span className="chat-list-header-btnEmoji" aria-hidden="true">
              📦
            </span>
          </HeaderButton>
        ) : null}
      </div>

      {showNovoMenu &&
        createPortal(
          <div
            ref={novoMenuRef}
            className="chat-list-novo-menu chat-list-novo-menu-portal"
            role="menu"
            style={{
              position: "fixed",
              top: menuPosition.top,
              left: menuPosition.left,
              width: menuPosition.width || 200,
            }}
          >
            <button
              type="button"
              className="chat-list-novo-item"
              onClick={onNovoContato}
              role="menuitem"
            >
              <span className="chat-list-novo-icon" aria-hidden>
                👤
              </span>
              <span>Novo contato</span>
            </button>
            <button
              type="button"
              className="chat-list-novo-item"
              onClick={onNovoGrupo}
              role="menuitem"
            >
              <span className="chat-list-novo-icon" aria-hidden>
                👥
              </span>
              <span>Novo grupo</span>
            </button>
            <button
              type="button"
              className="chat-list-novo-item"
              onClick={onNovaComunidade}
              role="menuitem"
            >
              <span className="chat-list-novo-icon" aria-hidden>
                🌐
              </span>
              <span>Nova comunidade</span>
            </button>
          </div>,
          document.body
        )}
    </header>
  );
}

function headerPropsAreEqual(prev, next) {
  if (prev.showNovoMenu !== next.showNovoMenu) return false;
  if (prev.canConsultarProdutos !== next.canConsultarProdutos) return false;
  if (prev.menuPosition?.top !== next.menuPosition?.top) return false;
  if (prev.menuPosition?.left !== next.menuPosition?.left) return false;
  if (prev.menuPosition?.width !== next.menuPosition?.width) return false;
  if (prev.novoBtnRef !== next.novoBtnRef) return false;
  if (prev.novoMenuRef !== next.novoMenuRef) return false;
  if (prev.onToggleNovoMenu !== next.onToggleNovoMenu) return false;
  if (prev.onToggleFilters !== next.onToggleFilters) return false;
  if (prev.onNovoContato !== next.onNovoContato) return false;
  if (prev.onNovoGrupo !== next.onNovoGrupo) return false;
  if (prev.onNovaComunidade !== next.onNovaComunidade) return false;
  if (prev.onOpenProdutos !== next.onOpenProdutos) return false;
  return true;
}

export default memo(ChatListHeaderBar, headerPropsAreEqual);
