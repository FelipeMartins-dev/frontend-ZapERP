/* ZapERP — Web Push (VAPID). Android/iOS tratam som, prioridade e entrega em segundo plano de forma distinta; não há API aqui para uniformizar. */
const SUPPRESS_REPLY_MS = 180

/**
 * Só interroga clientes com janela realmente em foco.
 * Em PWA móvel em segundo plano, matchAll costuma devolver clientes sem foco; esperar resposta deles
 * (MessageChannel + timeout) por cada um tornava o push lento e, em alguns SO, inconsistente após a 1.ª notificação.
 */
function clientsComJanelaEmFoco(clientList) {
  return (clientList || []).filter((c) => typeof c.focused === 'boolean' && c.focused === true)
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      try {
        let payload = {}
        try {
          const text = event.data ? await event.data.text() : '{}'
          payload = JSON.parse(text || '{}')
        } catch (_) {
          payload = {}
        }

        const conversaId =
          payload?.data?.conversaId ??
          payload?.data?.conversa_id ??
          payload?.data?.conversation_id
        const msgId =
          payload?.data?.messageId ??
          payload?.data?.mensagem_id
        const candidatos = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        const clientesFocados = clientsComJanelaEmFoco(candidatos)

        let suppress = false
        for (const client of clientesFocados) {
          try {
            const mc = new MessageChannel()
            const done = new Promise((resolve) => {
              mc.port1.onmessage = (e) => resolve(!!e?.data?.suppress)
              setTimeout(() => resolve(false), SUPPRESS_REPLY_MS)
            })
            client.postMessage({ type: 'ZAP_PUSH_SUPPRESS_CHECK', payload: { conversaId } }, [mc.port2])
            if (await done) {
              suppress = true
              break
            }
          } catch (_) {}
        }

        if (suppress) return

        const title = payload.title || 'ZapERP'
        const tagFallback =
          (msgId != null && String(msgId).trim() !== '' && `zap-${String(msgId)}`) ||
          (typeof payload.tag === 'string' && payload.tag.trim() !== '' && payload.tag.trim()) ||
          `zap-fallback-${Date.now()}`

        const shouldRequireInteraction =
          payload?.requireInteraction === true ||
          payload?.data?.requireInteraction === true ||
          payload?.priority === 'high'

        const options = {
          body: payload.body || '',
          icon: payload.icon,
          badge: payload.badge,
          tag: tagFallback,
          renotify: false,
          requireInteraction: shouldRequireInteraction,
          silent: false,
          data: payload.data && typeof payload.data === 'object' ? payload.data : {},
        }

        await self.registration.showNotification(title, options)

        // Ícone na Tela Início: indicador quando o app está em segundo plano (Badging API no SW).
        try {
          const reg = self.registration
          if (reg && typeof reg.setAppBadge === 'function') {
            const hint = payload?.data?.badgeCount
            const n = hint != null && Number.isFinite(Number(hint)) ? Math.max(0, Math.floor(Number(hint))) : null
            if (n != null && n > 0) {
              await reg.setAppBadge(Math.min(n, 99))
            } else {
              await reg.setAppBadge(1)
            }
          }
        } catch (_) {}
      } catch (e) {
        console.error('[zaperp-sw] push handler:', e)
      }
    })()
  )
})

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        for (const client of clients) {
          try {
            client.postMessage({ type: 'ZAP_PUSH_RESYNC_REQUIRED', reason: 'pushsubscriptionchange' })
          } catch (_) {}
        }
      } catch (_) {}
    })()
  )
})

function resolveNotificationOpenPath(data) {
  const d = data && typeof data === 'object' ? data : {}
  let raw =
    d.openUrl ||
    d.url ||
    (typeof d.open === 'string' ? d.open : '') ||
    ''
  raw = typeof raw === 'string' ? raw.trim() : ''
  if (raw) {
    if (raw.startsWith('/chat')) {
      try {
        const u = new URL(raw, self.location.origin)
        const cid =
          u.searchParams.get('conversa_id') ||
          u.searchParams.get('conversa') ||
          ''
        if (cid) return `/atendimento?conversa=${encodeURIComponent(cid)}`
      } catch (_) {}
    }
    return raw.startsWith('/') ? raw : `/${raw}`
  }
  const cid = d.conversaId ?? d.conversa_id
  if (cid != null && String(cid).trim() !== '') {
    return `/atendimento?conversa=${encodeURIComponent(String(cid).trim())}`
  }
  return '/atendimento'
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  const openPath = resolveNotificationOpenPath(data)
  const scope = self.registration.scope || '/'
  let origin
  try {
    origin = new URL(scope).origin
  } catch (_) {
    origin = ''
  }
  const targetUrl =
    openPath.startsWith('http') || openPath.startsWith('//')
      ? openPath
      : `${origin}${openPath.startsWith('/') ? openPath : `/${openPath}`}`

  event.waitUntil(
    (async () => {
      try {
        const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        for (const client of clientList) {
          if (origin && String(client.url || '').startsWith(origin) && 'focus' in client) {
            await client.focus()
            client.postMessage({
              type: 'ZAP_PUSH_NAVIGATE',
              openPath: openPath.startsWith('http') ? openPath : openPath,
            })
            return
          }
        }
        await self.clients.openWindow(targetUrl)
      } catch (e) {
        console.error('[zaperp-sw] notificationclick:', e)
      }
    })()
  )
})
