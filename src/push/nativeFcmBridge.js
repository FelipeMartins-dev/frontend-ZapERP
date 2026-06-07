import { registerNativeFcmToken, isPushDiagEnabled } from "./webPushClient"

let initialized = false

/**
 * Integração com app Android nativo (WebView + FirebaseMessagingService).
 *
 * Contratos suportados:
 * 1) Evento na página: `window.dispatchEvent(new CustomEvent('zaperp-native-fcm', { detail: { token, plataforma } }))`
 * 2) Função global (ex.: @JavascriptInterface): `window.__ZAPERP_RECEIVE_FCM_TOKEN__(token, 'android-native')`
 *
 * Android 13+: o pedido POST_NOTIFICATIONS deve ser feito no lado nativo antes de mostrar notificações;
 * o WebView só recebe o token após o utilizador conceder permissão no sistema.
 */
export function initNativeFcmBridge() {
  if (initialized || typeof window === "undefined") return
  initialized = true

  window.addEventListener("zaperp-native-fcm", (ev) => {
    const t = ev?.detail?.token
    const pl = ev?.detail?.plataforma
    if (typeof t === "string" && t.trim().length >= 10) {
      if (isPushDiagEnabled()) console.debug("[push][native] evento zaperp-native-fcm", { len: t.trim().length, plataforma: pl })
      void registerNativeFcmToken(t.trim(), pl || "android-native")
    } else if (isPushDiagEnabled()) {
      console.warn("[push][native] zaperp-native-fcm com token inválido")
    }
  })

  if (typeof window.__ZAPERP_RECEIVE_FCM_TOKEN__ !== "function") {
    window.__ZAPERP_RECEIVE_FCM_TOKEN__ = (token, plataforma) => {
      if (typeof token === "string" && token.trim().length >= 10) {
        if (isPushDiagEnabled()) console.debug("[push][native] __ZAPERP_RECEIVE_FCM_TOKEN__", { len: token.trim().length })
        void registerNativeFcmToken(token.trim(), plataforma || "android-native")
      }
    }
  }
}
