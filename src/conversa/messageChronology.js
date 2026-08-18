function normalizeNaiveIsoAsUtc(value) {
  const raw = String(value || "").trim()
  if (!raw) return raw
  const naiveIso = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)
  return naiveIso.test(raw) && !hasTimezone ? `${raw.replace(" ", "T")}Z` : raw
}

export function parseMessageTimestampMillis(value) {
  if (value == null || value === "") return NaN
  if (value instanceof Date) return value.getTime()
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.abs(value) < 1e11 ? value * 1000 : value
  }

  const raw = String(value).trim()
  if (!raw) return NaN
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) {
    const numeric = Number(raw)
    if (!Number.isFinite(numeric)) return NaN
    return Math.abs(numeric) < 1e11 ? numeric * 1000 : numeric
  }
  const parsed = new Date(normalizeNaiveIsoAsUtc(raw)).getTime()
  return Number.isFinite(parsed) ? parsed : NaN
}

export function getMessageTimestampValue(message) {
  const candidates = [
    message?.message_timestamp,
    message?.sent_at,
    message?.received_at,
    message?.criado_em,
    message?.created_at,
    message?.timestamp,
    message?.data_criacao,
    message?.ts,
  ]
  return candidates.find((value) => Number.isFinite(parseMessageTimestampMillis(value))) ?? null
}

export function getMessageTimestampMillis(message) {
  return parseMessageTimestampMillis(getMessageTimestampValue(message))
}

export function compareMessagesChronologically(a, b) {
  const ta = getMessageTimestampMillis(a)
  const tb = getMessageTimestampMillis(b)
  const safeTa = Number.isFinite(ta) ? ta : 0
  const safeTb = Number.isFinite(tb) ? tb : 0
  if (safeTa !== safeTb) return safeTa - safeTb

  const ida = a?.id == null || a?.id === "" ? NaN : Number(a.id)
  const idb = b?.id == null || b?.id === "" ? NaN : Number(b.id)
  if (Number.isFinite(ida) && Number.isFinite(idb) && ida !== idb) return ida - idb
  return 0
}

export function normalizeMessageChronology(message, fallbackMillis = Date.now()) {
  if (!message || typeof message !== "object") return message
  const millis = getMessageTimestampMillis(message)
  const safeMillis = Number.isFinite(millis) ? millis : fallbackMillis
  const canonical = new Date(safeMillis).toISOString()
  return {
    ...message,
    message_timestamp: canonical,
    ...(!message.criado_em ? { criado_em: canonical } : {}),
  }
}
