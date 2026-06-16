import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { crmApiError, getKanban, loseLead, moveLead, registerLeadContact, reorderLeads, winLead } from "../../api/crmService";
import type { CrmKanbanCard, CrmKanbanResponse } from "../crmTypes";
import CrmPipelinePicker from "../components/CrmPipelinePicker.jsx";
import { useCrmStore } from "../crmStore";

const cKey = (stageId: number) => `c-${stageId}`;
const lKey = (leadId: number) => `l-${leadId}`;

function parseC(k: string | number) {
  return Number(String(k).replace(/^c-/, ""));
}
function parseL(k: string | number) {
  return Number(String(k).replace(/^l-/, ""));
}

function findContainer(itemId: string | number, board: Record<string, string[]>) {
  const id = String(itemId);
  if (Object.prototype.hasOwnProperty.call(board, id)) return id;
  return Object.keys(board).find((key) => board[key].includes(id)) ?? null;
}

function pickAccent(cor?: string | null): string {
  if (!cor || typeof cor !== "string") return "var(--ds-accent)";
  const c = cor.trim();
  if (c.startsWith("#") || c.startsWith("rgb")) return c;
  return "var(--ds-accent)";
}

function fmtDt(iso?: string | null): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return null;
  }
}

function daysSince(iso?: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

function priorClass(p?: string | null): string {
  const x = String(p || "").toLowerCase();
  if (x === "urgente") return "crm-kanban-card--p-urgente";
  if (x === "alta") return "crm-kanban-card--p-alta";
  if (x === "normal") return "crm-kanban-card--p-normal";
  if (x === "baixa") return "crm-kanban-card--p-baixa";
  return "";
}

function buildBoardState(data: CrmKanbanResponse) {
  const items: Record<string, string[]> = {};
  const cards: Record<number, CrmKanbanCard> = {};
  for (const col of data.columns) {
    const key = cKey(col.stage.id);
    items[key] = col.leads.map((l) => lKey(l.id));
    for (const l of col.leads) cards[l.id] = l;
  }
  return { items, cards };
}

function KanbanCardBody({ card, onRefresh }: { card: CrmKanbanCard; onRefresh?: () => Promise<void> }) {
  const prox = fmtDt(card.data_proximo_contato ?? null);
  const ult = fmtDt(card.data_ultimo_contato ?? card.ultima_interacao_em ?? null);
  const parado = daysSince(card.data_entrada_stage ?? card.ultima_interacao_em ?? null);
  const valor =
    card.valor_estimado != null && card.valor_estimado !== ""
      ? Number(card.valor_estimado).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })
      : null;

  return (
    <>
      <div className="crm-kanban-card-name">{card.nome}</div>
      {card.empresa ? <div className="crm-muted" style={{ paddingLeft: 6, fontSize: "0.8rem" }}>{card.empresa}</div> : null}
      <div className="crm-tag-row" style={{ paddingLeft: 6 }}>
        {card.temperatura ? <span className={`crm-badge crm-badge--${card.temperatura}`}>{card.temperatura}</span> : null}
        {parado != null ? <span className="crm-badge">{parado}d no estagio</span> : null}
        {!ult ? <span className="crm-badge crm-badge--warn">sem contato</span> : null}
        {!prox ? <span className="crm-badge crm-badge--warn">sem proxima acao</span> : null}
      </div>
      <div className="crm-kanban-card-meta">
        {card.whatsapp || card.telefone ? (
          <div>
            <strong>Contato</strong> · {card.whatsapp || card.telefone}
          </div>
        ) : null}
        {prox ? (
          <div>
            <strong>Próximo contato</strong> · {prox}
          </div>
        ) : null}
        {ult ? (
          <div>
            <strong>Última interação</strong> · {ult}
          </div>
        ) : null}
      </div>
      {onRefresh ? <KanbanCardActions card={card} onRefresh={onRefresh} /> : null}
      {Array.isArray(card.tags) && card.tags.length > 0 ? (
        <div className="crm-tag-row" style={{ paddingLeft: 6 }}>
          {card.tags.slice(0, 4).map((t) => (
            <span
              key={t.id}
              className="crm-tag-pill"
              style={t.cor ? { background: `${t.cor}22`, color: t.cor } : undefined}
            >
              {t.nome ?? t.id}
            </span>
          ))}
        </div>
      ) : null}
      <div className="crm-kanban-card-footer">
        <span className="crm-kanban-avatar" title={card.responsavel?.nome ?? ""}>
          {card.responsavel?.nome ?? "Sem responsável"}
        </span>
        {valor ? <span className="crm-kanban-val">{valor}</span> : <span className="crm-muted" style={{ fontSize: "0.72rem" }}>—</span>}
      </div>
    </>
  );
}

function KanbanCardActions({ card, onRefresh }: { card: CrmKanbanCard; onRefresh: () => Promise<void> }) {
  const stop = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <div className="crm-kanban-actions" onPointerDown={stop} onMouseDown={stop} onClick={(e) => e.stopPropagation()}>
      <a className="crm-icon-btn" href={`/crm/leads/${card.id}`} title="Abrir lead" aria-label="Abrir lead">
        Abrir
      </a>
      <button
        type="button"
        className="crm-icon-btn"
        onClick={async () => {
          await registerLeadContact(card.id, { canal: "kanban", resultado: "Contato registrado pelo Kanban" });
          await onRefresh();
        }}
      >
        Contato
      </button>
      <button
        type="button"
        className="crm-icon-btn"
        onClick={async () => {
          const raw = window.prompt("Valor ganho (opcional)", card.valor_estimado != null ? String(card.valor_estimado) : "");
          await winLead(card.id, raw && raw.trim() ? { valor_ganho: Number(raw.replace(",", ".")) } : {});
          await onRefresh();
        }}
      >
        Ganho
      </button>
      <button
        type="button"
        className="crm-icon-btn crm-icon-btn--danger"
        onClick={async () => {
          const motivo = window.prompt("Motivo da perda");
          if (!motivo?.trim()) return;
          await loseLead(card.id, { motivo_perda: motivo.trim(), perdido_motivo: motivo.trim() });
          await onRefresh();
        }}
      >
        Perder
      </button>
    </div>
  );
}

function ColumnBody({ stageId, children }: { stageId: number; children: ReactNode }) {
  const { setNodeRef } = useDroppable({ id: cKey(stageId) });
  return (
    <div ref={setNodeRef} className="crm-kanban-col-body" data-stage-id={stageId}>
      {children}
    </div>
  );
}

function SortableLeadCard({ card, onRefresh }: { card: CrmKanbanCard; onRefresh: () => Promise<void> }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: lKey(card.id),
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`crm-kanban-card ${priorClass(card.prioridade)} ${isDragging ? "crm-kanban-card--drag" : ""}`}
      {...attributes}
      {...listeners}
    >
      <KanbanCardBody card={card} onRefresh={onRefresh} />
    </div>
  );
}

export default function CrmKanban() {
  const pipelineId = useCrmStore((s) => s.pipelineId);
  const refreshTick = useCrmStore((s) => s.refreshTick);
  const [kanban, setKanban] = useState<CrmKanbanResponse | null>(null);
  const [items, setItems] = useState<Record<string, string[]>>({});
  const [cards, setCards] = useState<Record<number, CrmKanbanCard>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [activeDrag, setActiveDrag] = useState<CrmKanbanCard | null>(null);
  const [q, setQ] = useState("");
  const [temperatura, setTemperatura] = useState("");
  const [semContato, setSemContato] = useState(false);
  const [semProxima, setSemProxima] = useState(false);
  const snapshotRef = useRef<string | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setErr("");
      const params: Record<string, string | number | boolean> = {};
      if (pipelineId != null) params.pipeline_id = pipelineId;
      if (q.trim()) params.q = q.trim();
      if (temperatura) params.temperatura = temperatura;
      if (semContato) params.sem_contato_dias = 1;
      if (semProxima) params.proximo_vencido = true;
      const data = await getKanban(params);
      setKanban(data);
      const b = buildBoardState(data);
      setItems(b.items);
      setCards(b.cards);
    } catch (e) {
      setErr(crmApiError(e));
      setKanban(null);
    } finally {
      setLoading(false);
    }
  }, [pipelineId, q, temperatura, semContato, semProxima]);

  useEffect(() => {
    load();
  }, [load, refreshTick]);

  const onDragStart = (event: DragStartEvent) => {
    const id = event.active?.id;
    if (id == null) return;
    snapshotRef.current = JSON.stringify(itemsRef.current);
    const lid = parseL(id as string);
    setActiveDrag(cards[lid] ?? null);
  };

  const onDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;
    setItems((prev) => {
      const activeContainer = findContainer(active.id, prev);
      const overContainer = findContainer(over.id, prev);
      if (!activeContainer || !overContainer || activeContainer === overContainer) return prev;

      const activeItems = [...prev[activeContainer]];
      const overItems = [...prev[overContainer]];
      const activeIndex = activeItems.indexOf(String(active.id));
      if (activeIndex === -1) return prev;
      const moved = activeItems[activeIndex];
      const nextActive = activeItems.filter((x) => x !== moved);
      const overId = String(over.id);
      let newIndex: number;
      if (Object.prototype.hasOwnProperty.call(prev, overId)) {
        newIndex = overItems.length;
      } else {
        const overIndex = overItems.indexOf(overId);
        newIndex = overIndex >= 0 ? overIndex : overItems.length;
      }
      const nextOver = [...overItems.slice(0, newIndex), moved, ...overItems.slice(newIndex)];
      return {
        ...prev,
        [activeContainer]: nextActive,
        [overContainer]: nextOver,
      };
    });
  };

  const onDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDrag(null);
    const current = itemsRef.current;

    if (!over) {
      if (snapshotRef.current) {
        try {
          setItems(JSON.parse(snapshotRef.current));
        } catch {
          /* ignore */
        }
      }
      snapshotRef.current = null;
      return;
    }

    const activeContainer = findContainer(active.id, current);
    const overContainer = findContainer(over.id, current);
    if (!activeContainer || !overContainer) {
      snapshotRef.current = null;
      return;
    }

    const leadId = parseL(active.id as string);
    const stageSource = parseC(activeContainer);
    const stageDest = parseC(overContainer);
    const pipeline = kanban?.pipeline?.id;

    try {
      if (activeContainer === overContainer) {
        const oldIndex = current[activeContainer].indexOf(String(active.id));
        const newIndex = current[overContainer].indexOf(String(over.id));
        if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) {
          snapshotRef.current = null;
          return;
        }
        const next = arrayMove(current[activeContainer], oldIndex, newIndex);
        setItems((prev) => ({ ...prev, [activeContainer]: next }));
        await reorderLeads({
          stage_id: stageSource,
          lead_ids: next.map((x) => parseL(x)),
        });
        snapshotRef.current = null;
        return;
      }

      await moveLead(leadId, {
        stage_id: stageDest,
        ...(pipeline != null ? { pipeline_id: pipeline } : {}),
        retornar_snapshot: true,
      });

      const destOrder = current[overContainer].map((x) => parseL(x));
      const sourceOrder = current[activeContainer].map((x) => parseL(x));

      await reorderLeads({ stage_id: stageDest, lead_ids: destOrder });
      await reorderLeads({ stage_id: stageSource, lead_ids: sourceOrder });
    } catch (e) {
      if (snapshotRef.current) {
        try {
          setItems(JSON.parse(snapshotRef.current));
        } catch {
          /* ignore */
        }
      }
      setErr(crmApiError(e));
    } finally {
      snapshotRef.current = null;
    }
  };

  const columns = kanban?.columns ?? [];

  if (loading && !kanban) {
    return (
      <div>
        <div className="crm-toolbar crm-toolbar--premium">
          <CrmPipelinePicker />
        </div>
        <div className="crm-empty-soft">Carregando quadro Kanban…</div>
      </div>
    );
  }

  if (err && !kanban) {
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

  const pipelineNome = kanban?.pipeline?.nome ?? "Pipeline";
  const totalLeads = columns.reduce((acc, c) => acc + (items[cKey(c.stage.id)]?.length ?? 0), 0);

  return (
    <div>
      <div className="crm-page-head">
        <div>
          <h2>Quadro Kanban</h2>
          <p>Arraste cards entre colunas para mover leads; na mesma coluna, reordene. Alterações são salvas na API.</p>
        </div>
      </div>

      <div className="crm-toolbar crm-toolbar--premium">
        <CrmPipelinePicker />
        <div className="crm-field">
          <span className="crm-field-label">Busca</span>
          <input className="crm-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome, telefone, e-mail, CPF/CNPJ" />
        </div>
        <div className="crm-field">
          <span className="crm-field-label">Temperatura</span>
          <select className="crm-select" value={temperatura} onChange={(e) => setTemperatura(e.target.value)}>
            <option value="">Todas</option>
            <option value="frio">Frio</option>
            <option value="morno">Morno</option>
            <option value="quente">Quente</option>
          </select>
        </div>
        <label className="crm-check">
          <input type="checkbox" checked={semContato} onChange={(e) => setSemContato(e.target.checked)} />
          Sem contato
        </label>
        <label className="crm-check">
          <input type="checkbox" checked={semProxima} onChange={(e) => setSemProxima(e.target.checked)} />
          Sem proxima acao
        </label>
        <button type="button" className="crm-btn crm-btn--primary" onClick={load} disabled={loading}>
          {loading ? "Atualizando…" : "Atualizar quadro"}
        </button>
      </div>

      {err ? <div className="crm-error" style={{ marginBottom: 16 }}>{err}</div> : null}

      <div className="crm-kanban-frame">
        <div className="crm-kanban-topbar">
          <div>
            <div className="crm-kanban-topbar__title">{pipelineNome}</div>
            <div className="crm-kanban-topbar__sub">
              {columns.length} colunas · {totalLeads} leads visíveis
            </div>
          </div>
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
        >
          <div className="crm-kanban-board">
            {columns.map((col) => {
              const cid = cKey(col.stage.id);
              const list = items[cid] ?? [];
              const colStyle = { "--col-accent": pickAccent(col.stage.cor) } as CSSProperties;
              return (
                <div key={col.stage.id} className="crm-kanban-col" style={colStyle}>
                  <div className="crm-kanban-col-hd">
                    <span className="crm-kanban-col-title">{col.stage.nome}</span>
                    <span className="crm-kanban-col-count">{list.length}</span>
                  </div>
                  <ColumnBody stageId={col.stage.id}>
                    <SortableContext items={list} strategy={verticalListSortingStrategy}>
                      {list.map((lid) => {
                        const id = parseL(lid);
                        const card = cards[id];
                        if (!card) return null;
                        return <SortableLeadCard key={id} card={card} onRefresh={load} />;
                      })}
                    </SortableContext>
                    {list.length === 0 ? <div className="crm-kanban-drop-hint">Solte um lead aqui</div> : null}
                  </ColumnBody>
                </div>
              );
            })}
          </div>
          <DragOverlay>
            {activeDrag ? (
              <div className={`crm-kanban-card crm-kanban-card--drag ${priorClass(activeDrag.prioridade)}`}>
                <KanbanCardBody card={activeDrag} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}
