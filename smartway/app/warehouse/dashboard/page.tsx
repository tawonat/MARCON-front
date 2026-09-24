import Workspace from "@/components/workspace/workspace";
export default async function Page({
  searchParams,
}: PageProps<"/warehouse/dashboard">) {
  const { view } = await searchParams;
  const page =
    view === "compra"
      ? "compra"
      : view === "recomendacoes"
        ? "recomendacoes"
        : "dashboard";
  return <Workspace role="almoxarifado" page={page} />;
}
