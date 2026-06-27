import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "../auth/authStore";
import { useNotificationStore } from "../notifications/notificationStore";
import { listInternalConversations } from "../api/internalChatService";
import { scheduleAfterInitialPaint } from "../chats/scheduleAfterInitialPaint";
import {
  extractConversationIdFromPayload,
  extractMessageFromPayload,
  extractReadPayload,
} from "./payloadUtils";
import { normalizeInternalMessage, isMessageMine } from "./messageUtils";
import { useInternalChatSocket } from "./useInternalChatSocket";
import { useInternalChatNotifyStore } from "./internalChatNotifyStore";
import { playInternalChatMessagePing } from "./internalChatMessagePing";

const INTERNAL_CHAT_DESKTOP_LS = "internal_chat_desktop_notif";
const INTERNAL_CHAT_HYDRATE_DELAY_DESKTOP_MS = 900;
const INTERNAL_CHAT_HYDRATE_DELAY_MOBILE_MS = 4500;

function isMobileViewport() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(max-width: 640px)").matches;
}

function tryDesktopNotify(title, body) {
  try {
    if (localStorage.getItem(INTERNAL_CHAT_DESKTOP_LS) !== "1") return;
  } catch {
    return;
  }
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon: "/brand/pwa-192.png" });
  } catch {
    /* ignore */
  }
}

/**
 * Mantém badge/título do chat interno fora da página e dispara som + toast + notificação desktop.
 * A rota /chat-interno continua a ser a fonte de verdade via hydrateFromConversations.
 */
export default function InternalChatGlobalSocketBridge() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const userId = user?.id != null ? String(user.id) : null;

  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;

  useEffect(() => {
    if (!userId) {
      useInternalChatNotifyStore.getState().reset();
      return undefined;
    }
    let cancelled = false;
    const delay = isMobileViewport()
      ? INTERNAL_CHAT_HYDRATE_DELAY_MOBILE_MS
      : INTERNAL_CHAT_HYDRATE_DELAY_DESKTOP_MS;
    const cancelSchedule = scheduleAfterInitialPaint(() => {
      listInternalConversations(user?.id)
        .then((convs) => {
          if (!cancelled) useInternalChatNotifyStore.getState().hydrateFromConversations(convs);
        })
        .catch(() => {});
    }, delay);
    return () => {
      cancelled = true;
      cancelSchedule();
    };
  }, [userId, user?.id]);

  useInternalChatSocket({
    onMessageCreated: (payload) => {
      if (!userId) return;
      const convId = extractConversationIdFromPayload(payload);
      if (!convId) return;
      const raw = extractMessageFromPayload(payload);
      const msg = normalizeInternalMessage(raw, user.id, null);
      if (!msg?.id) return;
      if (isMessageMine(msg, user.id, null)) return;

      const onInternalRoute = pathRef.current === "/chat-interno";
      if (!onInternalRoute) {
        useInternalChatNotifyStore.getState().bumpConv(convId, 1);
        playInternalChatMessagePing();
        const preview = (msg.listPreview || String(msg.content || "").trim()).slice(0, 120) || "Nova mensagem";
        tryDesktopNotify("ZapERP — Chat interno", preview);
        useNotificationStore.getState().showToast({
          type: "info",
          title: "Chat interno",
          message: preview,
          actionLabel: "Abrir",
          onAction: () => {
            navigate("/chat-interno", { state: { openInternalConversationId: convId } });
          },
        });
      }
    },
    onConversationRead: (payload) => {
      if (pathRef.current === "/chat-interno") return;
      const p = extractReadPayload(payload);
      if (!p) return;
      const cid =
        p.conversation_id != null
          ? String(p.conversation_id)
          : p.conversationId != null
            ? String(p.conversationId)
            : null;
      if (!cid) return;
      const me = userId;
      const readerId = p.user_id ?? p.reader_id ?? p.usuario_id ?? p.reader_user_id;
      const unreadVal = p.unread_count ?? p.unreadCount;
      if (unreadVal != null && unreadVal !== "") {
        useInternalChatNotifyStore.getState().setConvUnread(cid, unreadVal);
      } else if (me && readerId != null && String(readerId) === me) {
        useInternalChatNotifyStore.getState().setConvUnread(cid, 0);
      }
    },
  });

  return null;
}
