import api from "./http"

/**
 * Baixa o HTML de impressão da conversa (autenticado) e abre numa nova aba.
 * Não usar window.open(URL da API): o navegador não envia Authorization.
 *
 * @param {number|string} conversaId
 * @returns {Promise<void>}
 */
export async function openConversationPrint(conversaId) {
  const id = Number(conversaId)
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error("invalid_id")
  }

  const { data: blob } = await api.get(`/api/print/conversas/${id}`, {
    responseType: "blob",
    skipGlobal403Toast: true,
    skipGlobalServerErrorToast: true,
  })

  if (!(blob instanceof Blob)) {
    throw new Error("invalid_response")
  }

  if (blob.type && blob.type.includes("json")) {
    const text = await blob.text()
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error(text.slice(0, 280) || "Resposta inválida")
    }
    throw new Error(parsed?.error || parsed?.message || "Resposta inválida")
  }

  const url = URL.createObjectURL(blob)
  const win = window.open(url, "_blank", "noopener,noreferrer")

  if (!win) {
    URL.revokeObjectURL(url)
    const err = new Error("popup_blocked")
    err.code = "POPUP_BLOCKED"
    throw err
  }

  const revokeDelayed = () => {
    try {
      URL.revokeObjectURL(url)
    } catch (_) {}
  }

  const tryPrint = () => {
    try {
      win.focus()
      win.print()
    } catch (_) {}
  }

  win.addEventListener(
    "load",
    () => {
      tryPrint()
    },
    { once: true }
  )

  setTimeout(() => tryPrint(), 500)

  setTimeout(revokeDelayed, 120_000)
}

/**
 * Extrai mensagem legível de erro axios (incl. corpo Blob JSON/texto).
 * @param {unknown} err
 * @returns {Promise<{ status?: number, message: string }>}
 */
export async function getPrintRequestErrorInfo(err) {
  const status = err?.response?.status
  const raw = err?.response?.data

  if (raw instanceof Blob) {
    const text = await raw.text()
    try {
      const j = JSON.parse(text)
      return {
        status,
        message: String(j.error || j.message || text || "").trim() || fallbackMessage(status),
      }
    } catch {
      return {
        status,
        message: String(text || "").trim().slice(0, 400) || fallbackMessage(status),
      }
    }
  }

  const msg =
    err?.response?.data?.error ||
    err?.response?.data?.message ||
    err?.message ||
    ""

  return {
    status,
    message: String(msg).trim() || fallbackMessage(status),
  }
}

function fallbackMessage(status) {
  if (status === 403) return "Sem permissão para imprimir esta conversa."
  if (status === 404) return "Conversa não encontrada ou indisponível."
  if (status === 401) return "Sessão expirada."
  if (status >= 500) return "Erro no servidor. Tente novamente em instantes."
  return "Não foi possível gerar a impressão."
}

/**
 * Título e mensagem para toast conforme HTTP status.
 * @param {number|undefined} status
 * @param {string} message
 */
export function printErrorToastPayload(status, message) {
  const m = String(message || "").trim()

  if (status === 403) {
    return {
      type: "error",
      title: "Sem permissão",
      message: m || "Você não pode imprimir esta conversa.",
    }
  }
  if (status === 404) {
    return {
      type: "error",
      title: "Conversa não encontrada",
      message: m || "Esta conversa não existe ou não está disponível.",
    }
  }
  if (status === 401) {
    return {
      type: "error",
      title: "Sessão expirada",
      message: m || "Faça login novamente.",
    }
  }
  if (status >= 500) {
    return {
      type: "error",
      title: "Erro no servidor",
      message: m || "Tente novamente em instantes.",
    }
  }
  if (status === 429) {
    return {
      type: "warning",
      title: "Muitas tentativas",
      message: m || "Aguarde um momento antes de tentar de novo.",
    }
  }
  return {
    type: "error",
    title: "Não foi possível imprimir",
    message: m || "Tente de novo ou verifique sua conexão.",
  }
}
