/** Timeouts HTTP do ZapERP — valores em ms. */
export const HTTP_TIMEOUT_DEFAULT_MS = 55_000;
export const HTTP_TIMEOUT_TEXT_MS = 55_000;
export const HTTP_TIMEOUT_UPLOAD_MIN_MS = 180_000; // 3 min
export const HTTP_TIMEOUT_UPLOAD_MAX_MS = 900_000; // 15 min
export const HTTP_TIMEOUT_LARGE_VIDEO_MAX_MS = 1_800_000; // 30 min (upload + compactação no servidor)
/** Throughput conservador para estimar upload em rede lenta (~50 KB/s). */
const UPLOAD_BYTES_PER_SEC = 50 * 1024;

/**
 * Timeout de upload proporcional ao tamanho do arquivo.
 * Piso 3 min; teto 15 min em uploads comuns e 30 min para vídeo-fonte acima de 32 MB.
 */
export function resolveUploadTimeoutMs(fileOrSize) {
  const size =
    typeof fileOrSize === "number"
      ? fileOrSize
      : Number(fileOrSize?.size ?? fileOrSize?.tamanho ?? fileOrSize?.tamanho_bytes) || 0;
  const estimated = Math.ceil(size / UPLOAD_BYTES_PER_SEC) * 1000 + 60_000;
  const mime = typeof fileOrSize === "object" ? String(fileOrSize?.type || "").toLowerCase() : "";
  const name = typeof fileOrSize === "object" ? String(fileOrSize?.name || "").toLowerCase() : "";
  const isLargeVideo =
    size > 32 * 1024 * 1024 &&
    (mime.startsWith("video/") || /\.(mp4|mov|m4v|webm|avi|mkv|3gp|mpeg|mpg|ogv)$/i.test(name));
  const maxTimeout = isLargeVideo ? HTTP_TIMEOUT_LARGE_VIDEO_MAX_MS : HTTP_TIMEOUT_UPLOAD_MAX_MS;
  return Math.min(maxTimeout, Math.max(HTTP_TIMEOUT_UPLOAD_MIN_MS, estimated));
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
