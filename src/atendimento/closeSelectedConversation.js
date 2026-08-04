import { useConversaStore } from "../conversa/conversaStore";
import { WA_ATENDIMENTO_CHAT_HISTORY_KEY } from "./atendimentoMobileHistory";

function clearConversaQueryParam() {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("conversa")) return;
    url.searchParams.delete("conversa");
    const next = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(window.history.state, "", next);
  } catch {
    /* ignore */
  }
}

/**
 * Fecha só a conversa selecionada (UI/estado).
 * Não finaliza, não transfere, não altera status nem responsável.
 */
export function closeSelectedConversation({ preferHistoryBack = false } = {}) {
  const store = useConversaStore.getState();
  if (store.selectedId == null || store.selectedId === "") return false;

  if (
    preferHistoryBack &&
    typeof window !== "undefined" &&
    window.history?.state?.[WA_ATENDIMENTO_CHAT_HISTORY_KEY]
  ) {
    window.history.back();
    return true;
  }

  store.setSelectedId(null);
  clearConversaQueryParam();
  return true;
}
