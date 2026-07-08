/**
 * Diagnóstico de notificações (temporário / on-demand).
 *
 * SEGURO: só lê estado e expõe helpers no `window`. Não altera regras de atendimento,
 * conversas, mensagens, setores ou permissões. Nada é enviado sem o usuário chamar
 * explicitamente um dos helpers de teste.
 *
 * Uso no console do navegador (F12):
 *   await window.zapNotifDiag()        → imprime e devolve o estado completo
 *   await window.zapNotifTestLocal()   → mostra um card LOCAL de teste (Notification API)
 *   await window.zapNotifTestPush()    → pede ao backend um Web Push de teste (app fechado)
 *
 * Log automático (resumo) ao carregar: ative com
 *   localStorage.setItem('zaperp_push_debug','1') e recarregue.
 */
import api from "../api/http"
import {
  pushSupported,
  fetchVapidPublicKey,
  getPushServiceWorkerRegistration,
} from "./webPushClient"

function debugEnabled() {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem("zaperp_push_debug") === "1"
  } catch {
    return false
  }
}

function maskEndpoint(endpoint) {
  const ep = String(endpoint || "").trim()
  if (!ep) return null
  try {
    const u = new URL(ep)
    const tail = u.pathname.length > 12 ? `…${u.pathname.slice(-12)}` : u.pathname
    return `${u.origin}${tail}`
  } catch {
    return `${ep.slice(0, 24)}…`
  }
}

/** Pergunta ao SW ativo a sua versão (SW antigo/cache não responde → prova de PWA desatualizado). */
function askServiceWorkerVersion(reg, timeoutMs = 1500) {
  return new Promise((resolve) => {
    try {
      const target = reg?.active
      if (!target || typeof MessageChannel === "undefined") {
        resolve(null)
        return
      }
      const mc = new MessageChannel()
      const timer = setTimeout(() => resolve(null), timeoutMs)
      mc.port1.onmessage = (e) => {
        clearTimeout(timer)
        resolve(e?.data?.swVersion || null)
      }
      target.postMessage({ type: "ZAP_SW_VERSION" }, [mc.port2])
    } catch {
      resolve(null)
    }
  })
}

/** Lê o manifest em runtime — detecta manifest/ícone ANTIGO em cache (ícone diferente entre PCs). */
async function readManifest() {
  try {
    const res = await fetch("/manifest.webmanifest", { cache: "no-store" })
    if (!res.ok) return { error: `HTTP ${res.status}` }
    const j = await res.json()
    return {
      name: j?.name || null,
      short_name: j?.short_name || null,
      display: j?.display || null,
      start_url: j?.start_url || null,
      firstIcon: Array.isArray(j?.icons) && j.icons[0] ? j.icons[0].src : null,
    }
  } catch (e) {
    return { error: String(e?.message || e) }
  }
}

/** Estado completo do subsistema de notificações neste dispositivo/navegador. */
export async function collectNotificationDiagnostics() {
  const out = {
    timestamp: new Date().toISOString(),
    url: typeof location !== "undefined" ? location.href : null,
    secureContext: typeof window !== "undefined" ? !!window.isSecureContext : null,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    standalone:
      typeof window !== "undefined" &&
      ((window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
        window.navigator?.standalone === true),
    notificationSupport: typeof window !== "undefined" && "Notification" in window,
    notificationPermission:
      typeof Notification !== "undefined" ? Notification.permission : "unsupported",
    pushManagerAvailable: typeof window !== "undefined" && "PushManager" in window,
    serviceWorkerAvailable: typeof navigator !== "undefined" && "serviceWorker" in navigator,
    pushSupported: pushSupported(),
    serviceWorker: null,
    subscription: null,
    manifest: null,
    server: { vapidEnabled: null, vapidPublicKeyPreview: null, error: null },
  }

  out.manifest = await readManifest()

  // Service Worker
  try {
    if (out.serviceWorkerAvailable) {
      const reg = await getPushServiceWorkerRegistration()
      if (reg) {
        const active = reg.active || reg.waiting || reg.installing
        const swVersion = await askServiceWorkerVersion(reg)
        out.serviceWorker = {
          registered: true,
          scope: reg.scope || null,
          scriptURL: active?.scriptURL || null,
          state: active?.state || null,
          updateViaCache: reg.updateViaCache || null,
          // null = SW antigo em cache (não respondeu) → PWA desatualizado nesta máquina.
          version: swVersion,
          hasWaiting: !!reg.waiting,
        }
        // Subscription
        try {
          const sub = await reg.pushManager.getSubscription()
          out.subscription = sub
            ? {
                exists: true,
                endpoint: maskEndpoint(sub.endpoint),
                hasApplicationServerKey: !!sub.options?.applicationServerKey,
                expirationTime: sub.expirationTime || null,
              }
            : { exists: false }
        } catch (e) {
          out.subscription = { exists: false, error: String(e?.message || e) }
        }
      } else {
        out.serviceWorker = { registered: false }
      }
    }
  } catch (e) {
    out.serviceWorker = { registered: false, error: String(e?.message || e) }
  }

  // VAPID no servidor
  try {
    const v = await fetchVapidPublicKey()
    out.server.vapidEnabled = !!v?.publicKey
    out.server.vapidPublicKeyPreview = v?.publicKey ? `${String(v.publicKey).slice(0, 12)}…` : null
    if (v?.enabled === false) out.server.vapidEnabled = false
  } catch (e) {
    out.server.error = String(e?.message || e)
  }

  return out
}

/** Diagnóstico "veredito": aponta o próximo passo mais provável. */
function verdict(diag) {
  if (!diag.notificationSupport) return "Navegador sem suporte a Notification API."
  if (!diag.secureContext) return "Contexto não seguro (precisa de HTTPS ou localhost) — SW/Push não funcionam."
  if (diag.notificationPermission === "denied")
    return "Permissão BLOQUEADA no navegador/SO — libere nas configurações do site e recarregue."
  if (diag.notificationPermission !== "granted")
    return "Permissão ainda não concedida — clique em 'Ativar notificações' (gesto do usuário)."
  if (!diag.serviceWorker?.registered)
    return "Service Worker NÃO registrado — precisa do build de produção servido por HTTPS."
  if (diag.server.vapidEnabled === false)
    return "VAPID ausente no backend — sem isso NÃO há push com o app fechado. Configure VAPID_PUBLIC_KEY/PRIVATE_KEY."
  if (diag.serviceWorker?.registered && !diag.serviceWorker?.version)
    return "SW não respondeu à versão → possível Service Worker ANTIGO em cache (PWA desatualizado). Faça o procedimento de limpeza/reinstalação do PWA nesta máquina."
  if (diag.serviceWorker?.hasWaiting)
    return "Há um SW novo AGUARDANDO ativação — feche todas as abas/janelas do ZapERP e reabra (ou DevTools → Service Workers → skipWaiting)."
  return "Estado OK para o card com o app aberto. Se o banner só cai na Central do Windows, é config de banner por-app da PWA no Windows (ver checklist)."
}

export async function zapNotifDiag() {
  const diag = await collectNotificationDiagnostics()
  const conclusion = verdict(diag)
  try {
    console.group("%c[ZapERP] Diagnóstico de Notificações", "font-weight:bold")
    console.log("Permissão:", diag.notificationPermission)
    console.log("Contexto seguro (HTTPS):", diag.secureContext)
    console.log("Service Worker:", diag.serviceWorker)
    console.log("  → versão do SW:", diag.serviceWorker?.version || "(antigo/sem resposta — PWA desatualizado)")
    console.log("PushManager disponível:", diag.pushManagerAvailable)
    console.log("Subscription:", diag.subscription)
    console.log("Manifest (nome/ícone):", diag.manifest)
    console.log("VAPID no servidor:", diag.server)
    console.log("PWA instalada (standalone):", diag.standalone)
    console.log("%c→ " + conclusion, "color:#0d6efd;font-weight:bold")
    console.groupEnd()
  } catch {
    /* ignore */
  }
  return { ...diag, conclusion }
}

/** Card LOCAL de teste (Notification API) — valida o caminho do banner do SO independente do push. */
export async function zapNotifTestLocal() {
  if (typeof Notification === "undefined") return { ok: false, reason: "unsupported" }
  let perm = Notification.permission
  if (perm === "default") perm = await Notification.requestPermission()
  if (perm !== "granted") return { ok: false, reason: perm }
  try {
    const n = new Notification("ZapERP — teste local", {
      body: "Se você vê este banner, o card LOCAL funciona.",
      icon: "/brand/pwa-192.png",
      tag: `zap-diag-local-${Date.now()}`,
      requireInteraction: false,
    })
    setTimeout(() => {
      try {
        n.close()
      } catch {
        /* ignore */
      }
    }, 8000)
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: "creation_failed", error: String(e?.message || e) }
  }
}

/** Web Push de teste (backend → SW). Valida o caminho de "app fechado". Requer VAPID + subscription. */
export async function zapNotifTestPush() {
  const endpoints = ["/usuarios/me/push/test", "/api/usuarios/me/push/test"]
  let lastErr = null
  for (const ep of endpoints) {
    try {
      const res = await api.post(ep, {}, { silent: true })
      console.log("[ZapERP] Push de teste solicitado:", res?.data)
      return { ok: true, endpoint: ep, data: res?.data }
    } catch (e) {
      lastErr = { status: e?.response?.status, message: e?.response?.data?.error || e?.message }
      if (e?.response?.status && e.response.status !== 404) break
    }
  }
  console.warn("[ZapERP] Push de teste falhou:", lastErr)
  return { ok: false, error: lastErr }
}

/** Anexa os helpers ao window e imprime um resumo se o modo debug estiver ligado. */
export function initNotificationDiagnostics() {
  if (typeof window === "undefined") return
  try {
    window.zapNotifDiag = zapNotifDiag
    window.zapNotifTestLocal = zapNotifTestLocal
    window.zapNotifTestPush = zapNotifTestPush
  } catch {
    /* ignore */
  }
  if (debugEnabled()) {
    // Não bloqueia o boot; roda em segundo plano.
    setTimeout(() => {
      zapNotifDiag().catch(() => {})
    }, 1500)
  }
}
