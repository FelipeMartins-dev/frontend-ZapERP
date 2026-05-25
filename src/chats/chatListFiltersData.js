/**
 * Cache em memória + sessionStorage (TTL curto) para tags/atendentes/departamentos.
 * Não armazena mensagens nem conteúdo de conversas.
 */
const FILTERS_AUX_TTL_MS = 10 * 60 * 1000;
const STORAGE_PREFIX = "zap_erp_chat_filters_aux_v1";

let tagsCache = null;
let atendentesCache = null;
let departamentosCache = null;
let loadPromise = null;
let atendentesPromise = null;
let currentScopeKey = null;

export function buildChatListFiltersScopeKey(user) {
  const uid = user?.id ?? user?.user_id ?? "anon";
  const cid =
    user?.company_id ?? user?.empresa_id ?? user?.companyId ?? user?.empresaId ?? "0";
  return `${cid}:${uid}`;
}

function storageKey(scopeKey) {
  return `${STORAGE_PREFIX}:${scopeKey}`;
}

export function getChatListFiltersDataCache() {
  return {
    tags: tagsCache,
    atendentes: atendentesCache,
    departamentos: departamentosCache,
  };
}

export function applyChatListFiltersDataCache({ tags, atendentes, departamentos }) {
  if (tags !== undefined) tagsCache = tags;
  if (atendentes !== undefined) atendentesCache = atendentes;
  if (departamentos !== undefined) departamentosCache = departamentos;
}

export function resetChatListFiltersMemoryCache() {
  tagsCache = null;
  atendentesCache = null;
  departamentosCache = null;
  loadPromise = null;
  atendentesPromise = null;
}

/** Troca de usuário/empresa: limpa memória (session usa chave por escopo). */
export function setChatListFiltersScope(scopeKey) {
  const next = scopeKey != null ? String(scopeKey) : null;
  if (currentScopeKey === next) return;
  currentScopeKey = next;
  resetChatListFiltersMemoryCache();
}

/** Hidrata memória após F5 — retorna true se havia cache válido na sessão. */
export function hydrateChatListFiltersFromSession(scopeKey) {
  if (typeof sessionStorage === "undefined" || !scopeKey) return false;
  try {
    const raw = sessionStorage.getItem(storageKey(scopeKey));
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!parsed || Date.now() - (parsed.t || 0) > FILTERS_AUX_TTL_MS) {
      sessionStorage.removeItem(storageKey(scopeKey));
      return false;
    }
    applyChatListFiltersDataCache({
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      atendentes: Array.isArray(parsed.atendentes) ? parsed.atendentes : [],
      departamentos: Array.isArray(parsed.departamentos) ? parsed.departamentos : [],
    });
    return (
      tagsCache != null && atendentesCache != null && departamentosCache != null
    );
  } catch {
    return false;
  }
}

function persistChatListFiltersToSession(scopeKey) {
  if (typeof sessionStorage === "undefined" || !scopeKey) return;
  if (tagsCache == null || atendentesCache == null || departamentosCache == null) return;
  try {
    sessionStorage.setItem(
      storageKey(scopeKey),
      JSON.stringify({
        t: Date.now(),
        tags: tagsCache,
        atendentes: atendentesCache,
        departamentos: departamentosCache,
      })
    );
  } catch {
    /* quota / privado */
  }
}

function isCacheComplete() {
  return tagsCache != null && atendentesCache != null && departamentosCache != null;
}

/** GET /usuarios — dedupe + cache sessão (atendentes no payload completo). */
export function loadChatListAtendentesOnce(api, scopeKey) {
  if (atendentesCache != null) {
    return Promise.resolve(atendentesCache);
  }
  if (atendentesPromise) return atendentesPromise;

  atendentesPromise = api
    .get("/usuarios")
    .then((r) => {
      atendentesCache = Array.isArray(r.data) ? r.data : [];
      if (isCacheComplete()) persistChatListFiltersToSession(scopeKey);
      return atendentesCache;
    })
    .catch(() => {
      atendentesCache = [];
      return atendentesCache;
    })
    .finally(() => {
      atendentesPromise = null;
    });

  return atendentesPromise;
}

/** Uma rodada de GETs; chamadas concorrentes compartilham a mesma promise. */
export function loadChatListFiltersDataOnce({ listarTags, api, scopeKey }) {
  if (isCacheComplete()) {
    return Promise.resolve(getChatListFiltersDataCache());
  }
  if (loadPromise) return loadPromise;

  const scopeAtStart = scopeKey;

  loadPromise = Promise.all([
    listarTags().catch(() => []),
    api.get("/usuarios").then((r) => r.data || []).catch(() => []),
    api.get("/dashboard/departamentos").then((r) => r.data || []).catch(() => []),
  ])
    .then(([tags, atendentes, departamentos]) => {
      if (scopeAtStart && currentScopeKey && scopeAtStart !== currentScopeKey) {
        return getChatListFiltersDataCache();
      }
      tagsCache = Array.isArray(tags) ? tags : [];
      atendentesCache = Array.isArray(atendentes) ? atendentes : [];
      departamentosCache = Array.isArray(departamentos) ? departamentos : [];
      persistChatListFiltersToSession(scopeAtStart);
      return getChatListFiltersDataCache();
    })
    .finally(() => {
      loadPromise = null;
    });

  return loadPromise;
}
