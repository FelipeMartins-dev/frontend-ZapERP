/**
 * Helper: detecta se a conversa é de grupo.
 * Regras: remoteJid termina com "@g.us", ou isGroup === true, ou tipo === "grupo".
 *
 * @param {object} conversa - Objeto conversa (pode ter telefone, remoteJid, tipo, is_group)
 * @returns {boolean}
 */
export function isGroupConversation(conversa) {
  if (!conversa) return false
  const jid = conversa.remoteJid ?? conversa.telefone ?? conversa.phone ?? ''
  if (String(jid).endsWith('@g.us')) return true
  if (conversa.is_group === true || conversa.isGroup === true) return true
  const tipo = String(conversa.tipo || '').toLowerCase()
  if (tipo === 'grupo' || tipo === 'group') return true
  return false
}

/**
 * Status efetivo para UI e regras: no detalhe a API pode expor `status_atendimento_real` como fonte de verdade.
 * Na listagem costuma vir `status_atendimento` alinhado ao backend.
 * @param {object} [conversa]
 * @returns {string} valor normalizado (snake_case lower)
 */
export function getStatusAtendimentoEffective(conversa) {
  if (!conversa || typeof conversa !== 'object') return ''
  const raw = conversa.status_atendimento_real ?? conversa.status_atendimento
  return raw != null ? String(raw).toLowerCase().trim().replace(/\s+/g, '_') : ''
}

/** Modo manual: não inferir por `aguardando_cliente_desde` (job automático em em_atendimento). */
export function isAguardandoClienteManual(conversa) {
  return getStatusAtendimentoEffective(conversa) === 'aguardando_cliente'
}

/** Detecta texto bruto de vCard em mensagens WhatsApp (às vezes sem `tipo: contact`). */
export function isVCardText(text) {
  if (!text || typeof text !== 'string') return false
  return text.includes('BEGIN:VCARD')
}

/** Primeiros dígitos de uma linha TEL de vCard (prioriza linha com mais dígitos). */
export function parseVCardTelefone(text) {
  if (!text || typeof text !== 'string') return null
  const re = /^[^\S\r\n]*(?:item\d+\.|ITEM\d+\.)?TEL[^:]*:(.+)$/gim
  let best = null
  let bestLen = 0
  let m
  while ((m = re.exec(text)) !== null) {
    let v = String(m[1] || '').trim()
    v = v.replace(/^tel:/i, '').replace(/^waid\//i, '').trim()
    const digits = v.replace(/\D/g, '')
    if (digits.length >= 8 && digits.length >= bestLen) {
      best = digits
      bestLen = digits.length
    }
  }
  return best
}

/**
 * Nome exibível: FN: ou N: (vCard 3.x — Family;Given;Additional…).
 */
export function parseVCardDisplayName(text) {
  if (!text || typeof text !== 'string') return null
  const fnMatch = text.match(/^FN:(.+)$/im)
  if (fnMatch) {
    const fn = fnMatch[1].trim().replace(/\\,/g, ',').replace(/\\n/g, ' ').replace(/\\/g, '')
    if (fn && !fn.includes('BEGIN:VCARD')) return fn
  }
  const nMatch = text.match(/^N:([^\r\n]+)$/im)
  if (nMatch) {
    const parts = nMatch[1].split(';').map((s) => s.trim())
    const family = parts[0] || ''
    const given = parts[1] || ''
    if (given && family) return `${given} ${family}`
    if (given) return given
    if (family) return family
    if (parts.length > 2) {
      const rest = parts.slice(2).find((p) => p)
      if (rest) return rest
    }
  }
  return null
}

/** Metadados mínimos extraídos do vCard (para UI tipo WhatsApp). */
export function parseVCardMeta(text) {
  if (!isVCardText(text)) return null
  const nome = parseVCardDisplayName(text) || 'Contato'
  const telefone = parseVCardTelefone(text)
  return { nome, telefone }
}

function normalizeDigitsPhone(p) {
  if (p == null || p === '') return null
  const d = String(p).replace(/\D/g, '')
  return d || null
}

/**
 * Resolve nome/telefone/foto para cartão de contato ou preview.
 * Cobre `tipo: contact` com `contact_meta` e mensagens só com corpo vCard.
 * @param {object} msg
 * @returns {{ nome: string, telefone: string | null, foto_perfil: string | null } | null}
 */
export function resolveContactMetaFromMessage(msg) {
  if (!msg) return null
  const text = String(msg.texto ?? msg.conteudo ?? msg.body ?? '')
  const tipo = String(msg.tipo || '').toLowerCase()
  const rawMeta = msg.contact_meta && typeof msg.contact_meta === 'object' ? msg.contact_meta : null
  const vc = parseVCardMeta(text)
  const isVCardBody = isVCardText(text)

  if (tipo === 'contact') {
    if (!rawMeta && !vc && !isVCardBody) return null
    const nomeMeta = rawMeta?.nome != null ? String(rawMeta.nome).trim() : ''
    const nome = nomeMeta || vc?.nome || 'Contato'
    let telefone =
      normalizeDigitsPhone(rawMeta?.telefone) || normalizeDigitsPhone(rawMeta?.phone) || vc?.telefone || null
    const foto = rawMeta?.foto_perfil
    const fotoOk = foto && String(foto).trim().startsWith('http') ? String(foto).trim() : null
    return { nome, telefone, foto_perfil: fotoOk }
  }

  if (vc || isVCardBody) {
    const nome = vc?.nome || parseVCardDisplayName(text) || 'Contato'
    const telefone = vc?.telefone || parseVCardTelefone(text)
    return {
      nome,
      telefone: telefone || null,
      foto_perfil: null,
    }
  }

  return null
}
