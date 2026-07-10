import { getStatusAtendimentoEffective } from "../utils/conversaUtils";
import { getContactDisplay } from "./chatListDisplay";
import {
  rowPrefs,
  getLastMessage,
  getLastDirection,
  getListaUltimaMensagemCriadoEm,
  isConversaAguardandoFuncionario,
  atendimentoRowVisualClass,
  isEmAtendimentoUltimaDoCliente,
  esperaMinutosAnchorKey,
} from "./chatListRowAtendimento";
import { ultimaMensagemOutboundStatusKey } from "./chatListStoreCompare";

function normalizeDirection(v) {
  const d = String(v || "").toLowerCase().trim();
  if (!d) return "";
  if (d === "inbound" || d === "recebida" || d === "entrada") return "in";
  if (d === "outbound" || d === "enviada" || d === "saida") return "out";
  return d;
}

/** Chave estável para preview/hora da última mensagem (comparador MemoChatRow). */
export function chatRowLastPreviewKey(c) {
  const ultima = c?.ultima_mensagem || c?.ultima_mensagem_preview;
  const last = ultima || getLastMessage(c);
  if (!last) return "";
  const tipo = String(last?.tipo || "").toLowerCase();
  const txt = String(last?.conteudo || last?.body || last?.texto || "").trim();
  const url = String(last?.url_absoluta || last?.url || "");
  const criado = String(last?.criado_em || "");
  const dir = normalizeDirection(last?.direcao);
  return `${criado}|${dir}|${tipo}|${txt}|${url}`;
}

/** Nome, avatar, setor, empresa e tag visíveis no card (comparador MemoChatRow). */
export function chatRowContactSurfaceKey(c) {
  if (!c) return "";
  const { displayName, avatarUrl, phone } = getContactDisplay(c);
  const empresa = String(c?.cliente?.empresa ?? c?.cliente_empresa ?? c?.empresa ?? "").trim();
  const setor = String(c?.setor ?? c?.departamento?.nome ?? c?.departamentos?.nome ?? "").trim();
  const tag = c?.tags?.[0];
  const tagId = String(tag?.id ?? "");
  const tagNome = String(tag?.nome ?? "");
  const tagCor = String(tag?.cor ?? "");
  const instanceLabel = String(c?.whatsapp_instance_nome ?? c?.whatsapp_instance_display_phone ?? "").trim();
  return `${displayName}|${avatarUrl ?? ""}|${phone}|${empresa}|${setor}|${String(c?.departamento_id ?? "")}|${tagId}|${tagNome}|${tagCor}|${instanceLabel}`;
}

function chatRowNeedsMinuteTick(c, pendentesFuncionarioSet) {
  if (!c) return false;
  const status = String(getStatusAtendimentoEffective(c));
  if (status === "pagamento_pendente") return true;
  if (typeof c?.ui_hint_reaberto_ausencia_cliente === "number") return true;
  return Boolean(esperaMinutosAnchorKey(c, pendentesFuncionarioSet));
}

export function chatRowPropsAreEqual(prev, next) {
  if (prev.showWhatsappInstanceUi !== next.showWhatsappInstanceUi) return false;
  const a = prev.chat || {};
  const b = next.chat || {};
  const pa = rowPrefs(a);
  const pb = rowPrefs(b);
  const semA = Boolean(a.sem_conversa && a.cliente_id);
  const semB = Boolean(b.sem_conversa && b.cliente_id);
  const setA = prev.pendentesFuncionarioSet;
  const setB = next.pendentesFuncionarioSet;
  const needsMinuteTick = chatRowNeedsMinuteTick(a, setA) || chatRowNeedsMinuteTick(b, setB);
  if (needsMinuteTick && prev.minuteTick !== next.minuteTick) return false;
  const identityOk =
    semA && semB
      ? String(a.cliente_id) === String(b.cliente_id)
      : !semA && !semB
        ? String(a.id) === String(b.id)
        : false;
  return (
    identityOk &&
    prev.active === next.active &&
    prev.onSelect === next.onSelect &&
    prev.onOpenClienteSemConversa === next.onOpenClienteSemConversa &&
    prev.onToggleMenu === next.onToggleMenu &&
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
    String(getListaUltimaMensagemCriadoEm(a) ?? "") === String(getListaUltimaMensagemCriadoEm(b) ?? "") &&
    String(a?.ultima_mensagem?.id ?? a?.ultima_mensagem?.whatsapp_id ?? "") ===
      String(b?.ultima_mensagem?.id ?? b?.ultima_mensagem?.whatsapp_id ?? "") &&
    String(a?.modo_simples_aguardando ?? "") === String(b?.modo_simples_aguardando ?? "") &&
    Boolean(a?.atendimento_modo_simples) === Boolean(b?.atendimento_modo_simples) &&
    Boolean(a?.lida) === Boolean(b?.lida) &&
    Boolean(a?.tem_novas_mensagens) === Boolean(b?.tem_novas_mensagens) &&
    ultimaMensagemOutboundStatusKey(a) === ultimaMensagemOutboundStatusKey(b) &&
    chatRowLastPreviewKey(a) === chatRowLastPreviewKey(b) &&
    chatRowContactSurfaceKey(a) === chatRowContactSurfaceKey(b) &&
    semA === semB &&
    setA === setB &&
    isConversaAguardandoFuncionario(a, setA) === isConversaAguardandoFuncionario(b, setB) &&
    esperaMinutosAnchorKey(a, setA) === esperaMinutosAnchorKey(b, setB) &&
    prev.currentUserId === next.currentUserId &&
    atendimentoRowVisualClass(a, setA, semA, prev.currentUserId) ===
      atendimentoRowVisualClass(b, setB, semB, next.currentUserId) &&
    isEmAtendimentoUltimaDoCliente(a) === isEmAtendimentoUltimaDoCliente(b)
  );
}
