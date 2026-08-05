/** Escopo de instância WhatsApp para chaves de dedupe/lista. */
export function whatsappInstanceScope(c) {
  const instanceId =
    c?.whatsapp_instance_id ??
    c?.whatsappInstanceId ??
    c?.whatsapp_instance?.id ??
    null
  return instanceId != null && String(instanceId).trim() !== ""
    ? `wi:${String(instanceId).trim()}`
    : "wi:legacy"
}

/**
 * Chave estável de linha na lista de conversas.
 * Com id: conv:{id}. Sem conversa: cliente + instância. Fallback: telefone + instância.
 * Sem Math.random — remount no bump faz o avatar “pular”.
 */
export function chatRowStableKey(c) {
  if (c?.id != null && String(c.id).trim() !== "") {
    return `conv:${String(c.id)}`
  }
  const instanceScope = whatsappInstanceScope(c)
  if (c?.sem_conversa && c?.cliente_id != null) {
    return `${instanceScope}:sem:${String(c.cliente_id)}`
  }
  if (c?.cliente_id != null) {
    return `${instanceScope}:cliente:${String(c.cliente_id)}`
  }
  const tel = String(c?.telefone ?? c?.telefone_exibivel ?? "").trim()
  if (tel) return `${instanceScope}:tel:${tel}`
  return `${instanceScope}:row:missing`
}
