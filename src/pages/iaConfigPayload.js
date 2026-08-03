export function normalizeFinalizationMessage(enabled, message) {
  const mensagemFinalizacao = String(message || "").trim();
  return {
    enviarMensagemFinalizacao: enabled === true && mensagemFinalizacao.length > 0,
    mensagemFinalizacao,
  };
}
