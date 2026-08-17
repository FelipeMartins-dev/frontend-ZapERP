import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../auth/authStore'
import { getSocket } from '../socket/socket'
import { useNotificationStore } from '../notifications/notificationStore'
import {
  listHelpDeskNotifications,
  markHelpDeskTicketNotificationsRead,
} from '../api/helpDeskService'
import { useHelpDeskNotifyStore } from './helpDeskNotifyStore'
import { notifyHelpDeskDesktopNotification } from '../notifications/desktopNotificationService'

const HELPDESK_NOTIFICATION_EVENT = 'helpdesk:notification'
const HELPDESK_NOTIFICATIONS_CHANGED_EVENT = 'helpdesk:notifications_changed'
const HELPDESK_QUEUE_CHANGED_EVENT = 'helpdesk:queue_changed'

const TOAST_BY_TYPE = {
  ticket_created: { type: 'info', fallbackTitle: 'Novo chamado' },
  message_created: { type: 'warning', fallbackTitle: 'Nova mensagem no HelpDesk' },
  ticket_transferred: { type: 'handoff', fallbackTitle: 'Chamado transferido para você' },
}

function selectedTicketFromSearch(search) {
  const value = new URLSearchParams(search || '').get('ticket')
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

async function markTicketRead(ticketId) {
  try {
    const result = await markHelpDeskTicketNotificationsRead(ticketId)
    useHelpDeskNotifyStore.getState().markTicketRead(ticketId, result?.updated)
  } catch {
    /* a hidratação seguinte recupera o contador do backend */
  }
}

export default function HelpDeskGlobalSocketBridge() {
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((state) => state.user)
  const locationRef = useRef(location)
  locationRef.current = location

  useEffect(() => {
    if (!user?.id || Number(user?.company_id) !== 1) {
      useHelpDeskNotifyStore.getState().reset()
      return undefined
    }

    let cancelled = false
    listHelpDeskNotifications({ limit: 100 })
      .then((payload) => {
        if (!cancelled) useHelpDeskNotifyStore.getState().hydrate(payload)
      })
      .catch(() => {})

    return () => { cancelled = true }
  }, [user?.company_id, user?.id])

  useEffect(() => {
    if (!user?.id || Number(user?.company_id) !== 1) return undefined
    const socket = getSocket()

    const onNotification = (notification = {}) => {
      if (Number(notification.company_id) !== Number(user.company_id)) return
      if (Number(notification.usuario_id) !== Number(user.id)) return
      const ticketId = Number(notification.ticket_id)
      if (!Number.isInteger(ticketId) || ticketId <= 0) return

      if (notification.efemera !== true) {
        useHelpDeskNotifyStore.getState().receive(notification)
      }

      const current = locationRef.current
      const ticketIsOpen = current.pathname === '/helpdesk' && selectedTicketFromSearch(current.search) === ticketId
      if (ticketIsOpen) {
        void markTicketRead(ticketId)
        return
      }

      const appearance = TOAST_BY_TYPE[notification.tipo] || TOAST_BY_TYPE.ticket_created
      useNotificationStore.getState().showToast({
        type: appearance.type,
        title: notification.titulo || appearance.fallbackTitle,
        message: notification.mensagem || `Chamado #${ticketId}`,
        actionLabel: 'Abrir chamado',
        onAction: () => {
          navigate(`/helpdesk?ticket=${ticketId}`)
          void markTicketRead(ticketId)
        },
      })
      void notifyHelpDeskDesktopNotification({ notification })
    }

    const onNotificationsChanged = (payload = {}) => {
      if (Number(payload.company_id) !== Number(user.company_id)) return
      if (Number(payload.usuario_id) !== Number(user.id)) return
      useHelpDeskNotifyStore.getState().markNotificationsRead(
        payload.notification_ids,
        payload.updated
      )
    }

    const onQueueChanged = (payload = {}) => {
      if (Number(payload.company_id) !== Number(user.company_id)) return
      if (Number(payload.usuario_id) !== Number(user.id)) return
      listHelpDeskNotifications({ limit: 100 })
        .then((result) => useHelpDeskNotifyStore.getState().hydrate(result))
        .catch(() => {})
    }

    socket?.on(HELPDESK_NOTIFICATION_EVENT, onNotification)
    socket?.on(HELPDESK_NOTIFICATIONS_CHANGED_EVENT, onNotificationsChanged)
    socket?.on(HELPDESK_QUEUE_CHANGED_EVENT, onQueueChanged)
    return () => {
      socket?.off(HELPDESK_NOTIFICATION_EVENT, onNotification)
      socket?.off(HELPDESK_NOTIFICATIONS_CHANGED_EVENT, onNotificationsChanged)
      socket?.off(HELPDESK_QUEUE_CHANGED_EVENT, onQueueChanged)
    }
  }, [navigate, user?.company_id, user?.id])

  return null
}
