const RELOAD_MARKER_KEY = "zaperp:vite-preload-reload-at";
const RELOAD_QUERY_PARAM = "__zaperp_chunk_reload";
const RELOAD_GUARD_MS = 60_000;

const DYNAMIC_IMPORT_ERROR_PATTERNS = [
  "failed to fetch dynamically imported module",
  "error loading dynamically imported module",
  "importing a module script failed",
  "chunkloaderror",
  "loading chunk",
];

function getErrorMessage(value) {
  if (typeof value === "string") return value;
  if (typeof value?.message === "string") return value.message;
  return "";
}

export function isDynamicImportFetchError(value) {
  const message = getErrorMessage(value).toLowerCase();
  return DYNAMIC_IMPORT_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

export function recoverFromVitePreloadError(event, runtime = window, now = Date.now()) {
  // O Vite relanca o erro quando o evento nao e cancelado. Cancele inclusive
  // eventos repetidos enquanto a primeira navegacao de recuperacao esta em curso.
  event?.preventDefault?.();

  let lastReloadAt = 0;
  try {
    lastReloadAt = Number(runtime.sessionStorage?.getItem(RELOAD_MARKER_KEY) || 0);
  } catch (_) {
    // sessionStorage pode estar bloqueado; o reload com query ainda recupera a aba.
  }

  const currentUrl = new URL(runtime.location.href);
  const queryReloadAt = Number(currentUrl.searchParams.get(RELOAD_QUERY_PARAM) || 0);
  lastReloadAt = Math.max(lastReloadAt, queryReloadAt);

  if (Number.isFinite(lastReloadAt) && now - lastReloadAt < RELOAD_GUARD_MS) {
    return false;
  }

  try {
    runtime.sessionStorage?.setItem(RELOAD_MARKER_KEY, String(now));
  } catch (_) {
    // A protecao principal continua sendo a troca da URL abaixo.
  }

  const url = currentUrl;
  url.searchParams.set(RELOAD_QUERY_PARAM, String(now));
  runtime.location.replace(url.toString());
  return true;
}

export function installVitePreloadRecovery(runtime = window) {
  runtime.addEventListener("vite:preloadError", (event) => {
    recoverFromVitePreloadError(event, runtime);
  });

  // Fallback para navegadores/fluxos em que a falha do import() chega como
  // rejeicao global sem passar pelo evento especifico do Vite.
  runtime.addEventListener("unhandledrejection", (event) => {
    if (!isDynamicImportFetchError(event?.reason)) return;
    recoverFromVitePreloadError(event, runtime);
  });

  runtime.addEventListener("error", (event) => {
    const error = event?.error || event?.message;
    if (!isDynamicImportFetchError(error)) return;
    recoverFromVitePreloadError(event, runtime);
  });

  const url = new URL(runtime.location.href);
  if (!url.searchParams.has(RELOAD_QUERY_PARAM)) return;
  runtime.setTimeout?.(() => {
    const cleanUrl = new URL(runtime.location.href);
    cleanUrl.searchParams.delete(RELOAD_QUERY_PARAM);
    runtime.history.replaceState(runtime.history.state, "", cleanUrl.toString());
  }, RELOAD_GUARD_MS);
}

export const vitePreloadRecoveryConstants = {
  RELOAD_MARKER_KEY,
  RELOAD_QUERY_PARAM,
  RELOAD_GUARD_MS,
  DYNAMIC_IMPORT_ERROR_PATTERNS,
};
