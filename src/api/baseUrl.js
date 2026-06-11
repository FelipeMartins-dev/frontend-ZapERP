// Regra de URL base:
// - Se existir `VITE_API_URL`, usamos ela.
// - Em dev no localhost, fallback para backend local (PORT padrão 3000).
// - Caso contrário, fallback de produção.
//
// Observação: no Vite, `import.meta.env.VITE_*` é resolvido em build/dev server.

export const FALLBACK_API_URL =
  "https://zaperpapi.wmsistemas.inf.br"

const DEFAULT_LOCAL_BACKEND_PORT = "3000"

function resolveLocalDevApiUrl() {
  const fromEnv = normalizeBaseUrl(import.meta.env.VITE_API_URL)
  if (fromEnv) return fromEnv
  const port = String(import.meta.env.VITE_BACKEND_PORT || DEFAULT_LOCAL_BACKEND_PORT).trim()
  return `http://localhost:${port}`
}

/** Fallback documentado; em runtime use `getApiBaseUrl()` ou `resolveLocalDevApiUrl()` via dev. */
export const LOCAL_DEV_API_URL = `http://localhost:${DEFAULT_LOCAL_BACKEND_PORT}`

function normalizeBaseUrl(raw) {
  const s = String(raw || "").trim()
  if (!s) return ""

  // evita bugs comuns de configuração (.env com endpoint em vez de base)
  let url = s.replace(/\/+$/, "")
  url = url.replace(/\/usuarios\/login$/i, "")
  return url
}

function isLoopbackApiUrl(url) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?/i.test(String(url || "").trim())
}

function isLocalFrontendHost() {
  if (typeof window === "undefined") return false
  const host = String(window.location.hostname || "").trim().toLowerCase()
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]"
}

export function getApiBaseUrl() {
  const fromEnv = normalizeBaseUrl(import.meta.env.VITE_API_URL)
  let url = fromEnv

  if (!url && import.meta.env.DEV && isLocalFrontendHost()) {
    url = normalizeBaseUrl(resolveLocalDevApiUrl())
  }

  if (!url) {
    url = normalizeBaseUrl(FALLBACK_API_URL)
  }

  // Build com VITE_API_URL=localhost em site público: navegador bloqueia (Private Network Access).
  if (typeof window !== "undefined") {
    const isLocalFrontend = isLocalFrontendHost()
    if (!isLocalFrontend && isLoopbackApiUrl(url)) {
      url = normalizeBaseUrl(FALLBACK_API_URL)
    }
  }

  return url
}
