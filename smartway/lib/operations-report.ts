import type { Account } from "./accounts";
import { workspaceSnapshot } from "./workspace-db";
import { getPool } from "./db";
import type { RowDataPacket } from "mysql2";
import { ActionError, can } from "./permissions";
import { predict, suggestTransfers, type Forecast } from "./forecast";
import { shortestPath, type FacilityGraph } from "./routing";
import { integrationStatus } from "./integrations/corporate";
export type ReportFilter = {
  from?: string;
  to?: string;
  block?: string;
  requester?: string;
  code?: string;
  status?: string;
  priority?: string;
  sector?: string;
};
export type ReportRow = {
  code: string;
  item: string;
  unit: string;
  block: string;
  warehouse: string;
  location: string;
  withdrawals: number;
  entries: number;
  returns: number;
  physical: number;
  reserved: number;
  available: number;
  minimum: number;
  configuredMinimum: number;
  target: number;
  forecast: number;
  buy: number;
  transfer: number;
  cost: number;
  priceLabel: string;
  analysis: Forecast;
  capacity: number | null;
  incoming: number;
};
export async function operationsReport(user: Account, filters: ReportFilter) {
  filters = { ...filters, code: filters.code?.trim().toUpperCase() };
  const today = new Date().toISOString().slice(0, 10),
    from =
      filters.from ||
      new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
    to = filters.to || today;
  if (
    ![from, to].every(
      (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)),
    ) ||
    from > to ||
    (Date.parse(to) - Date.parse(from)) / 86400000 > 366
  )
    throw new ActionError("Período inválido (máximo 366 dias).");
  if (user.role === "lider" && filters.block && filters.block !== user.block)
    throw new ActionError("Bloco fora do seu escopo.", 403);
  if (
    user.role === "funcionario" &&
    filters.requester &&
    filters.requester !== user.id
  )
    throw new ActionError("Requisitor fora do seu escopo.", 403);
  const snapshot = await workspaceSnapshot(user, true),
    pool = getPool(),
    scope =
      user.role === "funcionario"
        ? "u.employee_no=?"
        : user.role === "lider"
          ? "b.name=?"
          : "1=1",
    params =
      user.role === "funcionario"
        ? [user.id]
        : user.role === "lider"
          ? [user.block ?? ""]
          : [];
  const [movements] = await pool.execute<RowDataPacket[]>(
    `SELECT r.sector AS request_sector,r.status AS request_status,r.priority AS request_priority,m.id,m.part_id,m.warehouse_id,m.kind,m.quantity,m.reason,au.name AS actor,p.code,DATE_FORMAT(m.created_at,'%Y-%m-%d') AS date,b.id AS block_id,b.name AS block,u.employee_no AS requester FROM stock_movements m JOIN users au ON au.id=m.actor_id JOIN parts p ON p.id=m.part_id LEFT JOIN requests r ON r.id=m.request_id LEFT JOIN users u ON u.id=r.requester_id LEFT JOIN blocks b ON b.id=m.block_id WHERE ${scope} AND m.created_at>=LEAST(?,UTC_DATE()-INTERVAL 180 DAY) AND m.created_at<DATE_ADD(GREATEST(?,UTC_DATE()),INTERVAL 1 DAY)`,
    [...params, from, to],
  );
  const [warehouses] = await pool.query<RowDataPacket[]>(
    "SELECT id,name,block_id,is_central FROM warehouses WHERE active=TRUE",
  );
  const [published] = await pool.query<RowDataPacket[]>(
    "SELECT id,graph FROM map_versions WHERE status='Publicada'",
  );
  const graph = published[0]
    ? ((typeof published[0].graph === "string"
        ? JSON.parse(published[0].graph)
        : published[0].graph) as FacilityGraph)
    : null;
  const [incomingRows] = can(user.role, "planning")
    ? await pool.query<RowDataPacket[]>(
        "SELECT e.*,p.code,w.name AS warehouse FROM expected_receipts e JOIN parts p ON p.id=e.part_id JOIN warehouses w ON w.id=e.warehouse_id ORDER BY e.due_date DESC LIMIT 1000",
      )
    : [[]];
  const [firstDates] = await pool.query<RowDataPacket[]>(
    "SELECT part_id,MIN(created_at) AS first_at FROM stock_movements GROUP BY part_id",
  );
  const observations = movements.filter(
    (m) =>
      (!filters.block || m.block === filters.block) &&
      (!filters.requester || m.requester === filters.requester) &&
      (!filters.status || m.request_status === filters.status) &&
      (!filters.priority || m.request_priority === filters.priority) &&
      (!filters.sector ||
        String(m.request_sector).toLowerCase() ===
          filters.sector.toLowerCase()),
  );
  const reportRows: ReportRow[] = [];
  for (const p of snapshot.stock.filter(
    (p) => !filters.code || p.code === filters.code,
  )) {
    const first = firstDates.find((d) => Number(d.part_id) === p.id)?.first_at;
    const days = Math.max(
      1,
      Math.min(
        180,
        first
          ? Math.ceil((Date.now() - Date.parse(String(first))) / 86400000)
          : 1,
      ),
    );
    const relevant = observations.filter((m) => Number(m.part_id) === p.id),
      history = relevant.filter((m) => m.kind === "saida" && m.date <= today);
    function closest(blockId: number | null) {
      const candidates = warehouses.filter(
          (w) => Number(w.block_id) === blockId,
        ),
        fallback = candidates[0] ?? warehouses.find((w) => w.is_central);
      if (!graph) return Number(fallback?.id);
      const target = graph.nodes.find(
        (n) =>
          n.blockId === blockId &&
          (n.kind === "block" || n.kind === "delivery"),
      );
      if (!target) return Number(fallback?.id);
      const scored = warehouses
        .map((w) => {
          const node = graph.nodes.find((n) => n.warehouseId === Number(w.id));
          return {
            id: Number(w.id),
            distance: node
              ? (shortestPath(graph, node.id, target.id)?.cost ?? Infinity)
              : Infinity,
          };
        })
        .sort((a, b) => a.distance - b.distance);
      return Number.isFinite(scored[0]?.distance)
        ? scored[0].id
        : Number(fallback?.id);
    }
    const targetWarehouses = new Map(
      [
        ...new Set(
          history.map((m) => (m.block_id ? Number(m.block_id) : null)),
        ),
      ].map((id) => [id, closest(id)]),
    );
    for (const location of p.locations ?? []) {
      const daily = Array.from({ length: days }, (_, i) => {
        const day = new Date(Date.now() - (days - 1 - i) * 86400000)
          .toISOString()
          .slice(0, 10);
        return history
          .filter(
            (m) =>
              m.date === day &&
              targetWarehouses.get(m.block_id ? Number(m.block_id) : null) ===
                location.warehouseId,
          )
          .reduce((s, m) => s + Number(m.quantity), 0);
      });
      const forecast = predict(
          daily,
          p.leadDays,
          location.minimum,
          p.criticality,
        ),
        target = Math.max(
          0,
          Math.min(
            forecast.target,
            (location.capacity ?? Infinity) - location.reserved,
          ),
        );
      const period = relevant.filter(
          (m) =>
            Number(m.warehouse_id) === location.warehouseId &&
            m.date >= from &&
            m.date <= to,
        ),
        sum = (k: string) =>
          period
            .filter((m) => m.kind === k)
            .reduce((s, m) => s + Number(m.quantity), 0);
      const incoming = incomingRows
        .filter(
          (r) =>
            r.code === p.code &&
            Number(r.warehouse_id) === location.warehouseId &&
            r.status === "Confirmada" &&
            String(r.due_date).slice(0, 10) <=
              new Date(Date.now() + p.leadDays * 86400000)
                .toISOString()
                .slice(0, 10),
        )
        .reduce((s, r) => s + Number(r.quantity), 0);
      reportRows.push({
        code: p.code,
        item: p.name,
        unit: p.unit ?? "un",
        block:
          filters.block ??
          (user.role === "lider"
            ? (user.block ?? "")
            : [...new Set(period.map((m) => m.block).filter(Boolean))].join(
                ", ",
              ) || "Sem retirada no período"),
        warehouse: location.warehouse,
        location: `${location.aisle} / ${location.shelf}`,
        withdrawals: sum("saida"),
        entries: sum("entrada"),
        returns: sum("devolucao"),
        physical: location.quantity,
        reserved: location.reserved,
        available: location.available,
        minimum: forecast.minimum,
        configuredMinimum: location.minimum,
        target,
        forecast: Math.ceil(forecast.daily * p.leadDays),
        buy: can(user.role, "planning")
          ? Math.max(0, target - location.available - incoming)
          : 0,
        transfer: 0,
        cost: 0,
        priceLabel: "Estimativa interna; frete e impostos não cotados",
        analysis: forecast,
        capacity: location.capacity,
        incoming,
      });
    }
  }
  const transfers = can(user.role, "planning")
    ? suggestTransfers(
        reportRows.map((r) => ({
          code: r.code,
          warehouse: r.warehouse,
          available: r.available,
          target: r.target,
          minimum: r.minimum,
          incoming: r.incoming,
          capacity: r.capacity,
        })),
      )
    : [];
  for (const r of reportRows) {
    r.transfer = transfers
      .filter((t) => t.code === r.code && t.to === r.warehouse)
      .reduce((s, t) => s + t.quantity, 0);
    r.buy = Math.max(0, r.buy - r.transfer);
    r.cost =
      r.buy *
      (snapshot.stock.find((p) => p.code === r.code)?.estimatedCost ?? 0);
  }
  const deliveryParams = [...params, from, to];
  let deliveryWhere =
    scope +
    " AND r.delivered_at>=? AND r.delivered_at<DATE_ADD(?,INTERVAL 1 DAY)";
  for (const [value, column] of [
    [filters.block, "b.name"],
    [filters.requester, "u.employee_no"],
    [filters.code, "p.code"],
  ])
    if (value) {
      deliveryWhere += " AND " + column + "=?";
      deliveryParams.push(value);
    }
  const [deliveryRows] = await pool.execute<RowDataPacket[]>(
    `SELECT AVG(TIMESTAMPDIFF(SECOND,r.created_at,r.delivered_at)/3600) AS hours FROM requests r JOIN users u ON u.id=r.requester_id JOIN blocks b ON b.id=r.block_id JOIN parts p ON p.id=r.part_id WHERE ${deliveryWhere} AND r.delivered_at>=r.created_at`,
    deliveryParams,
  );
  return {
    movements: observations
      .filter(
        (m) =>
          m.date >= from &&
          m.date <= to &&
          (!filters.code || m.code === filters.code),
      )
      .map((m) => ({
        id: Number(m.id),
        date: String(m.date),
        code: String(m.code),
        kind: String(m.kind),
        quantity: Number(m.quantity),
        block: m.block ? String(m.block) : null,
        requester: m.requester ? String(m.requester) : null,
        actor: String(m.actor),
        reason: String(m.reason),
        warehouse: warehouses.find(
          (w) => Number(w.id) === Number(m.warehouse_id),
        )?.name,
      })),
    period: { from, to },
    generatedAt: new Date().toISOString(),
    source:
      "MySQL local: baixas efetivas kind=saida; devoluções separadas. Previsão usa até 180 dias observáveis.",
    rows: reportRows,
    transfers,
    incoming: incomingRows,
    summary: {
      withdrawals: reportRows.reduce((s, r) => s + r.withdrawals, 0),
      entries: reportRows.reduce((s, r) => s + r.entries, 0),
      returns: reportRows.reduce((s, r) => s + r.returns, 0),
      critical: reportRows.filter((r) => r.available < r.configuredMinimum)
        .length,
      averageDeliveryHours:
        deliveryRows[0].hours === null ? null : Number(deliveryRows[0].hours),
      deliveryTimeNote:
        "Desde a data de criação; registros legados sem horário de entrega são excluídos.",
    },
    mapVersion: published[0]?.id ?? null,
    integrations: integrationStatus,
  };
}
