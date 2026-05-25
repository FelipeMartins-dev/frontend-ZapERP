/** Tipos alinhados ao CRM ZapERP (backend). Campos opcionais refletem respostas parciais. */

export type LeadStatus = "ativo" | "ganho" | "perdido" | "arquivado";
export type LeadPrioridade = "baixa" | "normal" | "alta" | "urgente";
export type StageTipoFechamento = "ganho" | "perdido" | null;

export interface CrmPipeline {
  id: number;
  nome: string;
  descricao?: string | null;
  cor?: string | null;
  ativo?: boolean;
  ordem?: number | null;
  padrao?: boolean;
  stages?: CrmStage[];
}

export interface CrmStage {
  id: number;
  pipeline_id: number;
  nome: string;
  descricao?: string | null;
  cor?: string | null;
  ordem?: number | null;
  tipo_fechamento?: StageTipoFechamento;
  exige_motivo_perda?: boolean;
  ativo?: boolean;
  inicial?: boolean;
}

export interface CrmOrigem {
  id: number;
  nome: string;
  descricao?: string | null;
  cor?: string | null;
  ativo?: boolean;
}

export interface CrmTagRef {
  id: number;
  nome?: string;
  cor?: string | null;
}

export interface CrmLeadListItem {
  id: number;
  nome: string;
  empresa?: string | null;
  telefone?: string | null;
  email?: string | null;
  valor_estimado?: number | string | null;
  probabilidade?: number | null;
  prioridade?: LeadPrioridade | null;
  status?: LeadStatus | string;
  data_proximo_contato?: string | null;
  ultima_interacao_em?: string | null;
  atualizado_em?: string | null;
  stage_id?: number | null;
  pipeline_id?: number | null;
  conversa_id?: number | null;
  cliente_id?: number | null;
  responsavel_id?: number | null;
  origem_id?: number | null;
  pipeline?: CrmPipeline | null;
  stage?: CrmStage | null;
  origem?: CrmOrigem | null;
  responsavel?: { id: number; nome?: string; email?: string } | null;
  conversa?: { id: number } | null;
  cliente?: { id: number; nome?: string } | null;
  totais?: { notas?: number; atividades?: number };
  proxima_atividade?: unknown;
  situacao?: string | null;
}

export interface CrmLeadsListResponse {
  items: CrmLeadListItem[];
  page: number;
  page_size: number;
  total: number;
}

export interface CrmKanbanColumn {
  stage: CrmStage;
  total: number;
  leads: CrmKanbanCard[];
}

export interface CrmKanbanCard {
  id: number;
  nome: string;
  empresa?: string | null;
  telefone?: string | null;
  email?: string | null;
  valor_estimado?: number | string | null;
  probabilidade?: number | null;
  prioridade?: LeadPrioridade | null;
  status?: LeadStatus | string;
  data_proximo_contato?: string | null;
  ultima_interacao_em?: string | null;
  stage_id: number;
  pipeline_id: number;
  tags?: CrmTagRef[];
  responsavel?: { id: number; nome?: string } | null;
}

export interface CrmKanbanResponse {
  pipeline: CrmPipeline;
  columns: CrmKanbanColumn[];
}

export interface CrmNota {
  id: number;
  lead_id?: number;
  texto: string;
  criado_em?: string;
  atualizado_em?: string;
}

export type AtividadeTipo =
  | "ligacao"
  | "reuniao"
  | "whatsapp"
  | "email"
  | "tarefa"
  | "nota"
  | "visita"
  | "proposta"
  | "demo"
  | "outro";

export type AtividadeStatus = "pendente" | "concluida" | "cancelada";

export interface CrmAtividade {
  id: number;
  lead_id?: number;
  tipo: AtividadeTipo;
  titulo: string;
  descricao?: string | null;
  status?: AtividadeStatus;
  data_agendada?: string | null;
  data_fim?: string | null;
  responsavel_id?: number | null;
}

export interface CreateLeadPayload {
  nome: string;
  empresa?: string;
  telefone?: string;
  email?: string;
  valor_estimado?: number;
  probabilidade?: number;
  prioridade?: LeadPrioridade;
  pipeline_id?: number;
  stage_id?: number;
  cliente_id?: number;
  conversa_id?: number;
  responsavel_id?: number | null;
  origem_id?: number;
  data_proximo_contato?: string;
  observacoes?: string;
  tag_ids?: number[];
  vincular_cliente_por_telefone?: boolean;
}

export interface MoveLeadPayload {
  stage_id: number;
  pipeline_id?: number;
  ordem?: number;
  motivo?: string;
  motivo_perda?: string;
  perdido_motivo?: string;
  bloquear_cruzamento_pipeline?: boolean;
  retornar_snapshot?: boolean;
}

export interface CreateAtividadePayload {
  tipo: AtividadeTipo;
  titulo: string;
  descricao?: string;
  status?: AtividadeStatus;
  data_agendada?: string;
  data_fim?: string;
  timezone?: string;
  participantes?: { email: string; nome?: string }[];
  responsavel_id?: number;
  sync_google?: boolean;
}
