/**
 * Loader ESM mínimo para os scripts de regressão: substitui `import.meta.env` (resolvido pelo
 * Vite em build/dev) por um objeto fixo, de modo que os módulos do app carreguem no node puro.
 * Não é usado em runtime — apenas por scripts/test-*.mjs via scripts/vite-env-shim.mjs.
 */
const ENV_FIXO =
  '({ VITE_API_URL: "https://api.teste.local", DEV: false, VITE_WITH_CREDENTIALS: "0" })';

const EXTENSOES = [".js", ".jsx", "/index.js", "/index.jsx"];

/** O Vite resolve import sem extensão ("../../utils/x"); o node não. */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (err?.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith(".")) throw err;
    for (const ext of EXTENSOES) {
      try {
        return await nextResolve(specifier + ext, context);
      } catch {
        /* tenta a próxima extensão */
      }
    }
    throw err;
  }
}

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (result.format !== "module" || !result.source) return result;
  const source = result.source.toString();
  if (!source.includes("import.meta.env")) return result;
  return { ...result, source: source.replaceAll("import.meta.env", ENV_FIXO) };
}
