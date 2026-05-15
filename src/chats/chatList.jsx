import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchChats, abrirConversaCliente, getZapiStatus, sincronizarFotosPerfil, postFinalizacaoAusenciaLote } from "./chatService";
import { useChatStore } from "./chatsStore";
import { useConversaStore } from "../conversa/conversaStore";
import { listarTags } from "../api/tagService";
import { useAuthStore } from "../auth/authStore";
import { isSupervisorOrAdmin } from "../auth/permissions";
import {
  isGroupConversation,
  getStatusAtendimentoEffective,
  isAguardandoClienteManual,
  isVCardText,
  parseVCardMeta,
} from "../utils/conversaUtils";
import api from "../api/http";
import { getApiBaseUrl } from "../api/baseUrl";
import { useNavigate, useLocation } from "react-router-dom";
import ZapERPLogo from "../brand/ZapERPLogo";
import { useNotificationStore } from "../notifications/notificationStore";
import EmptyState from "../components/feedback/EmptyState";
import ConfirmDialog from "../components/feedback/ConfirmDialog";
import { SkeletonChatList } from "../components/feedback/Skeleton";
import "../components/feedback/empty-state.css";
import "../components/feedback/skeleton.css";
import "../components/ui/button.css";
import "./chatList.css";
import "./chatList.chips-premium.css";
import NovoContatoModal from "./NovoContatoModal";
import ProdutoConsultaPanel from "../conversa/ProdutoConsultaPanel";
import ConversationActionMenuTrigger from "./ConversationActionMenuTrigger";
import ConversationActionMenu from "./ConversationActionMenu";
import { useConversationActionMenu } from "./useConversationActionMenu";
import AdminAtendenteFilter from "./AdminAtendenteFilter";
import { useAdminAtendenteFilter } from "./useAdminAtendenteFilter";
import { ChatListSearchBox } from "./ChatListSearchBox";
import { getClientesPendentesSupervisao, getResumoSupervisao } from "../api/supervisaoService";
import {
  clearConversation,
  deleteConversation,
  mergePrefsFromPatchResponse,
  toggleFavoriteConversation,
  toggleMuteConversation,
  togglePinConversation,
} from "./conversationActionsService";

/** Preferências por item (API pode enviar `silenciada` ou `silenciado`). */
function rowPrefs(c) {
  return {
    silenciado: !!(c?.silenciado ?? c?.silenciada),
    fixada: !!c?.fixada,
    favorita: !!c?.favorita,
  };
}

/**
 * A aba "Minha fila" usa `minhaFilaList` (GET `/chats?minha_fila=1`), separado do array `chats`.
 * Fixar em "Todas" atualiza só `chats` via store — sem mesclar aqui, o pin não aparece nem no topo em Minha fila.
 */
function mergeMinhaFilaPrefsFromChats(rows, chatsCanon) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const canon = Array.isArray(chatsCanon) ? chatsCanon : [];
  const byId = new Map(canon.filter((c) => c?.id != null).map((c) => [String(c.id), c]));
  return rows.map((row) => {
    const c = byId.get(String(row?.id));
    if (!c) return row;
    const silenciadoMerged =
      c.silenciado !== undefined || c.silenciada !== undefined
        ? !!(c.silenciado ?? c.silenciada)
        : !!(row.silenciado ?? row.silenciada);
    return {
      ...row,
      fixada: c.fixada !== undefined ? !!c.fixada : !!row.fixada,
      fixada_em: c.fixada_em !== undefined ? c.fixada_em : row.fixada_em,
      silenciado: silenciadoMerged,
      silenciada: silenciadoMerged,
      favorita: c.favorita !== undefined ? !!c.favorita : !!row.favorita,
    };
  });
}

/** Chip “Abertas”: apenas conversas com `status_atendimento === aberta` (fila / não assumidas). */
function conversaContaComoAbertaNoChip(c) {
  const s = getStatusAtendimentoEffective(c);
  if (s !== "aberta") return false;
  if (c?.exibir_badge_aberta === false) return false;
  return true;
}

/** Admin UI (filtro lateral por funcionário): aceita role/perfil legado. */
function isAppAdmin(user) {
  return isSupervisorOrAdmin(user);
}

function countDistinctConversas(list) {
  const arr = Array.isArray(list) ? list : [];
  const byKey = new Set();
  arr.forEach((c) => {
    const key =
      c?.id != null
        ? `conv-${c.id}`
        : c?.cliente_id != null
          ? `cliente-${c.cliente_id}`
          : null;
    if (key) byKey.add(String(key));
  });
  return byKey.size;
}

const CONFIRM_LOTE_AUSENCIA = "FINALIZAR_LOTE_AUSENCIA_CLIENTE";

/** IDs de conversas individuais em atendimento (para assistente de lote por ausência). */
function collectEmAtendimentoIdsFromChats(list, max = 50) {
  return (Array.isArray(list) ? list : [])
    .filter((c) => !isGroupConversation(c) && c?.id && !c.sem_conversa)
    .filter((c) => getStatusAtendimentoEffective(c) === "em_atendimento" && c.atendente_id != null)
    .map((c) => Number(c.id))
    .filter((n) => Number.isFinite(n) && n > 0)
    .slice(0, max);
}

function isConversaAguardandoCliente(c) {
  if (!c || c?.atendente_id == null) return false;
  if (isAguardandoClienteManual(c)) return true;
  return (
    getStatusAtendimentoEffective(c) === "em_atendimento" &&
    c?.aguardando_cliente_desde != null
  );
}

function isConversaEmAtendimentoBadge(c) {
  if (!c || c?.atendente_id == null) return false;
  const s = getStatusAtendimentoEffective(c);
  return s === "em_atendimento" || s === "aguardando_cliente";
}

const EMPTY_PENDENTES_SET = new Set();

/**
 * Cliente foi o último a falar (ou há novas mensagens) e a equipe deve responder.
 * Alinha ao selo “Cliente aguardando sua resposta” e, para supervisores, a `/supervisao/clientes-pendentes`.
 */
function isConversaAguardandoFuncionario(c, pendentesIdSet) {
  if (!c || isGroupConversation(c)) return false;
  if (c?.id != null && pendentesIdSet?.has?.(String(c.id))) return true;
  if (c?.atendente_id == null) return false;
  if (getStatusAtendimentoEffective(c) !== "em_atendimento") return false;
  if (isConversaAguardandoCliente(c)) return false;
  const lastDir = getLastDirection(c);
  const unread = Number(c?.unread_count ?? c?.unread ?? 0);
  const hintNovaMsg =
    !lastDir && (Boolean(c?.tem_novas_mensagens_em_atendimento) || unread > 0);
  return lastDir === "in" || hintNovaMsg;
}

/**
 * Classe do balão: calmo = em atendimento sem urgência; alerta = cliente aguardando o funcionário
 * (inclui mesma regra da bolinha verde/laranja para o responsável — antes o class era calculado antes do dot).
 */
function atendimentoRowVisualClass(c, pendentesIdSet, semConversaRow, currentUserId) {
  if (!c || semConversaRow || isGroupConversation(c)) return "";
  const isResponsavel =
    currentUserId != null &&
    c?.atendente_id != null &&
    String(c.atendente_id) === String(currentUserId);
  const stAt = getStatusAtendimentoEffective(c);
  const isHumanAtendimentoRow = stAt === "em_atendimento" || stAt === "aguardando_cliente";
  const lastDir = getLastDirection(c);
  const unread = Number(c?.unread_count ?? c?.unread ?? 0);
  const hintNovaMsg =
    !lastDir &&
    (Boolean(c?.tem_novas_mensagens_em_atendimento) || unread > 0);
  const showAtendimentoDot =
    isResponsavel &&
    isHumanAtendimentoRow &&
    (lastDir === "in" || hintNovaMsg);

  if (isConversaAguardandoFuncionario(c, pendentesIdSet) || showAtendimentoDot) {
    return "chat-list-row--atendimento-alerta";
  }
  if (isConversaEmAtendimentoBadge(c)) return "chat-list-row--atendimento-calm";
  return "";
}

/**
 * Em atendimento com última mensagem do cliente (ou indício de novas entradas) —
 * destaque visual “tech” na lista para o atendente notar rápido.
 */
function isEmAtendimentoUltimaDoCliente(c) {
  if (!c || isGroupConversation(c)) return false;
  if (c?.atendente_id == null) return false;
  if (getStatusAtendimentoEffective(c) !== "em_atendimento") return false;
  if (isConversaAguardandoCliente(c)) return false;
  const lastDir = getLastDirection(c);
  const unread = Number(c?.unread_count ?? c?.unread ?? 0);
  const hintNovaMsg =
    !lastDir &&
    (Boolean(c?.tem_novas_mensagens_em_atendimento) || unread > 0);
  return lastDir === "in" || hintNovaMsg;
}

/**
 * Modo admin por funcionário (payload pode ter vários status_atendimento).
 * Inclui só conversas assumidas por esse utilizador; grupos e itens sem atendente_id ficam de fora.
 */
function conversaMatchesAdminAtendenteFilter(c, selectedUserId) {
  if (isGroupConversation(c)) return false;
  if (c?.atendente_id == null) return false;
  return String(c.atendente_id) === String(selectedUserId);
}

/* =====================================================
   COMPONENTES (mantidos + refinados visualmente)
===================================================== */

const audioDurationCache = new Map(); // url -> seconds
const audioDurationPromiseCache = new Map(); // url -> Promise<number|null>
let audioDurationInFlight = 0;
const AUDIO_DURATION_CONCURRENCY = 4;
const audioDurationQueue = [];

function UnreadBadge({ n }) {
  const v = Number(n || 0);
  if (!v) return null;
  return <span className="chat-list-unread">{v > 99 ? "99+" : v}</span>;
}

function AtendimentoUnreadDot({ show }) {
  if (!show) return null;
  return (
    <span
      className="chat-list-atendimento-dot"
      title="Cliente aguardando sua resposta"
      aria-label="Cliente aguardando sua resposta"
      role="status"
    />
  );
}

/** Só os minutos ao lado do relógio; atualiza a cada minuto. */
const EsperaMinutosInline = memo(function EsperaMinutosInline({ anchorIso, className = "", wordUnit = false }) {
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    bump();
    const ms = 60000 - (Date.now() % 60000) + 25;
    let intervalId;
    const timeoutId = setTimeout(() => {
      bump();
      intervalId = setInterval(bump, 60000);
    }, ms);
    return () => {
      clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, [anchorIso, bump, wordUnit]);

  const d = parseToDate(anchorIso);
  if (!d) return null;
  const rawMin = Math.floor((Date.now() - d.getTime()) / 60000);
  const mins = Number.isFinite(rawMin) ? Math.max(0, rawMin) : 0;
  const label =
    mins < 1
      ? wordUnit
        ? "< 1 min"
        : "<1m"
      : wordUnit
        ? `${mins}\u00a0min`
        : `${mins}m`;
  const cn = ["chat-list-time-espera-min", className].filter(Boolean).join(" ");

  return (
    <span className={cn} title={`${mins} min — desde ${d.toLocaleString("pt-BR")}`}>
      {label}
    </span>
  );
});

function parseToDate(ts) {
  if (!ts) return null;
  if (ts instanceof Date) return ts;
  if (typeof ts === "number") return new Date(ts);
  const s = String(ts).trim();
  if (!s) return null;
  // Se vier sem timezone (ex.: "2026-02-10T20:36:00"), assuma UTC (Supabase timestamp sem TZ)
  const noTzIso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/;
  const hasTz = /Z$|[+-]\d{2}:\d{2}$/.test(s);
  const normalized = !hasTz && noTzIso.test(s) ? `${s}Z` : s;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatHora(ts) {
  const d = parseToDate(ts);
  if (!d) return "";
  try {
    return d.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Sao_Paulo",
    });
  } catch {
    // fallback sem timezone option (ambientes antigos)
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
}

function initials(nome = "") {
  const parts = String(nome).trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] || "";
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] : "";
  return (a + b).toUpperCase();
}

function digitsOnly(v) {
  return String(v || "").replace(/\D/g, "");
}

function isToday(dateLike) {
  if (!dateLike) return false;
  const d = new Date(dateLike);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function getLastMessage(chat) {
  const msgs = chat?.mensagens || chat?.messages || [];
  if (!Array.isArray(msgs) || msgs.length === 0) return null;
  return msgs[msgs.length - 1];
}

function normalizeDirection(v) {
  const d = String(v || "").toLowerCase().trim();
  if (!d) return "";
  if (d === "inbound" || d === "recebida" || d === "entrada") return "in";
  if (d === "outbound" || d === "enviada" || d === "saida") return "out";
  return d;
}

/** Fonte de verdade (prioridade): preview -> mensagens[0] -> ultima_mensagem -> fallback final. */
function getLastDirection(chat) {
  const dirPreview = normalizeDirection(chat?.ultima_mensagem_preview?.direcao);
  if (dirPreview) return dirPreview;
  const dirMsg0 = normalizeDirection(chat?.mensagens?.[0]?.direcao ?? chat?.messages?.[0]?.direcao);
  if (dirMsg0) return dirMsg0;
  const dirUltima = normalizeDirection(chat?.ultima_mensagem?.direcao);
  if (dirUltima) return dirUltima;
  const dirFallback = normalizeDirection(getLastMessage(chat)?.direcao);
  if (dirFallback) return dirFallback;
  return "";
}

/** Timestamp da última mensagem visível na lista (preview > mensagens[0] > última). */
function getListaUltimaMensagemCriadoEm(c) {
  if (!c) return null;
  const p = c?.ultima_mensagem_preview?.criado_em;
  if (p) return String(p).trim() || null;
  const m0 = c?.mensagens?.[0]?.criado_em;
  if (m0) return String(m0).trim() || null;
  const last = getLastMessage(c)?.criado_em;
  return last ? String(last).trim() || null : null;
}

/**
 * Só quando está em atendimento, fila “aguardando funcionário” e há âncora temporal.
 * @returns {string} ISO-like anchor ou "" se não mostrar minutos
 */
function getEsperaMinutosAnchorIso(c, pendentesIdSet) {
  if (!c || isGroupConversation(c)) return "";
  if (c?.atendente_id == null) return "";
  if (getStatusAtendimentoEffective(c) !== "em_atendimento") return "";
  if (isConversaAguardandoCliente(c)) return "";
  if (!isConversaAguardandoFuncionario(c, pendentesIdSet)) return "";

  const lastDir = getLastDirection(c);
  const previewDir = normalizeDirection(c?.ultima_mensagem_preview?.direcao);
  const lastMsgTs = getListaUltimaMensagemCriadoEm(c);
  const ultimaAtiv = c?.ultima_atividade != null ? String(c.ultima_atividade).trim() : "";
  const pendenteSupervisor = c?.id != null && pendentesIdSet?.has?.(String(c.id));

  let anchorIso = "";
  if ((lastDir === "in" || previewDir === "in") && lastMsgTs) anchorIso = lastMsgTs;
  else if (pendenteSupervisor && ultimaAtiv) anchorIso = ultimaAtiv;
  else anchorIso = ultimaAtiv || lastMsgTs || "";

  return anchorIso ? String(anchorIso).trim() : "";
}

function esperaMinutosAnchorKey(c, pendentesIdSet) {
  return getEsperaMinutosAnchorIso(c, pendentesIdSet);
}

function getMediaUrl(url, urlAbsoluta) {
  if (urlAbsoluta) return urlAbsoluta;
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  const base = getApiBaseUrl();
  return base.replace(/\/$/, "") + (url.startsWith("/") ? url : "/" + url);
}

function formatDuracaoSegundos(totalSeconds) {
  const s = Number(totalSeconds);
  if (!Number.isFinite(s) || s <= 0) return "";
  const sec = Math.round(s);
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

function isPlaceholderAudioText(txt) {
  const t = String(txt || "").trim().toLowerCase();
  return t === "(áudio)" || t === "(audio)";
}
function isPlaceholderImageText(txt) {
  const t = String(txt || "").trim().toLowerCase();
  return t === "(imagem)" || t === "(foto)";
}
function isPlaceholderVideoText(txt) {
  const t = String(txt || "").trim().toLowerCase();
  return t === "(vídeo)" || t === "(video)";
}
function isPlaceholderStickerText(txt) {
  const t = String(txt || "").trim().toLowerCase();
  return t === "(figurinha)" || t === "(sticker)";
}
function isPlaceholderFileText(txt) {
  const t = String(txt || "").trim().toLowerCase();
  return t === "(arquivo)" || t === "(documento)";
}
function isPlaceholderLocationText(txt) {
  const t = String(txt || "").trim().toLowerCase();
  return t === "(localização)" || t === "(localizacao)";
}

/** Detecta se mensagem é contato compartilhado (vCard) */
function isContactMessage(last) {
  const tipo = String(last?.tipo || "").toLowerCase();
  if (tipo === "contact") return true;
  const txt = last?.texto ?? last?.conteudo ?? last?.body ?? "";
  return typeof txt === "string" && isVCardText(txt);
}

/** Formata telefone para preview compacto */
function formatPhonePreview(phone) {
  if (!phone) return "";
  const p = String(phone).replace(/\D/g, "");
  if (p.startsWith("55") && p.length > 11) {
    const ddd = p.slice(2, 4);
    const rest = p.slice(4);
    if (rest.length >= 8) return `+55 ${ddd} ${rest.slice(0, 5)}-${rest.slice(5)}`;
  }
  return p.length >= 10 ? `+${p}` : String(phone);
}

function PreviewIcon({ type, className = "" }) {
  const t = String(type || "").toLowerCase();
  if (t === "audio") {
    return (
      <svg className={`chat-preview-ico ${className}`} width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm7-3a1 1 0 1 0-2 0a5 5 0 0 1-10 0a1 1 0 1 0-2 0a7 7 0 0 0 6 6.92V20H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-2.08A7 7 0 0 0 19 11Z"
        />
      </svg>
    );
  }
  if (t === "imagem") {
    return (
      <svg className={`chat-preview-ico ${className}`} width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M21 5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5Zm-2 0v9.2l-2.7-2.7a2 2 0 0 0-2.8 0l-6.3 6.3l-1.7-1.7a2 2 0 0 0-2.8 0L5 18.7V5h14ZM8.5 10A1.5 1.5 0 1 0 7 8.5A1.5 1.5 0 0 0 8.5 10Z"
        />
      </svg>
    );
  }
  if (t === "video") {
    return (
      <svg className={`chat-preview-ico ${className}`} width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M17 10.5V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3.5l4 4v-11l-4 4ZM10 9.5v5l4-2.5l-4-2.5Z"
        />
      </svg>
    );
  }
  if (t === "sticker") {
    return (
      <svg className={`chat-preview-ico ${className}`} width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 2a10 10 0 1 0 10 10c0-.7-.07-1.38-.2-2.03A7 7 0 0 1 14 17h-4a3 3 0 0 1-3-3v-4A7 7 0 0 1 14.03 2.2C13.38 2.07 12.7 2 12 2Zm-3 9a1 1 0 1 0 0-2a1 1 0 0 0 0 2Zm6 0a1 1 0 1 0 0-2a1 1 0 0 0 0 2Zm-6.2 3.3a1 1 0 0 0 1.4 1.4a2.54 2.54 0 0 1 3.6 0a1 1 0 1 0 1.4-1.4a4.54 4.54 0 0 0-6.4 0ZM14 19.5a5.5 5.5 0 0 0 5.5-5.5H17a3 3 0 0 1-3 3v2.5Z"
        />
      </svg>
    );
  }
  if (t === "arquivo") {
    return (
      <svg className={`chat-preview-ico ${className}`} width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-6Zm1 7V3.5L18.5 9H15Z"
        />
      </svg>
    );
  }
  if (t === "contact") {
    return (
      <svg className={`chat-preview-ico ${className}`} width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm0 16H5V5h14v14Zm-7-2a3 3 0 0 0 3-3a3 3 0 0 0-6 0a3 3 0 0 0 3 3Zm0-10a2.5 2.5 0 1 1 0 5a2.5 2.5 0 0 1 0-5Zm0 8.5a4 4 0 0 1 3.47-2a.5.5 0 0 1 .86.5a5.5 5.5 0 0 1-9.66 0a.5.5 0 0 1 .86-.5A4 4 0 0 1 12 15.5Z"
        />
      </svg>
    );
  }
  if (t === "location") {
    return (
      <svg className={`chat-preview-ico ${className}`} width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5Z"
        />
      </svg>
    );
  }
  return null;
}

function enqueueAudioDuration(url) {
  const u = String(url || "").trim();
  if (!u) return Promise.resolve(null);
  if (audioDurationCache.has(u)) return Promise.resolve(audioDurationCache.get(u));
  if (audioDurationPromiseCache.has(u)) return audioDurationPromiseCache.get(u);

  const p = new Promise((resolve) => {
    audioDurationQueue.push({ url: u, resolve });
    pumpAudioDurationQueue();
  });
  audioDurationPromiseCache.set(u, p);
  return p;
}

function pumpAudioDurationQueue() {
  while (audioDurationInFlight < AUDIO_DURATION_CONCURRENCY && audioDurationQueue.length > 0) {
    const job = audioDurationQueue.shift();
    audioDurationInFlight++;
    loadAudioDuration(job.url)
      .then((sec) => {
        if (sec != null && Number.isFinite(sec) && sec > 0) {
          audioDurationCache.set(job.url, sec);
        }
        job.resolve(audioDurationCache.get(job.url) ?? null);
      })
      .catch(() => job.resolve(null))
      .finally(() => {
        audioDurationInFlight--;
        // limpa promise cache para permitir retry eventual se der null por rede
        if (!audioDurationCache.has(job.url)) audioDurationPromiseCache.delete(job.url);
        pumpAudioDurationQueue();
      });
  }
}

function loadAudioDuration(url) {
  return new Promise((resolve) => {
    try {
      const audio = new Audio();
      audio.preload = "metadata";
      let done = false;
      const finish = (sec) => {
        if (done) return;
        done = true;
        try {
          audio.src = "";
        } catch {}
        resolve(sec ?? null);
      };

      const t = setTimeout(() => finish(null), 7000);

      audio.onloadedmetadata = () => {
        clearTimeout(t);
        const d = Number(audio.duration);
        // alguns browsers retornam Infinity até baixar mais; ignore
        if (!Number.isFinite(d) || d <= 0 || d === Infinity) return finish(null);
        finish(d);
      };
      audio.onerror = () => {
        clearTimeout(t);
        finish(null);
      };

      audio.src = url;
    } catch {
      resolve(null);
    }
  });
}

function getPreview(chat, { audioDurationSec } = {}) {
  const ultima = chat?.ultima_mensagem || chat?.ultima_mensagem_preview;
  const last = ultima || getLastMessage(chat);
  if (!last) return "Sem mensagens";

  const outPrefix = String(last?.direcao || "").toLowerCase() === "out" ? "Você: " : "";
  const tipoRaw = String(last?.tipo || "").toLowerCase();
  const txtRaw = last?.conteudo || last?.body || last?.texto || "";
  const txt = String(txtRaw || "").trim();
  const tipo =
    tipoRaw ||
    (isPlaceholderAudioText(txt) ? "audio" : "") ||
    (isPlaceholderImageText(txt) ? "imagem" : "") ||
    (isPlaceholderVideoText(txt) ? "video" : "") ||
    (isPlaceholderStickerText(txt) ? "sticker" : "") ||
    (isPlaceholderFileText(txt) ? "arquivo" : "") ||
    (isPlaceholderLocationText(txt) ? "location" : "") ||
    (isContactMessage(last) ? "contact" : "");

  if (tipo === "contact") {
    const meta = last?.contact_meta;
    const parsed = parseVCardMeta(txt) || {};
    const nome = (meta?.nome && String(meta.nome).trim()) || parsed.nome || "Contato";
    return `${outPrefix}📇 ${nome}`;
  }

  if (tipo === "location") {
    const lm = last?.location_meta;
    if (lm && typeof lm === "object") {
      const la = Number(lm.latitude);
      const ln = Number(lm.longitude);
      if (Number.isFinite(la) && Number.isFinite(ln)) {
        const n = String(lm.nome || "").trim();
        const e = String(lm.endereco || "").trim();
        const bits = [n, e].filter(Boolean);
        if (bits.length) return `${outPrefix}📍 ${bits.join(" • ")}`;
      }
    }
    const capLoc = txt && !isPlaceholderLocationText(txt) ? txt.slice(0, 60) : "";
    return `${outPrefix}📍 ${capLoc || "Localização"}`;
  }

  const isPlaceholder =
    !txt ||
    txt === "(mídia)" ||
    txt === "(mensagem vazia)" ||
    txt === "(imagem)" ||
    txt === "(áudio)" ||
    txt === "(vídeo)" ||
    txt === "(figurinha)" ||
    txt === "(arquivo)" ||
    isPlaceholderLocationText(txt);
  const cap = !isPlaceholder ? txt.slice(0, 60) : "";

  // Preferir preview por tipo (estilo WhatsApp)
  if (tipo === "audio") {
    const dur = formatDuracaoSegundos(audioDurationSec);
    return `${outPrefix}Áudio${dur ? ` • ${dur}` : ""}`;
  }
  if (tipo === "imagem") return `${outPrefix}Foto${cap ? `: ${cap}` : ""}`;
  if (tipo === "video") return `${outPrefix}Vídeo${cap ? `: ${cap}` : ""}`;
  if (tipo === "sticker") return `${outPrefix}Figurinha${cap ? `: ${cap}` : ""}`;
  if (tipo === "arquivo") {
    const n = String(last?.nome_arquivo || "").trim();
    return `${outPrefix}${n || "Documento"}`;
  }

  if (txt) return `${outPrefix}${txt}`;
  return `${outPrefix}(sem texto)`;
}

function ChatTicks({ status, isGroup }) {
  const raw = status;
  const s = String(raw ?? "").trim();
  const lower = s.toLowerCase();

  // Alguns providers retornam ack numérico (0..4)
  const maybeNum = typeof raw === "number" ? raw : /^\d+$/.test(lower) ? Number(lower) : null;
  if (maybeNum != null && Number.isFinite(maybeNum)) {
    if (maybeNum <= 0) return <span className="chat-ticks chat-ticks--pending" title="Enviando">✓</span>;
    if (maybeNum === 1) return <span className="chat-ticks" title="Enviada">✓</span>;
    if (maybeNum === 2) return <span className="chat-ticks" title="Entregue">✓✓</span>;
    if (maybeNum >= 3 && !isGroup) return <span className="chat-ticks chat-ticks--read" title="Visualizada">✓✓</span>;
    if (maybeNum >= 3 && isGroup) return <span className="chat-ticks" title="Entregue">✓✓</span>;
  }

  const isErr = lower === "erro" || lower === "error" || lower === "failed" || lower === "falhou";
  const isPending = lower === "pending" || lower === "enviando";
  const isSent =
    !lower || lower === "sent" || lower === "enviado" || lower === "enviada" || lower === "send" || lower === "sending";
  const isDelivered =
    lower === "received" ||
    lower === "delivered" ||
    lower === "entregue" ||
    lower === "entregada" ||
    lower === "receivedcallback";
  let isRead =
    lower === "read" ||
    lower === "seen" ||
    lower === "lida" ||
    lower === "visualizada" ||
    lower === "played";
  if (isGroup) isRead = false; // grupos: nunca mostrar azul

  if (isErr) return <span className="chat-ticks chat-ticks--err" title="Erro ao enviar">⚠</span>;
  if (isRead) return <span className="chat-ticks chat-ticks--read" title="Visualizada">✓✓</span>;
  if (isDelivered) return <span className="chat-ticks" title="Entregue">✓✓</span>;
  // Sem símbolo de relógio (pedido do usuário): use um ✓ suave enquanto "pending"
  if (isPending) return <span className="chat-ticks chat-ticks--pending" title="Enviando">✓</span>;
  if (isSent) return <span className="chat-ticks" title="Enviada">✓</span>;
  return <span className="chat-ticks" title={s}>✓</span>;
}

function PreviewLine({ chat, audioDurationSec }) {
  const last = chat?.ultima_mensagem || chat?.ultima_mensagem_preview || getLastMessage(chat);
  if (!last) return <span className="chat-list-previewText">Sem mensagens</span>;

  const out = String(last?.direcao || "").toLowerCase() === "out";
  const status = last?.status ?? last?.status_mensagem ?? chat?.status ?? "";
  const isGroup = isGroupConversation(chat);
  const atendentePrefix = out && last?.enviado_por_usuario && last?.usuario_nome
    ? `${last.usuario_nome}: `
    : "";

  const txtRaw = last?.conteudo || last?.body || last?.texto || "";
  const txt = String(txtRaw || "").trim();

  const tipoRaw = String(last?.tipo || "").toLowerCase();
  const tipo =
    tipoRaw ||
    (isPlaceholderAudioText(txt) ? "audio" : "") ||
    (isPlaceholderImageText(txt) ? "imagem" : "") ||
    (isPlaceholderVideoText(txt) ? "video" : "") ||
    (isPlaceholderStickerText(txt) ? "sticker" : "") ||
    (isPlaceholderFileText(txt) ? "arquivo" : "") ||
    (isPlaceholderLocationText(txt) ? "location" : "") ||
    (isContactMessage(last) ? "contact" : "");

  const isPlaceholder =
    !txt ||
    txt === "(mídia)" ||
    txt === "(mensagem vazia)" ||
    isPlaceholderImageText(txt) ||
    isPlaceholderAudioText(txt) ||
    isPlaceholderVideoText(txt) ||
    isPlaceholderStickerText(txt) ||
    isPlaceholderFileText(txt) ||
    isPlaceholderLocationText(txt);

  const cap = !isPlaceholder ? txt.slice(0, 60) : "";

  if (tipo === "audio") {
    const dur = formatDuracaoSegundos(audioDurationSec);
    const durLabel = dur || "0:00";
    return (
      <span className={`chat-list-previewLine ${out ? "is-out" : ""}`}>
        {out ? <ChatTicks status={status} isGroup={isGroup} /> : null}
        <PreviewIcon type="audio" className={out ? "is-accent" : ""} />
        <span className={`chat-list-previewDur ${out ? "is-accent" : ""}`}>{atendentePrefix}{durLabel}</span>
      </span>
    );
  }

  if (tipo === "imagem") {
    return (
      <span className="chat-list-previewLine">
        {out ? <ChatTicks status={status} isGroup={isGroup} /> : null}
        <PreviewIcon type="imagem" />
        <span className="chat-list-previewText">{atendentePrefix}{cap ? `Foto · ${cap}` : "Foto"}</span>
      </span>
    );
  }
  if (tipo === "video") {
    return (
      <span className="chat-list-previewLine">
        {out ? <ChatTicks status={status} isGroup={isGroup} /> : null}
        <PreviewIcon type="video" />
        <span className="chat-list-previewText">{atendentePrefix}{cap ? `Vídeo · ${cap}` : "Vídeo"}</span>
      </span>
    );
  }
  if (tipo === "sticker") {
    return (
      <span className="chat-list-previewLine">
        {out ? <ChatTicks status={status} isGroup={isGroup} /> : null}
        <PreviewIcon type="sticker" />
        <span className="chat-list-previewText">{atendentePrefix}{cap ? `Figurinha · ${cap}` : "Figurinha"}</span>
      </span>
    );
  }
  if (tipo === "arquivo") {
    const n = String(last?.nome_arquivo || "").trim();
    return (
      <span className="chat-list-previewLine">
        {out ? <ChatTicks status={status} isGroup={isGroup} /> : null}
        <PreviewIcon type="arquivo" />
        <span className="chat-list-previewText">{atendentePrefix}{n || "Documento"}</span>
      </span>
    );
  }

  if (tipo === "location") {
    const lm = last?.location_meta;
    let line = cap;
    if (lm && typeof lm === "object") {
      const la = Number(lm.latitude);
      const ln = Number(lm.longitude);
      if (Number.isFinite(la) && Number.isFinite(ln)) {
        const n = String(lm.nome || "").trim();
        const e = String(lm.endereco || "").trim();
        const bits = [n, e].filter(Boolean);
        if (bits.length) line = bits.join(" · ");
        else if (txt && !isPlaceholderLocationText(txt)) line = txt.slice(0, 60);
        else line = "Localização";
      }
    } else if (!line || isPlaceholderLocationText(txt)) {
      line = txt && !isPlaceholderLocationText(txt) ? txt.slice(0, 60) : "Localização";
    }
    return (
      <span className={`chat-list-previewLine ${out ? "is-out" : ""}`}>
        {out ? <ChatTicks status={status} isGroup={isGroup} /> : null}
        <PreviewIcon type="location" className={out ? "is-accent" : ""} />
        <span className="chat-list-previewText">{atendentePrefix}{line}</span>
      </span>
    );
  }

  if (tipo === "contact") {
    const meta = last?.contact_meta;
    const parsed = parseVCardMeta(txt) || {};
    const nome = (meta?.nome && String(meta.nome).trim()) || parsed.nome || "Contato";
    const telefone = meta?.telefone || parsed.telefone;
    const fotoPerfil = meta?.foto_perfil && String(meta.foto_perfil).trim().startsWith("http")
      ? String(meta.foto_perfil).trim()
      : null;
    const iniciais = nome
      .trim()
      .split(/\s+/)
      .map((s) => s[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "?";

    return (
      <span className="chat-list-previewLine chat-list-previewLine--contact">
        {out ? <ChatTicks status={status} isGroup={isGroup} /> : null}
        <PreviewIcon type="contact" className={out ? "is-accent" : ""} />
        <span className="chat-list-previewContact">
          {fotoPerfil ? (
            <img
              src={fotoPerfil}
              alt=""
              className="chat-list-previewContactAvatar"
              referrerPolicy="no-referrer"
              loading="lazy"
            />
          ) : (
            <span className="chat-list-previewContactInitials" aria-hidden="true">{iniciais}</span>
          )}
          <span className="chat-list-previewContactText" title={telefone ? formatPhonePreview(telefone) : nome}>
            {atendentePrefix}{nome}
          </span>
        </span>
      </span>
    );
  }

  return (
    <span className="chat-list-previewLine">
      {out ? <ChatTicks status={status} isGroup={isGroup} /> : null}
      <span className="chat-list-previewText">{atendentePrefix}{txt || "Sem mensagens"}</span>
    </span>
  );
}

/* =====================================================
   NORMALIZAÇÃO DE CONTATO (PRO) - mantido
===================================================== */

/** Uma só fonte: telefone no topo. Nunca exibir LID (lid:xxx) — backend envia telefone_exibivel null nesses casos. */
function getPhone(chat) {
  const tel = chat?.telefone_exibivel ?? chat?.cliente_telefone ?? chat?.telefone ?? chat?.numero ?? chat?.phone ?? chat?.wa_id ?? "";
  const s = String(tel || "").trim();
  if (s.toLowerCase().startsWith("lid:")) return "";
  return s;
}

function formatPhoneForDisplay(phone) {
  const p = String(phone || "").replace(/\D/g, "");
  if (p.length >= 10) {
    const ddd = p.length >= 12 ? p.slice(0, 2) : p.length === 11 ? p.slice(0, 2) : "";
    const rest = p.length >= 12 ? p.slice(2) : p.length === 11 ? p.slice(2) : p;
    if (ddd && rest.length >= 8) return `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
    return `+${p}`;
  }
  return p || "";
}

/**
 * Nome do contato/conversa.
 * Contatos: contato_nome principal; fallback telefone_exibivel ou telefone.
 * Grupos: nome_grupo principal.
 */
export function getDisplayName(chat) {
  if (isGroupConversation(chat)) {
    const nome = chat?.nome_grupo ?? chat?.contato_nome ?? chat?.nome_contato_cache ?? chat?.nome ?? "";
    const n = String(nome || "").trim();
    if (n && !n.toLowerCase().startsWith("lid:")) return n;
    return formatPhoneForDisplay(getPhone(chat)) || "Grupo";
  }
  // Prioridade: contato_nome (backend) > nome_contato_cache (contatos WhatsApp) > cliente.nome (CRM) > telefone
  // NUNCA usar pushname — pode vir da última msg e ser o nome do atendente em conversas onde você enviou
  const raw =
    chat?.contato_nome ??
    chat?.nome_contato_cache ??
    chat?.cliente?.nome ??
    chat?.clientes?.nome ??
    chat?.cliente_nome ??
    chat?.nome ??
    "";
  const nome = String(raw || "").trim();
  if (nome && !nome.toLowerCase().startsWith("lid:")) return nome;
  // Fallback: telefone_exibivel ou telefone quando contato_nome vazio
  const tel = getPhone(chat);
  return tel ? formatPhoneForDisplay(tel) : "Contato";
}

/**
 * Par nome + foto. foto_perfil: só usa se URL http válida; null → avatar padrão.
 * Grupos: foto_grupo ou fallback. Layout não quebra quando foto_perfil é null.
 */
function getContactDisplay(chat) {
  const isGroup = isGroupConversation(chat);
  const displayName = getDisplayName(chat);
  const phone = formatPhoneForDisplay(chat?.telefone_exibivel ?? chat?.telefone ?? chat?.cliente_telefone ?? chat?.numero ?? "");
  // NUNCA usar senderPhoto/photo — vêm da última msg e podem ser nossa foto em msgs outbound
  const rawFoto = isGroup
    ? (chat?.foto_grupo ?? null)
    : (
        chat?.foto_perfil ??
        chat?.foto_perfil_contato_cache ??
        chat?.cliente?.foto_perfil ??
        chat?.clientes?.foto_perfil ??
        null
      );
  const avatarUrl = rawFoto != null && String(rawFoto).trim().startsWith("http") ? String(rawFoto).trim() : null;
  return { displayName, avatarUrl, phone, isGroup };
}

function TagMini({ tag }) {
  if (!tag) return null;
  return (
    <span
      className="chat-list-tag-mini"
      title={tag?.nome}
      style={{ background: tag?.cor || "#64748b" }}
    >
      {tag?.nome}
    </span>
  );
}

function getAvatarColor(seed = "") {
  const s = String(seed);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue}, 62%, 42%)`;
}

/* =====================================================
   UI HELPERS (somente visual)
===================================================== */

function Icon({ children, size = 16 }) {
  return (
    <span
      className="chat-list-icon"
      style={{ width: size, height: size, minWidth: size, minHeight: size }}
      aria-hidden
    >
      {children}
    </span>
  );
}

function HeaderButton({ title, onClick, children, innerRef, disabled }) {
  return (
    <button
      ref={innerRef}
      onClick={onClick}
      className="chat-list-header-btn"
      title={title}
      type="button"
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function Chip({ active, onClick, children, variant = "default", className = "" }) {
  return (
    <button
      type="button"
      className={`chat-list-chip${variant === "primary" ? " chat-list-chip--primary" : ""}${
        active ? " is-active" : ""
      } ${className}`.trim()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function StatusPill({ status, exibirBadgeAberta, chat, aguardandoFuncionario, esperaMinutosAnchorIso = "" }) {
  const s = String(status || "").toLowerCase().trim().replace(/\s+/g, "_");
  const map = {
    em_atendimento: { label: "Em atendimento", cls: "chat-list-status in" },
    aguardando_cliente: {
      label: "Aguardando cliente",
      cls: "chat-list-status chat-list-status-tech chat-list-status-tech--client",
    },
    fechada: { label: "Finalizada", cls: "chat-list-status closed" },
    mensagem_disparada: { label: "Mensagem disparada", cls: "chat-list-status dispatched" },
  };
  const it = map[s];
  const ausenciaFechada =
    s === "fechada" &&
    (String(chat?.finalizacao_motivo) === "ausencia_cliente" || chat?.finalizada_automaticamente === true);
  const aguardandoClienteAutomatico =
    s === "em_atendimento" &&
    chat?.atendente_id != null &&
    chat?.aguardando_cliente_desde != null &&
    !isAguardandoClienteManual(chat);
  const aguardandoFuncionarioVisivel =
    Boolean(aguardandoFuncionario) && s === "em_atendimento" && !aguardandoClienteAutomatico;
  /** Sem “Em atendimento” quando já há etiqueta de aguardando cliente ou funcionário — libera espaço ao nome. */
  const suprimirPilulaEmAtendimento =
    s === "em_atendimento" && (aguardandoClienteAutomatico || aguardandoFuncionarioVisivel);
  const reabertoHint =
    typeof chat?.ui_hint_reaberto_ausencia_cliente === "number" &&
    Date.now() - chat.ui_hint_reaberto_ausencia_cliente < 120000;

  if (ausenciaFechada) {
    return (
      <span className="chat-list-statusRow">
        <span className="chat-list-status closed chat-list-status--muted" title="Encerrada automaticamente por ausência do cliente">
          Finalizado por ausência
        </span>
      </span>
    );
  }

  if (it) {
    const rowClass =
      "chat-list-statusRow" + (suprimirPilulaEmAtendimento ? " chat-list-statusRow--await-solo" : "");
    const mostrarPilulaPrincipal = !(s === "em_atendimento" && suprimirPilulaEmAtendimento);
    return (
      <span className={rowClass}>
        {mostrarPilulaPrincipal ? (
          <span
            className={it.cls}
            title={
              s === "aguardando_cliente"
                ? "Aguardando cliente (marcado manualmente)"
                : it.label
            }
          >
            {it.label}
          </span>
        ) : null}
        {reabertoHint ? (
          <span className="chat-list-status-note" title="Cliente voltou a enviar mensagem após encerramento por ausência">
            Reaberto pelo cliente
          </span>
        ) : null}
        {aguardandoClienteAutomatico ? (
          <span
            className="chat-list-status-tech chat-list-status-tech--client"
            title="Aguardando resposta do cliente (detecção automática — em atendimento)"
          >
            Aguardando cliente
          </span>
        ) : null}
        {aguardandoFuncionarioVisivel ? (
          <span
            className="chat-list-status-tech chat-list-status-tech--staff"
            title="Última mensagem do cliente — equipe deve responder"
          >
            <span className="chat-list-status-tech-staff-label">Aguardando funcionário</span>
            {String(esperaMinutosAnchorIso || "").trim() ? (
              <>
                <span className="chat-list-status-tech-staff-sep" aria-hidden="true">
                  <span className="chat-list-status-tech-staff-dot" />
                </span>
                <EsperaMinutosInline
                  anchorIso={String(esperaMinutosAnchorIso).trim()}
                  className="chat-list-time-espera-min--staff-pill"
                  wordUnit
                />
              </>
            ) : null}
          </span>
        ) : null}
      </span>
    );
  }
  // Aberta ou vazio: usar exibir_badge_aberta para decidir se mostra "Aberta"
  if (exibirBadgeAberta === true) {
    return (
      <span className="chat-list-statusRow">
        <span className="chat-list-status open" title="Aberta">
          Aberta
        </span>
        {reabertoHint ? (
          <span className="chat-list-status-note" title="Cliente voltou a enviar mensagem após encerramento por ausência">
            Reaberto pelo cliente
          </span>
        ) : null}
      </span>
    );
  }
  return null;
}

function ChatRow({
  chat,
  active,
  onSelect,
  onOpenClienteSemConversa,
  selectedId,
  setSelectedId,
  carregarConversa,
  setUnread,
  isMenuOpen,
  onToggleMenu,
  pendentesFuncionarioSet = EMPTY_PENDENTES_SET,
}) {
  const id = chat?.id;
  const clienteId = chat?.cliente_id;
  const semConversa = Boolean(chat?.sem_conversa && chat?.cliente_id);
  const authUser = useAuthStore((s) => s.user);
  const currentUserId = authUser?.id != null ? authUser.id : null;
  const atendimentoRowClass = atendimentoRowVisualClass(
    chat,
    pendentesFuncionarioSet,
    semConversa,
    currentUserId
  );
  const atendimentoTechClass = isEmAtendimentoUltimaDoCliente(chat) ? "chat-list-row--atendimento-tech" : "";
  const esperaMinutosAnchor = useMemo(
    () => getEsperaMinutosAnchorIso(chat, pendentesFuncionarioSet),
    [chat, pendentesFuncionarioSet]
  );
  const statusEff = getStatusAtendimentoEffective(chat);
  const aguardandoClienteAutomaticoRow =
    statusEff === "em_atendimento" &&
    chat?.atendente_id != null &&
    chat?.aguardando_cliente_desde != null &&
    !isAguardandoClienteManual(chat);
  const aguardandoFuncionarioVisivelRow =
    isConversaAguardandoFuncionario(chat, pendentesFuncionarioSet) &&
    statusEff === "em_atendimento" &&
    !aguardandoClienteAutomaticoRow;
  /** Contador de espera: ao lado do relógio só se não estiver na etiqueta “Aguardando funcionário”. */
  const mostrarEsperaMinutosAoLadoDoRelogio =
    Boolean(esperaMinutosAnchor) && !aguardandoFuncionarioVisivelRow;
  const contact = getContactDisplay(chat);
  const { displayName, avatarUrl, phone, isGroup } = contact;
  const empresa = String(chat?.cliente?.empresa ?? chat?.cliente_empresa ?? chat?.empresa ?? "").trim();
  const hasName = displayName !== phone;
  const last = getLastMessage(chat);
  const lastTxt = String(last?.conteudo || last?.body || last?.texto || "").trim();
  const lastTipoRaw = !semConversa ? String(last?.tipo || "").toLowerCase() : "";
  const lastTipoResolved =
    lastTipoRaw ||
    (isPlaceholderAudioText(lastTxt) ? "audio" : "") ||
    (isPlaceholderImageText(lastTxt) ? "imagem" : "") ||
    (isPlaceholderVideoText(lastTxt) ? "video" : "") ||
    (isPlaceholderStickerText(lastTxt) ? "sticker" : "") ||
    (isPlaceholderFileText(lastTxt) ? "arquivo" : "");
  const ts = last?.criado_em || chat?.criado_em;
  const hora = formatHora(ts);
  const audioUrl =
    !semConversa && lastTipoResolved === "audio" && (last?.url || last?.url_absoluta)
      ? (last?.url_absoluta || getMediaUrl(String(last.url)))
      : "";
  const [audioSec, setAudioSec] = useState(() => (audioUrl && audioDurationCache.has(audioUrl) ? audioDurationCache.get(audioUrl) : null));

  const lastTipo = lastTipoResolved;
  // thumb removido no chatlist para ficar igual WhatsApp (sem cortes / mais alinhado)

  useEffect(() => {
    let cancelled = false;
    if (!audioUrl) {
      setAudioSec(null);
      return;
    }
    const cached = audioDurationCache.get(audioUrl);
    if (cached != null) {
      setAudioSec(cached);
      return;
    }
    enqueueAudioDuration(audioUrl).then((sec) => {
      if (cancelled) return;
      if (sec != null) setAudioSec(sec);
    });
    return () => {
      cancelled = true;
    };
  }, [audioUrl]);

  const previewTitle = semConversa ? "Sem mensagens" : getPreview(chat, { audioDurationSec: audioSec });
  const previewNode = semConversa ? <span className="chat-list-previewText">Sem mensagens</span> : <PreviewLine chat={chat} audioDurationSec={audioSec} />;
  const unread = Number(chat?.unread_count ?? chat?.unread ?? 0);
  const isResponsavel =
    !isGroup &&
    currentUserId != null &&
    chat?.atendente_id != null &&
    String(chat.atendente_id) === String(currentUserId);
  const stAt = getStatusAtendimentoEffective(chat);
  const isHumanAtendimentoRow =
    stAt === "em_atendimento" || stAt === "aguardando_cliente";
  const lastDir = getLastDirection(chat);
  const hintNovaMsg =
    !lastDir &&
    (Boolean(chat?.tem_novas_mensagens_em_atendimento) || unread > 0);
  const showAtendimentoDot =
    isResponsavel &&
    isHumanAtendimentoRow &&
    (lastDir === "in" || hintNovaMsg);
  const rp = rowPrefs(chat);
  const showMutedIndicator = !isGroup && rp.silenciado;
  const showPinnedIndicator = !isGroup && rp.fixada;
  const showFavoriteIndicator = !isGroup && rp.favorita;
  const avatarSeed = displayName || phone || id || clienteId;
  const color = getAvatarColor(avatarSeed);
  const [imgError, setImgError] = useState(false);
  const [opening, setOpening] = useState(false);
  const showAvatarImg = Boolean(avatarUrl && !imgError);
  const setorLabelNome =
    !isGroup && chat?.departamento_id != null
      ? String(chat.setor ?? chat?.departamento?.nome ?? chat?.departamentos?.nome ?? "").trim()
      : "";

  useEffect(() => {
    setImgError(false);
  }, [avatarUrl]);

  function handleClick() {
    if (opening) return;
    if (semConversa && chat?.cliente_id) {
      setOpening(true);
      onOpenClienteSemConversa?.(chat.cliente_id)
        .finally(() => setOpening(false));
      return;
    }
    if (id == null || id === undefined || id === "") return;
    const normalizedId = Number(id) || String(id);
    setSelectedId(normalizedId);
    carregarConversa(normalizedId);
    setUnread(normalizedId, 0);
    onSelect?.(normalizedId);
  }

  function handleRowKeyDown(e) {
    if (opening) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    }
  }

  return (
    <div
      tabIndex={opening ? -1 : 0}
      className={`chat-list-row ${active ? "is-active" : ""} ${semConversa ? "chat-list-row-sem-conversa" : ""} ${unread > 0 ? "has-unread" : ""} ${atendimentoRowClass} ${atendimentoTechClass}`.trim()}
      onClick={handleClick}
      onKeyDown={handleRowKeyDown}
      aria-disabled={opening ? "true" : "false"}
      data-chat-id={id ?? undefined}
      data-cliente-id={clienteId ?? undefined}
      aria-label={`Conversa com ${displayName}`}
    >
      <div className="chat-list-avatar" style={{ background: showAvatarImg ? "transparent" : color }} aria-hidden="true">
        {showAvatarImg ? (
          <img
            src={avatarUrl}
            alt=""
            className="chat-list-avatar-img"
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
          />
        ) : (
          <span className="chat-list-avatar-text">
            {isGroup ? "👥" : hasName ? initials(displayName) : "#"}
          </span>
        )}
      </div>

      <div className="chat-list-row-main">
        <div className="chat-list-row-top">
          <div className="chat-list-row-title-wrap">
            <div className="chat-list-title-line">
              <div className="chat-list-title" title={displayName}>
                {displayName}
              </div>
              {showMutedIndicator ? <span className="chat-list-inline-indicator" title="Notificações silenciadas" aria-label="Notificações silenciadas">🔕</span> : null}
              {showPinnedIndicator ? <span className="chat-list-inline-indicator" title="Conversa fixada" aria-label="Conversa fixada">📌</span> : null}
              {showFavoriteIndicator ? <span className="chat-list-inline-indicator" title="Conversa favorita" aria-label="Conversa favorita">★</span> : null}
              {isGroup ? (
                <span className="chat-list-badge-grupo" title="Conversa de grupo">Grupo</span>
              ) : chat?.tags?.[0] ? (
                <TagMini tag={chat.tags[0]} />
              ) : null}
            </div>
            {!isGroup && setorLabelNome ? (
              <div className="chat-list-setor" title={`Setor: ${setorLabelNome}`}>
                {setorLabelNome}
              </div>
            ) : null}
            {!isGroup && empresa ? (
              <div className="chat-list-empresa" title={`Empresa: ${empresa}`}>
                {empresa}
              </div>
            ) : null}
          </div>
          <div className="chat-list-row-meta">
            <div className="chat-list-time">
              {opening ? "Abrindo…" : hora || (semConversa ? "" : "")}
              {!opening && !semConversa && mostrarEsperaMinutosAoLadoDoRelogio ? (
                <EsperaMinutosInline anchorIso={esperaMinutosAnchor} />
              ) : null}
            </div>
            {semConversa ? (
              <span className="chat-list-badge-sem-conversa" title="Clique para iniciar conversa">Sem conversa</span>
            ) : (
              <StatusPill
                status={statusEff}
                exibirBadgeAberta={chat?.exibir_badge_aberta}
                chat={chat}
                aguardandoFuncionario={isConversaAguardandoFuncionario(chat, pendentesFuncionarioSet)}
                esperaMinutosAnchorIso={esperaMinutosAnchor}
              />
            )}
          </div>
        </div>
        <div className="chat-list-row-mid">
          <div className="chat-list-midLeft">
            <div className="chat-list-preview-line">
              <div className="chat-list-preview" title={previewTitle}>
                {previewNode}
              </div>
              <AtendimentoUnreadDot show={showAtendimentoDot} />
            </div>
          </div>
          <UnreadBadge n={unread} />
        </div>
      </div>
      {!semConversa ? (
        <ConversationActionMenuTrigger
          conversationId={id}
          isOpen={isMenuOpen}
          onToggle={onToggleMenu}
        />
      ) : null}
    </div>
  );
}

const MemoChatRow = memo(ChatRow, (prev, next) => {
  const a = prev.chat || {};
  const b = next.chat || {};
  const pa = rowPrefs(a);
  const pb = rowPrefs(b);
  const semA = Boolean(a.sem_conversa && a.cliente_id);
  const semB = Boolean(b.sem_conversa && b.cliente_id);
  const setA = prev.pendentesFuncionarioSet;
  const setB = next.pendentesFuncionarioSet;
  const identityOk =
    semA && semB
      ? String(a.cliente_id) === String(b.cliente_id)
      : !semA && !semB
        ? String(a.id) === String(b.id)
        : false;
  return (
    identityOk &&
    prev.active === next.active &&
    prev.isMenuOpen === next.isMenuOpen &&
    Number(a.unread_count ?? a.unread ?? 0) === Number(b.unread_count ?? b.unread ?? 0) &&
    String(getStatusAtendimentoEffective(a)) === String(getStatusAtendimentoEffective(b)) &&
    String(a.status_atendimento_real ?? "") === String(b.status_atendimento_real ?? "") &&
    String(a.finalizacao_motivo ?? "") === String(b.finalizacao_motivo ?? "") &&
    Boolean(a.finalizada_automaticamente) === Boolean(b.finalizada_automaticamente) &&
    String(a.aguardando_cliente_desde ?? "") === String(b.aguardando_cliente_desde ?? "") &&
    String(a.ui_hint_reaberto_ausencia_cliente ?? "") === String(b.ui_hint_reaberto_ausencia_cliente ?? "") &&
    Boolean(a.exibir_badge_aberta) === Boolean(b.exibir_badge_aberta) &&
    pa.silenciado === pb.silenciado &&
    pa.fixada === pb.fixada &&
    pa.favorita === pb.favorita &&
    Boolean(a.tem_novas_mensagens_em_atendimento) === Boolean(b.tem_novas_mensagens_em_atendimento) &&
    String(a.atendente_id ?? "") === String(b.atendente_id ?? "") &&
    getLastDirection(a) === getLastDirection(b) &&
    String(a.ultima_atividade ?? "") === String(b.ultima_atividade ?? "") &&
    String(a?.ultima_mensagem?.id ?? a?.ultima_mensagem?.whatsapp_id ?? "") ===
      String(b?.ultima_mensagem?.id ?? b?.ultima_mensagem?.whatsapp_id ?? "") &&
    semA === semB &&
    setA === setB &&
    isConversaAguardandoFuncionario(a, setA) === isConversaAguardandoFuncionario(b, setB) &&
    esperaMinutosAnchorKey(a, setA) === esperaMinutosAnchorKey(b, setB) &&
    atendimentoRowVisualClass(a, setA, semA, useAuthStore.getState().user?.id) ===
      atendimentoRowVisualClass(b, setB, semB, useAuthStore.getState().user?.id) &&
    isEmAtendimentoUltimaDoCliente(a) === isEmAtendimentoUltimaDoCliente(b)
  );
});

/* =====================================================
   COMPONENTE PRINCIPAL (lógica mantida)
===================================================== */

export default function ChatList() {
  const chats = useChatStore((s) => s.chats || []);
  const setChats = useChatStore((s) => s.setChats);
  const setLoading = useChatStore((s) => s.setLoading);
  const setUnread = useChatStore((s) => s.setUnread);
  const addChat = useChatStore((s) => s.addChat);
  const loading = useChatStore((s) => s.loading);
  const chatListScrollToTopNonce = useChatStore((s) => s.chatListScrollToTopNonce ?? 0);

  const navigate = useNavigate();
  const location = useLocation();

  const carregarConversa = useConversaStore((s) => s.carregarConversa);
  const setSelectedId = useConversaStore((s) => s.setSelectedId);
  const selectedId = useConversaStore((s) => s.selectedId);
  const queueComposerAppend = useConversaStore((s) => s.queueComposerAppend);

  const user = useAuthStore((s) => s.user);
  /** Empresa com opção ativa (GET /usuarios/me + login). Desligado: sem chip nem API de contagem. */
  const separarMensagensDisparadasLigado = user?.separar_mensagens_disparadas === true;
  const userRole = String(user?.role || user?.perfil || "").toLowerCase();
  const canConsultarProdutos = ["admin", "supervisor", "atendente"].includes(userRole);
  const canVerSyncProdutos = ["admin", "supervisor"].includes(userRole);
  const canSincronizarProdutos = userRole === "admin";

  const {
    selectedUserId: adminAtendenteFilterId,
    setSelectedUserId: setAdminAtendenteFilterId,
    panelOpen: adminAtendentePanelOpen,
    setPanelOpen: setAdminAtendentePanelOpen,
    clearSelection: clearAdminAtendenteFilter,
  } = useAdminAtendenteFilter();

  const searchRef = useRef(null);

  const scrollRef = useRef(null);
  const scrollSaveRef = useRef(0);
  const scrollTopNoncePrevRef = useRef(0);
  const loadRequestIdRef = useRef(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => { scrollSaveRef.current = el.scrollTop; };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // busca: termo debounced no pai (filtro); digitação fica no filho para não re-renderizar a lista inteira
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [searchClearNonce, setSearchClearNonce] = useState(0);
  const handleSearchDebounced = useCallback((t) => {
    setDebouncedSearch(t);
  }, []);

  const [statusFilter, setStatusFilter] = useState("todos");
  const [allTags, setAllTags] = useState([]);
  const [tagFilter, setTagFilter] = useState("todas");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [atendentes, setAtendentes] = useState([]);
  const [atendenteFilter, setAtendenteFilter] = useState("todos");
  const [departamentos, setDepartamentos] = useState([]);
  const [departamentoFilter, setDepartamentoFilter] = useState("todos");
  const [mineOnly, setMineOnly] = useState(false);
  const [order, setOrder] = useState("recentes");
  const [showFilters, setShowFilters] = useState(false);
  /** Filtro avançado: conversas fechadas com finalização por ausência (reforça query GET /chats). */
  const [onlyFinalizadasAusencia, setOnlyFinalizadasAusencia] = useState(false);
  /** Filtro avançado: conversas em atendimento com humano aguardando resposta do cliente. */
  const [aguardandoClienteOnly, setAguardandoClienteOnly] = useState(false);
  /** GET /chats?tempo_parado= — conversas com aguardando_cliente_desde acima do limite (backend). */
  const [tempoParadoFilter, setTempoParadoFilter] = useState("");
  const [loteAusenciaBusy, setLoteAusenciaBusy] = useState(false);
  const [loteAusenciaMsg, setLoteAusenciaMsg] = useState("");
  const [loteAusenciaConfirm, setLoteAusenciaConfirm] = useState("");

  const [novoContatoModalOpen, setNovoContatoModalOpen] = useState(false);
  const [showProdutosPanel, setShowProdutosPanel] = useState(false);
  const [confirmClear, setConfirmClear] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  // menu "Novo" (botão +)
  const [showNovoMenu, setShowNovoMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const novoBtnRef = useRef(null);
  const novoMenuRef = useRef(null);

  // tabs estilo WhatsApp (chip row)
  // todas | hoje | abertas | minha_fila | em_atendimento | finalizadas | finalizadas_auto | aguardando_cliente | aguardando_funcionario
  const [tab, setTab] = useState("minha_fila");
  const tabRef = useRef(tab);
  tabRef.current = tab;

  useEffect(() => {
    if (tab === "nao_lidas") setTab("todas");
  }, [tab]);

  useEffect(() => {
    if (!isSupervisorOrAdmin(user) && tab === "aguardando_funcionario") {
      setTab("minha_fila");
    }
  }, [user, tab]);

  useEffect(() => {
    if (!separarMensagensDisparadasLigado && tab === "mensagens_disparadas") {
      setTab("minha_fila");
    }
  }, [separarMensagensDisparadasLigado, tab]);

  useEffect(() => {
    if (!separarMensagensDisparadasLigado && statusFilter === "mensagem_disparada") {
      setStatusFilter("todos");
    }
  }, [separarMensagensDisparadasLigado, statusFilter]);

  /** GET /chats?minha_fila=1 — fila do atendente (abertas + em atendimento comigo); sem status_atendimento na query. */
  const [minhaFilaList, setMinhaFilaList] = useState(null);
  const [minhaFilaCount, setMinhaFilaCount] = useState(0);
  /** Contador do chip “Em atendimento”: sempre GET /chats?status_atendimento=em_atendimento (escopo backend). */
  const [emAtendimentoBadgeCount, setEmAtendimentoBadgeCount] = useState(0);
  /** Contador do chip “Aguardando cliente”: sempre GET /chats?aguardando_cliente=1 (escopo do backend), nunca length de “Todas”. */
  const [aguardandoClienteBadgeCount, setAguardandoClienteBadgeCount] = useState(0);
  /** Contador do chip “Mensagens Disparadas”: GET /chats?status_atendimento=mensagem_disparada (escopo backend). */
  const [mensagensDisparadasCount, setMensagensDisparadasCount] = useState(0);
  /** Supervisão: resumo para badge e lista de conversas pendentes do funcionário. */
  const [supervisaoResumo, setSupervisaoResumo] = useState(null);
  const [pendentesFuncionarioIds, setPendentesFuncionarioIds] = useState([]);
  const pendentesFuncionarioSet = useMemo(
    () => new Set((pendentesFuncionarioIds || []).map((x) => String(x))),
    [pendentesFuncionarioIds]
  );

  // Status de conexão Z-API: null=não verificado, true=conectado, false=desconectado
  const [zapiConnected, setZapiConnected] = useState(null);
  const [zapiStatusLoaded, setZapiStatusLoaded] = useState(false);

  const showToast = useNotificationStore((s) => s.showToast);
  useEffect(() => {
    if (location.state?.openNovoContatoModal) {
      setNovoContatoModalOpen(true);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, location.pathname, navigate]);

  useEffect(() => {
    setAdminAtendentePanelOpen(false);
  }, [location.pathname, setAdminAtendentePanelOpen]);

  useEffect(() => {
    if (!isAppAdmin(user)) clearAdminAtendenteFilter();
  }, [user?.perfil, user?.role, clearAdminAtendenteFilter]);

  // Na montagem: conexão Z-API + sync contatos (nomes corretos) + fotos — em background
  useEffect(() => {
    let cancelled = false;

    getZapiStatus()
      .then((s) => {
        if (cancelled) return;
        setZapiConnected(s?.connected === true);
        setZapiStatusLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setZapiStatusLoaded(true);
      });

    sincronizarFotosPerfil().catch(() => {});

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Atualização automática da lista (nomes, novas conversas) a cada 5 min — evita "refresh" constante
  useEffect(() => {
    const interval = setInterval(() => loadRef.current?.(), 300_000);
    return () => clearInterval(interval);
  }, []);

  const refreshMinhaFila = useCallback(async () => {
    try {
      const t = tabRef.current;
      const finalAutoQuery = t === "finalizadas_auto" || onlyFinalizadasAusencia;
      /** Só minha_fila=1 aqui — nunca misturar com aguardando_cliente (endpoint com escopo próprio). */
      const params = {
        minha_fila: true,
        tag_id: tagFilter !== "todas" ? tagFilter : undefined,
        departamento_id: departamentoFilter !== "todos" ? departamentoFilter : undefined,
        atendente_id: atendenteFilter !== "todos" ? atendenteFilter : undefined,
        data_inicio: dataInicio || undefined,
        data_fim: dataFim || undefined,
        incluir_todos_clientes: "1",
      };
      if (finalAutoQuery) {
        params.status_atendimento = "fechada";
        params.finalizacao_motivo = "ausencia_cliente";
      }
      if (tempoParadoFilter) params.tempo_parado = tempoParadoFilter;
      const data = await fetchChats(params);
      const list = Array.isArray(data) ? data : [];
      setMinhaFilaCount(countDistinctConversas(list));
      if (tabRef.current === "minha_fila") {
        setMinhaFilaList(list);
      }
    } catch (e) {
      console.error("Erro ao carregar Minha fila:", e);
      setMinhaFilaCount(0);
      if (tabRef.current === "minha_fila") {
        setMinhaFilaList([]);
      }
    }
  }, [tagFilter, departamentoFilter, atendenteFilter, dataInicio, dataFim, onlyFinalizadasAusencia, tempoParadoFilter]);

  const refreshEmAtendimentoBadge = useCallback(async () => {
    try {
      const adminPorFuncionario =
        adminAtendenteFilterId != null && String(adminAtendenteFilterId).trim() !== "";
      let params;
      if (adminPorFuncionario) {
        const aid = Number(adminAtendenteFilterId);
        const atendenteIdQuery =
          Number.isFinite(aid) && aid > 0 ? aid : adminAtendenteFilterId;
        params = {
          status_atendimento: "em_atendimento",
          atendente_id: atendenteIdQuery,
          tag_id: tagFilter !== "todas" ? tagFilter : undefined,
          departamento_id: departamentoFilter !== "todos" ? departamentoFilter : undefined,
          data_inicio: dataInicio || undefined,
          data_fim: dataFim || undefined,
          incluir_todos_clientes: "1",
        };
      } else {
        params = {
          status_atendimento: "em_atendimento",
          tag_id: tagFilter !== "todas" ? tagFilter : undefined,
          departamento_id: departamentoFilter !== "todos" ? departamentoFilter : undefined,
          data_inicio: dataInicio || undefined,
          data_fim: dataFim || undefined,
          incluir_todos_clientes: "1",
        };
      }
      const data = await fetchChats(params);
      const list = Array.isArray(data) ? data : [];
      const apenasEmAtendimento = list.filter((c) => isConversaEmAtendimentoBadge(c));
      setEmAtendimentoBadgeCount(countDistinctConversas(apenasEmAtendimento));
    } catch (e) {
      console.error("Erro ao carregar contagem Em atendimento:", e);
      setEmAtendimentoBadgeCount(0);
    }
  }, [
    adminAtendenteFilterId,
    tagFilter,
    departamentoFilter,
    dataInicio,
    dataFim,
  ]);

  const refreshAguardandoClienteBadge = useCallback(async () => {
    try {
      const adminPorFuncionario =
        adminAtendenteFilterId != null && String(adminAtendenteFilterId).trim() !== "";
      let params;
      if (adminPorFuncionario) {
        const aid = Number(adminAtendenteFilterId);
        const atendenteIdQuery =
          Number.isFinite(aid) && aid > 0 ? aid : adminAtendenteFilterId;
        params = {
          aguardando_cliente: "1",
          atendente_id: atendenteIdQuery,
          tag_id: tagFilter !== "todas" ? tagFilter : undefined,
          departamento_id: departamentoFilter !== "todos" ? departamentoFilter : undefined,
          data_inicio: dataInicio || undefined,
          data_fim: dataFim || undefined,
          incluir_todos_clientes: "1",
        };
      } else {
        // Sem "Por funcionário": respeitar escopo padrão da sessão no backend.
        params = {
          aguardando_cliente: "1",
          tag_id: tagFilter !== "todas" ? tagFilter : undefined,
          departamento_id: departamentoFilter !== "todos" ? departamentoFilter : undefined,
          data_inicio: dataInicio || undefined,
          data_fim: dataFim || undefined,
          incluir_todos_clientes: "1",
        };
      }
      const data = await fetchChats(params);
      const list = Array.isArray(data) ? data : [];
      const apenasAguardando = list.filter((c) => isConversaAguardandoCliente(c));
      setAguardandoClienteBadgeCount(countDistinctConversas(apenasAguardando));
    } catch (e) {
      console.error("Erro ao carregar contagem Aguardando cliente:", e);
      setAguardandoClienteBadgeCount(0);
    }
  }, [
    adminAtendenteFilterId,
    tagFilter,
    departamentoFilter,
    atendenteFilter,
    dataInicio,
    dataFim,
  ]);

  const refreshMensagensDisparadasBadge = useCallback(async () => {
    if (!separarMensagensDisparadasLigado) {
      setMensagensDisparadasCount(0);
      return;
    }
    try {
      const params = {
        status_atendimento: "mensagem_disparada",
        tag_id: tagFilter !== "todas" ? tagFilter : undefined,
        departamento_id: departamentoFilter !== "todos" ? departamentoFilter : undefined,
        data_inicio: dataInicio || undefined,
        data_fim: dataFim || undefined,
        incluir_todos_clientes: "0",
      };
      const data = await fetchChats(params);
      const list = Array.isArray(data) ? data : [];
      setMensagensDisparadasCount(countDistinctConversas(list));
    } catch (e) {
      console.error("Erro ao carregar contagem Mensagens Disparadas:", e);
      setMensagensDisparadasCount(0);
    }
  }, [tagFilter, departamentoFilter, dataInicio, dataFim, separarMensagensDisparadasLigado]);

  const refreshSupervisaoData = useCallback(async () => {
    if (!isSupervisorOrAdmin(user)) {
      setSupervisaoResumo(null);
      setPendentesFuncionarioIds([]);
      return;
    }
    try {
      const [resumoData, pendentesData] = await Promise.all([
        getResumoSupervisao(),
        getClientesPendentesSupervisao(),
      ]);
      setSupervisaoResumo(resumoData || {});
      const ids = (Array.isArray(pendentesData) ? pendentesData : [])
        .map((item) => String(item?.conversa_id ?? item?.conversaId ?? ""))
        .filter(Boolean);
      setPendentesFuncionarioIds(ids);
    } catch {
      setPendentesFuncionarioIds([]);
    }
  }, [user]);

  useEffect(() => {
    if (!isSupervisorOrAdmin(user)) return undefined;
    void refreshSupervisaoData();
    const interval = setInterval(() => {
      void refreshSupervisaoData();
    }, 30000);
    return () => clearInterval(interval);
  }, [user, refreshSupervisaoData]);

  async function load() {
    const requestId = ++loadRequestIdRef.current;
    setLoading(true);
    try {
      /** Modo admin por funcionário: prioridade sobre status/minha_fila/atendente dos filtros avançados — ver chatsFiltrados. */
      const adminPorFuncionario =
        adminAtendenteFilterId != null && String(adminAtendenteFilterId).trim() !== "";

      const finalAutoQuery = tab === "finalizadas_auto" || onlyFinalizadasAusencia;
      const aguardandoQuery = tab === "aguardando_cliente" || aguardandoClienteOnly;

      let params;
      if (adminPorFuncionario) {
        /** Contrato API: `atendente_id` numérico (usuarios.id); omitir status_atendimento / minha_fila. */
        const aid = Number(adminAtendenteFilterId);
        const atendenteIdQuery =
          Number.isFinite(aid) && aid > 0 ? aid : adminAtendenteFilterId;
        params = {
          atendente_id: atendenteIdQuery,
          tag_id: tagFilter !== "todas" ? tagFilter : undefined,
          departamento_id: departamentoFilter !== "todos" ? departamentoFilter : undefined,
          data_inicio: dataInicio || undefined,
          data_fim: dataFim || undefined,
          incluir_todos_clientes: "1",
        };
        if (finalAutoQuery) {
          params.finalizacao_motivo = "ausencia_cliente";
        }
        if (aguardandoQuery) {
          params.aguardando_cliente = "1";
        }
      } else {
        params = {
          tag_id: tagFilter !== "todas" ? tagFilter : undefined,
          departamento_id: departamentoFilter !== "todos" ? departamentoFilter : undefined,
          status_atendimento: statusFilter !== "todos" ? statusFilter : undefined,
          atendente_id: atendenteFilter !== "todos" ? atendenteFilter : undefined,
          data_inicio: dataInicio || undefined,
          data_fim: dataFim || undefined,
          incluir_todos_clientes: "1",
        };
        if (aguardandoQuery) {
          params.aguardando_cliente = "1";
          delete params.status_atendimento;
          // Escopo por sessão; atendente_id só quando gestor usa "Por funcionário".
          delete params.atendente_id;
        } else if (finalAutoQuery) {
          params.status_atendimento = "fechada";
          params.finalizacao_motivo = "ausencia_cliente";
        } else if (tab === "abertas") {
          params.status_atendimento = "aberta";
        } else if (tab === "mensagens_disparadas" && separarMensagensDisparadasLigado) {
          params.status_atendimento = "mensagem_disparada";
        }
      }

      if (tempoParadoFilter) params.tempo_parado = tempoParadoFilter;

      /** Lista estrita: só o que a API devolveu — o merge com `prev` não pode reintroduzir conversas de outras abas. */
      const strictMensagemDisparadaQuery =
        separarMensagensDisparadasLigado &&
        String(params.status_atendimento || "").toLowerCase() === "mensagem_disparada";

      const data = await fetchChats(params);
      if (requestId !== loadRequestIdRef.current) return;
      let list = Array.isArray(data) ? data : [];
      if (!adminPorFuncionario && mineOnly && user?.id && !isAppAdmin(user)) {
        list = list.filter((c) => String(c.atendente_id) === String(user.id));
      }
      // Desduplicar por id (conversas) ou por cliente_id (clientes sem conversa) — NÃO descartar itens com id null
      const byKey = new Map();
      list.forEach((c) => {
        const key = c?.id != null ? `conv-${c.id}` : (c?.cliente_id != null ? `cliente-${c.cliente_id}` : `tel-${c?.telefone ?? Math.random()}`);
        if (!byKey.has(key)) byKey.set(key, c);
      });
      list = Array.from(byKey.values());
      const getTs = (c) =>
        c?.ultima_mensagem?.criado_em ||
        getLastMessage(c)?.criado_em ||
        c?.ultima_atividade ||
        c?.criado_em ||
        0;
      list.sort((a, b) =>
        order === "antigas"
          ? new Date(getTs(a)) - new Date(getTs(b))
          : new Date(getTs(b)) - new Date(getTs(a))
      );
      // Merge defensivo: nunca sobrescrever contato_nome/foto_perfil com undefined ou string vazia. Preserva chats locais não retornados pela API.
      setChats((prev) => {
        if (requestId !== loadRequestIdRef.current) return prev;
        const arr = Array.isArray(prev) ? prev : [];
        const byIdPrev = new Map(arr.map((c) => [String(c.id), c]));
        const fromApi = new Set(list.map((c) => String(c?.id)).filter(Boolean));
        const nomeUsuario = (user?.nome ?? user?.name ?? "").trim().toLowerCase();
        const merged = list.map((c) => {
          const existing = c?.id != null ? byIdPrev.get(String(c.id)) : null;
          let nomeApi = (c?.contato_nome ?? c?.nome ?? "").trim();
          const nomeContatoCache = (c?.nome_contato_cache ?? "").trim();
          const nomeCliente = (c?.cliente?.nome ?? c?.clientes?.nome ?? "").trim();
          if (nomeUsuario && nomeApi.toLowerCase() === nomeUsuario) {
            nomeApi = nomeContatoCache || nomeCliente || nomeApi;
          }
          const nomeJaExiste = (existing?.contato_nome || existing?.nome || "").trim();
          const contato_nome = nomeApi || nomeJaExiste || nomeContatoCache || nomeCliente || existing?.contato_nome || c?.contato_nome || c?.nome;
          const fotoApi = c?.foto_perfil != null && String(c.foto_perfil).trim().startsWith("http") ? String(c.foto_perfil).trim() : null;
          const fotoExisting = existing?.foto_perfil && String(existing.foto_perfil).trim().startsWith("http") ? String(existing.foto_perfil).trim() : null;
          const foto_perfil = fotoApi ?? (c?.foto_perfil === null ? null : fotoExisting);
          const uApi = c?.ultima_mensagem;
          const uPrev = existing?.ultima_mensagem;
          const sameMsg = uPrev && uApi && (String(uPrev.id) === String(uApi.id) || String(uPrev.whatsapp_id) === String(uApi.whatsapp_id) || (uPrev.criado_em && uApi.criado_em && String(uPrev.criado_em) === String(uApi.criado_em)));
          const ultima = (sameMsg && uPrev) ? { ...uApi, ...uPrev } : uApi || uPrev;
          return {
            ...c,
            contato_nome,
            foto_perfil,
            nome_grupo: c?.nome_grupo || existing?.nome_grupo,
            cliente: c?.cliente || existing?.cliente,
            ultima_mensagem: ultima,
            ultima_atividade: ultima?.criado_em || c?.ultima_atividade || existing?.ultima_atividade,
          };
        });
        const extra = arr.filter((c) => c?.id != null && !fromApi.has(String(c.id)));
        // Em consultas de "aguardando_cliente", não reaproveitar conversas antigas fora do filtro.
        if (aguardandoQuery) return merged;
        // Com filtro de tempo parado, a API já define o subconjunto; não misturar itens locais fora do critério.
        if (tempoParadoFilter) return merged;
        // "Mensagens disparadas" (chip ou status avançado): alinhar lista ao contador — sem centenas da aba anterior.
        if (strictMensagemDisparadaQuery) return merged;
        if (extra.length === 0) return merged;
        const getTs = (x) => x?.ultima_mensagem?.criado_em || x?.ultima_atividade || x?.criado_em || 0;
        const combined = [...merged, ...extra];
        combined.sort((a, b) => (order === "antigas" ? getTs(a) - getTs(b) : getTs(b) - getTs(a)));
        return combined;
      });
      const rid = requestId;
      const runSecondaryRefreshes = () => {
        if (rid !== loadRequestIdRef.current) return;
        void refreshMinhaFila();
        void refreshEmAtendimentoBadge();
        void refreshAguardandoClienteBadge();
        void refreshMensagensDisparadasBadge();
        void refreshSupervisaoData();
      };
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => {
          requestAnimationFrame(runSecondaryRefreshes);
        });
      } else {
        setTimeout(runSecondaryRefreshes, 0);
      }
    } catch (e) {
      if (requestId !== loadRequestIdRef.current) return;
      console.error("Erro ao carregar conversas:", e);
      setChats([]);
    } finally {
      if (requestId === loadRequestIdRef.current) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    load();
  }, [
    tab,
    tagFilter,
    departamentoFilter,
    statusFilter,
    atendenteFilter,
    dataInicio,
    dataFim,
    mineOnly,
    order,
    adminAtendenteFilterId,
    onlyFinalizadasAusencia,
    aguardandoClienteOnly,
    tempoParadoFilter,
    refreshSupervisaoData,
    separarMensagensDisparadasLigado,
  ]);

  // loadRef para sync/interval — deve estar definido antes dos effects que o usam
  const loadRef = useRef(load);
  loadRef.current = load;

  const handleLoteAusenciaSimular = useCallback(async () => {
    setLoteAusenciaMsg("");
    const ids = collectEmAtendimentoIdsFromChats(useChatStore.getState().chats);
    if (!ids.length) {
      setLoteAusenciaMsg("Nenhuma conversa em atendimento na lista atual.");
      return;
    }
    setLoteAusenciaBusy(true);
    try {
      const r = await postFinalizacaoAusenciaLote({ conversa_ids: ids, dry_run: true });
      const res = Array.isArray(r?.resultados) ? r.resultados : [];
      const ok = res.filter((x) => x.ok).length;
      setLoteAusenciaMsg(`Simulação: ${ok} de ${ids.length} conversa(s) elegível(is) ao critério do servidor.`);
    } catch (e) {
      const msg = e?.response?.data?.error || e?.message || "Falha na simulação";
      showToast({ type: "error", title: "Lote por ausência", message: String(msg) });
      setLoteAusenciaMsg(String(msg));
    } finally {
      setLoteAusenciaBusy(false);
    }
  }, [showToast]);

  const handleLoteAusenciaExecutar = useCallback(async () => {
    setLoteAusenciaMsg("");
    const ids = collectEmAtendimentoIdsFromChats(useChatStore.getState().chats);
    if (!ids.length) {
      setLoteAusenciaMsg("Nenhuma conversa em atendimento na lista atual.");
      return;
    }
    if (String(loteAusenciaConfirm).trim() !== CONFIRM_LOTE_AUSENCIA) {
      showToast({
        type: "info",
        title: "Confirmação necessária",
        message: `Digite exatamente: ${CONFIRM_LOTE_AUSENCIA}`,
      });
      return;
    }
    setLoteAusenciaBusy(true);
    try {
      const r = await postFinalizacaoAusenciaLote({
        conversa_ids: ids,
        dry_run: false,
        execute: true,
        confirm: CONFIRM_LOTE_AUSENCIA,
      });
      const res = Array.isArray(r?.resultados) ? r.resultados : [];
      const ok = res.filter((x) => x.ok).length;
      setLoteAusenciaMsg(`Concluído: ${ok} conversa(s) processada(s).`);
      setLoteAusenciaConfirm("");
      loadRef.current?.();
    } catch (e) {
      const msg = e?.response?.data?.error || e?.message || "Falha na execução";
      showToast({ type: "error", title: "Lote por ausência", message: String(msg) });
      setLoteAusenciaMsg(String(msg));
    } finally {
      setLoteAusenciaBusy(false);
    }
  }, [showToast, loteAusenciaConfirm]);

  const chatListResyncNonce = useChatStore((s) => s.chatListResyncNonce);
  useEffect(() => {
    if (!chatListResyncNonce) return;
    loadRef.current?.();
  }, [chatListResyncNonce]);

  useEffect(() => {
    function onSyncContatos() {
      loadRef.current?.();
    }
    window.addEventListener("zapi_sync_contatos", onSyncContatos);
    return () => window.removeEventListener("zapi_sync_contatos", onSyncContatos);
  }, []);

  useEffect(() => {
    listarTags().then(setAllTags).catch(() => setAllTags([]));
  }, []);

  useEffect(() => {
    api.get("/usuarios").then((r) => setAtendentes(r.data || [])).catch(() => setAtendentes([]));
  }, []);
  useEffect(() => {
    api.get("/dashboard/departamentos").then((r) => setDepartamentos(r.data || [])).catch(() => setDepartamentos([]));
  }, []);

  // atalhos
  useEffect(() => {
    function onKeyDown(e) {
      const k = e.key.toLowerCase();

      if (e.ctrlKey && k === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }

      if (e.ctrlKey && k === "f") {
        e.preventDefault();
        setShowFilters((v) => !v);
      }

      if (k === "escape") {
        if (novoContatoModalOpen) {
          setNovoContatoModalOpen(false);
          return;
        }
        if (adminAtendentePanelOpen) {
          setAdminAtendentePanelOpen(false);
          return;
        }
        // ESC: fecha filtros e limpa busca
        clearAdminAtendenteFilter();
        setShowFilters(false);
        setSearchClearNonce((n) => n + 1);
        setDebouncedSearch("");
        setStatusFilter("todos");
        setTagFilter("todas");
        setDepartamentoFilter("todos");
        setMineOnly(false);
        setOrder("recentes");
        setTab("minha_fila");
        setTempoParadoFilter("");
        setLoteAusenciaMsg("");
        setLoteAusenciaConfirm("");
        setShowNovoMenu(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    novoContatoModalOpen,
    adminAtendentePanelOpen,
    setAdminAtendentePanelOpen,
    clearAdminAtendenteFilter,
  ]);

  // posiciona menu abaixo do botão Novo
  useEffect(() => {
    if (!showNovoMenu || !novoBtnRef.current) return;
    const btn = novoBtnRef.current;
    const rect = btn.getBoundingClientRect();
    setMenuPosition({
      top: rect.bottom + 4,
      left: rect.right - 200,
    });
  }, [showNovoMenu]);

  // fecha menu "Novo" ao clicar fora
  useEffect(() => {
    if (!showNovoMenu) return;

    function onMouseDown(e) {
      const btn = novoBtnRef.current;
      const menu = novoMenuRef.current;
      const target = e.target;
      if (!target) return;

      if (btn && btn.contains(target)) return;
      if (menu && menu.contains(target)) return;

      setShowNovoMenu(false);
    }

    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, [showNovoMenu]);

  function emitNovoAction(type) {
    setShowNovoMenu(false);

    if (type === "novo_contato") {
      setNovoContatoModalOpen(true);
      return;
    }

    const routes = {
      novo_grupo: "/atendimento/novo-grupo",
      nova_comunidade: "/atendimento/nova-comunidade",
    };

    const path = routes[type];
    if (path) navigate(path);
  }

  function handleSelecionarConversa(chatId) {
    if (chatId == null || chatId === undefined || chatId === "") return;
    const id = Number(chatId) || String(chatId);
    /* Mobile: evita “flash” da lista em posição antiga antes do layout da conversa —
       recentes ficam no topo; ao voltar, o usuário vê o topo e pode rolar para baixo. */
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches) {
      scrollSaveRef.current = 0;
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }
    setSelectedId(id);
    carregarConversa(id);
    setUnread(id, 0);
  }

  async function handleOpenClienteSemConversa(cliente_id) {
    if (!cliente_id) return;
    try {
      const { conversa } = await abrirConversaCliente(cliente_id);
      if (conversa?.id) {
        addChat(conversa);
        if (typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches) {
          scrollSaveRef.current = 0;
          if (scrollRef.current) scrollRef.current.scrollTop = 0;
        }
        setSelectedId(conversa.id);
        carregarConversa(conversa.id);
        setUnread(conversa.id, 0);
      }
    } catch (e) {
      console.error("Erro ao abrir conversa do cliente:", e);
    }
  }

  const chatsFiltrados = useMemo(() => {
    /**
     * Filtro admin por funcionário (GET só com atendente_id): ignora chips de aba e minha_fila — prioridade única no fetch e aqui.
     */
    const adminPorFuncionario =
      adminAtendenteFilterId != null && String(adminAtendenteFilterId).trim() !== "";

    let list = adminPorFuncionario
      ? [...(Array.isArray(chats) ? chats : [])]
      : tab === "minha_fila"
        ? mergeMinhaFilaPrefsFromChats([...(Array.isArray(minhaFilaList) ? minhaFilaList : [])], chats)
        : Array.isArray(chats)
          ? [...chats]
          : [];

    // tabs rápidas (minha_fila vem filtrada do backend com minha_fila=1); desativadas no modo adminPorFuncionario
    if (!adminPorFuncionario) {
      if (tab === "hoje") {
        list = list.filter((c) => {
          const last = getLastMessage(c);
          const ts = last?.criado_em || c?.criado_em;
          return isToday(ts);
        });
      } else if (tab === "abertas") {
        list = list.filter((c) => conversaContaComoAbertaNoChip(c));
      } else if (tab === "em_atendimento") {
        list = list.filter((c) => getStatusAtendimentoEffective(c) === "em_atendimento");
      } else if (tab === "finalizadas") {
        list = list.filter((c) => getStatusAtendimentoEffective(c) === "fechada");
      } else if (tab === "finalizadas_auto") {
        list = list.filter(
          (c) =>
            getStatusAtendimentoEffective(c) === "fechada" &&
            (String(c?.finalizacao_motivo) === "ausencia_cliente" || c?.finalizada_automaticamente === true)
        );
      } else if (tab === "aguardando_cliente") {
        list = list.filter((c) => {
          if (isAguardandoClienteManual(c) && c?.atendente_id != null) return true;
          return (
            getStatusAtendimentoEffective(c) === "em_atendimento" &&
            c?.aguardando_cliente_desde != null &&
            c?.atendente_id != null
          );
        });
      } else if (tab === "aguardando_funcionario") {
        list = list.filter((c) => pendentesFuncionarioSet.has(String(c?.id ?? "")));
      }
    }

    if (adminPorFuncionario) {
      if (tab === "abertas") {
        list = list.filter((c) => conversaContaComoAbertaNoChip(c));
      }
      if (tab === "finalizadas_auto" || onlyFinalizadasAusencia) {
        list = list.filter(
          (c) =>
            getStatusAtendimentoEffective(c) === "fechada" &&
            (String(c?.finalizacao_motivo) === "ausencia_cliente" || c?.finalizada_automaticamente === true)
        );
      }
    }

    const skipStatusFilterRow =
      tab === "abertas" ||
      tab === "mensagens_disparadas" ||
      tab === "finalizadas_auto" ||
      onlyFinalizadasAusencia ||
      tab === "aguardando_cliente" ||
      aguardandoClienteOnly;

    // filtros avançados — status (no modo admin: omitir status na API; aqui não reaplicar o select para não esconder estados)
    if (adminPorFuncionario) {
      list = list.filter((c) => conversaMatchesAdminAtendenteFilter(c, adminAtendenteFilterId));
    } else if (statusFilter !== "todos" && !skipStatusFilterRow) {
      list = list.filter((c) => getStatusAtendimentoEffective(c) === statusFilter);
    }

    if (!adminPorFuncionario && onlyFinalizadasAusencia && tab !== "finalizadas_auto") {
      list = list.filter(
        (c) =>
          getStatusAtendimentoEffective(c) === "fechada" &&
          (String(c?.finalizacao_motivo) === "ausencia_cliente" || c?.finalizada_automaticamente === true)
      );
    }
    if (!adminPorFuncionario && aguardandoClienteOnly && tab !== "aguardando_cliente") {
      list = list.filter((c) => {
        if (isAguardandoClienteManual(c) && c?.atendente_id != null) return true;
        return (
          getStatusAtendimentoEffective(c) === "em_atendimento" &&
          c?.aguardando_cliente_desde != null &&
          c?.atendente_id != null
        );
      });
    }
    if (tagFilter !== "todas") {
      list = list.filter((c) =>
        (c?.tags || []).some((t) => String(t.id) === String(tagFilter))
      );
    }

    if (mineOnly && user?.id && !adminPorFuncionario) {
      list = list.filter((c) => String(c.atendente_id) === String(user.id));
    }

    // Filtros por setor/atendente: alinhar lista ao estado local após Socket (ex.: departamento_id vira null)
    if (isAppAdmin(user) && departamentoFilter !== "todos") {
      list = list.filter((c) => String(c?.departamento_id ?? "") === String(departamentoFilter));
    }
    if (!adminPorFuncionario && atendenteFilter !== "todos" && !aguardandoClienteOnly && tab !== "aguardando_cliente") {
      list = list.filter((c) => String(c?.atendente_id ?? "") === String(atendenteFilter));
    }

    // busca
    const termRaw = String(debouncedSearch || "").trim();
    const term = termRaw.toLowerCase();
    const termDigits = digitsOnly(termRaw);
    if (term) {
      list = list.filter((c) => {
        const title = getDisplayName(c).toLowerCase();
        const phone = String(getPhone(c) || "").toLowerCase();
        const telRaw =
          c?.telefone_exibivel ||
          c?.cliente_telefone ||
          c?.telefone ||
          "";
        const telDigits = digitsOnly(telRaw);

        const matchName = title.includes(term);
        const matchPhone =
          termDigits &&
          (digitsOnly(phone).includes(termDigits) || telDigits.includes(termDigits));

        return matchName || matchPhone;
      });
    }

    // ordenação: apenas por data (mais recente no topo) — contador de não lidas no item não altera a ordem
    list.sort((a, b) => {
      const aPinned = a?.fixada === true ? 1 : 0;
      const bPinned = b?.fixada === true ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      if (a?.sem_conversa && !b?.sem_conversa) return 1;
      if (!a?.sem_conversa && b?.sem_conversa) return -1;
      if (a?.sem_conversa && b?.sem_conversa) {
        const na = (a.contato_nome || "").toString().toLowerCase();
        const nb = (b.contato_nome || "").toString().toLowerCase();
        return na.localeCompare(nb);
      }
      const aTs = new Date(
        a?.ultima_mensagem?.criado_em || getLastMessage(a)?.criado_em || a?.ultima_atividade || a?.criado_em || 0
      ).getTime();
      const bTs = new Date(
        b?.ultima_mensagem?.criado_em || getLastMessage(b)?.criado_em || b?.ultima_atividade || b?.criado_em || 0
      ).getTime();
      return order === "antigas" ? aTs - bTs : bTs - aTs;
    });

    return list;
  }, [
    chats,
    minhaFilaList,
    debouncedSearch,
    statusFilter,
    tagFilter,
    departamentoFilter,
    atendenteFilter,
    mineOnly,
    order,
    tab,
    user?.id,
    user?.role,
    user?.perfil,
    adminAtendenteFilterId,
    onlyFinalizadasAusencia,
    aguardandoClienteOnly,
    pendentesFuncionarioSet,
  ]);

  const visibleConversationIds = useMemo(
    () => chatsFiltrados.map((c) => String(c?.id)).filter(Boolean),
    [chatsFiltrados]
  );

  const {
    openConversationId,
    anchorRect,
    openMenu,
    closeMenu,
  } = useConversationActionMenu({
    selectedConversationId: selectedId,
    visibleConversationIds,
    resetKey: `${tab}-${adminAtendenteFilterId ?? ""}`,
  });

  const openMenuChat = useMemo(
    () => chatsFiltrados.find((c) => String(c?.id) === String(openConversationId)) || null,
    [chatsFiltrados, openConversationId]
  );

  const menuActions = useMemo(() => {
    const chat = openMenuChat;
    if (!chat) return [];
    const isGroup = isGroupConversation(chat);
    const p = rowPrefs(chat);
    return [
      {
        id: "mute",
        label: p.silenciado ? "Remover silêncio" : "Silenciar notificações",
        icon: "🔕",
        visible: true,
        disabled: false,
      },
      {
        id: "pin",
        label: p.fixada ? "Desafixar conversa" : "Fixar conversa",
        icon: "📌",
        visible: true,
        disabled: false,
      },
      {
        id: "favorite",
        label: p.favorita ? "Remover dos favoritos" : "Adicionar aos Favoritos",
        icon: "★",
        visible: true,
        disabled: false,
      },
      {
        id: "clear",
        label: "Limpar conversa",
        icon: "🧹",
        visible: true,
        disabled: false,
      },
      {
        id: "delete",
        label: "Apagar conversa",
        icon: "🗑",
        danger: true,
        visible: true,
        disabled: isGroup,
        tooltip: isGroup ? "Grupos não podem ser apagados por esta ação." : undefined,
      },
    ];
  }, [openMenuChat]);

  const handleMenuAction = useCallback(async (action) => {
    if (!action || action.disabled || !openMenuChat?.id) return;
    const chatId = openMenuChat.id;
    const prefs = rowPrefs(openMenuChat);
    const currentSelectedId = useConversaStore.getState().selectedId;
    const isOpenConversation = String(currentSelectedId || "") === String(chatId);

    if (action.id === "clear") {
      setConfirmClear({ chatId, isOpenConversation });
      closeMenu();
      return;
    }
    if (action.id === "delete") {
      setConfirmDelete({ chatId, isOpenConversation });
      closeMenu();
      return;
    }

    closeMenu();

    try {
      if (action.id === "mute") {
        const nextMuted = !prefs.silenciado;
        useChatStore.getState().updateChat({ id: chatId, silenciado: nextMuted });
        const data = await toggleMuteConversation(chatId, nextMuted);
        useChatStore.getState().updateChat({ id: chatId, ...mergePrefsFromPatchResponse(data) });
        showToast({
          type: "success",
          title: nextMuted ? "Notificações silenciadas" : "Silêncio removido",
          message: nextMuted ? "Esta conversa foi silenciada." : "Esta conversa voltou a notificar.",
        });
        return;
      }
      if (action.id === "pin") {
        const nextPinned = !prefs.fixada;
        useChatStore.getState().updateChat({ id: chatId, fixada: nextPinned, fixada_em: nextPinned ? new Date().toISOString() : null });
        const data = await togglePinConversation(chatId, nextPinned);
        useChatStore.getState().updateChat({ id: chatId, ...mergePrefsFromPatchResponse(data) });
        showToast({
          type: "success",
          title: nextPinned ? "Conversa fixada" : "Conversa desafixada",
          message: nextPinned ? "A conversa subiu para o topo da lista." : "A conversa voltou à ordenação padrão.",
        });
        return;
      }
      if (action.id === "favorite") {
        const nextFavorite = !prefs.favorita;
        useChatStore.getState().updateChat({ id: chatId, favorita: nextFavorite });
        const data = await toggleFavoriteConversation(chatId, nextFavorite);
        useChatStore.getState().updateChat({ id: chatId, ...mergePrefsFromPatchResponse(data) });
        showToast({
          type: "success",
          title: nextFavorite ? "Favorito adicionado" : "Favorito removido",
          message: nextFavorite ? "Conversa marcada como favorita." : "Conversa removida dos favoritos.",
        });
      }
    } catch (e) {
      const msg = e?.response?.data?.error || e?.response?.data?.message || e?.message || "Não foi possível concluir esta ação.";
      showToast({
        type: "error",
        title: "Falha ao executar ação",
        message: msg,
      });
      loadRef.current?.();
    }
  }, [openMenuChat, closeMenu, showToast]);

  const runConfirmedClear = useCallback(async () => {
    if (!confirmClear?.chatId) return;
    const { chatId, isOpenConversation } = confirmClear;
    setConfirmClear(null);
    try {
      await clearConversation(chatId);
      useChatStore.getState().updateChat({
        id: chatId,
        ultima_mensagem: null,
        ultima_mensagem_preview: null,
        unread_count: 0,
        tem_novas_mensagens: false,
        tem_novas_mensagens_em_atendimento: false,
      });
      if (isOpenConversation) {
        useConversaStore.setState({ mensagens: [] });
      }
      showToast({
        type: "success",
        title: "Conversa limpa",
        message: "As mensagens foram removidas com sucesso.",
      });
      loadRef.current?.();
    } catch (e) {
      const msg = e?.response?.data?.error || e?.response?.data?.message || e?.message || "Não foi possível limpar a conversa.";
      showToast({ type: "error", title: "Falha ao limpar", message: msg });
      loadRef.current?.();
    }
  }, [confirmClear, showToast]);

  const runConfirmedDelete = useCallback(async () => {
    if (!confirmDelete?.chatId) return;
    const { chatId, isOpenConversation } = confirmDelete;
    setConfirmDelete(null);
    try {
      await deleteConversation(chatId);
      useChatStore.getState().removeChat(chatId);
      if (isOpenConversation) {
        useConversaStore.setState({
          selectedId: null,
          conversa: null,
          mensagens: [],
          tags: [],
        });
      }
      showToast({
        type: "success",
        title: "Conversa apagada",
        message: "A conversa foi removida da lista.",
      });
      loadRef.current?.();
    } catch (e) {
      const msg = e?.response?.data?.error || e?.response?.data?.message || e?.message || "Não foi possível apagar a conversa.";
      showToast({ type: "error", title: "Falha ao apagar", message: msg });
      loadRef.current?.();
    }
  }, [confirmDelete, showToast]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const mobile =
      typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches;
    /* Com conversa aberta no celular, manter a lista ancorada no topo — updates da lista
       não devem reaplicar scroll salvo (causa saltos para conversas antigas). */
    if (mobile && selectedId != null) {
      scrollSaveRef.current = 0;
      el.scrollTop = 0;
      return;
    }
    const n = chatListScrollToTopNonce;
    if (n !== scrollTopNoncePrevRef.current) {
      scrollTopNoncePrevRef.current = n;
      if (n > 0) {
        scrollSaveRef.current = 0;
        requestAnimationFrame(() => {
          if (scrollRef.current) scrollRef.current.scrollTop = 0;
        });
        return;
      }
    }
    const saved = scrollSaveRef.current;
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = saved;
    });
  }, [chatsFiltrados, chatListScrollToTopNonce, selectedId]);

  // KPIs derivados da lista base (memoizados para evitar trabalho repetido por render).
  const baseCounts = useMemo(() => {
    let hoje = 0;
    let abertas = 0;
    let finalizadas = 0;
    let finalizadasAuto = 0;

    for (const c of chats) {
      const last = getLastMessage(c);
      const ts = last?.criado_em || c?.criado_em;
      if (isToday(ts)) hoje += 1;
      if (conversaContaComoAbertaNoChip(c)) abertas += 1;

      if (getStatusAtendimentoEffective(c) === "fechada") {
        finalizadas += 1;
        if (
          String(c?.finalizacao_motivo) === "ausencia_cliente" ||
          c?.finalizada_automaticamente === true
        ) {
          finalizadasAuto += 1;
        }
      }
    }

    return {
      total: chats.length,
      hoje,
      abertas,
      finalizadas,
      finalizadasAuto,
    };
  }, [chats]);

  const total = baseCounts.total;
  const countHoje = baseCounts.hoje;
  const countAbertas = baseCounts.abertas;
  const countEmAtendimento = emAtendimentoBadgeCount;
  const countFinalizadas = baseCounts.finalizadas;
  const countFinalizadasAuto = baseCounts.finalizadasAuto;
  /** Chip: sempre vem do GET dedicado `aguardando_cliente=1` (escopo backend), não do length da lista atual. */
  const countAguardandoCliente = aguardandoClienteBadgeCount;
  const countAguardandoFuncionario = Number(
    supervisaoResumo?.aguardando_funcionario ??
      supervisaoResumo?.aguardandoFuncionario ??
      pendentesFuncionarioIds.length
  ) || 0;
  const aguardandoFuncionarioVisualState =
    countAguardandoFuncionario >= 10 ? "critical" : countAguardandoFuncionario >= 4 ? "attention" : "neutral";

  const adminPorFuncionarioAtivo =
    adminAtendenteFilterId != null && String(adminAtendenteFilterId).trim() !== "";

  return (
    <div className="chat-list-root">
      {zapiStatusLoaded && zapiConnected === false && (
        <div className="chat-list-zapi-alert" role="alert">
          <span className="chat-list-zapi-alert__icon" aria-hidden>⚠️</span>
          <span>
            WhatsApp desconectado — mensagens não serão entregues.{" "}
            <a href="/configuracoes" className="chat-list-zapi-alert__link">
              Reconectar
            </a>
          </span>
        </div>
      )}
      <header className="chat-list-header">
        <div className="chat-list-header-left">
          <ZapERPLogo
            variant="horizontal"
            size="md"
            tagline="Atendimento inteligente"
            title="ZapERP — Atendimento inteligente"
            interactive={false}
          />
        </div>

        <div className="chat-list-header-actions">
          <HeaderButton
            innerRef={novoBtnRef}
            title="Novo contato, grupo ou comunidade"
            onClick={(e) => {
              e.stopPropagation();
              setShowNovoMenu((v) => !v);
            }}
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

          <HeaderButton title="Filtros e tags" onClick={() => setShowFilters((v) => !v)}>
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
            <HeaderButton
              title="Consultar produtos"
              onClick={() => setShowProdutosPanel(true)}
            >
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
                minWidth: 200,
              }}
            >
              <button
                type="button"
                className="chat-list-novo-item"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  emitNovoAction("novo_contato");
                }}
                role="menuitem"
              >
                <span className="chat-list-novo-icon" aria-hidden>👤</span>
                <span>Novo contato</span>
              </button>
              <button
                type="button"
                className="chat-list-novo-item"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  emitNovoAction("novo_grupo");
                }}
                role="menuitem"
              >
                <span className="chat-list-novo-icon" aria-hidden>👥</span>
                <span>Novo grupo</span>
              </button>
              <button
                type="button"
                className="chat-list-novo-item"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  emitNovoAction("nova_comunidade");
                }}
                role="menuitem"
              >
                <span className="chat-list-novo-icon" aria-hidden>🌐</span>
                <span>Nova comunidade</span>
              </button>
            </div>,
            document.body
          )}
      </header>

      <div className="chat-list-search-wrap">
        <div className="chat-list-search-box">
          <Icon size={14}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path
                d="M10.5 18a7.5 7.5 0 1 1 7.5-7.5A7.5 7.5 0 0 1 10.5 18Zm9 3-5.2-5.2"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </Icon>

          <ChatListSearchBox
            ref={searchRef}
            clearNonce={searchClearNonce}
            onDebounced={handleSearchDebounced}
            placeholder="Buscar por nome ou telefone"
            className="chat-list-search-input"
          />
        </div>
        <div className="chat-list-search-hint">
          <span>
            {loading
              ? "Carregando…"
              : adminPorFuncionarioAtivo
                ? `${chatsFiltrados.length} conversas`
                : tab === "minha_fila"
                  ? `${chatsFiltrados.length} de ${minhaFilaCount}`
                  : tab === "aguardando_cliente"
                    ? `${chatsFiltrados.length} de ${aguardandoClienteBadgeCount}`
                    : `${chatsFiltrados.length} de ${total}`}
          </span>
        </div>
      </div>

      <div className="chat-list-chips-wrap">
        <div className="chat-list-chips chat-list-chips--primary" role="group" aria-label="Filtro principal">
          <Chip variant="primary" active={tab === "minha_fila"} onClick={() => setTab("minha_fila")}>
            <span>Minha fila</span>
            <span className="chat-list-chip-count">{minhaFilaCount}</span>
          </Chip>
        </div>
        <div className="chat-list-chips chat-list-chips--secondary" role="group" aria-label="Outros filtros de conversa">
          <Chip active={tab === "todas"} onClick={() => setTab("todas")}>
            <span>Todas</span>
            <span className="chat-list-chip-count">{total}</span>
          </Chip>
          <Chip active={tab === "hoje"} onClick={() => setTab("hoje")}>
            <span>Hoje</span>
            <span className="chat-list-chip-count">{countHoje}</span>
          </Chip>
          <Chip active={tab === "abertas"} onClick={() => setTab("abertas")}>
            <span>Abertas</span>
            <span className="chat-list-chip-count">{countAbertas}</span>
          </Chip>
          {separarMensagensDisparadasLigado ? (
            <Chip active={tab === "mensagens_disparadas"} onClick={() => setTab("mensagens_disparadas")}>
              <span>Mensagens Disparadas</span>
              <span className="chat-list-chip-count">{mensagensDisparadasCount}</span>
            </Chip>
          ) : null}
          <Chip active={tab === "em_atendimento"} onClick={() => setTab("em_atendimento")}>
            <span>Em atendimento</span>
            <span className="chat-list-chip-count">{countEmAtendimento}</span>
          </Chip>
          <Chip active={tab === "finalizadas"} onClick={() => setTab("finalizadas")}>
            <span>Finalizadas</span>
            <span className="chat-list-chip-count">{countFinalizadas}</span>
          </Chip>
          <Chip active={tab === "finalizadas_auto"} onClick={() => setTab("finalizadas_auto")}>
            <span>Por ausência</span>
            <span className="chat-list-chip-count">{countFinalizadasAuto}</span>
          </Chip>
          <Chip active={tab === "aguardando_cliente"} onClick={() => setTab("aguardando_cliente")}>
            <span>Aguardando cliente</span>
            <span className="chat-list-chip-count">{countAguardandoCliente}</span>
          </Chip>
          {isSupervisorOrAdmin(user) && (
            <Chip
              active={tab === "aguardando_funcionario"}
              onClick={() => setTab("aguardando_funcionario")}
              className={`chat-list-chip--aguardando-funcionario is-${aguardandoFuncionarioVisualState}`}
            >
              <span>Aguardando funcionario</span>
              <span className="chat-list-chip-count">{countAguardandoFuncionario}</span>
              {aguardandoFuncionarioVisualState === "critical" ? (
                <span className="chat-list-chip-critical-dot" aria-hidden="true" />
              ) : null}
            </Chip>
          )}
          {isAppAdmin(user) && (
            <AdminAtendenteFilter
              usuarios={atendentes}
              selectedUserId={adminAtendenteFilterId}
              open={adminAtendentePanelOpen}
              onOpenChange={setAdminAtendentePanelOpen}
              onBeforeOpen={() => {
                setShowNovoMenu(false);
                setShowFilters(false);
                closeMenu();
              }}
              onSelectUser={(u) => {
                if (u?.id == null) return;
                setAdminAtendenteFilterId(String(u.id));
              }}
              onClear={clearAdminAtendenteFilter}
            />
          )}
        </div>
      </div>

      {showFilters && (
        <div className="chat-list-filters">
          <div className="chat-list-filters-row">
            <label className="chat-list-field">
              <span>Status</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="chat-list-select"
              >
                <option value="todos">Todos</option>
                <option value="aberta">Aberta</option>
                {separarMensagensDisparadasLigado ? (
                  <option value="mensagem_disparada">Mensagem disparada</option>
                ) : null}
                <option value="em_atendimento">Em atendimento</option>
                <option value="aguardando_cliente">Aguardando cliente</option>
                <option value="fechada">Fechada</option>
              </select>
            </label>
            <label className="chat-list-field">
              <span>Tag</span>
              <select
                value={tagFilter}
                onChange={(e) => setTagFilter(e.target.value)}
                className="chat-list-select"
              >
                <option value="todas">Todas</option>
                {allTags.map((t) => (
                  <option key={t.id} value={t.id}>{t.nome}</option>
                ))}
              </select>
            </label>
            {isAppAdmin(user) && (
              <label className="chat-list-field">
                <span>Setor</span>
                <select
                  value={departamentoFilter}
                  onChange={(e) => setDepartamentoFilter(e.target.value)}
                  className="chat-list-select"
                >
                  <option value="todos">Todos</option>
                  {departamentos.map((d) => (
                    <option key={d.id} value={d.id}>{d.nome}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="chat-list-field">
              <span>Atendente</span>
              <select
                value={atendenteFilter}
                onChange={(e) => setAtendenteFilter(e.target.value)}
                className="chat-list-select"
              >
                <option value="todos">Todos</option>
                {atendentes.map((u) => (
                  <option key={u.id} value={u.id}>{u.nome || u.email}</option>
                ))}
              </select>
            </label>
            <label className="chat-list-field">
              <span>Data início</span>
              <input
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
                className="chat-list-select"
              />
            </label>
            <label className="chat-list-field">
              <span>Data fim</span>
              <input
                type="date"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
                className="chat-list-select"
              />
            </label>
            <label className="chat-list-check">
              <input
                type="checkbox"
                checked={mineOnly}
                onChange={(e) => setMineOnly(e.target.checked)}
              />
              <span>Minhas conversas</span>
            </label>
            <label className="chat-list-check">
              <input
                type="checkbox"
                checked={onlyFinalizadasAusencia}
                onChange={(e) => {
                  const on = e.target.checked;
                  setOnlyFinalizadasAusencia(on);
                  if (on) setStatusFilter("fechada");
                }}
              />
              <span title="Restringe às conversas encerradas automaticamente por falta de resposta do cliente">
                Só finalizadas por ausência
              </span>
            </label>
            <label className="chat-list-check">
              <input
                type="checkbox"
                checked={aguardandoClienteOnly}
                onChange={(e) => setAguardandoClienteOnly(e.target.checked)}
              />
              <span title="Conversas em atendimento com atendente, aguardando retorno do cliente após mensagem da equipe">
                Aguardando resposta do cliente
              </span>
            </label>
            <label className="chat-list-field">
              <span>Ordem</span>
              <select
                value={order}
                onChange={(e) => setOrder(e.target.value)}
                className="chat-list-select"
              >
                <option value="recentes">Mais recentes</option>
                <option value="antigas">Mais antigas</option>
              </select>
            </label>
          </div>
          <div className="chat-list-filters-row chat-list-filters-row--tempo-parado">
            <span className="chat-list-field-label">Tempo parado</span>
            <div className="chat-list-tempo-parado-chips" role="group" aria-label="Filtro por tempo parado">
              {[
                { v: "", l: "Todos" },
                { v: "2h", l: "+2h" },
                { v: "12h", l: "+12h" },
                { v: "24h", l: "+24h" },
                { v: "7d", l: "+7d" },
                { v: "30d", l: "+30d" },
              ].map(({ v, l }) => (
                <button
                  key={v || "none"}
                  type="button"
                  className={`chat-list-tempo-chip${tempoParadoFilter === v ? " is-on" : ""}`}
                  onClick={() => setTempoParadoFilter(v)}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          {isSupervisorOrAdmin(user) && (
            <div className="chat-list-ausencia-lote">
              <div className="chat-list-ausencia-lote-head">
                <span className="chat-list-ausencia-lote-title">Ausência — lote</span>
                <span className="chat-list-ausencia-lote-sub">Até 50 conversas em atendimento da lista atual</span>
              </div>
              <div className="chat-list-ausencia-lote-row">
                <button
                  type="button"
                  className="chat-list-ausencia-lote-btn"
                  disabled={loteAusenciaBusy}
                  onClick={() => void handleLoteAusenciaSimular()}
                >
                  Simular
                </button>
                <input
                  type="text"
                  className="chat-list-ausencia-lote-input"
                  value={loteAusenciaConfirm}
                  onChange={(e) => setLoteAusenciaConfirm(e.target.value)}
                  placeholder={CONFIRM_LOTE_AUSENCIA}
                  aria-label="Texto de confirmação para executar o lote"
                />
                <button
                  type="button"
                  className="chat-list-ausencia-lote-btn chat-list-ausencia-lote-btn--primary"
                  disabled={loteAusenciaBusy}
                  onClick={() => void handleLoteAusenciaExecutar()}
                >
                  Executar
                </button>
              </div>
              {loteAusenciaMsg ? <div className="chat-list-ausencia-lote-msg">{loteAusenciaMsg}</div> : null}
            </div>
          )}
        </div>
      )}

      <div ref={scrollRef} className="chat-list-list chat-list-scroll">
        {loading && (!chats || chats.length === 0) ? (
          <SkeletonChatList />
        ) : !adminPorFuncionarioAtivo && tab === "minha_fila" && minhaFilaList === null ? (
          <SkeletonChatList />
        ) : chatsFiltrados.length === 0 ? (
          <div className="chat-list-empty-wrap">
            <EmptyState
              title="Nenhuma conversa encontrada"
              description="Suas conversas aparecerão aqui quando você receber mensagens ou iniciar um atendimento."
              actionLabel="Criar novo contato"
              action={() => setNovoContatoModalOpen(true)}
            />
          </div>
        ) : (
          chatsFiltrados.map((c) => {
            const id = c?.id;
            const clienteSemConv = Boolean(c?.sem_conversa && c?.cliente_id);
            if (!clienteSemConv && (id == null || id === "")) return null;
            const rowKey = clienteSemConv ? `sem-${c.cliente_id}` : String(id);
            const active =
              !clienteSemConv && id != null && String(selectedId) === String(id);

            return (
              <MemoChatRow
                key={rowKey}
                chat={c}
                active={active}
                onSelect={handleSelecionarConversa}
                onOpenClienteSemConversa={handleOpenClienteSemConversa}
                selectedId={selectedId}
                setSelectedId={setSelectedId}
                carregarConversa={carregarConversa}
                setUnread={setUnread}
                isMenuOpen={String(openConversationId) === String(c?.id)}
                onToggleMenu={openMenu}
                pendentesFuncionarioSet={pendentesFuncionarioSet}
              />
            );
          })
        )}
      </div>

      <ConversationActionMenu
        isOpen={!!openConversationId}
        anchorRect={anchorRect}
        actions={menuActions}
        onRequestClose={closeMenu}
        onAction={handleMenuAction}
      />

      <ConfirmDialog
        open={confirmClear != null}
        title="Limpar esta conversa?"
        confirmLabel="Limpar mensagens"
        cancelLabel="Cancelar"
        onCancel={() => setConfirmClear(null)}
        onConfirm={() => {
          void runConfirmedClear();
        }}
      >
        <p style={{ margin: 0 }}>
          Todas as mensagens serão removidas. A conversa permanece na lista.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmDelete != null}
        title="Apagar conversa permanentemente?"
        confirmLabel="Apagar"
        cancelLabel="Cancelar"
        danger
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          void runConfirmedDelete();
        }}
      >
        <p style={{ margin: 0 }}>
          Esta ação não pode ser desfeita. O histórico e dados vinculados podem ser removidos conforme as regras do sistema.
        </p>
      </ConfirmDialog>

      <ProdutoConsultaPanel
        open={showProdutosPanel && canConsultarProdutos}
        onClose={() => setShowProdutosPanel(false)}
        canViewSyncStatus={canVerSyncProdutos}
        canTriggerManualSync={canSincronizarProdutos}
        showToast={showToast}
        onEnviarParaConversa={(template) => queueComposerAppend(template)}
      />

      <NovoContatoModal
        open={novoContatoModalOpen}
        onClose={() => setNovoContatoModalOpen(false)}
        onSuccess={(conversa, extra) => {
          if (conversa?.id) {
            addChat(conversa);
            load();
            setSelectedId(conversa.id);
            carregarConversa(conversa.id);
            setUnread(conversa.id, 0);
            showToast({
              type: "success",
              title: "Contato pronto",
              message: "Conversa iniciada. Você já pode enviar mensagens.",
            });
            return;
          }
          if (extra?.cliente?.id != null) {
            load();
            showToast({
              type: "success",
              title: "Cliente cadastrado",
              message: "O contato foi salvo. Abra a conversa depois pelo telefone ou pela lista de clientes.",
            });
          }
        }}
      />
    </div>
  );
}
