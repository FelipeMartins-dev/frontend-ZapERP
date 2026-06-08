import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuthStore } from "../auth/authStore";
import { can, isSupervisorOrAdmin } from "../auth/permissions";
import ZapERPLogo from "../brand/ZapERPLogo";
import GlobalNotifications from "../notifications/GlobalNotifications";
import PushPermissionPrompt from "../push/PushPermissionPrompt";
import MicPermissionPrompt from "../media/MicPermissionPrompt";
import { getOpenConversationNotificationEventName } from "../notifications/desktopNotificationService";
import { useChatStore } from "../chats/chatsStore";
import { useMatchMedia } from "../hooks/useMatchMedia";
import InternalChatGlobalSocketBridge from "../internal-chat/InternalChatGlobalSocketBridge";
import { useInternalChatNotifyStore, selectInternalChatUnreadTotal } from "../internal-chat/internalChatNotifyStore";
import "../components/layout/skip-link.css";

const THEME_KEY = "theme";

function getStoredTheme() {
  try { return localStorage.getItem(THEME_KEY) || "light"; } catch { return "light"; }
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch {}
}

export default function MainLayout() {
  const navigate = useNavigate();
  const { logout, user } = useAuthStore();
  /** Barra inferior CRM / breakpoint da sidebar mobile (app.css) */
  const isMobileBottomNav = useMatchMedia("(max-width: 768px)");
  const unreadAtendimentoTotal = useChatStore((s) => {
    const list = s.chats || [];
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      n += Number(list[i]?.unread_count ?? list[i]?.unread ?? 0) || 0;
    }
    return n;
  });
  /** Bolinha tipo app: só mobile; lista já reflete nova_mensagem + leitura (setUnread ao abrir chat). */
  const showAtendimentoUnreadDot = isMobileBottomNav && unreadAtendimentoTotal > 0;
  const internalChatUnreadTotal = useInternalChatNotifyStore(selectInternalChatUnreadTotal);
  const showInternalChatUnreadDot = internalChatUnreadTotal > 0;
  const canAccessConfig = can("config_acessar", user);
  const canAccessDashboard_ = can("dashboard_acessar", user);
  const canAccessChatbot_ = can("chatbot_acessar", user);
  const canAccessUsers = can("usuarios_acessar", user);
  const canAccessSupervisao = isSupervisorOrAdmin(user);
  const isAdmin = canAccessUsers;
  const [darkMode, setDarkMode] = useState(() => getStoredTheme() === "dark");

  useEffect(() => {
    applyTheme(darkMode ? "dark" : "light");
  }, [darkMode]);

  useEffect(() => {
    const onThemeChange = (e) => {
      if (e?.detail === "dark" || e?.detail === "light") {
        setDarkMode(e.detail === "dark");
      }
    };
    window.addEventListener("theme-change", onThemeChange);
    return () => window.removeEventListener("theme-change", onThemeChange);
  }, []);

  useEffect(() => {
    const eventName = getOpenConversationNotificationEventName();
    const onOpenFromDesktopNotification = (event) => {
      const conversaId = event?.detail?.conversaId;
      if (conversaId == null || conversaId === "") return;
      navigate("/atendimento", {
        state: { openConversaId: conversaId },
      });
    };
    window.addEventListener(eventName, onOpenFromDesktopNotification);
    return () => window.removeEventListener(eventName, onOpenFromDesktopNotification);
  }, [navigate]);

  function handleLogout() {
    logout();
    navigate("/login");
  }

  function toggleTheme() {
    setDarkMode((v) => !v);
  }

  return (
    <div className="app-layout app-layout--crm">
      <a href="#main-content" className="ds-skip-link">
        Pular para o conteúdo principal
      </a>
      <GlobalNotifications />
      <PushPermissionPrompt />
      <MicPermissionPrompt />
      <InternalChatGlobalSocketBridge />
      <aside className="sidebar sidebar--compact" aria-label="Menu">
        <div className="sidebar-brand-compact" title="ZapERP — Atendimento inteligente">
          <ZapERPLogo variant="compact" size="sm" title="ZapERP" />
        </div>
        <nav className="sidebar-nav sidebar-nav--compact">
          {canAccessDashboard_ && <NavItem to="/dashboard" label="Dashboard" icon={<IconDashboard />} />}
          {canAccessDashboard_ && <NavItem to="/dashboard/ia" label="IA" icon={<IconBot />} />}
          <NavItem to="/atendimento" label="Atendimento" icon={<IconAtendimento />} unreadDot={showAtendimentoUnreadDot} />
          <NavItem to="/crm" label="CRM" icon={<IconCrm />} title="Funil de vendas e leads" />
          <NavItem
            to="/chat-interno"
            label="Chat interno"
            icon={<IconInternalTeam />}
            title="Mensagens entre funcionários (não é WhatsApp)"
            unreadDot={showInternalChatUnreadDot}
          />
          {canAccessSupervisao && <NavItem to="/supervisao" label="Supervisão" icon={<IconSupervisao />} />}
          {canAccessConfig && <NavItem to="/configuracoes" label="Configurações" icon={<IconConfig />} />}
          {canAccessChatbot_ && (
            <NavItem to="/ia" label="Bot" icon={<IconIASparkle />} title="Chatbot / automação" />
          )}
          {canAccessUsers && <NavItem to="/permissoes" label="Permissões" icon={<IconPermissoes />} />}
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-footer sidebar-footer--compact">
          <button
            type="button"
            className="sidebar-theme-toggle"
            onClick={toggleTheme}
            title={darkMode ? "Modo claro" : "Modo escuro"}
            aria-label={darkMode ? "Alternar para modo claro" : "Alternar para modo escuro"}
          >
            {darkMode ? <IconSun /> : <IconMoon />}
          </button>
          {isAdmin && <span className="sidebar-badge-compact" title="Administrador">A</span>}
          <button type="button" className="sidebar-logout" onClick={handleLogout} title="Deslogar" aria-label="Deslogar da conta">
            <span className="sidebar-nav-icon" aria-hidden>
              <IconLogout />
            </span>
            <span className="sidebar-nav-label">Deslogar</span>
          </button>
        </div>
      </aside>

      <main id="main-content" className="main-content main-content--crm" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}

function NavItem({ to, label, icon, title, unreadDot }) {
  const baseTitle = title ?? label ?? "";
  const linkTitle = unreadDot && baseTitle ? `${baseTitle} — mensagens não lidas` : baseTitle || undefined;

  return (
    <NavLink to={to} className={({ isActive }) => `sidebar-nav-item${isActive ? " active" : ""}`} title={linkTitle}>
      {unreadDot ? (
        <span className="sidebar-nav-iconWrap sidebar-nav-iconWrap--unread">
          <span className="sidebar-nav-icon">{icon}</span>
          <span className="sidebar-nav-unreadDot" title="Novas mensagens" aria-hidden="true" />
        </span>
      ) : (
        <span className="sidebar-nav-icon">{icon}</span>
      )}
      <span className="sidebar-nav-label">{label}</span>
    </NavLink>
  );
}

function IconDashboard() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <path d="M18 17V9" />
      <path d="M13 17V5" />
      <path d="M8 17v-3" />
    </svg>
  );
}

function IconCrm() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 5h16l-6 7v7l-4 2v-9L4 5z" />
    </svg>
  );
}

function IconAtendimento() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
    </svg>
  );
}

/** Ícone distinto do fone de atendimento: equipe + mensagens internas */
function IconInternalTeam() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      <path d="M12 11h4" />
      <path d="M14 9v4" />
    </svg>
  );
}

function IconIASparkle() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
      <path d="M19 14l1.2 3.6L24 19l-3.6 1.2L19 24l-1.2-3.6L14 19l3.6-1.2L19 14z" />
      <path d="M5 17l.8 2.4L8 20l-2.4.8L5 23l-.8-2.4L2 20l2.4-.8L5 17z" />
    </svg>
  );
}

function IconConfig() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function IconPermissoes() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function IconBot() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="10" rx="2" />
      <circle cx="12" cy="5" r="2" />
      <path d="M12 7v4" />
      <circle cx="9" cy="16" r="1" fill="currentColor" />
      <circle cx="15" cy="16" r="1" fill="currentColor" />
    </svg>
  );
}

function IconSupervisao() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 13h8V3H3v10Zm10 8h8V11h-8v10ZM3 21h8v-6H3v6Zm10-10h8V3h-8v8Z" />
    </svg>
  );
}

function IconLogout() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function IconSun() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function IconMoon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
