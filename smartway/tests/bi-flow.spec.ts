import { expect, test } from "@playwright/test";

async function login(page: import("@playwright/test").Page, identity: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail ou matrícula").fill(identity);
  await page.getByLabel("Senha", { exact: true }).fill("Marcon@123");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/inicio\//);
}

test("administrador vê pedidos ativos na fila e concluídos no histórico", async ({
  page,
}) => {
  await login(page, "rafael@marcon.demo");
  await page.goto("/admin/all-requests");
  await expect(
    page.getByRole("heading", { name: "Requisições", exact: true }),
  ).toBeVisible();
  await expect(page.locator("tbody")).toContainText("Rolamento 6205 ZZ");
  await expect(page.locator("tbody")).not.toContainText("Retentor 35×52×7");
  await page.goto("/admin/history");
  await expect(
    page.getByRole("heading", { name: "Histórico de requisições" }),
  ).toBeVisible();
  await expect(page.locator("tbody").first()).toContainText("Retentor 35×52×7");
  await expect(page.locator("tbody").first()).not.toContainText(
    "Rolamento 6205 ZZ",
  );
  await page.getByLabel("Situação").selectOption("Cancelada");
  await expect(
    page.getByRole("heading", { name: "Nenhuma requisição encontrada" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Limpar filtros" }).first().click();
  await expect(page.locator("tbody").first()).toContainText("Retentor 35×52×7");
});

test("almoxarifado mostra somente pedidos para separação", async ({ page }) => {
  await login(page, "mariana@marcon.demo");
  await page.goto("/warehouse/requests");
  await expect(page.locator("tbody")).toContainText("Correia industrial A-42");
  await expect(page.locator("tbody")).not.toContainText("Rolamento 6205 ZZ");
  await expect(page.locator("tbody")).not.toContainText("Retentor 35×52×7");
});

test("dashboard prioriza resumo, indicadores e gráficos simples", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, "rafael@marcon.demo");
  await page.goto("/admin/dashboard");
  await expect(page.locator(".dashboard-health")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Etapas dos pedidos" }),
  ).toBeVisible();
  await expect(page.getByRole("img", { name: /Pendente:/ })).toBeVisible();
  await page.screenshot({
    path: "test-results/bi-dashboard-desktop.png",
    fullPage: true,
  });
});

test("compra preditiva explica consumo e estado da peça em pop-up", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page, "mariana@marcon.demo");
  await page.goto("/warehouse/purchases");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("heading", { name: "Onde agir primeiro" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/bi-purchase-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Ver detalhes da previsão" })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Consumo médio")).toBeVisible();
  await expect(dialog.getByText("Compra sugerida")).toBeVisible();
  const unitCost = dialog.getByRole("spinbutton", {
    name: /Valor de referência unitária/,
  });
  await expect(unitCost).toBeVisible();
  await unitCost.fill("100");
  await unitCost.blur();
  await expect(dialog).toContainText("Investimento estimado");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await dialog.getByRole("button", { name: /Fechar/ }).click();
  await expect(dialog).not.toBeVisible();
});

test("topbar e rolagem ficam contidos no painel em telas estreitas", async ({ page }) => {
  await login(page, "rafael@marcon.demo");
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 700 });
    await page.goto("/admin/dashboard");
    await expect(page.getByRole("link", { name: "Smartway — página inicial" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(() => document.querySelector(".main")!.scrollHeight >= document.querySelector(".main")!.clientHeight)).toBe(true);
  }
  await page.setViewportSize({ width: 320, height: 700 });
  await page.getByRole("button", { name: "Abrir menu" }).click();
  await expect(page.getByRole("navigation", { name: "Navegação principal" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Abrir menu" })).toBeFocused();
});
