/**
 * Regressão: ordem das fontes que o <audio> tenta para um áudio.
 *
 * Regra: enquanto o envio está pendente, o blob local é a primeira fonte (áudio ouvível na hora).
 * Assim que o servidor devolve /uploads, ele passa na frente — o blob é o webm cru do MediaRecorder,
 * sem duração no cabeçalho, e era ele que fazia a bolha exibir durações absurdas (12:37 num áudio
 * de 10s). O blob continua na lista como último recurso.
 *
 * Executar: node --import ./scripts/vite-env-shim.mjs scripts/test-audio-playback-candidates.mjs
 */
import {
  buildMediaOpenHref,
  getMediaPlaybackUrl,
  resolveAudioPlaybackCandidates,
} from "../src/conversa/utils/conversaViewHelpers.js";

let falhas = 0;
function checar(nome, condicao, detalhe) {
  if (condicao) return;
  falhas += 1;
  console.error(`FALHOU: ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
}

const BLOB = "blob:http://app.local/abc-123";

// 1) Envio ainda pendente: só existe o blob local.
{
  const msg = { tipo: "voice", direcao: "out", url: BLOB, _optimisticBlobUrl: BLOB };
  const c = resolveAudioPlaybackCandidates(msg);
  checar("pendente mantém o blob como primeira fonte", c[0] === BLOB, JSON.stringify(c));
}

// 2) Reconciliado: servidor já tem o OGG transcodificado em /uploads.
{
  const msg = {
    tipo: "voice",
    direcao: "out",
    url: "/uploads/1753600001234-audio.ogg",
    url_absoluta: "/uploads/1753600001234-audio.ogg",
    _optimisticBlobUrl: BLOB,
  };
  const c = resolveAudioPlaybackCandidates(msg);
  checar("depois de reconciliar, /uploads vem antes do blob", c[0]?.includes("/uploads/"), JSON.stringify(c));
  checar("blob continua disponível como fallback", c.includes(BLOB), JSON.stringify(c));
}

// 3) Áudio recebido do cliente ainda na URL do provedor: proxy autenticado primeiro.
{
  const provedor = "https://ultramsgmedia.s3.amazonaws.com/instance/audio.ogg";
  const msg = { tipo: "voice", direcao: "in", url: provedor };
  const c = resolveAudioPlaybackCandidates(msg);
  checar("recebido usa /media/proxy como primeira fonte", c[0]?.includes("/media/proxy"), JSON.stringify(c));
  checar("URL crua do provedor fica como fallback", c.includes(provedor), JSON.stringify(c));
}

// 4) Áudio recebido já migrado para /uploads: sem proxy no caminho.
{
  const msg = { tipo: "voice", direcao: "in", url: "/uploads/inbound-c1-m2-xyz.ogg" };
  const c = resolveAudioPlaybackCandidates(msg);
  checar("migrado toca direto de /uploads", c[0]?.includes("/uploads/"), JSON.stringify(c));
  checar("migrado não passa pelo proxy", !c.some((u) => u.includes("/media/proxy")), JSON.stringify(c));
}

// 5) Sem nenhuma URL: lista vazia (a bolha cai no placeholder, não num player quebrado).
{
  const c = resolveAudioPlaybackCandidates({ tipo: "voice", direcao: "in" });
  checar("sem URL não gera candidato", c.length === 0, JSON.stringify(c));
}

// 6) URL que já aponta ao proxy não pode ser embrulhada em um segundo proxy.
{
  const proxy =
    "https://api.teste.local/media/proxy?url=https%3A%2F%2Fcdn.ultramsg.com%2Fdocs%2Fa.pdf&access_token=token";
  const playback = getMediaPlaybackUrl(proxy, null);
  checar("proxy existente não vira proxy do proxy", playback === proxy, playback);
}

// 7) Abertura de documento externo inclui filename/MIME hint e usa disposition inline.
{
  const href = buildMediaOpenHref(
    "https://cdn.ultramsg.com/download/abc123",
    null,
    "Relatório final.pdf"
  );
  const parsed = new URL(href);
  checar("arquivo externo abre via proxy", parsed.pathname === "/media/proxy", href);
  checar("abertura usa disposition inline", parsed.searchParams.get("disposition") === "inline", href);
  checar("abertura preserva filename", parsed.searchParams.get("filename") === "Relatório final.pdf", href);
}

if (falhas > 0) {
  console.error(`\n${falhas} verificação(ões) falharam.`);
  process.exit(1);
}
console.log("OK — regressão de mídia/arquivos passou (7 cenários).");
