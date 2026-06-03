/** Icon/Chip compartilhados entre ChatList e ChatListBody (evita re-render cruzado). */
export function Icon({ children, size = 16 }) {
  return (
    <span
      className="chat-list-icon"
      style={{ width: size, height: size, minWidth: size, minHeight: size }}
      aria-hidden
    >
      {children}
    </span>
  );
}

export function Chip({ active, onClick, children, variant = "default", className = "", count = null }) {
  const showCount = count !== null && count !== undefined;
  const normalizedCount = showCount ? Number(count) || 0 : null;

  return (
    <button
      type="button"
      className={`chat-list-chip${variant === "primary" ? " chat-list-chip--primary" : ""}${
        active ? " is-active" : ""
      } ${className}`.trim()}
      onClick={onClick}
    >
      {children}
      {showCount ? <span className="chat-list-chip-count">{normalizedCount}</span> : null}
    </button>
  );
}
