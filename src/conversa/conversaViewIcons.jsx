import DSToast from "../components/feedback/Toast";

/* =========================================================
   Icons — finos (stroke ~1.5px), minimalistas
========================================================= */

export function IconClock(props) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}

export function IconMore(props) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" {...props}>
      <circle cx="12" cy="6" r="1.25" fill="currentColor" />
      <circle cx="12" cy="12" r="1.25" fill="currentColor" />
      <circle cx="12" cy="18" r="1.25" fill="currentColor" />
    </svg>
  );
}

export function IconAttach(props) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

export function IconSend(props) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="m22 2-7 20-4-9-9-4L22 2z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}

export function IconEmoji(props) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14.5s1.5 2 3.5 2 3.5-2 3.5-2" />
      <path d="M9 10h.01" />
      <path d="M15 10h.01" />
    </svg>
  );
}

export function IconPlay(props) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" strokeWidth="1.8" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M8 5v14l12-7-12-7Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconPause(props) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" strokeWidth="1.8" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M7 5h3v14H7z" fill="currentColor" stroke="none" />
      <path d="M14 5h3v14h-3z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconClose(props) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

/** Encaminhar (barra de seleção estilo WhatsApp). */
export function IconForward(props) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M13 5l7 7-7 7" />
      <path d="M5 12h14" />
    </svg>
  );
}

export function IconTag(props) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z" />
      <path d="M7 7h.01" />
    </svg>
  );
}

export function IconPrint(props) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M6 9V2h12v7" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <path d="M6 14h12v8H6z" />
    </svg>
  );
}

export function IconClipboard(props) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

export function IconContact(props) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5 19a7 7 0 0 1 14 0" />
      <rect x="3" y="3" width="5" height="5" rx="1" />
    </svg>
  );
}

/* =========================================================
   UI helpers
========================================================= */

export function ChatToast({ toast, onClose }) {
  if (!toast) return null;
  return (
    <DSToast
      title={toast.title || "Aviso"}
      message={toast.message}
      type={toast.type || "info"}
      onClose={onClose}
    />
  );
}

/**
 * Status ✓ / ✓✓ / ✓✓ azul
 * - tenta inferir por campos comuns (status, lida_em, lidaEm, read_at, etc.)
 * - grupos: nunca mostra "read" (azul) — WhatsApp não envia confirmação de leitura em grupos
 */
export const TickSvg = ({ kind }) => (
  <svg className="wa-ticksSvg" viewBox="0 0 18 12" width="18" height="12" aria-hidden="true" focusable="false">
    {kind === "sent" || kind === "delivered" || kind === "read" ? (
      <path d="M2.2 6.2 5.2 9.1 10.4 3.1" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
    ) : null}
    {kind === "delivered" || kind === "read" ? (
      <path d="M7.0 6.2 10.0 9.1 15.2 3.1" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
    ) : null}
    {kind === "pending" ? (
      <> <circle cx="9" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.35" opacity="0.9" />
        <path d="M9 3.8v2.5l1.6 1.0" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ) : null}
    {kind === "err" ? (
      <> <circle cx="9" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.35" opacity="0.9" />
        <path d="M9 3.6v3.2" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
        <circle cx="9" cy="10" r="0.8" fill="currentColor" />
      </>
    ) : null}
  </svg>
);
