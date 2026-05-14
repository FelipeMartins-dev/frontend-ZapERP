import { useEffect, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuthStore } from "../auth/authStore";
import { usePermissoesStore } from "../auth/permissoesStore";
import { canAcessarConfiguracoes } from "../auth/permissions";
import { useNotificationStore } from "../notifications/notificationStore";
import api from "../api/http";
import * as iaApi from "../api/iaService";
import Breadcrumb from "../components/layout/Breadcrumb";
import { SkeletonGrid } from "../components/feedback/Skeleton";
import Switch from "../components/ui/Switch";
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
    finalizar_por_ausencia_mensagem: "",
    finalizar_por_ausencia_reabrir_automaticamente: true,
    finalizar_por_ausencia_reabrir_sem_chatbot: true,
  },
};

/** Une resposta GET /ia/config com defaults para não perder chaves (ex.: chatbot_triage.finalizar_por_ausencia_*). */
function mergeIaConfigFromApi(server) {
  if (!server || typeof server !== "object") return { ...DEFAULT_CONFIG };
  const ctRaw = server.chatbot_triage;
  const ct = ctRaw && typeof ctRaw === "object" ? ctRaw : {};
  return {
    ia: { ...DEFAULT_CONFIG.ia, ...(server.ia || {}) },
    automacoes: { ...DEFAULT_CONFIG.automacoes, ...(server.automacoes || {}) },
    chatbot_triage: {
      ...DEFAULT_CONFIG.chatbot_triage,
      ...ct,
      options: Array.isArray(ct.options) ? ct.options : DEFAULT_CONFIG.chatbot_triage.options,
    },
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
            departamentos={departamentos}
            logs={logs}
            onSave={(v) => handleSaveConfig("chatbot_triage", v)}
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
        {tab === "logs" && <SecaoLogs logs={logs} onRefresh={loadLogs} />}
      </div>
    </div>
  );
}

function SecaoRespostasAutomaticas({ regras, formRegra, setFormRegra, departamentos, tags, onAdd, onDelete }) {
  return (
    <div className="ia-section">
      <h4>3. Respostas automáticas</h4>
      <p className="ia-muted">Palavra-chave → resposta. Usa respostas_salvas, tags, conversa_tags.</p>

      <form onSubmit={onAdd}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="ia-field">
            <label>Palavra-chave</label>
            <input
              type="text"
              className="ia-input"
              value={formRegra.palavra_chave}
              onChange={(e) => setFormRegra((f) => ({ ...f, palavra_chave: e.target.value }))}
              placeholder="ex: horário"
            />
          </div>
          <div className="ia-field">
            <label>Resposta</label>
            <input
              type="text"
              className="ia-input"
              value={formRegra.resposta}
              onChange={(e) => setFormRegra((f) => ({ ...f, resposta: e.target.value }))}
              placeholder="Nosso horário é..."
            />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="ia-field">
            <label>Setor (opcional)</label>
            <select
              className="ia-select"
              value={formRegra.departamento_id}
              onChange={(e) => setFormRegra((f) => ({ ...f, departamento_id: e.target.value }))}
            >
              <option value="">Todos</option>
              {departamentos.map((d) => (
                <option key={d.id} value={d.id}>{d.nome}</option>
              ))}
            </select>
          </div>
          <div className="ia-field">
            <label>Tag a aplicar (opcional)</label>
            <select
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
        <div className="ia-checkbox-row">
          <input
            type="checkbox"
            id="aplicar_tag"
            checked={formRegra.aplicar_tag}
            onChange={(e) => setFormRegra((f) => ({ ...f, aplicar_tag: e.target.checked }))}
          />
          <label htmlFor="aplicar_tag">Aplicar tag automaticamente</label>
        </div>
        <div className="ia-checkbox-row">
          <input
            type="checkbox"
            id="horario_comercial"
            checked={formRegra.horario_comercial_only}
            onChange={(e) => setFormRegra((f) => ({ ...f, horario_comercial_only: e.target.checked }))}
          />
          <label htmlFor="horario_comercial">Apenas em horário comercial</label>
        </div>
        <div className="ia-btn-row">
          <button type="submit" className="ia-btn ia-btn--primary">
            Salvar regra
          </button>
        </div>
      </form>

      <h4 style={{ marginTop: 24 }}>Regras cadastradas ({regras.length})</h4>
      {regras.length === 0 ? (
        <p className="ia-muted">Nenhuma regra cadastrada.</p>
      ) : (
        regras.map((r) => (
          <div key={r.id} className="ia-regra-item">
            <div className="ia-regra-item-main">
              <strong>{r.palavra_chave}</strong> → {r.resposta}
              <br />
              <span>
                {r.departamentos?.nome ? `Setor: ${r.departamentos.nome}` : ""}
                {r.tags?.nome ? ` | Tag: ${r.tags.nome}` : ""}
                {r.horario_comercial_only ? " | Horário comercial" : ""}
              </span>
            </div>
            <button
              type="button"
              className="ia-btn ia-btn--outline ia-btn--small"
              style={{ flexShrink: 0 }}
              onClick={() => onDelete(r.id)}
            >
              Excluir
            </button>
          </div>
        ))
      )}
    </div>
  );
}

function SecaoIA({ config, onSave, saving }) {
  const [v, setV] = useState(config);
  useEffect(() => setV(config), [config]);

  return (
    <div className="ia-section">
      <h4>4. IA (sugestões inteligentes)</h4>
      <p className="ia-muted">Assistivo, nunca responde sozinho sem permissão.</p>

      <div className="ds-switch-row">
        <Switch checked={v.usar_ia} onChange={(x) => setV((c) => ({ ...c, usar_ia: x }))} />
        <span>Usar IA</span>
      </div>

      <div className="ia-checkbox-row">
        <input
          type="checkbox"
          id="sugerir_respostas"
          checked={v.sugerir_respostas}
          onChange={(e) => setV((c) => ({ ...c, sugerir_respostas: e.target.checked }))}
        />
        <label htmlFor="sugerir_respostas">Sugerir respostas para atendente</label>
      </div>
      <div className="ia-checkbox-row">
        <input
          type="checkbox"
          id="corrigir_texto"
          checked={v.corrigir_texto}
          onChange={(e) => setV((c) => ({ ...c, corrigir_texto: e.target.checked }))}
        />
        <label htmlFor="corrigir_texto">Corrigir texto automaticamente</label>
      </div>
      <div className="ia-checkbox-row">
        <input
          type="checkbox"
          id="auto_completar"
          checked={v.auto_completar}
          onChange={(e) => setV((c) => ({ ...c, auto_completar: e.target.checked }))}
        />
        <label htmlFor="auto_completar">Auto completar mensagens</label>
      </div>
      <div className="ia-checkbox-row">
        <input
          type="checkbox"
          id="resumo_conversa"
          checked={v.resumo_conversa}
          onChange={(e) => setV((c) => ({ ...c, resumo_conversa: e.target.checked }))}
        />
        <label htmlFor="resumo_conversa">Resumo de conversa</label>
      </div>
      <div className="ia-checkbox-row">
        <input
          type="checkbox"
          id="classificar_intencao"
          checked={v.classificar_intencao}
          onChange={(e) => setV((c) => ({ ...c, classificar_intencao: e.target.checked }))}
        />
        <label htmlFor="classificar_intencao">Classificar intenção</label>
      </div>
      <div className="ia-checkbox-row">
        <input
          type="checkbox"
          id="sugerir_tags"
          checked={v.sugerir_tags}
          onChange={(e) => setV((c) => ({ ...c, sugerir_tags: e.target.checked }))}
        />
        <label htmlFor="sugerir_tags">Sugerir tags</label>
      </div>

      <div className="ia-btn-row">
        <button className="ia-btn ia-btn--primary" onClick={() => onSave(v)} disabled={saving}>
          {saving ? "Salvando..." : "Salvar"}
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

function SecaoChatbotTriagem({ config, departamentos, logs, onSave, onRefreshLogs, saving }) {
  const [v, setV] = useState(config);
  const [novaDataFechada, setNovaDataFechada] = useState("");
  useEffect(() => setV(config), [config]);

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
    return {
      ...vals,
      enabled: !!vals.enabled,
      welcomeMessage: (vals.welcomeMessage || "").trim(),
      invalidOptionMessage: (vals.invalidOptionMessage || "").trim(),
      confirmSelectionMessage: (vals.confirmSelectionMessage || "").trim(),
      enviarMensagemFinalizacao: !!vals.enviarMensagemFinalizacao,
      mensagemFinalizacao: (vals.mensagemFinalizacao || "").trim(),
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
    if (vals.enviarMensagemFinalizacao) {
      const msg = (vals.mensagemFinalizacao || "").trim();
      if (!msg) return "Mensagem de finalização é obrigatória quando está ativo o envio ao finalizar.";
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
              <div className="ia-field" style={{ marginTop: 12 }}>
                <label>Mensagem enviada ao cliente antes de encerrar (opcional)</label>
                <textarea
                  className="ia-textarea"
                  rows={4}
                  value={v.finalizar_por_ausencia_mensagem ?? ""}
                  onChange={(e) => setV((c) => ({ ...c, finalizar_por_ausencia_mensagem: e.target.value }))}
                  placeholder="Vazio = o sistema usa o texto padrão definido no servidor."
                />
                <p className="chatbot-hint" style={{ marginTop: 6 }}>
                  Personalize o aviso de encerramento por falta de resposta. Se deixar em branco, o backend aplica a mensagem padrão.
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
