import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import type { Account } from "./accounts";
import { transaction } from "./db";
import { hashPassword } from "./password";

type Row = RowDataPacket & Record<string, unknown>;
export class ActionError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
type Entry = { code: string; quantity: number; priority: string; justification?: string };
type Action =
  | { type: "createRequests"; entries: Entry[] }
  | { type: "changeRequestStatus"; id: number; status: string; qrCode?: string }
  | { type: "transfer"; code: string; to: string; quantity: number; qrCode: string }
  | { type: "savePart"; part: Record<string, unknown>; warehouse: string; localQuantity: number }
  | { type: "deletePart"; id: number }
  | { type: "saveUser"; user: Record<string, unknown>; editingId?: string | null; password?: string }
  | { type: "toggleUser"; id: string; active: boolean }
  | { type: "registerReturn"; code: string; block: string; quantity: number; condition: string; returnedBy: string; note?: string }
  | { type: "updatePrice"; code: string; price: number };

function requireRole(user: Account, roles: Account["role"][]) {
  if (!roles.includes(user.role)) throw new ActionError("Perfil sem permissão para esta ação.", 403);
}
function positiveInteger(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new ActionError("A quantidade deve ser um inteiro positivo.");
  return Number(value);
}
function nonnegativeInteger(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new ActionError("A quantidade deve ser um inteiro não negativo.");
  return Number(value);
}
function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
async function one(connection: PoolConnection, sql: string, params: unknown[]): Promise<Row | undefined> {
  const [rows] = await connection.execute<Row[]>(sql, params as (string | number | null)[]);
  return rows[0];
}
async function actorId(connection: PoolConnection, user: Account) {
  const actor = await one(connection, "SELECT id FROM users WHERE employee_no = ? AND active = TRUE", [user.id]);
  if (!actor) throw new ActionError("Sessão inválida.", 401);
  return Number(actor.id);
}
async function audit(connection: PoolConnection, actor: number, entity: string, id: number, action: string, details: unknown) {
  await connection.execute(
    "INSERT INTO audit_log (actor_id, entity_type, entity_id, action, details) VALUES (?, ?, ?, ?, ?)",
    [actor, entity, id, action, JSON.stringify(details)],
  );
}
const roleCodes: Record<string, Account["role"]> = {
  Administrador: "admin", "Líder de bloco": "lider", Almoxarife: "almoxarifado", Funcionário: "funcionario",
};

export async function executeWorkspaceAction(user: Account, input: unknown) {
  if (!input || typeof input !== "object" || !("type" in input)) throw new ActionError("Ação inválida.");
  const action = input as Action;
  switch (action.type) {
    case "createRequests": {
      requireRole(user, ["funcionario"]);
      if (!Array.isArray(action.entries) || !action.entries.length || action.entries.length > 30) throw new ActionError("Carrinho inválido.");
      return transaction(async (connection) => {
        const actor = await actorId(connection, user);
        const block = await one(connection, "SELECT block_id FROM users WHERE id = ?", [actor]);
        if (!block?.block_id) throw new ActionError("Usuário sem bloco definido.");
        const ids: number[] = [];
        for (const entry of action.entries) {
          const code = text(entry.code, 64);
          const quantity = positiveInteger(entry.quantity);
          const priority = entry.priority;
          if (!["Leve", "Moderado", "Urgente"].includes(priority)) throw new ActionError("Prioridade inválida.");
          const justification = text(entry.justification, 2000);
          if ((quantity > 10 || priority === "Urgente") && !justification) throw new ActionError("Justifique pedidos fora do padrão.");
          const part = await one(connection, "SELECT id FROM parts WHERE code = ? AND active = TRUE", [code]);
          if (!part) throw new ActionError("Peça não encontrada.", 404);
          const [inventoryRows] = await connection.execute<Row[]>("SELECT quantity FROM inventory WHERE part_id = ? FOR UPDATE", [part.id]);
          const [openRows] = await connection.execute<Row[]>("SELECT quantity FROM requests WHERE part_id = ? AND status IN ('Pendente','Em análise','Aprovada') FOR UPDATE", [part.id]);
          const available = inventoryRows.reduce((sum, row) => sum + Number(row.quantity), 0) - openRows.reduce((sum, row) => sum + Number(row.quantity), 0);
          if (quantity > available) throw new ActionError("Saldo disponível insuficiente para este pedido.", 409);
          const [result] = await connection.execute<ResultSetHeader>(
            "INSERT INTO requests (requester_id, block_id, part_id, quantity, priority, justification) VALUES (?, ?, ?, ?, ?, ?)",
            [actor, block.block_id, part.id, quantity, priority, justification || null],
          );
          ids.push(result.insertId);
          await audit(connection, actor, "request", result.insertId, "create", { code, quantity, priority });
        }
        return { ids };
      });
    }
    case "changeRequestStatus": {
      requireRole(user, ["lider", "almoxarifado"]);
      const id = positiveInteger(action.id);
      return transaction(async (connection) => {
        const actor = await actorId(connection, user);
        const request = await one(connection,
          "SELECT r.*, b.name AS block_name, p.code, p.qr_code FROM requests r JOIN blocks b ON b.id = r.block_id JOIN parts p ON p.id = r.part_id WHERE r.id = ? FOR UPDATE",
          [id],
        );
        if (!request) throw new ActionError("Requisição não encontrada.", 404);
        if (user.role === "lider") {
          if (user.block !== request.block_name || request.status !== "Pendente" || !["Aprovada", "Cancelada"].includes(action.status))
            throw new ActionError("Este líder não pode alterar esta requisição.", 403);
          await connection.execute("UPDATE requests SET status = ?, approved_by = ? WHERE id = ?", [action.status, actor, id]);
        } else {
          if (request.status !== "Aprovada" || !["Entregue", "Cancelada"].includes(action.status))
            throw new ActionError("Esta requisição não está pronta para entrega.", 409);
          if (action.status === "Entregue") {
            if (text(action.qrCode, 128).toUpperCase() !== String(request.qr_code).toUpperCase())
              throw new ActionError("QR/ID não corresponde à peça.", 422);
            const blockWarehouse = await one(connection, "SELECT id FROM warehouses WHERE block_id = ? AND active = TRUE", [request.block_id]);
            const central = await one(connection, "SELECT id FROM warehouses WHERE is_central = TRUE AND active = TRUE", []);
            if (!central) throw new ActionError("Almoxarifado Central não encontrado.", 500);
            const [rows] = await connection.execute<Row[]>(
              "SELECT warehouse_id, quantity FROM inventory WHERE part_id = ? AND warehouse_id IN (?, ?) ORDER BY warehouse_id FOR UPDATE",
              [request.part_id, blockWarehouse?.id ?? central.id, central.id],
            );
            const source = rows.find((row) => Number(row.warehouse_id) === Number(blockWarehouse?.id) && Number(row.quantity) >= Number(request.quantity))
              ?? rows.find((row) => Number(row.warehouse_id) === Number(central.id) && Number(row.quantity) >= Number(request.quantity));
            if (!source) throw new ActionError("Saldo insuficiente para entregar o pedido.", 409);
            await connection.execute("UPDATE inventory SET quantity = quantity - ? WHERE part_id = ? AND warehouse_id = ?",
              [request.quantity, request.part_id, source.warehouse_id]);
            await connection.execute(
              "INSERT INTO stock_movements (part_id, warehouse_id, kind, quantity, request_id, block_id, actor_id) VALUES (?, ?, 'saida', ?, ?, ?, ?)",
              [request.part_id, source.warehouse_id, request.quantity, id, request.block_id, actor],
            );
            await connection.execute("UPDATE requests SET status = 'Entregue', fulfilled_by = ?, fulfilled_from = ? WHERE id = ?",
              [actor, source.warehouse_id, id]);
          } else {
            await connection.execute("UPDATE requests SET status = 'Cancelada' WHERE id = ?", [id]);
          }
        }
        await audit(connection, actor, "request", id, action.status, {});
        return { id, status: action.status };
      });
    }
    case "transfer": {
      requireRole(user, ["almoxarifado"]);
      const quantity = positiveInteger(action.quantity);
      const code = text(action.code, 64);
      const qr = text(action.qrCode, 128).toUpperCase();
      const destination = text(action.to, 80);
      return transaction(async (connection) => {
        const actor = await actorId(connection, user);
        const part = await one(connection, "SELECT id, qr_code, minimum_total FROM parts WHERE code = ? AND active = TRUE", [code]);
        if (!part) throw new ActionError("Peça não encontrada.", 404);
        if (qr !== String(part.qr_code).toUpperCase()) throw new ActionError("QR/ID não corresponde à peça.", 422);
        const source = await one(connection, "SELECT id FROM warehouses WHERE is_central = TRUE AND active = TRUE", []);
        const target = await one(connection, "SELECT id, block_id FROM warehouses WHERE name = ? AND is_central = FALSE AND active = TRUE", [destination]);
        if (!source || !target) throw new ActionError("Destino inválido.");
        await connection.execute("INSERT IGNORE INTO inventory (part_id, warehouse_id, quantity) VALUES (?, ?, 0)", [part.id, target.id]);
        const [balances] = await connection.execute<Row[]>(
          "SELECT warehouse_id, quantity FROM inventory WHERE part_id = ? AND warehouse_id IN (?, ?) ORDER BY warehouse_id FOR UPDATE",
          [part.id, source.id, target.id],
        );
        const central = balances.find((row) => Number(row.warehouse_id) === Number(source.id));
        const destinationBalance = balances.find((row) => Number(row.warehouse_id) === Number(target.id));
        const reserve = Math.ceil(Number(part.minimum_total) / 4);
        if (!central || Number(central.quantity) - quantity < reserve)
          throw new ActionError("O Central precisa manter a reserva mínima.", 409);
        const demand = await one(connection,
          "SELECT COALESCE(SUM(quantity), 0) AS total FROM stock_movements WHERE part_id = ? AND block_id = ? AND kind = 'saida' AND created_at >= NOW() - INTERVAL 30 DAY",
          [part.id, target.block_id]);
        const open = await one(connection,
          "SELECT COALESCE(SUM(quantity), 0) AS total FROM requests WHERE part_id = ? AND block_id = ? AND status IN ('Pendente','Em análise','Aprovada')",
          [part.id, target.block_id]);
        const targetQuantity = Math.max(2, Math.ceil(Number(demand?.total ?? 0) * 0.5) + Number(open?.total ?? 0), Math.ceil(Number(part.minimum_total) / 8));
        if (quantity > targetQuantity - Number(destinationBalance?.quantity ?? 0))
          throw new ActionError("A quantidade excede a necessidade calculada para este bloco.", 409);
        await connection.execute("UPDATE inventory SET quantity = quantity - ? WHERE part_id = ? AND warehouse_id = ?", [quantity, part.id, source.id]);
        await connection.execute("UPDATE inventory SET quantity = quantity + ? WHERE part_id = ? AND warehouse_id = ?", [quantity, part.id, target.id]);
        const [result] = await connection.execute<ResultSetHeader>(
          "INSERT INTO stock_transfers (part_id, source_warehouse_id, destination_warehouse_id, quantity, qr_code_scanned, performed_by) VALUES (?, ?, ?, ?, ?, ?)",
          [part.id, source.id, target.id, quantity, qr, actor],
        );
        for (const [warehouse, kind] of [[source.id, "transferencia_saida"], [target.id, "transferencia_entrada"]]) {
          await connection.execute(
            "INSERT INTO stock_movements (part_id, warehouse_id, kind, quantity, transfer_id, actor_id) VALUES (?, ?, ?, ?, ?, ?)",
            [part.id, warehouse, kind, quantity, result.insertId, actor],
          );
        }
        await audit(connection, actor, "transfer", result.insertId, "create", { code, quantity, destination });
        return { id: result.insertId };
      });
    }
    case "savePart": {
      requireRole(user, ["almoxarifado"]);
      const part = action.part;
      if (!part || typeof part !== "object") throw new ActionError("Dados da peça inválidos.");
      const id = part.id == null ? null : positiveInteger(part.id);
      const name = text(part.name, 160);
      const code = text(part.code, 64).toUpperCase();
      const qrCode = text(part.qrCode, 128).toUpperCase();
      const location = text(part.location, 80);
      const warehouse = text(action.warehouse, 80);
      const localQuantity = nonnegativeInteger(action.localQuantity);
      const packSize = positiveInteger(part.packSize);
      const minimum = positiveInteger(part.minimum);
      const leadDays = positiveInteger(part.leadDays);
      const cost = Number(part.estimatedCost);
      const image = typeof part.image === "string" && part.image.startsWith("data:image/") && part.image.length < 1_500_000 ? part.image : null;
      if (!name || !code || !qrCode || !location || !Number.isFinite(cost) || cost < 0) throw new ActionError("Preencha todos os dados da peça.");
      return transaction(async (connection) => {
        const actor = await actorId(connection, user);
        const place = await one(connection, "SELECT id FROM warehouses WHERE name = ? AND active = TRUE", [warehouse]);
        if (!place) throw new ActionError("Almoxarifado inválido.");
        let partId = id;
        if (id) {
          const existing = await one(connection, "SELECT id, image_url FROM parts WHERE id = ? AND active = TRUE FOR UPDATE", [id]);
          if (!existing) throw new ActionError("Peça não encontrada.", 404);
          await connection.execute(
            "UPDATE parts SET name = ?, code = ?, qr_code = ?, pack_size = ?, minimum_total = ?, lead_days = ?, reference_unit_price = ?, location = ?, image_url = ? WHERE id = ?",
            [name, code, qrCode, packSize, minimum, leadDays, cost, location, image ?? existing.image_url ?? null, id],
          );
        } else {
          const [result] = await connection.execute<ResultSetHeader>(
            "INSERT INTO parts (name, code, qr_code, pack_size, minimum_total, lead_days, reference_unit_price, location, image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [name, code, qrCode, packSize, minimum, leadDays, cost, location, image],
          );
          partId = result.insertId;
        }
        await connection.execute("INSERT IGNORE INTO inventory (part_id, warehouse_id, quantity) VALUES (?, ?, 0)", [partId, place.id]);
        const balance = await one(connection, "SELECT quantity FROM inventory WHERE part_id = ? AND warehouse_id = ? FOR UPDATE", [partId, place.id]);
        const old = Number(balance?.quantity ?? 0);
        const delta = localQuantity - old;
        await connection.execute("UPDATE inventory SET quantity = ?, minimum_quantity = ? WHERE part_id = ? AND warehouse_id = ?",
          [localQuantity, Math.max(2, Math.ceil(minimum / (warehouse === "Central" ? 4 : 8))), partId, place.id]);
        if (delta) {
          await connection.execute(
            "INSERT INTO stock_movements (part_id, warehouse_id, kind, quantity, actor_id) VALUES (?, ?, ?, ?, ?)",
            [partId, place.id, delta > 0 ? "ajuste_entrada" : "ajuste_saida", Math.abs(delta), actor],
          );
        }
        await audit(connection, actor, "part", Number(partId), id ? "update" : "create", { code, warehouse, old, localQuantity });
        return { id: partId };
      });
    }
    case "deletePart": {
      requireRole(user, ["almoxarifado"]);
      const id = positiveInteger(action.id);
      return transaction(async (connection) => {
        const actor = await actorId(connection, user);
        const linked = await one(connection, "SELECT id FROM requests WHERE part_id = ? LIMIT 1", [id]);
        if (linked) throw new ActionError("Peça com requisições não pode ser desativada.", 409);
        const [result] = await connection.execute<ResultSetHeader>("UPDATE parts SET active = FALSE WHERE id = ? AND active = TRUE", [id]);
        if (!result.affectedRows) throw new ActionError("Peça não encontrada.", 404);
        await audit(connection, actor, "part", id, "deactivate", {});
        return { id };
      });
    }
    case "saveUser": {
      requireRole(user, ["admin"]);
      const data = action.user;
      if (!data || typeof data !== "object") throw new ActionError("Dados do usuário inválidos.");
      const employeeNo = text(data.id, 30);
      const name = text(data.name, 120);
      const email = text(data.email, 190).toLowerCase();
      const sector = text(data.sector, 80);
      const role = roleCodes[String(data.role)];
      const blockName = text(data.block, 80);
      const active = data.active === false ? 0 : 1;
      if (!/^[A-Za-z0-9_-]{1,30}$/.test(employeeNo) || !name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !sector || !role)
        throw new ActionError("Confira matrícula, nome, e-mail, setor e função.");
      if (["funcionario", "lider"].includes(role) && !blockName) throw new ActionError("Defina o bloco de atuação.");
      const password = typeof action.password === "string" ? action.password : "";
      if (!action.editingId && password.length < 12) throw new ActionError("A senha inicial deve ter pelo menos 12 caracteres.");
      if (password && password.length < 12) throw new ActionError("A nova senha deve ter pelo menos 12 caracteres.");
      if ((action.editingId === user.id || employeeNo === user.id) && (!active || role !== "admin"))
        throw new ActionError("Não altere o próprio perfil ou status de administrador.");
      return transaction(async (connection) => {
        const actor = await actorId(connection, user);
        const block = blockName ? await one(connection, "SELECT id FROM blocks WHERE name = ?", [blockName]) : null;
        if (blockName && !block) throw new ActionError("Bloco inválido.");
        const blockId = ["funcionario", "lider"].includes(role) ? block?.id ?? null : null;
        if (action.editingId) {
          const existing = await one(connection, "SELECT id FROM users WHERE employee_no = ? FOR UPDATE", [action.editingId]);
          if (!existing) throw new ActionError("Usuário não encontrado.", 404);
          if (password) {
            await connection.execute("UPDATE users SET employee_no = ?, name = ?, email = ?, sector = ?, role = ?, block_id = ?, active = ?, password_hash = ? WHERE id = ?",
              [employeeNo, name, email, sector, role, blockId, active, hashPassword(password), existing.id]);
          } else {
            await connection.execute("UPDATE users SET employee_no = ?, name = ?, email = ?, sector = ?, role = ?, block_id = ?, active = ? WHERE id = ?",
              [employeeNo, name, email, sector, role, blockId, active, existing.id]);
          }
          await audit(connection, actor, "user", Number(existing.id), "update", { employeeNo, role, blockName });
          return { id: Number(existing.id) };
        }
        const [result] = await connection.execute<ResultSetHeader>(
          "INSERT INTO users (employee_no, name, email, password_hash, sector, role, block_id, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [employeeNo, name, email, hashPassword(password), sector, role, blockId, active],
        );
        await audit(connection, actor, "user", result.insertId, "create", { employeeNo, role, blockName });
        return { id: result.insertId };
      });
    }
    case "toggleUser": {
      requireRole(user, ["admin"]);
      const employeeNo = text(action.id, 30);
      if (employeeNo === user.id && !action.active) throw new ActionError("Não é possível desativar a própria conta.");
      return transaction(async (connection) => {
        const actor = await actorId(connection, user);
        const target = await one(connection, "SELECT id FROM users WHERE employee_no = ? FOR UPDATE", [employeeNo]);
        if (!target) throw new ActionError("Usuário não encontrado.", 404);
        await connection.execute("UPDATE users SET active = ? WHERE id = ?", [action.active ? 1 : 0, target.id]);
        await audit(connection, actor, "user", Number(target.id), action.active ? "activate" : "deactivate", {});
        return { id: Number(target.id) };
      });
    }
    case "registerReturn": {
      requireRole(user, ["almoxarifado"]);
      const quantity = positiveInteger(action.quantity);
      const condition = action.condition;
      if (!["Apto", "Danificado"].includes(condition)) throw new ActionError("Condição inválida.");
      const returnedBy = text(action.returnedBy, 120);
      if (!returnedBy) throw new ActionError("Informe quem devolveu a peça.");
      return transaction(async (connection) => {
        const actor = await actorId(connection, user);
        const part = await one(connection, "SELECT id FROM parts WHERE code = ? AND active = TRUE", [text(action.code, 64)]);
        const block = await one(connection, "SELECT id FROM blocks WHERE name = ?", [text(action.block, 80)]);
        const central = await one(connection, "SELECT id FROM warehouses WHERE is_central = TRUE AND active = TRUE", []);
        if (!part || !block || !central) throw new ActionError("Peça ou bloco inválido.");
        const [result] = await connection.execute<ResultSetHeader>(
          "INSERT INTO return_records (part_id, block_id, warehouse_id, quantity, condition_type, returned_by, note, received_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [part.id, block.id, central.id, quantity, condition, returnedBy, text(action.note, 2000) || null, actor],
        );
        if (condition === "Apto") {
          await connection.execute("INSERT IGNORE INTO inventory (part_id, warehouse_id, quantity) VALUES (?, ?, 0)", [part.id, central.id]);
          await connection.execute("UPDATE inventory SET quantity = quantity + ? WHERE part_id = ? AND warehouse_id = ?", [quantity, part.id, central.id]);
          await connection.execute(
            "INSERT INTO stock_movements (part_id, warehouse_id, kind, quantity, return_id, block_id, actor_id) VALUES (?, ?, 'devolucao', ?, ?, ?, ?)",
            [part.id, central.id, quantity, result.insertId, block.id, actor],
          );
        }
        await audit(connection, actor, "return", result.insertId, "create", { quantity, condition });
        return { id: result.insertId };
      });
    }
    case "updatePrice": {
      requireRole(user, ["almoxarifado"]);
      const price = Number(action.price);
      if (!Number.isFinite(price) || price < 0 || price > 9999999999) throw new ActionError("Preço inválido.");
      return transaction(async (connection) => {
        const actor = await actorId(connection, user);
        const part = await one(connection, "SELECT id FROM parts WHERE code = ? AND active = TRUE", [text(action.code, 64)]);
        if (!part) throw new ActionError("Peça não encontrada.", 404);
        await connection.execute("UPDATE parts SET reference_unit_price = ? WHERE id = ?", [price, part.id]);
        await audit(connection, actor, "part", Number(part.id), "price", { price });
        return { ok: true };
      });
    }
    default:
      throw new ActionError("Ação não reconhecida.");
  }
}
