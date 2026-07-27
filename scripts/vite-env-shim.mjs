/**
 * Permite rodar módulos do app (que usam `import.meta.env` do Vite) no node puro,
 * para os scripts de regressão em scripts/test-*.mjs.
 *
 * Uso: node --import ./scripts/vite-env-shim.mjs scripts/test-alguma-coisa.mjs
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./vite-env-loader.mjs", pathToFileURL(import.meta.filename));

// `localStorage` é lido para montar a URL autenticada do /media/proxy.
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map([["zap_erp_auth", JSON.stringify({ token: "token-de-teste" })]]);
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}
