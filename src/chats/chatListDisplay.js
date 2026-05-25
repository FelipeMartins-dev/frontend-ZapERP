import { isGroupConversation } from "../utils/conversaUtils";

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
