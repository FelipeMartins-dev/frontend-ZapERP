import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../api/http";
import IaMarkdownContent from "../ia/IaMarkdownContent.jsx";
import IaAnaliticaRespostaCard from "../ia/IaAnaliticaRespostaCard.jsx";
import "./DashboardIA.css";

const SUGGESTIONS = [
  "Resumo das métricas de hoje",
  "O que os atendentes andam fazendo nas últimas 24 horas?",
  "Quais clientes estão mais ativos neste mês?",
  "Quais conversas estão há mais tempo sem resposta?",
  "Crie uma planilha (em CSV) para acompanhar a produtividade dos atendentes",
  "Escreva uma mensagem profissional para responder um cliente insatisfeito",
  "Me dê ideias de mensagens automáticas para novos clientes",
  "Explique como posso melhorar o atendimento da minha equipe",
];

function createMessage(role, content, meta) {
  const base = {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content: String(content || "").trim(),
    createdAt: new Date().toISOString(),
  };
  if (meta && typeof meta === "object") {
    return { ...base, meta };
  }
  return base;
}

export default function DashboardIA() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState(() => [
    createMessage(
      "assistant",
      "Olá! Eu sou o **Assistente Inteligente do ZapERP**.\n\nPergunte qualquer coisa sobre o seu WhatsApp corporativo, atendimentos, clientes, métricas ou rotinas internas. Eu respondo de forma clara, direta e em português.\n\nVocê pode pedir, por exemplo:\n\n- \"Resumo das métricas de hoje\"\n- \"Quais clientes estão mais ativos neste mês?\"\n- \"Crie uma planilha (em CSV) para acompanhar a produtividade dos atendentes\"\n- \"Escreva uma mensagem profissional para responder um cliente insatisfeito\""
    ),
  ]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [periodDaysValue, setPeriodDaysValue] = useState("");

  const bottomRef = useRef(null);
  const askInFlightRef = useRef(false);

  const canSend = useMemo(() => input.trim().length > 0 && !loading, [input, loading]);

  useEffect(() => {
    if (!bottomRef.current) return;
    try {
      bottomRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    } catch {
      // ignore
    }
  }, [messages, loading]);

  const ask = useCallback(
    async (questionText) => {
      if (askInFlightRef.current) return;
      const text = questionText?.trim() || input.trim();
      if (!text) return;

      askInFlightRef.current = true;
      setErrorMsg(null);
      setInput("");

      const userMsg = createMessage("user", text);
      setMessages((prev) => [...prev, userMsg]);
      setLoading(true);

      try {
        const body = { question: text };
        if (periodDaysValue) {
          const n = Number(periodDaysValue);
          if (Number.isFinite(n) && n > 0) body.period_days = Math.round(n);
        }
        const resp = await api.post("/api/ai/ask", body);
        const payload = resp?.data ?? {};
        const answer =
          payload.answer ||
          payload.response ||
          payload.message ||
          (typeof payload === "string" ? payload : "Não recebi uma resposta da IA. Tente novamente em instantes.");

        const assistantMsg = createMessage("assistant", answer, {
          intent: payload.intent ?? null,
          apiData: payload.data,
        });
        setMessages((prev) => [...prev, assistantMsg]);
      } catch (e) {
        console.error("Erro ao consultar IA:", e);
        const detail =
          e?.response?.data?.error ||
          e?.response?.data?.message ||
          e?.message ||
          "Não foi possível falar com a IA agora.";
        setErrorMsg(detail);
        const assistantMsg = createMessage(
          "assistant",
          "Tive um problema ao consultar a IA no momento. Tente novamente em alguns instantes."
        );
        setMessages((prev) => [...prev, assistantMsg]);
      } finally {
        askInFlightRef.current = false;
        setLoading(false);
      }
    },
    [input, periodDaysValue]
  );

  const handleCandidatoPick = useCallback((suggestion) => {
    const s = String(suggestion || "").trim();
    if (!s) return;
    setInput((prev) => {
      const p = prev.trim();
      return p ? `${p} ${s}` : s;
    });
  }, []);

  const handleSubmit = useCallback(
    (e) => {
      e?.preventDefault?.();
      if (!canSend) return;
      void ask();
    },
    [ask, canSend]
  );

  const handleSuggestion = useCallback(
    (text) => {
      if (loading) return;
      void ask(text);
    },
    [ask, loading]
  );

  return (
    <div className="ia-chat-wrap">
      <header className="ia-chat-header">
        <div>
          <h1 className="ia-chat-title">Assistente Inteligente do ZapERP</h1>
          <p className="ia-chat-subtitle">
            Pergunte qualquer coisa sobre o seu WhatsApp corporativo, atendimentos, clientes, métricas ou rotinas internas. Eu respondo de forma clara, direta e em português.
          </p>
        </div>
      </header>

      {errorMsg ? (
        <div className="ia-chat-alert" role="alert">
          <div className="ia-chat-alert-text">{errorMsg}</div>
          <button
            type="button"
            className="ia-chat-alert-close"
            onClick={() => setErrorMsg(null)}
            aria-label="Fechar aviso"
          >
            ×
          </button>
        </div>
      ) : null}

      <main className="ia-chat-main">
        <section className="ia-chat-card" aria-label="Conversa com a IA">
          <div className="ia-chat-suggestions" aria-label="Sugestões rápidas">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                className="ia-chat-suggestion"
                onClick={() => handleSuggestion(s)}
                disabled={loading}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="ia-chat-messages">
            {messages.map((m) => (
              <article
                key={m.id}
                className={`ia-chat-message ia-chat-message--${m.role}${m.role === "assistant" && m.meta?.apiData != null ? " ia-chat-message--assistantAnalitica" : ""}${m.role === "assistant" && m.meta?.apiData == null ? " ia-chat-message--assistantRich" : ""}`}
                aria-label={m.role === "assistant" ? "Mensagem da assistente" : "Sua mensagem"}
              >
                <div className="ia-chat-message-avatar">
                  {m.role === "assistant" ? (
                    <span className="ia-chat-avatar ia-chat-avatar--assistant">IA</span>
                  ) : (
                    <span className="ia-chat-avatar ia-chat-avatar--user">Você</span>
                  )}
                </div>
                <div className="ia-chat-message-body">
                  <div className="ia-chat-message-bubble">
                    <div className="ia-chat-message-content">
                      {m.role === "assistant" && m.meta?.apiData != null ? (
                        <IaAnaliticaRespostaCard
                          markdown={m.content}
                          data={m.meta.apiData}
                          intentFromRoot={m.meta.intent}
                          onCandidatoPick={handleCandidatoPick}
                          pickDisabled={loading}
                        />
                      ) : m.role === "assistant" ? (
                        <IaMarkdownContent markdown={m.content} />
                      ) : (
                        m.content.split("\n").map((line, idx) => (
                          <p key={idx}>{line}</p>
                        ))
                      )}
                    </div>
                    <div className="ia-chat-message-actions" aria-hidden="true">
                      <button
                        type="button"
                        className="ia-chat-message-actionBtn ia-chat-message-actionBtn--menu"
                        title="Mais opções"
                      >
                        ⋯
                      </button>
                      <button
                        type="button"
                        className="ia-chat-message-actionBtn ia-chat-message-actionBtn--emoji"
                        title="Reagir à mensagem"
                      >
                        🙂
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            ))}

            {loading ? (
              <div className="ia-chat-loading">
                <span className="ia-chat-loading-dot" />
                <span className="ia-chat-loading-dot" />
                <span className="ia-chat-loading-dot" />
              </div>
            ) : null}

            <div ref={bottomRef} />
          </div>
        </section>
      </main>

      <footer className="ia-chat-footer" aria-label="Enviar pergunta para a IA">
        <form className="ia-chat-form" onSubmit={handleSubmit}>
          <label className="ia-chat-period">
            <span className="ia-sr-only">Janela de dados (opcional)</span>
            <select
              className="ia-chat-period-select"
              value={periodDaysValue}
              onChange={(e) => setPeriodDaysValue(e.target.value)}
              disabled={loading}
              aria-label="Período em dias para a consulta (opcional)"
            >
              <option value="">Período: automático</option>
              <option value="7">Últimos 7 dias</option>
              <option value="14">Últimos 14 dias</option>
              <option value="30">Últimos 30 dias</option>
              <option value="90">Últimos 90 dias</option>
            </select>
          </label>
          <input
            className="ia-chat-input"
            type="text"
            placeholder="Digite sua pergunta sobre clientes, atendimentos, métricas ou peça qualquer ajuda (planilhas, mensagens, ideias...)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
          />
          <button
            type="submit"
            className="ia-chat-sendBtn"
            disabled={!canSend}
            aria-label="Enviar pergunta para a IA"
          >
            {loading ? "Enviando..." : "Enviar"}
          </button>
        </form>
      </footer>
    </div>
  );
}
