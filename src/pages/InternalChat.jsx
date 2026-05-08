import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuthStore } from "../auth/authStore";
import { useNotificationStore } from "../notifications/notificationStore";
import { SkeletonChatList } from "../components/feedback/Skeleton";
import "../components/feedback/skeleton.css";
import {
  createOrOpenInternalConversation,
  listInternalConversations,
  listInternalEmployees,
  listInternalMessages,
  sendInternalTextMessage,
  sendInternalMediaMultipart,
  sendInternalLocationMessage,
  sendInternalContactMessage,
  markInternalConversationRead,
  normalizeConversation,
  fetchInternalChatStatus,
} from "../api/internalChatService";
import { abrirConversaPorTelefone } from "../chats/chatService";
import { useChatStore } from "../chats/chatsStore";
import InternalChatThread from "../internal-chat/InternalChatThread";
import InternalChatCollaboratorListItem from "../internal-chat/InternalChatCollaboratorListItem";
import {
  extractConversationIdFromPayload,
  extractMessageFromPayload,
  extractReadPayload,
  unwrapPayload,
} from "../internal-chat/payloadUtils";
import {
  normalizeInternalMessage,
  sortMessagesAsc,
  upsertMessageSorted,
  isMessageMine,
} from "../internal-chat/messageUtils";
import { useInternalChatSocket } from "../internal-chat/useInternalChatSocket";
import { useInternalChatNotifyStore } from "../internal-chat/internalChatNotifyStore";
import { playInternalChatMessagePing } from "../internal-chat/internalChatMessagePing";
import "./internalChat.css";

const PAGE_SIZE = 40;
const INTERNAL_CHAT_NOTIF_LS = "internal_chat_desktop_notif";

function readDocumentTheme() {
  if (typeof document === "undefined") return "light";
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function formatActivityShort(ts) {
  if (ts == null || ts === "") return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function formatLastSeen(ts) {
  if (ts == null || ts === "") return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function sortConversations(list) {
  return [...list].sort((a, b) => {
    const ta = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
    const tb = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
    return tb - ta;
  });
}

/**
 * Uma única lista: colaboradores com conversa (preview/hora) ou só equipe; ordenado por atividade recente.
 * @param {any[]} employees
 * @param {any[]} conversations
 * @param {string | null} myId
 */
function buildInternalCollaboratorRows(employees, conversations, myId) {
  const convByPeer = new Map();
  for (const c of conversations) {
    if (c?.otherUserId) convByPeer.set(String(c.otherUserId), c);
  }
  const empIds = new Set(employees.map((e) => String(e.id)));
  const rows = [];
  for (const emp of employees) {
    if (myId && String(emp.id) === String(myId)) continue;
    const conv = convByPeer.get(String(emp.id)) || null;
    const sortTime = conv?.lastActivity ? new Date(conv.lastActivity).getTime() : 0;
    rows.push({ key: `emp-${emp.id}`, employee: emp, conversation: conv, sortTime });
  }
  for (const c of conversations) {
    if (!c?.otherUserId) continue;
    if (empIds.has(String(c.otherUserId))) continue;
    const sortTime = c.lastActivity ? new Date(c.lastActivity).getTime() : 0;
    rows.push({ key: `conv-${c.id}`, employee: null, conversation: c, sortTime });
  }
  rows.sort((a, b) => {
    if (b.sortTime !== a.sortTime) return b.sortTime - a.sortTime;
    const na = a.employee?.name || a.conversation?.otherName || "";
    const nb = b.employee?.name || b.conversation?.otherName || "";
    return na.localeCompare(nb, "pt-BR", { sensitivity: "base" });
  });
  return rows;
}

function pickErrorMessage(err) {
  return (
    err?.response?.data?.error ||
    err?.response?.data?.message ||
    err?.message ||
    "Não foi possível carregar o chat interno."
  );
}

export default function InternalChat() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const myId = user?.id != null ? String(user.id) : null;

  const [search, setSearch] = useState("");
  const [employees, setEmployees] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [selectedConversationId, setSelectedConversationId] = useState(null);
  const selectedConvIdRef = useRef(null);
  selectedConvIdRef.current = selectedConversationId;

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState(null);

  const [messages, setMessages] = useState([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);
  const [threadError, setThreadError] = useState(null);
  const [nextBeforeId, setNextBeforeId] = useState(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(/** @type {number | null} */ (null));
  const [publicMediaBaseUrl, setPublicMediaBaseUrl] = useState(/** @type {string | null} */ (null));
  const [conversarComContatoBusy, setConversarComContatoBusy] = useState(false);

  const messagesListRef = useRef(null);
  const threadRef = useRef(null);
  const conversationsRef = useRef([]);
  const readDebounceRef = useRef(null);

  const [desktopNotifOptIn, setDesktopNotifOptIn] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem(INTERNAL_CHAT_NOTIF_LS) === "1";
    } catch {
      return false;
    }
  });

  const [uiTheme, setUiTheme] = useState(readDocumentTheme);

  useEffect(() => {
    const sync = () => setUiTheme(readDocumentTheme());
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    window.addEventListener("theme-change", sync);
    return () => {
      mo.disconnect();
      window.removeEventListener("theme-change", sync);
    };
  }, []);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  const scheduleMarkConversationRead = useCallback((convId) => {
    if (!convId) return;
    if (readDebounceRef.current) clearTimeout(readDebounceRef.current);
    readDebounceRef.current = setTimeout(() => {
      readDebounceRef.current = null;
      markInternalConversationRead(convId).catch(() => {});
    }, 400);
  }, []);

  const notifyDesktopInternal = useCallback((convId, preview) => {
    try {
      if (localStorage.getItem(INTERNAL_CHAT_NOTIF_LS) !== "1") return;
    } catch {
      return;
    }
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const c = conversationsRef.current.find((x) => String(x.id) === String(convId));
    const name = c?.otherName || "Chat interno";
    const body = (preview || "Nova mensagem").slice(0, 120);
    try {
      new Notification(`ZapERP — ${name}`, { body, icon: "/brand/zaperp-favicon.svg" });
    } catch (_) {}
  }, []);

  useEffect(() => {
    if (loading) return;
    useInternalChatNotifyStore.getState().hydrateFromConversations(conversations);
  }, [conversations, loading]);

  useEffect(() => {
    const onVis = () => {
      if (typeof document === "undefined" || document.hidden) return;
      const cid = selectedConvIdRef.current;
      if (!cid) return;
      scheduleMarkConversationRead(cid);
      setConversations((prev) =>
        sortConversations(prev.map((c) => (String(c.id) === String(cid) ? { ...c, unreadCount: 0 } : c)))
      );
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [scheduleMarkConversationRead]);

  useEffect(
    () => () => {
      if (readDebounceRef.current) clearTimeout(readDebounceRef.current);
    },
    []
  );

  const otherUserIdForSelected = useMemo(() => {
    const c = conversations.find((x) => String(x.id) === String(selectedConversationId));
    return c?.otherUserId ?? null;
  }, [conversations, selectedConversationId]);

  const loadData = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [emRaw, convRaw] = await Promise.all([listInternalEmployees(), listInternalConversations(user?.id)]);
      const filtered = myId ? emRaw.filter((e) => String(e.id) !== myId) : emRaw;
      setEmployees(filtered);
      setConversations(sortConversations(convRaw));
    } catch (err) {
      setError(pickErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [myId, user?.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openInternalConversationId = location.state?.openInternalConversationId;
  useEffect(() => {
    if (openInternalConversationId == null || openInternalConversationId === "") return;
    setSelectedConversationId(String(openInternalConversationId));
    navigate("/chat-interno", { replace: true, state: {} });
  }, [openInternalConversationId, navigate]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { publicMediaBaseUrl: u } = await fetchInternalChatStatus();
        if (!cancelled) setPublicMediaBaseUrl(u);
      } catch {
        if (!cancelled) setPublicMediaBaseUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleConversarComContato = useCallback(async ({ nome, telefone }) => {
    const raw = String(telefone || "").trim();
    const digits = raw.replace(/\D/g, "");
    if (!digits) {
      try {
        useNotificationStore.getState().showToast({
          type: "warning",
          title: "Telefone indisponível",
          message: "Este contato não possui número para abrir no atendimento.",
        });
      } catch {
        /* ignore */
      }
      return;
    }
    setConversarComContatoBusy(true);
    try {
      const data = await abrirConversaPorTelefone(nome || "Contato", raw);
      const conv = data?.conversa || data || null;
      if (!conv?.id) throw new Error("Não foi possível abrir a conversa.");
      try {
        useChatStore.getState().addChat(conv);
      } catch {
        /* ignore */
      }
      navigate("/atendimento", { state: { openConversaId: conv.id } });
      try {
        useNotificationStore.getState().showToast({
          type: "success",
          title: "Atendimento",
          message: `Conversa com ${nome || "contato"} aberta no WhatsApp.`,
        });
      } catch {
        /* ignore */
      }
    } catch (e) {
      try {
        useNotificationStore.getState().showToast({
          type: "error",
          title: "Falha ao abrir conversa",
          message: e?.response?.data?.error || e?.message || "Não foi possível abrir a conversa com este contato.",
        });
      } catch {
        /* ignore */
      }
    } finally {
      setConversarComContatoBusy(false);
    }
  }, [navigate]);

  useEffect(() => {
    if (!selectedConversationId) {
      setMessages([]);
      setNextBeforeId(null);
      setThreadError(null);
      setSendError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setThreadLoading(true);
      setThreadError(null);
      setNextBeforeId(null);
      setSendError(null);
      try {
        const { rawMessages, nextBeforeId: nb } = await listInternalMessages(selectedConversationId, {
          limit: PAGE_SIZE,
        });
        if (cancelled) return;
        const otherUid =
          conversationsRef.current.find((x) => String(x.id) === String(selectedConversationId))?.otherUserId ?? null;
        const normalized = rawMessages
          .map((r) => normalizeInternalMessage(r, user?.id, otherUid))
          .filter(Boolean);
        setMessages(sortMessagesAsc(normalized));
        setNextBeforeId(nb && nb !== "null" && nb !== "undefined" ? nb : null);
        try {
          await markInternalConversationRead(selectedConversationId);
        } catch {
          /* ignore */
        }
        setConversations((prev) =>
          sortConversations(
            prev.map((c) => (String(c.id) === String(selectedConversationId) ? { ...c, unreadCount: 0 } : c))
          )
        );
      } catch (err) {
        if (!cancelled) setThreadError(pickErrorMessage(err));
      } finally {
        if (!cancelled) setThreadLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedConversationId, user?.id]);

  const loadOlder = useCallback(async () => {
    if (!selectedConversationId || !nextBeforeId || olderLoading || threadLoading) return;
    const el = messagesListRef.current;
    const prevH = el?.scrollHeight ?? 0;
    const prevT = el?.scrollTop ?? 0;
    setOlderLoading(true);
    setThreadError(null);
    try {
      const { rawMessages, nextBeforeId: nb } = await listInternalMessages(selectedConversationId, {
        limit: PAGE_SIZE,
        beforeId: nextBeforeId,
      });
      const normalized = rawMessages
        .map((r) => normalizeInternalMessage(r, user?.id, otherUserIdForSelected))
        .filter(Boolean);
      setMessages((prev) => {
        const merged = [...normalized, ...prev];
        const m = new Map(merged.map((x) => [x.id, x]));
        return sortMessagesAsc([...m.values()]);
      });
      setNextBeforeId(nb && nb !== "null" && nb !== "undefined" ? nb : null);
      requestAnimationFrame(() => {
        const el2 = messagesListRef.current;
        if (el2) el2.scrollTop = el2.scrollHeight - prevH + prevT;
      });
    } catch (err) {
      setThreadError(pickErrorMessage(err));
    } finally {
      setOlderLoading(false);
    }
  }, [selectedConversationId, nextBeforeId, olderLoading, threadLoading, user?.id]);

  const handleComposerSend = useCallback(
    async (payload) => {
      const tid = selectedConversationId;
      if (!tid) return;
      if (payload.kind === "text" && !String(payload.content || "").trim()) return;
      setSendError(null);
      setSending(true);
      setUploadProgress(null);
      const peerUid = conversationsRef.current.find((c) => String(c.id) === String(tid))?.otherUserId ?? null;
      try {
        let msg = null;
        if (payload.kind === "text") {
          const t = String(payload.content || "").trim();
          msg = await sendInternalTextMessage(tid, t, user?.id, peerUid);
        } else if (payload.kind === "media") {
          setUploadProgress(0);
          msg = await sendInternalMediaMultipart(
            tid,
            {
              file: payload.file,
              fieldName: payload.fieldName || "file",
              caption: payload.caption,
              messageType: payload.messageType,
            },
            user?.id,
            peerUid,
            (p) => setUploadProgress(p)
          );
        } else if (payload.kind === "location") {
          msg = await sendInternalLocationMessage(tid, payload, user?.id, peerUid);
        } else if (payload.kind === "contact") {
          msg = await sendInternalContactMessage(tid, payload, user?.id, peerUid);
        }
        if (msg) {
          setMessages((prev) => upsertMessageSorted(prev, msg));
          const preview = (msg.listPreview || String(msg.content || "").trim()).slice(0, 200);
          setConversations((prev) =>
            sortConversations(
              prev.map((c) =>
                String(c.id) === String(tid)
                  ? {
                      ...c,
                      lastMessage: preview || c.lastMessage,
                      lastActivity: msg?.createdAt ?? new Date().toISOString(),
                    }
                  : c
              )
            )
          );
        }
      } catch (err) {
        const m = pickErrorMessage(err);
        setSendError(m);
        if (err?.response?.status === 400) {
          try {
            useNotificationStore.getState().showToast({
              type: "error",
              title: "Envio recusado",
              message: m,
            });
          } catch {
            /* ignore */
          }
        }
        throw err;
      } finally {
        setSending(false);
        setUploadProgress(null);
      }
    },
    [selectedConversationId, user?.id]
  );

  useInternalChatSocket({
    onConversationCreated: (payload) => {
      const raw = unwrapPayload(payload);
      const conv = normalizeConversation(raw?.conversation ?? raw, user?.id);
      if (!conv?.id) return;
      setConversations((prev) => {
        const idx = prev.findIndex((c) => String(c.id) === String(conv.id));
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], ...conv };
          return sortConversations(next);
        }
        return sortConversations([...prev, conv]);
      });
    },
    onMessageCreated: (payload) => {
      const convId = extractConversationIdFromPayload(payload);
      if (!convId) return;
      const raw = extractMessageFromPayload(payload);
      const otherUid =
        conversationsRef.current.find((c) => String(c.id) === String(convId))?.otherUserId ?? null;
      const msg = normalizeInternalMessage(raw, user?.id, otherUid);
      if (!msg?.id) return;
      const openId = selectedConvIdRef.current;
      const isOpen = openId != null && String(openId) === String(convId);
      const isBackground = typeof document !== "undefined" && document.hidden;
      const shouldBumpUnread = !isOpen || isBackground;
      const isOwn = isMessageMine(msg, user?.id, otherUid);

      if (isOpen) {
        setMessages((prev) => upsertMessageSorted(prev, msg));
      }

      if (isOpen && !isBackground && !isOwn) {
        requestAnimationFrame(() => threadRef.current?.scrollToBottomSmooth());
        scheduleMarkConversationRead(convId);
      }

      const preview = (msg.listPreview || String(msg.content || "").trim()).slice(0, 120);
      const lastActivity = msg.createdAt || new Date().toISOString();
      setConversations((prev) =>
        sortConversations(
          prev.map((c) => {
            if (String(c.id) !== String(convId)) return c;
            const base = {
              ...c,
              lastMessage: preview || c.lastMessage,
              lastActivity,
            };
            if (isOwn) {
              return { ...base, unreadCount: Number(c.unreadCount) || 0 };
            }
            if (shouldBumpUnread) {
              return { ...base, unreadCount: (Number(c.unreadCount) || 0) + 1 };
            }
            return { ...base, unreadCount: 0 };
          })
        )
      );

      if (shouldBumpUnread && !isOwn) {
        playInternalChatMessagePing();
        notifyDesktopInternal(convId, preview);
        if (typeof document !== "undefined" && document.visibilityState === "visible") {
          try {
            useNotificationStore.getState().showToast({
              type: "info",
              title: "Chat interno",
              message: preview,
              actionLabel: "Ver",
              onAction: () => setSelectedConversationId(String(convId)),
            });
          } catch {
            /* ignore */
          }
        }
      }
    },
    onConversationRead: (payload) => {
      const p = extractReadPayload(payload);
      if (!p) return;
      const cid =
        p.conversation_id != null
          ? String(p.conversation_id)
          : p.conversationId != null
            ? String(p.conversationId)
            : null;
      if (!cid) return;
      const me = user?.id != null ? String(user.id) : null;
      const readerId = p.user_id ?? p.reader_id ?? p.usuario_id ?? p.reader_user_id;
      const unreadVal = p.unread_count ?? p.unreadCount;
      setConversations((prev) =>
        sortConversations(
          prev.map((c) => {
            if (String(c.id) !== cid) return c;
            if (unreadVal != null && unreadVal !== "") {
              return { ...c, unreadCount: Number(unreadVal) || 0 };
            }
            if (me && readerId != null && String(readerId) === me) {
              return { ...c, unreadCount: 0 };
            }
            return c;
          })
        )
      );
    },
  });

  const q = search.trim().toLowerCase();

  const collaboratorRows = useMemo(
    () => buildInternalCollaboratorRows(employees, conversations, myId),
    [employees, conversations, myId]
  );

  const collaboratorsFiltered = useMemo(() => {
    if (!q) return collaboratorRows;
    return collaboratorRows.filter((row) => {
      const emp = row.employee;
      const conv = row.conversation;
      const name = (emp?.name || conv?.otherName || "").toLowerCase();
      const email = (emp?.email || conv?.otherEmail || "").toLowerCase();
      const preview = (conv?.lastMessage || "").toLowerCase();
      return name.includes(q) || email.includes(q) || preview.includes(q);
    });
  }, [collaboratorRows, q]);

  const selected = useMemo(
    () => conversations.find((c) => String(c.id) === String(selectedConversationId)) || null,
    [conversations, selectedConversationId]
  );

  const peerEmployee = useMemo(() => {
    if (!selected?.otherUserId) return null;
    return employees.find((e) => String(e.id) === String(selected.otherUserId)) ?? null;
  }, [employees, selected]);

  async function openConversationForEmployee(emp) {
    if (!emp?.id || actionLoading) return;
    const hit = conversations.find((c) => c.otherUserId && String(c.otherUserId) === String(emp.id));
    if (hit) {
      setSelectedConversationId(hit.id);
      return;
    }
    setActionLoading(true);
    setError(null);
    try {
      const conv = await createOrOpenInternalConversation(emp.id, user?.id);
      const next = await listInternalConversations(user?.id);
      setConversations(sortConversations(next));
      if (conv?.id) {
        setSelectedConversationId(conv.id);
      } else {
        const found = next.find((c) => String(c.otherUserId) === String(emp.id));
        if (found) setSelectedConversationId(found.id);
      }
    } catch (err) {
      setError(pickErrorMessage(err));
    } finally {
      setActionLoading(false);
    }
  }

  function handleCollaboratorRowClick(row) {
    if (row.conversation?.id) {
      setSelectedConversationId(row.conversation.id);
      return;
    }
    if (row.employee) {
      openConversationForEmployee(row.employee);
    }
  }

  function isCollaboratorRowActive(row) {
    if (!selectedConversationId || !row.conversation?.id) return false;
    return String(row.conversation.id) === String(selectedConversationId);
  }

  const retryThread = useCallback(() => {
    if (!selectedConversationId) return;
    setThreadError(null);
    setThreadLoading(true);
    listInternalMessages(selectedConversationId, { limit: PAGE_SIZE })
      .then(({ rawMessages, nextBeforeId: nb }) => {
        const normalized = rawMessages
          .map((r) => normalizeInternalMessage(r, user?.id, otherUserIdForSelected))
          .filter(Boolean);
        setMessages(sortMessagesAsc(normalized));
        setNextBeforeId(nb && nb !== "null" && nb !== "undefined" ? nb : null);
      })
      .catch((err) => setThreadError(pickErrorMessage(err)))
      .finally(() => setThreadLoading(false));
  }, [selectedConversationId, user?.id, otherUserIdForSelected]);

  const notifActive =
    desktopNotifOptIn &&
    typeof Notification !== "undefined" &&
    Notification.permission === "granted";

  async function handleEnableDesktopNotifications() {
    if (typeof Notification === "undefined") return;
    const perm = await Notification.requestPermission();
    if (perm === "granted") {
      try {
        localStorage.setItem(INTERNAL_CHAT_NOTIF_LS, "1");
      } catch {
        /* ignore */
      }
      setDesktopNotifOptIn(true);
    }
  }

  const rootThemeClass = uiTheme === "dark" ? "internal-chat-root--dark-ui" : "internal-chat-root--light-ui";
  const threadOpenClass = selected ? "internal-chat-root--thread-open" : "";

  return (
    <div className={`internal-chat-root ${rootThemeClass} ${threadOpenClass}`.trim()}>
      <aside className="internal-chat-sidebar" aria-label="Lista de equipe e conversas internas">
        <header className="internal-chat-head">
          <h1>Chat interno</h1>
          <p>Mensagens entre funcionários da sua empresa. Separado do atendimento WhatsApp.</p>
        </header>

        <div className="internal-chat-search">
          <label htmlFor="internal-chat-search-input" className="visually-hidden">
            Buscar
          </label>
          <input
            id="internal-chat-search-input"
            type="search"
            autoComplete="off"
            placeholder="Buscar colaborador, e-mail ou mensagem…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="internal-chat-section-toolbar">
          <h2 className="internal-chat-section-title">Colaboradores internos</h2>
          <button
            type="button"
            className={`internal-chat-notif-btn${notifActive ? " internal-chat-notif-btn--on" : ""}`}
            onClick={handleEnableDesktopNotifications}
          >
            {notifActive ? "Notificações ativas" : "Ativar notificações"}
          </button>
        </div>

        {error ? (
          <div className="internal-chat-error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => loadData()}>
              Tentar novamente
            </button>
          </div>
        ) : null}

        <div className="internal-chat-list-wrap">
          {loading ? (
            <div className="internal-chat-skel-pad">
              <SkeletonChatList />
            </div>
          ) : collaboratorsFiltered.length === 0 ? (
            <div className="internal-chat-panel" style={{ padding: "24px 16px" }}>
              <p style={{ fontSize: "0.88rem", color: "var(--ds-text-secondary)" }}>
                {q
                  ? "Nenhum colaborador encontrado para a busca."
                  : "Nenhum colaborador interno disponível no momento."}
              </p>
            </div>
          ) : (
            collaboratorsFiltered.map((row) => {
              const emp = row.employee;
              const conv = row.conversation;
              const title = emp?.name || conv?.otherName || "Colaborador";
              const avatarUrl = emp?.avatarUrl ?? conv?.avatarUrl;
              const online = Boolean(emp?.isOnline);
              const subtitle = conv?.lastMessage
                ? String(conv.lastMessage)
                : emp?.email || "Toque para abrir a conversa";
              const timeLabel = conv?.lastActivity
                ? formatActivityShort(conv.lastActivity)
                : emp?.lastSeen && !emp?.isOnline
                  ? formatLastSeen(emp.lastSeen)
                  : "";
              const unreadCount = conv ? Number(conv.unreadCount) || 0 : 0;
              const active = isCollaboratorRowActive(row);
              return (
                <InternalChatCollaboratorListItem
                  key={row.key}
                  title={title}
                  avatarUrl={avatarUrl}
                  online={online}
                  subtitle={subtitle}
                  timeLabel={timeLabel}
                  unreadCount={unreadCount}
                  active={active}
                  disabled={actionLoading}
                  onClick={() => handleCollaboratorRowClick(row)}
                />
              );
            })
          )}
        </div>
      </aside>

      <main className="internal-chat-main" aria-label="Área da conversa interna">
        {!selected ? (
          <div className="internal-chat-panel">
            <div className="internal-chat-empty-icon" aria-hidden>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 11c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3z" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4 20c0-3.31 3.58-6 8-6s8 2.69 8 6" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M19 8h3M20.5 6.5v3" strokeLinecap="round" />
              </svg>
            </div>
            <h2>Selecione um colaborador</h2>
            <p>Clique em um nome em Colaboradores internos para abrir a conversa e enviar mensagens.</p>
            <span className="internal-chat-chip">Área interna · não é WhatsApp</span>
          </div>
        ) : (
          <InternalChatThread
            ref={threadRef}
            conversation={selected}
            onBackToList={() => setSelectedConversationId(null)}
            myUserId={user?.id}
            messagesListRef={messagesListRef}
            peerOnline={Boolean(peerEmployee?.isOnline)}
            peerLastSeen={peerEmployee?.lastSeen ?? null}
            formatLastSeen={formatLastSeen}
            messages={messages}
            initLoading={threadLoading}
            olderLoading={olderLoading}
            error={threadError}
            hasMoreOlder={Boolean(nextBeforeId)}
            onLoadOlder={loadOlder}
            onRetryLoad={retryThread}
            onComposerSend={handleComposerSend}
            sending={sending}
            sendError={sendError}
            uploadProgress={uploadProgress}
            publicMediaBaseUrl={publicMediaBaseUrl}
            onConversarComContato={handleConversarComContato}
            conversarComContatoBusy={conversarComContatoBusy}
          />
        )}
      </main>
    </div>
  );
}
