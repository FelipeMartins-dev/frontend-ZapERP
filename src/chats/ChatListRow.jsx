import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getApiBaseUrl } from "../api/baseUrl";
import {
  isGroupConversation,
  getStatusAtendimentoEffective,
  isAguardandoClienteManual,
  exibirBadgePagamentoConcluido,
  isClosedAttendanceStatus,
  isVCardText,
  parseVCardMeta,
  isModoSimplesAguardandoAtendente,
  isModoSimplesAguardandoCliente,
  resolveModoSimplesAguardandoEffective,
} from "../utils/conversaUtils";
import {
  formatPrazoPagamentoCompacto,
  formatPrazoPagamentoTooltip,
} from "../utils/pagamentoPrazoFormat";
import ConversationActionMenuTrigger from "./ConversationActionMenuTrigger";
import { getContactDisplay } from "./chatListDisplay";
import {
  rowPrefs,
  EMPTY_PENDENTES_SET,
  getLastMessage,
  getEsperaMinutosAnchorIso,
  isConversaAguardandoCliente,
  isConversaAguardandoFuncionario,
  isConversaAguardandoClienteEmCobranca,
  getLastDirection,
  atendimentoRowVisualClass,
  isEmAtendimentoUltimaDoCliente,
} from "./chatListRowAtendimento";
import { chatRowPropsAreEqual } from "./chatListRowCompare";
import {
  formatEsperaDuracaoFromMinutes,
  formatEsperaDuracaoTooltip,
} from "../utils/formatEsperaDuracao";

export const CHAT_ROW_TOUCH_MOVE_PX = 12;

const audioDurationCache = new Map(); // url -> seconds
const audioDurationPromiseCache = new Map(); // url -> Promise<number|null>
let audioDurationInFlight = 0;
const AUDIO_DURATION_CONCURRENCY = 4;
const audioDurationQueue = [];

/** Só os minutos ao lado do relógio; recalcula quando minuteTick avança (tick global em ChatListRows). */
const EsperaMinutosInline = memo(function EsperaMinutosInline({
  anchorIso,
  className = "",
  wordUnit = false,
  format = "default",
  minuteTick,
}) {
  const d = parseToDate(anchorIso);
  if (!d) return null;
  const nowMs = typeof minuteTick === "number" && Number.isFinite(minuteTick) ? minuteTick : Date.now();
  const rawMin = Math.floor((nowMs - d.getTime()) / 60000);
  const mins = Number.isFinite(rawMin) ? Math.max(0, rawMin) : 0;
  const label = formatEsperaDuracaoFromMinutes(mins, { format, wordUnit });
  const cn = ["chat-list-time-espera-min", "zap-wait-time", className].filter(Boolean).join(" ");
  const waitLevel = mins < 5 ? "low" : mins <= 15 ? "mid" : "high";

  return (
    <span
      className={cn}
      data-wait-level={waitLevel}
      title={formatEsperaDuracaoTooltip(mins, d)}
    >
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
function isPlaceholderGenericMessageText(txt) {
  const t = String(txt || "").trim().toLowerCase();
  return t === "(mensagem)" || t === "(mensagem vazia)";
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
    isPlaceholderGenericMessageText(txt) ||
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

  if (txt && !isPlaceholderGenericMessageText(txt)) return `${outPrefix}${txt}`;
  if (isPlaceholderGenericMessageText(txt)) return "Sem mensagens";
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
    isPlaceholderGenericMessageText(txt) ||
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
      <span className="chat-list-previewText">{isPlaceholderGenericMessageText(txt) ? "Sem mensagens" : `${atendentePrefix}${txt || "Sem mensagens"}`}</span>
    </span>
  );
}

function TagMini({ tag }) {
  if (!tag) return null;
  const cor = String(tag?.cor || "").trim();
  return (
    <span
      className={`chat-list-tag-mini${cor ? " chat-list-tag-mini--colored" : ""}`}
      title={tag?.nome}
      style={cor ? { background: cor, color: "#fff" } : undefined}
    >
      {tag?.nome}
    </span>
  );
}

function isReabertaPorFaltaInteracao(chat) {
  return chat?.reaberta_por_falta_interacao === true || Boolean(chat?.reaberta_falta_interacao_em);
}

function ReabertaFaltaInteracaoBadge({ sub = false }) {
  return (
    <span
      className={
        "chat-list-status-tech chat-list-status-tech--reaberta-falta zap-badge-reaberta-falta" +
        (sub ? " chat-list-status-tech--reaberta-falta-sub" : "")
      }
      title="Reaberta automaticamente por falta de interação do atendente (gestor notificado)"
    >
      <span className="chat-list-status-tech-reaberta-dot zap-dot" aria-hidden="true" />
      <span className="chat-list-status-tech-reaberta-label">Reaberta por falta de interação do atendente</span>
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

function AwaitClienteBadge({ title, auto = false }) {
  return (
    <span
      className={
        "chat-list-status-tech chat-list-status-tech--await-client zap-badge-aguardando-cliente" +
        (auto ? " chat-list-status-tech--await-client-auto" : "")
      }
      title={title}
    >
      <span className="chat-list-status-tech-await-client-badge-icon zap-dot" aria-hidden="true">
        ◈
      </span>
      <span className="chat-list-status-tech-await-client-label">Aguardando cliente</span>
    </span>
  );
}

function PagamentoPendenteBadge({ prazoAte, prazoOrigem, minuteTick, sub = false }) {
  const nowMs =
    typeof minuteTick === "number" && Number.isFinite(minuteTick) ? minuteTick : Date.now();
  const prazoCompacto = formatPrazoPagamentoCompacto(prazoAte, prazoOrigem, nowMs);
  const prazoData = formatPrazoPagamentoTooltip(prazoAte);
  const prazoHint = prazoData
    ? `Cobrança enviada — prazo até ${prazoData}${prazoCompacto ? ` (${prazoCompacto})` : ""}`
    : "Cobrança enviada — aguardando pagamento";
  return (
    <span
      className={
        "chat-list-status-tech chat-list-status-tech--pagamento-pendente zap-badge-pagamento-pendente" +
        (sub ? " chat-list-status-tech--pagamento-pendente-sub" : "")
      }
      title={prazoHint}
    >
      <span className="chat-list-status-tech-pagamento-dot zap-dot" aria-hidden="true" />
      <span className="chat-list-status-tech-pagamento-label">Pagamento pendente</span>
      {prazoCompacto ? (
        <>
          <span className="chat-list-status-tech-prazo-sep" aria-hidden="true" />
          <span className="chat-list-status-tech-prazo-valor">{prazoCompacto}</span>
        </>
      ) : null}
    </span>
  );
}

function EmAtrasoBadge({ sub = false }) {
  return (
    <span
      className={
        "chat-list-status-tech chat-list-status-tech--em-atraso zap-badge-em-atraso" +
        (sub ? " chat-list-status-tech--em-atraso-sub" : "")
      }
      title="Prazo de pagamento vencido — necessária nova cobrança"
    >
      <span className="chat-list-status-tech-atraso-dot zap-dot" aria-hidden="true" />
      <span className="chat-list-status-tech-atraso-label">Em atraso</span>
    </span>
  );
}

function AguardandoFuncionarioPill({ esperaMinutosAnchorIso = "", minuteTick, title }) {
  const hint =
    title ||
    "Pagamento pendente — última mensagem do cliente; equipe deve responder";
  return (
    <span className="chat-list-status-tech chat-list-status-tech--staff" title={hint}>
      <span className="chat-list-status-tech-staff-main zap-badge-aguardando-funcionario">
        <span className="chat-list-status-tech-staff-label">Aguardando atendente</span>
      </span>
      {String(esperaMinutosAnchorIso || "").trim() ? (
        <EsperaMinutosInline
          anchorIso={String(esperaMinutosAnchorIso).trim()}
          className="chat-list-time-espera-min--staff-pill"
          format="hud"
          minuteTick={minuteTick}
        />
      ) : null}
    </span>
  );
}

/** Etiqueta principal em cobrança conforme última mensagem (in → atendente, out → cliente). */
function CobrancaPrimaryPorUltimaMensagem({
  chat,
  aguardandoFuncionario,
  esperaMinutosAnchorIso,
  minuteTick,
}) {
  if (chat?.atendente_id == null) return null;
  const lastDir = getLastDirection(chat);
  const unread = Number(chat?.unread_count ?? chat?.unread ?? 0);
  const hintNovaMsg =
    !lastDir && (Boolean(chat?.tem_novas_mensagens_em_atendimento) || unread > 0);
  const atendentePorUltimo = lastDir === "out";
  const clientePorUltimo = lastDir === "in" || hintNovaMsg;

  if (atendentePorUltimo) {
    return (
      <AwaitClienteBadge title="Cobrança enviada — aguardando resposta do cliente" auto />
    );
  }
  if (clientePorUltimo || Boolean(aguardandoFuncionario)) {
    return (
      <AguardandoFuncionarioPill
        esperaMinutosAnchorIso={esperaMinutosAnchorIso}
        minuteTick={minuteTick}
      />
    );
  }
  return (
    <AwaitClienteBadge title="Cobrança enviada — aguardando resposta do cliente" auto />
  );
}

/** Pilha: aguardando cliente/atendente + pagamento pendente ou em atraso. */
function CobrancaFinanceiroStatusStack({
  chat,
  statusKey,
  aguardandoFuncionario,
  esperaMinutosAnchorIso,
  minuteTick,
}) {
  const s = String(statusKey || "").toLowerCase().trim();
  const primary = (
    <CobrancaPrimaryPorUltimaMensagem
      chat={chat}
      aguardandoFuncionario={aguardandoFuncionario}
      esperaMinutosAnchorIso={esperaMinutosAnchorIso}
      minuteTick={minuteTick}
    />
  );
  const financeSub =
    s === "em_atraso" ? (
      <EmAtrasoBadge sub />
    ) : (
      <PagamentoPendenteBadge
        sub
        prazoAte={chat?.pagamento_prazo_ate}
        prazoOrigem={chat?.pagamento_prazo_origem}
        minuteTick={minuteTick}
      />
    );

  return (
    <span className="chat-list-statusRow chat-list-statusRow--pagamento-sub chat-list-statusRow--cobranca-dupla">
      {primary ? <span className="chat-list-statusRow-primary">{primary}</span> : null}
      <span className="chat-list-statusRow-sub">{financeSub}</span>
    </span>
  );
}

function PagamentoConcluidoBadge({ sub = false }) {
  return (
    <span
      className={
        "chat-list-status-tech chat-list-status-tech--pagamento-concluido zap-badge-pagamento-concluido" +
        (sub ? " chat-list-status-tech--pagamento-concluido-sub" : "")
      }
      title="Pagamento confirmado neste atendimento"
    >
      <span className="chat-list-status-tech-pagamento-ok-label">Pagamento concluído</span>
    </span>
  );
}

function StatusPill({
  status,
  exibirBadgeAberta,
  chat,
  aguardandoFuncionario,
  esperaMinutosAnchorIso = "",
  minuteTick,
}) {
  const s = String(status || "").toLowerCase().trim().replace(/\s+/g, "_");
  const map = {
    em_atendimento: {
      label: "Em atendimento",
      cls: "chat-list-status in chat-list-status--hud-in",
      prefix: "▹",
      prefixClass: "chat-list-status-hud-prefix--session",
    },
    fechada: {
      label: "Finalizada",
      cls: "chat-list-status closed chat-list-status--hud-closed",
      prefix: "✓",
      prefixClass: "chat-list-status-hud-prefix--check",
    },
    mensagem_disparada: {
      label: "Mensagem disparada",
      cls: "chat-list-status dispatched chat-list-status--hud-dispatched",
      prefix: "↯",
      prefixClass: "chat-list-status-hud-prefix--dispatch",
    },
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
    Boolean(aguardandoFuncionario) &&
    (s === "em_atendimento" || s === "pagamento_pendente" || s === "em_atraso") &&
    !aguardandoClienteAutomatico;
  const pagamentoConcluidoVisivel = exibirBadgePagamentoConcluido(chat);
  /** Sem “Em atendimento” quando já há etiqueta de aguardando cliente ou atendente — libera espaço ao nome. */
  const suprimirPilulaEmAtendimento =
    s === "em_atendimento" && (aguardandoClienteAutomatico || aguardandoFuncionarioVisivel);
  const reabertoHint =
    typeof chat?.ui_hint_reaberto_ausencia_cliente === "number" &&
    Date.now() - chat.ui_hint_reaberto_ausencia_cliente < 120000;
  const reabertaFaltaInteracao = isReabertaPorFaltaInteracao(chat);

  if (
    chat?.atendimento_modo_simples &&
    !isGroupConversation(chat) &&
    !isClosedAttendanceStatus(status)
  ) {
    const ag = resolveModoSimplesAguardandoEffective(chat);
    if (ag === 'atendente' || ag === 'cliente') {
      const aguardandoAtendente = ag === 'atendente';
      return (
        <span className="chat-list-statusRow chat-list-statusRow--await-solo">
          {aguardandoAtendente ? (
            <span
              className="chat-list-status-tech chat-list-status-tech--staff"
              title="Última mensagem do cliente — equipe deve responder"
            >
              <span className="chat-list-status-tech-staff-main zap-badge-aguardando-funcionario">
                <span className="chat-list-status-tech-staff-label">Aguardando atendente</span>
              </span>
              {String(esperaMinutosAnchorIso || "").trim() ? (
                <EsperaMinutosInline
                  anchorIso={String(esperaMinutosAnchorIso).trim()}
                  className="chat-list-time-espera-min--staff-pill"
                  format="hud"
                  minuteTick={minuteTick}
                />
              ) : null}
            </span>
          ) : (
            <AwaitClienteBadge title="Aguardando resposta do cliente (modo simples)" auto />
          )}
        </span>
      );
    }
  }

  if (ausenciaFechada) {
    return (
      <span className="chat-list-statusRow">
        <span
          className="chat-list-status closed chat-list-status--hud-closed chat-list-status--hud-closed-muted chat-list-status--muted"
          title="Encerrada automaticamente por ausência do cliente"
        >
          <span className="chat-list-status-hud-prefix chat-list-status-hud-prefix--check" aria-hidden>
            ✓
          </span>
          <span className="chat-list-status-hud-text">Finalizado por ausência</span>
        </span>
      </span>
    );
  }

  if (s === "pagamento_pendente" || s === "em_atraso") {
    return (
      <CobrancaFinanceiroStatusStack
        chat={chat}
        statusKey={s}
        aguardandoFuncionario={aguardandoFuncionario}
        esperaMinutosAnchorIso={esperaMinutosAnchorIso}
        minuteTick={minuteTick}
      />
    );
  }

  if (s === "aguardando_cliente") {
    const pagamentoSubAguardando = pagamentoConcluidoVisivel ? (
      <span className="chat-list-statusRow-sub">
        <PagamentoConcluidoBadge sub />
      </span>
    ) : null;
    const primaryAguardando = (
      <>
        <AwaitClienteBadge title="Aguardando cliente (marcado manualmente)" auto={false} />
        {reabertoHint ? (
          <span className="chat-list-status-note" title="Cliente voltou a enviar mensagem após encerramento por ausência">
            Reaberto pelo cliente
          </span>
        ) : null}
      </>
    );
    if (pagamentoSubAguardando) {
      return (
        <span className="chat-list-statusRow chat-list-statusRow--await-solo chat-list-statusRow--pagamento-sub">
          <span className="chat-list-statusRow-primary">{primaryAguardando}</span>
          {pagamentoSubAguardando}
        </span>
      );
    }
    return <span className="chat-list-statusRow">{primaryAguardando}</span>;
  }

  if (it) {
    const rowClass =
      "chat-list-statusRow" +
      (suprimirPilulaEmAtendimento ? " chat-list-statusRow--await-solo" : "") +
      (pagamentoConcluidoVisivel ? " chat-list-statusRow--pagamento-sub" : "");
    const mostrarPilulaPrincipal = !(s === "em_atendimento" && suprimirPilulaEmAtendimento);
    const primary = (
      <>
        {mostrarPilulaPrincipal ? (
          <span
            className={`${it.cls}${s === "em_atendimento" ? " zap-badge-em-atendimento" : ""}`.trim()}
            title={it.label}
          >
            <span
              className={`chat-list-status-hud-prefix ${it.prefixClass}${s === "em_atendimento" ? " zap-dot" : ""}`.trim()}
              aria-hidden
            >
              {it.prefix}
            </span>
            <span className="chat-list-status-hud-text">{it.label}</span>
          </span>
        ) : null}
        {reabertoHint ? (
          <span className="chat-list-status-note" title="Cliente voltou a enviar mensagem após encerramento por ausência">
            Reaberto pelo cliente
          </span>
        ) : null}
        {aguardandoClienteAutomatico ? (
          <AwaitClienteBadge title="Aguardando resposta do cliente (detecção automática — em atendimento)" auto />
        ) : null}
        {aguardandoFuncionarioVisivel ? (
          <span
            className="chat-list-status-tech chat-list-status-tech--staff"
            title="Última mensagem do cliente — equipe deve responder"
          >
            <span className="chat-list-status-tech-staff-main zap-badge-aguardando-funcionario">
              <span className="chat-list-status-tech-staff-label">Aguardando atendente</span>
            </span>
            {String(esperaMinutosAnchorIso || "").trim() ? (
              <EsperaMinutosInline
                anchorIso={String(esperaMinutosAnchorIso).trim()}
                className="chat-list-time-espera-min--staff-pill"
                format="hud"
                minuteTick={minuteTick}
              />
            ) : null}
          </span>
        ) : null}
      </>
    );
    return (
      <span className={rowClass}>
        {pagamentoConcluidoVisivel ? (
          <>
            <span className="chat-list-statusRow-primary">{primary}</span>
            <span className="chat-list-statusRow-sub">
              <PagamentoConcluidoBadge sub />
            </span>
          </>
        ) : (
          primary
        )}
      </span>
    );
  }
  // Aberta ou vazio: usar exibir_badge_aberta para decidir se mostra "Aberta"
  if (
    exibirBadgeAberta === true &&
    !(chat?.atendimento_modo_simples && resolveModoSimplesAguardandoEffective(chat))
  ) {
    return (
      <span className={`chat-list-statusRow${reabertaFaltaInteracao ? " chat-list-statusRow--reaberta-falta" : ""}`}>
        <span className="chat-list-statusRow-primary">
          <span className="chat-list-status open chat-list-status--hud-open" title="Aberta">
            <span className="chat-list-status-hud-prefix chat-list-status-hud-prefix--aberta" aria-hidden>
              ▶
            </span>
            <span className="chat-list-status-hud-text">Aberta</span>
          </span>
        </span>
        {reabertaFaltaInteracao ? (
          <span className="chat-list-statusRow-sub">
            <ReabertaFaltaInteracaoBadge sub />
          </span>
        ) : null}
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
  currentUserId,
  isMenuOpen,
  onToggleMenu,
  pendentesFuncionarioSet = EMPTY_PENDENTES_SET,
  minuteTick,
  showWhatsappInstanceUi = false,
}) {
  const id = chat?.id;
  const clienteId = chat?.cliente_id;
  const semConversa = Boolean(chat?.sem_conversa && chat?.cliente_id);
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
  const cobrancaFinanceiraRow =
    statusEff === "pagamento_pendente" || statusEff === "em_atraso";
  const aguardandoFuncionarioVisivelRow =
    isConversaAguardandoFuncionario(chat, pendentesFuncionarioSet) &&
    (statusEff === "em_atendimento" ||
      cobrancaFinanceiraRow ||
      chat?.atendimento_modo_simples) &&
    !aguardandoClienteAutomaticoRow;
  const aguardandoClienteCobrancaRow = isConversaAguardandoClienteEmCobranca(chat);
  /** Minutos ao lado do relógio só quando não estão na badge “Aguardando atendente”. */
  const mostrarEsperaMinutosAoLadoDoRelogio =
    Boolean(esperaMinutosAnchor) && !aguardandoFuncionarioVisivelRow;
  const staffPremiumRowClass = aguardandoFuncionarioVisivelRow ? " chat-list-row--await-staff-premium" : "";
  const reabertaFaltaRowClass = isReabertaPorFaltaInteracao(chat) ? " chat-list-row--reaberta-falta-card" : "";
  const somenteAbertaRowClass =
    !semConversa &&
    !isGroupConversation(chat) &&
    chat?.exibir_badge_aberta === true &&
    !isReabertaPorFaltaInteracao(chat) &&
    !aguardandoFuncionarioVisivelRow &&
    !aguardandoClienteAutomaticoRow &&
    statusEff !== "aguardando_cliente" &&
    !cobrancaFinanceiraRow &&
    statusEff !== "fechada" &&
    statusEff !== "mensagem_disparada"
      ? " chat-list-row--somente-aberta-card"
      : "";
  const awaitClientCardClass =
    !aguardandoFuncionarioVisivelRow &&
    (aguardandoClienteAutomaticoRow ||
      statusEff === "aguardando_cliente" ||
      aguardandoClienteCobrancaRow)
      ? " chat-list-row--await-client-card"
      : "";
  const contact = getContactDisplay(chat);
  const { displayName, avatarUrl, phone, isGroup } = contact;
  const empresa = String(chat?.cliente?.empresa ?? chat?.cliente_empresa ?? chat?.empresa ?? "").trim();
  const hasName = displayName !== phone;
  const last = chat?.ultima_mensagem || chat?.ultima_mensagem_preview || getLastMessage(chat);
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
  const whatsappInstanceLabel = !isGroup && showWhatsappInstanceUi
    ? String(
        chat?.whatsapp_instance_nome ||
        chat?.whatsappInstanceNome ||
        chat?.whatsapp_instance_display_phone ||
        chat?.whatsappInstanceDisplayPhone ||
        ""
      ).trim()
    : "";

  useEffect(() => {
    setImgError(false);
  }, [avatarUrl]);

  useEffect(() => {
    if (active) setOpening(false);
  }, [active]);

  useEffect(() => {
    if (!opening) return undefined;
    const t = window.setTimeout(() => setOpening(false), 5000);
    return () => window.clearTimeout(t);
  }, [opening]);

  /* Se abriu outra conversa ou falhou, não deixar "opening" travar o clique. */
  useEffect(() => {
    if (!opening || active) return undefined;
    const t = window.setTimeout(() => setOpening(false), 400);
    return () => window.clearTimeout(t);
  }, [opening, active]);

  const touchRef = useRef(null);

  const activateRow = useCallback(() => {
    if (semConversa && chat?.cliente_id) {
      setOpening(true);
      const instanceId = chat?.whatsapp_instance_id ?? chat?.whatsappInstanceId ?? null;
      onOpenClienteSemConversa?.(chat.cliente_id, instanceId)
        .finally(() => setOpening(false));
      return;
    }
    if (id == null || id === undefined || id === "") return;
    onSelect?.(id);
  }, [semConversa, chat?.cliente_id, id, onOpenClienteSemConversa, onSelect]);

  function handleTouchStart(e) {
    const t = e.touches?.[0];
    if (!t) return;
    touchRef.current = { x: t.clientX, y: t.clientY, moved: false };
  }

  function handleTouchMove(e) {
    const st = touchRef.current;
    const t = e.touches?.[0];
    if (!st || !t) return;
    if (
      Math.abs(t.clientX - st.x) > CHAT_ROW_TOUCH_MOVE_PX ||
      Math.abs(t.clientY - st.y) > CHAT_ROW_TOUCH_MOVE_PX
    ) {
      st.moved = true;
    }
  }

  function handleTouchEnd(e) {
    const st = touchRef.current;
    touchRef.current = null;
    if (!st || st.moved) return;
    if (e.target?.closest?.(".chat-row-action-trigger")) return;
    e.preventDefault();
    activateRow();
  }

  function handleClick(e) {
    if (e?.target?.closest?.(".chat-row-action-trigger")) return;
    if (typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches) return;
    activateRow();
  }

  function handleRowKeyDown(e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activateRow();
    }
  }

  return (
    <div
      tabIndex={0}
      className={`chat-list-row zap-conversation-card ${active || opening ? "is-active" : ""} ${opening ? "is-opening" : ""} ${semConversa ? "chat-list-row-sem-conversa" : ""} ${unread > 0 ? "has-unread" : ""} ${atendimentoRowClass} ${atendimentoTechClass}${staffPremiumRowClass}${reabertaFaltaRowClass}${somenteAbertaRowClass}${awaitClientCardClass}`.trim()}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onClick={handleClick}
      onKeyDown={handleRowKeyDown}
      aria-disabled={semConversa && opening ? "true" : "false"}
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
            {!isGroup && whatsappInstanceLabel ? (
              <div className="chat-list-whatsapp-instance" title={`Numero WhatsApp: ${whatsappInstanceLabel}`}>
                {whatsappInstanceLabel}
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
                <EsperaMinutosInline anchorIso={esperaMinutosAnchor} minuteTick={minuteTick} />
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
                minuteTick={minuteTick}
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
            </div>
          </div>
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

const MemoChatRow = memo(ChatRow, chatRowPropsAreEqual);

export default MemoChatRow;
