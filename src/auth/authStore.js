import { create } from "zustand"
import { login as loginService } from "./authService"
import { getUsuarioMe } from "../api/configService"
import { initSocket, disconnectSocket } from "../socket/socket"
import { useChatStore } from "../chats/chatsStore"
import { useConversaStore } from "../conversa/conversaStore"
import { usePermissoesStore } from "./permissoesStore"
import { unsubscribeWebPush, syncPushSubscriptionSilently, resetPushRegistrationDebounce } from "../push/webPushClient"

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

      return data
    } catch (err) {
      set({ loading: false })
      throw err
    }
  },

  // ======================
  // LOGOUT
  // ======================
  logout: () => {
    unsubscribeWebPush().catch(() => {})
    localStorage.removeItem("zap_erp_auth")

    // encerra a conexão para evitar “sessão fantasma” após logout
    disconnectSocket()
    try {
      useChatStore.getState().limpar()
      useConversaStore.getState().limpar()
      usePermissoesStore.getState().clearPermissoes()
    } catch (_) {}

    set({ user: null, token: null })
    window.location.href = "/login"
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

      // Carrega permissões do usuário (menus e proteção de rotas)
      usePermissoesStore.getState().fetchPermissoes().catch(() => {})
    } catch {
      localStorage.removeItem("zap_erp_auth")
    }
  },
}))
