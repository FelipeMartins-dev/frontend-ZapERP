const RELOAD_MARKER_KEY = "zaperp:vite-preload-reload-at";
const RELOAD_QUERY_PARAM = "__zaperp_chunk_reload";
const RELOAD_GUARD_MS = 60_000;

export function recoverFromVitePreloadError(event, runtime = window, now = Date.now()) {
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

  event?.preventDefault?.();
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
};
