import { useCallback, useEffect, useState } from "react"
import {
  pushSupported,
  fetchVapidPublicKey,
  subscribeWebPush,
  unsubscribeWebPush,
  syncPushSubscriptionSilently,
  getPushServiceWorkerRegistration,
} from "./webPushClient"
import { getPushPlatformHints } from "./pushPlatform"

export default function PushNotificationsCard() {
  const [ready, setReady] = useState(false)
  const [serverEnabled, setServerEnabled] = useState(false)
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState(null)

  const refresh = useCallback(async () => {
    if (!pushSupported()) {
      setReady(true)
      setServerEnabled(false)
      setSubscribed(false)
      return
    }
    try {
      const v = await fetchVapidPublicKey()
      setServerEnabled(!!v.publicKey)
      const reg = await getPushServiceWorkerRegistration()
      if (!reg) {
        setSubscribed(false)
        setLastSyncAt(new Date().toISOString())
        return
      }
      const sub = await reg.pushManager.getSubscription()
      setSubscribed(!!sub)
      setLastSyncAt(new Date().toISOString())
    } catch {
      setServerEnabled(false)
      setSubscribed(false)
    } finally {
      setReady(true)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function handleEnable() {
    setBusy(true)
    try {
      await subscribeWebPush()
      setLastSyncAt(new Date().toISOString())
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function handleDisable() {
    setBusy(true)
    try {
      await unsubscribeWebPush()
      setLastSyncAt(new Date().toISOString())
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function handleReactivate() {
    setBusy(true)
    try {
      await syncPushSubscriptionSilently()
      setLastSyncAt(new Date().toISOString())
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  if (!ready) return null

  if (!pushSupported()) {
    return (
      <div className="ia-field" style={{ marginTop: 20 }}>
        <h4>Notificações no celular</h4>
        <p className="ia-muted">Seu navegador não suporta notificações push neste dispositivo.</p>
      </div>
    )
  }

  if (!serverEnabled) {
    return (
      <div className="ia-field" style={{ marginTop: 20 }}>
        <h4>Notificações no celular</h4>
        <p className="ia-muted">
          As notificações push ainda não estão habilitadas no servidor (VAPID). Entre em contato com o suporte se precisar
          deste recurso.
        </p>
      </div>
    )
  }

  const perm = typeof Notification !== "undefined" ? Notification.permission : "denied"
  const platformHints = getPushPlatformHints()
  const syncLabel = lastSyncAt ? new Date(lastSyncAt).toLocaleString("pt-BR") : "nunca"

  return (
    <div className="ia-field config-appearance-row" style={{ marginTop: 24 }}>
      <h4>Notificações no celular</h4>
      <p className="ia-muted config-appearance-hint" style={{ marginBottom: 12 }}>
        Receba alerta de nova mensagem fora do ZapERP quando o sistema permitir. O comportamento não é o mesmo em todos
        os aparelhos: Android e iPhone/iPad aplicam regras diferentes ao Web Push e à PWA.
      </p>
      <ul className="ia-muted config-appearance-hint" style={{ margin: "0 0 12px 1rem", padding: 0, lineHeight: 1.45 }}>
        {platformHints.lines.map((line, i) => (
          <li key={i} style={{ marginBottom: 8 }}>
            {line}
          </li>
        ))}
      </ul>
      <div className="ia-muted" style={{ marginBottom: 12, display: "grid", gap: 4 }}>
        <span><strong>Suportado:</strong> {pushSupported() ? "sim" : "não"}</span>
        <span><strong>Permissão:</strong> {perm}</span>
        <span><strong>Assinado:</strong> {subscribed ? "sim" : "não"}</span>
        <span><strong>Última sincronização:</strong> {syncLabel}</span>
      </div>
      {perm === "denied" ? (
        <p className="ia-muted">
          As notificações estão bloqueadas nas configurações do navegador ou do sistema. Libere para o site ZapERP nas
          permissões do navegador para usar este recurso.
        </p>
      ) : subscribed ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          <span className="ia-muted">Notificações push ativas neste dispositivo.</span>
          <button type="button" className="ia-btn ia-btn--outline" disabled={busy} onClick={handleReactivate}>
            Reativar notificações
          </button>
          <button type="button" className="ia-btn ia-btn--outline" disabled={busy} onClick={handleDisable}>
            Desativar neste aparelho
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          <button type="button" className="ia-btn ia-btn--primary" disabled={busy} onClick={handleEnable}>
            Ativar notificações push
          </button>
          <button type="button" className="ia-btn ia-btn--outline" disabled={busy} onClick={handleReactivate}>
            Reativar notificações
          </button>
          <span className="ia-muted">Será solicitada permissão do sistema/Gestor de notificações.</span>
        </div>
      )}
    </div>
  )
}
