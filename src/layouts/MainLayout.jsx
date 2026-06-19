import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  IconBook2,
  IconChartBar,
  IconFilter,
  IconGridDots,
  IconHeadset,
  IconLogout,
  IconMessage2,
  IconRobot,
  IconSettings,
  IconSparkles,
  IconTemplate,
  IconMoon,
  IconSun,
  IconUsers,
} from "@tabler/icons-react";
import { useAuthStore } from "../auth/authStore";
import { can, canGerenciarRespostasSalvas, isSupervisorOrAdmin } from "../auth/permissions";
import GlobalNotifications from "../notifications/GlobalNotifications";
import PushPermissionPrompt from "../push/PushPermissionPrompt";
import { getOpenConversationNotificationEventName } from "../notifications/desktopNotificationService";
import { useChatStore } from "../chats/chatsStore";
import { useMatchMedia } from "../hooks/useMatchMedia";
import InternalChatGlobalSocketBridge from "../internal-chat/InternalChatGlobalSocketBridge";
import { useInternalChatNotifyStore, selectInternalChatUnreadTotal } from "../internal-chat/internalChatNotifyStore";
import "../components/layout/skip-link.css";

const THEME_KEY = "theme";
const SIDEBAR_ICON_SIZE = 17;
const SIDEBAR_ICON_STROKE = 1.75;

function getStoredTheme() {
  try {
    return localStorage.getItem(THEME_KEY) || "light";
  } catch {
    return "light";
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {}
}

function getUserInitial(user) {
  const name = String(user?.nome || user?.name || user?.email || "U").trim();
  return (name[0] || "U").toUpperCase();
}

export default function MainLayout() {
  const navigate = useNavigate();
  const { logout, user } = useAuthStore();
  const isMobileBottomNav = useMatchMedia("(max-width: 768px)");
  const unreadAtendimentoTotal = useChatStore((s) => {
    const list = s.chats || [];
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      n += Number(list[i]?.unread_count ?? list[i]?.unread ?? 0) || 0;
    }
    return n;
  });
  const showAtendimentoUnreadDot = isMobileBottomNav && unreadAtendimentoTotal > 0;
  const internalChatUnreadTotal = useInternalChatNotifyStore(selectInternalChatUnreadTotal);
  const showInternalChatUnreadDot = internalChatUnreadTotal > 0;
  const canAccessConfig = can("config_acessar", user);
  const canAccessRespostasSalvas = canGerenciarRespostasSalvas(user);
  const canAccessDashboard_ = can("dashboard_acessar", user);
  const canAccessChatbot_ = can("chatbot_acessar", user);
  const canAccessUsers = can("usuarios_acessar", user);
  const canAccessSupervisao = isSupervisorOrAdmin(user);
  const [darkMode, setDarkMode] = useState(() => getStoredTheme() === "dark");

  const navItems = useMemo(
    () =>
      [
        {
          to: "/dashboard",
          label: "Analytics",
          title: "Analytics",
          icon: IconChartBar,
          show: canAccessDashboard_,
        },
        {
          to: "/ia",
          label: "Bot",
          title: "Bot / IA",
          icon: IconRobot,
          show: canAccessChatbot_,
        },
        {
          to: "/atendimento",
          label: "Atendimento",
          title: "Atendimento",
          icon: IconHeadset,
          show: true,
          unreadDot: showAtendimentoUnreadDot,
        },
        {
          to: "/chat-interno",
          label: "Chat",
          title: "Chat interno",
          icon: IconMessage2,
          show: true,
          unreadDot: showInternalChatUnreadDot,
        },
        {
          to: "/supervisao",
          label: "Filtros",
          title: "Filtros / Supervisão",
          icon: IconFilter,
          show: canAccessSupervisao,
        },
        {
          to: "/permissoes",
          label: "Equipe",
          title: "Equipe",
          icon: IconUsers,
          show: canAccessUsers,
        },
        {
          to: "/crm",
          label: "Apps",
          title: "Apps / CRM",
          icon: IconGridDots,
          show: true,
        },
        {
          to: "/configuracoes",
          label: "Configurações",
          title: "Configurações",
          icon: IconSettings,
          show: canAccessConfig,
        },
        {
          to: "/configuracoes?tab=respostas",
          label: "Respostas",
          title: "Respostas salvas",
          icon: IconTemplate,
          show: !canAccessConfig && canAccessRespostasSalvas,
        },
        {
          to: "/dashboard/ia",
          label: "IA",
          title: "IA / Sparkles",
          icon: IconSparkles,
          show: canAccessDashboard_,
        },
        {
          to: "/manual",
          label: "Manual",
          title: "Manual do Atendente",
          icon: IconBook2,
          show: true,
        },
      ].filter((item) => item.show),
    [
      canAccessChatbot_,
      canAccessConfig,
      canAccessDashboard_,
      canAccessRespostasSalvas,
      canAccessSupervisao,
      canAccessUsers,
      showAtendimentoUnreadDot,
      showInternalChatUnreadDot,
    ]
  );

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

  const userInitial = getUserInitial(user);

  return (
    <div className="app-layout app-layout--crm">
      <a href="#main-content" className="ds-skip-link">
        Pular para o conteúdo principal
      </a>
      <GlobalNotifications />
      <PushPermissionPrompt />
      <InternalChatGlobalSocketBridge />
      <aside className="sidebar sidebar--compact sidebar--v2" aria-label="Menu">
        <nav className="sidebar-nav sidebar-nav--compact sidebar-nav--v2">
          {navItems.map((item) => (
            <SidebarNavItem key={`${item.to}-${item.label}`} {...item} />
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-footer sidebar-footer--compact sidebar-footer--v2">
          <hr className="sidebar-v2-divider" aria-hidden="true" />
          <button
            type="button"
            className="sidebar-theme-toggle"
            onClick={toggleTheme}
            title={darkMode ? "Modo claro" : "Modo escuro"}
            aria-label={darkMode ? "Alternar para modo claro" : "Alternar para modo escuro"}
          >
            {darkMode ? (
              <IconSun size={SIDEBAR_ICON_SIZE} stroke={SIDEBAR_ICON_STROKE} aria-hidden />
            ) : (
              <IconMoon size={SIDEBAR_ICON_SIZE} stroke={SIDEBAR_ICON_STROKE} aria-hidden />
            )}
            <span className="sidebar-nav-label">{darkMode ? "Claro" : "Escuro"}</span>
          </button>
          <div className="sidebar-user-avatar" title={user?.nome || user?.email || "Usuário"} aria-label="Usuário logado">
            {userInitial}
          </div>
          <button
            type="button"
            className="sidebar-logout"
            onClick={handleLogout}
            title="Sair"
            aria-label="Sair da conta"
          >
            <IconLogout size={SIDEBAR_ICON_SIZE} stroke={SIDEBAR_ICON_STROKE} aria-hidden />
            <span className="sidebar-nav-label">Sair</span>
          </button>
        </div>
      </aside>

      <main id="main-content" className="main-content main-content--crm" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}

function SidebarNavItem({ to, label, title, icon: Icon, unreadDot }) {
  const linkTitle = unreadDot && title ? `${title} — mensagens não lidas` : title ?? label;

  return (
    <NavLink
      to={to}
      className={({ isActive }) => `sidebar-nav-item${isActive ? " active" : ""}`}
      title={linkTitle}
      aria-label={label}
    >
      {unreadDot ? (
        <span className="sidebar-nav-iconWrap sidebar-nav-iconWrap--unread">
          <span className="sidebar-nav-icon" aria-hidden>
            <Icon size={SIDEBAR_ICON_SIZE} stroke={SIDEBAR_ICON_STROKE} />
          </span>
          <span className="sidebar-nav-unreadDot" title="Novas mensagens" aria-hidden="true" />
        </span>
      ) : (
        <span className="sidebar-nav-icon" aria-hidden>
          <Icon size={SIDEBAR_ICON_SIZE} stroke={SIDEBAR_ICON_STROKE} />
        </span>
      )}
      <span className="sidebar-nav-label">{label}</span>
    </NavLink>
  );
}
