const KEY_PREFIX = "zap:replyMeta:";

function key(conversaId) {
  return `${KEY_PREFIX}${String(conversaId)}`;
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * Estrutura:
 * {
 *   "<mensagemId>": { name: string, snippet: string, ts: number, replyToId?: string|number }
 * }
 */
export function loadReplyMetaMap(conversaId) {
  if (!conversaId) return {};
  const raw = localStorage.getItem(key(conversaId));
  const parsed = raw ? safeJsonParse(raw) : null;
  return parsed && typeof parsed === "object" ? parsed : {};
}

export function saveReplyMeta(conversaId, mensagemId, meta) {
  if (!conversaId || !mensagemId || !meta) return;
  const id = String(mensagemId);
  const next = { ...loadReplyMetaMap(conversaId) };
  next[id] = {
    name: String(meta.name || "").slice(0, 80),
    snippet: String(meta.snippet || "").slice(0, 180),
    ts: Number(meta.ts || Date.now()),
    replyToId: meta.replyToId != null ? String(meta.replyToId) : undefined,
  };

  // limita tamanho (evita crescer infinito)
  const entries = Object.entries(next);
  const MAX = 600;
  if (entries.length > MAX) {
    entries
      .sort((a, b) => Number(a[1]?.ts || 0) - Number(b[1]?.ts || 0))
      .slice(0, Math.max(0, entries.length - MAX))
      .forEach(([k]) => {
        delete next[k];
      });
  }

  try {
    localStorage.setItem(key(conversaId), JSON.stringify(next));
  } catch {
    // ignore
  }
}

export function attachReplyMeta(conversaId, mensagens) {
  if (!conversaId || !Array.isArray(mensagens) || mensagens.length === 0) return mensagens;
  const map = loadReplyMetaMap(conversaId);
  if (!map || Object.keys(map).length === 0) return mensagens;

  return mensagens.map((m) => {
    const id = m?.id != null ? String(m.id) : null;
    const meta = id ? map[id] : null;
    if (!meta) return m;
    return { ...m, reply_meta: meta };
  });
}

