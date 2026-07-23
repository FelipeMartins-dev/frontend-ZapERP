import { useEffect, useState } from "react"
import {
  pushSupported,
  subscribeWebPush,
} from "./webPushClient"
import { runAfterPushEntryReady, schedulePushSubscriptionSync } from "./deferredPushSync"
import "./push-permission-prompt.css"

const STORAGE_DISMISS_UNTIL = "zaperp_push_optin_dismissed_until"
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
      if (typeof Notification === "undefined") {
        if (!cancelled) setUi("none")
        return
      }

      const perm = Notification.permission
      if (perm === "granted") {
        if (pushSupported()) schedulePushSubscriptionSync()
        if (!cancelled) setUi("none")
        return
      }

      if (perm === "denied") {
        if (!cancelled) setUi("none")
        return
      }

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
      let permission = typeof Notification !== "undefined" ? Notification.permission : "denied"
      if (permission === "default") {
        permission = await Notification.requestPermission()
      }
      if (permission !== "granted") {
        setUi("none")
        return
      }

      try {
        await subscribeWebPush()
      } catch {
        /* Card local não depende do Web Push. */
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

  return null
}
