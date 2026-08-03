/**
 * Sessão 2: timeouts HTTP + watchdog de pending + classificação timeout≠erro.
 * Roda: node scripts/test-pending-timeout-watchdog.mjs
 */
import {
  HTTP_TIMEOUT_DEFAULT_MS,
  HTTP_TIMEOUT_TEXT_MS,
  HTTP_TIMEOUT_UPLOAD_MIN_MS,
  HTTP_TIMEOUT_UPLOAD_MAX_MS,
  resolveUploadTimeoutMs,
  resolveRequestTimeoutMs,
} from "../src/api/httpTimeouts.js";
import {
  classifyOutboundAxiosError,
  OUTBOUND_ERROR_KIND,
  shouldShowOutboundToast,
  _resetOutboundToastDedupForTests,
} from "../src/conversa/outboundSendError.js";
import {
  decidePendingWatchdogAction,
  applyPendingWatchdogToList,
  WATCHDOG_SOFT_MS,
  WATCHDOG_HARD_MS,
} from "../src/conversa/pendingMessageWatchdog.js";
import { pickHigherStatus } from "../src/socket/statusMensagemBatch.js";
import { specialtyOutboundToastDecision } from "../src/conversa/specialtyOutboundAccept.js";

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed += 1;
    return;
  }
  failed += 1;
  console.error("FAIL:", msg);
}

// --- Timeouts ---
assert(HTTP_TIMEOUT_DEFAULT_MS === 55_000, "default 55s");
assert(HTTP_TIMEOUT_TEXT_MS === 55_000, "texto 55s");
assert(resolveUploadTimeoutMs(10_000) === HTTP_TIMEOUT_UPLOAD_MIN_MS, "upload pequeno ≥ 3min");
assert(resolveUploadTimeoutMs(50 * 1024 * 1024) <= HTTP_TIMEOUT_UPLOAD_MAX_MS, "vídeo ≤ 15min");
assert(resolveUploadTimeoutMs(50 * 1024 * 1024) > HTTP_TIMEOUT_UPLOAD_MIN_MS, "vídeo > 3min");
assert(
  resolveRequestTimeoutMs({ url: "/chats/1/mensagens", timeout: undefined }) === HTTP_TIMEOUT_DEFAULT_MS,
  "request texto usa default"
);
assert(
  resolveRequestTimeoutMs({ url: "/chats/1/arquivo", data: null, timeout: undefined }) >= HTTP_TIMEOUT_UPLOAD_MIN_MS,
  "request arquivo usa upload timeout"
);

// --- Classificação: timeout ≠ recusa ---
const timeoutErr = Object.assign(new Error("timeout of 55000ms exceeded"), { code: "ECONNABORTED" });
const timeoutClass = classifyOutboundAxiosError(timeoutErr);
assert(timeoutClass.kind === OUTBOUND_ERROR_KIND.TIMEOUT, "timeout kind");
assert(timeoutClass.uncertain === true, "timeout é incerto");

const offlineErr = Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" });
assert(classifyOutboundAxiosError(offlineErr).uncertain === true, "offline incerto");

const providerErr = {
  response: { status: 502, data: { ok: false, status: "erro", error: "invalid phone" } },
  message: "Request failed",
};
const providerClass = classifyOutboundAxiosError(providerErr);
assert(providerClass.kind === OUTBOUND_ERROR_KIND.PROVIDER, "provider kind");
assert(providerClass.uncertain === false, "provider não é incerto");

// Toast: sem verde em timeout; dedupe
_resetOutboundToastDedupForTests();
assert(shouldShowOutboundToast("t1") === true, "primeiro toast");
assert(shouldShowOutboundToast("t1") === false, "toast dedupe");
assert(specialtyOutboundToastDecision({ ok: false, status: "erro" }).type === "error", "sem toast verde em falha");

// --- Watchdog ---
const now = Date.now();
const young = {
  direcao: "out",
  tempId: "temp-1",
  client_temp_id: "temp-1",
  status: "pending",
  criado_em: new Date(now - 10_000).toISOString(),
};
assert(decidePendingWatchdogAction(young, now) === "none", "jovem: none");

const soft = {
  ...young,
  criado_em: new Date(now - WATCHDOG_SOFT_MS - 1000).toISOString(),
};
assert(decidePendingWatchdogAction(soft, now) === "mark_demorado", "soft → demorado");

const hard = {
  ...young,
  criado_em: new Date(now - WATCHDOG_HARD_MS - 1000).toISOString(),
};
assert(decidePendingWatchdogAction(hard, now) === "mark_indefinido", "hard → indefinido");

const sent = {
  direcao: "out",
  status: "sent",
  whatsapp_id: "3EB0A123456789ABCDEF",
  criado_em: new Date(now - WATCHDOG_HARD_MS - 1000).toISOString(),
};
assert(decidePendingWatchdogAction(sent, now) === "none", "sent nunca vira indefinido");

const applied = applyPendingWatchdogToList([soft, hard], now);
assert(applied.changed === true, "watchdog altera lista");
assert(applied.next[0].envio_demorado === true, "marca demorado");
assert(applied.next[1].status_mensagem === "status_indefinido", "marca indefinido");
assert(applied.next[1].retry_preparado === true, "prepara retry futuro");
assert(applied.next[1].envio_erro !== true, "indefinido ≠ erro");

// --- Monotonicidade: indefinido não bloqueia sent; sent não regride ---
assert(pickHigherStatus("status_indefinido", "sent") === "sent", "indefinido → sent");
assert(pickHigherStatus("sent", "status_indefinido") === "sent", "sent não regride para indefinido");
assert(pickHigherStatus("delivered", "pending") === "delivered", "delivered não regride");
assert(pickHigherStatus("read", "erro") === "erro" || pickHigherStatus("read", "pending") === "read", "read estável vs pending");

// Sequência: várias mensagens — ações independentes por idade
const seq = applyPendingWatchdogToList(
  [
    { direcao: "out", tempId: "a", status: "pending", criado_em: new Date(now - 5_000).toISOString() },
    { direcao: "out", tempId: "b", status: "pending", criado_em: new Date(now - WATCHDOG_SOFT_MS - 1).toISOString() },
    { direcao: "out", tempId: "c", status: "sending", criado_em: new Date(now - WATCHDOG_HARD_MS - 1).toISOString() },
  ],
  now
);
assert(seq.next[0].envio_demorado !== true, "seq jovem intacta");
assert(seq.next[1].envio_demorado === true, "seq soft demorada");
assert(seq.next[2].status === "status_indefinido", "seq hard indefinida");

console.log(`pending-timeout-watchdog: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
