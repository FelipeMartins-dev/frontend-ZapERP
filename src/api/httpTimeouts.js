/** Timeouts HTTP do ZapERP — valores em ms. */
export const HTTP_TIMEOUT_DEFAULT_MS = 55_000;
export const HTTP_TIMEOUT_TEXT_MS = 55_000;
export const HTTP_TIMEOUT_UPLOAD_MIN_MS = 180_000; // 3 min
export const HTTP_TIMEOUT_UPLOAD_MAX_MS = 900_000; // 15 min
/** Throughput conservador para estimar upload em rede lenta (~50 KB/s). */
const UPLOAD_BYTES_PER_SEC = 50 * 1024;

/**
 * Timeout de upload proporcional ao tamanho do arquivo.
 * Piso 3 min (imagem/doc), teto 15 min (vídeo grande / rede lenta).
 */
export function resolveUploadTimeoutMs(fileOrSize) {
  const size =
    typeof fileOrSize === "number"
      ? fileOrSize
      : Number(fileOrSize?.size ?? fileOrSize?.tamanho ?? fileOrSize?.tamanho_bytes) || 0;
  const estimated = Math.ceil(size / UPLOAD_BYTES_PER_SEC) * 1000 + 60_000;
  return Math.min(HTTP_TIMEOUT_UPLOAD_MAX_MS, Math.max(HTTP_TIMEOUT_UPLOAD_MIN_MS, estimated));
}

function formDataTotalFileBytes(formData) {
  if (typeof FormData === "undefined" || !(formData instanceof FormData)) return 0;
  let total = 0;
  try {
    for (const value of formData.values()) {
      if (value && typeof value === "object" && typeof value.size === "number") {
        total += value.size;
      }
    }
  } catch {
    /* ignore */
  }
  return total;
}

/**
 * Resolve timeout por config Axios quando o caller não definiu um valor explícito.
 */
export function resolveRequestTimeoutMs(config) {
  if (config?.timeout != null && Number(config.timeout) > 0) {
    return Number(config.timeout);
  }
  const url = String(config?.url || "");
  const isUpload =
    url.includes("/arquivo") ||
    (typeof FormData !== "undefined" && config?.data instanceof FormData);
  if (isUpload) {
    const bytes = formDataTotalFileBytes(config.data);
    return resolveUploadTimeoutMs(bytes > 0 ? bytes : HTTP_TIMEOUT_UPLOAD_MIN_MS);
  }
  return HTTP_TIMEOUT_DEFAULT_MS;
}
