export type Role = "admin" | "lider" | "almoxarifado" | "funcionario";
export type Page =
  | "dashboard"
  | "requisicoes"
  | "funcionarios"
  | "historico"
  | "solicitacoes"
  | "estoque"
  | "devolucoes"
  | "compra"
  | "recomendacoes"
  | "nova";
export const roleLanding: Record<Role, string> = {
  admin: "/admin/dashboard",
  lider: "/department-head/dashboard",
  almoxarifado: "/warehouse/dashboard",
  funcionario: "/employee/request",
};
export const pagePaths: Record<Role, Partial<Record<Page, string>>> = {
  admin: {
    dashboard: "/admin/dashboard",
    requisicoes: "/admin/all-requests",
    funcionarios: "/admin/create",
    historico: "/admin/history",
  },
  lider: {
    dashboard: "/department-head/dashboard",
    solicitacoes: "/department-head/requests",
    historico: "/department-head/history",
  },
  almoxarifado: {
    dashboard: "/warehouse/dashboard",
    requisicoes: "/warehouse/requests",
    estoque: "/warehouse/stock/all/all",
    devolucoes: "/warehouse/returns",
    compra: "/warehouse/dashboard?view=compra",
    recomendacoes: "/warehouse/dashboard?view=recomendacoes",
    historico: "/warehouse/history",
  },
  funcionario: { nova: "/employee/request", historico: "/employee/history" },
};
export function pathFor(role: Role, page: Page) {
  return pagePaths[role][page] ?? roleLanding[role];
}
