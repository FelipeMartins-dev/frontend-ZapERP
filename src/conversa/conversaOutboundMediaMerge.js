/** Merge/dedupe de mensagens — módulo puro (sem React/socket) para store + testes. */
function cleanupOptimisticBlobFields(merged) { return merged }

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
  if (m?.id != null && String(m.id).trim() !== "") return `id-${String(m.id)}`
  if (m?.tempId != null && String(m.tempId).trim() !== "") return `temp-${String(m.tempId)}`
  const syn = stableSyntheticMessageKey(m, conversaId)
  const seq = Number(m?._stableInsertSeq)
  // Sem id/wa/temp, só o fingerprint sintético pode colidir (ex.: várias saídas no mesmo segundo).
  if (Number.isFinite(seq)) return `syn-${conv}-seq${seq}-${syn}`
  return syn
}

/** Duas linhas com o mesmo `mapDedupeKey` devem fundir só se forem a mesma mensagem lógica (UPSERT). */
function canMergeDedupeEntries(prev, incoming) {
  if (!prev || !incoming) return true
  if (prev.tempId && incoming.tempId && String(prev.tempId) === String(incoming.tempId)) return true
  const pid = prev.id != null && String(prev.id).trim() !== "" ? String(prev.id) : null
  const iid = incoming.id != null && String(incoming.id).trim() !== "" ? String(incoming.id) : null
  if (pid && iid) return pid === iid
  const pwa = prev.whatsapp_id != null && String(prev.whatsapp_id).trim() !== "" ? String(prev.whatsapp_id) : null
  const iwa = incoming.whatsapp_id != null && String(incoming.whatsapp_id).trim() !== "" ? String(incoming.whatsapp_id) : null
  if (pwa && iwa) return pwa === iwa
  if (iid && !pid) return true
  if (pid && !iid) return true
  if (iwa && !pwa) return true
  if (pwa && !iwa) return true
  return false
}

/** Mesma bolha lógica com chaves diferentes (ex.: otimista temp-* vs socket id-*). */
function areLikelySameMessageBubble(prev, incoming) {
  if (!prev || !incoming) return false
  if (prev.tempId && incoming.tempId && String(prev.tempId) === String(incoming.tempId)) return true
  const pwa = prev.whatsapp_id != null && String(prev.whatsapp_id).trim() !== "" ? String(prev.whatsapp_id) : null
  const iwa = incoming.whatsapp_id != null && String(incoming.whatsapp_id).trim() !== "" ? String(incoming.whatsapp_id) : null
  if (pwa && iwa && pwa === iwa) return true
  const pid = prev.id != null && String(prev.id).trim() !== "" ? String(prev.id) : null
  const iid = incoming.id != null && String(incoming.id).trim() !== "" ? String(incoming.id) : null
  if (pid && iid && pid === iid) return true
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
  if (tipoP && tipoP === tipoI && isMediaTipo(tipoP)) {
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
      const kept = bestById.get(id).m
      const sameAudioFamily =
        isAudioFamilyTipo(kept?.tipo) && isAudioFamilyTipo(m?.tipo)
      const distinctTempIds =
        m?.tempId &&
        kept?.tempId &&
        String(m.tempId) !== String(kept.tempId)
      const sameBubble = areLikelySameMessageBubble(kept, m)
      if (!(sameAudioFamily && distinctTempIds) && sameBubble) drop.add(idx)
    }
    if (wa && bestByWa.has(wa) && bestByWa.get(wa).idx !== idx) {
      const kept = bestByWa.get(wa).m
      const sameAudioFamily =
        isAudioFamilyTipo(kept?.tipo) && isAudioFamilyTipo(m?.tipo)
      const distinctTempIds =
        m?.tempId &&
        kept?.tempId &&
        String(m.tempId) !== String(kept.tempId)
      const sameBubble = areLikelySameMessageBubble(kept, m)
      if (!(sameAudioFamily && distinctTempIds) && sameBubble) drop.add(idx)
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
      break
    }
  }
  if (!remove.size) return list
  return list.filter((_, idx) => !remove.has(idx))
}

function finalizeMensagensList(list) {
  const beforePrune = list.length
  const afterTemps = pruneRedundantOutgoingTemps(list)
  const afterEchoes = pruneRedundantOutgoingMediaEchoes(afterTemps)
  const afterIdentityDedupe = dedupeListByPersistedIdentity(afterEchoes)
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
        removidos: list.filter(m => isAudioFamilyTipo(m?.tipo) && !final.some(f => f.tempId === m.tempId && f.id === m.id))
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
  let ms = toMillis(n.criado_em)
  if (!Number.isFinite(ms)) ms = toMillis(altTs)
  if (!Number.isFinite(ms) && typeof altTs === "number" && Number.isFinite(altTs)) ms = altTs
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
function finalizeMergedMessageRow(prev, merged) {
  let row = cleanupOptimisticBlobFields(mergeMsgPreferringTombstone(prev, merged))
  if (prev?.tempId) return { ...row, tempId: prev.tempId }
  return stripTempIdWhenPersisted(row)
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

/** Correlação explícita bolha otimista ↔ confirmação HTTP/socket. */
function matchesClientTempCorrelation(prev, incoming) {
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
      return true
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
    // Sem client_temp_id: exige file_last_modified — nome+tamanho sem LM é insuficiente para áudios.
    const hasLm =
      (prev?.file_last_modified != null && Number.isFinite(Number(prev.file_last_modified))) ||
      (incoming?.file_last_modified != null && Number.isFinite(Number(incoming.file_last_modified)))
    if (!hasLm) return false
    return sameMediaStrongHint(prev, incoming)
  }

  if (sameMediaStrongHint(prev, incoming)) return true
  if (matchesClientTempCorrelation(prev, incoming)) return true
  return opts.allowLoose === true
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
      const sameBubble = areLikelySameMessageBubble(row, m)
      if (!sameBubble) return true
      if (isDebugRuntime() && typeof window !== "undefined" && isAudioFamilyTipo(m?.tipo)) {
        console.log("[AUDIO_DEBUG] Removendo duplicata por ID", { keepIdx, i, id, m })
      }
      return false
    }
    if (wa && m?.whatsapp_id != null && String(m.whatsapp_id) === wa) {
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

/** Ordem cronológica estável (evita “sumir” / saltos quando timestamps coincidem). */
function sortMensagensChronological(arr) {
  return [...(arr || [])].sort((a, b) => {
    const ta = toMillis(a?.criado_em) || 0
    const tb = toMillis(b?.criado_em) || 0
    if (ta !== tb) return ta - tb
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
    const seqa = Number(a?._stableInsertSeq)
    const seqb = Number(b?._stableInsertSeq)
    if (Number.isFinite(seqa) && Number.isFinite(seqb) && seqa !== seqb) return seqa - seqb
    const conv = String(a?.conversa_id ?? b?.conversa_id ?? "")
    return stableSyntheticMessageKey(a, conv).localeCompare(stableSyntheticMessageKey(b, conv))
  })
}

/** Incorpora uma mensagem na lista (sem ordenar). Usado em lote pelo flush de `anexarMensagem`. */
function applyAnexarOneToList(list, convId, msg) {
  msg = normalizeMsgForStore(msg)
  if (!msg || !convId) return list

  const findExisting = () => {
    if (msg.id != null && String(msg.id).trim() !== "") {
      const byId = list.findIndex((m) => String(m.id) === String(msg.id))
      if (byId >= 0) return byId
    }
    const waId = msg.whatsapp_id || null
    if (waId && convId) {
      const byWa = list.findIndex(
        (m) =>
          (m.conversa_id == null || String(m.conversa_id) === String(convId)) &&
          String(m.whatsapp_id || "") === String(waId)
      )
      if (byWa >= 0) return byWa
    }
    if (msg.tempId) {
      const byTemp = list.findIndex((m) => String(m.tempId) === String(msg.tempId))
      if (byTemp >= 0) return byTemp
    }
    const clientTempId = resolveClientTempId(msg)
    if (clientTempId) {
      const byClient = list.findIndex((m) => m?.tempId && String(m.tempId) === clientTempId)
      if (byClient >= 0) return byClient
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
      merged.criado_em = pickLaterCriadoEmIso(existing, msg)
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
    const mergePendingMediaAt = (i) => {
      const m = list[i]
      const merged = preserveLocalMediaFields(m, { ...m, ...msg, conversa_id: convId })
      if (msg.id) merged.id = msg.id
      if (msg.whatsapp_id) merged.whatsapp_id = msg.whatsapp_id
      if (msg.status != null) merged.status = msg.status
      if (msg.status_mensagem != null) merged.status_mensagem = msg.status_mensagem
      merged.criado_em = pickLaterCriadoEmIso(m, msg)
      merged._stableInsertSeq = mergeStableSeq(m, msg, null)
      const next = [...list]
      next[i] = finalizeMergedMessageRow(m, merged)
      return dedupeRowsByPersistedIdentity(next, i)
    }

    let mergeIdx = findPendingOutgoingMediaMergeIndex(list, msg)
    if (mergeIdx < 0) {
      mergeIdx = findPendingOutgoingMediaMergeIndex(list, msg, { allowLoose: true })
    }
    if (mergeIdx >= 0) return mergePendingMediaAt(mergeIdx)
  }

  if (isFromMe && textoIn && isTipoTextoParaReconciliarPorConteudo(msg)) {
    const clientTempIdEarly = resolveClientTempId(msg)
    if (clientTempIdEarly) {
      const byClientOnly = list.findIndex(
        (m) => m?.tempId && String(m.tempId) === clientTempIdEarly && isPendingOutgoingTemp(m)
      )
      if (byClientOnly >= 0) {
        const existing = list[byClientOnly]
        const merged = preserveLocalMediaFields(existing, { ...existing, ...msg, conversa_id: convId })
        if (msg.id) merged.id = msg.id
        if (msg.whatsapp_id) merged.whatsapp_id = msg.whatsapp_id
        if (msg.status != null) merged.status = msg.status
        if (msg.status_mensagem != null) merged.status_mensagem = msg.status_mensagem
        merged.criado_em = pickLaterCriadoEmIso(existing, msg)
        merged._stableInsertSeq = mergeStableSeq(existing, msg, null)
        const next = [...list]
        next[byClientOnly] = finalizeMergedMessageRow(existing, merged)
        return next
      }
    }

    const candidates = []
    for (let i = 0; i < list.length; i++) {
      const m = list[i]
      if (!isPendingOutgoingTemp(m)) continue
      if (!isTipoTextoParaReconciliarPorConteudo(m)) continue
      const ts = toMillis(m?.criado_em)
      if (!Number.isFinite(ts) || now - ts >= recentMs) continue
      const textoMatch = (m.texto || m.conteudo || "").toString().trim() === textoIn
      if (!textoMatch) continue
      candidates.push({ i, ts, seq: Number.isFinite(Number(m._stableInsertSeq)) ? Number(m._stableInsertSeq) : Infinity })
    }
    let replaceIdx = -1
    if (candidates.length === 1) {
      replaceIdx = candidates[0].i
    } else if (candidates.length > 1) {
      const tsIn = toMillis(msg?.criado_em)
      if (Number.isFinite(tsIn)) {
        let bestDist = Infinity
        for (const c of candidates) {
          const dist = Math.abs(c.ts - tsIn)
          if (dist < bestDist || (dist === bestDist && c.seq < (candidates.find((x) => x.i === replaceIdx)?.seq ?? Infinity))) {
            bestDist = dist
            replaceIdx = c.i
          }
        }
      }
      if (replaceIdx < 0) {
        let best = candidates[0]
        for (const c of candidates) {
          if (c.seq < best.seq || (c.seq === best.seq && c.i < best.i)) best = c
        }
        replaceIdx = best.i
      }
    }
    if (replaceIdx >= 0) {
      const existing = list[replaceIdx]
      const merged = preserveLocalMediaFields(existing, { ...existing, ...msg, conversa_id: convId })
      if (msg.id) merged.id = msg.id
      if (msg.whatsapp_id) merged.whatsapp_id = msg.whatsapp_id
      if (msg.status != null) merged.status = msg.status
      if (msg.status_mensagem != null) merged.status_mensagem = msg.status_mensagem
      merged.criado_em = pickLaterCriadoEmIso(existing, msg)
      merged._stableInsertSeq = mergeStableSeq(existing, msg, null)
      const next = [...list]
      next[replaceIdx] = finalizeMergedMessageRow(existing, merged)
      return next
    }
  }

  const isFromMeAlt = isOutgoingLike(msg)
  const textoParaCenarioId = (msg.texto || msg.conteudo || "").toString().trim()
  if (msg.id && isFromMeAlt && textoParaCenarioId && isTipoTextoParaReconciliarPorConteudo(msg)) {
    const recentMsC3 = 90_000
    const nowC3 = Date.now()
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i]
      if (!isOutgoingLike(m)) continue
      if (m?.tempId) continue
      const ts = toMillis(m?.criado_em)
      if (!Number.isFinite(ts) || nowC3 - ts > recentMsC3) break
      const textoMatch = (m.texto || m.conteudo || "").toString().trim() === textoParaCenarioId
      if (m.whatsapp_id && !m.id && textoMatch) {
        const merged = preserveLocalMediaFields(m, { ...m, ...msg, conversa_id: convId })
        if (isOutgoingLike(m) && isOutgoingLike(msg)) merged.criado_em = pickLaterCriadoEmIso(m, msg)
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

  const dupIdx = list.findIndex((m) => mapDedupeKey(m, convId) === newK)
  if (dupIdx >= 0) {
    const prevRow = list[dupIdx]
    if (canMergeDedupeEntries(prevRow, candNew)) {
      let mergedNew = preserveLocalMediaFields(
        prevRow,
        mergeMsgPreferringTombstone(prevRow, { ...prevRow, ...candNew })
      )
      if (isOutgoingLike(prevRow) && isOutgoingLike(candNew)) {
        mergedNew.criado_em = pickLaterCriadoEmIso(prevRow, candNew)
      }
      mergedNew._stableInsertSeq = mergeStableSeq(prevRow, candNew, null)
      const next = [...list]
      next[dupIdx] = finalizeMergedMessageRow(prevRow, mergedNew)
      return next
    }
  }

  const findAudioCrossMergeIndex = () =>
    list.findIndex((m, i) => {
      if (i === dupIdx || !areLikelySameMessageBubble(m, candNew)) return false
      if (matchesClientTempCorrelation(m, candNew)) return true
      const pid = m?.id != null && String(m.id).trim() !== "" ? String(m.id) : null
      const iid = candNew?.id != null && String(candNew.id).trim() !== "" ? String(candNew.id) : null
      if (pid && iid && pid === iid) return true
      const pwa = m?.whatsapp_id != null && String(m.whatsapp_id).trim() !== "" ? String(m.whatsapp_id) : null
      const iwa =
        candNew?.whatsapp_id != null && String(candNew.whatsapp_id).trim() !== ""
          ? String(candNew.whatsapp_id)
          : null
      if (pwa && iwa && pwa === iwa) return true
      const prevPersist = hasPersistedMessageIdentity(m)
      const incPersist = hasPersistedMessageIdentity(candNew)
      if (prevPersist && incPersist) return false
      if (prevPersist || incPersist) return isOutgoingAudioReconcilePair(m, candNew)
      return false
    })

  const crossIdx =
    isOutgoingLike(candNew) && mediaFamilyFromMsg(candNew) === "audio"
      ? findAudioCrossMergeIndex()
      : list.findIndex((m, i) => {
          if (i === dupIdx) return false
          if (matchesClientTempCorrelation(m, candNew)) return true
          const pid = m?.id != null && String(m.id).trim() !== "" ? String(m.id) : null
          const iid = candNew?.id != null && String(candNew.id).trim() !== "" ? String(candNew.id) : null
          if (pid && iid && pid === iid) return true
          const pwa = m?.whatsapp_id != null && String(m.whatsapp_id).trim() !== "" ? String(m.whatsapp_id) : null
          const iwa =
            candNew?.whatsapp_id != null && String(candNew.whatsapp_id).trim() !== ""
              ? String(candNew.whatsapp_id)
              : null
          if (pwa && iwa && pwa === iwa) return true
          if (isTipoTextoParaReconciliarPorConteudo(m) && isTipoTextoParaReconciliarPorConteudo(candNew)) {
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
      mergedNew.criado_em = pickLaterCriadoEmIso(prevRow, candNew)
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
    merged.criado_em = pickLaterCriadoEmIso(prev, incoming)
  }
  merged._stableInsertSeq = mergeStableSeq(prev || null, incoming, ord)
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
  isPendingOutgoingTemp,
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
}