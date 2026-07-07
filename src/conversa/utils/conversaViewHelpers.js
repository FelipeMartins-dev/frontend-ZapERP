import { resolveContactMetaFromMessage } from "../../utils/conversaUtils";
import { getApiBaseUrl } from "../../api/baseUrl";
import { CAPTION_BUNDLE_MAX_SEC, STICKER_RECENTS_LIMIT } from "../conversaConstants";

export function formatForwardHttpError(err) {
  const status = err?.response?.status;
  const server = err?.response?.data?.error ?? err?.response?.data?.message;
  if (server != null && String(server).trim() !== "") return String(server).trim();
  if (status === 401) return "Sessão expirada. Faça login novamente.";
  if (status === 403) return "Você não tem permissão para esta ação.";
  if (status === 404) return "Conversa ou recurso não encontrado.";
  if (status >= 500) return "Erro no servidor. Tente novamente em instantes.";
  return err?.message || "Falha de rede ou resposta inesperada.";
}
export function parseToDate(ts) {
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

export function formatHora(ts) {
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

export function formatDia(ts) {
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

export function sameDay(a, b) {
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

export function safeString(v) {
  return String(v ?? "").trim();
}

/**
 * Normaliza aliases de tipo vindos de APIs/webhooks diferentes.
 * Mantém os tipos internos principais usados pela UI.
 */
export function normalizeMessageTipo(tipo) {
  const t = safeString(tipo).toLowerCase();
  if (t === "image") return "imagem";
  if (t === "vídeo") return "video";
  if (t === "document" || t === "file" || t === "documento") return "arquivo";
  if (t === "ptt") return "voice";
  if (t === "location_message" || t === "localizacao" || t === "localização") return "location";
  if (t === "contact_message" || t === "vcard" || t === "contato") return "contact";
  return t;
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
export function isFilenameOnlyText(texto, nomeArquivo) {
  if (!texto) return false;
  const t = String(texto).trim();
  if (!t) return false;
  const nome = String(nomeArquivo || "").trim();
  if (nome && t.toLowerCase() === nome.toLowerCase()) return true;
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
  if (/^chatgpt\s+image\b/i.test(baseNoExt)) return true;
  if (!/\s/.test(t)) return true;
  return false;
}

export function isOutgoingMessage(msg) {
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

const MEDIA_INLINE_CAPTION_PLACEHOLDERS = new Set([
  "(mídia)",
  "(mensagem vazia)",
  "(imagem)",
  "(áudio)",
  "(áudio de voz)",
  "(vídeo)",
  "(figurinha)",
  "(arquivo)",
]);

/** Mídia (foto/vídeo/figurinha) que já exibe legenda no próprio balão — não agrupar com texto seguinte. */
export function mediaHasInlineCaption(msg) {
  const t = normalizeMessageTipo(msg?.tipo);
  if (t !== "imagem" && t !== "video" && t !== "sticker") return false;
  const texto = safeString(msg?.texto);
  if (!texto || MEDIA_INLINE_CAPTION_PLACEHOLDERS.has(texto)) return false;
  if (isFilenameOnlyText(texto, msg?.nome_arquivo)) return false;
  return true;
}

/** Normaliza legenda para comparar eco webhook / mensagem de texto duplicada. */
export function normalizeCaptionForCompare(text) {
  let t = safeString(text);
  if (!t) return "";
  t = t.replace(/\n?—\s*.+$/s, "").trim();
  const lines = t.split("\n");
  if (lines.length >= 2) {
    const first = lines[0].trim().replace(/^\*+|\*+$/g, "").trim();
    const rest = lines.slice(1).join("\n").trim();
    if (rest && first.length > 0 && first.length <= 80) return rest;
  }
  return t;
}

/** Texto seguinte é eco da legenda já exibida na mídia anterior (evita duplicata visual). */
export function captionTextsEquivalent(prev, cur) {
  const a = safeString(prev?.texto);
  const b = safeString(cur?.texto);
  if (!a || !b) return false;
  const na = normalizeCaptionForCompare(a).toLowerCase();
  const nb = normalizeCaptionForCompare(b).toLowerCase();
  if (na && nb && na === nb) return true;
  return a.toLowerCase() === b.toLowerCase();
}

export function isMediaCaptionBundleTop(msg) {
  const t = normalizeMessageTipo(msg?.tipo);
  return t === "imagem" || t === "video";
}

export function isPlainCaptionFollowMessage(msg) {
  const t = normalizeMessageTipo(msg?.tipo);
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

export function messageHasReplyMeta(msg) {
  const rm = msg?.reply_meta;
  return !!(rm && (safeString(rm.name) || safeString(rm.snippet) || safeString(rm.thumb)));
}

export function sameCaptionBundleAuthor(prev, cur) {
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

export function captionFollowTimeOk(prev, cur) {
  const ta = new Date(prev?.criado_em).getTime();
  const tb = new Date(cur?.criado_em).getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return false;
  const deltaSec = (tb - ta) / 1000;
  return deltaSec >= 0 && deltaSec <= CAPTION_BUNDLE_MAX_SEC;
}

export function formatHoraCurta(ts) {
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

export function timelineEventLabel(a, conversaCtx) {
  const acao = safeString(a?.acao).toLowerCase();
  const quem = a?.usuario_nome || "Sistema";
  const paraQuem = a?.para_usuario_nome;
  if (acao === "assumiu") return `${quem} assumiu`;
  if (acao === "transferiu") return paraQuem ? `${quem} transferiu para ${paraQuem}` : `${quem} transferiu`;
  if (acao === "adicionou_atendente") return paraQuem ? `${quem} adicionou ${paraQuem} ao atendimento` : `${quem} adicionou atendente ao atendimento`;
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

export function initials(nome = "") {
  const parts = safeString(nome).split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const a = parts[0]?.[0] || "?";
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] : "";
  return (a + b).toUpperCase();
}

export function normalizeTelefone(v) {
  const raw = safeString(v);
  const digits = raw.replace(/\D+/g, "");
  return digits;
}

/** Badge do header: em_atendimento, fechada ou Aberta (só se exibir_badge_aberta). */
export function statusBadge(status, exibirBadgeAberta, finalizacaoMotivo) {
  const s = safeString(status).toLowerCase();
  const ausencia = safeString(finalizacaoMotivo).toLowerCase() === "ausencia_cliente";
  if (s === "aguardando_atendente") {
    return {
      text: "Aguardando atendente",
      bg: "rgba(245,158,11,0.12)",
      color: "#b45309",
      border: "rgba(245,158,11,0.22)",
      dot: "#d97706",
    };
  }
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
    variant: "aberta",
    bg: "rgba(6, 78, 59, 0.5)",
    color: "#6ee7b7",
    border: "rgba(16, 185, 129, 0.22)",
    dot: "#10b981",
  };
}

export function isImageFile(file) {
  if (!file) return false;
  const t = String(file.type || "").toLowerCase();
  if (t.startsWith("image/")) return true;
  const name = String(file.name || "").toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i.test(name);
}

/** Imagens estáticas editáveis no mobile (sem GIF/SVG). */
export function isEditableImageForSend(file) {
  if (!file || !isImageFile(file)) return false;
  const t = String(file.type || "").toLowerCase();
  if (t === "image/gif" || t.includes("svg")) return false;
  const name = String(file.name || "").toLowerCase();
  if (name.endsWith(".gif") || name.endsWith(".svg")) return false;
  return true;
}

export function isAudioFile(file) {
  if (!file) return false;
  const t = String(file.type || "").toLowerCase();
  if (t.startsWith("audio/")) return true;
  const name = String(file.name || "").toLowerCase();
  return /\.(mp3|ogg|wav|m4a|webm|aac|opus|amr)$/i.test(name);
}

export function isVideoFile(file) {
  if (!file) return false;
  const t = String(file.type || "").toLowerCase();
  if (t.startsWith("video/")) return true;
  const name = String(file.name || "").toLowerCase();
  return /\.(mp4|mov|webm|mkv|avi|3gp|m4v)$/i.test(name);
}

/** Alinhado ao backend `EXTENSOES_BLOQUEADAS_WHATSAPP` — WhatsApp costuma recusar. */
export const EXTENSOES_BLOQUEADAS_WHATSAPP = new Set([
  "exe",
  "msi",
  "apk",
  "bat",
  "cmd",
  "com",
  "scr",
  "ps1",
  "sh",
  "vbs",
  "reg",
  "dll",
  "jar",
]);

export function extensaoArquivoFromFile(file) {
  const name = String(file?.name || "").trim();
  const m = name.match(/\.([a-z0-9]{2,8})$/i);
  return m ? m[1].toLowerCase() : "";
}

export function isArquivoBloqueadoWhatsApp(file) {
  const ext = extensaoArquivoFromFile(file);
  return ext.length > 0 && EXTENSOES_BLOQUEADAS_WHATSAPP.has(ext);
}

export function mensagemArquivoBloqueadoWhatsApp(file) {
  const ext = extensaoArquivoFromFile(file);
  const label = ext ? `.${ext}` : "deste tipo";
  return (
    `Arquivos ${label} não podem ser enviados pelo WhatsApp (alto risco de bloqueio). ` +
    "Se precisar compartilhar, use um .zip com PDF, planilha ou documento permitido."
  );
}

function getApiOrigin() {
  try {
    const base = getApiBaseUrl().replace(/\/$/, "");
    return new URL(base.startsWith("http") ? base : `https://${base}`).origin;
  } catch {
    return "";
  }
}

/** Normaliza path relativo, blob ou URL absoluta para reprodução no host da API atual. */
export function resolveMediaUrlForPlayback(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (s.startsWith("blob:")) return s;
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      // Mensagem gravada com APP_URL de produção mas frontend apontando p/ API local (dev).
      if (u.pathname.startsWith("/uploads/")) {
        const apiOrigin = getApiOrigin();
        if (apiOrigin && u.origin !== apiOrigin) {
          return `${apiOrigin}${u.pathname}${u.search}${u.hash}`;
        }
      }
    } catch {
      /* mantém s */
    }
    return s;
  }
  const base = getApiBaseUrl().replace(/\/$/, "");
  return `${base}${s.startsWith("/") ? s : `/${s}`}`;
}

export function getMediaUrl(url, urlAbsoluta) {
  const absRaw = urlAbsoluta != null && String(urlAbsoluta).trim() !== "" ? String(urlAbsoluta).trim() : "";
  if (absRaw) return resolveMediaUrlForPlayback(absRaw);
  const urlRaw = url != null && String(url).trim() !== "" ? String(url).trim() : "";
  if (urlRaw) return resolveMediaUrlForPlayback(urlRaw);
  return "";
}

/** URLs candidatas para exibir mídia na bolha (blob local primeiro, depois servidor/proxy). */
export function resolveBubbleMediaCandidates(msg) {
  if (!msg || typeof msg !== "object") return [];
  const out = [];
  const seen = new Set();
  const push = (u) => {
    const s = String(u || "").trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };
  const pushResolved = (url, urlAbsoluta) => {
    const abs = getMediaUrl(url, urlAbsoluta);
    if (!abs) return;
    if (needsProxiedMediaPlayback(abs)) {
      push(getMediaPlaybackUrl(url, urlAbsoluta) || abs);
    }
    push(abs);
  };

  const blobCandidates = [
    msg?._optimisticBlobUrl,
    msg?.url,
    msg?.url_absoluta,
    msg?.media_url,
    msg?.mediaUrl,
    msg?.file_url,
    msg?.fileUrl,
    msg?.download_url,
    msg?.downloadUrl,
  ];
  for (const raw of blobCandidates) {
    if (String(raw || "").startsWith("blob:")) push(raw);
  }

  pushResolved(msg?.url, msg?.url_absoluta);
  pushResolved(msg?.media_url ?? msg?.mediaUrl, null);
  pushResolved(msg?.file_url ?? msg?.fileUrl, null);
  pushResolved(msg?.download_url ?? msg?.downloadUrl, null);

  return out;
}

/** URL exibível na bolha — prioriza preview local até haver fallback no componente. */
export function resolveBubbleMediaUrl(msg) {
  const candidates = resolveBubbleMediaCandidates(msg);
  return candidates[0] || "";
}

/** Candidatos de áudio prontos para `<audio>` — blob local primeiro, depois /uploads da API atual, depois proxy. */
export function resolveAudioPlaybackCandidates(msg) {
  if (!msg || typeof msg !== "object") return [];
  const out = [];
  const seen = new Set();
  const push = (u) => {
    const s = String(u || "").trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };

  for (const raw of resolveBubbleMediaCandidates(msg)) {
    if (String(raw).startsWith("blob:")) {
      push(raw);
      continue;
    }
    const resolved = resolveMediaUrlForPlayback(raw);
    if (!resolved) continue;
    if (needsProxiedMediaPlayback(resolved)) {
      push(getMediaPlaybackUrl(raw, raw) || resolved);
    }
    push(resolved);
  }
  return out;
}

function getAuthTokenFromStorage() {
  try {
    const raw = localStorage.getItem("zap_erp_auth");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.token ? String(parsed.token).trim() : null;
  } catch {
    return null;
  }
}

/** URLs externas (ex.: S3 UltraMsg) precisam do proxy autenticado para <video> reproduzir no CRM. */
export function needsProxiedMediaPlayback(absUrl) {
  const abs = String(absUrl || "").trim();
  if (!abs || abs.startsWith("blob:")) return false;
  if (!/^https?:\/\//i.test(abs)) return false;
  try {
    const u = new URL(abs);
    const baseRaw = getApiBaseUrl().replace(/\/$/, "");
    const api = new URL(baseRaw.startsWith("http") ? baseRaw : `https://${baseRaw}`);
    if (u.origin === api.origin && u.pathname.startsWith("/uploads/")) return false;
    return true;
  } catch {
    return /^https?:\/\//i.test(abs);
  }
}

export function getMediaPlaybackUrl(url, urlAbsoluta) {
  const abs = getMediaUrl(url, urlAbsoluta);
  if (!abs) return "";
  if (!needsProxiedMediaPlayback(abs)) return abs;
  const token = getAuthTokenFromStorage();
  const q = new URLSearchParams({ url: abs });
  if (token) q.set("access_token", token);
  return `${getApiBaseUrl().replace(/\/$/, "")}/media/proxy?${q.toString()}`;
}

export function credentialedFetchMode() {
  const v = String(import.meta.env.VITE_WITH_CREDENTIALS || "").trim().toLowerCase();
  return v === "1" || v === "true" ? "include" : "omit";
}

/** Baixa o arquivo com o mesmo JWT do `api` (evita <iframe src="API"> bloqueado por X-Frame-Options no servidor/proxy). */
export async function fetchMediaBinaryAuthenticated(absoluteUrl) {
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
export function mediaViewerSupportsPrint(viewerType, fileName) {
  const t = normalizeMessageTipo(viewerType);
  if (t === "video" || t === "imagem" || t === "sticker" || t === "figurinha") return true;
  if (t === "arquivo") {
    const fn = String(fileName || "").toLowerCase();
    return /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(fn);
  }
  return false;
}

export function fileToPreviewURL(file) {
  try {
    return URL.createObjectURL(file);
  } catch {
    return null;
  }
}

export function getAudioFilename(file) {
  const name = String(file?.name || "").trim();
  if (name) return name;
  const type = String(file?.type || "").toLowerCase();
  if (type.includes("ogg")) return `audio-${Date.now()}.ogg`;
  if (type.includes("mp3") || type.includes("mpeg")) return `audio-${Date.now()}.mp3`;
  if (type.includes("mp4") || type.includes("m4a")) return `audio-${Date.now()}.m4a`;
  return `audio-${Date.now()}.webm`;
}

const KNOWN_EXT_RE = /\.[a-z0-9]{2,8}(\?|#|$)/i;

/**
 * Tenta extrair um nome de arquivo com extensão de uma URL.
 * Suporta proxy URLs no formato /media/proxy?url=... (extrai da URL interna).
 */
function filenameFromUrl(urlStr) {
  if (!urlStr) return "";
  try {
    const u = new URL(String(urlStr), window.location.href);
    // Se é proxy, extrai da URL interna
    let pathname = u.pathname;
    if (pathname.includes("/proxy")) {
      const inner = u.searchParams.get("url");
      if (inner) {
        try {
          pathname = new URL(inner).pathname;
        } catch {
          /* usa pathname original */
        }
      }
    }
    const parts = pathname.split("/");
    const last = decodeURIComponent(parts[parts.length - 1] || "");
    if (last && KNOWN_EXT_RE.test(last)) return last.replace(/\?.*/, "");
  } catch {
    /* ignore */
  }
  return "";
}

/**
 * Resolve o melhor filename para download, com extensão correta.
 * Prioriza nome_arquivo do banco; fallback extrai da URL.
 */
export function resolveDownloadFilename(nomeArquivo, mediaUrl) {
  const nome = String(nomeArquivo || "").trim();
  if (nome && nome !== "Arquivo" && KNOWN_EXT_RE.test(nome)) return nome;

  const fromUrl = filenameFromUrl(mediaUrl);
  if (fromUrl) return fromUrl;

  // Mantém nome original mesmo sem extensão (melhor que "Arquivo")
  return nome || "Arquivo";
}

/**
 * Constrói URL de download via proxy autenticado com filename correto.
 * Garante que o backend defina Content-Disposition + Content-Type corretos.
 * Só usa o proxy para URLs externas (cross-origin); retorna a URL original para /uploads.
 */
export function buildMediaDownloadHref(rawUrl, rawUrlAbsoluta, filename) {
  const abs = getMediaUrl(rawUrl, rawUrlAbsoluta);
  if (!abs) return abs;

  // Proxy já está na URL (foi construído em getMediaPlaybackUrl)
  if (abs.includes("/media/proxy")) {
    try {
      const u = new URL(abs, window.location.href);
      if (filename) u.searchParams.set("filename", filename);
      u.searchParams.set("disposition", "attachment");
      return u.toString();
    } catch {
      return abs;
    }
  }

  // URL local (/uploads ou same-origin) — não precisa de proxy
  if (!needsProxiedMediaPlayback(abs)) return abs;

  // URL externa — roteia pelo proxy com filename + disposition=attachment
  const token = getAuthTokenFromStorage();
  const q = new URLSearchParams({ url: abs, disposition: "attachment" });
  if (token) q.set("access_token", token);
  if (filename) q.set("filename", filename);
  return `${getApiBaseUrl().replace(/\/$/, "")}/media/proxy?${q.toString()}`;
}


export function buildStickerStorageKey(user) {
  const companyId = user?.company_id ?? user?.empresa_id ?? user?.companyId ?? user?.empresaId ?? "default";
  const userId = user?.id ?? user?.user_id ?? user?.userId ?? "anon";
  return `wa_stickers_recent_${companyId}_${userId}`;
}

export function readRecentStickers(user) {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(buildStickerStorageKey(user));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeRecentStickers(user, list) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(buildStickerStorageKey(user), JSON.stringify(list.slice(0, STICKER_RECENTS_LIMIT)));
  } catch {
    /* ignore */
  }
}

export function toDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Falha ao ler arquivo."));
    reader.readAsDataURL(file);
  });
}

export function convertImageToWebp(file, quality = 0.9) {
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

/** Mídia cujo apagamento o usuário costuma querer evitar por engano (foto, vídeo, áudio, arquivo…). */
export function isRichMediaMessage(msg) {
  const tipo = normalizeMessageTipo(msg?.tipo);
  return ["imagem", "video", "sticker", "audio", "voice", "arquivo"].includes(tipo);
}

export function resolveConversaAvatarUrl(raw) {
  const s = raw != null ? String(raw).trim() : "";
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("data:")) return s;
  return getMediaUrl(s, null) || null;
}

export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/** Área visível com teclado virtual / barra do Safari — menus fixed devem usar isto no mobile. */
export function getVisualViewportLayout() {
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

export function formatMmSs(totalSeconds) {
  const s = Number(totalSeconds);
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const sec = Math.floor(s);
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

export function getFileExt(nome) {
  const s = String(nome || "").trim();
  const i = s.lastIndexOf(".");
  return i >= 0 ? s.slice(i + 1).toUpperCase().slice(0, 4) : "FILE";
}

export function formatFileSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function seedFromAny(v) {
  const s = String(v ?? "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function makeWaveBars(count, seed) {
  let x = seed || 1;
  const out = [];
  for (let i = 0; i < count; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    const r = (x >>> 0) / 4294967295;
    const v = 0.25 + 0.75 * Math.pow(r, 0.55);
    out.push(v);
  }
  return out;
}

export async function copyTextToClipboard(text) {
  const t = safeString(text);
  if (!t) return false;
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
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
