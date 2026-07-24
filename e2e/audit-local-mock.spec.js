import { test, expect } from "@playwright/test";

const API = "https://zapapi.wmsistemas.inf.br";

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
