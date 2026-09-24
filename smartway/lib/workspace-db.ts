import type { RowDataPacket } from "mysql2";
import type { Account } from "./accounts";
import { getPool } from "./db";
import type { Part, Request, Movement, ReturnRecord } from "./demo-data";
import type { InventoryBalance, Transfer, Warehouse } from "./inventory";
import type { StaffRole, StaffUser } from "./staff-data";

type Row = RowDataPacket & Record<string, unknown>;
const staffRoles: Record<Account["role"], StaffRole> = {
  admin: "Administrador", lider: "Líder de bloco", almoxarifado: "Almoxarife", funcionario: "Funcionário",
};
export type WorkspaceSnapshot = {
  stock: Part[]; balances: InventoryBalance[]; requests: Request[];
  movements: Movement[]; transfers: Transfer[]; returns: ReturnRecord[]; staff: StaffUser[];
};
export async function workspaceSnapshot(user: Account): Promise<WorkspaceSnapshot> {
  const pool = getPool();
  const [partRows] = await pool.query<Row[]>(
    "SELECT p.*, COALESCE(SUM(i.quantity), 0) AS total_quantity, (SELECT COALESCE(SUM(m.quantity), 0) FROM stock_movements m WHERE m.part_id = p.id AND m.kind = 'saida' AND m.created_at >= NOW() - INTERVAL 30 DAY) AS actual_consumed30, (SELECT COALESCE(SUM(m.quantity), 0) FROM stock_movements m WHERE m.part_id = p.id AND m.kind = 'saida' AND m.created_at >= NOW() - INTERVAL 60 DAY AND m.created_at < NOW() - INTERVAL 30 DAY) AS actual_previous30 FROM parts p LEFT JOIN inventory i ON i.part_id = p.id WHERE p.active = TRUE GROUP BY p.id ORDER BY p.name",
  );
  const stock: Part[] = partRows.map((row) => ({
    id: Number(row.id), name: String(row.name), code: String(row.code),
    qrCode: String(row.qr_code), quantity: Number(row.total_quantity),
    packSize: Number(row.pack_size), minimum: Number(row.minimum_total),
    consumed30: Number(row.actual_consumed30), previous30: Number(row.actual_previous30),
    leadDays: Number(row.lead_days), estimatedCost: Number(row.reference_unit_price),
    location: String(row.location), warehouse: "Central",
    image: row.image_url ? String(row.image_url) : undefined,
  }));
  const [balanceRows] = await pool.query<Row[]>(
    "SELECT p.code AS part_code, w.name AS warehouse, i.quantity FROM inventory i JOIN parts p ON p.id = i.part_id JOIN warehouses w ON w.id = i.warehouse_id WHERE p.active = TRUE",
  );
  const balances: InventoryBalance[] = balanceRows.map((row) => ({
    partCode: String(row.part_code), warehouse: String(row.warehouse) as Warehouse, quantity: Number(row.quantity),
  }));
  const requestScope = user.role === "funcionario" ? "WHERE u.employee_no = ?" :
    user.role === "lider" ? "WHERE b.name = ?" : "";
  const requestParams = user.role === "funcionario" ? [user.id] :
    user.role === "lider" ? [user.block ?? ""] : [];
  const [requestRows] = await pool.query<Row[]>(
    `SELECT r.id, p.code, p.name AS material, r.quantity, u.name AS person, b.name AS block, DATE_FORMAT(r.created_at, '%d/%m/%Y') AS date, r.status, r.priority, r.justification
     FROM requests r JOIN parts p ON p.id = r.part_id JOIN users u ON u.id = r.requester_id JOIN blocks b ON b.id = r.block_id
     ${requestScope} ORDER BY r.created_at DESC, r.id DESC`,
    requestParams,
  );
  const requests: Request[] = requestRows.map((row) => ({
    id: Number(row.id), code: String(row.code), material: String(row.material),
    quantity: Number(row.quantity), person: String(row.person), block: String(row.block),
    date: String(row.date), status: row.status as Request["status"],
    priority: row.priority as Request["priority"],
    justification: row.justification ? String(row.justification) : undefined,
  }));
  if (user.role === "funcionario" || user.role === "lider") {
    return { stock, balances, requests, movements: [], transfers: [], returns: [], staff: [] };
  }
  const [movementRows] = await pool.query<Row[]>(
    "SELECT m.id, p.code AS part_code, m.kind, m.quantity, DATE_FORMAT(m.created_at, '%Y-%m-%d') AS date, w.name AS warehouse, b.name AS block, COALESCE(ru.name, au.name) AS requester, m.transfer_id FROM stock_movements m JOIN parts p ON p.id = m.part_id JOIN warehouses w ON w.id = m.warehouse_id LEFT JOIN blocks b ON b.id = m.block_id LEFT JOIN requests r ON r.id = m.request_id LEFT JOIN users ru ON ru.id = r.requester_id JOIN users au ON au.id = m.actor_id ORDER BY m.created_at DESC, m.id DESC LIMIT 5000",
  );
  const movements: Movement[] = movementRows.map((row) => ({
    id: Number(row.id), partCode: String(row.part_code),
    type: ["entrada", "transferencia_entrada", "devolucao", "ajuste_entrada"].includes(String(row.kind)) ? "entrada" : "saida",
    quantity: Number(row.quantity), date: String(row.date), warehouse: String(row.warehouse),
    block: row.block ? String(row.block) : undefined,
    requester: row.requester ? String(row.requester) : undefined,
    transferId: row.transfer_id ? Number(row.transfer_id) : undefined,
  }));
  const [transferRows] = await pool.query<Row[]>(
    "SELECT t.id, p.code AS part_code, s.name AS source_name, d.name AS destination_name, t.quantity, DATE_FORMAT(t.created_at, '%Y-%m-%d') AS date, t.qr_code_scanned FROM stock_transfers t JOIN parts p ON p.id = t.part_id JOIN warehouses s ON s.id = t.source_warehouse_id JOIN warehouses d ON d.id = t.destination_warehouse_id ORDER BY t.created_at DESC, t.id DESC LIMIT 2000",
  );
  const transfers: Transfer[] = transferRows.map((row) => ({
    id: Number(row.id), partCode: String(row.part_code), from: String(row.source_name) as Warehouse,
    to: String(row.destination_name) as Warehouse, quantity: Number(row.quantity),
    date: String(row.date), qrCode: String(row.qr_code_scanned),
  }));
  const [returnRows] = await pool.query<Row[]>(
    "SELECT r.id, p.code AS part_code, p.pack_size, r.quantity, b.name AS from_block, r.returned_by, DATE_FORMAT(r.created_at, '%Y-%m-%d') AS date, r.condition_type, r.note FROM return_records r JOIN parts p ON p.id = r.part_id JOIN blocks b ON b.id = r.block_id ORDER BY r.created_at DESC, r.id DESC LIMIT 2000",
  );
  const returns: ReturnRecord[] = returnRows.map((row) => ({
    id: Number(row.id), partCode: String(row.part_code), packSize: Number(row.pack_size),
    quantity: Number(row.quantity), boxes: Math.floor(Number(row.quantity) / Number(row.pack_size)),
    looseUnits: Number(row.quantity) % Number(row.pack_size), fromBlock: String(row.from_block),
    returnedBy: String(row.returned_by), date: String(row.date),
    condition: row.condition_type as ReturnRecord["condition"], note: row.note ? String(row.note) : "",
  }));
  let staff: StaffUser[] = [];
  if (user.role === "admin") {
    const [staffRows] = await pool.query<Row[]>(
      "SELECT u.employee_no, u.name, u.email, u.sector, u.role, u.active, b.name AS block FROM users u LEFT JOIN blocks b ON b.id = u.block_id ORDER BY u.name",
    );
    staff = staffRows.map((row) => ({
      id: String(row.employee_no), name: String(row.name), email: String(row.email),
      sector: String(row.sector), role: staffRoles[row.role as Account["role"]],
      active: Boolean(row.active), block: row.block ? String(row.block) : undefined,
    }));
  }
  return { stock, balances, requests, movements, transfers, returns, staff };
}
