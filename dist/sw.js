/* ZapERP — Web Push (VAPID). Android/iOS tratam som, prioridade e entrega em segundo plano de forma distinta; não há API aqui para uniformizar. */
// Marcador de versão do Service Worker. Serve para COMPARAR máquinas: um PC preso numa
// versão antiga do PWA responderá com versão diferente (ou não responderá) ao ZAP_SW_VERSION.
// Atualize a data quando mudar a lógica do SW.
const SW_VERSION = '2026-07-13-notif-autoclose-4s'
const SUPPRESS_REPLY_MS = 180
// Tempo até o banner sumir sozinho (notificação de mensagem não deve ficar fixa na tela).
const AUTO_CLOSE_MS = 4000

// Responde a versão do SW a quem perguntar (usado pelo diagnóstico no console).
self.addEventListener('message', (event) => {
  try {
    if (event && event.data && event.data.type === 'ZAP_SW_VERSION') {
      const port = event.ports && event.ports[0]
      if (port && typeof port.postMessage === 'function') {
        port.postMessage({ swVersion: SW_VERSION })
      }
    }
  } catch (_) {}
})

/**
 * Pergunta a UM cliente se o Web Push deve ser suprimido (ele já mostra o card local).
 * Resolve false se o cliente não responder dentro de SUPPRESS_REPLY_MS — telemóvel suspenso
 * em segundo plano não responde e o push é mostrado como fallback.
 */
function pedeSupressaoAoCliente(client, conversaId) {
  return new Promise((resolve) => {
    try {
      const mc = new MessageChannel()
      const timer = setTimeout(() => resolve(false), SUPPRESS_REPLY_MS)
      mc.port1.onmessage = (e) => {
        clearTimeout(timer)
        resolve(!!(e && e.data && e.data.suppress))
      }
      client.postMessage({ type: 'ZAP_PUSH_SUPPRESS_CHECK', payload: { conversaId } }, [mc.port2])
    } catch (_) {
      resolve(false)
    }
  })
}

/**
 * Interroga TODOS os clientes de janela vivos em paralelo (não só os focados): um cliente
 * desktop vivo em segundo plano está desfocado mas mostra o card local (Notification API) e
 * responde "suppress" para evitar card duplicado. Paralelo + timeout curto mantém o push
 * rápido mesmo com clientes que não respondem (telemóvel suspenso).
 */
async function algumClientePedeSupressao(clientList, conversaId) {
  const clientes = clientList || []
  if (clientes.length === 0) return false
  const respostas = await Promise.all(clientes.map((c) => pedeSupressaoAoCliente(c, conversaId)))
  return respostas.some(Boolean)
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
        const suppress = await algumClientePedeSupressao(candidatos, conversaId)
        if (suppress) return

        const title = payload.title || 'ZapERP'
        const tagFallback =
          (msgId != null && String(msgId).trim() !== '' && `zap-${String(msgId)}`) ||
          (typeof payload.tag === 'string' && payload.tag.trim() !== '' && payload.tag.trim()) ||
          `zap-fallback-${Date.now()}`

        // `requireInteraction` deixa o banner FIXO na tela até o usuário fechar. Prioridade de
        // ENTREGA (urgency/priority 'high') não deve implicar isso — senão a notificação de
        // mensagem gruda na tela. Só fixa quando o payload pedir explicitamente.
        const shouldRequireInteraction =
          payload?.requireInteraction === true ||
          payload?.data?.requireInteraction === true

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

        // Auto-fechar o banner após ~5s (a menos que seja para exigir interação).
        // O SO já esconde o banner sozinho com requireInteraction:false; este close reforça
        // e limpa também da lista, para a notificação não "ficar fixa".
        if (!shouldRequireInteraction) {
          await new Promise((resolve) => setTimeout(resolve, AUTO_CLOSE_MS))
          try {
            const notifs = await self.registration.getNotifications({ tag: options.tag })
            notifs.forEach((n) => {
              try {
                n.close()
              } catch (_) {}
            })
          } catch (_) {}
        }
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
