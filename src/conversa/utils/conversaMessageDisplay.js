import { getDisplayName } from "../../chats/chatList";
import { resolveContactMetaFromMessage } from "../../utils/conversaUtils";
import {
  safeString,
  isOutgoingMessage,
  isFilenameOnlyText,
  getMediaUrl,
  formatMmSs,
} from "./conversaViewHelpers";

export function isRichMediaMessage(msg) {
  const tipo = safeString(msg?.tipo).toLowerCase();
  return ["imagem", "video", "sticker", "audio", "voice", "arquivo"].includes(tipo);
}

export function snippetFromMsg(msg) {
  const contactResolved = resolveContactMetaFromMessage(msg);
  if (contactResolved?.nome) return contactResolved.nome;

  const tipo = safeString(msg?.tipo).toLowerCase();
  const t = safeString(msg?.texto);
  /* Não usar nome de arquivo gravado em `texto` como preview de mídia (reply / lista). */
  const skipTextoPorArquivoMidia =
    (tipo === "imagem" || tipo === "sticker" || tipo === "video") && t && isFilenameOnlyText(t);
  if (t && !skipTextoPorArquivoMidia) return t.length > 80 ? `${t.slice(0, 80)}…` : t;
  if (tipo === "audio" || tipo === "voice" || tipo === "ptt") {
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
export function pickReplyToIdForApi(msg) {
  if (!msg) return undefined;
  const source = msg?.mensagem && typeof msg.mensagem === "object" ? msg.mensagem : msg;
  const wa = source.whatsapp_id != null && String(source.whatsapp_id).trim() !== "" ? String(source.whatsapp_id).trim() : null;
  if (wa) return wa;
  if (source.id != null && source.id !== "") return source.id;
  return undefined;
}

/** Monta reply_meta para API + localStorage (inclui miniatura em foto/figurinha). */
export function buildReplyMetaForPersist(replyTo, nome, chat) {
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
export function replySnippetDisplay(rm) {
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

export function getReplySenderLabel(replyMsg, peerName, chat) {
  const contactDisplayName = chat ? getDisplayName(chat) : null;
  if (!replyMsg) return contactDisplayName || "Contato";
  const out = isOutgoingMessage(replyMsg);
  if (out) return "Você";
  const groupSender = safeString(replyMsg?.remetente_nome || replyMsg?.remetente_telefone);
  if (groupSender) return groupSender;
  const contactName = safeString(peerName) || contactDisplayName;
  return contactName || "Contato";
}

export function nameColor(seed) {
  const s = String(seed || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 70% 42%)`;
}
