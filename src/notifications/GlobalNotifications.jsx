import { useEffect } from "react";
import { useNotificationStore } from "./notificationStore";
import { useChatStore } from "../chats/chatsStore";
import { syncAppBadgeNumber } from "./appBadgeSync";
import { getStatusAtendimentoEffective } from "../utils/conversaUtils";
import { useInternalChatNotifyStore, selectInternalChatUnreadTotal } from "../internal-chat/internalChatNotifyStore";
import { useHelpDeskNotifyStore, selectHelpDeskUnreadTotal } from "../helpdesk/helpDeskNotifyStore";
import Toast from "../components/feedback/Toast";
import "../components/feedback/toast.css";

const TITLE_BASE = "ZapERP — Atendimento inteligente";

export default function GlobalNotifications() {
  const toast = useNotificationStore((s) => s.toast);
  const clearToast = useNotificationStore((s) => s.clearToast);
  const chats = useChatStore((s) => s.chats || []);
  const internalUnread = useInternalChatNotifyStore(selectInternalChatUnreadTotal);
  const helpDeskUnread = useHelpDeskNotifyStore(selectHelpDeskUnreadTotal);

  useEffect(() => {
    const waUnread = chats.reduce((acc, c) => acc + Number(c?.unread_count ?? 0), 0);
    const totalMsgs = waUnread + internalUnread + helpDeskUnread;
    document.title = totalMsgs > 0 ? `(${totalMsgs}) ${TITLE_BASE}` : TITLE_BASE;
    // Ícone da PWA: quantidade de conversas na fila "Aberta" (não soma de mensagens — evita ficar preso em 99).
    const openConversations = chats.filter((c) => getStatusAtendimentoEffective(c) === "aberta").length;
    syncAppBadgeNumber(openConversations);
    return () => {
      document.title = TITLE_BASE;
    };
  }, [chats, helpDeskUnread, internalUnread]);

  useEffect(() => {
    if (!toast) return;
    const ms = toast.actionLabel && typeof toast.onAction === "function" ? 12000 : 4000;
    const t = setTimeout(clearToast, ms);
    return () => clearTimeout(t);
  }, [toast, clearToast]);

  if (!toast) return null;

  return (
    <Toast
      title={toast.title}
      message={toast.message}
      type={toast.type || "info"}
      onClose={clearToast}
      actionLabel={toast.actionLabel}
      onAction={
        typeof toast.onAction === "function"
          ? () => {
              try {
                toast.onAction();
              } finally {
                clearToast();
              }
            }
          : undefined
      }
    />
  );
}
