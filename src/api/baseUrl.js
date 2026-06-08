// Regra de URL base:
// - Se existir `VITE_API_URL`, usamos ela.
// - Se não existir, usamos um fallback fixo.
//
// Observação: no Vite, `import.meta.env.VITE_*` é resolvido em build/dev server.

export const FALLBACK_API_URL =
  "https://zaperpapi.wmsistemas.inf.br"

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

export function getApiBaseUrl() {
  const fromEnv = normalizeBaseUrl(import.meta.env.VITE_API_URL)
  let url = fromEnv || normalizeBaseUrl(FALLBACK_API_URL)

  // Build com VITE_API_URL=localhost em site público: navegador bloqueia (Private Network Access).
  if (typeof window !== "undefined") {
    const host = String(window.location.hostname || "").trim().toLowerCase()
    const isLocalFrontend = host === "localhost" || host === "127.0.0.1" || host === "[::1]"
    if (!isLocalFrontend && isLoopbackApiUrl(url)) {
      url = normalizeBaseUrl(FALLBACK_API_URL)
    }
  }

  return url
}

