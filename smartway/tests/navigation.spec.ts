import { expect, test } from "@playwright/test";

const accounts = [
  { id: "1001", role: "funcionario", panel: "/employee/request" },
  { id: "1002", role: "lider", panel: "/department-head/dashboard" },
  { id: "1003", role: "almoxarifado", panel: "/warehouse/dashboard" },
  { id: "1004", role: "admin", panel: "/admin/dashboard" },
];

for (const account of accounts) {
  test(`${account.role}: conta fixa, voltar, restrição de perfil e sair`, async ({ page, baseURL }) => {
    const login = await page.request.post("/api/login", {
      headers: { origin: baseURL! },
      data: { identity: account.id, password: "Marcon@123" },
    });
    expect(login.status()).toBe(200);
    await page.goto(account.panel);
    await expect(page.getByRole("link", { name: "Voltar", exact: true })).toBeVisible();
    await expect(page.getByText(/trocar (usuário|perfil|conta)/i)).toHaveCount(0);
    if (account.role === "almoxarifado") {
      await page.goto("/warehouse/stock/all/all");
      await page.getByRole("link", { name: "Voltar", exact: true }).click();
      await expect(page).toHaveURL(account.panel);
    }
    await page.getByRole("link", { name: "Voltar", exact: true }).click();
    await expect(page).toHaveURL(`/inicio/${account.role}`);
    const other = accounts.find((item) => item.role !== account.role)!;
    await page.goto(other.panel);
    await expect(page).toHaveURL(`/inicio/${account.role}`);
    await page.goto(account.panel);
    await page.getByRole("button", { name: "Sair da conta" }).click();
    await expect(page).toHaveURL("/login");
    await page.goto(account.panel);
    await expect(page).toHaveURL("/login");
  });
}
