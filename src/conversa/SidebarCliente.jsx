import "./conversa.css";
import { useMemo, useState, useCallback, useEffect } from "react";
import { salvarObservacao, vincularClienteConversa, atualizarNomeContatoConversa } from "./conversaService";
import { useConversaStore } from "./conversaStore";
import { useChatStore } from "../chats/chatsStore";
import { useAuthStore } from "../auth/authStore";
import { useNotificationStore } from "../notifications/notificationStore";
import { getDisplayName } from "../chats/chatList";
import * as cfg from "../api/configService";
import { getStatusAtendimentoEffective } from "../utils/conversaUtils";

function initials(nome = "") {
  const parts = String(nome || "").trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] || "";
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] : "";
  return (a + b).toUpperCase() || "Z";
}

function digitsOnly(v) {
  return String(v || "").replace(/\D/g, "");
}

function getSidebarStatusKey(conversa) {
  const s = getStatusAtendimentoEffective(conversa);
  if (
    s === "em_atendimento" &&
    conversa?.atendente_id != null &&
    conversa?.aguardando_cliente_desde != null
  ) {
    return "aguardando_cliente";
  }
  return s;
}

async function copyText(text) {
  const t = String(text || "");
  if (!t) return false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(t);
      return true;
    }
  } catch (_) {}

  // fallback (ambientes / permissões)
  try {
    const el = document.createElement("textarea");
    el.value = t;
    el.setAttribute("readonly", "true");
    el.style.position = "fixed";
    el.style.left = "-9999px";
    el.style.top = "-9999px";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return !!ok;
  } catch (_) {
    return false;
  }
}

const NEXT_CONTACT_MARKER = "[NEXT_CONTACT]";

function parseNextContactFromObservacoes(raw) {
  const s = String(raw || "");
  const lines = s.split(/\r?\n/);
  let found = null;
  const kept = [];

  for (const line of lines) {
    const m = String(line || "").match(
      /^\s*\[NEXT_CONTACT\]\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})(?:\s*\|\s*(.*))?\s*$/
    );
    if (!found && m) {
      found = { date: m[1], time: m[2], note: (m[3] || "").trim() };
      continue;
    }
    kept.push(line);
  }

  const text = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { meta: found, text };
}

function buildObservacoesWithNextContact(text, meta) {
  const t = String(text || "").trim();
  const lines = [];
  if (meta?.date && meta?.time) {
    const note = String(meta?.note || "").replace(/\r?\n/g, " ").trim();
    lines.push(`${NEXT_CONTACT_MARKER} ${meta.date} ${meta.time}${note ? ` | ${note}` : ""}`);
  }
  if (t) lines.push(t);
  const out = lines.join("\n\n").trim();
  return out ? out : null;
}

function diffObject(before, after) {
  const b = before || {};
  const a = after || {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const out = {};
  for (const k of keys) {
    const bv = b[k];
    const av = a[k];
    const nb = bv == null ? null : String(bv);
    const na = av == null ? null : String(av);
    if (nb !== na) out[k] = { before: bv ?? null, after: av ?? null };
  }
  return out;
}

export default function SidebarCliente({ open, onClose, conversa, tags, tempoSemResponder, onObservacaoSaved, isGroup }) {
  const user = useAuthStore((s) => s.user);
  const showToast = useNotificationStore((s) => s.showToast);
  const [observacao, setObservacao] = useState("");
  const [obsBase, setObsBase] = useState("");
  const [savingObs, setSavingObs] = useState(false);
  const [avatarImgError, setAvatarImgError] = useState(false);

  useEffect(() => {
    if (isGroup) return;
    const valor = conversa?.observacao != null ? String(conversa.observacao) : "";
    setObservacao(valor);
    setObsBase(valor);
  }, [open, conversa?.id, conversa?.observacao, isGroup]);

  const clienteId = useMemo(() => {
    const id = conversa?.cliente_id ?? conversa?.cliente?.id ?? null;
    return id != null && id !== "" ? String(id) : null;
  }, [conversa]);

  const canEdit = useMemo(() => {
    if (isGroup) return false;
    if (user?.id == null) return false;
    const perfil = String(user?.perfil || "").toLowerCase();
    if (perfil === "admin" || perfil === "supervisor") return true;
    if (conversa?.atendente_id == null || conversa?.atendente_id === "") return false;
    return String(conversa.atendente_id) === String(user.id);
  }, [isGroup, user?.id, user?.perfil, conversa?.atendente_id]);

  const [cliente, setCliente] = useState(null);
  const [clienteLoading, setClienteLoading] = useState(false);
  const [savingCliente, setSavingCliente] = useState(false);
  const [creatingCliente, setCreatingCliente] = useState(false);

  const [cliNome, setCliNome] = useState("");
  const [cliEmail, setCliEmail] = useState("");
  const [cliEmpresa, setCliEmpresa] = useState("");
  const [cliObsText, setCliObsText] = useState("");

  const [nextDate, setNextDate] = useState("");
  const [nextTime, setNextTime] = useState("");
  const [nextNote, setNextNote] = useState("");

  const [clienteBase, setClienteBase] = useState({
    nome: "",
    email: "",
    empresa: "",
    observacoes: "",
    nextDate: "",
    nextTime: "",
    nextNote: "",
  });
  const [nomeContatoBase, setNomeContatoBase] = useState("");
  const [savingNomeContato, setSavingNomeContato] = useState(false);

  const hydrateFromCliente = useCallback((c) => {
    const fromCliente = c?.nome != null ? String(c.nome).trim() : "";
    const fromConversa = String(getDisplayName(conversa) || "").trim();
    const nome = fromCliente || (fromConversa && fromConversa !== "Contato" ? fromConversa : "");
    const email = c?.email != null ? String(c.email) : "";
    const empresa = c?.empresa != null ? String(c.empresa) : "";
    const obsRaw = c?.observacoes != null ? String(c.observacoes) : "";

    const parsed = parseNextContactFromObservacoes(obsRaw);
    const meta = parsed.meta || {};

    setCliNome(nome);
    setCliEmail(email);
    setCliEmpresa(empresa);
    setCliObsText(parsed.text || "");
    setNextDate(meta.date || "");
    setNextTime(meta.time || "");
    setNextNote(meta.note || "");

    setClienteBase({
      nome,
      email,
      empresa,
      observacoes: parsed.text || "",
      nextDate: meta.date || "",
      nextTime: meta.time || "",
      nextNote: meta.note || "",
    });
    setNomeContatoBase(nome);
  }, [conversa]);

  const loadCliente = useCallback(async () => {
    if (!open || isGroup) return;
    if (!clienteId) {
      setCliente(null);
      return;
    }

    setClienteLoading(true);
    try {
      // 1) tenta endpoint direto /clientes/:id (se existir)
      let c = null;
      try {
        c = await cfg.getCliente(clienteId);
      } catch (_) {
        c = null;
      }

      // 2) fallback: busca por palavra (telefone) e encontra pelo id
      if (!c) {
        const tel = digitsOnly(conversa?.cliente_telefone || conversa?.cliente?.telefone || conversa?.telefone || "");
        const list = await cfg.getClientes(tel ? { palavra: tel } : {});
        const arr = Array.isArray(list) ? list : [];
        c = arr.find((x) => String(x?.id) === String(clienteId)) || null;
      }

      setCliente(c);
      hydrateFromCliente(c || {});
    } catch (e) {
      console.error("Erro ao carregar cliente:", e);
      setCliente(null);
      // mantém valores atuais (não quebra a UI)
    } finally {
      setClienteLoading(false);
    }
  }, [open, isGroup, clienteId, conversa, hydrateFromCliente]);

  useEffect(() => {
    loadCliente();
  }, [loadCliente]);

  const responsavelNome = useMemo(() => {
    // hoje só temos o id do atendente; mostramos “Você” quando for o próprio usuário logado
    if (conversa?.atendente_id == null || conversa?.atendente_id === "") return "Nenhum responsável";
    const nome = conversa?.atendente_nome;
    if (nome) return user && Number(user.id) === Number(conversa.atendente_id) ? "Você" : nome;
    if (user && Number(user.id) === Number(conversa.atendente_id)) return "Você";
    return "Responsável (ID #" + conversa.atendente_id + ")";
  }, [conversa?.atendente_id, conversa?.atendente_nome, user]);

  /** Nome alinhado com lista e cabeçalho: contato_nome (WhatsApp) primeiro, evitando trocar para cliente.nome ao enviar msg */
  const clienteNome = useMemo(() => getDisplayName(conversa), [conversa]);

  // Nunca exibir LID (lid:xxx) como telefone — é identificador interno do WhatsApp
  const telefone = useMemo(() => {
    const raw =
      conversa?.cliente_telefone ||
      conversa?.telefone_exibivel ||
      conversa?.cliente?.telefone ||
      conversa?.telefone ||
      "";
    const s = String(raw || "").trim();
    if (s.toLowerCase().startsWith("lid:")) return "";
    return s;
  }, [conversa]);

  const telDigits = useMemo(() => digitsOnly(telefone), [telefone]);
  const telefoneCadastro = useMemo(() => {
    const raw = String(telefone || "").trim();
    if (raw.startsWith("+")) return raw;
    if (telDigits) return `+${telDigits}`;
    return "";
  }, [telefone, telDigits]);

  const syncNomeContatoFromConversa = useCallback(() => {
    const dn = String(getDisplayName(conversa) || "").trim();
    const fallbackPhone = String(telefone || "").trim();
    const isPhoneLabel =
      !dn ||
      dn === "Contato" ||
      (fallbackPhone && (dn === fallbackPhone || dn === telefoneCadastro));
    const initial = isPhoneLabel ? "" : dn;
    setCliNome(initial);
    setNomeContatoBase(initial);
  }, [conversa, telefone, telefoneCadastro]);

  useEffect(() => {
    if (!open || isGroup) return;
    if (clienteId && clienteLoading) return;
    if (!clienteId) syncNomeContatoFromConversa();
  }, [open, isGroup, clienteId, clienteLoading, syncNomeContatoFromConversa]);

  const empresaDisplay = useMemo(() => {
    const v =
      String(cliEmpresa || "").trim() ||
      String(cliente?.empresa || "").trim() ||
      String(conversa?.cliente?.empresa || "").trim() ||
      String(conversa?.cliente_empresa || "").trim() ||
      String(conversa?.empresa || "").trim();
    return v || "";
  }, [cliEmpresa, cliente?.empresa, conversa?.cliente?.empresa, conversa?.cliente_empresa, conversa?.empresa]);

  const fotoPerfil = useMemo(() => {
    const url = isGroup
      ? (conversa?.foto_grupo ?? null)
      : (conversa?.foto_perfil ?? conversa?.foto_perfil_contato_cache ?? conversa?.cliente?.foto_perfil ?? conversa?.clientes?.foto_perfil ?? null);
    const s = url ? String(url).trim() : "";
    return s && s.startsWith("http") ? s : null;
  }, [conversa, isGroup]);

  const statusLabel = useMemo(() => {
    const s = getSidebarStatusKey(conversa);
    if (s === "em_atendimento") return "Em atendimento";
    if (s === "aguardando_cliente") return "Aguardando cliente";
    if (s === "pagamento_pendente") return "Pagamento pendente";
    if (s === "em_atraso") return "Em atraso";
    if (s === "mensagem_disparada") return "Mensagem disparada";
    if (s === "fechada") return "Finalizada";
    if (!s) return "Aberta";
    return s;
  }, [
    conversa?.status_atendimento,
    conversa?.status_atendimento_real,
    conversa?.atendente_id,
    conversa?.aguardando_cliente_desde,
  ]);

  const statusTone = useMemo(() => {
    const s = getSidebarStatusKey(conversa);
    if (s === "fechada") return "closed";
    if (s === "aguardando_cliente") return "awaiting";
    if (s === "em_atendimento" || s === "pagamento_pendente" || s === "em_atraso") return "active";
    return "open";
  }, [
    conversa?.status_atendimento,
    conversa?.status_atendimento_real,
    conversa?.atendente_id,
    conversa?.aguardando_cliente_desde,
  ]);

  const createdAt = useMemo(() => {
    if (!conversa?.criado_em) return "";
    try {
      return new Date(conversa.criado_em).toLocaleString();
    } catch {
      return "";
    }
  }, [conversa]);

  const crmHref = useMemo(() => {
    const base = import.meta.env?.VITE_CRM_URL ? String(import.meta.env.VITE_CRM_URL).trim() : "";
    if (!base || base === "#") return "";
    try {
      // suporta base com ou sem query
      const u = new URL(base, window.location.origin);
      if (telDigits) u.searchParams.set("telefone", telDigits);
      if (conversa?.cliente_id != null) u.searchParams.set("cliente_id", String(conversa.cliente_id));
      if (conversa?.id != null) u.searchParams.set("conversa_id", String(conversa.id));
      return u.toString();
    } catch {
      // fallback: concat simples
      const q = [];
      if (telDigits) q.push(`telefone=${encodeURIComponent(telDigits)}`);
      if (conversa?.cliente_id != null) q.push(`cliente_id=${encodeURIComponent(String(conversa.cliente_id))}`);
      if (conversa?.id != null) q.push(`conversa_id=${encodeURIComponent(String(conversa.id))}`);
      if (q.length === 0) return base;
      return base.includes("?") ? `${base}&${q.join("&")}` : `${base}?${q.join("&")}`;
    }
  }, [conversa?.cliente_id, conversa?.id, telDigits]);

  const safeAudit = useCallback(async (payload) => {
    try {
      await cfg.registrarAuditoria(payload);
    } catch (_) {
      // se o backend não suportar POST /config/auditoria, ignora (não quebra UX)
    }
  }, []);

  const handleSalvarObs = useCallback(async () => {
    if (!conversa?.id) return false;
    if (!canEdit) {
      showToast?.({
        type: "error",
        title: "Somente leitura",
        message: "Assuma a conversa para editar/salvar detalhes.",
      });
      return false;
    }
    try {
      setSavingObs(true);
      const before = obsBase;
      await salvarObservacao(conversa.id, observacao);
      setObsBase(observacao);
      showToast?.({ type: "success", title: "Salvo", message: "Observação atualizada com sucesso." });
      safeAudit({
        acao: "detalhes_cliente_salvar_observacao_atendimento",
        conversa_id: conversa.id,
        cliente_id: clienteId,
        usuario_id: user?.id ?? null,
        usuario: user?.nome || user?.email || null,
        diff: diffObject({ observacao: before }, { observacao }),
        criado_em: new Date().toISOString(),
      });
      onObservacaoSaved?.();
      return true;
    } catch (err) {
      console.error("Erro ao salvar observação da conversa:", err);
      showToast?.({ type: "error", title: "Falha ao salvar", message: "Não foi possível salvar a observação." });
      return false;
    } finally {
      setSavingObs(false);
    }
  }, [conversa?.id, observacao, onObservacaoSaved, showToast, canEdit, obsBase, safeAudit, user?.id, user?.nome, user?.email, clienteId]);

  const setDateToday = useCallback(() => {
    const d = new Date();
    const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    setNextDate(v);
  }, []);

  const setDateTomorrow = useCallback(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    setNextDate(v);
  }, []);

  const handleLimparProximoContato = useCallback(() => {
    setNextDate("");
    setNextTime("");
    setNextNote("");
    showToast?.({ type: "info", title: "Limpo", message: "Próximo contato removido (não esqueça de salvar)." });
  }, [showToast]);

  const applyNomeContatoPatch = useCallback(
    (nomeTrim) => {
      if (!conversa?.id || !nomeTrim) return;
      const patch = {
        id: conversa.id,
        contato_nome: nomeTrim,
        nome_contato_cache: nomeTrim,
        cliente_nome: nomeTrim,
      };
      useConversaStore.getState().patchConversa(patch);
      useChatStore.getState().updateChat(patch);
    },
    [conversa?.id]
  );

  const handleCriarEVincularCliente = useCallback(async () => {
    if (!canEdit) {
      showToast?.({ type: "error", title: "Somente leitura", message: "Assuma a conversa para cadastrar o cliente." });
      return false;
    }
    if (creatingCliente) return false;
    if (!conversa?.id) return false;
    if (!telefoneCadastro) {
      showToast?.({ type: "error", title: "Telefone obrigatório", message: "Não foi possível identificar o telefone deste contato para criar o cadastro." });
      return false;
    }

    const date = String(nextDate || "").trim();
    const time = String(nextTime || "").trim();
    const note = String(nextNote || "").trim();
    const hasAny = Boolean(date || time || note);
    const hasDt = Boolean(date && time);
    if (hasAny && !hasDt && (date || time)) {
      showToast?.({
        type: "error",
        title: "Preencha dia e hora",
        message: "Para agendar o próximo contato, informe o dia e o horário (ou limpe os campos).",
      });
      return false;
    }

    const observacoes = buildObservacoesWithNextContact(cliObsText, hasDt ? { date, time, note } : null);

    setCreatingCliente(true);
    try {
      const payload = {
        telefone: telefoneCadastro,
        nome: String(cliNome || "").trim() || null,
        email: String(cliEmail || "").trim() || null,
        empresa: String(cliEmpresa || "").trim() || null,
        observacoes,
      };

      const createdRes = await cfg.criarCliente(payload);
      const created =
        createdRes?.cliente ||
        createdRes?.data?.cliente ||
        createdRes?.data ||
        createdRes;
      const newId =
        created?.id ??
        createdRes?.id ??
        createdRes?.cliente_id ??
        createdRes?.cliente?.id ??
        null;

      if (!newId) throw new Error("Cadastro criado, mas sem ID retornado pelo servidor.");

      await vincularClienteConversa(conversa.id, newId);

      safeAudit({
        acao: "detalhes_cliente_criar_e_vincular",
        conversa_id: conversa.id,
        cliente_id: newId,
        usuario_id: user?.id ?? null,
        usuario: user?.nome || user?.email || null,
        diff: diffObject(
          { cliente_id: null },
          {
            cliente_id: String(newId),
            telefone: telefoneCadastro,
            nome: payload.nome || "",
            email: payload.email || "",
            empresa: payload.empresa || "",
            proximo_contato_dia: hasDt ? date : "",
            proximo_contato_hora: hasDt ? time : "",
            proximo_contato_lembrete: hasDt ? note : "",
          }
        ),
        criado_em: new Date().toISOString(),
      });

      const nomeTrim = String(payload.nome || "").trim();
      if (nomeTrim) {
        try {
          const dataNome = await atualizarNomeContatoConversa(conversa.id, nomeTrim);
          const nomeOk = String(dataNome?.conversa?.contato_nome || nomeTrim).trim();
          applyNomeContatoPatch(nomeOk);
          setNomeContatoBase(nomeOk);
          setCliNome(nomeOk);
        } catch (_) {
          applyNomeContatoPatch(nomeTrim);
        }
      }
      showToast?.({ type: "success", title: "Cadastro criado", message: "Cliente cadastrado e vinculado à conversa." });
      onObservacaoSaved?.();
      return true;
    } catch (e) {
      console.error("Erro ao criar/vincular cliente:", e);
      showToast?.({
        type: "error",
        title: "Falha ao cadastrar",
        message: e?.response?.data?.erro || e?.response?.data?.error || e?.message || "Não foi possível criar/vincular o cliente.",
      });
      return false;
    } finally {
      setCreatingCliente(false);
    }
  }, [
    canEdit,
    creatingCliente,
    conversa?.id,
    telefoneCadastro,
    cliNome,
    cliEmail,
    cliEmpresa,
    cliObsText,
    nextDate,
    nextTime,
    nextNote,
    showToast,
    safeAudit,
    user?.id,
    user?.nome,
    user?.email,
    onObservacaoSaved,
    applyNomeContatoPatch,
  ]);

  const handleSalvarNomeContato = useCallback(async () => {
    if (!conversa?.id || savingNomeContato) return false;
    if (!canEdit) {
      showToast?.({
        type: "error",
        title: "Somente leitura",
        message: "Assuma a conversa para editar o nome.",
      });
      return false;
    }
    const nomeTrim = String(cliNome || "").trim();
    if (!nomeTrim) {
      showToast?.({ type: "error", title: "Nome obrigatório", message: "Informe o nome do contato." });
      return false;
    }
    setSavingNomeContato(true);
    try {
      const data = await atualizarNomeContatoConversa(conversa.id, nomeTrim);
      const nomeOk = String(data?.conversa?.nome_contato_cache || data?.conversa?.contato_nome || nomeTrim).trim();
      setCliNome(nomeOk);
      setNomeContatoBase(nomeOk);
      applyNomeContatoPatch(nomeOk);
      if (clienteId && data?.cliente) {
        setCliente(data.cliente);
        hydrateFromCliente(data.cliente);
      } else {
        setClienteBase((prev) => ({ ...prev, nome: nomeOk }));
      }
      showToast?.({ type: "success", title: "Nome atualizado", message: "O nome do contato foi salvo." });
      return true;
    } catch (e) {
      console.error("Erro ao salvar nome do contato:", e);
      showToast?.({
        type: "error",
        title: "Falha ao salvar nome",
        message: e?.response?.data?.error || e?.response?.data?.erro || e?.message || "Tente novamente.",
      });
      return false;
    } finally {
      setSavingNomeContato(false);
    }
  }, [
    conversa?.id,
    savingNomeContato,
    canEdit,
    cliNome,
    clienteId,
    showToast,
    applyNomeContatoPatch,
    hydrateFromCliente,
  ]);

  const hasNomeContatoChanges = useMemo(() => {
    return String(cliNome || "").trim() !== String(nomeContatoBase || "").trim();
  }, [cliNome, nomeContatoBase]);

  const hasClienteChanges = useMemo(() => {
    const norm = (v) => String(v || "");
    const nomeChanged = norm(cliNome).trim() !== norm(clienteBase.nome).trim();
    return (
      (!hasNomeContatoChanges && nomeChanged) ||
      norm(cliEmail).trim() !== norm(clienteBase.email).trim() ||
      norm(cliEmpresa).trim() !== norm(clienteBase.empresa).trim() ||
      norm(cliObsText).trim() !== norm(clienteBase.observacoes).trim() ||
      norm(nextDate) !== norm(clienteBase.nextDate) ||
      norm(nextTime) !== norm(clienteBase.nextTime) ||
      norm(nextNote).trim() !== norm(clienteBase.nextNote).trim()
    );
  }, [cliNome, cliEmail, cliEmpresa, cliObsText, nextDate, nextTime, nextNote, clienteBase, hasNomeContatoChanges]);

  const handleSalvarCliente = useCallback(async () => {
    if (!clienteId || savingCliente) return false;
    if (!canEdit) {
      showToast?.({
        type: "error",
        title: "Somente leitura",
        message: "Assuma a conversa para editar/salvar detalhes.",
      });
      return false;
    }

    const date = String(nextDate || "").trim();
    const time = String(nextTime || "").trim();
    const note = String(nextNote || "").trim();

    // validação: se um dos dois foi preenchido, exige ambos
    const hasAny = Boolean(date || time || note);
    const hasDt = Boolean(date && time);
    if (hasAny && !hasDt && (date || time)) {
      showToast?.({
        type: "error",
        title: "Preencha dia e hora",
        message: "Para agendar o próximo contato, informe o dia e o horário (ou limpe os campos).",
      });
      return false;
    }

    const observacoes = buildObservacoesWithNextContact(cliObsText, hasDt ? { date, time, note } : null);

    setSavingCliente(true);
    try {
      const before = {
        nome: clienteBase.nome,
        email: clienteBase.email,
        empresa: clienteBase.empresa,
        observacoes: clienteBase.observacoes,
        proximo_contato_dia: clienteBase.nextDate,
        proximo_contato_hora: clienteBase.nextTime,
        proximo_contato_lembrete: clienteBase.nextNote,
      };
      const payload = {
        nome: String(cliNome || "").trim() || null,
        email: String(cliEmail || "").trim() || null,
        empresa: String(cliEmpresa || "").trim() || null,
        observacoes,
      };
      const updated = await cfg.atualizarCliente(clienteId, payload);
      setCliente(updated || { ...(cliente || {}), ...payload, id: clienteId });
      hydrateFromCliente(updated || { ...(cliente || {}), ...payload, id: clienteId });
      const nomeTrim = String(cliNome || "").trim();
      if (nomeTrim) {
        await atualizarNomeContatoConversa(conversa.id, nomeTrim);
        applyNomeContatoPatch(nomeTrim);
        setNomeContatoBase(nomeTrim);
      }
      showToast?.({ type: "success", title: "Cliente salvo", message: "Dados do cliente atualizados com sucesso." });
      const after = {
        nome: String(cliNome || "").trim() || "",
        email: String(cliEmail || "").trim() || "",
        empresa: String(cliEmpresa || "").trim() || "",
        observacoes: String(cliObsText || "").trim() || "",
        proximo_contato_dia: date || "",
        proximo_contato_hora: time || "",
        proximo_contato_lembrete: note || "",
      };
      safeAudit({
        acao: "detalhes_cliente_salvar_cadastro",
        conversa_id: conversa?.id ?? null,
        cliente_id: clienteId,
        usuario_id: user?.id ?? null,
        usuario: user?.nome || user?.email || null,
        diff: diffObject(before, after),
        criado_em: new Date().toISOString(),
      });
      onObservacaoSaved?.(); // reaproveita refresh da tela (se necessário)
      return true;
    } catch (e) {
      console.error("Erro ao salvar cliente:", e);
      showToast?.({
        type: "error",
        title: "Falha ao salvar cliente",
        message: e?.response?.data?.erro || e?.response?.data?.error || e?.message || "Não foi possível salvar.",
      });
      return false;
    } finally {
      setSavingCliente(false);
    }
  }, [
    clienteId,
    savingCliente,
    canEdit,
    cliNome,
    cliEmail,
    cliEmpresa,
    cliObsText,
    nextDate,
    nextTime,
    nextNote,
    showToast,
    onObservacaoSaved,
    hydrateFromCliente,
    cliente,
    clienteBase,
    safeAudit,
    conversa?.id,
    user?.id,
    user?.nome,
    user?.email,
    conversa?.id,
    applyNomeContatoPatch,
  ]);

  const hasObsChanges = useMemo(
    () => String(observacao || "") !== String(obsBase || ""),
    [observacao, obsBase]
  );
  const savingAny = Boolean(savingObs || savingCliente || creatingCliente || savingNomeContato);
  const hasAnyChanges = Boolean(hasObsChanges || hasClienteChanges || hasNomeContatoChanges);

  const handleSalvarTudo = useCallback(async () => {
    if (!canEdit) {
      showToast?.({
        type: "error",
        title: "Somente leitura",
        message: "Assuma a conversa para salvar alterações.",
      });
      return;
    }
    if (savingAny) return;

    let did = false;

    if (hasNomeContatoChanges) {
      did = true;
      await handleSalvarNomeContato();
    }

    if (hasObsChanges) {
      did = true;
      await handleSalvarObs();
    }

    if (clienteId) {
      if (hasClienteChanges) {
        did = true;
        await handleSalvarCliente();
      }
    } else if (hasClienteChanges) {
      did = true;
      await handleCriarEVincularCliente();
    }

    if (!did) {
      showToast?.({ type: "info", title: "Tudo certo", message: "Não há alterações pendentes." });
    }
  }, [
    canEdit,
    savingAny,
    hasObsChanges,
    hasClienteChanges,
    hasNomeContatoChanges,
    clienteId,
    handleSalvarObs,
    handleSalvarNomeContato,
    handleSalvarCliente,
    handleCriarEVincularCliente,
    showToast,
  ]);

  if (!open) return null;

  if (isGroup) {
    return (
      <div className="wa-sideCliente" role="complementary" aria-label="Detalhes do grupo">
        <div className="wa-sideCliente-head">
          <div className="wa-sideCliente-titleBlock">
            <span className="wa-sideCliente-title">Conversa de grupo</span>
            <span className="wa-sideCliente-sub">Informações da conversa</span>
          </div>
          <button type="button" className="wa-iconBtn" onClick={onClose} title="Fechar">
            <span>×</span>
          </button>
        </div>
        <div className="wa-sideCliente-body">
          <section className="wa-sideCliente-section">
            <h3 className="wa-sideCliente-sectionTitle">Grupo</h3>
            <div className="wa-sideCliente-row">
              <span className="wa-sideCliente-label">Nome</span>
              <span className="wa-sideCliente-value">{conversa?.nome_grupo || "Grupo"}</span>
            </div>
          </section>
          <section className="wa-sideCliente-section">
            <h3 className="wa-sideCliente-sectionTitle">Atendimento</h3>
            <div className="wa-sideCliente-row">
              <span className="wa-sideCliente-label">Status</span>
              <span className="wa-sideCliente-value">{statusLabel}</span>
            </div>
            <div className="wa-sideCliente-row">
              <span className="wa-sideCliente-label">Responsável</span>
              <span className="wa-sideCliente-value">{responsavelNome}</span>
            </div>
            {createdAt ? (
              <div className="wa-sideCliente-row">
                <span className="wa-sideCliente-label">Criado em</span>
                <span className="wa-sideCliente-value">{createdAt}</span>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="wa-sideCliente" role="complementary" aria-label="Detalhes do cliente">
      <div className="wa-sideCliente-head">
        <div className="wa-sideCliente-titleBlock">
          <span className="wa-sideCliente-title">Detalhes do cliente</span>
          <span className="wa-sideCliente-sub">Informações da conversa atual</span>
        </div>
        <button
          type="button"
          className="wa-iconBtn"
          onClick={onClose}
          title="Fechar"
        >
          <span>×</span>
        </button>
      </div>

      <div className="wa-sideCliente-body">
        <section className="wa-sideCliente-hero" aria-label="Resumo do cliente">
          <div className="wa-sideCliente-avatar">
            <span className="wa-sideCliente-avatarFallback" aria-hidden="true">{initials(clienteNome)}</span>
            {fotoPerfil && !avatarImgError ? (
              <img
                className="wa-sideCliente-avatarImg"
                src={fotoPerfil}
                alt=""
                onError={() => setAvatarImgError(true)}
              />
            ) : null}
          </div>
          <div className="wa-sideCliente-heroMain">
            <div className="wa-sideCliente-heroTop">
              {canEdit ? (
                <input
                  type="text"
                  className="wa-sideCliente-input wa-sideCliente-heroNameInput"
                  value={cliNome}
                  onChange={(e) => setCliNome(e.target.value)}
                  placeholder="Nome do contato"
                  disabled={savingAny}
                  aria-label="Nome do contato"
                  maxLength={120}
                />
              ) : (
                <div className="wa-sideCliente-heroName" title={clienteNome}>
                  {clienteNome}
                </div>
              )}
              <span className={`wa-sideCliente-pill wa-sideCliente-pill--${statusTone}`}>{statusLabel}</span>
            </div>
            <div className="wa-sideCliente-heroSub">
              {telefone ? <span className="wa-sideCliente-mono">{telefone}</span> : <span className="wa-sideCliente-muted">Sem telefone</span>}
              {empresaDisplay ? (
                <>
                  <span className="wa-sideCliente-dotSep" aria-hidden="true">•</span>
                  <span className="wa-sideCliente-muted" title={`Empresa: ${empresaDisplay}`}>{empresaDisplay}</span>
                </>
              ) : null}
              {tempoSemResponder != null ? (
                <>
                  <span className="wa-sideCliente-dotSep" aria-hidden="true">•</span>
                  <span className="wa-sideCliente-sla">
                    <span className="wa-sideCliente-muted">Sem responder há</span>{" "}
                    <span className="wa-sideCliente-slaValue">{tempoSemResponder}</span>
                  </span>
                </>
              ) : null}
            </div>
            <div className="wa-sideCliente-heroMeta">
              <span className="wa-sideCliente-muted">Responsável:</span>{" "}
              <span className="wa-sideCliente-valueInline">{responsavelNome}</span>
              {createdAt ? (
                <>
                  <span className="wa-sideCliente-dotSep" aria-hidden="true">•</span>
                  <span className="wa-sideCliente-muted">Criado:</span>{" "}
                  <span className="wa-sideCliente-valueInline">{createdAt}</span>
                </>
              ) : null}
            </div>
            <div className="wa-sideCliente-heroActions" aria-label="Ações rápidas">
              {telefone ? (
                <a href={`tel:${telDigits}`} className="wa-iconBtn wa-sideCliente-actionBtn" title="Ligar" aria-label="Ligar">
                  📞
                </a>
              ) : (
                <button type="button" className="wa-iconBtn wa-sideCliente-actionBtn" title="Sem telefone" disabled>
                  📞
                </button>
              )}
              <button
                type="button"
                className="wa-iconBtn wa-sideCliente-actionBtn"
                title="Copiar telefone"
                disabled={!telefone}
                onClick={async () => {
                  if (!telefone) return;
                  const ok = await copyText(telefone);
                  showToast?.({
                    type: ok ? "success" : "error",
                    title: ok ? "Copiado" : "Falha",
                    message: ok ? "Telefone copiado." : "Não foi possível copiar.",
                  });
                }}
              >
                ⧉
              </button>
              {crmHref ? (
                <a
                  href={crmHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="wa-iconBtn wa-sideCliente-actionBtn"
                  title="Abrir CRM"
                  aria-label="Abrir CRM"
                >
                  ⤴
                </a>
              ) : (
                <button type="button" className="wa-iconBtn wa-sideCliente-actionBtn" title="CRM não configurado" disabled>
                  ⤴
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="wa-sideCliente-section" aria-label="Cadastro do cliente">
          <div className="wa-sideCliente-sectionHead">
            <h3 className="wa-sideCliente-sectionTitle">Cliente</h3>
            <span className={`wa-sideCliente-miniPill ${canEdit ? "isEdit" : "isRead"}`}>
              {canEdit ? "Editando" : "Somente leitura"}
            </span>
          </div>
          {!canEdit ? (
            <div className="wa-sideCliente-lockHint">
              Para editar/salvar, você precisa <strong>assumir esta conversa</strong>.
            </div>
          ) : null}
          {!clienteId ? (
            <div className="wa-sideCliente-lockHint">
              Este contato ainda está <strong>sem cadastro</strong>. Você pode criar e vincular o cadastro aqui mesmo.
            </div>
          ) : null}
          {clienteLoading ? (
            <div className="wa-sideCliente-hint">Carregando cadastro do cliente…</div>
          ) : null}

          <h4 className="wa-sideCliente-subTitle">Próximo contato</h4>
          <div className="wa-sideCliente-grid2">
            <div className="wa-sideCliente-field">
              <span className="wa-sideCliente-label">Dia</span>
              <input
                type="date"
                className="wa-sideCliente-input"
                value={nextDate}
                onChange={(e) => setNextDate(e.target.value)}
                disabled={!canEdit || savingCliente || creatingCliente}
              />
              <div className="wa-sideCliente-miniActions">
                <button type="button" className="wa-miniBtn" onClick={setDateToday} disabled={!canEdit || savingCliente || creatingCliente}>
                  Hoje
                </button>
                <button type="button" className="wa-miniBtn" onClick={setDateTomorrow} disabled={!canEdit || savingCliente || creatingCliente}>
                  Amanhã
                </button>
              </div>
            </div>
            <div className="wa-sideCliente-field">
              <span className="wa-sideCliente-label">Horário</span>
              <input
                type="time"
                className="wa-sideCliente-input"
                value={nextTime}
                onChange={(e) => setNextTime(e.target.value)}
                disabled={!canEdit || savingCliente || creatingCliente}
              />
            </div>
          </div>
          <div className="wa-sideCliente-field">
            <span className="wa-sideCliente-label">Lembrete (opcional)</span>
            <input
              className="wa-sideCliente-input"
              value={nextNote}
              onChange={(e) => setNextNote(e.target.value)}
              placeholder='Ex.: "confirmar pagamento" / "retornar com proposta"'
              disabled={!canEdit || savingCliente || creatingCliente}
            />
          </div>

          <details className="wa-sideCliente-details">
            <summary>Cadastro completo</summary>
            <div className="wa-sideCliente-field">
              <span className="wa-sideCliente-label">Nome</span>
              <input
                className="wa-sideCliente-input"
                value={cliNome}
                onChange={(e) => setCliNome(e.target.value)}
                placeholder="Nome do cliente"
                disabled={!canEdit || savingCliente || creatingCliente}
              />
            </div>
            <div className="wa-sideCliente-grid2">
              <div className="wa-sideCliente-field">
                <span className="wa-sideCliente-label">Email</span>
                <input
                  className="wa-sideCliente-input"
                  value={cliEmail}
                  onChange={(e) => setCliEmail(e.target.value)}
                  placeholder="email@empresa.com"
                  inputMode="email"
                  autoComplete="email"
                  disabled={!canEdit || savingCliente || creatingCliente}
                />
              </div>
              <div className="wa-sideCliente-field">
                <span className="wa-sideCliente-label">Empresa</span>
                <input
                  className="wa-sideCliente-input"
                  value={cliEmpresa}
                  onChange={(e) => setCliEmpresa(e.target.value)}
                  placeholder="Empresa (opcional)"
                  disabled={!canEdit || savingCliente || creatingCliente}
                />
              </div>
            </div>
            <div className="wa-sideCliente-field">
              <span className="wa-sideCliente-label">Observações do cliente</span>
              <textarea
                className="wa-sideCliente-textarea"
                value={cliObsText}
                onChange={(e) => setCliObsText(e.target.value)}
                placeholder="Preferências, contexto, histórico..."
                disabled={!canEdit || savingCliente || creatingCliente}
              />
            </div>
          </details>
        </section>

        {Array.isArray(tags) && tags.length > 0 ? (
          <details className="wa-sideCliente-details wa-sideCliente-details--tags">
            <summary>Tags</summary>
            <div className="wa-sideCliente-tags" style={{ marginTop: 10 }}>
              {tags.map((t) => (
                <span key={t.id} className="wa-tagChip isSelected">
                  <span className="wa-tagChip-label">{t.nome}</span>
                </span>
              ))}
            </div>
          </details>
        ) : null}

        <section className="wa-sideCliente-section">
          <div className="wa-sideCliente-sectionHead">
            <h3 className="wa-sideCliente-sectionTitle">Observação do atendimento</h3>
            {!canEdit ? <span className="wa-sideCliente-miniPill isRead">Somente leitura</span> : null}
          </div>
          <textarea
            className="wa-sideCliente-textarea"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="Ex.: Cliente VIP, prefere contato à tarde, combinou retorno amanhã..."
            disabled={!canEdit}
          />
        </section>

        <div className="wa-sideCliente-saveBar" role="region" aria-label="Salvar alterações">
          <div className="wa-sideCliente-saveLeft">
            {!canEdit ? (
              <span className="wa-sideCliente-saveStatus">Somente leitura</span>
            ) : savingAny ? (
              <span className="wa-sideCliente-saveStatus">Salvando…</span>
            ) : !clienteId ? (
              <span className="wa-sideCliente-saveStatus">Cadastro pendente</span>
            ) : hasAnyChanges ? (
              <span className="wa-sideCliente-saveStatus isWarn">Alterações pendentes</span>
            ) : (
              <span className="wa-sideCliente-saveStatus isOk">Tudo salvo</span>
            )}
          </div>
          <div className="wa-sideCliente-saveRight">
            {(nextDate || nextTime || nextNote) ? (
              <button
                type="button"
                className="wa-btn wa-btn-ghost"
                onClick={handleLimparProximoContato}
                disabled={!canEdit || savingAny}
                title="Limpar próximo contato (não salva automaticamente)"
              >
                Limpar
              </button>
            ) : null}
            <button
              type="button"
              className="wa-btn wa-btn-primary"
              onClick={handleSalvarTudo}
              disabled={
                !canEdit ||
                savingAny ||
                (!clienteId && !telefoneCadastro) ||
                (!clienteId && !hasAnyChanges) ||
                (clienteId && !hasAnyChanges)
              }
              aria-busy={savingAny}
              title={!clienteId ? "Criar e vincular" : "Salvar alterações"}
            >
              {!clienteId ? (creatingCliente ? "Criando..." : "Criar e vincular") : (savingAny ? "Salvando..." : "Salvar")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
