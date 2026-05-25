import { useAuthStore } from "../auth/authStore";

const FORWARD_COLAB_TTL_MS = 8 * 60 * 1000;
const STORAGE_PREFIX = "zap_erp_forward_colab_v1";

let colaboradoresEncaminharCache = null;
let inflight = null;
let cacheScopeKey = null;

function buildForwardScopeKey() {
  const u = useAuthStore.getState().user;
  const uid = u?.id ?? u?.user_id ?? "anon";
  const cid =
    u?.company_id ?? u?.empresa_id ?? u?.companyId ?? u?.empresaId ?? "0";
  return `${cid}:${uid}`;
}

function storageKey(scope) {
  return `${STORAGE_PREFIX}:${scope}`;
}

function hydrateFromSession(scope) {
  if (typeof sessionStorage === "undefined" || !scope) return false;
  try {
    const raw = sessionStorage.getItem(storageKey(scope));
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!parsed || Date.now() - (parsed.t || 0) > FORWARD_COLAB_TTL_MS) {
      sessionStorage.removeItem(storageKey(scope));
      return false;
    }
    colaboradoresEncaminharCache = Array.isArray(parsed.list) ? parsed.list : [];
    cacheScopeKey = scope;
    return true;
  } catch {
    return false;
  }
}

function persistToSession(scope, list) {
  if (typeof sessionStorage === "undefined" || !scope) return;
  try {
    sessionStorage.setItem(
      storageKey(scope),
      JSON.stringify({ t: Date.now(), list: Array.isArray(list) ? list : [] })
    );
  } catch {
    /* ignore */
  }
}

export function getForwardColaboradoresCache() {
  const scope = buildForwardScopeKey();
  if (cacheScopeKey !== scope) {
    cacheScopeKey = scope;
    colaboradoresEncaminharCache = null;
    inflight = null;
    hydrateFromSession(scope);
  }
  return colaboradoresEncaminharCache;
}

export function setForwardColaboradoresCache(list) {
  colaboradoresEncaminharCache = Array.isArray(list) ? list : [];
  const scope = buildForwardScopeKey();
  cacheScopeKey = scope;
  persistToSession(scope, colaboradoresEncaminharCache);
}

export function loadForwardColaboradoresOnce(fetchFn) {
  const scope = buildForwardScopeKey();
  if (cacheScopeKey !== scope) {
    cacheScopeKey = scope;
    colaboradoresEncaminharCache = null;
    inflight = null;
    hydrateFromSession(scope);
  }
  if (colaboradoresEncaminharCache != null) {
    return Promise.resolve(colaboradoresEncaminharCache);
  }
  if (inflight) return inflight;
  inflight = fetchFn()
    .then((list) => {
      setForwardColaboradoresCache(list);
      return colaboradoresEncaminharCache;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
