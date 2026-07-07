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

/**
 * Um outbound só "conta" para o modo simples se for resposta real do atendente
 * (mesma heurística do backend/socket: tem autor ou id otimista). Ausência automática
 * e bot interno não trazem esses marcadores e não devem virar "aguardando cliente".
 */
function outboundContaComoRespostaAtendente(msg) {
  if (!msg || typeof msg !== 'object') return false
  const autorId = msg.autor_usuario_id ?? msg.usuario_id ?? msg.user_id ?? msg.autor_id
  if (autorId != null && String(autorId).trim() !== '') return true
  const tempId = msg.client_temp_id ?? msg.clientTempId ?? msg.temp_id ?? msg.tempId
  if (tempId != null && String(tempId).trim() !== '') return true
  return false
}

/** Mensagens candidatas (preview + última + histórico carregado) da mais recente para a mais antiga. */
function collectMensagemCandidates(conversa) {
  if (!conversa || typeof conversa !== 'object') return []
  const out = []
  const push = (msg) => {
    if (!msg || typeof msg !== 'object') return
    const dir = normalizeMessageDirection(msg.direcao)
    if (!dir) return
    const t = new Date(msg.criado_em || 0).getTime()
    out.push({ msg, dir, ts: Number.isFinite(t) ? t : 0 })
  }
  push(conversa.ultima_mensagem_preview)
  push(conversa.ultima_mensagem)
  if (Array.isArray(conversa.mensagens)) {
    for (const m of conversa.mensagens) push(m)
  }
  out.sort((a, b) => b.ts - a.ts)
  return out
}

/** Mescla lista + detalhe + histórico carregado para regras de UI do modo simples. */
export function buildConversaModoSimplesUiSource(conversa, fromChat, mensagens) {
  const merged = { ...(fromChat && typeof fromChat === 'object' ? fromChat : {}), ...(conversa && typeof conversa === 'object' ? conversa : {}) }
  if (Array.isArray(mensagens) && mensagens.length > 0) {
    merged.mensagens = mensagens
  }
  return merged
}

/**
 * Inferência pela última mensagem real visível (mesma regra de qualificação do backend):
 * - inbound sempre conta → "atendente";
 * - outbound só conta se for resposta real do atendente → "cliente";
 * - outbound não qualificado (ausência automática/bot) é ignorado, olhando a mensagem anterior.
 * Retorna "" quando nada é conclusivo — aí o valor persistido pelo backend prevalece.
 */
export function inferModoSimplesAguardandoFromPreview(conversa) {
  const candidates = collectMensagemCandidates(conversa)
  for (const { msg, dir } of candidates) {
    if (dir === 'in') return 'atendente'
    if (dir === 'out') {
      if (outboundContaComoRespostaAtendente(msg)) return 'cliente'
      // outbound não qualificado (ausência automática/bot): ignora e olha a anterior
    }
    // system/outros: ignora
  }
  return ''
}

/** Valor efetivo para UI: inferência qualificada pela última msg real visível ou coluna persistida (backend). */
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
  // Última mensagem visível qualificada prevalece (tempo real no chat aberto / preview atualizado);
  // ausência automática/bot não flipam para "cliente" — nesse caso cai para a coluna do backend.
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
