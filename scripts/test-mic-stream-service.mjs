/**
 * Regressão do ciclo de vida do microfone (src/media/micStreamService.js).
 *
 * O mic NÃO fica em cache entre gravações: no iPhone/Safari o indicador do sistema
 * permanece no topo enquanto houver track `live`. Cada acquire abre um stream novo
 * e release/invalidate encerram todas as faixas.
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

const {
  acquireMicStream,
  releaseMicStream,
  invalidateMicStream,
  areMicAudioTracksEnded,
  warmMicStreamSilently,
  getActiveMicStream,
} = await import("../src/media/micStreamService.js");

async function cenario(nome, fn) {
  invalidateMicStream();
  aberturas = 0;
  await fn();
  cenarios.push(nome);
}

await cenario("cada acquire abre um MediaStream novo (não reutiliza)", async () => {
  proximoTrack = () => fakeTrack();
  const a = await acquireMicStream();
  const trackA = a.getAudioTracks()[0];
  releaseMicStream();
  assert.equal(trackA.readyState, "ended", "release deve encerrar a track");
  assert.equal(areMicAudioTracksEnded(a), true);

  const b = await acquireMicStream();
  assert.notEqual(a, b, "não deve reutilizar stream encerrado");
  assert.equal(aberturas, 2, "deve chamar getUserMedia de novo");
});

await cenario("acquire com stream anterior vivo finaliza a faixa antiga primeiro", async () => {
  proximoTrack = () => fakeTrack();
  const a = await acquireMicStream();
  const trackA = a.getAudioTracks()[0];
  assert.equal(trackA.readyState, "live");
  proximoTrack = () => fakeTrack();
  const b = await acquireMicStream();
  assert.equal(trackA.readyState, "ended", "faixa anterior deve ser stopped");
  assert.notEqual(a, b);
  assert.equal(aberturas, 2);
  assert.equal(b.getAudioTracks()[0].readyState, "live");
});

await cenario("releaseMicStream é idempotente", async () => {
  proximoTrack = () => fakeTrack();
  const a = await acquireMicStream();
  releaseMicStream();
  releaseMicStream();
  invalidateMicStream();
  assert.equal(areMicAudioTracksEnded(a), true);
  assert.equal(getActiveMicStream(), null);
});

await cenario("warmMicStreamSilently não abre o microfone", async () => {
  const ok = await warmMicStreamSilently();
  assert.equal(ok, false);
  assert.equal(aberturas, 0);
  assert.equal(getActiveMicStream(), null);
});

await cenario("chamadas simultâneas compartilham uma única abertura em voo", async () => {
  proximoTrack = () => fakeTrack();
  const [a, b] = await Promise.all([acquireMicStream(), acquireMicStream()]);
  assert.equal(a, b);
  assert.equal(aberturas, 1, "duas chamadas concorrentes não podem abrir o mic duas vezes");
  releaseMicStream();
  assert.equal(areMicAudioTracksEnded(a), true);
});

console.log(`OK — regressão do ciclo de vida do microfone passou (${cenarios.length} cenários).`);
