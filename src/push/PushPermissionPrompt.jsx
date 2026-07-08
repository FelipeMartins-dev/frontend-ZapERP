import { useEffect, useState } from "react"
import {
  pushSupported,
  subscribeWebPush,
} from "./webPushClient"
import { runAfterPushEntryReady, schedulePushSubscriptionSync } from "./deferredPushSync"
import "./push-permission-prompt.css"

const STORAGE_DISMISS_UNTIL = "zaperp_push_optin_dismissed_until"
const SESSION_DENIED_HINT = "zaperp_push_denied_hint_shown_v1"
const DISMISS_DAYS = 14

function dismissUntilMs() {
  return Date.now() + DISMISS_DAYS * 24 * 60 * 60 * 1000
}

export default function PushPermissionPrompt() {
  const [ui, setUi] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false

    const cancelReady = runAfterPushEntryReady(() => void (async () => {
      // IMPORTANTE: o card local (Notification API) NÃO depende de VAPID/Web Push — precisa só
      // da permissão de notificação. Por isso o prompt é oferecido sempre que houver suporte a
      // Notification, mesmo sem VAPID no servidor. (Antes o prompt abortava sem VAPID e a
      // permissão ficava em "default" → som tocava mas o card nunca aparecia.)
      if (typeof Notification === "undefined") {
        if (!cancelled) setUi("none")
        return
      }

      const perm = Notification.permission
      if (perm === "granted") {
        // Card local já funciona. Se houver Web Push disponível, sincroniza a subscription.
        if (pushSupported()) schedulePushSubscriptionSync()
        if (!cancelled) setUi("none")
        return
      }

      if (perm === "denied") {
        try {
          if (sessionStorage.getItem(SESSION_DENIED_HINT) === "1") {
            if (!cancelled) setUi("none")
            return
          }
        } catch {
          /* ignore */
        }
        if (!cancelled) setUi("denied_strip")
        return
      }

      // perm === "default": oferecer ativação (independente de VAPID).
      try {
        const raw = localStorage.getItem(STORAGE_DISMISS_UNTIL)
        const until = raw ? Number(raw) : 0
        if (until > Date.now()) {
          if (!cancelled) setUi("none")
          return
        }
      } catch {
        /* ignore */
      }

      if (!cancelled) setUi("modal")
    })())

    return () => {
      cancelled = true
      cancelReady()
    }
  }, [])

  async function handleEnable() {
    setBusy(true)
    try {
      // 1) Permissão de notificação — pedida aqui, no clique (gesto do usuário), para o
      //    navegador exibir o prompt. É o único requisito do card local (Notification API).
      let permission = typeof Notification !== "undefined" ? Notification.permission : "denied"
      if (permission === "default") {
        permission = await Notification.requestPermission()
      }
      if (permission !== "granted") {
        setUi(permission === "denied" ? "denied_strip" : "none")
        return
      }

      // 2) Permissão concedida → o card local já funciona. Se houver Web Push (VAPID no
      //    servidor), tenta subscrever também, para alertas com o app fechado. Melhor esforço:
      //    a falta de VAPID não deve tirar o card local que acabou de ser habilitado.
      try {
        await subscribeWebPush()
      } catch {
        /* ignore — card local não depende do Web Push */
      }
      setUi("none")
    } finally {
      setBusy(false)
    }
  }

  function handleDismiss() {
    try {
      localStorage.setItem(STORAGE_DISMISS_UNTIL, String(dismissUntilMs()))
    } catch {
      /* ignore */
    }
    setUi("none")
  }

  function dismissDeniedHint() {
    try {
      sessionStorage.setItem(SESSION_DENIED_HINT, "1")
    } catch {
      /* ignore */
    }
    setUi("none")
  }

  if (ui === null || ui === "none") return null

  if (ui === "modal") {
    return (
      <div className="zap-push-overlay" role="dialog" aria-modal="true" aria-labelledby="zap-push-modal-title">
        <div className="zap-push-modal">
          <div className="zap-push-modal__brand" aria-hidden="true">
            <span className="zap-push-modal__dot" />
          </div>
          <h2 id="zap-push-modal-title" className="zap-push-modal__title">
            Notificações
          </h2>
          <p className="zap-push-modal__text">
            Ative as notificações para receber o aviso visual de novas mensagens dos clientes mesmo quando estiver usando outro aplicativo.
          </p>
          <div className="zap-push-modal__actions">
            <button type="button" className="zap-push-btn zap-push-btn--secondary" disabled={busy} onClick={handleDismiss}>
              Agora não
            </button>
            <button type="button" className="zap-push-btn zap-push-btn--primary" disabled={busy} onClick={handleEnable}>
              {busy ? "Abrindo…" : "Ativar notificações"}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (ui === "denied_strip") {
    return (
      <div className="zap-push-strip" role="status">
        <p className="zap-push-strip__text">
          Notificações bloqueadas neste navegador. Para receber alertas com o app fechado, permita notificações nas
          configurações do site.
        </p>
        <button type="button" className="zap-push-strip__close" onClick={dismissDeniedHint} aria-label="Fechar aviso">
          ×
        </button>
      </div>
    )
  }

  return null
}
