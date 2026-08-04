import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buscarMensagensNaConversa } from "../conversaService";
import { IconClose, IconSearch } from "../conversaViewIcons";
import { formatHoraCurta, safeString } from "../utils/conversaViewHelpers";

const SEARCH_DEBOUNCE_MS = 320;
const SEARCH_PAGE_LIMIT = 30;

function useDebouncedValue(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function formatSearchDate(value) {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightedText(text, query) {
  const raw = safeString(text);
  const q = safeString(query);
  if (!raw || !q) return raw || "(mensagem sem texto)";
  const re = new RegExp(`(${escapeRegExp(q)})`, "ig");
  return raw.split(re).map((part, idx) =>
    part.toLowerCase() === q.toLowerCase() ? (
      <mark key={`${part}-${idx}`} className="wa-msgSearch-match">
        {part}
      </mark>
    ) : (
      <span key={`${part}-${idx}`}>{part}</span>
    )
  );
}

function resultSenderLabel(msg) {
  if (msg?.direcao === "out") return safeString(msg?.usuario_nome) || "Atendente";
  return safeString(msg?.remetente_nome) || safeString(msg?.remetente_telefone) || "Contato";
}

function ConversaMessageSearchPanel({ open, conversaId, onClose, onSelectResult }) {
  const inputRef = useRef(null);
  const abortRef = useRef(null);
  const requestSeqRef = useRef(0);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [nextCursor, setNextCursor] = useState(null);
  const [nextCursorId, setNextCursorId] = useState(null);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus?.(), 80);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort?.();
      setQuery("");
      setResults([]);
      setError("");
      setNextCursor(null);
      setNextCursorId(null);
      setHasMore(false);
    }
  }, [open]);

  const runSearch = useCallback(
    async ({ append = false, cursor = null, cursorId = null } = {}) => {
      const q = safeString(debouncedQuery);
      abortRef.current?.abort?.();
      const abortController = new AbortController();
      abortRef.current = abortController;
      const seq = ++requestSeqRef.current;

      if (!open || !conversaId || !q) {
        setResults([]);
        setError("");
        setNextCursor(null);
        setNextCursorId(null);
        setHasMore(false);
        setLoading(false);
        setLoadingMore(false);
        return;
      }

      if (append) setLoadingMore(true);
      else setLoading(true);
      setError("");

      try {
        const data = await buscarMensagensNaConversa(conversaId, {
          q,
          cursor,
          cursorId,
          limit: SEARCH_PAGE_LIMIT,
          signal: abortController.signal,
        });
        if (seq !== requestSeqRef.current) return;
        const page = Array.isArray(data?.resultados) ? data.resultados : [];
        setResults((prev) => (append ? [...prev, ...page] : page));
        setNextCursor(data?.next_cursor || null);
        setNextCursorId(data?.next_cursor_id ?? null);
        setHasMore(Boolean(data?.has_more && data?.next_cursor));
      } catch (err) {
        if (err?.name === "CanceledError" || err?.name === "AbortError") return;
        setError(err?.response?.data?.error || err?.message || "Nao foi possivel buscar mensagens.");
      } finally {
        if (seq === requestSeqRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [conversaId, debouncedQuery, open]
  );

  useEffect(() => {
    runSearch({ append: false });
    return () => abortRef.current?.abort?.();
  }, [runSearch]);

  const hasQuery = safeString(debouncedQuery).length > 0;
  const stateLabel = useMemo(() => {
    if (!hasQuery) return "Digite uma palavra para pesquisar nesta conversa.";
    if (loading) return "Pesquisando...";
    if (error) return error;
    if (results.length === 0) return "Nenhuma mensagem encontrada";
    return "";
  }, [error, hasQuery, loading, results.length]);

  if (!open) return null;

  return (
    <aside className="wa-msgSearchPanel" role="dialog" aria-label="Pesquisar mensagens">
      <div className="wa-msgSearch-head">
        <button type="button" className="wa-msgSearch-close" onClick={onClose} aria-label="Fechar busca">
          <IconClose />
        </button>
        <span className="wa-msgSearch-title">Pesquisar mensagens</span>
      </div>

      <div className="wa-msgSearch-box">
        <IconSearch />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Pesquisar na conversa"
          autoComplete="off"
          aria-label="Pesquisar mensagens da conversa"
        />
        {query ? (
          <button type="button" className="wa-msgSearch-clear" onClick={() => setQuery("")} aria-label="Limpar busca">
            <IconClose />
          </button>
        ) : null}
      </div>

      <div className="wa-msgSearch-results" aria-live="polite">
        {stateLabel ? (
          <div className={`wa-msgSearch-state ${error ? "isError" : ""}`}>{stateLabel}</div>
        ) : (
          results.map((msg) => (
            <button
              key={msg.id}
              type="button"
              className="wa-msgSearch-result"
              onClick={() => onSelectResult?.(msg)}
            >
              <span className="wa-msgSearch-resultDate">{formatSearchDate(msg.criado_em)}</span>
              <span className="wa-msgSearch-resultText">{highlightedText(msg.texto, debouncedQuery)}</span>
              <span className="wa-msgSearch-resultMeta">
                {resultSenderLabel(msg)}
                {formatHoraCurta(msg.criado_em) ? ` · ${formatHoraCurta(msg.criado_em)}` : ""}
              </span>
            </button>
          ))
        )}
        {hasMore && !error ? (
          <button
            type="button"
            className="wa-msgSearch-more"
            onClick={() => runSearch({ append: true, cursor: nextCursor, cursorId: nextCursorId })}
            disabled={loadingMore}
          >
            {loadingMore ? "Carregando..." : "Carregar mais resultados"}
          </button>
        ) : null}
      </div>
    </aside>
  );
}

export default memo(ConversaMessageSearchPanel);
