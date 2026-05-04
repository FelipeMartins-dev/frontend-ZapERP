import axios from "axios"
import { getApiBaseUrl } from "./baseUrl"

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

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err?.response?.status
    if (status === 401) {
      localStorage.removeItem("zap_erp_auth")
      import("../socket/socket")
        .then((m) => m.disconnectSocket && m.disconnectSocket())
        .catch(() => {})
      if (typeof window !== "undefined" && !window.location.pathname.includes("/login")) {
        window.location.href = "/login"
      }
      return Promise.reject(err)
    }
    // Feedback global para erros de servidor/rede (evita tela travada sem aviso)
    if (typeof window !== "undefined") {
      const show = (payload) => {
        import("../notifications/notificationStore").then((m) => m.useNotificationStore?.getState()?.showToast(payload)).catch(() => {})
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
