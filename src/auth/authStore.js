import { create } from "zustand"
import { login as loginService } from "./authService"
import { getUsuarioMe } from "../api/configService"
import { initSocket, disconnectSocket } from "../socket/socket"
import { useChatStore } from "../chats/chatsStore"
import { clearChatListSidebarSessionCache } from "../chats/chatListSidebarCache"
import { useConversaStore } from "../conversa/conversaStore"
import { usePermissoesStore } from "./permissoesStore"
import { unsubscribeWebPush, resetPushRegistrationDebounce } from "../push/webPushClient"
import { schedulePushSubscriptionSync } from "../push/deferredPushSync"
import { useEmpresaStore } from "./empresaStore"

function buildUsuarioMePatch(me) {
  if (!me || typeof me !== "object") return null
  const patch = {}
  if (me.crm_habilitado !== undefined) patch.crm_habilitado = me.crm_habilitado
  if (me.separar_mensagens_disparadas !== undefined) {
    patch.separar_mensagens_disparadas = me.separar_mensagens_disparadas
  }
  return Object.keys(patch).length > 0 ? patch : null
}

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
      schedulePushSubscriptionSync()

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
      clearChatListSidebarSessionCache()
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
      const me = await getUsuarioMe()
      return me || true
    } catch (err) {
      if (err?.response?.status === 401) {
        get().clearSession({ redirect: false })
        return false
      }
      return true
    }
  },

  applyUsuarioMeFlags: (me) => {
    const patch = buildUsuarioMePatch(me)
    if (!patch) return
    get().updateUser(patch)
  },

  /** Atualiza flags do utilizador a partir de GET /usuarios/me (ex.: crm_habilitado). */
  syncUsuarioMe: async () => {
    const { token, user } = get()
    if (!token || !user) return
    try {
      const me = await getUsuarioMe()
      get().applyUsuarioMeFlags(me)
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
          .then((session) => {
            if (!session) return
            usePermissoesStore.getState().fetchPermissoes().catch(() => {})
            if (typeof session === "object") {
              get().applyUsuarioMeFlags(session)
            } else {
              get().syncUsuarioMe?.().catch(() => {})
            }
            useEmpresaStore.getState().fetchEmpresa().catch(() => {})
          })
          .catch(() => {})
      })
    } catch {
      get().clearSession({ redirect: false })
    }
  },
}))
