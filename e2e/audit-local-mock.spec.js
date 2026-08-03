import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

// Mantém o mock alinhado ao VITE_API_URL que o webServer do Playwright injeta.
const API = process.env.VITE_API_URL || "http://localhost:5000";
const auditAudioFixture = readFileSync(new URL("./fixtures/voz-2s.ogg", import.meta.url));

const chats = [
  {
    id: 1,
    contato_nome: "Contato Auditoria",
    nome_contato_cache: "Contato Auditoria",
    telefone: "5511999990001",
    status_atendimento: "em_atendimento",
    status_atendimento_real: "em_atendimento",
    atendente_id: 1,
    departamento_id: 1,
    unread_count: 0,
    ultima_atividade: "2026-07-24T20:00:00.000Z",
    ultima_mensagem: {
      id: 10,
      conversa_id: 1,
      texto: "Mensagem inicial",
      direcao: "in",
      criado_em: "2026-07-24T20:00:00.000Z",
    },
  },
  {
    id: 2,
    contato_nome: "Segunda Conversa",
    nome_contato_cache: "Segunda Conversa",
    telefone: "5511999990002",
    status_atendimento: "em_atendimento",
    status_atendimento_real: "em_atendimento",
    atendente_id: 1,
    departamento_id: 1,
    unread_count: 2,
    ultima_atividade: "2026-07-24T19:59:00.000Z",
  },
];

function conversationPayload(id) {
  const chat = chats.find((item) => String(item.id) === String(id)) || chats[0];
  return {
    conversa: { ...chat, cliente_nome: chat.contato_nome, mensagens_bloqueadas: false },
    mensagens: [
      {
        id: Number(id) * 100,
        conversa_id: Number(id),
        texto: `Histórico ${id}`,
        direcao: "in",
        criado_em: "2026-07-24T19:58:00.000Z",
        status: "lido",
      },
    ],
    next_cursor: null,
    tags: [],
  };
}

async function installAuditSession(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "zap_erp_auth",
      JSON.stringify({
        token: "audit-local-token",
        user: {
          id: 1,
          nome: "Auditor Local",
          email: "audit@local.test",
          perfil: "admin",
          role: "admin",
          departamento_ids: [1],
        },
      })
    );
  });
}

async function installFakeAudioRecorder(page) {
  await page.addInitScript(() => {
    const track = {
      readyState: "live",
      stop() {
        this.readyState = "ended";
      },
      addEventListener() {},
      removeEventListener() {},
    };
    const stream = {
      getAudioTracks: () => [track],
      getTracks: () => [track],
    };

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => stream },
    });
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: { query: async () => ({ state: "granted" }) },
    });

    class FakeMediaRecorder {
      static isTypeSupported() {
        return true;
      }

      constructor(_stream, options = {}) {
        this.mimeType = options.mimeType || "audio/webm";
        this.state = "inactive";
        this.emitted = false;
      }

      start() {
        this.state = "recording";
      }

      requestData() {
        if (this.emitted) return;
        this.emitted = true;
        const data = new Blob([new Uint8Array(2048)], { type: this.mimeType });
        this.ondataavailable?.({ data });
      }

      stop() {
        this.requestData();
        this.state = "inactive";
        queueMicrotask(() => this.onstop?.());
      }
    }

    class FakeAudio {
      removeAttribute() {}
      load() {}
      set src(_value) {
        queueMicrotask(() => this.onerror?.());
      }
    }

    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: FakeMediaRecorder,
    });
    Object.defineProperty(window, "Audio", {
      configurable: true,
      value: FakeAudio,
    });
  });
}

test("mensagens consecutivas entram na fila sem duplo envio", async ({ page }, testInfo) => {
  const postedTexts = [];
  let nextMessageId = 1000;

  await installAuditSession(page);

  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path.startsWith("/socket.io")) {
      await route.abort();
      return;
    }
    if (path === "/usuarios/me") {
      await route.fulfill({ json: { id: 1, perfil: "admin", role: "admin" } });
      return;
    }
    if (path === "/usuarios/me/permissoes") {
      await route.fulfill({ json: { permissoes: [] } });
      return;
    }
    if (path === "/config/empresa") {
      await route.fulfill({ json: { id: 1, nome: "ZapERP Auditoria" } });
      return;
    }
    if (path === "/chats/whatsapp-instances") {
      await route.fulfill({ json: { instances: [], active_count: 0 } });
      return;
    }
    if (path === "/tags" || path === "/dashboard/departamentos") {
      await route.fulfill({ json: [] });
      return;
    }
    if (path === "/chats/counts") {
      await route.fulfill({
        json: {
          todas: chats.length,
          minha_fila: chats.length,
          em_atendimento: chats.length,
          aguardando_cliente: 0,
          aguardando_atendente: 0,
        },
      });
      return;
    }
    if (path === "/chats" && request.method() === "GET") {
      await route.fulfill({ json: chats });
      return;
    }
    const detailMatch = path.match(/^\/chats\/(\d+)$/);
    if (detailMatch && request.method() === "GET") {
      await route.fulfill({ json: conversationPayload(detailMatch[1]) });
      return;
    }
    const sendMatch = path.match(/^\/chats\/(\d+)\/mensagens$/);
    if (sendMatch && request.method() === "POST") {
      const body = request.postDataJSON();
      postedTexts.push({ conversaId: Number(sendMatch[1]), texto: body.texto });
      await new Promise((resolve) => setTimeout(resolve, 1200));
      nextMessageId += 1;
      await route.fulfill({
        json: {
          mensagem: {
            id: nextMessageId,
            conversa_id: Number(sendMatch[1]),
            texto: body.texto,
            client_temp_id: body.client_temp_id,
            direcao: "out",
            criado_em: new Date().toISOString(),
            status: "enviado",
          },
        },
      });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.goto("/atendimento");
  const rows = page.locator(".chat-list-row");
  await expect(rows).toHaveCount(2);
  if (testInfo.project.name.includes("mobile")) {
    await rows.nth(0).tap();
  } else {
    await rows.nth(0).click();
  }

  const composer = page.locator(".wa-input");
  await expect(composer).toBeVisible();

  await composer.fill("auditoria sequencial 1");
  if (testInfo.project.name.includes("mobile")) {
    await page.getByRole("button", { name: "Enviar mensagem" }).click();
  } else {
    await composer.press("Enter");
  }
  await composer.fill("auditoria sequencial 2");
  if (testInfo.project.name.includes("mobile")) {
    await page.getByRole("button", { name: "Enviar mensagem" }).click();
  } else {
    await composer.press("Enter");
  }

  await expect(page.locator(".wa-bubble").filter({ hasText: "Auditoria sequencial 1" })).toHaveCount(1);
  await expect(page.locator(".wa-bubble").filter({ hasText: "Auditoria sequencial 2" })).toHaveCount(1);

  await composer.fill("auditoria clique duplo");
  const send = page.getByRole("button", { name: "Enviar mensagem" });
  await expect(send).toBeEnabled();
  await send.dblclick();
  await expect(page.locator(".wa-bubble").filter({ hasText: "Auditoria clique duplo" })).toHaveCount(1);

  await expect.poll(() => postedTexts.length, { timeout: 10_000 }).toBe(3);
  expect(postedTexts).toEqual([
    { conversaId: 1, texto: "Auditoria sequencial 1" },
    { conversaId: 1, texto: "Auditoria sequencial 2" },
    { conversaId: 1, texto: "Auditoria clique duplo" },
  ]);
});

test("áudios consecutivos aparecem imediatamente e mantêm upload FIFO", async ({ page }, testInfo) => {
  const uploadedTempIds = [];
  let activeUploads = 0;
  let maxActiveUploads = 0;
  let nextMessageId = 3000;
  let liberarPrimeiroUpload = () => {};
  const primeiroUploadLiberado = new Promise((resolve) => {
    liberarPrimeiroUpload = resolve;
  });

  await installAuditSession(page);
  await installFakeAudioRecorder(page);

  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path.startsWith("/socket.io")) {
      await route.abort();
      return;
    }
    if (path === "/usuarios/me") {
      await route.fulfill({ json: { id: 1, perfil: "admin", role: "admin" } });
      return;
    }
    if (path === "/usuarios/me/permissoes") {
      await route.fulfill({ json: { permissoes: [] } });
      return;
    }
    if (path === "/config/empresa") {
      await route.fulfill({ json: { id: 1, nome: "ZapERP Auditoria" } });
      return;
    }
    if (path === "/chats/whatsapp-instances") {
      await route.fulfill({ json: { instances: [], active_count: 0 } });
      return;
    }
    if (path === "/tags" || path === "/dashboard/departamentos") {
      await route.fulfill({ json: [] });
      return;
    }
    if (path === "/chats/counts") {
      await route.fulfill({ json: { todas: 2, minha_fila: 2, em_atendimento: 2 } });
      return;
    }
    if (path === "/chats" && request.method() === "GET") {
      await route.fulfill({ json: chats });
      return;
    }
    if (path === "/chats/1" && request.method() === "GET") {
      await route.fulfill({ json: conversationPayload(1) });
      return;
    }
    if (path === "/chats/1/arquivo" && request.method() === "POST") {
      const multipart = request.postData() || "";
      const tempId =
        multipart.match(/name="client_temp_id"\r?\n\r?\n([^\r\n]+)/)?.[1]?.trim() ||
        `sem-temp-${uploadedTempIds.length + 1}`;
      uploadedTempIds.push(tempId);
      activeUploads += 1;
      maxActiveUploads = Math.max(maxActiveUploads, activeUploads);
      const numeroUpload = uploadedTempIds.length;
      if (numeroUpload === 1) {
        await primeiroUploadLiberado;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
      nextMessageId += 1;
      await route.fulfill({
        json: {
          id: nextMessageId,
          conversa_id: 1,
          client_temp_id: tempId,
          direcao: "out",
          tipo: "audio",
          status: "enviado",
          criado_em: new Date().toISOString(),
          url: `/uploads/audio-${nextMessageId}.webm`,
        },
      });
      activeUploads -= 1;
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.goto("/atendimento");
  const firstRow = page.locator(".chat-list-row").filter({ hasText: "Contato Auditoria" });
  await expect(firstRow).toBeVisible({ timeout: 30_000 });
  if (testInfo.project.name.includes("mobile")) {
    await firstRow.tap();
  } else {
    await firstRow.click();
  }

  const record = page.getByRole("button", { name: "Gravar áudio" });
  const sendAudio = page.getByRole("button", { name: "Enviar áudio" });

  try {
    await record.click();
    await expect(sendAudio).toBeVisible();
    await page.waitForTimeout(850);
    await sendAudio.click();
    await expect(page.locator(".audio-message")).toHaveCount(1);
    await expect.poll(() => uploadedTempIds.length).toBe(1);

    await expect(record).toBeVisible();
    await record.click();
    await expect(sendAudio).toBeVisible();
    await page.waitForTimeout(850);
    await sendAudio.click();

    // O primeiro request fica deliberadamente aberto: assim provamos que o
    // segundo áudio aparece otimisticamente enquanto ainda aguarda sua vez,
    // sem depender da velocidade da máquina ou de um timeout arbitrário.
    await expect(page.locator(".audio-message")).toHaveCount(2);
    expect(uploadedTempIds).toHaveLength(1);
    const pendingAudioCount = await page.locator(".audio-message .wa-ticks.isPending").count();
    expect(pendingAudioCount).toBeGreaterThanOrEqual(1);
  } finally {
    liberarPrimeiroUpload();
  }

  await expect.poll(() => uploadedTempIds.length, { timeout: 10_000 }).toBe(2);
  expect(new Set(uploadedTempIds).size).toBe(2);
  expect(maxActiveUploads).toBe(1);
});

test("troca rápida ignora resposta antiga e mantém thread longo virtualizado", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "Cenário de troca paralela entre duas colunas é desktop.");
  await installAuditSession(page);

  const longMessages = Array.from({ length: 2000 }, (_, index) => ({
    id: 20_000 + index,
    conversa_id: 2,
    texto: `Mensagem longa ${index + 1}`,
    direcao: index % 2 === 0 ? "in" : "out",
    criado_em: new Date(Date.UTC(2026, 6, 20, 12, 0, 0) + index * 1000).toISOString(),
    status: "lido",
  }));

  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path.startsWith("/socket.io")) {
      await route.abort();
      return;
    }
    if (path === "/usuarios/me") {
      await route.fulfill({ json: { id: 1, perfil: "admin", role: "admin" } });
      return;
    }
    if (path === "/usuarios/me/permissoes") {
      await route.fulfill({ json: { permissoes: [] } });
      return;
    }
    if (path === "/config/empresa") {
      await route.fulfill({ json: { id: 1, nome: "ZapERP Auditoria" } });
      return;
    }
    if (path === "/chats/whatsapp-instances") {
      await route.fulfill({ json: { instances: [], active_count: 0 } });
      return;
    }
    if (path === "/tags" || path === "/dashboard/departamentos") {
      await route.fulfill({ json: [] });
      return;
    }
    if (path === "/chats/counts") {
      await route.fulfill({ json: { todas: 2, minha_fila: 2, em_atendimento: 2 } });
      return;
    }
    if (path === "/chats" && request.method() === "GET") {
      await route.fulfill({ json: chats });
      return;
    }
    if (path === "/chats/1" && request.method() === "GET") {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.fulfill({ json: conversationPayload(1) }).catch(() => {});
      return;
    }
    if (path === "/chats/2" && request.method() === "GET") {
      await route.fulfill({
        json: {
          conversa: {
            ...chats[1],
            cliente_nome: chats[1].contato_nome,
            mensagens_bloqueadas: false,
          },
          mensagens: longMessages,
          next_cursor: null,
          tags: [],
        },
      });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.goto("/atendimento");
  const rows = page.locator(".chat-list-row");
  await expect(rows).toHaveCount(2);
  const firstRow = rows.filter({ hasText: "Contato Auditoria" });
  const secondRow = rows.filter({ hasText: "Segunda Conversa" });
  await expect(firstRow).toHaveCount(1);
  await expect(secondRow).toHaveCount(1);

  await firstRow.click();
  await secondRow.click();

  const header = page.locator(".wa-header");
  await expect(header).toContainText("Segunda Conversa");
  await page.waitForTimeout(1400);
  await expect(header).toContainText("Segunda Conversa");
  await expect(header).not.toContainText("Contato Auditoria");

  const renderedBubbles = page.locator(".wa-bubble");
  const renderedCount = await renderedBubbles.count();
  expect(renderedCount).toBeGreaterThan(0);
  expect(renderedCount).toBeLessThan(80);

  const scrollGap = await page.locator(".wa-messages").evaluate((element) =>
    Math.max(0, element.scrollHeight - element.clientHeight - element.scrollTop)
  );
  expect(scrollGap).toBeLessThan(240);
});

test("abertura e envio mantêm o thread visualmente estável", async ({ page }, testInfo) => {
  await installAuditSession(page);

  const stableMessages = Array.from({ length: 120 }, (_, index) => ({
    id: 40_000 + index,
    conversa_id: 1,
    texto: `Mensagem de estabilidade ${index + 1} ${"conteúdo ".repeat((index % 4) + 1)}`,
    direcao: index % 2 === 0 ? "in" : "out",
    criado_em: new Date(Date.UTC(2026, 6, 24, 12, 0, 0) + index * 1000).toISOString(),
    status: "lido",
  }));

  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path.startsWith("/socket.io")) {
      await route.abort();
      return;
    }
    if (path === "/usuarios/me") {
      await route.fulfill({ json: { id: 1, perfil: "admin", role: "admin" } });
      return;
    }
    if (path === "/usuarios/me/permissoes") {
      await route.fulfill({ json: { permissoes: [] } });
      return;
    }
    if (path === "/config/empresa") {
      await route.fulfill({ json: { id: 1, nome: "ZapERP Auditoria" } });
      return;
    }
    if (path === "/chats/whatsapp-instances") {
      await route.fulfill({ json: { instances: [], active_count: 0 } });
      return;
    }
    if (path === "/tags" || path === "/dashboard/departamentos") {
      await route.fulfill({ json: [] });
      return;
    }
    if (path === "/chats/counts") {
      await route.fulfill({ json: { todas: 2, minha_fila: 2, em_atendimento: 2 } });
      return;
    }
    if (path === "/chats" && request.method() === "GET") {
      await route.fulfill({ json: chats });
      return;
    }
    if (path === "/chats/1" && request.method() === "GET") {
      await new Promise((resolve) => setTimeout(resolve, 180));
      await route.fulfill({
        json: {
          conversa: { ...chats[0], cliente_nome: chats[0].contato_nome, mensagens_bloqueadas: false },
          mensagens: stableMessages,
          next_cursor: null,
          tags: [],
        },
      });
      return;
    }
    if (path === "/chats/1/mensagens" && request.method() === "POST") {
      const body = request.postDataJSON();
      await new Promise((resolve) => setTimeout(resolve, 350));
      await route.fulfill({
        json: {
          mensagem: {
            id: 50_001,
            conversa_id: 1,
            texto: body.texto,
            client_temp_id: body.client_temp_id,
            direcao: "out",
            criado_em: new Date().toISOString(),
            status: "enviado",
          },
        },
      });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.goto("/atendimento");
  const firstRow = page.locator(".chat-list-row").filter({ hasText: "Contato Auditoria" });
  await expect(firstRow).toHaveCount(1);
  if (testInfo.project.name.includes("mobile")) {
    await firstRow.tap();
  } else {
    await firstRow.click();
  }

  const threadRoot = page.locator(".wa-messages-virtual-root");
  await expect(threadRoot).toBeVisible();
  await expect(page.locator(".wa-messages")).not.toHaveClass(/wa-messages--opening/);

  const revealStyle = await threadRoot.evaluate((element) => {
    const style = getComputedStyle(element);
    return { animationName: style.animationName, opacity: Number(style.opacity) };
  });

  const composer = page.locator(".wa-input");
  await composer.fill("Linha visual 1\nLinha visual 2\nLinha visual 3");
  await page.locator(".wa-messages").evaluate((element) => {
    window.__waVisualSamples = [];
    const startedAt = performance.now();
    const sample = () => {
      const gap = Math.max(0, element.scrollHeight - element.clientHeight - element.scrollTop);
      window.__waVisualSamples.push(gap);
      if (performance.now() - startedAt < 700) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });

  await page.getByRole("button", { name: "Enviar mensagem" }).click();
  await expect(page.locator(".wa-bubble").filter({ hasText: "Linha visual 1" })).toHaveCount(1);
  await page.waitForTimeout(750);

  const scrollSamples = await page.evaluate(() => window.__waVisualSamples || []);
  expect(scrollSamples.length).toBeGreaterThan(5);
  const displacedFrames = scrollSamples.filter((gap) => gap > 4);
  expect(
    displacedFrames.length,
    `gaps observados: ${JSON.stringify(scrollSamples.slice(0, 20))}`
  ).toBeLessThanOrEqual(1);
  expect(scrollSamples.at(-1)).toBeLessThanOrEqual(4);
  expect(revealStyle.animationName).toBe("none");
  expect(revealStyle.opacity).toBe(1);
});

test("historico com muitas midias abre e envia sem saltos tardios", async ({ page }, testInfo) => {
  await installAuditSession(page);

  const mixedMessages = Array.from({ length: 180 }, (_, index) => {
    const base = {
      id: 60_000 + index,
      conversa_id: 1,
      direcao: index % 2 === 0 ? "in" : "out",
      criado_em: new Date(Date.UTC(2026, 6, 25, 12, 0, 0) + index * 1000).toISOString(),
      status: "lido",
    };
    if (index % 5 === 1) {
      return { ...base, tipo: "imagem", url: `/uploads/audit-image-${index}.svg` };
    }
    if (index % 5 === 3) {
      return {
        ...base,
        tipo: "audio",
        url: `/uploads/audit-audio-${index}.ogg`,
        audio_duracao_sec: 2,
      };
    }
    return {
      ...base,
      tipo: "texto",
      texto: `Mensagem mista ${index + 1} ${"conteudo ".repeat((index % 3) + 1)}`,
    };
  });

  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path.startsWith("/socket.io")) {
      await route.abort();
      return;
    }
    if (/^\/uploads\/audit-image-\d+\.svg$/.test(path)) {
      const imageNumber = Number(path.match(/(\d+)/)?.[1] || 0);
      await new Promise((resolve) => setTimeout(resolve, 180 + (imageNumber % 4) * 90));
      const portrait = imageNumber % 2 === 0;
      const width = portrait ? 360 : 640;
      const height = portrait ? 540 : 360;
      await route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#d9ece6"/><circle cx="50%" cy="45%" r="72" fill="#79b8a5"/></svg>`,
      });
      return;
    }
    if (/^\/uploads\/audit-audio-\d+\.ogg$/.test(path)) {
      await new Promise((resolve) => setTimeout(resolve, 120));
      await route.fulfill({ status: 200, contentType: "audio/ogg", body: auditAudioFixture });
      return;
    }
    if (path === "/usuarios/me") {
      await route.fulfill({ json: { id: 1, perfil: "admin", role: "admin" } });
      return;
    }
    if (path === "/usuarios/me/permissoes") {
      await route.fulfill({ json: { permissoes: [] } });
      return;
    }
    if (path === "/config/empresa") {
      await route.fulfill({ json: { id: 1, nome: "ZapERP Auditoria" } });
      return;
    }
    if (path === "/chats/whatsapp-instances") {
      await route.fulfill({ json: { instances: [], active_count: 0 } });
      return;
    }
    if (path === "/tags" || path === "/dashboard/departamentos") {
      await route.fulfill({ json: [] });
      return;
    }
    if (path === "/chats/counts") {
      await route.fulfill({ json: { todas: 2, minha_fila: 2, em_atendimento: 2 } });
      return;
    }
    if (path === "/chats" && request.method() === "GET") {
      await route.fulfill({ json: chats });
      return;
    }
    if (path === "/chats/1" && request.method() === "GET") {
      await route.fulfill({
        json: {
          conversa: { ...chats[0], cliente_nome: chats[0].contato_nome, mensagens_bloqueadas: false },
          mensagens: mixedMessages,
          next_cursor: null,
          tags: [],
        },
      });
      return;
    }
    if (path === "/chats/1/mensagens" && request.method() === "POST") {
      const body = request.postDataJSON();
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.fulfill({
        json: {
          mensagem: {
            id: 70_001,
            conversa_id: 1,
            texto: body.texto,
            client_temp_id: body.client_temp_id,
            direcao: "out",
            criado_em: new Date().toISOString(),
            status: "enviado",
          },
        },
      });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.goto("/atendimento");
  const firstRow = page.locator(".chat-list-row").filter({ hasText: "Contato Auditoria" });
  await expect(firstRow).toBeVisible();
  if (testInfo.project.name.includes("mobile")) {
    await firstRow.tap();
  } else {
    await firstRow.click();
  }

  const messages = page.locator(".wa-messages");
  await expect(page.locator(".wa-messages-virtual-root")).toBeVisible();
  await messages.evaluate((element) => {
    window.__waMediaSamples = [];
    const startedAt = performance.now();
    const sample = () => {
      window.__waMediaSamples.push(
        Math.max(0, element.scrollHeight - element.clientHeight - element.scrollTop)
      );
      if (performance.now() - startedAt < 1100) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });

  await expect(page.locator(".wa-bubble-img").first()).toBeVisible();
  await expect(page.locator(".audio-message").first()).toBeVisible();
  await page.waitForTimeout(1150);

  const openingSamples = await page.evaluate(() => window.__waMediaSamples || []);
  expect(openingSamples.length).toBeGreaterThan(20);
  expect(
    openingSamples.filter((gap) => gap > 6).length,
    `gaps de abertura: ${JSON.stringify(openingSamples.slice(0, 30))}`
  ).toBeLessThanOrEqual(2);
  expect(openingSamples.at(-1)).toBeLessThanOrEqual(6);

  const renderedCount = await page.locator(".wa-bubble").count();
  expect(renderedCount).toBeGreaterThan(0);
  expect(renderedCount).toBeLessThan(80);

  const composer = page.locator(".wa-input");
  await composer.fill("Mensagem apos historico pesado");
  await page.getByRole("button", { name: "Enviar mensagem" }).click();
  await expect(page.locator(".wa-bubble").filter({ hasText: "Mensagem apos historico pesado" })).toHaveCount(1);
  await expect.poll(
    () => messages.evaluate((element) => Math.max(0, element.scrollHeight - element.clientHeight - element.scrollTop)),
    { timeout: 5_000 }
  ).toBeLessThanOrEqual(6);
});
