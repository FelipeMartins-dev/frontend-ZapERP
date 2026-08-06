import {
  isGroupConversation,
  getStatusAtendimentoEffective,
  isAguardandoClienteManual,
  isCobrancaFinanceiraStatus,
  isModoSimplesAguardandoAtendente,
  isModoSimplesAguardandoCliente,
  resolveModoSimplesAguardandoEffective,
} from "../utils/conversaUtils";
import { parseToDate } from "../conversa/utils/conversaViewHelpers";
import { getContactDisplay } from "./chatListDisplay";

/** Timestamp em ms alinhado ao horário exibido no card (ISO sem TZ = UTC, como no Supabase). */
function toChatListTimestampMs(raw) {
  if (raw == null || raw === "") return 0;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  const d = parseToDate(raw);
  if (!d) return 0;
  const t = d.getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Preferências por item (API pode enviar `silenciada` ou `silenciado`). */
export function rowPrefs(c) {
  return {
    silenciado: !!(c?.silenciado ?? c?.silenciada),
    fixada: !!c?.fixada,
    favorita: !!c?.favorita,
  };
}

export const EMPTY_PENDENTES_SET = new Set();

function cleanAssigneeName(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.replace(/\s+/g, " ");
}

function getAssigneeId(item) {
  return item?.usuario_id ?? item?.user_id ?? item?.atendente_id ?? item?.id ?? null;
}

function getAssigneeNameFromItem(item, currentUserId, currentUserName) {
  const id = getAssigneeId(item);
  const currentName =
    currentUserId != null &&
    id != null &&
    String(id) === String(currentUserId)
      ? cleanAssigneeName(currentUserName)
      : "";

  return (
    cleanAssigneeName(
      item?.nome ??
        item?.name ??
        item?.usuario_nome ??
        item?.user_nome ??
        item?.atendente_nome ??
        item?.responsavel_nome ??
        item?.email
    ) ||
    currentName
  );
}

function collectAssigneeItems(c) {
  const sources = [
    c?.atendentes,
    c?.usuarios_atendimento,
    c?.atendimento_usuarios,
    c?.responsaveis,
    c?.usuarios,
  ];
  return sources.find((items) => Array.isArray(items) && items.length > 0) || [];
}

export function getAtendimentoAssigneeNames(c, currentUserId = null, currentUserName = "") {
  if (!c || isGroupConversation(c)) return [];

  const byKey = new Map();
  const pushName = (name, id = null) => {
    const clean = cleanAssigneeName(name);
    if (!clean) return;
    const key = id != null ? `id:${String(id)}` : `name:${clean.toLowerCase()}`;
    if (!byKey.has(key)) byKey.set(key, clean);
  };

  for (const item of collectAssigneeItems(c)) {
    if (!item || typeof item !== "object") continue;
    pushName(getAssigneeNameFromItem(item, currentUserId, currentUserName), getAssigneeId(item));
  }

  const atendenteId = c?.atendente_id ?? c?.responsavel_id ?? null;
  const atendenteNome =
    cleanAssigneeName(
      c?.atendente_nome ??
        c?.atendente?.nome ??
        c?.atendente?.name ??
        c?.responsavel_nome ??
        c?.responsavel?.nome ??
        c?.responsavel?.name
    ) ||
    (currentUserId != null && atendenteId != null && String(atendenteId) === String(currentUserId)
      ? cleanAssigneeName(currentUserName)
      : "");

  pushName(atendenteNome, atendenteId);

  return Array.from(byKey.values()).slice(0, 3);
}

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
  return toChatListTimestampMs(iso);
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

function messageTs(msg) {
  if (!msg) return 0;
  return toChatListTimestampMs(msg.criado_em);
}

/** Escolhe a mensagem com `criado_em` mais recente entre candidatos. */
export function pickListaUltimaMensagem(c) {
  if (!c) return null;
  const candidates = [
    c?.ultima_mensagem,
    c?.ultima_mensagem_preview,
    c?.mensagens?.[0],
    c?.messages?.[0],
    getLastMessage(c),
  ].filter(Boolean);
  return pickNewerMessage(...candidates);
}

/** Entre várias mensagens, retorna a de timestamp mais recente. */
export function pickNewerMessage(...msgs) {
  let best = null;
  for (const m of msgs) {
    if (!m) continue;
    if (!best || messageTs(m) >= messageTs(best)) best = m;
  }
  return best;
}

/** Timestamp da última mensagem visível na lista — sempre o mais recente entre fontes. */
export function getListaUltimaMensagemCriadoEm(c) {
  const last = pickListaUltimaMensagem(c);
  const iso = last?.criado_em;
  return iso != null && String(iso).trim() !== "" ? String(iso).trim() : null;
}

/** Timestamp efetivo para ordenação estilo WhatsApp (mais recente no topo). */
export function getChatListSortTimestampMs(c) {
  if (!c) return 0;
  // Prioriza o tempo da ÚLTIMA MENSAGEM real (estilo WhatsApp). `ultima_atividade` pode ser
  // inflado por eventos sem mensagem visível (placeholder de mídia, sync de histórico/contatos),
  // o que embaralharia a ordem — por isso entra só como fallback quando não há mensagem.
  // Usa o mesmo parseToDate da hora do card: ISO sem timezone = UTC (evita inverter 20:29 vs 20:46).
  const msgMs = Math.max(
    toChatListTimestampMs(pickListaUltimaMensagem(c)?.criado_em),
    toChatListTimestampMs(c?.ultima_mensagem?.criado_em),
    toChatListTimestampMs(c?.ultima_mensagem_preview?.criado_em)
  );
  if (msgMs > 0) return msgMs;
  return Math.max(toChatListTimestampMs(c?.ultima_atividade), toChatListTimestampMs(c?.criado_em));
}

/** Mescla campos de preview/atividade preservando sempre o timestamp mais recente (socket > API stale). */
export function mergeChatRowListaAtividade(apiRow, localRow) {
  const base = { ...(localRow && typeof localRow === "object" ? localRow : {}), ...(apiRow && typeof apiRow === "object" ? apiRow : {}) };
  const ultima = pickNewerMessage(
    localRow?.ultima_mensagem,
    apiRow?.ultima_mensagem,
    localRow?.ultima_mensagem_preview,
    apiRow?.ultima_mensagem_preview
  );
  const tsMs = Math.max(getChatListSortTimestampMs(apiRow), getChatListSortTimestampMs(localRow));
  const ultimaAtividade =
    tsMs > 0
      ? new Date(tsMs).toISOString()
      : base.ultima_atividade ?? localRow?.ultima_atividade ?? apiRow?.ultima_atividade ?? null;
  if (ultima) {
    base.ultima_mensagem = ultima;
    base.ultima_mensagem_preview = ultima;
  }
  if (ultimaAtividade) base.ultima_atividade = ultimaAtividade;
  return base;
}

/** Ordena conversas por atividade mais recente (DESC). */
export function sortChatListByRecent(arr) {
  if (!Array.isArray(arr) || arr.length <= 1) return arr;
  return [...arr].sort(
    (a, b) => getChatListSortTimestampMs(b) - getChatListSortTimestampMs(a)
  );
}

export function isConversaAguardandoCliente(c, user) {
  if (!c) return false;
  if (isModoSimplesAguardandoCliente(c, user)) return true;
  if (c?.atendente_id == null) return false;
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

export function isConversaAguardandoFuncionario(c, pendentesIdSet, user) {
  if (!c || isGroupConversation(c)) return false;
  if (isModoSimplesAguardandoAtendente(c, user)) return true;
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

export function atendimentoRowVisualClass(c, pendentesIdSet, semConversaRow, currentUserId, user) {
  if (!c || semConversaRow || isGroupConversation(c)) return "";
  // Modo simples: só a tag “Aguardando atendente/cliente”, sem card âmbar destacado.
  if (c?.atendimento_modo_simples === true || user?.atendimento_modo_simples === true) {
    return "";
  }
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

export function getEsperaMinutosAnchorIso(c, pendentesIdSet, user) {
  if (!c || isGroupConversation(c)) return "";
  const modoSimplesUi =
    c?.atendimento_modo_simples === true || user?.atendimento_modo_simples === true;
  if (modoSimplesUi && resolveModoSimplesAguardandoEffective(c, user) === "atendente") {
    const lastMsgTs = getListaUltimaMensagemCriadoEm(c);
    const ultimaAtiv = c?.ultima_atividade != null ? String(c.ultima_atividade).trim() : "";
    return lastMsgTs || ultimaAtiv || "";
  }
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
export const CHAT_LIST_ROW_GAP = 7;

/** Métricas espelhadas do chatList.css — lista virtual usa altura fixa por item (sem measureElement). */
const VIRTUAL_ROW_METRICS = {
  desktop: {
    padY: 26,
    avatar: 48,
    titleLine: 17.5,
    setor: 15,
    assignee: 15,
    empresa: 15,
    preview: 17,
    mainGap: 2,
    badgeGridExtra: 0,
    statusSubLine: 18,
    minRow: 76,
    titleWrapWidth: 210,
  },
  mobile: {
    padY: 16,
    avatar: 46,
    titleLine: 16.2,
    setor: 12.5,
    assignee: 13.5,
    empresa: 13.5,
    preview: 14.8,
    mainGap: 3,
    badgeGridExtra: 23,
    statusSubLine: 17,
    minRow: 68,
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
export function estimateChatListRowSize(chat, isMobileLayout, pendentesIdSet = null, showAssigneeNames = false) {
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
  const hasAssignee = showAssigneeNames && !isGroup && getAtendimentoAssigneeNames(chat).length > 0;

  let titleBlock = titleLines * m.titleLine;
  if (hasSetor) titleBlock += m.setor;
  if (hasAssignee) titleBlock += m.assignee;
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

  if (mobileBadgeGrid) rowHeight = Math.max(rowHeight, isMobileLayout ? 80 : 80);
  if (hasSetor && status === "em_atendimento" && chat?.atendente_id != null) {
    rowHeight = Math.max(rowHeight, isMobileLayout ? 80 : 80);
  }

  return Math.ceil(rowHeight) + 3;
}
