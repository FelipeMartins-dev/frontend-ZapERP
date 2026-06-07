import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuthStore } from "../auth/authStore";
import { useConversaStore } from "../conversa/conversaStore";
import { useNotificationStore } from "../notifications/notificationStore";
import {
  canAssumir,
  canTransferir,
  canEncerrar,
  canReabrir,
} from "../auth/permissions";
import api from "../api/http";
import { listarTags } from "../api/tagService";
import {
  getStatusAtendimentoEffective,
  isAguardandoClienteManual,
  isCobrancaFinanceiraStatus,
} from "../utils/conversaUtils";
import { isAtendenteSetorFinanceiro } from "../utils/financeiroSector";
import {
  buildChatListFiltersScopeKey,
  getChatListFiltersDataCache,
  loadChatListFiltersDataOnce,
} from "../chats/chatListFiltersData";
import AguardarPagamentoModal from "./AguardarPagamentoModal";
import "./aguardarPagamento.css";

function getApiErrorMessage(e) {
  return e?.response?.data?.error || e?.message || "Erro na operação.";
}

function getAguardandoClienteErrorMessage(e) {
  const st = e?.response?.status;
  const body = e?.response?.data;
  const raw = body?.error || body?.message || "";
  const t = String(raw || "").toLowerCase();
  if (st === 409) {
    if (t.includes("em_atendimento") || t.includes("em atendimento"))
      return "Só é possível a partir de uma conversa em atendimento, com você como responsável.";
    if (t.includes("aguardando") || t.includes("retomar"))
      return raw || "O estado da conversa mudou. Atualize e tente de novo.";
    return raw || "Esta ação não se aplica ao estado atual da conversa.";
  }
  return getApiErrorMessage(e);
}

function getMessagesScrollMetrics() {
  if (typeof document === "undefined") return null;
  const container = document.querySelector(".wa-messages");
  if (!container) return null;
  return {
    scrollTop: Number(container.scrollTop || 0),
    scrollHeight: Number(container.scrollHeight || 0),
    clientHeight: Number(container.clientHeight || 0),
  };
}

function logActionScroll(action, phase) {
  if (!import.meta.env.DEV) return;
  const metrics = getMessagesScrollMetrics();
  if (!metrics) {
    console.debug(`[scroll-debug] ${action}:${phase} sem-container`);
    return;
  }
  console.debug(`[scroll-debug] ${action}:${phase}`, metrics);
}

function IconDotsHorizontal() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="currentColor">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

function IconAtendTransfer() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
    </svg>
  );
}

function IconAtendWait() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}

function IconAtendClose() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function IconAtendReopen() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13a7 7 0 1 0-9.89-9.89L6 7" />
      <path d="M6 3v4h4" />
    </svg>
  );
}

function IconPagamentoConcluido() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20z" opacity="0.35" />
      <path d="M8.5 12.2 11 14.7l4.8-5.5" />
    </svg>
  );
}

function AtendimentoActionIcon({ id }) {
  switch (id) {
    case "transferir":
      return <IconAtendTransfer />;
    case "aguardar_cliente":
    case "aguardar_pagamento":
      return <IconAtendWait />;
    case "pagamento_concluido":
      return <IconPagamentoConcluido />;
    case "encerrar":
      return <IconAtendClose />;
    case "reabrir":
      return <IconAtendReopen />;
    default:
      return null;
  }
}

/** No menu ⋯ (mobile): ícone opcional por ação secundária */
function renderOverflowSheetIcon(id) {
  switch (id) {
    case "aguardar_cliente":
      return <IconAtendWait />;
    case "retomar_atendimento":
      return (
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a9 9 0 1 1-3.57-7.19" />
          <path d="M21 3v7h-7" />
        </svg>
      );
    case "pagamento_concluido":
      return <IconPagamentoConcluido />;
    case "reabrir":
      return (
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 13a7 7 0 1 0-9.89-9.89L6 7" />
          <path d="M6 3v4h4" />
        </svg>
      );
    default:
      return null;
  }
}

/** Mobile: estas ficam na barra; o resto vai para o menu ⋯. Reabrir entra na barra quando a conversa está finalizada. */
const MOBILE_TOOLBAR_PINNED_BASE = ["assumir", "transferir", "encerrar"];

/**
 * @param {object} props
 * @param {boolean} [props.compactToolbar] — mobile: ações de atendimento em fileira; menu "…" só para extras (overflowTop)
 * @param {(close: () => void) => import("react").ReactNode} [props.overflowTop] — itens extras no topo do menu (tags, histórico…)
 * @param {import("react").ReactNode} [props.prepend] — ex.: ícone de histórico à esquerda (só mobile / ConversaView)
 * @param {boolean} [props.splitCompactHeader] — mobile 2 linhas: ⋯ na linha 1, botões inline na linha 2 (grid do header)
 */
export default function AtendimentoActions({
  compactToolbar = false,
  overflowTop,
  prepend,
  splitCompactHeader = false,
}) {
  const userFromSelector = useAuthStore((s) => s?.user);
  const stateAuth = useAuthStore((s) => s);
  const user = userFromSelector ?? stateAuth?.user ?? null;

  const conversa = useConversaStore((s) => s?.conversa);
  const assumirConversa = useConversaStore((s) => s?.assumirConversa);
  const transferirConversa = useConversaStore((s) => s?.transferirConversa);
  const encerrarConversa = useConversaStore((s) => s?.encerrarConversa);
  const reabrirConversa = useConversaStore((s) => s?.reabrirConversa);
  const marcarAguardandoClienteConversa = useConversaStore((s) => s?.marcarAguardandoClienteConversa);
  const marcarAguardandoPagamentoConversa = useConversaStore((s) => s?.marcarAguardandoPagamentoConversa);
  const retomarAtendimentoConversa = useConversaStore((s) => s?.retomarAtendimentoConversa);
  const showToast = useNotificationStore((s) => s?.showToast);

  const [departamentosLista, setDepartamentosLista] = useState(() => {
    const cached = getChatListFiltersDataCache();
    return Array.isArray(cached?.departamentos) ? cached.departamentos : [];
  });
  const [pagamentoModalOpen, setPagamentoModalOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [atendentes, setAtendentes] = useState([]);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuWrapRef = useRef(null);
  const overflowTriggerRef = useRef(null);
  const overflowMenuRef = useRef(null);
  const [overflowMenuPos, setOverflowMenuPos] = useState(null);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  useLayoutEffect(() => {
    if (!menuOpen || !overflowTriggerRef.current) {
      setOverflowMenuPos(null);
      return undefined;
    }
    const updatePos = () => {
      const r = overflowTriggerRef.current?.getBoundingClientRect();
      if (!r) return;
      setOverflowMenuPos({
        top: Math.round(r.bottom + 6),
        right: Math.max(8, Math.round(window.innerWidth - r.right)),
      });
    };
    updatePos();
    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", updatePos, true);
    return () => {
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", updatePos, true);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e) => {
      if (e.key === "Escape") closeMenu();
    };
    const onPointer = (e) => {
      const t = e.target;
      if (overflowTriggerRef.current?.contains(t)) return;
      if (overflowMenuRef.current?.contains(t)) return;
      closeMenu();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer, { passive: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
    };
  }, [menuOpen, closeMenu]);

  useEffect(() => {
    let alive = true;
    const cached = getChatListFiltersDataCache();
    if (Array.isArray(cached?.departamentos) && cached.departamentos.length > 0) {
      setDepartamentosLista(cached.departamentos);
      return () => {
        alive = false;
      };
    }
    const scope = buildChatListFiltersScopeKey(user);
    const loadDept = scope
      ? loadChatListFiltersDataOnce({ listarTags, api, scopeKey: scope }).then(() => getChatListFiltersDataCache()?.departamentos)
      : api.get("/dashboard/departamentos").then((r) => r.data);
    Promise.resolve(loadDept)
      .then((data) => {
        if (!alive) return;
        if (Array.isArray(data) && data.length > 0) setDepartamentosLista(data);
      })
      .catch(() => {
        if (!alive) return;
        api
          .get("/dashboard/departamentos")
          .then((r) => {
            if (alive && Array.isArray(r.data)) setDepartamentosLista(r.data);
          })
          .catch(() => {});
      });
    return () => {
      alive = false;
    };
  }, [user?.id, user?.company_id]);

  useEffect(() => {
    if (!transferOpen) return;

    let alive = true;

    async function load() {
      try {
        const { data } = await api.get("/usuarios");
        if (!alive) return;
        setAtendentes(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!alive) return;
        setAtendentes([]);
        console.error("Erro ao carregar /usuarios:", e);
      }
    }

    load();

    return () => {
      alive = false;
    };
  }, [transferOpen]);

  const filtrados = useMemo(() => {
    const term = String(search || "").toLowerCase();
    return (atendentes || []).filter((a) =>
      String(a?.nome || "").toLowerCase().includes(term)
    );
  }, [atendentes, search]);

  if (!conversa || !user) return null;

  const status = getStatusAtendimentoEffective(conversa);
  const meuId = user?.id;
  const userRole = String(user?.role || user?.perfil || "").toLowerCase();
  const isPrivileged = userRole === "admin" || userRole === "supervisor";

  const atendenteIdRaw = conversa?.atendente_id ?? null;
  const atendenteId =
    atendenteIdRaw === "" || atendenteIdRaw === undefined ? null : atendenteIdRaw;

  const hasAtendente = atendenteId !== null;
  const isMinha = hasAtendente && String(atendenteId) === String(meuId);

  const isFechada = status === "fechada" || status === "encerrada";
  const isFila =
    status === "fila" ||
    status === "aberta" ||
    status === "pendente" ||
    status === "mensagem_disparada";
  const isAguardandoClienteManualStatus = isAguardandoClienteManual(conversa);
  const isCobrancaFinanceira = isCobrancaFinanceiraStatus(conversa);
  const atendenteFinanceiro = isAtendenteSetorFinanceiro(user, departamentosLista);
  const isEmAtendimento =
    status === "em_atendimento" || status === "em atendimento";
  const isEmAtendimentoOuAguardandoManual =
    isEmAtendimento || isAguardandoClienteManualStatus || isCobrancaFinanceira;

  const convDepId = conversa?.departamento_id ?? null;
  const userDepIds = Array.isArray(user?.departamento_ids)
    ? user.departamento_ids.map((id) => Number(id))
    : user?.departamento_id != null
      ? [Number(user.departamento_id)]
      : [];
  const mesmaSetorOuSemRestricao =
    isPrivileged ||
    convDepId == null ||
    (userDepIds.length > 0 && userDepIds.includes(Number(convDepId)));

  const podeAssumir =
    typeof canAssumir === "function" &&
    canAssumir(user) &&
    !isFechada &&
    isFila &&
    !hasAtendente &&
    mesmaSetorOuSemRestricao;

  const podeTransferir =
    typeof canTransferir === "function" &&
    canTransferir(user) &&
    !isFechada &&
    (isPrivileged
      ? isFila || isEmAtendimentoOuAguardandoManual || hasAtendente
      : hasAtendente && isMinha);

  const podeEncerrar =
    typeof canEncerrar === "function" &&
    canEncerrar(user) &&
    !isFechada &&
    (isEmAtendimentoOuAguardandoManual || hasAtendente) &&
    (isPrivileged ? true : isMinha);

  const podeMarcarAguardandoCliente =
    !atendenteFinanceiro &&
    typeof canEncerrar === "function" &&
    canEncerrar(user) &&
    typeof marcarAguardandoClienteConversa === "function" &&
    !isFechada &&
    isEmAtendimento &&
    !isAguardandoClienteManualStatus &&
    hasAtendente &&
    (isPrivileged ? true : isMinha);

  const podeMarcarAguardandoPagamento =
    atendenteFinanceiro &&
    typeof canEncerrar === "function" &&
    canEncerrar(user) &&
    typeof marcarAguardandoPagamentoConversa === "function" &&
    !isFechada &&
    isEmAtendimento &&
    !isCobrancaFinanceira &&
    hasAtendente &&
    (isPrivileged ? true : isMinha);

  const podeRetomarAtendimento =
    typeof canEncerrar === "function" &&
    canEncerrar(user) &&
    typeof retomarAtendimentoConversa === "function" &&
    !isFechada &&
    isAguardandoClienteManualStatus &&
    !isCobrancaFinanceira &&
    hasAtendente &&
    (isPrivileged ? true : isMinha);

  const podeConfirmarPagamento =
    typeof canEncerrar === "function" &&
    canEncerrar(user) &&
    typeof retomarAtendimentoConversa === "function" &&
    !isFechada &&
    isCobrancaFinanceira &&
    hasAtendente &&
    (isPrivileged ? true : isMinha);

  const podeReabrir =
    typeof canReabrir === "function" && canReabrir(user) && isFechada;

  async function handleAssumir() {
    if (busy) return;
    logActionScroll("assumir", "antes");
    setBusy(true);
    try {
      if (typeof assumirConversa === "function") {
        await assumirConversa(conversa.id);
        logActionScroll("assumir", "depois");
        if (showToast) showToast({ title: "Conversa assumida", message: "Você está atendendo esta conversa." });
      }
    } catch (e) {
      console.error("Erro ao assumir conversa:", e);
      if (showToast) showToast({ title: "Erro ao assumir", message: getApiErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  async function handleEncerrar() {
    if (busy) return;
    logActionScroll("encerrar", "antes");
    setBusy(true);
    try {
      if (typeof encerrarConversa === "function") {
        await encerrarConversa(conversa.id);
        logActionScroll("encerrar", "depois");
        if (showToast) showToast({ title: "Conversa encerrada", message: "Você pode reabrir quando precisar." });
      }
    } catch (e) {
      console.error("Erro ao encerrar conversa:", e);
      if (showToast) showToast({ title: "Erro ao encerrar", message: getApiErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  async function handleReabrir() {
    if (busy) return;
    logActionScroll("reabrir", "antes");
    setBusy(true);
    try {
      if (typeof reabrirConversa === "function") {
        await reabrirConversa(conversa.id);
        logActionScroll("reabrir", "depois");
        if (showToast) showToast({ title: "Conversa reaberta", message: "Atendimento disponível novamente." });
      }
    } catch (e) {
      console.error("Erro ao reabrir conversa:", e);
      if (showToast) showToast({ title: "Erro ao reabrir", message: getApiErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmarAguardarPagamento({ prazo, data }) {
    if (busy) return;
    setBusy(true);
    try {
      if (typeof marcarAguardandoPagamentoConversa === "function") {
        await marcarAguardandoPagamentoConversa(conversa.id, { prazo, data });
        setPagamentoModalOpen(false);
        if (showToast)
          showToast({
            title: "Pagamento pendente",
            message: "A cobrança está aguardando pagamento dentro do prazo definido.",
          });
      }
    } catch (e) {
      console.error("Erro ao marcar aguardando pagamento:", e);
      if (showToast)
        showToast({
          title: "Não foi possível atualizar",
          message: getAguardandoClienteErrorMessage(e),
        });
    } finally {
      setBusy(false);
    }
  }

  async function handleMarcarAguardandoCliente() {
    if (busy) return;
    setBusy(true);
    try {
      if (typeof marcarAguardandoClienteConversa === "function") {
        await marcarAguardandoClienteConversa(conversa.id);
        if (showToast)
          showToast({
            title: "Aguardando cliente",
            message: "A conversa foi marcada como aguardando resposta do cliente.",
          });
      }
    } catch (e) {
      console.error("Erro ao marcar aguardando cliente:", e);
      if (showToast)
        showToast({
          title: "Não foi possível atualizar",
          message: getAguardandoClienteErrorMessage(e),
        });
    } finally {
      setBusy(false);
    }
  }

  async function handleRetomarAtendimento() {
    if (busy) return;
    setBusy(true);
    try {
      if (typeof retomarAtendimentoConversa === "function") {
        await retomarAtendimentoConversa(conversa.id);
        if (showToast)
          showToast({
            title: "Atendimento retomado",
            message: "A conversa voltou para em atendimento.",
          });
      }
    } catch (e) {
      console.error("Erro ao retomar atendimento:", e);
      if (showToast)
        showToast({
          title: "Não foi possível retomar",
          message: getAguardandoClienteErrorMessage(e),
        });
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmarPagamento() {
    if (busy) return;
    setBusy(true);
    try {
      if (typeof retomarAtendimentoConversa === "function") {
        await retomarAtendimentoConversa(conversa.id);
        if (showToast)
          showToast({
            title: "Pagamento confirmado",
            message: "O pagamento foi registrado e o atendimento foi retomado.",
          });
      }
    } catch (e) {
      console.error("Erro ao confirmar pagamento:", e);
      if (showToast)
        showToast({
          title: "Não foi possível confirmar",
          message: getAguardandoClienteErrorMessage(e),
        });
    } finally {
      setBusy(false);
    }
  }

  async function handleTransferir(id) {
    if (busy) return;
    setBusy(true);
    try {
      if (typeof transferirConversa === "function") {
        await transferirConversa(conversa.id, id);
        setTransferOpen(false);
        setSearch("");
        const paraMim = String(id) === String(meuId);
        if (showToast) {
          showToast({
            title: "Atendimento transferido",
            message: paraMim
              ? "A conversa foi atribuída a você. Use Encerrar ou Transferir quando precisar."
              : "A conversa foi atribuída ao atendente selecionado.",
          });
        }
      }
    } catch (e) {
      console.error("Erro ao transferir conversa:", e);
      if (showToast) showToast({ title: "Erro ao transferir", message: getApiErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  const openTransfer = useCallback(() => {
    setTransferOpen(true);
    closeMenu();
  }, [closeMenu]);

  const actions = [];
  if (podeAssumir) {
    actions.push({
      id: "assumir",
      className: `wa-btn-primary ${!hasAtendente ? "wa-btn-assumir-destaque" : ""}`,
      labelLong: "Assumir",
      labelShort: "Assum.",
      onClick: handleAssumir,
      title: !hasAtendente ? "Clique para assumir e enviar mensagens" : "Assumir atendimento",
      ariaLabel: "Assumir atendimento",
    });
  }
  if (podeConfirmarPagamento) {
    actions.push({
      id: "pagamento_concluido",
      className: "wa-btn-pagamento-concluido",
      labelLong: "Pagamento concluído",
      labelShort: "Pago",
      onClick: handleConfirmarPagamento,
      title: "Confirmar pagamento recebido e retomar atendimento",
      ariaLabel: "Pagamento concluído",
    });
  }
  if (podeRetomarAtendimento) {
    actions.push({
      id: "retomar_atendimento",
      className: "wa-btn-primary",
      labelLong: "Retomar atendimento",
      labelShort: "Retomar",
      onClick: handleRetomarAtendimento,
      title: "Voltar para em atendimento",
      ariaLabel: "Retomar atendimento",
    });
  }
  if (podeTransferir) {
    actions.push({
      id: "transferir",
      className: "wa-btn-transferir",
      labelLong: "Transferir",
      labelShort: "Transf.",
      onClick: openTransfer,
      title: "Transferir atendimento",
      ariaLabel: "Transferir atendimento",
    });
  }
  if (podeMarcarAguardandoPagamento) {
    actions.push({
      id: "aguardar_pagamento",
      className: "wa-btn-aguardar-pagamento",
      labelLong: "Aguardar pagamento",
      labelShort: "Pagam.",
      onClick: () => setPagamentoModalOpen(true),
      title: "Marcar cobrança enviada e definir prazo de pagamento",
      ariaLabel: "Aguardar pagamento",
    });
  }
  if (podeMarcarAguardandoCliente) {
    actions.push({
      id: "aguardar_cliente",
      className: "wa-btn-aguardar-cliente",
      labelLong: "Aguardar cliente",
      labelShort: "Aguard.",
      onClick: handleMarcarAguardandoCliente,
      title: "Marcar como aguardando resposta do cliente",
      ariaLabel: "Marcar como aguardando cliente",
    });
  }
  if (podeEncerrar) {
    actions.push({
      id: "encerrar",
      className: "wa-btn-danger",
      labelLong: "Encerrar",
      labelShort: "Encerr.",
      onClick: handleEncerrar,
      title: "Encerrar conversa",
      ariaLabel: "Encerrar conversa",
    });
  }
  if (podeReabrir) {
    actions.push({
      id: "reabrir",
      className: "wa-btn-secondary",
      labelLong: "Reabrir",
      labelShort: "Reabrir",
      onClick: handleReabrir,
      title: "Reabrir conversa",
      ariaLabel: "Reabrir conversa",
    });
  }

  const mobileToolbarPinned = new Set(MOBILE_TOOLBAR_PINNED_BASE);
  if (podeReabrir) mobileToolbarPinned.add("reabrir");

  const overflowExtra = typeof overflowTop === "function" ? overflowTop(closeMenu) : null;
  const compactOverflowActions = compactToolbar
    ? actions.filter((a) => !mobileToolbarPinned.has(a.id))
    : [];
  const compactInlineActions = compactToolbar
    ? actions.filter((a) => mobileToolbarPinned.has(a.id))
    : actions;
  /** Mobile: barra com Assumir / Transferir / Encerrar (+ Reabrir se finalizada); demais no ⋯ + extras. */
  const showCompactOverflowMenu =
    compactToolbar && (Boolean(overflowExtra) || compactOverflowActions.length > 0);

  const transferModal =
    transferOpen
      ? createPortal(
          <div
            className="wa-modalOverlay"
            role="dialog"
            aria-label="Transferir atendimento"
            onMouseDown={() => {
              if (busy) return;
              setTransferOpen(false);
              setSearch("");
            }}
          >
            <div className="wa-modal wa-transferModal" onMouseDown={(e) => e.stopPropagation()}>
              <div className="wa-modal-head">
                <div className="wa-modal-title">Transferir atendimento</div>
                <button
                  type="button"
                  className="wa-header-btn"
                  onClick={() => {
                    if (busy) return;
                    setTransferOpen(false);
                    setSearch("");
                  }}
                  aria-label="Fechar"
                  title="Fechar"
                  style={{ width: 34, height: 34 }}
                >
                  ✕
                </button>
              </div>

              <div className="wa-modal-body">
                <input
                  className="wa-transferSearch"
                  placeholder="Buscar atendente..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoFocus
                />

                <div className="wa-transferList" role="list">
                  {filtrados.map((a) => {
                    const souEu = String(a?.id) === String(meuId);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        className={`wa-transferItem ${souEu ? "isMe" : ""}`}
                        onClick={() => handleTransferir(a.id)}
                        disabled={busy}
                        role="listitem"
                        title={a?.nome || ""}
                      >
                        <span className="wa-transferName">{a.nome}</span>
                        {souEu ? <span className="wa-transferBadge">você</span> : null}
                      </button>
                    );
                  })}

                  {filtrados.length === 0 ? (
                    <div className="wa-transferEmpty">Nenhum atendente encontrado</div>
                  ) : null}
                </div>

                <div className="wa-transferFooter">
                  <button
                    type="button"
                    className="wa-btn-secondary"
                    onClick={() => {
                      if (busy) return;
                      setTransferOpen(false);
                      setSearch("");
                    }}
                    disabled={busy}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  function renderToolbarButton(a) {
    const icon = <AtendimentoActionIcon id={a.id} />;
    return (
      <button
        key={a.id}
        type="button"
        className={`${a.className} zap-action-btn`.trim()}
        onClick={a.onClick}
        disabled={busy}
        title={a.title}
        aria-label={a.ariaLabel}
      >
        {icon ? (
          <span className="wa-atendBtn-icon" aria-hidden>
            {icon}
          </span>
        ) : null}
        <span className="wa-atendLabel--long">{a.labelLong}</span>
        <span className="wa-atendLabel--short">{a.labelShort}</span>
      </button>
    );
  }

  if (!compactToolbar && actions.length === 0) {
    return transferModal;
  }

  if (compactToolbar && actions.length === 0 && typeof overflowTop !== "function") {
    return transferModal;
  }

  const pagamentoModal = (
    <AguardarPagamentoModal
      open={pagamentoModalOpen}
      busy={busy}
      onClose={() => setPagamentoModalOpen(false)}
      onConfirm={handleConfirmarAguardarPagamento}
    />
  );

  if (!compactToolbar) {
    return (
      <>
        <div className="wa-actions">{actions.map((a) => renderToolbarButton(a))}</div>
        {transferModal}
        {pagamentoModal}
      </>
    );
  }

  const overflowMenuButton = showCompactOverflowMenu ? (
    <div
      className={`wa-atendToolbar-overflowWrap${splitCompactHeader ? " wa-atendToolbar-overflowWrap--headerRow1" : ""}`}
      ref={splitCompactHeader ? menuWrapRef : undefined}
    >
      <button
        ref={overflowTriggerRef}
        type="button"
        className="wa-header-btn wa-header-btn--micro wa-atendToolbar-overflowTrigger"
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-label="Mais opções"
        title="Mais opções"
        onClick={() => setMenuOpen((v) => !v)}
      >
        <IconDotsHorizontal />
      </button>

      {menuOpen && overflowMenuPos && typeof document !== "undefined"
        ? createPortal(
            <>
              <div
                className="wa-atendToolbar-backdrop wa-atendToolbar-backdrop--portal"
                aria-hidden="true"
                onClick={closeMenu}
              />
              <div
                ref={overflowMenuRef}
                className="wa-atendToolbar-dropdown wa-atendToolbar-dropdown--portal"
                role="menu"
                aria-label="Mais opções"
                style={{
                  top: overflowMenuPos.top,
                  right: overflowMenuPos.right,
                }}
              >
                <div className="wa-atendToolbar-menuExtras">
                  {overflowExtra}
                  {compactOverflowActions.map((a) => {
                    const sheetIcon = renderOverflowSheetIcon(a.id);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        className="wa-atendToolbar-sheetBtn"
                        onClick={() => {
                          a.onClick?.();
                          closeMenu();
                        }}
                        disabled={busy}
                        title={a.title}
                        aria-label={a.ariaLabel}
                      >
                        {sheetIcon ? (
                          <span className="wa-atendToolbar-sheetIcon" aria-hidden="true">
                            {sheetIcon}
                          </span>
                        ) : null}
                        <span className="wa-atendToolbar-sheetLabel">{a.labelLong}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </>,
            document.body
          )
        : null}
    </div>
  ) : null;

  const primaryRow = (
    <div
      className={`wa-atendToolbar-primaryRow${splitCompactHeader ? " wa-atendToolbar-primaryRow--headerRow2" : ""}`}
    >
      {compactInlineActions.map((a) => renderToolbarButton(a))}
    </div>
  );

  if (splitCompactHeader) {
    return (
      <>
        <div className="wa-atendToolbar wa-atendToolbar--compact wa-atendToolbar--splitHeader">
          {prepend ? <div className="wa-atendToolbar-prepend">{prepend}</div> : null}
          {overflowMenuButton}
          {primaryRow}
        </div>
        {transferModal}
        {pagamentoModal}
      </>
    );
  }

  return (
    <>
      <div className="wa-atendToolbar wa-atendToolbar--compact" ref={menuWrapRef}>
        {prepend ? <div className="wa-atendToolbar-prepend">{prepend}</div> : null}
        {primaryRow}
        {overflowMenuButton}
      </div>
      {transferModal}
      {pagamentoModal}
    </>
  );
}
