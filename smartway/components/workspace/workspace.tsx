"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDemoStore } from "./demo-store";
import { badge } from "./ui";
import { PurchaseScreen } from "./screens/purchase-screen";
import { RecommendationScreen } from "./screens/recommendation-screen";
import { EmployeeRequestScreen } from "./screens/employee-request-screen";
import { StaffScreen } from "./screens/staff-screen";
import { StockScreen } from "./screens/stock-screen";
import { ReturnsScreen } from "./screens/returns-screen";
import { DashboardScreen } from "./screens/dashboard-screen";
import { WarehouseDashboard } from "./screens/warehouse-dashboard";
import { RequestsScreen } from "./screens/requests-screen";
import { initialStock, type Request, type Part } from "@/lib/demo-data";
import {
  pathFor,
  roleLanding,
  type Role,
  type Page,
} from "@/lib/workspace-routes";
import {
  Boxes,
  RotateCcw,
  ChartNoAxesCombined,
  ClipboardList,
  History,
  Inbox,
  LayoutDashboard,
  Lightbulb,
  Menu,
  Plus,
  UsersRound,
  X,
} from "lucide-react";

const roles: Record<
  Role,
  { name: string; pages: { id: Page; label: string }[] }
> = {
  admin: {
    name: "Admin",
    pages: [
      { id: "dashboard", label: "Dashboard" },
      { id: "requisicoes", label: "Ver requisições" },
      { id: "funcionarios", label: "Funcionários" },
      { id: "historico", label: "Histórico" },
    ],
  },
  lider: {
    name: "Líder de bloco",
    pages: [
      { id: "dashboard", label: "Dashboard" },
      { id: "solicitacoes", label: "Solicitações" },
      { id: "historico", label: "Histórico do bloco" },
    ],
  },
  almoxarifado: {
    name: "Almoxarifado",
    pages: [
      { id: "dashboard", label: "Dashboard" },
      { id: "requisicoes", label: "Requisições" },
      { id: "estoque", label: "Estoque" },
      { id: "devolucoes", label: "Devoluções" },
      { id: "compra", label: "Compra preditiva" },
      { id: "recomendacoes", label: "Recomendação de estoque" },
      { id: "historico", label: "Histórico" },
    ],
  },
  funcionario: {
    name: "Funcionário",
    pages: [
      { id: "nova", label: "Fazer requisição" },
      { id: "historico", label: "Minhas requisições" },
    ],
  },
};
const pageIcons = {
  dashboard: LayoutDashboard,
  requisicoes: ClipboardList,
  funcionarios: UsersRound,
  historico: History,
  solicitacoes: Inbox,
  estoque: Boxes,
  devolucoes: RotateCcw,
  compra: ChartNoAxesCombined,
  recomendacoes: Lightbulb,
  nova: Plus,
};
function forecast(part: Part) {
  const daily = part.consumed30 / 30;
  return {
    arrival: Math.round(part.quantity - daily * part.leadDays),
    buy: Math.max(
      0,
      Math.ceil(daily * (part.leadDays + 15) + part.minimum - part.quantity),
    ),
    growth: part.previous30
      ? Math.round((part.consumed30 / part.previous30 - 1) * 100)
      : 0,
  };
}
function NavIcon({ page }: { page: Page }) {
  const Icon = pageIcons[page];
  return <Icon size={19} strokeWidth={1.9} aria-hidden="true" />;
}
export default function Workspace({
  role,
  page,
  routePart,
  dashboardView,
}: {
  role: Role;
  page: Page;
  routePart?: string;
  dashboardView?: string;
}) {
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const {
    requests,
    setRequests,
    stock,
    setStock,
    movements,
    setMovements,
    cart,
    setCart,
  } = useDemoStore();
  const [selectedPart, setSelectedPart] = useState(
    routePart && routePart !== "all"
      ? (stock.find(
          (part) =>
            String(part.id) === routePart ||
            part.code.toLowerCase() === routePart.toLowerCase(),
        )?.code ?? initialStock[0].code)
      : initialStock[0].code,
  );
  const [requestQuantity, setRequestQuantity] = useState(1);
  const [requestPriority, setRequestPriority] =
    useState<Request["priority"]>("Leve");
  const [detail, setDetail] = useState<Request | null>(null);
  const [qrCode, setQrCode] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("Todas");
  const [message, setMessage] = useState("");
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const current = roles[role];
  const active =
    current.pages.find((item) => item.id === page) ?? current.pages[0];
  const roleRequests = requests.filter((item) =>
    role === "funcionario"
      ? item.person === "Você"
      : role === "lider"
        ? item.block === "Bloco A"
        : true,
  );
  const shownRequests = roleRequests.filter(
    (item) =>
      (page !== "historico" ||
        role === "funcionario" ||
        item.status === "Entregue" ||
        item.status === "Cancelada") &&
      (statusFilter === "Todas" || item.status === statusFilter) &&
      (item.material + item.person + item.id)
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const sortedRequests = [...shownRequests].sort(
    (a, b) =>
      ({ Urgente: 0, Moderado: 1, Leve: 2 })[a.priority] -
      { Urgente: 0, Moderado: 1, Leve: 2 }[b.priority],
  );
  const requestRows =
    role === "almoxarifado" && page === "requisicoes"
      ? sortedRequests.filter((item) => item.status === "Aprovada")
      : shownRequests;
  const selectedStock =
    stock.find((part) => part.code === selectedPart) ?? stock[0];
  const atypical = requestQuantity > 10 || requestPriority === "Urgente";
  const purchaseItems = stock
    .map((item) => ({ item, projection: forecast(item) }))
    .filter(({ projection }) => projection.buy > 0)
    .sort((a, b) => a.projection.arrival - b.projection.arrival);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 800px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!drawerOpen) return;
    sidebar.current?.querySelector<HTMLElement>("button")?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setDrawerOpen(false);
      if (event.key !== "Tab" || !sidebar.current) return;
      const focusable = [
        ...sidebar.current.querySelectorAll<HTMLElement>("button"),
      ];
      if (event.shiftKey && document.activeElement === focusable[0]) {
        event.preventDefault();
        focusable.at(-1)?.focus();
      }
      if (!event.shiftKey && document.activeElement === focusable.at(-1)) {
        event.preventDefault();
        focusable[0]?.focus();
      }
    }
    const trigger = menuButton.current;
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      trigger?.focus();
    };
  }, [drawerOpen]);
  function navigate(next: Page) {
    router.push(pathFor(role, next));
    setDrawerOpen(false);
    setSearch("");
    setStatusFilter("Todas");
  }
  function changeRole(next: Role) {
    router.push(roleLanding[next]);
    setDrawerOpen(false);
    setMessage("");
  }
  function updateStatus(id: number, status: Request["status"]) {
    const request = requests.find((item) => item.id === id);
    if (!request) return false;
    const leaderAllowed =
      role === "lider" &&
      request.block === "Bloco A" &&
      request.status === "Pendente" &&
      ["Aprovada", "Cancelada"].includes(status);
    const warehouseAllowed =
      role === "almoxarifado" &&
      request.status === "Aprovada" &&
      ["Entregue", "Cancelada"].includes(status);
    if (!leaderAllowed && !warehouseAllowed) {
      setMessage("Ação indisponível para este perfil ou etapa.");
      return false;
    }
    if (status === "Entregue") {
      const part = stock.find(
        (item) => item.code === request.code || item.name === request.material,
      );
      if (!part || qrCode.trim().toUpperCase() !== (part.qrCode ?? part.code)) {
        setMessage("Confira o código QR/ID da embalagem antes da baixa.");
        return false;
      }
      if (part.quantity < request.quantity) {
        setMessage("Saldo insuficiente para esta separação.");
        return false;
      }
      setStock((items) =>
        items.map((item) =>
          item.code === part.code
            ? { ...item, quantity: item.quantity - request.quantity }
            : item,
        ),
      );
      setMovements((items) => [
        {
          id: Date.now(),
          partCode: part.code,
          type: "saida",
          quantity: request.quantity,
          date: new Date().toISOString().slice(0, 10),
          warehouse: part.warehouse,
          block: request.block,
          requester: request.person,
        },
        ...items,
      ]);
      setQrCode("");
    }
    setRequests((items) =>
      items.map((item) => (item.id === id ? { ...item, status } : item)),
    );
    setMessage("Situação atualizada nesta sessão.");
    return true;
  }
  function exportCsv(exportRows: Request[]) {
    const rows = [
      [
        "ID",
        "Peça",
        "Código",
        "Quantidade",
        "Solicitante",
        "Bloco",
        "Prioridade",
        "Situação",
        "Data",
      ],
      ...exportRows.map((item) => [
        item.id,
        item.material,
        item.code || "",
        item.quantity,
        item.person,
        item.block,
        item.priority,
        item.status,
        item.date,
      ]),
    ];
    const csv = rows
      .map((row) => row.map((value) => JSON.stringify(String(value))).join(";"))
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "marcon-requisicoes.csv";
    link.click();
    URL.revokeObjectURL(url);
  }
  function createRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const material = String(data.get("material") || "").trim();
    const quantity = Number(data.get("quantity"));
    const part = stock.find((item) => item.code === material);
    const justification = String(data.get("justification") || "").trim();
    if (
      !part ||
      quantity < 1 ||
      quantity > part.quantity ||
      quantity !== Number(data.get("confirmQuantity"))
    ) {
      setMessage("Confira a peça, o saldo e a confirmação da quantidade.");
      return;
    }
    if (
      (quantity > 10 || data.get("priority") === "Urgente") &&
      !justification
    ) {
      setMessage("Informe a justificativa para este pedido atípico.");
      return;
    }
    setRequests((items) => [
      {
        id: Math.max(...items.map((item) => item.id)) + 1,
        material: part.name,
        code: part.code,
        justification,
        quantity,
        person: "Você",
        block: "Bloco A",
        date: new Date().toLocaleDateString("pt-BR"),
        status: "Pendente",
        priority: data.get("priority") as Request["priority"],
      },
      ...items,
    ]);
    form.reset();
    setRequestQuantity(1);
    setRequestPriority("Leve");
    navigate("historico");
    setMessage("Requisição criada nesta demonstração.");
  }
  function addCart() {
    const explanation =
      (
        document.querySelector(
          "[name=justification]",
        ) as HTMLTextAreaElement | null
      )?.value.trim() ?? "";
    if (requestQuantity < 1 || requestQuantity > selectedStock.quantity) {
      setMessage("Quantidade acima do saldo disponível.");
      return;
    }
    if (atypical && !explanation) {
      setMessage("Justifique o pedido atípico antes de adicionar ao carrinho.");
      return;
    }
    setCart((items) => [
      ...items,
      {
        code: selectedPart,
        quantity: requestQuantity,
        priority: requestPriority,
        justification: explanation,
      },
    ]);
    setMessage("Peça adicionada ao carrinho desta sessão.");
  }
  function checkoutCart() {
    if (!cart.length) return;
    setRequests((items) => [
      ...cart.map((entry, index) => {
        const part = stock.find((piece) => piece.code === entry.code)!;
        return {
          id: Math.max(...items.map((item) => item.id)) + index + 1,
          material: part.name,
          code: part.code,
          quantity: entry.quantity,
          person: "Você",
          block: "Bloco A",
          date: new Date().toLocaleDateString("pt-BR"),
          status: "Pendente" as const,
          priority: entry.priority,
          justification: entry.justification,
        };
      }),
      ...items,
    ]);
    setCart([]);
    navigate("historico");
    setMessage("Solicitações do carrinho registradas nesta sessão.");
  }
  function allowedStatuses(item: Request): Request["status"][] {
    if (role === "lider" && item.status === "Pendente")
      return ["Pendente", "Aprovada", "Cancelada"];
    if (role === "almoxarifado" && item.status === "Aprovada")
      return ["Aprovada", "Entregue", "Cancelada"];
    return [item.status];
  }
  function requestCard(item: Request) {
    return (
      <article className="request-card" key={item.id}>
        <div className="card-line">
          <strong>{item.material}</strong>
          {badge(item.status)}
        </div>
        <p>
          #{item.id} · {item.quantity} un. · {item.block}
        </p>
        <div className="card-line">
          <span>
            {item.date} · {item.person}
          </span>
          {badge(item.priority)}
        </div>
        {item.justification && (
          <p className="alert-note">
            Justificativa atípica: {item.justification}
          </p>
        )}
        <button className="link-button" onClick={() => setDetail(item)}>
          Ver detalhes
        </button>
        {role === "lider" && page !== "historico" && (
          <label className="mobile-status">
            Atualizar situação
            <select
              value={item.status}
              onChange={(event) =>
                updateStatus(item.id, event.target.value as Request["status"])
              }
            >
              {allowedStatuses(item).map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
          </label>
        )}
      </article>
    );
  }
  return (
    <div className="shell">
      <div
        className={"overlay " + (drawerOpen ? "visible" : "")}
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />
      <aside
        ref={sidebar}
        inert={isMobile && !drawerOpen}
        className={"sidebar " + (drawerOpen ? "open" : "")}
        aria-label="Menu principal"
      >
        <div className="brand">
          <div>
            <strong>MARCON</strong>
            <small>Gestão de materiais</small>
          </div>
          <button
            className="icon-button close"
            onClick={() => setDrawerOpen(false)}
            aria-label="Fechar menu"
          >
            <X size={20} />
          </button>
        </div>
        <p className="nav-caption">ESPAÇO DE TRABALHO</p>
        <nav aria-label="Navegação principal">
          {current.pages.map((item) => (
            <button
              key={item.id}
              className={"nav-link " + (active.id === item.id ? "active" : "")}
              onClick={() => navigate(item.id)}
              aria-current={active.id === item.id ? "page" : undefined}
            >
              <span aria-hidden="true">
                <NavIcon page={item.id} />
              </span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="side-note">
            <strong>Seu espaço, seu ritmo.</strong>
            <p>Organize materiais e acompanhe solicitações em um só lugar.</p>
          </div>
          <div className="user">
            <span className="avatar">{current.name[0]}</span>
            <div>
              <strong>{current.name}</strong>
              <small>Visualização de demonstração</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="top-left">
            <button
              ref={menuButton}
              className="icon-button menu"
              onClick={() => setDrawerOpen(true)}
              aria-label="Abrir menu"
              aria-expanded={drawerOpen}
            >
              <Menu size={22} />
            </button>
            <span>
              Área de trabalho <b>/</b> <strong>{active.label}</strong>
            </span>
          </div>
          <label className="role-control">
            <span>Visualizar como</span>
            <select
              value={role}
              onChange={(event) => changeRole(event.target.value as Role)}
              aria-label="Selecionar perfil para demonstração"
            >
              <option value="admin">Admin</option>
              <option value="lider">Líder de bloco</option>
              <option value="almoxarifado">Almoxarifado</option>
              <option value="funcionario">Funcionário</option>
            </select>
          </label>
        </header>
        <main className="content">
          {message && (
            <div className="notice" role="status">
              ✓ {message}
              <button
                onClick={() => setMessage("")}
                aria-label="Dispensar aviso"
              >
                ×
              </button>
            </div>
          )}
          {page === "dashboard" && role === "almoxarifado" && (
            <WarehouseDashboard
              stock={stock}
              requests={roleRequests}
              movements={movements}
            />
          )}
          {page === "dashboard" && role !== "almoxarifado" && (
            <DashboardScreen
              role={role}
              current={current}
              roleRequests={roleRequests}
              stock={stock}
              requests={requests}
              dashboardView={dashboardView}
              routePart={routePart}
              navigate={navigate}
              NavIcon={NavIcon}
            />
          )}
          {["requisicoes", "solicitacoes", "historico"].includes(page) && (
            <RequestsScreen
              role={role}
              page={page}
              current={current}
              active={active}
              requestRows={requestRows}
              search={search}
              setSearch={setSearch}
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              qrCode={qrCode}
              setQrCode={setQrCode}
              exportCsv={exportCsv}
              updateStatus={updateStatus}
              setDetail={setDetail}
              allowedStatuses={allowedStatuses}
              requestCard={requestCard}
            />
          )}
          {page === "nova" && (
            <EmployeeRequestScreen
              selectedPart={selectedPart}
              setSelectedPart={setSelectedPart}
              selectedStock={selectedStock}
              requestQuantity={requestQuantity}
              setRequestQuantity={setRequestQuantity}
              requestPriority={requestPriority}
              setRequestPriority={setRequestPriority}
              atypical={atypical}
              createRequest={createRequest}
              addCart={addCart}
              checkoutCart={checkoutCart}
            />
          )}
          {page === "funcionarios" && <StaffScreen setMessage={setMessage} />}
          {page === "estoque" && (
            <StockScreen routePart={routePart} setMessage={setMessage} />
          )}
          {page === "devolucoes" && <ReturnsScreen setMessage={setMessage} />}
          {page === "compra" && (
            <PurchaseScreen purchaseItems={purchaseItems} />
          )}
          {page === "recomendacoes" && <RecommendationScreen stock={stock} />}
        </main>
      </div>
      {detail && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setDetail(null)}
        >
          <section
            className="detail-modal"
            role="dialog"
            aria-modal="true"
            aria-label={"Requisição " + detail.id}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              className="icon-button modal-close"
              aria-label="Fechar detalhes"
              onClick={() => setDetail(null)}
            >
              <X size={20} />
            </button>
            <p className="kicker">REQUISIÇÃO #{detail.id}</p>
            <h2>{detail.material}</h2>
            <p>Código: {detail.code || "Não informado"}</p>
            <p>
              Quantidade: {detail.quantity} unidades · {detail.block}
            </p>
            <p>
              Solicitante: {detail.person} · {detail.date}
            </p>
            <p>
              Prioridade: {detail.priority} · Situação: {detail.status}
            </p>
            {detail.justification && (
              <p className="alert-note">
                <strong>Justificativa de atipicidade:</strong>{" "}
                {detail.justification}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
