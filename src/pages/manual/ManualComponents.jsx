/* Componentes reutilizáveis do Manual ZapERP */

export function SectionHeader({ icon, iconClass, title, subtitle }) {
  return (
    <div className="manual-section-header">
      <div className={`manual-section-icon ${iconClass || "manual-section-icon--green"}`}>{icon}</div>
      <h2 className="manual-section-title">
        {title}
        {subtitle && <small>{subtitle}</small>}
      </h2>
    </div>
  );
}

export function Card({ title, children }) {
  return (
    <div className="manual-card">
      {title && <div className="manual-card-title">{title}</div>}
      <div className="manual-card-body">{children}</div>
    </div>
  );
}

export function Tip({ variant, icon = "💡", children }) {
  return (
    <div className={`manual-tip${variant ? ` manual-tip--${variant}` : ""}`}>
      <span className="manual-tip-icon">{icon}</span>
      <span>{children}</span>
    </div>
  );
}

export function Steps({ items }) {
  return (
    <div className="manual-steps">
      {items.map((text, i) => (
        <div key={i} className="manual-step">
          <div className="manual-step-num">{i + 1}</div>
          <div className="manual-step-content" dangerouslySetInnerHTML={{ __html: text }} />
        </div>
      ))}
    </div>
  );
}

export function BtnGrid({ items }) {
  return (
    <div className="manual-btn-grid">
      {items.map((item, i) => (
        <div key={i} className="manual-btn-card">
          <div className="manual-btn-label">{item.label}</div>
          <div className="manual-btn-desc" dangerouslySetInnerHTML={{ __html: item.desc }} />
        </div>
      ))}
    </div>
  );
}

export function StatusGrid({ items }) {
  return (
    <div className="manual-status-grid">
      {items.map((item, i) => (
        <div key={i} className="manual-status-badge">
          <div className={`manual-status-dot manual-status-dot--${item.color}`} />
          <div>
            <div className="manual-status-name">{item.name}</div>
            <div className="manual-status-desc">{item.desc}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function DataTable({ headers, rows }) {
  return (
    <table className="manual-table">
      <thead>
        <tr>
          {headers.map((h, i) => (
            <th key={i}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td key={j} dangerouslySetInnerHTML={{ __html: cell }} />
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Checklist({ title, items }) {
  return (
    <div className="manual-checklist">
      {title && <div className="manual-checklist-title">{title}</div>}
      <ul className="manual-checklist-list">
        {items.map((item, i) => (
          <li key={i} dangerouslySetInnerHTML={{ __html: item }} />
        ))}
      </ul>
    </div>
  );
}

export function Quote({ children }) {
  return <div className="manual-quote">{children}</div>;
}

export function TagList({ tags }) {
  return (
    <div className="manual-tag-list">
      {tags.map((t, i) => (
        <span key={i} className={`manual-tag manual-tag--${(i % 6) + 1}`}>
          {t}
        </span>
      ))}
    </div>
  );
}

export function PriorityList({ items }) {
  return (
    <ol className="manual-priority-list">
      {items.map((item, i) => (
        <li key={i} dangerouslySetInnerHTML={{ __html: item }} />
      ))}
    </ol>
  );
}

export function SubSection({ title, children }) {
  return (
    <div className="manual-subsection">
      {title && <h3 className="manual-subsection-title">{title}</h3>}
      {children}
    </div>
  );
}

export function Ul({ items }) {
  return (
    <ul className="manual-ul">
      {items.map((item, i) => (
        <li key={i} dangerouslySetInnerHTML={{ __html: item }} />
      ))}
    </ul>
  );
}
