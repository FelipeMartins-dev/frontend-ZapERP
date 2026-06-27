/**
 * Skeleton — placeholder de carregamento
 * Design System ZapERP — usa tokens
 */
export default function Skeleton({ variant = "line", width, className = "", style = {}, ...props }) {
  const combinedStyle = { ...(width ? { width: typeof width === "number" ? `${width}px` : width } : {}), ...style };
  return (
    <div
      className={`ds-skeleton ds-skeleton--${variant} ${className}`.trim()}
      style={combinedStyle}
      aria-hidden
      {...props}
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="ds-skeleton-card">
      <Skeleton variant="line" width="60%" />
      <Skeleton variant="line" width="40%" style={{ marginTop: 8 }} />
    </div>
  );
}

export function SkeletonGrid({ count = 6 }) {
  return (
    <div className="ds-skeleton-grid">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

/** Lista de conversas — avatar + 2 linhas por linha (chatList) */
export function SkeletonChatList({ count = 8, className = "" }) {
  return (
    <div className={`chat-list-pad ${className}`.trim()}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="chat-list-skel-row">
          <Skeleton variant="circle" />
          <div className="chat-list-skel-body">
            <Skeleton variant="line" width="50%" />
            <Skeleton variant="line" width="80%" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Alias: linha de skeleton (ex.: ConversaView wa-empty-skel) */
export function SkeletonLine({ width = "100%" }) {
  return <Skeleton variant="line" width={width} />;
}

/** Skeleton de lista de mensagens — bolhas alternadas entrada/saída */
export function SkeletonMessages() {
  const rows = [
    { dir: "in",  width: "52%" },
    { dir: "out", width: "38%" },
    { dir: "in",  width: "68%" },
    { dir: "in",  width: "44%" },
    { dir: "out", width: "58%" },
    { dir: "out", width: "32%" },
    { dir: "in",  width: "50%" },
  ];
  return (
    <div className="ds-skeleton-messages" aria-hidden>
      {rows.map((r, i) => (
        <div key={i} className={`ds-skeleton-msg-row ds-skeleton-msg-row--${r.dir}`}>
          <Skeleton variant="bubble" width={r.width} />
        </div>
      ))}
    </div>
  );
}
