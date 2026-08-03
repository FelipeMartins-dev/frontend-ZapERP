import assert from "node:assert/strict";
import { normalizeFinalizationMessage } from "../src/pages/iaConfigPayload.js";
import {
  recoverFromVitePreloadError,
  vitePreloadRecoveryConstants,
} from "../src/runtime/vitePreloadRecovery.js";

assert.deepEqual(normalizeFinalizationMessage(true, "  Atendimento encerrado  "), {
  enviarMensagemFinalizacao: true,
  mensagemFinalizacao: "Atendimento encerrado",
});
assert.deepEqual(normalizeFinalizationMessage(true, "   "), {
  enviarMensagemFinalizacao: false,
  mensagemFinalizacao: "",
});
assert.deepEqual(normalizeFinalizationMessage(false, "Mensagem preservada"), {
  enviarMensagemFinalizacao: false,
  mensagemFinalizacao: "Mensagem preservada",
});

const storage = new Map();
const replacedUrls = [];
const runtime = {
  location: {
    href: "https://zaperp.wmsistemas.inf.br/ia",
    replace(url) {
      replacedUrls.push(url);
    },
  },
  sessionStorage: {
    getItem(key) {
      return storage.get(key) ?? null;
    },
    setItem(key, value) {
      storage.set(key, value);
    },
  },
};

let prevented = 0;
const event = { preventDefault: () => { prevented += 1; } };
assert.equal(recoverFromVitePreloadError(event, runtime, 100_000), true);
assert.equal(prevented, 1);
assert.equal(replacedUrls.length, 1);
assert.match(replacedUrls[0], /__zaperp_chunk_reload=100000/);

assert.equal(recoverFromVitePreloadError(event, runtime, 100_100), false);
assert.equal(prevented, 1);
assert.equal(replacedUrls.length, 1);

const runtimeWithoutStorage = {
  location: {
    href: "https://zaperp.wmsistemas.inf.br/ia?__zaperp_chunk_reload=100000",
    replace() {
      throw new Error("nao deveria recarregar durante a protecao");
    },
  },
  sessionStorage: {
    getItem() {
      throw new Error("storage bloqueado");
    },
  },
};
assert.equal(recoverFromVitePreloadError(event, runtimeWithoutStorage, 100_100), false);
assert.equal(prevented, 1);

const afterGuard = 100_000 + vitePreloadRecoveryConstants.RELOAD_GUARD_MS;
assert.equal(recoverFromVitePreloadError(event, runtime, afterGuard), true);
assert.equal(prevented, 2);
assert.equal(replacedUrls.length, 2);

console.log("deploy recovery and finalization config: ok");
