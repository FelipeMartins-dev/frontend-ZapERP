import api from "./http";
import type {
  CreateAtividadePayload,
  CreateLeadPayload,
  CrmAtividade,
  CrmCampaign,
  CrmKanbanResponse,
  CrmLeadListItem,
  CrmLeadsListResponse,
  CrmNota,
  CrmOrigem,
  CrmPipeline,
  CrmStage,
  CrmTagRef,
  CrmTimelineEvent,
  MoveLeadPayload,
} from "../crm/crmTypes";

const CRM = "/api/crm";

/** Extrai mensagem de erro legível de Axios */
export function crmApiError(err: unknown): string {
  const e = err as {
    response?: { data?: { error?: string }; status?: number };
    message?: string;
  };
  return e?.response?.data?.error || e?.message || "Erro ao comunicar com o servidor.";
}

// --- Pipelines ---

export async function listPipelines(params?: { ativo?: boolean; include?: string; inc?: string }) {
  const { data } = await api.get<CrmPipeline[]>(`${CRM}/pipelines`, { params });
  return data;
}

export async function getPipeline(id: number) {
  const { data } = await api.get<CrmPipeline>(`${CRM}/pipelines/${id}`);
  return data;
}

export async function getPipelineFull(id: number) {
  const { data } = await api.get<{ pipeline: CrmPipeline; stages: CrmStage[] } | CrmPipeline>(
    `${CRM}/pipelines/${id}/full`
  );
  return data;
}

export async function createPipeline(payload: Partial<CrmPipeline> & { nome: string }) {
  const { data } = await api.post<CrmPipeline>(`${CRM}/pipelines`, payload);
  return data;
}

export async function updatePipeline(id: number, payload: Partial<CrmPipeline>) {
  const { data } = await api.put<CrmPipeline>(`${CRM}/pipelines/${id}`, payload);
  return data;
}

export async function deletePipeline(id: number) {
  await api.delete(`${CRM}/pipelines/${id}`);
}

export async function clonePipeline(id: number, body?: { nome?: string }) {
  const { data } = await api.post<CrmPipeline>(`${CRM}/pipelines/${id}/clone`, body ?? {});
  return data;
}

export async function setPipelinePadrao(id: number) {
  const { data } = await api.patch<CrmPipeline>(`${CRM}/pipelines/${id}/padrao`);
  return data;
}

// --- Stages ---

export async function listStages(params?: { pipeline_id?: number; ativo?: boolean }) {
  const { data } = await api.get<CrmStage[]>(`${CRM}/stages`, { params });
  return data;
}

export async function createStage(
  payload: Partial<CrmStage> & { pipeline_id: number; nome: string }
) {
  const { data } = await api.post<CrmStage>(`${CRM}/stages`, payload);
  return data;
}

export async function updateStage(id: number, payload: Partial<CrmStage>) {
  const { data } = await api.put<CrmStage>(`${CRM}/stages/${id}`, payload);
  return data;
}

export async function deleteStage(id: number) {
  await api.delete(`${CRM}/stages/${id}`);
}

// --- Origens ---

export async function listOrigens(params?: { ativo?: boolean }) {
  const { data } = await api.get<CrmOrigem[]>(`${CRM}/origens`, { params });
  return data;
}

export async function createOrigem(payload: Partial<CrmOrigem> & { nome: string }) {
  const { data } = await api.post<CrmOrigem>(`${CRM}/origens`, payload);
  return data;
}

export async function updateOrigem(id: number, payload: Partial<CrmOrigem>) {
  const { data } = await api.put<CrmOrigem>(`${CRM}/origens/${id}`, payload);
  return data;
}

// --- Campanhas ---

export async function listCampaigns(params?: { ativo?: boolean; origem_id?: number }) {
  const { data } = await api.get<CrmCampaign[]>(`${CRM}/campaigns`, { params });
  return data;
}

export async function createCampaign(payload: Partial<CrmCampaign> & { nome: string }) {
  const { data } = await api.post<CrmCampaign>(`${CRM}/campaigns`, payload);
  return data;
}

export async function updateCampaign(id: number, payload: Partial<CrmCampaign>) {
  const { data } = await api.put<CrmCampaign>(`${CRM}/campaigns/${id}`, payload);
  return data;
}

// --- Tags CRM ---

export async function listCrmTags(params?: { ativo?: boolean }) {
  const { data } = await api.get<CrmTagRef[]>(`${CRM}/tags`, { params });
  return data;
}

export async function createCrmTag(payload: { nome: string; cor?: string | null; ativo?: boolean }) {
  const { data } = await api.post<CrmTagRef>(`${CRM}/tags`, payload);
  return data;
}

export async function updateCrmTag(id: number, payload: { nome?: string; cor?: string | null; ativo?: boolean }) {
  const { data } = await api.put<CrmTagRef>(`${CRM}/tags/${id}`, payload);
  return data;
}

// --- Lost reasons ---

export async function listLostReasons() {
  const { data } = await api.get<unknown[]>(`${CRM}/lost-reasons`);
  return Array.isArray(data) ? data : [];
}

export async function createLostReason(payload: { nome: string; descricao?: string; ativo?: boolean; ordem?: number }) {
  const { data } = await api.post<unknown>(`${CRM}/lost-reasons`, payload);
  return data;
}

export async function updateLostReason(id: number, payload: Record<string, unknown>) {
  const { data } = await api.put<unknown>(`${CRM}/lost-reasons/${id}`, payload);
  return data;
}

// --- Leads ---

export type LeadsQueryParams = Record<string, string | number | boolean | undefined | null>;

export async function listLeads(params?: LeadsQueryParams) {
  const { data } = await api.get<CrmLeadsListResponse>(`${CRM}/leads`, { params });
  return data;
}

export async function exportLeadsCsv(params?: LeadsQueryParams) {
  const { data } = await api.get<Blob>(`${CRM}/leads/export`, {
    params,
    responseType: "blob",
  });
  return data;
}

/** Resposta POST /leads/from-conversa (201/200/409). */
export interface FromConversaLeadResponse {
  lead?: { id?: number; [key: string]: unknown };
  from_conversa?: Record<string, unknown>;
  error?: string;
}

/**
 * Cria ou sincroniza lead a partir da conversa.
 * 409 devolvido como status (não lança) quando há duplicata e `sincronizar_duplicata: false` no body.
 */
export async function postLeadFromConversa(conversaId: number, body?: Record<string, unknown>) {
  const res = await api.post<FromConversaLeadResponse>(`${CRM}/leads/from-conversa/${conversaId}`, body ?? {}, {
    validateStatus: (s) => s === 200 || s === 201 || s === 409,
    // evita toast global 403; o chat trata CRM_DISABLED localmente
    skipGlobal403Toast: true,
  } as Parameters<typeof api.post>[2] & { skipGlobal403Toast?: boolean });
  return { status: res.status, data: res.data };
}

/** @deprecated Preferir `postLeadFromConversa` para tratar 409. */
export async function createLeadFromConversa(conversaId: number, body?: Record<string, unknown>) {
  const { status, data } = await postLeadFromConversa(conversaId, body);
  if (status === 409) {
    const err = new Error((data as FromConversaLeadResponse)?.error || "Conflito ao criar lead.") as Error & {
      response?: { status: number; data: FromConversaLeadResponse };
    };
    err.response = { status: 409, data };
    throw err;
  }
  return data as unknown as CrmLeadListItem;
}

export async function createLeadFromCliente(clienteId: number, body?: Record<string, unknown>) {
  const { data } = await api.post<CrmLeadListItem>(`${CRM}/leads/from-cliente/${clienteId}`, body ?? {});
  return data;
}

export async function createLead(payload: CreateLeadPayload) {
  const { data } = await api.post<CrmLeadListItem>(`${CRM}/leads`, payload);
  return data;
}

export async function getLead(id: number) {
  const { data } = await api.get<Record<string, unknown>>(`${CRM}/leads/${id}`);
  return data;
}

export async function patchLead(id: number, payload: Record<string, unknown>) {
  const { data } = await api.patch<CrmLeadListItem>(`${CRM}/leads/${id}`, payload);
  return data;
}

export async function moveLead(id: number, payload: MoveLeadPayload) {
  const { data } = await api.post<unknown>(`${CRM}/leads/${id}/move`, payload);
  return data;
}

export async function winLead(id: number, payload?: { valor_ganho?: number; stage_id?: number; motivo?: string }) {
  const { data } = await api.post<CrmLeadListItem>(`${CRM}/leads/${id}/win`, payload ?? {});
  return data;
}

export async function loseLead(
  id: number,
  payload: { motivo_perda?: string; perdido_motivo?: string; motivo_perda_id?: number | null; observacao?: string; stage_id?: number }
) {
  const { data } = await api.post<CrmLeadListItem>(`${CRM}/leads/${id}/lose`, payload);
  return data;
}

export async function reopenLead(id: number, payload?: { stage_id?: number; pipeline_id?: number; motivo?: string }) {
  const { data } = await api.post<CrmLeadListItem>(`${CRM}/leads/${id}/reopen`, payload ?? {});
  return data;
}

export async function transferLead(id: number, responsavel_id: number | null) {
  const { data } = await api.post<CrmLeadListItem>(`${CRM}/leads/${id}/transfer`, { responsavel_id });
  return data;
}

export async function registerLeadContact(
  id: number,
  payload?: { canal?: string; resultado?: string; descricao?: string; data_contato?: string; data_proxima_acao?: string }
) {
  const { data } = await api.post<CrmLeadListItem>(`${CRM}/leads/${id}/contact`, payload ?? {});
  return data;
}

export async function reorderLeads(body: { stage_id: number; lead_ids: number[] }) {
  const { data } = await api.post<unknown>(`${CRM}/leads/reorder`, body);
  return data;
}

export async function getLeadHistory(id: number) {
  const { data } = await api.get<unknown>(`${CRM}/leads/${id}/history`);
  return data;
}

export async function getLeadTimeline(id: number, params?: { tipo?: string; limit?: number }) {
  const { data } = await api.get<CrmTimelineEvent[]>(`${CRM}/leads/${id}/timeline`, { params });
  return data;
}

// --- Notas ---

export async function listLeadNotes(leadId: number) {
  const { data } = await api.get<CrmNota[] | { items?: CrmNota[] }>(`${CRM}/leads/${leadId}/notes`);
  if (Array.isArray(data)) return data;
  return data?.items ?? [];
}

export async function createLeadNote(leadId: number, texto: string) {
  const { data } = await api.post<CrmNota>(`${CRM}/leads/${leadId}/notes`, { texto });
  return data;
}

export async function updateLeadNote(leadId: number, notaId: number, texto: string) {
  const { data } = await api.put<CrmNota>(`${CRM}/leads/${leadId}/notas/${notaId}`, { texto });
  return data;
}

export async function deleteLeadNote(leadId: number, notaId: number) {
  await api.delete(`${CRM}/leads/${leadId}/notas/${notaId}`);
}

// --- Atividades ---

export async function listLeadActivities(leadId: number) {
  const { data } = await api.get<CrmAtividade[] | { items?: CrmAtividade[] }>(
    `${CRM}/leads/${leadId}/activities`
  );
  if (Array.isArray(data)) return data;
  return data?.items ?? [];
}

export async function createLeadActivity(leadId: number, payload: CreateAtividadePayload) {
  const { data } = await api.post<CrmAtividade>(`${CRM}/leads/${leadId}/activities`, payload);
  return data;
}

export async function updateActivity(activityId: number, payload: Partial<CreateAtividadePayload> & Record<string, unknown>) {
  const { data } = await api.patch<CrmAtividade>(`${CRM}/activities/${activityId}`, payload);
  return data;
}

export async function updateActivityStatus(
  activityId: number,
  body: { status: "pendente" | "concluida" | "cancelada"; sync_google?: boolean }
) {
  const { data } = await api.patch<CrmAtividade>(`${CRM}/activities/${activityId}/status`, body);
  return data;
}

export async function deleteActivity(activityId: number) {
  await api.delete(`${CRM}/activities/${activityId}`);
}

// --- Kanban ---

export async function getKanban(params?: LeadsQueryParams & { pipeline_id?: number }) {
  const { data } = await api.get<CrmKanbanResponse>(`${CRM}/kanban`, { params });
  return data;
}

// --- Agenda ---

export async function getAgendaResumo() {
  const { data } = await api.get<Record<string, unknown>>(`${CRM}/agenda/resumo`);
  return data;
}

export async function getAgenda(params: Record<string, string | number | undefined>) {
  const { data } = await api.get<Record<string, unknown>>(`${CRM}/agenda`, { params });
  return data;
}

// --- Dashboard CRM ---

export async function getCrmDashboard(params?: { pipeline_id?: number }) {
  const { data } = await api.get<Record<string, unknown>>(`${CRM}/dashboard`, { params });
  return data;
}

export async function getCrmDashboardFunnel(params?: Record<string, string | number | undefined>) {
  const { data } = await api.get<Record<string, unknown>>(`${CRM}/dashboard/funnel`, { params });
  return data;
}

export async function getCrmDashboardResponsaveis(params?: { pipeline_id?: number }) {
  const { data } = await api.get<unknown>(`${CRM}/dashboard/responsaveis`, { params });
  return data;
}

export async function getCrmDashboardOrigens(params?: { pipeline_id?: number }) {
  const { data } = await api.get<unknown>(`${CRM}/dashboard/origens`, { params });
  return data;
}

// --- Google ---

export async function getGoogleStatus() {
  const { data } = await api.get<{ connected: boolean; email_google?: string }>(`${CRM}/google/status`);
  return data;
}

export async function getGoogleConnectUrl() {
  const { data } = await api.get<{ url: string }>(`${CRM}/google/connect`, {
    params: { json: 1 },
  });
  return data?.url;
}

export async function disconnectGoogle() {
  await api.post(`${CRM}/google/disconnect`);
}

export async function listGoogleCalendars() {
  const { data } = await api.get<unknown>(`${CRM}/google/calendars`);
  return data;
}

export async function setGoogleCalendar(calendar_id: string) {
  await api.post(`${CRM}/google/calendar`, { calendar_id });
}

export async function syncGoogleLead(leadId: number) {
  await api.post(`${CRM}/google/sync/${leadId}`);
}
