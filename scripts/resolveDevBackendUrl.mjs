/**
 * URL do backend local — mesma regra do `getApiBaseUrl()` e do proxy do Vite.
 * Prioridade: VITE_API_URL → http://localhost:VITE_BACKEND_PORT → :3000
 */
export function resolveDevBackendUrl(env = {}) {
  const fromApi = String(env.VITE_API_URL || "").trim().replace(/\/+$/, "")
  if (fromApi) return fromApi

  const port = String(env.VITE_BACKEND_PORT || env.PORT || "3000").trim()
  return `http://localhost:${port}`
}
