import { useEffect, useState, useCallback } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuthStore } from "../auth/authStore";
import { usePermissoesStore } from "../auth/permissoesStore";
import { canAcessarConfiguracoes } from "../auth/permissions";
import { useNotificationStore } from "../notifications/notificationStore";
import api from "../api/http";
import * as iaApi from "../api/iaService";
import { getClientes, getUsuarios } from "../api/configService";
import Breadcrumb from "../components/layout/Breadcrumb";
import { SkeletonGrid } from "../components/feedback/Skeleton";
import Switch from "../components/ui/Switch";
import { normalizeFinalizationMessage } from "./iaConfigPayload";
import "../components/layout/breadcrumb.css";
import "../components/feedback/skeleton.css";
import "../components/ui/switch.css";
import "./IA.css";

const DEFAULT_CONFIG = {
  ia: {
    usar_ia: false,
    sugerir_respostas: true,
    corrigir_texto: false,
    auto_completar: false,
    resumo_conversa: true,
    classificar_intencao: true,
    sugerir_tags: true,
  },
  automacoes: {
    encerrar_automatico_min: 0,
    mensagem_encerramento_inatividade: "-conversa encerrada por conta de inatividade-",
    transferir_para_humano_apos_bot: true,
    limite_mensagens_bot: 5,
    auto_assumir: false,
    reabrir_automaticamente: false,
  },
  chatbot_triage: {
    enabled: false,
    welcomeMessage: "",
    invalidOptionMessage: "Opção inválida. Por favor, responda apenas com o número do setor desejado.",
    confirmSelectionMessage: "Perfeito! Seu atendimento foi direcionado para o setor {{departamento}}. Em instantes nossa equipe dará continuidade.",
    enviarMensagemFinalizacao: false,
    mensagemFinalizacao: "Atendimento finalizado com sucesso. (Segue seu protocolo: {{protocolo}}.\nPor favor, informe uma nota entre 0 e 10 para avaliar o atendimento prestado.)",
    foraHorarioEnabled: false,
    horarioInicio: "09:00",
    horarioFim: "18:00",
    diasSemanaDesativados: [0, 6],
    datasEspecificasFechadas: [],
    mensagemForaHorario: "Olá! Nosso horário de atendimento é de segunda a sexta, das 09h às 18h. Sua mensagem foi recebida e retornaremos no próximo dia útil. Obrigado!",
    intervaloEnvioSegundos: 3,
    sendOnlyFirstTime: true,
    fallbackToAI: false,
    businessHoursOnly: false,
    transferMode: "departamento",
    tipo_distribuicao: "fila",
    reopenMenuCommand: "0",
    options: [],
    finalizar_por_ausencia_ativo: false,
    finalizar_por_ausencia_prazo: 24,
    finalizar_por_ausencia_unidade: "horas_corridas",
    finalizar_por_ausencia_enviar_mensagem: false,
    finalizar_por_ausencia_mensagem: "",
    finalizar_por_ausencia_reabrir_automaticamente: true,
    finalizar_por_ausencia_reabrir_sem_chatbot: true,
  },
  admin_atendimento_alerta: {
    ativo: false,
    cliente_id: null,
    cliente_nome: "",
    telefone_admin: "",
    horario_envio: "09:00",
    timezone: "",
    incluir_nota_media: false,
    incluir_conversas_sem_resposta: true,
  },
};

const DEFAULT_ALERTA_SEM_RESPOSTA = {
  alerta_sem_resposta_ativo: false,
  tempo_primeiro_alerta_minutos: 1,
  tempo_alerta_critico_minutos: 3,
  tempo_notificar_gestor_minutos: 5,
  notificar_por_whatsapp: false,
  notificar_por_email: false,
  notificar_interno: true,
  reabrir_conversa_automaticamente: true,
  aplicar_tag_automatica: true,
  nome_tag_automatica: "Reaberta por falta de resposta",
  gestor_notificado_id: null,
  gestor_cliente_id: null,
  gestor_cliente_nome: "",
  responsaveis_notificacao_ids: [],
  telefone_gestor: "",
  horario_comercial_ativo: true,
  timezone: "America/Sao_Paulo",
  horarioInicio: "09:00",
  horarioFim: "18:00",
  diasSemanaDesativados: [0, 6],
  datasEspecificasFechadas: [],
  horario_comercial: null,
};

function normalizeHorarioAdminAlerta(t) {
  if (!t || typeof t !== "string") return "09:00";
  const m = t.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return "09:00";
  const h = Math.max(0, Math.min(23, parseInt(m[1], 10)));
  const min = Math.max(0, Math.min(59, parseInt(m[2], 10)));
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function mergeAdminAtendimentoAlertaFromApi(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  const ativoRaw = s.ativo;
  const ativo =
    ativoRaw === true ||
    ativoRaw === 1 ||
    String(ativoRaw || "")
      .trim()
      .toLowerCase() === "true";
  return {
    ...DEFAULT_CONFIG.admin_atendimento_alerta,
    ...s,
    ativo,
    cliente_id: Number.isInteger(Number(s.cliente_id)) && Number(s.cliente_id) > 0 ? Number(s.cliente_id) : null,
    cliente_nome: String(s.cliente_nome || "").trim().slice(0, 120),
    telefone_admin: String(s.telefone_admin || "").trim().slice(0, 40),
    horario_envio: normalizeHorarioAdminAlerta(s.horario_envio),
    timezone: String(s.timezone || "").trim().slice(0, 80),
    incluir_nota_media: s.incluir_nota_media === true,
    incluir_conversas_sem_resposta: s.incluir_conversas_sem_resposta !== false,
  };
}

/** Une resposta GET /ia/config com defaults para não perder chaves (ex.: chatbot_triage.finalizar_por_ausencia_*). */
function mergeIaConfigFromApi(server) {
  if (!server || typeof server !== "object") return { ...DEFAULT_CONFIG };
  const ctRaw = server.chatbot_triage;
  const ct = ctRaw && typeof ctRaw === "object" ? ctRaw : {};
  const enviarMensagemAusencia =
    ct.finalizar_por_ausencia_enviar_mensagem == null
      ? Boolean(String(ct.finalizar_por_ausencia_mensagem ?? "").trim())
      : ct.finalizar_por_ausencia_enviar_mensagem !== false;
  return {
    ia: { ...DEFAULT_CONFIG.ia, ...(server.ia || {}) },
    automacoes: { ...DEFAULT_CONFIG.automacoes, ...(server.automacoes || {}) },
    chatbot_triage: {
      ...DEFAULT_CONFIG.chatbot_triage,
      ...ct,
      finalizar_por_ausencia_enviar_mensagem: enviarMensagemAusencia,
      options: Array.isArray(ct.options) ? ct.options : DEFAULT_CONFIG.chatbot_triage.options,
    },
    admin_atendimento_alerta: mergeAdminAtendimentoAlertaFromApi(server.admin_atendimento_alerta),
  };
}

function iaConfigCacheKey(companyKey) {
  return `ia_config_cache_${String(companyKey || "default")}`;
}

function readIaConfigCache(companyKey) {
  try {
    const raw = localStorage.getItem(iaConfigCacheKey(companyKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return mergeIaConfigFromApi(parsed);
  } catch {
    return null;
  }
}

function writeIaConfigCache(companyKey, config) {
  try {
    localStorage.setItem(iaConfigCacheKey(companyKey), JSON.stringify(config || {}));
  } catch {}
}

const TABS = [
  { id: "chatbot", label: "Chatbot de Triagem" },
  { id: "respostas", label: "Respostas automáticas" },
  { id: "ia", label: "IA (sugestões)" },
  { id: "automacoes", label: "Automações" },
  { id: "alertas", label: "Alertas de Atendimento" },
  { id: "logs", label: "Logs do bot" },
];

export default function IA() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  /** Re-render quando permissões carregam (login) — can() passa a refletir a API. */
  const permissoes = usePermissoesStore((s) => s.permissoes);
  const companyKey =
    user?.empresa_id ??
    user?.company_id ??
    user?.empresaId ??
    user?.companyId ??
    "";
  const isAdmin = canAcessarConfiguracoes(user);

  const tabFromUrl = searchParams.get("tab");
  const resolvedTab = tabFromUrl === "bot" ? "chatbot" : (TABS.some((t) => t.id === tabFromUrl) ? tabFromUrl : "chatbot");
  const [tab, setTab] = useState(resolvedTab);

  useEffect(() => {
    const next = tabFromUrl === "bot" ? "chatbot" : (TABS.some((t) => t.id === tabFromUrl) ? tabFromUrl : "chatbot");
    setTab(next);
  }, [tabFromUrl]);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [regras, setRegras] = useState([]);
  const [logs, setLogs] = useState([]);
  const [departamentos, setDepartamentos] = useState([]);
  const [tags, setTags] = useState([]);
  const [formRegra, setFormRegra] = useState({ palavra_chave: "", resposta: "", departamento_id: "", tag_id: "", aplicar_tag: false, horario_comercial_only: false });
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    if (!isAdmin) navigate("/atendimento", { replace: true });
  }, [isAdmin, navigate]);

  const loadRegras = useCallback(async () => {
    try {
      const r = await iaApi.getRegras();
      setRegras(r || []);
    } catch (e) {
      console.error("Erro ao carregar regras:", e);
    }
  }, []);

  const loadLogs = useCallback(async () => {
    try {
      const l = await iaApi.getLogs(50);
      setLogs(l || []);
    } catch (e) {
      console.error("Erro ao carregar logs:", e);
    }
  }, []);

  /** GET /ia/config + departamentos/tags sempre no mount e quando sessão/tenant/permissões mudam (não depender só de “Atualizar”). */
  useEffect(() => {
    if (!isAdmin || !token) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [c, dep, tag] = await Promise.all([
          iaApi.getConfig(),
          api.get("/dashboard/departamentos").then((r) => r.data || []),
          api.get("/tags").then((r) => r.data || []),
        ]);
        if (cancelled) return;
        const merged = mergeIaConfigFromApi(c);
        setConfig(merged);
        writeIaConfigCache(companyKey, merged);
        setDepartamentos(dep);
        setTags(tag);
        setErrorMsg(null);
      } catch (e) {
        console.error("Erro ao carregar config IA:", e);
        if (!cancelled) {
          const cached = readIaConfigCache(companyKey);
          setConfig(cached || { ...DEFAULT_CONFIG });
          setErrorMsg("Não foi possível carregar configurações. Tente novamente.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, token, companyKey, permissoes]);

  useEffect(() => {
    if (tab === "respostas") loadRegras();
    if (tab === "logs" || tab === "chatbot") loadLogs();
  }, [tab, loadRegras, loadLogs]);

  if (!isAdmin) return null;

  const showToast = useNotificationStore((s) => s.showToast);

  const handleSaveConfig = async (section, values) => {
    setSaving(true);
    setErrorMsg(null);
    try {
      const c = await iaApi.putConfig({ [section]: values });
      const merged = mergeIaConfigFromApi(c);
      setConfig(merged);
      writeIaConfigCache(companyKey, merged);
      showToast({ type: "success", title: "Salvo", message: "Configuração salva com sucesso." });
    } catch (e) {
      console.error("Erro ao salvar config:", e);
      setErrorMsg(e?.response?.data?.error || "Erro ao salvar. Verifique se a migration foi executada no banco.");
    } finally {
      setSaving(false);
    }
  };

  const handleAddRegra = async (e) => {
    e.preventDefault();
    if (!formRegra.palavra_chave?.trim() || !formRegra.resposta?.trim()) return;
    try {
      await iaApi.postRegra({
        palavra_chave: formRegra.palavra_chave.trim(),
        resposta: formRegra.resposta.trim(),
        departamento_id: formRegra.departamento_id || null,
        tag_id: formRegra.tag_id || null,
        aplicar_tag: formRegra.aplicar_tag,
        horario_comercial_only: formRegra.horario_comercial_only,
      });
      setFormRegra({ palavra_chave: "", resposta: "", departamento_id: "", tag_id: "", aplicar_tag: false, horario_comercial_only: false });
      loadRegras();
    } catch (e) {
      console.error("Erro ao criar regra:", e);
    }
  };

  const handleDeleteRegra = async (id) => {
    if (!confirm("Excluir esta regra?")) return;
    try {
      await iaApi.deleteRegra(id);
      loadRegras();
    } catch (e) {
      console.error("Erro ao excluir regra:", e);
    }
  };

  if (loading) {
    return (
      <div className="ia-wrap">
        <div className="ia-header">
          <Breadcrumb items={[{ label: "Configurações", to: "/configuracoes" }, { label: "IA / Chatbot" }]} />
          <h1 className="ia-title">IA / Bot / Automação</h1>
          <p className="ia-subtitle">Configurações de automação do CRM</p>
        </div>
        <div className="ia-content ia-loading-skeleton">
          <SkeletonGrid count={4} />
        </div>
      </div>
    );
  }

  const cfg = config || DEFAULT_CONFIG;

  const ia = cfg.ia || {};
  const auto = cfg.automacoes || {};

  return (
    <div className="ia-wrap">
      <header className="ia-header">
        <Breadcrumb items={[{ label: "Configurações", to: "/configuracoes" }, { label: "IA / Chatbot" }]} />
        <h1 className="ia-title">IA / Bot / Automação</h1>
        <p className="ia-subtitle">Configure automações. Se desligado → atendimento 100% humano.</p>
      </header>

      {errorMsg && (
        <div className="ia-error-banner" role="alert">
          {errorMsg}
          <button type="button" onClick={() => setErrorMsg(null)} aria-label="Fechar">×</button>
        </div>
      )}

      <nav className="ia-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`ia-tab ${tab === t.id ? "ia-tab--active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="ia-content">
        {tab === "chatbot" && (
          <SecaoChatbotTriagem
            config={cfg.chatbot_triage || DEFAULT_CONFIG.chatbot_triage}
            adminAtendimentoAlerta={cfg.admin_atendimento_alerta || DEFAULT_CONFIG.admin_atendimento_alerta}
            departamentos={departamentos}
            logs={logs}
            onSave={(v) => handleSaveConfig("chatbot_triage", v)}
            onSaveAdminAlert={(v) => handleSaveConfig("admin_atendimento_alerta", v)}
            onRefreshLogs={loadLogs}
            saving={saving}
          />
        )}
        {tab === "respostas" && (
          <SecaoRespostasAutomaticas
            regras={regras}
            formRegra={formRegra}
            setFormRegra={setFormRegra}
            departamentos={departamentos}
            tags={tags}
            onAdd={handleAddRegra}
            onDelete={handleDeleteRegra}
          />
        )}
        {tab === "ia" && (
          <SecaoIA
            config={ia}
            onSave={(v) => handleSaveConfig("ia", v)}
            saving={saving}
          />
        )}
        {tab === "automacoes" && (
          <SecaoAutomacoes
            config={auto}
            onSave={(v) => handleSaveConfig("automacoes", v)}
            saving={saving}
          />
        )}
        {tab === "alertas" && <SecaoAlertasAtendimento />}
        {tab === "logs" && <SecaoLogs logs={logs} onRefresh={loadLogs} />}
      </div>
    </div>
  );
}

function SecaoRespostasAutomaticas({ regras, formRegra, setFormRegra, departamentos, tags, onAdd, onDelete }) {
  return (
    <div className="ia-section ia-auto-reply-section">
      <header className="ia-auto-reply-header">
        <span className="ia-auto-reply-eyebrow">Automação do bot</span>
        <h4 className="ia-auto-reply-title">Respostas automáticas</h4>
        <p className="ia-auto-reply-lead">
          O sistema responde <strong>sozinho</strong> quando o cliente envia uma palavra-chave na conversa.
          Ideal para horário, endereço, prazos e mensagens repetitivas.
        </p>
      </header>

      <div className="ia-callout ia-callout--warn" role="note">
        <div className="ia-callout-icon" aria-hidden="true">!</div>
        <div className="ia-callout-body">
          <p className="ia-callout-title">Isto não aparece no atalho <kbd>/</kbd> do atendimento</p>
          <p className="ia-callout-text">
            Regras aqui são do <strong>chatbot</strong> (resposta automática ao cliente).
            Para o atendente preencher o campo de mensagem com <kbd>/</kbd>, cadastre em{" "}
            <Link to="/configuracoes?tab=respostas" className="ia-callout-link">
              Configurações → Respostas salvas
            </Link>
            .
          </p>
        </div>
      </div>

      <div className="ia-auto-reply-form-card">
        <h5 className="ia-auto-reply-card-title">Nova regra automática</h5>
        <p className="ia-muted ia-auto-reply-card-hint">
          Exemplo: cliente digita &quot;horário&quot; → o bot envia a resposta cadastrada.
        </p>

        <form onSubmit={onAdd} className="ia-auto-reply-form">
          <div className="ia-auto-reply-form-grid">
            <div className="ia-field">
              <label htmlFor="regra-palavra">Palavra-chave do cliente</label>
              <input
                id="regra-palavra"
                type="text"
                className="ia-input"
                value={formRegra.palavra_chave}
                onChange={(e) => setFormRegra((f) => ({ ...f, palavra_chave: e.target.value }))}
                placeholder="ex: horário, teste, preço"
              />
            </div>
            <div className="ia-field ia-field--span2">
              <label htmlFor="regra-resposta">Resposta que o bot enviará</label>
              <textarea
                id="regra-resposta"
                className="ia-textarea ia-auto-reply-textarea"
                value={formRegra.resposta}
                onChange={(e) => setFormRegra((f) => ({ ...f, resposta: e.target.value }))}
                placeholder="Nosso horário de atendimento é de segunda a sexta, das 9h às 18h."
                rows={3}
              />
            </div>
            <div className="ia-field">
              <label htmlFor="regra-setor">Setor ao casar (opcional)</label>
              <select
                id="regra-setor"
                className="ia-select"
                value={formRegra.departamento_id}
                onChange={(e) => setFormRegra((f) => ({ ...f, departamento_id: e.target.value }))}
              >
                <option value="">Não alterar setor</option>
                {departamentos.map((d) => (
                  <option key={d.id} value={d.id}>{d.nome}</option>
                ))}
              </select>
            </div>
            <div className="ia-field">
              <label htmlFor="regra-tag">Tag a aplicar (opcional)</label>
              <select
                id="regra-tag"
                className="ia-select"
                value={formRegra.tag_id}
                onChange={(e) => setFormRegra((f) => ({ ...f, tag_id: e.target.value }))}
              >
                <option value="">Nenhuma</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>{t.nome}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="ia-auto-reply-options">
            <label className="ia-auto-reply-check">
              <input
                type="checkbox"
                checked={formRegra.aplicar_tag}
                onChange={(e) => setFormRegra((f) => ({ ...f, aplicar_tag: e.target.checked }))}
              />
              <span>Aplicar tag automaticamente na conversa</span>
            </label>
            <label className="ia-auto-reply-check">
              <input
                type="checkbox"
                checked={formRegra.horario_comercial_only}
                onChange={(e) => setFormRegra((f) => ({ ...f, horario_comercial_only: e.target.checked }))}
              />
              <span>Responder apenas em horário comercial</span>
            </label>
          </div>

          <div className="ia-btn-row">
            <button type="submit" className="ia-btn ia-btn--primary">
              Salvar regra automática
            </button>
          </div>
        </form>
      </div>

      <div className="ia-auto-reply-rules">
        <div className="ia-auto-reply-rules-head">
          <h5 className="ia-auto-reply-card-title">Regras cadastradas</h5>
          <span className="ia-auto-reply-count">{regras.length}</span>
        </div>

        {regras.length === 0 ? (
          <div className="ia-auto-reply-empty">
            <p>Nenhuma regra automática ainda.</p>
            <p className="ia-muted">Quando o cliente enviar a palavra-chave, o bot responderá sozinho.</p>
          </div>
        ) : (
          <ul className="ia-auto-reply-list">
            {regras.map((r) => (
              <li key={r.id} className="ia-auto-reply-card">
                <div className="ia-auto-reply-card-top">
                  <span className="ia-auto-reply-keyword">{r.palavra_chave}</span>
                  <span className="ia-auto-reply-arrow" aria-hidden="true">→</span>
                  <p className="ia-auto-reply-response">{r.resposta}</p>
                </div>
                <div className="ia-auto-reply-card-meta">
                  {r.departamentos?.nome ? (
                    <span className="ia-auto-reply-pill">Setor: {r.departamentos.nome}</span>
                  ) : null}
                  {r.tags?.nome ? (
                    <span className="ia-auto-reply-pill ia-auto-reply-pill--tag">Tag: {r.tags.nome}</span>
                  ) : null}
                  {r.horario_comercial_only ? (
                    <span className="ia-auto-reply-pill ia-auto-reply-pill--muted">Horário comercial</span>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="ia-btn ia-btn--outline ia-btn--small ia-auto-reply-delete"
                  onClick={() => onDelete(r.id)}
                >
                  Excluir
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const IA_FEATURE_ITEMS = [
  {
    key: "sugerir_respostas",
    title: "Sugerir respostas para atendente",
    description: "Exibe sugestões de texto enquanto o atendente digita. Nunca envia mensagem sozinha.",
    badge: "em breve",
  },
  {
    key: "corrigir_texto",
    title: "Corrigir texto automaticamente",
    description: "Correção ortográfica assistida no composer. Hoje o atendente controla isso no ícone de correção da conversa.",
    badge: "em breve",
  },
  {
    key: "auto_completar",
    title: "Auto completar mensagens",
    description: "Completa frases com base no contexto da conversa.",
    badge: "em breve",
  },
  {
    key: "resumo_conversa",
    title: "Resumo de conversa",
    description: "Gera resumo rápido do histórico para o atendente assumir com contexto.",
    badge: "em breve",
  },
  {
    key: "classificar_intencao",
    title: "Classificar intenção",
    description: "Identifica intenção do cliente (dúvida, reclamação, compra, etc.).",
    badge: "em breve",
  },
  {
    key: "sugerir_tags",
    title: "Sugerir tags",
    description: "Recomenda tags para classificar a conversa com um clique.",
    badge: "em breve",
  },
];

function SecaoIA({ config, onSave, saving }) {
  const [v, setV] = useState(config);
  useEffect(() => setV(config), [config]);

  const iaEnabled = !!v.usar_ia;

  const setFeature = useCallback((key, checked) => {
    setV((c) => ({ ...c, [key]: checked }));
  }, []);

  const handleMasterToggle = useCallback((checked) => {
    setV((c) => ({ ...c, usar_ia: checked }));
  }, []);

  return (
    <div className="ia-section ia-suggest-section">
      <header className="ia-suggest-header">
        <span className="ia-auto-reply-eyebrow">Assistência inteligente</span>
        <h4 className="ia-suggest-title">IA (sugestões inteligentes)</h4>
        <p className="ia-suggest-lead">
          Recursos assistivos para o atendente — <strong>nunca respondem sozinhos</strong> ao cliente.
          Ative a IA principal para liberar as preferências abaixo.
        </p>
      </header>

      <div className={`ia-suggest-master ${iaEnabled ? "ia-suggest-master--on" : ""}`}>
        <div className="ia-suggest-master-icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3a7 7 0 0 1 7 7c0 2.5-1.2 4.7-3 6.1V19a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-2.9A7 7 0 0 1 5 10a7 7 0 0 1 7-7z" />
            <path d="M9.5 17h5" />
          </svg>
        </div>
        <div className="ia-suggest-master-body">
          <div className="ia-suggest-master-row">
            <div>
              <h5 className="ia-suggest-master-title">Usar IA</h5>
              <p className="ia-suggest-master-desc">
                Habilita a <strong>IA Analítica</strong> no Dashboard (consultas em linguagem natural).
              </p>
            </div>
            <Switch
              checked={iaEnabled}
              onChange={handleMasterToggle}
              aria-label="Usar IA"
            />
          </div>
          <span className={`ia-suggest-status-pill ${iaEnabled ? "is-on" : ""}`}>
            {iaEnabled ? "IA Analítica ativa" : "IA desligada — preferências abaixo ficam bloqueadas"}
          </span>
        </div>
      </div>

      <div className={`ia-suggest-features ${!iaEnabled ? "ia-suggest-features--disabled" : ""}`}>
        <h5 className="ia-suggest-features-title">Funcionalidades assistivas</h5>
        <p className="ia-muted ia-suggest-features-hint">
          Preferências salvas por empresa. Itens marcados como &quot;em breve&quot; ainda não alteram o atendimento em tempo real.
        </p>
        <ul className="ia-suggest-list">
          {IA_FEATURE_ITEMS.map((item) => {
            const checked = !!v[item.key];
            return (
              <li key={item.key} className={`ia-suggest-item ${checked && iaEnabled ? "is-on" : ""}`}>
                <label className="ia-suggest-item-label">
                  <input
                    type="checkbox"
                    className="ia-suggest-item-check"
                    checked={checked}
                    disabled={!iaEnabled || saving}
                    onChange={(e) => setFeature(item.key, e.target.checked)}
                  />
                  <span className="ia-suggest-item-check-ui" aria-hidden="true" />
                  <span className="ia-suggest-item-text">
                    <span className="ia-suggest-item-title-row">
                      <strong>{item.title}</strong>
                      <span className="ia-suggest-item-badge">{item.badge}</span>
                    </span>
                    <span className="ia-suggest-item-desc">{item.description}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="ia-suggest-footer">
        <button
          type="button"
          className="ia-btn ia-btn--primary"
          onClick={() => onSave(v)}
          disabled={saving}
        >
          {saving ? "Salvando..." : "Salvar configurações de IA"}
        </button>
      </div>
    </div>
  );
}

function SecaoAutomacoes({ config, onSave, saving }) {
  const [v, setV] = useState(config);
  useEffect(() => setV(config), [config]);
  const inatividadeAtivo = (v.encerrar_automatico_min ?? 0) > 0;

  return (
    <div className="ia-section auto-section">
      <div className="auto-header">
        <h4 className="auto-title">5. Automações</h4>
        <p className="auto-subtitle">Comportamentos automáticos que economizam tempo e organizam o atendimento.</p>
      </div>

      {/* Card: Encerramento por inatividade */}
      <div className={`auto-card ${inatividadeAtivo ? "auto-card--active" : ""}`}>
        <div className="auto-card-header">
          <span className="auto-card-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
          </span>
          <div>
            <h3 className="auto-card-title">Encerramento por inatividade do cliente</h3>
            <p className="auto-card-desc">
              Fecha automaticamente conversas em que o cliente não responde ao chatbot dentro do prazo configurado.
            </p>
          </div>
        </div>

        <div className="auto-card-body">
          <div className="ia-field auto-field-inline">
            <label>
              Tempo limite (minutos)
              <span className="auto-label-hint">0 = desativado · máx. 10080 (7 dias)</span>
            </label>
            <input
              type="number"
              className="ia-input auto-input-num"
              min={0}
              max={10080}
              value={v.encerrar_automatico_min ?? 0}
              onChange={(e) => setV((c) => ({ ...c, encerrar_automatico_min: Number(e.target.value) || 0 }))}
            />
          </div>

          {inatividadeAtivo ? (
            <div className="ia-field auto-field-expand">
              <label>Mensagem enviada ao cliente ao encerrar</label>
              <textarea
                className="ia-textarea auto-textarea"
                rows={3}
                value={v.mensagem_encerramento_inatividade ?? ""}
                onChange={(e) => setV((c) => ({ ...c, mensagem_encerramento_inatividade: e.target.value }))}
                placeholder="-conversa encerrada por conta de inatividade-"
              />
              <p className="auto-hint">
                Enviada quando a conversa é fechada por falta de resposta. <strong>Exceção:</strong> não encerra se a última mensagem do bot foi a de &quot;fora do horário&quot; — a conversa permanece aberta para atendimento no próximo dia.
              </p>
            </div>
          ) : (
            <p className="auto-hint auto-hint--muted">
              Defina minutos acima de zero para ativar. Um novo campo permitirá configurar a mensagem enviada ao cliente ao fechar.
            </p>
          )}
        </div>
      </div>

      {/* Card: Comportamento do chatbot */}
      <div className="auto-card">
        <h3 className="auto-card-title">Comportamento do chatbot</h3>
        <div className="auto-card-body">
          <div className="ia-checkbox-row auto-checkbox">
            <input
              type="checkbox"
              id="transferir_humano"
              checked={v.transferir_para_humano_apos_bot}
              onChange={(e) => setV((c) => ({ ...c, transferir_para_humano_apos_bot: e.target.checked }))}
            />
            <div className="auto-checkbox-content">
              <label htmlFor="transferir_humano">Transferir para humano após limite do bot</label>
              <span className="auto-checkbox-hint">Quando o bot atingir o limite de mensagens, encaminha a conversa para atendente.</span>
            </div>
          </div>

          <div className="ia-field auto-field-inline">
            <label>Limite de mensagens do bot antes de transferir</label>
            <input
              type="number"
              className="ia-input auto-input-num"
              min={1}
              max={50}
              value={v.limite_mensagens_bot ?? 5}
              onChange={(e) => setV((c) => ({ ...c, limite_mensagens_bot: Number(e.target.value) || 5 }))}
            />
          </div>
        </div>
      </div>

      {/* Card: Conversas */}
      <div className="auto-card">
        <h3 className="auto-card-title">Conversas</h3>
        <div className="auto-card-body">
          <div className="ia-checkbox-row auto-checkbox">
            <input
              type="checkbox"
              id="auto_assumir"
              checked={v.auto_assumir}
              onChange={(e) => setV((c) => ({ ...c, auto_assumir: e.target.checked }))}
            />
            <div className="auto-checkbox-content">
              <label htmlFor="auto_assumir">Auto assumir conversa</label>
              <span className="auto-checkbox-hint">Atribui automaticamente ao primeiro atendente disponível.</span>
            </div>
          </div>

          <div className="ia-checkbox-row auto-checkbox">
            <input
              type="checkbox"
              id="reabrir_auto"
              checked={v.reabrir_automaticamente}
              onChange={(e) => setV((c) => ({ ...c, reabrir_automaticamente: e.target.checked }))}
            />
            <div className="auto-checkbox-content">
              <label htmlFor="reabrir_auto">Reabrir conversa automaticamente</label>
              <span className="auto-checkbox-hint">Ao receber nova mensagem de uma conversa encerrada, reabre para atendimento.</span>
            </div>
          </div>
        </div>
      </div>

      <div className="auto-actions">
        <button className="ia-btn ia-btn--primary auto-btn-save" onClick={() => onSave(v)} disabled={saving}>
          {saving ? "Salvando…" : "Salvar alterações"}
        </button>
      </div>
    </div>
  );
}

const DIAS_SEMANA = [
  { num: 0, label: "Dom" },
  { num: 1, label: "Seg" },
  { num: 2, label: "Ter" },
  { num: 3, label: "Qua" },
  { num: 4, label: "Qui" },
  { num: 5, label: "Sex" },
  { num: 6, label: "Sáb" },
];

function formatTimeForInput(t) {
  if (!t || typeof t !== "string") return "09:00";
  const m = t.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return "09:00";
  const h = Math.max(0, Math.min(23, parseInt(m[1], 10)));
  const min = Math.max(0, Math.min(59, parseInt(m[2], 10)));
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function formatAdminAlertContactOption(cliente) {
  const nome = String(cliente?.nome || cliente?.pushname || "").trim() || `Cliente ${cliente?.id || ""}`.trim();
  const telefone = String(cliente?.telefone || cliente?.wa_id || "").trim();
  return telefone ? `${nome} - ${telefone}` : nome;
}

function SecaoChatbotTriagem({
  config,
  adminAtendimentoAlerta,
  departamentos,
  logs,
  onSave,
  onSaveAdminAlert,
  onRefreshLogs,
  saving,
}) {
  const [v, setV] = useState(config);
  const [adminAl, setAdminAl] = useState(adminAtendimentoAlerta);
  const [adminContatoBusca, setAdminContatoBusca] = useState("");
  const [adminContatoOptions, setAdminContatoOptions] = useState([]);
  const [adminContatoLoading, setAdminContatoLoading] = useState(false);
  const [adminTesteEnviando, setAdminTesteEnviando] = useState(false);
  const [novaDataFechada, setNovaDataFechada] = useState("");
  useEffect(() => setV(config), [config]);
  useEffect(() => setAdminAl(adminAtendimentoAlerta), [adminAtendimentoAlerta]);

  useEffect(() => {
    if (!adminAl?.ativo) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setAdminContatoLoading(true);
      try {
        const clientes = await getClientes({
          palavra: adminContatoBusca.trim() || undefined,
          limit: 20,
          page: 1,
        });
        if (!cancelled) setAdminContatoOptions(Array.isArray(clientes) ? clientes : []);
      } catch (e) {
        console.error("Erro ao carregar contatos do alerta admin:", e);
        if (!cancelled) setAdminContatoOptions([]);
      } finally {
        if (!cancelled) setAdminContatoLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [adminAl?.ativo, adminContatoBusca]);

  const showToast = useNotificationStore((s) => s.showToast);

  const addOption = () => {
    const opts = v.options || [];
    const nextKey = String((opts.length > 0 ? Math.max(...opts.map((o) => parseInt(o.key, 10) || 0)) : 0) + 1);
    setV((c) => ({
      ...c,
      options: [...opts, { key: nextKey, label: "", departamento_id: "", active: true }],
    }));
  };

  const updateOption = (idx, field, value) => {
    const opts = [...(v.options || [])];
    opts[idx] = { ...opts[idx], [field]: value };
    setV((c) => ({ ...c, options: opts }));
  };

  const removeOption = (idx) => {
    const opts = [...(v.options || [])];
    opts.splice(idx, 1);
    setV((c) => ({ ...c, options: opts }));
  };

  const buildPayload = (vals) => {
    const formatTime = (t) => {
      if (!t || typeof t !== "string") return "09:00";
      const match = t.trim().match(/^(\d{1,2}):(\d{2})$/);
      if (!match) return "09:00";
      const h = Math.max(0, Math.min(23, parseInt(match[1], 10)));
      const m = Math.max(0, Math.min(59, parseInt(match[2], 10)));
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    };
    const dias = (vals.diasSemanaDesativados || []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    const datas = (vals.datasEspecificasFechadas || []).filter((d) => {
      if (typeof d !== "string") return false;
      const match = d.match(/^\d{4}-\d{2}-\d{2}$/);
      if (!match) return false;
      const dt = new Date(d);
      return !isNaN(dt.getTime());
    });
    const finalizationMessage = normalizeFinalizationMessage(
      vals.enviarMensagemFinalizacao,
      vals.mensagemFinalizacao
    );

    return {
      ...vals,
      enabled: !!vals.enabled,
      welcomeMessage: (vals.welcomeMessage || "").trim(),
      invalidOptionMessage: (vals.invalidOptionMessage || "").trim(),
      confirmSelectionMessage: (vals.confirmSelectionMessage || "").trim(),
      ...finalizationMessage,
      foraHorarioEnabled: !!vals.foraHorarioEnabled,
      horarioInicio: formatTime(vals.horarioInicio) || "09:00",
      horarioFim: formatTime(vals.horarioFim) || "18:00",
      diasSemanaDesativados: dias.length > 0 ? dias : [0, 6],
      datasEspecificasFechadas: datas,
      mensagemForaHorario: (vals.mensagemForaHorario || "").trim().slice(0, 1024),
      intervaloEnvioSegundos: Math.max(0, Math.min(60, Number(vals.intervaloEnvioSegundos) || 3)),
      sendOnlyFirstTime: vals.sendOnlyFirstTime !== false,
      fallbackToAI: vals.fallbackToAI ?? false,
      businessHoursOnly: vals.businessHoursOnly ?? false,
      transferMode: vals.transferMode ?? "departamento",
      reopenMenuCommand: String(vals.reopenMenuCommand ?? "0").trim() || "0",
      tipo_distribuicao: ["fila", "round_robin", "menor_carga"].includes(vals.tipo_distribuicao) ? vals.tipo_distribuicao : "fila",
      options: (vals.options || []).map((o) => ({
        key: String(o.key || "").trim(),
        label: (o.label || "").trim(),
        departamento_id: o.departamento_id ? Number(o.departamento_id) : null,
        active: !!o.active,
      })),
      finalizar_por_ausencia_ativo: !!vals.finalizar_por_ausencia_ativo,
      finalizar_por_ausencia_prazo: Math.max(1, Math.min(720, Number(vals.finalizar_por_ausencia_prazo) || 24)),
      finalizar_por_ausencia_unidade:
        vals.finalizar_por_ausencia_unidade === "horas_uteis" ? "horas_uteis" : "horas_corridas",
      finalizar_por_ausencia_mensagem: vals.finalizar_por_ausencia_mensagem != null ? String(vals.finalizar_por_ausencia_mensagem) : "",
      finalizar_por_ausencia_reabrir_automaticamente: vals.finalizar_por_ausencia_reabrir_automaticamente !== false,
      finalizar_por_ausencia_reabrir_sem_chatbot: vals.finalizar_por_ausencia_reabrir_sem_chatbot !== false,
    };
  };

  const validate = () => {
    const vals = v;
    if (!vals || typeof vals !== "object") return "Dados inválidos.";
    const opts = vals.options || [];
    if (vals.enabled) {
      const welcome = (vals.welcomeMessage || "").trim();
      if (!welcome) return "Mensagem de boas-vindas é obrigatória quando o chatbot está ativo.";
      const activeOpts = opts.filter((o) => o.active !== false);
      const validOpts = activeOpts.filter((o) => (o.label || "").trim() && o.departamento_id);
      if (validOpts.length === 0) return "Adicione pelo menos uma opção válida (label e departamento) quando o chatbot está ativo.";
    }
    if (vals.foraHorarioEnabled) {
      const msgFora = (vals.mensagemForaHorario || "").trim();
      if (!msgFora) return "Mensagem fora do horário é obrigatória quando está ativo o envio fora do horário comercial.";
    }
    const keys = opts.map((o) => String(o.key || "").trim()).filter(Boolean);
    const uniqueKeys = [...new Set(keys)];
    if (keys.length !== uniqueKeys.length) return "Cada opção deve ter uma key única.";
    for (let i = 0; i < opts.length; i++) {
      const o = opts[i];
      if (o.active !== false) {
        if (!(o.label || "").trim()) return `Opção ${i + 1}: label é obrigatório.`;
        if (!o.departamento_id) return `Opção ${i + 1}: departamento é obrigatório.`;
      }
    }
    return null;
  };

  const handleSave = () => {
    const err = validate();
    if (err) {
      showToast({ type: "error", title: "Validação", message: err });
      return;
    }
    onSave(buildPayload(v));
  };

  const opts = v.options || [];
  const previewDept = departamentos.find((d) => d.id === (opts.find((o) => o.active)?.departamento_id))?.nome || "Vendas";
  const previewConfirm = (v.confirmSelectionMessage || "").replace(/\{\{departamento\}\}/gi, previewDept);
  const previewFinal = (v.mensagemFinalizacao || "")
    .replace(/\{\{protocolo\}\}/gi, "12345")
    .replace(/\{\{nome_atendente\}\}/gi, "Maria");
  const selectedAdminContatoId = adminAl.cliente_id ? String(adminAl.cliente_id) : "";
  const selectedAdminContatoFallback =
    selectedAdminContatoId && !adminContatoOptions.some((c) => String(c.id) === selectedAdminContatoId)
      ? [{
          id: Number(adminAl.cliente_id),
          nome: adminAl.cliente_nome || "Contato selecionado",
          telefone: adminAl.telefone_admin || "",
        }]
      : [];
  const adminContatoSelectOptions = [...selectedAdminContatoFallback, ...adminContatoOptions];

  return (
    <div className="chatbot-section">
      <div className="chatbot-header">
        <div className="chatbot-header-left">
          <Switch checked={v.enabled} onChange={(x) => setV((c) => ({ ...c, enabled: x }))} />
          <div>
            <h2 className="chatbot-title">Chatbot de Triagem</h2>
            <p className="chatbot-subtitle">Configure o roteador automático de atendimento (menu de setores)</p>
          </div>
        </div>
        <span className={`chatbot-badge ${v.enabled ? "chatbot-badge--on" : "chatbot-badge--off"}`} title={v.enabled ? "Clique no interruptor para desativar" : "Clique no interruptor para ativar"}>
          {v.enabled ? "Ativado" : "Desativado"}
        </span>
      </div>

      <div className="chatbot-grid">
        <div className="chatbot-form">
          {/* SEÇÃO 1 — Ativar + Mensagem de boas-vindas */}
          <div className="chatbot-card">
            <h3 className="chatbot-card-title">1. Mensagem de boas-vindas</h3>
            <div className="ia-field">
              <label title="Enviada quando o cliente manda a primeira mensagem. Inclua as opções do menu (ex: 1 - Atendimento, 2 - Vendas).">
                Mensagem de boas-vindas
              </label>
              <textarea
                className="ia-textarea chatbot-textarea"
                rows={6}
                value={v.welcomeMessage || ""}
                onChange={(e) => setV((c) => ({ ...c, welcomeMessage: e.target.value }))}
                placeholder="Olá! Seja bem-vindo(a) à sua empresa.&#10;Para direcionarmos seu atendimento, escolha o setor:&#10;&#10;1 - Atendimento&#10;2 - Vendas&#10;3 - Financeiro&#10;&#10;Responda com o número da opção desejada."
              />
            </div>
            <div className="ia-field">
              <label title="Enviada quando o cliente digita um número que não está no menu.">
                Mensagem quando o cliente digita opção errada
              </label>
              <textarea
                className="ia-textarea"
                rows={2}
                value={v.invalidOptionMessage || ""}
                onChange={(e) => setV((c) => ({ ...c, invalidOptionMessage: e.target.value }))}
                placeholder="Opção inválida. Por favor, responda apenas com o número do setor desejado."
              />
            </div>
            <div className="ia-field">
              <label title="Após o cliente escolher uma opção válida. Use {{departamento}} para substituir pelo nome do setor.">
                Mensagem de confirmação (use {"{{departamento}}"})
              </label>
              <textarea
                className="ia-textarea"
                rows={2}
                value={v.confirmSelectionMessage || ""}
                onChange={(e) => setV((c) => ({ ...c, confirmSelectionMessage: e.target.value }))}
                placeholder="Perfeito! Seu atendimento foi direcionado para o setor {{departamento}}. Em instantes nossa equipe dará continuidade."
              />
            </div>
            <div className="ia-field">
              <label title="O cliente pode digitar este comando (ex: 0) para ver o menu novamente.">
                Comando para ver o menu de novo
              </label>
              <input
                type="text"
                className="ia-input chatbot-input-cmd"
                value={v.reopenMenuCommand ?? "0"}
                onChange={(e) => setV((c) => ({ ...c, reopenMenuCommand: e.target.value }))}
                placeholder="0"
              />
            </div>
            <div className="ia-checkbox-row">
              <input
                type="checkbox"
                id="sendOnlyFirstTime"
                checked={v.sendOnlyFirstTime !== false}
                onChange={(e) => setV((c) => ({ ...c, sendOnlyFirstTime: e.target.checked }))}
              />
              <label htmlFor="sendOnlyFirstTime" title="Se marcado, o menu só é enviado na primeira mensagem.">
                Enviar menu apenas na primeira mensagem
              </label>
            </div>
          </div>

          {/* SEÇÃO 2 — Escolhas do menu */}
          <div className="chatbot-card">
            <h3 className="chatbot-card-title">2. Escolhas que o cliente verá no WhatsApp</h3>
            <p className="chatbot-card-subtitle">O que aparece quando alguém manda a primeira mensagem</p>
            <div className="chatbot-table-wrap">
              <table className="ia-table chatbot-table">
                <thead>
                  <tr>
                    <th title="O número que o cliente digita para escolher (1, 2, 3...)">Nº</th>
                    <th title="O texto que aparece no menu (ex: Atendimento, Vendas)">O que o cliente vê</th>
                    <th title="Para qual equipe a conversa vai quando o cliente escolher esta opção">Setor que recebe</th>
                    <th title="Se desmarcado, esta opção não aparece no menu">Opção ativa</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {opts.map((o, idx) => (
                    <tr key={idx}>
                      <td>
                        <input
                          type="text"
                          className="ia-input chatbot-input-key"
                          value={o.key ?? ""}
                          onChange={(e) => updateOption(idx, "key", e.target.value)}
                          placeholder="1"
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          className="ia-input"
                          value={o.label ?? ""}
                          onChange={(e) => updateOption(idx, "label", e.target.value)}
                          placeholder="Atendimento"
                        />
                      </td>
                      <td>
                        <select
                          className="ia-select"
                          value={o.departamento_id ?? ""}
                          onChange={(e) => updateOption(idx, "departamento_id", e.target.value)}
                        >
                          <option value="">Selecione</option>
                          {departamentos.map((d) => (
                            <option key={d.id} value={d.id}>{d.nome}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={o.active !== false}
                          onChange={(e) => updateOption(idx, "active", e.target.checked)}
                          aria-label="Opção ativa"
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="chatbot-btn-remove"
                          onClick={() => removeOption(idx)}
                          aria-label="Remover"
                        >
                          Remover
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {departamentos.length === 0 && (
              <p className="chatbot-hint">Cadastre departamentos em Configurações para vincular às opções.</p>
            )}
            <button type="button" className="chatbot-btn-add" onClick={addOption}>
              + Adicionar nova escolha
            </button>
          </div>

          {/* SEÇÃO 3 — Mensagem ao finalizar atendimento */}
          <div className="chatbot-card">
            <h3 className="chatbot-card-title">3. Mensagem ao finalizar atendimento</h3>
            <p className="chatbot-card-subtitle">
              Enviada automaticamente quando o atendente clicar em &quot;Finalizar conversa&quot;. O cliente pode responder 0–10 para avaliar.
            </p>
            <div className="ds-switch-row" style={{ marginBottom: 16 }}>
              <Switch checked={v.enviarMensagemFinalizacao === true} onChange={(x) => setV((c) => ({ ...c, enviarMensagemFinalizacao: x }))} />
              <span>Enviar mensagem automaticamente quando finalizar conversa</span>
            </div>
            <div className="ia-field">
              <label title="Use {{protocolo}} para o número do atendimento e {{nome_atendente}} para o nome.">
                Mensagem (use {"{{protocolo}}"} e {"{{nome_atendente}}"})
              </label>
              <textarea
                className="ia-textarea"
                rows={5}
                value={v.mensagemFinalizacao || ""}
                onChange={(e) => setV((c) => ({ ...c, mensagemFinalizacao: e.target.value }))}
                placeholder="Atendimento finalizado com sucesso. (Segue seu protocolo: {{protocolo}}.\nPor favor, informe uma nota entre 0 e 10 para avaliar o atendimento prestado.)"
                disabled={!v.enviarMensagemFinalizacao}
              />
              <p className="chatbot-hint" style={{ marginTop: 6 }}>
                Placeholders: <code>{"{{protocolo}}"}</code> = número do protocolo (ID do atendimento); <code>{"{{nome_atendente}}"}</code> = nome do atendente que finalizou.
              </p>
            </div>
          </div>

          {/* SEÇÃO 4 — Mensagem fora do horário comercial */}
          <div className="chatbot-card">
            <h3 className="chatbot-card-title">4. Mensagem fora do horário comercial</h3>
            <div className="ds-switch-row" style={{ marginBottom: 16 }}>
              <Switch checked={v.foraHorarioEnabled === true} onChange={(x) => setV((c) => ({ ...c, foraHorarioEnabled: x }))} />
              <span>Enviar mensagem automática quando o cliente escrever fora do horário</span>
            </div>

            <div className="chatbot-fora-horario-fields" style={{ opacity: v.foraHorarioEnabled ? 1 : 0.6, pointerEvents: v.foraHorarioEnabled ? "auto" : "none" }}>
                  <div className="chatbot-subsection">
                    <h4 className="chatbot-subsection-title">Horário de atendimento</h4>
                    <div className="chatbot-time-row">
                      <div className="ia-field">
                        <label>Início</label>
                        <input
                          type="time"
                          className="ia-input"
                          value={formatTimeForInput(v.horarioInicio) || "09:00"}
                          onChange={(e) => setV((c) => ({ ...c, horarioInicio: e.target.value }))}
                        />
                      </div>
                      <div className="ia-field">
                        <label>Término</label>
                        <input
                          type="time"
                          className="ia-input"
                          value={formatTimeForInput(v.horarioFim) || "18:00"}
                          onChange={(e) => setV((c) => ({ ...c, horarioFim: e.target.value }))}
                        />
                      </div>
                    </div>
                    <p className="chatbot-hint">
                      Horários que atravessam meia-noite são suportados (ex: 22:00–06:00).
                    </p>
                  </div>

                  <div className="chatbot-subsection">
                    <h4 className="chatbot-subsection-title">Dias da semana em que não trabalha</h4>
                    <div className="chatbot-dias-row">
                      {DIAS_SEMANA.map((d) => {
                        const dias = v.diasSemanaDesativados || [0, 6];
                        const checked = dias.includes(d.num);
                        return (
                          <label key={d.num} className="chatbot-dia-check">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                const prev = v.diasSemanaDesativados || [0, 6];
                                const next = checked ? prev.filter((n) => n !== d.num) : [...prev.filter((n) => n !== d.num), d.num].sort((a, b) => a - b);
                                setV((c) => ({ ...c, diasSemanaDesativados: next.length > 0 ? next : [0, 6] }));
                              }}
                            />
                            <span>{d.label}</span>
                          </label>
                        );
                      })}
                    </div>
                    <p className="chatbot-hint">Marcado = não trabalha. Padrão: Dom e Sáb marcados.</p>
                  </div>

                  <div className="chatbot-subsection">
                    <h4 className="chatbot-subsection-title">Datas específicas fechadas (feriados, recesso)</h4>
                    <div className="chatbot-datas-row">
                      <input
                        type="date"
                        className="ia-input chatbot-input-date"
                        value={novaDataFechada}
                        onChange={(e) => setNovaDataFechada(e.target.value)}
                      />
                      <button
                        type="button"
                        className="ia-btn ia-btn--outline"
                        onClick={() => {
                          if (novaDataFechada) {
                            const datas = v.datasEspecificasFechadas || [];
                            if (!datas.includes(novaDataFechada)) {
                              setV((c) => ({ ...c, datasEspecificasFechadas: [...datas, novaDataFechada].sort() }));
                              setNovaDataFechada("");
                            }
                          }
                        }}
                      >
                        + Adicionar data
                      </button>
                      <button
                        type="button"
                        className="ia-btn ia-btn--outline"
                        title="Adiciona Natal e Ano Novo do ano atual"
                        onClick={() => {
                          const y = new Date().getFullYear();
                          const natal = `${y}-12-25`;
                          const anoNovo = `${y + 1}-01-01`;
                          const datas = v.datasEspecificasFechadas || [];
                          const toAdd = [natal, anoNovo].filter((d) => !datas.includes(d));
                          if (toAdd.length > 0) {
                            setV((c) => ({ ...c, datasEspecificasFechadas: [...(c.datasEspecificasFechadas || []), ...toAdd].sort() }));
                          }
                        }}
                      >
                        + Feriados comuns
                      </button>
                    </div>
                    {(v.datasEspecificasFechadas || []).length > 0 && (
                      <ul className="chatbot-datas-list">
                        {(v.datasEspecificasFechadas || []).map((d) => (
                          <li key={d} className="chatbot-datas-item">
                            <span>{new Date(d + "T12:00:00").toLocaleDateString("pt-BR")}</span>
                            <button
                              type="button"
                              className="chatbot-btn-remove"
                              onClick={() => setV((c) => ({ ...c, datasEspecificasFechadas: (c.datasEspecificasFechadas || []).filter((x) => x !== d) }))}
                            >
                              Remover
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="ia-field">
                    <label>Mensagem enviada fora do horário</label>
                    <textarea
                      className="ia-textarea"
                      rows={5}
                      maxLength={1024}
                      value={v.mensagemForaHorario || ""}
                      onChange={(e) => setV((c) => ({ ...c, mensagemForaHorario: e.target.value }))}
                      placeholder="Olá! Nosso horário de atendimento é de segunda a sexta, das 09h às 18h. Sua mensagem foi recebida e retornaremos no próximo dia útil. Obrigado!"
                    />
                    <p className="chatbot-hint">Máximo 1024 caracteres. Enviada quando o cliente escreve fora do horário ou em dia de folga.</p>
                  </div>
            </div>
          </div>

          {/* Finalização automática por ausência do cliente (config em chatbot_triage) */}
          <div className="chatbot-card">
            <h3 className="chatbot-card-title">5. Finalização por ausência do cliente</h3>
            <p className="chatbot-card-subtitle">
              Encerra automaticamente conversas em atendimento humano quando o cliente não responde após a última mensagem da equipe, dentro do prazo configurado. Desligado por padrão.
            </p>
            <div className="ds-switch-row" style={{ marginBottom: 16 }}>
              <Switch
                checked={v.finalizar_por_ausencia_ativo === true}
                onChange={(x) => setV((c) => ({ ...c, finalizar_por_ausencia_ativo: x }))}
              />
              <span>Ativar finalização automática por ausência</span>
            </div>
            <div
              className="chatbot-fora-horario-fields"
              style={{
                opacity: v.finalizar_por_ausencia_ativo ? 1 : 0.55,
                pointerEvents: v.finalizar_por_ausencia_ativo ? "auto" : "none",
              }}
            >
              <div className="chatbot-time-row" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
                <div className="ia-field" style={{ minWidth: 120 }}>
                  <label>Prazo (horas)</label>
                  <input
                    type="number"
                    className="ia-input chatbot-input-cmd"
                    min={1}
                    max={720}
                    value={v.finalizar_por_ausencia_prazo ?? 24}
                    onChange={(e) =>
                      setV((c) => ({
                        ...c,
                        finalizar_por_ausencia_prazo: Math.max(1, Math.min(720, Number(e.target.value) || 24)),
                      }))
                    }
                  />
                  <p className="chatbot-hint" style={{ marginTop: 4 }}>Entre 1 e 720 horas (o servidor valida o limite).</p>
                </div>
                <div className="ia-field" style={{ minWidth: 200 }}>
                  <label>Contagem do prazo</label>
                  <select
                    className="ia-select"
                    value={v.finalizar_por_ausencia_unidade === "horas_uteis" ? "horas_uteis" : "horas_corridas"}
                    onChange={(e) =>
                      setV((c) => ({ ...c, finalizar_por_ausencia_unidade: e.target.value }))
                    }
                  >
                    <option value="horas_corridas">Horas corridas</option>
                    <option value="horas_uteis">Horas úteis</option>
                  </select>
                </div>
              </div>
              {v.finalizar_por_ausencia_unidade === "horas_uteis" ? (
                <p className="chatbot-hint" style={{ marginTop: 8, padding: 10, borderRadius: 8, background: "rgba(251, 191, 36, 0.12)", border: "1px solid rgba(251, 191, 36, 0.35)" }}>
                  <strong>Atenção:</strong> no backend atual, &quot;horas úteis&quot; ainda são tratadas como horas corridas até haver suporte completo a calendário comercial. Ajuste o prazo considerando essa limitação.
                </p>
              ) : null}
              <div className="ds-switch-row" style={{ marginTop: 16 }}>
                <Switch
                  checked={v.finalizar_por_ausencia_enviar_mensagem === true}
                  onChange={(x) => setV((c) => ({ ...c, finalizar_por_ausencia_enviar_mensagem: x }))}
                />
                <span>Enviar mensagem de finalização ao cliente</span>
              </div>
              <p className="chatbot-hint" style={{ marginTop: 4, marginBottom: 12 }}>
                Quando desligado, a conversa será encerrada apenas dentro do sistema, sem enviar nada ao cliente.
              </p>
              <div
                className="ia-field"
                style={{
                  opacity: v.finalizar_por_ausencia_enviar_mensagem === true ? 1 : 0.55,
                }}
              >
                <label>Mensagem enviada ao cliente antes de encerrar</label>
                <textarea
                  className="ia-textarea"
                  rows={4}
                  disabled={v.finalizar_por_ausencia_enviar_mensagem !== true}
                  value={v.finalizar_por_ausencia_mensagem ?? ""}
                  onChange={(e) => setV((c) => ({ ...c, finalizar_por_ausencia_mensagem: e.target.value }))}
                  placeholder="Digite a mensagem de finalização enviada ao cliente."
                />
                <p className="chatbot-hint" style={{ marginTop: 6 }}>
                  O texto fica salvo ao desligar a opção e poderá ser reutilizado se o envio for ativado novamente.
                </p>
              </div>
              <div className="ds-switch-row" style={{ marginTop: 16 }}>
                <Switch
                  checked={v.finalizar_por_ausencia_reabrir_automaticamente !== false}
                  onChange={(x) => setV((c) => ({ ...c, finalizar_por_ausencia_reabrir_automaticamente: x }))}
                />
                <span>Reabrir automaticamente se o cliente voltar a falar</span>
              </div>
              <p className="chatbot-hint" style={{ marginTop: 4, marginBottom: 12 }}>
                Quando desligado, a conversa permanece fechada até um atendente reabrir manualmente (salvo outras regras da empresa).
              </p>
              <div className="ds-switch-row">
                <Switch
                  checked={v.finalizar_por_ausencia_reabrir_sem_chatbot !== false}
                  onChange={(x) => setV((c) => ({ ...c, finalizar_por_ausencia_reabrir_sem_chatbot: x }))}
                />
                <span>Na reabertura automática, ir direto ao atendente (sem passar pelo menu do chatbot)</span>
              </div>
              <p className="chatbot-hint" style={{ marginTop: 4 }}>
                Útil para o cliente continuar o diálogo com a equipe sem receber de novo o menu de triagem.
              </p>
            </div>
          </div>

          {/* SEÇÃO 8 — Alerta do administrador (independente do chatbot; salva em admin_atendimento_alerta) */}
          <div className="chatbot-card chatbot-card--admin-alerta">
            <h3 className="chatbot-card-title">8. Alerta do administrador</h3>
            <p className="chatbot-card-subtitle chatbot-card-subtitle--muted">
              Resumo automático por WhatsApp no horário definido (fuso da seção 4 ou campo abaixo). Desativado por
              padrão. O backend verifica o horário periodicamente enquanto estiver em execução. Opcionalmente use também{" "}
              <code className="chatbot-inline-code">POST /jobs/admin-atendimento-alerta</code> com header{" "}
              <code className="chatbot-inline-code">X-Cron-Secret</code>.
            </p>
            <div className="ds-switch-row" style={{ marginBottom: 12 }}>
              <Switch
                checked={adminAl.ativo === true}
                onChange={(x) =>
                  setAdminAl((c) => {
                    const next = { ...c, ativo: x };
                    if (x && !c.incluir_nota_media && c.incluir_conversas_sem_resposta === false) {
                      next.incluir_conversas_sem_resposta = true;
                    }
                    return next;
                  })
                }
              />
              <span>Ativar alerta</span>
            </div>
            <div
              className="chatbot-fora-horario-fields"
              style={{
                opacity: adminAl.ativo ? 1 : 0.55,
                pointerEvents: adminAl.ativo ? "auto" : "none",
              }}
            >
              <div className="ia-field">
                <label>Contato que receberá o alerta</label>
                <div className="chatbot-time-row" style={{ alignItems: "flex-end", gap: 12 }}>
                  <input
                    type="search"
                    className="ia-input"
                    value={adminContatoBusca}
                    onChange={(e) => setAdminContatoBusca(e.target.value)}
                    placeholder="Buscar por nome ou telefone"
                    autoComplete="off"
                    style={{ minWidth: 220 }}
                  />
                  <select
                    className="ia-select"
                    value={selectedAdminContatoId}
                    onChange={(e) => {
                      const id = e.target.value;
                      const contato = adminContatoSelectOptions.find((c) => String(c.id) === id);
                      setAdminAl((c) => ({
                        ...c,
                        cliente_id: id ? Number(id) : null,
                        cliente_nome: contato ? String(contato.nome || contato.pushname || "").trim().slice(0, 120) : "",
                        telefone_admin: contato ? String(contato.telefone || contato.wa_id || "").trim().slice(0, 40) : "",
                      }));
                    }}
                    style={{ minWidth: 280 }}
                  >
                    <option value="">{adminContatoLoading ? "Carregando contatos..." : "Selecione um contato"}</option>
                    {adminContatoSelectOptions.map((cliente) => (
                      <option key={cliente.id} value={cliente.id}>
                        {formatAdminAlertContactOption(cliente)}
                      </option>
                    ))}
                  </select>
                </div>
                {adminAl.telefone_admin ? (
                  <p className="chatbot-hint" style={{ marginTop: 6 }}>
                    Envio para {adminAl.cliente_nome || "contato selecionado"} ({adminAl.telefone_admin}).
                  </p>
                ) : (
                  <p className="chatbot-hint" style={{ marginTop: 6 }}>
                    O contato precisa ter telefone ou WhatsApp cadastrado.
                  </p>
                )}
              </div>
              <div className="chatbot-time-row">
                <div className="ia-field">
                  <label>Horário de envio (fuso abaixo)</label>
                  <input
                    type="time"
                    className="ia-input"
                    value={formatTimeForInput(adminAl.horario_envio)}
                    onChange={(e) => setAdminAl((c) => ({ ...c, horario_envio: e.target.value }))}
                  />
                </div>
                <div className="ia-field">
                  <label>Fuso IANA (opcional)</label>
                  <input
                    type="text"
                    className="ia-input"
                    value={adminAl.timezone || ""}
                    onChange={(e) => setAdminAl((c) => ({ ...c, timezone: e.target.value }))}
                    placeholder="Vazio = mesmo da seção 4"
                  />
                </div>
              </div>
              <div className="ia-checkbox-row">
                <input
                  type="checkbox"
                  id="admin_alerta_nota"
                  checked={adminAl.incluir_nota_media === true}
                  onChange={(e) => setAdminAl((c) => ({ ...c, incluir_nota_media: e.target.checked }))}
                />
                <label htmlFor="admin_alerta_nota">Incluir nota média (avaliações dos últimos 30 dias)</label>
              </div>
              <div className="ia-checkbox-row">
                <input
                  type="checkbox"
                  id="admin_alerta_fila"
                  checked={adminAl.incluir_conversas_sem_resposta === true}
                  onChange={(e) => setAdminAl((c) => ({ ...c, incluir_conversas_sem_resposta: e.target.checked }))}
                />
                <label htmlFor="admin_alerta_fila">
                  Incluir quantidade de conversas aguardando resposta (etiqueta &quot;Aguardando funcionário&quot;; não
                  conta finalizadas, aguardando cliente nem triagem ativa do chatbot)
                </label>
              </div>
              <p className="chatbot-hint" style={{ marginTop: 8 }}>
                Marque ao menos uma métrica (recomendado). O envio automático ocorre no horário configurado, com tolerância
                de até 30 minutos (fuso da seção 4 ou campo acima). Um envio por dia por empresa.
              </p>
              <div className="ia-btn-row" style={{ marginTop: 12, flexWrap: "wrap", gap: 8 }}>
                <button
                  type="button"
                  className="ia-btn ia-btn--outline"
                  onClick={() => {
                    const clienteId = Number(adminAl.cliente_id);
                    const telefoneAdmin = String(adminAl.telefone_admin || "").trim().slice(0, 40);
                    if (adminAl.ativo && !clienteId && !telefoneAdmin) {
                      showToast({ type: "error", title: "Alerta do administrador", message: "Selecione o contato que receberá o alerta." });
                      return;
                    }
                    if (
                      adminAl.ativo &&
                      !adminAl.incluir_nota_media &&
                      adminAl.incluir_conversas_sem_resposta === false
                    ) {
                      showToast({
                        type: "error",
                        title: "Alerta do administrador",
                        message: "Marque ao menos uma métrica para incluir no resumo.",
                      });
                      return;
                    }
                    onSaveAdminAlert({
                      ...adminAl,
                      cliente_id: Number.isInteger(clienteId) && clienteId > 0 ? clienteId : null,
                      cliente_nome: String(adminAl.cliente_nome || "").trim().slice(0, 120),
                      horario_envio: normalizeHorarioAdminAlerta(adminAl.horario_envio),
                      telefone_admin: telefoneAdmin,
                      timezone: String(adminAl.timezone || "").trim().slice(0, 80),
                      incluir_conversas_sem_resposta: adminAl.incluir_conversas_sem_resposta !== false,
                    });
                  }}
                  disabled={saving}
                >
                  {saving ? "Salvando…" : "Salvar alerta do administrador"}
                </button>
                <button
                  type="button"
                  className="ia-btn ia-btn--primary"
                  disabled={saving || adminTesteEnviando || !adminAl.ativo}
                  onClick={async () => {
                    const clienteId = Number(adminAl.cliente_id);
                    const telefoneAdmin = String(adminAl.telefone_admin || "").trim();
                    if (!clienteId && telefoneAdmin.replace(/\D/g, "").length < 10) {
                      showToast({
                        type: "error",
                        title: "Teste do alerta",
                        message: "Salve o alerta com um contato válido antes de testar.",
                      });
                      return;
                    }
                    setAdminTesteEnviando(true);
                    try {
                      await iaApi.testarAdminAtendimentoAlerta();
                      showToast({
                        type: "success",
                        title: "Teste enviado",
                        message: "Verifique o WhatsApp do contato selecionado.",
                      });
                    } catch (e) {
                      const msg =
                        e?.response?.data?.error ||
                        e?.response?.data?.message ||
                        "Não foi possível enviar o teste.";
                      showToast({ type: "error", title: "Teste do alerta", message: msg });
                    } finally {
                      setAdminTesteEnviando(false);
                    }
                  }}
                >
                  {adminTesteEnviando ? "Enviando teste…" : "Enviar teste agora"}
                </button>
              </div>
            </div>
          </div>

          {/* SEÇÃO 6 — Configurações avançadas */}
          <div className="chatbot-card">
            <h3 className="chatbot-card-title">6. Configurações avançadas</h3>
            <div className="ia-field">
              <label title="Define o que acontece quando o cliente responde com o número do setor (ex: 1 para Vendas).">
                Como a conversa chega ao setor
              </label>
              <select
                className="ia-select"
                value={v.tipo_distribuicao ?? "fila"}
                onChange={(e) => setV((c) => ({ ...c, tipo_distribuicao: e.target.value }))}
                title="Define o que acontece quando o cliente responde com o número do setor (ex: 1 para Vendas)."
              >
                <option value="fila">Todos do setor veem — quem assumir primeiro atende (recomendado)</option>
                <option value="round_robin">Rotação automática entre atendentes</option>
                <option value="menor_carga">Atribuir ao atendente com menos conversas</option>
              </select>
            </div>
            <div className="ia-field">
              <label title="Intervalo mínimo entre envios de mensagens automáticas. Evita bloqueio WhatsApp/UltraMSG. 0 = sem delay.">
                Intervalo entre envios (segundos)
              </label>
              <input
                type="number"
                className="ia-input chatbot-input-cmd"
                min={0}
                max={60}
                value={v.intervaloEnvioSegundos ?? 3}
                onChange={(e) => setV((c) => ({ ...c, intervaloEnvioSegundos: Number(e.target.value) || 0 }))}
                placeholder="3"
              />
            </div>
          </div>

          {/* SEÇÃO 6 — Salvar + Logs */}
          <div className="chatbot-actions">
            <button className="ia-btn ia-btn--primary chatbot-btn-save" onClick={handleSave} disabled={saving}>
              {saving ? "Salvando..." : "Salvar configuração"}
            </button>
          </div>
        </div>

        <div className="chatbot-preview">
          <div className="chatbot-preview-card">
            <h3 className="chatbot-preview-title">Preview — Como o cliente verá</h3>
            <div className="chatbot-preview-phone">
              <div className="chatbot-preview-bubbles">
                <div className="chatbot-bubble chatbot-bubble--in">
                  <span className="chatbot-bubble-time">agora</span>
                  <div className="chatbot-bubble-text">
                    {(v.welcomeMessage || "Digite a mensagem de boas-vindas ao lado.").split("\n").map((line, i) => (
                      <span key={i}>{line || " "}<br /></span>
                    ))}
                  </div>
                </div>
                <div className="chatbot-bubble chatbot-bubble--out">
                  <span className="chatbot-bubble-time">agora</span>
                  <div className="chatbot-bubble-text">1</div>
                </div>
                <div className="chatbot-bubble chatbot-bubble--in">
                  <span className="chatbot-bubble-time">agora</span>
                  <div className="chatbot-bubble-text">
                    {previewConfirm || "Mensagem de confirmação (ex: Perfeito! Seu atendimento foi direcionado para o setor Vendas...)"}
                  </div>
                </div>
              </div>
            </div>
            <p className="chatbot-preview-hint">Simulação: cliente responde "1" → recebe confirmação com setor "{previewDept}"</p>
            {v.enviarMensagemFinalizacao && (v.mensagemFinalizacao || "").trim() && (
              <div className="chatbot-preview-final" style={{ marginTop: 16, padding: 12, background: "var(--ia-bg-secondary, #1e293b)", borderRadius: 8 }}>
                <p className="chatbot-preview-hint" style={{ marginBottom: 8 }}>Mensagem ao finalizar (ex.: protocolo 12345, atendente Maria):</p>
                <div className="chatbot-bubble chatbot-bubble--in">
                  <div className="chatbot-bubble-text" style={{ whiteSpace: "pre-wrap" }}>{previewFinal}</div>
                </div>
              </div>
            )}
            {v.foraHorarioEnabled && (v.mensagemForaHorario || "").trim() && (
              <div className="chatbot-preview-final" style={{ marginTop: 16, padding: 12, background: "var(--ia-bg-secondary, #1e293b)", borderRadius: 8 }}>
                <p className="chatbot-preview-hint" style={{ marginBottom: 8 }}>Mensagem fora do horário ({v.horarioInicio || "09:00"}–{v.horarioFim || "18:00"}):</p>
                <div className="chatbot-bubble chatbot-bubble--in">
                  <div className="chatbot-bubble-text" style={{ whiteSpace: "pre-wrap" }}>{(v.mensagemForaHorario || "").trim()}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="chatbot-logs">
        <div className="chatbot-logs-header">
          <h3 className="chatbot-card-title">Logs recentes</h3>
          <button type="button" className="ia-btn ia-btn--outline chatbot-btn-refresh" onClick={onRefreshLogs}>
            Atualizar
          </button>
        </div>
        {logs.length === 0 ? (
          <p className="chatbot-empty">Nenhum log registrado.</p>
        ) : (
          <div className="chatbot-logs-list">
            {logs.map((l) => {
              const dataStr = l.criado_em ? new Date(l.criado_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
              const detalhesStr = l.detalhes?.departamento || l.detalhes?.label || l.detalhes?.texto || "";
              const part3 = detalhesStr
                ? (l.conversa_id ? `${detalhesStr} (conv #${l.conversa_id})` : detalhesStr)
                : (l.conversa_id ? `conv #${l.conversa_id}` : "");
              const fullStr = [dataStr, l.tipo === "fora_horario" ? "fora do horário" : l.tipo, part3].filter(Boolean).join(" — ");
              const isForaHorario = l.tipo === "fora_horario";
              return (
                <div key={l.id} className={`chatbot-log-item ${l.tipo === "erro" ? "chatbot-log-item--error" : ""} ${isForaHorario ? "chatbot-log-item--fora-horario" : ""}`} title={isForaHorario ? "Cliente escreveu fora do horário comercial" : undefined}>
                  {fullStr}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function normalizeAlertaSemRespostaFromApi(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  const bool = (value, fallback = false) => {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (value === 1) return true;
      if (value === 0) return false;
    }
    const rawValue = String(value ?? "").trim().toLowerCase();
    if (["1", "true", "sim", "yes", "on", "ativo"].includes(rawValue)) return true;
    if (["0", "false", "nao", "n\u00e3o", "no", "off", "inativo"].includes(rawValue)) return false;
    return fallback;
  };
  const num = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  };
  const responsaveis = Array.isArray(s.responsaveis_notificacao_ids)
    ? s.responsaveis_notificacao_ids.map(Number).filter((id) => Number.isFinite(id) && id > 0)
    : [];
  const gestorId = Number(s.gestor_notificado_id ?? responsaveis[0]);
  const gestorClienteId = Number(s.gestor_cliente_id);
  const horarioApi = s.horario_comercial && typeof s.horario_comercial === "object" ? s.horario_comercial : null;
  const janelaApi = Array.isArray(horarioApi?.janelas) && horarioApi.janelas.length ? horarioApi.janelas[0] : null;
  return {
    ...DEFAULT_ALERTA_SEM_RESPOSTA,
    ...s,
    alerta_sem_resposta_ativo: bool(s.alerta_sem_resposta_ativo, bool(s.ativo, false)),
    tempo_primeiro_alerta_minutos: num(s.tempo_primeiro_alerta_minutos, 1),
    tempo_alerta_critico_minutos: num(s.tempo_alerta_critico_minutos, 3),
    tempo_notificar_gestor_minutos: num(s.tempo_notificar_gestor_minutos, 5),
    notificar_por_whatsapp: bool(s.notificar_por_whatsapp, false),
    notificar_por_email: bool(s.notificar_por_email, false),
    notificar_interno: bool(s.notificar_interno, true),
    reabrir_conversa_automaticamente: bool(s.reabrir_conversa_automaticamente, true),
    aplicar_tag_automatica: bool(s.aplicar_tag_automatica, true),
    nome_tag_automatica: String(s.nome_tag_automatica || DEFAULT_ALERTA_SEM_RESPOSTA.nome_tag_automatica).trim(),
    gestor_notificado_id: Number.isFinite(gestorId) && gestorId > 0 ? gestorId : null,
    gestor_cliente_id: Number.isFinite(gestorClienteId) && gestorClienteId > 0 ? gestorClienteId : null,
    gestor_cliente_nome: String(s.gestor_cliente_nome || "").trim(),
    responsaveis_notificacao_ids: responsaveis,
    telefone_gestor: String(s.telefone_gestor || "").trim(),
    horario_comercial_ativo: bool(s.alerta_sem_resposta_ativo, bool(s.ativo, false)) ? true : bool(s.horario_comercial_ativo, true),
    timezone: String(s.timezone || horarioApi?.timezone || DEFAULT_ALERTA_SEM_RESPOSTA.timezone).trim(),
    horarioInicio: formatTimeForInput(s.horarioInicio || janelaApi?.inicio || "09:00"),
    horarioFim: formatTimeForInput(s.horarioFim || janelaApi?.fim || "18:00"),
    diasSemanaDesativados: Array.isArray(s.diasSemanaDesativados)
      ? s.diasSemanaDesativados.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      : Array.isArray(horarioApi?.dias_semana_desativados)
        ? horarioApi.dias_semana_desativados.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
        : [0, 6],
    datasEspecificasFechadas: Array.isArray(s.datasEspecificasFechadas)
      ? s.datasEspecificasFechadas.map(String).filter(Boolean)
      : Array.isArray(horarioApi?.datas_especificas_fechadas)
        ? horarioApi.datas_especificas_fechadas.map(String).filter(Boolean)
        : [],
    horario_comercial: horarioApi,
  };
}

function validateAlertaSemResposta(v) {
  const first = Number(v.tempo_primeiro_alerta_minutos);
  const critical = Number(v.tempo_alerta_critico_minutos);
  const manager = Number(v.tempo_notificar_gestor_minutos);
  if (!Number.isFinite(first) || first <= 0) return "Informe um tempo maior que zero para o primeiro alerta.";
  if (!Number.isFinite(critical) || critical < first) return "O alerta critico nao pode ser menor que o primeiro alerta.";
  if (!Number.isFinite(manager) || manager < critical) return "A notificacao ao gestor nao pode ser menor que o alerta critico.";
  if (v.aplicar_tag_automatica && !String(v.nome_tag_automatica || "").trim()) return "Informe o nome da tag automatica.";
  if (!v.alerta_sem_resposta_ativo) return null;
  if (v.notificar_interno) {
    const gestorId = Number(v.gestor_notificado_id);
    if (!(Number.isFinite(gestorId) && gestorId > 0)) {
      return "Selecione um responsavel interno da empresa.";
    }
  }
  if (v.notificar_por_whatsapp) {
    const clienteId = Number(v.gestor_cliente_id);
    const manual = String(v.telefone_gestor || "").replace(/\D/g, "");
    if (!(Number.isFinite(clienteId) && clienteId > 0) && (!manual || manual.length < 10)) {
      return "Para WhatsApp, selecione um contato cadastrado no sistema.";
    }
  }
  if (v.notificar_por_email) return "E-mail esta indisponivel ate a configuracao de SMTP no servidor.";
  if (!v.notificar_por_whatsapp && !v.notificar_por_email && !v.notificar_interno) {
    return "Selecione ao menos um canal de notificacao disponivel.";
  }
  return null;
}

function buildAlertaSemRespostaPayload(v) {
  const gestorId = Number(v.gestor_notificado_id);
  const gestorClienteId = Number(v.gestor_cliente_id);
  const alertaAtivo = v.alerta_sem_resposta_ativo === true;
  return {
    alerta_sem_resposta_ativo: alertaAtivo,
    tempo_primeiro_alerta_minutos: Math.max(1, Math.floor(Number(v.tempo_primeiro_alerta_minutos) || 1)),
    tempo_alerta_critico_minutos: Math.max(1, Math.floor(Number(v.tempo_alerta_critico_minutos) || 1)),
    tempo_notificar_gestor_minutos: Math.max(1, Math.floor(Number(v.tempo_notificar_gestor_minutos) || 1)),
    notificar_por_whatsapp: v.notificar_por_whatsapp === true,
    notificar_por_email: v.notificar_por_email === true,
    notificar_interno: v.notificar_interno !== false,
    reabrir_conversa_automaticamente: v.reabrir_conversa_automaticamente !== false,
    aplicar_tag_automatica: v.aplicar_tag_automatica !== false,
    nome_tag_automatica: String(v.nome_tag_automatica || DEFAULT_ALERTA_SEM_RESPOSTA.nome_tag_automatica).trim(),
    gestor_notificado_id: Number.isFinite(gestorId) && gestorId > 0 ? gestorId : null,
    gestor_cliente_id: Number.isFinite(gestorClienteId) && gestorClienteId > 0 ? gestorClienteId : null,
    gestor_cliente_nome: String(v.gestor_cliente_nome || "").trim(),
    responsaveis_notificacao_ids: Number.isFinite(gestorId) && gestorId > 0 ? [gestorId] : [],
    telefone_gestor: String(v.telefone_gestor || "").trim(),
    horario_comercial_ativo: alertaAtivo ? true : v.horario_comercial_ativo !== false,
    timezone: String(v.timezone || "America/Sao_Paulo").trim(),
    horarioInicio: formatTimeForInput(v.horarioInicio),
    horarioFim: formatTimeForInput(v.horarioFim),
    diasSemanaDesativados: Array.isArray(v.diasSemanaDesativados)
      ? v.diasSemanaDesativados.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      : [0, 6],
    datasEspecificasFechadas: Array.isArray(v.datasEspecificasFechadas)
      ? v.datasEspecificasFechadas.map(String).filter(Boolean)
      : [],
  };
}

function formatAlertaEventoTipo(tipo) {
  const map = {
    primeiro_alerta: "Primeiro alerta enviado",
    alerta_critico: "Alerta critico enviado",
    gestor_notificado: "Gestor notificado",
    whatsapp_enviado: "WhatsApp enviado ao gestor",
    tag_aplicada: "Tag aplicada",
    conversa_reaberta: "Conversa reaberta",
    sla_resetado: "SLA resetado",
    whatsapp_falha: "Falha no WhatsApp",
    email_indisponivel: "E-mail indisponivel",
  };
  return map[tipo] || tipo || "Evento";
}

function getHorarioComercialResumo(cfg) {
  const horario = cfg?.horario_comercial && typeof cfg.horario_comercial === "object" ? cfg.horario_comercial : null;
  if (horario?.resumo) return horario.resumo;
  if (cfg?.horario_comercial_ativo === false) {
    return "Contagem ativa: horario comercial desativado. Os minutos contam de forma corrida.";
  }
  return "Contagem ativa conforme o horario comercial configurado para a empresa. Fora desse horario, os minutos ficam pausados e continuam no proximo expediente.";
}

function SecaoAlertasAtendimento() {
  const showToast = useNotificationStore((s) => s.showToast);
  const [cfg, setCfg] = useState(DEFAULT_ALERTA_SEM_RESPOSTA);
  const [logs, setLogs] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [featureUnavailable, setFeatureUnavailable] = useState(
    () => !iaApi.isAlertaSemRespostaApiEnabled()
  );
  const [gestorContatoBusca, setGestorContatoBusca] = useState("");
  const [gestorContatoOptions, setGestorContatoOptions] = useState([]);
  const [gestorContatoLoading, setGestorContatoLoading] = useState(false);
  const [novaDataFechadaAlerta, setNovaDataFechadaAlerta] = useState("");

  const gestores = usuarios.filter((u) => {
    const perfil = String(u.perfil || u.role || "").toLowerCase();
    return perfil === "admin" || perfil === "gestor" || perfil === "supervisor";
  });
  const responsaveis = gestores.length ? gestores : usuarios.filter((u) => String(u.perfil || "").toLowerCase() !== "atendente");

  useEffect(() => {
    if (!cfg.notificar_por_whatsapp) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setGestorContatoLoading(true);
      try {
        const clientes = await getClientes({
          palavra: gestorContatoBusca.trim() || undefined,
          limit: 20,
          page: 1,
        });
        if (!cancelled) setGestorContatoOptions(Array.isArray(clientes) ? clientes : []);
      } catch (e) {
        if (import.meta.env.DEV) console.warn("Erro ao carregar contatos do gestor:", e);
        if (!cancelled) setGestorContatoOptions([]);
      } finally {
        if (!cancelled) setGestorContatoLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [cfg.notificar_por_whatsapp, gestorContatoBusca]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const usuariosResp = await getUsuarios().catch(() => []);
      setUsuarios(Array.isArray(usuariosResp) ? usuariosResp : []);

      if (!iaApi.isAlertaSemRespostaApiEnabled()) {
        setFeatureUnavailable(true);
        setCfg(DEFAULT_ALERTA_SEM_RESPOSTA);
        setLogs([]);
        setError(
          "Os alertas de atendimento ainda nao estao disponiveis neste servidor. Atualize o backend ou contate o suporte."
        );
        return;
      }

      const configResp = await iaApi.getAlertaSemRespostaConfig();
      if (configResp == null) {
        setFeatureUnavailable(true);
        setCfg(DEFAULT_ALERTA_SEM_RESPOSTA);
        setLogs([]);
        setError(
          "Os alertas de atendimento ainda nao estao disponiveis neste servidor. Atualize o backend ou contate o suporte."
        );
        return;
      }

      setFeatureUnavailable(false);
      setCfg(normalizeAlertaSemRespostaFromApi(configResp));
      try {
        const eventosResp = await iaApi.getAlertaSemRespostaEventos({ limit: 20 });
        setLogs(Array.isArray(eventosResp) ? eventosResp : []);
      } catch (eventosErr) {
        setLogs([]);
        if (import.meta.env.DEV) console.warn("Logs de alerta indisponiveis:", eventosErr);
      }
    } catch (e) {
      if (import.meta.env.DEV) console.warn("Erro ao carregar alerta sem resposta:", e);
      setError(e?.response?.data?.error || "Nao foi possivel carregar os alertas de atendimento.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const validation = validateAlertaSemResposta(cfg);
  const previewFirst = Number(cfg.tempo_primeiro_alerta_minutos) || 1;
  const previewCritical = Number(cfg.tempo_alerta_critico_minutos) || 3;
  const previewManager = Number(cfg.tempo_notificar_gestor_minutos) || 5;
  const horarioComercialResumo = getHorarioComercialResumo(cfg);
  const tagResumo =
    cfg.aplicar_tag_automatica && String(cfg.nome_tag_automatica || "").trim()
      ? String(cfg.nome_tag_automatica).trim()
      : "desativada";
  const selectedGestor = responsaveis.find((u) => Number(u.id) === Number(cfg.gestor_notificado_id));
  const selectedGestorContatoId = cfg.gestor_cliente_id ? String(cfg.gestor_cliente_id) : "";
  const gestorContatoSelectOptions = (() => {
    const base = [...gestorContatoOptions];
    if (cfg.gestor_cliente_id && !base.some((c) => String(c.id) === String(cfg.gestor_cliente_id))) {
      base.unshift({
        id: Number(cfg.gestor_cliente_id),
        nome: cfg.gestor_cliente_nome || `Cliente ${cfg.gestor_cliente_id}`,
        telefone: cfg.telefone_gestor || "",
      });
    }
    return base;
  })();

  const handleSave = async () => {
    const msg = validateAlertaSemResposta(cfg);
    if (msg) {
      setError(msg);
      showToast({ type: "error", title: "Configuracao invalida", message: msg });
      return;
    }
    setSaving(true);
    setError("");
    try {
      const saved = await iaApi.putAlertaSemRespostaConfig(buildAlertaSemRespostaPayload(cfg));
      const refreshed = await iaApi.getAlertaSemRespostaConfig().catch(() => saved);
      setCfg(normalizeAlertaSemRespostaFromApi(refreshed || saved));
      showToast({ type: "success", title: "Salvo", message: "Alertas de atendimento atualizados." });
      const eventos = await iaApi.getAlertaSemRespostaEventos({ limit: 20 }).catch(() => logs);
      setLogs(eventos || []);
    } catch (e) {
      const msgErr =
        e?.code === "ALERTA_SEM_RESPOSTA_UNAVAILABLE"
          ? e.message
          : e?.response?.data?.error || "Nao foi possivel salvar a configuracao.";
      setError(msgErr);
      showToast({ type: "error", title: "Erro ao salvar", message: msgErr });
    } finally {
      setSaving(false);
    }
  };

  const handleDryRun = async () => {
    setChecking(true);
    try {
      const result = await iaApi.processarAlertaSemResposta(true);
      const total = Number(result?.processadas || 0);
      const skipped = String(result?.skipped || "");
      const paused = skipped === "fora_horario";
      showToast({
        type: paused ? "warning" : "success",
        title: paused ? "Contador pausado" : "Simulacao concluida",
        message: paused
          ? `Nenhum alerta dispararia agora porque esta fora do expediente. ${result?.horario_comercial?.resumo || horarioComercialResumo}`
          : total
            ? `${total} conversa(s) elegiveis agora.`
            : "Nenhuma conversa elegivel neste momento.",
      });
    } catch (e) {
      showToast({
        type: "error",
        title: "Falha na simulacao",
        message:
          e?.code === "ALERTA_SEM_RESPOSTA_UNAVAILABLE"
            ? e.message
            : e?.response?.data?.error || "Nao foi possivel processar a simulacao.",
      });
    } finally {
      setChecking(false);
    }
  };

  if (loading) {
    return (
      <div className="sla-section">
        <SkeletonGrid count={4} />
      </div>
    );
  }

  return (
    <div className="sla-section">
      <div className="sla-header">
        <div>
          <h2 className="chatbot-title">Alertas de Atendimento</h2>
          <p className="chatbot-subtitle">Configure escalonamento quando a ultima mensagem da conversa for do cliente. Os prazos contam dentro do horario comercial.</p>
        </div>
        <span className={`chatbot-badge ${cfg.alerta_sem_resposta_ativo ? "chatbot-badge--on" : "chatbot-badge--off"}`}>
          {cfg.alerta_sem_resposta_ativo ? "Ativo" : "Inativo"}
        </span>
      </div>

      {error && (
        <div className="sla-inline-error" role="alert">
          {error}
        </div>
      )}

      <div className="sla-grid">
        <div className="sla-main">
          <div className="chatbot-card sla-card">
            <div className="sla-card-head">
              <div>
                <h3 className="chatbot-card-title">Alerta de atendimento sem resposta</h3>
                <p className="chatbot-card-subtitle">Evite que clientes fiquem esquecidos quando um atendente nao responde no prazo.</p>
              </div>
              <Switch
                checked={cfg.alerta_sem_resposta_ativo}
                onChange={(x) =>
                  setCfg((c) => ({
                    ...c,
                    alerta_sem_resposta_ativo: x,
                    horario_comercial_ativo: x ? true : c.horario_comercial_ativo,
                  }))
                }
              />
            </div>
            <div className="sla-note">
              O fluxo roda somente quando esta ativo, a conversa nao esta encerrada, a ultima mensagem foi enviada pelo cliente e o atendimento esta dentro do horario comercial.
            </div>
            <div className="sla-schedule-callout">
              <strong>Contagem do temporizador</strong>
              <span>{horarioComercialResumo}</span>
            </div>
          </div>

          <div className="chatbot-card sla-card">
            <div className="sla-card-head">
              <div>
                <h3 className="chatbot-card-title">Horario comercial do alerta</h3>
                <p className="chatbot-card-subtitle">
                  Defina quando os alertas podem disparar. Fora desse horario, o contador fica pausado e nenhuma acao e executada.
                </p>
              </div>
              <Switch
                checked={cfg.horario_comercial_ativo !== false}
                disabled={cfg.alerta_sem_resposta_ativo}
                onChange={(x) => setCfg((c) => ({ ...c, horario_comercial_ativo: x }))}
              />
            </div>
            <div
              className="chatbot-fora-horario-fields"
              style={{
                opacity: cfg.horario_comercial_ativo !== false ? 1 : 0.55,
                pointerEvents: cfg.horario_comercial_ativo !== false ? "auto" : "none",
              }}
            >
              <div className="chatbot-subsection">
                <h4 className="chatbot-subsection-title">Horario de atendimento</h4>
                <div className="chatbot-time-row">
                  <div className="ia-field">
                    <label>Inicio</label>
                    <input
                      type="time"
                      className="ia-input"
                      value={formatTimeForInput(cfg.horarioInicio) || "09:00"}
                      onChange={(e) => setCfg((c) => ({ ...c, horarioInicio: e.target.value }))}
                    />
                  </div>
                  <div className="ia-field">
                    <label>Termino</label>
                    <input
                      type="time"
                      className="ia-input"
                      value={formatTimeForInput(cfg.horarioFim) || "18:00"}
                      onChange={(e) => setCfg((c) => ({ ...c, horarioFim: e.target.value }))}
                    />
                  </div>
                </div>
                <p className="chatbot-hint">Horarios que atravessam meia-noite sao suportados (ex: 22:00-06:00).</p>
              </div>

              <div className="chatbot-subsection">
                <h4 className="chatbot-subsection-title">Dias da semana em que nao trabalha</h4>
                <div className="chatbot-dias-row">
                  {DIAS_SEMANA.map((d) => {
                    const dias = cfg.diasSemanaDesativados || [0, 6];
                    const checked = dias.includes(d.num);
                    return (
                      <label key={d.num} className="chatbot-dia-check">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const prev = cfg.diasSemanaDesativados || [0, 6];
                            const next = checked
                              ? prev.filter((n) => n !== d.num)
                              : [...prev.filter((n) => n !== d.num), d.num].sort((a, b) => a - b);
                            setCfg((c) => ({ ...c, diasSemanaDesativados: next.length > 0 ? next : [0, 6] }));
                          }}
                        />
                        <span>{d.label}</span>
                      </label>
                    );
                  })}
                </div>
                <p className="chatbot-hint">Marcado = nao trabalha. Padrao: Dom e Sab marcados.</p>
              </div>

              <div className="chatbot-subsection">
                <h4 className="chatbot-subsection-title">Datas especificas fechadas (feriados, recesso)</h4>
                <div className="chatbot-datas-row">
                  <input
                    type="date"
                    className="ia-input chatbot-input-date"
                    value={novaDataFechadaAlerta}
                    onChange={(e) => setNovaDataFechadaAlerta(e.target.value)}
                  />
                  <button
                    type="button"
                    className="ia-btn ia-btn--outline"
                    onClick={() => {
                      if (!novaDataFechadaAlerta) return;
                      const datas = cfg.datasEspecificasFechadas || [];
                      if (!datas.includes(novaDataFechadaAlerta)) {
                        setCfg((c) => ({
                          ...c,
                          datasEspecificasFechadas: [...datas, novaDataFechadaAlerta].sort(),
                        }));
                        setNovaDataFechadaAlerta("");
                      }
                    }}
                  >
                    + Adicionar data
                  </button>
                </div>
                {(cfg.datasEspecificasFechadas || []).length > 0 && (
                  <ul className="chatbot-datas-list">
                    {(cfg.datasEspecificasFechadas || []).map((d) => (
                      <li key={d} className="chatbot-datas-item">
                        <span>{new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR")}</span>
                        <button
                          type="button"
                          className="chatbot-btn-remove"
                          onClick={() =>
                            setCfg((c) => ({
                              ...c,
                              datasEspecificasFechadas: (c.datasEspecificasFechadas || []).filter((x) => x !== d),
                            }))
                          }
                        >
                          Remover
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            {cfg.alerta_sem_resposta_ativo && (
              <p className="chatbot-hint" style={{ marginTop: 12 }}>
                Com o alerta ativo, o horario comercial fica sempre ligado para evitar disparos fora do expediente.
              </p>
            )}
          </div>

          <div className="chatbot-card sla-card">
            <h3 className="chatbot-card-title">Tempos de alerta</h3>
            <div className="sla-time-grid">
              <div className="ia-field">
                <label>Primeiro alerta de atencao apos</label>
                <div className="sla-input-suffix">
                  <input
                    type="number"
                    min="1"
                    className="ia-input"
                    value={cfg.tempo_primeiro_alerta_minutos}
                    onChange={(e) => setCfg((c) => ({ ...c, tempo_primeiro_alerta_minutos: e.target.value }))}
                  />
                  <span>min</span>
                </div>
              </div>
              <div className="ia-field">
                <label>Alerta critico apos</label>
                <div className="sla-input-suffix">
                  <input
                    type="number"
                    min="1"
                    className="ia-input"
                    value={cfg.tempo_alerta_critico_minutos}
                    onChange={(e) => setCfg((c) => ({ ...c, tempo_alerta_critico_minutos: e.target.value }))}
                  />
                  <span>min</span>
                </div>
              </div>
              <div className="ia-field">
                <label>Notificar gestor/admin apos</label>
                <div className="sla-input-suffix">
                  <input
                    type="number"
                    min="1"
                    className="ia-input"
                    value={cfg.tempo_notificar_gestor_minutos}
                    onChange={(e) => setCfg((c) => ({ ...c, tempo_notificar_gestor_minutos: e.target.value }))}
                  />
                  <span>min</span>
                </div>
              </div>
            </div>
            {validation && <p className="sla-field-error">{validation}</p>}
            <p className="chatbot-hint">Quando o horario comercial estiver ativo, os minutos pausam fora do expediente e continuam no proximo periodo de atendimento.</p>
          </div>

          <div className="chatbot-card sla-card">
            <h3 className="chatbot-card-title">Acao automatica</h3>
            <div className="sla-switch-list">
              <label className="sla-switch-item">
                <Switch
                  checked={cfg.reabrir_conversa_automaticamente}
                  onChange={(x) => setCfg((c) => ({ ...c, reabrir_conversa_automaticamente: x }))}
                />
                <span>
                  <strong>Reabrir/liberar conversa automaticamente</strong>
                  <small>Ao atingir o tempo final, outro atendente ou gestor podera assumir.</small>
                </span>
              </label>
              <label className="sla-switch-item">
                <Switch
                  checked={cfg.aplicar_tag_automatica}
                  onChange={(x) => setCfg((c) => ({ ...c, aplicar_tag_automatica: x }))}
                />
                <span>
                  <strong>Aplicar tag automatica</strong>
                  <small>Ajuda supervisao e filtros operacionais.</small>
                </span>
              </label>
            </div>
            <div className="ia-field" style={{ marginTop: 14 }}>
              <label>Nome da tag automatica</label>
              <input
                className="ia-input"
                value={cfg.nome_tag_automatica}
                disabled={!cfg.aplicar_tag_automatica}
                onChange={(e) => setCfg((c) => ({ ...c, nome_tag_automatica: e.target.value }))}
              />
            </div>
          </div>

          <div className="chatbot-card sla-card">
            <h3 className="chatbot-card-title">Notificacao do gestor</h3>
            <div className="sla-channel-grid">
              <label className="sla-check-card">
                <input
                  type="checkbox"
                  checked={cfg.notificar_por_whatsapp}
                  onChange={(e) => setCfg((c) => ({ ...c, notificar_por_whatsapp: e.target.checked }))}
                />
                <span>WhatsApp</span>
              </label>
              <label className="sla-check-card">
                <input
                  type="checkbox"
                  checked={cfg.notificar_por_email}
                  onChange={(e) => {
                    if (e.target.checked) {
                      showToast({
                        type: "warning",
                        title: "E-mail indisponivel",
                        message: "Configure SMTP no servidor antes de ativar notificacao por e-mail.",
                      });
                      return;
                    }
                    setCfg((c) => ({ ...c, notificar_por_email: false }));
                  }}
                />
                <span>E-mail</span>
              </label>
              <label className="sla-check-card">
                <input
                  type="checkbox"
                  checked={cfg.notificar_interno}
                  onChange={(e) => setCfg((c) => ({ ...c, notificar_interno: e.target.checked }))}
                />
                <span>Interna</span>
              </label>
            </div>
            <div className="sla-manager-grid">
              <div className="ia-field">
                <label>Responsavel (alerta interno)</label>
                <select
                  className="ia-select"
                  value={cfg.gestor_notificado_id || ""}
                  onChange={(e) => setCfg((c) => ({ ...c, gestor_notificado_id: e.target.value ? Number(e.target.value) : null }))}
                >
                  <option value="">Admin principal / regras do sistema</option>
                  {responsaveis.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nome || u.email || `Usuario ${u.id}`}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {cfg.notificar_por_whatsapp ? (
              <div className="ia-field" style={{ marginTop: 14 }}>
                <label>Contato WhatsApp do gestor (cadastrado no sistema)</label>
                <div className="chatbot-time-row" style={{ alignItems: "flex-end", gap: 12 }}>
                  <input
                    type="search"
                    className="ia-input"
                    value={gestorContatoBusca}
                    onChange={(e) => setGestorContatoBusca(e.target.value)}
                    placeholder="Buscar por nome ou telefone"
                    autoComplete="off"
                    style={{ minWidth: 220 }}
                  />
                  <select
                    className="ia-select"
                    value={selectedGestorContatoId}
                    onChange={(e) => {
                      const id = e.target.value;
                      const contato = gestorContatoSelectOptions.find((c) => String(c.id) === id);
                      setCfg((c) => ({
                        ...c,
                        gestor_cliente_id: id ? Number(id) : null,
                        gestor_cliente_nome: contato ? String(contato.nome || contato.pushname || "").trim().slice(0, 120) : "",
                        telefone_gestor: contato ? String(contato.telefone || contato.wa_id || "").trim().slice(0, 40) : "",
                      }));
                    }}
                    style={{ minWidth: 280 }}
                  >
                    <option value="">{gestorContatoLoading ? "Carregando contatos..." : "Selecione um contato"}</option>
                    {gestorContatoSelectOptions.map((cliente) => (
                      <option key={cliente.id} value={cliente.id}>
                        {formatAdminAlertContactOption(cliente)}
                      </option>
                    ))}
                  </select>
                </div>
                {cfg.telefone_gestor ? (
                  <p className="chatbot-hint" style={{ marginTop: 6 }}>
                    Envio para {cfg.gestor_cliente_nome || "contato selecionado"} ({cfg.telefone_gestor}).
                  </p>
                ) : (
                  <p className="chatbot-hint" style={{ marginTop: 6 }}>
                    O contato precisa ter telefone ou WhatsApp cadastrado.
                  </p>
                )}
              </div>
            ) : null}
            {selectedGestor && (
              <p className="chatbot-hint">Responsavel interno: {selectedGestor.nome || selectedGestor.email || `Usuario ${selectedGestor.id}`}</p>
            )}
            <p className="chatbot-hint">
              {cfg.notificar_por_email
                ? "E-mail ativo pelo servidor. A edicao do provedor SMTP/transacional ainda nao esta disponivel nesta tela."
                : "E-mail fica indisponivel ate a configuracao de um provedor SMTP/transacional no servidor."}
            </p>
          </div>

          <div className="sla-actions">
            <button
              type="button"
              className="ia-btn ia-btn--primary"
              onClick={handleSave}
              disabled={featureUnavailable || saving || !!validation}
            >
              {saving ? "Salvando..." : "Salvar configuracoes"}
            </button>
            <button
              type="button"
              className="ia-btn ia-btn--outline"
              onClick={handleDryRun}
              disabled={featureUnavailable || checking}
            >
              {checking ? "Simulando..." : "Simular agora"}
            </button>
            <button type="button" className="ia-btn ia-btn--outline" onClick={load} disabled={saving || checking}>
              Recarregar
            </button>
          </div>
        </div>

        <aside className="sla-side">
          <div className="chatbot-card sla-card">
            <h3 className="chatbot-card-title">Como funciona</h3>
            <ol className="sla-flow">
              <li>Cliente envia mensagem</li>
              <li>Atendente nao responde</li>
              <li>Apos {previewFirst} min: alerta de atencao</li>
              <li>Apos {previewCritical} min: alerta critico</li>
              <li>Apos {previewManager} min: gestor notificado</li>
              <li>{cfg.reabrir_conversa_automaticamente ? "Conversa reaberta/liberada" : "Conversa permanece com o atendente"}</li>
              <li>Tag: {tagResumo}</li>
            </ol>
            <p className="sla-note">{horarioComercialResumo}</p>
          </div>

          <div className="chatbot-card sla-card">
            <h3 className="chatbot-card-title">Preview das mensagens</h3>
            <div className="sla-preview-list">
              <div className="sla-preview-message">
                <strong>Atendente</strong>
                <p>⚠️ Atencao: este cliente esta aguardando resposta ha {previewFirst} minutos. Responda agora para evitar escalonamento.</p>
              </div>
              <div className="sla-preview-message sla-preview-message--critical">
                <strong>Critico</strong>
                <p>🚨 Alerta critico: esta conversa esta sem resposta ha {previewCritical} minutos. Se nao houver resposta, {cfg.reabrir_conversa_automaticamente ? "o gestor sera notificado e a conversa podera ser reaberta" : "o gestor sera notificado para acompanhar a conversa"}.</p>
              </div>
              <div className="sla-preview-message sla-preview-message--manager">
                <strong>Gestor</strong>
                <p>🚨 ZapERP — Atendimento sem resposta<br /><br />Cliente: Carlos Almeida<br />Atendente: Joao<br />Tempo sem resposta: {previewManager}min<br /><br />Status: {cfg.reabrir_conversa_automaticamente ? "conversa reaberta e liberada para novo atendimento." : "gestor notificado; conversa permanece com o atendente atual."}</p>
              </div>
            </div>
          </div>
        </aside>
      </div>

      <div className="chatbot-card sla-card sla-logs-card">
        <div className="chatbot-logs-header">
          <h3 className="chatbot-card-title">Logs recentes</h3>
          <button type="button" className="ia-btn ia-btn--outline chatbot-btn-refresh" onClick={load}>
            Atualizar
          </button>
        </div>
        {logs.length === 0 ? (
          <p className="chatbot-empty">Nenhum alerta registrado ainda.</p>
        ) : (
          <div className="sla-log-table-wrap">
            <table className="ia-table sla-log-table">
              <thead>
                <tr>
                  <th>Data/hora</th>
                  <th>Cliente</th>
                  <th>Atendente</th>
                  <th>Etapa</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td>{l.criado_em ? new Date(l.criado_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "-"}</td>
                    <td>{l.detalhes?.cliente_nome || (l.conversa_id ? `Conversa #${l.conversa_id}` : "-")}</td>
                    <td>{l.detalhes?.atendente_nome || (l.atendente_id ? `Usuario #${l.atendente_id}` : "-")}</td>
                    <td>{formatAlertaEventoTipo(l.tipo)}</td>
                    <td>{l.nivel || l.detalhes?.status_atendimento || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SecaoLogs({ logs, onRefresh }) {
  return (
    <div className="ia-section">
      <h4>6. Logs do bot</h4>
      <p className="ia-muted">Ações do bot, respostas automáticas enviadas e erros.</p>
      <div className="ia-btn-row">
        <button type="button" className="ia-btn ia-btn--outline" onClick={onRefresh}>
          Atualizar
        </button>
      </div>

      {logs.length === 0 ? (
        <p className="ia-muted">Nenhum log registrado.</p>
      ) : (
        <div style={{ marginTop: 12, maxHeight: 400, overflowY: "auto" }}>
          {logs.map((l) => (
            <div key={l.id} className="ia-log-item">
              <span className={`ia-log-tipo ${l.tipo === "erro" ? "erro" : ""}`}>{l.tipo}</span>
              {l.detalhes?.texto && <span>{l.detalhes.texto}</span>}
              <span style={{ marginLeft: 8, color: "#64748b", fontSize: 12 }}>
                {l.criado_em ? new Date(l.criado_em).toLocaleString("pt-BR") : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
