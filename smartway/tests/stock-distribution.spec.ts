import { expect, test } from "@playwright/test";

test("warehouse transfers by QR and shows balances and history", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail ou matrícula").fill("mariana@marcon.demo");
  await page.getByLabel("Senha", { exact: true }).fill("Marcon@123");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.goto("/warehouse/dashboard?view=recomendacoes");
  await expect(page.getByRole("heading", { name: "Recomendação de estoque" })).toBeVisible();
  const first = page.locator(".recommendation-card").filter({ hasText: "Rolamento 6205 ZZ" }).first();
  await first.getByRole("button", { name: "Vou retirar" }).click();
  const dialog = page.getByRole("dialog", { name: "Confirmar transferência" });
  await dialog.getByLabel("Leia o QR Code ou digite o ID da embalagem").fill("ROL-6205-ZZ");
  await dialog.getByLabel("Quantidade").fill("1");
  await dialog.getByRole("button", { name: "Confirmar transferência" }).click();
  await expect(page.getByRole("status")).toContainText("transferida");
  await page.getByRole("button", { name: "Histórico", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Histórico de estoque" })).toBeVisible();
  await expect(page.getByText("Transferência #").first()).toBeVisible();
  await page.getByRole("button", { name: "Estoque", exact: true }).click();
  await expect(page.getByRole("tab", { name: /Central/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Almoxarifado 4/ })).toBeVisible();
});

test("warehouse dashboard, distribution and stock fit mobile screens", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail ou matrícula").fill("mariana@marcon.demo");
  await page.getByLabel("Senha", { exact: true }).fill("Marcon@123");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  for (const width of [320, 375, 768]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/warehouse/dashboard", "/warehouse/dashboard?view=recomendacoes", "/warehouse/stock/all/all"]) {
      await page.goto(route);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    }
  }
});
