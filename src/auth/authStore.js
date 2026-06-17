import { create } from "zustand"
import { login as loginService } from "./authService"
import { getUsuarioMe } from "../api/configService"
import { initSocket, disconnectSocket } from "../socket/socket"
import { useChatStore } from "../chats/chatsStore"
import { useConversaStore } from "../conversa/conversaStore"
import { usePermissoesStore } from "./permissoesStore"
import { unsubscribeWebPush, syncPushSubscriptionSilently, resetPushRegistrationDebounce } from "../push/webPushClient"
import { useEmpresaStore } from "./empresaStore"

export const useAuthStore = create((set, get) => ({
  user: null,
  token: null,
  loading: false,

  // ======================
  // LOGIN
  // ======================
  login: async (email, senha) => {
    set({ loading: true })

    try {
      const data = await loginService(email, senha)

      const usuario = data.usuario || {}

      // 🔒 NORMALIZAÇÃO: role vem do backend (perfil) para roteamento por setor e permissões
      const userNormalizado = {
        ...usuario,
        role: String(
          usuario.perfil ||
            usuario.role ||
            (usuario.email === "admin@empresa.com" ? "admin" : "atendente")
        ).toLowerCase(),
      }

      const token = data.token

      localStorage.setItem(
        "zap_erp_auth",
        JSON.stringify({
          token,
          user: userNormalizado,
        })
      )
      try {
        if (userNormalizado?.email) {
          localStorage.setItem("zap_erp_last_email", String(userNormalizado.email))
        }
      } catch (_) {}

      set({
        user: userNormalizado,
        token,
        loading: false,
      })

      // 🔌 inicia socket autenticado
      initSocket(token)

      // Notificações: o evento `storage` não dispara na mesma aba — re-registar subscription/token após login.
      resetPushRegistrationDebounce()
      void syncPushSubscriptionSilently().catch(() => {})

      // Carrega permissões do usuário (menus e proteção de rotas)
      usePermissoesStore.getState().fetchPermissoes().catch(() => {})

      get().syncUsuarioMe?.().catch(() => {})

      useEmpresaStore.getState().fetchEmpresa().catch(() => {})

      return data
    } catch (err) {
      set({ loading: false })
      throw err
    }
  },

  /** Remove sessão local sem redirecionar (ex.: token expirado no restore). */
  clearSession: (opts = {}) => {
    const { redirect = false } = opts
    unsubscribeWebPush().catch(() => {})
    localStorage.removeItem("zap_erp_auth")
    disconnectSocket()
    try {
      useChatStore.getState().limpar()
      useConversaStore.getState().limpar()
      usePermissoesStore.getState().clearPermissoes()
      useEmpresaStore.getState().clear()
    } catch (_) {}
    set({ user: null, token: null })
    if (redirect && typeof window !== "undefined") {
      window.location.href = "/login"
    }
  },

  // ======================
  // LOGOUT
  // ======================
  logout: () => {
    try {
      localStorage.removeItem("zap_erp_last_email")
    } catch (_) {}
    get().clearSession({ redirect: true })
  },

  /** Valida token salvo com GET /usuarios/me — evita loop de 401 após F5. */
  validateSession: async () => {
    const { token } = get()
    if (!token) return false
    try {
      await getUsuarioMe()
      return true
    } catch (err) {
      if (err?.response?.status === 401) {
        get().clearSession({ redirect: false })
        return false
      }
      return true
    }
  },

  /** Atualiza flags do utilizador a partir de GET /usuarios/me (ex.: crm_habilitado). */
  syncUsuarioMe: async () => {
    const { token, user } = get()
    if (!token || !user) return
    try {
      const me = await getUsuarioMe()
      if (!me || typeof me !== "object") return
      const patch = {}
      if (me.crm_habilitado !== undefined) patch.crm_habilitado = me.crm_habilitado
      if (me.separar_mensagens_disparadas !== undefined) patch.separar_mensagens_disparadas = me.separar_mensagens_disparadas
      if (Object.keys(patch).length === 0) return
      get().updateUser(patch)
    } catch (_) {
      /* rede / sessão — ignorar */
    }
  },

  /** Atualiza dados do usuário logado (ex.: após PATCH /usuarios/me) */
  updateUser: (patch) => {
    set((state) => {
      if (!state.user) return state
      const next = { ...state.user, ...patch }
      try {
        const raw = localStorage.getItem("zap_erp_auth")
        if (raw) {
          const parsed = JSON.parse(raw)
          parsed.user = next
          localStorage.setItem("zap_erp_auth", JSON.stringify(parsed))
        }
      } catch {}
      return { user: next }
    })
  },

  // ======================
  // RESTORE (refresh da página)
  // ======================
  restore: () => {
    const raw = localStorage.getItem("zap_erp_auth")
    if (!raw) return

    try {
      const parsed = JSON.parse(raw)
      if (!parsed?.token || !parsed?.user) return

      const userNormalizado = {
        ...parsed.user,
        role: String(parsed.user.role || parsed.user.perfil || "atendente").toLowerCase(),
      }

      set({
        token: parsed.token,
        user: userNormalizado,
      })

      initSocket(parsed.token)

      queueMicrotask(() => {
        get()
          .validateSession()
          .then((ok) => {
            if (!ok) return
            usePermissoesStore.getState().fetchPermissoes().catch(() => {})
            get().syncUsuarioMe?.().catch(() => {})
            useEmpresaStore.getState().fetchEmpresa().catch(() => {})
          })
          .catch(() => {})
      })
    } catch {
      get().clearSession({ redirect: false })
    }
  },
}))
