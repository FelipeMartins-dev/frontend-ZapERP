# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke.spec.js >> ZapERP smoke >> login válido, lista de conversas e refresh de sessão
- Location: e2e\smoke.spec.js:23:3

# Error details

```
Error: expect(page).toHaveURL(expected) failed

Expected pattern: /\/atendimento/
Received string:  "http://localhost:5173/login"
Timeout: 30000ms

Call log:
  - Expect "toHaveURL" with timeout 30000ms
    63 × unexpected value "http://localhost:5173/login"

```

```yaml
- form "Formulário de login":
  - heading "ZapERP · Login" [level=2]
  - text: E-mail
  - textbox "E-mail":
    - /placeholder: seu@email.com
    - text: e2e-audit@zaperp.local
  - text: Senha
  - textbox "Senha":
    - /placeholder: ••••••••
    - text: E2eAudit2026!
  - button "Entrar"
  - alert: Sem conexão com a API (https://zaperpapi.wmsistemas.inf.br). Confira se o backend está no ar e se VITE_API_URL no .env.local aponta para o mesmo servidor.
  - paragraph: "API: https://zaperpapi.wmsistemas.inf.br"
```

# Test source

```ts
  1  | import { test, expect } from "@playwright/test";
  2  | 
  3  | const EMAIL = process.env.ZAPERP_TEST_EMAIL || "e2e-audit@zaperp.local";
  4  | const PASSWORD = process.env.ZAPERP_TEST_PASSWORD || "E2eAudit2026!";
  5  | 
  6  | async function login(page) {
  7  |   await page.goto("/login");
  8  |   await page.getByLabel(/e-mail/i).fill(EMAIL);
  9  |   await page.getByLabel(/senha/i).fill(PASSWORD);
  10 |   await page.getByRole("button", { name: /entrar/i }).click();
> 11 |   await expect(page).toHaveURL(/\/atendimento/, { timeout: 30_000 });
     |                      ^ Error: expect(page).toHaveURL(expected) failed
  12 | }
  13 | 
  14 | test.describe("ZapERP smoke", () => {
  15 |   test("login inválido exibe erro", async ({ page }) => {
  16 |     await page.goto("/login");
  17 |     await page.getByLabel(/e-mail/i).fill("invalido@test.local");
  18 |     await page.getByLabel(/senha/i).fill("senhaerrada");
  19 |     await page.getByRole("button", { name: /entrar/i }).click();
  20 |     await expect(page.getByText(/incorret|inválid|credencial/i)).toBeVisible({ timeout: 15_000 });
  21 |   });
  22 | 
  23 |   test("login válido, lista de conversas e refresh de sessão", async ({ page }) => {
  24 |     const consoleErrors = [];
  25 |     page.on("console", (msg) => {
  26 |       if (msg.type() === "error") consoleErrors.push(msg.text());
  27 |     });
  28 | 
  29 |     await login(page);
  30 |     await expect(page.locator(".chat-list-root").first()).toBeVisible({
  31 |       timeout: 30_000,
  32 |     });
  33 | 
  34 |     await page.reload();
  35 |     await expect(page).toHaveURL(/\/atendimento/);
  36 |     await expect(page.locator(".chat-list-root").first()).toBeVisible({
  37 |       timeout: 30_000,
  38 |     });
  39 | 
  40 |     const critical = consoleErrors.filter(
  41 |       (t) => !/favicon|manifest|service-worker|ResizeObserver|Failed to load resource/i.test(t)
  42 |     );
  43 |     expect(critical, `console errors: ${critical.join(" | ")}`).toEqual([]);
  44 |   });
  45 | 
  46 |   test("abrir conversa e enviar mensagem de texto", async ({ page }) => {
  47 |     await login(page);
  48 | 
  49 |     const row = page.locator(".chat-list-row").first();
  50 |     await expect(row).toBeVisible({ timeout: 30_000 });
  51 |     await row.click();
  52 | 
  53 |     const composer = page.locator(
  54 |       "textarea[placeholder*='mensagem'], textarea[placeholder*='Mensagem'], .wa-composer textarea, [contenteditable='true']"
  55 |     ).first();
  56 |     await expect(composer).toBeVisible({ timeout: 20_000 });
  57 | 
  58 |     const marker = `[E2E-PW] ${Date.now()}`;
  59 |     await composer.fill(marker);
  60 |     await page.keyboard.press("Enter");
  61 | 
  62 |     await expect(page.getByText(marker, { exact: false })).toBeVisible({ timeout: 25_000 });
  63 | 
  64 |     await page.reload();
  65 |     await expect(page.getByText(marker, { exact: false })).toBeVisible({ timeout: 30_000 });
  66 |   });
  67 | 
  68 |   test("rota protegida redireciona sem permissão simulada", async ({ page }) => {
  69 |     await login(page);
  70 |     await page.evaluate(() => {
  71 |       const raw = localStorage.getItem("zap_erp_auth");
  72 |       if (!raw) return;
  73 |       const parsed = JSON.parse(raw);
  74 |       parsed.user = { ...parsed.user, role: "atendente", perfil: "atendente" };
  75 |       localStorage.setItem("zap_erp_auth", JSON.stringify(parsed));
  76 |     });
  77 |     await page.goto("/permissoes");
  78 |     await expect(page).toHaveURL(/\/atendimento/, { timeout: 15_000 });
  79 |   });
  80 | });
  81 | 
```