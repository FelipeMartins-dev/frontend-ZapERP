import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as dashboardApi from '../api/dashboardService'
import './dashboard.css'
import ConversasPorAtendente from './charts/ConversasPorAtendente'
import AtendimentoPorHora from './charts/AtendimentoPorHora'
import { SkeletonGrid } from '../components/feedback/Skeleton'
import '../components/feedback/skeleton.css'

const TABS = [
  { id: 'overview', label: 'Visão geral' },
  { id: 'relatorios', label: 'Relatórios' },
  { id: 'respostas', label: 'Respostas salvas' },
  { id: 'sla', label: 'SLA' },
]

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
      const data = await dashboardApi.getOverview(rangeDays ? { range_days: rangeDays } : {})
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
        <div className="dash-header-row">
          <div>
            <h1 className="dash-title">Dashboard</h1>
            <p className="dash-subtitle">Métricas claras, relatórios exportáveis e SLA — tudo sincronizado.</p>
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
            <button type="button" className="dash-btn dash-btn--outline" onClick={loadDashboard} disabled={loading}>
              {loading ? 'Atualizando…' : 'Atualizar'}
            </button>
          </div>
        </div>
      </header>

      <nav className="dash-tabs">
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

      <div className="dash-tab-content">
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
      </div>
    </div>
  )
}

// --- Visão geral (KPIs + gráficos) ---
function DashboardOverview({ overview, loading, loadErr, rangeDays, onRefresh }) {
  if (loading) {
    return (
      <div className="dash-loading-skeleton">
        <SkeletonGrid count={6} />
      </div>
    )
  }
  if (!overview) {
    return (
      <div className="dash-empty">
        {loadErr || 'Nenhum dado disponível. Verifique sua conexão.'}
        <button type="button" className="dash-btn dash-btn--primary" onClick={onRefresh}>
          Tentar novamente
        </button>
      </div>
    )
  }

  const {
    kpis = {},
    mensagens_kpis = {},
    mensagens_por_tipo = [],
    conversas_por_setor = [],
    conversas_por_atendente = [],
    conversas_por_hora = [],
    periodo,
  } = overview
  const atendimentosHoje = kpis.atendimentos_hoje ?? 0
  const tempoMedioResposta = kpis.tempo_medio_resposta_min ?? kpis.tempo_primeira_resposta_min
  const slaPercent = kpis.sla_percent
  const atendenteMaisProdutivo = kpis.atendente_mais_produtivo
  const ticketsAbertos = kpis.tickets_abertos ?? (kpis.abertas + kpis.em_atendimento)
  const taxaConversao = kpis.taxa_conversao_percent

  const periodoLabel = useMemo(() => {
    if (!rangeDays) return 'Tudo'
    if (rangeDays === 1) return 'Hoje'
    return `Últimos ${rangeDays} dias`
  }, [rangeDays])

  return (
    <>
      <div className="dash-note">
        <div className="dash-note-title">Como ler este painel</div>
        <div className="dash-note-text">
          Os KPIs e gráficos consideram o período selecionado ({periodoLabel}). Use “Relatórios” para filtrar e exportar.
        </div>
      </div>

      <div className="dash-grid">
        <StatCard label="Atendimentos hoje" value={atendimentosHoje} hint="Ações registradas na tabela de atendimentos." />
        <StatCard label="Tempo médio (1ª resposta)" value={formatMin(tempoMedioResposta)} tone="blue" hint="Do 1º “in” até o 1º “out” na conversa." />
        <StatCard label="SLA (1ª resp. ≤ 5 min)" value={slaPercent != null ? `${slaPercent}%` : '—'} tone="green" hint="Percentual de conversas respondidas em até 5 min." />
        <StatCard label="Atendente mais produtivo" value={atendenteMaisProdutivo || '—'} tone="muted" hint="Quem teve mais conversas atribuídas no período." />
        <StatCard label="Tickets abertos" value={ticketsAbertos} tone="amber" hint="Abertas + em atendimento no período." />
        <StatCard label="Taxa de conversão" value={taxaConversao != null ? `${taxaConversao}%` : '—'} tone="green" hint="Fechadas ÷ total de conversas." />
      </div>

      <section className="dash-split">
        <div className="dash-panel">
          <div className="dash-panel-head">
            <h3 className="dash-panel-title">Volume de mensagens</h3>
            <div className="dash-panel-sub">Entrada/saída e tipos de mídia (texto, áudio, imagem…)</div>
          </div>
          <div className="dash-miniGrid">
            <div className="dash-mini">
              <div className="dash-mini-label">Total</div>
              <div className="dash-mini-value">{mensagens_kpis.total ?? 0}</div>
            </div>
            <div className="dash-mini">
              <div className="dash-mini-label">Recebidas</div>
              <div className="dash-mini-value">{mensagens_kpis.in ?? 0}</div>
            </div>
            <div className="dash-mini">
              <div className="dash-mini-label">Enviadas</div>
              <div className="dash-mini-value">{mensagens_kpis.out ?? 0}</div>
            </div>
          </div>
          <BarList
            title="Mensagens por tipo"
            items={(mensagens_por_tipo || []).map((x) => ({
              label: prettyTipo(x.tipo),
              value: Number(x.total || 0),
            }))}
            emptyText="Sem mensagens no período."
          />
        </div>

        <div className="dash-panel">
          <div className="dash-panel-head">
            <h3 className="dash-panel-title">Distribuição por setor</h3>
            <div className="dash-panel-sub">Ajuda a entender onde está a demanda.</div>
          </div>
          <BarList
            title="Conversas por setor"
            items={(conversas_por_setor || []).map((x) => ({
              label: x.nome,
              value: Number(x.total || 0),
            }))}
            emptyText="Sem conversas no período."
          />
          {periodo?.from ? (
            <div className="dash-footnote">
              Período: {new Date(periodo.from).toLocaleDateString('pt-BR')} → {new Date(periodo.to).toLocaleDateString('pt-BR')}
            </div>
          ) : null}
        </div>
      </section>

      <section className="dash-charts">
        <div className="dash-chart-card">
          <h4>Conversas por atendente</h4>
          <ConversasPorAtendente data={conversas_por_atendente} />
        </div>
        <div className="dash-chart-card">
          <h4>Conversas por hora</h4>
          <AtendimentoPorHora data={conversas_por_hora} />
        </div>
      </section>
    </>
  )
}

function StatCard({ label, value, tone, hint }) {
  const toneClass =
    tone === 'green'
      ? 'dash-card-value--green'
      : tone === 'blue'
        ? 'dash-card-value--blue'
        : tone === 'amber'
          ? 'dash-card-value--amber'
          : tone === 'muted'
            ? 'dash-card-value--muted'
            : ''
  return (
    <div className="dash-card">
      <div className="dash-card-label">{label}</div>
      <div className={`dash-card-value ${toneClass}`}>{value}</div>
      {hint ? <div className="dash-card-hint">{hint}</div> : null}
    </div>
  )
}

function BarList({ title, items, emptyText }) {
  const list = Array.isArray(items) ? items.filter((x) => Number(x.value || 0) > 0) : []
  const max = list.reduce((m, x) => Math.max(m, Number(x.value || 0)), 0) || 1
  return (
    <div className="dash-barlist">
      <div className="dash-barlist-title">{title}</div>
      {list.length === 0 ? (
        <div className="dash-barlist-empty">{emptyText || 'Sem dados.'}</div>
      ) : (
        <div className="dash-barlist-items">
          {list.slice(0, 8).map((x) => (
            <div className="dash-baritem" key={x.label}>
              <div className="dash-baritem-top">
                <span className="dash-baritem-label">{x.label}</span>
                <span className="dash-baritem-value">{x.value}</span>
              </div>
              <div className="dash-bartrack" aria-hidden="true">
                <div className="dash-barfill" style={{ width: `${Math.round((x.value / max) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function prettyTipo(t) {
  const s = String(t || '').toLowerCase()
  if (!s || s === 'texto') return 'Texto'
  if (s === 'audio') return 'Áudio'
  if (s === 'imagem') return 'Imagem'
  if (s === 'video') return 'Vídeo'
  if (s === 'sticker') return 'Figurinha'
  if (s === 'arquivo') return 'Arquivo'
  return s
}

// --- Relatórios (filtros + tabela + export CSV/Excel/PDF) ---
function DashboardRelatorios() {
  const [relTab, setRelTab] = useState('conversas')
  const [filters, setFilters] = useState({
    data_inicio: '',
    data_fim: '',
    status_atendimento: '',
    atendente_id: '',
    departamento_id: '',
  })
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(null)
  const [departamentos, setDepartamentos] = useState([])
  const [usuarios, setUsuarios] = useState([])
  const [erroCarregar, setErroCarregar] = useState('')
  const [erroExportar, setErroExportar] = useState('')
  const [msgRows, setMsgRows] = useState([])

  useEffect(() => {
    Promise.all([dashboardApi.getDepartamentos(), dashboardApi.getUsuarios()]).then(
      ([dept, usr]) => {
        setDepartamentos(dept || [])
        setUsuarios(usr || [])
      }
    ).catch(() => {
      setErroCarregar('Erro ao carregar departamentos/atendentes.')
    })
  }, [])

  async function carregar() {
    setLoading(true)
    setErroCarregar('')
    try {
      const params = {}
      if (filters.data_inicio) params.data_inicio = filters.data_inicio
      if (filters.data_fim) params.data_fim = filters.data_fim
      if (filters.status_atendimento) params.status_atendimento = filters.status_atendimento
      if (filters.atendente_id) params.atendente_id = filters.atendente_id
      if (filters.departamento_id) params.departamento_id = filters.departamento_id
      if (relTab === 'conversas') {
        const list = await dashboardApi.getRelatorioConversas(params)
        setData(list)
      } else {
        const list = await dashboardApi.getRelatorioMensagens(params)
        setMsgRows(list)
      }
    } catch (e) {
      setErroCarregar(e?.response?.data?.error || 'Erro ao carregar relatório.')
      setData([])
      setMsgRows([])
    } finally {
      setLoading(false)
    }
  }

  async function exportar(format) {
    setExporting(format)
    setErroExportar('')
    try {
      const params = {}
      if (filters.data_inicio) params.data_inicio = filters.data_inicio
      if (filters.data_fim) params.data_fim = filters.data_fim
      if (filters.status_atendimento) params.status_atendimento = filters.status_atendimento
      if (filters.atendente_id) params.atendente_id = filters.atendente_id
      if (filters.departamento_id) params.departamento_id = filters.departamento_id
      await dashboardApi.exportRelatorio(format, params)
    } catch (e) {
      setErroExportar(e?.response?.data?.error || `Erro ao exportar ${format.toUpperCase()}.`)
    } finally {
      setExporting(null)
    }
  }

  return (
    <div className="dash-relatorios">
      <div className="dash-rel-subtabs" role="tablist" aria-label="Tipos de relatório">
        <button
          type="button"
          className={`dash-rel-subtab ${relTab === 'conversas' ? 'isActive' : ''}`}
          onClick={() => setRelTab('conversas')}
        >
          Conversas
        </button>
        <button
          type="button"
          className={`dash-rel-subtab ${relTab === 'mensagens' ? 'isActive' : ''}`}
          onClick={() => setRelTab('mensagens')}
        >
          Mensagens
        </button>
      </div>

      <div className="dash-note dash-note--compact">
        <div className="dash-note-text">
          {relTab === 'conversas'
            ? 'Relatório detalhado de conversas (cliente, setor, tags, tempo sem responder) com exportação CSV/Excel/PDF.'
            : 'Relatório de volume de mensagens por dia (entrada/saída) e por tipo de mídia.'}
        </div>
      </div>

      <div className="dash-filters">
        <input
          type="date"
          value={filters.data_inicio}
          onChange={(e) => setFilters((f) => ({ ...f, data_inicio: e.target.value }))}
          className="dash-input"
          placeholder="Data início"
        />
        <input
          type="date"
          value={filters.data_fim}
          onChange={(e) => setFilters((f) => ({ ...f, data_fim: e.target.value }))}
          className="dash-input"
          placeholder="Data fim"
        />
        {relTab === 'conversas' ? (
          <>
            <select
              value={filters.status_atendimento}
              onChange={(e) => setFilters((f) => ({ ...f, status_atendimento: e.target.value }))}
              className="dash-select"
            >
              <option value="">Status</option>
              <option value="aberta">Aberta</option>
              <option value="em_atendimento">Em atendimento</option>
              <option value="aguardando_cliente">Aguardando cliente</option>
              <option value="fechada">Fechada</option>
            </select>
            <select
              value={filters.atendente_id}
              onChange={(e) => setFilters((f) => ({ ...f, atendente_id: e.target.value }))}
              className="dash-select"
            >
              <option value="">Atendente</option>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nome}
                </option>
              ))}
            </select>
            <select
              value={filters.departamento_id}
              onChange={(e) => setFilters((f) => ({ ...f, departamento_id: e.target.value }))}
              className="dash-select"
            >
              <option value="">Setor</option>
              {departamentos.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nome}
                </option>
              ))}
            </select>
          </>
        ) : null}
        <button type="button" className="dash-btn dash-btn--primary" onClick={carregar} disabled={loading}>
          {loading ? 'Carregando...' : 'Aplicar'}
        </button>
      </div>

      {(erroCarregar || erroExportar) && (
        <div className="dash-erro" role="alert">
          {erroCarregar && <span>{erroCarregar}</span>}
          {erroCarregar && erroExportar && ' '}
          {erroExportar && <span>{erroExportar}</span>}
        </div>
      )}

      {relTab === 'conversas' ? (
        <div className="dash-export-buttons">
          <span className="dash-export-label">Exportar:</span>
          <button
            type="button"
            className="dash-btn dash-btn--outline"
            onClick={() => exportar('csv')}
            disabled={!!exporting}
          >
            {exporting === 'csv' ? '...' : 'CSV'}
          </button>
          <button
            type="button"
            className="dash-btn dash-btn--outline"
            onClick={() => exportar('xlsx')}
            disabled={!!exporting}
          >
            {exporting === 'xlsx' ? '...' : 'Excel'}
          </button>
          <button
            type="button"
            className="dash-btn dash-btn--outline"
            onClick={() => exportar('pdf')}
            disabled={!!exporting}
          >
            {exporting === 'pdf' ? '...' : 'PDF'}
          </button>
        </div>
      ) : null}

      <div className="dash-table-wrap">
        {relTab === 'conversas' ? (
          <table className="dash-table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Telefone</th>
                <th>Setor</th>
                <th>Status</th>
                <th>Atendente</th>
                <th>Tags</th>
                <th>Criado em</th>
                <th>Min sem responder</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 && !loading && (
                <tr>
                  <td colSpan={8} className="dash-table-empty">
                    Aplique os filtros e clique em Aplicar para carregar o relatório.
                  </td>
                </tr>
              )}
              {data.map((r) => (
                <tr key={r.id}>
                  <td>{r.cliente_nome || '—'}</td>
                  <td>{r.telefone || '—'}</td>
                  <td>{r.setor || '—'}</td>
                  <td>{r.status_atendimento || '—'}</td>
                  <td>{r.atendente_nome || '—'}</td>
                  <td>{r.tags || '—'}</td>
                  <td>{r.criado_em ? new Date(r.criado_em).toLocaleString('pt-BR') : '—'}</td>
                  <td>{r.tempo_sem_responder_min != null ? r.tempo_sem_responder_min : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="dash-table">
            <thead>
              <tr>
                <th>Dia</th>
                <th>Total</th>
                <th>Recebidas</th>
                <th>Enviadas</th>
                <th>Texto</th>
                <th>Áudio</th>
                <th>Imagem</th>
                <th>Vídeo</th>
                <th>Figurinha</th>
                <th>Arquivo</th>
              </tr>
            </thead>
            <tbody>
              {msgRows.length === 0 && !loading && (
                <tr>
                  <td colSpan={10} className="dash-table-empty">
                    Selecione o período e clique em Aplicar para carregar o relatório.
                  </td>
                </tr>
              )}
              {msgRows.map((r) => (
                <tr key={r.dia}>
                  <td>{formatDia(r.dia)}</td>
                  <td>{r.total ?? 0}</td>
                  <td>{r.in ?? 0}</td>
                  <td>{r.out ?? 0}</td>
                  <td>{r.texto ?? 0}</td>
                  <td>{r.audio ?? 0}</td>
                  <td>{r.imagem ?? 0}</td>
                  <td>{r.video ?? 0}</td>
                  <td>{r.sticker ?? 0}</td>
                  <td>{r.arquivo ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function formatDia(yyyyMmDd) {
  const s = String(yyyyMmDd || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || '—'
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}

// --- Respostas salvas por setor ---
function DashboardRespostasSalvas() {
  const [departamentos, setDepartamentos] = useState([])
  const [respostas, setRespostas] = useState([])
  const [departamentoId, setDepartamentoId] = useState('')
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ titulo: '', texto: '', departamento_id: '' })
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState('')

  async function loadDept() {
    try {
      const list = await dashboardApi.getDepartamentos()
      setDepartamentos(list || [])
    } catch (e) {
      setDepartamentos([])
      setErro('Erro ao carregar setores.')
    }
  }

  async function loadRespostas() {
    setLoading(true)
    setErro('')
    try {
      const list = await dashboardApi.getRespostasSalvas(departamentoId || null)
      setRespostas(list)
    } catch (e) {
      setRespostas([])
      setErro(e?.response?.data?.error || 'Erro ao carregar respostas salvas.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDept()
  }, [])

  useEffect(() => {
    loadRespostas()
  }, [departamentoId])

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

  return (
    <div className="dash-respostas">
      <p className="dash-muted" style={{ marginBottom: 12 }}>
        Respostas pessoais do seu usuário. No atendimento, use <strong>/</strong> ou o botão no composer.
      </p>
      {(erro || ok) && (
        <div className={`dash-banner ${ok ? 'dash-banner--ok' : 'dash-banner--err'}`} role="alert">
          <span>{erro || ok}</span>
          <button type="button" className="dash-banner-close" onClick={() => { setErro(''); setOk('') }} aria-label="Fechar">
            ×
          </button>
        </div>
      )}
      <div className="dash-respostas-filters">
        <label>
          Setor (departamento):
          <select
            value={departamentoId}
            onChange={(e) => setDepartamentoId(e.target.value)}
            className="dash-select"
          >
            <option value="">Todos</option>
            {departamentos.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nome}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section className="dash-respostas-form-card">
        <h4>Nova resposta salva</h4>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Título"
            value={form.titulo}
            onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))}
            className="dash-input"
            required
          />
          <select
            value={form.departamento_id}
            onChange={(e) => setForm((f) => ({ ...f, departamento_id: e.target.value }))}
            className="dash-select"
          >
            <option value="">Setor (opcional)</option>
            {departamentos.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nome}
              </option>
            ))}
          </select>
          <textarea
            placeholder="Texto da resposta"
            value={form.texto}
            onChange={(e) => setForm((f) => ({ ...f, texto: e.target.value }))}
            className="dash-textarea"
            rows={3}
            required
          />
          <button type="submit" className="dash-btn dash-btn--primary" disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </form>
      </section>

      <section className="dash-respostas-list">
        <h4>Respostas salvas ({respostas.length})</h4>
        {loading ? (
          <p className="dash-muted">Carregando...</p>
        ) : respostas.length === 0 ? (
          <p className="dash-muted">Nenhuma resposta salva para o setor selecionado.</p>
        ) : (
          <ul className="dash-respostas-ul">
            {respostas.map((r) => (
              <li key={r.id} className="dash-resposta-item">
                <strong>{r.titulo}</strong>
                {r.departamentos?.nome && (
                  <span className="dash-resposta-setor">{r.departamentos.nome}</span>
                )}
                <p className="dash-resposta-texto">{r.texto}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

// --- SLA: config + alertas ---
function DashboardSLA({ navigate }) {
  const [config, setConfig] = useState({ sla_minutos_sem_resposta: 30 })
  const [alertas, setAlertas] = useState({ limite_min: 30, alertas: [] })
  const [loadingConfig, setLoadingConfig] = useState(true)
  const [loadingAlertas, setLoadingAlertas] = useState(true)
  const [saving, setSaving] = useState(false)
  const [minutosInput, setMinutosInput] = useState('')
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState('')

  async function loadConfig() {
    setLoadingConfig(true)
    setErro('')
    try {
      const c = await dashboardApi.getSlaConfig()
      setConfig(c)
      setMinutosInput(String(c.sla_minutos_sem_resposta ?? 30))
    } catch (e) {
      setErro(e?.response?.data?.error || 'Erro ao carregar configuração de SLA.')
    } finally {
      setLoadingConfig(false)
    }
  }

  async function loadAlertas() {
    setLoadingAlertas(true)
    setErro('')
    try {
      const a = await dashboardApi.getSlaAlertas()
      setAlertas(a)
    } catch (e) {
      setErro(e?.response?.data?.error || 'Erro ao carregar alertas de SLA.')
    } finally {
      setLoadingAlertas(false)
    }
  }

  useEffect(() => {
    loadConfig()
  }, [])

  useEffect(() => {
    loadAlertas()
    const t = setInterval(loadAlertas, 60000)
    return () => clearInterval(t)
  }, [])

  async function salvarSla() {
    const min = Math.max(1, Math.min(1440, parseInt(minutosInput, 10) || 30))
    setSaving(true)
    setErro('')
    setOk('')
    try {
      await dashboardApi.setSlaConfig(min)
      setConfig({ sla_minutos_sem_resposta: min })
      loadAlertas()
      setOk('Configuração de SLA salva.')
    } catch (e) {
      setErro(e?.response?.data?.error || 'Erro ao salvar configuração de SLA.')
    } finally {
      setSaving(false)
    }
  }

  function abrirConversa(conversaId) {
    navigate('/atendimento', { state: { openConversaId: conversaId } })
  }

  return (
    <div className="dash-sla">
      {(erro || ok) && (
        <div className={`dash-banner ${ok ? 'dash-banner--ok' : 'dash-banner--err'}`} role="alert">
          <span>{erro || ok}</span>
          <button type="button" className="dash-banner-close" onClick={() => { setErro(''); setOk('') }} aria-label="Fechar">
            ×
          </button>
        </div>
      )}
      <section className="dash-sla-config dash-card">
        <h4>Configuração do SLA</h4>
        <p className="dash-muted">
          Alerta quando um cliente ficar mais de X minutos sem resposta (conversa aberta ou em
          atendimento).
        </p>
        {loadingConfig ? (
          <p className="dash-muted">Carregando...</p>
        ) : (
          <div className="dash-sla-form">
            <input
              type="number"
              min={1}
              max={1440}
              value={minutosInput}
              onChange={(e) => setMinutosInput(e.target.value)}
              className="dash-input"
              style={{ width: 80 }}
            />
            <span>minutos</span>
            <button
              type="button"
              className="dash-btn dash-btn--primary"
              onClick={salvarSla}
              disabled={saving}
            >
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        )}
        <p className="dash-muted">Atual: {config.sla_minutos_sem_resposta ?? 30} minutos.</p>
      </section>

      <section className="dash-sla-alertas dash-card">
        <h4>Alertas de SLA ({alertas.alertas?.length ?? 0})</h4>
        <p className="dash-muted">
          Conversas em que o cliente está há mais de {alertas.limite_min ?? 30} min sem resposta.
        </p>
        <button
          type="button"
          className="dash-btn dash-btn--outline"
          onClick={loadAlertas}
          disabled={loadingAlertas}
        >
          {loadingAlertas ? 'Atualizando...' : 'Atualizar'}
        </button>
        {loadingAlertas ? (
          <p className="dash-muted">Carregando alertas...</p>
        ) : !alertas.alertas?.length ? (
          <p className="dash-muted">Nenhum alerta no momento.</p>
        ) : (
          <ul className="dash-sla-lista">
            {alertas.alertas.map((a) => (
              <li key={a.conversa_id} className="dash-sla-item">
                <span className="dash-sla-item-nome">{a.cliente_nome || a.telefone}</span>
                <span className="dash-sla-item-tempo">
                  {a.tempo_sem_responder_min} min sem resposta
                </span>
                <span className="dash-sla-item-atendente">Atendente: {a.atendente_nome || '—'}</span>
                <button
                  type="button"
                  className="dash-btn dash-btn--small"
                  onClick={() => abrirConversa(a.conversa_id)}
                >
                  Abrir conversa
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function formatMin(min) {
  if (min === null || min === undefined) return '—'
  if (min < 1) return `${Math.round(min * 60)}s`
  if (min < 60) return `${min.toFixed(1)} min`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return `${h}h ${m}m`
}
