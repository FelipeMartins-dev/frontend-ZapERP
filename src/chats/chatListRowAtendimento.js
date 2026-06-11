import {
  isGroupConversation,
  getStatusAtendimentoEffective,
  isAguardandoClienteManual,
  isCobrancaFinanceiraStatus,
} from "../utils/conversaUtils";
import { getContactDisplay } from "./chatListDisplay";

/** Preferências por item (API pode enviar `silenciada` ou `silenciado`). */
export function rowPrefs(c) {
  return {
    silenciado: !!(c?.silenciado ?? c?.silenciada),
    fixada: !!c?.fixada,
    favorita: !!c?.favorita,
  };
}

export const EMPTY_PENDENTES_SET = new Set();

export function getLastMessage(chat) {
  const msgs = chat?.mensagens || chat?.messages || [];
  if (!Array.isArray(msgs) || msgs.length === 0) return null;
  return msgs[msgs.length - 1];
}

function normalizeDirection(v) {
  const d = String(v || "").toLowerCase().trim();
  if (!d) return "";
  if (d === "inbound" || d === "recebida" || d === "entrada") return "in";
  if (d === "outbound" || d === "enviada" || d === "saida") return "out";
  return d;
}

function directionCandidateTs(iso) {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Última direção pela mensagem mais recente (preview, ultima_mensagem, mensagens[0], fallback). */
export function getLastDirection(chat) {
  const candidates = [];
  const push = (dir, criadoEm) => {
    const d = normalizeDirection(dir);
    if (!d) return;
    candidates.push({ dir: d, ts: directionCandidateTs(criadoEm) });
  };

  const preview = chat?.ultima_mensagem_preview;
  const ultima = chat?.ultima_mensagem;
  const m0 = chat?.mensagens?.[0] ?? chat?.messages?.[0];
  const last = getLastMessage(chat);

  push(preview?.direcao, preview?.criado_em);
  push(ultima?.direcao, ultima?.criado_em);
  push(m0?.direcao, m0?.criado_em);
  push(last?.direcao, last?.criado_em);

  if (!candidates.length) return "";

  let best = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    if (candidates[i].ts >= best.ts) best = candidates[i];
  }
  return best.dir;
}

/** Timestamp da última mensagem visível na lista (preview > mensagens[0] > última). */
export function getListaUltimaMensagemCriadoEm(c) {
  if (!c) return null;
  const p = c?.ultima_mensagem_preview?.criado_em;
  if (p) return String(p).trim() || null;
  const m0 = c?.mensagens?.[0]?.criado_em;
  if (m0) return String(m0).trim() || null;
  const last = getLastMessage(c)?.criado_em;
  return last ? String(last).trim() || null : null;
}

export function isConversaAguardandoCliente(c) {
  if (!c || c?.atendente_id == null) return false;
  if (isAguardandoClienteManual(c)) return true;
  return (
    getStatusAtendimentoEffective(c) === "em_atendimento" &&
    c?.aguardando_cliente_desde != null
  );
}

export function isConversaEmAtendimentoBadge(c) {
  if (!c || c?.atendente_id == null) return false;
  const s = getStatusAtendimentoEffective(c);
  return s === "em_atendimento" || s === "aguardando_cliente";
}

export function isConversaPagamentoPendente(c) {
  if (!c || c?.atendente_id == null) return false;
  return getStatusAtendimentoEffective(c) === "pagamento_pendente";
}

export function isConversaEmAtrasoPagamento(c) {
  if (!c || c?.atendente_id == null) return false;
  return getStatusAtendimentoEffective(c) === "em_atraso";
}

/**
 * Cliente foi o último a falar (ou há novas mensagens) e a equipe deve responder.
 */
function cobrancaFinanceiraPorUltimaMensagem(c) {
  const st = getStatusAtendimentoEffective(c);
  if (st !== "pagamento_pendente" && st !== "em_atraso") return null;
  if (c?.atendente_id == null) return null;
  const lastDir = getLastDirection(c);
  const unread = Number(c?.unread_count ?? c?.unread ?? 0);
  const hintNovaMsg =
    !lastDir && (Boolean(c?.tem_novas_mensagens_em_atendimento) || unread > 0);
  if (lastDir === "in" || hintNovaMsg) return "funcionario";
  if (lastDir === "out") return "cliente";
  return null;
}

/** Cobrança: última mensagem foi da equipe → etiqueta Aguardando cliente. */
export function isConversaAguardandoClienteEmCobranca(c) {
  return cobrancaFinanceiraPorUltimaMensagem(c) === "cliente";
}

export function isConversaAguardandoFuncionario(c, pendentesIdSet) {
  if (!c || isGroupConversation(c)) return false;
  if (c?.id != null && pendentesIdSet?.has?.(String(c.id))) return true;
  if (c?.atendente_id == null) return false;

  const cobranca = cobrancaFinanceiraPorUltimaMensagem(c);
  if (cobranca === "funcionario") return true;
  if (cobranca === "cliente") return false;

  if (getStatusAtendimentoEffective(c) !== "em_atendimento") return false;
  if (isConversaAguardandoCliente(c)) return false;
  const lastDir = getLastDirection(c);
  const unread = Number(c?.unread_count ?? c?.unread ?? 0);
  const hintNovaMsg =
    !lastDir && (Boolean(c?.tem_novas_mensagens_em_atendimento) || unread > 0);
  return lastDir === "in" || hintNovaMsg;
}

export function atendimentoRowVisualClass(c, pendentesIdSet, semConversaRow, currentUserId) {
  if (!c || semConversaRow || isGroupConversation(c)) return "";
  const isResponsavel =
    currentUserId != null &&
    c?.atendente_id != null &&
    String(c.atendente_id) === String(currentUserId);
  const stAt = getStatusAtendimentoEffective(c);
  const isHumanAtendimentoRow =
    stAt === "em_atendimento" ||
    stAt === "aguardando_cliente" ||
    isCobrancaFinanceiraStatus(c);
  const lastDir = getLastDirection(c);
  const unread = Number(c?.unread_count ?? c?.unread ?? 0);
  const hintNovaMsg =
    !lastDir &&
    (Boolean(c?.tem_novas_mensagens_em_atendimento) || unread > 0);
  const showAtendimentoDot =
    isResponsavel &&
    isHumanAtendimentoRow &&
    (lastDir === "in" || hintNovaMsg);

  if (isConversaAguardandoFuncionario(c, pendentesIdSet) || showAtendimentoDot) {
    return "chat-list-row--atendimento-alerta";
  }
  if (isConversaEmAtendimentoBadge(c)) return "chat-list-row--atendimento-calm";
  return "";
}

export function isEmAtendimentoUltimaDoCliente(c) {
  if (!c || isGroupConversation(c)) return false;
  if (c?.atendente_id == null) return false;
  if (cobrancaFinanceiraPorUltimaMensagem(c) === "funcionario") return true;
  if (getStatusAtendimentoEffective(c) !== "em_atendimento") return false;
  if (isConversaAguardandoCliente(c)) return false;
  const lastDir = getLastDirection(c);
  const unread = Number(c?.unread_count ?? c?.unread ?? 0);
  const hintNovaMsg =
    !lastDir &&
    (Boolean(c?.tem_novas_mensagens_em_atendimento) || unread > 0);
  return lastDir === "in" || hintNovaMsg;
}

export function getEsperaMinutosAnchorIso(c, pendentesIdSet) {
  if (!c || isGroupConversation(c)) return "";
  if (c?.atendente_id == null) return "";
  const st = getStatusAtendimentoEffective(c);
  const cobrancaStaff = st === "pagamento_pendente" || st === "em_atraso";
  if (!cobrancaStaff && st !== "em_atendimento") return "";
  if (!cobrancaStaff && isConversaAguardandoCliente(c)) return "";
  if (!isConversaAguardandoFuncionario(c, pendentesIdSet)) return "";

  const lastDir = getLastDirection(c);
  const previewDir = normalizeDirection(c?.ultima_mensagem_preview?.direcao);
  const lastMsgTs = getListaUltimaMensagemCriadoEm(c);
  const ultimaAtiv = c?.ultima_atividade != null ? String(c.ultima_atividade).trim() : "";
  const pendenteSupervisor = c?.id != null && pendentesIdSet?.has?.(String(c.id));

  let anchorIso = "";
  if ((lastDir === "in" || previewDir === "in") && lastMsgTs) anchorIso = lastMsgTs;
  else if (pendenteSupervisor && ultimaAtiv) anchorIso = ultimaAtiv;
  else anchorIso = ultimaAtiv || lastMsgTs || "";

  return anchorIso ? String(anchorIso).trim() : "";
}

export function esperaMinutosAnchorKey(c, pendentesIdSet) {
  return getEsperaMinutosAnchorIso(c, pendentesIdSet);
}

/** Espaço vertical entre cards na lista (espelha --cl-chat-row-gap). */
export const CHAT_LIST_ROW_GAP = 1;

/** Métricas espelhadas do chatList.css — lista virtual usa altura fixa por item (sem measureElement). */
const VIRTUAL_ROW_METRICS = {
  desktop: {
    padY: 26,
    avatar: 48,
    titleLine: 17.5,
    setor: 15,
    empresa: 15,
    preview: 17,
    mainGap: 2,
    badgeGridExtra: 0,
    statusSubLine: 18,
    minRow: 76,
    titleWrapWidth: 210,
  },
  mobile: {
    padY: 30,
    avatar: 56,
    titleLine: 19.5,
    setor: 15,
    empresa: 15,
    preview: 20,
    mainGap: 6,
    badgeGridExtra: 33,
    statusSubLine: 20,
    minRow: 84,
    titleWrapWidth: 168,
  },
};

function estimateTitleLineCount(name, extraInlinePx, titleWrapWidth) {
  const text = String(name || "").trim();
  if (!text) return 1;
  const usable = Math.max(96, titleWrapWidth - extraInlinePx);
  const charsPerLine = Math.max(10, Math.floor(usable / 7.4));
  return Math.min(2, Math.ceil(text.length / charsPerLine));
}

function chatRowUsesMobileBadgeGrid(chat, pendentesIdSet) {
  const status = getStatusAtendimentoEffective(chat);
  const awaitClient =
    status === "aguardando_cliente" || isConversaAguardandoCliente(chat);
  const awaitStaff = isConversaAguardandoFuncionario(chat, pendentesIdSet);
  return awaitClient || awaitStaff;
}

function estimateMetaColumnHeight(chat, pendentesIdSet, isMobileLayout) {
  if (isMobileLayout && chatRowUsesMobileBadgeGrid(chat, pendentesIdSet)) return 0;

  const status = getStatusAtendimentoEffective(chat);
  let badge = 22;
  if (
    status === "aguardando_cliente" ||
    isConversaAguardandoCliente(chat) ||
    isConversaAguardandoFuncionario(chat, pendentesIdSet)
  ) {
    badge = 28;
  } else if (status === "pagamento_pendente" || status === "em_atraso") {
    badge = 40;
  } else if (status === "fechada" && String(chat?.finalizacao_motivo) === "ausencia_cliente") {
    badge = 26;
  }

  return 14 + 4 + badge;
}

/**
 * Altura fixa por card na virtualização — calculada pelo conteúdo (título até 2 linhas, setor, badges).
 * Deve ser >= altura real; measureElement fica desligado para o layout não “pular” após abrir/atualizar.
 */
export function estimateChatListRowSize(chat, isMobileLayout, pendentesIdSet = null) {
  const m = isMobileLayout ? VIRTUAL_ROW_METRICS.mobile : VIRTUAL_ROW_METRICS.desktop;
  if (!chat) return m.minRow;

  const { displayName, isGroup } = getContactDisplay(chat);
  const prefs = rowPrefs(chat);
  let inlineExtra = 0;
  if (prefs.silenciado) inlineExtra += 18;
  if (prefs.fixada) inlineExtra += 18;
  if (prefs.favorita) inlineExtra += 18;
  if (isGroup || chat?.tags?.[0]) inlineExtra += 44;

  const titleLines = estimateTitleLineCount(displayName, inlineExtra, m.titleWrapWidth);
  const hasSetor =
    !isGroup && chat?.departamento_id != null
      ? Boolean(
          String(chat.setor ?? chat?.departamento?.nome ?? chat?.departamentos?.nome ?? "").trim()
        )
      : false;
  const hasEmpresa = !isGroup
    ? Boolean(String(chat?.cliente?.empresa ?? chat?.cliente_empresa ?? chat?.empresa ?? "").trim())
    : false;

  let titleBlock = titleLines * m.titleLine;
  if (hasSetor) titleBlock += m.setor;
  if (hasEmpresa) titleBlock += m.empresa;

  const metaCol = estimateMetaColumnHeight(chat, pendentesIdSet, isMobileLayout);
  const mobileBadgeGrid = isMobileLayout && chatRowUsesMobileBadgeGrid(chat, pendentesIdSet);
  let topBlock = titleBlock;
  if (mobileBadgeGrid) {
    topBlock = titleLines * m.titleLine + (hasSetor ? m.setor : 0) + (hasEmpresa ? m.empresa : 0) + m.badgeGridExtra;
  } else if (metaCol > 0) {
    topBlock = Math.max(titleBlock, metaCol);
  }

  let mainBlock = topBlock + m.mainGap + m.preview;

  const status = getStatusAtendimentoEffective(chat);
  if (
    status === "em_atendimento" &&
    typeof chat?.ui_hint_reaberto_ausencia_cliente === "number" &&
    Date.now() - chat.ui_hint_reaberto_ausencia_cliente < 120000 &&
    !mobileBadgeGrid
  ) {
    mainBlock += m.statusSubLine;
  }

  let rowHeight = Math.max(m.avatar, mainBlock) + m.padY;
  rowHeight = Math.max(rowHeight, m.minRow);

  if (mobileBadgeGrid) rowHeight = Math.max(rowHeight, isMobileLayout ? 96 : 80);
  if (hasSetor && status === "em_atendimento" && chat?.atendente_id != null) {
    rowHeight = Math.max(rowHeight, isMobileLayout ? 96 : 80);
  }

  return Math.ceil(rowHeight) + 3;
}
