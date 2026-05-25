import axios from "axios"
import { getApiBaseUrl } from "./baseUrl"
import { disconnectSocket } from "../socket/socket"
import { useNotificationStore } from "../notifications/notificationStore"

const baseURL = getApiBaseUrl()

const withCredentials =
  String(import.meta.env.VITE_WITH_CREDENTIALS || "").trim() === "1" ||
  String(import.meta.env.VITE_WITH_CREDENTIALS || "").toLowerCase() === "true"

const api = axios.create({
  baseURL,
  ...(withCredentials ? { withCredentials: true } : {}),
})

// 🔐 injeta token sempre do localStorage
api.interceptors.request.use((config) => {
  const raw = localStorage.getItem("zap_erp_auth")

  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      const token = parsed?.token
      if (token) config.headers.Authorization = `Bearer ${token}`
    } catch (_) {
      // auth inválido; próximo request pode resultar em 401
    }
  }

  return config
})

function requestHadBearerToken(config) {
  const h = config?.headers
  if (!h) return false
  const auth = h.Authorization ?? h.authorization
  return typeof auth === "string" && /^Bearer\s+\S+/i.test(auth)
}

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err?.response?.status
    if (status === 401) {
      const url = String(err?.config?.url || "")
      const isLoginRequest = url.includes("/usuarios/login")
      const skipLogout = err?.config?.skipAuthLogout === true || isLoginRequest
      const hadAuth = requestHadBearerToken(err?.config)

      if (!skipLogout && hadAuth) {
        localStorage.removeItem("zap_erp_auth")
        try {
          disconnectSocket?.()
        } catch (_) {
          /* ignore */
        }
        const path = typeof window !== "undefined" ? window.location.pathname : ""
        if (path && !path.includes("/login")) {
          window.location.href = "/login"
        }
      }
      return Promise.reject(err)
    }
    if (err?.config?.silent === true) {
      return Promise.reject(err)
    }
    // Feedback global para erros de servidor/rede (evita tela travada sem aviso)
    if (typeof window !== "undefined") {
      const show = (payload) => {
        try {
          useNotificationStore?.getState()?.showToast?.(payload)
        } catch (_) {
          /* ignore */
        }
      }
      if (status === 403) {
        if (err?.config?.skipGlobal403Toast === true) {
          return Promise.reject(err)
        }
        show({
          type: "error",
          title: "Acesso restrito",
          message: err?.response?.data?.error || "Você não tem permissão para acessar este recurso.",
        })
      } else if (status >= 500) {
        if (err?.config?.skipGlobal500Toast === true) {
          return Promise.reject(err)
        }
        show({ type: "error", title: "Erro no servidor", message: err?.response?.data?.error || "Tente novamente em instantes." })
      } else if (status === 429) {
        show({ type: "warning", title: "Muitas requisições", message: "Aguarde um momento antes de tentar de novo." })
      } else if (err?.message === "Network Error" || err?.code === "ECONNABORTED") {
        show({ type: "error", title: "Sem conexão", message: "Verifique sua internet e tente novamente." })
      }
    }
    return Promise.reject(err)
  }
)

export default api
