/**
 * Regressão do microfone compartilhado (src/media/micStreamService.js).
 *
 * O stream fica em cache entre gravações. Um track pode continuar `readyState === "live"`
 * e ainda assim estar `muted` — dispositivo trocado (fone bluetooth), silenciado pelo
 * sistema ou tomado por outro app. Reaproveitar esse track produz uma gravação só com
 * silêncio, que chegava ao contato como áudio mudo. Aqui garantimos que o cache só é
 * reaproveitado enquanto o track está realmente capturando.
 *
 * Uso: node --import ./scripts/vite-env-shim.mjs scripts/test-mic-stream-service.mjs
 */
import assert from "node:assert/strict";

/** MediaStreamTrack de mentira, com os campos que o serviço olha. */
function fakeTrack({ readyState = "live", muted = false } = {}) {
  return {
    readyState,
    muted,
    listeners: new Map(),
    addEventListener(ev, fn) {
      this.listeners.set(ev, [...(this.listeners.get(ev) || []), fn]);
    },
    removeEventListener(ev, fn) {
      this.listeners.set(ev, (this.listeners.get(ev) || []).filter((f) => f !== fn));
    },
    stop() {
      this.readyState = "ended";
    },
  };
}

function fakeStream(track) {
  return {
    track,
    getAudioTracks: () => [track],
    getTracks: () => [track],
  };
}

const cenarios = [];
let aberturas = 0;
let proximoTrack = () => fakeTrack();

// `navigator` no node moderno é getter-only: substitui via defineProperty.
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  writable: true,
  value: {
    permissions: { query: async () => ({ state: "granted" }) },
    mediaDevices: {
      getUserMedia: async () => {
        aberturas += 1;
        return fakeStream(proximoTrack());
      },
    },
  },
});
globalThis.sessionStorage = globalThis.localStorage;

const { acquireMicStream, invalidateMicStream } = await import("../src/media/micStreamService.js");

async function cenario(nome, fn) {
  invalidateMicStream();
  aberturas = 0;
  await fn();
  cenarios.push(nome);
}

await cenario("track saudável é reaproveitado entre gravações", async () => {
  proximoTrack = () => fakeTrack();
  const a = await acquireMicStream();
  const b = await acquireMicStream();
  assert.equal(a, b, "deveria devolver o mesmo stream em cache");
  assert.equal(aberturas, 1, "não deveria reabrir o microfone com o track saudável");
});

await cenario("track MUDO em cache não é reaproveitado — reabre o microfone", async () => {
  const mudo = fakeTrack({ muted: true });
  proximoTrack = () => mudo;
  const a = await acquireMicStream();
  assert.equal(aberturas, 1);
  proximoTrack = () => fakeTrack({ muted: false });
  const b = await acquireMicStream();
  assert.notEqual(a, b, "stream mudo não pode ser reaproveitado");
  assert.equal(aberturas, 2, "deveria ter reaberto o microfone");
  assert.equal(mudo.readyState, "ended", "o stream mudo deve ser liberado");
});

await cenario("track que ficou mudo DEPOIS também força reabertura", async () => {
  const t = fakeTrack();
  proximoTrack = () => t;
  const a = await acquireMicStream();
  assert.equal(aberturas, 1);
  t.muted = true; // dispositivo trocado enquanto o stream estava ocioso
  proximoTrack = () => fakeTrack();
  const b = await acquireMicStream();
  assert.notEqual(a, b);
  assert.equal(aberturas, 2);
});

await cenario("track encerrado continua forçando reabertura (comportamento antigo)", async () => {
  const t = fakeTrack();
  proximoTrack = () => t;
  await acquireMicStream();
  t.readyState = "ended";
  proximoTrack = () => fakeTrack();
  await acquireMicStream();
  assert.equal(aberturas, 2);
});

await cenario("chamadas simultâneas compartilham uma única abertura", async () => {
  proximoTrack = () => fakeTrack();
  const [a, b] = await Promise.all([acquireMicStream(), acquireMicStream()]);
  assert.equal(a, b);
  assert.equal(aberturas, 1, "duas chamadas concorrentes não podem abrir o mic duas vezes");
});

console.log(`OK — regressão do microfone compartilhado passou (${cenarios.length} cenários).`);
