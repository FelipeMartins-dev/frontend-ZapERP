/** Merge/dedupe de mensagens — módulo puro (sem React/socket) para store + testes. */
function cleanupOptimisticBlobFields(merged) {
  if (!merged || typeof merged !== "object") return merged

  const tipo = String(merged.tipo || "").toLowerCase().trim()
  if (tipo !== "video" && tipo !== "vídeo") return merged

  const persistedUrl = [
    merged.url,
    merged.url_absoluta,
    merged.media_url,
    merged.mediaUrl,
    merged.file_url,
    merged.fileUrl,
  ].find((value) => {
    const url = String(value || "").trim()
    return url && !url.startsWith("blob:")
  })

  // `_optimisticBlobUrl` representa somente o preview local durante o POST. Depois que
  // API/socket entregam uma URL persistida, mantê-lo faz VideoBubblePreview exibir
  // "Enviando vídeo..." para sempre e ainda prioriza o blob sobre /uploads no player.
  if (!persistedUrl || !merged._optimisticBlobUrl) return merged
  const next = { ...merged }
  delete next._optimisticBlobUrl
  return next
}

/** Logs técnicos pesados só em desenvolvimento. */
function isDebugRuntime() {
  return Boolean(import.meta?.env?.DEV)
}
const RUNTIME_INSERT_SEQ_BASE = 10_000_000
let stableInsertSeqCounter = RUNTIME_INSERT_SEQ_BASE
function allocStableInsertSeq() {
  return stableInsertSeqCounter++
}

function mergeStableSeq(existingMsg, incomingMsg, fallbackOrd) {
  const ex = existingMsg?._stableInsertSeq
  const inc = incomingMsg?._stableInsertSeq
  const highPreserve = (v) => v != null && Number.isFinite(Number(v)) && Number(v) >= RUNTIME_INSERT_SEQ_BASE
  if (highPreserve(ex)) return Number(ex)
  if (highPreserve(inc)) return Number(inc)

  const nums = []
  if (ex != null && Number.isFinite(Number(ex))) nums.push(Number(ex))
  if (inc != null && Number.isFinite(Number(inc))) nums.push(Number(inc))
  if (fallbackOrd != null && Number.isFinite(Number(fallbackOrd))) nums.push(Number(fallbackOrd))
  if (nums.length === 0) return allocStableInsertSeq()
  return Math.min(...nums)
}

function toMillis(value) {
  if (!value) return NaN
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : NaN
}

/** ISO/string → ms; número ou dígitos puros: < 1e11 = segundos Unix, senão ms. */
function resolveTimestampToMillis(value) {
  if (value == null || value === "") return NaN
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e11 ? value * 1000 : value
  }
  const raw = String(value).trim()
  if (/^\d+$/.test(raw)) {
    const n = Number(raw)
    if (Number.isFinite(n)) return n < 1e11 ? n * 1000 : n
  }
  return toMillis(value)
}

/** Reconciliação por texto só para bolhas de chat — evita fundir "(áudio)"/mídia na mensagem de texto errada. */
function isTipoTextoParaReconciliarPorConteudo(msg) {
  const t = String(msg?.tipo ?? "").toLowerCase().trim()
  return t === "" || t === "texto" || t === "text" || t === "chat"
}

function stripWhatsappBoldNamePrefix(texto, msg) {
  const raw = String(texto || "").trim()
  if (!raw || !raw.includes("\n")) return raw
  const lines = raw.split("\n")
  const first = String(lines[0] || "").trim()
  const rest = lines.slice(1).join("\n").trim()
  if (!first || !rest) return raw
  const plainFirst = first.replace(/^\*+|\*+$/g, "").trim()
  if (!plainFirst || plainFirst.length > 80) return raw

  const expectedNames = [
    msg?.remetente_nome,
    msg?.usuario_nome,
    msg?.autor_nome,
    msg?.atendente_nome,
    msg?.nome_atendente,
    msg?.senderName,
  ]
    .map((v) => String(v || "").trim().toLowerCase())
    .filter(Boolean)

  if (expectedNames.includes(plainFirst.toLowerCase())) return rest

  // Eco fromMe pode chegar sem metadado do atendente, mas com a primeira linha em negrito.
  if (/^\*[^*\n]{1,80}\*$/.test(first)) return rest
  return raw
}

function normalizeOutboundTextForCompare(msg) {
  return stripWhatsappBoldNamePrefix(msg?.texto ?? msg?.conteudo ?? "", msg)
}

function normalizeTextForDuplicateCompare(msg) {
  return String(msg?.texto ?? msg?.conteudo ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim()
}

function isTextMessageForDuplicateCompare(msg) {
  if (!msg) return false
  if (mediaFamilyFromMsg(msg)) return false
  return isTipoTextoParaReconciliarPorConteudo(msg)
}

function hasHumanAuthorHint(msg) {
  const fields = [
    msg?.usuario_id,
    msg?.user_id,
    msg?.atendente_id,
    msg?.operador_id,
    msg?.colaborador_id,
    msg?.sent_by_user_id,
  ]
  return fields.some((v) => v != null && String(v).trim() !== "")
}

function hasAutomationHint(msg) {
  const flags = msg?.flags && typeof msg.flags === "object" ? msg.flags : null
  if (flags?.provavel_automatica === true || flags?.automatica === true) return true
  const raw = [
    msg?.origem,
    msg?.source,
    msg?.fonte,
    msg?.tipo_origem,
    msg?.enviado_por,
    msg?.sender_type,
    msg?.autor_tipo,
    msg?.created_by_type,
  ]
    .map((v) => String(v || "").toLowerCase())
    .join(" ")
  return /\b(chatbot|bot|automacao|automatic|automatica|sistema|system)\b/.test(raw)
}

function isLikelyChatbotTemplateText(text) {
  const raw = String(text || "")
  const compact = raw.trim()
  if (compact.length >= 80) return true
  if (compact.includes("\n") && compact.length >= 40) return true
  return /(^|\n)\s*\d+\s*[-.)]/.test(compact)
}

function isLikelyDuplicateAutomatedTextEcho(prev, incoming) {
  if (!prev || !incoming) return false
  if (!sameExplicitConversation(prev, incoming)) return false
  if (!isOutgoingLike(prev) || !isOutgoingLike(incoming)) return false
  if (!isTextMessageForDuplicateCompare(prev) || !isTextMessageForDuplicateCompare(incoming)) return false
  if (matchesClientTempCorrelation(prev, incoming)) return true
  if (prev.tempId || incoming.tempId) return false

  const textPrev = normalizeTextForDuplicateCompare(prev)
  const textIncoming = normalizeTextForDuplicateCompare(incoming)
  if (!textPrev || textPrev !== textIncoming) return false
  if (!isLikelyChatbotTemplateText(textPrev)) return false

  const tsPrev = toMillis(prev?.criado_em)
  const tsIncoming = toMillis(incoming?.criado_em)
  if (!Number.isFinite(tsPrev) || !Number.isFinite(tsIncoming)) return false
  const diffMs = Math.abs(tsPrev - tsIncoming)
  if (diffMs > 15_000) return false

  if (hasAutomationHint(prev) || hasAutomationHint(incoming)) return true
  if (!hasHumanAuthorHint(prev) && !hasHumanAuthorHint(incoming) && diffMs <= 5_000) return true
  return false
}

/** Contato/vCard: CRM grava nome; webhook ecoa vCard completo — ids diferentes, mesma bolha lógica. */
function isVCardTextLocal(text) {
  return Boolean(text && typeof text === "string" && text.includes("BEGIN:VCARD"))
}

function parseVCardTelefoneLocal(text) {
  if (!text || typeof text !== "string") return null
  const re = /^[^\S\r\n]*(?:item\d+\.|ITEM\d+\.)?TEL[^:]*:(.+)$/gim
  let best = null
  let bestLen = 0
  let m
  while ((m = re.exec(text)) !== null) {
    let v = String(m[1] || "").trim()
    v = v.replace(/^tel:/i, "").replace(/^waid\//i, "").trim()
    const digits = v.replace(/\D/g, "")
    if (digits.length >= 8 && digits.length >= bestLen) {
      best = digits
      bestLen = digits.length
    }
  }
  return best
}

function parseVCardDisplayNameLocal(text) {
  if (!text || typeof text !== "string") return null
  const fnMatch = text.match(/^FN:(.+)$/im)
  if (fnMatch) {
    const fn = fnMatch[1].trim().replace(/\\,/g, ",").replace(/\\n/g, " ").replace(/\\/g, "")
    if (fn && !fn.includes("BEGIN:VCARD")) return fn
  }
  return null
}

function resolveContactMetaLocal(msg) {
  if (!msg) return null
  const text = String(msg.texto ?? msg.conteudo ?? msg.body ?? "")
  const tipo = String(msg.tipo || "").toLowerCase()
  const rawMeta = msg.contact_meta && typeof msg.contact_meta === "object" ? msg.contact_meta : null
  const isVCardBody = isVCardTextLocal(text)
  const nomeVc = isVCardBody ? parseVCardDisplayNameLocal(text) : null
  const telVc = isVCardBody ? parseVCardTelefoneLocal(text) : null

  if (tipo === "contact" || tipo === "vcard" || tipo === "contato" || tipo === "contact_message" || isVCardBody || rawMeta) {
    const nomeMeta = rawMeta?.nome != null ? String(rawMeta.nome).trim() : ""
    const nome = nomeMeta || nomeVc || (!isVCardBody ? String(text).trim() : "") || "Contato"
    const telefone =
      (rawMeta?.telefone != null ? String(rawMeta.telefone).replace(/\D/g, "") : "") ||
      (rawMeta?.phone != null ? String(rawMeta.phone).replace(/\D/g, "") : "") ||
      telVc ||
      null
    return { nome, telefone: telefone || null }
  }
  return null
}

function isContactMessage(msg) {
  if (!msg) return false
  const tipo = String(msg?.tipo || "").toLowerCase().trim()
  if (
    tipo === "contact" ||
    tipo === "vcard" ||
    tipo === "contato" ||
    tipo === "contact_message"
  ) {
    return true
  }
  const text = String(msg?.texto ?? msg?.conteudo ?? msg?.body ?? "")
  if (isVCardTextLocal(text)) return true
  if (msg.contact_meta && typeof msg.contact_meta === "object") return true
  return false
}

function messageHasVCardBody(msg) {
  return isVCardTextLocal(String(msg?.texto ?? msg?.conteudo ?? msg?.body ?? ""))
}

function normalizeContactNameKey(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function contactFingerprintParts(msg) {
  const meta = resolveContactMetaLocal(msg)
  const phoneRaw = meta?.telefone != null ? String(meta.telefone).replace(/\D/g, "") : ""
  const phone = phoneRaw.length >= 8 ? phoneRaw : ""
  let name = normalizeContactNameKey(meta?.nome || "")
  if (!name || name === "contato") {
    const text = String(msg?.texto ?? msg?.conteudo ?? "").trim()
    if (text && !isVCardTextLocal(text)) name = normalizeContactNameKey(text)
  }
  if (name === "contato") name = ""
  return { phone, name }
}

function contactPhonesMatch(a, b) {
  if (!a || !b) return false
  if (a === b) return true
  const strip55 = (p) => (p.startsWith("55") && p.length >= 12 ? p.slice(2) : p)
  const sa = strip55(a)
  const sb = strip55(b)
  if (sa === sb) return true
  if (sa.length >= 8 && sb.length >= 8 && sa.slice(-8) === sb.slice(-8)) return true
  return false
}

function contactFingerprintsCompatible(a, b) {
  const pa = contactFingerprintParts(a)
  const pb = contactFingerprintParts(b)
  if (pa.phone && pb.phone) return contactPhonesMatch(pa.phone, pb.phone)
  if (pa.name && pb.name && pa.name.length >= 2 && pa.name === pb.name) return true
  return false
}

function isLikelyDuplicateContactEcho(prev, incoming) {
  if (!prev || !incoming) return false
  if (!sameExplicitConversation(prev, incoming)) return false
  if (!isContactMessage(prev) || !isContactMessage(incoming)) return false
  if (isOutgoingLike(prev) !== isOutgoingLike(incoming)) return false
  if (matchesClientTempCorrelation(prev, incoming)) return true
  if (hasConflictingClientTempCorrelation(prev, incoming)) return false

  const tsP = toMillis(prev?.criado_em)
  const tsI = toMillis(incoming?.criado_em)
  if (!Number.isFinite(tsP) || !Number.isFinite(tsI)) return false
  const diffMs = Math.abs(tsP - tsI)
  if (diffMs > 90_000) return false
  if (!contactFingerprintsCompatible(prev, incoming)) return false

  const vcardP = messageHasVCardBody(prev)
  const vcardI = messageHasVCardBody(incoming)
  // Padrão CRM: uma linha só com nome + eco webhook com vCard completo.
  if (vcardP !== vcardI) return true

  const waP =
    prev.whatsapp_id != null && String(prev.whatsapp_id).trim() !== ""
      ? String(prev.whatsapp_id).trim()
      : ""
  const waI =
    incoming.whatsapp_id != null && String(incoming.whatsapp_id).trim() !== ""
      ? String(incoming.whatsapp_id).trim()
      : ""
  if (!!waP !== !!waI) return true

  const partsP = contactFingerprintParts(prev)
  const partsI = contactFingerprintParts(incoming)
  const strongPhone = !!(partsP.phone && partsI.phone && contactPhonesMatch(partsP.phone, partsI.phone))

  // Dois whatsapp_id distintos: só colapsa com telefone forte em janela curta (eco duplicado).
  if (waP && waI && waP !== waI) {
    if (strongPhone && diffMs <= 45_000) return true
    if (vcardP && vcardI) return false
  }

  const pid = prev.id != null && String(prev.id).trim() !== "" ? String(prev.id).trim() : ""
  const iid =
    incoming.id != null && String(incoming.id).trim() !== "" ? String(incoming.id).trim() : ""
  if (pid && iid && pid !== iid && vcardP && vcardI) {
    return strongPhone && diffMs <= 45_000
  }

  return true
}

function contactEchoDedupeScore(m) {
  let score = 0
  if (messageHasVCardBody(m)) score += 10
  if (m?.whatsapp_id != null && String(m.whatsapp_id).trim() !== "") score += 6
  if (m?.id != null && String(m.id).trim() !== "") score += 3
  const meta = resolveContactMetaLocal(m)
  if (meta?.telefone) score += 4
  if (meta?.nome && normalizeContactNameKey(meta.nome) !== "contato") score += 1
  const order = { pending: 0, sent: 1, delivered: 2, read: 3, played: 4 }
  score += order[String(m?.status_mensagem || m?.status || "").toLowerCase()] ?? 0
  const seq = Number(m?._stableInsertSeq)
  if (Number.isFinite(seq)) score -= seq / 1e15
  return score
}

function pruneRedundantContactEchoes(list) {
  if (!Array.isArray(list) || list.length < 2) return list
  const remove = new Set()
  for (let i = 0; i < list.length; i++) {
    if (remove.has(i)) continue
    for (let j = i + 1; j < list.length; j++) {
      if (remove.has(j)) continue
      const a = list[i]
      const b = list[j]
      if (!isLikelyDuplicateContactEcho(a, b)) continue
      const scoreA = contactEchoDedupeScore(a)
      const scoreB = contactEchoDedupeScore(b)
      if (scoreA > scoreB) remove.add(j)
      else if (scoreB > scoreA) remove.add(i)
      else remove.add(j)
    }
  }
  if (!remove.size) return list
  return list.filter((_, idx) => !remove.has(idx))
}

function isOutgoingLike(msg) {
  const dir = String(msg?.direcao || "").toLowerCase().trim()
  if (dir === "out") return true
  if (dir === "in") return false
  if (dir === "sent" || dir === "sending" || dir === "outbound" || dir === "enviado" || dir === "enviada") return true
  if (dir === "received" || dir === "inbound" || dir === "recebido" || dir === "recebida") return false
  const fromMe = msg?.fromMe ?? msg?.from_me ?? msg?.isFromMe ?? msg?.is_from_me
  if (fromMe === true || fromMe === 1 || String(fromMe).toLowerCase() === "true") return true
  if (fromMe === false || fromMe === 0 || String(fromMe).toLowerCase() === "false") return false
  return false
}

/** Chave estável quando id/whatsapp_id/tempId ausentes — evita sumir mensagens no merge/refresh. */
function stableSyntheticMessageKey(m, conversaId) {
  const textoSnippet = String(m?.texto ?? m?.conteudo ?? "").slice(0, 160)
  const tipo = String(m?.tipo ?? "")
  const rem = String(m?.remetente_nome ?? m?.remetente_telefone ?? m?.pushname ?? "")
  const ts = String(m?.criado_em ?? "")
  const dir = isOutgoingLike(m) ? "o" : "i"
  const fileHint = String(m?.nome_arquivo ?? m?.filename ?? "").slice(0, 96)
  const urlTail = String(m?.url ?? m?.url_absoluta ?? "")
    .split("/")
    .pop()
    ?.slice(0, 96) ?? ""
  const dur =
    m?.audio_duracao_sec ??
    m?.audioDuracaoSec ??
    m?.duracao_segundos ??
    ""
  return `syn:${conversaId}:${dir}:${ts}:${tipo}:${rem}:${fileHint}:${urlTail}:${dur}:${textoSnippet}`
}

/** Chave única para Map dedupe (lista + merge API). */
function mapDedupeKey(m, conversaId) {
  const conv = String(conversaId ?? "")
  const waRaw = m?.whatsapp_id ?? m?.wamid ?? m?.wa_message_id ?? null
  if (waRaw != null && String(waRaw).trim() !== "") return `wa-${conv}-${String(waRaw)}`
  if (m?.id != null && String(m.id).trim() !== "") return `id-${conv}-${String(m.id)}`
  if (m?.tempId != null && String(m.tempId).trim() !== "") return `temp-${conv}-${String(m.tempId)}`
  const syn = stableSyntheticMessageKey(m, conversaId)
  const seq = Number(m?._stableInsertSeq)
  // Sem id/wa/temp, só o fingerprint sintético pode colidir (ex.: várias saídas no mesmo segundo).
  if (Number.isFinite(seq)) return `syn-${conv}-seq${seq}-${syn}`
  return syn
}

/** Duas linhas com o mesmo `mapDedupeKey` devem fundir só se forem a mesma mensagem lógica (UPSERT). */
function canMergeDedupeEntries(prev, incoming) {
  if (!prev || !incoming) return false
  if (!sameExplicitConversation(prev, incoming)) return false
  if (prev.tempId && incoming.tempId && String(prev.tempId) === String(incoming.tempId)) return true
  if (matchesClientTempCorrelation(prev, incoming)) return true
  return areLikelySameMessageBubble(prev, incoming)
}

/** id/whatsapp_id iguais: inbound sempre funde; outbound exige conteúdo/temp compatível. */
function persistedIdentityMarksSameBubble(prev, incoming) {
  if (!prev || !incoming) return false
  if (!sameExplicitConversation(prev, incoming)) return false
  if (matchesClientTempCorrelation(prev, incoming)) return true

  const pid = prev.id != null && String(prev.id).trim() !== "" ? String(prev.id) : null
  const iid = incoming.id != null && String(incoming.id).trim() !== "" ? String(incoming.id) : null
  const pwa =
    prev.whatsapp_id != null && String(prev.whatsapp_id).trim() !== ""
      ? String(prev.whatsapp_id)
      : null
  const iwa =
    incoming.whatsapp_id != null && String(incoming.whatsapp_id).trim() !== ""
      ? String(incoming.whatsapp_id)
      : null
  /* tempIds distintos não separam bolhas que já compartilham id/whatsapp_id persistido:
     seria a mesma linha do banco renderizada duas vezes. Nesse caso decide o conteúdo abaixo. */
  const sharesPersistedIdentity = !!((pid && iid && pid === iid) || (pwa && iwa && pwa === iwa))
  if (!sharesPersistedIdentity && hasConflictingClientTempCorrelation(prev, incoming)) return false
  if (prev.tempId && incoming.tempId && String(prev.tempId) === String(incoming.tempId)) return true

  const inboundPair = !isOutgoingLike(prev) && !isOutgoingLike(incoming)
  if (inboundPair && pid && iid && pid === iid) return true
  if (inboundPair && pwa && iwa && pwa === iwa) return true

  const textoP = (prev.texto || prev.conteudo || "").toString().trim()
  const textoI = (incoming.texto || incoming.conteudo || "").toString().trim()
  if (
    textoP &&
    textoI &&
    isTipoTextoParaReconciliarPorConteudo(prev) &&
    isTipoTextoParaReconciliarPorConteudo(incoming)
  ) {
    return (
      normalizeOutboundTextForCompare(prev).toLowerCase() ===
      normalizeOutboundTextForCompare(incoming).toLowerCase()
    )
  }

  const famP = mediaFamilyFromMsg(prev)
  const famI = mediaFamilyFromMsg(incoming)
  if (famP && famI && famP === famI) {
    return sameMediaStrongHint(prev, incoming)
  }

  if (inboundPair && isIncomingClientMediaReconcilePair(prev, incoming)) return true

  return false
}

function shouldMergeExistingMessages(existing, msg) {
  if (!existing || !msg) return false
  if (!sameExplicitConversation(existing, msg)) return false
  if (matchesClientTempCorrelation(existing, msg)) return true
  const samePersistedId =
    msg.id != null &&
    String(msg.id).trim() !== "" &&
    existing.id != null &&
    String(existing.id) === String(msg.id)
  const waId = msg.whatsapp_id || null
  const samePersistedWaId =
    !!waId && existing.whatsapp_id != null && String(existing.whatsapp_id) === String(waId)
  if (!samePersistedId && !samePersistedWaId && hasConflictingClientTempCorrelation(existing, msg)) {
    return false
  }
  if (existing.tempId && msg.tempId && String(existing.tempId) === String(msg.tempId)) return true
  if (isLikelyDuplicateAutomatedTextEcho(existing, msg)) return true
  const clientTempId = resolveClientTempId(msg)
  if (clientTempId && existing.tempId && String(existing.tempId) === clientTempId) return true
  if (samePersistedId) {
    if (existing.tempId && msg.tempId && String(existing.tempId) !== String(msg.tempId)) {
      return persistedIdentityMarksSameBubble(existing, msg)
    }
    return true
  }
  if (samePersistedWaId) {
    return persistedIdentityMarksSameBubble(existing, msg)
  }
  if (!isOutgoingLike(existing) && !isOutgoingLike(msg)) {
    return isIncomingClientMediaReconcilePair(existing, msg)
  }
  return false
}

/** Evita propagar `id` persistido que já pertence a outra bolha distinta na lista. */
function stripPersistedIdIfConflictsWithList(list, keepIdx, msg) {
  if (!msg?.id || !Array.isArray(list)) return msg
  const conflict = list.some(
    (m, i) =>
      i !== keepIdx &&
      m?.id != null &&
      String(m.id) === String(msg.id) &&
      !shouldMergeExistingMessages(m, msg)
  )
  if (!conflict) return msg
  const next = { ...msg }
  delete next.id
  return next
}

/** Mesma bolha lógica com chaves diferentes (ex.: otimista temp-* vs socket id-*). */
function areLikelySameMessageBubble(prev, incoming) {
  if (!prev || !incoming) return false
  if (!sameExplicitConversation(prev, incoming)) return false
  if (prev.tempId && incoming.tempId && String(prev.tempId) === String(incoming.tempId)) return true
  if (hasConflictingClientTempCorrelation(prev, incoming)) return false
  if (isLikelyDuplicateAutomatedTextEcho(prev, incoming)) return true
  const pwa = prev.whatsapp_id != null && String(prev.whatsapp_id).trim() !== "" ? String(prev.whatsapp_id) : null
  const iwa = incoming.whatsapp_id != null && String(incoming.whatsapp_id).trim() !== "" ? String(incoming.whatsapp_id) : null
  if (pwa && iwa && pwa === iwa) return persistedIdentityMarksSameBubble(prev, incoming)
  const pid = prev.id != null && String(prev.id).trim() !== "" ? String(prev.id) : null
  const iid = incoming.id != null && String(incoming.id).trim() !== "" ? String(incoming.id) : null
  if (pid && iid && pid === iid) return persistedIdentityMarksSameBubble(prev, incoming)
  if (isContactMessage(prev) && isContactMessage(incoming)) {
    return isLikelyDuplicateContactEcho(prev, incoming)
  }
  if (!isOutgoingLike(prev) && !isOutgoingLike(incoming)) {
    return isIncomingClientMediaReconcilePair(prev, incoming)
  }
  if (!isOutgoingLike(prev) || !isOutgoingLike(incoming)) return false
  const recentMs = 90_000
  const now = Date.now()
  const tsP = toMillis(prev?.criado_em)
  const tsI = toMillis(incoming?.criado_em)
  if (!Number.isFinite(tsP) || !Number.isFinite(tsI)) return false
  if (Math.abs(tsP - tsI) > recentMs) return false
  const textoP = (prev.texto || prev.conteudo || "").toString().trim()
  const textoI = (incoming.texto || incoming.conteudo || "").toString().trim()
  const textoCompareP = textoP ? normalizeOutboundTextForCompare(prev) : ""
  const textoCompareI = textoI ? normalizeOutboundTextForCompare(incoming) : ""
  if (
    textoCompareP &&
    textoCompareI &&
    textoCompareP.toLowerCase() === textoCompareI.toLowerCase() &&
    isTipoTextoParaReconciliarPorConteudo(prev) &&
    isTipoTextoParaReconciliarPorConteudo(incoming)
  ) {
    if (matchesClientTempCorrelation(prev, incoming)) return true
    const prevPersist = hasPersistedMessageIdentity(prev)
    const incPersist = hasPersistedMessageIdentity(incoming)
    /* Dois otimistas com o mesmo texto são envios distintos — não colapsar no prune/merge. */
    if (!prevPersist && !incPersist) return false
    if (prevPersist && incPersist) {
      const pid = prev.id != null && String(prev.id).trim() !== "" ? String(prev.id) : null
      const iid = incoming.id != null && String(incoming.id).trim() !== "" ? String(incoming.id) : null
      return !!(pid && iid && pid === iid)
    }
    /* Confirmado + outro otimista com texto igual: só a mesma bolha com client_temp_id explícito. */
    return matchesClientTempCorrelation(prev, incoming)
  }
  const tipoP = String(prev.tipo || "").toLowerCase().trim()
  const tipoI = String(incoming.tipo || "").toLowerCase().trim()
  const famP = mediaFamilyFromMsg(prev)
  const famI = mediaFamilyFromMsg(incoming)
  if (famP && famI && famP === famI && famP === "imagem") {
    const nomeP = String(prev.nome_arquivo || "").trim()
    const nomeI = String(incoming.nome_arquivo || "").trim()
    if (nomeP && nomeI && nomeP === nomeI) {
      if (matchesClientTempCorrelation(prev, incoming)) return true
      const prevPersist = hasPersistedMessageIdentity(prev)
      const incPersist = hasPersistedMessageIdentity(incoming)
      if (!prevPersist && !incPersist) return false
      return sameMediaStrongHint(prev, incoming)
    }
    if (isLikelyOutboundStickerImageEcho(prev, incoming)) return true
  } else if (tipoP && tipoP === tipoI && isMediaTipo(tipoP)) {
    const nomeP = String(prev.nome_arquivo || "").trim()
    const nomeI = String(incoming.nome_arquivo || "").trim()
    if (nomeP && nomeI && nomeP === nomeI) {
      if (isAudioFamilyTipo(tipoP)) {
        // Para áudios, apenas nome igual NÃO é suficiente - precisamos de correlação explícita
        if (matchesClientTempCorrelation(prev, incoming)) return true
        // Fallback: sameMediaStrongHint só aceito quando file_last_modified está presente como âncora.
        const hasLm =
          (prev?.file_last_modified != null && Number.isFinite(Number(prev.file_last_modified))) ||
          (incoming?.file_last_modified != null && Number.isFinite(Number(incoming.file_last_modified)))
        return hasLm && sameMediaStrongHint(prev, incoming)
      }
      if (matchesClientTempCorrelation(prev, incoming)) return true
      const prevPersist = hasPersistedMessageIdentity(prev)
      const incPersist = hasPersistedMessageIdentity(incoming)
      if (!prevPersist && !incPersist) return false
      return sameMediaStrongHint(prev, incoming)
    }
  }
  if (isOutgoingMediaReconcilePair(prev, incoming)) return true
  if (isOutgoingAudioReconcilePair(prev, incoming)) return true
  return false
}

function isStickerOrImageOutboundTipo(m) {
  const t = String(m?.tipo || "").toLowerCase().trim()
  return t === "sticker" || t === "imagem" || t === "image"
}

function isStickerPlaceholderText(texto) {
  const s = String(texto || "").trim().toLowerCase()
  return s === "(figurinha)" || s === "(imagem)" || s === "(mídia)"
}

/** Eco outbound CRM + webhook/socket com ids distintos (figurinha/imagem). */
function isLikelyOutboundStickerImageEcho(a, b) {
  if (!a || !b) return false
  if (!isOutgoingLike(a) || !isOutgoingLike(b)) return false
  if (!sameExplicitConversation(a, b)) return false
  if (hasConflictingClientTempCorrelation(a, b)) return false
  if (!isStickerOrImageOutboundTipo(a) || !isStickerOrImageOutboundTipo(b)) return false

  const tsA = toMillis(a?.criado_em)
  const tsB = toMillis(b?.criado_em)
  if (!Number.isFinite(tsA) || !Number.isFinite(tsB)) return false
  if (Math.abs(tsA - tsB) > 120_000) return false

  if (matchesClientTempCorrelation(a, b)) return true
  if (sameMediaStrongHint(a, b)) return true

  const idA = a?.id != null && String(a.id).trim() !== "" ? String(a.id) : null
  const idB = b?.id != null && String(b.id).trim() !== "" ? String(b.id) : null
  if (idA && idB && idA === idB) return true

  const prevLm = a?.file_last_modified ?? null
  const incLm = b?.file_last_modified ?? null
  const prevSize = a?.tamanho ?? a?.tamanho_bytes ?? null
  const incSize = b?.tamanho ?? b?.tamanho_bytes ?? null
  if (
    prevLm != null &&
    incLm != null &&
    Number.isFinite(Number(prevLm)) &&
    Number(prevLm) === Number(incLm) &&
    prevSize != null &&
    incSize != null &&
    Number.isFinite(Number(prevSize)) &&
    Number(prevSize) === Number(incSize)
  ) {
    return true
  }

  const aLocal = isLocalUploadMediaMessage(a) && hasRenderableUrl(a)
  const bLocal = isLocalUploadMediaMessage(b) && hasRenderableUrl(b)
  if (aLocal !== bLocal && Math.abs(tsA - tsB) <= 20_000) {
    if (isStickerPlaceholderText(a?.texto) || isStickerPlaceholderText(b?.texto)) return true
    if (a?.tempId || b?.tempId) return true
  }

  return false
}

function isWeakLocalUploadStickerImageEcho(a, b) {
  if (!a || !b) return false
  if (!isLikelyOutboundStickerImageEcho(a, b)) return false
  if (matchesClientTempCorrelation(a, b)) return false
  if (sameMediaStrongHint(a, b)) return false

  const idA = a?.id != null && String(a.id).trim() !== "" ? String(a.id) : null
  const idB = b?.id != null && String(b.id).trim() !== "" ? String(b.id) : null
  if (idA && idB && idA === idB) return false

  const prevLm = a?.file_last_modified ?? null
  const incLm = b?.file_last_modified ?? null
  const prevSize = a?.tamanho ?? a?.tamanho_bytes ?? null
  const incSize = b?.tamanho ?? b?.tamanho_bytes ?? null
  if (
    prevLm != null &&
    incLm != null &&
    Number.isFinite(Number(prevLm)) &&
    Number(prevLm) === Number(incLm) &&
    prevSize != null &&
    incSize != null &&
    Number.isFinite(Number(prevSize)) &&
    Number(prevSize) === Number(incSize)
  ) {
    return false
  }

  const tsA = toMillis(a?.criado_em)
  const tsB = toMillis(b?.criado_em)
  const aLocal = isLocalUploadMediaMessage(a) && hasRenderableUrl(a)
  const bLocal = isLocalUploadMediaMessage(b) && hasRenderableUrl(b)
  return (
    Number.isFinite(tsA) &&
    Number.isFinite(tsB) &&
    aLocal !== bLocal &&
    Math.abs(tsA - tsB) <= 20_000 &&
    (isStickerPlaceholderText(a?.texto) || isStickerPlaceholderText(b?.texto) || a?.tempId || b?.tempId)
  )
}

function countPendingOutgoingStickerImageFamily(list, msg) {
  const family = mediaFamilyFromMsg(msg)
  const conv = msg?.conversa_id != null ? String(msg.conversa_id) : null
  if (!family || !conv) return false
  return list.filter((m) =>
    m &&
    isPendingOutgoingTemp(m) &&
    isOutgoingLike(m) &&
    isStickerOrImageOutboundTipo(m) &&
    mediaFamilyFromMsg(m) === family &&
    m.conversa_id != null &&
    String(m.conversa_id) === conv
  ).length
}

function shouldKeepWeakStickerImageCandidates(list, a, b) {
  if (!isWeakLocalUploadStickerImageEcho(a, b) && !isWeakLocalUploadStickerImageEcho(b, a)) return false
  const pending = isPendingOutgoingTemp(a) ? a : isPendingOutgoingTemp(b) ? b : null
  const persisted = hasPersistedMessageIdentity(a) ? a : hasPersistedMessageIdentity(b) ? b : null
  if (!pending || !persisted) return false
  return countPendingOutgoingStickerImageFamily(list, pending) > 1
}

function hasAmbiguousPendingStickerImageMerge(list, msg) {
  if (!msg || !isOutgoingLike(msg) || !hasPersistedMessageIdentity(msg)) return false
  if (!isStickerOrImageOutboundTipo(msg)) return false
  if (resolveClientTempId(msg)) return false
  return countPendingOutgoingStickerImageFamily(list, msg) > 1
}

function pruneRedundantOutgoingStickerImageEchoes(list) {
  if (!Array.isArray(list) || list.length < 2) return list
  const remove = new Set()
  for (let i = 0; i < list.length; i++) {
    if (remove.has(i)) continue
    for (let j = i + 1; j < list.length; j++) {
      if (remove.has(j)) continue
      const a = list[i]
      const b = list[j]
      if (!isLikelyOutboundStickerImageEcho(a, b) && !isLikelyOutboundStickerImageEcho(b, a)) continue
      if (shouldKeepWeakStickerImageCandidates(list, a, b)) continue
      const keepIdx =
        persistedIdentityDedupeScore(a) >= persistedIdentityDedupeScore(b) ? i : j
      remove.add(keepIdx === i ? j : i)
    }
  }
  if (!remove.size) return list
  return list.filter((_, idx) => !remove.has(idx))
}

function findMergeableMapKey(map, copy) {
  if (!map || !copy) return null
  const copyIsPersistedAudio =
    isOutgoingLike(copy) &&
    hasPersistedMessageIdentity(copy) &&
    mediaFamilyFromMsg(copy) === "audio"
  for (const [key, prev] of map.entries()) {
    if (!prev) continue
    // Dois áudios confirmados distintos não colapsam — mas a MESMA mensagem (id/wa/temp) ainda deve fundir.
    if (copyIsPersistedAudio && isOutgoingLike(prev) && hasPersistedMessageIdentity(prev) && mediaFamilyFromMsg(prev) === "audio") {
      if (!areLikelySameMessageBubble(prev, copy)) continue
    }
    if (areLikelySameMessageBubble(prev, copy)) return key
  }
  return null
}

/** Remove otimistas órfãos quando já existe a mensagem confirmada (id/whatsapp_id). */
function pruneRedundantOutgoingTemps(list) {
  if (!Array.isArray(list) || list.length < 2) return list
  const recentMs = 90_000
  const now = Date.now()
  const confirmed = list.filter((m) => {
    if (!isOutgoingLike(m)) return false
    const idOk = m.id != null && String(m.id).trim() !== ""
    const waOk = m.whatsapp_id != null && String(m.whatsapp_id).trim() !== ""
    return idOk || waOk
  })
  if (!confirmed.length) return list
  return list.filter((m) => {
    if (!m?.tempId || !isOutgoingLike(m)) return true
    const idOk = m.id != null && String(m.id).trim() !== ""
    const waOk = m.whatsapp_id != null && String(m.whatsapp_id).trim() !== ""
    if (idOk || waOk) return true
    const ts = toMillis(m?.criado_em)
    if (!Number.isFinite(ts) || now - ts >= recentMs) return true
    
    // Para áudios, exige correlação client_temp_id explícita.
    // sameMediaStrongHint sozinho pode dar falso-positivo quando dois áudios têm nome igual
    // (ex: "audio.ogg") e tamanho parecido — removeria o otimista do áudio anterior.
    const isAudio = isAudioFamilyTipo(m.tipo)
    if (isAudio) {
      return !confirmed.some((c) => {
        if (!isAudioFamilyTipo(c.tipo)) return false
        return matchesClientTempCorrelation(m, c)
      })
    }
    
    return !confirmed.some((c) => {
      if (matchesClientTempCorrelation(m, c)) return true
      if (shouldKeepWeakStickerImageCandidates(list, m, c)) return false
      /* Texto: não remover otimista só porque o texto coincide — exige correlação explícita. */
      if (isTipoTextoParaReconciliarPorConteudo(m) && isTipoTextoParaReconciliarPorConteudo(c)) {
        return false
      }
      return areLikelySameMessageBubble(m, c)
    })
  })
}

/** Preferência ao colapsar duplicatas id/whatsapp_id (tempId + blob local > eco id-only). */
function persistedIdentityDedupeScore(m) {
  let score = 0
  if (m?.tempId) score += 8
  if (isLocalUploadMediaMessage(m) && hasRenderableUrl(m)) score += 4
  else if (hasRenderableUrl(m)) score += 2
  if (m?._optimisticBlobUrl) score += 1
  const seq = Number(m?._stableInsertSeq)
  if (Number.isFinite(seq)) score -= seq / 1e15
  return score
}

function dedupeListByPersistedIdentity(list) {
  if (!Array.isArray(list) || list.length < 2) return list
  const bestById = new Map()
  const bestByWa = new Map()
  const pickBetter = (a, b) =>
    persistedIdentityDedupeScore(b.m) > persistedIdentityDedupeScore(a.m) ? b : a

  list.forEach((m, idx) => {
    const id = m?.id != null && String(m.id).trim() !== "" ? String(m.id) : null
    const wa =
      m?.whatsapp_id != null && String(m.whatsapp_id).trim() !== ""
        ? String(m.whatsapp_id)
        : null
    if (id) bestById.set(id, bestById.has(id) ? pickBetter(bestById.get(id), { m, idx }) : { m, idx })
    if (wa) bestByWa.set(wa, bestByWa.has(wa) ? pickBetter(bestByWa.get(wa), { m, idx }) : { m, idx })
  })

  const drop = new Set()
  list.forEach((m, idx) => {
    const id = m?.id != null && String(m.id).trim() !== "" ? String(m.id) : null
    const wa =
      m?.whatsapp_id != null && String(m.whatsapp_id).trim() !== ""
        ? String(m.whatsapp_id)
        : null
    if (id && bestById.has(id) && bestById.get(id).idx !== idx) {
      if (areLikelySameMessageBubble(bestById.get(id).m, m)) drop.add(idx)
    }
    if (wa && bestByWa.has(wa) && bestByWa.get(wa).idx !== idx) {
      if (areLikelySameMessageBubble(bestByWa.get(wa).m, m)) drop.add(idx)
    }
  })
  if (!drop.size) return list
  return list.filter((_, idx) => !drop.has(idx))
}

function pruneRedundantOutgoingMediaEchoes(list) {
  if (!Array.isArray(list) || list.length < 2) return list
  const remove = new Set()
  for (let i = 0; i < list.length; i++) {
    const m = list[i]
    if (!m || !isOutgoingLike(m) || !mediaFamilyFromMsg(m)) continue
    const mid = m.id != null && String(m.id).trim() !== "" ? String(m.id) : null
    if (!mid) continue
    for (let j = 0; j < list.length; j++) {
      if (i === j) continue
      const o = list[j]
      if (!o || !isOutgoingLike(o) || !mediaFamilyFromMsg(o)) continue
      const oid = o.id != null && String(o.id).trim() !== "" ? String(o.id) : null
      if (!oid || oid !== mid) continue
      const mLocal = isLocalUploadMediaMessage(m) && hasRenderableUrl(m)
      const oLocal = isLocalUploadMediaMessage(o) && hasRenderableUrl(o)
      if (mLocal && !oLocal) remove.add(j)
      else if (oLocal && !mLocal) remove.add(i)
      else if (m?.tempId && !o?.tempId) remove.add(i)
      else if (o?.tempId && !m?.tempId) remove.add(j)
      // Empate total: mantém o de índice menor (inserção anterior) e remove o mais recente
      else remove.add(Math.max(i, j))
      break
    }
  }
  if (!remove.size) return list
  return list.filter((_, idx) => !remove.has(idx))
}

function finalizeMensagensList(list) {
  const beforePrune = list.length
  const afterTemps = pruneRedundantOutgoingTemps(list)
  const afterStickerEchoes = pruneRedundantOutgoingStickerImageEchoes(afterTemps)
  const afterOutgoingEchoes = pruneRedundantOutgoingMediaEchoes(afterStickerEchoes)
  const afterIncomingEchoes = pruneRedundantIncomingClientMediaEchoes(afterOutgoingEchoes)
  const afterAutomatedTextEchoes = pruneRedundantAutomatedTextEchoes(afterIncomingEchoes)
  const afterContactEchoes = pruneRedundantContactEchoes(afterAutomatedTextEchoes)
  const afterIdentityDedupe = dedupeListByPersistedIdentity(afterContactEchoes)
  const final = sortMensagensChronological(afterIdentityDedupe)
  
  // Debug para detectar remoções inesperadas de áudios
  if (isDebugRuntime() && typeof window !== "undefined" && final.length < beforePrune) {
    const audiosBefore = list.filter(m => isAudioFamilyTipo(m?.tipo)).length
    const audiosAfter = final.filter(m => isAudioFamilyTipo(m?.tipo)).length
    if (audiosBefore > audiosAfter) {
      console.warn("[AUDIO_DEBUG] Áudios removidos durante finalizeMensagensList", {
        antes: audiosBefore,
        depois: audiosAfter,
        totalAntes: beforePrune,
        totalDepois: final.length,
        removidos: list.filter(m => isAudioFamilyTipo(m?.tipo) && !final.some(f =>
          (f.tempId && f.tempId === m.tempId) || (f.id != null && f.id === m.id) || (f.whatsapp_id != null && f.whatsapp_id === m.whatsapp_id)
        ))
      })
    }
  }
  
  return final
}

/** Chave estável para React (evita colisão e remount errado). */
function getMessageListReactKey(m, conversaId) {
  if (!m) return "unknown"
  if (m.tempId != null && String(m.tempId).trim() !== "") return String(m.tempId)
  if (m.id != null && String(m.id).trim() !== "") return String(m.id)
  if (m.whatsapp_id != null && String(m.whatsapp_id).trim() !== "") return `wa-${String(m.whatsapp_id)}`
  const syn = stableSyntheticMessageKey(m, conversaId)
  const seq = Number.isFinite(Number(m._stableInsertSeq)) ? String(m._stableInsertSeq) : ""
  return seq ? `${syn}·seq${seq}` : syn
}

/** Evita tratar `id` da conversa como id da mensagem (colapsa várias bolhas num único id). */
function sanitizePersistedMessageIdentity(msg) {
  if (!msg || typeof msg !== "object") return msg
  const n = { ...msg }
  const convRaw = n.conversa_id ?? n.chat_id ?? n.conversation_id
  const convId = convRaw != null && String(convRaw).trim() !== "" ? String(convRaw).trim() : null
  const idRaw = n.id != null && String(n.id).trim() !== "" ? String(n.id).trim() : null
  if (convId && idRaw && idRaw === convId) {
    delete n.id
  }
  const waRaw = n.whatsapp_id != null && String(n.whatsapp_id).trim() !== "" ? String(n.whatsapp_id).trim() : null
  if (convId && waRaw && waRaw === convId) {
    delete n.whatsapp_id
  }
  return n
}

function normalizeMsgForStore(msg) {
  if (!msg || typeof msg !== "object") return msg
  let n = sanitizePersistedMessageIdentity({ ...msg })
  const idMissing = n.id == null || String(n.id).trim() === ""
  if (idMissing) {
    const mid = n.mensagem_id ?? n.message_id ?? n.messageId ?? n.msg_id
    if (mid != null && String(mid).trim() !== "") n.id = mid
  }
  n = sanitizePersistedMessageIdentity(n)
  const waMissing = n.whatsapp_id == null || String(n.whatsapp_id).trim() === ""
  if (waMissing) {
    const wa = n.wamid ?? n.wa_message_id ?? n.whatsapp_message_id
    if (wa != null && String(wa).trim() !== "") n.whatsapp_id = wa
  }
  const altTs = n.created_at ?? n.timestamp ?? n.data_criacao ?? n.ts
  let ms = resolveTimestampToMillis(n.criado_em)
  if (!Number.isFinite(ms)) ms = resolveTimestampToMillis(altTs)
  if (!Number.isFinite(ms)) {
    n.criado_em = new Date().toISOString()
  } else if (!n.criado_em || !String(n.criado_em).trim()) {
    n.criado_em = new Date(ms).toISOString()
  }
  return n
}

/**
 * Remove tempId em linhas novas vindas só do servidor (sem bolha otimista prévia).
 * Merge in-place de envio do usuário usa finalizeMergedMessageRow (mantém tempId para UI estável).
 */
function stripTempIdWhenPersisted(msg) {
  if (!msg || typeof msg !== "object") return msg
  const idOk = msg.id != null && String(msg.id).trim() !== ""
  const waOk = msg.whatsapp_id != null && String(msg.whatsapp_id).trim() !== ""
  if (!idOk && !waOk) return msg
  const next = { ...msg }
  delete next.tempId
  return next
}

/** Merge in-place preservando tempId da bolha otimista (chave React + lastMsgKey estáveis). */
/**
 * Flags locais de espera (offline/incerto) nao vem do backend. No merge
 * `{...prev, ...api}` elas sobrevivem e o relogio fica preso mesmo apos sent/delivered.
 */
function clearStaleOutboundWaitFlags(merged) {
  if (!merged || typeof merged !== "object") return merged
  const status = String(merged.status_mensagem ?? merged.status ?? "").toLowerCase().trim()
  const hasPersist =
    (merged.id != null && String(merged.id).trim() !== "") ||
    (merged.whatsapp_id != null && String(merged.whatsapp_id).trim() !== "")
  const serverProgress = [
    "pending",
    "sending",
    "enviando",
    "sent",
    "enviada",
    "enviado",
    "delivered",
    "entregue",
    "read",
    "lida",
    "played",
    "erro",
    "error",
    "failed",
    "falhou",
  ].includes(status)
  const stillWaitingLocal =
    merged.aguardando_conexao === true ||
    status === "aguardando_conexao" ||
    merged.envio_incerto === true ||
    merged.envio_demorado === true
  if (!stillWaitingLocal) return merged
  if (!hasPersist && !serverProgress) return merged

  const next = { ...merged }
  next.aguardando_conexao = false
  next.envio_incerto = false
  next.envio_demorado = false
  if (status === "aguardando_conexao") {
    next.status = hasPersist ? "pending" : next.status
    next.status_mensagem = hasPersist ? "pending" : next.status_mensagem
  }
  if (next.erro_mensagem && /aguardando conex|sem conex|internet voltar/i.test(String(next.erro_mensagem))) {
    delete next.erro_mensagem
  }
  return next
}

function finalizeMergedMessageRow(prev, merged) {
  let row = cleanupOptimisticBlobFields(mergeMsgPreferringTombstone(prev, merged))
  row = clearStaleOutboundWaitFlags(row)
  row = preferRicherContactFields(prev, row)
  if (prev?.tempId) return { ...row, tempId: prev.tempId }
  return stripTempIdWhenPersisted(row)
}

/** Ao fundir eco CRM (só nome) + webhook (vCard), mantém o corpo/meta mais rico. */
function preferRicherContactFields(prev, merged) {
  if (!merged || !prev) return merged
  if (!isContactMessage(prev) && !isContactMessage(merged)) return merged
  const next = { ...merged }
  const prevVcard = messageHasVCardBody(prev)
  const mergedVcard = messageHasVCardBody(merged)
  if (prevVcard && !mergedVcard) {
    next.texto = prev.texto ?? prev.conteudo
    if (prev.conteudo != null) next.conteudo = prev.conteudo
  }
  const prevMeta = prev.contact_meta && typeof prev.contact_meta === "object" ? prev.contact_meta : null
  const mergedMeta =
    next.contact_meta && typeof next.contact_meta === "object" ? next.contact_meta : null
  if (prevMeta || mergedMeta) {
    const prevPhone = String(prevMeta?.telefone ?? prevMeta?.phone ?? "").replace(/\D/g, "")
    const mergedPhone = String(mergedMeta?.telefone ?? mergedMeta?.phone ?? "").replace(/\D/g, "")
    const richerMeta = {
      ...(prevMeta || {}),
      ...(mergedMeta || {}),
    }
    if (prevPhone.length >= 8 && mergedPhone.length < 8) {
      richerMeta.telefone = prevMeta.telefone ?? prevMeta.phone
    }
    if (!richerMeta.nome && prevMeta?.nome) richerMeta.nome = prevMeta.nome
    next.contact_meta = richerMeta
  }
  if (!next.tipo || String(next.tipo).trim() === "") next.tipo = prev.tipo || "contact"
  return next
}

/** Otimista ainda sem id/whatsapp — candidato a reconciliação por texto. */
function isPendingOutgoingTemp(m) {
  if (!m?.tempId || !isOutgoingLike(m)) return false
  const idOk = m.id != null && String(m.id).trim() !== ""
  const waOk = m.whatsapp_id != null && String(m.whatsapp_id).trim() !== ""
  return !idOk && !waOk
}

/** Mantém placeholder local “apagada para todos” se a API devolver o corpo antigo sem flag. */
function mergeMsgPreferringTombstone(prev, mergedCandidate) {
  if (!prev) return mergedCandidate
  if (!mergedCandidate) return prev
  if (prev.apagada_para_todos && !mergedCandidate.apagada_para_todos) return prev
  return mergedCandidate
}

const MEDIA_TIPOS = new Set(["imagem", "sticker", "audio", "voice", "video", "arquivo", "ptt", "documento"])
const AUDIO_FAMILY_TIPOS = new Set(["audio", "voice", "ptt"])

function isMediaTipo(tipo) {
  return MEDIA_TIPOS.has(String(tipo || "").toLowerCase().trim())
}

function isAudioFamilyTipo(tipo) {
  return AUDIO_FAMILY_TIPOS.has(String(tipo || "").toLowerCase().trim())
}

function hasPersistedMessageIdentity(m) {
  const idOk = m?.id != null && String(m.id).trim() !== ""
  const waOk = m?.whatsapp_id != null && String(m.whatsapp_id).trim() !== ""
  return idOk || waOk
}

/** Familia de midia usada para reconciliar optimistic + socket/API sem misturar tipos diferentes. */
function mediaFamilyFromMsg(m) {
  const tipo = String(m?.tipo || "").toLowerCase().trim()
  if (isAudioFamilyTipo(tipo)) return "audio"
  if (tipo === "imagem" || tipo === "image" || tipo === "sticker") return "imagem"
  if (tipo === "video" || tipo === "vídeo") return "video"
  if (tipo === "arquivo" || tipo === "documento" || tipo === "document" || tipo === "file") return "arquivo"
  return ""
}

function mediaFileBaseName(m) {
  const raw = String(m?.nome_arquivo || m?.filename || "").trim()
  if (!raw) return ""
  const clean = raw.split(/[?#]/)[0].split(/[\\/]/).pop() || raw
  return clean
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\.[a-z0-9]{2,5}$/i, "")
}

function mediaUrlTail(m) {
  const raw = String(m?.url || m?.url_absoluta || "").trim()
  if (!raw || raw.startsWith("blob:")) return ""
  return raw.split(/[?#]/)[0].split("/").pop()?.toLowerCase() || ""
}

function isLocalUploadMediaMessage(m) {
  const raw = String(m?.url || m?.url_absoluta || "").trim()
  return raw.startsWith("/uploads/")
}

function resolveClientTempId(msg) {
  const v = msg?.client_temp_id ?? msg?.clientTempId
  if (v == null || String(v).trim() === "") return null
  return String(v).trim()
}

function sameExplicitConversation(prev, incoming) {
  const prevConv = prev?.conversa_id != null && String(prev.conversa_id).trim() !== ""
    ? String(prev.conversa_id)
    : null
  const incConv = incoming?.conversa_id != null && String(incoming.conversa_id).trim() !== ""
    ? String(incoming.conversa_id)
    : null
  if (prevConv && incConv) return prevConv === incConv
  return true
}

/** Correlação explícita bolha otimista ↔ confirmação HTTP/socket. */
function matchesClientTempCorrelation(prev, incoming) {
  if (!sameExplicitConversation(prev, incoming)) return false
  const prevTemp =
    prev?.tempId != null && String(prev.tempId).trim() !== "" ? String(prev.tempId).trim() : null
  const incTemp =
    incoming?.tempId != null && String(incoming.tempId).trim() !== ""
      ? String(incoming.tempId).trim()
      : null
  const prevCid = resolveClientTempId(prev)
  const incCid = resolveClientTempId(incoming)

  if (prevTemp && incCid && prevTemp === incCid) return true
  if (incTemp && prevCid && incTemp === prevCid) return true
  if (prevTemp && incTemp && prevTemp === incTemp) return true
  if (prevCid && incCid && prevCid === incCid) return true
  return false
}

function clientTempCorrelationKeys(msg) {
  const keys = []
  const tempId = msg?.tempId != null && String(msg.tempId).trim() !== "" ? String(msg.tempId).trim() : null
  const clientTempId = resolveClientTempId(msg)
  if (tempId) keys.push(tempId)
  if (clientTempId && clientTempId !== tempId) keys.push(clientTempId)
  return keys
}

function hasConflictingClientTempCorrelation(prev, incoming) {
  if (!sameExplicitConversation(prev, incoming)) return true
  const prevKeys = clientTempCorrelationKeys(prev)
  const incomingKeys = clientTempCorrelationKeys(incoming)
  if (!prevKeys.length || !incomingKeys.length) return false
  return !prevKeys.some((k) => incomingKeys.includes(k))
}

function pickClosestPendingMediaCandidate(candidates, msg) {
  if (!candidates?.length) return null
  const tsIn = toMillis(msg?.criado_em)
  if (!Number.isFinite(tsIn)) return candidates[0]
  let best = candidates[0]
  let bestDist = Math.abs(toMillis(best.m?.criado_em) - tsIn)
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i]
    const ts = toMillis(c.m?.criado_em)
    if (!Number.isFinite(ts)) continue
    const dist = Math.abs(ts - tsIn)
    if (dist < bestDist || (dist === bestDist && c.seq < best.seq)) {
      best = c
      bestDist = dist
    }
  }
  return best
}

function sameMediaStrongHint(prev, incoming) {
  const prevName = mediaFileBaseName(prev)
  const incomingName = mediaFileBaseName(incoming)
  const prevSize = prev?.tamanho ?? prev?.tamanho_bytes ?? null
  const incomingSize = incoming?.tamanho ?? incoming?.tamanho_bytes ?? null
  const prevLm = prev?.file_last_modified ?? null
  const incomingLm = incoming?.file_last_modified ?? null
  if (prevName && incomingName && prevName === incomingName) {
    if (
      prevSize != null &&
      incomingSize != null &&
      Number.isFinite(Number(prevSize)) &&
      Number(prevSize) === Number(incomingSize)
    ) {
      if (
        prevLm != null &&
        incomingLm != null &&
        Number.isFinite(Number(prevLm)) &&
        Number.isFinite(Number(incomingLm))
      ) {
        return Number(prevLm) === Number(incomingLm)
      }
      return prevLm == null && incomingLm == null
    }
    if (
      prevLm != null &&
      incomingLm != null &&
      Number.isFinite(Number(prevLm)) &&
      Number(prevLm) === Number(incomingLm)
    ) {
      return true
    }
  }
  const prevUrl = mediaUrlTail(prev)
  const incomingUrl = mediaUrlTail(incoming)
  if (prevUrl && incomingUrl && prevUrl === incomingUrl) return true
  if (
    prevSize != null &&
    incomingSize != null &&
    Number.isFinite(Number(prevSize)) &&
    Number(prevSize) === Number(incomingSize) &&
    prevLm != null &&
    incomingLm != null &&
    Number.isFinite(Number(prevLm)) &&
    Number(prevLm) === Number(incomingLm)
  ) {
    return true
  }
  return false
}

function sameMediaNameAndSizeHint(prev, incoming) {
  const prevName = mediaFileBaseName(prev)
  const incomingName = mediaFileBaseName(incoming)
  if (!prevName || !incomingName || prevName !== incomingName) return false
  const prevSize = prev?.tamanho ?? prev?.tamanho_bytes ?? null
  const incomingSize = incoming?.tamanho ?? incoming?.tamanho_bytes ?? null
  return (
    prevSize != null &&
    incomingSize != null &&
    Number.isFinite(Number(prevSize)) &&
    Number(prevSize) === Number(incomingSize)
  )
}

/**
 * Áudio outbound confirmado (socket/API) sem client_temp_id: funde no otimista pendente
 * mais próximo no tempo — evita bolha duplicada quando nome/tipo divergem (webm vs voice).
 */
function findClosestPendingOutgoingAudioIndex(list, msg, recentMs = 90_000) {
  if (!Array.isArray(list) || !msg || mediaFamilyFromMsg(msg) !== "audio") return -1
  if (!hasPersistedMessageIdentity(msg) || !isOutgoingLike(msg)) return -1
  const tsI = toMillis(msg?.criado_em)
  if (!Number.isFinite(tsI)) return -1

  const pending = []
  for (let i = 0; i < list.length; i++) {
    const m = list[i]
    if (!isPendingOutgoingTemp(m) || mediaFamilyFromMsg(m) !== "audio") continue
    const tsP = toMillis(m?.criado_em)
    if (!Number.isFinite(tsP) || Math.abs(tsP - tsI) > recentMs) continue
    pending.push({
      i,
      m,
      seq: Number.isFinite(Number(m._stableInsertSeq)) ? Number(m._stableInsertSeq) : Infinity,
    })
  }
  if (!pending.length) return -1
  if (pending.length === 1) return pending[0].i

  // Vários otimistas ao mesmo tempo: não adivinhar pelo relógio (confundia 1º e 2º áudio).
  const withHint = pending.filter((p) => sameMediaStrongHint(p.m, msg))
  if (withHint.length === 1) return withHint[0].i
  if (withHint.length > 1) return pickClosestPendingMediaCandidate(withHint, msg)?.i ?? -1
  const withNameAndSize = pending.filter((p) => sameMediaNameAndSizeHint(p.m, msg))
  if (withNameAndSize.length === 1) return withNameAndSize[0].i
  if (withNameAndSize.length > 1) return pickClosestPendingMediaCandidate(withNameAndSize, msg)?.i ?? -1
  return -1
}

/** Índice do otimista de mídia mais adequado para fundir com confirmação (FIFO + hint forte). */
function findPendingOutgoingMediaMergeIndex(list, msg, opts = {}) {
  if (!Array.isArray(list) || !msg) return -1
  const candidates = []
  for (let i = 0; i < list.length; i++) {
    const m = list[i]
    if (!isPendingOutgoingTemp(m) || !mediaFamilyFromMsg(m)) continue
    if (!isOutgoingMediaReconcilePair(m, msg, opts) && !isOutgoingAudioReconcilePair(m, msg)) continue
    candidates.push({
      i,
      m,
      strong: sameMediaStrongHint(m, msg),
      seq: Number.isFinite(Number(m._stableInsertSeq)) ? Number(m._stableInsertSeq) : Infinity,
    })
  }
  if (!candidates.length) {
    if (mediaFamilyFromMsg(msg) === "audio" && hasPersistedMessageIdentity(msg)) {
      return findClosestPendingOutgoingAudioIndex(list, msg)
    }
    return -1
  }

  const clientTempId = resolveClientTempId(msg)
  if (clientTempId) {
    const byClient = candidates.filter((c) => c.m?.tempId && String(c.m.tempId) === clientTempId)
    if (byClient.length === 1) return byClient[0].i
    if (byClient.length > 1) {
      // Múltiplos candidatos com mesmo client_temp_id - escolhe o mais próximo temporalmente
      const closest = pickClosestPendingMediaCandidate(byClient, msg)
      return closest?.i ?? -1
    }
    // client_temp_id presente mas sem bolha correspondente — não fundir em outro áudio pendente
    return -1
  }

  const strongOnes = candidates.filter((c) => c.strong)
  if (strongOnes.length === 1) return strongOnes[0].i
  if (strongOnes.length > 1) {
    const closest = pickClosestPendingMediaCandidate(strongOnes, msg)
    return closest?.i ?? -1
  }

  const pendingSameFamily = list.filter(
    (m) => isPendingOutgoingTemp(m) && mediaFamilyFromMsg(m) === mediaFamilyFromMsg(msg)
  )
  const audioFamily = mediaFamilyFromMsg(msg) === "audio"
  if (
    opts.allowLoose === true &&
    !audioFamily &&
    candidates.length === 1 &&
    pendingSameFamily.length === 1
  ) {
    return candidates[0].i
  }

  if (audioFamily && hasPersistedMessageIdentity(msg)) {
    const looseIdx = findClosestPendingOutgoingAudioIndex(list, msg)
    if (looseIdx >= 0) return looseIdx
  }
  return -1
}

/** Otimista de audio + confirmacao (socket/HTTP): nomes/tipos podem divergir (audio vs voice). */
function isOutgoingAudioReconcilePair(prev, incoming) {
  if (!prev || !incoming) return false
  if (!isOutgoingLike(prev) || !isOutgoingLike(incoming)) return false
  if (!isAudioFamilyTipo(prev.tipo) || !isAudioFamilyTipo(incoming.tipo)) return false
  const recentMs = 90_000
  const tsP = toMillis(prev?.criado_em)
  const tsI = toMillis(incoming?.criado_em)
  if (!Number.isFinite(tsP) || !Number.isFinite(tsI)) return false
  if (Math.abs(tsP - tsI) > recentMs) return false
  const prevPending = isPendingOutgoingTemp(prev)
  const incPending = isPendingOutgoingTemp(incoming)
  const prevPersist = hasPersistedMessageIdentity(prev)
  const incPersist = hasPersistedMessageIdentity(incoming)
  if (!((prevPending && incPersist) || (incPending && prevPersist))) return false
  const cid = resolveClientTempId(incoming) || resolveClientTempId(prev)
  if (cid) return matchesClientTempCorrelation(prev, incoming)
  // Sem client_temp_id: exige file_last_modified como âncora de unicidade.
  // Nome+tamanho sem last_modified é fraco demais para áudios gravados em sequência.
  const hasLm =
    (prev?.file_last_modified != null && Number.isFinite(Number(prev.file_last_modified))) ||
    (incoming?.file_last_modified != null && Number.isFinite(Number(incoming.file_last_modified)))
  if (!hasLm) return false
  return sameMediaStrongHint(prev, incoming)
}

function isOutgoingMediaReconcilePair(prev, incoming, opts = {}) {
  if (!prev || !incoming) return false
  if (!isOutgoingLike(prev) || !isOutgoingLike(incoming)) return false
  const prevFamily = mediaFamilyFromMsg(prev)
  const incomingFamily = mediaFamilyFromMsg(incoming)
  if (!prevFamily || !incomingFamily || prevFamily !== incomingFamily) return false
  const prevPending = isPendingOutgoingTemp(prev)
  const incPending = isPendingOutgoingTemp(incoming)
  const prevPersist = hasPersistedMessageIdentity(prev)
  const incPersist = hasPersistedMessageIdentity(incoming)
  if (!((prevPending && incPersist) || (incPending && prevPersist))) return false

  const recentMs = opts.allowLoose ? 15_000 : 120_000
  const tsP = toMillis(prev?.criado_em)
  const tsI = toMillis(incoming?.criado_em)
  if (!Number.isFinite(tsP) || !Number.isFinite(tsI)) return false
  if (Math.abs(tsP - tsI) > recentMs) return false

  if (prevFamily === "audio") {
    const cid = resolveClientTempId(incoming) || resolveClientTempId(prev)
    if (cid) return matchesClientTempCorrelation(prev, incoming)
    const hasLm =
      (prev?.file_last_modified != null && Number.isFinite(Number(prev.file_last_modified))) ||
      (incoming?.file_last_modified != null && Number.isFinite(Number(incoming.file_last_modified)))
    if (!hasLm) return false
    return sameMediaStrongHint(prev, incoming)
  }

  const prevCid = resolveClientTempId(prev)
  const incomingCid = resolveClientTempId(incoming)
  if (prevCid || incomingCid) {
    if (matchesClientTempCorrelation(prev, incoming)) return true
    // Se a confirmação trouxe client_temp_id, ela só pode fundir com a bolha exata.
    if (incomingCid) return false
    // Alguns ecos do provider/socket chegam sem client_temp_id. Nesse caso, o fallback
    // frouxo continua limitado a uma única mídia pendente da mesma família.
    if (opts.allowLoose !== true) return false
  }
  if (sameMediaStrongHint(prev, incoming)) return true
  return opts.allowLoose === true
}

/** Só fotos e áudios recebidos do cliente — eco duplo do socket (placeholder → URL). */
const INCOMING_CLIENT_MEDIA_RECONCILE_MS = 20_000

function isIncomingClientMediaFamily(fam) {
  return fam === "audio" || fam === "imagem"
}

function resolveInboundAudioDurationSec(m) {
  const raw =
    m?.audio_duracao_sec ??
    m?.audioDuracaoSec ??
    m?.duracao_segundos ??
    m?.duration ??
    m?.audio_duration ??
    null
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Duas bolhas inbound da mesma mídia (ex.: nova_mensagem sem URL + nova_mensagem com /uploads/).
 * Não aplica a mensagens enviadas pelo atendente.
 */
function isIncomingClientMediaReconcilePair(prev, incoming) {
  if (!prev || !incoming) return false
  if (isOutgoingLike(prev) || isOutgoingLike(incoming)) return false

  const fam = mediaFamilyFromMsg(prev)
  const famI = mediaFamilyFromMsg(incoming)
  if (!fam || fam !== famI || !isIncomingClientMediaFamily(fam)) return false

  const pwa = prev.whatsapp_id != null && String(prev.whatsapp_id).trim() !== "" ? String(prev.whatsapp_id) : null
  const iwa =
    incoming.whatsapp_id != null && String(incoming.whatsapp_id).trim() !== ""
      ? String(incoming.whatsapp_id)
      : null
  if (pwa && iwa && pwa === iwa) return true

  const pid = prev.id != null && String(prev.id).trim() !== "" ? String(prev.id) : null
  const iid = incoming.id != null && String(incoming.id).trim() !== "" ? String(incoming.id) : null
  if (pid && iid && pid === iid) return true
  if (pid && iid && pid !== iid) return false

  // Se ambos os lados já têm alguma identidade persistida (id ou whatsapp_id) mas não bateram
  // nas checagens fortes acima, são DUAS mensagens diferentes — não arriscar uma fusão por
  // heurística fraca (duração igual, nome/tamanho de arquivo parecido, etc.). Isso evita que
  // duas mídias reais recebidas em sequência (ex.: dois áudios curtos com a mesma duração)
  // sejam fundidas numa única bolha, fazendo a segunda "desaparecer" da tela.
  const prevPersist = hasPersistedMessageIdentity(prev)
  const incPersist = hasPersistedMessageIdentity(incoming)
  if (prevPersist && incPersist) return false

  const tsP = toMillis(prev?.criado_em)
  const tsI = toMillis(incoming?.criado_em)
  if (!Number.isFinite(tsP) || !Number.isFinite(tsI)) return false
  if (Math.abs(tsP - tsI) > INCOMING_CLIENT_MEDIA_RECONCILE_MS) return false

  if (sameMediaStrongHint(prev, incoming)) return true

  const durP = resolveInboundAudioDurationSec(prev)
  const durI = resolveInboundAudioDurationSec(incoming)
  if (fam === "audio" && durP != null && durI != null && durP === durI) return true

  const hasUrlP = hasRenderableUrl(prev)
  const hasUrlI = hasRenderableUrl(incoming)
  if (hasUrlP !== hasUrlI) return true

  return false
}

function incomingClientMediaDedupeScore(m) {
  let score = 0
  if (hasPersistedMessageIdentity(m)) score += 10
  if (hasRenderableUrl(m)) score += 5
  if (isLocalUploadMediaMessage(m)) score += 2
  return score
}

function findIncomingClientMediaMergeIndex(list, msg) {
  if (!msg || isOutgoingLike(msg)) return -1
  if (!isIncomingClientMediaFamily(mediaFamilyFromMsg(msg))) return -1
  for (let i = list.length - 1; i >= 0; i--) {
    if (isIncomingClientMediaReconcilePair(list[i], msg)) return i
  }
  return -1
}

function mergeIncomingClientMediaAtIndex(list, convId, mergeIdx, msg) {
  const existing = list[mergeIdx]
  const merged = preserveLocalMediaFields(existing, { ...existing, ...msg })
  if (convId) merged.conversa_id = convId
  if (msg.id && !existing.id) merged.id = msg.id
  if (msg.whatsapp_id && !existing.whatsapp_id) merged.whatsapp_id = msg.whatsapp_id
  if (msg.status != null) merged.status = msg.status
  if (msg.status_mensagem != null) merged.status_mensagem = msg.status_mensagem
  merged._stableInsertSeq = mergeStableSeq(existing, msg, null)
  const next = [...list]
  next[mergeIdx] = finalizeMergedMessageRow(existing, merged)
  if (hasPersistedMessageIdentity(merged)) {
    return dedupeRowsByPersistedIdentity(next, mergeIdx)
  }
  return next
}

/** Remove ecos inbound duplicados (foto/áudio recebidos) após rajadas do socket. */
function pruneRedundantIncomingClientMediaEchoes(list) {
  if (!Array.isArray(list) || list.length < 2) return list
  const remove = new Set()
  for (let i = 0; i < list.length; i++) {
    if (remove.has(i)) continue
    for (let j = i + 1; j < list.length; j++) {
      if (remove.has(j)) continue
      const a = list[i]
      const b = list[j]
      if (!a || !b || isOutgoingLike(a) || isOutgoingLike(b)) continue
      if (!isIncomingClientMediaReconcilePair(a, b)) continue
      const scoreA = incomingClientMediaDedupeScore(a)
      const scoreB = incomingClientMediaDedupeScore(b)
      if (scoreA > scoreB) remove.add(j)
      else if (scoreB > scoreA) remove.add(i)
      else remove.add(Math.max(i, j))
    }
  }
  if (!remove.size) return list
  return list.filter((_, idx) => !remove.has(idx))
}

function automatedTextEchoScore(m) {
  let score = 0
  if (hasAutomationHint(m)) score += 8
  if (m?.whatsapp_id != null && String(m.whatsapp_id).trim() !== "") score += 4
  if (m?.id != null && String(m.id).trim() !== "") score += 2
  const order = { pending: 0, sent: 1, delivered: 2, read: 3, played: 4 }
  score += order[String(m?.status_mensagem || m?.status || "").toLowerCase()] ?? 0
  const seq = Number(m?._stableInsertSeq)
  if (Number.isFinite(seq)) score -= seq / 1e15
  return score
}

function pruneRedundantAutomatedTextEchoes(list) {
  if (!Array.isArray(list) || list.length < 2) return list
  const remove = new Set()
  for (let i = 0; i < list.length; i++) {
    if (remove.has(i)) continue
    for (let j = i + 1; j < list.length; j++) {
      if (remove.has(j)) continue
      const a = list[i]
      const b = list[j]
      if (!isLikelyDuplicateAutomatedTextEcho(a, b)) continue
      const scoreA = automatedTextEchoScore(a)
      const scoreB = automatedTextEchoScore(b)
      if (scoreA > scoreB) remove.add(j)
      else if (scoreB > scoreA) remove.add(i)
      else remove.add(j)
    }
  }
  if (!remove.size) return list
  return list.filter((_, idx) => !remove.has(idx))
}

function dedupeRowsByPersistedIdentity(list, keepIdx) {
  const row = list[keepIdx]
  if (!row) return list
  const id = row.id != null && String(row.id).trim() !== "" ? String(row.id) : null
  const wa =
    row.whatsapp_id != null && String(row.whatsapp_id).trim() !== ""
      ? String(row.whatsapp_id)
      : null
  if (!id && !wa) return list
  
  const filtered = list.filter((m, i) => {
    if (i === keepIdx) return true

    if (id && m?.id != null && String(m.id) === id) {
      if (row.tempId && m.tempId && String(row.tempId) !== String(m.tempId)) return true
      const sameBubble = areLikelySameMessageBubble(row, m)
      if (!sameBubble) return true
      if (isDebugRuntime() && typeof window !== "undefined" && isAudioFamilyTipo(m?.tipo)) {
        console.log("[AUDIO_DEBUG] Removendo duplicata por ID", { keepIdx, i, id, m })
      }
      return false
    }
    if (wa && m?.whatsapp_id != null && String(m.whatsapp_id) === wa) {
      if (row.tempId && m.tempId && String(row.tempId) !== String(m.tempId)) return true
      const sameBubble = areLikelySameMessageBubble(row, m)
      if (!sameBubble) return true
      if (isDebugRuntime() && typeof window !== "undefined" && isAudioFamilyTipo(m?.tipo)) {
        console.log("[AUDIO_DEBUG] Removendo duplicata por whatsapp_id", { keepIdx, i, wa, m })
      }
      return false
    }
    return true
  })
  
  return filtered
}

function hasRenderableUrl(m) {
  if (!m) return false
  const u = m.url || m.url_absoluta
  return u != null && String(u).trim() !== ""
}

/**
 * Se a API devolver mensagem de mídia sem URL (link expirado, campo omitido, etc.),
 * mantém url/nome do que já estava no cliente — evita “sumir” foto/áudio após refresh ou merge.
 */
function preserveLocalMediaFields(prev, merged) {
  if (!merged) return merged
  if (!prev) return merged
  const tipo = String(merged.tipo || prev.tipo || "").toLowerCase().trim()
  if (!isMediaTipo(tipo)) return merged

  const next = { ...merged }
  if (!next.tipo || String(next.tipo).trim() === "") next.tipo = prev.tipo

  const mergedHasUrl = hasRenderableUrl(merged)
  const prevHasUrl = hasRenderableUrl(prev)
  const prevLocal = isLocalUploadMediaMessage(prev)
  const mergedLocal = isLocalUploadMediaMessage(merged)

  // URL do CRM (/uploads/) tem prioridade sobre eco WebSocket sem mídia ou CDN externo.
  if (prevLocal && (!mergedHasUrl || !mergedLocal)) {
    next.url = prev.url
    next.url_absoluta = prev.url_absoluta ?? prev.url
  } else if (!mergedHasUrl && prevHasUrl) {
    next.url = prev.url
    next.url_absoluta = prev.url_absoluta ?? prev.url
  }

  if (prev.nome_arquivo && !next.nome_arquivo) next.nome_arquivo = prev.nome_arquivo
  if (prev.thumbnail_url && !next.thumbnail_url) next.thumbnail_url = prev.thumbnail_url
  if (prev.tamanho != null && next.tamanho == null) next.tamanho = prev.tamanho
  if (prev.file_last_modified != null && next.file_last_modified == null) {
    next.file_last_modified = prev.file_last_modified
  }

  const prevBlob = prev?._optimisticBlobUrl
  const prevBlobUrl =
    prevBlob && String(prevBlob).startsWith("blob:")
      ? prevBlob
      : String(prev?.url || "").startsWith("blob:")
        ? prev.url
        : null
  if (prevBlobUrl) {
    next._optimisticBlobUrl = prevBlobUrl
    // Mantém áudio ouvível no blob até haver /uploads confiável no servidor (evita URL de produção quebrada em dev).
    if (!isLocalUploadMediaMessage(merged) || !mergedHasUrl) {
      next.url = prevBlobUrl
      next.url_absoluta = prevBlobUrl
    }
  }

  return next
}

/** Evita que `criado_em` do servidor (às vezes mais antigo que o relógio local) empurre a bolha para cima na ordenação. */
function pickLaterCriadoEmIso(existing, incoming) {
  const te = toMillis(existing?.criado_em)
  const ti = toMillis(incoming?.criado_em)
  if (!Number.isFinite(te)) return incoming?.criado_em ?? existing?.criado_em
  if (!Number.isFinite(ti)) return existing?.criado_em ?? incoming?.criado_em
  return new Date(Math.max(te, ti)).toISOString()
}

function hasRuntimeLocalOrder(msg) {
  if (!msg) return false
  if (msg.tempId || msg.client_temp_id || msg.clientTempId) return true
  const seq = Number(msg._stableInsertSeq)
  return Number.isFinite(seq) && seq >= RUNTIME_INSERT_SEQ_BASE
}

/** Mantém a âncora visual local em rajadas outbound enquanto socket/API reconciliam fora de ordem. */
function pickOutgoingMergedCriadoEmIso(existing, incoming) {
  if (hasRuntimeLocalOrder(existing) && existing?.criado_em) return existing.criado_em
  return pickLaterCriadoEmIso(existing, incoming)
}

/** Ordem cronológica estável (evita “sumir” / saltos quando timestamps coincidem). */
function sortMensagensChronological(arr) {
  return [...(arr || [])].sort((a, b) => {
    const seqa = Number(a?._stableInsertSeq)
    const seqb = Number(b?._stableInsertSeq)
    // Mensagens que entraram ao vivo nesta sessão (otimistas + recebidas) carregam uma
    // sequência de chegada global monotônica (>= RUNTIME_INSERT_SEQ_BASE). Para elas, a ordem
    // de chegada no cliente é a verdade — imune a clock skew entre relógio local (bolha enviada)
    // e relógio do servidor (recebida), que embaralhava a posição. O `criado_em` só governa o
    // histórico vindo da API (seq pequeno de índice de lote).
    const bothRuntime =
      Number.isFinite(seqa) && seqa >= RUNTIME_INSERT_SEQ_BASE &&
      Number.isFinite(seqb) && seqb >= RUNTIME_INSERT_SEQ_BASE
    if (bothRuntime && seqa !== seqb) return seqa - seqb
    const ta = toMillis(a?.criado_em) || 0
    const tb = toMillis(b?.criado_em) || 0
    if (ta !== tb) return ta - tb
    if (Number.isFinite(seqa) && Number.isFinite(seqb) && seqa !== seqb) return seqa - seqb
    const ida = Number(a?.id)
    const idb = Number(b?.id)
    if (Number.isFinite(ida) && Number.isFinite(idb) && ida !== idb) return ida - idb
    const sid = String(a?.id ?? "").localeCompare(String(b?.id ?? ""))
    if (sid !== 0) return sid
    const wa = String(a?.whatsapp_id || "").localeCompare(String(b?.whatsapp_id || ""))
    if (wa !== 0) return wa
    const tt = String(a?.tempId || "").localeCompare(String(b?.tempId || ""))
    if (tt !== 0) return tt
    const fn = String(a?.nome_arquivo || "").localeCompare(String(b?.nome_arquivo || ""))
    if (fn !== 0) return fn
    const ur = String(a?.url || a?.url_absoluta || "").localeCompare(String(b?.url || b?.url_absoluta || ""))
    if (ur !== 0) return ur
    const conv = String(a?.conversa_id ?? b?.conversa_id ?? "")
    return stableSyntheticMessageKey(a, conv).localeCompare(stableSyntheticMessageKey(b, conv))
  })
}

/** Incorpora uma mensagem na lista (sem ordenar). Usado em lote pelo flush de `anexarMensagem`. */
function applyAnexarOneToList(list, convId, msg) {
  msg = normalizeMsgForStore(msg)
  if (!msg || !convId) return list
  if (msg.conversa_id == null || String(msg.conversa_id) !== String(convId)) return list
  const belongsToConv = (m) => m?.conversa_id != null && String(m.conversa_id) === String(convId)
  const hasMultiplePendingStickerImageFamily = (incoming) => hasAmbiguousPendingStickerImageMerge(list, incoming)

  const findExisting = () => {
    if (msg.tempId) {
      const byTemp = list.findIndex(
        (m) =>
          m?.conversa_id != null &&
          String(m.conversa_id) === String(convId) &&
          String(m.tempId) === String(msg.tempId)
      )
      if (byTemp >= 0) return byTemp
    }
    const clientTempId = resolveClientTempId(msg)
    if (clientTempId) {
      const byClient = list.findIndex(
        (m) =>
          m?.conversa_id != null &&
          String(m.conversa_id) === String(convId) &&
          m?.tempId &&
          String(m.tempId) === clientTempId
      )
      if (byClient >= 0) return byClient
    }
    if (msg.id != null && String(msg.id).trim() !== "") {
      const ambiguousPendingMedia = hasMultiplePendingStickerImageFamily(msg)
      const byId = list.findIndex((m) =>
        belongsToConv(m) &&
        !(ambiguousPendingMedia && isPendingOutgoingTemp(m) && mediaFamilyFromMsg(m) === mediaFamilyFromMsg(msg)) &&
        shouldMergeExistingMessages(m, msg)
      )
      if (byId >= 0) return byId
    }
    const waId = msg.whatsapp_id || null
    if (waId && convId) {
      const byWa = list.findIndex(
        (m) =>
          m.conversa_id != null &&
          String(m.conversa_id) === String(convId) &&
          String(m.whatsapp_id || "") === String(waId) &&
          shouldMergeExistingMessages(m, msg)
      )
      if (byWa >= 0) return byWa
    }
    return -1
  }

  const existingIdx = findExisting()
  if (existingIdx >= 0) {
    const existing = list[existingIdx]
    const merged = preserveLocalMediaFields(existing, { ...existing, ...msg })
    if (convId) merged.conversa_id = convId
    if (msg.id && !existing.id) merged.id = msg.id
    if (msg.whatsapp_id && !existing.whatsapp_id) merged.whatsapp_id = msg.whatsapp_id
    if (msg.status != null) merged.status = msg.status
    if (msg.status_mensagem != null) merged.status_mensagem = msg.status_mensagem
    if (isOutgoingLike(existing) && isOutgoingLike(msg)) {
      merged.criado_em = pickOutgoingMergedCriadoEmIso(existing, msg)
    }
    merged._stableInsertSeq = mergeStableSeq(existing, msg, null)
    const next = [...list]
    next[existingIdx] = finalizeMergedMessageRow(existing, merged)
    return next
  }

  const isFromMe = isOutgoingLike(msg)
  const textoIn = (msg.texto || msg.conteudo || "").toString().trim()
  const recentMs = 90_000
  const now = Date.now()

  if (isFromMe && mediaFamilyFromMsg(msg) && hasPersistedMessageIdentity(msg)) {
    const ambiguousPendingStickerImage = hasMultiplePendingStickerImageFamily(msg)
    const mergePendingMediaAt = (i) => {
      const m = list[i]
      const merged = preserveLocalMediaFields(m, { ...m, ...msg, conversa_id: convId })
      if (msg.id) merged.id = msg.id
      if (msg.whatsapp_id) merged.whatsapp_id = msg.whatsapp_id
      if (msg.status != null) merged.status = msg.status
      if (msg.status_mensagem != null) merged.status_mensagem = msg.status_mensagem
      merged.criado_em = pickOutgoingMergedCriadoEmIso(m, msg)
      merged._stableInsertSeq = mergeStableSeq(m, msg, null)
      const next = [...list]
      next[i] = finalizeMergedMessageRow(m, merged)
      return dedupeRowsByPersistedIdentity(next, i)
    }

    let mergeIdx = findPendingOutgoingMediaMergeIndex(list, msg)
    if (mergeIdx < 0 && !ambiguousPendingStickerImage) {
      mergeIdx = findPendingOutgoingMediaMergeIndex(list, msg, { allowLoose: true })
    }
    if (mergeIdx >= 0 && belongsToConv(list[mergeIdx])) return mergePendingMediaAt(mergeIdx)
  }

  if (!isFromMe && isIncomingClientMediaFamily(mediaFamilyFromMsg(msg))) {
    const inIdx = findIncomingClientMediaMergeIndex(list, msg)
    if (inIdx >= 0 && belongsToConv(list[inIdx])) return mergeIncomingClientMediaAtIndex(list, convId, inIdx, msg)
  }

  if (isFromMe && textoIn && isTipoTextoParaReconciliarPorConteudo(msg)) {
    const clientTempIdEarly = resolveClientTempId(msg)
    if (clientTempIdEarly) {
      const byClientOnly = list.findIndex(
        (m) => belongsToConv(m) && m?.tempId && String(m.tempId) === clientTempIdEarly && isPendingOutgoingTemp(m)
      )
      if (byClientOnly >= 0) {
        const existing = list[byClientOnly]
        const merged = preserveLocalMediaFields(existing, { ...existing, ...msg, conversa_id: convId })
        if (msg.id) merged.id = msg.id
        if (msg.whatsapp_id) merged.whatsapp_id = msg.whatsapp_id
        if (msg.status != null) merged.status = msg.status
        if (msg.status_mensagem != null) merged.status_mensagem = msg.status_mensagem
        merged.criado_em = pickOutgoingMergedCriadoEmIso(existing, msg)
        merged._stableInsertSeq = mergeStableSeq(existing, msg, null)
        const next = [...list]
        next[byClientOnly] = finalizeMergedMessageRow(existing, merged)
        return next
      }
    }

    // msg.tempId só existe em mensagens otimistas recém-criadas localmente (nunca em eco de
    // socket/API). Se já chega com tempId próprio e não casou acima por client_temp_id, é um
    // envio novo e distinto — não pode ser fundido por texto com outro otimista pendente igual
    // (ex.: usuário manda "ok" duas vezes em sequência), senão a 2ª bolha "desaparece" da tela.
    const candidates = []
    if (!msg.tempId) {
      for (let i = 0; i < list.length; i++) {
        const m = list[i]
        if (!belongsToConv(m)) continue
        if (!isPendingOutgoingTemp(m)) continue
        if (!isTipoTextoParaReconciliarPorConteudo(m)) continue
        const ts = toMillis(m?.criado_em)
        if (!Number.isFinite(ts) || now - ts >= recentMs) continue
        const textoMatch = (m.texto || m.conteudo || "").toString().trim() === textoIn
        if (!textoMatch) continue
        candidates.push({ i, ts, seq: Number.isFinite(Number(m._stableInsertSeq)) ? Number(m._stableInsertSeq) : Infinity })
      }
    }
    let replaceIdx = -1
    if (candidates.length === 1) {
      replaceIdx = candidates[0].i
    } else if (candidates.length > 1) {
      // Sem client_temp_id não há identidade forte para textos repetidos.
      // Usar timestamp do servidor embaralha rajadas iguais; FIFO preserva a ordem local.
      let best = candidates[0]
      for (const c of candidates) {
        if (c.seq < best.seq || (c.seq === best.seq && c.i < best.i)) best = c
      }
      replaceIdx = best.i
    }
    if (replaceIdx >= 0) {
      const existing = list[replaceIdx]
      const merged = preserveLocalMediaFields(existing, { ...existing, ...msg, conversa_id: convId })
      if (msg.id) merged.id = msg.id
      if (msg.whatsapp_id) merged.whatsapp_id = msg.whatsapp_id
      if (msg.status != null) merged.status = msg.status
      if (msg.status_mensagem != null) merged.status_mensagem = msg.status_mensagem
      merged.criado_em = pickOutgoingMergedCriadoEmIso(existing, msg)
      merged._stableInsertSeq = mergeStableSeq(existing, msg, null)
      const next = [...list]
      next[replaceIdx] = finalizeMergedMessageRow(existing, merged)
      return next
    }
  }

  const textoParaCenarioId = (msg.texto || msg.conteudo || "").toString().trim()
  if (msg.id && isFromMe && textoParaCenarioId && isTipoTextoParaReconciliarPorConteudo(msg)) {
    const recentMsC3 = 90_000
    const nowC3 = Date.now()
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i]
      if (!belongsToConv(m)) continue
      if (!isOutgoingLike(m)) continue
      if (m?.tempId) continue
      const ts = toMillis(m?.criado_em)
      if (!Number.isFinite(ts) || nowC3 - ts > recentMsC3) continue
      const textoMatch = (m.texto || m.conteudo || "").toString().trim() === textoParaCenarioId
      if (m.whatsapp_id && !m.id && textoMatch) {
        const merged = preserveLocalMediaFields(m, { ...m, ...msg, conversa_id: convId })
        if (isOutgoingLike(m) && isOutgoingLike(msg)) merged.criado_em = pickOutgoingMergedCriadoEmIso(m, msg)
        const order = { pending: 0, sent: 1, delivered: 2, read: 3, played: 4 }
        const mVal = order[String(m?.status_mensagem || m?.status || "").toLowerCase()] ?? 0
        const msgVal = order[String(msg?.status_mensagem || msg?.status || "").toLowerCase()] ?? 0
        if (mVal > msgVal) {
          merged.status = m.status
          merged.status_mensagem = m.status_mensagem
        }
        merged._stableInsertSeq = mergeStableSeq(m, msg, null)
        const next = [...list]
        next[i] = finalizeMergedMessageRow(m, merged)
        return next
      }
    }
  }

  const newMsg = normalizeMsgForStore({ ...msg })
  if (convId) newMsg.conversa_id = convId
  const semChavePersistida =
    (newMsg.id == null || String(newMsg.id).trim() === "") &&
    (newMsg.whatsapp_id == null || String(newMsg.whatsapp_id).trim() === "") &&
    (newMsg.tempId == null || String(newMsg.tempId).trim() === "")
  if (semChavePersistida && !Number.isFinite(Number(newMsg._stableInsertSeq))) {
    newMsg._stableInsertSeq = allocStableInsertSeq()
  }
  const newK = mapDedupeKey(newMsg, convId)
  const candNew = stripTempIdWhenPersisted(newMsg)

  const dupIdx = list.findIndex((m) => belongsToConv(m) && mapDedupeKey(m, convId) === newK)
  if (dupIdx >= 0) {
    const prevRow = list[dupIdx]
    if (canMergeDedupeEntries(prevRow, candNew)) {
      let mergedNew = preserveLocalMediaFields(
        prevRow,
        mergeMsgPreferringTombstone(prevRow, { ...prevRow, ...candNew })
      )
      if (isOutgoingLike(prevRow) && isOutgoingLike(candNew)) {
        mergedNew.criado_em = pickOutgoingMergedCriadoEmIso(prevRow, candNew)
      }
      mergedNew._stableInsertSeq = mergeStableSeq(prevRow, candNew, null)
      const next = [...list]
      next[dupIdx] = finalizeMergedMessageRow(prevRow, mergedNew)
      return next
    }
  }

  const findAudioCrossMergeIndex = () =>
    list.findIndex((m, i) => {
      if (!belongsToConv(m)) return false
      if (i === dupIdx || !areLikelySameMessageBubble(m, candNew)) return false
      if (matchesClientTempCorrelation(m, candNew)) return true
      const pid = m?.id != null && String(m.id).trim() !== "" ? String(m.id) : null
      const iid = candNew?.id != null && String(candNew.id).trim() !== "" ? String(candNew.id) : null
      if (pid && iid && pid === iid) return persistedIdentityMarksSameBubble(m, candNew)
      const pwa = m?.whatsapp_id != null && String(m.whatsapp_id).trim() !== "" ? String(m.whatsapp_id) : null
      const iwa =
        candNew?.whatsapp_id != null && String(candNew.whatsapp_id).trim() !== ""
          ? String(candNew.whatsapp_id)
          : null
      if (pwa && iwa && pwa === iwa) return persistedIdentityMarksSameBubble(m, candNew)
      const prevPersist = hasPersistedMessageIdentity(m)
      const incPersist = hasPersistedMessageIdentity(candNew)
      if (prevPersist && incPersist) return false
      if (prevPersist || incPersist) return isOutgoingAudioReconcilePair(m, candNew)
      return false
    })

  const ambiguousPendingStickerImageCross = hasMultiplePendingStickerImageFamily(candNew)
  const crossIdx =
    isOutgoingLike(candNew) && mediaFamilyFromMsg(candNew) === "audio"
      ? findAudioCrossMergeIndex()
      : !isOutgoingLike(candNew) && isIncomingClientMediaFamily(mediaFamilyFromMsg(candNew))
        ? findIncomingClientMediaMergeIndex(list, candNew)
        : list.findIndex((m, i) => {
          if (!belongsToConv(m)) return false
          if (i === dupIdx) return false
          if (matchesClientTempCorrelation(m, candNew)) return true
          const pid = m?.id != null && String(m.id).trim() !== "" ? String(m.id) : null
          const iid = candNew?.id != null && String(candNew.id).trim() !== "" ? String(candNew.id) : null
          if (pid && iid && pid === iid) return persistedIdentityMarksSameBubble(m, candNew)
          const pwa = m?.whatsapp_id != null && String(m.whatsapp_id).trim() !== "" ? String(m.whatsapp_id) : null
          const iwa =
            candNew?.whatsapp_id != null && String(candNew.whatsapp_id).trim() !== ""
              ? String(candNew.whatsapp_id)
              : null
          if (pwa && iwa && pwa === iwa) return persistedIdentityMarksSameBubble(m, candNew)
          if (isTipoTextoParaReconciliarPorConteudo(m) && isTipoTextoParaReconciliarPorConteudo(candNew)) {
            return false
          }
          if (
            ambiguousPendingStickerImageCross &&
            isPendingOutgoingTemp(m) &&
            isStickerOrImageOutboundTipo(m) &&
            mediaFamilyFromMsg(m) === mediaFamilyFromMsg(candNew)
          ) {
            return false
          }
          return areLikelySameMessageBubble(m, candNew)
        })
  if (crossIdx >= 0) {
    const prevRow = list[crossIdx]
    let mergedNew = preserveLocalMediaFields(
      prevRow,
      mergeMsgPreferringTombstone(prevRow, { ...prevRow, ...candNew })
    )
    if (isOutgoingLike(prevRow) && isOutgoingLike(candNew)) {
      mergedNew.criado_em = pickOutgoingMergedCriadoEmIso(prevRow, candNew)
    }
    mergedNew._stableInsertSeq = mergeStableSeq(prevRow, candNew, null)
    const next = [...list]
    next[crossIdx] = finalizeMergedMessageRow(prevRow, mergedNew)
    if (hasPersistedMessageIdentity(mergedNew)) {
      return dedupeRowsByPersistedIdentity(next, crossIdx)
    }
    return next
  }

  const appended = { ...candNew, _stableInsertSeq: mergeStableSeq(null, candNew, null) }
  let next = [...list, stripTempIdWhenPersisted(appended)]
  if (isOutgoingLike(candNew) && hasPersistedMessageIdentity(candNew)) {
    next = dedupeRowsByPersistedIdentity(next, next.length - 1)
  }
  return next
}

function mergeDedupeRows(prev, incoming, ord) {
  const cand = prev ? { ...prev, ...incoming } : incoming
  let merged = preserveLocalMediaFields(prev, mergeMsgPreferringTombstone(prev, cand))
  if (prev && isOutgoingLike(prev) && isOutgoingLike(incoming)) {
    merged.criado_em = pickOutgoingMergedCriadoEmIso(prev, incoming)
  }
  merged._stableInsertSeq = mergeStableSeq(prev || null, incoming, ord)
  merged = clearStaleOutboundWaitFlags(merged)
  return prev ? finalizeMergedMessageRow(prev, merged) : stripTempIdWhenPersisted(merged)
}

function putMensagemInDedupeMap(map, raw, conversaId, ord) {
  if (!raw) return
  const copy = normalizeMsgForStore({ ...raw, conversa_id: conversaId })
  const k = mapDedupeKey(copy, conversaId)
  const prev = map.get(k)

  if (prev && !canMergeDedupeEntries(prev, copy)) {
    const altKey = findMergeableMapKey(map, copy)
    if (altKey) {
      map.set(altKey, mergeDedupeRows(map.get(altKey), copy, ord))
      return
    }
    let altK = `${k}::__split_${ord}`
    let n = 0
    while (map.has(altK) && n < 500) altK = `${k}::__split_${ord}_${++n}`
    map.set(altK, mergeMsgPreferringTombstone(null, { ...copy, _stableInsertSeq: mergeStableSeq(null, copy, ord) }))
    return
  }

  if (!prev) {
    const altKey = findMergeableMapKey(map, copy)
    if (altKey) {
      map.set(altKey, mergeDedupeRows(map.get(altKey), copy, ord))
      return
    }
  }

  map.set(k, mergeDedupeRows(prev || null, copy, ord))
}

export function mergeMessageIntoListForTest(list, convId, msg) {
  const next = applyAnexarOneToList(Array.isArray(list) ? [...list] : [], convId, msg)
  return finalizeMensagensList(next)
}

export {
  stableSyntheticMessageKey,
  mapDedupeKey,
  getMessageListReactKey,
  allocStableInsertSeq,
  isPendingOutgoingTemp,
  clearStaleOutboundWaitFlags,
  normalizeMsgForStore,
  applyAnexarOneToList,
  finalizeMensagensList,
  putMensagemInDedupeMap,
  sortMensagensChronological,
  preserveLocalMediaFields,
  mergeMsgPreferringTombstone,
  mergeStableSeq,
  dedupeRowsByPersistedIdentity,
  finalizeMergedMessageRow,
  hasRenderableUrl,
  isOutgoingLike,
  toMillis,
  stripTempIdWhenPersisted,
  shouldMergeExistingMessages,
  stripPersistedIdIfConflictsWithList,
}
