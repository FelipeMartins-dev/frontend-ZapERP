/**
 * Aceite válido do backend para contato/localização/link/ligação.
 * HTTP 200 sozinho não basta: ok deve ser true e status não pode ser erro.
 */
export function assertSpecialtyOutboundAccepted(data, fallbackMsg = "Envio não confirmado pelo WhatsApp.") {
  const status = String(data?.status ?? data?.status_mensagem ?? "").toLowerCase().trim();
  const failedStatus = ["erro", "error", "failed", "falhou", "blocked"].includes(status);
  if (data?.ok === false || failedStatus) {
    const err = new Error(data?.error || data?.motivo || fallbackMsg);
    err.response = { status: failedStatus && status === "blocked" ? 422 : 502, data: data || {} };
    err.isSpecialtyOutboundFailure = true;
    throw err;
  }
  return data;
}

/** Decisão de toast: sucesso somente com aceite válido. */
export function specialtyOutboundToastDecision(dataOrError) {
  try {
    if (dataOrError instanceof Error) throw dataOrError;
    const data = assertSpecialtyOutboundAccepted(dataOrError);
    if (data?.ok === false) return { type: "error" };
    return { type: "success" };
  } catch {
    return { type: "error" };
  }
}
