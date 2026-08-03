/**
 * Sessão 3: regras de UI do botão "Tentar novamente".
 * Roda: node scripts/test-manual-retry-ui.mjs
 */

function canShowRetryButton(msg, { hasHandler = true } = {}) {
  const out = msg?.direcao === "out" || msg?.fromMe === true;
  const retryMensagemId = msg?.id ?? msg?.mensagem_id;
  const retryStatus = String(msg?.status_mensagem ?? msg?.status ?? "").toLowerCase();
  const retryFailedConfirmed =
    msg?.envio_erro === true || ["erro", "error", "failed", "falhou"].includes(retryStatus);
  const retryBlockedStatus = [
    "pending",
    "sending",
    "enviando",
    "sent",
    "enviada",
    "delivered",
    "entregue",
    "read",
    "lida",
    "played",
    "status_indefinido",
  ].includes(retryStatus);
  const tipoNorm = String(msg?.tipo || "").toLowerCase();
  const media = ["audio", "voice", "ptt", "imagem", "image", "video", "vídeo", "arquivo", "documento", "sticker"].includes(
    tipoNorm
  );
  const text =
    !media &&
    tipoNorm !== "location" &&
    tipoNorm !== "contact" &&
    tipoNorm !== "call" &&
    (tipoNorm === "" || tipoNorm === "texto" || tipoNorm === "text" || tipoNorm === "chat");
  return (
    out &&
    hasHandler &&
    retryMensagemId != null &&
    String(retryMensagemId).trim() !== "" &&
    retryFailedConfirmed &&
    !retryBlockedStatus &&
    (media || text)
  );
}

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL:", msg);
  }
}

assert(canShowRetryButton({ direcao: "out", id: 1, tipo: "texto", status: "erro" }), "texto erro");
assert(canShowRetryButton({ direcao: "out", id: 2, tipo: "audio", status: "erro", envio_erro: true }), "áudio erro");
assert(canShowRetryButton({ direcao: "out", id: 3, tipo: "imagem", status: "failed" }), "imagem failed");
assert(canShowRetryButton({ direcao: "out", id: 4, tipo: "video", status: "erro" }), "vídeo erro");
assert(canShowRetryButton({ direcao: "out", id: 5, tipo: "arquivo", status: "erro" }), "documento erro");

assert(!canShowRetryButton({ direcao: "out", id: 6, tipo: "texto", status: "pending" }), "não pending");
assert(!canShowRetryButton({ direcao: "out", id: 7, tipo: "texto", status: "sending" }), "não sending");
assert(!canShowRetryButton({ direcao: "out", id: 8, tipo: "texto", status: "sent" }), "não sent");
assert(!canShowRetryButton({ direcao: "out", id: 9, tipo: "texto", status: "delivered" }), "não delivered");
assert(!canShowRetryButton({ direcao: "out", id: 10, tipo: "texto", status: "read" }), "não read");
assert(!canShowRetryButton({ direcao: "out", id: 11, tipo: "texto", status: "status_indefinido" }), "não indefinido");
assert(!canShowRetryButton({ direcao: "out", tipo: "texto", status: "erro" }), "exige mensagem_id");
assert(!canShowRetryButton({ direcao: "in", id: 12, tipo: "texto", status: "erro" }), "não inbound");
assert(!canShowRetryButton({ direcao: "out", id: 13, tipo: "contact", status: "erro" }), "não contato");

// Dois cliques: in-flight set simulado
const inFlight = new Set();
function tryStartRetry(mid) {
  const k = String(mid);
  if (inFlight.has(k)) return false;
  inFlight.add(k);
  return true;
}
assert(tryStartRetry(100) === true, "primeiro clique");
assert(tryStartRetry(100) === false, "segundo clique bloqueado");
inFlight.delete("100");
assert(tryStartRetry(100) === true, "após liberar permite de novo");

console.log(`manual-retry-ui: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
