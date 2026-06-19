/**
 * EmptyState — estado vazio com ilustração, título, descrição e CTA
 * Design System ZapERP
 */
export default function EmptyState({
  icon,
  title,
  description,
  action,
  actionLabel,
  brandLogoUrl,
  brandName,
  className = "",
}) {
  const normalizedBrandLogoUrl =
    typeof brandLogoUrl === "string" ? brandLogoUrl.trim() : "";
  const hasBrandLogo = Boolean(normalizedBrandLogoUrl);

  const defaultIcon = (
    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );

  return (
    <div
      className={`ds-empty-state ${hasBrandLogo ? "ds-empty-state--branded" : ""} ${className}`.trim()}
      role="status"
    >
      {hasBrandLogo && (
        <div className="ds-empty-state__brand" aria-hidden>
          <img
            src={normalizedBrandLogoUrl}
            alt=""
            title={brandName || "Logo da empresa"}
            draggable={false}
            onError={(event) => {
              event.currentTarget.closest(".ds-empty-state__brand")?.classList.add("is-hidden");
            }}
          />
        </div>
      )}
      <div className="ds-empty-state__icon" aria-hidden>
        {icon || defaultIcon}
      </div>
      <h3 className="ds-empty-state__title">{title}</h3>
      {description && (
        <p className="ds-empty-state__desc">{description}</p>
      )}
      {action && actionLabel && (
        <div className="ds-empty-state__action">
          {typeof action === "function"
            ? <button type="button" className="ds-btn ds-btn--primary" onClick={action}>{actionLabel}</button>
            : action}
        </div>
      )}
    </div>
  );
}
