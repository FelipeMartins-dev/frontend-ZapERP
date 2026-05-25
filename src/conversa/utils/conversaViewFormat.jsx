import { safeString } from "./conversaViewHelpers";

export const URL_REGEX = /(https?:\/\/[^\s]+)/gi;

/** Deixa URLs em texto azuis e clicáveis (http/https). */
export function renderTextWithLinks(text) {
  const s = safeString(text);
  if (!s) return null;
  const parts = [];
  let lastIndex = 0;
  let match;
  while ((match = URL_REGEX.exec(s)) !== null) {
    const url = match[0];
    const idx = match.index;
    if (idx > lastIndex) {
      parts.push(s.slice(lastIndex, idx));
    }
    parts.push(
      <a
        key={`link-${idx}-${url}`}
        href={url}
        target="_blank"
        rel="noreferrer"
        className="wa-link"
      >
        {url}
      </a>
    );
    lastIndex = idx + url.length;
  }
  if (lastIndex < s.length) {
    parts.push(s.slice(lastIndex));
  }
  return parts;
}
