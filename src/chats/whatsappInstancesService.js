import api from "../api/http";

/** GET /chats/whatsapp-instances — instâncias ativas (sem tokens). */
export async function fetchWhatsappInstancesAtendimento(options = {}) {
  const { data } = await api.get("/chats/whatsapp-instances", {
    signal: options.signal,
    silent: options.silent === true,
  });
  const list = data?.instances ?? data ?? [];
  return Array.isArray(list) ? list : [];
}

export function whatsappInstanceLabel(inst) {
  if (!inst || typeof inst !== "object") return "";
  return String(inst.nome || inst.display_phone || "").trim();
}
