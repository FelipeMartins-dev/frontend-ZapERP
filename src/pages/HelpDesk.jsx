import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IconArrowLeft, IconArrowRight, IconBrandWhatsapp, IconCircleCheck, IconDeviceDesktop, IconEdit, IconMessagePlus, IconRefresh, IconTicket, IconUserCheck } from '@tabler/icons-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '../auth/authStore'
import { getDepartamentos, getUsuarios } from '../api/configService'
import {
  addTicketMessage,
  assumeTicket,
  getTicket,
  helpDeskApiError,
  listTickets,
  markHelpDeskTicketNotificationsRead,
  transferTicket,
  updateTicket,
} from '../api/helpDeskService'
import { getSocket } from '../socket/socket'
import { useHelpDeskNotifyStore } from '../helpdesk/helpDeskNotifyStore'
import { abrirConversaPorTelefone } from '../chats/chatService'
import './helpDesk.css'
import './helpDeskTheme.css'

const STATUS_LABEL = {
  aberto: 'Aberto',
  em_atendimento: 'Em atendimento',
  resolvido: 'Resolvido',
}

const PRIORITY_LABEL = { baixa: 'Baixa', normal: 'Normal', alta: 'Alta', urgente: 'Urgente' }
const SORT_LABEL = {
  atualizado: 'Atualizado há',
  criado: 'Criado há',
  status: 'Status',
  empresa: 'Empresa',
  numero: 'Número do chamado',
}
const SORT_DIRECTION_LABEL = {
  atualizado: { asc: 'Há mais tempo', desc: 'Mais recente' },
  criado: { asc: 'Mais antigo', desc: 'Mais recente' },
  status: { asc: 'Aberto primeiro', desc: 'Resolvido primeiro' },
  empresa: { asc: 'A–Z', desc: 'Z–A' },
  numero: { asc: 'Menor primeiro', desc: 'Maior primeiro' },
}
const HELPDESK_DEPARTAMENTO_NOMES = new Set([
  'Suporte',
  'Financeiro',
  'Comercial',
])
const FILTER_STORAGE_PREFIX = 'zaperp_helpdesk_filters'
const HELPDESK_CHANGED_EVENT = 'helpdesk:ticket_changed'
const BACKGROUND_REFRESH_MS = 60000
const SOCKET_REFRESH_DEBOUNCE_MS = 300

function loadStoredFilters(user) {
  const defaults = { filtersOpen: false, status: '', priority: '', search: '', myQueue: false, startDate: '', endDate: '', orderBy: 'atualizado', orderDirection: 'desc' }
  if (typeof window === 'undefined') return defaults
  try {
    const key = `${FILTER_STORAGE_PREFIX}:${user?.company_id || 'unknown'}:${user?.id || 'unknown'}`
    const stored = JSON.parse(window.localStorage.getItem(key) || 'null')
    if (!stored || typeof stored !== 'object') return defaults
    return {
      filtersOpen: stored.filtersOpen === true,
      status: stored.status && STATUS_LABEL[stored.status] ? stored.status : '',
      priority: stored.priority && PRIORITY_LABEL[stored.priority] ? stored.priority : '',
      search: typeof stored.search === 'string' ? stored.search : '',
      myQueue: stored.myQueue === true,
      startDate: typeof stored.startDate === 'string' ? stored.startDate : '',
      endDate: typeof stored.endDate === 'string' ? stored.endDate : '',
      orderBy: SORT_LABEL[stored.orderBy] ? stored.orderBy : 'atualizado',
      orderDirection: stored.orderDirection === 'asc' ? 'asc' : 'desc',
    }
  } catch {
    return defaults
  }
}

function formatDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function DateFilterInput({ value, onChange, ariaLabel }) {
  function handleChange(event) {
    const nextValue = event.target.value
    if (!nextValue || /^\d{4}-\d{2}-\d{2}$/.test(nextValue)) onChange(nextValue)
  }

  return (
    <input
      type="date"
      lang="pt-BR"
      min="1000-01-01"
      max="9999-12-31"
      aria-label={ariaLabel}
      value={value}
      onChange={handleChange}
    />
  )
}

function formatElapsed(value, now = Date.now()) {
  const startedAt = new Date(value).getTime()
  if (!Number.isFinite(startedAt)) return 'tempo não informado'

  const totalMinutes = Math.max(0, Math.floor((now - startedAt) / 60000))
  if (totalMinutes < 1) return 'menos de 1 min'

  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60

  if (days > 0) return `${days}d${hours > 0 ? ` ${hours}h` : ''}`
  if (hours > 0) return `${hours}h${minutes > 0 ? ` ${minutes}min` : ''}`
  return `${minutes}min`
}

function formatBytes(value) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes < 0) return 'Não informado'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const amount = bytes / (1024 ** unitIndex)
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(amount)} ${units[unitIndex]}`
}

function formatUptime(value) {
  const totalSeconds = Number(value)
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return 'Não informado'
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  if (days > 0) return `${days}d${hours > 0 ? ` ${hours}h` : ''}`
  if (hours > 0) return `${hours}h${minutes > 0 ? ` ${minutes}min` : ''}`
  return `${minutes}min`
}

export default function HelpDesk() {
  const user = useAuthStore((state) => state.user)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTicketParam = searchParams.get('ticket')
  const initialFilters = useMemo(() => loadStoredFilters(user), [user?.company_id, user?.id])
  const [tickets, setTickets] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(() => initialFilters.filtersOpen)
  const [status, setStatus] = useState(() => initialFilters.status)
  const [priority, setPriority] = useState(() => initialFilters.priority)
  const [search, setSearch] = useState(() => initialFilters.search)
  const [myQueue, setMyQueue] = useState(() => initialFilters.myQueue)
  const [startDate, setStartDate] = useState(() => initialFilters.startDate)
  const [endDate, setEndDate] = useState(() => initialFilters.endDate)
  const [orderBy, setOrderBy] = useState(() => initialFilters.orderBy)
  const [orderDirection, setOrderDirection] = useState(() => initialFilters.orderDirection)
  const [departments, setDepartments] = useState([])
  const [users, setUsers] = useState([])
  const [now, setNow] = useState(() => Date.now())
  const backgroundRefreshRunning = useRef(false)
  const listScrollTop = useRef(0)
  const listScrollElement = useRef(null)

  const userMap = useMemo(() => Object.fromEntries(users.map((item) => [item.id, item.nome])), [users])

  const loadTickets = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true)
      setError('')
      const data = await listTickets({
        status: status || undefined,
        prioridade: priority || undefined,
        q: search.trim() || undefined,
        responsavel_id: myQueue ? user?.id : undefined,
        data_inicio: startDate || undefined,
        data_fim: endDate || undefined,
        ordenar_por: orderBy,
        ordem: orderDirection,
        limit: 100,
      })
      const items = data?.items || []
      setTickets(items)
    } catch (err) {
      setError(helpDeskApiError(err))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [endDate, myQueue, orderBy, orderDirection, priority, search, startDate, status, user?.id])

  const loadDetail = useCallback(async (id, { silent = false } = {}) => {
    if (!id) {
      setDetail(null)
      return
    }
    try {
      if (!silent) setDetailLoading(true)
      setError('')
      setDetail(await getTicket(id))
    } catch (err) {
      setError(helpDeskApiError(err))
      setDetail(null)
    } finally {
      if (!silent) setDetailLoading(false)
    }
  }, [])

  const backgroundRefresh = useCallback(async (changedTicketId = null) => {
    if (backgroundRefreshRunning.current) return
    backgroundRefreshRunning.current = true
    try {
      const tasks = [loadTickets({ silent: true })]
      if (selectedId && (!changedTicketId || Number(changedTicketId) === Number(selectedId))) {
        tasks.push(loadDetail(selectedId, { silent: true }))
      }
      await Promise.all(tasks)
    } finally {
      backgroundRefreshRunning.current = false
    }
  }, [loadDetail, loadTickets, selectedId])

  useEffect(() => { loadTickets() }, [loadTickets])
  useEffect(() => { loadDetail(selectedId) }, [loadDetail, selectedId])
  useEffect(() => {
    const ticketId = Number(requestedTicketParam)
    if (!Number.isInteger(ticketId) || ticketId <= 0) return
    setSelectedId(ticketId)
    markHelpDeskTicketNotificationsRead(ticketId)
      .then((result) => useHelpDeskNotifyStore.getState().markTicketRead(ticketId, result?.updated))
      .catch(() => {})
  }, [requestedTicketParam])
  useEffect(() => {
    if (typeof window === 'undefined' || !user?.id || !user?.company_id) return
    const key = `${FILTER_STORAGE_PREFIX}:${user.company_id}:${user.id}`
    window.localStorage.setItem(key, JSON.stringify({ filtersOpen, status, priority, search, myQueue, startDate, endDate, orderBy, orderDirection }))
  }, [endDate, filtersOpen, myQueue, orderBy, orderDirection, priority, search, startDate, status, user?.company_id, user?.id])
  useEffect(() => {
    Promise.all([getDepartamentos(), getUsuarios()])
      .then(([deps, people]) => {
        setDepartments(
          (Array.isArray(deps) ? deps : []).filter((department) =>
          HELPDESK_DEPARTAMENTO_NOMES.has(String(department.nome || '').trim())))
        setUsers((Array.isArray(people) ? people : []).filter((item) => item.ativo !== false))
      })
      .catch(() => {})
  }, [])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    const socket = getSocket()
    let socketTimer = null
    const onTicketChanged = (payload = {}) => {
      if (Number(payload.company_id) !== Number(user?.company_id)) return
      window.clearTimeout(socketTimer)
      socketTimer = window.setTimeout(
        () => void backgroundRefresh(payload.ticket_id),
        SOCKET_REFRESH_DEBOUNCE_MS
      )
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void backgroundRefresh()
    }
    const pollTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void backgroundRefresh()
    }, BACKGROUND_REFRESH_MS)

    socket?.on(HELPDESK_CHANGED_EVENT, onTicketChanged)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearTimeout(socketTimer)
      window.clearInterval(pollTimer)
      socket?.off(HELPDESK_CHANGED_EVENT, onTicketChanged)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [backgroundRefresh, user?.company_id])

  async function refreshSelected() {
    await Promise.all([loadTickets(), loadDetail(selectedId)])
  }

  function openTicket(id) {
    listScrollTop.current = listScrollElement.current?.scrollTop || 0
    setSelectedId(id)
    setSearchParams({ ticket: String(id) }, { replace: true })
  }

  function returnToList() {
    setSelectedId(null)
    setSearchParams({}, { replace: true })
    window.requestAnimationFrame(() => {
      if (listScrollElement.current) listScrollElement.current.scrollTop = listScrollTop.current
    })
  }

  async function openWhatsappAttendance(ticket) {
    try {
      setError('')
      const result = await abrirConversaPorTelefone(
        ticket.solicitante_nome || ticket.empresa_nome || 'Contato',
        ticket.telefone,
      )
      const conversation = result?.conversa
      if (!conversation?.id) {
        setError('Não foi possível abrir ou iniciar o atendimento no WhatsApp')
        return
      }
      navigate('/atendimento', { state: { openConversaId: conversation.id } })
    } catch (err) {
      setError(
        err?.response?.data?.error
          || err?.response?.data?.detalhe
          || err?.message
          || 'Não foi possível abrir ou iniciar o atendimento no WhatsApp',
      )
    }
  }

  return (
    <section className="helpdesk-page">
      <header className="helpdesk-header">
        <div>
          <p className="helpdesk-eyebrow">Central de suporte</p>
          <h1>HelpDesk</h1>
          <p>Acompanhe chamados, identifique rapidamente cada contato e direcione a solicitação à equipe certa.</p>
        </div>
        <div className="helpdesk-header-actions">
          <button className="helpdesk-btn helpdesk-btn--ghost" type="button" onClick={refreshSelected}>
            <IconRefresh size={18} /> Atualizar
          </button>
        </div>
      </header>

      {error ? <div className="helpdesk-error" role="alert">{error}</div> : null}

      <div className={`helpdesk-workspace ${selectedId ? 'is-detail-view' : 'is-list-view'}`}>
        {!selectedId ? (
          <section className="helpdesk-ticket-list-view">
            <details
              className="helpdesk-filter-panel"
              open={filtersOpen}
              onToggle={(event) => setFiltersOpen(event.currentTarget.open)}
            >
              <summary>Filtros</summary>
              <div className="helpdesk-filters">
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome da empresa ou CNPJ" aria-label="Buscar por nome da empresa ou CNPJ" />
                <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filtrar por status">
                  <option value="">Todos os status</option>
                  {Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <select value={priority} onChange={(event) => setPriority(event.target.value)} aria-label="Filtrar por prioridade">
                  <option value="">Todas as prioridades</option>
                  {Object.entries(PRIORITY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <label className="helpdesk-my-queue"><input type="checkbox" checked={myQueue} onChange={(event) => setMyQueue(event.target.checked)} /><span>Somente minha fila</span></label>
                <div className="helpdesk-sort-controls">
                  <label>
                    <span>Ordenar por</span>
                    <select value={orderBy} onChange={(event) => setOrderBy(event.target.value)} aria-label="Ordenar chamados por">
                      {Object.entries(SORT_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>Ordem</span>
                    <select value={orderDirection} onChange={(event) => setOrderDirection(event.target.value)} aria-label="Definir ordem dos chamados">
                      <option value="desc">{SORT_DIRECTION_LABEL[orderBy].desc}</option>
                      <option value="asc">{SORT_DIRECTION_LABEL[orderBy].asc}</option>
                    </select>
                  </label>
                </div>
                <div className="helpdesk-filter-dates">
                  <label className="helpdesk-filter-date"><span>De</span><DateFilterInput value={startDate} onChange={setStartDate} ariaLabel="Data inicial no formato dia, mês e ano" /></label>
                  <label className="helpdesk-filter-date"><span>Até</span><DateFilterInput value={endDate} onChange={setEndDate} ariaLabel="Data final no formato dia, mês e ano" /></label>
                </div>
              </div>
            </details>

            <div className="helpdesk-table-summary">
              <strong>{tickets.length} {tickets.length === 1 ? 'chamado' : 'chamados'}</strong>
              <span>Clique em uma linha para abrir o atendimento</span>
            </div>

            <div className="helpdesk-ticket-table-wrap" ref={listScrollElement} aria-busy={loading}>
              {loading ? <p className="helpdesk-empty">Carregando chamados…</p> : null}
              {!loading && tickets.length === 0 ? <p className="helpdesk-empty">Nenhum chamado encontrado.</p> : null}
              {!loading && tickets.length > 0 ? (
                <table className="helpdesk-ticket-table">
                  <thead>
                    <tr>
                      <th>Nº</th>
                      <th>Assunto</th>
                      <th>Contato</th>
                      <th>Empresa</th>
                      <th>Atendimento</th>
                      <th>Criado em</th>
                      <th>Atualizado</th>
                      <th>Prioridade</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tickets.map((ticket) => (
                      <tr
                        key={ticket.id}
                        className="helpdesk-ticket-row"
                        role="button"
                        tabIndex={0}
                        onClick={() => openTicket(ticket.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            openTicket(ticket.id)
                          }
                        }}
                      >
                        <td data-label="Chamado" className="helpdesk-table-id">#{ticket.id}</td>
                        <td data-label="Assunto" className="helpdesk-table-subject">
                          <strong>{ticket.titulo}</strong>
                          {ticket.status === 'aberto' && !ticket.responsavel_id ? <span className="helpdesk-ticket-wait">Aguardando há {formatElapsed(ticket.criado_em, now)}</span> : null}
                        </td>
                        <td data-label="Contato" className="helpdesk-table-contact">
                          <strong>{ticket.solicitante_nome || 'Não informado'}</strong>
                          <span>{ticket.telefone || 'Sem telefone'}</span>
                        </td>
                        <td data-label="Empresa" className="helpdesk-table-company">
                          <strong>{ticket.empresa_nome || 'Não informada'}</strong>
                          <span>{ticket.cnpj || 'CNPJ não informado'}</span>
                        </td>
                        <td data-label="Atendimento" className="helpdesk-table-assignee">
                          <strong>{ticket.responsavel_nome || userMap[ticket.responsavel_id] || 'Não atribuído'}</strong>
                          <span>{ticket.departamento || 'Sem departamento'}</span>
                        </td>
                        <td data-label="Criado em"><time>{formatDate(ticket.criado_em)}</time></td>
                        <td data-label="Atualizado"><span>Há {formatElapsed(ticket.atualizado_em, now)}</span></td>
                        <td data-label="Prioridade"><span className={`helpdesk-priority helpdesk-priority--${ticket.prioridade}`}>{PRIORITY_LABEL[ticket.prioridade]}</span></td>
                        <td data-label="Status"><span className={`helpdesk-status helpdesk-status--${ticket.status}`}>{STATUS_LABEL[ticket.status] || ticket.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          </section>
        ) : (
          <main className="helpdesk-detail-panel">
            <div className="helpdesk-detail-toolbar">
              <button className="helpdesk-btn helpdesk-btn--ghost" type="button" onClick={returnToList}>
                <IconArrowLeft size={18} /> Voltar aos chamados
              </button>
            </div>
            {detailLoading || !detail ? (
              <div className="helpdesk-detail-empty"><IconTicket size={42} /><p>Carregando detalhes…</p></div>
            ) : (
              <TicketDetail
                ticket={detail}
                departments={departments}
                users={users}
                userMap={userMap}
                onChanged={refreshSelected}
                onError={setError}
                onOpenWhatsapp={openWhatsappAttendance}
              />
            )}
          </main>
        )}
      </div>

    </section>
  )
}

function TicketDetail({ ticket, departments, users, userMap, onChanged, onError, onOpenWhatsapp }) {
  const [message, setMessage] = useState('')
  const [internal, setInternal] = useState(false)
  const [sending, setSending] = useState(false)
  const [assuming, setAssuming] = useState(false)
  const [closing, setClosing] = useState(false)
  const [showTransfer, setShowTransfer] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [showEnvironment, setShowEnvironment] = useState(false)
  const timeline = useMemo(() => [
    ...(ticket.mensagens || []).map((item) => ({ ...item, kind: 'message' })),
    ...(ticket.transferencias || []).map((item) => ({ ...item, kind: 'transfer' })),
  ].sort((a, b) => new Date(a.criado_em).getTime() - new Date(b.criado_em).getTime()), [ticket.mensagens, ticket.transferencias])
  const hasEnvironmentInfo = [
    ticket.sistema_operacional,
    ticket.nome_maquina,
    ticket.versao_sistema,
    ticket.memoria_ram_bytes,
    ticket.processador_nome,
    ticket.processadores_logicos,
    ticket.tempo_atividade_segundos,
    ticket.espaco_disponivel_disco_c_bytes,
    ticket.espaco_total_disco_c_bytes,
  ].some((value) => value !== null && value !== undefined && value !== '')

  async function sendMessage(event) {
    event.preventDefault()
    if (!message.trim()) return
    try {
      setSending(true)
      await addTicketMessage(ticket.id, { mensagem: message.trim(), interna: internal })
      setMessage('')
      setInternal(false)
      await onChanged()
    } catch (err) {
      onError(helpDeskApiError(err))
    } finally {
      setSending(false)
    }
  }

  async function assume() {
    try {
      setAssuming(true)
      onError('')
      await assumeTicket(ticket.id)
      await onChanged()
    } catch (err) {
      onError(helpDeskApiError(err))
    } finally {
      setAssuming(false)
    }
  }

  async function closeTicket() {
    try {
      setClosing(true)
      onError('')
      await updateTicket(ticket.id, { status: 'resolvido' })
      await onChanged()
    } catch (err) {
      onError(helpDeskApiError(err))
    } finally {
      setClosing(false)
    }
  }

  return (
    <div className="helpdesk-detail">
      <div className="helpdesk-detail-head">
        <div><span>Chamado #{ticket.id}</span><h2>{ticket.titulo}</h2></div>
        <div className="helpdesk-detail-actions">
          {ticket.status === 'aberto' && !ticket.responsavel_id ? <button className="helpdesk-btn helpdesk-btn--primary" type="button" disabled={assuming} onClick={assume}><IconUserCheck size={18} /> {assuming ? 'Assumindo…' : 'Assumir'}</button> : null}
          {ticket.status === 'em_atendimento' ? <button className="helpdesk-btn helpdesk-btn--close" type="button" disabled={closing} onClick={closeTicket}><IconCircleCheck size={18} /> {closing ? 'Encerrando…' : 'Encerrar'}</button> : null}
          {hasEnvironmentInfo ? <button className="helpdesk-btn helpdesk-btn--ghost" type="button" onClick={() => setShowEnvironment(true)}><IconDeviceDesktop size={18} /> Informações</button> : null}
          <button className="helpdesk-btn helpdesk-btn--ghost" type="button" onClick={() => setShowEdit(true)}><IconEdit size={18} /> Editar</button>
          <button className="helpdesk-btn helpdesk-btn--ghost" type="button" onClick={() => setShowTransfer(true)}><IconArrowRight size={18} /> Transferir</button>
        </div>
      </div>
      <section className="helpdesk-customer-card">
        <div><span>Nome fantasia</span><strong>{ticket.empresa_nome || 'Não informado'}</strong></div>
        <div><span>Razão social</span><strong>{ticket.empresa_razao || 'Não informada'}</strong></div>
        <div><span>CNPJ</span><strong>{ticket.cnpj || 'Não informado'}</strong></div>
        <div><span>Usuário</span><strong>{ticket.solicitante_nome || 'Não informado'}</strong></div>
        <div>
          <span>Telefone</span>
          <div className="helpdesk-phone-row">
            <strong>{ticket.telefone || 'Não informado'}</strong>
            {ticket.telefone ? (
              <button
                className="helpdesk-whatsapp-link"
                type="button"
                title="Abrir ou iniciar atendimento no WhatsApp"
                aria-label="Abrir ou iniciar atendimento no WhatsApp"
                onClick={() => onOpenWhatsapp(ticket)}
              >
                <IconBrandWhatsapp size={16} />
              </button>
            ) : null}
          </div>
        </div>
      </section>
      <div className="helpdesk-meta-grid">
        <div><span>Status</span><strong>{STATUS_LABEL[ticket.status] || ticket.status}</strong></div>
        <div><span>Prioridade</span><strong>{PRIORITY_LABEL[ticket.prioridade]}</strong></div>
        <div><span>Departamento</span><strong>{ticket.departamento || 'Sem departamento'}</strong></div>
        <div><span>Responsável</span><strong>{ticket.responsavel_nome || userMap[ticket.responsavel_id] || 'Não atribuído'}</strong></div>
        <div><span>Avaliação</span><strong className={Number(ticket.avaliacao) > 0 ? 'helpdesk-rating' : undefined}>{Number(ticket.avaliacao) > 0 ? `${'★'.repeat(Number(ticket.avaliacao))}${'☆'.repeat(5 - Number(ticket.avaliacao))} (${ticket.avaliacao}/5)` : 'Não avaliado'}</strong></div>
      </div>
      <article className="helpdesk-description"><span>Descrição</span><p>{ticket.descricao}</p></article>
      <section className="helpdesk-timeline">
        <h3>Histórico</h3>
        {timeline.length === 0 ? <p className="helpdesk-empty">Ainda não há movimentações neste chamado.</p> : null}
        {timeline.map((item) => item.kind === 'message' ? (
          <article className={`helpdesk-message${item.interna ? ' is-internal' : ''}`} key={`message-${item.id}`}>
            <div><strong>{item.autor_nome || item.solicitante_nome || userMap[item.autor_usuario_id] || ticket.solicitante_nome || 'Usuário'}</strong>{item.interna ? <span>Nota interna</span> : null}<time>{formatDate(item.criado_em)}</time></div>
            <p>{item.mensagem}</p>
          </article>
        ) : (
          <article className="helpdesk-message helpdesk-transfer-event" key={`transfer-${item.id}`}>
            <div><strong>{item.transferido_por_nome || userMap[item.transferido_por] || 'Usuário'}</strong><span>Transferência</span><time>{formatDate(item.criado_em)}</time></div>
            <p>
              Departamento: {item.de_departamento_nome || 'Sem departamento'} → {item.para_departamento_nome || 'Sem departamento'}
              <br />
              Responsável: {item.de_responsavel_nome || 'Não atribuído'} → {item.para_responsavel_nome || 'Não atribuído'}
              {item.motivo ? <><br />Motivo: {item.motivo}</> : null}
            </p>
          </article>
        ))}
      </section>
      <form className="helpdesk-composer" onSubmit={sendMessage}>
        <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Escreva uma atualização…" rows={3} />
        <div><label><input type="checkbox" checked={internal} onChange={(event) => setInternal(event.target.checked)} /> Nota interna</label><button className="helpdesk-btn helpdesk-btn--primary" disabled={sending || !message.trim()}><IconMessagePlus size={18} /> {sending ? 'Enviando…' : 'Adicionar mensagem'}</button></div>
      </form>
      {showTransfer ? <TransferModal ticket={ticket} departments={departments} users={users} onClose={() => setShowTransfer(false)} onSaved={async () => { setShowTransfer(false); await onChanged() }} /> : null}
      {showEdit ? <EditTicketModal ticket={ticket} departments={departments} onClose={() => setShowEdit(false)} onSaved={async () => { setShowEdit(false); await onChanged() }} onError={onError} /> : null}
      {showEnvironment ? <OperationalInfoModal ticket={ticket} onClose={() => setShowEnvironment(false)} /> : null}
    </div>
  )
}

function OperationalInfoModal({ ticket, onClose }) {
  return <Modal title={`Informações operacionais`} onClose={onClose}>
    <div className="helpdesk-operational-grid">
      <div><span>Sistema operacional</span><strong>{ticket.sistema_operacional || 'Não informado'}</strong></div>
      <div><span>Nome da máquina</span><strong>{ticket.nome_maquina || 'Não informado'}</strong></div>
      <div><span>Versão do sistema</span><strong>{ticket.versao_sistema || 'Não informada'}</strong></div>
      <div><span>Memória RAM</span><strong>{formatBytes(ticket.memoria_ram_bytes)}</strong></div>
      <div><span>Processador</span><strong>{ticket.processador_nome || 'Não informado'}</strong></div>
      <div><span>Processadores lógicos</span><strong>{ticket.processadores_logicos ?? 'Não informado'}</strong></div>
      <div><span>Tempo de atividade</span><strong>{formatUptime(ticket.tempo_atividade_segundos)}</strong></div>
      <div><span>Espaço disponível no disco C:</span><strong>{formatBytes(ticket.espaco_disponivel_disco_c_bytes)}</strong></div>
      <div><span>Espaço total no disco C:</span><strong>{formatBytes(ticket.espaco_total_disco_c_bytes)}</strong></div>
    </div>
  </Modal>
}

function EditTicketModal({ ticket, departments, onClose, onSaved, onError }) {
  const [status, setStatus] = useState(ticket.status)
  const [priority, setPriority] = useState(ticket.prioridade)
  const [departmentId, setDepartmentId] = useState(
    departments.find((item) => item.nome === ticket.departamento)?.id || ''
  )
  const [saving, setSaving] = useState(false)

  async function submit(event) {
    event.preventDefault()
    try {
      setSaving(true)
      await updateTicket(ticket.id, {
        status,
        prioridade: priority,
        departamento_id: departmentId ? Number(departmentId) : null,
      })
      await onSaved()
    } catch (error) {
      onError(helpDeskApiError(error))
    } finally {
      setSaving(false)
    }
  }

  return <Modal title="Editar chamado" onClose={onClose}><form className="helpdesk-form" onSubmit={submit}><label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}>{Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Prioridade<select value={priority} onChange={(event) => setPriority(event.target.value)}>{Object.entries(PRIORITY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Departamento<select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}><option value="">Sem departamento</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.nome}</option>)}</select></label><div className="helpdesk-modal-actions"><button type="button" className="helpdesk-btn helpdesk-btn--ghost" onClick={onClose}>Cancelar</button><button className="helpdesk-btn helpdesk-btn--primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar alterações'}</button></div></form></Modal>
}

function TransferModal({ ticket, departments, users, onClose, onSaved }) {
  const [departmentId, setDepartmentId] = useState(
    departments.find((item) => item.nome === ticket.departamento)?.id || ''
  )
  const [assigneeId, setAssigneeId] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const filteredUsers = departmentId ? users.filter((u) => !u.departamento_id || Number(u.departamento_id) === Number(departmentId)) : users
  async function submit(event) { event.preventDefault(); try { setSaving(true); await transferTicket(ticket.id, { departamento_id: departmentId ? Number(departmentId) : null, responsavel_id: assigneeId ? Number(assigneeId) : null, motivo: reason.trim() || null }); onSaved() } finally { setSaving(false) } }
  return <Modal title="Transferir chamado" onClose={onClose}><form className="helpdesk-form" onSubmit={submit}><label>Departamento<select value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setAssigneeId('') }}><option value="">Selecione</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.nome}</option>)}</select></label><label>Responsável<select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}><option value="">Deixar na fila do departamento</option>{filteredUsers.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}</select></label><label>Motivo<textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></label><div className="helpdesk-modal-actions"><button type="button" className="helpdesk-btn helpdesk-btn--ghost" onClick={onClose}>Cancelar</button><button className="helpdesk-btn helpdesk-btn--primary" disabled={saving || (!departmentId && !assigneeId)}>{saving ? 'Transferindo…' : 'Confirmar transferência'}</button></div></form></Modal>
}

function Modal({ title, onClose, children }) {
  return <div className="helpdesk-modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><section className="helpdesk-modal" role="dialog" aria-modal="true" aria-label={title}><div className="helpdesk-modal-head"><h2>{title}</h2><button type="button" onClick={onClose} aria-label="Fechar">×</button></div>{children}</section></div>
}
