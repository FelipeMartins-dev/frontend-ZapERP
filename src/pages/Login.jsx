import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuthStore } from "../auth/authStore"

export default function Login() {
  const navigate = useNavigate()
  const login = useAuthStore((s) => s.login)
  const loading = useAuthStore((s) => s.loading)

  const [email, setEmail] = useState("")
  const [senha, setSenha] = useState("")
  const [erro, setErro] = useState("")

  async function handleSubmit(e) {
    e.preventDefault()
    setErro("")

    try {
      await login(email.trim(), senha)
      navigate("/", { replace: true })
    } catch (err) {
      const status = err?.response?.status
      const msg =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        err?.message ||
        "Falha no login. Verifique e-mail e senha."
      if (status === 429) {
        setErro("Muitas tentativas. Aguarde 1 minuto e tente novamente.")
      } else if (err?.message === "Network Error" || err?.code === "ECONNABORTED") {
        setErro("Sem conexão. Verifique sua internet e tente novamente.")
      } else {
        setErro(msg)
      }
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-bg" aria-hidden="true">
        <span className="login-bg-mesh" />
        <span className="login-bg-orb login-bg-orb-1" />
        <span className="login-bg-orb login-bg-orb-2" />
        <span className="login-bg-orb login-bg-orb-3" />
        <span className="login-bg-glow" />
        <span className="login-bg-grid" />
        <span className="login-bg-scanline" />
        <span className="login-bg-noise" />
      </div>
      <form
        onSubmit={handleSubmit}
        className="login-form"
        noValidate
        aria-label="Formulário de login"
      >
        <h2 className="login-title">ZapERP · Login</h2>

        <label htmlFor="login-email">E-mail</label>
        <input
          id="login-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="seu@email.com"
          disabled={loading}
          aria-invalid={!!erro}
          aria-describedby={erro ? "login-error" : undefined}
        />

        <label htmlFor="login-senha">Senha</label>
        <input
          id="login-senha"
          name="password"
          type="password"
          autoComplete="current-password"
          enterKeyHint="done"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          placeholder="••••••••"
          disabled={loading}
          aria-invalid={!!erro}
        />

        <button type="submit" disabled={loading} aria-busy={loading}>
          {loading ? "Entrando…" : "Entrar"}
        </button>

        {erro && (
          <p id="login-error" className="login-error" role="alert">
            {erro}
          </p>
        )}
      </form>
    </div>
  )
}
