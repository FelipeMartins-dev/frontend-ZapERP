/**
 * Reprodução de áudio, ponta a ponta, num navegador de verdade.
 *
 * Fecha a lacuna que as auditorias anteriores só conseguiam declarar por revisão de código:
 * o player era verificado a olho, nunca executado. Aqui um <audio> real decodifica um
 * OGG/Opus real (o mesmo formato que o WhatsApp entrega) dentro do componente real.
 *
 * Cobre os três estados que decidem se o atendente consegue ouvir:
 *  1. fonte boa           → toca, com a duração certa;
 *  2. 1ª fonte quebrada   → cai sozinho para a próxima e toca no MESMO clique;
 *  3. todas quebradas     → mostra "Áudio indisponível — tentar de novo", e o botão
 *                           recupera a reprodução quando a fonte volta.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API = process.env.VITE_API_URL || "http://localhost:5000";
const OGG = fs.readFileSync(path.join(__dirname, "fixtures", "voz-2s.ogg"));

/** URL remota (fora da API) — força o caminho do /media/proxy, como áudio recebido real. */
const AUDIO_REMOTO = "https://s3.amazonaws.com/ultramsgmedia/instance1/voz-2s.ogg";

const chat = {
  id: 1,
  contato_nome: "Contato Áudio",
  nome_contato_cache: "Contato Áudio",
  telefone: "5511999990001",
  status_atendimento: "em_atendimento",
  status_atendimento_real: "em_atendimento",
  atendente_id: 1,
  departamento_id: 1,
  unread_count: 0,
  ultima_atividade: "2026-07-27T20:00:00.000Z",
};

const mensagemAudio = {
  id: 500,
  conversa_id: 1,
  tipo: "audio",
  texto: "",
  url: AUDIO_REMOTO,
  nome_arquivo: "voz-2s.ogg",
  direcao: "in",
  criado_em: "2026-07-27T20:00:00.000Z",
  status: "lido",
};

async function installSession(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "zap_erp_auth",
      JSON.stringify({
        token: "audio-e2e-token",
        user: {
          id: 1,
          nome: "Auditor Áudio",
          email: "audio@local.test",
          perfil: "admin",
          role: "admin",
          departamento_ids: [1],
        },
      })
    );
  });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {() => 'ok'|'falha'} estadoMidia decide, a cada pedido, se a mídia responde ou quebra
 */
async function installApi(page, estadoMidia, { proxySempreFalha = false } = {}) {
  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const p = url.pathname;

    if (p.startsWith("/socket.io")) return route.abort();
    if (p === "/usuarios/me") return route.fulfill({ json: { id: 1, perfil: "admin", role: "admin" } });
    if (p === "/usuarios/me/permissoes") return route.fulfill({ json: { permissoes: [] } });
    if (p === "/config/empresa") return route.fulfill({ json: { id: 1, nome: "ZapERP Áudio" } });
    if (p === "/chats/whatsapp-instances") return route.fulfill({ json: { instances: [], active_count: 0 } });
    if (p === "/tags" || p === "/dashboard/departamentos") return route.fulfill({ json: [] });
    if (p === "/chats/counts") {
      return route.fulfill({ json: { todas: 1, minha_fila: 1, em_atendimento: 1, aguardando_cliente: 0, aguardando_atendente: 0 } });
    }
    if (p === "/chats" && request.method() === "GET") return route.fulfill({ json: [chat] });
    if (/^\/chats\/1$/.test(p) && request.method() === "GET") {
      return route.fulfill({
        json: {
          conversa: { ...chat, cliente_nome: chat.contato_nome, mensagens_bloqueadas: false },
          mensagens: [mensagemAudio],
          next_cursor: null,
          tags: [],
        },
      });
    }

    // É por aqui que o <audio> busca a mídia remota: /media/proxy?url=...&access_token=...
    if (p === "/media/proxy" || p === "/api/media/proxy") {
      if (proxySempreFalha || estadoMidia() === "falha") {
        return route.fulfill({ status: 502, contentType: "text/plain", body: "falha simulada" });
      }
      // Espelha o backend: Accept-Ranges honesto com 206 quando o browser pede Range (seek/resume).
      const range = request.headers()["range"] || request.headers()["Range"];
      const m = typeof range === "string" ? /^bytes=(\d*)-(\d*)$/i.exec(range.trim()) : null;
      if (m && !range.includes(",")) {
        const total = OGG.length;
        let start;
        let end;
        if (m[1] === "" && m[2] !== "") {
          const suffix = Number(m[2]);
          start = Math.max(0, total - suffix);
          end = total - 1;
        } else {
          start = Number(m[1] || 0);
          end = m[2] !== "" ? Number(m[2]) : total - 1;
          end = Math.min(end, total - 1);
        }
        if (Number.isFinite(start) && start < total && Number.isFinite(end) && end >= start) {
          const chunk = OGG.subarray(start, end + 1);
          return route.fulfill({
            status: 206,
            headers: {
              "content-type": "audio/ogg",
              "accept-ranges": "bytes",
              "content-range": `bytes ${start}-${end}/${total}`,
              "content-length": String(chunk.length),
              "cache-control": "no-store",
            },
            body: chunk,
          });
        }
      }
      return route.fulfill({
        status: 200,
        headers: {
          "content-type": "audio/ogg",
          "accept-ranges": "bytes",
          "content-length": String(OGG.length),
          "cache-control": "no-store",
        },
        body: OGG,
      });
    }

    return route.fulfill({ json: {} });
  });

  // A mídia direta (sem proxy) é o segundo candidato da lista.
  await page.route(AUDIO_REMOTO, async (route) => {
    if (estadoMidia() === "falha") {
      return route.fulfill({ status: 502, contentType: "text/plain", body: "falha simulada" });
    }
    return route.fulfill({ status: 200, headers: { "content-type": "audio/ogg" }, body: OGG });
  });
}

async function abrirConversaComAudio(page, testInfo) {
  await page.goto("/atendimento");
  const rows = page.locator(".chat-list-row");
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  if (testInfo.project.name.includes("mobile")) await rows.first().tap();
  else await rows.first().click();
  const player = page.locator(".wa-audioPlayer").first();
  await expect(player).toBeVisible({ timeout: 30_000 });
  return player;
}

/** Estado do <audio> real dentro da bolha. */
function estadoAudio(page) {
  return page.evaluate(() => {
    const el = document.querySelector(".wa-audioElHidden");
    if (!el) return null;
    return {
      src: el.currentSrc || el.src || "",
      readyState: el.readyState,
      duration: Number.isFinite(el.duration) ? el.duration : null,
      currentTime: el.currentTime,
      paused: el.paused,
      erro: el.error ? el.error.code : null,
    };
  });
}

async function retomarDepoisDaFonteVoltar(page) {
  const aviso = page.getByTestId("audio-indisponivel");

  if (await aviso.isVisible().catch(() => false)) {
    try {
      await aviso.click({ timeout: 4_000 });
      return;
    } catch (error) {
      // A recuperação automática pode substituir o aviso pelo player entre a
      // verificação acima e o clique. Só toleramos o erro se o aviso realmente
      // tiver sido desmontado; qualquer outra falha de interação continua fatal.
      if ((await aviso.count()) !== 0) {
        throw error;
      }
    }
  }

  const audio = await estadoAudio(page);
  if ((audio?.currentTime ?? 0) > 0.15 || audio?.paused === false) {
    return;
  }

  await page.getByRole("button", { name: /tocar áudio/i }).first().click();
}

test.describe("reprodução de áudio", () => {
  test("áudio recebido carrega, tem a duração certa e toca de verdade", async ({ page }, testInfo) => {
    await installSession(page);
    await installApi(page, () => "ok");
    await abrirConversaComAudio(page, testInfo);

    // O navegador abriu e decodificou o cabeçalho: readyState >= 1 (HAVE_METADATA).
    // Não exigimos 2 aqui de propósito — o elemento usa preload="metadata", então antes
    // do play o normal é parar em 1. A prova de reprodução real vem do currentTime abaixo.
    await expect
      .poll(async () => (await estadoAudio(page))?.readyState ?? 0, { timeout: 20_000 })
      .toBeGreaterThanOrEqual(1);

    const antes = await estadoAudio(page);
    expect(antes.erro).toBeNull();
    // Fixture de 2s: a duração real precisa aparecer (é o que a bolha mostra).
    expect(antes.duration).toBeGreaterThan(1.5);
    expect(antes.duration).toBeLessThan(2.6);

    await page.getByRole("button", { name: /tocar áudio/i }).first().click();

    // Tocou mesmo: o cursor andou.
    await expect
      .poll(async () => (await estadoAudio(page))?.currentTime ?? 0, { timeout: 15_000 })
      .toBeGreaterThan(0.15);
    expect((await estadoAudio(page)).paused).toBe(false);

    // Nunca deve aparecer aviso de indisponível num áudio que funciona.
    await expect(page.getByTestId("audio-indisponivel")).toHaveCount(0);
  });

  test("primeira fonte quebrada: cai para a próxima e toca no mesmo clique", async ({ page }, testInfo) => {
    // O proxy falha; a URL direta funciona. O player tem de percorrer sozinho.
    await installSession(page);
    await installApi(page, () => "ok", { proxySempreFalha: true });
    await abrirConversaComAudio(page, testInfo);

    await page.getByRole("button", { name: /tocar áudio/i }).first().click();

    await expect
      .poll(async () => (await estadoAudio(page))?.currentTime ?? 0, { timeout: 25_000 })
      .toBeGreaterThan(0.15);

    const st = await estadoAudio(page);
    expect(st.paused).toBe(false);
    expect(st.src).not.toContain("/media/proxy");
  });

  test("todas as fontes quebradas: avisa e o botão recupera quando a fonte volta", async ({ page }, testInfo) => {
    let estado = "falha";
    await installSession(page);
    await installApi(page, () => estado);
    await abrirConversaComAudio(page, testInfo);

    await page.getByRole("button", { name: /tocar áudio/i }).first().click();

    // O atendente precisa SABER que não tocou — antes ficava mudo e sem explicação.
    const aviso = page.getByTestId("audio-indisponivel");
    await expect(aviso).toBeVisible({ timeout: 30_000 });

    // Fonte volta (ex.: backfill copiou a mídia, rede restabelecida) → o botão recupera.
    estado = "ok";
    await retomarDepoisDaFonteVoltar(page);

    await expect
      .poll(async () => (await estadoAudio(page))?.currentTime ?? 0, { timeout: 25_000 })
      .toBeGreaterThan(0.15);
    await expect(page.getByTestId("audio-indisponivel")).toHaveCount(0);
  });

  test("pause e play retomam a partir da posição (não recomeçam do zero)", async ({ page }, testInfo) => {
    // Regressão do bug mobile: após pausar, o play seguinte não retomava (buffer liberado /
    // play() antes de canplay / seek concorrente). Cobre desktop e chromium-mobile (Pixel 5).
    await installSession(page);
    await installApi(page, () => "ok");
    await abrirConversaComAudio(page, testInfo);

    const playBtn = page.getByRole("button", { name: /tocar áudio|pausar áudio/i }).first();
    await playBtn.click();

    await expect
      .poll(async () => (await estadoAudio(page))?.currentTime ?? 0, { timeout: 15_000 })
      .toBeGreaterThan(0.35);

    await page.getByRole("button", { name: /pausar áudio/i }).first().click();

    await expect
      .poll(async () => (await estadoAudio(page))?.paused === true, { timeout: 5_000 })
      .toBe(true);

    const pausedAt = (await estadoAudio(page))?.currentTime ?? 0;
    expect(pausedAt).toBeGreaterThan(0.3);

    await page.getByRole("button", { name: /tocar áudio/i }).first().click();

    await expect
      .poll(async () => (await estadoAudio(page))?.paused === false, { timeout: 15_000 })
      .toBe(true);

    // Retomou perto de onde parou (tolerância para seek/reload), sem voltar ao início.
    await expect
      .poll(async () => (await estadoAudio(page))?.currentTime ?? 0, { timeout: 10_000 })
      .toBeGreaterThan(pausedAt - 0.35);

    const depois = await estadoAudio(page);
    expect(depois.currentTime).toBeGreaterThan(0.25);
    // Avançou de verdade após o resume (não ficou congelado mudo).
    await expect
      .poll(async () => (await estadoAudio(page))?.currentTime ?? 0, { timeout: 10_000 })
      .toBeGreaterThan(pausedAt + 0.1);

    await expect(page.getByTestId("audio-indisponivel")).toHaveCount(0);
  });
});
