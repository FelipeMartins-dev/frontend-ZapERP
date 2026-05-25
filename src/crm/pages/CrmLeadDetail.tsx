import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  crmApiError,
  createLeadActivity,
  createLeadNote,
  deleteActivity,
  disconnectGoogle,
  getGoogleConnectUrl,
  getGoogleStatus,
  getLead,
  syncGoogleLead,
  listLeadActivities,
  listLeadNotes,
  listLostReasons,
  listStages,
  moveLead,
  patchLead,
  updateActivityStatus,
} from "../../api/crmService";
import { getTags } from "../../api/configService";
import type { AtividadeTipo, CrmAtividade, CrmNota } from "../crmTypes";

type TabId = "resumo" | "notas" | "atividades" | "historico";

export default function CrmLeadDetail() {
  const { id } = useParams();
  const leadId = Number(id);
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabId>("resumo");
  const [lead, setLead] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [notes, setNotes] = useState<CrmNota[]>([]);
  const [acts, setActs] = useState<CrmAtividade[]>([]);
  const [tagsCatalog, setTagsCatalog] = useState<{ id: number; nome: string }[]>([]);
  const [google, setGoogle] = useState<{ connected: boolean; email_google?: string } | null>(null);

  const load = useCallback(async () => {
    if (!Number.isFinite(leadId)) return;
    try {
      setLoading(true);
      setErr("");
      const [l, n, a, t, g] = await Promise.all([
        getLead(leadId),
        listLeadNotes(leadId),
        listLeadActivities(leadId),
        getTags(),
        getGoogleStatus().catch(() => null),
      ]);
      setLead(l);
      setNotes(Array.isArray(n) ? n : []);
      setActs(Array.isArray(a) ? a : []);
      setTagsCatalog(
        Array.isArray(t)
          ? t
              .map((x: { id?: number; nome?: string }) => ({
                id: Number(x?.id),
                nome: String(x?.nome ?? ""),
              }))
              .filter((x) => Number.isFinite(x.id) && x.id > 0)
          : []
      );
      setGoogle(g);
    } catch (e) {
      setErr(crmApiError(e));
      setLead(null);
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    load();
  }, [load]);

  const conversaId = lead?.conversa_id != null ? Number(lead.conversa_id) : null;

  if (!Number.isFinite(leadId)) {
    return <div className="crm-error">Lead inválido.</div>;
  }

  if (loading && !lead) {
    return <div className="crm-empty">Carregando lead…</div>;
  }

  if (err && !lead) {
    return (
      <div className="crm-error">
        {err}
        <div style={{ marginTop: 12 }}>
          <button type="button" className="crm-btn crm-btn--primary" onClick={load}>
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  if (!lead) {
    return <div className="crm-empty">Lead nao encontrado.</div>;
  }

  const nome = String(lead?.nome ?? "");

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Link to="/crm/leads" className="crm-muted">
          ← Voltar aos leads
        </Link>
      </div>

      <header style={{ marginBottom: 16 }}>
        <h2 className="crm-title" style={{ fontSize: "1.35rem" }}>
          {nome}
        </h2>
        <p className="crm-muted">
          {lead?.empresa ? String(lead.empresa) : "—"} · {lead?.telefone ? String(lead.telefone) : "—"} ·{" "}
          {lead?.email ? String(lead.email) : "—"}
        </p>
        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {conversaId ? (
            <button
              type="button"
              className="crm-btn crm-btn--primary"
              onClick={() => navigate("/atendimento", { state: { openConversaId: conversaId } })}
            >
              Abrir conversa
            </button>
          ) : null}
          <MoveLeadButton lead={lead} leadId={leadId} onDone={load} />
        </div>
      </header>

      <nav className="crm-tabs" aria-label="Seções do lead">
        {(
          [
            ["resumo", "Resumo"],
            ["notas", "Notas"],
            ["atividades", "Atividades"],
            ["historico", "Histórico"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={`crm-tab ${tab === k ? "crm-tab--active" : ""}`}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "resumo" && (
        <LeadResumoTab
          lead={lead}
          leadId={leadId}
          tagsCatalog={tagsCatalog}
          google={google}
          onRefreshGoogle={async () => setGoogle(await getGoogleStatus())}
          onConnectGoogle={async () => {
            const url = await getGoogleConnectUrl();
            if (url) window.open(url, "_blank", "noopener,noreferrer");
          }}
          onDisconnectGoogle={async () => {
            await disconnectGoogle();
            setGoogle(await getGoogleStatus());
          }}
          onSyncLead={async () => {
            await syncGoogleLead(leadId);
            await load();
          }}
          onPatch={async (payload) => {
            await patchLead(leadId, payload);
            await load();
          }}
        />
      )}
      {tab === "notas" && (
        <NotesTab leadId={leadId} notes={notes} onRefresh={load} />
      )}
      {tab === "atividades" && (
        <ActivitiesTab leadId={leadId} items={acts} onRefresh={load} />
      )}
      {tab === "historico" && <HistoricoTab lead={lead} leadId={leadId} />}
    </div>
  );
}

function LeadResumoTab({
  lead,
  leadId,
  tagsCatalog,
  google,
  onRefreshGoogle,
  onConnectGoogle,
  onDisconnectGoogle,
  onSyncLead,
  onPatch,
}: {
  lead: Record<string, unknown>;
  leadId: number;
  tagsCatalog: { id: number; nome: string }[];
  google: { connected: boolean; email_google?: string } | null;
  onRefreshGoogle: () => Promise<void>;
  onConnectGoogle: () => Promise<void>;
  onDisconnectGoogle: () => Promise<void>;
  onSyncLead: () => Promise<void>;
  onPatch: (p: Record<string, unknown>) => Promise<void>;
}) {
  const [obs, setObs] = useState(String(lead.observacoes ?? ""));
  const [tagIds, setTagIds] = useState<number[]>(
    Array.isArray(lead.tags)
      ? (lead.tags as { id: number }[]).map((t) => t.id)
      : Array.isArray(lead.tag_ids)
        ? (lead.tag_ids as number[])
        : []
  );
  const [saving, setSaving] = useState(false);

  async function saveObs(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onPatch({ observacoes: obs, tag_ids: tagIds });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="crm-split">
      <div className="crm-card">
        <h3 style={{ marginTop: 0 }}>Dados</h3>
        <form onSubmit={saveObs}>
          <div className="crm-form-row">
            <label>Observações</label>
            <textarea className="crm-input" style={{ width: "100%", minHeight: 100 }} value={obs} onChange={(e) => setObs(e.target.value)} />
          </div>
          <div className="crm-form-row">
            <label>Tags</label>
            <select
              multiple
              className="crm-input"
              style={{ width: "100%", minHeight: 120 }}
              value={tagIds.map(String)}
              onChange={(e) => {
                const v = Array.from(e.target.selectedOptions).map((o) => Number(o.value));
                setTagIds(v);
              }}
            >
              {tagsCatalog.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                </option>
              ))}
            </select>
            <span className="crm-muted">Segure Ctrl para múltiplas tags.</span>
          </div>
          <button type="submit" className="crm-btn crm-btn--primary" disabled={saving}>
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </form>
      </div>
      <div className="crm-card">
        <h3 style={{ marginTop: 0 }}>Google Calendar</h3>
        <p className="crm-muted">
          {google?.connected ? `Conectado${google.email_google ? ` (${google.email_google})` : ""}` : "Não conectado"}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          {!google?.connected ? (
            <button type="button" className="crm-btn crm-btn--primary" onClick={onConnectGoogle}>
              Conectar
            </button>
          ) : (
            <>
              <button type="button" className="crm-btn crm-btn--outline" onClick={onDisconnectGoogle}>
                Desconectar
              </button>
              <button type="button" className="crm-btn crm-btn--primary" onClick={onSyncLead}>
                Sincronizar atividades (lead #{leadId})
              </button>
            </>
          )}
          <button type="button" className="crm-btn crm-btn--outline" onClick={onRefreshGoogle}>
            Atualizar status
          </button>
        </div>
      </div>
    </div>
  );
}

function NotesTab({ leadId, notes, onRefresh }: { leadId: number; notes: CrmNota[]; onRefresh: () => Promise<void> }) {
  const [texto, setTexto] = useState("");
  const [busy, setBusy] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!texto.trim()) return;
    setBusy(true);
    try {
      await createLeadNote(leadId, texto.trim());
      setTexto("");
      await onRefresh();
    } catch (err) {
      window.alert(crmApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <form onSubmit={add} className="crm-card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Nova nota</h3>
        <textarea className="crm-input" style={{ width: "100%", minHeight: 80 }} value={texto} onChange={(e) => setTexto(e.target.value)} />
        <div style={{ marginTop: 8 }}>
          <button type="submit" className="crm-btn crm-btn--primary" disabled={busy}>
            Adicionar
          </button>
        </div>
      </form>
      <div className="crm-card">
        {notes.length === 0 ? (
          <div className="crm-empty">Nenhuma nota.</div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {notes.map((n) => (
              <li key={n.id} style={{ marginBottom: 12 }}>
                <div>{n.texto}</div>
                <div className="crm-muted" style={{ fontSize: "0.75rem" }}>
                  {n.criado_em ? String(n.criado_em) : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const TIPOS: AtividadeTipo[] = [
  "ligacao",
  "reuniao",
  "whatsapp",
  "email",
  "tarefa",
  "nota",
  "visita",
  "proposta",
  "demo",
  "outro",
];

function ActivitiesTab({
  leadId,
  items,
  onRefresh,
}: {
  leadId: number;
  items: CrmAtividade[];
  onRefresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <button type="button" className="crm-btn crm-btn--primary" onClick={() => setOpen(true)}>
          Nova atividade
        </button>
      </div>
      {open ? (
        <ActivityFormModal leadId={leadId} onClose={() => setOpen(false)} onSaved={onRefresh} />
      ) : null}
      <div className="crm-table-wrap">
        <table className="crm-table">
          <thead>
            <tr>
              <th>Título</th>
              <th>Tipo</th>
              <th>Status</th>
              <th>Quando</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="crm-muted">
                  Nenhuma atividade.
                </td>
              </tr>
            ) : (
              items.map((a) => (
                <tr key={a.id}>
                  <td>{a.titulo}</td>
                  <td>{a.tipo}</td>
                  <td>{a.status ?? "—"}</td>
                  <td>{a.data_agendada ? String(a.data_agendada).slice(0, 16).replace("T", " ") : "—"}</td>
                  <td>
                    {a.status !== "concluida" ? (
                      <button
                        type="button"
                        className="crm-btn crm-btn--ghost"
                        onClick={async () => {
                          await updateActivityStatus(a.id, { status: "concluida" });
                          await onRefresh();
                        }}
                      >
                        Concluir
                      </button>
                    ) : null}
                    {a.status !== "cancelada" ? (
                      <button
                        type="button"
                        className="crm-btn crm-btn--ghost"
                        onClick={async () => {
                          await updateActivityStatus(a.id, { status: "cancelada" });
                          await onRefresh();
                        }}
                      >
                        Cancelar
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="crm-btn crm-btn--danger"
                      onClick={async () => {
                        if (!window.confirm("Excluir atividade?")) return;
                        await deleteActivity(a.id);
                        await onRefresh();
                      }}
                    >
                      Excluir
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ActivityFormModal({
  leadId,
  onClose,
  onSaved,
}: {
  leadId: number;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [tipo, setTipo] = useState<AtividadeTipo>("tarefa");
  const [titulo, setTitulo] = useState("");
  const [dataAgendada, setDataAgendada] = useState("");
  const [sync, setSync] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!titulo.trim()) return;
    setBusy(true);
    try {
      await createLeadActivity(leadId, {
        tipo,
        titulo: titulo.trim(),
        ...(dataAgendada ? { data_agendada: new Date(dataAgendada).toISOString() } : {}),
        sync_google: sync,
      });
      onClose();
      await onSaved();
    } catch (err) {
      window.alert(crmApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="crm-modal-overlay" role="dialog" aria-modal>
      <div className="crm-modal">
        <h3>Nova atividade</h3>
        <form onSubmit={submit}>
          <div className="crm-form-row">
            <label>Tipo</label>
            <select className="crm-select" style={{ width: "100%" }} value={tipo} onChange={(e) => setTipo(e.target.value as AtividadeTipo)}>
              {TIPOS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="crm-form-row">
            <label>Título</label>
            <input className="crm-input" style={{ width: "100%" }} value={titulo} onChange={(e) => setTitulo(e.target.value)} />
          </div>
          <div className="crm-form-row">
            <label>Data agendada</label>
            <input
              className="crm-input"
              style={{ width: "100%" }}
              type="datetime-local"
              value={dataAgendada}
              onChange={(e) => setDataAgendada(e.target.value)}
            />
          </div>
          <div className="crm-form-row">
            <label>
              <input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} /> Sincronizar com Google
            </label>
          </div>
          <div className="crm-form-actions">
            <button type="button" className="crm-btn crm-btn--outline" onClick={onClose}>
              Fechar
            </button>
            <button type="submit" className="crm-btn crm-btn--primary" disabled={busy}>
              Salvar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function HistoricoTab({ lead, leadId }: { lead: Record<string, unknown> | null; leadId: number }) {
  const raw = lead?.historico ?? lead?.historico_movimentacoes;
  return (
    <div className="crm-card">
      <h3 style={{ marginTop: 0 }}>Histórico</h3>
      <pre style={{ margin: 0, fontSize: "0.82rem", overflow: "auto", maxHeight: 420 }}>
        {raw ? JSON.stringify(raw, null, 2) : `Lead #${leadId} — histórico não retornado no payload.`}
      </pre>
    </div>
  );
}

function MoveLeadButton({
  lead,
  leadId,
  onDone,
}: {
  lead: Record<string, unknown> | null;
  leadId: number;
  onDone: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const pipelineId = lead?.pipeline_id != null ? Number(lead.pipeline_id) : null;
  const [stages, setStages] = useState<{ id: number; nome: string; exige_motivo_perda?: boolean; tipo_fechamento?: string | null }[]>([]);
  const [stageId, setStageId] = useState<number | "">("");
  const [motivo, setMotivo] = useState("");
  const [lostReasons, setLostReasons] = useState<unknown[]>([]);

  useEffect(() => {
    let c = false;
    (async () => {
      if (pipelineId == null) return;
      try {
        const s = await listStages({ pipeline_id: pipelineId, ativo: true });
        const lr = await listLostReasons();
        if (c) return;
        setStages(Array.isArray(s) ? s : []);
        setLostReasons(Array.isArray(lr) ? lr : []);
      } catch {
        setStages([]);
      }
    })();
    return () => {
      c = true;
    };
  }, [pipelineId]);

  if (pipelineId == null) return null;

  const target = stages.find((s) => s.id === stageId);
  const needMotivo =
    target?.tipo_fechamento === "perdido" && target.exige_motivo_perda;

  async function confirm() {
    if (stageId === "" || pipelineId == null) return;
    try {
      await moveLead(leadId, {
        stage_id: Number(stageId),
        pipeline_id: pipelineId,
        ...(needMotivo && motivo.trim() ? { motivo_perda: motivo.trim(), perdido_motivo: motivo.trim() } : {}),
        retornar_snapshot: true,
      });
      setOpen(false);
      await onDone();
    } catch (e) {
      window.alert(crmApiError(e));
    }
  }

  return (
    <>
      <button type="button" className="crm-btn crm-btn--outline" onClick={() => setOpen(true)}>
        Mover de estágio
      </button>
      {open ? (
        <div className="crm-modal-overlay" role="dialog" aria-modal>
          <div className="crm-modal">
            <h3>Mover lead</h3>
            <div className="crm-form-row">
              <label>Novo estágio</label>
              <select
                className="crm-select"
                style={{ width: "100%" }}
                value={stageId === "" ? "" : String(stageId)}
                onChange={(e) => setStageId(e.target.value ? Number(e.target.value) : "")}
              >
                <option value="">Selecione</option>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nome}
                    {s.tipo_fechamento ? ` (${s.tipo_fechamento})` : ""}
                  </option>
                ))}
              </select>
            </div>
            {needMotivo ? (
              <div className="crm-form-row">
                <label>Motivo da perda *</label>
                <input className="crm-input" style={{ width: "100%" }} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                {lostReasons.length > 0 ? (
                  <span className="crm-muted">Catálogo disponível no backend ({lostReasons.length} itens).</span>
                ) : null}
              </div>
            ) : null}
            <div className="crm-form-actions">
              <button type="button" className="crm-btn crm-btn--outline" onClick={() => setOpen(false)}>
                Cancelar
              </button>
              <button type="button" className="crm-btn crm-btn--primary" onClick={confirm}>
                Mover
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
