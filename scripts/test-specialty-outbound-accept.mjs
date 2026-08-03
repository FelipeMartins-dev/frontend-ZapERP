/**
 * Garante que contato/localização/link/ligação não tratam falha como sucesso.
 * Roda: node scripts/test-specialty-outbound-accept.mjs
 */
import {
  assertSpecialtyOutboundAccepted,
  specialtyOutboundToastDecision,
} from "../src/conversa/specialtyOutboundAccept.js";

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

function expectThrow(fn, label) {
  try {
    fn();
    failed += 1;
    console.error("FAIL:", label, "— deveria lançar");
  } catch (e) {
    passed += 1;
    return e;
  }
  return null;
}

assert(
  assertSpecialtyOutboundAccepted({ ok: true, status: "sent", whatsapp_id: "3EB0A123456789ABCDEF" }).ok === true,
  "aceite com ID"
);

assert(
  assertSpecialtyOutboundAccepted({ ok: true, status: "pending", queued: true }).status === "pending",
  "aceite sem ID permanece pending"
);

const errOkFalse = expectThrow(
  () => assertSpecialtyOutboundAccepted({ ok: false, status: "erro", error: "invalid phone" }),
  "ok:false"
);
assert(errOkFalse?.response?.data?.status === "erro", "ok:false expõe status erro");

expectThrow(
  () => assertSpecialtyOutboundAccepted({ ok: true, status: "erro" }),
  "ok:true + status erro"
);
expectThrow(
  () => assertSpecialtyOutboundAccepted({ status: "failed", error: "x" }),
  "status failed"
);

for (const payload of [
  { ok: false, status: "erro", error: "provider" },
  { ok: true, status: "erro" },
  { status: "failed" },
  Object.assign(new Error("network"), { response: { status: 502, data: { ok: false, status: "erro" } } }),
]) {
  const toast = specialtyOutboundToastDecision(payload);
  assert(toast.type === "error", "toast não verde em falha");
  assert(toast.type !== "success", "garantia extra: sem success");
}

assert(specialtyOutboundToastDecision({ ok: true, status: "sent" }).type === "success", "toast verde em sent");
assert(specialtyOutboundToastDecision({ ok: true, status: "pending" }).type === "success", "toast verde em pending aceito");

console.log(`specialty-outbound-accept: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
