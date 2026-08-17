import { create } from 'zustand'

function notificationId(notification) {
  return notification?.id == null ? null : String(notification.id)
}

export const useHelpDeskNotifyStore = create((set, get) => ({
  items: [],
  unreadTotal: 0,
  queueTotal: 0,

  reset() {
    set({ items: [], unreadTotal: 0, queueTotal: 0 })
  },

  hydrate(payload) {
    set({
      items: Array.isArray(payload?.items) ? payload.items : [],
      unreadTotal: Math.max(0, Number(payload?.unread_count) || 0),
      queueTotal: Math.max(0, Number(payload?.queue_count) || 0),
    })
  },

  receive(notification) {
    const id = notificationId(notification)
    if (!id || get().items.some((item) => notificationId(item) === id)) return
    set((state) => ({
      items: [notification, ...state.items].slice(0, 100),
      unreadTotal: state.unreadTotal + (notification?.lida === true ? 0 : 1),
    }))
  },

  markTicketRead(ticketId, updatedCount = null) {
    const id = String(ticketId)
    const knownUnread = get().items.filter((item) => String(item.ticket_id) === id && item.lida !== true).length
    const decrement = updatedCount == null ? knownUnread : Math.max(0, Number(updatedCount) || 0)
    set((state) => ({
      items: state.items.map((item) => (
        String(item.ticket_id) === id ? { ...item, lida: true } : item
      )),
      unreadTotal: Math.max(state.queueTotal, state.unreadTotal - decrement),
    }))
  },

  markNotificationsRead(notificationIds, updatedCount = null) {
    const ids = new Set((notificationIds || []).map(String))
    const knownUnread = get().items.filter((item) => (
      ids.has(notificationId(item)) && item.lida !== true
    )).length
    const decrement = updatedCount == null ? knownUnread : Math.max(0, Number(updatedCount) || 0)
    set((state) => ({
      items: state.items.map((item) => (
        ids.has(notificationId(item)) ? { ...item, lida: true } : item
      )),
      unreadTotal: Math.max(state.queueTotal, state.unreadTotal - decrement),
    }))
  },

  markAllRead() {
    set((state) => ({
      items: state.items.map((item) => ({ ...item, lida: true })),
      unreadTotal: state.queueTotal,
    }))
  },
}))

export const selectHelpDeskUnreadTotal = (state) => state.unreadTotal
