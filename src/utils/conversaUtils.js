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
  const raw = conversa.status_atendimento_real ?? conversa.status_real ?? conversa.status_atendimento
  return raw != null ? String(raw).toLowerCase().trim().replace(/\s+/g, '_') : ''
}

export function isClosedAttendanceStatus(status) {
  const s = status != null ? String(status).toLowerCase().trim().replace(/\s+/g, '_') : ''
  return s === 'fechada' || s === 'encerrada' || s === 'finalizada' || s === 'finalizado'
}

export function isClosedAttendance(conversa) {
  return isClosedAttendanceStatus(getStatusAtendimentoEffective(conversa))
}

/** Modo manual: não inferir por `aguardando_cliente_desde` (job automático em em_atendimento). */
export function isAguardandoClienteManual(conversa) {
  return getStatusAtendimentoEffective(conversa) === 'aguardando_cliente'
}

/** Financeiro: cobrança enviada, prazo em andamento. */
export function isPagamentoPendente(conversa) {
  return getStatusAtendimentoEffective(conversa) === 'pagamento_pendente'
}

/** Financeiro: prazo de pagamento vencido. */
export function isEmAtrasoPagamento(conversa) {
  return getStatusAtendimentoEffective(conversa) === 'em_atraso'
}

export function isCobrancaFinanceiraStatus(conversa) {
  const s = getStatusAtendimentoEffective(conversa)
  return s === 'pagamento_pendente' || s === 'em_atraso'
}

/** Badge discreto após confirmar pagamento (em atendimento ou aguardando cliente; some ao encerrar). */
export function exibirBadgePagamentoConcluido(conversa) {
  if (!conversa) return false
  const s = getStatusAtendimentoEffective(conversa)
  if (s !== 'em_atendimento' && s !== 'aguardando_cliente') return false
  const em = conversa.pagamento_concluido_em
  return em != null && String(em).trim() !== ''
}

/** Empresa com módulo "Modo simples de atendimento" ativo (controle por última mensagem). */
export function isEmpresaModoSimplesAtivo(source) {
  if (!source || typeof source !== 'object') return false
  return source.atendimento_modo_simples === true
}

/** Conversa ou utilizador indica modo simples ligado. */
export function isConversaModoSimplesAtiva(conversa, user) {
  return isEmpresaModoSimplesAtivo(conversa) || isEmpresaModoSimplesAtivo(user)
}

export function getModoSimplesAguardando(conversa) {
  const raw = conversa?.modo_simples_aguardando
  return raw != null ? String(raw).toLowerCase().trim() : ''
}

function normalizeMessageDirection(v) {
  const d = String(v || '').toLowerCase().trim()
  if (!d) return ''
  if (d === 'inbound' || d === 'recebida' || d === 'entrada') return 'in'
  if (d === 'outbound' || d === 'enviada' || d === 'saida') return 'out'
  return d
}

function pickUltimaMensagemDirecao(conversa) {
  if (!conversa || typeof conversa !== 'object') return ''
  const candidates = []
  const push = (dir, criadoEm) => {
    const d = normalizeMessageDirection(dir)
    if (!d) return
    const t = new Date(criadoEm || 0).getTime()
    candidates.push({ dir: d, ts: Number.isFinite(t) ? t : 0 })
  }
  push(conversa?.ultima_mensagem_preview?.direcao, conversa?.ultima_mensagem_preview?.criado_em)
  push(conversa?.ultima_mensagem?.direcao, conversa?.ultima_mensagem?.criado_em)
  const list = Array.isArray(conversa.mensagens) ? conversa.mensagens : []
  if (list.length > 0) {
    push(list[0]?.direcao, list[0]?.criado_em)
    push(list[list.length - 1]?.direcao, list[list.length - 1]?.criado_em)
  }
  if (!candidates.length) return ''
  let best = candidates[0]
  for (let i = 1; i < candidates.length; i++) {
    if (candidates[i].ts >= best.ts) best = candidates[i]
  }
  return best.dir
}

/** Mescla lista + detalhe + histórico carregado para regras de UI do modo simples. */
export function buildConversaModoSimplesUiSource(conversa, fromChat, mensagens) {
  const merged = { ...(fromChat && typeof fromChat === 'object' ? fromChat : {}), ...(conversa && typeof conversa === 'object' ? conversa : {}) }
  if (Array.isArray(mensagens) && mensagens.length > 0) {
    merged.mensagens = mensagens
  }
  return merged
}

/** Fallback pela preview/última mensagem quando o socket ainda não trouxe modo_simples_aguardando. */
export function inferModoSimplesAguardandoFromPreview(conversa) {
  if (!conversa || typeof conversa !== 'object') return ''
  const candidates = [
    conversa?.ultima_mensagem_preview?.direcao,
    conversa?.ultima_mensagem?.direcao,
    pickUltimaMensagemDirecao(conversa),
  ]
  for (const raw of candidates) {
    const dir = normalizeMessageDirection(raw)
    if (dir === 'in') return 'atendente'
    if (dir === 'out') return 'cliente'
  }
  return ''
}

/** Valor efetivo para UI: coluna persistida ou inferência pela última mensagem real visível. */
export function resolveModoSimplesAguardandoEffective(conversa, user) {
  if (!isConversaModoSimplesAtiva(conversa, user)) return ''
  // Grupos: sem badge de modo simples (fila usa unread, estilo WhatsApp).
  if (isGroupConversation(conversa)) return ''
  // null explícito = marcada como lida; não inferir pela última mensagem antiga
  if (
    conversa &&
    Object.prototype.hasOwnProperty.call(conversa, 'modo_simples_aguardando') &&
    conversa.modo_simples_aguardando === null
  ) {
    return ''
  }
  // Última mensagem visível prevalece (tempo real no chat aberto / preview atualizado)
  const inferred = inferModoSimplesAguardandoFromPreview(conversa)
  if (inferred === 'cliente' || inferred === 'atendente') return inferred
  const stored = getModoSimplesAguardando(conversa)
  if (stored === 'atendente' || stored === 'cliente') return stored
  return ''
}

export function isModoSimplesAguardandoAtendente(conversa, user) {
  if (!isConversaModoSimplesAtiva(conversa, user)) return false
  if (isGroupConversation(conversa)) {
    const unread = Number(conversa?.unread_count ?? 0)
    if (unread > 0) return true
    if (conversa?.tem_novas_mensagens === true) return true
    return conversa?.lida === false
  }
  return resolveModoSimplesAguardandoEffective(conversa, user) === 'atendente'
}

export function isModoSimplesAguardandoCliente(conversa, user) {
  return resolveModoSimplesAguardandoEffective(conversa, user) === 'cliente'
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
