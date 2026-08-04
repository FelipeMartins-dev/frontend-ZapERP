/**
 * Rascunhos do composer por conversa (memória + sessionStorage).
 * Não altera status/atendimento — só texto digitado.
 */

const memoryDrafts = new Map();
const STORAGE_PREFIX = "zap:composerDraft:";

function normalizeId(conversaId) {
  if (conversaId == null || conversaId === "") return null;
  return String(conversaId);
}

function storageKey(id) {
  return `${STORAGE_PREFIX}${id}`;
}

export function saveComposerDraft(conversaId, text) {
  const id = normalizeId(conversaId);
  if (!id) return;
  const value = String(text ?? "");
  if (!value.trim()) {
    clearComposerDraft(id);
    return;
  }
  memoryDrafts.set(id, value);
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(storageKey(id), value);
    }
  } catch {
    /* quota / private mode */
  }
}

export function loadComposerDraft(conversaId) {
  const id = normalizeId(conversaId);
  if (!id) return "";
  if (memoryDrafts.has(id)) return String(memoryDrafts.get(id) ?? "");
  try {
    if (typeof sessionStorage !== "undefined") {
      const raw = sessionStorage.getItem(storageKey(id));
      if (raw != null) {
        memoryDrafts.set(id, raw);
        return raw;
      }
    }
  } catch {
    /* ignore */
  }
  return "";
}

export function clearComposerDraft(conversaId) {
  const id = normalizeId(conversaId);
  if (!id) return;
  memoryDrafts.delete(id);
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem(storageKey(id));
    }
  } catch {
    /* ignore */
  }
}
