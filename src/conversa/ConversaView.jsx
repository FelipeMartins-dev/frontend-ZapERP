import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { shallow } from "zustand/shallow";
import { useConversaStore, getMessageListReactKey } from "./conversaStore";
import {
  enviarMensagem,
  excluirMensagem,
  enviarReacao,
  removerReacao,
  enviarContato,
  registrarLigacao,
  encaminharArquivo,
  encaminharMensagemViaAPI,
  assumirChat,
  enviarLocalizacao,
  getPixConfig,
  putPixConfig,
} from "./conversaService";
import { isGroupConversation, getStatusAtendimentoEffective, resolveContactMetaFromMessage } from "../utils/conversaUtils";
import "./conversa.css";
import "../styles/zap-animations.css";
import api from "../api/http";
import { useAuthStore } from "../auth/authStore";
import { canAssumir, canGerenciarSetores, canTag, canTransferirSetorConversa } from "../auth/permissions";
import AtendimentoActions from "../atendimento/AtendimentoActions";
import SendToCrmChatButton, { IconFunnelSend } from "./SendToCrmChatButton";
import ProdutoConsultaPanel from "./ProdutoConsultaPanel";
import { useChatStore } from "../chats/chatsStore";
import { fetchChats, abrirConversaCliente, abrirConversaPorTelefone, conversaFromContatoResponse } from "../chats/chatService";
import { forwardAtendimentoMessageToColaborador } from "../api/internalChatService";
import { getDisplayName } from "../chats/chatList";
import { getApiBaseUrl } from "../api/baseUrl";
import {
  printImageFromUrl,
  printImageBlob,
  captureVideoFrameToPngBlob,
} from "./mediaPrint";
import { getSocket } from "../socket/socket";
import { saveReplyMeta } from "./replyMeta";
import { isNearBottom } from "./scrollUtils";
import { ConversaMessageVirtualList } from "./ConversaMessageVirtualList";
import {
  listarTags,
  adicionarTagConversa,
  removerTagConversa,
} from "../api/tagService";
import * as cfg from "../api/configService";
import SidebarCliente from "./SidebarCliente";
import { SwipeReplyTrack } from "./SwipeReplyTrack";
import { useMatchMedia } from "../hooks/useMatchMedia";
import { WA_ATENDIMENTO_CHAT_HISTORY_KEY } from "../atendimento/atendimentoMobileHistory";
import { getAutocorrectEdit } from "../utils/autocorrectText";
import EmptyState from "../components/feedback/EmptyState";
import DSToast from "../components/feedback/Toast";
import { SkeletonLine } from "../components/feedback/Skeleton";
import "../components/feedback/empty-state.css";
import "../components/feedback/skeleton.css";
import "../components/feedback/toast.css";

/** Altura máxima do campo de mensagem (estilo WhatsApp Web). */
const WA_INPUT_MAX_HEIGHT_PX = 160;

/** Limite do backend para encaminhamento em lote. */
const FORWARD_SELECT_MAX = 30;
/** Máximo de conversas de destino por ação de encaminhamento (UI + validação cliente). */
const FORWARD_DEST_MAX = 10;

function formatForwardHttpError(err) {
  const status = err?.response?.status;
  const server = err?.response?.data?.error ?? err?.response?.data?.message;
  if (server != null && String(server).trim() !== "") return String(server).trim();
  if (status === 401) return "Sessão expirada. Faça login novamente.";
  if (status === 403) return "Você não tem permissão para esta ação.";
  if (status === 404) return "Conversa ou recurso não encontrado.";
  if (status >= 500) return "Erro no servidor. Tente novamente em instantes.";
  return err?.message || "Falha de rede ou resposta inesperada.";
}

/* =========================================================
   Utils
========================================================= */

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
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
}

function formatDia(ts) {
  if (!ts) return "";
  try {
    const d = parseToDate(ts) || new Date(ts);
    return d.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "America/Sao_Paulo",
    });
  } catch {
    return "";
  }
}

function sameDay(a, b) {
  try {
    const da = parseToDate(a) || new Date(a);
    const db = parseToDate(b) || new Date(b);
    return (
      da.getFullYear() === db.getFullYear() &&
      da.getMonth() === db.getMonth() &&
      da.getDate() === db.getDate()
    );
  } catch {
    return false;
  }
}

function safeString(v) {
  return String(v ?? "").trim();
}

/**
 * Detecta se o texto é apenas um nome de arquivo (sem qualquer descrição).
 * Usado para evitar exibir "IMG_6559.png" / "VID-2026.mp4" como legenda da mídia
 * quando o backend gravou o originalname em `mensagens.texto`.
 *
 * Considera nome de arquivo isolado:
 *  - sem espaços E terminando em extensão conhecida → "foto.jpg"
 *  - prefixos típicos de câmera/WhatsApp + extensão → "IMG_6559.png", "VID-2026.mp4"
 *  - "WhatsApp Image 2026-05-08 at 12.34.56.jpeg"
 */
function isFilenameOnlyText(texto) {
  if (!texto) return false;
  const t = String(texto).trim();
  if (!t) return false;
  const knownExt =
    /\.(jpe?g|png|gif|webp|bmp|svg|heic|heif|tiff?|mp4|mov|webm|mkv|avi|3gp|m4v|mp3|m4a|wav|ogg|opus|aac|amr|pdf|docx?|xlsx?|pptx?|txt|csv|zip|rar|7z)$/i;
  if (!knownExt.test(t)) return false;
  /* Nomes longos só com extensão (ex.: IDs numéricos do WhatsApp .jpg) continuam sendo arquivo — o teto evita parágrafos colados a ".pdf". */
  if (t.length > 8000) return false;
  if (/^(IMG|IMG_E|VID|VID_|MOV|DSC|PXL|PHOTO|VIDEO|AUDIO|REC|FILE|DOC|PDF|WA|WhatsApp|Screenshot|Captura|image|video|audio)[ _-]/i.test(t)) {
    return true;
  }
  const baseNoExt = t.replace(/\.[^.]+$/i, "").trim();
  /* Exportações padrão (Figma, Adobe, etc.) — não exibir como legenda na foto */
  if (
    /^(design\s+sem\s+nome|sem\s+nome|untitled(\s+design)?|new\s+document|documento\s+sem\s+t[ií]tulo|sem\s+t[ií]tulo)$/i.test(
      baseNoExt
    )
  ) {
    return true;
  }
  if (!/\s/.test(t)) return true;
  return false;
}

function isOutgoingMessage(msg) {
  const raw = safeString(msg?.direcao).toLowerCase();
  if (raw === "out") return true;
  if (raw === "in") return false;

  const outgoingLike = new Set([
    "sent",
    "send",
    "sending",
    "enviado",
    "enviada",
    "saida",
    "output",
    "outbound",
  ]);
  const incomingLike = new Set([
    "received",
    "receive",
    "recebido",
    "recebida",
    "entrada",
    "input",
    "inbound",
  ]);

  if (outgoingLike.has(raw)) return true;
  if (incomingLike.has(raw)) return false;

  const fromMe = msg?.from_me ?? msg?.fromMe ?? msg?.is_from_me ?? msg?.isFromMe;
  if (fromMe === true || fromMe === 1 || String(fromMe).toLowerCase() === "true") return true;
  if (fromMe === false || fromMe === 0 || String(fromMe).toLowerCase() === "false") return false;

  return false;
}

/** Segundos máx. entre foto/vídeo e mensagem de texto para agrupar visualmente como legenda. */
const CAPTION_BUNDLE_MAX_SEC = 5;

function isMediaCaptionBundleTop(msg) {
  const t = safeString(msg?.tipo).toLowerCase();
  return t === "imagem" || t === "video";
}

function isPlainCaptionFollowMessage(msg) {
  const t = safeString(msg?.tipo).toLowerCase();
  const nonText = new Set([
    "imagem",
    "video",
    "sticker",
    "audio",
    "voice",
    "arquivo",
    "location",
    "contact",
    "call",
    "reaction",
    "link",
  ]);
  if (nonText.has(t)) return false;
  if (resolveContactMetaFromMessage(msg)) return false;
  const tx = safeString(msg?.texto);
  if (!tx) return false;
  if (msg?.encaminhado || tx.startsWith("[Encaminhado]")) return false;
  return true;
}

function messageHasReplyMeta(msg) {
  const rm = msg?.reply_meta;
  return !!(rm && (safeString(rm.name) || safeString(rm.snippet) || safeString(rm.thumb)));
}

function sameCaptionBundleAuthor(prev, cur) {
  const outPrev = isOutgoingMessage(prev);
  const outCur = isOutgoingMessage(cur);
  if (outPrev !== outCur) return false;
  if (outPrev) {
    return String(prev?.autor_usuario_id ?? "") === String(cur?.autor_usuario_id ?? "");
  }
  const key = (m) => {
    const tel = safeString(m?.remetente_telefone);
    const n = safeString(m?.remetente_nome);
    return tel || n || "";
  };
  return key(prev) === key(cur);
}

function captionFollowTimeOk(prev, cur) {
  const ta = new Date(prev?.criado_em).getTime();
  const tb = new Date(cur?.criado_em).getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return false;
  const deltaSec = (tb - ta) / 1000;
  return deltaSec >= 0 && deltaSec <= CAPTION_BUNDLE_MAX_SEC;
}

// Deixa URLs em texto azuis e clicáveis (http/https)
const URL_REGEX = /(https?:\/\/[^\s]+)/gi;

function renderTextWithLinks(text) {
  const s = safeString(text);
  if (!s) return null;
  const parts = [];
  let lastIndex = 0;
  let match;
  while ((match = URL_REGEX.exec(s)) !== null) {
    const url = match[0];
    const idx = match.index;
    if (idx > lastIndex) {
      parts.push(s.slice(lastIndex, idx));
    }
    parts.push(
      <a
        key={`link-${idx}-${url}`}
        href={url}
        target="_blank"
        rel="noreferrer"
        className="wa-link"
      >
        {url}
      </a>
    );
    lastIndex = idx + url.length;
  }
  if (lastIndex < s.length) {
    parts.push(s.slice(lastIndex));
  }
  return parts;
}

function formatHoraCurta(ts) {
  if (!ts) return "";
  try {
    const d = parseToDate(ts) || new Date(ts);
    return d.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Sao_Paulo",
    });
  } catch {
    return "";
  }
}

function timelineEventLabel(a, conversaCtx) {
  const acao = safeString(a?.acao).toLowerCase();
  const quem = a?.usuario_nome || "Sistema";
  const paraQuem = a?.para_usuario_nome;
  if (acao === "assumiu") return `${quem} assumiu`;
  if (acao === "transferiu") return paraQuem ? `${quem} transferiu para ${paraQuem}` : `${quem} transferiu`;
  if (acao === "transferiu_setor") return a?.observacao ? `${quem} transferiu setor: ${a.observacao}` : `${quem} transferiu setor`;
  if (acao === "encerrou") {
    const motivoLinha = safeString(a?.finalizacao_motivo).toLowerCase();
    const motivoConv = safeString(conversaCtx?.finalizacao_motivo).toLowerCase();
    if (motivoLinha === "ausencia_cliente" || motivoConv === "ausencia_cliente" || a?.finalizada_automaticamente === true) {
      return "Encerrada automaticamente por ausência";
    }
    return "Atendimento finalizado";
  }
  if (acao === "reabriu") return "Conversa reaberta";
  return quem;
}

function initials(nome = "") {
  const parts = safeString(nome).split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const a = parts[0]?.[0] || "?";
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] : "";
  return (a + b).toUpperCase();
}

function normalizeTelefone(v) {
  const raw = safeString(v);
  const digits = raw.replace(/\D+/g, "");
  return digits;
}

/** Badge do header: em_atendimento, fechada ou Aberta (só se exibir_badge_aberta). */
function statusBadge(status, exibirBadgeAberta, finalizacaoMotivo) {
  const s = safeString(status).toLowerCase();
  const ausencia = safeString(finalizacaoMotivo).toLowerCase() === "ausencia_cliente";
  if (s === "aguardando_cliente") {
    return {
      text: "Aguardando cliente",
      bg: "rgba(14,165,233,0.09)",
      color: "#0369a1",
      border: "rgba(14,165,233,0.2)",
      dot: "#0284c7",
    };
  }
  if (s === "em_atendimento") {
    return {
      text: "Em atendimento",
      bg: "rgba(59,130,246,0.12)",
      color: "var(--wa-status-blue)",
      border: "rgba(59,130,246,0.18)",
      dot: "var(--wa-status-blue)",
    };
  }
  if (s === "fechada") {
    return {
      text: ausencia ? "Finalizada (ausência)" : "Finalizada",
      bg: "rgba(245,158,11,0.12)",
      color: "var(--wa-status-orange)",
      border: "rgba(245,158,11,0.18)",
      dot: "var(--wa-status-orange)",
    };
  }
  if (s === "mensagem_disparada") {
    return {
      text: "Mensagem disparada",
      bg: "rgba(139,92,246,0.1)",
      color: "#6d28d9",
      border: "rgba(139,92,246,0.22)",
      dot: "#7c3aed",
    };
  }
  if (exibirBadgeAberta !== true) return null;
  return {
    text: "Aberta",
    bg: "rgba(34,197,94,0.12)",
    color: "var(--wa-status-green)",
    border: "rgba(34,197,94,0.18)",
    dot: "var(--wa-status-green)",
  };
}

function isImageFile(file) {
  if (!file) return false;
  const t = String(file.type || "").toLowerCase();
  if (t.startsWith("image/")) return true;
  const name = String(file.name || "").toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp)$/i.test(name);
}

function isAudioFile(file) {
  if (!file) return false;
  const t = String(file.type || "").toLowerCase();
  if (t.startsWith("audio/")) return true;
  const name = String(file.name || "").toLowerCase();
  return /\.(mp3|ogg|wav|m4a|webm|aac|opus)$/i.test(name);
}

function isVideoFile(file) {
  if (!file) return false;
  const t = String(file.type || "").toLowerCase();
  if (t.startsWith("video/")) return true;
  const name = String(file.name || "").toLowerCase();
  return /\.(mp4|mov|webm|mkv|avi|3gp|m4v)$/i.test(name);
}

function getMediaUrl(url, urlAbsoluta) {
  if (urlAbsoluta) return urlAbsoluta;
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  const base = getApiBaseUrl();
  return base.replace(/\/$/, "") + (url.startsWith("/") ? url : "/" + url);
}

function credentialedFetchMode() {
  const v = String(import.meta.env.VITE_WITH_CREDENTIALS || "").trim().toLowerCase();
  return v === "1" || v === "true" ? "include" : "omit";
}

/** Baixa o arquivo com o mesmo JWT do `api` (evita <iframe src="API"> bloqueado por X-Frame-Options no servidor/proxy). */
async function fetchMediaBinaryAuthenticated(absoluteUrl) {
  const headers = {};
  try {
    const raw = localStorage.getItem("zap_erp_auth");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.token) headers.Authorization = `Bearer ${parsed.token}`;
    }
  } catch {
    /* ignore */
  }
  const res = await fetch(absoluteUrl, {
    method: "GET",
    headers,
    credentials: credentialedFetchMode(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

/** Visualizador de mídia: tipos em que a impressão faz sentido (imagem / vídeo-quadro). */
function mediaViewerSupportsPrint(viewerType, fileName) {
  const t = String(viewerType || "").toLowerCase();
  if (t === "video" || t === "imagem" || t === "figurinha") return true;
  if (t === "arquivo") {
    const fn = String(fileName || "").toLowerCase();
    return /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(fn);
  }
  return false;
}

function fileToPreviewURL(file) {
  try {
    return URL.createObjectURL(file);
  } catch {
    return null;
  }
}

function getAudioFilename(file) {
  const name = String(file?.name || "").trim();
  if (name) return name;
  const type = String(file?.type || "").toLowerCase();
  if (type.includes("ogg")) return `audio-${Date.now()}.ogg`;
  if (type.includes("mp3") || type.includes("mpeg")) return `audio-${Date.now()}.mp3`;
  if (type.includes("mp4") || type.includes("m4a")) return `audio-${Date.now()}.m4a`;
  return `audio-${Date.now()}.webm`;
}

const STICKER_RECENTS_LIMIT = 36;

function buildStickerStorageKey(user) {
  const companyId = user?.company_id ?? user?.empresa_id ?? user?.companyId ?? user?.empresaId ?? "default";
  const userId = user?.id ?? user?.user_id ?? user?.userId ?? "anon";
  return `wa_stickers_recent_${companyId}_${userId}`;
}

function buildAutoCorrectStorageKey(user) {
  const companyId = user?.company_id ?? user?.empresa_id ?? user?.companyId ?? user?.empresaId ?? "default";
  const userId = user?.id ?? user?.user_id ?? user?.userId ?? "anon";
  return `wa_autocorrect_enabled_${companyId}_${userId}`;
}

function readRecentStickers(user) {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(buildStickerStorageKey(user));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRecentStickers(user, list) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(buildStickerStorageKey(user), JSON.stringify(list.slice(0, STICKER_RECENTS_LIMIT)));
  } catch {
    /* ignore */
  }
}

function toDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Falha ao ler arquivo."));
    reader.readAsDataURL(file);
  });
}

function convertImageToWebp(file, quality = 0.9) {
  return new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const maxSize = 512;
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas indisponível.");
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(src);
            if (!blob) {
              reject(new Error("Falha ao gerar WebP."));
              return;
            }
            resolve(new File([blob], `sticker-${Date.now()}.webp`, { type: "image/webp" }));
          },
          "image/webp",
          quality
        );
      } catch (e) {
        URL.revokeObjectURL(src);
        reject(e instanceof Error ? e : new Error("Falha ao converter imagem."));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(src);
      reject(new Error("Falha ao carregar imagem."));
    };
    img.src = src;
  });
}

/* =========================================================
   Icons — finos (stroke ~1.5px), minimalistas
========================================================= */

function IconClock(props) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}

function IconMore(props) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" {...props}>
      <circle cx="12" cy="6" r="1.25" fill="currentColor" />
      <circle cx="12" cy="12" r="1.25" fill="currentColor" />
      <circle cx="12" cy="18" r="1.25" fill="currentColor" />
    </svg>
  );
}

function IconAttach(props) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function IconSend(props) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="m22 2-7 20-4-9-9-4L22 2z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}

function IconMic(props) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Z" />
      <path d="M19 11a7 7 0 0 1-14 0" />
      <path d="M12 18v3" />
      <path d="M8 21h8" />
    </svg>
  );
}

function IconEmoji(props) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14.5s1.5 2 3.5 2 3.5-2 3.5-2" />
      <path d="M9 10h.01" />
      <path d="M15 10h.01" />
    </svg>
  );
}

function IconCamera(props) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l2-3h8l2 3h3a2 2 0 0 1 2 2Z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function IconPlay(props) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" strokeWidth="1.8" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M8 5v14l12-7-12-7Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconPause(props) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" strokeWidth="1.8" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M7 5h3v14H7z" fill="currentColor" stroke="none" />
      <path d="M14 5h3v14h-3z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconClose(props) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

/** Encaminhar (barra de seleção estilo WhatsApp). */
function IconForward(props) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M13 5l7 7-7 7" />
      <path d="M5 12h14" />
    </svg>
  );
}

function IconTag(props) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z" />
      <path d="M7 7h.01" />
    </svg>
  );
}

function IconPrint(props) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M6 9V2h12v7" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <path d="M6 14h12v8H6z" />
    </svg>
  );
}

function IconClipboard(props) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

function IconContact(props) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5 19a7 7 0 0 1 14 0" />
      <rect x="3" y="3" width="5" height="5" rx="1" />
    </svg>
  );
}

function IconPlus(props) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function IconDocument(props) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" strokeWidth="1.6" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6" />
      <path d="M9 17h6" />
    </svg>
  );
}

function IconPix(props) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" strokeWidth="1.8" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M8 5 5 8l3 3 4-4" />
      <path d="M16 5l3 3-3 3-4-4" />
      <path d="M8 19l-3-3 3-3 4 4" />
      <path d="M16 19l3-3-3-3-4 4" />
      <path d="M10.8 10.8h2.4v2.4h-2.4z" />
    </svg>
  );
}

function IconSticker(props) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" strokeWidth="1.7" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M15 4v4a1.5 1.5 0 0 0 1.5 1.5H20" />
      <path d="M8.5 14.5s1.2 1.5 3.5 1.5 3.5-1.5 3.5-1.5" />
      <path d="M9 10h.01" />
      <path d="M15 10h.01" />
    </svg>
  );
}

/* =========================================================
   UI helpers
========================================================= */

function ChatToast({ toast, onClose }) {
  if (!toast) return null;
  return (
    <DSToast
      title={toast.title || "Aviso"}
      message={toast.message}
      type={toast.type || "info"}
      onClose={onClose}
    />
  );
}

function DaySeparator({ label }) {
  return (
    <div className="wa-daySep" role="separator" aria-label={`Mensagens do dia ${label}`}>
      <span className="wa-daySep-pill">{label}</span>
    </div>
  );
}

/**
 * Status ✓ / ✓✓ / ✓✓ azul
 * - tenta inferir por campos comuns (status, lida_em, lidaEm, read_at, etc.)
 * - grupos: nunca mostra "read" (azul) — WhatsApp não envia confirmação de leitura em grupos
 */
const TickSvg = ({ kind }) => (
  <svg className="wa-ticksSvg" viewBox="0 0 18 12" width="18" height="12" aria-hidden="true" focusable="false">
    {kind === "sent" || kind === "delivered" || kind === "read" ? (
      <path d="M2.2 6.2 5.2 9.1 10.4 3.1" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
    ) : null}
    {kind === "delivered" || kind === "read" ? (
      <path d="M7.0 6.2 10.0 9.1 15.2 3.1" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
    ) : null}
    {kind === "pending" ? (
      <> <circle cx="9" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.35" opacity="0.9" />
        <path d="M9 3.8v2.5l1.6 1.0" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ) : null}
    {kind === "err" ? (
      <> <circle cx="9" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.35" opacity="0.9" />
        <path d="M9 3.6v3.2" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
        <circle cx="9" cy="10" r="0.8" fill="currentColor" />
      </>
    ) : null}
  </svg>
);

function MessageTicks({ msg, isGroup }) {
  const out = isOutgoingMessage(msg);
  if (!out) return null;

  const raw = msg?.status_mensagem ?? msg?.status ?? msg?.situacao;
  const maybeNum = typeof raw === "number" && Number.isFinite(raw) ? raw : (/^\d+$/.test(String(raw || "").trim()) ? Number(raw) : null);
  const rawStatus = raw != null && maybeNum == null ? safeString(raw).toLowerCase() : String(maybeNum ?? "");
  const hasReadAt = !!(msg?.lida_em || msg?.lidaEm || msg?.read_at || msg?.readAt);
  const hasDeliveredAt = !!(msg?.entregue_em || msg?.entregueEm || msg?.delivered_at || msg?.deliveredAt);

  if (maybeNum != null) {
    if (maybeNum <= 0) return <span className="wa-ticks isPending"><TickSvg kind="pending" /></span>;
    if (maybeNum === 1) return <span className="wa-ticks"><TickSvg kind="sent" /></span>;
    if (maybeNum === 2) return <span className="wa-ticks isDelivered"><TickSvg kind="delivered" /></span>;
    if (maybeNum >= 3 && !isGroup) return <span className="wa-ticks isRead"><TickSvg kind="read" /></span>;
    if (maybeNum >= 3 && isGroup) return <span className="wa-ticks isDelivered"><TickSvg kind="delivered" /></span>;
  }

  const s = rawStatus;
  const hasReadKeyword = /lida|read|seen|visualiz|played/.test(s);
  const hasDeliveredKeyword = /entregue|deliver|receiv/.test(s);
  const isErr = s === "erro" || s === "error" || s === "failed" || s === "falhou";
  const isPending = s === "pending" || s === "enviando" || s === "sending";
  let isRead =
    s === "lida" || s === "read" || s === "seen" ||
    s === "visualizada" || s === "played" ||
    hasReadAt ||
    hasReadKeyword;
  if (isGroup) isRead = false; // grupos: cap em delivered, nunca azul
  const isDelivered =
    isRead ||
    s === "entregue" || s === "delivered" || s === "received" ||
    hasDeliveredAt ||
    hasDeliveredKeyword;
  // sent: mensagem confirmada pelo servidor WA mas ainda não entregue ao dispositivo
  const isSent = !isErr && !isPending && !isDelivered && !isRead &&
    (!s || s === "sent" || s === "enviada" || s === "enviado");

  return (
    <span className={`wa-ticks ${isDelivered ? "isDelivered" : ""} ${isRead ? "isRead" : ""} ${isErr ? "isErr" : ""} ${isPending ? "isPending" : ""}`}>
      <TickSvg kind={isErr ? "err" : isPending ? "pending" : isRead ? "read" : isDelivered ? "delivered" : isSent ? "sent" : "sent"} />
    </span>
  );
}

/**
 * Card de arquivo estilo WhatsApp: ícone com extensão, nome, tipo/tamanho,
 * timestamp, ticks e links "Abrir" / "Salvar como..."
 */
function FileBubbleContent({ msg, mediaUrl, selectMode, onOpenMedia, isGroup, out }) {
  const nome = msg?.nome_arquivo || "Arquivo";
  const ext = getFileExt(nome);
  const bytes = msg?.tamanho ?? msg?.tamanho_bytes;
  const size = formatFileSize(bytes);
  const typeSize = size ? `${ext} · ${size}` : ext;
  const encaminhado = !!msg?.encaminhado || (typeof msg?.texto === "string" && msg.texto.trimStart().startsWith("[Encaminhado]"));

  const handleCardClick = (e) => {
    if (!selectMode) e.stopPropagation();
  };

  return (
    <div className={`wa-bubble-fileCard ${out ? "wa-bubble-fileCard--out" : ""}`} onClick={handleCardClick}>
      {encaminhado ? <div className="wa-bubble-encaminhado">[Encaminhado]</div> : null}
      <div className="wa-bubble-fileTop">
        <div className={`wa-bubble-fileIconWrap wa-bubble-fileIconWrap--${ext.toLowerCase()}`} aria-hidden="true">
          <span className="wa-bubble-fileExt">{ext}</span>
        </div>
        <div className="wa-bubble-fileMain">
          <span className="wa-bubble-fileName">{nome}</span>
          <span className="wa-bubble-fileTypeSize">{typeSize}</span>
        </div>
        <span className="wa-bubble-fileTimeMeta">
          <span className="wa-bubble-fileTime">{formatHora(msg?.criado_em)}</span>
          <MessageTicks msg={msg} isGroup={Boolean(isGroup)} />
        </span>
      </div>
      <div className="wa-bubble-fileActions">
        <button
          type="button"
          className="wa-bubble-fileAction"
          disabled={!!selectMode}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!selectMode && mediaUrl) onOpenMedia?.(mediaUrl, "arquivo", nome);
          }}
        >
          Abrir
        </button>
        {mediaUrl ? (
          <>
            <span className="wa-bubble-fileActionSep" aria-hidden="true">·</span>
            <a
              href={mediaUrl}
              download={nome}
              className="wa-bubble-fileAction"
              onClick={(e) => e.stopPropagation()}
              target="_blank"
              rel="noreferrer"
            >
              Salvar como...
            </a>
          </>
        ) : null}
      </div>
    </div>
  );
}

function ContactBubbleContent({
  msg,
  contactMeta,
  selectMode,
  isGroup,
  out,
  onConversar,
  onAdicionarGrupo,
}) {
  const meta = contactMeta || resolveContactMetaFromMessage(msg);
  if (!meta) return null;
  const nome = meta.nome || "Contato";
  const telefone = meta.telefone || null;
  const fotoPerfil = meta.foto_perfil && String(meta.foto_perfil).trim().startsWith("http")
    ? String(meta.foto_perfil).trim()
    : null;
  const iniciais = nome
    .trim()
    .split(/\s+/)
    .map((s) => s[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "?";

  const handleCardClick = (e) => {
    if (!selectMode) e.stopPropagation();
  };

  return (
    <div className={`wa-bubble-contactCard ${out ? "wa-bubble-contactCard--out" : ""}`} onClick={handleCardClick}>
      <div className="wa-bubble-contactHeader">
        <div className="wa-bubble-contactAvatarWrap">
          {fotoPerfil ? (
            <img
              src={fotoPerfil}
              alt=""
              className="wa-bubble-contactAvatar"
              referrerPolicy="no-referrer"
              loading="lazy"
            />
          ) : (
            <span className="wa-bubble-contactInitials" aria-hidden="true">{iniciais}</span>
          )}
        </div>
        <div className="wa-bubble-contactInfo">
          <span className="wa-bubble-contactName">{nome}</span>
          <span className="wa-bubble-contactTimeMeta">
            <span className="wa-bubble-contactTime">{formatHora(msg?.criado_em)}</span>
            <MessageTicks msg={msg} isGroup={Boolean(isGroup)} />
          </span>
        </div>
      </div>
      <div className="wa-bubble-contactDivider" />
      <div className="wa-bubble-contactActions">
        <button
          type="button"
          className="wa-bubble-contactAction"
          disabled={!!selectMode}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!selectMode && onConversar) onConversar({ nome, telefone });
          }}
        >
          Conversar
        </button>
        <button
          type="button"
          className="wa-bubble-contactAction"
          disabled={!!selectMode}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!selectMode && onAdicionarGrupo) onAdicionarGrupo({ nome, telefone });
          }}
        >
          Adicionar a um grupo
        </button>
      </div>
    </div>
  );
}

/** Formata coordenadas com no máx. 5 decimais */
function formatCoords(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  const rounded = (n) => Math.round(n * 100000) / 100000;
  return `${rounded(la)}, ${rounded(ln)}`;
}

/** Extrai endereço e coordenadas do texto da mensagem de localização */
function parseLocationText(texto) {
  const raw = safeString(texto).trim();
  if (!raw) return { address: null, coords: null, coordsFormatted: null };

  const coordsMatch = raw.match(/\(?(-?\d+\.?\d*),\s*(-?\d+\.?\d*)\)?/);
  const isCoordsOnly = /^\(?\s*-?\d+\.?\d*,\s*-?\d+\.?\d*\s*\)?$/.test(raw.replace(/\s+/g, " ").trim());
  const hasAddress = raw.includes("•") && !isCoordsOnly;

  let address = null;
  let coordsFormatted = null;

  if (coordsMatch) {
    coordsFormatted = formatCoords(coordsMatch[1], coordsMatch[2]);
  }

  if (isCoordsOnly && coordsMatch) {
    return { address: null, coords: raw, coordsFormatted };
  }

  if (hasAddress) {
    const withoutCoords = raw.replace(/\s*\(?(-?\d+\.?\d*),\s*(-?\d+\.?\d*)\)?\s*$/, "").trim().replace(/\s*•\s*$/, "").trim();
    address = withoutCoords || null;
  }

  return { address, coords: coordsMatch ? `${coordsMatch[1]}, ${coordsMatch[2]}` : null, coordsFormatted };
}

/** Mapa estático (OSM) — sem API key; fallback é só o link em `url`. */
function buildStaticMapUrl(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  return `https://staticmap.openstreetmap.de/staticmap.php?center=${la},${ln}&zoom=15&size=320x160&maptype=mapnik&markers=${la},${ln},red-pushpin`;
}

/** Mensagem de localização — `location_meta` + mapa/link; fallback texto/url legado */
function LocationBubbleContent({ msg, selectMode, isGroup, out }) {
  const texto = safeString(msg?.texto);
  const isLive = msg?.location_live === true;
  const meta = msg?.location_meta && typeof msg.location_meta === "object" ? msg.location_meta : null;
  const latM = meta != null ? Number(meta.latitude) : NaN;
  const lngM = meta != null ? Number(meta.longitude) : NaN;
  const hasMetaCoords = Number.isFinite(latM) && Number.isFinite(lngM);

  const mapUrl =
    (msg?.url && String(msg.url).trim()) ||
    (hasMetaCoords
      ? `https://www.google.com/maps?q=${encodeURIComponent(`${latM},${lngM}`)}`
      : `https://www.google.com/maps/search/${encodeURIComponent(texto || "localização")}`);

  const staticMapUrl = hasMetaCoords ? buildStaticMapUrl(latM, lngM) : null;

  const nomeMeta = meta ? safeString(meta.nome) : "";
  const enderecoMeta = meta ? safeString(meta.endereco) : "";

  const { address, coordsFormatted } = parseLocationText(texto);
  const hasCoords = !!coordsFormatted;
  const legacyLine =
    !hasMetaCoords && (address || (texto && !hasCoords ? texto : null) || null);

  const handleCardClick = (e) => {
    if (!selectMode) e.stopPropagation();
  };

  return (
    <div
      className={`wa-bubble-locationCard ${out ? "wa-bubble-locationCard--out" : ""}`}
      onClick={handleCardClick}
    >
      <span className="wa-bubble-locationBadge">
        {isLive ? "Localização em tempo real" : "Localização"}
      </span>
      {staticMapUrl ? (
        <a
          href={mapUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="wa-bubble-locationMapLink"
          onClick={(e) => e.stopPropagation()}
          aria-label="Abrir localização no mapa"
        >
          <img
            src={staticMapUrl}
            alt=""
            className="wa-bubble-locationMap"
            loading="lazy"
            decoding="async"
          />
        </a>
      ) : null}
      <div className="wa-bubble-locationContent">
        <span className="wa-bubble-locationIcon" aria-hidden="true">📍</span>
        {hasMetaCoords ? (
          <>
            {nomeMeta ? <p className="wa-bubble-locationAddress">{nomeMeta}</p> : null}
            {enderecoMeta ? (
              <p
                className={`wa-bubble-locationAddress ${nomeMeta ? "wa-bubble-locationAddress--sub" : ""}`}
              >
                {enderecoMeta}
              </p>
            ) : null}
          </>
        ) : legacyLine ? (
          <p className="wa-bubble-locationAddress">{legacyLine}</p>
        ) : null}
        {hasMetaCoords ? (
          <p className="wa-bubble-locationCoords">{formatCoords(latM, lngM)}</p>
        ) : hasCoords ? (
          <p className="wa-bubble-locationCoords">{coordsFormatted}</p>
        ) : null}
        <a
          href={mapUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="wa-bubble-locationCta"
          onClick={(e) => e.stopPropagation()}
        >
          Abrir no mapa
        </a>
      </div>
      <div className="wa-bubble-locationFooter">
        <span className="wa-bubble-locationTime">{formatHora(msg?.criado_em)}</span>
        <MessageTicks msg={msg} isGroup={Boolean(isGroup)} />
      </div>
    </div>
  );
}

async function copyTextToClipboard(text) {
  const t = safeString(text);
  if (!t) return false;
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch (_) {
    try {
      const ta = document.createElement("textarea");
      ta.value = t;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return !!ok;
    } catch {
      return false;
    }
  }
}

/** Mídia cujo apagamento o usuário costuma querer evitar por engano (foto, vídeo, áudio, arquivo…). */
function isRichMediaMessage(msg) {
  const tipo = safeString(msg?.tipo).toLowerCase();
  return ["imagem", "video", "sticker", "audio", "voice", "arquivo"].includes(tipo);
}

function snippetFromMsg(msg) {
  const contactResolved = resolveContactMetaFromMessage(msg);
  if (contactResolved?.nome) return contactResolved.nome;

  const tipo = safeString(msg?.tipo).toLowerCase();
  const t = safeString(msg?.texto);
  /* Não usar nome de arquivo gravado em `texto` como preview de mídia (reply / lista). */
  const skipTextoPorArquivoMidia =
    (tipo === "imagem" || tipo === "sticker" || tipo === "video") && t && isFilenameOnlyText(t);
  if (t && !skipTextoPorArquivoMidia) return t.length > 80 ? `${t.slice(0, 80)}…` : t;
  if (tipo === "audio") {
    const rawDur =
      msg?.audio_duracao_sec ??
      msg?.audioDuracaoSec ??
      msg?.duracao_sec ??
      msg?.duracao ??
      msg?.duration ??
      msg?.media_duration ??
      msg?.mediaDuration ??
      null;
    const d = Number(rawDur);
    return Number.isFinite(d) && d > 0 ? `(áudio · ${formatMmSs(d)})` : "(áudio)";
  }
  if (tipo === "imagem") return "(foto)";
  if (tipo === "video") return "(vídeo)";
  if (tipo === "sticker") return "(figurinha)";
  if (tipo === "arquivo") return msg?.nome_arquivo ? String(msg.nome_arquivo) : "(arquivo)";
  if (tipo === "location") {
    const lm = msg?.location_meta;
    if (lm && typeof lm === "object") {
      const la = Number(lm.latitude);
      const ln = Number(lm.longitude);
      if (Number.isFinite(la) && Number.isFinite(ln)) {
        const n = safeString(lm.nome);
        const e = safeString(lm.endereco);
        const line = n && e ? `${n} • ${e}` : n || e || "";
        if (line) return line.length > 80 ? `${line.slice(0, 79)}…` : line;
      }
    }
    return msg?.texto || "(localização)";
  }
  return "(mídia)";
}

/** Para reply nativo no WhatsApp (UltraMsg `msgId`): prioriza `whatsapp_id` da mensagem citada. */
function pickReplyToIdForApi(msg) {
  if (!msg) return undefined;
  const source = msg?.mensagem && typeof msg.mensagem === "object" ? msg.mensagem : msg;
  const wa = source.whatsapp_id != null && String(source.whatsapp_id).trim() !== "" ? String(source.whatsapp_id).trim() : null;
  if (wa) return wa;
  if (source.id != null && source.id !== "") return source.id;
  return undefined;
}

/** Monta reply_meta para API + localStorage (inclui miniatura em foto/figurinha). */
function buildReplyMetaForPersist(replyTo, nome, chat) {
  if (!replyTo) return null;
  const name = getReplySenderLabel(replyTo, nome, chat);
  const snippet = snippetFromMsg(replyTo);
  const base = {
    name,
    snippet,
    ts: Date.now(),
    replyToId: pickReplyToIdForApi(replyTo),
  };
  const tipo = safeString(replyTo?.tipo).toLowerCase();
  if (tipo === "imagem" || tipo === "sticker") {
    const thumb = getMediaUrl(replyTo?.url, replyTo?.url_absoluta);
    return {
      ...base,
      reply_kind: tipo,
      /* URLs assinadas (S3) passam de 500 chars — truncar quebrava miniatura e a imagem sumia na citação. */
      ...(thumb ? { thumb: String(thumb).slice(0, 12000) } : {}),
    };
  }
  return base;
}

/** Texto da linha de preview na citação (evita nome de arquivo legado no localStorage). */
function replySnippetDisplay(rm) {
  if (!rm) return "";
  const sn = safeString(rm.snippet);
  const kind = safeString(rm.reply_kind).toLowerCase();
  if (!sn && safeString(rm.thumb)) return "Foto";
  if (kind === "sticker" && (!sn || isFilenameOnlyText(sn))) return "Figurinha";
  const snTrim = sn.trim();
  if (
    snTrim &&
    /\.(jpe?g|png|gif|webp|bmp|heic|heif)$/i.test(snTrim) &&
    !/\s/.test(snTrim)
  ) {
    if (kind === "sticker") return "Figurinha";
    return "Foto";
  }
  if (sn && isFilenameOnlyText(sn) && /\.(jpe?g|png|gif|webp|bmp|heic|heif)$/i.test(sn)) return "Foto";
  if (kind === "imagem" && (!sn || sn === "(foto)" || isFilenameOnlyText(sn))) return "Foto";
  return sn;
}

function resolveConversaAvatarUrl(raw) {
  const s = raw != null ? String(raw).trim() : "";
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("data:")) return s;
  return getMediaUrl(s, null) || null;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/** Área visível com teclado virtual / barra do Safari — menus fixed devem usar isto no mobile. */
function getVisualViewportLayout() {
  if (typeof window === "undefined") {
    return {
      innerWidth: 360,
      innerHeight: 640,
      visibleHeight: 640,
      visibleTop: 0,
      keyboardInsetBottom: 0,
    };
  }
  const innerWidth = window.innerWidth || 360;
  const innerHeight = window.innerHeight || 640;
  const vv = window.visualViewport;
  if (!vv) {
    return {
      innerWidth,
      innerHeight,
      visibleHeight: innerHeight,
      visibleTop: 0,
      keyboardInsetBottom: 0,
    };
  }
  const keyboardInsetBottom = Math.max(0, innerHeight - vv.height - vv.offsetTop);
  return {
    innerWidth,
    innerHeight,
    visibleHeight: vv.height,
    visibleTop: vv.offsetTop,
    keyboardInsetBottom,
  };
}

function formatMmSs(totalSeconds) {
  const s = Number(totalSeconds);
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const sec = Math.floor(s);
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

function getFileExt(nome) {
  const s = String(nome || "").trim();
  const i = s.lastIndexOf(".");
  return i >= 0 ? s.slice(i + 1).toUpperCase().slice(0, 4) : "FILE";
}

function formatFileSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function seedFromAny(v) {
  const s = String(v ?? "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeWaveBars(count, seed) {
  let x = seed || 1;
  const out = [];
  for (let i = 0; i < count; i++) {
    // xorshift32
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    const r = (x >>> 0) / 4294967295;
    // barras com variação "bonita"
    const v = 0.25 + 0.75 * Math.pow(r, 0.55);
    out.push(v);
  }
  return out;
}

const __WA_EMOJIS = [
  "😀","😁","😂","🤣","😊","😍","😘","😅","😎","🙂","🤝","🙏","👏","🔥","✅","❌","⚠️","⭐","🎉","💡","📎","📌","📞","🎧",
  "👍","👎","👌","🤌","✌️","🤞","🫶","💪","🧠","🕒","📍","📅","💬","📷","🎥","🎙️","🎵","🗂️","🧾",
  "❤️","💛","💚","💙","🤍","🖤","💔",
];

let __waCurrentAudio = null;

const WA_AUDIO_SPEEDS = [1, 1.5, 2];

function AudioWavePlayer({ src, msgKey, avatarUrl, avatarLabel, onDuration, sentAtLabel }) {
  const audioRef = useRef(null);
  const waveMeasureRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [dur, setDur] = useState(0);
  const [cur, setCur] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [waveBarCount, setWaveBarCount] = useState(34);
  const rafRef = useRef(null);
  const rafLastRef = useRef(0);

  useLayoutEffect(() => {
    const el = waveMeasureRef.current;
    if (!el || typeof ResizeObserver === "undefined") {
      setWaveBarCount(34);
      return;
    }
    let rafId = 0;
    const update = () => {
      const w = el.getBoundingClientRect?.().width || el.offsetWidth || 200;
      const n = clamp(Math.floor(w / 4), 18, 56);
      setWaveBarCount((prev) => (prev === n ? prev : n));
    };
    const schedule = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        update();
      });
    };
    schedule();
    const ro = new ResizeObserver(() => schedule());
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [src]);

  const bars = useMemo(() => makeWaveBars(waveBarCount, seedFromAny(msgKey)), [msgKey, waveBarCount]);

  useEffect(() => {
    setPlaybackRate(1);
  }, [src]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    try {
      el.playbackRate = playbackRate;
    } catch {
      /* ignore */
    }
  }, [playbackRate, src]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onLoaded = () => {
      const d = Number(el.duration);
      if (Number.isFinite(d) && d > 0) {
        setDur(d);
        try { onDuration?.(d); } catch {}
      }
      try {
        el.playbackRate = playbackRate;
      } catch {
        /* ignore */
      }
    };
    const onSeeked = () => setCur(Number(el.currentTime || 0));
    const onEnded = () => {
      setPlaying(false);
      setCur(0);
    };
    const onPlay = () => {
      setPlaying(true);
      try {
        el.playbackRate = playbackRate;
      } catch {
        /* ignore */
      }
    };
    const onPause = () => setPlaying(false);

    el.addEventListener("loadedmetadata", onLoaded);
    el.addEventListener("seeked", onSeeked);
    el.addEventListener("ended", onEnded);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    return () => {
      el.removeEventListener("loadedmetadata", onLoaded);
      el.removeEventListener("seeked", onSeeked);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
    };
  }, [src, playbackRate]);

  // Progresso mais fluido (rAF com throttle leve) enquanto toca
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !playing) return;

    const tick = (t) => {
      if (!audioRef.current) return;
      const last = rafLastRef.current || 0;
      if (!last || t - last >= 66) {
        rafLastRef.current = t;
        setCur(Number(audioRef.current.currentTime || 0));
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      rafLastRef.current = 0;
    };
  }, [playing]);

  const toggle = useCallback(async () => {
    const el = audioRef.current;
    if (!el) return;
    try {
      if (__waCurrentAudio && __waCurrentAudio !== el) {
        try { __waCurrentAudio.pause(); } catch {}
      }
      __waCurrentAudio = el;
      try {
        el.playbackRate = playbackRate;
      } catch {
        /* ignore */
      }
      if (el.paused) {
        await el.play();
      } else {
        el.pause();
      }
    } catch {
      // ignore
    }
  }, [playbackRate]);

  const seek = useCallback((e) => {
    const el = audioRef.current;
    if (!el) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const frac = rect.width > 0 ? clamp(x / rect.width, 0, 1) : 0;
    const target = (dur || el.duration || 0) * frac;
    if (Number.isFinite(target)) {
      el.currentTime = target;
      setCur(target);
    }
  }, [dur]);

  const frac = dur > 0 ? clamp(cur / dur, 0, 1) : 0;
  const playedBars = Math.round(frac * bars.length);
  const remaining = dur > 0 ? Math.max(0, dur - cur) : 0;
  const pLabel = `${Math.round(frac * 100)}%`;

  return (
    <div className={`wa-audioPlayer ${playing ? "isPlaying" : ""}`}>
      <button
        type="button"
        className={`wa-audioPlayBtn ${playing ? "isPlaying" : ""}`}
        onClick={toggle}
        aria-label={playing ? "Pausar áudio" : "Tocar áudio"}
      >
        <span className="wa-audioPlayIcon wa-audioPlayIcon--play" aria-hidden="true">
          <IconPlay width="22" height="22" />
        </span>
        <span className="wa-audioPlayIcon wa-audioPlayIcon--pause" aria-hidden="true">
          <IconPause width="22" height="22" />
        </span>
      </button>
      <div className="wa-audioMid">
        <div className="wa-audioWaveRow">
          <div
            ref={waveMeasureRef}
            className="wa-audioWave"
            role="slider"
            aria-label="Progresso do áudio"
            onClick={seek}
            style={{ "--p": pLabel }}
          >
            {bars.map((v, i) => (
              <div
                key={i}
                className={`wa-audioBar ${i < playedBars ? "isPlayed" : ""}`}
                style={{ height: `${Math.round(8 + v * 18)}px`, "--i": i }}
              />
            ))}
            <div className="wa-audioDot" style={{ left: `${Math.round(frac * 100)}%` }} aria-hidden="true" />
          </div>
          <div className="wa-audioDurSlot">
            {playing ? (
              <span className="wa-audioRemain wa-audioRemain--slot" title={`Restante ${formatMmSs(remaining)}`}>
                -{formatMmSs(remaining)}
              </span>
            ) : null}
            <span className="wa-audioTime wa-audioTime--dur" title={formatMmSs(dur || 0)}>
              {formatMmSs(dur || 0)}
            </span>
          </div>
          <div className="wa-audioSpeedGroup" role="group" aria-label="Velocidade de reprodução">
            {WA_AUDIO_SPEEDS.map((rate) => (
              <button
                key={rate}
                type="button"
                className={`wa-audioSpeedBtn ${playbackRate === rate ? "isActive" : ""}`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setPlaybackRate(rate);
                  const a = audioRef.current;
                  if (a) {
                    try {
                      a.playbackRate = rate;
                    } catch {
                      /* ignore */
                    }
                  }
                }}
                aria-pressed={playbackRate === rate}
                aria-label={rate === 1 ? "Velocidade normal" : `Velocidade ${rate} vezes`}
                title={rate === 1 ? "1×" : `${rate}×`}
              >
                {rate === 1 ? "1×" : `${rate}×`}
              </button>
            ))}
          </div>
        </div>
        <div className="wa-audioSub">
          <span className="wa-audioTime wa-audioTime--cur" title={formatMmSs(cur)}>
            {formatMmSs(cur)}
          </span>
          {sentAtLabel ? (
            <span className="wa-audioSentAt" title={`Enviado às ${sentAtLabel}`}>
              {sentAtLabel}
            </span>
          ) : null}
        </div>
      </div>
      {avatarUrl ? (
        <span className="wa-audioAvatarWrap" aria-hidden="true">
          <img
            className="wa-audioAvatar"
            src={avatarUrl}
            alt={avatarLabel ? `Foto de ${avatarLabel}` : "Foto do contato"}
            referrerPolicy="no-referrer"
            loading="lazy"
          />
        </span>
      ) : null}
      <audio ref={audioRef} src={src} preload="metadata" className="wa-audioElHidden" />
    </div>
  );
}

function getReplySenderLabel(replyMsg, peerName, chat) {
  const contactDisplayName = chat ? getDisplayName(chat) : null;
  if (!replyMsg) return contactDisplayName || "Contato";
  const out = isOutgoingMessage(replyMsg);
  if (out) return "Você";
  const groupSender = safeString(replyMsg?.remetente_nome || replyMsg?.remetente_telefone);
  if (groupSender) return groupSender;
  const contactName = safeString(peerName) || contactDisplayName;
  return contactName || "Contato";
}

function nameColor(seed) {
  const s = String(seed || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 70% 42%)`;
}

const Bubble = memo(function Bubble({
  msg,
  showRemetente,
  isGroup,
  peerAvatarUrl,
  peerName,
  selectMode,
  selected,
  onToggleSelected,
  onInfo,
  onReply,
  onCopy,
  onForward,
  onTogglePin,
  onToggleStar,
  onStartSelect,
  onDeleteForMe,
  onDeleteForEveryone,
  isPinned,
  isStarred,
  currentUserId,
  onJumpToReply,
  onOpenMedia,
  localReaction,
  onReact,
  onRemoveReaction,
  reactionBusy,
  onConversarContact,
  onAdicionarGrupoContact,
  mostrarNomeAoCliente = true,
  swipeReplyEnabled = false,
  captionBundleTop = false,
  captionBundleFollow = false,
  /** Mobile/tablet: sem setinha fixa; menu por long press + folha inferior */
  mobileMessageChrome = false,
  menuUsesBottomSheet = false,
  zapAnimateIn = false,
}) {
  const out = isOutgoingMessage(msg);
  const isApagadaParaTodos = !!msg?.apagada_para_todos;
  const mediaUrl = getMediaUrl(msg?.url, msg?.url_absoluta);
  const canDeleteForEveryone = useMemo(() => {
    if (!out) return false;
    if (msg?.apagada_para_todos) return false;
    if (currentUserId == null) return false;
    if (msg?.autor_usuario_id == null) return false;
    return String(msg.autor_usuario_id) === String(currentUserId);
  }, [out, currentUserId, msg?.autor_usuario_id, msg?.apagada_para_todos]);
  /* Com mídia preservada no painel, ainda exibe imagem/áudio após “apagar para todos” no WhatsApp. */
  const isImg = msg?.tipo === "imagem" && (!isApagadaParaTodos || !!mediaUrl);
  const isSticker = msg?.tipo === "sticker" && (!isApagadaParaTodos || !!mediaUrl);
  const isFile = msg?.tipo === "arquivo" && (!isApagadaParaTodos || !!mediaUrl);
  const isAudio = msg?.tipo === "audio" && (!isApagadaParaTodos || !!mediaUrl);
  const isVoice = msg?.tipo === "voice" && (!isApagadaParaTodos || !!mediaUrl);
  const isAudioOrVoice = isAudio || isVoice;
  const isVideo = msg?.tipo === "video" && (!isApagadaParaTodos || !!mediaUrl);
  const contactBubbleMeta = useMemo(() => resolveContactMetaFromMessage(msg), [msg]);
  const isContact = !!contactBubbleMeta;
  const isLocation = msg?.tipo === "location";
  const textoRaw = safeString(msg?.texto);
  const texto =
    isApagadaParaTodos && !textoRaw ? "Esta mensagem foi apagada para todos." : textoRaw;
  const hasText = !!texto;
  const remetente = showRemetente && !out && (msg?.remetente_nome || msg?.remetente_telefone);
  const isPlaceholderCaption =
    !texto ||
    texto === "(mídia)" ||
    texto === "(mensagem vazia)" ||
    texto === "(imagem)" ||
    texto === "(áudio)" ||
    texto === "(áudio de voz)" ||
    texto === "(vídeo)" ||
    texto === "(figurinha)" ||
    texto === "(arquivo)" ||
    // Casos legados: backend antigo gravava o nome do arquivo no texto
    // (ex.: "IMG_6559.png", "VID-20260508.mp4", "WhatsApp Image 2026.jpeg",
    // "image1714560000000.jpg"). Tratamos isso como placeholder para nunca
    // exibir o nome do arquivo como legenda no balão da mensagem.
    isFilenameOnlyText(texto);
  const showCaption = (isImg || isVideo || isSticker) && hasText && !isPlaceholderCaption;
  const showAudioText = isAudioOrVoice && hasText && !isPlaceholderCaption;
  // Detecta mensagem encaminhada: campo encaminhado=true ou texto começa com [Encaminhado]
  const isEncaminhado =
    !isApagadaParaTodos &&
    (!!msg?.encaminhado ||
      (typeof msg?.texto === "string" && msg.texto.trimStart().startsWith("[Encaminhado]")));
  /* Imagem/vídeo/figurinha com legenda: meta (hora/ticks) no rodapé do balão — hasInlineMeta reserva padding à direita sem uso e estoura o layout. */
  const inlineMeta = !showCaption || (!isImg && !isVideo && !isSticker);
  /* Só mensagens de texto usam classe hasInlineMeta (evita CSS esconder .wa-bubble-metaLeft em foto sem legenda). */
  const hasInlineMetaClass = inlineMeta && !isImg && !isVideo && !isSticker && !isAudioOrVoice;
  /* Hora + ticks: rodapé/canto quando não há meta na linha do texto; áudio/voz nunca têm meta inline no corpo. */
  const showFloatingMetaTime =
    (!inlineMeta || ((isImg || isSticker || isVideo) && !showCaption)) ||
    (isAudioOrVoice && !!mediaUrl);
  const replyMeta = !isApagadaParaTodos ? msg?.reply_meta || null : null;
  const hasReply = !!(replyMeta && (replyMeta.name || replyMeta.snippet || replyMeta.thumb));

  // pedido do usuário: setinha no hover para mensagens do cliente
  const showMenuButton = !selectMode;
  const [menuOpen, setMenuOpen] = useState(false);
  /** Âncora visual do menu: sempre na bolha (desktop e mobile). */
  const menuAnchorRef = useRef(null);
  const menuElRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const longPressCleanupRef = useRef(null);
  const bubbleRef = useRef(null);
  /** Mobile: após long press abrir menu, ignorar o próximo clique na foto/vídeo (evita abrir viewer). */
  const skipNextMediaTapRef = useRef(false);

  useEffect(() => {
    if (!zapAnimateIn || !bubbleRef.current) return undefined;
    const el = bubbleRef.current;
    const onEnd = () => el.classList.add("zap-anim-settled");
    el.addEventListener("animationend", onEnd, { once: true });
    return () => el.removeEventListener("animationend", onEnd);
  }, [zapAnimateIn]);
  const [menuStyle, setMenuStyle] = useState(null);
  const [reactionOpen, setReactionOpen] = useState(false);
  const isCall = !isApagadaParaTodos && msg?.tipo === "call";
  const [audioDur, setAudioDur] = useState(0);
  const audioDurLabel = useMemo(() => (audioDur > 0 ? formatMmSs(audioDur) : null), [audioDur]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e) => {
      const a = menuAnchorRef.current;
      const m = menuElRef.current;
      if (a && a.contains(e.target)) return;
      if (m && m.contains(e.target)) return;
      setMenuOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const computeMenuPosition = useCallback(() => {
    const a = menuAnchorRef.current;
    if (!a) return;
    const { innerWidth: vw, visibleHeight, visibleTop, keyboardInsetBottom } = getVisualViewportLayout();
    const visibleBottom = visibleTop + visibleHeight;

    if (menuUsesBottomSheet) {
      const bottomPx = Math.max(8, keyboardInsetBottom + 6);
      const maxSheetPx = Math.max(200, Math.floor(visibleHeight - bottomPx - 14));
      setMenuStyle({
        position: "fixed",
        left: 10,
        right: 10,
        width: "auto",
        bottom: `${bottomPx}px`,
        top: "auto",
        maxHeight: `${maxSheetPx}px`,
        overflowY: "auto",
        WebkitOverflowScrolling: "touch",
        overscrollBehavior: "contain",
        zIndex: 10002,
      });
      return;
    }

    const rect = a.getBoundingClientRect();
    const desiredW = 220;
    const w = Math.max(180, Math.min(desiredW, vw - 16));

    let left = rect.right - w;
    left = clamp(left, 8, Math.max(8, vw - w - 8));

    let top = rect.bottom + 6;
    const approxH = menuElRef.current?.offsetHeight || 320;
    let placed = "down";

    if (top + approxH > visibleBottom - 8) {
      top = rect.top - approxH - 6;
      placed = "up";
    }
    top = clamp(top, visibleTop + 8, Math.max(visibleTop + 8, visibleBottom - 120));

    const maxHeight =
      placed === "down"
        ? Math.max(160, visibleBottom - top - 8)
        : Math.max(160, rect.top - visibleTop - 8);

    setMenuStyle({
      position: "fixed",
      top,
      left,
      width: w,
      maxHeight,
      overflowY: "auto",
      WebkitOverflowScrolling: "touch",
      zIndex: 10002,
    });
  }, [menuUsesBottomSheet]);

  useEffect(() => {
    if (!menuOpen) return;
    const tick = () => computeMenuPosition();
    tick();
    // recalcula após render/medida real
    const raf = requestAnimationFrame(tick);

    const onReflow = () => computeMenuPosition();
    window.addEventListener("resize", onReflow);
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    vv?.addEventListener("resize", onReflow);
    vv?.addEventListener("scroll", onReflow);
    // captura scroll dentro do container de mensagens também
    document.addEventListener("scroll", onReflow, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onReflow);
      vv?.removeEventListener("resize", onReflow);
      vv?.removeEventListener("scroll", onReflow);
      document.removeEventListener("scroll", onReflow, true);
    };
  }, [menuOpen, computeMenuPosition]);

  const LONG_PRESS_MS = 480;
  const LONG_PRESS_MOVE_PX = 14;

  const clearLongPressTracking = useCallback(() => {
    if (longPressTimerRef.current != null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    const rm = longPressCleanupRef.current;
    longPressCleanupRef.current = null;
    if (typeof rm === "function") rm();
  }, []);

  const onBubblePointerDown = useCallback(
    (e) => {
      if (!mobileMessageChrome || selectMode || menuOpen) return;
      if (e.button !== 0) return;
      const el = e.target;
      if (el && typeof el.closest === "function") {
        if (
          el.closest(
            ".wa-reactionBtn, .wa-reactionPicker, .wa-msgMenuBtn, .wa-selectChk, .wa-bubble-fileAction, .wa-audioPlayBtn, [role=\"slider\"]"
          )
        )
          return;
        if (el.closest("button, a[href]")) return;
      }
      clearLongPressTracking();
      const x0 = e.clientX;
      const y0 = e.clientY;

      const onMove = (ev) => {
        if (
          Math.abs(ev.clientX - x0) > LONG_PRESS_MOVE_PX ||
          Math.abs(ev.clientY - y0) > LONG_PRESS_MOVE_PX
        ) {
          clearLongPressTracking();
        }
      };
      const onEnd = () => {
        clearLongPressTracking();
      };

      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerup", onEnd);
      window.addEventListener("pointercancel", onEnd);

      longPressCleanupRef.current = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onEnd);
        window.removeEventListener("pointercancel", onEnd);
      };

      longPressTimerRef.current = window.setTimeout(() => {
        longPressTimerRef.current = null;
        const rmListeners = longPressCleanupRef.current;
        longPressCleanupRef.current = null;
        if (typeof rmListeners === "function") rmListeners();
        try {
          if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(12);
        } catch (_) {}
        skipNextMediaTapRef.current = true;
        setMenuOpen(true);
      }, LONG_PRESS_MS);
    },
    [mobileMessageChrome, selectMode, menuOpen, clearLongPressTracking]
  );

  useEffect(() => () => clearLongPressTracking(), [clearLongPressTracking]);

  const handleToggleSelect = useCallback(
    (e) => {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      onToggleSelected?.(msg);
    },
    [onToggleSelected, msg]
  );

  const doCopy = useCallback(async () => {
    const text =
      safeString(msg?.texto) ||
      (mediaUrl ? `${msg?.nome_arquivo ? `${msg.nome_arquivo}\n` : ""}${mediaUrl}` : "");
    const ok = await copyTextToClipboard(text);
    onCopy?.(ok);
  }, [msg, mediaUrl, onCopy]);

  const runAction = useCallback(
    async (action) => {
      setMenuOpen(false);
      if (action === "info") onInfo?.(msg);
      if (action === "reply") onReply?.(msg);
      if (action === "copy") await doCopy();
      if (action === "forward") onForward?.(msg);
      if (action === "pin") onTogglePin?.(msg);
      if (action === "star") onToggleStar?.(msg);
      if (action === "select") onStartSelect?.(msg);
      if (action === "deleteForMe") onDeleteForMe?.(msg);
      if (action === "deleteForEveryone") onDeleteForEveryone?.(msg);
    },
    [msg, onInfo, onReply, doCopy, onForward, onTogglePin, onToggleStar, onStartSelect, onDeleteForMe, onDeleteForEveryone]
  );

  return (
      <div
        className={`wa-row ${out ? "wa-row-out" : "wa-row-in"}${localReaction ? " wa-row--hasReaction" : ""}${
          captionBundleTop ? " wa-row--captionBundleTop" : ""
        }${captionBundleFollow ? " wa-row--captionBundleFollow" : ""}${menuOpen ? " wa-row--menuOpen" : ""}`}
        data-msg-id={msg?.id}
        data-group-start={showRemetente && !out ? "1" : "0"}
      >
      {selectMode && !msg?.apagada_para_todos ? (
        <button
          type="button"
          className={`wa-selectChk ${selected ? "isOn" : ""}`}
          onClick={handleToggleSelect}
          title={selected ? "Desmarcar" : "Selecionar"}
          aria-label={selected ? "Desmarcar mensagem" : "Selecionar mensagem"}
        >
          {selected ? "✓" : ""}
        </button>
      ) : null}

      <SwipeReplyTrack
        enabled={Boolean(swipeReplyEnabled && !isCall && !msg?.apagada_para_todos)}
        outgoing={out}
        gestureBlocked={menuOpen || reactionOpen || selectMode}
        onCommit={() => {
          setMenuOpen(false);
          setReactionOpen(false);
          onReply?.(msg);
        }}
      >
      <div
        ref={(node) => {
          menuAnchorRef.current = node;
          bubbleRef.current = node;
        }}
        className={[
          "wa-bubble",
          zapAnimateIn ? "zap-message-enter" : "",
          out ? "wa-bubble-out" : "wa-bubble-in",
          hasInlineMetaClass ? "hasInlineMeta" : "",
          (isImg || isSticker) ? "wa-bubble-media" : "",
          isSticker ? "wa-bubble-sticker sticker-message" : "",
          isImg && !isSticker ? "image-message" : "",
          isFile ? "wa-bubble-fileWrap" : "",
          isContact ? "wa-bubble-contactWrap" : "",
          isLocation ? "wa-bubble-locationWrap" : "",
          isAudioOrVoice ? "wa-bubble-audio audio-message" : "",
          isVideo ? "wa-bubble-video" : "",
          selected ? "isSelected" : "",
          menuOpen ? "wa-bubble--menuOpen" : "",
          mobileMessageChrome ? "wa-bubble--mobileUx" : "",
          msg?.apagada_para_todos ? "wa-bubble--revokedEveryone" : "",
        ].filter(Boolean).join(" ")}
        onClick={selectMode && !msg?.apagada_para_todos ? handleToggleSelect : undefined}
        onPointerDown={mobileMessageChrome && !selectMode ? onBubblePointerDown : undefined}
        onContextMenu={mobileMessageChrome ? (ev) => ev.preventDefault() : undefined}
        onSelectStart={(ev) => ev.preventDefault()}
        role="group"
        aria-label="Mensagem"
      >
        {showMenuButton && !mobileMessageChrome ? (
          <button
            type="button"
            className={`wa-msgMenuBtn wa-msgMenuBtn--top ${menuOpen ? "isOpen" : ""}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            title="Mais opções"
            aria-label="Abrir opções da mensagem"
          >
            ▾
          </button>
        ) : null}
        <div className="wa-bubble-body">
          {/* Badge de mensagem encaminhada — acima de tudo */}
          {isEncaminhado && !isFile && !isContact && !isLocation ? (
            <div className="wa-bubble-fwd-badge">
              <svg className="wa-bubble-fwd-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="15 10 20 15 15 20" />
                <path d="M4 4v7a4 4 0 0 0 4 4h12" />
              </svg>
              <span>Encaminhado</span>
            </div>
          ) : null}
          {/* Citação (reply) — sempre no topo, antes de qualquer conteúdo */}
          {hasReply && (
            <div
              className={`wa-replyCtx ${out ? "isOut" : "isIn"}`}
              aria-label="Mensagem citada"
              role="button"
              tabIndex={0}
              title="Ver mensagem respondida"
              onClick={(e) => {
                e?.stopPropagation?.();
                const rid = replyMeta?.replyToId;
                if (rid && onJumpToReply) onJumpToReply(rid);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  const rid = replyMeta?.replyToId;
                  if (rid && onJumpToReply) onJumpToReply(rid);
                }
              }}
            >
              <div className="wa-replyCtx-bar" aria-hidden="true" />
              <div className="wa-replyCtx-content">
                {safeString(replyMeta.thumb) ? (
                  <img
                    src={replyMeta.thumb}
                    alt=""
                    className="wa-replyCtx-thumb"
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                  />
                ) : null}
                <div className="wa-replyCtx-textStack">
                  <div className="wa-replyCtx-name">
                    {replyMeta.name && replyMeta.name !== "Contato"
                      ? replyMeta.name
                      : (peerName || replyMeta.name)}
                  </div>
                  <div className="wa-replyCtx-snippet">{replySnippetDisplay(replyMeta)}</div>
                </div>
              </div>
            </div>
          )}
          {/* Nome do atendente acima da mensagem enviada pelo sistema (respeita mostrar_nome_ao_cliente) */}
          {out &&
          msg?.enviado_por_usuario &&
          !isApagadaParaTodos &&
          safeString(msg?.usuario_nome) &&
          mostrarNomeAoCliente ? (
            <div className="wa-bubble-atendente" aria-label={`Enviado por ${msg.usuario_nome}`}>
              {msg.usuario_nome}
            </div>
          ) : null}
          {remetente ? (
            <div className="wa-bubble-remetente">
              <span className="wa-bubble-remetente-nome">
                {remetente}:
              </span>
              {isImg || isSticker ? (
                <div className="wa-bubble-mediaStack">
                  <button
                    type="button"
                    className="wa-bubble-imgLink"
                    onClick={(e) => {
                      if (selectMode) return;
                      e.stopPropagation();
                      if (skipNextMediaTapRef.current) {
                        skipNextMediaTapRef.current = false;
                        return;
                      }
                      onOpenMedia?.(mediaUrl, isSticker ? "figurinha" : "imagem");
                    }}
                  >
                    <img
                      src={mediaUrl}
                      alt={isSticker ? "figurinha" : "imagem"}
                      className="wa-bubble-img"
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                    />
                  </button>
                  {showCaption ? <div className="wa-bubble-caption">{renderTextWithLinks(texto)}</div> : null}
                </div>
              ) : isVideo ? (
                <div className="wa-bubble-mediaStack">
                  <button
                    type="button"
                    className="wa-bubble-videoLink"
                    onClick={(e) => {
                      if (selectMode) return;
                      e.stopPropagation();
                      if (skipNextMediaTapRef.current) {
                        skipNextMediaTapRef.current = false;
                        return;
                      }
                      onOpenMedia?.(mediaUrl, "video");
                    }}
                  >
                    <video src={mediaUrl} playsInline className="wa-bubble-videoEl" />
                  </button>
                  {showCaption ? <div className="wa-bubble-caption">{renderTextWithLinks(texto)}</div> : null}
                </div>
              ) : isFile ? (
                <FileBubbleContent
                  msg={msg}
                  mediaUrl={mediaUrl}
                  selectMode={selectMode}
                  onOpenMedia={onOpenMedia}
                  isGroup={isGroup}
                  out={out}
                />
              ) : isLocation ? (
                <LocationBubbleContent msg={msg} selectMode={selectMode} isGroup={isGroup} out={out} />
              ) : isContact ? (
                <ContactBubbleContent
                  msg={msg}
                  contactMeta={contactBubbleMeta}
                  selectMode={selectMode}
                  isGroup={isGroup}
                  out={out}
                  onConversar={onConversarContact}
                  onAdicionarGrupo={onAdicionarGrupoContact}
                />
              ) : hasText ? (
                inlineMeta ? (
                  <span className="wa-bubble-text wa-bubble-textInline">
                    {renderTextWithLinks(texto)}
                    <span className="wa-inlineMeta" aria-label="Horário e status">
                      <span className="wa-inlineTime">{formatHora(msg?.criado_em)}</span>
                      <MessageTicks msg={msg} isGroup={Boolean(isGroup)} />
                    </span>
                  </span>
                ) : (
                  <span className="wa-bubble-text">{renderTextWithLinks(texto)}</span>
                )
              ) : (
                <span className="wa-bubble-text wa-muted">(mídia)</span>
              )}
            </div>
          ) : isImg || isSticker ? (
            <div className="wa-bubble-mediaStack">
              <button
                type="button"
                className="wa-bubble-imgLink"
                onClick={(e) => {
                  if (selectMode) return;
                  e.stopPropagation();
                  if (skipNextMediaTapRef.current) {
                    skipNextMediaTapRef.current = false;
                    return;
                  }
                  onOpenMedia?.(mediaUrl, isSticker ? "figurinha" : "imagem");
                }}
              >
                <img
                  src={mediaUrl}
                  alt={isSticker ? "figurinha" : "imagem"}
                  className="wa-bubble-img"
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                />
              </button>
              {showCaption ? <div className="wa-bubble-caption">{renderTextWithLinks(texto)}</div> : null}
            </div>
          ) : isVideo && mediaUrl ? (
            <div className="wa-bubble-mediaStack">
              <button
                type="button"
                className="wa-bubble-videoLink"
                onClick={(e) => {
                  if (selectMode) return;
                  e.stopPropagation();
                  if (skipNextMediaTapRef.current) {
                    skipNextMediaTapRef.current = false;
                    return;
                  }
                  onOpenMedia?.(mediaUrl, "video");
                }}
              >
                <video src={mediaUrl} playsInline className="wa-bubble-videoEl" />
              </button>
              {showCaption ? <div className="wa-bubble-caption">{renderTextWithLinks(texto)}</div> : null}
            </div>
          ) : isAudioOrVoice && mediaUrl ? (
            <div className="wa-bubble-audioStack">
              <div className="wa-bubble-audioWrap">
                <AudioWavePlayer
                  src={mediaUrl}
                  msgKey={msg?.whatsapp_id || msg?.id || mediaUrl}
                  avatarUrl={!out ? peerAvatarUrl : null}
                  avatarLabel={!out ? peerName : null}
                  sentAtLabel={formatHora(msg?.criado_em)}
                  onDuration={(d) => {
                    setAudioDur(d);
                    if (msg?.id) {
                      try {
                        useConversaStore.getState().patchMensagem(msg.id, { audio_duracao_sec: d });
                      } catch {}
                    }
                  }}
                />
              </div>
              {showAudioText ? <div className="wa-bubble-audioCaption">{renderTextWithLinks(texto)}</div> : null}
            </div>
          ) : isFile ? (
            <FileBubbleContent
              msg={msg}
              mediaUrl={mediaUrl}
              selectMode={selectMode}
              onOpenMedia={onOpenMedia}
              isGroup={isGroup}
              out={out}
            />
          ) : isLocation ? (
            <LocationBubbleContent msg={msg} selectMode={selectMode} isGroup={isGroup} out={out} />
          ) : isContact ? (
            <ContactBubbleContent
              msg={msg}
              contactMeta={contactBubbleMeta}
              selectMode={selectMode}
              isGroup={isGroup}
              out={out}
              onConversar={onConversarContact}
              onAdicionarGrupo={onAdicionarGrupoContact}
            />
          ) : isCall ? (
            <div className="wa-callBubble">
              <div className="wa-callIcon" aria-hidden="true">📞</div>
              <div className="wa-callText">
                {texto || "Ligação via WhatsApp"}
              </div>
            </div>
          ) : hasText ? (
            inlineMeta ? (
              <span className="wa-bubble-text wa-bubble-textInline">
                {renderTextWithLinks(texto)}
                <span className="wa-inlineMeta" aria-label="Horário e status">
                  <span className="wa-inlineTime">{formatHora(msg?.criado_em)}</span>
                  <MessageTicks msg={msg} isGroup={Boolean(isGroup)} />
                </span>
              </span>
            ) : (
              <span className="wa-bubble-text">{renderTextWithLinks(texto)}</span>
            )
          ) : (
            <span className="wa-bubble-text wa-muted">(mensagem vazia)</span>
          )}
        </div>
        {!isCall ? (
          <button
            type="button"
            className={`wa-reactionBtn ${reactionOpen ? "isOpen" : ""}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setReactionOpen((v) => !v);
            }}
            title="Reagir"
            aria-label="Reagir à mensagem"
            disabled={reactionBusy || !!msg?.apagada_para_todos}
          >
            <IconEmoji style={{ width: 12, height: 12 }} />
          </button>
        ) : null}
        <div className="wa-bubble-meta">
          <div className="wa-bubble-metaLeft">
            {showFloatingMetaTime ? (
              <>
                {!(isAudioOrVoice && mediaUrl) ? (
                  <span className="wa-bubble-time">{formatHora(msg?.criado_em)}</span>
                ) : null}
                <MessageTicks msg={msg} isGroup={Boolean(isGroup)} />
              </>
            ) : null}
            {isPinned ? <span className="wa-bubble-badge" title="Fixada">📌</span> : null}
            {isStarred ? <span className="wa-bubble-badge" title="Favorita">★</span> : null}
          </div>
        </div>

        {reactionOpen && !isCall ? (
          <div
            className="wa-reactionPicker"
            onClick={(e) => e.stopPropagation()}
          >
            {["❤️", "👍", "😂", "😮", "😢", "👎"].map((emo) => (
              <button
                key={emo}
                type="button"
                className="wa-reactionPicker-btn"
                disabled={reactionBusy || !!msg?.apagada_para_todos}
                onClick={() => {
                  onReact?.(msg, emo);
                  setReactionOpen(false);
                }}
              >
                {emo}
              </button>
            ))}
            {localReaction ? (
              <button
                type="button"
                className="wa-reactionPicker-remove"
                disabled={reactionBusy || !!msg?.apagada_para_todos}
                onClick={() => {
                  onRemoveReaction?.(msg);
                  setReactionOpen(false);
                }}
              >
                Remover reação
              </button>
            ) : null}
          </div>
        ) : null}

        {localReaction ? (
          <div className="wa-bubble-reaction" aria-label={`Sua reação: ${localReaction}`}>
            {localReaction}
          </div>
        ) : null}
      </div>
      </SwipeReplyTrack>

      {menuOpen
        ? createPortal(
            <>
              <div
                className={`wa-msgMenuBackdrop${menuUsesBottomSheet ? " wa-msgMenuBackdrop--sheet" : ""}`}
                aria-hidden="true"
                onPointerDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  e.preventDefault();
                  setMenuOpen(false);
                }}
              />
              <div
                ref={menuElRef}
                className={`wa-msgMenu${menuUsesBottomSheet ? " wa-msgMenu--sheet" : ""}`}
                style={menuStyle || { position: "fixed", top: -9999, left: -9999 }}
                role="menu"
                aria-label="Opções da mensagem"
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
              >
              {out ? (
                <>
                  <button type="button" className="wa-msgMenuItem" onClick={() => runAction("info")} role="menuitem">
                    Dados da mensagem
                  </button>
                  <div className="wa-msgMenuSep" aria-hidden="true" />
                </>
              ) : null}
              {!msg?.apagada_para_todos ? (
                <button type="button" className="wa-msgMenuItem" onClick={() => runAction("reply")} role="menuitem">
                  Responder
                </button>
              ) : null}
              <button type="button" className="wa-msgMenuItem" onClick={() => runAction("copy")} role="menuitem">
                Copiar
              </button>
              {!msg?.apagada_para_todos ? (
                <>
                  <button type="button" className="wa-msgMenuItem" onClick={() => runAction("forward")} role="menuitem">
                    Encaminhar
                  </button>
                  <button type="button" className="wa-msgMenuItem" onClick={() => runAction("pin")} role="menuitem">
                    {isPinned ? "Desafixar" : "Fixar"}
                  </button>
                  <button type="button" className="wa-msgMenuItem" onClick={() => runAction("star")} role="menuitem">
                    {isStarred ? "Desfavoritar" : "Favoritar"}
                  </button>
                  <button type="button" className="wa-msgMenuItem" onClick={() => runAction("select")} role="menuitem">
                    Selecionar
                  </button>
                </>
              ) : null}
              <div className="wa-msgMenuSep" aria-hidden="true" />
              <button
                type="button"
                className="wa-msgMenuItem"
                onClick={() => runAction("deleteForMe")}
                role="menuitem"
              >
                Apagar para mim
              </button>
              {canDeleteForEveryone ? (
                <button
                  type="button"
                  className="wa-msgMenuItem wa-msgMenuItemDanger"
                  onClick={() => runAction("deleteForEveryone")}
                  role="menuitem"
                >
                  Apagar para todos
                </button>
              ) : null}
              </div>
            </>,
            document.body
          )
        : null}
    </div>
  );
});

/* =========================================================
   Hooks
========================================================= */

function useStableTimeout() {
  const ref = useRef(null);
  const clear = useCallback(() => {
    if (ref.current) {
      clearTimeout(ref.current);
      ref.current = null;
    }
  }, []);
  const set = useCallback(
    (fn, ms) => {
      clear();
      ref.current = setTimeout(fn, ms);
    },
    [clear]
  );

  useEffect(() => clear, [clear]);
  return { set, clear };
}

function snapThreadToBottom(container, virtualListRef) {
  const v = virtualListRef?.current;
  if (v && typeof v.scrollToEnd === "function") {
    try {
      v.scrollToEnd({ align: "end", behavior: "auto" });
    } catch {
      /* ignore */
    }
  }
  if (container) {
    const apply = () => {
      try {
        container.scrollTop = container.scrollHeight;
      } catch {
        /* ignore */
      }
    };
    apply();
    requestAnimationFrame(apply);
  }
}

function useAutoScroll({
  conversaId,
  loading,
  lastMsgKey,
  lastMsg,
  myUserId,
  messagesContainerRef,
  shouldStickToBottomRef,
  virtualListRef,
  /** Contagem bruta no store — quando passa de 0 a N após o load, força novo snap até às mensagens mais recentes. */
  mensagensCount = 0,
}) {
  const prevConversaIdRef = useRef(null);
  const prevLastKeyRef = useRef(null);
  /** Após `carregarConversa`, o painel de mensagens só tem altura real quando `loading` vira false — scroll antes disso não chega ao fim. */
  const pendingJumpToBottomRef = useRef(false);
  /** Segundo passe quando a lista ainda estava vazia no 1º snap (virtualizer mede altura só depois). */
  const anchorLatestUntilMsgsRef = useRef(false);
  const prevLoadingForSnapRef = useRef(loading);
  const prevSnapConversaKeyRef = useRef(null);

  // useLayoutEffect síncrono: ancora o scroll na base ANTES do browser pintar.
  // Isso elimina a "animação visível" (smooth scroll que jogava a tela pra cima
  // quando o usuário enviava uma mensagem). Para mensagens próprias / stick-to-bottom
  // a nova bolha simplesmente aparece colada no fundo — sem movimento perceptível.
  useLayoutEffect(() => {
    const conversaIdAtual = conversaId ? String(conversaId) : null;
    const container = messagesContainerRef?.current;

    if (!conversaIdAtual) {
      prevConversaIdRef.current = null;
      prevLastKeyRef.current = null;
      pendingJumpToBottomRef.current = false;
      anchorLatestUntilMsgsRef.current = false;
      return;
    }

    // primeira conversa / primeira seleção desta sessão no painel
    if (!prevConversaIdRef.current) {
      prevConversaIdRef.current = conversaIdAtual;
      prevLastKeyRef.current = lastMsgKey;
      shouldStickToBottomRef.current = true;
      pendingJumpToBottomRef.current = true;
      anchorLatestUntilMsgsRef.current = true;
      return;
    }

    // troca de conversa
    if (prevConversaIdRef.current !== conversaIdAtual) {
      prevConversaIdRef.current = conversaIdAtual;
      prevLastKeyRef.current = lastMsgKey;
      shouldStickToBottomRef.current = true;
      pendingJumpToBottomRef.current = true;
      anchorLatestUntilMsgsRef.current = true;
      return;
    }

    // novas mensagens (mesma conversa)
    if (lastMsgKey && lastMsgKey !== prevLastKeyRef.current) {
      const fromMe =
        isOutgoingMessage(lastMsg) ||
        lastMsg?.fromMe === true ||
        (myUserId != null && lastMsg?.autor_usuario_id != null && String(lastMsg.autor_usuario_id) === String(myUserId));
      const shouldAutoScroll = Boolean(shouldStickToBottomRef.current || fromMe);
      if (shouldAutoScroll && container) {
        snapThreadToBottom(container, virtualListRef);
      }
    }

    prevLastKeyRef.current = lastMsgKey;
  }, [
    conversaId,
    lastMsgKey,
    lastMsg,
    myUserId,
    messagesContainerRef,
    shouldStickToBottomRef,
    virtualListRef,
  ]);

  // Ao abrir/trocar conversa: ancora nas últimas mensagens UMA vez ao ficar pronto (não reexecuta a cada nova msg).
  // Menos rAF/timers no mobile = scroll tátil mais livre depois de entrar.
  useLayoutEffect(() => {
    if (!conversaId) return;
    const convKey = String(conversaId);
    if (prevSnapConversaKeyRef.current !== convKey) {
      prevSnapConversaKeyRef.current = convKey;
      prevLoadingForSnapRef.current = loading;
    }
    const becameReady = prevLoadingForSnapRef.current === true && loading === false;
    prevLoadingForSnapRef.current = loading;
    if (loading) return;

    const shouldSnapLatest =
      pendingJumpToBottomRef.current ||
      (anchorLatestUntilMsgsRef.current && mensagensCount > 0) ||
      (becameReady && mensagensCount > 0);

    if (!shouldSnapLatest) return;

    const container = messagesContainerRef?.current;
    if (pendingJumpToBottomRef.current) pendingJumpToBottomRef.current = false;
    if (mensagensCount > 0) anchorLatestUntilMsgsRef.current = false;

    shouldStickToBottomRef.current = true;
    const mobileLike =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(max-width: 640px)").matches;
    // Mobile: menos rAF encadeados — o virtualizer já âncora via scrollToEnd,
    // iterações extras bloqueiam o thread principal e causam travamento ao abrir.
    const rafCap = mobileLike ? 3 : 10;
    const stickMax = mobileLike ? 5 : 18;

    const snap = () => {
      if (!shouldStickToBottomRef.current) return;
      snapThreadToBottom(container, virtualListRef);
    };
    snap();
    let n = 0;
    const chain = () => {
      // Para imediatamente se já estiver na posição correta — evita saturar mobile.
      if (mobileLike && isNearBottom(messagesContainerRef?.current, 80)) return;
      n += 1;
      snap();
      if (n < rafCap) requestAnimationFrame(chain);
    };
    requestAnimationFrame(chain);
    const t1 = window.setTimeout(snap, 0);
    const t2 = window.setTimeout(snap, mobileLike ? 80 : 120);
    const t3 = !mobileLike ? window.setTimeout(snap, 380) : 0;

    let rafStick = 0;
    let stickAttempts = 0;
    const tryStickOpen = () => {
      const c = messagesContainerRef?.current;
      stickAttempts += 1;
      if (!c || stickAttempts > stickMax) return;
      if (!shouldStickToBottomRef.current) return;
      if (!isNearBottom(c, mobileLike ? 80 : 200)) {
        snap();
        rafStick = requestAnimationFrame(tryStickOpen);
      }
      // Se já está perto do fundo: para o loop, estava travando o mobile.
    };
    rafStick = requestAnimationFrame(tryStickOpen);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      if (t3) window.clearTimeout(t3);
      if (rafStick) cancelAnimationFrame(rafStick);
    };
  }, [conversaId, loading, mensagensCount, messagesContainerRef, shouldStickToBottomRef, virtualListRef]);
}

function useGlobalHotkeys({ onToggleTimeline, onFocusInput, onEscape, disabled }) {
  useEffect(() => {
    if (disabled) return;

    function onKeyDown(e) {
      const k = String(e.key || "").toLowerCase();

      if ((e.ctrlKey || e.metaKey) && k === "k") {
        e.preventDefault();
        onFocusInput?.();
      }

      if ((e.ctrlKey || e.metaKey) && k === "h") {
        e.preventDefault();
        onToggleTimeline?.();
      }

      if (k === "escape") {
        e.preventDefault();
        onEscape?.();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onToggleTimeline, onFocusInput, onEscape, disabled]);
}

/* =========================================================
   Main
========================================================= */

export default function ConversaView() {
  const {
    conversa,
    mensagens,
    loading,
    loadError,
    loadingMore,
    hasMore,
    cursor,
  } = useConversaStore(
    (s) => ({
      conversa: s.conversa,
      mensagens: s.mensagens,
      loading: s.loading,
      loadError: s.loadError,
      loadingMore: s.loadingMore,
      hasMore: s.hasMore,
      cursor: s.cursor,
    }),
    shallow
  );

  const { tags, atendimentos, atendimentosLoading } = useConversaStore(
    (s) => ({
      tags: s.tags,
      atendimentos: s.atendimentos,
      atendimentosLoading: s.atendimentosLoading,
    }),
    shallow
  );

  const selectedId = useConversaStore((s) => s.selectedId);
  const setSelectedId = useConversaStore((s) => s.setSelectedId);

  /** Só a entrada da conversa atual — não re-renderiza quando outro chat recebe typing_start. */
  const typingInfo = useConversaStore((s) => {
    const id = s.conversa?.id ?? s.selectedId;
    if (id == null || id === "") return null;
    return s.typing[String(id)] ?? null;
  });

  const {
    refresh,
    loadMore,
    carregarConversa,
    anexarMensagem,
      marcarMensagemApagadaParaTodos,
      removerMensagem,
      removerMensagemTemp,
    carregarAtendimentos,
    clearTyping,
    assumirConversa,
  } = useConversaStore(
    (s) => ({
      refresh: s.refresh,
      loadMore: s.loadMore,
      carregarConversa: s.carregarConversa,
      anexarMensagem: s.anexarMensagem,
      marcarMensagemApagadaParaTodos: s.marcarMensagemApagadaParaTodos,
      removerMensagem: s.removerMensagem,
      removerMensagemTemp: s.removerMensagemTemp,
      carregarAtendimentos: s.carregarAtendimentos,
      clearTyping: s.clearTyping,
      assumirConversa: s.assumirConversa,
    }),
    shallow
  );

  const user = useAuthStore((s) => s.user);
  const myUserId = user?.id != null ? Number(user.id) : null;
  const podeGerenciarSetores = canGerenciarSetores(user);
  const podeTransferirSetor = canTransferirSetorConversa(user);
  const podeGerenciarTags = canTag(user);
  const mostrarEnviarCrm = user?.crm_habilitado !== false;
  const headerCompact = useMatchMedia("(max-width: 640px)");
  /** Tablet atendimento: mesmo padrão do mobile — correção no menu (+), barra em uma linha */
  const atendimentoTabletComposer = useMatchMedia("(min-width: 740px) and (max-width: 1024px)");
  /** Bolhas: long press + folha de opções; barra de seleção premium (sem alterar desktop largo). */
  const compactMessageUx = headerCompact || atendimentoTabletComposer;
  const autocorrectToggleInMenu = headerCompact || atendimentoTabletComposer;
  /** Mobile/tablet: tecla Retorno do teclado virtual insere nova linha; enviar só pelo botão (evita enterKeyHint=send esconder o enter). */
  const composerEnterInsertsNewline = headerCompact || atendimentoTabletComposer;
  const composerAppendQueue = useConversaStore((s) => s.composerAppendQueue);
  const clearComposerAppendQueue = useConversaStore((s) => s.clearComposerAppendQueue);
  const queueComposerAppend = useConversaStore((s) => s.queueComposerAppend);

  const podeEnviar = useMemo(() => {
    if (!user?.id || !conversa?.id) return false;
    /** Grupos: qualquer usuário pode enviar sem assumir atendimento (modelo WhatsApp). */
    if (isGroupConversation(conversa)) return true;
    if (conversa?.mensagens_bloqueadas) return false;
    const perfil = String(user?.perfil || user?.role || "").toLowerCase();
    if (perfil === "admin") return true;
    const atendenteId = conversa?.atendente_id ?? null;
    if (atendenteId == null || atendenteId === "") return false;
    return String(atendenteId) === String(user.id);
  }, [user?.id, user?.perfil, user?.role, conversa, conversa?.atendente_id, conversa?.id, conversa?.mensagens_bloqueadas]);

  const [texto, setTexto] = useState("");
  const [autoCorrectEnabled, setAutoCorrectEnabled] = useState(true);
  const [autoCorrectFlash, setAutoCorrectFlash] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [sending, setSending] = useState(false);

  const [emojiOpen, setEmojiOpen] = useState(false);
  const [emojiQuery, setEmojiQuery] = useState("");
  const emojiPanelRef = useRef(null);
  const emojiSearchRef = useRef(null);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [stickerQuery, setStickerQuery] = useState("");
  const [recentStickers, setRecentStickers] = useState([]);
  const stickerPanelRef = useRef(null);
  const stickerSearchRef = useRef(null);
  const stickerBtnRef = useRef(null);

  const [toast, setToast] = useState(null);
  const toastT = useStableTimeout();

  const [dragOver, setDragOver] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);
  const [pendingPreview, setPendingPreview] = useState(null);
  /** Legenda opcional digitada no preview (apenas imagem/vídeo, estilo WhatsApp). */
  const [pendingCaption, setPendingCaption] = useState("");
  const pendingCaptionRef = useRef(null);
  const mediaPreviewRootRef = useRef(null);
  const pendingBlobUrlRef = useRef(null);
  const confirmSendLockRef = useRef(false);
  const [mediaViewer, setMediaViewer] = useState(null); // { url, type, fileName }
  const [mediaPdfBlobUrl, setMediaPdfBlobUrl] = useState(null);
  const [mediaPdfLoading, setMediaPdfLoading] = useState(false);
  const [mediaPdfError, setMediaPdfError] = useState(null);
  const [mediaPrintLoading, setMediaPrintLoading] = useState(false);
  const mediaViewerImgRef = useRef(null);
  const mediaViewerVideoRef = useRef(null);
  const [localReactions, setLocalReactions] = useState({});
  const [reactionLoading, setReactionLoading] = useState({});

  const [shareContactOpen, setShareContactOpen] = useState(false);
  const [shareContactQuery, setShareContactQuery] = useState("");
  const [shareContactList, setShareContactList] = useState([]);
  const [shareContactLoading, setShareContactLoading] = useState(false);
  const [shareContactSending, setShareContactSending] = useState(false);

  const [shareLocationOpen, setShareLocationOpen] = useState(false);
  const [shareLocationGeoLoading, setShareLocationGeoLoading] = useState(false);
  const [shareLocationGeoError, setShareLocationGeoError] = useState(null);
  const [shareLocationLat, setShareLocationLat] = useState("");
  const [shareLocationLng, setShareLocationLng] = useState("");
  const [shareLocationNome, setShareLocationNome] = useState("");
  const [shareLocationEndereco, setShareLocationEndereco] = useState("");
  const [shareLocationSending, setShareLocationSending] = useState(false);

  const [addToGroupModal, setAddToGroupModal] = useState({ open: false, telefone: null, nome: null });
  const [addToGroupGrupos, setAddToGroupGrupos] = useState([]);
  const [addToGroupLoading, setAddToGroupLoading] = useState(false);
  const [addToGroupSending, setAddToGroupSending] = useState(false);

  const [callModalOpen, setCallModalOpen] = useState(false);
  const [callDuration, setCallDuration] = useState(5);
  const [callSending, setCallSending] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const attachMenuRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const shouldStickToBottomRef = useRef(true);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingCanceledRef = useRef(false);
  const recordingTimerRef = useRef(null);
  /** Stream de microfone reutilizado entre gravações (evita pedir permissão a cada áudio). */
  const micStreamRef = useRef(null);

  const [allTags, setAllTags] = useState([]);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [tagMutatingId, setTagMutatingId] = useState(null);
  const [showClienteSide, setShowClienteSide] = useState(false);
  const [showTransferirSetor, setShowTransferirSetor] = useState(false);
  const [pixModalOpen, setPixModalOpen] = useState(false);
  const [pixConfigLoading, setPixConfigLoading] = useState(false);
  const [pixConfigLoaded, setPixConfigLoaded] = useState(false);
  const [pixConfigSaving, setPixConfigSaving] = useState(false);
  const [pixActionBusy, setPixActionBusy] = useState(false);
  const [pixTipoChave, setPixTipoChave] = useState("cpf");
  const [pixChave, setPixChave] = useState("");
  const [pixNomeRecebedor, setPixNomeRecebedor] = useState("");
  const [pixMensagemPadrao, setPixMensagemPadrao] = useState("");
  const [departamentos, setDepartamentos] = useState([]);
  const [transferirSetorLoading, setTransferirSetorLoading] = useState(false);
  const [showRespostasSalvas, setShowRespostasSalvas] = useState(false);
  const [respostasSalvas, setRespostasSalvas] = useState([]);
  const [respostasSalvasLoading, setRespostasSalvasLoading] = useState(false);
  const [showProdutosPanel, setShowProdutosPanel] = useState(false);

  const chats = useChatStore((s) => s.chats);
  const userRole = String(user?.role || user?.perfil || "").toLowerCase();
  const canConsultarProdutos = ["admin", "supervisor", "atendente"].includes(userRole);
  const canVerSyncProdutos = ["admin", "supervisor"].includes(userRole);
  const canSincronizarProdutos = userRole === "admin";

  // ações estilo WhatsApp: responder, encaminhar, fixar, favoritar, selecionar, apagar
  const [replyTo, setReplyTo] = useState(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedMsgIds, setSelectedMsgIds] = useState({});
  /** Ordem em que as mensagens foram marcadas (ids como string), para respeitar na API. */
  const [selectionOrder, setSelectionOrder] = useState([]);
  const selectionOrderRef = useRef([]);
  /** True quando o modo seleção foi aberto por "Encaminhar" (mostra fluxo até o destino). */
  const [forwardSelectIntent, setForwardSelectIntent] = useState(false);
  const [pinnedIds, setPinnedIds] = useState([]);
  const [starredIds, setStarredIds] = useState([]);

  const [forwardOpen, setForwardOpen] = useState(false);
  /** Lista ordenada de mensagens a encaminhar ao confirmar destino; null = modal fechado. */
  const [forwardMsgs, setForwardMsgs] = useState(null);
  const [forwardQuery, setForwardQuery] = useState("");
  const [forwardSending, setForwardSending] = useState(false);
  const [forwardClientes, setForwardClientes] = useState([]);
  const [forwardClientesLoading, setForwardClientesLoading] = useState(false);
  const [forwardColaboradores, setForwardColaboradores] = useState([]);
  const [forwardColaboradoresLoading, setForwardColaboradoresLoading] = useState(false);
  /** Ordem de clique: ids de conversa destino (máx. FORWARD_DEST_MAX). */
  const [forwardSelectedConversaIds, setForwardSelectedConversaIds] = useState([]);
  const [forwardMax10Msg, setForwardMax10Msg] = useState("");
  const [forwardMultiProgress, setForwardMultiProgress] = useState(null);
  const forwardMax10TimerRef = useRef(null);

  const [msgInfoOpen, setMsgInfoOpen] = useState(false);
  const [msgInfo, setMsgInfo] = useState(null);

  const bottomRef = useRef(null);
  const virtualThreadRef = useRef(null);
  const mensagensComSeparadoresRef = useRef([]);
  const fileInputRef = useRef(null);
  const fototecaInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const audioInputRef = useRef(null);
  const documentInputRef = useRef(null);
  const stickerInputRef = useRef(null);
  const inputRef = useRef(null);
  const waShellRef = useRef(null);
  const waHeaderRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const sendCrmRef = useRef(null);
  const autoCorrectFlashTimeoutRef = useRef(null);
  const autoCorrectTrackedRef = useRef([]);
  const autoCorrectIgnoredRef = useRef([]);
  const zapSeenMsgKeysRef = useRef(new Set());
  const zapMsgsInitialPassRef = useRef(true);

  const AUTO_CORRECT_CONTEXT_WINDOW = 12;
  const AUTO_CORRECT_CONTEXT_MATCH = 6;

  const normalizeAutoWord = useCallback((value) => String(value || "").toLowerCase(), []);

  const getAutoContext = useCallback((text, start, end) => {
    const value = String(text || "");
    const s = Math.max(0, Number(start) || 0);
    const e = Math.max(s, Number(end) || s);
    return {
      before: value.slice(Math.max(0, s - AUTO_CORRECT_CONTEXT_WINDOW), s),
      after: value.slice(e, Math.min(value.length, e + AUTO_CORRECT_CONTEXT_WINDOW)),
    };
  }, []);

  const contextMatches = useCallback((candidate, tracked) => {
    const beforeSize = Math.min(AUTO_CORRECT_CONTEXT_MATCH, candidate.before.length, tracked.before.length);
    const afterSize = Math.min(AUTO_CORRECT_CONTEXT_MATCH, candidate.after.length, tracked.after.length);
    const beforeOk =
      beforeSize === 0 || candidate.before.slice(-beforeSize) === tracked.before.slice(-beforeSize);
    const afterOk = afterSize === 0 || candidate.after.slice(0, afterSize) === tracked.after.slice(0, afterSize);
    return beforeOk && afterOk;
  }, []);

  const resetAutocorrectTracking = useCallback(() => {
    autoCorrectTrackedRef.current = [];
    autoCorrectIgnoredRef.current = [];
  }, []);

  const hasWordWithContext = useCallback((text, wordLower, context) => {
    const value = String(text || "");
    if (!value || !wordLower) return false;
    const re = /[A-Za-zÀ-ÖØ-öø-ÿ]+/g;
    let m;
    while ((m = re.exec(value)) != null) {
      const found = normalizeAutoWord(m[0]);
      if (found !== wordLower) continue;
      const ctx = getAutoContext(value, m.index, m.index + m[0].length);
      if (contextMatches(ctx, context)) return true;
    }
    return false;
  }, [contextMatches, getAutoContext, normalizeAutoWord]);

  const focusMessageInput = useCallback(({ force = false } = {}) => {
    if (typeof window !== "undefined" && !force) {
      // Em mobile/touch, refocar após enviar pode fechar/abrir teclado e causar "pulo" visual.
      // Mantemos o foco apenas se ele já estiver no próprio input.
      const isCoarse = window.matchMedia?.("(pointer: coarse)")?.matches;
      const el = inputRef.current;
      if (isCoarse && el && document.activeElement !== el) return;
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (!el) return;
        try {
          el.focus({ preventScroll: true });
        } catch {
          el.focus();
        }
      });
    });
  }, []);

  const syncTextareaHeight = useCallback(() => {
    const el = inputRef.current;
    if (!el || el.tagName !== "TEXTAREA") return;
    el.style.height = "auto";
    const maxPx = parseFloat(getComputedStyle(el).maxHeight);
    const cap =
      Number.isFinite(maxPx) && maxPx > 0 ? Math.min(maxPx, WA_INPUT_MAX_HEIGHT_PX) : WA_INPUT_MAX_HEIGHT_PX;
    const next = Math.min(el.scrollHeight, cap);
    el.style.height = `${next}px`;
  }, []);

  const prevInputHeightRef = useRef(0);
  useLayoutEffect(() => {
    const el = inputRef.current;
    syncTextareaHeight();
    prevInputHeightRef.current = el ? el.getBoundingClientRect().height : prevInputHeightRef.current;
    // Scroll ao fundo fica só no useAutoScroll (nova mensagem) — evita “pulo” duplo ao enviar.
  }, [texto, syncTextareaHeight]);

  useEffect(() => {
    pendingBlobUrlRef.current = pendingPreview || null;
  }, [pendingPreview]);

  useEffect(
    () => () => {
      const url = pendingBlobUrlRef.current;
      if (url && String(url).startsWith("blob:")) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* ignore */
        }
      }
    },
    []
  );

  // Auto-grow do textarea de legenda (preview de mídia, estilo WhatsApp).
  useLayoutEffect(() => {
    const el = pendingCaptionRef.current;
    if (!el) return;
    el.style.height = "auto";
    const maxPx = parseFloat(getComputedStyle(el).maxHeight);
    const cap = Number.isFinite(maxPx) && maxPx > 0 ? maxPx : 120;
    el.style.height = `${Math.min(el.scrollHeight, cap)}px`;
  }, [pendingCaption, pendingFile]);

  // Foco automático no campo de legenda quando o preview abre — só no desktop
  // (no touch evitamos abrir o teclado de imediato).
  useEffect(() => {
    if (!pendingFile) return;
    if (typeof window === "undefined") return;
    const isCoarse = window.matchMedia?.("(pointer: coarse)")?.matches;
    if (isCoarse) return;
    const t = setTimeout(() => {
      pendingCaptionRef.current?.focus();
    }, 80);
    return () => clearTimeout(t);
  }, [pendingFile]);

  /* Preview de envio: inset do teclado (iOS) + foco preso com Tab dentro do diálogo. */
  useEffect(() => {
    if (!pendingFile) return undefined;
    const root = mediaPreviewRootRef.current;
    if (!root) return undefined;

    const previousActive =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const selector =
      'button:not([disabled]), textarea:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const getFocusable = () =>
      Array.from(root.querySelectorAll(selector)).filter(
        (el) => el instanceof HTMLElement && root.contains(el) && !el.hasAttribute("disabled")
      );

    const raf = requestAnimationFrame(() => {
      const nodes = getFocusable();
      if (nodes.length) nodes[0].focus?.();
    });

    const onTrapKeyDown = (e) => {
      if (e.key !== "Tab") return;
      const nodes = getFocusable();
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onTrapKeyDown, true);

    const syncKbInset = () => {
      const vv = window.visualViewport;
      if (!vv) {
        root.style.setProperty("--wa-media-preview-kb-inset", "0px");
        return;
      }
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty("--wa-media-preview-kb-inset", `${Math.round(inset)}px`);
    };
    syncKbInset();
    const vv = window.visualViewport;
    vv?.addEventListener("resize", syncKbInset);
    vv?.addEventListener("scroll", syncKbInset);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onTrapKeyDown, true);
      vv?.removeEventListener("resize", syncKbInset);
      vv?.removeEventListener("scroll", syncKbInset);
      root.style.removeProperty("--wa-media-preview-kb-inset");
      if (previousActive && typeof previousActive.focus === "function") {
        try {
          previousActive.focus();
        } catch {
          /* ignore */
        }
      }
    };
  }, [pendingFile]);

  const conversaId = conversa?.id || null;

  /** Enquanto `carregarConversa` limpa `conversa`, `selectedId` mantém o chat — necessário para scroll até à última mensagem não falhar a meio do load. */
  const scrollThreadId =
    selectedId != null && selectedId !== "" ? selectedId : conversaId;

  const prevComposerLenRef = useRef(0);
  const prevComposerConversaRef = useRef(null);
  /** Ao limpar o composer (ex.: após enviar), o textarea encolhe e o viewport deixa de parecer colado ao fim — reancora só nessa transição, não a cada tecla. */
  useLayoutEffect(() => {
    const len = String(texto ?? "").length;
    const threadKey = scrollThreadId ?? conversaId;
    if (String(prevComposerConversaRef.current) !== String(threadKey ?? "")) {
      prevComposerConversaRef.current = threadKey;
      prevComposerLenRef.current = len;
      return;
    }
    const prevLen = prevComposerLenRef.current;
    prevComposerLenRef.current = len;
    if (prevLen <= 0 || len !== 0) return;
    if (!threadKey || loading) return;
    const c = messagesContainerRef.current;
    if (!c || !shouldStickToBottomRef.current) return;
    if (!isNearBottom(c, 220)) return;
    snapThreadToBottom(c, virtualThreadRef);
  }, [texto, conversaId, scrollThreadId, loading]);

  useEffect(() => {
    resetAutocorrectTracking();
  }, [conversaId, resetAutocorrectTracking]);

  useEffect(() => {
    setRecentStickers(readRecentStickers(user));
  }, [user?.id, user?.company_id, user?.empresa_id]);

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    try {
      const raw = localStorage.getItem(buildAutoCorrectStorageKey(user));
      setAutoCorrectEnabled(raw == null ? true : raw === "1");
    } catch {
      setAutoCorrectEnabled(true);
    }
  }, [user?.id, user?.company_id, user?.empresa_id]);

  useEffect(() => {
    return () => {
      if (autoCorrectFlashTimeoutRef.current) {
        clearTimeout(autoCorrectFlashTimeoutRef.current);
        autoCorrectFlashTimeoutRef.current = null;
      }
    };
  }, []);

  /* Mobile: cabeçalho fixo (viewport) + padding no shell; teclado via visualViewport e foco no input */
  useLayoutEffect(() => {
    const shell = waShellRef.current;
    const header = waHeaderRef.current;
    const input = inputRef.current;
    if (!shell || !header) return;

    const mq = window.matchMedia("(max-width: 640px)");
    const syncMobileInputFocusClass = () => {
      const isFocused = Boolean(input && document.activeElement === input);
      shell.classList.toggle("wa-mobile-input-focused", mq.matches && isFocused);
    };

    const syncHeaderLayout = () => {
      if (!mq.matches) {
        shell.style.removeProperty("--wa-mobile-header-h");
        shell.style.removeProperty("--wa-vv-top");
        shell.style.removeProperty("--wa-keyboard-inset");
        shell.style.removeProperty("--wa-visual-height");
        shell.classList.remove("wa-mobile-input-focused");
        return;
      }
      shell.style.setProperty("--wa-mobile-header-h", `${header.offsetHeight}px`);
      const vvNow = window.visualViewport;
      if (vvNow) {
        shell.style.setProperty("--wa-vv-top", `${vvNow.offsetTop}px`);
        const ih = window.innerHeight;
        const kbInset = Math.max(0, ih - vvNow.height - vvNow.offsetTop);
        shell.style.setProperty("--wa-keyboard-inset", `${kbInset}px`);
        shell.style.setProperty("--wa-visual-height", `${vvNow.height}px`);
      } else {
        shell.style.removeProperty("--wa-keyboard-inset");
        shell.style.removeProperty("--wa-visual-height");
      }
      syncMobileInputFocusClass();
    };

    syncHeaderLayout();

    const ro = new ResizeObserver(syncHeaderLayout);
    ro.observe(header);

    const onMqChange = () => syncHeaderLayout();
    if (mq.addEventListener) mq.addEventListener("change", onMqChange);
    else mq.addListener(onMqChange);

    const vv = window.visualViewport;
    const onVv = () => syncHeaderLayout();
    if (vv) {
      vv.addEventListener("resize", onVv);
      vv.addEventListener("scroll", onVv);
    }

    const onInputFocusBlur = () => requestAnimationFrame(syncHeaderLayout);
    if (input) {
      input.addEventListener("focus", onInputFocusBlur);
      input.addEventListener("blur", onInputFocusBlur);
    }

    return () => {
      ro.disconnect();
      if (mq.removeEventListener) mq.removeEventListener("change", onMqChange);
      else mq.removeListener(onMqChange);
      if (vv) {
        vv.removeEventListener("resize", onVv);
        vv.removeEventListener("scroll", onVv);
      }
      if (input) {
        input.removeEventListener("focus", onInputFocusBlur);
        input.removeEventListener("blur", onInputFocusBlur);
      }
      shell.classList.remove("wa-mobile-input-focused");
      shell.style.removeProperty("--wa-mobile-header-h");
      shell.style.removeProperty("--wa-vv-top");
      shell.style.removeProperty("--wa-keyboard-inset");
      shell.style.removeProperty("--wa-visual-height");
    };
  }, [conversaId]);

  const isSomeoneTyping = Boolean(
    typingInfo &&
    typingInfo.usuario_id !== myUserId &&
    (typingInfo.expiresAt == null || typingInfo.expiresAt > Date.now())
  );

  const isGroup = useMemo(() => isGroupConversation(conversa), [conversa]);

  // Nunca exibir LID (lid:xxx) como nome ou número — identificador interno do WhatsApp
  const isLidValue = (v) => v != null && String(v).trim().toLowerCase().startsWith("lid:");

  const fromChat = useMemo(
    () => (Array.isArray(chats) ? chats.find((c) => String(c?.id) === String(conversaId)) : null),
    [chats, conversaId]
  );

  // Nome idêntico à lista de conversas: usa getDisplayName do chatList quando disponível
  const nome = useMemo(() => {
    const chatParaNome = fromChat ?? conversa;
    if (chatParaNome) {
      return getDisplayName(chatParaNome);
    }
    if (isGroup) {
      const g =
        conversa?.nome_grupo ||
        conversa?.contato_nome ||
        conversa?.nome ||
        "Grupo";
      return isLidValue(g) ? "Grupo" : g;
    }
    const raw =
      conversa?.contato_nome ||
      conversa?.nome_contato_cache ||
      conversa?.cliente?.nome ||
      conversa?.clientes?.nome ||
      conversa?.cliente_nome ||
      conversa?.nome ||
      "";
    const n = String(raw || "").trim();
    if (n && !isLidValue(n)) return n;
    const tel =
      conversa?.telefone_exibivel ||
      conversa?.cliente_telefone ||
      conversa?.telefone ||
      "";
    if (tel && !isLidValue(tel)) return String(tel).trim();
    return "Contato";
  }, [conversa, fromChat, conversaId, isGroup]);

  const replyBarPreview = useMemo(() => {
    if (!replyTo) return null;
    const chatParaNome = fromChat ?? conversa;
    const rt = safeString(replyTo?.tipo).toLowerCase();
    const thumb = rt === "imagem" || rt === "sticker" ? getMediaUrl(replyTo?.url, replyTo?.url_absoluta) : "";
    const meta = buildReplyMetaForPersist(replyTo, nome, chatParaNome);
    return {
      thumb: thumb || null,
      title: getReplySenderLabel(replyTo, nome, chatParaNome),
      text: replySnippetDisplay(meta) || snippetFromMsg(replyTo),
    };
  }, [replyTo, nome, fromChat, conversa]);

  const telefone = useMemo(() => {
    const t = conversa?.telefone_exibivel || conversa?.cliente_telefone || conversa?.cliente?.telefone || conversa?.telefone
      || fromChat?.telefone_exibivel || fromChat?.telefone || "";
    return isLidValue(t) ? "" : (t || "");
  }, [conversa, fromChat, isGroup]);

  const rawAvatarUrl = isGroup
    ? (conversa?.foto_grupo ?? fromChat?.foto_grupo ?? null)
    : (
        conversa?.foto_perfil ??
        conversa?.foto_perfil_contato_cache ??
        fromChat?.foto_perfil ??
        fromChat?.foto_perfil_contato_cache ??
        conversa?.cliente?.foto_perfil ??
        conversa?.clientes?.foto_perfil ??
        null
      );
  const avatarUrl = resolveConversaAvatarUrl(rawAvatarUrl);
  const avatar = useMemo(() => (isGroup ? "👥" : initials(nome)), [isGroup, nome]);
  const [avatarImgError, setAvatarImgError] = useState(false);
  const showAvatarImg = Boolean(avatarUrl && !avatarImgError);

  const badge = useMemo(
    () =>
      statusBadge(
        getStatusAtendimentoEffective(conversa),
        conversa?.exibir_badge_aberta,
        conversa?.finalizacao_motivo
      ),
    [
      conversa?.status_atendimento,
      conversa?.status_atendimento_real,
      conversa?.exibir_badge_aberta,
      conversa?.finalizacao_motivo,
    ]
  );

  /** Aberta / finalizada: setor e ação ficam na linha abaixo do pill de status (mobile/desktop). */
  const headerSetorBelowStatus = useMemo(() => {
    if (!conversa || isGroupConversation(conversa)) return false;
    const s = safeString(getStatusAtendimentoEffective(conversa)).toLowerCase();
    return s === "aberta" || s === "fechada" || s === "mensagem_disparada";
  }, [conversa]);

  /** Mobile: layout compacto em duas linhas + pill menor só em em_atendimento / aguardando_cliente */
  const headerCrmAtivoLayout = useMemo(() => {
    const s = safeString(getStatusAtendimentoEffective(conversa)).toLowerCase();
    return s === "em_atendimento" || s === "aguardando_cliente";
  }, [conversa?.status_atendimento, conversa?.status_atendimento_real, conversa]);

  const encerramentoAusenciaHint = useMemo(() => {
    const s = safeString(getStatusAtendimentoEffective(conversa)).toLowerCase();
    if (s !== "fechada") return null;
    if (safeString(conversa?.finalizacao_motivo).toLowerCase() !== "ausencia_cliente" && conversa?.finalizada_automaticamente !== true) {
      return null;
    }
    return "Encerrada automaticamente por ausência do cliente.";
  }, [
    conversa?.status_atendimento,
    conversa?.status_atendimento_real,
    conversa?.finalizacao_motivo,
    conversa?.finalizada_automaticamente,
  ]);

  useEffect(() => {
    setAvatarImgError(false);
  }, [avatarUrl]);

  const selectedTagIds = useMemo(
    () => (Array.isArray(tags) ? tags.map((t) => t.id) : []),
    [tags]
  );

  const lastMsg = useMemo(
    () => (mensagens?.length ? mensagens[mensagens.length - 1] : null),
    [mensagens]
  );
  const lastMsgKey = useMemo(() => {
    if (!lastMsg) return null;
    return String(
      lastMsg.id ??
      lastMsg.whatsapp_id ??
      lastMsg.tempId ??
      `${lastMsg.criado_em || ""}-${lastMsg.direcao || ""}-${(lastMsg.texto || lastMsg.conteudo || "").slice(0, 24)}`
    );
  }, [lastMsg]);

  const pinnedSet = useMemo(() => new Set((pinnedIds || []).map(String)), [pinnedIds]);
  const starredSet = useMemo(() => new Set((starredIds || []).map(String)), [starredIds]);
  const selectedSet = useMemo(() => new Set(Object.keys(selectedMsgIds || {}).filter((k) => selectedMsgIds[k])), [selectedMsgIds]);

  const pinnedTop = useMemo(() => {
    if (!mensagens?.length || !(pinnedIds || []).length) return null;
    const lastPinnedId = String((pinnedIds || [])[pinnedIds.length - 1]);
    return (mensagens || []).find((m) => String(m.id) === lastPinnedId) || null;
  }, [mensagens, pinnedIds]);

  const forwardCandidates = useMemo(() => {
    const list = Array.isArray(chats) ? chats : [];
    const q = safeString(forwardQuery).toLowerCase();
    const byName = (c) => {
      const n = safeString(c?.contato_nome || c?.nome || c?.cliente?.nome || c?.telefone);
      const at = safeString(c?.atendente_nome ?? c?.atendenteNome);
      const atMail = safeString(c?.atendente_email ?? c?.atendenteEmail);
      const tel = safeString(c?.telefone);
      const telEx = safeString(c?.telefone_exibivel ?? c?.telefoneExibivel);
      if (!q) return true;
      const hay = `${n} ${at} ${atMail} ${tel} ${telEx}`.toLowerCase();
      return hay.includes(q);
    };
    return list
      .filter((c) => c?.id != null && String(c.id) !== String(conversaId))
      .filter(byName)
      .slice(0, 80);
  }, [chats, forwardQuery, conversaId]);

  const forwardColaboradoresFiltered = useMemo(() => {
    const list = Array.isArray(forwardColaboradores) ? forwardColaboradores : [];
    const me = user?.id != null ? String(user.id) : null;
    const semEu = me
      ? list.filter((colab) => {
          const uid = colab?.id ?? colab?.user_id ?? colab?.usuario_id;
          return uid == null || String(uid) !== me;
        })
      : list;
    const q = safeString(forwardQuery).toLowerCase();
    if (!q) return semEu.slice(0, 80);
    return semEu
      .filter((colab) => {
        const n = safeString(colab?.nome ?? colab?.name ?? colab?.full_name).toLowerCase();
        const em = safeString(colab?.email).toLowerCase();
        return n.includes(q) || em.includes(q);
      })
      .slice(0, 80);
  }, [forwardColaboradores, forwardQuery, user?.id]);

  // Encaminhar: GET /chats com colaboradores + busca de clientes (contatos)
  useEffect(() => {
    if (!forwardOpen) {
      setForwardClientes([]);
      setForwardClientesLoading(false);
      setForwardColaboradores([]);
      setForwardColaboradoresLoading(false);
      return;
    }

    let cancelled = false;
    setForwardColaboradoresLoading(true);
    (async () => {
      try {
        const parsed = await fetchChats({
          incluir_todos_clientes: true,
          incluir_colaboradores_encaminhar: true,
        });
        if (cancelled) return;
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.conversas)) {
          useChatStore.getState().setChats(parsed.conversas);
          setForwardColaboradores(Array.isArray(parsed.colaboradores_encaminhar) ? parsed.colaboradores_encaminhar : []);
        } else if (!cancelled) {
          setForwardColaboradores([]);
        }
      } catch (_) {
        if (!cancelled) setForwardColaboradores([]);
      } finally {
        if (!cancelled) setForwardColaboradoresLoading(false);
      }
    })();

    // 2) busca clientes no banco por palavra (opcional)
    const q = safeString(forwardQuery).trim();
    let clientesTimer = null;
    if (q.length < 2) {
      setForwardClientes([]);
      setForwardClientesLoading(false);
    } else {
      setForwardClientesLoading(true);
      clientesTimer = setTimeout(async () => {
        if (cancelled) return;
        try {
          const list = await cfg.getClientes({ palavra: q, limit: 60 });
          if (cancelled) return;
          const arr = Array.isArray(list) ? list : [];
          const curClienteId = conversa?.cliente_id != null ? String(conversa.cliente_id) : null;
          setForwardClientes(curClienteId ? arr.filter((c) => String(c.id) !== curClienteId) : arr);
        } catch (_) {
          if (!cancelled) setForwardClientes([]);
        } finally {
          if (!cancelled) setForwardClientesLoading(false);
        }
      }, 260);
    }

    return () => {
      cancelled = true;
      if (clientesTimer) clearTimeout(clientesTimer);
    };
  }, [forwardOpen, forwardQuery, conversa?.cliente_id]);

  useEffect(() => {
    // reset por conversa
    setReplyTo(null);
    setSelectMode(false);
    setSelectedMsgIds({});
    selectionOrderRef.current = [];
    setSelectionOrder([]);
    setForwardSelectIntent(false);
    setForwardOpen(false);
    setForwardMsgs(null);
    setForwardQuery("");

    if (!conversaId) {
      setPinnedIds([]);
      setStarredIds([]);
      return;
    }

    try {
      const pins = JSON.parse(localStorage.getItem(`zap:pins:${conversaId}`) || "[]");
      const stars = JSON.parse(localStorage.getItem(`zap:stars:${conversaId}`) || "[]");
      setPinnedIds(Array.isArray(pins) ? pins : []);
      setStarredIds(Array.isArray(stars) ? stars : []);
    } catch {
      setPinnedIds([]);
      setStarredIds([]);
    }
  }, [conversaId]);

  const tempoSemResponder = useMemo(() => {
    const list = Array.isArray(mensagens) ? mensagens : [];
    const ultimaIn = [...list].reverse().find((m) => m?.direcao === "in");
    if (!ultimaIn?.criado_em) return null;
    const diffMs = Date.now() - new Date(ultimaIn.criado_em).getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffH = Math.floor(diffMin / 60);
    const diffD = Math.floor(diffH / 24);
    if (diffMin < 1) return "Agora";
    if (diffMin < 60) return `${diffMin} min`;
    if (diffH < 24) return `${diffH}h`;
    return `${diffD} dia(s)`;
  }, [mensagens]);

  /** Só reancora ao fundo se o utilizador ainda está colado ao fim (evita “puxar” ao meio ao ler histórico). */
  const snapIfStickBottom = useCallback(() => {
    const c = messagesContainerRef.current;
    if (!c || loadingMore) return;
    if (!shouldStickToBottomRef.current) return;
    if (!isNearBottom(c, 160)) return;
    shouldStickToBottomRef.current = true;
    snapThreadToBottom(c, virtualThreadRef);
  }, [loadingMore]);

  useAutoScroll({
    conversaId: scrollThreadId,
    loading,
    lastMsgKey,
    lastMsg,
    myUserId,
    messagesContainerRef,
    shouldStickToBottomRef,
    virtualListRef: virtualThreadRef,
    mensagensCount: Array.isArray(mensagens) ? mensagens.length : 0,
  });

  useLayoutEffect(() => {
    zapSeenMsgKeysRef.current = new Set();
    zapMsgsInitialPassRef.current = true;
  }, [conversaId]);

  useLayoutEffect(() => {
    if (loading || !conversaId) return;
    const list = Array.isArray(mensagens) ? mensagens : [];
    if (!zapMsgsInitialPassRef.current) return;
    if (list.length === 0) return;
    list.forEach((m) => {
      zapSeenMsgKeysRef.current.add(getMessageListReactKey(m, conversaId));
    });
    zapMsgsInitialPassRef.current = false;
  }, [loading, conversaId, mensagens]);

  const showToast = useCallback(
    (next) => {
      setToast(next);
      toastT.set(() => setToast(null), 3500);
    },
    [toastT]
  );

  useEffect(() => {
    if (!composerAppendQueue) return;
    const value = composerAppendQueue;
    clearComposerAppendQueue();
    setTexto((prev) => (prev ? `${prev}\n${value}` : value));
    focusMessageInput();
    showToast({
      type: "success",
      title: "Produto pronto",
      message: "O produto foi adicionado na caixa de mensagem.",
    });
  }, [composerAppendQueue, clearComposerAppendQueue, focusMessageInput, showToast]);

  const clearPending = useCallback(() => {
    if (pendingPreview) {
      try {
        URL.revokeObjectURL(pendingPreview);
      } catch {}
    }
    setPendingFile(null);
    setPendingPreview(null);
    setPendingCaption("");
  }, [pendingPreview]);

  const openMediaViewer = useCallback((url, type = "imagem", fileName) => {
    if (!url) return;
    setMediaViewer({ url, type: type || "imagem", fileName: fileName || null });
  }, []);

  const onHeaderAvatarClick = useCallback(() => {
    if (showAvatarImg && avatarUrl) {
      openMediaViewer(avatarUrl, "imagem", nome);
    }
  }, [showAvatarImg, avatarUrl, nome, openMediaViewer]);

  const closeMediaViewer = useCallback(() => {
    setMediaViewer(null);
  }, []);

  const handleMediaViewerPrint = useCallback(async () => {
    if (!mediaViewer?.url || mediaPrintLoading) return;
    if (!mediaViewerSupportsPrint(mediaViewer.type, mediaViewer.fileName)) {
      showToast({
        type: "info",
        title: "Impressão",
        message: "Use Abrir arquivo no navegador e imprima a partir de lá.",
      });
      return;
    }

    setMediaPrintLoading(true);
    try {
      if (mediaViewer.type === "video") {
        const v = mediaViewerVideoRef.current;
        if (!v) {
          showToast({ type: "error", title: "Impressão", message: "Vídeo indisponível no visualizador." });
          return;
        }
        if (v.readyState < 2) {
          showToast({
            type: "warning",
            title: "Aguarde",
            message: "Carregue o vídeo antes de imprimir.",
          });
          return;
        }
        let blob;
        try {
          blob = await captureVideoFrameToPngBlob(v);
        } catch (e) {
          const msg = String(e?.message || "");
          if (msg === "VIDEO_FRAME_TAINTED" || msg === "VIDEO_NOT_READY") {
            showToast({
              type: "error",
              title: "Não foi possível capturar o quadro",
              message:
                msg === "VIDEO_NOT_READY"
                  ? "O vídeo ainda não tem dimensões. Aguarde um instante."
                  : "Limitação do navegador com esta origem de mídia. Baixe o arquivo e imprima localmente, se necessário.",
            });
            return;
          }
          throw e;
        }
        printImageBlob(blob);
        return;
      }

      await printImageFromUrl(mediaViewer.url);
    } catch (err) {
      if (err?.code === "POPUP_BLOCKED") {
        showToast({
          type: "warning",
          title: "Pop-up bloqueado",
          message: "Permita pop-ups para este site para abrir a janela de impressão.",
        });
        return;
      }
      console.error(err);
      showToast({
        type: "error",
        title: "Falha ao imprimir",
        message: "Não foi possível preparar a impressão. Tente de novo.",
      });
    } finally {
      setMediaPrintLoading(false);
    }
  }, [mediaViewer, mediaPrintLoading, showToast]);

  useEffect(() => {
    if (!mediaViewer) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeMediaViewer();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mediaViewer, closeMediaViewer]);

  useEffect(() => {
    let cancelled = false;
    const revokeIf = (u) => {
      if (u) {
        try {
          URL.revokeObjectURL(u);
        } catch {
          /* ignore */
        }
      }
    };

    if (!mediaViewer) {
      setMediaPdfBlobUrl((prev) => {
        revokeIf(prev);
        return null;
      });
      setMediaPdfLoading(false);
      setMediaPdfError(null);
      return undefined;
    }

    const fn = String(mediaViewer.fileName || "").toLowerCase();
    const isPdf = mediaViewer.type === "arquivo" && fn.endsWith(".pdf");
    if (!isPdf) {
      setMediaPdfBlobUrl((prev) => {
        revokeIf(prev);
        return null;
      });
      setMediaPdfLoading(false);
      setMediaPdfError(null);
      return undefined;
    }

    setMediaPdfLoading(true);
    setMediaPdfError(null);
    setMediaPdfBlobUrl((prev) => {
      revokeIf(prev);
      return null;
    });

    const abs = getMediaUrl(mediaViewer.url, false);
    (async () => {
      try {
        const blob = await fetchMediaBinaryAuthenticated(abs);
        if (cancelled) return;
        const pdfBlob =
          blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" });
        const u = URL.createObjectURL(pdfBlob);
        setMediaPdfBlobUrl(u);
      } catch (e) {
        if (!cancelled) {
          setMediaPdfError(String(e?.message || e || "Erro ao carregar o documento."));
        }
      } finally {
        if (!cancelled) setMediaPdfLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mediaViewer]);

  useEffect(() => {
    if (!shareContactOpen) {
      setShareContactList([]);
      setShareContactQuery("");
      setShareContactLoading(false);
      return;
    }
    const q = safeString(shareContactQuery).trim().toLowerCase();
    setShareContactLoading(true);
    const t = setTimeout(async () => {
      try {
        const list = await cfg.getClientes({ palavra: q || undefined, limit: 60 });
        const arr = Array.isArray(list) ? list : [];
        setShareContactList(arr);
      } catch (e) {
        console.error("Erro ao buscar contatos:", e);
        setShareContactList([]);
      } finally {
        setShareContactLoading(false);
      }
    }, 260);
    return () => clearTimeout(t);
  }, [shareContactOpen, shareContactQuery]);

  const openFilePicker = useCallback(() => {
    if (!conversaId) return;
    fileInputRef.current?.click();
  }, [conversaId]);

  const openCameraPicker = useCallback(() => {
    if (!conversaId) return;
    try {
      const hasMediaDevices = typeof navigator !== "undefined" && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
      if (!hasMediaDevices) {
        showToast({
          type: "error",
          title: "Câmera indisponível",
          message: "Seu navegador não permite acesso à câmera neste dispositivo.",
        });
        return;
      }
    } catch {
      // se der erro na detecção, apenas tenta abrir o picker
    }
    cameraInputRef.current?.click();
  }, [conversaId, showToast]);

  const openFototecaPicker = useCallback(() => {
    if (!conversaId) return;
    fototecaInputRef.current?.click();
  }, [conversaId]);

  const openAudioPicker = useCallback(() => {
    if (!conversaId) return;
    audioInputRef.current?.click();
  }, [conversaId]);

  const openDocumentPicker = useCallback(() => {
    if (!conversaId) return;
    documentInputRef.current?.click();
  }, [conversaId]);

  const openShareLocation = useCallback(() => {
    setAttachMenuOpen(false);
    setShareLocationGeoError(null);
    setShareLocationNome("");
    setShareLocationEndereco("");
    setShareLocationLat("");
    setShareLocationLng("");
    setShareLocationOpen(true);
    setShareLocationGeoLoading(true);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setShareLocationGeoLoading(false);
      setShareLocationGeoError("Geolocalização indisponível neste navegador. Informe latitude e longitude abaixo.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setShareLocationLat(String(pos.coords.latitude));
        setShareLocationLng(String(pos.coords.longitude));
        setShareLocationGeoLoading(false);
      },
      () => {
        setShareLocationGeoLoading(false);
        setShareLocationGeoError(
          "Não foi possível obter sua posição. Permita o acesso à localização ou informe latitude e longitude manualmente."
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }, []);

  const isPixConfigured = useCallback((cfgData) => {
    if (!cfgData || typeof cfgData !== "object") return false;
    const tipo = safeString(cfgData.tipo_chave).toLowerCase();
    const chave = safeString(cfgData.chave_pix);
    const nome = safeString(cfgData.nome_recebedor);
    return !!tipo && !!chave && !!nome;
  }, []);

  const applyPixConfigToForm = useCallback((cfgData) => {
    const next = cfgData && typeof cfgData === "object" ? cfgData : {};
    setPixTipoChave(safeString(next.tipo_chave).toLowerCase() || "cpf");
    setPixChave(safeString(next.chave_pix));
    setPixNomeRecebedor(safeString(next.nome_recebedor));
    setPixMensagemPadrao(safeString(next.mensagem_padrao));
  }, []);

  const fetchPixConfigIfNeeded = useCallback(async () => {
    if (pixConfigLoading) return null;
    setPixConfigLoading(true);
    try {
      const payload = await getPixConfig();
      const config = payload?.config && typeof payload.config === "object" ? payload.config : null;
      if (config) applyPixConfigToForm(config);
      setPixConfigLoaded(true);
      return config;
    } catch (err) {
      console.error("Erro ao carregar Pix:", err);
      showToast({
        type: "error",
        title: "Pix",
        message: "Não foi possível carregar a configuração Pix da empresa.",
      });
      return null;
    } finally {
      setPixConfigLoading(false);
    }
  }, [pixConfigLoading, applyPixConfigToForm, showToast]);

  const buildPixMessagePreview = useCallback((cfgData) => {
    const tipoRaw = safeString(cfgData?.tipo_chave).toLowerCase();
    const tipoLabel =
      tipoRaw === "cpf"
        ? "CPF"
        : tipoRaw === "cnpj"
          ? "CNPJ"
          : tipoRaw === "email"
            ? "E-mail"
            : tipoRaw === "telefone"
              ? "Telefone"
              : "Chave aleatória";
    const extra = safeString(cfgData?.mensagem_padrao);
    const lines = [
      "Segue a chave Pix para pagamento:",
      "",
      `Nome: ${safeString(cfgData?.nome_recebedor)}`,
      `Tipo da chave: ${tipoLabel}`,
      `Chave Pix: ${safeString(cfgData?.chave_pix)}`,
    ];
    if (extra) lines.push("", extra);
    lines.push("", "Após o pagamento, por favor envie o comprovante por aqui.");
    return lines.join("\n").trim();
  }, []);

  const handleSalvarPixConfig = useCallback(async (opts = {}) => {
    if (pixConfigSaving) return false;
    const payload = {
      tipo_chave: safeString(pixTipoChave).toLowerCase(),
      chave_pix: safeString(pixChave),
      nome_recebedor: safeString(pixNomeRecebedor),
      mensagem_padrao: safeString(pixMensagemPadrao) || null,
    };
    if (!payload.chave_pix || !payload.nome_recebedor) {
      showToast({
        type: "warning",
        title: "Pix",
        message: "Preencha tipo, chave e nome do recebedor.",
      });
      return false;
    }
    setPixConfigSaving(true);
    try {
      const data = await putPixConfig(payload);
      const saved = data?.config || payload;
      applyPixConfigToForm(saved);
      setPixConfigLoaded(true);
      showToast({
        type: "success",
        title: "Pix configurado",
        message: "Os dados Pix foram salvos com sucesso.",
      });
      if (opts?.closeModal !== false) setPixModalOpen(false);
      return true;
    } catch (err) {
      console.error("Erro ao salvar Pix:", err);
      showToast({
        type: "error",
        title: "Pix",
        message: err?.response?.data?.error || "Não foi possível salvar os dados Pix.",
      });
      return false;
    } finally {
      setPixConfigSaving(false);
    }
  }, [pixConfigSaving, pixTipoChave, pixChave, pixNomeRecebedor, pixMensagemPadrao, applyPixConfigToForm, showToast]);

  const handleEnviarLocalizacao = useCallback(async () => {
    if (!conversaId || shareLocationSending) return;
    const la = Number(String(shareLocationLat).replace(",", "."));
    const ln = Number(String(shareLocationLng).replace(",", "."));
    if (!Number.isFinite(la) || !Number.isFinite(ln)) {
      showToast({
        type: "error",
        title: "Coordenadas inválidas",
        message: "Informe latitude e longitude válidas.",
      });
      return;
    }
    setShareLocationSending(true);
    try {
      await enviarLocalizacao(conversaId, {
        lat: la,
        lng: ln,
        nome: shareLocationNome.trim() || undefined,
        endereco: shareLocationEndereco.trim() || undefined,
      });
      setShareLocationOpen(false);
      setShareLocationGeoError(null);
      showToast({
        type: "success",
        title: "Localização enviada",
        message: "A mensagem aparecerá na conversa quando o servidor confirmar.",
      });
    } catch (err) {
      console.error("Erro ao enviar localização:", err);
      const is403 = err?.response?.status === 403;
      const apiMsg = err?.response?.data?.error;
      showToast({
        type: "error",
        title: is403 ? "Acesso restrito" : "Falha ao enviar localização",
        message:
          apiMsg ||
          (is403 ? "Assuma a conversa antes de enviar mensagens." : "Não foi possível enviar a localização."),
      });
    } finally {
      setShareLocationSending(false);
    }
  }, [
    conversaId,
    shareLocationSending,
    shareLocationLat,
    shareLocationLng,
    shareLocationNome,
    shareLocationEndereco,
    showToast,
  ]);

  const insertEmoji = useCallback((emoji) => {
    const em = String(emoji || "");
    if (!em) return;
    const el = inputRef.current;
    if (!el) {
      setTexto((prev) => (prev ? prev + em : em));
      return;
    }

    const cur = String(texto || "");
    const start = typeof el.selectionStart === "number" ? el.selectionStart : cur.length;
    const end = typeof el.selectionEnd === "number" ? el.selectionEnd : cur.length;
    const next = cur.slice(0, start) + em + cur.slice(end);
    setTexto(next);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          el.focus({ preventScroll: true });
          const pos = start + em.length;
          el.setSelectionRange?.(pos, pos);
        } catch {}
      });
    });
  }, [texto]);

  // Fecha o painel de emoji ao clicar fora e foca busca ao abrir
  useEffect(() => {
    if (!emojiOpen) return;
    const onDoc = (e) => {
      const panel = emojiPanelRef.current;
      if (panel && panel.contains(e.target)) return;
      setEmojiOpen(false);
      setEmojiQuery("");
    };
    document.addEventListener("mousedown", onDoc);
    requestAnimationFrame(() => emojiSearchRef.current?.focus?.());
    return () => document.removeEventListener("mousedown", onDoc);
  }, [emojiOpen]);

  useEffect(() => {
    if (!attachMenuOpen) return;
    const onDoc = (e) => {
      const menu = attachMenuRef.current;
      if (menu && menu.contains(e.target)) return;
      setAttachMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [attachMenuOpen]);

  useEffect(() => {
    if (!stickerOpen) return;
    const onDoc = (e) => {
      const panel = stickerPanelRef.current;
      const btn = stickerBtnRef.current;
      if ((panel && panel.contains(e.target)) || (btn && btn.contains(e.target))) return;
      setStickerOpen(false);
      setStickerQuery("");
    };
    document.addEventListener("mousedown", onDoc);
    requestAnimationFrame(() => stickerSearchRef.current?.focus?.());
    return () => document.removeEventListener("mousedown", onDoc);
  }, [stickerOpen]);

  const loadMoreScrollRef = useRef({ top: 0, height: 0 });
  /** Um único agendamento por frame para loadMore — evita spam na API e trabalho síncrono em cada evento de scroll (touch). */
  const loadMoreScrollRafRef = useRef(0);

  const handleMessagesScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    shouldStickToBottomRef.current = isNearBottom(el, 120);

    const st = useConversaStore.getState();
    if (!st.hasMore || st.loadingMore || !st.cursor) return;
    if (loadMoreScrollRafRef.current) return;
    loadMoreScrollRafRef.current = requestAnimationFrame(() => {
      loadMoreScrollRafRef.current = 0;
      const el2 = messagesContainerRef.current;
      if (!el2) return;
      const cur = useConversaStore.getState();
      if (!cur.hasMore || cur.loadingMore || !cur.cursor) return;
      if (el2.scrollTop < 140) {
        loadMoreScrollRef.current = { top: el2.scrollTop, height: el2.scrollHeight };
        cur.loadMore();
      }
    });
  }, []);

  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    el.addEventListener("scroll", handleMessagesScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleMessagesScroll);
  }, [handleMessagesScroll, conversaId]);

  useEffect(() => {
    return () => {
      if (loadMoreScrollRafRef.current) {
        cancelAnimationFrame(loadMoreScrollRafRef.current);
        loadMoreScrollRafRef.current = 0;
      }
    };
  }, [conversaId]);

  useEffect(() => {
    if (loadingMore) return;
    const { top, height } = loadMoreScrollRef.current;
    if (top === 0 && height === 0) return;
    const el = messagesContainerRef.current;
    if (!el) return;
    const diff = el.scrollHeight - height;
    if (diff > 0) {
      el.scrollTop = top + diff;
    }
    loadMoreScrollRef.current = { top: 0, height: 0 };
  }, [loadingMore]);

  /** Mesma estratégia do scroll ao topo: grava altura/scroll antes do `loadMore` para restaurar posição após o lote. */
  const handleLoadOlderMessagesClick = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const st = useConversaStore.getState();
    if (!st.hasMore || st.loadingMore || !st.cursor || st.conversa?.mensagens_bloqueadas) return;
    loadMoreScrollRef.current = { top: el.scrollTop, height: el.scrollHeight };
    st.loadMore();
  }, []);

  const handleDropFile = useCallback((file) => {
    if (!file) return;
    setPendingFile(file);
    setPendingCaption("");

    if (isImageFile(file) || isVideoFile(file)) {
      const url = fileToPreviewURL(file);
      setPendingPreview(url);
    } else if (isAudioFile(file)) {
      setPendingPreview(null); // áudio: sem preview visual
    } else {
      setPendingPreview(null);
    }
  }, []);

  const handleSendReaction = useCallback(
    async (msg, reaction) => {
      if (!conversaId || !msg?.id || !reaction) return;
      const mid = String(msg.id);
      if (reactionLoading[mid]) return;
      setReactionLoading((prev) => ({ ...prev, [mid]: true }));
      setLocalReactions((prev) => ({ ...prev, [mid]: reaction }));
      try {
        await enviarReacao(conversaId, msg.id, reaction);
      } catch (err) {
        console.error("Erro ao enviar reação:", err);
        setLocalReactions((prev) => {
          const next = { ...prev };
          delete next[mid];
          return next;
        });
        showToast({
          type: "error",
          title: "Falha ao reagir",
          message: err?.response?.data?.error || "Não foi possível registrar a reação.",
        });
      } finally {
        setReactionLoading((prev) => {
          const next = { ...prev };
          delete next[mid];
          return next;
        });
      }
    },
    [conversaId, reactionLoading, showToast]
  );

  const handleRemoveReaction = useCallback(
    async (msg) => {
      if (!conversaId || !msg?.id) return;
      const mid = String(msg.id);
      if (reactionLoading[mid]) return;
      if (!localReactions[mid]) return;
      setReactionLoading((prev) => ({ ...prev, [mid]: true }));
      const prevReaction = localReactions[mid];
      setLocalReactions((prev) => {
        const next = { ...prev };
        delete next[mid];
        return next;
      });
      try {
        await removerReacao(conversaId, msg.id);
      } catch (err) {
        console.error("Erro ao remover reação:", err);
        setLocalReactions((prev) => ({ ...prev, [mid]: prevReaction }));
        showToast({
          type: "error",
          title: "Falha ao remover reação",
          message: err?.response?.data?.error || "Não foi possível remover a reação.",
        });
      } finally {
        setReactionLoading((prev) => {
          const next = { ...prev };
          delete next[mid];
          return next;
        });
      }
    },
    [conversaId, localReactions, reactionLoading, showToast]
  );

  const handlePaste = useCallback(
    (e) => {
      if (!conversaId) return;
      const dt = e.clipboardData;
      if (!dt) return;

      const files = dt.files && dt.files.length > 0 ? Array.from(dt.files) : [];
      const items = dt.items && dt.items.length > 0 ? Array.from(dt.items) : [];

      let pickedFile = null;

      if (files.length > 0) {
        pickedFile = files.find((f) => f && isImageFile(f)) || files[0];
      } else if (items.length > 0) {
        const fileItem = items.find((it) => it.kind === "file" && it.type && it.type.startsWith("image/"));
        if (fileItem) pickedFile = fileItem.getAsFile();
      }

      if (pickedFile && isImageFile(pickedFile)) {
        e.preventDefault();
        handleDropFile(pickedFile);
      }
    },
    [conversaId, handleDropFile]
  );

  const onDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const onDragOver = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!dragOver) setDragOver(true);
    },
    [dragOver]
  );

  const onDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);

      const file = e.dataTransfer?.files?.[0];
      if (file) handleDropFile(file);
    },
    [handleDropFile]
  );

  const handleEnviarArquivo = useCallback(
    async (file, opts = {}) => {
      if (!file || !conversaId) return;
      if (!podeEnviar) {
        showToast({
          type: "warning",
          title: "Conversa não assumida",
          message: "Clique em Assumir para enviar mensagens.",
        });
        clearPending();
        return;
      }

      const formData = new FormData();
      // Inclui nome quando disponível (File tem .name; Blob precisa do 3º parâmetro)
      const nomeArquivo = isAudioFile(file) ? getAudioFilename(file) : (file?.name || "arquivo");
      formData.append("file", file, nomeArquivo);
      if (opts.forceStickerType) {
        formData.append("tipo", "sticker");
      }
      const legenda = String(opts.caption ?? "").trim();
      if (legenda) {
        formData.append("caption", legenda);
      }

      setSending(true);
      try {
        // Content-Type: false remove o header para o browser definir multipart/form-data com boundary.
        const { data } = await api.post(`/chats/${conversaId}/arquivo`, formData, {
          headers: { "Content-Type": false },
        });

        clearPending();

        if (!opts.waitSocketOnly && (!data?.id || Number(data?.conversa_id) !== Number(conversaId))) {
          await refresh({ silent: true });
        }
      } catch (err) {
        console.error("Erro ao enviar arquivo:", err);
        const is403 = err?.response?.status === 403;
        const apiMsg = err?.response?.data?.error;
        showToast({
          type: "error",
          title: is403 ? "Acesso restrito" : "Falha ao enviar",
          message: apiMsg || (is403 ? "Assuma a conversa antes de enviar mensagens." : "Não foi possível enviar o arquivo. Tente novamente."),
        });
      } finally {
        setSending(false);
        focusMessageInput();
      }
    },
    [conversaId, refresh, showToast, clearPending, podeEnviar, focusMessageInput]
  );

  const handleFileInputChange = useCallback(
    (e) => {
      const file = e.target.files?.[0];
      if (!file) {
        e.target.value = "";
        return;
      }
      handleDropFile(file);
      e.target.value = "";
    },
    [handleDropFile]
  );

  const handleCameraInputChange = useCallback(
    (e) => {
      const file = e.target.files?.[0];
      if (!file) {
        e.target.value = "";
        return;
      }
      handleDropFile(file);
      e.target.value = "";
    },
    [handleDropFile]
  );

  const handleFototecaInputChange = useCallback(
    async (e) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      e.target.value = "";
      if (!files.length || !conversaId) return;
      if (!podeEnviar) {
        showToast({
          type: "warning",
          title: "Conversa não assumida",
          message: "Clique em Assumir para enviar mensagens.",
        });
        return;
      }
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append("file", files[i]);
      }
      setSending(true);
      try {
        const { data } = await api.post(`/chats/${conversaId}/arquivo`, formData, {
          headers: { "Content-Type": false },
        });
        const hasIds = Array.isArray(data?.ids) && data.ids.length > 0;
        if (!hasIds && (!data?.id || Number(data?.conversa_id) !== Number(conversaId))) {
          await refresh({ silent: true });
        }
      } catch (err) {
        console.error("Erro ao enviar fotos da galeria:", err);
        const is403 = err?.response?.status === 403;
        const apiMsg = err?.response?.data?.error;
        showToast({
          type: "error",
          title: is403 ? "Acesso restrito" : "Falha ao enviar",
          message: apiMsg || (is403 ? "Assuma a conversa antes de enviar mensagens." : "Não foi possível enviar as fotos. Tente novamente."),
        });
      } finally {
        setSending(false);
        focusMessageInput();
      }
    },
    [conversaId, podeEnviar, refresh, showToast, focusMessageInput]
  );

  const handleConfirmSendFile = useCallback(async () => {
    if (!pendingFile || confirmSendLockRef.current) return;
    confirmSendLockRef.current = true;
    try {
      const captionToSend = pendingCaption;
      await handleEnviarArquivo(pendingFile, { caption: captionToSend });
    } finally {
      confirmSendLockRef.current = false;
    }
  }, [pendingFile, pendingCaption, handleEnviarArquivo]);

  const persistRecentSticker = useCallback(
    async (file) => {
      try {
        const dataUrl = await toDataUrl(file);
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const item = {
          id,
          name: file.name || "figurinha",
          mimeType: file.type || "image/webp",
          dataUrl,
          ts: Date.now(),
        };
        const next = [item, ...recentStickers.filter((x) => x?.dataUrl !== dataUrl)].slice(0, STICKER_RECENTS_LIMIT);
        setRecentStickers(next);
        writeRecentStickers(user, next);
      } catch {
        /* ignore */
      }
    },
    [recentStickers, user]
  );

  const sendStickerFile = useCallback(
    async (inputFile) => {
      if (!inputFile || !conversaId) return;
      try {
        let fileToSend = inputFile;
        const type = String(inputFile.type || "").toLowerCase();
        const shouldConvert = type.startsWith("image/") && type !== "image/webp" && !type.includes("gif");
        if (shouldConvert) {
          try {
            fileToSend = await convertImageToWebp(inputFile);
          } catch {
            fileToSend = inputFile;
          }
        }
        const mime = String(fileToSend.type || "").toLowerCase();
        const ext = String(fileToSend.name || "").toLowerCase();
        const isWebp = mime === "image/webp" || ext.endsWith(".webp");
        await handleEnviarArquivo(fileToSend, { forceStickerType: !isWebp, waitSocketOnly: true });
        await persistRecentSticker(fileToSend);
        setStickerOpen(false);
        setStickerQuery("");
      } catch {
        /* toast já tratado no envio */
      }
    },
    [conversaId, handleEnviarArquivo, persistRecentSticker]
  );

  const handleStickerInputChange = useCallback(
    async (e) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      await sendStickerFile(file);
    },
    [sendStickerFile]
  );

  const handleStartRecording = useCallback(async () => {
    if (!conversaId || sending || isRecording) return;
    if (!podeEnviar) {
      showToast({
        type: "warning",
        title: "Conversa não assumida",
        message: "Clique em Assumir para enviar mensagens.",
      });
      return;
    }
    recordingCanceledRef.current = false;
    setRecordingSeconds(0);
    try {
      if (!window.isSecureContext) {
        showToast({
          type: "error",
          title: "Microfone",
          message: "Para gravar áudio, acesse via HTTPS (ou localhost). Em HTTP o navegador bloqueia o microfone.",
        });
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        showToast({
          type: "error",
          title: "Microfone",
          message: "Seu navegador não suporta gravação de áudio (getUserMedia indisponível).",
        });
        return;
      }

      // Se o navegador suportar, checa estado de permissão antes de pedir
      try {
        const perm = await navigator.permissions?.query?.({ name: "microphone" });
        if (perm?.state === "denied") {
          showToast({
            type: "error",
            title: "Microfone bloqueado",
            message: "O microfone está bloqueado para este site. Clique no cadeado do navegador e permita o microfone.",
          });
          return;
        }
      } catch {
        // ignore
      }

      let stream = micStreamRef.current;
      const audioTracks = stream?.getAudioTracks?.() || [];
      const hasLiveMic = audioTracks.some((t) => t.readyState === "live");
      if (!hasLiveMic) {
        if (stream) {
          try {
            stream.getTracks().forEach((t) => t.stop());
          } catch {
            /* ignore */
          }
          micStreamRef.current = null;
        }
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStreamRef.current = stream;
        const track = stream.getAudioTracks?.()[0];
        if (track) {
          const onEnded = () => {
            track.removeEventListener("ended", onEnded);
            micStreamRef.current = null;
          };
          track.addEventListener("ended", onEnded);
        }
      }

      // Escolhe o melhor mimeType disponível (melhora compatibilidade)
      const preferred = [
        "audio/ogg;codecs=opus",
        "audio/ogg",
        "audio/webm;codecs=opus",
        "audio/webm",
      ];
      const mimeType =
        typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported
          ? preferred.find((t) => MediaRecorder.isTypeSupported(t))
          : null;

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        /* Mantém o stream ativo para a próxima gravação (permissão só na 1ª vez nesta sessão). */
        if (recordingCanceledRef.current || audioChunksRef.current.length === 0) return;
        const finalType = recorder.mimeType || mimeType || "audio/webm";
        const ext = finalType.includes("ogg") ? "ogg" : "webm";
        const blob = new Blob(audioChunksRef.current, { type: finalType });
        if (blob.size < 50) {
          showToast({
            type: "warning",
            title: "Áudio muito curto",
            message: "Grave por pelo menos 1 segundo antes de enviar.",
          });
          return;
        }
        const file = new File([blob], `audio-${Date.now()}.${ext}`, { type: finalType });
        await handleEnviarArquivo(file);
      };

      recorder.start(400);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch (err) {
      console.error("Erro ao iniciar gravação:", err);
      const name = String(err?.name || "");
      if (name === "NotAllowedError" || name === "NotFoundError") {
        try {
          micStreamRef.current?.getTracks?.().forEach((t) => t.stop());
        } catch {
          /* ignore */
        }
        micStreamRef.current = null;
      }
      const msg =
        name === "NotAllowedError"
          ? "Permissão negada. Clique no cadeado do navegador e permita o microfone."
          : name === "NotFoundError"
            ? "Nenhum microfone foi encontrado no dispositivo."
            : "Não foi possível acessar o microfone. Verifique as permissões.";
      showToast({
        type: "error",
        title: "Microfone",
        message: msg,
      });
    }
  }, [conversaId, sending, isRecording, handleEnviarArquivo, showToast, podeEnviar]);

  const handleStopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      try {
        if (mediaRecorderRef.current.state !== "inactive") {
          mediaRecorderRef.current.stop();
        }
      } catch {}
      mediaRecorderRef.current = null;
      setIsRecording(false);
      setRecordingSeconds(0);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    }
  }, [isRecording]);

  const handleCancelRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      recordingCanceledRef.current = true;
      try {
        if (mediaRecorderRef.current.state !== "inactive") {
          mediaRecorderRef.current.stop();
        }
      } catch {}
      mediaRecorderRef.current = null;
      setIsRecording(false);
      setRecordingSeconds(0);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    }
  }, [isRecording]);

  useEffect(() => {
    if (!isRecording) return;
    recordingTimerRef.current = setInterval(() => {
      setRecordingSeconds((s) => s + 1);
    }, 1000);
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };
  }, [isRecording]);

  useEffect(() => {
    return () => {
      const s = micStreamRef.current;
      if (!s) return;
      try {
        s.getTracks().forEach((t) => t.stop());
      } catch {
        /* ignore */
      }
      micStreamRef.current = null;
    };
  }, []);

  const toggleTimeline = useCallback(() => {
    setShowTimeline((v) => !v);
  }, []);

  const handleCloseTimeline = useCallback(() => setShowTimeline(false), []);

  const emitTypingStop = useCallback(() => {
    if (!conversaId) return;
    const socket = getSocket();
    if (socket?.connected) socket.emit("typing_stop", { conversa_id: conversaId });
  }, [conversaId]);

  const emitTypingStart = useCallback(() => {
    if (!conversaId) return;
    const socket = getSocket();
    if (socket?.connected) socket.emit("typing_start", { conversa_id: conversaId });
  }, [conversaId]);

  useEffect(() => {
    if (!conversaId) return;
    if (!safeString(texto)) {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      emitTypingStop();
      return;
    }
    const t = typingTimeoutRef.current;
    if (t) clearTimeout(t);
    typingTimeoutRef.current = setTimeout(() => {
      typingTimeoutRef.current = null;
      emitTypingStart();
    }, 400);
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
    };
  }, [conversaId, texto, emitTypingStart, emitTypingStop]);

  useEffect(() => {
    return () => {
      if (conversaId) {
        const socket = getSocket();
        if (socket?.connected) socket.emit("typing_stop", { conversa_id: conversaId });
        clearTyping(conversaId);
      }
    };
  }, [conversaId, clearTyping]);

  const handleEnviar = useCallback(async (forcedText) => {
    if (!conversaId) return;
    if (!podeEnviar) {
      showToast({
        type: "warning",
        title: "Conversa não assumida",
        message: "Clique em Assumir para enviar mensagens.",
      });
      return;
    }

    const forcedLooksLikeEvent =
      forcedText &&
      typeof forcedText === "object" &&
      ("nativeEvent" in forcedText || "preventDefault" in forcedText || "currentTarget" in forcedText);
    const t = safeString((forcedLooksLikeEvent ? undefined : forcedText) ?? texto);
    if (!t) return;
    emitTypingStop();
    const chatParaNome = fromChat ?? conversa;
    const replyMeta = buildReplyMetaForPersist(replyTo, nome, chatParaNome);

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const optimisticMsg = {
      tempId,
      tipo: "texto",
      texto: t,
      conteudo: t,
      direcao: "out",
      status: "pending",
      status_mensagem: "pending",
      criado_em: new Date().toISOString(),
      conversa_id: Number(conversaId),
      reply_meta: replyMeta || undefined,
    };
    anexarMensagem(optimisticMsg);
    const chatStore = useChatStore.getState();
    const chats = chatStore.chats || [];
    const jaNaLista = chats.some((c) => String(c?.id) === String(conversaId));
    if (!jaNaLista && conversa) {
      const nome = conversa?.contato_nome || conversa?.nome_contato_cache || conversa?.cliente_nome || conversa?.nome_grupo
      chatStore.addChat({
        id: conversaId,
        contato_nome: nome || undefined,
        foto_perfil: conversa?.foto_perfil,
        ultima_mensagem: optimisticMsg,
      });
    }
    if (typeof chatStore.setUltimaMensagemEBump === "function") {
      chatStore.setUltimaMensagemEBump(conversaId, optimisticMsg);
    } else {
      chatStore.setUltimaMensagem(conversaId, optimisticMsg);
      chatStore.bumpChatToTop(conversaId);
    }
    resetAutocorrectTracking();
    setTexto("");
    setReplyTo(null);
    setSending(true);

    let envioFalhou = false;
    try {
      const res = await enviarMensagem(conversaId, t, replyMeta || undefined);
      // API pode retornar { ok, id, conversa_id } SEM mensagem — msg vem só via socket nova_mensagem
      const resMsgId = res?.mensagem?.id ?? res?.id;
      if (res?.mensagem?.id && replyMeta) {
        saveReplyMeta(conversaId, res.mensagem.id, replyMeta);
      }
      // Só remover otimista em falha explícita. `ok` ausente ≠ erro (evita apagar mensagem em respostas mínimas ou só com mensagem.id).
      if (res?.ok === false && resMsgId == null) {
        removerMensagemTemp(tempId);
      }
    } catch (err) {
      envioFalhou = true;
      console.error("Erro ao enviar mensagem:", err);
      removerMensagemTemp(tempId);
      setTexto(t);
      if (replyTo) setReplyTo(replyTo);
      const is403 = err?.response?.status === 403;
      const apiMsg = err?.response?.data?.error;
      showToast({
        type: "error",
        title: is403 ? "Acesso restrito" : "Falha ao enviar",
        message: apiMsg || (is403 ? "Assuma a conversa antes de enviar mensagens." : "Não foi possível enviar a mensagem. Verifique sua conexão."),
      });
      focusMessageInput();
    } finally {
      setSending(false);
    }
    // Sucesso: refoca depois do layout/scroll da nova mensagem — evita “subir e voltar” ao enviar.
    if (!envioFalhou) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => focusMessageInput());
      });
    }
  }, [conversaId, texto, replyTo, showToast, anexarMensagem, removerMensagemTemp, nome, emitTypingStop, podeEnviar, focusMessageInput, resetAutocorrectTracking]);

  const handlePixMenuClick = useCallback(async () => {
    if (!conversaId || sending || pixActionBusy || !podeEnviar) return;
    setAttachMenuOpen(false);
    setPixActionBusy(true);
    try {
      const localCfg = {
        tipo_chave: pixTipoChave,
        chave_pix: pixChave,
        nome_recebedor: pixNomeRecebedor,
        mensagem_padrao: pixMensagemPadrao,
      };
      let cfgToUse = isPixConfigured(localCfg) ? localCfg : null;
      if (!cfgToUse || !pixConfigLoaded) {
        const fetched = await fetchPixConfigIfNeeded();
        if (fetched && isPixConfigured(fetched)) cfgToUse = fetched;
      }
      if (!cfgToUse || !isPixConfigured(cfgToUse)) {
        setPixModalOpen(true);
        return;
      }
      const msg = buildPixMessagePreview(cfgToUse);
      await handleEnviar(msg);
    } finally {
      setPixActionBusy(false);
    }
  }, [
    conversaId,
    sending,
    pixActionBusy,
    podeEnviar,
    pixTipoChave,
    pixChave,
    pixNomeRecebedor,
    pixMensagemPadrao,
    isPixConfigured,
    pixConfigLoaded,
    fetchPixConfigIfNeeded,
    buildPixMessagePreview,
    handleEnviar,
  ]);

  const runInputFlash = useCallback(() => {
    setAutoCorrectFlash(true);
    if (autoCorrectFlashTimeoutRef.current) {
      clearTimeout(autoCorrectFlashTimeoutRef.current);
    }
    autoCorrectFlashTimeoutRef.current = setTimeout(() => {
      setAutoCorrectFlash(false);
      autoCorrectFlashTimeoutRef.current = null;
    }, 220);
  }, []);

  const updateAutoCorrectPreference = useCallback((next) => {
    setAutoCorrectEnabled(next);
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(buildAutoCorrectStorageKey(user), next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [user]);

  const applyAutocorrectFromEvent = useCallback((e, triggerChar) => {
    if (!autoCorrectEnabled) return null;
    if (e.nativeEvent?.isComposing || e.isComposing) return null;
    const el = e.currentTarget;
    if (!el || typeof el.selectionStart !== "number" || typeof el.selectionEnd !== "number") return null;

    const edit = getAutocorrectEdit({
      text: el.value,
      selectionStart: el.selectionStart,
      selectionEnd: el.selectionEnd,
      triggerChar,
    });
    if (!edit) return null;

    const originalWord = String(el.value || "").slice(edit.replaceStart, edit.replaceEnd);
    const originalLower = normalizeAutoWord(originalWord);
    const candidateContext = getAutoContext(el.value, edit.replaceStart, edit.replaceEnd);
    const shouldIgnore = autoCorrectIgnoredRef.current.some(
      (item) => item?.originalLower === originalLower && contextMatches(candidateContext, item.context)
    );
    if (shouldIgnore) return null;

    e.preventDefault();
    let nextValue = "";
    if (typeof el.setRangeText === "function") {
      el.setRangeText(edit.replacement, edit.replaceStart, edit.replaceEnd, "end");
      nextValue = String(el.value || "");
      setTexto(nextValue);
      syncTextareaHeight();
    } else {
      const cur = String(el.value || "");
      nextValue = `${cur.slice(0, edit.replaceStart)}${edit.replacement}${cur.slice(edit.replaceEnd)}`;
      const nextPos = edit.replaceStart + edit.replacement.length;
      setTexto(nextValue);
      requestAnimationFrame(() => {
        try {
          el.setSelectionRange?.(nextPos, nextPos);
        } catch {}
      });
    }

    const correctedLower = normalizeAutoWord(edit.correctedWord);
    const correctionContext = getAutoContext(
      nextValue,
      edit.replaceStart,
      edit.replaceStart + String(edit.correctedWord || "").length
    );
    autoCorrectTrackedRef.current.push({
      originalLower,
      correctedLower,
      context: correctionContext,
    });

    runInputFlash();
    return edit;
  }, [autoCorrectEnabled, contextMatches, getAutoContext, normalizeAutoWord, runInputFlash, syncTextareaHeight]);

  const handleInputChange = useCallback((e) => {
    const nextValue = String(e.target.value || "");
    const tracked = autoCorrectTrackedRef.current;

    if (tracked.length > 0) {
      const remaining = [];
      for (const item of tracked) {
        const stillCorrected = hasWordWithContext(nextValue, item.correctedLower, item.context);
        if (stillCorrected) {
          remaining.push(item);
          continue;
        }
        const revertedToOriginal = hasWordWithContext(nextValue, item.originalLower, item.context);
        if (revertedToOriginal) {
          autoCorrectIgnoredRef.current.push({
            originalLower: item.originalLower,
            context: item.context,
          });
        }
      }
      autoCorrectTrackedRef.current = remaining;
    }

    if (!nextValue) {
      resetAutocorrectTracking();
    }

    setTexto(nextValue);
  }, [hasWordWithContext, resetAutocorrectTracking]);

  const handleKeyDownInput = useCallback(
    (e) => {
      if (e.nativeEvent?.isComposing || e.isComposing) return;

      const key = String(e.key || "");
      const punctuationTrigger = key.length === 1 && [".", ",", "!", "?", ";", ":"].includes(key);
      if (key === " " || punctuationTrigger) {
        applyAutocorrectFromEvent(e, key);
        return;
      }

      if (key !== "Enter") return;

      if (composerEnterInsertsNewline) {
        applyAutocorrectFromEvent(e, "\n");
        return;
      }

      if (e.shiftKey) {
        applyAutocorrectFromEvent(e, "\n");
        return;
      }

      const edit = applyAutocorrectFromEvent(e, "\n");
      e.preventDefault();
      const textToSend = edit
        ? `${String(e.currentTarget?.value || "")}`.replace(/\n$/, "")
        : texto;
      handleEnviar(textToSend);
    },
    [applyAutocorrectFromEvent, composerEnterInsertsNewline, handleEnviar, texto]
  );

  const persistPins = useCallback((next) => {
    if (!conversaId) return;
    try {
      localStorage.setItem(`zap:pins:${conversaId}`, JSON.stringify(next || []));
    } catch {}
  }, [conversaId]);

  const persistStars = useCallback((next) => {
    if (!conversaId) return;
    try {
      localStorage.setItem(`zap:stars:${conversaId}`, JSON.stringify(next || []));
    } catch {}
  }, [conversaId]);

  const togglePin = useCallback((msg) => {
    if (!msg?.id || !conversaId) return;
    setPinnedIds((cur) => {
      const id = String(msg.id);
      const has = (cur || []).map(String).includes(id);
      const next = has ? (cur || []).filter((x) => String(x) !== id) : [...(cur || []), id];
      persistPins(next);
      showToast({ type: "info", title: has ? "Desafixada" : "Fixada", message: snippetFromMsg(msg) });
      return next;
    });
  }, [conversaId, persistPins, showToast]);

  const toggleStar = useCallback((msg) => {
    if (!msg?.id || !conversaId) return;
    setStarredIds((cur) => {
      const id = String(msg.id);
      const has = (cur || []).map(String).includes(id);
      const next = has ? (cur || []).filter((x) => String(x) !== id) : [...(cur || []), id];
      persistStars(next);
      showToast({ type: "info", title: has ? "Removida dos favoritos" : "Favoritada", message: snippetFromMsg(msg) });
      return next;
    });
  }, [conversaId, persistStars, showToast]);

  const startSelect = useCallback((msg) => {
    if (!msg?.id || msg.apagada_para_todos) return;
    setForwardSelectIntent(false);
    setSelectMode(true);
    const key = String(msg.id);
    setSelectedMsgIds((cur) => {
      const next = { ...(cur || {}), [key]: true };
      let ord = selectionOrderRef.current;
      ord = ord.includes(key) ? ord : [...ord, key];
      selectionOrderRef.current = ord;
      setSelectionOrder(ord);
      return next;
    });
  }, []);

  const toggleSelected = useCallback(
    (msg) => {
      if (!msg?.id || msg.apagada_para_todos) return;
      setSelectedMsgIds((cur) => {
        const key = String(msg.id);
        const wasOn = !!cur[key];
        const nextOn = !wasOn;
        let ord = selectionOrderRef.current;
        if (nextOn && forwardSelectIntent && ord.length >= FORWARD_SELECT_MAX && !ord.includes(key)) {
          showToast({
            type: "warning",
            title: "Limite",
            message: `No máximo ${FORWARD_SELECT_MAX} mensagens por encaminhamento.`,
          });
          return cur;
        }
        ord = nextOn ? (ord.includes(key) ? ord : [...ord, key]) : ord.filter((k) => k !== key);
        selectionOrderRef.current = ord;
        setSelectionOrder(ord);
        return { ...cur, [key]: nextOn };
      });
    },
    [forwardSelectIntent, showToast]
  );

  const exitSelectMode = useCallback(() => {
    selectionOrderRef.current = [];
    setSelectionOrder([]);
    setSelectedMsgIds({});
    setSelectMode(false);
    setForwardSelectIntent(false);
  }, []);

  const handleReplyAction = useCallback((msg) => {
    setReplyTo(msg || null);
    focusMessageInput();
  }, [focusMessageInput]);

  const handleInfoAction = useCallback((msg) => {
    if (!msg) return;
    setMsgInfo(msg);
    setMsgInfoOpen(true);
  }, []);

  const handleCopyResult = useCallback((ok) => {
    showToast({
      type: ok ? "success" : "error",
      title: ok ? "Copiado" : "Falha ao copiar",
      message: ok ? "Mensagem copiada para a área de transferência." : "Não foi possível copiar. Tente novamente.",
    });
  }, [showToast]);

  function buildForwardText(m) {
    if (!m) return "";
    const t = safeString(m?.texto);
    if (t) return `[Encaminhado]\n${t}`;
    const url = getMediaUrl(m?.url, m?.url_absoluta);
    const nome = safeString(m?.nome_arquivo);
    if (url) return `[Encaminhado]\n${nome ? `${nome}\n` : ""}${url}`;
    return "[Encaminhado]\n(mídia)";
  }

  const handleForwardAction = useCallback((msg) => {
    if (!msg?.id || msg.apagada_para_todos) {
      if (msg?.apagada_para_todos) {
        showToast({
          type: "info",
          title: "Não disponível",
          message: "Não é possível encaminhar uma mensagem apagada.",
        });
      }
      return;
    }
    setForwardSelectIntent(true);
    setSelectMode(true);
    const key = String(msg.id);
    const ord = [key];
    selectionOrderRef.current = ord;
    setSelectionOrder(ord);
    setSelectedMsgIds({ [key]: true });
  }, [showToast]);

  const orderedSelectedIds = useMemo(
    () => (selectionOrder || []).filter((id) => selectedMsgIds?.[id]),
    [selectionOrder, selectedMsgIds]
  );

  const handleForwardAdvance = useCallback(() => {
    if (!orderedSelectedIds.length) return;
    const byId = new Map((mensagens || []).filter((m) => m?.id).map((m) => [String(m.id), m]));
    const orderedMsgs = orderedSelectedIds.map((id) => byId.get(String(id))).filter(Boolean);
    if (!orderedMsgs.length) {
      showToast({
        type: "warning",
        title: "Mensagens indisponíveis",
        message: "Não foi possível resolver as mensagens selecionadas nesta conversa.",
      });
      return;
    }
    const capped = orderedMsgs.slice(0, FORWARD_SELECT_MAX);
    if (orderedMsgs.length > capped.length) {
      showToast({
        type: "info",
        title: "Limite",
        message: `Encaminhando as primeiras ${FORWARD_SELECT_MAX} mensagens selecionadas.`,
      });
    }
    setForwardMsgs(capped);
    setForwardQuery("");
    setForwardSelectedConversaIds([]);
    setForwardOpen(true);
  }, [orderedSelectedIds, mensagens, showToast]);

  const forwardPreviewLabel = useMemo(() => {
    if (!forwardMsgs?.length) return "";
    if (forwardMsgs.length === 1) return snippetFromMsg(forwardMsgs[0]);
    const first = snippetFromMsg(forwardMsgs[0]);
    return `${first} · e mais ${forwardMsgs.length - 1} mensagem(ns)`;
  }, [forwardMsgs]);

  const handleDeleteForMe = useCallback(
    async (msg) => {
      if (!conversaId || !msg?.id) return;
      const preview = snippetFromMsg(msg).slice(0, 120);
      const isMedia = isRichMediaMessage(msg);
      const ok = window.confirm(
        isMedia
          ? `Ocultar esta mídia só para você?\n\n` +
              `• Ela continua no histórico para os outros atendentes.\n` +
              `• Não apaga o arquivo no servidor nem no WhatsApp.\n\n` +
              `Prévia: "${preview || "(mídia)"}"`
          : `Ocultar esta mensagem só para você?\n\n` +
              `Os outros da conversa continuam vendo.\n\n` +
              `Prévia: "${preview || "(sem texto)"}"`
      );
      if (!ok) return;
      try {
        await excluirMensagem(conversaId, msg.id, { scope: "me" });
        removerMensagem(msg.id);
        showToast({ type: "success", title: "Apagada para mim", message: "A mensagem foi removida da sua visualização." });
      } catch (e) {
        console.error("Erro ao apagar pra mim:", e);
        showToast({ type: "error", title: "Falha ao apagar", message: e.response?.data?.error || "Não foi possível apagar a mensagem." });
      }
    },
    [conversaId, showToast, removerMensagem]
  );

  const handleDeleteForEveryone = useCallback(
    async (msg) => {
      if (!conversaId || msg?.apagada_para_todos) return;
      const mid = msg?.id;
      if (mid == null || String(mid).trim() === "") {
        showToast({
          type: "warning",
          title: "Aguarde confirmação",
          message: "Só é possível apagar para todos depois que a mensagem for confirmada pelo servidor.",
        });
        return;
      }
      // regra: "para todos" somente para mensagens enviadas por mim
      if (!myUserId || msg?.autor_usuario_id == null || String(msg.autor_usuario_id) !== String(myUserId)) {
        showToast({
          type: "info",
          title: "Somente suas mensagens",
          message: "Você só pode apagar para todos mensagens enviadas por você.",
        });
        return;
      }
      const pk = String(mid);
      const preview = snippetFromMsg(msg).slice(0, 120);
      const isMedia = isRichMediaMessage(msg);
      const ok = window.confirm(
        isMedia
          ? `Apagar para todos esta mídia?\n\n` +
              `• Só é permitido para mensagens que você enviou.\n` +
              `• A conversa passará a mostrar um aviso no lugar da mídia.\n` +
              `• A remoção no WhatsApp depende do provedor (UltraMsg).\n\n` +
              `Prévia: "${preview || "(mídia)"}"\n(id ${pk})`
          : `Apagar para todos esta mensagem?\n\n"${preview || "(sem texto)"}"\n\nSomente esta mensagem (id ${pk}) será substituída por um aviso.`
      );
      if (!ok) return;
      try {
        await excluirMensagem(conversaId, mid);
        marcarMensagemApagadaParaTodos(mid, { euQueApaguei: true });
        showToast({
          type: "success",
          title: "Apagada para todos",
          message: "A mensagem foi substituída por um aviso nesta conversa.",
        });
      } catch (e) {
        console.error("Erro ao excluir mensagem:", e);
        showToast({ type: "error", title: "Falha ao apagar", message: "Não foi possível apagar a mensagem." });
      }
    },
    [conversaId, myUserId, showToast, marcarMensagemApagadaParaTodos]
  );

  const handleDeleteSelected = useCallback(async () => {
    if (!conversaId) return;
    const ids = Array.from(selectedSet);
    if (ids.length === 0) return;
    const ok = window.confirm(`Apagar ${ids.length} mensagem(ns) selecionada(s) do sistema?`);
    if (!ok) return;
    try {
      for (const id of ids) {
        // eslint-disable-next-line no-await-in-loop
        await excluirMensagem(conversaId, id);
      }
      showToast({ type: "success", title: "Apagadas", message: `${ids.length} mensagem(ns) removida(s).` });
      exitSelectMode();
    } catch (e) {
      console.error("Erro ao excluir selecionadas:", e);
      showToast({ type: "error", title: "Falha ao apagar", message: "Algumas mensagens podem não ter sido apagadas." });
    }
  }, [conversaId, selectedSet, exitSelectMode, showToast]);

  const scrollToMsg = useCallback((msgId) => {
    if (!msgId) return;
    const list = mensagensComSeparadoresRef.current;
    const idx = list.findIndex((it) => it && it.__type === "msg" && String(it.id) === String(msgId));
    if (idx >= 0 && virtualThreadRef.current?.scrollToIndex) {
      virtualThreadRef.current.scrollToIndex(idx, { align: "center", behavior: "smooth" });
      return;
    }
    const el = document.querySelector(`[data-msg-id="${String(msgId)}"]`);
    el?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }, []);

  const jumpToReply = useCallback((replyToId) => {
    const rid = safeString(replyToId);
    if (!rid) return;

    const list = Array.isArray(mensagens) ? mensagens : [];
    const byWaId = list.find((m) => safeString(m?.whatsapp_id) && String(m.whatsapp_id) === rid);
    if (byWaId?.id) return scrollToMsg(byWaId.id);

    // fallback: se veio id numérico do banco
    if (/^\d{1,15}$/.test(rid)) return scrollToMsg(rid);

    showToast({
      type: "info",
      title: "Mensagem não encontrada",
      message: "A mensagem respondida não está carregada neste histórico.",
    });
  }, [mensagens, scrollToMsg, showToast]);

  const closeForward = useCallback(() => {
    if (forwardMax10TimerRef.current) {
      clearTimeout(forwardMax10TimerRef.current);
      forwardMax10TimerRef.current = null;
    }
    setForwardOpen(false);
    setForwardMsgs(null);
    setForwardQuery("");
    setForwardSending(false);
    setForwardSelectedConversaIds([]);
    setForwardMax10Msg("");
    setForwardMultiProgress(null);
  }, []);

  /** Fecha modal de encaminhar (se aberto) e sai do modo seleção — botão X estilo WhatsApp. */
  const dismissSelectionOverlay = useCallback(() => {
    closeForward();
    exitSelectMode();
  }, [closeForward, exitSelectMode]);

  const onEscape = useCallback(() => {
    if (isRecording) handleCancelRecording();
    if (showTimeline) setShowTimeline(false);
    if (tagsOpen) setTagsOpen(false);
    if (stickerOpen) {
      setStickerOpen(false);
      setStickerQuery("");
    }
    if (emojiOpen) {
      setEmojiOpen(false);
      setEmojiQuery("");
    }
    if (pendingFile) clearPending();
    if (showClienteSide) setShowClienteSide(false);
    if (showRespostasSalvas) setShowRespostasSalvas(false);
    if (showTransferirSetor) setShowTransferirSetor(false);
    if (forwardOpen || selectMode) dismissSelectionOverlay();
    if (msgInfoOpen) {
      setMsgInfoOpen(false);
      setMsgInfo(null);
    }
    if (pixModalOpen) setPixModalOpen(false);
    if (replyTo) setReplyTo(null);
  }, [
    isRecording,
    handleCancelRecording,
    showTimeline,
    tagsOpen,
    stickerOpen,
    emojiOpen,
    pendingFile,
    clearPending,
    showClienteSide,
    showRespostasSalvas,
    showTransferirSetor,
    dismissSelectionOverlay,
    forwardOpen,
    selectMode,
    msgInfoOpen,
    pixModalOpen,
    replyTo,
  ]);

  useGlobalHotkeys({
    onToggleTimeline: () => setShowTimeline((v) => !v),
    onFocusInput: focusMessageInput,
    onEscape,
    disabled: loading,
  });

  const toggleForwardConversaSelect = useCallback((rawId) => {
    if (rawId == null) return;
    const s = String(rawId);
    setForwardSelectedConversaIds((prev) => {
      if (prev.includes(s)) return prev.filter((x) => x !== s);
      if (prev.length >= FORWARD_DEST_MAX) {
        setForwardMax10Msg("Máximo de 10 contatos.");
        if (forwardMax10TimerRef.current) clearTimeout(forwardMax10TimerRef.current);
        forwardMax10TimerRef.current = setTimeout(() => {
          setForwardMax10Msg("");
          forwardMax10TimerRef.current = null;
        }, 4000);
        return prev;
      }
      return [...prev, s];
    });
  }, []);

  const execEncaminhar = useCallback(
    async (destConversaId, opts = {}) => {
      const { quietBatchItemToasts = false } = opts;
      const msgs = Array.isArray(forwardMsgs) ? forwardMsgs : [];
      if (!msgs.length) return;

      const orderedIds = msgs.map((m) => m.id).filter((id) => id != null);
      if (!orderedIds.length) {
        for (const m of msgs) {
          // eslint-disable-next-line no-await-in-loop
          await enviarMensagem(destConversaId, buildForwardText(m));
        }
        return null;
      }

      if (orderedIds.length === 1) {
        const forwardMsg = msgs[0];
        const tipo = String(forwardMsg?.tipo || "").toLowerCase();
        const hasMediaUrl = !!(forwardMsg?.url || forwardMsg?.url_absoluta);
        try {
          await encaminharMensagemViaAPI(destConversaId, forwardMsg.id);
          // Inserção no chat aberto fica exclusiva do evento socket `nova_mensagem`.
          return null;
        } catch (e) {
          console.warn("Encaminhar via API falhou, tentando fallback:", e?.response?.data?.error || e?.message);
          if (hasMediaUrl && (tipo === "arquivo" || tipo === "imagem" || tipo === "video" || tipo === "vídeo")) {
            try {
              await encaminharArquivo(destConversaId, forwardMsg, getMediaUrl);
              // Inserção no chat aberto fica exclusiva do evento socket `nova_mensagem`.
              return null;
            } catch (e2) {
              console.warn("Fallback arquivo também falhou:", e2);
            }
          }
          await enviarMensagem(destConversaId, buildForwardText(forwardMsg));
        }
        return null;
      }

      const res = await encaminharMensagemViaAPI(destConversaId, orderedIds);
      if (!res || res.kind !== "batch") {
        throw new Error("Resposta de encaminhamento em lote inválida.");
      }
      const items = res.encaminhamentos || [];
      if (!items.length) {
        throw new Error("Resposta de encaminhamento em lote sem itens.");
      }
      let okCount = 0;
      let failCount = 0;
      for (const item of items) {
        if (item?.ok) {
          okCount++;
        } else if (item && item.ok === false) {
          failCount++;
          if (!quietBatchItemToasts) {
            const hint = item.mensagem_id != null ? ` (#${item.mensagem_id})` : "";
            showToast({
              type: "error",
              title: "Falha ao encaminhar",
              message: String(item.error || item.status || `Item${hint}`),
            });
          }
        }
      }
      if (okCount === 0 && items.length) {
        throw new Error("Nenhuma mensagem foi encaminhada.");
      }
      return { successes: okCount, failures: failCount, total: items.length };
    },
    [forwardMsgs, showToast]
  );

  const confirmForwardToMany = useCallback(async () => {
    const ids = (forwardSelectedConversaIds || []).filter((x) => x != null && String(x) !== "");
    if (ids.length < 1 || ids.length > FORWARD_DEST_MAX || !forwardMsgs?.length || forwardSending) return;
    setForwardSending(true);
    setForwardMultiProgress({ current: 0, total: ids.length });
    const forwardOk = [];
    const forwardFail = [];
    const assumeFail = [];
    try {
      for (let i = 0; i < ids.length; i++) {
        const destId = ids[i];
        setForwardMultiProgress({ current: i + 1, total: ids.length });
        try {
          const stats = await execEncaminhar(destId, { quietBatchItemToasts: true });
          forwardOk.push(destId);
          if (stats && stats.failures > 0) {
            /* lote de mensagens com falhas parciais: POST já aceitou; ainda assumimos a conversa */
          }
          try {
            await assumirChat(destId);
          } catch (ae) {
            assumeFail.push({ id: destId, error: formatForwardHttpError(ae) });
          }
        } catch (e) {
          forwardFail.push({ id: destId, error: formatForwardHttpError(e) });
        }
      }

      if (forwardOk.length > 0 && forwardFail.length === 0 && assumeFail.length === 0) {
        showToast({
          type: "success",
          title: "Encaminhamento concluído",
          message: `Concluído para ${forwardOk.length} destino(s). As conversas ficaram com você após assumir.`,
        });
      } else if (forwardOk.length > 0 && (forwardFail.length > 0 || assumeFail.length > 0)) {
        const bits = [];
        if (forwardFail.length) {
          bits.push(
            `Falha ao encaminhar em ${forwardFail.length} destino(s): ${forwardFail.map((f) => `#${f.id}`).join(", ")}.`
          );
        }
        if (assumeFail.length) {
          bits.push(
            `Encaminhado, mas não foi possível assumir em ${assumeFail.length} destino(s): ${assumeFail.map((a) => `#${a.id}`).join(", ")}.`
          );
        }
        showToast({
          type: "warning",
          title: "Resultado parcial",
          message: bits.join(" "),
        });
      } else {
        showToast({
          type: "error",
          title: "Falha ao encaminhar",
          message: forwardFail.map((f) => f.error).filter(Boolean).join(" · ") || "Não foi possível encaminhar.",
        });
      }
      try {
        useChatStore.getState().requestChatListResync();
      } catch (_) {}
      closeForward();
      exitSelectMode();
    } catch (e) {
      showToast({ type: "error", title: "Encaminhamento", message: formatForwardHttpError(e) });
    } finally {
      setForwardSending(false);
      setForwardMultiProgress(null);
    }
  }, [
    forwardSelectedConversaIds,
    forwardMsgs,
    forwardSending,
    execEncaminhar,
    showToast,
    closeForward,
    exitSelectMode,
  ]);

  const confirmForwardTo = useCallback(
    async (destConversaId) => {
      if (!destConversaId || !forwardMsgs?.length || forwardSending) return;
      setForwardSending(true);
      try {
        const n = forwardMsgs.length;
        const stats = await execEncaminhar(destConversaId);
        if (stats && stats.failures > 0) {
          showToast({
            type: "info",
            title: "Encaminhamento parcial",
            message: `${stats.successes} de ${stats.total} encaminhada(s) com sucesso; ${stats.failures} falha(s).`,
          });
        } else {
          showToast({
            type: "success",
            title: n > 1 ? "Encaminhadas" : "Encaminhada",
            message: n > 1 ? `${n} mensagens encaminhadas com sucesso.` : "Mensagem encaminhada com sucesso.",
          });
        }
        try {
          await assumirChat(destConversaId);
        } catch (ae) {
          showToast({
            type: "warning",
            title: "Encaminhado, mas não foi possível assumir",
            message: formatForwardHttpError(ae),
          });
        }
        try {
          useChatStore.getState().requestChatListResync();
        } catch (_) {}
        closeForward();
        exitSelectMode();
      } catch (e) {
        console.error("Erro ao encaminhar:", e);
        showToast({ type: "error", title: "Falha ao encaminhar", message: formatForwardHttpError(e) });
      } finally {
        setForwardSending(false);
      }
    },
    [forwardMsgs, forwardSending, showToast, closeForward, execEncaminhar, exitSelectMode]
  );

  const confirmForwardToCliente = useCallback(
    async (cliente) => {
      if (!cliente?.id || !forwardMsgs?.length || forwardSending) return;
      setForwardSending(true);
      try {
        const n = forwardMsgs.length;
        const data = await abrirConversaCliente(cliente.id);
        const conv = data?.conversa || data || null;
        const destId = conv?.id || null;
        if (!destId) throw new Error("Não foi possível abrir a conversa do cliente.");
        try { useChatStore.getState().addChat(conv); } catch {}
        const stats = await execEncaminhar(destId);
        if (stats && stats.failures > 0) {
          showToast({
            type: "info",
            title: "Encaminhamento parcial",
            message: `${stats.successes} de ${stats.total} encaminhada(s) com sucesso; ${stats.failures} falha(s).`,
          });
        } else {
          showToast({
            type: "success",
            title: n > 1 ? "Encaminhadas" : "Encaminhada",
            message: n > 1 ? `${n} mensagens encaminhadas com sucesso.` : "Mensagem encaminhada com sucesso.",
          });
        }
        try {
          await assumirChat(destId);
        } catch (ae) {
          showToast({
            type: "warning",
            title: "Encaminhado, mas não foi possível assumir",
            message: formatForwardHttpError(ae),
          });
        }
        try {
          useChatStore.getState().requestChatListResync();
        } catch (_) {}
        closeForward();
        exitSelectMode();
      } catch (e) {
        console.error("Erro ao encaminhar (cliente):", e);
        showToast({ type: "error", title: "Falha ao encaminhar", message: formatForwardHttpError(e) });
      } finally {
        setForwardSending(false);
      }
    },
    [forwardMsgs, forwardSending, showToast, closeForward, execEncaminhar, exitSelectMode]
  );

  const confirmForwardToColaborador = useCallback(
    async (colab) => {
      const targetUserId = colab?.id ?? colab?.user_id ?? colab?.usuario_id;
      const ids = (forwardMsgs || []).map((m) => m.id).filter((id) => id != null);
      if (!ids.length || !conversaId || targetUserId == null || forwardSending) return;
      setForwardSending(true);
      try {
        const data = await forwardAtendimentoMessageToColaborador({
          conversaOrigemId: conversaId,
          mensagemIds: ids,
          targetUserId,
        });
        const many = Array.isArray(data?.messages) ? data.messages : null;
        const one = data?.message;
        const n = many?.length || (one ? 1 : 0);
        showToast({
          type: "success",
          title: n > 1 ? "Encaminhadas" : "Encaminhada",
          message:
            n > 1
              ? `${n} mensagens enviadas para o chat interno do colaborador.`
              : "Mensagem enviada para o chat interno do colaborador.",
        });
        closeForward();
        exitSelectMode();
      } catch (e) {
        console.error("Erro ao encaminhar (colaborador):", e);
        showToast({
          type: "error",
          title: "Falha ao encaminhar",
          message: e?.response?.data?.error || e?.message || "Não foi possível encaminhar para o colaborador.",
        });
      } finally {
        setForwardSending(false);
      }
    },
    [forwardMsgs, conversaId, forwardSending, showToast, closeForward, exitSelectMode]
  );

  const handleConversarContact = useCallback(
    async (meta) => {
      if (!meta?.telefone) {
        showToast({ type: "warning", title: "Telefone indisponível", message: "Este contato não possui número para iniciar conversa." });
        return;
      }
      try {
        const data = await abrirConversaPorTelefone(meta.nome || "Contato", meta.telefone);
        const conv = data?.conversa ?? conversaFromContatoResponse(data) ?? null;
        if (!conv?.id) throw new Error("Não foi possível abrir a conversa.");
        try { useChatStore.getState().addChat(conv); } catch {}
        setSelectedId(conv.id);
        carregarConversa(conv.id);
        showToast({ type: "success", title: "Conversa aberta", message: `Conversa com ${meta.nome || "contato"} iniciada.` });
      } catch (e) {
        console.error("Erro ao abrir conversa do contato:", e);
        showToast({
          type: "error",
          title: "Falha ao abrir conversa",
          message: e.response?.data?.error || e.message || "Não foi possível abrir a conversa com este contato.",
        });
      }
    },
    [showToast, setSelectedId, carregarConversa]
  );

  const handleAdicionarGrupoContact = useCallback((meta) => {
    if (!meta?.telefone) {
      showToast({ type: "warning", title: "Telefone indisponível", message: "Este contato não possui número." });
      return;
    }
    setAddToGroupModal({ open: true, telefone: meta.telefone, nome: meta.nome || "Contato" });
  }, [showToast]);

  const closeAddToGroupModal = useCallback(() => {
    setAddToGroupModal({ open: false, telefone: null, nome: null });
    setAddToGroupGrupos([]);
    setAddToGroupSending(false);
  }, []);

  const confirmAddToGroup = useCallback(
    async (grupo) => {
      if (!grupo?.id || !addToGroupModal?.telefone || addToGroupSending) return;
      setAddToGroupSending(true);
      try {
        await api.post(`/chats/${grupo.id}/participantes`, { telefone: addToGroupModal.telefone });
        showToast({ type: "success", title: "Adicionado", message: `${addToGroupModal.nome} foi adicionado ao grupo.` });
        closeAddToGroupModal();
      } catch (e) {
        const status = e?.response?.status;
        const msg = e?.response?.data?.error || e.message;
        if (status === 404 || status === 501 || msg?.toLowerCase?.().includes("not found") || msg?.toLowerCase?.().includes("não suportado")) {
          showToast({
            type: "info",
            title: "Funcionalidade indisponível",
            message: "Adicionar contato a grupo pode não estar disponível nesta instância.",
          });
        } else {
          showToast({ type: "error", title: "Falha ao adicionar", message: msg || "Não foi possível adicionar ao grupo." });
        }
      } finally {
        setAddToGroupSending(false);
      }
    },
    [addToGroupModal, addToGroupSending, showToast, closeAddToGroupModal]
  );

  useEffect(() => {
    if (showTimeline && conversaId) {
      carregarAtendimentos(conversaId);
    }
  }, [showTimeline, conversaId, carregarAtendimentos]);

  useEffect(() => {
    if (!addToGroupModal?.open) {
      setAddToGroupGrupos([]);
      setAddToGroupLoading(false);
      return;
    }
    setAddToGroupLoading(true);
    fetchChats({ incluir_todos_clientes: true })
      .then((list) => {
        const grupos = (Array.isArray(list) ? list : []).filter((c) => isGroupConversation(c));
        setAddToGroupGrupos(grupos);
      })
      .catch(() => setAddToGroupGrupos([]))
      .finally(() => setAddToGroupLoading(false));
  }, [addToGroupModal?.open]);

  useEffect(() => {
    clearPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversaId]);

  const mensagensComSeparadores = useMemo(() => {
    const raw = Array.isArray(mensagens) ? mensagens : [];
    const list = [];
    const reactionsByMsgId = {};

    // Primeiro, varre a lista original para detectar mensagens de reação (tipo='reaction')
    // e anexar o emoji na mensagem imediatamente anterior (aproximação estilo WhatsApp).
    for (let i = 0; i < raw.length; i++) {
      const msg = raw[i];
      if (!msg) continue;
      const tipo = safeString(msg.tipo).toLowerCase();
      if (tipo === "reaction") {
        const text = safeString(msg.texto || msg.message || msg.body);
        let emoji = "";
        const m = text.match(/rea[cç][aã]o:\s*(.+)$/i);
        if (m && m[1]) {
          emoji = m[1].trim();
        } else if (text) {
          // fallback: último caractere visível
          emoji = text.slice(-2).trim() || text.slice(-1);
        }
        const prevMsg = list[list.length - 1];
        if (prevMsg && prevMsg.id != null && emoji) {
          reactionsByMsgId[String(prevMsg.id)] = emoji;
        }
        // não adiciona a mensagem de reação na timeline
        continue;
      }
      list.push(msg);
    }

    const out = [];

    // Chave única por remetente: telefone quando existir, senão nome (evita "nome:" vs "tel:" darem chaves diferentes).
    const senderKey = (m) => {
      if (!m) return "";
      const tel = safeString(m?.remetente_telefone);
      const n = safeString(m?.remetente_nome);
      return tel || n || "";
    };

    for (let i = 0; i < list.length; i++) {
      const msg = list[i];
      if (!msg) continue;
      const prev = list[i - 1];

      const isNewDay = i === 0 || !sameDay(prev?.criado_em, msg?.criado_em);
      if (isNewDay) {
        const label = formatDia(msg?.criado_em) || "Data";
        out.push({ __type: "day", id: `day-${label}-${i}`, label });
      }

      const outMsg = isOutgoingMessage(msg);
      const prevOut = isOutgoingMessage(prev);
      const curSender = senderKey(msg);
      const prevSender = senderKey(prev);

      // WhatsApp-like (grupos): nome só na primeira msg do bloco; depois só as mensagens.
      const showRemetente =
        isGroup &&
        !outMsg &&
        Boolean(curSender) &&
        (isNewDay || !prev || prevOut || curSender !== prevSender);

      const reaction = reactionsByMsgId[String(msg.id)];

      out.push({ ...msg, __type: "msg", __showRemetente: showRemetente, __reaction: reaction });
    }

    /* Foto/vídeo seguido de texto curto (legenda enviada em mensagem separada): une visualmente. */
    for (let i = 0; i < out.length; i++) {
      const row = out[i];
      if (row.__type !== "msg") continue;
      let prevIdx = -1;
      for (let j = i - 1; j >= 0; j--) {
        if (out[j].__type === "msg") {
          prevIdx = j;
          break;
        }
      }
      if (prevIdx < 0) continue;
      const prev = out[prevIdx];
      const cur = row;
      if (!isMediaCaptionBundleTop(prev)) continue;
      if (!isPlainCaptionFollowMessage(cur)) continue;
      if (messageHasReplyMeta(cur)) continue;
      if (!sameCaptionBundleAuthor(prev, cur)) continue;
      if (!captionFollowTimeOk(prev, cur)) continue;
      out[prevIdx] = { ...prev, __captionBundleTop: true };
      out[i] = { ...cur, __captionBundleFollow: true };
    }

    return out;
  }, [mensagens, isGroup]);

  mensagensComSeparadoresRef.current = mensagensComSeparadores;

  const showAssumeEmptyCta = useMemo(() => {
    if (isGroup) return false;
    if (!conversa?.id || conversa?.mensagens_bloqueadas) return false;
    if (conversa?.exibir_cta_assumir_sem_mensagens !== true) return false;
    if (!canAssumir(user)) return false;
    const status = getStatusAtendimentoEffective(conversa);
    if (status === "fechada" || status === "encerrada") return false;
    const atendenteId = conversa?.atendente_id ?? null;
    const hasAtendente = atendenteId !== null && atendenteId !== "";
    if (hasAtendente) return false;
    const userRole = String(user?.role || user?.perfil || "").toLowerCase();
    const isPrivileged = userRole === "admin" || userRole === "supervisor";
    const convDepId = conversa?.departamento_id ?? null;
    const userDepIds = Array.isArray(user?.departamento_ids)
      ? user.departamento_ids.map((id) => Number(id))
      : user?.departamento_id != null
        ? [Number(user.departamento_id)]
        : [];
    const mesmaSetorOuSemRestricao =
      isPrivileged ||
      convDepId == null ||
      (userDepIds.length > 0 && userDepIds.includes(Number(convDepId)));
    return mesmaSetorOuSemRestricao;
  }, [conversa, user, isGroup]);

  const [assumeEmptyBusy, setAssumeEmptyBusy] = useState(false);

  const handleAssumeEmpty = useCallback(async () => {
    if (!conversaId || assumeEmptyBusy) return;
    setAssumeEmptyBusy(true);
    try {
      await assumirConversa(conversaId);
      await refresh({ silent: true });
      showToast({
        type: "success",
        title: "Conversa assumida",
        message: "Você já pode enviar mensagens.",
      });
    } catch (e) {
      showToast({
        type: "error",
        title: "Erro ao assumir",
        message: e?.response?.data?.error || e?.message || "Tente novamente.",
      });
    } finally {
      setAssumeEmptyBusy(false);
    }
  }, [conversaId, assumeEmptyBusy, assumirConversa, refresh, showToast]);

  const headerSubtitle = useMemo(() => {
    const tel = normalizeTelefone(telefone);
    if (tel.length >= 10) return `+${tel}`;
    if (safeString(telefone)) return safeString(telefone);
    return "Online";
  }, [telefone]);

  const setorAtual =
    conversa?.departamento_id != null
      ? (conversa?.setor ?? conversa?.departamento?.nome ?? conversa?.departamentos?.nome ?? null)
      : null;

  const carregarDepartamentos = useCallback(async () => {
    try {
      const { data } = await api.get("/dashboard/departamentos");
      setDepartamentos(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("Erro ao carregar departamentos:", e);
      setDepartamentos([]);
    }
  }, []);

  const handleOpenTransferirSetor = useCallback(() => {
    setShowTransferirSetor(true);
    carregarDepartamentos();
  }, [carregarDepartamentos]);

  const carregarRespostasSalvas = useCallback(async () => {
    try {
      setRespostasSalvasLoading(true);
      const depId = conversa?.departamento_id || null;
      const list = await cfg.getRespostasSalvas(depId);
      setRespostasSalvas(Array.isArray(list) ? list : []);
    } catch (e) {
      console.error("Erro ao carregar respostas salvas:", e);
      setRespostasSalvas([]);
    } finally {
      setRespostasSalvasLoading(false);
    }
  }, [conversa?.departamento_id]);

  const handleOpenRespostasSalvas = useCallback(() => {
    setShowRespostasSalvas(true);
    carregarRespostasSalvas();
  }, [carregarRespostasSalvas]);

  const handleInserirResposta = useCallback(
    (texto) => {
      if (!texto) return;
      setTexto((prev) => (prev ? prev + "\n" + texto : texto));
      setShowRespostasSalvas(false);
      focusMessageInput();
    },
    [focusMessageInput]
  );

  const handleTransferirSetor = useCallback(
    async (departamentoId) => {
      if (!conversaId || !departamentoId || transferirSetorLoading) return;
      setTransferirSetorLoading(true);
      try {
        await api.put(`/chats/${conversaId}/departamento`, {
          departamento_id: Number(departamentoId),
        });
        await refresh({ silent: true });
        setShowTransferirSetor(false);
      } catch (e) {
        console.error("Erro ao transferir setor:", e);
        showToast({
          type: "error",
          title: "Falha ao transferir setor",
          message: e?.response?.data?.error || "Tente novamente.",
        });
      } finally {
        setTransferirSetorLoading(false);
      }
    },
    [conversaId, refresh, showToast, transferirSetorLoading]
  );

  const handleRemoverSetor = useCallback(
    async () => {
      if (!conversaId || transferirSetorLoading) return;
      setTransferirSetorLoading(true);
      try {
        await api.put(`/chats/${conversaId}/departamento`, { remover_setor: true });
        await refresh({ silent: true });
        setShowTransferirSetor(false);
        showToast({ type: "success", title: "Setor removido", message: "A conversa não possui mais setor vinculado." });
      } catch (e) {
        console.error("Erro ao remover setor:", e);
        showToast({
          type: "error",
          title: "Falha ao remover setor",
          message: e?.response?.data?.error || "Tente novamente.",
        });
      } finally {
        setTransferirSetorLoading(false);
      }
    },
    [conversaId, refresh, showToast, transferirSetorLoading]
  );

  const carregarTags = useCallback(
    async (opts = {}) => {
      const showError = opts.showErrorToUser !== false;
      try {
        setTagsLoading(true);
        const data = await listarTags();
        setAllTags(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("Erro ao listar tags:", err);
        if (showError) {
          showToast({
            type: "error",
            title: "Falha ao carregar tags",
            message: "Não foi possível carregar as tags disponíveis.",
          });
        }
      } finally {
        setTagsLoading(false);
      }
    },
    [showToast]
  );

  const handleToggleTagPanel = useCallback(() => {
    setTagsOpen((prev) => {
      const next = !prev;
      if (next) {
        // ao abrir o painel, carrega tags e mostra toast só se falhar (usuário está vendo o painel)
        carregarTags({ showErrorToUser: true });
      }
      return next;
    });
  }, [carregarTags]);

  const handleToggleTag = useCallback(
    async (tag) => {
      if (!conversaId || !tag?.id) return;
      const alreadySelected = selectedTagIds.includes(tag.id);
      try {
        setTagMutatingId(tag.id);
        if (alreadySelected) {
          await removerTagConversa(conversaId, tag.id);
        } else {
          await adicionarTagConversa(conversaId, tag.id);
        }
        await refresh({ silent: true });
      } catch (err) {
        console.error("Erro ao atualizar tag da conversa:", err);
        showToast({
          type: "error",
          title: "Falha ao atualizar tag",
          message: "Não foi possível atualizar as tags desta conversa.",
        });
      } finally {
        setTagMutatingId(null);
      }
    },
    [conversaId, selectedTagIds, refresh, showToast]
  );

  // Tags: só carregamos ao abrir o painel (evita toast "falha ao carregar" em background)
  // handleToggleTagPanel já chama carregarTags() ao abrir quando allTags está vazio

  if (loading) {
    return (
      <div className="wa-empty">
        <div className="wa-empty-card wa-empty-card-loading">
          <div className="wa-empty-title">Carregando conversa…</div>
          <div className="wa-empty-skel">
            <SkeletonLine width="70%" />
            <SkeletonLine width="92%" />
            <SkeletonLine width="84%" />
            <SkeletonLine width="60%" />
          </div>
        </div>
      </div>
    );
  }

  // Selecionou uma conversa mas ainda carregando
  if (selectedId && !conversa && loading) {
    return (
      <div className="wa-empty">
        <div className="wa-empty-card wa-empty-card-loading">
          <div className="wa-empty-title">Carregando conversa…</div>
        </div>
      </div>
    );
  }

  // Erro ao carregar ou conversa não encontrada — permite tentar de novo
  if (selectedId && !conversa && !loading) {
    return (
      <div className="wa-empty">
        <div className="wa-empty-card">
          <div className="wa-empty-title">Não foi possível abrir a conversa</div>
          <div className="wa-empty-sub">
            {loadError || "Selecione outra na lista ou tente novamente."}
          </div>
          <button type="button" className="wa-btn wa-btn-primary" style={{ marginTop: 12 }} onClick={() => carregarConversa(selectedId)}>
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  // Nenhuma conversa selecionada
  if (!conversa) {
    return (
      <div className="wa-empty">
        <EmptyState
          title="Selecione uma conversa"
          description="Abra uma conversa na lista à esquerda para visualizar e responder às mensagens."
        />
      </div>
    );
  }

  const filteredRecentStickers = recentStickers.filter((item) => {
    if (!safeString(stickerQuery)) return true;
    return safeString(item?.name).toLowerCase().includes(safeString(stickerQuery).toLowerCase());
  });
  const hasDraft = Boolean(safeString(texto));

  return (
    <div ref={waShellRef} className="wa-shell" onDragEnter={onDragEnter}>
        <ChatToast toast={toast} onClose={() => setToast(null)} />

        {dragOver ? (
          <div
            className="wa-dropOverlay"
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            role="presentation"
          >
            <div className="wa-dropCard">
              <div className="wa-dropTitle">Solte para anexar</div>
              <div className="wa-dropSub">Envie imagens e arquivos diretamente na conversa.</div>
            </div>
          </div>
        ) : null}

        {/* HEADER — nome + meta (status/setor) + ações; mobile: toolbar compacta */}
        <div
          ref={waHeaderRef}
          className={`wa-header ${isGroup ? "wa-header--group" : ""} ${headerCompact && !isGroup ? "wa-header--atendMobile" : ""} ${headerCompact && !isGroup && headerCrmAtivoLayout ? "wa-header--crmAtivo" : ""}`}
        >
          <button
            type="button"
            className="wa-header-back"
            onClick={() => {
              if (
                headerCompact &&
                typeof window !== "undefined" &&
                window.history.state?.[WA_ATENDIMENTO_CHAT_HISTORY_KEY]
              ) {
                window.history.back();
                return;
              }
              setSelectedId(null);
            }}
            aria-label="Voltar para lista de conversas"
            title="Voltar"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
          </button>
          <div className="wa-header-left">
            <div className="wa-avatarWrap">
              <button
                type="button"
                className="wa-avatarButton"
                onClick={onHeaderAvatarClick}
                disabled={!showAvatarImg}
                title={showAvatarImg ? "Ver foto ampliada" : undefined}
                aria-label={showAvatarImg ? `Ver foto ampliada de ${safeString(nome) || "contato"}` : undefined}
              >
                <div className="wa-avatar" aria-hidden="true">
                  {showAvatarImg ? (
                    <img
                      src={avatarUrl}
                      alt=""
                      className="wa-avatar-img"
                      referrerPolicy="no-referrer"
                      onError={() => setAvatarImgError(true)}
                    />
                  ) : (
                    avatar
                  )}
                </div>
              </button>
            </div>
            <div className="wa-header-info">
              <div className="wa-header-titleBlock">
                <div className="wa-header-titleRow">
                  <span className="wa-header-name" title={nome}>
                    {nome}
                  </span>
                </div>
                <div className="wa-header-metaBlock">
                  <div className="wa-header-metaStrip" aria-label="Status da conversa">
                    {badge ? (
                      <span
                        className="wa-status-pill wa-status-pill--meta"
                        style={{
                          background: badge.bg,
                          borderColor: badge.border,
                          color: badge.color,
                        }}
                        title={encerramentoAusenciaHint || badge.text}
                      >
                        {badge.text}
                      </span>
                    ) : null}
                    {!headerSetorBelowStatus &&
                      !isGroup &&
                      (setorAtual ? (
                        <>
                          {badge ? <span className="wa-header-metaSep" aria-hidden="true" /> : null}
                          <span className="wa-header-metaItem" title={setorAtual}>
                            Setor: {setorAtual}
                          </span>
                          {podeTransferirSetor ? (
                            <button
                              type="button"
                              className="wa-header-setorBtn"
                              onClick={handleOpenTransferirSetor}
                              title="Transferir para outro setor"
                            >
                              <span className="wa-setorBtn-label wa-setorBtn-label--full">Transferir setor</span>
                              <span className="wa-setorBtn-label wa-setorBtn-label--short">Trocar</span>
                            </button>
                          ) : null}
                        </>
                      ) : (
                        <>
                          {badge ? <span className="wa-header-metaSep" aria-hidden="true" /> : null}
                          <span className="wa-header-metaItem wa-muted">Sem setor</span>
                          {podeTransferirSetor ? (
                            <button
                              type="button"
                              className="wa-header-setorBtn"
                              onClick={handleOpenTransferirSetor}
                              title="Definir setor"
                            >
                              <span className="wa-setorBtn-label wa-setorBtn-label--full">Definir setor</span>
                              <span className="wa-setorBtn-label wa-setorBtn-label--short">Setor</span>
                            </button>
                          ) : null}
                        </>
                      ))}
                    {isGroup ? (
                      <>
                        {badge ? <span className="wa-header-metaSep" aria-hidden="true" /> : null}
                        <span className="wa-header-metaItem wa-muted">Grupo</span>
                      </>
                    ) : null}
                  </div>
                  {headerSetorBelowStatus && !isGroup ? (
                    <div className="wa-header-setorRow" aria-label="Setor da conversa">
                      {setorAtual ? (
                        <>
                          <span className="wa-header-metaItem" title={setorAtual}>
                            Setor: {setorAtual}
                          </span>
                          {podeTransferirSetor ? (
                            <button
                              type="button"
                              className="wa-header-setorBtn"
                              onClick={handleOpenTransferirSetor}
                              title="Transferir para outro setor"
                            >
                              <span className="wa-setorBtn-label wa-setorBtn-label--full">Transferir setor</span>
                              <span className="wa-setorBtn-label wa-setorBtn-label--short">Trocar</span>
                            </button>
                          ) : null}
                        </>
                      ) : (
                        <>
                          <span className="wa-header-metaItem wa-muted">Sem setor</span>
                          {podeTransferirSetor ? (
                            <button
                              type="button"
                              className="wa-header-setorBtn"
                              onClick={handleOpenTransferirSetor}
                              title="Definir setor"
                            >
                              <span className="wa-setorBtn-label wa-setorBtn-label--full">Definir setor</span>
                              <span className="wa-setorBtn-label wa-setorBtn-label--short">Setor</span>
                            </button>
                          ) : null}
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
              {isSomeoneTyping ? (
                <div className="wa-header-typingRow">
                  <span className="wa-typing-dots">
                    digitando
                    <span className="wa-typing-dots-inner">
                      <span className="wa-typing-dot">.</span>
                      <span className="wa-typing-dot">.</span>
                      <span className="wa-typing-dot">.</span>
                    </span>
                  </span>
                </div>
              ) : null}
            </div>
          </div>

          <div className="wa-header-right">
            <div className="wa-header-innerRow">
              <div className="wa-header-iconsLine">
                {!headerCompact && !isGroup && podeGerenciarTags ? (
                  <button
                    type="button"
                    className={`wa-header-btn wa-tagsBtn ${tagsOpen ? "isActive" : ""}`}
                    onClick={handleToggleTagPanel}
                    disabled={!conversaId}
                    title="Tags do cliente"
                    aria-label="Tags do cliente"
                  >
                    <IconTag />
                  </button>
                ) : null}

                {(!headerCompact || isGroup) ? (
                  <button
                    onClick={toggleTimeline}
                    title="Histórico de atendimentos (Ctrl/Cmd + H)"
                    className={`wa-header-btn wa-header-historyBtn ${showTimeline ? "isActive" : ""}`}
                    type="button"
                    aria-label="Histórico"
                  >
                    <IconClock />
                  </button>
                ) : null}

                {!isGroup && conversaId && mostrarEnviarCrm ? (
                  <SendToCrmChatButton
                    ref={sendCrmRef}
                    conversaId={conversaId}
                    hideToolbarButton={headerCompact}
                    isGroup={isGroup}
                    crmEnabled={mostrarEnviarCrm}
                  />
                ) : null}
                {!headerCompact && !isGroup && conversaId && canConsultarProdutos ? (
                  <button
                    type="button"
                    className={`wa-header-btn wa-productsQuickBtn ${showProdutosPanel ? "isActive" : ""}`}
                    onClick={() => setShowProdutosPanel(true)}
                    title="Consultar produtos"
                    aria-label="Consultar produtos"
                  >
                    <span aria-hidden="true">📦</span>
                  </button>
                ) : null}
              </div>

              {!isGroup ? (
                <div className="wa-header-actionsRow">
                  <div className="wa-actions">
                    <AtendimentoActions
                      compactToolbar={headerCompact}
                      overflowTop={
                        headerCompact
                          ? (close) => (
                              <>
                                <button
                                  type="button"
                                  className="wa-atendToolbar-sheetBtn"
                                  onClick={() => {
                                    toggleTimeline();
                                    close();
                                  }}
                                >
                                  <span className="wa-atendToolbar-sheetIcon" aria-hidden="true">
                                    <IconClock />
                                  </span>
                                  <span className="wa-atendToolbar-sheetLabel">Histórico de atendimentos</span>
                                </button>
                                {podeGerenciarTags ? (
                                  <button
                                    type="button"
                                    className="wa-atendToolbar-sheetBtn"
                                    onClick={() => {
                                      handleToggleTagPanel();
                                      close();
                                    }}
                                    disabled={!conversaId}
                                  >
                                    <span className="wa-atendToolbar-sheetIcon" aria-hidden="true">
                                      <IconTag />
                                    </span>
                                    <span className="wa-atendToolbar-sheetLabel">Tags do cliente</span>
                                  </button>
                                ) : null}
                                {!isGroup && conversaId && mostrarEnviarCrm ? (
                                  <button
                                    type="button"
                                    className="wa-atendToolbar-sheetBtn"
                                    onClick={() => {
                                      try {
                                        sendCrmRef.current?.open?.();
                                      } catch (_) {}
                                      close();
                                    }}
                                  >
                                    <span className="wa-atendToolbar-sheetIcon" aria-hidden="true">
                                      <IconFunnelSend />
                                    </span>
                                    <span className="wa-atendToolbar-sheetLabel">Enviar ao CRM</span>
                                  </button>
                                ) : null}
                                {!isGroup && conversaId && canConsultarProdutos ? (
                                  <button
                                    type="button"
                                    className="wa-atendToolbar-sheetBtn"
                                    onClick={() => {
                                      setShowProdutosPanel(true);
                                      close();
                                    }}
                                  >
                                    <span className="wa-atendToolbar-sheetIcon" aria-hidden="true">
                                      📦
                                    </span>
                                    <span className="wa-atendToolbar-sheetLabel">Consultar produtos</span>
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  className="wa-atendToolbar-sheetBtn"
                                  onClick={() => {
                                    setShowClienteSide(true);
                                    close();
                                  }}
                                >
                                  <span className="wa-atendToolbar-sheetIcon" aria-hidden="true">
                                    <IconContact />
                                  </span>
                                  <span className="wa-atendToolbar-sheetLabel">Dados do contato</span>
                                </button>
                              </>
                            )
                          : undefined
                      }
                    />
                  </div>
                </div>
              ) : null}

              {headerCompact && !isGroup ? null : (
                <button
                  title="Mais opções"
                  className="wa-header-btn wa-header-moreBtn"
                  type="button"
                  onClick={() => setShowClienteSide(true)}
                  aria-label="Dados do contato e mais opções"
                >
                  <IconMore />
                </button>
              )}
            </div>
          </div>
        </div>

        {!isGroup && podeTransferirSetor && showTransferirSetor && (
          <>
            <button
              type="button"
              className="wa-floatingSheet-backdrop"
              aria-label="Fechar painel de setor"
              onClick={() => setShowTransferirSetor(false)}
            />
          <div
            className="wa-tagsPanel wa-tagsPanel--setor"
            role="dialog"
            aria-label="Transferir setor"
          >
            <div className="wa-tagsPanel-head">
              <span className="wa-tagsPanel-title">Transferir setor</span>
              <button
                type="button"
                className="wa-iconBtn"
                onClick={() => setShowTransferirSetor(false)}
                title="Fechar"
              >
                <IconClose />
              </button>
            </div>
            <div className="wa-tagsPanel-body">
              {departamentos.length === 0 ? (
                <div className="wa-muted">Carregando setores...</div>
              ) : (
                <div className="wa-tagsList">
                  {departamentos.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      className="wa-tagItem"
                      onClick={() => handleTransferirSetor(d.id)}
                      disabled={transferirSetorLoading || Number(d.id) === Number(conversa?.departamento_id)}
                    >
                      {d.nome}
                      {Number(d.id) === Number(conversa?.departamento_id) ? " (atual)" : ""}
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                className="wa-tagItem wa-tagItem--remover"
                onClick={handleRemoverSetor}
                disabled={transferirSetorLoading || !conversa?.departamento_id}
                title={conversa?.departamento_id ? "Remover setor da conversa" : "Conversa já está sem setor"}
              >
                Sem setor
              </button>
              {transferirSetorLoading && (
                <div className="wa-muted" style={{ marginTop: 8 }}>Salvando...</div>
              )}
            </div>
          </div>
          </>
        )}

        {!isGroup && podeGerenciarTags && tagsOpen && (
          <>
            <button
              type="button"
              className="wa-floatingSheet-backdrop"
              aria-label="Fechar painel de tags"
              onClick={() => handleToggleTagPanel()}
            />
          <div className="wa-tagsPanel wa-tagsPanel--tags" role="dialog" aria-label="Tags da conversa">
            <div className="wa-tagsPanel-head">
              <span className="wa-tagsPanel-title">Tags do cliente</span>
              <button
                type="button"
                className="wa-iconBtn"
                onClick={handleToggleTagPanel}
                title="Fechar"
              >
                <IconClose />
              </button>
            </div>
            <div className="wa-tagsPanel-body">
              {tagsLoading && allTags.length === 0 ? (
                <div className="wa-muted">Carregando tags...</div>
              ) : allTags.length === 0 ? (
                <div className="wa-muted">Nenhuma tag cadastrada.</div>
              ) : (
                <div className="wa-tagsList">
                  {allTags.map((tag) => {
                    const selected = selectedTagIds.includes(tag.id);
                    const busy = tagMutatingId === tag.id;
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        className={`wa-tagChip ${selected ? "isSelected" : ""}`}
                        onClick={() => handleToggleTag(tag)}
                        disabled={busy}
                      >
                        <span className="wa-tagChip-label">{tag.nome}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          </>
        )}

        <SidebarCliente
          open={!!showClienteSide}
          onClose={() => setShowClienteSide(false)}
          conversa={conversa}
          isGroup={isGroup}
          tags={tags}
          tempoSemResponder={tempoSemResponder}
          onObservacaoSaved={refresh}
        />

        {/* TIMELINE */}
        {showTimeline ? (
          <div className="wa-timeline" role="region" aria-label="Historico do atendimento">
            <div className="wa-timeline-head">
              <div className="wa-timeline-headLeft">
                <span className="wa-timeline-title">Histórico</span>
                <span className="wa-timeline-sub">Eventos, transferências e notas desta conversa (Esc para fechar)</span>
              </div>

              <button onClick={handleCloseTimeline} className="wa-iconBtn" title="Fechar (Esc)" type="button">
                <IconClose />
              </button>
            </div>

            <div className="wa-timeline-body">
              {atendimentosLoading ? (
                <div className="wa-muted">Carregando...</div>
              ) : (atendimentos || []).length === 0 ? (
                <div className="wa-muted">Sem histórico ainda.</div>
              ) : (
                <div className="wa-timeline-list">
                  {(atendimentos || []).map((a) => (
                    <div key={a.id || `${a.acao}-${a.criado_em}`} className="wa-timeline-card">
                      <div className="wa-timeline-row">
                        <span className="wa-timeline-time">{formatHoraCurta(a.criado_em)}</span>
                        <span className="wa-timeline-label">{timelineEventLabel(a, conversa)}</span>
                      </div>
                      {a.observacao ? (
                        <div className="wa-timeline-nota">Nota interna: {a.observacao}</div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {/* MENSAGENS */}
        <div
          ref={messagesContainerRef}
          className={`wa-messages${selectMode ? " wa-messages--selectDim" : ""}`}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onDragLeave={onDragLeave}
          role="log"
          aria-label="Mensagens"
        >
          {selectMode ? <div className="wa-messages-selectDim" aria-hidden /> : null}
          {selectMode ? (
            <div
              className={`wa-selectBar${forwardSelectIntent ? " wa-selectBar--forwardIntent" : ""}${
                compactMessageUx ? " wa-selectBar--compactUx" : ""
              }`}
              role="region"
              aria-label="Modo seleção"
            >
              <div className="wa-selectBar-left">
                <button
                  type="button"
                  className="wa-selectBar-close"
                  onClick={dismissSelectionOverlay}
                  title="Fechar"
                  aria-label="Fechar seleção"
                >
                  <IconClose />
                </button>
                {!compactMessageUx ? (
                  <button type="button" className="wa-btn wa-btn-ghost" onClick={dismissSelectionOverlay}>
                    Cancelar
                  </button>
                ) : null}
                <span className="wa-selectBar-count">{selectedSet.size} selecionada(s)</span>
              </div>
              <div className="wa-selectBar-actions">
                {forwardSelectIntent ? (
                  <button
                    type="button"
                    className={`wa-btn wa-btn-primary${compactMessageUx ? " wa-selectBar-forwardFab" : ""}`}
                    onClick={handleForwardAdvance}
                    disabled={selectedSet.size === 0 || forwardSending}
                    aria-label="Encaminhar mensagens selecionadas"
                  >
                    <IconForward />
                    {!compactMessageUx ? <span className="wa-selectBar-forwardText"> Encaminhar…</span> : null}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="wa-btn wa-btn-danger"
                  onClick={handleDeleteSelected}
                  disabled={selectedSet.size === 0}
                >
                  Apagar
                </button>
              </div>
            </div>
          ) : pinnedTop ? (
            <div className="wa-pinBar" role="button" tabIndex={0} onClick={() => scrollToMsg(pinnedTop.id)}>
              <span className="wa-pinBar-ic" aria-hidden="true">📌</span>
              <span className="wa-pinBar-text">Fixada: {snippetFromMsg(pinnedTop)}</span>
              <span className="wa-pinBar-hint">Ver</span>
            </div>
          ) : null}

          {conversa?.mensagens_bloqueadas ? (
            <div className="wa-messages-empty">
              <div className="wa-messages-emptyCard wa-messages-emptyCard--blocked">
                <span className="wa-messages-blocked-icon" aria-hidden="true">🔒</span>
                <strong>Este atendimento foi assumido por {conversa?.atendente_nome?.trim() ? conversa.atendente_nome : "outro usuário"}.</strong>
              </div>
            </div>
          ) : mensagensComSeparadores.length === 0 ? (
            <div className="wa-messages-empty">
              <div className="wa-messages-emptyCard">
                <p className="wa-messages-emptyText">Sem mensagens ainda.</p>
                {showAssumeEmptyCta ? (
                  <button
                    type="button"
                    className="wa-btn wa-btn-primary wa-btn-assumir-destaque"
                    onClick={handleAssumeEmpty}
                    disabled={assumeEmptyBusy}
                  >
                    {assumeEmptyBusy ? "Assumindo…" : "Assumir"}
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              {!conversa?.mensagens_bloqueadas && Array.isArray(mensagens) && mensagens.length > 0 && !loading ? (
                <div className="wa-loadOlderHistory">
                  {hasMore && cursor ? (
                    <button
                      type="button"
                      className="wa-loadOlderBtn"
                      onClick={handleLoadOlderMessagesClick}
                      disabled={loadingMore}
                      aria-busy={loadingMore}
                      title="Carrega o lote anterior de mensagens. Também pode rolar até ao topo da conversa."
                      aria-label={
                        loadingMore ? "Carregando mensagens antigas" : "Carregar mensagens antigas"
                      }
                    >
                      Carregar mensagens antigas
                    </button>
                  ) : !hasMore ? (
                    <p className="wa-loadOlderEnd" role="status">
                      Todas as mensagens foram carregadas
                    </p>
                  ) : null}
                </div>
              ) : null}
              {loadingMore ? (
                <div className="wa-historyLoading" role="status" aria-live="polite" aria-label="Carregando histórico">
                  <span className="wa-historyLoading-bar" />
                </div>
              ) : null}
            <ConversaMessageVirtualList
              key={`wa-thread-${String(scrollThreadId ?? conversaId ?? "")}`}
              ref={virtualThreadRef}
              scrollRef={messagesContainerRef}
              overscan={headerCompact ? 5 : 15}
              conversaId={scrollThreadId ?? conversaId}
              items={mensagensComSeparadores}
              onVirtualContentResize={snapIfStickBottom}
              renderItem={(item) => {
                if (item.__type === "day") return <DaySeparator key={item.id} label={item.label} />;
                const msgKey = getMessageListReactKey(item, conversaId);
                let zapAnimateIn = false;
                if (!zapMsgsInitialPassRef.current && !zapSeenMsgKeysRef.current.has(msgKey)) {
                  zapAnimateIn = true;
                }
                zapSeenMsgKeysRef.current.add(msgKey);
                return (
                  <Bubble
                    key={msgKey}
                    msg={item}
                    zapAnimateIn={zapAnimateIn}
                    showRemetente={Boolean(item.__showRemetente)}
                    isGroup={isGroup}
                    peerAvatarUrl={avatarUrl}
                    peerName={nome}
                    selectMode={selectMode}
                    selected={selectedSet.has(String(msgKey))}
                    onToggleSelected={toggleSelected}
                    onInfo={handleInfoAction}
                    onReply={handleReplyAction}
                    onCopy={handleCopyResult}
                    onForward={handleForwardAction}
                    onTogglePin={togglePin}
                    onToggleStar={toggleStar}
                    onStartSelect={startSelect}
                    onDeleteForMe={handleDeleteForMe}
                    onDeleteForEveryone={handleDeleteForEveryone}
                    isPinned={pinnedSet.has(String(msgKey))}
                    isStarred={starredSet.has(String(msgKey))}
                    currentUserId={myUserId}
                    onJumpToReply={jumpToReply}
                    onOpenMedia={openMediaViewer}
                    localReaction={localReactions[String(msgKey)] || item.__reaction}
                    onReact={handleSendReaction}
                    onRemoveReaction={handleRemoveReaction}
                    reactionBusy={Boolean(reactionLoading[String(msgKey)])}
                    onConversarContact={handleConversarContact}
                    onAdicionarGrupoContact={handleAdicionarGrupoContact}
                    mostrarNomeAoCliente={user?.mostrar_nome_ao_cliente !== false}
                    swipeReplyEnabled={headerCompact && !selectMode}
                    captionBundleTop={Boolean(item.__captionBundleTop)}
                    captionBundleFollow={Boolean(item.__captionBundleFollow)}
                    mobileMessageChrome={compactMessageUx}
                    menuUsesBottomSheet={compactMessageUx}
                  />
                );
              }}
            />
            </>
          )}

          <div ref={bottomRef} />
        </div>

        {/* PREVIEW antes de enviar — overlay full-screen (mídia ou arquivo) + legenda opcional */}
        {pendingFile ? (
          <div
            ref={mediaPreviewRootRef}
            className={`wa-mediaPreview${isImageFile(pendingFile) || isVideoFile(pendingFile) ? "" : " wa-mediaPreview--file"}`}
            role="dialog"
            aria-modal="true"
            aria-label={
              isVideoFile(pendingFile)
                ? "Pré-visualizar vídeo antes de enviar"
                : isImageFile(pendingFile)
                  ? "Pré-visualizar imagem antes de enviar"
                  : isAudioFile(pendingFile)
                    ? "Revisar áudio antes de enviar"
                    : "Revisar arquivo antes de enviar"
            }
            onKeyDown={(e) => {
              if (e.key === "Escape" && !sending) {
                e.stopPropagation();
                clearPending();
              }
            }}
          >
            <div className="wa-mediaPreview-head">
              <button
                type="button"
                className="wa-mediaPreview-close"
                onClick={clearPending}
                disabled={sending}
                aria-label="Cancelar envio"
                title="Cancelar"
              >
                <IconClose />
              </button>
              <span className="wa-mediaPreview-title">
                {isVideoFile(pendingFile)
                  ? "Enviar vídeo"
                  : isImageFile(pendingFile)
                    ? "Enviar foto"
                    : isAudioFile(pendingFile)
                      ? "Enviar áudio"
                      : "Enviar arquivo"}
              </span>
              <span className="wa-mediaPreview-spacer" aria-hidden="true" />
            </div>

            <div className="wa-mediaPreview-stage">
              {isVideoFile(pendingFile) ? (
                <video
                  src={pendingPreview}
                  className="wa-mediaPreview-media"
                  controls
                  playsInline
                  preload="metadata"
                />
              ) : isImageFile(pendingFile) ? (
                <img
                  src={pendingPreview}
                  alt="Pré-visualização da imagem a enviar"
                  className="wa-mediaPreview-media"
                />
              ) : (
                <div className="wa-fileSendPreview-card">
                  <div className="wa-fileSendPreview-icon" aria-hidden="true">
                    {isAudioFile(pendingFile) ? "🎧" : "📎"}
                  </div>
                  <div className="wa-fileSendPreview-meta">
                    <div className="wa-fileSendPreview-name">{pendingFile.name}</div>
                    <div className="wa-fileSendPreview-sub">
                      {isAudioFile(pendingFile) ? "Áudio pronto para envio" : "Arquivo pronto para envio"}
                      <span className="wa-dotSep">•</span>
                      {(pendingFile.size / 1024 / 1024).toFixed(2)} MB
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="wa-mediaPreview-composer">
              <div className="wa-mediaPreview-inputWrap">
                <textarea
                  ref={pendingCaptionRef}
                  value={pendingCaption}
                  onChange={(e) => setPendingCaption(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (!sending) handleConfirmSendFile();
                    }
                  }}
                  placeholder="Adicionar legenda (opcional)…"
                  rows={1}
                  className="wa-mediaPreview-input"
                  disabled={sending}
                  aria-label="Legenda ou comentário junto ao envio"
                  enterKeyHint="send"
                  maxLength={1024}
                />
              </div>
              <button
                type="button"
                onClick={handleConfirmSendFile}
                disabled={sending}
                className="wa-mediaPreview-sendBtn"
                title="Enviar"
                aria-label="Confirmar envio"
              >
                {sending ? <span className="wa-spinner" aria-hidden="true" /> : <IconSend />}
              </button>
            </div>
          </div>
        ) : null}

        {showRespostasSalvas && (
          <div
            className="wa-tagsPanel"
            role="dialog"
            aria-label="Respostas salvas"
            style={{ bottom: "100%", left: 0, right: 0, maxHeight: 220 }}
          >
            <div className="wa-tagsPanel-head">
              <span className="wa-tagsPanel-title">Respostas rápidas</span>
              <button
                type="button"
                className="wa-iconBtn"
                onClick={() => setShowRespostasSalvas(false)}
                title="Fechar"
              >
                <IconClose />
              </button>
            </div>
            <div className="wa-tagsPanel-body" style={{ maxHeight: 160, overflowY: "auto" }}>
              {respostasSalvasLoading ? (
                <div className="wa-muted">Carregando...</div>
              ) : respostasSalvas.length === 0 ? (
                <div className="wa-muted">Nenhuma resposta salva. Configure em Configurações &gt; Respostas salvas.</div>
              ) : (
                <div className="wa-tagsList">
                  {respostasSalvas.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className="wa-tagItem"
                      onClick={() => handleInserirResposta(r.texto)}
                      title={r.titulo}
                    >
                      <strong>{r.titulo}</strong>
                      <span className="wa-muted" style={{ fontSize: 12, marginTop: 2, display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {String(r.texto || "").slice(0, 60)}
                        {(r.texto || "").length > 60 ? "…" : ""}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {forwardOpen && forwardMsgs?.length ? createPortal(
          <div
            className="wa-modalOverlay wa-forwardOverlay"
            role="dialog"
            aria-label="Encaminhar mensagens"
            onMouseDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (!forwardSending) closeForward();
            }}
          >
            <div className="wa-modal wa-forwardModal" onMouseDown={(e) => e.stopPropagation()}>
              <div className="wa-forwardSheetHandle" aria-hidden="true" />
              <div className="wa-modal-head">
                <div className="wa-forwardHeadLeft">
                  <div className="wa-modal-title">{forwardMsgs.length > 1 ? `Encaminhar (${forwardMsgs.length})` : "Encaminhar"}</div>
                  <div className="wa-forwardHeadCounter" aria-live="polite">
                    {forwardSelectedConversaIds.length} selecionada(s) · até {FORWARD_DEST_MAX} destinos
                  </div>
                </div>
                <button
                  type="button"
                  className="wa-iconBtn"
                  onClick={closeForward}
                  title="Fechar"
                  disabled={forwardSending}
                >
                  <IconClose />
                </button>
              </div>
              <div className="wa-modal-body wa-forwardBody">
                <div className="wa-forwardHint">
                  <div className="wa-forwardPreview" title={forwardPreviewLabel}>
                    {forwardPreviewLabel}
                  </div>
                  <ol className="wa-forwardSteps">
                    <li>Marque uma ou mais conversas e toque em <strong>Encaminhar selecionados</strong> no rodapé.</li>
                    <li>Para <strong>um destino só</strong>, use <strong>Apenas esta</strong> na linha da conversa.</li>
                    <li><strong>Chat interno</strong> (colaborador) ou <strong>cliente</strong> na busca: toque no cartão para encaminhar direto.</li>
                  </ol>
                </div>

                <input
                  className="wa-input wa-forwardSearch"
                  value={forwardQuery}
                  onChange={(e) => setForwardQuery(e.target.value)}
                  placeholder="Buscar por nome/telefone..."
                  aria-label="Buscar contato"
                  autoFocus
                />

                <div className="wa-forwardSection">
                  <div className="wa-forwardSectionTitle">Colaboradores</div>
                  {forwardColaboradoresLoading ? (
                    <div className="wa-muted" style={{ padding: "10px 4px" }}>
                      Carregando…
                    </div>
                  ) : forwardColaboradoresFiltered.length === 0 ? (
                    <div className="wa-muted" style={{ padding: "10px 4px" }}>
                      Nenhum colaborador disponível para encaminhar.
                    </div>
                  ) : (
                    <div className="wa-forwardList">
                      {forwardColaboradoresFiltered.map((colab) => {
                        const uid = colab?.id ?? colab?.user_id ?? colab?.usuario_id;
                        const nome = safeString(colab?.nome ?? colab?.name ?? colab?.full_name) || "Colaborador";
                        const email = safeString(colab?.email);
                        return (
                          <button
                            key={`colab-${uid != null ? String(uid) : nome}`}
                            type="button"
                            className="wa-forwardItem"
                            onClick={() => confirmForwardToColaborador(colab)}
                            title={`Encaminhar para ${nome} (chat interno)`}
                            disabled={forwardSending || uid == null}
                          >
                            <div className="wa-forwardItem-name">{nome}</div>
                            {email ? <div className="wa-forwardItem-sub">{email}</div> : null}
                            <div className="wa-forwardItem-atendente">Chat interno</div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="wa-forwardSection" style={{ marginTop: 14 }}>
                  <div className="wa-forwardSectionHead">
                    <div className="wa-forwardSectionTitle">Conversas</div>
                    <span className="wa-forwardSectionCap" aria-hidden="true">
                      máx. {FORWARD_DEST_MAX} destinos
                    </span>
                  </div>
                  {forwardMax10Msg ? (
                    <p className="wa-forwardMaxHint" role="status" aria-live="polite">
                      {forwardMax10Msg}
                    </p>
                  ) : null}
                  {forwardCandidates.length === 0 ? (
                    <div className="wa-muted" style={{ padding: "10px 4px" }}>
                      {forwardQuery.trim() ? "Nenhuma conversa encontrada." : "Carregando conversas…"}
                    </div>
                  ) : (
                    <div className="wa-forwardList">
                      {forwardCandidates.map((c) => {
                        const n = safeString(c?.contato_nome || c?.nome || c?.cliente?.nome || c?.telefone) || "Conversa";
                        const telLinha = safeString(c?.telefone_exibivel ?? c?.telefoneExibivel ?? c?.telefone);
                        const atNome = safeString(c?.atendente_nome ?? c?.atendenteNome).trim();
                        const atMail = safeString(c?.atendente_email ?? c?.atendenteEmail).trim();
                        const atendenteTitle = [atNome ? `Atendente: ${atNome}` : "", atMail].filter(Boolean).join(" · ");
                        const idStr = String(c.id);
                        const sel = forwardSelectedConversaIds.includes(idStr);
                        return (
                          <div
                            key={`conv-${c.id}`}
                            className={`wa-forwardItem wa-forwardItem--row ${sel ? "isSelected" : ""}`}
                          >
                            <div className="wa-forwardItem-rowMain">
                              <label className="wa-forwardItem-checkLabel">
                                <input
                                  type="checkbox"
                                  className="wa-forwardItem-check"
                                  checked={sel}
                                  onChange={() => toggleForwardConversaSelect(c.id)}
                                  disabled={forwardSending}
                                  aria-label={`Incluir conversa: ${n}`}
                                />
                              </label>
                              <button
                                type="button"
                                className="wa-forwardItem-main"
                                onClick={() => !forwardSending && toggleForwardConversaSelect(c.id)}
                                disabled={forwardSending}
                              >
                                <div className="wa-forwardItem-name">{n}</div>
                                {telLinha ? <div className="wa-forwardItem-sub">{telLinha}</div> : null}
                                {atNome ? (
                                  <div className="wa-forwardItem-atendente" title={atendenteTitle || undefined}>
                                    Atendente: {atNome}
                                  </div>
                                ) : (
                                  <div className="wa-forwardItem-atendente wa-forwardItem-atendente--empty">Sem atendente atribuído</div>
                                )}
                              </button>
                            </div>
                            <button
                              type="button"
                              className="wa-btn wa-btn-ghost wa-forwardItem-solo"
                              onClick={() => confirmForwardTo(c.id)}
                              disabled={forwardSending}
                              title="Encaminhar somente para esta conversa (um destino)"
                            >
                              Apenas esta
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="wa-forwardSection" style={{ marginTop: 14 }}>
                  <div className="wa-forwardSectionTitle">Clientes</div>
                  {forwardClientesLoading ? (
                    <div className="wa-muted" style={{ padding: "10px 4px" }}>Buscando…</div>
                  ) : forwardClientes.length === 0 ? (
                    <div className="wa-muted" style={{ padding: "10px 4px" }}>
                      {safeString(forwardQuery).trim().length >= 2 ? "Nenhum cliente encontrado." : "Digite pelo menos 2 caracteres para buscar."}
                    </div>
                  ) : (
                    <div className="wa-forwardList">
                      {forwardClientes.slice(0, 60).map((c) => {
                        const n = safeString(c?.nome || c?.telefone) || "Cliente";
                        return (
                          <button
                            key={`cli-${c.id}`}
                            type="button"
                            className="wa-forwardItem"
                            onClick={() => confirmForwardToCliente(c)}
                            title={`Encaminhar para ${n}`}
                            disabled={forwardSending}
                          >
                            <div className="wa-forwardItem-name">{n}</div>
                            {c?.telefone ? <div className="wa-forwardItem-sub">{String(c.telefone)}</div> : null}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              <div className="wa-forwardFooter">
                <button type="button" className="wa-btn wa-btn-ghost" onClick={closeForward} disabled={forwardSending}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="wa-btn wa-btn-primary"
                  onClick={confirmForwardToMany}
                  disabled={forwardSending || forwardSelectedConversaIds.length < 1}
                >
                  {forwardMultiProgress
                    ? `Enviando ${forwardMultiProgress.current}/${forwardMultiProgress.total}…`
                    : `Encaminhar selecionados${
                        forwardSelectedConversaIds.length ? ` (${forwardSelectedConversaIds.length})` : ""
                      }`}
                </button>
              </div>
            </div>
          </div>,
          document.body
        ) : null}

        {pixModalOpen &&
          createPortal(
            <div
              className="wa-modalOverlay"
              role="dialog"
              aria-label="Configurar Pix"
              onMouseDown={() => !pixConfigSaving && setPixModalOpen(false)}
            >
              <div className="wa-modal" onMouseDown={(e) => e.stopPropagation()}>
                <div className="wa-modal-head">
                  <div className="wa-modal-title">Configurar Pix</div>
                  <button
                    type="button"
                    className="wa-iconBtn"
                    onClick={() => setPixModalOpen(false)}
                    title="Fechar"
                    disabled={pixConfigSaving}
                  >
                    <IconClose />
                  </button>
                </div>
                <div className="wa-modal-body">
                  <div className="wa-field">
                    <label className="wa-label">Tipo da chave Pix</label>
                    <select
                      className="wa-input"
                      value={pixTipoChave}
                      onChange={(e) => setPixTipoChave(String(e.target.value || "").toLowerCase())}
                      disabled={pixConfigSaving || pixConfigLoading}
                    >
                      <option value="cpf">CPF</option>
                      <option value="cnpj">CNPJ</option>
                      <option value="email">E-mail</option>
                      <option value="telefone">Telefone</option>
                      <option value="aleatoria">Chave aleatória</option>
                    </select>
                  </div>
                  <div className="wa-field">
                    <label className="wa-label">Chave Pix</label>
                    <input
                      className="wa-input"
                      value={pixChave}
                      onChange={(e) => setPixChave(e.target.value)}
                      placeholder="Digite a chave Pix"
                      autoFocus
                      disabled={pixConfigSaving || pixConfigLoading}
                    />
                  </div>
                  <div className="wa-field">
                    <label className="wa-label">Nome do recebedor/empresa</label>
                    <input
                      className="wa-input"
                      value={pixNomeRecebedor}
                      onChange={(e) => setPixNomeRecebedor(e.target.value)}
                      placeholder="Nome exibido para pagamento"
                      disabled={pixConfigSaving || pixConfigLoading}
                    />
                  </div>
                  <div className="wa-field">
                    <label className="wa-label">Mensagem padrão (opcional)</label>
                    <textarea
                      className="wa-input"
                      rows={3}
                      value={pixMensagemPadrao}
                      onChange={(e) => setPixMensagemPadrao(e.target.value)}
                      placeholder="Ex: Valor referente ao pedido #123"
                      disabled={pixConfigSaving || pixConfigLoading}
                    />
                  </div>
                </div>
                <div className="wa-modal-footer">
                  <button
                    type="button"
                    className="wa-btn wa-btn-ghost"
                    onClick={() => setPixModalOpen(false)}
                    disabled={pixConfigSaving}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="wa-btn wa-btn-primary"
                    onClick={() => handleSalvarPixConfig()}
                    disabled={pixConfigSaving || pixConfigLoading}
                  >
                    {pixConfigSaving ? "Salvando..." : "Salvar Pix"}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )}

        {replyBarPreview && !isRecording ? (
          <div className="wa-replyBar" role="region" aria-label="Respondendo">
            <div className="wa-replyBar-bar" aria-hidden="true" />
            {replyBarPreview.thumb ? (
              <img
                src={replyBarPreview.thumb}
                alt=""
                className="wa-replyBar-thumb"
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
              />
            ) : null}
            <div className="wa-replyBar-left">
              <div className="wa-replyBar-title">{replyBarPreview.title}</div>
              <div className="wa-replyBar-text">{replyBarPreview.text}</div>
            </div>
            <button
              type="button"
              className="wa-iconBtn"
              onClick={() => setReplyTo(null)}
              title="Cancelar resposta"
              aria-label="Cancelar resposta"
              disabled={sending}
            >
              <IconClose />
            </button>
          </div>
        ) : null}

        {msgInfoOpen && msgInfo ? createPortal(
          <div className="wa-modalOverlay" role="dialog" aria-label="Dados da mensagem" onMouseDown={() => { setMsgInfoOpen(false); setMsgInfo(null); }}>
            <div className="wa-modal" onMouseDown={(e) => e.stopPropagation()}>
              <div className="wa-modal-head">
                <div className="wa-modal-title">Dados da mensagem</div>
                <button type="button" className="wa-iconBtn" onClick={() => { setMsgInfoOpen(false); setMsgInfo(null); }} title="Fechar">
                  <IconClose />
                </button>
              </div>

              <div className="wa-modal-body">
                <div className="wa-modal-row">
                  <span className="wa-modal-label">Conteúdo</span>
                  <span className="wa-modal-value">{snippetFromMsg(msgInfo)}</span>
                </div>
                <div className="wa-modal-row">
                  <span className="wa-modal-label">Horário</span>
                  <span className="wa-modal-value">{formatDia(msgInfo?.criado_em)} {formatHora(msgInfo?.criado_em)}</span>
                </div>
                <div className="wa-modal-row">
                  <span className="wa-modal-label">Status</span>
                  <span className="wa-modal-value">{safeString(msgInfo?.status_mensagem || msgInfo?.status) || "enviada"}</span>
                </div>
                {safeString(msgInfo?.whatsapp_id) ? (
                  <div className="wa-modal-row">
                    <span className="wa-modal-label">ID WhatsApp</span>
                    <span className="wa-modal-value wa-mono">{String(msgInfo.whatsapp_id)}</span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>,
          document.body
        ) : null}

        {mediaViewer ? createPortal(
          <div
            className="wa-modalOverlay wa-mediaViewerOverlay"
            role="dialog"
            aria-label="Visualizar mídia"
            onMouseDown={(e) => e.target === e.currentTarget && closeMediaViewer()}
          >
            <div className="wa-mediaViewer" onMouseDown={(e) => e.stopPropagation()}>
              <div className="wa-mediaViewer-actions">
                {mediaViewerSupportsPrint(mediaViewer.type, mediaViewer.fileName) ? (
                  <button
                    type="button"
                    className="wa-mediaViewer-print"
                    onClick={handleMediaViewerPrint}
                    disabled={mediaPrintLoading}
                    title="Imprimir"
                    aria-label="Imprimir"
                    aria-busy={mediaPrintLoading}
                  >
                    <IconPrint />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="wa-mediaViewer-close"
                  onClick={closeMediaViewer}
                  title="Fechar (Esc)"
                  aria-label="Fechar"
                >
                  <IconClose />
                </button>
              </div>
              {mediaViewer.type === "video" ? (
                <div className="wa-mediaViewer-videoWrap">
                  <video
                    ref={mediaViewerVideoRef}
                    src={mediaViewer.url}
                    controls
                    autoPlay
                    playsInline
                    className="wa-mediaViewer-video"
                  />
                  <p className="wa-mediaViewer-videoPrintHint" role="note">
                    A impressão usa o quadro exibido no momento. Navegadores costumam não imprimir o elemento de vídeo
                    diretamente; usamos a imagem do frame atual.
                  </p>
                </div>
              ) : mediaViewer.type === "arquivo" ? (
                (() => {
                  const fn = (mediaViewer.fileName || "").toLowerCase();
                  const isPdf = fn.endsWith(".pdf");
                  const isImg = /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(fn);
                  if (isImg) {
                    return (
                      <img
                        ref={mediaViewerImgRef}
                        src={mediaViewer.url}
                        alt={mediaViewer.fileName || "Arquivo"}
                        className="wa-mediaViewer-img"
                      />
                    );
                  }
                  if (isPdf) {
                    const absUrl = getMediaUrl(mediaViewer.url, false);
                    if (mediaPdfLoading) {
                      return (
                        <div
                          className="wa-mediaViewer-iframe wa-mediaViewer-pdfState"
                          role="status"
                          aria-busy="true"
                        >
                          Carregando documento…
                        </div>
                      );
                    }
                    if (mediaPdfError) {
                      return (
                        <div className="wa-mediaViewer-iframe wa-mediaViewer-pdfState">
                          <span className="wa-mediaViewer-fileIcon" aria-hidden="true">
                            📎
                          </span>
                          <span>Não foi possível exibir o PDF nesta janela ({mediaPdfError}).</span>
                          <a href={absUrl} target="_blank" rel="noreferrer" className="wa-btn wa-btn-primary">
                            Abrir em nova aba
                          </a>
                        </div>
                      );
                    }
                    if (mediaPdfBlobUrl) {
                      return (
                        <iframe
                          src={mediaPdfBlobUrl}
                          title={mediaViewer.fileName || "Documento"}
                          className="wa-mediaViewer-iframe"
                        />
                      );
                    }
                    return (
                      <div className="wa-mediaViewer-iframe wa-mediaViewer-pdfState" role="status">
                        Preparando documento…
                      </div>
                    );
                  }
                  return (
                    <div className="wa-mediaViewer-file">
                      <span className="wa-mediaViewer-fileIcon">📎</span>
                      <span className="wa-mediaViewer-fileName">{mediaViewer.fileName || "Arquivo"}</span>
                      <a href={mediaViewer.url} target="_blank" rel="noreferrer" className="wa-btn wa-btn-primary">
                        Abrir arquivo
                      </a>
                    </div>
                  );
                })()
              ) : (
                <img
                  ref={mediaViewerImgRef}
                  src={mediaViewer.url}
                  alt={mediaViewer.type === "figurinha" ? "Figurinha" : "Imagem"}
                  className="wa-mediaViewer-img"
                />
              )}
            </div>
          </div>,
          document.body
        ) : null}

        {shareContactOpen ? createPortal(
          <div
            className="wa-modalOverlay"
            role="dialog"
            aria-label="Enviar contato"
            onMouseDown={() => {
              if (shareContactSending) return;
              setShareContactOpen(false);
              setShareContactQuery("");
              setShareContactList([]);
            }}
          >
            <div className="wa-modal" onMouseDown={(e) => e.stopPropagation()}>
              <div className="wa-modal-head">
                <div className="wa-modal-title">Enviar contato</div>
                <button
                  type="button"
                  className="wa-iconBtn"
                  onClick={() => {
                    if (shareContactSending) return;
                    setShareContactOpen(false);
                    setShareContactQuery("");
                    setShareContactList([]);
                  }}
                  title="Fechar"
                >
                  <IconClose />
                </button>
              </div>
              <div className="wa-modal-body">
                <div className="wa-modal-row">
                  <input
                    className="wa-input"
                    placeholder="Buscar cliente por nome ou telefone..."
                    value={shareContactQuery}
                    onChange={(e) => setShareContactQuery(e.target.value)}
                  />
                </div>
                <div className="wa-modal-row" style={{ maxHeight: 260, overflowY: "auto", paddingRight: 4 }}>
                  {shareContactLoading ? (
                    <div className="wa-muted">Carregando contatos...</div>
                  ) : shareContactList.length === 0 ? (
                    <div className="wa-muted">Nenhum contato encontrado.</div>
                  ) : (
                    <div className="wa-forwardList">
                      {shareContactList.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className="wa-forwardItem"
                          disabled={shareContactSending}
                          onClick={async () => {
                            if (!conversaId) return;
                            setShareContactSending(true);
                            try {
                              await enviarContato(conversaId, c.id);
                              setShareContactOpen(false);
                              setShareContactQuery("");
                              setShareContactList([]);
                              showToast({
                                type: "success",
                                title: "Contato enviado",
                                message: "O contato foi compartilhado na conversa.",
                              });
                            } catch (err) {
                              console.error("Erro ao enviar contato:", err);
                              const is403 = err?.response?.status === 403;
                              const apiMsg = err?.response?.data?.error;
                              showToast({
                                type: "error",
                                title: is403 ? "Acesso restrito" : "Falha ao enviar contato",
                                message: apiMsg || (is403 ? "Assuma a conversa antes de enviar mensagens." : "Não foi possível enviar o contato."),
                              });
                            } finally {
                              setShareContactSending(false);
                            }
                          }}
                        >
                          <div className="wa-forwardItem-name">{safeString(c.nome || c.telefone) || "Cliente"}</div>
                          {c.telefone ? (
                            <div className="wa-forwardItem-sub">{String(c.telefone)}</div>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>,
          document.body
        ) : null}

        {shareLocationOpen ? createPortal(
          <div
            className="wa-modalOverlay"
            role="dialog"
            aria-label="Enviar localização"
            onMouseDown={() => {
              if (shareLocationSending) return;
              setShareLocationOpen(false);
            }}
          >
            <div className="wa-modal" onMouseDown={(e) => e.stopPropagation()}>
              <div className="wa-modal-head">
                <div className="wa-modal-title">Enviar localização</div>
                <button
                  type="button"
                  className="wa-iconBtn"
                  onClick={() => {
                    if (shareLocationSending) return;
                    setShareLocationOpen(false);
                  }}
                  title="Fechar"
                >
                  <IconClose />
                </button>
              </div>
              <div className="wa-modal-body">
                {shareLocationGeoLoading ? <div className="wa-muted">Obtendo localização…</div> : null}
                {shareLocationGeoError ? (
                  <div className="wa-modal-row wa-modal-row--hint">{shareLocationGeoError}</div>
                ) : null}
                <div className="wa-modal-row">
                  <span className="wa-modal-label">Latitude</span>
                  <input
                    className="wa-input"
                    inputMode="decimal"
                    value={shareLocationLat}
                    onChange={(e) => setShareLocationLat(e.target.value)}
                    placeholder="-19.5"
                    disabled={shareLocationSending}
                    autoComplete="off"
                  />
                </div>
                <div className="wa-modal-row">
                  <span className="wa-modal-label">Longitude</span>
                  <input
                    className="wa-input"
                    inputMode="decimal"
                    value={shareLocationLng}
                    onChange={(e) => setShareLocationLng(e.target.value)}
                    placeholder="-44.0"
                    disabled={shareLocationSending}
                    autoComplete="off"
                  />
                </div>
                <div className="wa-modal-row">
                  <span className="wa-modal-label">Nome do local (opcional)</span>
                  <input
                    className="wa-input"
                    value={shareLocationNome}
                    onChange={(e) => setShareLocationNome(e.target.value)}
                    placeholder="Ex.: nome do estabelecimento"
                    disabled={shareLocationSending}
                  />
                </div>
                <div className="wa-modal-row">
                  <span className="wa-modal-label">Endereço (opcional)</span>
                  <input
                    className="wa-input"
                    value={shareLocationEndereco}
                    onChange={(e) => setShareLocationEndereco(e.target.value)}
                    placeholder="Ex.: Rua, número"
                    disabled={shareLocationSending}
                  />
                </div>
                <div className="wa-modal-row wa-modal-row--actions">
                  <button
                    type="button"
                    className="wa-btn"
                    disabled={shareLocationSending}
                    onClick={() => setShareLocationOpen(false)}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="wa-btn wa-btn-primary"
                    disabled={shareLocationSending || shareLocationGeoLoading}
                    onClick={handleEnviarLocalizacao}
                  >
                    {shareLocationSending ? "Enviando…" : "Enviar"}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        ) : null}

        <ProdutoConsultaPanel
          open={showProdutosPanel && !isGroup && canConsultarProdutos}
          onClose={() => setShowProdutosPanel(false)}
          canViewSyncStatus={canVerSyncProdutos}
          canTriggerManualSync={canSincronizarProdutos}
          showToast={showToast}
          onEnviarParaConversa={(template) => queueComposerAppend(template)}
        />

        {addToGroupModal?.open ? createPortal(
          <div
            className="wa-modalOverlay"
            role="dialog"
            aria-label="Adicionar a um grupo"
            onMouseDown={() => {
              if (addToGroupSending) return;
              closeAddToGroupModal();
            }}
          >
            <div className="wa-modal" onMouseDown={(e) => e.stopPropagation()}>
              <div className="wa-modal-head">
                <div className="wa-modal-title">Adicionar {addToGroupModal?.nome || "contato"} a um grupo</div>
                <button
                  type="button"
                  className="wa-iconBtn"
                  onClick={closeAddToGroupModal}
                  disabled={addToGroupSending}
                  title="Fechar"
                >
                  <IconClose />
                </button>
              </div>
              <div className="wa-modal-body">
                <div className="wa-modal-row" style={{ maxHeight: 260, overflowY: "auto", paddingRight: 4 }}>
                  {addToGroupLoading ? (
                    <div className="wa-muted">Carregando grupos...</div>
                  ) : addToGroupGrupos.length === 0 ? (
                    <div className="wa-muted">Nenhum grupo encontrado.</div>
                  ) : (
                    <div className="wa-forwardList">
                      {addToGroupGrupos.map((g) => (
                        <button
                          key={g.id}
                          type="button"
                          className="wa-forwardItem"
                          disabled={addToGroupSending}
                          onClick={() => confirmAddToGroup(g)}
                        >
                          <div className="wa-forwardItem-name">{getDisplayName(g)}</div>
                          <div className="wa-forwardItem-sub">Grupo</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>,
          document.body
        ) : null}

        {callModalOpen ? createPortal(
          <div
            className="wa-modalOverlay"
            role="dialog"
            aria-label="Registrar ligação"
            onMouseDown={() => {
              if (callSending) return;
              setCallModalOpen(false);
            }}
          >
            <div className="wa-modal" onMouseDown={(e) => e.stopPropagation()}>
              <div className="wa-modal-head">
                <div className="wa-modal-title">Ligar pelo WhatsApp</div>
                <button
                  type="button"
                  className="wa-iconBtn"
                  onClick={() => !callSending && setCallModalOpen(false)}
                  title="Fechar"
                >
                  <IconClose />
                </button>
              </div>
              <div className="wa-modal-body">
                <div className="wa-modal-row">
                  <span className="wa-modal-label">Duração (segundos)</span>
                  <input
                    type="number"
                    min={1}
                    max={15}
                    className="wa-input"
                    value={callDuration}
                    onChange={(e) => {
                      const v = Number(e.target.value) || 0;
                      if (v < 1) setCallDuration(1);
                      else if (v > 15) setCallDuration(15);
                      else setCallDuration(v);
                    }}
                  />
                </div>
                <div className="wa-modal-row">
                  <p className="wa-modal-value">
                    Registraremos uma ligação via WhatsApp nesta conversa. Isso não inicia a chamada no seu dispositivo,
                    apenas registra no histórico.
                  </p>
                </div>
              </div>
              <div className="wa-modal-body" style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                  type="button"
                  className="wa-btn wa-btn-ghost"
                  disabled={callSending}
                  onClick={() => !callSending && setCallModalOpen(false)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="wa-btn wa-btn-primary"
                  disabled={callSending || !conversaId}
                  onClick={async () => {
                    if (!conversaId) return;
                    const dur = Math.min(15, Math.max(1, Number(callDuration) || 5));
                    setCallSending(true);
                    try {
                      await registrarLigacao(conversaId, dur);
                      setCallModalOpen(false);
                      showToast({
                        type: "success",
                        title: "Ligação registrada",
                        message: "A ligação via WhatsApp foi registrada na conversa.",
                      });
                    } catch (err) {
                      console.error("Erro ao registrar ligação:", err);
                      const is403 = err?.response?.status === 403;
                      const apiMsg = err?.response?.data?.error;
                      showToast({
                        type: "error",
                        title: is403 ? "Acesso restrito" : "Falha ao registrar ligação",
                        message: apiMsg || (is403 ? "Assuma a conversa antes de enviar mensagens." : "Não foi possível registrar a ligação."),
                      });
                    } finally {
                      setCallSending(false);
                    }
                  }}
                >
                  {callSending ? "Registrando..." : "Iniciar ligação"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        ) : null}

        <div className="wa-footer">
          {isRecording ? (
            <div className="wa-recording-bar">
              <button
                type="button"
                className="wa-recording-cancel"
                onClick={handleCancelRecording}
                title="Cancelar"
                aria-label="Cancelar gravação"
              >
                <IconClose />
              </button>
              <div className="wa-recording-timer">
                <span className="wa-recording-dot" aria-hidden="true" />
                <span className="wa-recording-time">
                  {Math.floor(recordingSeconds / 60)}:{(recordingSeconds % 60).toString().padStart(2, "0")}
                </span>
              </div>
              <span className="wa-recording-hint">Toque para enviar</span>
              <button
                type="button"
                className="wa-recording-send"
                onClick={handleStopRecording}
                title="Enviar áudio"
                aria-label="Enviar áudio"
              >
                <IconSend />
              </button>
            </div>
          ) : (
            <>
              {!podeEnviar && (
                <div className="wa-footer-hint" role="status">
                  {conversa?.mensagens_bloqueadas
                    ? `Este atendimento foi assumido por ${conversa?.atendente_nome?.trim() ? conversa.atendente_nome : "outro usuário"}.`
                    : "Assuma esta conversa para enviar mensagens"}
                </div>
              )}
              <div className="wa-attachWrap" ref={attachMenuRef}>
                <button
                  type="button"
                  className={`wa-iconBtn wa-attachPlus ${attachMenuOpen ? "isOpen" : ""}`}
                  onClick={() => { setAttachMenuOpen((v) => !v); setEmojiOpen(false); setStickerOpen(false); }}
                  title="Anexos e mais"
                  aria-label="Anexos e mais"
                  aria-expanded={attachMenuOpen}
                  disabled={sending || !conversaId || !podeEnviar}
                >
                  <IconPlus />
                </button>
                {attachMenuOpen ? (
                  <div className="wa-attachMenu" role="menu" aria-label="Anexos">
                    <button type="button" className="wa-attachItem" role="menuitem" onClick={() => { openFototecaPicker(); setAttachMenuOpen(false); }}>
                      <span className="wa-attachItem-icon wa-attachIcon-doc" aria-hidden="true">📄</span>
                      <span>Fototeca/Galeria</span>
                    </button>
                    <button type="button" className="wa-attachItem" role="menuitem" onClick={() => { openFototecaPicker(); setAttachMenuOpen(false); }}>
                      <span className="wa-attachItem-icon wa-attachIcon-gallery" aria-hidden="true">🖼️</span>
                      <span>Galeria</span>
                    </button>
                    <button type="button" className="wa-attachItem" role="menuitem" onClick={() => { openCameraPicker(); setAttachMenuOpen(false); }}>
                      <span className="wa-attachItem-icon wa-attachIcon-camera" aria-hidden="true">📷</span>
                      <span>Câmera</span>
                    </button>
                    <button
                      type="button"
                      className="wa-attachItem"
                      role="menuitem"
                      onClick={() => { openDocumentPicker(); setAttachMenuOpen(false); }}
                      disabled={sending || !conversaId || !podeEnviar}
                    >
                      <span className="wa-attachItem-icon wa-attachIcon-document" aria-hidden="true"><IconDocument /></span>
                      <span>Documentos</span>
                    </button>
                    <button
                      type="button"
                      className="wa-attachItem"
                      role="menuitem"
                      onClick={handlePixMenuClick}
                      disabled={pixActionBusy || sending || !conversaId || !podeEnviar}
                    >
                      <span className="wa-attachItem-icon wa-attachIcon-pix" aria-hidden="true"><IconPix /></span>
                      <span>{pixActionBusy ? "Enviando Pix..." : "Pix"}</span>
                    </button>
                    <button
                      type="button"
                      className="wa-attachItem"
                      role="menuitem"
                      onClick={async () => {
                        setAttachMenuOpen(false);
                        await fetchPixConfigIfNeeded();
                        setPixModalOpen(true);
                      }}
                      disabled={pixConfigLoading || sending}
                    >
                      <span className="wa-attachItem-icon wa-attachIcon-clip" aria-hidden="true">⚙️</span>
                      <span>Configurar Pix</span>
                    </button>
                    <button type="button" className="wa-attachItem" role="menuitem" onClick={() => { setShareContactOpen(true); setAttachMenuOpen(false); }}>
                      <span className="wa-attachItem-icon wa-attachIcon-contact" aria-hidden="true">👤</span>
                      <span>Contato</span>
                    </button>
                    <button type="button" className="wa-attachItem" role="menuitem" onClick={openShareLocation}>
                      <span className="wa-attachItem-icon wa-attachIcon-location" aria-hidden="true">📍</span>
                      <span>Localização</span>
                    </button>
                    {autocorrectToggleInMenu ? (
                      <button
                        type="button"
                        className="wa-attachItem wa-attachItem--autocorrect"
                        role="menuitemcheckbox"
                        aria-checked={autoCorrectEnabled ? "true" : "false"}
                        onClick={() => {
                          updateAutoCorrectPreference(!autoCorrectEnabled);
                          setAttachMenuOpen(false);
                        }}
                      >
                        <span className="wa-attachItem-icon wa-attachIcon-clip" aria-hidden="true">✓</span>
                        <span>{autoCorrectEnabled ? "Desativar correção automática" : "Ativar correção automática"}</span>
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="wa-stickerWrap">
                <button
                  ref={stickerBtnRef}
                  type="button"
                  className={`wa-iconBtn wa-stickerBtn ${stickerOpen ? "isActive" : ""}`}
                  onClick={() => {
                    setStickerOpen((v) => !v);
                    setAttachMenuOpen(false);
                    setEmojiOpen(false);
                  }}
                  title="Figurinhas"
                  aria-label="Figurinhas"
                  aria-expanded={stickerOpen}
                  disabled={sending || !conversaId || !podeEnviar}
                >
                  <IconSticker />
                </button>
              </div>
              {!autocorrectToggleInMenu ? (
                <label
                  className={`wa-autocorrectToggle ${autoCorrectEnabled ? "isEnabled" : ""}`}
                  title="Ativar ou desativar correção ortográfica automática"
                >
                  <input
                    type="checkbox"
                    checked={autoCorrectEnabled}
                    onChange={(e) => updateAutoCorrectPreference(e.target.checked)}
                    aria-label="Correção automática"
                  />
                  <span className="wa-autocorrectToggle-track" aria-hidden="true">
                    <span className="wa-autocorrectToggle-thumb" />
                  </span>
                  <span className="wa-autocorrectToggle-text">Correção automática</span>
                </label>
              ) : null}
              <input
                ref={fileInputRef}
                type="file"
                style={{ display: "none" }}
                accept=".pdf,.doc,.docx,image/*,audio/*,video/*"
                onChange={handleFileInputChange}
              />
              <input
                ref={fototecaInputRef}
                type="file"
                style={{ display: "none" }}
                accept="image/*"
                multiple
                onChange={handleFototecaInputChange}
              />
              <input
                ref={cameraInputRef}
                type="file"
                style={{ display: "none" }}
                accept="image/*,video/*"
                capture="environment"
                onChange={handleCameraInputChange}
              />
              <input
                ref={audioInputRef}
                type="file"
                style={{ display: "none" }}
                accept="audio/*,.mp3,.m4a,.ogg,.wav,.aac,.opus,.webm"
                onChange={handleFileInputChange}
              />
              <input
                ref={documentInputRef}
                type="file"
                style={{ display: "none" }}
                accept="*/*"
                onChange={handleFileInputChange}
              />
              <input
                ref={stickerInputRef}
                type="file"
                style={{ display: "none" }}
                accept="image/*"
                onChange={handleStickerInputChange}
              />

              <textarea
                ref={inputRef}
                value={texto}
                onChange={handleInputChange}
                onBlur={emitTypingStop}
                onPaste={handlePaste}
                placeholder={podeEnviar ? "Digite uma mensagem" : (conversa?.mensagens_bloqueadas ? "Este atendimento foi assumido por outro usuário." : "Assuma esta conversa para responder")}
                className={`wa-input ${autoCorrectFlash ? "wa-input--autocorrect-flash" : ""}`}
                onKeyDown={handleKeyDownInput}
                disabled={!conversaId || !podeEnviar}
                aria-label={
                  podeEnviar
                    ? composerEnterInsertsNewline
                      ? "Digite sua resposta. Retorno ou Enter para nova linha; use o botão enviar para mandar a mensagem. Esc para fechar painéis."
                      : "Digite sua resposta. Enter para enviar, Shift+Enter para nova linha, Esc para fechar painéis."
                    : conversa?.mensagens_bloqueadas
                      ? "Este atendimento foi assumido por outro usuário. Você não pode enviar mensagens."
                      : "Assuma esta conversa para responder."
                }
                rows={1}
                enterKeyHint={composerEnterInsertsNewline ? "enter" : "send"}
              />

              {!headerCompact ? (
                <button
                  type="button"
                  className={`wa-iconBtn ${emojiOpen ? "isActive" : ""}`}
                  onClick={() => { setEmojiOpen((v) => !v); setAttachMenuOpen(false); setStickerOpen(false); }}
                  title="Emojis"
                  aria-label="Emojis"
                  disabled={sending || !conversaId || !podeEnviar}
                >
                  <IconEmoji />
                </button>
              ) : null}

              {headerCompact && !hasDraft ? (
                <button
                  onClick={openCameraPicker}
                  disabled={sending || !conversaId || !podeEnviar}
                  className="wa-iconBtn wa-cameraQuickBtn"
                  title="Câmera"
                  type="button"
                  aria-label="Abrir câmera"
                >
                  <IconCamera />
                </button>
              ) : null}

              <div className="wa-footer-right">
                {headerCompact ? (
                  hasDraft ? (
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        if (e.button !== 0) return;
                        e.preventDefault();
                      }}
                      onClick={() => handleEnviar()}
                      disabled={sending || !hasDraft || !conversaId || !podeEnviar}
                      className="wa-sendBtn"
                      title="Enviar"
                      aria-label="Enviar mensagem"
                    >
                      {sending ? <span className="wa-spinner" aria-hidden="true" /> : <IconSend />}
                    </button>
                  ) : (
                    <button
                      onClick={handleStartRecording}
                      disabled={sending || !conversaId || !podeEnviar}
                      className="wa-micBtn"
                      title="Gravar áudio"
                      type="button"
                      aria-label="Gravar áudio"
                    >
                      <IconMic />
                    </button>
                  )
                ) : (
                  <>
                    <button
                      onClick={handleStartRecording}
                      disabled={sending || !conversaId || !podeEnviar}
                      className="wa-micBtn"
                      title="Gravar áudio"
                      type="button"
                      aria-label="Gravar áudio"
                    >
                      <IconMic />
                    </button>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        if (e.button !== 0) return;
                        e.preventDefault();
                      }}
                      onClick={() => handleEnviar()}
                      disabled={sending || !hasDraft || !conversaId || !podeEnviar}
                      className="wa-sendBtn"
                      title="Enviar"
                      aria-label="Enviar mensagem"
                    >
                      {sending ? <span className="wa-spinner" aria-hidden="true" /> : <IconSend />}
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {!isRecording && stickerOpen ? createPortal(
          <div
            ref={stickerPanelRef}
            className="wa-stickerPanel"
            role="dialog"
            aria-label="Figurinhas"
          >
            <div className="wa-stickerTabs" role="tablist" aria-label="Categorias de figurinhas">
              <button type="button" className="wa-stickerTab isActive" role="tab" aria-selected="true">Recentes</button>
            </div>
            <div className="wa-stickerHead">
              <input
                ref={stickerSearchRef}
                className="wa-stickerSearch"
                value={stickerQuery}
                onChange={(e) => setStickerQuery(e.target.value)}
                placeholder="Buscar figurinha..."
                aria-label="Buscar figurinha"
              />
            </div>
            <div className="wa-stickerGrid" role="list">
              <button
                type="button"
                className="wa-stickerCreate"
                onClick={() => stickerInputRef.current?.click()}
                aria-label="Criar figurinha"
              >
                <span className="wa-stickerCreatePlus" aria-hidden="true">+</span>
                <span>Criar</span>
              </button>
              {filteredRecentStickers.map((item) => (
                <button
                  key={String(item.id)}
                  type="button"
                  className="wa-stickerItem"
                  onClick={async () => {
                    try {
                      const res = await fetch(item.dataUrl);
                      const blob = await res.blob();
                      const ext = String(item?.mimeType || "").includes("webp") ? "webp" : "png";
                      const file = new File([blob], item?.name || `sticker-${Date.now()}.${ext}`, {
                        type: item?.mimeType || blob.type || "image/webp",
                      });
                      await sendStickerFile(file);
                    } catch {
                      showToast({ type: "error", title: "Figurinha", message: "Não foi possível enviar esta figurinha." });
                    }
                  }}
                  role="listitem"
                  aria-label={`Enviar figurinha ${item?.name || ""}`.trim()}
                  title={item?.name || "Figurinha"}
                >
                  <img src={item.dataUrl} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          </div>,
          document.body
        ) : null}

        {/* Emoji picker — simples e leve (sem libs) */}
        {!isRecording && emojiOpen ? createPortal(
          <div
            ref={emojiPanelRef}
            className="wa-emojiPanel"
            role="dialog"
            aria-label="Selecionar emoji"
          >
            <div className="wa-emojiHead">
              <input
                ref={emojiSearchRef}
                className="wa-emojiSearch"
                value={emojiQuery}
                onChange={(e) => setEmojiQuery(e.target.value)}
                placeholder="Buscar emoji..."
                aria-label="Buscar emoji"
              />
              <button
                type="button"
                className="wa-iconBtn"
                onClick={() => { setEmojiOpen(false); setEmojiQuery(""); }}
                title="Fechar"
                aria-label="Fechar"
              >
                <IconClose />
              </button>
            </div>
            <div className="wa-emojiGrid" role="list">
              {__WA_EMOJIS
                .filter((e) => !safeString(emojiQuery) || e.includes(safeString(emojiQuery)))
                .map((e) => (
                  <button
                    key={e}
                    type="button"
                    className="wa-emojiBtn"
                    onClick={() => insertEmoji(e)}
                    role="listitem"
                    aria-label={`Emoji ${e}`}
                    title={e}
                  >
                    {e}
                  </button>
                ))}
            </div>
            <div className="wa-emojiFoot">
              <span className="wa-muted">Dica: clique para inserir no cursor.</span>
            </div>
          </div>,
          document.body
        ) : null}

        {/* ESC handler central */}
        <button
          type="button"
          className="wa-escCatcher"
          aria-hidden="true"
          tabIndex={-1}
          onClick={onEscape}
          style={{ display: "none" }}
        />
    </div>
  );
}
