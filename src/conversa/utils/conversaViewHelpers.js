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

export function isMediaCaptionBundleTop(msg) {
  const t = safeString(msg?.tipo).toLowerCase();
  return t === "imagem" || t === "video";
}

export function isPlainCaptionFollowMessage(msg) {
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

export function isImageFile(file) {
  if (!file) return false;
  const t = String(file.type || "").toLowerCase();
  if (t.startsWith("image/")) return true;
  const name = String(file.name || "").toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp)$/i.test(name);
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
  return /\.(mp3|ogg|wav|m4a|webm|aac|opus)$/i.test(name);
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

export function getMediaUrl(url, urlAbsoluta) {
  if (urlAbsoluta) return urlAbsoluta;
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  const base = getApiBaseUrl();
  return base.replace(/\/$/, "") + (url.startsWith("/") ? url : "/" + url);
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
  const t = String(viewerType || "").toLowerCase();
  if (t === "video" || t === "imagem" || t === "figurinha") return true;
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
  const tipo = safeString(msg?.tipo).toLowerCase();
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
