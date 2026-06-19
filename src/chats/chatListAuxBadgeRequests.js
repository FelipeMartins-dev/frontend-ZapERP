/**
 * Coalescência de GETs auxiliares de badges/chips (GET /chats com query distinta).
 * Escopo por empresa:usuário — não reutiliza entre tenants.
 */
const AUX_BADGE_TTL_MS = 25_000;

/** @type {Map<string, Record<string, { fetchedAt: number, inFlight: Promise<void>|null }>>} */
const scopeState = new Map();

const KINDS = [
  "chatCounts",
  "minhaFila",
  "emAtendimento",
  "aguardandoCliente",
  "pagamentosPendentes",
  "emAtraso",
  "mensagensDisparadas",
  "supervisao",
];

function ensureScope(scopeKey) {
  const key = scopeKey != null ? String(scopeKey) : "";
  if (!key) return null;
  if (!scopeState.has(key)) {
    scopeState.set(
      key,
      Object.fromEntries(KINDS.map((k) => [k, { fetchedAt: 0, inFlight: null }]))
    );
  }
  return scopeState.get(key);
}

/** Troca de usuário/empresa: invalida in-flight/TTL do escopo anterior. */
export function resetAuxBadgeRequestsForScope(scopeKey) {
  if (scopeKey == null) return;
  scopeState.delete(String(scopeKey));
}

/**
 * Executa fetch auxiliar no máximo uma vez por janela TTL (salvo force).
 * Se já houver request igual em andamento, reutiliza a mesma promise.
 * @param {string} scopeKey
 * @param {string} kind
 * @param {() => Promise<void>|void} fn
 * @param {{ force?: boolean }} [opts]
 */
export function runAuxBadgeFetch(scopeKey, kind, fn, opts = {}) {
  const bucket = ensureScope(scopeKey);
  if (!bucket || !kind) return Promise.resolve();
  const slot = bucket[kind];
  if (!slot) return Promise.resolve();

  const force = opts.force === true;
  const now = Date.now();
  if (!force && slot.fetchedAt > 0 && now - slot.fetchedAt < AUX_BADGE_TTL_MS) {
    return Promise.resolve();
  }
  if (slot.inFlight) return slot.inFlight;

  slot.inFlight = Promise.resolve()
    .then(() => fn())
    .then(() => {
      slot.fetchedAt = Date.now();
    })
    .catch(() => {
      /* mantém fetchedAt anterior — caller não zera contadores */
    })
    .finally(() => {
      slot.inFlight = null;
    });

  return slot.inFlight;
}

export const AUX_BADGE_REQUEST_TTL_MS = AUX_BADGE_TTL_MS;
