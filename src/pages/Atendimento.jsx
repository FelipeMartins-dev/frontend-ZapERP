import { useEffect, useRef } from "react";
import { Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import ChatList from "../chats/chatList";
import ConversaView from "../conversa/ConversaView";
import { useConversaStore } from "../conversa/conversaStore";
import { useChatStore } from "../chats/chatsStore";
import { updateDocumentTitleFromChats } from "../socket/socket";
import { useMatchMedia } from "../hooks/useMatchMedia";
import { WA_ATENDIMENTO_CHAT_HISTORY_KEY } from "../atendimento/atendimentoMobileHistory";

export default function Atendimento() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const carregarConversa = useConversaStore((s) => s.carregarConversa);
  const selectedId = useConversaStore((s) => s.selectedId);
  const chats = useChatStore((s) => s.chats);
  /** Mesmo breakpoint do header compacto da conversa — só mobile. */
  const isAtendimentoMobileNav = useMatchMedia("(max-width: 640px)");
  const prevSelectedRef = useRef(null);

  useEffect(() => {
    updateDocumentTitleFromChats();
  }, [chats]);

  const isRoot = location.pathname === "/atendimento";
  const openConversaId = location.state?.openConversaId;

  /**
   * Empilha um nível no histórico ao abrir conversa no celular: o «voltar» do aparelho
   * remove só essa camada e volta à lista, em vez de sair do app / fechar o WebView.
   */
  useEffect(() => {
    if (!isAtendimentoMobileNav || typeof window === "undefined") {
      prevSelectedRef.current = selectedId;
      return;
    }

    const prev = prevSelectedRef.current;
    const url = `${window.location.pathname}${window.location.search}`;
    const stateMarker = { [WA_ATENDIMENTO_CHAT_HISTORY_KEY]: 1 };

    const stateHasMarker = !!window.history.state?.[WA_ATENDIMENTO_CHAT_HISTORY_KEY];

    if (selectedId != null && prev == null && !stateHasMarker) {
      window.history.pushState(stateMarker, "", url);
    } else if (
      selectedId != null &&
      prev != null &&
      String(prev) !== String(selectedId)
    ) {
      window.history.replaceState(stateMarker, "", url);
    } else if (
      selectedId != null &&
      prev != null &&
      String(prev) === String(selectedId) &&
      !stateHasMarker
    ) {
      /* Ex.: conversa já aberta no desktop e rotação para mobile — ainda sem camada no histórico. */
      window.history.pushState(stateMarker, "", url);
    }

    prevSelectedRef.current = selectedId;
  }, [selectedId, isAtendimentoMobileNav, location.pathname, location.search]);

  useEffect(() => {
    if (!isAtendimentoMobileNav || typeof window === "undefined") return undefined;

    const onPopState = () => {
      const sid = useConversaStore.getState().selectedId;
      if (sid != null) {
        useConversaStore.getState().setSelectedId(null);
      }
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
    const q = searchParams.get("conversa");
    if (q) {
      carregarConversa(q);
      navigate({ pathname: "/atendimento", search: "", replace: true });
    }
  }, [searchParams, carregarConversa, navigate]);

  return (
    <div className={`atendimento-layout ${selectedId ? "conversation-open" : ""}`}>
      <aside className="atendimento-sidebar">
        <ChatList />
      </aside>

      <main className="atendimento-chat-area">
        {isRoot ? <ConversaView /> : <Outlet />}
      </main>
    </div>
  );
}