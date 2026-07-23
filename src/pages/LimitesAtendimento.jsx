import { useEffect, useMemo, useState } from "react";
import Switch from "../components/ui/Switch";
import * as cfg from "../api/configService";

const DAY_OPTIONS = [
  { value: 0, label: "Dom" },
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sab" },
];

const RULES = [
  ["messages_per_hour", "Novas mensagens por hora", "mensagens"],
  ["messages_per_day", "Novas mensagens por dia", "mensagens"],
  ["new_conversations_per_hour", "Novas conversas por hora", "conversas"],
  ["new_conversations_per_day", "Novas conversas por dia", "conversas"],
  ["message_interval_seconds", "Intervalo minimo entre mensagens", "seg"],
  ["new_conversation_interval_seconds", "Intervalo minimo entre novas conversas", "seg"],
  ["consecutive_without_reply", "Mensagens consecutivas sem resposta", "mensagens"],
];

function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config || {}));
}

function defaultConfig(base) {
  return {
    messages_per_hour_enabled: false,
    messages_per_hour: "",
    messages_per_day_enabled: false,
    messages_per_day: "",
    new_conversations_per_hour_enabled: false,
    new_conversations_per_hour: "",
    new_conversations_per_day_enabled: false,
    new_conversations_per_day: "",
    message_interval_seconds_enabled: false,
    message_interval_seconds: "",
    new_conversation_interval_seconds_enabled: false,
    new_conversation_interval_seconds: "",
    consecutive_without_reply_enabled: false,
    consecutive_without_reply: "",
    allowed_hours_enabled: false,
    allowed_days: [1, 2, 3, 4, 5],
    allowed_start: "08:00",
    allowed_end: "18:00",
    timezone: "America/Sao_Paulo",
    allow_existing_replies_outside_hours: true,
    block_new_conversations_only: true,
    ...(base || {}),
  };
}

function toInputValue(value) {
  return value === null || value === undefined ? "" : value;
}

function normalizeForForm(config) {
  const next = defaultConfig(config);
  RULES.forEach(([key]) => {
    next[key] = toInputValue(next[key]);
    next[`${key}_enabled`] = next[`${key}_enabled`] === true;
  });
  next.allowed_hours_enabled = next.allowed_hours_enabled === true;
  next.allow_existing_replies_outside_hours = next.allow_existing_replies_outside_hours !== false;
  next.block_new_conversations_only = next.block_new_conversations_only !== false;
  next.allowed_days = Array.isArray(next.allowed_days) ? next.allowed_days : [1, 2, 3, 4, 5];
  return next;
}

function sanitizeForSave(config) {
  const next = defaultConfig(config);
  RULES.forEach(([key]) => {
    const raw = String(next[key] ?? "").trim();
    const n = Number(raw);
    next[key] = raw && Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    next[`${key}_enabled`] = next[`${key}_enabled`] === true;
  });
  next.allowed_hours_enabled = next.allowed_hours_enabled === true;
  next.allowed_days = [...new Set((next.allowed_days || []).map(Number).filter((d) => d >= 0 && d <= 6))];
  next.allowed_start = /^\d{2}:\d{2}$/.test(next.allowed_start || "") ? next.allowed_start : "08:00";
  next.allowed_end = /^\d{2}:\d{2}$/.test(next.allowed_end || "") ? next.allowed_end : "18:00";
  next.timezone = String(next.timezone || "America/Sao_Paulo").trim();
  next.allow_existing_replies_outside_hours = next.allow_existing_replies_outside_hours !== false;
  next.block_new_conversations_only = next.block_new_conversations_only !== false;
  return next;
}

export default function LimitesAtendimento({ usuarios = [] }) {
  const [data, setData] = useState(null);
  const [enabled, setEnabled] = useState(false);
  const [companyConfig, setCompanyConfig] = useState(defaultConfig());
  const [selectedUserId, setSelectedUserId] = useState("");
  const [userConfig, setUserConfig] = useState(defaultConfig());
  const [useCompanyDefault, setUseCompanyDefault] = useState(true);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = async () => {
    setMsg(null);
    const payload = await cfg.getAtendimentoLimits();
    setData(payload);
    setEnabled(payload?.enabled === true);
    setCompanyConfig(normalizeForForm(payload?.default_config || payload?.defaults));
  };

  useEffect(() => {
    load().catch(() => setMsg({ type: "err", text: "Erro ao carregar limites de atendimento." }));
  }, []);

  const userConfigMap = useMemo(() => {
    const map = new Map();
    (data?.user_configs || []).forEach((item) => map.set(String(item.usuario_id), item));
    return map;
  }, [data]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (usuarios || []).filter((u) => {
      if (!q) return true;
      return String(u.nome || "").toLowerCase().includes(q) || String(u.email || "").toLowerCase().includes(q);
    });
  }, [usuarios, search]);

  const selectedUser = usuarios.find((u) => String(u.id) === String(selectedUserId));

  useEffect(() => {
    if (!selectedUserId) return;
    const custom = userConfigMap.get(String(selectedUserId));
    setUseCompanyDefault(custom ? custom.use_company_default !== false : true);
    setUserConfig(normalizeForForm(custom?.config || companyConfig));
  }, [selectedUserId, userConfigMap, companyConfig]);

  const saveCompany = async () => {
    if (!window.confirm("Salvar os limites padrao da empresa?")) return;
    setSaving(true);
    try {
      const next = await cfg.putAtendimentoLimits({
        enabled,
        default_config: sanitizeForSave(companyConfig),
      });
      setData(next);
      setCompanyConfig(normalizeForForm(next?.default_config));
      setMsg({ type: "ok", text: "Limites da empresa salvos." });
    } catch (e) {
      setMsg({ type: "err", text: e?.response?.data?.error || "Erro ao salvar limites." });
    } finally {
      setSaving(false);
    }
  };

  const saveUser = async () => {
    if (!selectedUserId) return;
    if (!window.confirm(`Salvar limites para ${selectedUser?.nome || "este usuario"}?`)) return;
    setSaving(true);
    try {
      const next = await cfg.putAtendimentoLimitsUsuario(selectedUserId, {
        use_company_default: useCompanyDefault,
        config: sanitizeForSave(userConfig),
      });
      setData(next);
      setMsg({ type: "ok", text: "Limites do usuario salvos." });
    } catch (e) {
      setMsg({ type: "err", text: e?.response?.data?.error || "Erro ao salvar usuario." });
    } finally {
      setSaving(false);
    }
  };

  const restoreUserDefault = () => {
    setUseCompanyDefault(true);
    setUserConfig(normalizeForForm(companyConfig));
  };

  if (!data) return <p className="ia-muted">Carregando limites de atendimento...</p>;

  return (
    <div className="ia-section atendimento-limits">
      <div className="config-headRow">
        <div>
          <h4>Limites de Atendimento</h4>
          <p className="ia-muted">Controle opcional por empresa e por usuario. Desativado, o envio permanece como antes.</p>
        </div>
        <button type="button" className="ia-btn ia-btn--primary" onClick={saveCompany} disabled={saving}>
          {saving ? "Salvando..." : "Salvar padrao"}
        </button>
      </div>

      {msg ? (
        <div className={`ia-error-banner ${msg.type === "ok" ? "is-ok" : ""}`} role="alert">
          {msg.text}
          <button type="button" onClick={() => setMsg(null)} aria-label="Fechar">x</button>
        </div>
      ) : null}

      <section className="atendimento-limits-toggle">
        <div>
          <strong>Ativar limites de atendimento</strong>
          <span>Quando desligado, nenhuma regra abaixo e aplicada.</span>
        </div>
        <Switch checked={enabled} onChange={setEnabled} aria-label="Ativar limites de atendimento" />
      </section>

      <section className="atendimento-limits-panel">
        <h5>Padrao da empresa</h5>
        <LimitConfigForm value={companyConfig} onChange={setCompanyConfig} />
      </section>

      <section className="atendimento-limits-users">
        <div className="atendimento-limits-user-list">
          <div className="ia-field">
            <label htmlFor="limits-user-search">Usuarios</label>
            <input
              id="limits-user-search"
              className="ia-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome ou email"
            />
          </div>
          <div className="atendimento-limits-users-scroll">
            {filteredUsers.map((u) => {
              const custom = userConfigMap.get(String(u.id));
              const isSelected = String(u.id) === String(selectedUserId);
              const inherited = !custom || custom.use_company_default !== false;
              return (
                <button
                  key={u.id}
                  type="button"
                  className={`atendimento-limits-user ${isSelected ? "is-selected" : ""}`}
                  onClick={() => setSelectedUserId(String(u.id))}
                >
                  <span>{u.nome || u.email || `Usuario ${u.id}`}</span>
                  <small>{inherited ? "Padrao da empresa" : "Personalizado"}</small>
                </button>
              );
            })}
          </div>
        </div>

        <div className="atendimento-limits-user-editor">
          {selectedUser ? (
            <>
              <div className="config-headRow">
                <div>
                  <h5>{selectedUser.nome || "Usuario"}</h5>
                  <p className="ia-muted">{selectedUser.email || "Configuracao individual"}</p>
                </div>
                <button type="button" className="ia-btn ia-btn--outline" onClick={restoreUserDefault}>
                  Restaurar padrao
                </button>
              </div>
              <label className="atendimento-limits-check">
                <input
                  type="checkbox"
                  checked={useCompanyDefault}
                  onChange={(e) => setUseCompanyDefault(e.target.checked)}
                />
                Usar padrao da empresa
              </label>
              <LimitConfigForm value={userConfig} onChange={setUserConfig} disabled={useCompanyDefault} />
              <div className="ia-btn-row">
                <button type="button" className="ia-btn ia-btn--primary" onClick={saveUser} disabled={saving}>
                  Salvar usuario
                </button>
              </div>
            </>
          ) : (
            <p className="ia-muted">Selecione um usuario para personalizar os limites.</p>
          )}
        </div>
      </section>

      <section className="atendimento-limits-panel">
        <h5>Historico de alteracoes</h5>
        <div className="atendimento-limits-history">
          {(data.history || []).length === 0 ? (
            <p className="ia-muted">Nenhuma alteracao registrada.</p>
          ) : (
            (data.history || []).slice(0, 30).map((h) => (
              <div key={h.id} className="atendimento-limits-history-row">
                <span>{new Date(h.criado_em).toLocaleString()}</span>
                <strong>{h.target_type === "user" ? `Usuario ${h.target_usuario_id}` : "Padrao da empresa"}</strong>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function LimitConfigForm({ value, onChange, disabled = false }) {
  const set = (patch) => onChange((current) => ({ ...cloneConfig(current), ...patch }));
  const toggleDay = (day) => {
    const days = new Set(value.allowed_days || []);
    if (days.has(day)) days.delete(day);
    else days.add(day);
    set({ allowed_days: [...days].sort((a, b) => a - b) });
  };

  return (
    <div className={`atendimento-limits-form ${disabled ? "is-disabled" : ""}`}>
      <div className="atendimento-limits-rules">
        {RULES.map(([key, label, unit]) => (
          <div key={key} className="atendimento-limits-rule">
            <label>
              <input
                type="checkbox"
                checked={value[`${key}_enabled`] === true}
                disabled={disabled}
                onChange={(e) => set({ [`${key}_enabled`]: e.target.checked })}
              />
              {label}
            </label>
            <div className="atendimento-limits-number">
              <input
                className="ia-input"
                type="number"
                min="1"
                value={value[key] ?? ""}
                disabled={disabled || value[`${key}_enabled`] !== true}
                onChange={(e) => set({ [key]: e.target.value })}
              />
              <span>{unit}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="atendimento-limits-hours">
        <label className="atendimento-limits-check">
          <input
            type="checkbox"
            checked={value.allowed_hours_enabled === true}
            disabled={disabled}
            onChange={(e) => set({ allowed_hours_enabled: e.target.checked })}
          />
          Horario permitido para iniciar novas conversas
        </label>
        <div className="atendimento-limits-days">
          {DAY_OPTIONS.map((d) => (
            <button
              key={d.value}
              type="button"
              className={(value.allowed_days || []).includes(d.value) ? "is-active" : ""}
              disabled={disabled || value.allowed_hours_enabled !== true}
              onClick={() => toggleDay(d.value)}
            >
              {d.label}
            </button>
          ))}
        </div>
        <div className="atendimento-limits-time-grid">
          <label>
            Inicio
            <input className="ia-input" type="time" value={value.allowed_start || "08:00"} disabled={disabled || value.allowed_hours_enabled !== true} onChange={(e) => set({ allowed_start: e.target.value })} />
          </label>
          <label>
            Fim
            <input className="ia-input" type="time" value={value.allowed_end || "18:00"} disabled={disabled || value.allowed_hours_enabled !== true} onChange={(e) => set({ allowed_end: e.target.value })} />
          </label>
          <label>
            Fuso horario
            <input className="ia-input" value={value.timezone || "America/Sao_Paulo"} disabled={disabled || value.allowed_hours_enabled !== true} onChange={(e) => set({ timezone: e.target.value })} />
          </label>
        </div>
        <label className="atendimento-limits-check">
          <input
            type="checkbox"
            checked={value.allow_existing_replies_outside_hours !== false}
            disabled={disabled || value.allowed_hours_enabled !== true}
            onChange={(e) => set({ allow_existing_replies_outside_hours: e.target.checked })}
          />
          Permitir respostas em conversas existentes fora do horario
        </label>
      </div>
    </div>
  );
}
