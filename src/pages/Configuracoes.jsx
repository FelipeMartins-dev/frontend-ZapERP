import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuthStore } from "../auth/authStore";
import { useEmpresaStore } from "../auth/empresaStore";
import { useChatStore } from "../chats/chatsStore";
import { useConversaStore } from "../conversa/conversaStore";
import api from "../api/http";
import * as cfg from "../api/configService";
import * as chatService from "../chats/chatService";
import { canAcessarConfiguracoes, canAcessarUsuarios, canGerenciarRespostasSalvas } from "../auth/permissions";
import { useNotificationStore } from "../notifications/notificationStore";
import SecaoPermissoes from "./SecaoPermissoes";
import Breadcrumb from "../components/layout/Breadcrumb";
import { SkeletonGrid } from "../components/feedback/Skeleton";
import Switch from "../components/ui/Switch";
import "../components/layout/breadcrumb.css";
import "../components/feedback/skeleton.css";
import "../components/ui/switch.css";
import "./IA.css";
import "./Configuracoes.css";
import PushNotificationsCard from "../push/PushNotificationsCard";

/** Limite por página na lista de clientes — evita buscar/renderizar a base inteira de uma vez. */
const CLIENTES_PAGE_LIMIT = 200;

/** Fontes disponíveis para o nome da empresa no cabeçalho. */
export const FONTES_OPCOES = [
  { value: "inter",              label: "Inter (padrão)"          },
  { value: "plus-jakarta-sans",  label: "Plus Jakarta Sans"        },
  { value: "poppins",            label: "Poppins"                  },
  { value: "montserrat",         label: "Montserrat"               },
  { value: "orbitron",           label: "Orbitron (estilo Brasão & Prata)" },
  { value: "nunito",             label: "Nunito"                   },
  { value: "raleway",            label: "Raleway"                  },
  { value: "playfair-display",   label: "Playfair Display (Serif)" },
];

/** Mapa de chave → CSS font-family para aplicar inline. */
export const FONT_FAMILIES = {
  "inter":             '"Inter", system-ui, sans-serif',
  "plus-jakarta-sans": '"Plus Jakarta Sans", sans-serif',
  "poppins":           '"Poppins", sans-serif',
  "montserrat":        '"Montserrat", sans-serif',
  "orbitron":          '"Orbitron", "Montserrat", sans-serif',
  "nunito":            '"Nunito", sans-serif',
  "raleway":           '"Raleway", sans-serif',
  "playfair-display":  '"Playfair Display", Georgia, serif',
};

const TABS = [
  { id: "geral", label: "Geral" },
  { id: "usuarios", label: "Usuários" },
  { id: "permissoes", label: "Permissões" },
  { id: "departamentos", label: "Departamentos" },
  { id: "tags", label: "Tags" },
  { id: "respostas", label: "Respostas salvas" },
  { id: "bot", label: "ChatBot / IA" },
  { id: "clientes", label: "Clientes" },
  { id: "planos", label: "Planos" },
  { id: "auditoria", label: "Auditoria" },
];

export default function Configuracoes() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const canAccessConfig = canAcessarConfiguracoes(user);
  const canAccessUsers = canAcessarUsuarios(user);
  const canManageRespostas = canGerenciarRespostasSalvas(user);
  const respostasOnlyMode = !canAccessConfig && canManageRespostas;

  const visibleTabs = useMemo(
    () => {
      if (respostasOnlyMode) {
        return TABS.filter((t) => t.id === "respostas");
      }
      return canAccessUsers
        ? TABS
        : TABS.filter((t) => t.id !== "usuarios" && t.id !== "permissoes");
    },
    [canAccessUsers, respostasOnlyMode]
  );

  const tabFromUrl = searchParams.get("tab");
  const [tab, setTab] = useState(tabFromUrl && TABS.some((t) => t.id === tabFromUrl) ? tabFromUrl : "geral");
  const [loading, setLoading] = useState(true);
  const [empresa, setEmpresa] = useState(null);
  const [usuarios, setUsuarios] = useState([]);
  const [departamentos, setDepartamentos] = useState([]);
  const [tags, setTags] = useState([]);
  const [respostas, setRespostas] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [clientesTotal, setClientesTotal] = useState(0);
  const [clientesLoadingMore, setClientesLoadingMore] = useState(false);
  const clientesPageRef = useRef(1);
  const [planos, setPlanos] = useState([]);
  const [auditoria, setAuditoria] = useState([]);
  const [empresasWhatsapp, setEmpresasWhatsapp] = useState([]);
  const [errorMsg, setErrorMsg] = useState(null);
  const [modal, setModal] = useState(null);
  const [usuarioIdPermissoes, setUsuarioIdPermissoes] = useState("");

  useEffect(() => {
    if (!canAccessConfig && !canManageRespostas) {
      navigate("/atendimento");
    }
  }, [canAccessConfig, canManageRespostas, navigate]);

  useEffect(() => {
    const t = searchParams.get("tab");
    if (respostasOnlyMode) {
      if (t !== "respostas") {
        navigate("/configuracoes?tab=respostas", { replace: true });
        return;
      }
      setTab("respostas");
      return;
    }
    if ((t === "usuarios" || t === "permissoes") && !canAccessUsers) {
      navigate("/configuracoes?tab=geral", { replace: true });
      return;
    }
    if (t && TABS.some((x) => x.id === t)) setTab(t);
  }, [searchParams, canAccessUsers, navigate, respostasOnlyMode]);

  const setTabAndUrl = useCallback((nextTab) => {
    if (respostasOnlyMode && nextTab !== "respostas") return;
    setTab(nextTab);
    try {
      const sp = new URLSearchParams(searchParams);
      sp.set("tab", nextTab);
      navigate({ search: `?${sp.toString()}` }, { replace: true });
    } catch {
      // ignore
    }
  }, [navigate, respostasOnlyMode, searchParams]);


  const loadAll = useCallback(async () => {
    if (!canAccessConfig && !canManageRespostas) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      if (respostasOnlyMode) {
        const [dep, resp] = await Promise.all([
          cfg.getDepartamentos().catch(() => []),
          cfg.getRespostasSalvas().catch(() => []),
        ]);
        setDepartamentos(dep);
        setRespostas(resp);
        return;
      }
      const [emp, usr, dep, tag, resp, cliRes, plan, aud, ew] = await Promise.all([
        cfg.getEmpresa().catch(() => null),
        cfg.getUsuarios().catch(() => []),
        cfg.getDepartamentos().catch(() => []),
        cfg.getTags().catch(() => []),
        cfg.getRespostasSalvas().catch(() => []),
        cfg.getClientesComTotal({ page: 1, limit: CLIENTES_PAGE_LIMIT }).catch(() => ({ clientes: [], total: 0 })),
        cfg.getPlanos().catch(() => []),
        cfg.getAuditoria(100).catch(() => []),
        cfg.getEmpresasWhatsapp().catch(() => []),
      ]);
      setEmpresa(emp);
      setUsuarios(usr);
      setDepartamentos(dep);
      setTags(tag);
      setRespostas(resp);
      setClientes(cliRes?.clientes || []);
      setClientesTotal(Number(cliRes?.total) || 0);
      clientesPageRef.current = 1;
      setPlanos(plan);
      setAuditoria(aud);
      setEmpresasWhatsapp(ew);
    } catch (e) {
      setErrorMsg("Erro ao carregar dados. Verifique sua conexão.");
    } finally {
      setLoading(false);
    }
  }, [canAccessConfig, canManageRespostas, respostasOnlyMode]);

  /**
   * Carrega clientes com filtro opcional (nome ou telefone).
   * Sem busca ativa: pagina (CLIENTES_PAGE_LIMIT por vez) para não buscar/renderizar a base inteira.
   * Com busca ativa: mantém o comportamento atual (busca já estreita o resultado).
   */
  const loadClientes = useCallback(async (params = {}) => {
    const temBusca = String(params?.palavra || "").trim() !== "";
    const finalParams = temBusca ? params : { page: 1, limit: CLIENTES_PAGE_LIMIT, ...params };
    try {
      const cliRes = await cfg.getClientesComTotal(finalParams);
      setClientes(cliRes?.clientes || []);
      setClientesTotal(Number(cliRes?.total) || 0);
      clientesPageRef.current = 1;
    } catch (e) {
      setClientes([]);
      setClientesTotal(0);
    }
  }, []);

  /** Busca a próxima página e acrescenta à lista atual (só usado sem busca ativa). */
  const carregarMaisClientes = useCallback(async () => {
    if (clientesLoadingMore) return;
    setClientesLoadingMore(true);
    try {
      const nextPage = clientesPageRef.current + 1;
      const cliRes = await cfg.getClientesComTotal({ page: nextPage, limit: CLIENTES_PAGE_LIMIT });
      const novos = cliRes?.clientes || [];
      if (novos.length > 0) {
        setClientes((prev) => [...prev, ...novos]);
        clientesPageRef.current = nextPage;
      }
      if (cliRes?.total != null) setClientesTotal(Number(cliRes.total) || 0);
    } catch (e) {
      // silencioso — mantém a lista atual; o usuário pode tentar novamente
    } finally {
      setClientesLoadingMore(false);
    }
  }, [clientesLoadingMore]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  if (!canAccessConfig && !canManageRespostas) return null;

  if (loading && canAccessConfig && !empresa) {
    return (
      <div className="ia-wrap config-wrap">
        <div className="ia-header">
          <Breadcrumb items={[{ label: "Configurações" }]} />
          <h1 className="ia-title">Configurações</h1>
          <p className="ia-subtitle">Painel administrativo do CRM</p>
        </div>
        <div className="ia-content config-loading-skeleton">
          <SkeletonGrid count={4} />
        </div>
      </div>
    );
  }

  return (
    <div className="ia-wrap config-wrap">
      <header className="ia-header">
        <Breadcrumb items={[{ label: "Configurações" }]} />
        <h1 className="ia-title">{respostasOnlyMode ? "Respostas salvas" : "Configurações"}</h1>
        <p className="ia-subtitle">
          {respostasOnlyMode
            ? "Cadastre modelos pessoais para usar no atendimento com o atalho /"
            : "Central de administração — configure 100% do sistema"}
        </p>
      </header>

      {errorMsg && (
        <div className="ia-error-banner" role="alert">
          {errorMsg}
          <button type="button" onClick={() => setErrorMsg(null)}>×</button>
        </div>
      )}

      <nav className="ia-tabs">
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`ia-tab ${tab === t.id ? "ia-tab--active" : ""}`}
            onClick={() => setTabAndUrl(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="ia-content">
        {tab === "geral" && (
          <SecaoGeral
            empresa={empresa}
            empresasWhatsapp={empresasWhatsapp}
            onOpenConnectWhatsapp={() => navigate("/configuracoes/whatsapp")}
            onSave={async (v) => {
              const updated = await cfg.putEmpresa(v);
              const nextEmpresa = updated || v;
              setEmpresa(nextEmpresa);
              useEmpresaStore.getState().setEmpresa(nextEmpresa);
              const authPatch = {};
              if (nextEmpresa?.crm_habilitado !== undefined) authPatch.crm_habilitado = nextEmpresa.crm_habilitado;
              if (nextEmpresa?.separar_mensagens_disparadas !== undefined) authPatch.separar_mensagens_disparadas = nextEmpresa.separar_mensagens_disparadas;
              if (Object.keys(authPatch).length > 0) {
                useAuthStore.getState().updateUser(authPatch);
              }
              loadAll();
            }}
            onRefresh={loadAll}
          />
        )}
        {tab === "usuarios" && (
          <SecaoUsuarios
            usuarios={usuarios}
            departamentos={departamentos}
            onRefresh={loadAll}
            onEdit={(u) => setModal({ type: "usuario", data: u })}
            onNew={() => setModal({ type: "usuario", data: null })}
            onEditarPermissoes={(u) => {
              setTabAndUrl("permissoes");
              setUsuarioIdPermissoes(String(u.id));
            }}
          />
        )}
        {tab === "permissoes" && (
          <SecaoPermissoes
            usuarios={usuarios}
            usuarioIdInicial={usuarioIdPermissoes}
            onUsuarioIdChange={setUsuarioIdPermissoes}
            onRefresh={loadAll}
          />
        )}
        {tab === "departamentos" && (
          <SecaoDepartamentos departamentos={departamentos} onRefresh={loadAll} />
        )}
        {tab === "tags" && (
          <SecaoTags tags={tags} onRefresh={loadAll} />
        )}
        {tab === "respostas" && (
          <SecaoRespostas respostas={respostas} departamentos={departamentos} onRefresh={loadAll} user={user} />
        )}
        {tab === "bot" && (
          <div className="ia-section">
            <h4>ChatBot / IA</h4>
            <p className="ia-muted">Configure automações, bot, roteamento e IA assistiva.</p>
            <div className="ia-btn-row" style={{ gap: 12 }}>
              <button type="button" className="ia-btn ia-btn--primary" onClick={() => navigate("/ia?tab=chatbot")}>
                Chatbot de Triagem
              </button>
              <button type="button" className="ia-btn ia-btn--outline" onClick={() => navigate("/ia")}>
                Painel completo IA / Bot
              </button>
            </div>
          </div>
        )}
        {tab === "clientes" && (
          <SecaoClientes
            clientes={clientes}
            clientesTotal={clientesTotal}
            onRefresh={loadAll}
            onSyncContacts={loadAll}
            onSearchClientes={loadClientes}
            onLoadMoreClientes={carregarMaisClientes}
            loadingMoreClientes={clientesLoadingMore}
            empresa={empresa}
            tags={tags}
            onUpdateEmpresa={async (patch) => {
              const updated = await cfg.putEmpresa(patch);
              setEmpresa((prev) => updated || { ...(prev || {}), ...(patch || {}) });
              return updated;
            }}
          />
        )}
        {tab === "planos" && (
          <SecaoPlanos planos={planos} />
        )}
        {tab === "auditoria" && (
          <SecaoAuditoria auditoria={auditoria} onRefresh={loadAll} />
        )}
      </div>

      {modal?.type === "usuario" && (
        <ModalUsuario
          usuario={modal.data}
          departamentos={departamentos}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); loadAll(); }}
        />
      )}
    </div>
  );
}

const THEME_KEY = "theme";

function getStoredTheme() {
  try {
    return localStorage.getItem(THEME_KEY) || "light";
  } catch {
    return "light";
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {}
  window.dispatchEvent(new CustomEvent("theme-change", { detail: theme }));
}

function SecaoGeral({ empresa, empresasWhatsapp = [], onSave, onRefresh, onOpenConnectWhatsapp }) {
  const [v, setV] = useState(empresa || {});
  useEffect(() => setV(empresa || {}), [empresa]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null); // { type: "ok"|"err", text }
  const [darkMode, setDarkMode] = useState(() => getStoredTheme() === "dark");
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoMsg, setLogoMsg] = useState(null);

  const user = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);
  const showToast = useNotificationStore((s) => s.showToast);
  const [mostrarNomeAoCliente, setMostrarNomeAoCliente] = useState(user?.mostrar_nome_ao_cliente !== false);
  const [mostrarNomeLoading, setMostrarNomeLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    cfg.getUsuarioMe()
      .then((me) => {
        if (!cancelled && me?.mostrar_nome_ao_cliente !== undefined) {
          setMostrarNomeAoCliente(me.mostrar_nome_ao_cliente !== false);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const handleMostrarNomeToggle = async (on) => {
    setMostrarNomeLoading(true);
    try {
      const res = await cfg.patchUsuarioMe({ mostrar_nome_ao_cliente: on });
      setMostrarNomeAoCliente(res?.mostrar_nome_ao_cliente !== false);
      updateUser({ mostrar_nome_ao_cliente: res?.mostrar_nome_ao_cliente });
      showToast?.({ type: "success", title: "Preferência salva", message: "Alteração aplicada às suas mensagens." });
    } catch (e) {
      showToast?.({ type: "error", title: "Erro", message: e?.response?.data?.error || "Não foi possível salvar." });
    } finally {
      setMostrarNomeLoading(false);
    }
  };

  const handleDarkModeToggle = (on) => {
    const theme = on ? "dark" : "light";
    setDarkMode(on);
    applyTheme(theme);
  };

  if (!empresa) return <p className="ia-muted">Carregando...</p>;

  return (
    <div className="config-geral-section">
      <header className="config-geral-header">
        <span className="ia-auto-reply-eyebrow">Administração</span>
        <h4 className="config-geral-title">Configurações gerais</h4>
        <p className="config-geral-lead">Perfil do atendente, aparência da interface e parâmetros operacionais da empresa.</p>
      </header>

      {msg ? (
        <div className={`ia-error-banner ${msg.type === "ok" ? "is-ok" : ""}`} role="alert">
          {msg.text}
          <button type="button" onClick={() => setMsg(null)} aria-label="Fechar">×</button>
        </div>
      ) : null}

      <div className="config-geral-grid">
        <section className="config-geral-card" aria-labelledby="config-geral-perfil">
          <h5 id="config-geral-perfil" className="config-geral-card-title">Meu perfil</h5>
          <div className="config-geral-toggle">
            <div className="config-geral-toggle-text">
              <span className="config-geral-toggle-label">Mostrar meu nome nas mensagens ao cliente</span>
              <span className="config-geral-toggle-hint">
                Quando ativado, o cliente verá seu nome acima das mensagens que você envia no WhatsApp.
              </span>
            </div>
            <Switch
              checked={mostrarNomeAoCliente}
              onChange={handleMostrarNomeToggle}
              disabled={mostrarNomeLoading}
              aria-label="Mostrar nome ao cliente"
            />
          </div>
          <div className="config-geral-card-divider" />
          <PushNotificationsCard />
        </section>

        <section className="config-geral-card" aria-labelledby="config-geral-aparencia">
          <h5 id="config-geral-aparencia" className="config-geral-card-title">Aparência</h5>
          <div className="config-geral-toggle">
            <div className="config-geral-toggle-text">
              <span className="config-geral-toggle-label">Modo escuro</span>
              <span className="config-geral-toggle-hint">Altera apenas cores e contraste da interface neste dispositivo.</span>
            </div>
            <Switch checked={darkMode} onChange={handleDarkModeToggle} aria-label="Modo escuro" />
          </div>
        </section>

        <section className="config-geral-card config-geral-card--wide" aria-labelledby="config-geral-empresa">
          <h5 id="config-geral-empresa" className="config-geral-card-title">Dados da empresa</h5>
          <div className="config-geral-fields">
            <div className="ia-field">
              <label htmlFor="empresa-nome">Nome</label>
              <input
                id="empresa-nome"
                className="ia-input"
                value={v.nome || ""}
                onChange={(e) => setV((c) => ({ ...c, nome: e.target.value }))}
              />
            </div>
            <div className="config-geral-toggle">
              <div className="config-geral-toggle-text">
                <span className="config-geral-toggle-label">Empresa ativa</span>
                <span className="config-geral-toggle-hint">Desligue apenas para suspender o acesso da empresa ao sistema.</span>
              </div>
              <Switch checked={!!v.ativo} onChange={(x) => setV((c) => ({ ...c, ativo: x }))} aria-label="Empresa ativa" />
            </div>
            <div className="config-geral-toggle">
              <div className="config-geral-toggle-text">
                <span className="config-geral-toggle-label">Módulo CRM para a empresa</span>
                <span className="config-geral-toggle-hint">
                  Quando desligado, o botão «Enviar ao CRM» no chat não aparece e as APIs do CRM respondem com acesso negado.
                </span>
              </div>
              <Switch
                checked={v.crm_habilitado !== false}
                onChange={(on) => setV((c) => ({ ...c, crm_habilitado: on }))}
                aria-label="Módulo CRM ativo para a empresa"
              />
            </div>
            <div className="config-geral-toggle">
              <div className="config-geral-toggle-text">
                <span className="config-geral-toggle-label">Separar mensagens disparadas</span>
                <span className="config-geral-toggle-hint">
                  Quando ativado, mensagens enviadas pelo WhatsApp fora do ZapERP (pelo celular ou por campanha) ficam numa aba separada «Mensagens Disparadas» em vez de aparecer em «Abertas».
                </span>
              </div>
              <Switch
                checked={!!v.separar_mensagens_disparadas}
                onChange={(on) => setV((c) => ({ ...c, separar_mensagens_disparadas: on }))}
                aria-label="Separar mensagens disparadas"
              />
            </div>
          </div>
        </section>

        <section className="config-geral-card config-geral-card--wide" aria-labelledby="config-geral-sla">
          <h5 id="config-geral-sla" className="config-geral-card-title">SLA e limites</h5>
          <div className="config-geral-fields config-geral-fields--grid">
            <div className="ia-field">
              <label htmlFor="sla-minutos">Minutos sem resposta para alerta</label>
              <input
                id="sla-minutos"
                type="number"
                className="ia-input"
                min={1}
                max={1440}
                value={v.sla_minutos_sem_resposta ?? 30}
                onChange={(e) => setV((c) => ({ ...c, sla_minutos_sem_resposta: Number(e.target.value) || 30 }))}
              />
            </div>
            <div className="ia-field">
              <label htmlFor="limite-chats">Chats simultâneos por atendente</label>
              <input
                id="limite-chats"
                type="number"
                className="ia-input"
                min={0}
                max={100}
                value={v.limite_chats_por_atendente ?? 10}
                onChange={(e) => setV((c) => ({ ...c, limite_chats_por_atendente: Math.max(0, Number(e.target.value) || 0) }))}
              />
              <span className="config-geral-field-hint">0 = sem limite</span>
            </div>
            <div className="ia-field">
              <label htmlFor="timeout-inatividade">Timeout inatividade (min)</label>
              <input
                id="timeout-inatividade"
                type="number"
                className="ia-input"
                min={0}
                max={10080}
                value={v.timeout_inatividade_min ?? 0}
                onChange={(e) => setV((c) => ({ ...c, timeout_inatividade_min: Math.max(0, Number(e.target.value) || 0) }))}
              />
              <span className="config-geral-field-hint">0 = desativado — fecha conversa sem resposta</span>
            </div>
          </div>
        </section>

        <section className="config-geral-card" aria-labelledby="config-geral-horarios">
          <h5 id="config-geral-horarios" className="config-geral-card-title">Horário comercial</h5>
          <div className="config-geral-fields config-geral-fields--grid2">
            <div className="ia-field">
              <label htmlFor="horario-inicio">Início</label>
              <input
                id="horario-inicio"
                type="time"
                className="ia-input"
                value={v.horario_inicio || "09:00"}
                onChange={(e) => setV((c) => ({ ...c, horario_inicio: e.target.value }))}
              />
            </div>
            <div className="ia-field">
              <label htmlFor="horario-fim">Fim</label>
              <input
                id="horario-fim"
                type="time"
                className="ia-input"
                value={v.horario_fim || "18:00"}
                onChange={(e) => setV((c) => ({ ...c, horario_fim: e.target.value }))}
              />
            </div>
          </div>
        </section>

        <section className="config-geral-card config-geral-card--wide" aria-labelledby="config-geral-tema">
          <h5 id="config-geral-tema" className="config-geral-card-title">Tema e identidade</h5>
          <div className="config-geral-fields config-geral-fields--grid3">
            <div className="ia-field">
              <label htmlFor="empresa-tema">Tema padrão (sistema)</label>
              <select
                id="empresa-tema"
                className="ia-select"
                value={v.tema || "light"}
                onChange={(e) => setV((c) => ({ ...c, tema: e.target.value }))}
              >
                <option value="light">Claro</option>
                <option value="dark">Escuro</option>
              </select>
            </div>
            <div className="ia-field config-geral-field--span2">
              <label>Logo da empresa</label>
              <div className="config-logo-wrap">
                {v.logo_url ? (
                  <div className="config-logo-preview-row">
                    <div className="config-logo-preview-box">
                      <img
                        src={v.logo_url}
                        alt="Logo da empresa"
                        className="config-logo-preview-img"
                        onError={(e) => { e.currentTarget.style.opacity = "0.3"; e.currentTarget.title = "Imagem não encontrada"; }}
                      />
                    </div>
                    <div className="config-logo-preview-info">
                      <span className="config-logo-preview-label">Logo atual</span>
                      <span className="config-logo-preview-url">{v.logo_url}</span>
                    </div>
                  </div>
                ) : (
                  <div className="config-logo-empty">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.5"/>
                      <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/>
                      <path d="M3 15l5-5 4 4 3-3 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <span>Nenhum logo configurado</span>
                    <span className="config-logo-hint">Aparecerá no cabeçalho no lugar do ZapERP</span>
                  </div>
                )}

                {logoMsg && (
                  <div className={`config-logo-msg ${logoMsg.type === "ok" ? "is-ok" : "is-err"}`} role="alert">
                    {logoMsg.text}
                  </div>
                )}

                <div className="config-logo-actions">
                  <label
                    className={`ia-btn ia-btn--outline config-logo-upload-btn${logoUploading ? " is-loading" : ""}`}
                    title="Selecionar imagem (PNG, JPG, WebP — máx. 5 MB)"
                    style={{ cursor: logoUploading ? "default" : "pointer" }}
                  >
                    {logoUploading ? "Enviando…" : v.logo_url ? "Trocar logo" : "Fazer upload do logo"}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      style={{ display: "none" }}
                      disabled={logoUploading}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        if (file.size > 5 * 1024 * 1024) {
                          setLogoMsg({ type: "err", text: "A imagem deve ter no máximo 5 MB." });
                          e.target.value = "";
                          return;
                        }
                        setLogoUploading(true);
                        setLogoMsg(null);
                        try {
                          const result = await cfg.uploadLogoEmpresa(file);
                          setV((c) => ({ ...c, logo_url: result.logo_url }));
                          useEmpresaStore.getState().setLogoUrl(result.logo_url);
                          setLogoMsg({ type: "ok", text: "Logo enviado com sucesso!" });
                        } catch (err) {
                          setLogoMsg({ type: "err", text: err?.response?.data?.error || "Erro ao enviar logo." });
                        } finally {
                          setLogoUploading(false);
                          e.target.value = "";
                        }
                      }}
                    />
                  </label>

                  {v.logo_url && (
                    <button
                      type="button"
                      className="ia-btn ia-btn--ghost"
                      disabled={logoUploading}
                      onClick={async () => {
                        setLogoUploading(true);
                        setLogoMsg(null);
                        try {
                          await cfg.deleteLogoEmpresa();
                          setV((c) => ({ ...c, logo_url: "" }));
                          useEmpresaStore.getState().setLogoUrl(null);
                          setLogoMsg({ type: "ok", text: "Logo removido." });
                        } catch (err) {
                          setLogoMsg({ type: "err", text: err?.response?.data?.error || "Erro ao remover logo." });
                        } finally {
                          setLogoUploading(false);
                        }
                      }}
                    >
                      Remover logo
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div className="ia-field">
              <label htmlFor="empresa-cor">Cor primária</label>
              <div className="config-geral-color-wrap">
                <input
                  id="empresa-cor"
                  type="color"
                  className="config-geral-color-input"
                  value={v.cor_primaria || "#2563eb"}
                  onChange={(e) => setV((c) => ({ ...c, cor_primaria: e.target.value }))}
                />
                <span className="config-geral-color-value">{v.cor_primaria || "#2563eb"}</span>
              </div>
            </div>

            <div className="ia-field config-geral-field--span2">
              <label htmlFor="empresa-fonte">Fonte do nome da empresa</label>
              <select
                id="empresa-fonte"
                className="ia-select"
                value={v.nome_fonte || "inter"}
                onChange={(e) => setV((c) => ({ ...c, nome_fonte: e.target.value }))}
              >
                {FONTES_OPCOES.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
              {/* Prévia ao vivo */}
              <div
                className="config-fonte-preview"
                style={{ fontFamily: FONT_FAMILIES[v.nome_fonte || "inter"] }}
              >
                {v.nome || "Nome da Empresa"}
              </div>
            </div>
          </div>
        </section>

        <section className="config-geral-card config-geral-card--wide" aria-labelledby="config-geral-whatsapp">
          <h5 id="config-geral-whatsapp" className="config-geral-card-title">WhatsApp</h5>
          <p className="config-geral-card-desc">
            Conexão UltraMSG e mapeamento Meta (phone_number_id) para webhook multi-tenant.
          </p>
          <div className="config-geral-whatsapp-connect">
            <div>
              <strong>Conexão UltraMSG / WhatsApp</strong>
              <p className="config-geral-toggle-hint" style={{ marginTop: 4 }}>
                Página dedicada para conectar via QR Code, como no WhatsApp Web.
              </p>
            </div>
            <button type="button" className="ia-btn ia-btn--outline" onClick={() => onOpenConnectWhatsapp?.()}>
              Conectar WhatsApp
            </button>
          </div>
          <div className="config-geral-card-divider" />
          <p className="config-geral-toggle-hint" style={{ marginBottom: 8 }}>
            Mapeamentos Meta (opcional): cadastre o phone_number_id recebido no webhook.
          </p>
          <SecaoEmpresasWhatsapp lista={empresasWhatsapp} onRefresh={onRefresh} />
        </section>
      </div>

      <footer className="config-geral-footer">
        <button
          type="button"
          className="ia-btn ia-btn--primary"
          onClick={async () => {
            setSaving(true);
            setMsg(null);
            try {
              await onSave(v);
              setMsg({ type: "ok", text: "Configurações salvas com sucesso." });
            } catch (e) {
              setMsg({ type: "err", text: e?.response?.data?.error || "Erro ao salvar configurações." });
            } finally {
              setSaving(false);
            }
          }}
          disabled={saving}
        >
          {saving ? "Salvando..." : "Salvar configurações gerais"}
        </button>
      </footer>
    </div>
  );
}

/** Formata departamentos do usuário para exibição (array ou objeto único) */
function formatUserDepartamentos(u) {
  if (!u) return "—";
  const deps = u.departamentos;
  if (Array.isArray(deps) && deps.length > 0) {
    return deps.map((d) => d?.nome).filter(Boolean).join(", ") || "—";
  }
  if (deps?.nome) return deps.nome;
  return "—";
}

function SecaoUsuarios({ usuarios, departamentos, onRefresh, onEdit, onNew, onEditarPermissoes }) {
  return (
    <div className="ia-section">
      <div className="config-headRow">
        <div>
          <h4 style={{ margin: 0 }}>Usuários / Atendentes</h4>
          <p className="ia-muted" style={{ margin: "6px 0 0" }}>
            {usuarios.length} usuário(s). Perfis definem acesso e o setor limita as conversas visíveis.
          </p>
        </div>
        <div className="config-headActions">
          <button className="ia-btn ia-btn--outline" type="button" onClick={onRefresh}>Atualizar</button>
          <button className="ia-btn ia-btn--primary" type="button" onClick={onNew}>Novo usuário</button>
        </div>
      </div>
      <table className="ia-table">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Email</th>
            <th>Perfil</th>
            <th>Setores</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {usuarios.length === 0 ? (
            <tr>
              <td colSpan={6} className="config-emptyCell">
                Nenhum usuário encontrado. Clique em <strong>Novo usuário</strong> para cadastrar o primeiro atendente.
              </td>
            </tr>
          ) : null}
          {usuarios.map((u) => (
            <tr key={u.id}>
              <td>{u.nome}</td>
              <td>{u.email}</td>
              <td>{u.perfil || "atendente"}</td>
              <td><span className="config-departamentos-cell">{formatUserDepartamentos(u)}</span></td>
              <td>{u.ativo ? "Ativo" : "Inativo"}</td>
              <td>
                <button className="ia-btn ia-btn--small ia-btn--outline" onClick={() => onEdit(u)}>Editar</button>
                {onEditarPermissoes && (
                  <button className="ia-btn ia-btn--small ia-btn--outline" onClick={() => onEditarPermissoes(u)} style={{ marginLeft: 6 }}>
                    Permissões
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SecaoEmpresasWhatsapp({ lista, onRefresh }) {
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [saving, setSaving] = useState(false);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!phoneNumberId.trim()) return;
    setSaving(true);
    try {
      await cfg.addEmpresaWhatsapp({ phone_number_id: phoneNumberId.trim(), phone_number: phoneNumber.trim() || null });
      setPhoneNumberId("");
      setPhoneNumber("");
      onRefresh();
    } catch (e) {
      alert(e?.response?.data?.error || "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (id) => {
    if (!confirm("Remover este mapeamento?")) return;
    try {
      await cfg.removeEmpresaWhatsapp(id);
      onRefresh();
    } catch (e) {
      alert(e?.response?.data?.error || "Erro ao remover");
    }
  };

  return (
    <div className="config-whatsapp-mappings">
      <form onSubmit={handleAdd} className="config-whatsapp-mappings-form">
        <input
          className="ia-input"
          value={phoneNumberId}
          onChange={(e) => setPhoneNumberId(e.target.value)}
          placeholder="phone_number_id (ex: 106540352242922)"
          style={{ minWidth: 200 }}
        />
        <input
          className="ia-input"
          value={phoneNumber}
          onChange={(e) => setPhoneNumber(e.target.value)}
          placeholder="Número (opcional)"
          style={{ width: 140 }}
        />
        <button type="submit" className="ia-btn ia-btn--primary" disabled={saving}>{saving ? "Salvando..." : "Adicionar"}</button>
      </form>
      {lista.length > 0 && (
        <ul className="ia-list">
          {lista.map((r) => (
            <li key={r.id} className="ia-list-item">
              <span><code>{r.phone_number_id}</code>{r.phone_number && ` (${r.phone_number})`}</span>
              <button type="button" className="ia-btn ia-btn--small ia-btn--outline" onClick={() => handleRemove(r.id)}>Remover</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SecaoDepartamentos({ departamentos, onRefresh }) {
  const [nome, setNome] = useState("");
  const [editing, setEditing] = useState(null);
  const [editNome, setEditNome] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [grupoModal, setGrupoModal] = useState(null);
  const [gruposLoading, setGruposLoading] = useState(false);
  const [gruposSaving, setGruposSaving] = useState(false);

  const handleCriar = async (e) => {
    e.preventDefault();
    if (!nome.trim()) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      await cfg.criarDepartamento(nome.trim());
      setNome("");
      onRefresh();
    } catch (e) {
      setErrorMsg(e?.response?.data?.error || "Erro ao criar setor.");
    } finally {
      setSaving(false);
    }
  };

  const handleEditar = (d) => {
    setEditing(d.id);
    setEditNome(d.nome);
  };

  const handleSalvarEdicao = async () => {
    if (!editing || !editNome.trim()) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      await cfg.atualizarDepartamento(editing, editNome.trim());
      setEditing(null);
      setEditNome("");
      onRefresh();
    } catch (e) {
      setErrorMsg(e?.response?.data?.error || "Erro ao atualizar setor.");
    } finally {
      setSaving(false);
    }
  };

  const handleExcluir = async (id) => {
    if (!confirm("Excluir este setor? Usuários vinculados precisam ser reatribuídos antes.")) return;
    setErrorMsg(null);
    try {
      await cfg.excluirDepartamento(id);
      onRefresh();
    } catch (e) {
      setErrorMsg(e?.response?.data?.error || "Erro ao excluir setor.");
    }
  };

  const handleAbrirGrupos = async (departamento) => {
    setGrupoModal({ departamento, grupos: [], selecionados: [] });
    setGruposLoading(true);
    setErrorMsg(null);
    try {
      const data = await cfg.getDepartamentoGrupos(departamento.id);
      const grupos = Array.isArray(data?.grupos) ? data.grupos : [];
      setGrupoModal({
        departamento: data?.departamento || departamento,
        grupos,
        selecionados: grupos.filter((g) => g.vinculado).map((g) => Number(g.id)),
      });
    } catch (e) {
      setGrupoModal(null);
      setErrorMsg(e?.response?.data?.error || "Erro ao carregar grupos do setor.");
    } finally {
      setGruposLoading(false);
    }
  };

  const handleToggleGrupo = (grupoId) => {
    const id = Number(grupoId);
    setGrupoModal((curr) => {
      if (!curr) return curr;
      const exists = curr.selecionados.includes(id);
      return {
        ...curr,
        selecionados: exists ? curr.selecionados.filter((x) => x !== id) : [...curr.selecionados, id],
      };
    });
  };

  const handleSalvarGrupos = async () => {
    if (!grupoModal?.departamento?.id) return;
    setGruposSaving(true);
    setErrorMsg(null);
    try {
      await cfg.atualizarDepartamentoGrupos(grupoModal.departamento.id, grupoModal.selecionados);
      setGrupoModal(null);
      onRefresh();
    } catch (e) {
      setErrorMsg(e?.response?.data?.error || "Erro ao salvar grupos do setor.");
    } finally {
      setGruposSaving(false);
    }
  };

  return (
    <div className="ia-section">
      <h4>Departamentos (Setores)</h4>
      <p className="ia-muted">Apenas administradores podem criar e editar setores. Crie setores e atribua aos usuários em Usuários. Atendentes só veem conversas do seu setor.</p>
      {errorMsg && (
        <div className="ia-error-banner" role="alert" style={{ marginBottom: 12 }}>
          {errorMsg}
          <button type="button" onClick={() => setErrorMsg(null)}>×</button>
        </div>
      )}
      <form onSubmit={handleCriar} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input className="ia-input" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do setor (ex: Suporte, Comercial)" style={{ flex: 1, maxWidth: 280 }} />
        <button type="submit" className="ia-btn ia-btn--primary" disabled={saving}>{saving ? "Salvando..." : "Salvar"}</button>
      </form>
      <ul className="ia-list">
        {departamentos.map((d) => (
          <li key={d.id} className="ia-list-item">
            {editing === d.id ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flex: 1 }}>
                <input className="ia-input" value={editNome} onChange={(e) => setEditNome(e.target.value)} placeholder="Nome" style={{ flex: 1, maxWidth: 200 }} autoFocus />
                <button type="button" className="ia-btn ia-btn--primary ia-btn--small" onClick={handleSalvarEdicao} disabled={saving}>Salvar</button>
                <button type="button" className="ia-btn ia-btn--outline ia-btn--small" onClick={() => { setEditing(null); setEditNome(""); }}>Cancelar</button>
              </div>
            ) : (
              <>
                <span>{d.nome}</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="ia-btn ia-btn--small ia-btn--outline" onClick={() => handleAbrirGrupos(d)}>Grupos</button>
                  <button type="button" className="ia-btn ia-btn--small ia-btn--outline" onClick={() => handleEditar(d)}>Editar</button>
                  <button type="button" className="ia-btn ia-btn--small ia-btn--outline" onClick={() => handleExcluir(d.id)}>Excluir</button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      {departamentos.length === 0 && (
        <p className="ia-muted">Nenhum setor cadastrado. Crie o primeiro acima.</p>
      )}
      {grupoModal && (
        <ModalDepartamentoGrupos
          departamento={grupoModal.departamento}
          grupos={grupoModal.grupos}
          selecionados={grupoModal.selecionados}
          loading={gruposLoading}
          saving={gruposSaving}
          onToggle={handleToggleGrupo}
          onClose={() => !gruposSaving && setGrupoModal(null)}
          onSave={handleSalvarGrupos}
        />
      )}
    </div>
  );
}

function ModalDepartamentoGrupos({ departamento, grupos, selecionados, loading, saving, onToggle, onClose, onSave }) {
  const selectedSet = new Set((selecionados || []).map(Number));
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: 520, maxWidth: "92vw", maxHeight: "82vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
        <h4 style={{ margin: "0 0 8px 0" }}>Grupos do setor</h4>
        <p className="ia-muted" style={{ marginTop: 0 }}>{departamento?.nome || "Setor"}</p>
        {loading ? (
          <p className="ia-muted">Carregando grupos...</p>
        ) : grupos.length === 0 ? (
          <p className="ia-muted">Nenhum grupo sincronizado.</p>
        ) : (
          <div className="config-departamentos-multiselect" style={{ maxHeight: 360, overflowY: "auto" }}>
            {grupos.map((g) => {
              const id = Number(g.id);
              const checked = selectedSet.has(id);
              const nome = g.nome_grupo || g.telefone || "Grupo";
              return (
                <label key={g.id} className="config-departamento-checkbox">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={saving}
                    onChange={() => onToggle(id)}
                  />
                  <span>{nome}</span>
                </label>
              );
            })}
          </div>
        )}
        <div className="ia-btn-row" style={{ marginTop: 16 }}>
          <button type="button" className="ia-btn ia-btn--primary" disabled={saving || loading} onClick={onSave}>{saving ? "Salvando..." : "Salvar"}</button>
          <button type="button" className="ia-btn ia-btn--outline" disabled={saving} onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

function SecaoTags({ tags, onRefresh }) {
  const [nome, setNome] = useState("");
  const [cor, setCor] = useState("#6366f1");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [okMsg, setOkMsg] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editNome, setEditNome] = useState("");
  const [editCor, setEditCor] = useState("#6366f1");

  const handleCriar = async (e) => {
    e.preventDefault();
    if (!nome.trim()) return;
    setSaving(true);
    setErrorMsg(null);
    setOkMsg(null);
    try {
      await cfg.criarTag(nome.trim(), cor);
      setNome("");
      setOkMsg("Tag criada com sucesso.");
      onRefresh();
    } catch (e) {
      setErrorMsg(e?.response?.data?.error || "Erro ao criar tag.");
    } finally {
      setSaving(false);
    }
  };

  const handleExcluir = async (id) => {
    if (!confirm("Excluir esta tag?")) return;
    setErrorMsg(null);
    setOkMsg(null);
    try {
      await cfg.excluirTag(id);
      setOkMsg("Tag excluída.");
      onRefresh();
    } catch (e) {
      setErrorMsg(e?.response?.data?.error || "Erro ao excluir tag.");
    }
  };

  const startEdit = (t) => {
    setEditingId(t.id);
    setEditNome(t.nome || "");
    setEditCor(t.cor || "#6366f1");
    setErrorMsg(null);
    setOkMsg(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditNome("");
    setEditCor("#6366f1");
  };

  const handleSalvarEdicao = async () => {
    if (!editingId || !editNome.trim()) return;
    setSaving(true);
    setErrorMsg(null);
    setOkMsg(null);
    try {
      await cfg.atualizarTag(editingId, editNome.trim(), editCor);
      setOkMsg("Tag atualizada.");
      cancelEdit();
      onRefresh();
    } catch (e) {
      setErrorMsg(e?.response?.data?.error || "Erro ao atualizar tag.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ia-section">
      <h4>Tags / Etiquetas</h4>
      <p className="ia-muted">Use tags para organizar conversas e criar filtros (ex.: “Prioridade”, “Cobrança”, “Novo lead”).</p>
      {(errorMsg || okMsg) && (
        <div className={`ia-error-banner ${okMsg ? "is-ok" : ""}`} role="alert" style={{ marginBottom: 12 }}>
          {errorMsg || okMsg}
          <button type="button" onClick={() => { setErrorMsg(null); setOkMsg(null); }}>×</button>
        </div>
      )}
      <form onSubmit={handleCriar} style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <input className="ia-input" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome" style={{ width: 160 }} />
        <input type="color" value={cor} onChange={(e) => setCor(e.target.value)} style={{ width: 48, height: 38, padding: 2, border: "1px solid #e2e8f0", borderRadius: 8 }} />
        <button type="submit" className="ia-btn ia-btn--primary" disabled={saving}>{saving ? "Salvando..." : "Salvar"}</button>
      </form>
      <ul className="ia-list">
        {tags.length === 0 ? (
          <li className="config-emptyRow">
            Nenhuma tag cadastrada. Crie a primeira acima.
          </li>
        ) : null}
        {tags.map((t) => (
          <li key={t.id} className="ia-list-item">
            {editingId === t.id ? (
              <div className="config-inlineEdit">
                <input className="ia-input" value={editNome} onChange={(e) => setEditNome(e.target.value)} placeholder="Nome" style={{ width: 180 }} autoFocus />
                <input type="color" value={editCor} onChange={(e) => setEditCor(e.target.value)} style={{ width: 48, height: 38, padding: 2, border: "1px solid #e2e8f0", borderRadius: 8 }} />
                <div className="config-inlineEditActions">
                  <button type="button" className="ia-btn ia-btn--small ia-btn--primary" onClick={handleSalvarEdicao} disabled={saving}>
                    {saving ? "Salvando…" : "Salvar"}
                  </button>
                  <button type="button" className="ia-btn ia-btn--small ia-btn--outline" onClick={cancelEdit} disabled={saving}>
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 4, background: t.cor || "#94a3b8" }} />
                  {t.nome}
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="ia-btn ia-btn--small ia-btn--outline" type="button" onClick={() => startEdit(t)}>Editar</button>
                  <button className="ia-btn ia-btn--small ia-btn--outline" type="button" onClick={() => handleExcluir(t.id)}>Excluir</button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const LIMITE_RESPOSTAS_ATENDENTE = 5;

function SecaoRespostas({ respostas, departamentos, onRefresh, user }) {
  const [titulo, setTitulo] = useState("");
  const [texto, setTexto] = useState("");
  const [depId, setDepId] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [okMsg, setOkMsg] = useState(null);
  const [filterDepId, setFilterDepId] = useState("");
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [edit, setEdit] = useState({ titulo: "", texto: "", departamento_id: "" });

  // Determina se é atendente (sem acesso à config completa)
  const perfil = String(user?.perfil || "").toLowerCase();
  const isAtendente = perfil !== "admin" && perfil !== "administrador" && perfil !== "supervisor";
  const userId = user?.id != null ? Number(user.id) : null;

  // Conta apenas as respostas que pertencem ao próprio usuário
  const minhasRespostas = useMemo(() => {
    const list = Array.isArray(respostas) ? respostas : [];
    if (userId == null) return list;
    return list.filter((r) => Number(r.usuario_id) === userId);
  }, [respostas, userId]);

  const totalProprias = minhasRespostas.length;
  const limitAtingido = isAtendente && totalProprias >= LIMITE_RESPOSTAS_ATENDENTE;

  const handleCriar = async (e) => {
    e.preventDefault();
    if (!titulo.trim() || !texto.trim()) return;
    if (limitAtingido) return;
    setSaving(true);
    setErrorMsg(null);
    setOkMsg(null);
    try {
      await cfg.criarRespostaSalva({ titulo: titulo.trim(), texto: texto.trim(), departamento_id: depId || null });
      setTitulo("");
      setTexto("");
      setOkMsg("Resposta salva criada.");
      onRefresh();
    } catch (e) {
      setErrorMsg(e?.response?.data?.error || "Erro ao criar resposta salva.");
    } finally {
      setSaving(false);
    }
  };

  const handleExcluir = async (id) => {
    if (!confirm("Excluir esta resposta?")) return;
    setErrorMsg(null);
    setOkMsg(null);
    try {
      await cfg.excluirRespostaSalva(id);
      setOkMsg("Resposta removida.");
      onRefresh();
    } catch (e) {
      setErrorMsg(e?.response?.data?.error || "Erro ao excluir resposta.");
    }
  };

  const startEdit = (r) => {
    setEditingId(r.id);
    setEdit({
      titulo: r.titulo || "",
      texto: r.texto || "",
      departamento_id: r.departamento_id != null ? String(r.departamento_id) : "",
    });
    setErrorMsg(null);
    setOkMsg(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEdit({ titulo: "", texto: "", departamento_id: "" });
  };

  const handleSalvarEdicao = async () => {
    if (!editingId || !edit.titulo.trim() || !edit.texto.trim()) return;
    setSaving(true);
    setErrorMsg(null);
    setOkMsg(null);
    try {
      await cfg.atualizarRespostaSalva(editingId, {
        titulo: edit.titulo.trim(),
        texto: edit.texto.trim(),
        departamento_id: edit.departamento_id || null,
      });
      setOkMsg("Resposta salva atualizada.");
      cancelEdit();
      onRefresh();
    } catch (e) {
      setErrorMsg(e?.response?.data?.error || "Erro ao atualizar resposta salva.");
    } finally {
      setSaving(false);
    }
  };

  const copyToClipboard = async (t) => {
    try {
      await navigator.clipboard.writeText(String(t || ""));
      setOkMsg("Copiado para a área de transferência.");
    } catch {
      setErrorMsg("Não foi possível copiar.");
    }
  };

  const filtered = useMemo(() => {
    const list = Array.isArray(respostas) ? respostas : [];
    const q = String(query || "").trim().toLowerCase();
    return list.filter((r) => {
      if (filterDepId && String(r.departamento_id || "") !== String(filterDepId)) return false;
      if (!q) return true;
      const t = `${r.titulo || ""} ${r.texto || ""}`.toLowerCase();
      return t.includes(q);
    });
  }, [respostas, filterDepId, query]);

  return (
    <div className="ia-section">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 4 }}>
        <h4 style={{ margin: 0 }}>Respostas salvas</h4>
        {isAtendente && (
          <span
            className={`config-respostas-counter${limitAtingido ? " config-respostas-counter--cheio" : totalProprias >= LIMITE_RESPOSTAS_ATENDENTE - 1 ? " config-respostas-counter--alerta" : ""}`}
            title={limitAtingido ? "Limite atingido. Exclua uma resposta para criar outra." : `Você usou ${totalProprias} de ${LIMITE_RESPOSTAS_ATENDENTE} respostas salvas`}
          >
            {totalProprias}/{LIMITE_RESPOSTAS_ATENDENTE} respostas salvas
          </span>
        )}
      </div>
      <div className="ia-callout ia-callout--info ia-respostas-salvas-callout" role="note">
        <div className="ia-callout-icon ia-callout-icon--info" aria-hidden="true">/</div>
        <div className="ia-callout-body">
          <p className="ia-callout-title">Para o atalho <kbd>/</kbd> no atendimento</p>
          <p className="ia-callout-text">
            Cadastre modelos para inserir na conversa com o atalho <kbd>/</kbd> (o cliente não recebe automaticamente).
            {isAtendente
              ? <> Você pode salvar até <strong>{LIMITE_RESPOSTAS_ATENDENTE} respostas</strong> pessoais.</>
              : <> Com setor <strong>Todos</strong>, a resposta fica disponível para todos os atendentes da empresa.</>
            }
            {" "}Não confundir com <Link to="/ia?tab=respostas" className="ia-callout-link">IA → Respostas automáticas</Link> do bot.
          </p>
        </div>
      </div>
      {!isAtendente && (
        <p className="ia-muted">Setor &quot;Todos&quot; compartilha com toda a empresa. Setor específico limita a resposta ao seu usuário naquele setor.</p>
      )}
      {(errorMsg || okMsg) && (
        <div className={`ia-error-banner ${okMsg ? "is-ok" : ""}`} role="alert" style={{ marginBottom: 12 }}>
          {errorMsg || okMsg}
          <button type="button" onClick={() => { setErrorMsg(null); setOkMsg(null); }}>×</button>
        </div>
      )}

      {limitAtingido ? (
        <div className="ia-callout ia-callout--warn" role="alert" style={{ marginBottom: 16 }}>
          <div className="ia-callout-icon" aria-hidden="true">⚠️</div>
          <div className="ia-callout-body">
            <p className="ia-callout-title">Limite atingido ({LIMITE_RESPOSTAS_ATENDENTE}/{LIMITE_RESPOSTAS_ATENDENTE})</p>
            <p className="ia-callout-text">Você atingiu o limite de {LIMITE_RESPOSTAS_ATENDENTE} respostas salvas. Exclua uma existente para poder criar uma nova.</p>
          </div>
        </div>
      ) : (
        <form onSubmit={handleCriar}>
          <div className="ia-field">
            <label>Título</label>
            <input className="ia-input" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Saudação inicial, Prazo de entrega…" />
          </div>
          <div className="ia-field">
            <label>Texto</label>
            <textarea className="ia-textarea" value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} placeholder="Texto que será inserido na conversa ao usar o atalho /" />
          </div>
          {!isAtendente && (
            <div className="ia-field">
              <label>Setor (opcional)</label>
              <select className="ia-select" value={depId} onChange={(e) => setDepId(e.target.value)}>
                <option value="">Todos</option>
                {departamentos.map((d) => <option key={d.id} value={d.id}>{d.nome}</option>)}
              </select>
            </div>
          )}
          <button type="submit" className="ia-btn ia-btn--primary" disabled={saving || !titulo.trim() || !texto.trim()}>
            {saving ? "Salvando..." : "Salvar resposta"}
          </button>
        </form>
      )}

      <div className="config-toolbar" style={{ marginTop: 18 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {!isAtendente && (
            <label className="config-inlineLabel">
              Setor:
              <select className="ia-select" value={filterDepId} onChange={(e) => setFilterDepId(e.target.value)} style={{ marginLeft: 8, minWidth: 180 }}>
                <option value="">Todos</option>
                {departamentos.map((d) => <option key={d.id} value={d.id}>{d.nome}</option>)}
              </select>
            </label>
          )}
          <input
            className="ia-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por título ou texto…"
            style={{ minWidth: 240 }}
          />
          <span className="ia-muted">{filtered.length} resultado(s)</span>
        </div>
      </div>

      <ul className="ia-list" style={{ marginTop: 12 }}>
        {filtered.length === 0 ? (
          <li className="config-emptyRow">
            {isAtendente && totalProprias === 0
              ? "Você ainda não tem respostas salvas. Crie sua primeira resposta acima."
              : "Nenhuma resposta salva encontrada para este filtro."}
          </li>
        ) : null}
        {filtered.map((r) => {
          const snippet = String(r.texto || "").trim().slice(0, 140);
          const depNome = r.departamentos?.nome ? String(r.departamentos.nome) : null;
          const isPropriaDoUsuario = userId != null && Number(r.usuario_id) === userId;
          return (
            <li key={r.id} className="ia-list-item">
              {editingId === r.id ? (
                <div style={{ width: "100%" }}>
                  <div className="config-inlineEdit" style={{ alignItems: "flex-start" }}>
                    <div style={{ flex: 1, minWidth: 240 }}>
                      <div className="ia-field" style={{ marginBottom: 10 }}>
                        <label>Título</label>
                        <input className="ia-input" value={edit.titulo} onChange={(e) => setEdit((c) => ({ ...c, titulo: e.target.value }))} />
                      </div>
                      <div className="ia-field" style={{ marginBottom: 10 }}>
                        <label>Texto</label>
                        <textarea className="ia-textarea" rows={3} value={edit.texto} onChange={(e) => setEdit((c) => ({ ...c, texto: e.target.value }))} />
                      </div>
                      {!isAtendente && (
                        <div className="ia-field" style={{ marginBottom: 0 }}>
                          <label>Setor (opcional)</label>
                          <select className="ia-select" value={edit.departamento_id} onChange={(e) => setEdit((c) => ({ ...c, departamento_id: e.target.value }))}>
                            <option value="">Todos</option>
                            {departamentos.map((d) => <option key={d.id} value={d.id}>{d.nome}</option>)}
                          </select>
                        </div>
                      )}
                    </div>
                    <div className="config-inlineEditActions">
                      <button type="button" className="ia-btn ia-btn--small ia-btn--primary" onClick={handleSalvarEdicao} disabled={saving}>
                        {saving ? "Salvando…" : "Salvar"}
                      </button>
                      <button type="button" className="ia-btn ia-btn--small ia-btn--outline" onClick={cancelEdit} disabled={saving}>
                        Cancelar
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                      <strong>{r.titulo}</strong>
                      {!isAtendente && (
                        depNome ? <span className="config-pill">{depNome}</span> : <span className="config-pill config-pill--muted">Global</span>
                      )}
                      {isAtendente && !isPropriaDoUsuario && (
                        <span className="config-pill config-pill--muted">Empresa</span>
                      )}
                    </div>
                    <div className="ia-muted" style={{ marginTop: 6 }}>
                      {snippet}{String(r.texto || "").length > 140 ? "…" : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button className="ia-btn ia-btn--small ia-btn--outline" type="button" onClick={() => copyToClipboard(r.texto)} title="Copiar texto">
                      Copiar
                    </button>
                    {isPropriaDoUsuario && (
                      <>
                        <button className="ia-btn ia-btn--small ia-btn--outline" type="button" onClick={() => startEdit(r)} title="Editar">
                          Editar
                        </button>
                        <button className="ia-btn ia-btn--small ia-btn--outline" type="button" onClick={() => handleExcluir(r.id)} title="Excluir">
                          Excluir
                        </button>
                      </>
                    )}
                    {!isPropriaDoUsuario && !isAtendente && (
                      <>
                        <button className="ia-btn ia-btn--small ia-btn--outline" type="button" onClick={() => startEdit(r)} title="Editar">
                          Editar
                        </button>
                        <button className="ia-btn ia-btn--small ia-btn--outline" type="button" onClick={() => handleExcluir(r.id)} title="Excluir">
                          Excluir
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SecaoClientes({ clientes, clientesTotal, onRefresh, onSyncContacts, onSearchClientes, onLoadMoreClientes, loadingMoreClientes, empresa, onUpdateEmpresa, tags }) {
  const navigate = useNavigate();
  const addChat = useChatStore((s) => s.addChat);
  const setSelectedId = useConversaStore((s) => s.setSelectedId);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [syncingFotos, setSyncingFotos] = useState(false);
  const [syncFotosResult, setSyncFotosResult] = useState(null);
  const [autoSyncSaving, setAutoSyncSaving] = useState(false);
  const [busca, setBusca] = useState("");
  const [searching, setSearching] = useState(false);
  const [abrindoId, setAbrindoId] = useState(null);
  const [excluindoId, setExcluindoId] = useState(null);
  const [excluindoTodos, setExcluindoTodos] = useState(false);
  const [clienteModal, setClienteModal] = useState(null); // { mode: "new"|"edit", data }
  useEffect(() => {
    if (!onSearchClientes) return;
    const t = setTimeout(() => {
      setSearching(true);
      onSearchClientes(busca.trim() ? { palavra: busca.trim() } : {}).finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [busca, onSearchClientes]);

  // ✅ auto-refresh quando o backend terminar o sync on-connect (Socket → CustomEvent)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (ev) => {
      const detail = ev?.detail;
      if (!detail) return;
      setSyncResult(detail);
      onSyncContacts?.();
    };
    window.addEventListener("zapi_sync_contatos", handler);
    return () => window.removeEventListener("zapi_sync_contatos", handler);
  }, [onSyncContacts]);

  const autoSyncValue = empresa?.zapi_auto_sync_contatos ?? true;
  const handleToggleAutoSync = async (next) => {
    if (!onUpdateEmpresa) return;
    setAutoSyncSaving(true);
    try {
      await onUpdateEmpresa({ zapi_auto_sync_contatos: !!next });
    } catch (e) {
      alert(e.response?.data?.error || e.message || "Erro ao salvar preferência.");
    } finally {
      setAutoSyncSaving(false);
    }
  };

  const handleSincronizarContatos = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await chatService.sincronizarContatos();
      if (res?.ok === false) {
        setSyncResult({ error: res.message || "Erro ao sincronizar. Verifique a configuração do UltraMSG em Integrações." });
        return;
      }
      setSyncResult(res);
      onSyncContacts?.();
    } catch (e) {
      setSyncResult({ error: e.response?.data?.error || e.message || "Erro ao sincronizar" });
    } finally {
      setSyncing(false);
    }
  };

  const handleSincronizarFotosPerfil = async () => {
    setSyncingFotos(true);
    setSyncFotosResult(null);
    try {
      const res = await chatService.sincronizarFotosPerfil();
      setSyncFotosResult(res);
      onRefresh?.();
    } catch (e) {
      setSyncFotosResult({ error: e.response?.data?.error || e.message || "Erro ao sincronizar fotos." });
    } finally {
      setSyncingFotos(false);
    }
  };

  const handleAbrirConversa = async (cliente) => {
    if (!cliente?.id || !cliente?.telefone) return;
    setAbrindoId(cliente.id);
    try {
      const { conversa } = await chatService.abrirConversaCliente(cliente.id);
      if (conversa?.id) {
        addChat(conversa);
        setSelectedId(conversa.id);
        navigate("/atendimento");
      }
    } catch (e) {
      console.error("Erro ao abrir conversa:", e);
    } finally {
      setAbrindoId(null);
    }
  };

  const handleExcluirCliente = async (cliente) => {
    if (!cliente?.id) return;
    const nome = cliente.nome || cliente.telefone || "Cliente";
    if (!window.confirm(`Excluir o cliente "${nome}"? As conversas continuarão, mas sem vínculo com este cadastro.`)) return;
    setExcluindoId(cliente.id);
    try {
      await cfg.excluirCliente(cliente.id);
      onRefresh?.();
    } catch (e) {
      console.error("Erro ao excluir cliente:", e);
      alert(e.response?.data?.erro || e.message || "Erro ao excluir cliente.");
    } finally {
      setExcluindoId(null);
    }
  };

  const handleApagarTodosClientes = async () => {
    if ((Number(clientesTotal) || 0) === 0 && !busca.trim()) {
      alert("Não há clientes para apagar.");
      return;
    }
    const msg = busca.trim()
      ? "Apagar TODOS os clientes desta empresa? (inclusive os que não aparecem na busca atual). As conversas continuarão sem vínculo. Esta ação não pode ser desfeita."
      : `Apagar TODOS os ${Number(clientesTotal) || 0} cliente(s)? As conversas continuarão sem vínculo. Esta ação não pode ser desfeita.`;
    if (!window.confirm(msg)) return;
    setExcluindoTodos(true);
    try {
      const res = await cfg.excluirTodosClientes();
      alert(res?.mensagem || `${res?.apagados ?? 0} cliente(s) apagado(s).`);
      onRefresh?.();
    } catch (e) {
      console.error("Erro ao apagar todos os clientes:", e);
      alert(e.response?.data?.erro || e.message || "Erro ao apagar clientes.");
    } finally {
      setExcluindoTodos(false);
    }
  };

  const avatarUrl = (c) => {
    const url = c?.foto_perfil;
    if (!url || !String(url).trim().startsWith("http")) return null;
    return String(url).trim();
  };

  return (
    <div className="ia-section">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h4 style={{ margin: 0 }}>Clientes</h4>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            className="ia-btn ia-btn--primary"
            onClick={() => setClienteModal({ mode: "new", data: null })}
          >
            Novo cliente
          </button>
          <button
            type="button"
            className="ia-btn ia-btn--outline"
            style={{ color: "#dc2626", borderColor: "#dc2626" }}
            disabled={excluindoTodos || ((Number(clientesTotal) || 0) === 0 && !busca.trim())}
            onClick={handleApagarTodosClientes}
          >
            {excluindoTodos ? "Apagando…" : "Apagar todos os clientes"}
          </button>
        </div>
      </div>
      <div className="ia-field" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <p className="ia-muted" style={{ margin: 0 }}>
            Importe nomes e fotos de perfil da agenda do celular via UltraMSG.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="ia-muted">Auto-sync ao conectar</span>
            <Switch
              checked={!!autoSyncValue}
              onChange={(v) => {
                if (autoSyncSaving) return;
                handleToggleAutoSync(v);
              }}
            />
          </div>
        </div>
        {autoSyncSaving && (
          <p className="ia-muted" style={{ marginTop: 8 }}>
            Salvando preferência…
          </p>
        )}
        <button
          type="button"
          className="ia-btn ia-btn--primary"
          disabled={syncing}
          onClick={handleSincronizarContatos}
        >
          {syncing ? "Sincronizando…" : "Sincronizar contatos do celular"}
        </button>
        {syncResult && (
          <p className="ia-muted" style={{ marginTop: 8 }}>
            {syncResult.error
              ? syncResult.error
              : syncResult.job_id
                ? (syncResult.mensagem || "Sincronização enfileirada.")
                : `OK: ${syncResult.total_contatos ?? 0} contatos; ${syncResult.criados ?? 0} novos, ${syncResult.atualizados ?? 0} atualizados.${syncResult.fotos_atualizadas ? ` ${syncResult.fotos_atualizadas} fotos atualizadas.` : ""}`}
          </p>
        )}
      </div>
      <div className="ia-field" style={{ marginBottom: 16 }}>
        <p className="ia-muted">Atualize as fotos de perfil de todos os clientes a partir do WhatsApp (UltraMSG).</p>
        <button
          type="button"
          className="ia-btn ia-btn--outline"
          disabled={syncingFotos}
          onClick={handleSincronizarFotosPerfil}
        >
          {syncingFotos ? "Sincronizando fotos…" : "Sincronizar fotos de perfil"}
        </button>
        {syncFotosResult && (
          <p className="ia-muted" style={{ marginTop: 8 }}>
            {syncFotosResult.error
              ? syncFotosResult.error
              : syncFotosResult.job_id
                ? (syncFotosResult.mensagem || "Sincronização de fotos enfileirada.")
                : `OK: ${syncFotosResult.total ?? 0} clientes; ${syncFotosResult.atualizados ?? 0} fotos atualizadas.`}
          </p>
        )}
      </div>
      <div className="ia-field" style={{ marginBottom: 12 }}>
        <label className="ia-label">Pesquisar por nome ou telefone</label>
        <input
          type="search"
          className="ia-input"
          placeholder="Digite nome ou telefone..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          style={{ maxWidth: 320 }}
        />
        {searching && <span className="ia-muted" style={{ marginLeft: 8 }}>Buscando…</span>}
      </div>
      <p className="ia-muted">
        {Number(clientesTotal) || 0} cliente(s) {busca.trim() ? "encontrado(s)." : "cadastrado(s)."} — conectado à tabela <code>clientes</code> do banco.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table className="ia-table">
          <thead>
            <tr>
              <th style={{ width: 52 }}></th>
              <th>Nome</th>
              <th>Telefone</th>
              <th>Email</th>
              <th>Empresa</th>
              <th>Observações</th>
              <th style={{ width: 200 }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {clientes.map((c) => {
              const url = avatarUrl(c);
              const iniciais = [c.nome, c.telefone].filter(Boolean)[0]
                ? String(c.nome || c.telefone || "").trim().slice(0, 2).toUpperCase()
                : "—";
              const abrindo = abrindoId === c.id;
              return (
                <tr key={c.id}>
                  <td>
                    <div style={{ position: "relative", width: 36, height: 36 }}>
                      <span
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: "50%",
                          background: "#e2e8f0",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 12,
                          color: "#64748b",
                        }}
                      >
                        {iniciais}
                      </span>
                      {url && (
                        <img
                          src={url}
                          alt=""
                          style={{
                            position: "absolute",
                            left: 0,
                            top: 0,
                            width: 36,
                            height: 36,
                            borderRadius: "50%",
                            objectFit: "cover",
                          }}
                          onError={(e) => { e.target.style.display = "none"; }}
                        />
                      )}
                    </div>
                  </td>
                  <td>{c.nome || "—"}</td>
                  <td>{c.telefone}</td>
                  <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{c.email || "—"}</td>
                  <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{c.empresa || "—"}</td>
                  <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{c.observacoes || "—"}</td>
                  <td>
                    <div className="ia-btn-row" style={{ gap: 8, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="ia-btn ia-btn--small ia-btn--primary"
                        disabled={abrindo || !c.telefone}
                        onClick={() => handleAbrirConversa(c)}
                      >
                        {abrindo ? "Abrindo…" : "Conversar"}
                      </button>
                      <button
                        type="button"
                        className="ia-btn ia-btn--small ia-btn--outline"
                        onClick={() => setClienteModal({ mode: "edit", data: c })}
                        title="Editar cliente"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="ia-btn ia-btn--small ia-btn--outline"
                        disabled={excluindoId === c.id}
                        onClick={() => handleExcluirCliente(c)}
                        title="Excluir cliente"
                      >
                        {excluindoId === c.id ? "Excluindo…" : "Excluir"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!busca.trim() && clientes.length < (Number(clientesTotal) || 0) ? (
        <div className="ia-btn-row" style={{ justifyContent: "center", marginTop: 12 }}>
          <button
            type="button"
            className="ia-btn ia-btn--outline"
            onClick={onLoadMoreClientes}
            disabled={loadingMoreClientes}
          >
            {loadingMoreClientes
              ? "Carregando..."
              : `Carregar mais clientes (${clientes.length} de ${clientesTotal})`}
          </button>
        </div>
      ) : null}
      {clienteModal ? (
        <ModalCliente
          mode={clienteModal.mode}
          cliente={clienteModal.data}
          allTags={tags}
          onClose={() => setClienteModal(null)}
          onSaved={() => { setClienteModal(null); onRefresh?.(); }}
        />
      ) : null}
    </div>
  );
}

function SecaoPlanos({ planos }) {
  return (
    <div className="ia-section">
      <h4>Planos</h4>
      <p className="ia-muted">Limites de atendentes, conversas e mensagens.</p>
      <table className="ia-table">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Atendentes</th>
            <th>Conversas</th>
            <th>Mensagens</th>
          </tr>
        </thead>
        <tbody>
          {planos.map((p) => (
            <tr key={p.id}>
              <td>{p.nome || "—"}</td>
              <td>{p.limite_atendentes ?? "—"}</td>
              <td>{p.limite_conversas ?? "—"}</td>
              <td>{p.limite_mensagens ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SecaoAuditoria({ auditoria, onRefresh }) {
  return (
    <div className="ia-section">
      <h4>Logs / Auditoria</h4>
      <button className="ia-btn ia-btn--outline" onClick={onRefresh} style={{ marginBottom: 12 }}>Atualizar</button>
      <div style={{ maxHeight: 400, overflowY: "auto" }}>
        {auditoria.map((a, i) => (
          <div key={a.tipo + "-" + a.id + "-" + i} className="ia-log-item" style={{ padding: "8px 0", borderBottom: "1px solid #e2e8f0" }}>
            <strong>{a.acao}</strong> — {a.usuario_nome || a.para_nome || "Sistema"} — {a.observacao || ""} — {a.criado_em ? new Date(a.criado_em).toLocaleString("pt-BR") : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Normaliza departamento_ids do usuário para array de números */
function normalizeDepartamentoIds(u) {
  if (!u) return [];
  const ids = u.departamento_ids;
  if (Array.isArray(ids)) return ids.map((id) => Number(id)).filter((n) => !Number.isNaN(n));
  if (u.departamento_id != null) return [Number(u.departamento_id)];
  if (Array.isArray(u.departamentos)) return u.departamentos.map((d) => Number(d?.id)).filter((n) => !Number.isNaN(n));
  return [];
}

function ModalUsuario({ usuario, departamentos, onClose, onSaved }) {
  const isNew = !usuario?.id;
  const [nome, setNome] = useState(usuario?.nome || "");
  const [email, setEmail] = useState(usuario?.email || "");
  const [senha, setSenha] = useState("");
  const [perfil, setPerfil] = useState(usuario?.perfil || "atendente");
  const [departamento_ids, setDepartamento_ids] = useState(() => normalizeDepartamentoIds(usuario));
  const [ativo, setAtivo] = useState(usuario?.ativo !== false);

  useEffect(() => {
    if (usuario) {
      setNome(usuario.nome || "");
      setEmail(usuario.email || "");
      setSenha("");
      setPerfil(usuario.perfil || "atendente");
      setDepartamento_ids(normalizeDepartamentoIds(usuario));
      setAtivo(usuario.ativo !== false);
    }
  }, [usuario?.id, usuario?.nome, usuario?.email, usuario?.perfil, usuario?.departamento_id, usuario?.departamento_ids, usuario?.departamentos, usuario?.ativo]);
  const [saving, setSaving] = useState(false);
  const [showSenha, setShowSenha] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!nome.trim() || !email.trim()) return;
    if (isNew && !senha.trim()) {
      alert("Senha é obrigatória para novo usuário");
      return;
    }
    setSaving(true);
    try {
      const payload = { nome: nome.trim(), email: email.trim(), perfil, departamento_ids: departamento_ids, ativo };
      if (isNew) {
        payload.senha = senha.trim();
        await cfg.criarUsuario(payload);
      } else {
        await cfg.atualizarUsuario(usuario.id, { nome: payload.nome, email: payload.email, perfil, departamento_ids: payload.departamento_ids, ativo: payload.ativo });
        if (senha.trim()) await cfg.redefinirSenha(usuario.id, senha.trim());
      }
      onSaved();
    } catch (e) {
      alert(e?.response?.data?.error || "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: 400, maxWidth: "90vw" }} onClick={(e) => e.stopPropagation()}>
        <h4 style={{ margin: "0 0 16px 0" }}>{isNew ? "Novo usuário" : "Editar usuário"}</h4>
        <form onSubmit={handleSubmit}>
          <div className="ia-field">
            <label>Nome</label>
            <input className="ia-input" value={nome} onChange={(e) => setNome(e.target.value)} required />
          </div>
          <div className="ia-field">
            <label>Email</label>
            <input type="email" className="ia-input" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={!isNew} />
          </div>
          <div className="ia-field">
            <label>{isNew ? "Senha" : "Nova senha (deixe em branco para manter)"}</label>
            <input type={showSenha ? "text" : "password"} className="ia-input" value={senha} onChange={(e) => setSenha(e.target.value)} required={isNew} />
          </div>
          <div className="ia-field">
            <label>Perfil</label>
            <select className="ia-select" value={perfil} onChange={(e) => setPerfil(e.target.value)}>
              <option value="admin">Admin</option>
              <option value="supervisor">Supervisor</option>
              <option value="atendente">Atendente</option>
            </select>
          </div>
          <div className="ia-field">
            <label>Setores (Departamentos)</label>
            <div className="config-departamentos-multiselect">
              {departamentos.map((d) => {
                const depId = Number(d.id);
                const checked = departamento_ids.includes(depId);
                return (
                  <label key={d.id} className="config-departamento-checkbox">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setDepartamento_ids((prev) =>
                          checked ? prev.filter((id) => id !== depId) : [...prev, depId]
                        );
                      }}
                    />
                    <span>{d.nome}</span>
                  </label>
                );
              })}
            </div>
            {departamentos.length === 0 && (
              <p className="ia-muted" style={{ fontSize: 12, marginTop: 4 }}>Cadastre departamentos na aba Departamentos.</p>
            )}
            <span className="ia-muted" style={{ fontSize: 12, marginTop: 4, display: "block" }}>Atendentes só veem conversas dos setores selecionados. Efeito no próximo login.</span>
          </div>
          {!isNew && (
            <div className="ia-checkbox-row">
              <input type="checkbox" id="ativo" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
              <label htmlFor="ativo">Ativo</label>
            </div>
          )}
          <div className="ia-btn-row" style={{ marginTop: 16 }}>
            <button type="submit" className="ia-btn ia-btn--primary" disabled={saving}>{saving ? "Salvando..." : "Salvar"}</button>
            <button type="button" className="ia-btn ia-btn--outline" onClick={onClose}>Cancelar</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ModalCliente({ mode, cliente, onClose, onSaved, allTags = [] }) {
  const isNew = mode === "new";
  const [nome, setNome] = useState(cliente?.nome || "");
  const [telefone, setTelefone] = useState(cliente?.telefone || "");
  const [email, setEmail] = useState(cliente?.email || "");
  const [empresa, setEmpresa] = useState(cliente?.empresa || "");
  const [observacoes, setObservacoes] = useState(cliente?.observacoes || "");
  const [tagIds, setTagIds] = useState([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [tagBusyId, setTagBusyId] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setNome(cliente?.nome || "");
    setTelefone(cliente?.telefone || "");
    setEmail(cliente?.email || "");
    setEmpresa(cliente?.empresa || "");
    setObservacoes(cliente?.observacoes || "");
    setTagIds([]);
  }, [cliente?.id]);

  useEffect(() => {
    if (isNew || !cliente?.id) return;
    setTagsLoading(true);
    cfg.getClienteTags(cliente.id)
      .then((list) => {
        const ids = (Array.isArray(list) ? list : []).map((t) => String(t.id));
        setTagIds(ids);
      })
      .catch(() => setTagIds([]))
      .finally(() => setTagsLoading(false));
  }, [isNew, cliente?.id]);

  const toggleTag = async (tag) => {
    if (!cliente?.id || !tag?.id || tagBusyId) return;
    const tid = String(tag.id);
    const has = tagIds.includes(tid);
    setTagBusyId(tid);
    try {
      if (has) {
        await cfg.removeClienteTag(cliente.id, tag.id);
        setTagIds((cur) => (cur || []).filter((x) => x !== tid));
      } else {
        await cfg.addClienteTag(cliente.id, tag.id);
        setTagIds((cur) => [...new Set([...(cur || []), tid])]);
      }
    } catch (e) {
      const msg = e?.response?.data?.erro || e?.response?.data?.error || e?.message || "Erro ao atualizar tags do cliente.";
      alert(msg);
    } finally {
      setTagBusyId(null);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (isNew) {
        if (!String(telefone || "").trim()) {
          alert("Telefone é obrigatório para criar cliente.");
          return;
        }
        await cfg.criarCliente({
          telefone: String(telefone || "").trim(),
          nome: String(nome || "").trim() || null,
          email: String(email || "").trim() || null,
          empresa: String(empresa || "").trim() || null,
          observacoes: String(observacoes || "").trim() || null,
        });
      } else {
        if (!String(telefone || "").trim()) {
          alert("Telefone é obrigatório.");
          return;
        }
        await cfg.atualizarCliente(cliente.id, {
          telefone: String(telefone || "").trim(),
          nome: String(nome || "").trim() || null,
          email: String(email || "").trim() || null,
          empresa: String(empresa || "").trim() || null,
          observacoes: String(observacoes || "").trim() || null,
        });
      }
      onSaved?.();
    } catch (e) {
      const msg = e?.response?.data?.erro || e?.response?.data?.error || e?.message || "Erro ao salvar cliente.";
      alert(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
      onClick={onClose}
    >
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: 440, maxWidth: "92vw" }} onClick={(e) => e.stopPropagation()}>
        <h4 style={{ margin: "0 0 16px 0" }}>{isNew ? "Novo cliente" : "Editar cliente"}</h4>
        <form onSubmit={handleSubmit}>
          <div className="ia-field">
            <label>Nome</label>
            <input className="ia-input" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do cliente (opcional)" />
          </div>
          <div className="ia-field">
            <label>Telefone</label>
            <input
              className="ia-input"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              placeholder="+55 11 99999-9999"
              required
            />
          </div>
          <div className="ia-field">
            <label>Email</label>
            <input
              className="ia-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@empresa.com (opcional)"
              inputMode="email"
              autoComplete="email"
            />
          </div>
          <div className="ia-field">
            <label>Empresa</label>
            <input className="ia-input" value={empresa} onChange={(e) => setEmpresa(e.target.value)} placeholder="Nome da empresa (opcional)" />
          </div>
          <div className="ia-field">
            <label>Observações</label>
            <textarea className="ia-textarea" value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={3} placeholder="Observações internas sobre o cliente..." />
          </div>
          {!isNew ? (
            <div className="ia-field">
              <label>Tags do contato</label>
              <div className="ia-muted" style={{ fontSize: 12, marginBottom: 8 }}>
                {tagsLoading ? "Carregando tags..." : "Clique para adicionar/remover tags deste contato."}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {(Array.isArray(allTags) ? allTags : []).length === 0 ? (
                  <span className="ia-muted" style={{ fontSize: 12 }}>Nenhuma tag cadastrada (Configurações → Tags).</span>
                ) : (
                  (allTags || []).map((t) => {
                    const on = tagIds.includes(String(t.id));
                    const busy = tagBusyId === String(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        className={`ia-btn ia-btn--small ${on ? "ia-btn--primary" : "ia-btn--outline"}`}
                        style={on ? { background: t.cor || undefined, borderColor: t.cor || undefined } : undefined}
                        onClick={() => toggleTag(t)}
                        disabled={busy || tagsLoading}
                        title={on ? "Remover tag" : "Adicionar tag"}
                      >
                        {t.nome}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          ) : null}
          <div className="ia-btn-row" style={{ marginTop: 16 }}>
            <button type="submit" className="ia-btn ia-btn--primary" disabled={saving}>
              {saving ? "Salvando..." : "Salvar"}
            </button>
            <button type="button" className="ia-btn ia-btn--outline" onClick={onClose} disabled={saving}>
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
