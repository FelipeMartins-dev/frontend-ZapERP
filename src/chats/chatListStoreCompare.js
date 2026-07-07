import { getStatusAtendimentoEffective } from "../utils/conversaUtils";
import { chatRowContactSurfaceKey, chatRowLastPreviewKey } from "./chatListRowCompare";
import {
  rowPrefs,
  getLastDirection,
  getListaUltimaMensagemCriadoEm,
} from "./chatListRowAtendimento";

/**
 * Assinatura leve de um chat na store — campos que afetam card, ordem e filtros laterais.
 * Usado para evitar set() quando merge não altera estado visível.
 */
export function chatRowListStoreKey(c) {
  if (!c) return "";
  const pa = rowPrefs(c);
  const parts = [
    String(c.id ?? ""),
    String(c.cliente_id ?? ""),
    Boolean(c.sem_conversa),
    Number(c.unread_count ?? c.unread ?? 0),
    String(getStatusAtendimentoEffective(c)),
    String(c.status_atendimento_real ?? ""),
    String(c.finalizacao_motivo ?? ""),
    Boolean(c.finalizada_automaticamente),
    String(c.aguardando_cliente_desde ?? ""),
    String(c.ui_hint_reaberto_ausencia_cliente ?? ""),
    Boolean(c.exibir_badge_aberta),
    pa.silenciado,
    pa.fixada,
    pa.favorita,
    Boolean(c.tem_novas_mensagens),
    Boolean(c.lida),
    Boolean(c.tem_novas_mensagens_em_atendimento),
    String(c.atendente_id ?? ""),
    String(c.atendente_nome ?? ""),
    String(c.whatsapp_instance_id ?? ""),
    String(c.whatsapp_instance_nome ?? ""),
    String(c.departamento_id ?? ""),
    getLastDirection(c),
    String(c.ultima_atividade ?? ""),
    String(getListaUltimaMensagemCriadoEm(c) ?? ""),
    String(c?.ultima_mensagem?.id ?? c?.ultima_mensagem?.whatsapp_id ?? ""),
    String(c?.modo_simples_aguardando ?? ""),
    Boolean(c?.atendimento_modo_simples),
    Boolean(c?.lida),
    chatRowLastPreviewKey(c),
    chatRowContactSurfaceKey(c),
  ];
  return parts.join("\x1e");
}

export function chatRowStoreMergeUnchanged(cur, merged) {
  if (!cur || !merged) return false;
  return chatRowListStoreKey(cur) === chatRowListStoreKey(merged);
}

/** Mesma ordem de ids e mesma assinatura por linha. */
export function chatListsStoreEquivalent(prev, next) {
  if (prev === next) return true;
  if (!Array.isArray(prev) || !Array.isArray(next)) return false;
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i++) {
    if (String(prev[i]?.id) !== String(next[i]?.id)) return false;
    if (chatRowListStoreKey(prev[i]) !== chatRowListStoreKey(next[i])) return false;
  }
  return true;
}

export function chatListIdsInOrder(list) {
  if (!Array.isArray(list)) return "";
  return list.map((c) => String(c?.id ?? "")).join(",");
}

/** Status normalizado para ticks (lista + guards de status_mensagem). */
export function normalizeMensagemStatusKey(m) {
  if (!m) return "";
  return String(m?.status_mensagem ?? m?.status ?? "")
    .toLowerCase()
    .trim();
}

/** Mesma mensagem lógica na última linha (id ou whatsapp_id). */
export function ultimaMensagemRefsEqual(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const idA = a.id != null && String(a.id).trim() !== "" ? String(a.id) : null;
  const idB = b.id != null && String(b.id).trim() !== "" ? String(b.id) : null;
  if (idA && idB && idA === idB) return true;
  const waA = a.whatsapp_id != null && String(a.whatsapp_id).trim() !== "" ? String(a.whatsapp_id) : null;
  const waB = b.whatsapp_id != null && String(b.whatsapp_id).trim() !== "" ? String(b.whatsapp_id) : null;
  if (waA && waB && waA === waB) return true;
  return false;
}

/** Ticks outbound na última mensagem do card (só direção out). */
export function ultimaMensagemOutboundStatusKey(c) {
  const u = c?.ultima_mensagem || c?.ultima_mensagem_preview;
  if (!u) return "";
  const d = String(u?.direcao || "").toLowerCase().trim();
  const isOut =
    d === "out" ||
    d === "outbound" ||
    d === "enviada" ||
    d === "enviado" ||
    u?.fromMe === true ||
    u?.from_me === true;
  if (!isOut) return "";
  return normalizeMensagemStatusKey(u);
}
