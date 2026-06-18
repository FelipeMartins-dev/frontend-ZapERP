import { chromium, expect } from "@playwright/test";

const baseURL = process.env.AUDIT_BASE_URL || "http://localhost:5173";
const targetName = process.env.AUDIT_CONTACT || "Miguel WM";
const profileDir = process.env.AUDIT_PROFILE_DIR || ".tmp-zaperp-audit-profile";
const marker = `[AUDIT-ZapERP] ${new Date().toISOString()}`;
const headless = /^(1|true|yes)$/i.test(process.env.AUDIT_HEADLESS || "");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function log(message, data = undefined) {
  const suffix = data === undefined ? "" : ` ${JSON.stringify(data)}`;
  console.log(`[audit] ${message}${suffix}`);
}

async function firstVisible(page, selectors, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const loc = page.locator(selector).first();
      if ((await loc.count()) && (await loc.isVisible().catch(() => false))) return loc;
    }
    await sleep(250);
  }
  throw new Error(`Nenhum seletor visivel: ${selectors.join(" | ")}`);
}

async function clickByText(page, text, opts = {}) {
  const loc = page.getByText(text, { exact: opts.exact ?? false }).first();
  await expect(loc).toBeVisible({ timeout: opts.timeout ?? 15000 });
  await loc.click();
  return loc;
}

async function ensureLoggedIn(page) {
  await page.goto(`${baseURL}/atendimento`, { waitUntil: "domcontentloaded" });
  if (/\/login/i.test(page.url()) || (await page.getByRole("button", { name: /entrar/i }).count())) {
    log("login necessario: faca login na janela aberta; aguardando /atendimento");
    await page.waitForURL(/\/atendimento/, { timeout: 300000 });
  }
  await expect(page.locator(".chat-list-root, .chat-list-row, [class*='chat-list']").first()).toBeVisible({
    timeout: 45000,
  });
  log("atendimento carregado", { url: page.url() });
}

async function searchContact(page, term) {
  const todas = page.locator("button").filter({ hasText: /Todas/i }).first();
  if ((await todas.count()) && (await todas.isVisible().catch(() => false))) {
    await todas.click();
    await sleep(1000);
  }
  const search = await firstVisible(page, [
    "input[placeholder*='Buscar']",
    "input[placeholder*='nome']",
    "input[placeholder*='telefone']",
    "input[type='search']",
  ]);
  await search.click();
  await search.fill("");
  await search.fill(term);
  await sleep(1500);
  const rows = page.locator(".chat-list-row");
  await expect(rows.first()).toBeVisible({ timeout: 30000 });
  const count = await rows.count();
  const visibleTexts = [];
  for (let i = 0; i < Math.min(count, 8); i += 1) {
    visibleTexts.push((await rows.nth(i).innerText()).replace(/\s+/g, " ").trim());
  }
  log("resultado da busca", { term, count, visibleTexts });
  return rows.first();
}

async function openTargetConversation(page) {
  let row = await searchContact(page, targetName);
  const rowsText = (await page.locator(".chat-list-row").first().innerText()).toLowerCase();
  if (!rowsText.includes(targetName.toLowerCase().split(" ")[0])) {
    log("primeiro resultado nao contem o nome alvo, tentando termo parcial");
    row = await searchContact(page, "Miguel");
  }
  await row.click();
  await expect(page.locator("main").last()).toContainText(/Miguel|Wagner|Atendimento|Mensagem/i, { timeout: 30000 });
  log("conversa aberta", { row: (await row.innerText()).replace(/\s+/g, " ").trim() });
}

async function ensureWritableConversation(page) {
  const reopen = page.getByRole("button", { name: /reabrir|retomar/i }).first();
  if ((await reopen.count()) && (await reopen.isVisible().catch(() => false))) {
    await reopen.click();
    await sleep(1000);
    const confirm = page.getByRole("button", { name: /confirmar|reabrir|retomar|sim/i }).last();
    if ((await confirm.count()) && (await confirm.isVisible().catch(() => false))) {
      await confirm.click();
      await sleep(1500);
    }
    log("conversa reaberta/retomada para teste");
  }

  const assume = page.getByRole("button", { name: /assumir/i }).first();
  if ((await assume.count()) && (await assume.isVisible().catch(() => false))) {
    await assume.click();
    await sleep(1500);
    log("conversa assumida para teste");
  }

  await expect(page.locator(".wa-composer, textarea, [contenteditable='true']").first()).toBeVisible({
    timeout: 30000,
  });
}

async function sendMessage(page) {
  await ensureWritableConversation(page);
  const composer = await firstVisible(page, [
    ".wa-composer textarea",
    "textarea[placeholder*='mensagem']",
    "textarea[placeholder*='Mensagem']",
    "[contenteditable='true']",
  ]);
  await composer.click();
  await composer.fill(marker);
  const beforeRows = await page.locator(".chat-list-row").count();
  await page.keyboard.press("Enter");
  await expect(page.getByText(marker, { exact: false }).first()).toBeVisible({ timeout: 30000 });
  await sleep(2000);
  const afterRows = await page.locator(".chat-list-row").count();
  log("mensagem enviada/visivel", { marker, beforeRows, afterRows });
}

async function tryLoadOldMessages(page) {
  const candidates = [
    /carregar mensagens antigas deste contato/i,
    /mensagens antigas/i,
    /carregar histórico/i,
    /carregar historico/i,
  ];
  for (const pattern of candidates) {
    const btn = page.locator("button").filter({ hasText: pattern }).first();
    if ((await btn.count()) && (await btn.isVisible().catch(() => false))) {
      await btn.click();
      await sleep(5000);
      const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      log("carregar mensagens antigas acionado", {
        foundBy: String(pattern),
        nenhumHistorico: /Nenhuma mensagem antiga encontrada/i.test(body),
        erro: /erro|falha|não foi possível|nao foi possivel/i.test(body),
      });
      return;
    }
  }
  log("botao carregar mensagens antigas nao encontrado/nao visivel");
}

async function testFilter(page, label) {
  const chip = page.locator("button").filter({ hasText: new RegExp(label, "i") }).first();
  if (!(await chip.count()) || !(await chip.isVisible().catch(() => false))) {
    log("filtro nao visivel", { label });
    return;
  }
  await chip.click();
  await sleep(1800);
  const rowCount = await page.locator(".chat-list-row").count();
  const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  log("filtro validado", {
    label,
    rowCount,
    placeholderMensagemVisivel: body.includes("(mensagem)"),
  });
}

async function tryEndAndReopen(page) {
  const endButton = page
    .getByRole("button", { name: /encerrar|finalizar/i })
    .or(page.locator("button[title*='Encerrar'], button[title*='Finalizar']"))
    .first();
  if (!(await endButton.count()) || !(await endButton.isVisible().catch(() => false))) {
    log("botao encerrar nao visivel nesta conversa");
    return;
  }
  const before = await page.locator(".chat-list-row").count();
  await endButton.click();
  await sleep(500);
  const confirm = page.getByRole("button", { name: /confirmar|encerrar|finalizar|sim/i }).last();
  if ((await confirm.count()) && (await confirm.isVisible().catch(() => false))) {
    await confirm.click();
  }
  await sleep(2500);
  const after = await page.locator(".chat-list-row").count();
  log("encerramento testado", { before, after });

  const reopen = page.getByRole("button", { name: /reabrir|retomar/i }).first();
  if ((await reopen.count()) && (await reopen.isVisible().catch(() => false))) {
    await reopen.click();
    await sleep(1500);
    log("reabertura/retomada clicada");
  }
}

const browser = await chromium.launchPersistentContext(profileDir, {
  headless,
  viewport: { width: 1440, height: 900 },
});
const page = browser.pages()[0] || (await browser.newPage());
const consoleErrors = [];
const badResponses = [];

page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("response", (response) => {
  const status = response.status();
  const url = response.url();
  if (status >= 400 && !/favicon|manifest|sockjs|hot-update/i.test(url)) {
    badResponses.push({ status, url });
  }
});

try {
  await ensureLoggedIn(page);
  await sleep(2000);
  await testFilter(page, "Todas");
  await searchContact(page, "Miguel");
  await openTargetConversation(page);
  await tryLoadOldMessages(page);
  await sendMessage(page);
  for (const filter of ["Minha fila", "Todas", "Hoje", "Abertas", "Em atendimento", "Aguardando cliente", "Aguardando atendente"]) {
    await testFilter(page, filter);
  }
  await searchContact(page, "Miguel");
  await openTargetConversation(page);
  await tryEndAndReopen(page);

  const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  log("resumo", {
    url: page.url(),
    consoleErrors: consoleErrors.slice(-10),
    badResponses: badResponses.slice(-20),
    rawMensagemPlaceholderVisible: body.includes("(mensagem)"),
  });
} finally {
  await browser.close();
}
