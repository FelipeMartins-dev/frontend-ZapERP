import { isGroupConversation } from "../utils/conversaUtils";
import { getApiBaseUrl } from "../api/baseUrl";

/**
 * Aceita tanto URLs absolutas quanto caminhos devolvidos pela API.
 * Algumas integrações persistem a foto como `/uploads/...` ou `uploads/...`;
 * descartar esses valores fazia o card cair nas iniciais mesmo com foto válida.
 */
export function resolveAvatarUrl(raw) {
  const value = raw == null ? "" : String(raw).trim();
  if (!value || value.toLowerCase() === "null" || value.toLowerCase() === "undefined") return null;
  if (/^https?:\/\//i.test(value) || value.startsWith("blob:") || value.startsWith("data:image/")) {
    return value;
  }
  if (value.startsWith("//")) {
    const protocol = typeof window !== "undefined" && window.location?.protocol
      ? window.location.protocol
      : "https:";
    return `${protocol}${value}`;
  }
  const base = getApiBaseUrl().replace(/\/$/, "");
  return `${base}${value.startsWith("/") ? value : `/${value}`}`;
}

function getAvatarCandidates(chat) {
  const isGroup = isGroupConversation(chat);
  return isGroup
    ? [chat?.foto_grupo, chat?.group_photo, chat?.photo_url, chat?.avatar_url]
    : [
        chat?.foto_perfil,
        chat?.foto_perfil_contato_cache,
        chat?.cliente?.foto_perfil,
        chat?.clientes?.foto_perfil,
        chat?.foto,
        chat?.photo_url,
        chat?.avatar_url,
        chat?.avatar,
      ];
}

function firstAvatarUrl(chat) {
  for (const candidate of getAvatarCandidates(chat)) {
    const resolved = resolveAvatarUrl(candidate);
    if (resolved) return resolved;
  }
  return null;
}

/** Mantém a foto já carregada quando um refresh parcial da lista volta sem esse campo. */
export function pickPreferredAvatarUrl(incoming, existing) {
  return firstAvatarUrl(incoming) ?? firstAvatarUrl(existing) ?? null;
}

/** Uma só fonte: telefone no topo. Nunca exibir LID (lid:xxx) — backend envia telefone_exibivel null nesses casos. */
export function getPhone(chat) {
  const tel = chat?.telefone_exibivel ?? chat?.cliente_telefone ?? chat?.telefone ?? chat?.numero ?? chat?.phone ?? chat?.wa_id ?? "";
  const s = String(tel || "").trim();
  if (s.toLowerCase().startsWith("lid:")) return "";
  return s;
}

export function formatPhoneForDisplay(phone) {
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
  const tel = getPhone(chat);
  return tel ? formatPhoneForDisplay(tel) : "Contato";
}

/**
 * Par nome + foto. foto_perfil: só usa se URL http válida; null → avatar padrão.
 * Grupos: foto_grupo ou fallback. Layout não quebra quando foto_perfil é null.
 */
export function getContactDisplay(chat) {
  const isGroup = isGroupConversation(chat);
  const displayName = getDisplayName(chat);
  const phone = formatPhoneForDisplay(chat?.telefone_exibivel ?? chat?.telefone ?? chat?.cliente_telefone ?? chat?.numero ?? "");
  const avatarUrl = firstAvatarUrl(chat);
  return { displayName, avatarUrl, phone, isGroup };
}

/** True se o valor pode ser normalizado para uma fonte utilizável no <img> do card. */
export function isHttpAvatarUrl(url) {
  return Boolean(resolveAvatarUrl(url));
}

/**
 * Trava a foto do card por identidade da conversa.
 * Anti-flicker: não descartar URL válida quando o payload vem sem foto (null).
 * B03: aceita URL http nova (foto atualizada via sync/contato_atualizado).
 *
 * @param {{ identity: string|null, url: string|null }} locked
 * @param {string} identity - ex.: conv:123
 * @param {string|null} incomingUrl
 * @returns {{ identity: string, url: string|null }}
 */
export function lockCardAvatarUrl(locked, identity, incomingUrl) {
  const id = identity != null ? String(identity) : "";
  const next = resolveAvatarUrl(incomingUrl);
  if (!id) return { identity: "", url: next };
  if (!locked || locked.identity !== id) {
    return { identity: id, url: next };
  }
  // Mantém a foto atual se o store veio sem URL (evita pulo null ↔ CDN).
  if (!next && isHttpAvatarUrl(locked.url)) {
    return locked;
  }
  return { identity: id, url: next };
}
