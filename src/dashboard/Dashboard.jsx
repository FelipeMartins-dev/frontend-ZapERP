import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BarChart2,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Filter,
  HelpCircle,
  Inbox,
  MessageSquareText,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Target,
  TimerReset,
  TrendingUp,
  Users,
  XCircle,
  Zap,
} from 'lucide-react'
import * as dashboardApi from '../api/dashboardService'
import { SkeletonGrid } from '../components/feedback/Skeleton'
import '../components/feedback/skeleton.css'
import './dashboard.css'

const TABS = [
  { id: 'overview', label: 'Visão geral' },
  { id: 'relatorios', label: 'Relatórios' },
  { id: 'respostas', label: 'Respostas salvas' },
  { id: 'sla', label: 'SLA' },
  { id: 'sla-diaria', label: 'SLA Diária' },
]

const STATUS_OPTIONS = [
  { value: '', label: 'Todos os status' },
  { value: 'aberta', label: 'Aberta' },
  { value: 'em_atendimento', label: 'Em atendimento' },
  { value: 'aguardando_cliente', label: 'Aguardando cliente' },
  { value: 'fechada', label: 'Fechada' },
  { value: 'finalizada', label: 'Finalizada' },
  { value: 'mensagem_disparada', label: 'Mensagem disparada' },
  { value: 'pagamento_pendente', label: 'Pagamento pendente' },
  { value: 'em_atraso', label: 'Em atraso' },
]

function dateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${map.year}-${map.month}-${map.day}`
}

function defaultPeriod(days = 6) {
  const dataFim = dateKey()
  const [year, month, day] = dataFim.split('-').map(Number)
  const start = new Date(Date.UTC(year, month - 1, day - days, 12))
  return { data_inicio: dateKey(start), data_fim: dataFim }
}

function buildParams(filters = {}) {
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== '' && value !== null && value !== undefined)
  )
}

export default function Dashboard() {
  const [tab, setTab] = useState('overview')
  const [overview, setOverview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [rangeDays, setRangeDays] = useState(7)
  const [loadErr, setLoadErr] = useState('')
  const navigate = useNavigate()

  async function loadDashboard() {
    try {
      setLoading(true)
      setLoadErr('')
      const data = await dashboardApi.getOverview({ range_days: rangeDays })
      setOverview(data)
    } catch (e) {
      console.error('Erro ao carregar dashboard', e)
      setLoadErr(e?.response?.data?.error || 'Erro ao carregar métricas do dashboard.')
      setOverview(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDashboard()
  }, [rangeDays])

  return (
    <div className="dash-wrap">
      <header className="dash-header">
        <div>
          <h1 className="dash-title">Dashboard</h1>
          <p className="dash-subtitle">Operação, relatórios, respostas e SLA com dados reais do ZapERP.</p>
        </div>
        <div className="dash-header-actions">
          <label className="dash-field">
            <span className="dash-field-label">Período</span>
            <select
              className="dash-select"
              value={rangeDays}
              onChange={(e) => setRangeDays(Number(e.target.value) || 0)}
              aria-label="Selecionar período do dashboard"
            >
              <option value={1}>Hoje</option>
              <option value={7}>Últimos 7 dias</option>
              <option value={30}>Últimos 30 dias</option>
              <option value={90}>Últimos 90 dias</option>
              <option value={0}>Tudo</option>
            </select>
          </label>
          <IconButton icon={RefreshCw} label={loading ? 'Atualizando' : 'Atualizar'} onClick={loadDashboard} disabled={loading} />
        </div>
      </header>

      <nav className="dash-tabs" aria-label="Abas do dashboard">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`dash-tab ${tab === t.id ? 'dash-tab--active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="dash-tab-content">
        {tab === 'overview' && (
          <DashboardOverview
            overview={overview}
            loading={loading}
            loadErr={loadErr}
            rangeDays={rangeDays}
            onRefresh={loadDashboard}
          />
        )}
        {tab === 'relatorios' && <DashboardRelatorios />}
        {tab === 'respostas' && <DashboardRespostasSalvas />}
        {tab === 'sla' && <DashboardSLA navigate={navigate} />}
        {tab === 'sla-diaria' && <DashboardSlaDiaria navigate={navigate} />}
      </main>
    </div>
  )
}

function DashboardOverview({ overview, loading, loadErr, rangeDays, onRefresh }) {
  if (loading) {
    return <SkeletonGrid count={6} />
  }

  if (!overview) {
    return (
      <EmptyPanel
        title="Não foi possível carregar o painel"
        text={loadErr || 'Nenhum dado disponível no momento.'}
        action={<IconButton icon={RefreshCw} label="Tentar novamente" onClick={onRefresh} />}
      />
    )
  }

  const {
    kpis = {},
    mensagens_kpis = {},
    mensagens_por_tipo = [],
    conversas_por_setor = [],
    conversas_por_atendente = [],
    conversas_por_status = [],
    conversas_por_hora = [],
    periodo,
    instancia,
    auditoria = {},
  } = overview

  const periodoLabel = !rangeDays ? 'Todo o histórico até agora' : rangeDays === 1 ? 'Hoje (dia local)' : `Últimos ${rangeDays} dias locais, incluindo hoje`
  const ticketsAbertos = kpis.tickets_abertos ?? ((kpis.abertas || 0) + (kpis.em_atendimento || 0))

  return (
    <div className="dash-stack">
      <InfoStrip
        icon={Activity}
        title="Leitura do período"
        text={`KPIs e gráficos abaixo consideram ${periodoLabel}, no fuso ${periodo?.timezone || 'America/Sao_Paulo'}, e a instância ${instancia?.nome || 'WhatsApp principal'}. Indicadores sem base suficiente aparecem sem número calculado.`}
      />

      <section className="dash-kpi-grid" aria-label="Indicadores principais">
        <MetricCard icon={Inbox} label="Atendimentos hoje" value={kpis.atendimentos_hoje ?? 0} hint="Conversas distintas com atividade real de WhatsApp no dia local." />
        <MetricCard icon={TimerReset} label="Tempo médio 1ª resposta" value={formatMin(kpis.tempo_medio_resposta_min ?? kpis.tempo_primeira_resposta_min)} tone="blue" hint="Primeira entrada do cliente até a primeira saída humana válida." />
        <MetricCard icon={ShieldCheck} label="SLA 1ª resposta" value={kpis.sla_percent != null ? `${kpis.sla_percent}%` : 'Sem dados'} tone="green" hint="Somente conversas com resposta válida." />
        <MetricCard icon={Users} label="Atendente destaque" value={kpis.atendente_mais_produtivo || 'Sem dados'} tone="muted" hint="Maior volume de conversas atribuídas." />
        <MetricCard icon={AlertTriangle} label="Tickets abertos agora" value={ticketsAbertos} tone="amber" hint="Fotografia atual: abertas, em atendimento e aguardando cliente; independe do período." />
        <MetricCard icon={Target} label="Taxa de conversão" value={kpis.taxa_conversao_percent != null ? `${kpis.taxa_conversao_percent}%` : 'Sem dados'} tone="green" hint="Exibida só quando houver cálculo confiável." />
      </section>

      <section className="dash-layout-2">
        <Panel title="Volume de mensagens" subtitle="Entrada, saída e tipos de mídia reais no período.">
          <div className="dash-mini-grid">
            <MiniStat label="Total" value={mensagens_kpis.total ?? 0} />
            <MiniStat label="Recebidas" value={mensagens_kpis.in ?? 0} />
            <MiniStat label="Enviadas" value={mensagens_kpis.out ?? 0} />
          </div>
          <div className="dash-mini-grid">
            <MiniStat label="Pelo sistema" value={mensagens_kpis.origens?.sistema_humano ?? 0} />
            <MiniStat label="Pelo celular" value={mensagens_kpis.origens?.whatsapp_celular ?? 0} />
            <MiniStat label="Automações" value={(mensagens_kpis.origens?.automacao ?? 0) + (mensagens_kpis.origens?.bot ?? 0)} />
          </div>
          <BarList
            title="Mensagens por tipo"
            items={(mensagens_por_tipo || []).map((x) => ({ label: prettyTipo(x.tipo), value: Number(x.total || 0) }))}
            emptyText="Sem mensagens no período."
          />
        </Panel>

        <Panel title="Distribuição por setor" subtitle="Onde a demanda se concentrou.">
          <BarList
            title="Conversas por setor"
            items={(conversas_por_setor || []).map((x) => ({ label: x.nome || 'Sem setor', value: Number(x.total || 0) }))}
            emptyText="Sem conversas no período."
          />
          {periodo?.from ? (
            <p className="dash-footnote">
              {formatDateTime(periodo.from)} até {formatDateTime(periodo.to)}
            </p>
          ) : null}
        </Panel>
      </section>

      <section className="dash-layout-2">
        <Panel title="Conversas por atendente" subtitle="Ranking por atribuição de conversa.">
          <BarList
            items={(conversas_por_atendente || []).map((x) => ({ label: x.nome || 'Sem nome', value: Number(x.total || x.total_conversas || 0) }))}
            emptyText="Sem atendentes no período."
          />
        </Panel>
        <Panel title="Conversas por status" subtitle="Status atual das conversas com atividade no período.">
          <BarList
            items={(conversas_por_status || []).map((x) => ({ label: statusLabel(x.status), value: Number(x.total || 0) }))}
            emptyText="Sem conversas no período."
          />
        </Panel>
      </section>

      <Panel title="Conversas por hora" subtitle="Hora local da primeira atividade da conversa dentro do período.">
          <BarList
            items={(conversas_por_hora || []).map((x) => ({ label: x.hora, value: Number(x.total || 0) }))}
            emptyText="Sem conversas no período."
          />
      </Panel>

      {(auditoria.mensagens_duplicadas_excluidas || auditoria.mensagens_invalidas_excluidas || auditoria.mensagens_legadas_sem_instancia) ? (
        <InfoStrip
          icon={ShieldCheck}
          title="Rastreabilidade da consulta"
          text={`${auditoria.mensagens_duplicadas_excluidas || 0} duplicidade(s) excluída(s), ${auditoria.mensagens_invalidas_excluidas || 0} mensagem(ns) inválida(s) excluída(s) e ${auditoria.mensagens_legadas_sem_instancia || 0} registro(s) legado(s) sem instância explícita.`}
        />
      ) : null}
    </div>
  )
}

function DashboardRelatorios() {
  const [relTab, setRelTab] = useState('conversas')
  const [filters, setFilters] = useState({ data_inicio: '', data_fim: '', status_atendimento: '', atendente_id: '', departamento_id: '' })
  const [data, setData] = useState([])
  const [msgRows, setMsgRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(null)
  const [departamentos, setDepartamentos] = useState([])
  const [usuarios, setUsuarios] = useState([])
  const [erro, setErro] = useState('')

  useEffect(() => {
    Promise.all([dashboardApi.getDepartamentos(), dashboardApi.getUsuarios()])
      .then(([dept, usr]) => {
        setDepartamentos(dept || [])
        setUsuarios(usr || [])
      })
      .catch(() => setErro('Erro ao carregar filtros de atendente e setor.'))
  }, [])

  async function carregar() {
    setLoading(true)
    setErro('')
    try {
      const params = buildParams(filters)
      if (relTab === 'conversas') {
        setData(await dashboardApi.getRelatorioConversas(params))
        setMsgRows([])
      } else {
        setMsgRows(await dashboardApi.getRelatorioMensagens(params))
        setData([])
      }
    } catch (e) {
      setErro(e?.response?.data?.error || 'Erro ao carregar relatório.')
      setData([])
      setMsgRows([])
    } finally {
      setLoading(false)
    }
  }

  async function exportar(format) {
    setExporting(format)
    setErro('')
    try {
      await dashboardApi.exportRelatorio(format, buildParams(filters))
    } catch (e) {
      setErro(e?.response?.data?.error || `Erro ao exportar ${format.toUpperCase()}.`)
    } finally {
      setExporting(null)
    }
  }

  const totals = useMemo(() => {
    if (relTab === 'mensagens') {
      return msgRows.reduce((acc, row) => ({
        total: acc.total + Number(row.total || 0),
        in: acc.in + Number(row.in || 0),
        out: acc.out + Number(row.out || 0),
      }), { total: 0, in: 0, out: 0 })
    }
    return { total: data.length }
  }, [relTab, data, msgRows])

  return (
    <div className="dash-stack">
      <div className="dash-segmented" role="tablist" aria-label="Tipos de relatório">
        <button type="button" className={relTab === 'conversas' ? 'is-active' : ''} onClick={() => setRelTab('conversas')}>Conversas</button>
        <button type="button" className={relTab === 'mensagens' ? 'is-active' : ''} onClick={() => setRelTab('mensagens')}>Mensagens</button>
      </div>

      <Panel
        title="Filtros do relatório"
        subtitle={`A exportação usa os mesmos filtros. ${relTab === 'conversas' ? 'O período filtra a data de criação da conversa.' : 'O período filtra a data de envio/recebimento da mensagem em America/São_Paulo.'}`}
      >
        <FilterGrid>
          <input type="date" value={filters.data_inicio} onChange={(e) => setFilters((f) => ({ ...f, data_inicio: e.target.value }))} className="dash-input" aria-label="Data inicial" />
          <input type="date" value={filters.data_fim} onChange={(e) => setFilters((f) => ({ ...f, data_fim: e.target.value }))} className="dash-input" aria-label="Data final" />
          {relTab === 'conversas' ? (
            <>
              <Select value={filters.status_atendimento} onChange={(value) => setFilters((f) => ({ ...f, status_atendimento: value }))} options={STATUS_OPTIONS} />
              <Select value={filters.atendente_id} onChange={(value) => setFilters((f) => ({ ...f, atendente_id: value }))} options={[{ value: '', label: 'Todos os atendentes' }, ...usuarios.map((u) => ({ value: u.id, label: u.nome }))]} />
              <Select value={filters.departamento_id} onChange={(value) => setFilters((f) => ({ ...f, departamento_id: value }))} options={[{ value: '', label: 'Todos os setores' }, ...departamentos.map((d) => ({ value: d.id, label: d.nome }))]} />
            </>
          ) : null}
          <IconButton icon={Search} label={loading ? 'Carregando' : 'Aplicar'} onClick={carregar} disabled={loading} />
        </FilterGrid>
      </Panel>

      {erro ? <AlertBanner type="error" text={erro} onClose={() => setErro('')} /> : null}

      <section className="dash-kpi-grid dash-kpi-grid--compact">
        <MetricCard icon={FileText} label={relTab === 'conversas' ? 'Conversas exibidas' : 'Dias exibidos'} value={relTab === 'conversas' ? totals.total : msgRows.length} />
        {relTab === 'mensagens' ? (
          <>
            <MetricCard icon={MessageSquareText} label="Mensagens" value={totals.total} />
            <MetricCard icon={Inbox} label="Recebidas" value={totals.in} tone="green" />
            <MetricCard icon={Download} label="Enviadas" value={totals.out} tone="blue" />
          </>
        ) : null}
      </section>

      {relTab === 'conversas' ? (
        <div className="dash-toolbar">
          <span className="dash-muted">Exportar conversas</span>
          {['csv', 'xlsx', 'pdf'].map((format) => (
            <IconButton key={format} icon={Download} label={exporting === format ? 'Exportando' : format.toUpperCase()} onClick={() => exportar(format)} disabled={!!exporting} variant="outline" />
          ))}
        </div>
      ) : null}

      <Panel title={relTab === 'conversas' ? 'Tabela de conversas' : 'Tabela de mensagens'}>
        {relTab === 'conversas' ? (
          <Table
            columns={['Cliente', 'Telefone', 'Setor', 'Status', 'Atendente', 'Tags', 'Criado em', 'Min sem responder']}
            emptyText="Aplique os filtros para carregar o relatório."
            rows={data}
            renderRow={(r) => [
              r.cliente_nome || 'Sem dados',
              r.telefone || 'Sem dados',
              r.setor || 'Sem setor',
              statusLabel(r.status_atendimento),
              r.atendente_nome || 'Sem atendente',
              r.tags || 'Sem tags',
              formatDateTime(r.criado_em),
              r.tempo_sem_responder_min != null ? r.tempo_sem_responder_min : 'Sem dados',
            ]}
          />
        ) : (
          <Table
            columns={['Dia', 'Total', 'Recebidas', 'Enviadas', 'Texto', 'Áudio', 'Imagem', 'Vídeo', 'Documento', 'Outros']}
            emptyText="Selecione o período e aplique os filtros."
            rows={msgRows}
            renderRow={(r) => [formatDia(r.dia), r.total ?? 0, r.in ?? 0, r.out ?? 0, r.texto ?? 0, r.audio ?? 0, r.imagem ?? 0, r.video ?? 0, r.documento ?? 0, r.outros ?? 0]}
          />
        )}
      </Panel>
    </div>
  )
}

function DashboardRespostasSalvas() {
  const [departamentos, setDepartamentos] = useState([])
  const [respostas, setRespostas] = useState([])
  const [departamentoId, setDepartamentoId] = useState('')
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ titulo: '', texto: '', departamento_id: '' })
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState('')

  useEffect(() => {
    dashboardApi.getDepartamentos().then(setDepartamentos).catch(() => setErro('Erro ao carregar setores.'))
  }, [])

  useEffect(() => {
    loadRespostas()
  }, [departamentoId])

  async function loadRespostas() {
    setLoading(true)
    setErro('')
    try {
      setRespostas(await dashboardApi.getRespostasSalvas(departamentoId || null))
    } catch (e) {
      setRespostas([])
      setErro(e?.response?.data?.error || 'Erro ao carregar respostas salvas.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.titulo?.trim() || !form.texto?.trim()) return
    setSaving(true)
    setErro('')
    setOk('')
    try {
      await dashboardApi.criarRespostaSalva({
        titulo: form.titulo.trim(),
        texto: form.texto.trim(),
        departamento_id: form.departamento_id || null,
      })
      setForm({ titulo: '', texto: '', departamento_id: '' })
      setOk('Resposta salva criada com sucesso.')
      loadRespostas()
    } catch (err) {
      setErro(err?.response?.data?.error || 'Erro ao salvar resposta.')
    } finally {
      setSaving(false)
    }
  }

  const globais = respostas.filter((r) => !r.departamento_id).length
  const setoriais = respostas.length - globais

  return (
    <div className="dash-stack">
      {(erro || ok) ? <AlertBanner type={ok ? 'success' : 'error'} text={erro || ok} onClose={() => { setErro(''); setOk('') }} /> : null}

      <section className="dash-kpi-grid dash-kpi-grid--compact">
        <MetricCard icon={MessageSquareText} label="Respostas salvas" value={respostas.length} />
        <MetricCard icon={Users} label="Globais" value={globais} tone="green" />
        <MetricCard icon={Filter} label="Por setor" value={setoriais} tone="blue" />
      </section>

      <InfoStrip
        icon={HelpCircle}
        title="Uso de respostas salvas: sem dados confiáveis"
        text="O ZapERP ainda não persiste qual resposta salva originou uma mensagem enviada. A biblioteca é exibida, mas nenhum ranking de uso é calculado por comparação de texto."
      />

      <section className="dash-layout-2 dash-layout-2--wide-left">
        <Panel title="Nova resposta salva" subtitle="Disponível por empresa, com vínculo opcional por setor.">
          <form onSubmit={handleSubmit} className="dash-form">
            <input type="text" placeholder="Título" value={form.titulo} onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))} className="dash-input" required />
            <Select value={form.departamento_id} onChange={(value) => setForm((f) => ({ ...f, departamento_id: value }))} options={[{ value: '', label: 'Todos os setores' }, ...departamentos.map((d) => ({ value: d.id, label: d.nome }))]} />
            <textarea placeholder="Texto da resposta" value={form.texto} onChange={(e) => setForm((f) => ({ ...f, texto: e.target.value }))} className="dash-textarea" rows={6} required />
            <IconButton icon={Save} label={saving ? 'Salvando' : 'Salvar resposta'} disabled={saving} type="submit" />
          </form>
        </Panel>

        <Panel title="Biblioteca" subtitle="Filtro por setor sem inventar ranking de uso.">
          <Select value={departamentoId} onChange={setDepartamentoId} options={[{ value: '', label: 'Todos os setores' }, ...departamentos.map((d) => ({ value: d.id, label: d.nome }))]} />
          {loading ? (
            <p className="dash-muted">Carregando respostas...</p>
          ) : respostas.length === 0 ? (
            <EmptyInline text="Nenhuma resposta salva para o filtro selecionado." />
          ) : (
            <ul className="dash-response-list">
              {respostas.map((r) => (
                <li key={r.id} className="dash-response-item">
                  <div>
                    <strong>{r.titulo}</strong>
                    <span>{r.departamentos?.nome || 'Todos os setores'}</span>
                  </div>
                  <p>{r.texto}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>
    </div>
  )
}

function DashboardSLA({ navigate }) {
  const [filters, setFilters] = useState({ ...defaultPeriod(), atendente_id: '', departamento_id: '', status_atendimento: '' })
  const [data, setData] = useState(null)
  const [config, setConfig] = useState({
    sla_minutos_sem_resposta: 30,
    sla_meta_percentual: 90,
    sla_usar_horario_comercial: false,
    sla_contar_bot_como_resposta: false,
  })
  const [configDraft, setConfigDraft] = useState(null)
  const [departamentos, setDepartamentos] = useState([])
  const [usuarios, setUsuarios] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [validacaoId, setValidacaoId] = useState('')
  const [validacao, setValidacao] = useState(null)
  const [validando, setValidando] = useState(false)
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState('')

  useEffect(() => {
    Promise.all([dashboardApi.getDepartamentos(), dashboardApi.getUsuarios(), dashboardApi.getSlaConfig()])
      .then(([dept, users, cfg]) => {
        setDepartamentos(dept || [])
        setUsuarios(users || [])
        const merged = cfg || { sla_minutos_sem_resposta: 30 }
        setConfig(merged)
        setConfigDraft({
          sla_minutos_sem_resposta: String(merged.sla_minutos_sem_resposta ?? 30),
          sla_meta_percentual: String(merged.sla_meta_percentual ?? 90),
          sla_usar_horario_comercial: merged.sla_usar_horario_comercial === true,
          sla_contar_bot_como_resposta: merged.sla_contar_bot_como_resposta === true,
          metas_departamentos: (dept || []).map((d) => ({
            departamento_id: d.id,
            nome: d.nome,
            sla_minutos_sem_resposta: merged.metas_departamentos?.[String(d.id)] ?? '',
          })),
          metas_usuarios: (users || []).map((u) => ({
            usuario_id: u.id,
            nome: u.nome,
            sla_minutos_sem_resposta: merged.metas_usuarios?.[String(u.id)] ?? '',
          })),
        })
      })
      .catch(() => setErro('Erro ao carregar filtros e configuração de SLA.'))
    loadSla()
  }, [])

  async function loadSla(nextFilters = filters) {
    setLoading(true)
    setErro('')
    try {
      setData(await dashboardApi.getSlaResumo(buildParams(nextFilters)))
    } catch (e) {
      setData(null)
      setErro(e?.response?.data?.error || 'Erro ao carregar SLA.')
    } finally {
      setLoading(false)
    }
  }

  async function salvarSla() {
    if (!configDraft) return
    setSaving(true)
    setErro('')
    setOk('')
    try {
      const saved = await dashboardApi.setSlaConfig({
        sla_minutos_sem_resposta: Math.max(1, Math.min(1440, parseInt(configDraft.sla_minutos_sem_resposta, 10) || 30)),
        sla_meta_percentual: Math.max(1, Math.min(100, parseInt(configDraft.sla_meta_percentual, 10) || 90)),
        sla_usar_horario_comercial: configDraft.sla_usar_horario_comercial === true,
        sla_contar_bot_como_resposta: configDraft.sla_contar_bot_como_resposta === true,
        metas_departamentos: configDraft.metas_departamentos || [],
        metas_usuarios: configDraft.metas_usuarios || [],
      })
      setConfig(saved)
      setConfigDraft({
        sla_minutos_sem_resposta: String(saved.sla_minutos_sem_resposta ?? 30),
        sla_meta_percentual: String(saved.sla_meta_percentual ?? 90),
        sla_usar_horario_comercial: saved.sla_usar_horario_comercial === true,
        sla_contar_bot_como_resposta: saved.sla_contar_bot_como_resposta === true,
        metas_departamentos: departamentos.map((d) => ({
          departamento_id: d.id,
          nome: d.nome,
          sla_minutos_sem_resposta: saved.metas_departamentos?.[String(d.id)] ?? '',
        })),
        metas_usuarios: usuarios.map((u) => ({
          usuario_id: u.id,
          nome: u.nome,
          sla_minutos_sem_resposta: saved.metas_usuarios?.[String(u.id)] ?? '',
        })),
      })
      setOk('Configuração de SLA salva.')
      loadSla()
    } catch (e) {
      setErro(e?.response?.data?.error || 'Erro ao salvar configuração de SLA.')
    } finally {
      setSaving(false)
    }
  }

  async function exportarSla(format, tipo = 'detalhado') {
    setExporting(true)
    try {
      await dashboardApi.exportSla(format, buildParams(filters), tipo)
    } catch (e) {
      setErro(e?.response?.data?.error || 'Erro ao exportar SLA.')
    } finally {
      setExporting(false)
    }
  }

  async function validarConversa() {
    const id = parseInt(validacaoId, 10)
    if (!id) return
    setValidando(true)
    setValidacao(null)
    try {
      setValidacao(await dashboardApi.validateSlaConversa(id))
    } catch (e) {
      setErro(e?.response?.data?.error || 'Erro ao validar conversa.')
    } finally {
      setValidando(false)
    }
  }

  const resumo = data?.resumo || {}
  const limiteMin = data?.limite_min ?? config.sla_minutos_sem_resposta ?? 30
  const metaPct = data?.meta_percentual ?? config.sla_meta_percentual ?? 90
  const horarioInfo = data?.horario_comercial || config.horario_comercial

  return (
    <div className="dash-stack dash-sla-page">
      <SlaPageHeader
        icon={Zap}
        title="SLA de primeira resposta"
        description="Métricas confiáveis com exclusão de bot/automação, horário comercial opcional e metas por empresa, setor ou atendente."
      />

      {(erro || ok) ? <AlertBanner type={ok ? 'success' : 'error'} text={erro || ok} onClose={() => { setErro(''); setOk('') }} /> : null}

      <Panel title="Filtros de SLA" subtitle="Refine por período, atendente, setor ou status da conversa." className="dash-sla-panel-filters">
        <SlaFilters filters={filters} setFilters={setFilters} usuarios={usuarios} departamentos={departamentos} onApply={() => loadSla()} loading={loading} />
      </Panel>

      {configDraft ? (
        <SlaConfigPanel
          draft={configDraft}
          setDraft={setConfigDraft}
          onSave={salvarSla}
          saving={saving}
          horarioInfo={horarioInfo}
          departamentos={departamentos}
          usuarios={usuarios}
          config={config}
        />
      ) : null}

      {loading ? (
        <SkeletonGrid count={6} />
      ) : !data ? (
        <EmptyPanel icon={Zap} title="SLA indisponível" text="Não foi possível carregar os dados. Ajuste os filtros e clique em Aplicar para tentar novamente." />
      ) : (
        <>
          <SlaSummaryBanner
            percentual={resumo.percentual_cumprido}
            limiteMin={limiteMin}
            totalAnalisadas={resumo.total_analisadas ?? 0}
            dentroSla={resumo.dentro_sla ?? 0}
            foraSla={resumo.fora_sla ?? 0}
          />

          {data.tendencia ? <SlaTrendBadge tendencia={data.tendencia} /> : null}

          {horarioInfo?.resumo ? (
            <InfoStrip icon={Clock} title={`Modo de contagem: ${horarioInfo.modo_contagem === 'horario_comercial' ? 'Horário comercial' : 'Tempo corrido'}`} text={horarioInfo.resumo} />
          ) : null}

          <SlaTipoBreakdown porTipo={data.por_tipo} resumo={resumo} metaPct={metaPct} limiteMin={limiteMin} />

          <section className="dash-kpi-grid dash-sla-kpi-grid dash-sla-kpi-grid--wide">
            <MetricCard icon={FileText} label="Conversas analisadas" value={resumo.total_analisadas ?? 0} tone="blue" />
            <MetricCard icon={CheckCircle2} label="Dentro do SLA" value={resumo.dentro_sla ?? 0} tone="green" />
            <MetricCard icon={XCircle} label="Fora do SLA" value={resumo.fora_sla ?? 0} tone="red" />
            <MetricCard icon={AlertTriangle} label="Aguardando 1ª resposta" value={resumo.sem_resposta ?? 0} tone="amber" hint="Exibidas separadamente; não elevam silenciosamente o total analisado." />
            <MetricCard icon={HelpCircle} label="Dados insuficientes" value={resumo.dados_insuficientes ?? 0} tone="muted" hint="Registros sem base temporal válida para cálculo." />
            <MetricCard icon={TimerReset} label="Tempo médio 1ª resp." value={formatMin(resumo.tempo_medio_primeira_resposta_min)} tone="blue" />
            <MetricCard icon={TrendingUp} label="Melhor tempo" value={formatMin(resumo.melhor_tempo_resposta_min)} tone="green" />
            <MetricCard icon={TrendingUp} label="Pior tempo" value={formatMin(resumo.pior_tempo_resposta_min)} tone="red" />
            <MetricCard icon={Target} label="% cumprimento" value={resumo.percentual_cumprido != null ? `${resumo.percentual_cumprido}%` : 'Sem dados'} tone="green" />
            <MetricCard icon={Clock} label="Meta configurada" value={`${limiteMin} min`} hint={`Referência ${metaPct}%`} />
          </section>

          <div className="dash-sla-export-bar">
            <div className="dash-sla-export-copy">
              <Download size={18} aria-hidden="true" />
              <div>
                <strong>Exportar dados de SLA</strong>
                <span>Mesmos filtros da tela — resumo ou lista detalhada (CSV/XLSX).</span>
              </div>
            </div>
            <div className="dash-sla-export-actions">
              <IconButton icon={Download} label={exporting ? 'Exportando' : 'CSV detalhado'} onClick={() => exportarSla('csv', 'detalhado')} variant="outline" disabled={exporting} />
              <IconButton icon={Download} label="XLSX detalhado" onClick={() => exportarSla('xlsx', 'detalhado')} variant="outline" disabled={exporting} />
              <IconButton icon={Download} label="CSV resumo" onClick={() => exportarSla('csv', 'resumo')} variant="outline" disabled={exporting} />
            </div>
          </div>

          <section className="dash-layout-2">
            <Panel title="Melhor SLA por atendente" subtitle="Maior percentual de cumprimento.">
              <SlaRankingList rows={data.ranking_atendentes_melhor} />
            </Panel>
            <Panel title="Mais violações por atendente" subtitle="Maior quantidade de conversas fora do SLA.">
              <SlaViolationRankingList rows={data.ranking_atendentes_violacoes} />
            </Panel>
          </section>

          <section className="dash-layout-2">
            <Panel title="Ranking por setor" subtitle="Comparativo de cumprimento entre departamentos.">
              <SlaRankingList rows={data.ranking_setores} />
            </Panel>
            <Panel title="Horários com mais violações" subtitle="Baseado na hora da primeira mensagem do cliente.">
              <SlaHourRanking rows={data.horarios_maior_violacao} />
            </Panel>
          </section>

          <Panel title="Dias da semana com pior SLA" subtitle="Concentração de violações por dia da semana.">
            <SlaWeekdayRanking rows={data.dias_semana_pior_sla} />
          </Panel>

          {(data.criticas_sem_resposta || []).length > 0 ? (
            <Panel title="Conversas críticas sem resposta" subtitle="Abertas/em atendimento acima da meta — requerem ação." className="dash-sla-panel-danger">
              <SlaDetailedTable rows={data.criticas_sem_resposta} onOpen={(id) => navigate('/atendimento', { state: { openConversaId: id } })} />
            </Panel>
          ) : null}

          <Panel title="Lista detalhada de conversas" subtitle="Todas as categorias: cumpriu, violou, sem resposta e dados insuficientes." className="dash-sla-panel-danger">
            <SlaDetailedTable rows={data.conversas_detalhadas || data.violacoes} onOpen={(id) => navigate('/atendimento', { state: { openConversaId: id } })} />
          </Panel>

          {(data.reabertura || []).length > 0 ? (
            <Panel title="SLA após reabertura" subtitle="Conversas reabertas por falta de interação — ciclo separado da primeira resposta.">
              <SlaDetailedTable rows={data.reabertura} onOpen={(id) => navigate('/atendimento', { state: { openConversaId: id } })} />
            </Panel>
          ) : null}

          <Panel title="Validar SLA de uma conversa" subtitle="Conferência manual: compare passo a passo com o banco de dados.">
            <div className="dash-sla-validacao">
              <div className="dash-sla-config-input-row">
                <input type="number" className="dash-input" placeholder="ID da conversa" value={validacaoId} onChange={(e) => setValidacaoId(e.target.value)} aria-label="ID da conversa para validação" />
                <IconButton icon={Search} label={validando ? 'Validando' : 'Validar'} onClick={validarConversa} disabled={validando || !validacaoId} />
              </div>
              {validacao ? (
                <div className="dash-sla-validacao-result">
                  <p><strong>Status:</strong> <SlaStatusBadge status={validacao.resultado?.status_sla} /> · Meta: {validacao.config?.limite_min} min ({validacao.config?.meta_origem_label})</p>
                  <ol className="dash-sla-validacao-steps">
                    {(validacao.passos_validacao || []).map((p) => (
                      <li key={p.passo}>
                        <strong>Passo {p.passo}:</strong> {p.descricao}
                        {p.em ? ` — ${formatDateTime(p.em)}` : ''}
                        {p.minutos != null ? ` — ${p.minutos} min (${p.status_sla})` : ''}
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
            </div>
          </Panel>
        </>
      )}
    </div>
  )
}

function DashboardSlaDiaria({ navigate }) {
  const [filters, setFilters] = useState({ ...defaultPeriod(), atendente_id: '', departamento_id: '', status_atendimento: '' })
  const [data, setData] = useState(null)
  const [diaSelecionado, setDiaSelecionado] = useState(null)
  const [diaDetalhe, setDiaDetalhe] = useState(null)
  const [loadingDia, setLoadingDia] = useState(false)
  const [departamentos, setDepartamentos] = useState([])
  const [usuarios, setUsuarios] = useState([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    Promise.all([dashboardApi.getDepartamentos(), dashboardApi.getUsuarios()])
      .then(([dept, users]) => {
        setDepartamentos(dept || [])
        setUsuarios(users || [])
      })
      .catch(() => setErro('Erro ao carregar filtros.'))
    load()
  }, [])

  async function load(nextFilters = filters) {
    setLoading(true)
    setErro('')
    setDiaSelecionado(null)
    setDiaDetalhe(null)
    try {
      setData(await dashboardApi.getSlaDiaria(buildParams(nextFilters)))
    } catch (e) {
      setData(null)
      setErro(e?.response?.data?.error || 'Erro ao carregar SLA diária.')
    } finally {
      setLoading(false)
    }
  }

  async function abrirDia(dia) {
    if (!dia) return
    setDiaSelecionado(dia)
    setLoadingDia(true)
    try {
      const detalhe = await dashboardApi.getSlaResumo(buildParams({ ...filters, dia }))
      setDiaDetalhe(detalhe)
    } catch (e) {
      setErro(e?.response?.data?.error || 'Erro ao carregar detalhe do dia.')
      setDiaDetalhe(null)
    } finally {
      setLoadingDia(false)
    }
  }

  async function exportar(format, tipo = 'detalhado') {
    setExporting(true)
    try {
      const params = diaSelecionado ? { ...buildParams(filters), dia: diaSelecionado } : buildParams(filters)
      await dashboardApi.exportSla(format, params, tipo)
    } catch (e) {
      setErro(e?.response?.data?.error || 'Erro ao exportar.')
    } finally {
      setExporting(false)
    }
  }

  const rows = data?.diario || []
  const metaPct = data?.meta_percentual ?? 90

  return (
    <div className="dash-stack dash-sla-diaria-page">
      <SlaPageHeader
        icon={TrendingUp}
        title="SLA diária"
        description="Comparativo dia a dia com meta configurável. Clique em um dia para ver as conversas daquela data."
      />

      {erro ? <AlertBanner type="error" text={erro} onClose={() => setErro('')} /> : null}

      <Panel title="Filtros da SLA diária" subtitle="Selecione o intervalo e recorte por atendente, setor ou status." className="dash-sla-panel-filters">
        <SlaFilters filters={filters} setFilters={setFilters} usuarios={usuarios} departamentos={departamentos} onApply={() => load()} loading={loading} />
      </Panel>

      {loading ? (
        <SkeletonGrid count={4} />
      ) : !data ? (
        <EmptyPanel icon={CalendarDays} title="SLA diária indisponível" text="Não foi possível carregar a evolução diária. Ajuste os filtros e clique em Aplicar para tentar novamente." />
      ) : (
        <>
          <section className="dash-kpi-grid dash-kpi-grid--compact dash-sla-kpi-grid">
            <MetricCard icon={CalendarDays} label="Dias no período" value={rows.length} />
            <MetricCard icon={FileText} label="Conversas analisadas" value={data.resumo?.total_analisadas ?? 0} tone="blue" />
            <MetricCard icon={Target} label="Percentual cumprido" value={data.resumo?.percentual_cumprido != null ? `${data.resumo.percentual_cumprido}%` : 'Sem dados'} tone="green" />
            <MetricCard icon={TimerReset} label="Tempo médio" value={formatMin(data.resumo?.tempo_medio_primeira_resposta_min)} tone="blue" />
          </section>

          {(data.melhor_dia || data.pior_dia) ? (
            <section className="dash-layout-2">
              <Panel title="Melhor dia" subtitle="Maior percentual de cumprimento no período." className="dash-sla-day-card dash-sla-day-card--good">
                {data.melhor_dia ? (
                  <button type="button" className="dash-sla-day-btn" onClick={() => abrirDia(data.melhor_dia.dia)}>
                    <strong>{formatDia(data.melhor_dia.dia)}</strong>
                    <span>{data.melhor_dia.percentual_cumprido ?? '—'}% · {data.melhor_dia.dentro_sla}/{data.melhor_dia.total_analisadas} dentro</span>
                  </button>
                ) : <EmptyInline text="Sem dados." />}
              </Panel>
              <Panel title="Pior dia" subtitle="Menor percentual de cumprimento no período." className="dash-sla-day-card dash-sla-day-card--bad">
                {data.pior_dia ? (
                  <button type="button" className="dash-sla-day-btn" onClick={() => abrirDia(data.pior_dia.dia)}>
                    <strong>{formatDia(data.pior_dia.dia)}</strong>
                    <span>{data.pior_dia.percentual_cumprido ?? '—'}% · {data.pior_dia.fora_sla} violações</span>
                  </button>
                ) : <EmptyInline text="Sem dados." />}
              </Panel>
            </section>
          ) : null}

          <Panel title="Evolução diária" subtitle={`Clique em um dia para detalhar conversas. Meta: ${metaPct}%.`} className="dash-sla-panel-chart">
            <DailySlaChart rows={rows} meta={metaPct} selectedDay={diaSelecionado} onDayClick={abrirDia} />
          </Panel>

          <div className="dash-sla-export-bar">
            <div className="dash-sla-export-copy">
              <Download size={18} aria-hidden="true" />
              <div>
                <strong>Exportar relatório</strong>
                <span>{diaSelecionado ? `Dia ${formatDia(diaSelecionado)} selecionado` : 'Período completo'} — CSV/XLSX via backend.</span>
              </div>
            </div>
            <div className="dash-sla-export-actions">
              <IconButton icon={Download} label={exporting ? 'Exportando' : 'CSV'} onClick={() => exportar('csv')} variant="outline" disabled={exporting || rows.length === 0} />
              <IconButton icon={Download} label="XLSX" onClick={() => exportar('xlsx')} variant="outline" disabled={exporting || rows.length === 0} />
            </div>
          </div>

          <Panel title="Tabela diária" subtitle="Dias abaixo da meta ficam destacados em amarelo.">
            <Table
              columns={['Data', 'Analisadas', 'Dentro SLA', 'Fora SLA', '% cumprido', 'Média 1ª resp.', 'Pior tempo', 'Melhor tempo', 'Sem resp.', 'Dados insuf.', '']}
              rows={rows}
              emptyText="Nenhum dia com dados para os filtros aplicados."
              rowClassName={(r) => {
                if (r.dia === diaSelecionado) return 'is-selected'
                if (r.percentual_cumprido != null && r.percentual_cumprido < metaPct) return 'is-warning'
                return ''
              }}
              renderRow={(r) => [
                formatDia(r.dia),
                r.total_analisadas ?? 0,
                r.dentro_sla ?? 0,
                r.fora_sla ?? 0,
                r.percentual_cumprido != null ? `${r.percentual_cumprido}%` : 'Sem dados',
                formatMin(r.tempo_medio_primeira_resposta_min),
                formatMin(r.pior_tempo_resposta_min),
                formatMin(r.melhor_tempo_resposta_min),
                r.sem_resposta ?? 0,
                r.dados_insuficientes ?? 0,
                <button type="button" className="dash-link-btn" onClick={() => abrirDia(r.dia)}>Ver dia</button>,
              ]}
            />
          </Panel>

          {diaSelecionado ? (
            <Panel title={`Conversas do dia ${formatDia(diaSelecionado)}`} subtitle="Detalhamento das conversas cuja primeira mensagem do cliente foi nesta data.">
              {loadingDia ? <SkeletonGrid count={2} /> : (
                <SlaDetailedTable rows={diaDetalhe?.conversas_detalhadas || []} onOpen={(id) => navigate('/atendimento', { state: { openConversaId: id } })} />
              )}
            </Panel>
          ) : null}

          <section className="dash-layout-2">
            <Panel title="Detalhe por atendente" subtitle="Consolidado do período filtrado.">
              <SlaRankingList rows={data.ranking_atendentes} />
            </Panel>
            <Panel title="Detalhe por setor" subtitle="Consolidado do período filtrado.">
              <SlaRankingList rows={data.ranking_setores} />
            </Panel>
          </section>
        </>
      )}
    </div>
  )
}

function SlaFilters({ filters, setFilters, usuarios, departamentos, onApply, loading }) {
  return (
    <div className="dash-sla-filters">
      <div className="dash-filter-grid dash-sla-filter-grid">
        <label className="dash-filter-field">
          <span className="dash-filter-label">Data inicial</span>
          <input type="date" value={filters.data_inicio} onChange={(e) => setFilters((f) => ({ ...f, data_inicio: e.target.value }))} className="dash-input" />
        </label>
        <label className="dash-filter-field">
          <span className="dash-filter-label">Data final</span>
          <input type="date" value={filters.data_fim} onChange={(e) => setFilters((f) => ({ ...f, data_fim: e.target.value }))} className="dash-input" />
        </label>
        <label className="dash-filter-field">
          <span className="dash-filter-label">Atendente</span>
          <Select value={filters.atendente_id} onChange={(value) => setFilters((f) => ({ ...f, atendente_id: value }))} options={[{ value: '', label: 'Todos os atendentes' }, ...usuarios.map((u) => ({ value: u.id, label: u.nome }))]} />
        </label>
        <label className="dash-filter-field">
          <span className="dash-filter-label">Setor</span>
          <Select value={filters.departamento_id} onChange={(value) => setFilters((f) => ({ ...f, departamento_id: value }))} options={[{ value: '', label: 'Todos os setores' }, ...departamentos.map((d) => ({ value: d.id, label: d.nome }))]} />
        </label>
        <label className="dash-filter-field">
          <span className="dash-filter-label">Status</span>
          <Select value={filters.status_atendimento} onChange={(value) => setFilters((f) => ({ ...f, status_atendimento: value }))} options={STATUS_OPTIONS} />
        </label>
        <div className="dash-filter-field dash-filter-field--action">
          <span className="dash-filter-label" aria-hidden="true">&nbsp;</span>
          <IconButton icon={Search} label={loading ? 'Carregando' : 'Aplicar filtros'} onClick={onApply} disabled={loading} />
        </div>
      </div>
    </div>
  )
}

function SlaConfigPanel({ draft, setDraft, onSave, saving, horarioInfo, departamentos = [], usuarios = [] }) {
  function updateDeptMeta(id, value) {
    setDraft((d) => ({
      ...d,
      metas_departamentos: (d.metas_departamentos || []).map((item) => (
        item.departamento_id === id ? { ...item, sla_minutos_sem_resposta: value } : item
      )),
    }))
  }

  function updateUserMeta(id, value) {
    setDraft((d) => ({
      ...d,
      metas_usuarios: (d.metas_usuarios || []).map((item) => (
        item.usuario_id === id ? { ...item, sla_minutos_sem_resposta: value } : item
      )),
    }))
  }

  return (
    <section className="dash-sla-config-panel">
      <Panel title="Configuração avançada de SLA" subtitle="Meta global, horário comercial, regras de contagem e metas opcionais por setor ou atendente.">
        <div className="dash-sla-config-grid">
          <label className="dash-filter-field">
            <span className="dash-filter-label">Meta global (minutos)</span>
            <input type="number" min={1} max={1440} className="dash-input" value={draft.sla_minutos_sem_resposta} onChange={(e) => setDraft((d) => ({ ...d, sla_minutos_sem_resposta: e.target.value }))} />
          </label>
          <label className="dash-filter-field">
            <span className="dash-filter-label">Meta percentual (%)</span>
            <input type="number" min={1} max={100} className="dash-input" value={draft.sla_meta_percentual} onChange={(e) => setDraft((d) => ({ ...d, sla_meta_percentual: e.target.value }))} />
          </label>
          <label className="dash-sla-check">
            <input type="checkbox" checked={draft.sla_usar_horario_comercial} onChange={(e) => setDraft((d) => ({ ...d, sla_usar_horario_comercial: e.target.checked }))} />
            <span>Usar horário comercial no cálculo</span>
          </label>
          <label className="dash-sla-check">
            <input type="checkbox" checked={draft.sla_contar_bot_como_resposta} onChange={(e) => setDraft((d) => ({ ...d, sla_contar_bot_como_resposta: e.target.checked }))} />
            <span>Contar bot/automação como primeira resposta</span>
          </label>
        </div>

        {(draft.metas_departamentos || []).length > 0 ? (
          <details className="dash-sla-meta-details">
            <summary>Metas por setor (opcional — vazio herda a meta global)</summary>
            <div className="dash-sla-meta-list">
              {(draft.metas_departamentos || []).map((item) => (
                <label key={item.departamento_id} className="dash-sla-meta-row">
                  <span>{item.nome}</span>
                  <input type="number" min={1} max={1440} className="dash-input dash-input--short" placeholder="Global" value={item.sla_minutos_sem_resposta} onChange={(e) => updateDeptMeta(item.departamento_id, e.target.value)} />
                  <span className="dash-sla-config-unit">min</span>
                </label>
              ))}
            </div>
          </details>
        ) : null}

        {(draft.metas_usuarios || []).length > 0 ? (
          <details className="dash-sla-meta-details">
            <summary>Metas por atendente (opcional — vazio herda setor ou global)</summary>
            <div className="dash-sla-meta-list">
              {(draft.metas_usuarios || []).slice(0, 20).map((item) => (
                <label key={item.usuario_id} className="dash-sla-meta-row">
                  <span>{item.nome}</span>
                  <input type="number" min={1} max={1440} className="dash-input dash-input--short" placeholder="Herdar" value={item.sla_minutos_sem_resposta} onChange={(e) => updateUserMeta(item.usuario_id, e.target.value)} />
                  <span className="dash-sla-config-unit">min</span>
                </label>
              ))}
            </div>
          </details>
        ) : null}

        <div className="dash-sla-config-actions">
          <IconButton icon={Save} label={saving ? 'Salvando' : 'Salvar configuração'} onClick={onSave} disabled={saving} />
        </div>
        {horarioInfo?.resumo ? <p className="dash-sla-config-hint">{horarioInfo.resumo}</p> : null}
      </Panel>
      <InfoStrip icon={ShieldCheck} title="Critério seguro" text="Bot, URA e mensagens automáticas não contam como primeira resposta humana, salvo se você ativar a opção acima. Conversas sem resposta humana não entram como violação." />
    </section>
  )
}

function SlaStatusBadge({ status }) {
  const map = {
    cumpriu: { label: 'Cumpriu', className: 'dash-sla-badge dash-sla-badge--green' },
    violou: { label: 'Violou', className: 'dash-sla-badge dash-sla-badge--red' },
    sem_resposta: { label: 'Sem resposta', className: 'dash-sla-badge dash-sla-badge--amber' },
    dados_insuficientes: { label: 'Dados insuficientes', className: 'dash-sla-badge dash-sla-badge--muted' },
  }
  const item = map[status] || { label: status || '—', className: 'dash-sla-badge' }
  return <span className={item.className}>{item.label}</span>
}

function SlaTrendBadge({ tendencia }) {
  if (!tendencia) return null
  const variacao = tendencia.variacao_percentual
  const Icon = tendencia.direcao === 'subiu' ? ArrowUp : tendencia.direcao === 'caiu' ? ArrowDown : BarChart2
  const tone = tendencia.direcao === 'subiu' ? 'good' : tendencia.direcao === 'caiu' ? 'bad' : 'neutral'
  return (
    <div className={`dash-sla-trend dash-sla-trend--${tone}`}>
      <Icon size={18} aria-hidden="true" />
      <div>
        <strong>Tendência vs período anterior</strong>
        <span>
          {tendencia.percentual_anterior != null ? `${tendencia.percentual_anterior}%` : '—'} → {tendencia.periodo_anterior ? `${formatDia(tendencia.periodo_anterior.data_inicio)} a ${formatDia(tendencia.periodo_anterior.data_fim)}` : ''}
          {variacao != null ? ` · ${variacao > 0 ? '+' : ''}${variacao} p.p.` : ''}
        </span>
      </div>
    </div>
  )
}

function SlaTipoBreakdown({ porTipo, resumo, metaPct, limiteMin }) {
  const pr = porTipo?.primeira_resposta || {}
  const reab = porTipo?.reabertura || {}
  return (
    <section className="dash-sla-tipo-grid">
      <article className="dash-sla-tipo-card">
        <h3>1ª resposta</h3>
        <p>{pr.analisadas ?? 0} analisadas · meta {limiteMin} min</p>
        <div className="dash-sla-tipo-stats">
          <span className="dash-sla-chip dash-sla-chip--green">{pr.dentro_sla ?? 0} dentro</span>
          <span className="dash-sla-chip dash-sla-chip--red">{pr.fora_sla ?? 0} fora</span>
          <span className="dash-sla-chip dash-sla-chip--amber">{pr.sem_resposta ?? 0} sem resp.</span>
        </div>
      </article>
      <article className="dash-sla-tipo-card">
        <h3>Reabertura</h3>
        <p>{reab.total ?? 0} ciclos · meta ref. {metaPct}%</p>
        <div className="dash-sla-tipo-stats">
          <span className="dash-sla-chip dash-sla-chip--green">{reab.dentro_sla ?? 0} dentro</span>
          <span className="dash-sla-chip dash-sla-chip--red">{reab.fora_sla ?? 0} fora</span>
        </div>
      </article>
      <article className="dash-sla-tipo-card">
        <h3>Tipo de resposta</h3>
        <p>Classificação no período</p>
        <div className="dash-sla-tipo-stats">
          <span className="dash-sla-chip dash-sla-chip--green">{resumo.resposta_humana ?? porTipo?.resposta_humana ?? 0} humana</span>
          <span className="dash-sla-chip dash-sla-chip--muted">{resumo.resposta_automacao ?? porTipo?.resposta_automacao ?? 0} automação</span>
        </div>
      </article>
    </section>
  )
}

function SlaDetailedTable({ rows = [], onOpen, showOpen = true }) {
  return (
    <Table
      columns={['Cliente', 'Telefone', 'Atendente', 'Setor', '1ª msg cliente', '1ª resposta', 'Tempo', 'Meta', 'Origem meta', 'Status SLA', 'Conversa', ...(showOpen ? [''] : [])]}
      rows={rows}
      emptyText="Nenhuma conversa para exibir."
      rowClassName={(r) => (r.status_sla === 'violou' ? 'is-warning' : '')}
      renderRow={(r) => [
        r.cliente_nome,
        r.telefone || '—',
        r.atendente_nome || '—',
        r.setor || '—',
        formatDateTime(r.primeira_mensagem_cliente_em),
        formatDateTime(r.primeira_resposta_em || r.primeira_resposta_atendente_em),
        formatMin(r.tempo_resposta_min),
        r.limite_min != null ? `${r.limite_min} min` : '—',
        r.meta_origem_label || r.meta_origem || 'Empresa',
        <SlaStatusBadge status={r.status_sla} />,
        statusLabel(r.status_atendimento),
        ...(showOpen ? [<button type="button" className="dash-link-btn" onClick={() => onOpen(r.conversa_id)}>Abrir</button>] : []),
      ]}
    />
  )
}

function SlaViolationRankingList({ rows = [] }) {
  if (!rows?.length) return <EmptyInline text="Sem dados suficientes." />
  return (
    <div className="dash-sla-ranking">
      {rows.map((row, index) => (
        <div className="dash-sla-ranking-row dash-sla-ranking-row--bad" key={`${row.id}-${row.nome}`}>
          <div className="dash-sla-ranking-pos">{index + 1}</div>
          <div className="dash-sla-ranking-main">
            <div className="dash-sla-ranking-top">
              <strong>{row.nome}</strong>
              <span className="dash-sla-ranking-pct">{row.fora_sla} violações</span>
            </div>
            <div className="dash-sla-ranking-meta">
              <span>{row.total_analisadas} analisadas</span>
              <span>{row.percentual_cumprido != null ? `${row.percentual_cumprido}% cumprido` : 'Sem %'}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function SlaHourRanking({ rows = [] }) {
  if (!rows?.length) return <EmptyInline text="Sem violações no período." />
  const max = Math.max(...rows.map((r) => r.violacoes || 0), 1)
  return (
    <div className="dash-barlist">
      {rows.map((r) => (
        <div className="dash-baritem" key={r.hora}>
          <div className="dash-baritem-top">
            <span>{r.hora}</span>
            <strong>{r.violacoes}</strong>
          </div>
          <div className="dash-bartrack"><div className="dash-barfill" style={{ width: `${Math.max(8, (r.violacoes / max) * 100)}%`, background: 'linear-gradient(90deg, #dc2626, #f59e0b)' }} /></div>
        </div>
      ))}
    </div>
  )
}

function SlaWeekdayRanking({ rows = [] }) {
  if (!rows?.length) return <EmptyInline text="Sem violações no período." />
  return (
    <div className="dash-sla-weekday-grid">
      {rows.map((r) => (
        <div className="dash-sla-weekday-card" key={r.dia_semana}>
          <strong>{r.dia_semana_nome}</strong>
          <span>{r.violacoes} violações</span>
          {r.tempo_medio_violacao_min != null ? <small>Média {formatMin(r.tempo_medio_violacao_min)}</small> : null}
        </div>
      ))}
    </div>
  )
}

function SlaPageHeader({ icon: Icon, title, description }) {
  return (
    <header className="dash-sla-hero">
      <div className="dash-sla-hero-icon" aria-hidden="true">
        {Icon ? <Icon size={22} /> : null}
      </div>
      <div className="dash-sla-hero-copy">
        <h2 className="dash-sla-hero-title">{title}</h2>
        <p className="dash-sla-hero-desc">{description}</p>
      </div>
    </header>
  )
}

function SlaSummaryBanner({ percentual, limiteMin, totalAnalisadas, dentroSla, foraSla }) {
  const hasPct = percentual != null
  const pct = hasPct ? Number(percentual) : null
  const tone = !hasPct ? 'neutral' : pct >= 90 ? 'good' : pct >= 70 ? 'warn' : 'bad'

  return (
    <section className={`dash-sla-summary dash-sla-summary--${tone}`} aria-label="Resumo do SLA no período">
      <div className="dash-sla-summary-ring" aria-hidden="true">
        <svg viewBox="0 0 120 120" className="dash-sla-summary-svg">
          <circle cx="60" cy="60" r="52" className="dash-sla-summary-track" />
          {hasPct ? (
            <circle
              cx="60"
              cy="60"
              r="52"
              className="dash-sla-summary-progress"
              style={{ strokeDasharray: `${Math.max(0, Math.min(100, pct)) * 3.267} 326.7` }}
            />
          ) : null}
        </svg>
        <div className="dash-sla-summary-pct">
          {hasPct ? <strong>{pct}%</strong> : <strong>—</strong>}
          <span>cumprido</span>
        </div>
      </div>
      <div className="dash-sla-summary-details">
        <h3 className="dash-sla-summary-title">Resumo do período</h3>
        <p className="dash-sla-summary-text">
          Meta de <strong>{limiteMin} min</strong> para a primeira resposta · <strong>{totalAnalisadas}</strong> conversas analisadas.
        </p>
        <div className="dash-sla-summary-chips">
          <span className="dash-sla-chip dash-sla-chip--green">
            <CheckCircle2 size={14} aria-hidden="true" />
            {dentroSla} dentro do SLA
          </span>
          <span className="dash-sla-chip dash-sla-chip--red">
            <XCircle size={14} aria-hidden="true" />
            {foraSla} violações
          </span>
        </div>
      </div>
    </section>
  )
}

function SlaRankingList({ rows = [] }) {
  if (!rows?.length) return <EmptyInline text="Sem dados suficientes para ranking." />
  return (
    <div className="dash-sla-ranking">
      {rows.slice(0, 8).map((row, index) => {
        const pct = row.percentual_cumprido != null ? Number(row.percentual_cumprido) : null
        const barWidth = pct != null ? Math.max(4, Math.min(100, pct)) : 0
        const tone = pct == null ? 'neutral' : pct >= 90 ? 'good' : pct >= 70 ? 'warn' : 'bad'
        return (
          <div className={`dash-sla-ranking-row dash-sla-ranking-row--${tone}`} key={`${row.id}-${row.nome}`}>
            <div className="dash-sla-ranking-pos" aria-hidden="true">{index + 1}</div>
            <div className="dash-sla-ranking-main">
              <div className="dash-sla-ranking-top">
                <strong>{row.nome}</strong>
                <span className="dash-sla-ranking-pct">
                  {pct != null ? `${pct}%` : 'Sem dados'}
                </span>
              </div>
              <div className="dash-sla-ranking-track" aria-hidden="true">
                <div className="dash-sla-ranking-fill" style={{ width: `${barWidth}%` }} />
              </div>
              <div className="dash-sla-ranking-meta">
                <span>{row.total_analisadas} analisadas</span>
                <span>{row.dentro_sla} dentro · {row.fora_sla} fora</span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MetricCard({ icon: Icon, label, value, hint, tone = 'default' }) {
  return (
    <article className={`dash-metric dash-metric--${tone}`}>
      <div className="dash-metric-icon">{Icon ? <Icon size={18} /> : null}</div>
      <div className="dash-metric-label">{label}</div>
      <div className="dash-metric-value">{value}</div>
      {hint ? <div className="dash-metric-hint">{hint}</div> : null}
    </article>
  )
}

function Panel({ title, subtitle, children, className = '' }) {
  return (
    <section className={`dash-panel ${className}`.trim()}>
      {(title || subtitle) ? (
        <div className="dash-panel-head">
          {title ? <h2 className="dash-panel-title">{title}</h2> : null}
          {subtitle ? <p className="dash-panel-sub">{subtitle}</p> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}

function InfoStrip({ icon: Icon, title, text }) {
  return (
    <div className="dash-info-strip">
      <div className="dash-info-icon">{Icon ? <Icon size={18} /> : null}</div>
      <div>
        <strong>{title}</strong>
        <p>{text}</p>
      </div>
    </div>
  )
}

function IconButton({ icon: Icon, label, onClick, disabled, variant = 'primary', type = 'button' }) {
  return (
    <button type={type} className={`dash-btn dash-btn--${variant}`} onClick={onClick} disabled={disabled}>
      {Icon ? <Icon size={16} /> : null}
      <span>{label}</span>
    </button>
  )
}

function Select({ value, onChange, options }) {
  return (
    <select className="dash-select" value={value} onChange={(e) => onChange(e.target.value)}>
      {(options || []).map((option) => (
        <option key={String(option.value)} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

function FilterGrid({ children }) {
  return <div className="dash-filter-grid">{children}</div>
}

function MiniStat({ label, value }) {
  return (
    <div className="dash-mini">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function BarList({ title, items, emptyText }) {
  const list = Array.isArray(items) ? items.filter((x) => Number(x.value || 0) > 0) : []
  const max = list.reduce((m, x) => Math.max(m, Number(x.value || 0)), 0) || 1
  return (
    <div className="dash-barlist">
      {title ? <h3>{title}</h3> : null}
      {list.length === 0 ? (
        <EmptyInline text={emptyText || 'Sem dados.'} />
      ) : (
        list.slice(0, 10).map((x) => (
          <div className="dash-baritem" key={x.label}>
            <div className="dash-baritem-top">
              <span>{x.label}</span>
              <strong>{x.value}</strong>
            </div>
            <div className="dash-bartrack" aria-hidden="true">
              <div className="dash-barfill" style={{ width: `${Math.max(4, Math.round((x.value / max) * 100))}%` }} />
            </div>
          </div>
        ))
      )}
    </div>
  )
}

function RankingList({ rows = [] }) {
  if (!rows?.length) return <EmptyInline text="Sem dados suficientes para ranking." />
  return (
    <div className="dash-ranking">
      {rows.slice(0, 8).map((row) => (
        <div className="dash-ranking-row" key={`${row.id}-${row.nome}`}>
          <div>
            <strong>{row.nome}</strong>
            <span>{row.total_analisadas} analisadas</span>
          </div>
          <div className="dash-ranking-score">
            <strong>{row.percentual_cumprido != null ? `${row.percentual_cumprido}%` : 'Sem dados'}</strong>
            <span>{row.dentro_sla} dentro · {row.fora_sla} fora</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function SlaViolationTable({ rows = [], onOpen }) {
  return (
    <Table
      columns={['Cliente', 'Setor', 'Atendente', 'Primeira mensagem', 'Primeira resposta', 'Tempo', 'Status', '']}
      rows={rows}
      emptyText="Nenhuma violação de SLA para os filtros aplicados."
      renderRow={(r) => [
        r.cliente_nome || 'Cliente',
        r.setor || 'Sem setor',
        r.atendente_nome || 'Sem atendente',
        formatDateTime(r.primeira_mensagem_cliente_em),
        formatDateTime(r.primeira_resposta_atendente_em),
        formatMin(r.tempo_resposta_min),
        <span className="dash-status dash-status--danger">Violou</span>,
        <button type="button" className="dash-link-btn" onClick={() => onOpen(r.conversa_id)}>Abrir</button>,
      ]}
    />
  )
}

function DailySlaChart({ rows = [], meta = 90, selectedDay, onDayClick }) {
  if (!rows.length) return <EmptyInline text="Sem evolução diária para exibir." />
  return (
    <div className="dash-daily-chart dash-sla-daily-chart">
      <div className="dash-sla-daily-legend" aria-hidden="true">
        <span className="dash-sla-legend-item dash-sla-legend-item--good">Acima da meta ({meta}%)</span>
        <span className="dash-sla-legend-item dash-sla-legend-item--low">Abaixo da meta</span>
      </div>
      {rows.map((row) => {
        const pct = row.percentual_cumprido ?? 0
        const hasPct = row.percentual_cumprido != null
        const low = hasPct && pct < meta
        const isSelected = selectedDay === row.dia
        return (
          <button
            type="button"
            key={row.dia}
            className={`dash-daily-row dash-sla-daily-row ${low ? 'is-low' : 'is-good'} ${isSelected ? 'is-selected' : ''}`}
            onClick={() => onDayClick?.(row.dia)}
            title={`Ver conversas de ${formatDia(row.dia)}`}
          >
            <div className="dash-sla-daily-date">
              <CalendarDays size={14} aria-hidden="true" />
              <span>{formatDia(row.dia)}</span>
            </div>
            <div className="dash-sla-daily-bar-wrap">
              <div className="dash-daily-track dash-sla-daily-track">
                <div
                  className={`dash-daily-fill dash-sla-daily-fill ${low ? 'is-low' : 'is-good'}`}
                  style={{ width: `${hasPct ? Math.max(3, pct) : 3}%` }}
                />
                <div className="dash-sla-daily-meta-line" style={{ left: `${meta}%` }} title={`Meta: ${meta}%`} />
              </div>
              <div className="dash-sla-daily-stats">
                <span>{row.dentro_sla ?? 0} dentro</span>
                <span>{row.fora_sla ?? 0} fora</span>
                <span>{row.sem_resposta ?? 0} sem resp.</span>
              </div>
            </div>
            <strong className="dash-sla-daily-pct">
              {hasPct ? `${row.percentual_cumprido}%` : 'Sem dados'}
            </strong>
          </button>
        )
      })}
    </div>
  )
}

function Table({ columns, rows, renderRow, emptyText, rowClassName }) {
  const list = Array.isArray(rows) ? rows : []
  return (
    <div className="dash-table-wrap">
      <table className="dash-table">
        <thead>
          <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
        </thead>
        <tbody>
          {list.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="dash-table-empty">{emptyText || 'Sem dados.'}</td>
            </tr>
          ) : (
            list.map((row, rowIndex) => (
              <tr key={row.id || row.conversa_id || row.dia || rowIndex} className={rowClassName ? rowClassName(row) : ''}>
                {renderRow(row).map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

function AlertBanner({ type = 'error', text, onClose }) {
  return (
    <div className={`dash-banner dash-banner--${type}`} role="alert">
      <span>{text}</span>
      <button type="button" onClick={onClose} aria-label="Fechar">×</button>
    </div>
  )
}

function EmptyPanel({ title, text, action, icon: Icon }) {
  return (
    <div className="dash-empty dash-sla-empty">
      {Icon ? (
        <div className="dash-sla-empty-icon" aria-hidden="true">
          <Icon size={28} />
        </div>
      ) : null}
      <strong>{title}</strong>
      {text ? <p>{text}</p> : null}
      {action}
    </div>
  )
}

function EmptyInline({ text }) {
  return <div className="dash-empty-inline">{text}</div>
}

function formatMin(min) {
  if (min === null || min === undefined || min === 'Sem dados') return 'Sem dados'
  const n = Number(min)
  if (!Number.isFinite(n)) return 'Sem dados'
  if (n < 1) return `${Math.round(n * 60)}s`
  if (n < 60) return `${Math.round(n * 10) / 10} min`
  const h = Math.floor(n / 60)
  const m = Math.round(n % 60)
  return `${h}h ${m}m`
}

function formatDia(yyyyMmDd) {
  const s = String(yyyyMmDd || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || 'Sem data'
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}

function formatDateTime(value) {
  if (!value) return 'Sem dados'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Sem dados'
  return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

function prettyTipo(t) {
  const s = String(t || '').toLowerCase()
  if (!s || s === 'texto') return 'Texto'
  if (s === 'audio') return 'Áudio'
  if (s === 'imagem') return 'Imagem'
  if (s === 'video') return 'Vídeo'
  if (s === 'documento') return 'Documento'
  if (s === 'outros') return 'Outros'
  if (s === 'sticker') return 'Figurinha'
  if (s === 'arquivo') return 'Arquivo'
  if (s === 'contact') return 'Contato'
  if (s === 'location') return 'Localização'
  return s
}

function statusLabel(status) {
  const found = STATUS_OPTIONS.find((option) => option.value === status)
  return found?.label || status || 'Sem status'
}

function downloadCsv(filename, rows) {
  const csv = `\uFEFF${rows.map((row) => row.map((cell) => String(cell ?? '').replace(/;/g, ',').replace(/\n/g, ' ')).join(';')).join('\n')}`
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
