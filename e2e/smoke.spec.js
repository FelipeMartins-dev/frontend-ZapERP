import { test, expect } from "@playwright/test";

const EMAIL = process.env.ZAPERP_TEST_EMAIL || "e2e-audit@zaperp.local";
const PASSWORD = process.env.ZAPERP_TEST_PASSWORD || "E2eAudit2026!";

async function login(page) {
  await page.goto("/login");
  await page.getByLabel(/e-mail/i).fill(EMAIL);
  await page.getByLabel(/senha/i).fill(PASSWORD);
  await page.getByRole("button", { name: /entrar/i }).click();
  await expect(page).toHaveURL(/\/atendimento/, { timeout: 30_000 });
}

test.describe("ZapERP smoke", () => {
  test("login inválido exibe erro", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/e-mail/i).fill("invalido@test.local");
    await page.getByLabel(/senha/i).fill("senhaerrada");
    await page.getByRole("button", { name: /entrar/i }).click();
    await expect(page.getByText(/incorret|inválid|credencial/i)).toBeVisible({ timeout: 15_000 });
  });

  test("login válido, lista de conversas e refresh de sessão", async ({ page }) => {
    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await login(page);
    await expect(page.locator(".chat-list-root").first()).toBeVisible({
      timeout: 30_000,
    });

    await page.reload();
    await expect(page).toHaveURL(/\/atendimento/);
    await expect(page.locator(".chat-list-root").first()).toBeVisible({
      timeout: 30_000,
    });

    const critical = consoleErrors.filter(
      (t) => !/favicon|manifest|service-worker|ResizeObserver|Failed to load resource/i.test(t)
    );
    expect(critical, `console errors: ${critical.join(" | ")}`).toEqual([]);
  });

  test("abrir conversa e enviar mensagem de texto", async ({ page }) => {
    await login(page);

    const row = page.locator(".chat-list-row").first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

    const composer = page.locator(
      "textarea[placeholder*='mensagem'], textarea[placeholder*='Mensagem'], .wa-composer textarea, [contenteditable='true']"
    ).first();
    await expect(composer).toBeVisible({ timeout: 20_000 });

    const marker = `[E2E-PW] ${Date.now()}`;
    await composer.fill(marker);
    await page.keyboard.press("Enter");

    await expect(page.getByText(marker, { exact: false })).toBeVisible({ timeout: 25_000 });

    await page.reload();
    await expect(page.getByText(marker, { exact: false })).toBeVisible({ timeout: 30_000 });
  });

  test("rota protegida redireciona sem permissão simulada", async ({ page }) => {
    await login(page);
    await page.evaluate(() => {
      const raw = localStorage.getItem("zap_erp_auth");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      parsed.user = { ...parsed.user, role: "atendente", perfil: "atendente" };
      localStorage.setItem("zap_erp_auth", JSON.stringify(parsed));
    });
    await page.goto("/permissoes");
    await expect(page).toHaveURL(/\/atendimento/, { timeout: 15_000 });
  });
});
