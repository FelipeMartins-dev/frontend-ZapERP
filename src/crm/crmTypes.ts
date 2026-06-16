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
  probabilidade_padrao?: number | null;
  tempo_maximo_horas?: number | null;
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
  cpf_cnpj?: string | null;
  telefone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  cidade?: string | null;
  uf?: string | null;
  valor_estimado?: number | string | null;
  valor_ganho?: number | string | null;
  probabilidade?: number | null;
  prioridade?: LeadPrioridade | null;
  temperatura?: "frio" | "morno" | "quente" | null;
  status?: LeadStatus | string;
  data_prevista_fechamento?: string | null;
  data_proximo_contato?: string | null;
  data_proxima_acao?: string | null;
  data_primeiro_contato?: string | null;
  data_ultimo_contato?: string | null;
  data_entrada_stage?: string | null;
  ultima_interacao_em?: string | null;
  atualizado_em?: string | null;
  stage_id?: number | null;
  pipeline_id?: number | null;
  conversa_id?: number | null;
  cliente_id?: number | null;
  responsavel_id?: number | null;
  origem_id?: number | null;
  campanha_id?: number | null;
  motivo_perda_id?: number | null;
  motivo_perda_observacao?: string | null;
  pipeline?: CrmPipeline | null;
  stage?: CrmStage | null;
  origem?: CrmOrigem | null;
  responsavel?: { id: number; nome?: string; email?: string } | null;
  conversa?: { id: number } | null;
  cliente?: { id: number; nome?: string } | null;
  totais?: { notas?: number; atividades?: number };
  proxima_atividade?: unknown;
  situacao?: string | null;
  tags?: CrmTagRef[];
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
  whatsapp?: string | null;
  email?: string | null;
  valor_estimado?: number | string | null;
  valor_ganho?: number | string | null;
  probabilidade?: number | null;
  prioridade?: LeadPrioridade | null;
  temperatura?: "frio" | "morno" | "quente" | null;
  status?: LeadStatus | string;
  data_proximo_contato?: string | null;
  data_proxima_acao?: string | null;
  data_ultimo_contato?: string | null;
  data_entrada_stage?: string | null;
  ultima_interacao_em?: string | null;
  stage_id: number;
  pipeline_id: number;
  tags?: CrmTagRef[];
  responsavel?: { id: number; nome?: string } | null;
  origem?: CrmOrigem | null;
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
  | "demonstracao"
  | "retorno"
  | "outro";

export type AtividadeStatus = "pendente" | "concluida" | "cancelada";
export type AtividadePrioridade = "baixa" | "media" | "alta";

export interface CrmAtividade {
  id: number;
  lead_id?: number;
  tipo: AtividadeTipo;
  titulo: string;
  descricao?: string | null;
  status?: AtividadeStatus;
  prioridade?: AtividadePrioridade;
  data_agendada?: string | null;
  data_fim?: string | null;
  responsavel_id?: number | null;
  resultado?: string | null;
  proximo_passo?: string | null;
}

export interface CreateLeadPayload {
  nome: string;
  empresa?: string;
  cpf_cnpj?: string;
  telefone?: string;
  whatsapp?: string;
  email?: string;
  cidade?: string;
  uf?: string;
  valor_estimado?: number;
  valor_ganho?: number;
  probabilidade?: number;
  prioridade?: LeadPrioridade;
  temperatura?: "frio" | "morno" | "quente";
  pipeline_id?: number;
  stage_id?: number;
  cliente_id?: number;
  conversa_id?: number;
  responsavel_id?: number | null;
  origem_id?: number;
  campanha_id?: number;
  data_prevista_fechamento?: string;
  data_proximo_contato?: string;
  data_proxima_acao?: string;
  observacoes?: string;
  produtos_interesse?: unknown[] | string;
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
  motivo_perda_id?: number | null;
  motivo_perda_observacao?: string;
  valor_ganho?: number;
  bloquear_cruzamento_pipeline?: boolean;
  retornar_snapshot?: boolean;
}

export interface CreateAtividadePayload {
  tipo: AtividadeTipo;
  titulo: string;
  descricao?: string;
  status?: AtividadeStatus;
  prioridade?: AtividadePrioridade;
  data_agendada?: string;
  data_fim?: string;
  timezone?: string;
  participantes?: { email: string; nome?: string }[];
  responsavel_id?: number;
  resultado?: string;
  proximo_passo?: string;
  sync_google?: boolean;
}

export interface CrmTimelineEvent {
  id: number;
  lead_id: number;
  usuario_id?: number | null;
  tipo: string;
  titulo: string;
  descricao?: string | null;
  metadata?: Record<string, unknown>;
  criado_em?: string;
}

export interface CrmCampaign {
  id: number;
  nome: string;
  origem_id?: number | null;
  custo?: number | string | null;
  data_inicio?: string | null;
  data_fim?: string | null;
  ativo?: boolean;
}
