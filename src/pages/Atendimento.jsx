import { lazy, Suspense, useEffect, useRef } from "react";
import { Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { SkeletonChatList } from "../components/feedback/Skeleton";
import EmptyState from "../components/feedback/EmptyState";
import "../components/feedback/empty-state.css";
import "../components/feedback/skeleton.css";
import { useConversaStore } from "../conversa/conversaStore";
import { useChatStore } from "../chats/chatsStore";
import { useWhatsappInstancesStore } from "../chats/whatsappInstancesStore";
import { useEmpresaStore } from "../auth/empresaStore";
import { applyDocumentTitle } from "../socket/socket";
import { useMatchMedia } from "../hooks/useMatchMedia";
import { WA_ATENDIMENTO_CHAT_HISTORY_KEY } from "../atendimento/atendimentoMobileHistory";

const ChatList = lazy(() => import("../chats/chatList"));
const ConversaView = lazy(() => import("../conversa/ConversaView"));

function ChatListPanelFallback() {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "var(--ds-surface-1)",
      }}
      aria-busy="true"
      aria-live="polite"
    >
      <SkeletonChatList />
    </div>
  );
}

function ConversaPanelFallback() {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--wa-bg, var(--ds-chat-bg))",
        color: "var(--wa-text-muted, var(--ds-text-muted))",
        fontSize: 14,
      }}
      aria-busy="true"
      aria-live="polite"
    >
      Carregando…
    </div>
  );
}

/** Desktop sem conversa selecionada — evita baixar o chunk ConversaView no login. */
function AtendimentoChatPlaceholder() {
  const logoUrl = useEmpresaStore((s) => s.empresa?.logo_url);
  const nome = useEmpresaStore((s) => s.empresa?.nome);

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--wa-bg, var(--ds-chat-bg))",
      }}
      role="status"
    >
      <EmptyState
        title="Selecione uma conversa"
        description="Abra uma conversa na lista à esquerda para visualizar e responder às mensagens."
        brandLogoUrl={logoUrl}
        brandName={nome}
      />
    </div>
  );
}

export default function Atendimento() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const carregarConversa = useConversaStore((s) => s.carregarConversa);
  const selectedId = useConversaStore((s) => s.selectedId);
  /** Mesmo breakpoint do header compacto da conversa — só mobile. */
  const isAtendimentoMobileNav = useMatchMedia("(max-width: 640px)");
  const prevSelectedRef = useRef(null);
  const mobileHistoryArmedRef = useRef(false);

  const unreadTitleTotal = useChatStore((s) => {
    let total = 0
    for (const c of s.chats || []) total += Number(c.unread_count) || 0
    return total
  }, (a, b) => a === b);

  useEffect(() => {
    applyDocumentTitle(unreadTitleTotal);
  }, [unreadTitleTotal]);

  const isRoot = location.pathname === "/atendimento";
  const openConversaId = location.state?.openConversaId;
  const hasSelectedConversa = selectedId != null && selectedId !== "";

  /**
   * Empilha um nível no histórico ao abrir conversa no celular: o «voltar» do aparelho
   * remove só essa camada e volta à lista, em vez de sair do app / fechar o WebView.
   */
  useEffect(() => {
    if (!isAtendimentoMobileNav || typeof window === "undefined") {
      prevSelectedRef.current = selectedId;
      mobileHistoryArmedRef.current = false;
      return;
    }

    const prev = prevSelectedRef.current;
    const url = `${window.location.pathname}${window.location.search}`;
    const currentState =
      window.history.state && typeof window.history.state === "object"
        ? window.history.state
        : {};
    const stateMarker = { ...currentState, [WA_ATENDIMENTO_CHAT_HISTORY_KEY]: 1 };

    const stateHasMarker = !!currentState?.[WA_ATENDIMENTO_CHAT_HISTORY_KEY];

    if (selectedId == null) {
      prevSelectedRef.current = selectedId;
      return;
    }

    if (selectedId != null && prev == null && !stateHasMarker) {
      window.history.pushState(stateMarker, "", url);
      mobileHistoryArmedRef.current = true;
    } else if (
      selectedId != null &&
      prev != null &&
      String(prev) !== String(selectedId)
    ) {
      window.history.replaceState(stateMarker, "", url);
      mobileHistoryArmedRef.current = true;
    } else if (
      selectedId != null &&
      prev != null &&
      String(prev) === String(selectedId) &&
      !stateHasMarker
    ) {
      /* Ex.: conversa já aberta no desktop e rotação para mobile — ainda sem camada no histórico. */
      window.history.pushState(stateMarker, "", url);
      mobileHistoryArmedRef.current = true;
    } else if (stateHasMarker) {
      mobileHistoryArmedRef.current = true;
    }

    prevSelectedRef.current = selectedId;
  }, [selectedId, isAtendimentoMobileNav, location.pathname, location.search]);

  useEffect(() => {
    if (!isAtendimentoMobileNav || typeof window === "undefined") return undefined;

    const onPopState = (event) => {
      if (event?.isTrusted === false) return;

      const sid = useConversaStore.getState().selectedId;
      if (sid == null) return;

      const nextHasMarker = !!event?.state?.[WA_ATENDIMENTO_CHAT_HISTORY_KEY];
      if (nextHasMarker) {
        mobileHistoryArmedRef.current = true;
        return;
      }

      if (!mobileHistoryArmedRef.current) return;

      mobileHistoryArmedRef.current = false;
      prevSelectedRef.current = null;
      useConversaStore.getState().setSelectedId(null);
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [isAtendimentoMobileNav]);

  useEffect(() => {
    if (openConversaId) {
      carregarConversa(openConversaId);
      navigate("/atendimento", { replace: true, state: {} });
    }
  }, [openConversaId, carregarConversa, navigate]);

  useEffect(() => {
    useWhatsappInstancesStore.getState().load();
  }, []);

  useEffect(() => {
    const q = searchParams.get("conversa");
    if (q) {
      carregarConversa(q);
      navigate({ pathname: "/atendimento", search: "", replace: true });
    }
  }, [searchParams, carregarConversa, navigate]);

  return (
    <div className={`atendimento-layout ${selectedId ? "conversation-open" : ""}`}>
      <aside className="atendimento-sidebar">
        <Suspense fallback={<ChatListPanelFallback />}>
          <ChatList />
        </Suspense>
      </aside>

      <main className="atendimento-chat-area">
        {isRoot ? (
          hasSelectedConversa ? (
            <Suspense fallback={<ConversaPanelFallback />}>
              <ConversaView />
            </Suspense>
          ) : isAtendimentoMobileNav ? null : (
            <AtendimentoChatPlaceholder />
          )
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  );
}
