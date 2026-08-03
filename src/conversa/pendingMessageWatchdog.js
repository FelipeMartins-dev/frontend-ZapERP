/**
 * Watchdog de mensagens outbound pendentes (somente frontend).
 * Não marca erro por tempo sozinho — usa demora / status_indefinido e deixa
 * a reconciliação (refresh/socket) confirmar sent/erro real.
 */

export const WATCHDOG_SOFT_MS = 45_000;
export const WATCHDOG_HARD_MS = 180_000;
export const WATCHDOG_TICK_MS = 15_000;

const PENDINGISH = new Set([
  "pending",
  "sending",
  "enviando",
  "status_indefinido",
  "",
]);

export function isPendingishStatus(status) {
  return PENDINGISH.has(String(status ?? "").toLowerCase().trim());
}

export function messageAgeMs(msg, now = Date.now()) {
  const ts = Date.parse(msg?.criado_em || msg?.created_at || "");
  if (!Number.isFinite(ts)) return 0;
  return Math.max(0, now - ts);
}

/**
 * Decide ação do watchdog para uma mensagem.
 * @returns {'none'|'mark_demorado'|'mark_indefinido'|'refresh'}
 */
export function decidePendingWatchdogAction(msg, now = Date.now()) {
  if (!msg || msg.direcao === "in" || msg.fromMe === false) return "none";
  const direcao = String(msg.direcao || "").toLowerCase();
  const out = direcao === "out" || direcao === "saida" || msg.fromMe === true || !!msg.tempId;
  if (!out) return "none";

  const status = msg.status_mensagem ?? msg.status;
  if (!isPendingishStatus(status)) return "none";
  // Já confirmado pelo provedor — nunca regressar.
  if (msg.whatsapp_id && ["sent", "delivered", "read", "played"].includes(String(status).toLowerCase())) {
    return "none";
  }
  if (msg.envio_erro === true && String(status).toLowerCase() === "erro") return "none";

  const age = messageAgeMs(msg, now);
  if (age < WATCHDOG_SOFT_MS) return "none";

  if (age >= WATCHDOG_HARD_MS) {
    if (String(status).toLowerCase() === "status_indefinido") return "refresh";
    return "mark_indefinido";
  }

  if (msg.envio_demorado === true) return "none";
  return "mark_demorado";
}

/**
 * Aplica decisões do watchdog numa lista (puro, para testes).
 * @returns {{ next: object[], needsRefresh: boolean, changed: boolean }}
 */
export function applyPendingWatchdogToList(mensagens, now = Date.now()) {
  const list = Array.isArray(mensagens) ? mensagens : [];
  let needsRefresh = false;
  let changed = false;
  const next = list.map((msg) => {
    const action = decidePendingWatchdogAction(msg, now);
    if (action === "none") return msg;
    if (action === "refresh") {
      needsRefresh = true;
      return msg;
    }
    if (action === "mark_demorado") {
      changed = true;
      return {
        ...msg,
        envio_demorado: true,
        // Mantém pending/sending — só sinal visual de demora.
      };
    }
    if (action === "mark_indefinido") {
      changed = true;
      needsRefresh = true;
      return {
        ...msg,
        status: "status_indefinido",
        status_mensagem: "status_indefinido",
        envio_demorado: true,
        envio_incerto: true,
        // Preparado para retry futuro; não implementa reenvio nesta sessão.
        retry_preparado: true,
        erro_mensagem:
          msg.erro_mensagem ||
          "Não foi possível confirmar o envio a tempo. Verificando com o servidor…",
      };
    }
    return msg;
  });
  return { next: changed ? next : list, needsRefresh, changed };
}
