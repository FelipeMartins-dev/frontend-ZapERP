import autocorrectDictionary from "./autocorrectDictionary";

const WORD_END_TRIGGERS = new Set([" ", "\n", ".", ",", "!", "?", ";", ":"]);
const WORD_PATTERN = /^[A-Za-zÀ-ÖØ-öø-ÿ]+$/;
const UPPERCASE_WORD_PATTERN = /^[A-ZÀ-ÖØ-Þ]+$/;
const MESSAGE_START_LETTER_PATTERN = /^[a-zà-öø-ÿ]/;

/** Maiúscula automática apenas no primeiro caractere da mensagem (campo vazio). */
export function capitalizeMessageStart(prevText, nextText) {
  const prev = String(prevText ?? "");
  const next = String(nextText ?? "");
  if (prev.length > 0 || next.length === 0) return next;
  const first = next.charAt(0);
  if (!MESSAGE_START_LETTER_PATTERN.test(first)) return next;
  return first.toUpperCase() + next.slice(1);
}

function hasUnsafePattern(word) {
  const lower = word.toLowerCase();
  if (!lower) return true;
  if (
    lower.includes("http") ||
    lower.includes("www") ||
    lower.includes(".com") ||
    lower.includes("@") ||
    lower.includes("/") ||
    lower.includes("-") ||
    lower.includes("_") ||
    /\d/.test(lower)
  ) {
    return true;
  }
  return false;
}

function preserveCasing(original, corrected) {
  if (!original || !corrected) return corrected;

  if (UPPERCASE_WORD_PATTERN.test(original)) {
    return corrected.toUpperCase();
  }

  const firstChar = original.charAt(0);
  if (firstChar === firstChar.toUpperCase() && firstChar !== firstChar.toLowerCase()) {
    return corrected.charAt(0).toUpperCase() + corrected.slice(1);
  }

  return corrected;
}

export function getAutocorrectEdit({ text, selectionStart, selectionEnd, triggerChar }) {
  const value = String(text ?? "");
  if (!WORD_END_TRIGGERS.has(triggerChar)) return null;
  if (selectionStart == null || selectionEnd == null) return null;
  if (selectionStart !== selectionEnd) return null;

  const cursor = Number(selectionStart);
  if (!Number.isFinite(cursor) || cursor < 0 || cursor > value.length) return null;

  let start = cursor;
  while (start > 0 && /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(value.charAt(start - 1))) {
    start -= 1;
  }
  if (start === cursor) return null;

  const originalWord = value.slice(start, cursor);
  if (!WORD_PATTERN.test(originalWord)) return null;
  if (hasUnsafePattern(originalWord)) return null;

  const lowerWord = originalWord.toLowerCase();
  const correctedBase = autocorrectDictionary[lowerWord];
  if (!correctedBase || correctedBase === lowerWord) return null;

  const correctedWord = preserveCasing(originalWord, correctedBase);
  if (!correctedWord || correctedWord === originalWord) return null;

  return {
    replaceStart: start,
    replaceEnd: cursor,
    replacement: `${correctedWord}${triggerChar}`,
    correctedWord,
  };
}

