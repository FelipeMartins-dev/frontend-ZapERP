/**
 * Classifica falhas de envio outbound no frontend.
 * Timeout/rede sem resposta HTTP ≠ recusa do provedor.
 */

export const OUTBOUND_ERROR_KIND = Object.freeze({
  TIMEOUT: "timeout",
  OFFLINE: "offline",
  HTTP: "http",
  PROVIDER: "provider",
  VALIDATION: "validation",
  CANCEL: "cancel",
  UNKNOWN: "unknown",
});

export function isAxiosTimeoutError(err) {
  return (
    err?.code === "ECONNABORTED" ||
    err?.code === "ETIMEDOUT" ||
    /timeout/i.test(String(err?.message || ""))
  );
}

export function isAxiosOfflineError(err) {
  if (isAxiosTimeoutError(err)) return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return err?.message === "Network Error" || err?.code === "ERR_NETWORK";
}

export function isAxiosCancelError(err) {
  return (
    err?.code === "ERR_CANCELED" ||
    err?.name === "CanceledError" ||
    err?.name === "AbortError" ||
    (typeof err?.message === "string" && /cancel/i.test(err.message))
  );
}

/**
 * @returns {{ kind: string, uncertain: boolean, httpStatus: number|null, message: string }}
 */
export function classifyOutboundAxiosError(err) {
  if (!err) {
    return { kind: OUTBOUND_ERROR_KIND.UNKNOWN, uncertain: true, httpStatus: null, message: "Falha desconhecida" };
  }
  if (isAxiosCancelError(err)) {
    return {
      kind: OUTBOUND_ERROR_KIND.CANCEL,
      uncertain: true,
      httpStatus: null,
      message: "Envio cancelado.",
    };
  }
  if (isAxiosTimeoutError(err)) {
    return {
      kind: OUTBOUND_ERROR_KIND.TIMEOUT,
      uncertain: true,
      httpStatus: null,
      message: "O servidor demorou para responder. Estamos verificando se a mensagem foi enviada.",
    };
  }
  if (isAxiosOfflineError(err)) {
    return {
      kind: OUTBOUND_ERROR_KIND.OFFLINE,
      uncertain: true,
      httpStatus: null,
      message: "Aguardando conexão. A mensagem será enviada automaticamente quando a internet voltar.",
    };
  }

  const httpStatus = Number(err?.response?.status) || null;
  const data = err?.response?.data;
  const apiMsg = data?.error || data?.motivo || err?.message || "Não foi possível enviar.";
  const bodyStatus = String(data?.status || data?.status_mensagem || "").toLowerCase();

  if (httpStatus === 400 || httpStatus === 422) {
    return { kind: OUTBOUND_ERROR_KIND.VALIDATION, uncertain: false, httpStatus, message: String(apiMsg) };
  }
  if (httpStatus === 403) {
    return { kind: OUTBOUND_ERROR_KIND.VALIDATION, uncertain: false, httpStatus, message: String(apiMsg) };
  }
  if (
    bodyStatus === "erro" ||
    bodyStatus === "failed" ||
    bodyStatus === "blocked" ||
    data?.ok === false
  ) {
    return { kind: OUTBOUND_ERROR_KIND.PROVIDER, uncertain: false, httpStatus, message: String(apiMsg) };
  }
  if (httpStatus != null) {
    return { kind: OUTBOUND_ERROR_KIND.HTTP, uncertain: httpStatus >= 500, httpStatus, message: String(apiMsg) };
  }
  return { kind: OUTBOUND_ERROR_KIND.UNKNOWN, uncertain: true, httpStatus: null, message: String(apiMsg) };
}

/** Toast único por tempId/mensagem (evita spam). */
const recentToastKeys = new Map();
const TOAST_DEDUP_MS = 8_000;

export function shouldShowOutboundToast(key) {
  const k = String(key || "").trim();
  if (!k) return true;
  const now = Date.now();
  const prev = recentToastKeys.get(k) || 0;
  if (now - prev < TOAST_DEDUP_MS) return false;
  recentToastKeys.set(k, now);
  if (recentToastKeys.size > 200) {
    for (const [id, ts] of recentToastKeys) {
      if (now - ts > TOAST_DEDUP_MS) recentToastKeys.delete(id);
    }
  }
  return true;
}

export function _resetOutboundToastDedupForTests() {
  recentToastKeys.clear();
}
