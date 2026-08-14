import { useCallback, useEffect, useMemo, useState } from 'react'
import { IconArrowRight, IconCircleCheck, IconEdit, IconMessagePlus, IconRefresh, IconTicket, IconUserCheck } from '@tabler/icons-react'
import { useAuthStore } from '../auth/authStore'
import { getDepartamentos, getUsuarios } from '../api/configService'
import {
  addTicketMessage,
  assumeTicket,
  getTicket,
  helpDeskApiError,
  listTickets,
  transferTicket,
  updateTicket,
} from '../api/helpDeskService'
import './helpDesk.css'
import './helpDeskTheme.css'

const STATUS_LABEL = {
  aberto: 'Aberto',
  em_atendimento: 'Em atendimento',
  resolvido: 'Resolvido',
}

const PRIORITY_LABEL = { baixa: 'Baixa', normal: 'Normal', alta: 'Alta', urgente: 'Urgente' }
const FILTER_STORAGE_PREFIX = 'zaperp_helpdesk_filters'

function loadStoredFilters(user) {
  const defaults = { status: '', priority: '', search: '', myQueue: false, startDate: '', endDate: '' }
  if (typeof window === 'undefined') return defaults
  try {
    const key = `${FILTER_STORAGE_PREFIX}:${user?.company_id || 'unknown'}:${user?.id || 'unknown'}`
    const stored = JSON.parse(window.localStorage.getItem(key) || 'null')
    if (!stored || typeof stored !== 'object') return defaults
    return {
      status: stored.status && STATUS_LABEL[stored.status] ? stored.status : '',
      priority: stored.priority && PRIORITY_LABEL[stored.priority] ? stored.priority : '',
      search: typeof stored.search === 'string' ? stored.search : '',
      myQueue: stored.myQueue === true,
      startDate: typeof stored.startDate === 'string' ? stored.startDate : '',
      endDate: typeof stored.endDate === 'string' ? stored.endDate : '',
    }
  } catch {
    return defaults
  }
}

function formatDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
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
  const initialFilters = useMemo(() => loadStoredFilters(user), [user?.company_id, user?.id])
  const [tickets, setTickets] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState(() => initialFilters.status)
  const [priority, setPriority] = useState(() => initialFilters.priority)
  const [search, setSearch] = useState(() => initialFilters.search)
  const [myQueue, setMyQueue] = useState(() => initialFilters.myQueue)
  const [startDate, setStartDate] = useState(() => initialFilters.startDate)
  const [endDate, setEndDate] = useState(() => initialFilters.endDate)
  const [departments, setDepartments] = useState([])
  const [users, setUsers] = useState([])
  const [now, setNow] = useState(() => Date.now())

  const userMap = useMemo(() => Object.fromEntries(users.map((item) => [item.id, item.nome])), [users])

  const loadTickets = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      const data = await listTickets({
        status: status || undefined,
        prioridade: priority || undefined,
        q: search.trim() || undefined,
        responsavel_id: myQueue ? user?.id : undefined,
        data_inicio: startDate || undefined,
        data_fim: endDate || undefined,
        limit: 100,
      })
      const items = data?.items || []
      setTickets(items)
      setSelectedId((current) => (current && items.some((item) => item.id === current) ? current : items[0]?.id || null))
    } catch (err) {
      setError(helpDeskApiError(err))
    } finally {
      setLoading(false)
    }
  }, [endDate, myQueue, priority, search, startDate, status, user?.id])

  const loadDetail = useCallback(async (id) => {
    if (!id) {
      setDetail(null)
      return
    }
    try {
      setDetailLoading(true)
      setError('')
      setDetail(await getTicket(id))
    } catch (err) {
      setError(helpDeskApiError(err))
      setDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => { loadTickets() }, [loadTickets])
  useEffect(() => { loadDetail(selectedId) }, [loadDetail, selectedId])
  useEffect(() => {
    if (typeof window === 'undefined' || !user?.id || !user?.company_id) return
    const key = `${FILTER_STORAGE_PREFIX}:${user.company_id}:${user.id}`
    window.localStorage.setItem(key, JSON.stringify({ status, priority, search, myQueue, startDate, endDate }))
  }, [endDate, myQueue, priority, search, startDate, status, user?.company_id, user?.id])
  useEffect(() => {
    Promise.all([getDepartamentos(), getUsuarios()])
      .then(([deps, people]) => {
        setDepartments(Array.isArray(deps) ? deps : [])
        setUsers((Array.isArray(people) ? people : []).filter((item) => item.ativo !== false))
      })
      .catch(() => {})
  }, [])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000)
    return () => window.clearInterval(timer)
  }, [])

  async function refreshSelected() {
    await Promise.all([loadTickets(), loadDetail(selectedId)])
  }

  return (
    <section className="helpdesk-page">
      <header className="helpdesk-header">
        <div>
          <p className="helpdesk-eyebrow">Central de suporte</p>
          <h1>HelpDesk</h1>
          <p>Organize solicitações internas, acompanhe conversas e direcione cada chamado à equipe certa.</p>
        </div>
        <div className="helpdesk-header-actions">
          <button className="helpdesk-btn helpdesk-btn--ghost" type="button" onClick={refreshSelected}>
            <IconRefresh size={18} /> Atualizar
          </button>
        </div>
      </header>

      {error ? <div className="helpdesk-error" role="alert">{error}</div> : null}

      <div className="helpdesk-workspace">
        <aside className="helpdesk-list-panel">
          <details className="helpdesk-filter-panel">
            <summary>Filtros</summary>
            <div className="helpdesk-filters">
            <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filtrar por status">
              <option value="">Todos os status</option>
              {Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select value={priority} onChange={(event) => setPriority(event.target.value)} aria-label="Filtrar por prioridade">
              <option value="">Todas as prioridades</option>
              {Object.entries(PRIORITY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Empresa ou CNPJ" aria-label="Filtrar por nome da empresa ou CNPJ" />
              <label className="helpdesk-my-queue"><input type="checkbox" checked={myQueue} onChange={(event) => setMyQueue(event.target.checked)} /><span>Somente minha fila</span></label>
              <div className="helpdesk-filter-dates">
                <label className="helpdesk-filter-date"><span>De</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
                <label className="helpdesk-filter-date"><span>Até</span><input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
              </div>
            </div>
          </details>

          <div className="helpdesk-list" aria-busy={loading}>
            {loading ? <p className="helpdesk-empty">Carregando chamados…</p> : null}
            {!loading && tickets.length === 0 ? <p className="helpdesk-empty">Nenhum chamado encontrado.</p> : null}
            {tickets.map((ticket) => (
              <button
                type="button"
                key={ticket.id}
                className={`helpdesk-ticket-card${selectedId === ticket.id ? ' is-active' : ''}`}
                onClick={() => setSelectedId(ticket.id)}
              >
                <div className="helpdesk-ticket-topline">
                  <span className={`helpdesk-priority helpdesk-priority--${ticket.prioridade}`}>{PRIORITY_LABEL[ticket.prioridade]}</span>
                </div>
                <strong>{ticket.empresa_nome || 'Empresa não informada'}</strong>
                <span className="helpdesk-ticket-subject">{ticket.titulo}</span>
                {ticket.status === 'aberto' && !ticket.responsavel_id ? <span className="helpdesk-ticket-wait">Aguardando há {formatElapsed(ticket.criado_em, now)}</span> : null}
                {ticket.status === 'em_atendimento' ? <span>Atendente: {ticket.responsavel_nome || userMap[ticket.responsavel_id] || 'Não atribuído'}</span> : null}
                <div className="helpdesk-ticket-footer">
                  <span className={`helpdesk-status helpdesk-status--${ticket.status}`}>{STATUS_LABEL[ticket.status] || ticket.status}</span>
                  <time>{formatDate(ticket.atualizado_em)}</time>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <main className="helpdesk-detail-panel">
          {!selectedId ? (
            <div className="helpdesk-detail-empty"><IconTicket size={42} /><h2>Selecione um chamado</h2><p>O histórico e as ações aparecerão aqui.</p></div>
          ) : detailLoading || !detail ? (
            <div className="helpdesk-detail-empty"><p>Carregando detalhes…</p></div>
          ) : (
            <TicketDetail
              ticket={detail}
              departments={departments}
              users={users}
              userMap={userMap}
              onChanged={refreshSelected}
              onError={setError}
            />
          )}
        </main>
      </div>

    </section>
  )
}

function TicketDetail({ ticket, departments, users, userMap, onChanged, onError }) {
  const [message, setMessage] = useState('')
  const [internal, setInternal] = useState(false)
  const [sending, setSending] = useState(false)
  const [assuming, setAssuming] = useState(false)
  const [closing, setClosing] = useState(false)
  const [showTransfer, setShowTransfer] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
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
        <div><span>Chamado</span><h2>{ticket.titulo}</h2></div>
        <div className="helpdesk-detail-actions">
          {ticket.status === 'aberto' && !ticket.responsavel_id ? <button className="helpdesk-btn helpdesk-btn--primary" type="button" disabled={assuming} onClick={assume}><IconUserCheck size={18} /> {assuming ? 'Assumindo…' : 'Assumir'}</button> : null}
          {ticket.status === 'em_atendimento' ? <button className="helpdesk-btn helpdesk-btn--primary" type="button" disabled={closing} onClick={closeTicket}><IconCircleCheck size={18} /> {closing ? 'Encerrando…' : 'Encerrar'}</button> : null}
          <button className="helpdesk-btn helpdesk-btn--ghost" type="button" onClick={() => setShowEdit(true)}><IconEdit size={18} /> Editar</button>
          <button className="helpdesk-btn helpdesk-btn--ghost" type="button" onClick={() => setShowTransfer(true)}><IconArrowRight size={18} /> Transferir</button>
        </div>
      </div>
      <section className="helpdesk-customer-card">
        <div><span>Nome fantasia</span><strong>{ticket.empresa_nome || 'Não informado'}</strong></div>
        <div><span>Razão social</span><strong>{ticket.empresa_razao || 'Não informada'}</strong></div>
        <div><span>CNPJ</span><strong>{ticket.cnpj || 'Não informado'}</strong></div>
        <div><span>Usuário</span><strong>{ticket.solicitante_nome || 'Não informado'}</strong></div>
        <div><span>Telefone</span><strong>{ticket.telefone || 'Não informado'}</strong></div>
      </section>
      {hasEnvironmentInfo ? (
        <section className="helpdesk-environment">
          <h3>Ambiente do cliente</h3>
          <div className="helpdesk-customer-card helpdesk-environment-card">
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
        </section>
      ) : null}
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
    </div>
  )
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
