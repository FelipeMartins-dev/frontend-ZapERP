import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { SkeletonLine } from "../components/feedback/Skeleton";
import "../components/feedback/skeleton.css";
import { isMessageMine } from "./messageUtils";
import InternalChatHeader from "./InternalChatHeader";
import InternalChatMessageBubble from "./InternalChatMessageBubble";
import InternalChatComposer from "./InternalChatComposer";

function assignRefs(el, a, b) {
  a.current = el;
  if (b) b.current = el;
}

const InternalChatThread = forwardRef(function InternalChatThread(
  {
    conversation,
    onBackToList,
    myUserId,
    messagesListRef,
    peerOnline = false,
    peerLastSeen = null,
    formatLastSeen = () => "",
    messages,
    initLoading,
    olderLoading,
    error,
    hasMoreOlder,
    onLoadOlder,
    onRetryLoad,
    onComposerSend,
    sending,
    sendError,
    uploadProgress = null,
    publicMediaBaseUrl = null,
    onConversarComContato,
    conversarComContatoBusy = false,
  },
  ref
) {
  const listRef = useRef(null);
  const stickBottomRef = useRef(true);

  const scrollToBottom = useCallback((behavior = "smooth") => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      scrollToBottomSmooth: () => {
        stickBottomRef.current = true;
        requestAnimationFrame(() => scrollToBottom("auto"));
      },
    }),
    [scrollToBottom]
  );

  useEffect(() => {
    if (initLoading || olderLoading) return;
    if (stickBottomRef.current) {
      requestAnimationFrame(() => scrollToBottom("auto"));
    }
  }, [messages, initLoading, olderLoading, scrollToBottom]);

  useEffect(() => {
    stickBottomRef.current = true;
    if (!initLoading && messages.length) {
      requestAnimationFrame(() => scrollToBottom("auto"));
    }
  }, [conversation?.id, initLoading, messages.length, scrollToBottom]);

  function onScrollList() {
    const el = listRef.current;
    if (!el) return;
    const threshold = 80;
    stickBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }

  if (!conversation) return null;

  return (
    <div className="ic-thread">
      <InternalChatHeader
        conversation={conversation}
        peerOnline={peerOnline}
        peerLastSeen={peerLastSeen}
        formatLastSeen={formatLastSeen}
        onBack={onBackToList}
      />

      <div className="ic-thread-body">
        {error && !initLoading ? (
          <div className="ic-thread-banner ic-thread-banner--error" role="alert">
            <span>{error}</span>
            <button type="button" className="ic-thread-banner-btn" onClick={onRetryLoad}>
              Tentar novamente
            </button>
          </div>
        ) : null}

        <div
          className="ic-thread-messages-wrap"
          ref={(el) => assignRefs(el, listRef, messagesListRef)}
          onScroll={onScrollList}
        >
          {hasMoreOlder ? (
            <div className="ic-thread-load-more">
              <button type="button" className="ic-thread-load-more-btn" disabled={olderLoading} onClick={onLoadOlder}>
                {olderLoading ? "Carregando…" : "Carregar mensagens anteriores"}
              </button>
            </div>
          ) : null}

          {initLoading ? (
            <div className="ic-thread-skel" aria-busy="true">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className={`ic-thread-skel-row ${i % 2 === 0 ? "ic-thread-skel-row--out" : ""}`}>
                  <SkeletonLine width={i % 3 === 0 ? "72%" : "48%"} />
                </div>
              ))}
            </div>
          ) : messages.length === 0 ? (
            <div className="ic-thread-empty">
              <div className="ic-thread-empty-icon" aria-hidden>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p className="ic-thread-empty-title">Nenhuma mensagem ainda</p>
              <p className="ic-thread-empty-text">Envie a primeira mensagem abaixo. Ela é exclusiva desta conversa interna.</p>
            </div>
          ) : (
            <div className="ic-thread-live" role="log" aria-live="polite" aria-relevant="additions text">
              <ul className="ic-thread-msg-list" aria-label="Mensagens">
                {messages.map((m, idx) => {
                  const mine = isMessageMine(m, myUserId, conversation?.otherUserId);
                  const prev = messages[idx - 1];
                  const prevMine = prev ? isMessageMine(prev, myUserId, conversation?.otherUserId) : null;
                  const cluster = prevMine === mine;
                  return (
                    <InternalChatMessageBubble
                      key={m.id}
                      message={m}
                      myUserId={myUserId}
                      otherUserId={conversation?.otherUserId}
                      cluster={cluster}
                      publicMediaBaseUrl={publicMediaBaseUrl}
                      onConversarComContato={onConversarComContato}
                      conversarComContatoBusy={conversarComContatoBusy}
                    />
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </div>

      <footer className="ic-thread-footer">
        <InternalChatComposer
          onSend={onComposerSend}
          disabled={sending}
          sendError={sendError}
          uploadProgress={uploadProgress}
        />
      </footer>
    </div>
  );
});

export default InternalChatThread;
