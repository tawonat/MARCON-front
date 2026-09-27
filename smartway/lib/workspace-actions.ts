import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import type { Account } from "./accounts";
import { transaction } from "./db";
import { hashPassword } from "./password";

type Row = RowDataPacket & Record<string, unknown>;
import { ActionError } from "./permissions";
export { ActionError } from "./permissions";
import { inventoryActions, executeInventoryAction } from "./inventory-actions";
type Entry = {
  code: string;
  quantity: number;
  priority: string;
  justification?: string;
};
type Action =
  | { type: "createRequests"; entries: Entry[] }
  | { type: "changeRequestStatus"; id: number; status: string; qrCode?: string }
  | {
      type: "transfer";
      code: string;
      to: string;
      quantity: number;
      qrCode: string;
    }
  | {
      type: "savePart";
      part: Record<string, unknown>;
      warehouse: string;
      localQuantity: number;
    }
  | { type: "deletePart"; id: number }
  | {
      type: "saveUser";
      user: Record<string, unknown>;
      editingId?: string | null;
      password?: string;
    }
  | { type: "toggleUser"; id: string; active: boolean }
  | {
      type: "registerReturn";
      code: string;
      block: string;
      quantity: number;
      condition: string;
      returnedBy: string;
      note?: string;
    }
  | { type: "updatePrice"; code: string; price: number };

function requireRole(user: Account, roles: Account["role"][]) {
  if (!roles.includes(user.role))
    throw new ActionError("Perfil sem permissão para esta ação.", 403);
}
function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
async function one(
  connection: PoolConnection,
  sql: string,
  params: unknown[],
): Promise<Row | undefined> {
  const [rows] = await connection.execute<Row[]>(
    sql,
    params as (string | number | null)[],
  );
  return rows[0];
}
async function actorId(connection: PoolConnection, user: Account) {
  const actor = await one(
    connection,
    "SELECT id FROM users WHERE employee_no = ? AND active = TRUE",
    [user.id],
  );
  if (!actor) throw new ActionError("Sessão inválida.", 401);
  return Number(actor.id);
}
async function audit(
  connection: PoolConnection,
  actor: number,
  entity: string,
  id: number,
  action: string,
  details: unknown,
) {
  await connection.execute(
    "INSERT INTO audit_log (actor_id, entity_type, entity_id, action, details) VALUES (?, ?, ?, ?, ?)",
    [actor, entity, id, action, JSON.stringify(details)],
  );
}
const roleCodes: Record<string, Account["role"]> = {
  Administrador: "admin",
  "Líder de bloco": "lider",
  Almoxarife: "almoxarifado",
  Funcionário: "funcionario",
};

export async function executeWorkspaceAction(user: Account, input: unknown) {
  if (!input || typeof input !== "object" || !("type" in input))
    throw new ActionError("Ação inválida.");
  if (inventoryActions.has(String(input.type)))
    return executeInventoryAction(user, input as Record<string, unknown>);
  const action = input as Action;
  switch (action.type) {
    case "saveUser": {
      requireRole(user, ["admin"]);
      const data = action.user;
      if (!data || typeof data !== "object")
        throw new ActionError("Dados do usuário inválidos.");
      const employeeNo = text(data.id, 30);
      const name = text(data.name, 120);
      const email = text(data.email, 190).toLowerCase();
      const sector = text(data.sector, 80);
      const role = Object.hasOwn(roleCodes, String(data.role))
        ? roleCodes[String(data.role)]
        : undefined;
      const blockName = text(data.block, 80);
      const active = data.active === false ? 0 : 1;
      if (
        !/^[A-Za-z0-9_-]{1,30}$/.test(employeeNo) ||
        !name ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        !sector ||
        !role
      )
        throw new ActionError(
          "Confira matrícula, nome, e-mail, setor e função.",
        );
      if (["funcionario", "lider"].includes(role) && !blockName)
        throw new ActionError("Defina o bloco de atuação.");
      const password =
        typeof action.password === "string" ? action.password : "";
      if (!action.editingId && password.length < 12)
        throw new ActionError(
          "A senha inicial deve ter pelo menos 12 caracteres.",
        );
      if (password && password.length < 12)
        throw new ActionError(
          "A nova senha deve ter pelo menos 12 caracteres.",
        );
      if (
        (action.editingId === user.id || employeeNo === user.id) &&
        (!active || role !== "admin")
      )
        throw new ActionError(
          "Não altere o próprio perfil ou status de administrador.",
        );
      return transaction(async (connection) => {
        const actor = await actorId(connection, user);
        const duplicate = await one(
          connection,
          "SELECT employee_no,email FROM users WHERE (employee_no=? OR email=?) AND employee_no<>? LIMIT 1 FOR UPDATE",
          [employeeNo, email, action.editingId ?? ""],
        );
        if (duplicate?.employee_no === employeeNo)
          throw new ActionError("Esta matrícula já está cadastrada.", 409);
        if (String(duplicate?.email ?? "").toLowerCase() === email)
          throw new ActionError("Este e-mail já está cadastrado.", 409);
        const block = blockName
          ? await one(connection, "SELECT id FROM blocks WHERE name = ?", [
              blockName,
            ])
          : null;
        if (blockName && !block) throw new ActionError("Bloco inválido.");
        const blockId = ["funcionario", "lider"].includes(role)
          ? (block?.id ?? null)
          : null;
        if (action.editingId) {
          const existing = await one(
            connection,
            "SELECT id FROM users WHERE employee_no = ? FOR UPDATE",
            [action.editingId],
          );
          if (!existing) throw new ActionError("Usuário não encontrado.", 404);
          if (password) {
            await connection.execute(
              "UPDATE users SET employee_no = ?, name = ?, email = ?, sector = ?, role = ?, block_id = ?, active = ?, password_hash = ? WHERE id = ?",
              [
                employeeNo,
                name,
                email,
                sector,
                role,
                blockId,
                active,
                hashPassword(password),
                existing.id,
              ],
            );
          } else {
            await connection.execute(
              "UPDATE users SET employee_no = ?, name = ?, email = ?, sector = ?, role = ?, block_id = ?, active = ? WHERE id = ?",
              [
                employeeNo,
                name,
                email,
                sector,
                role,
                blockId,
                active,
                existing.id,
              ],
            );
          }
          await audit(
            connection,
            actor,
            "user",
            Number(existing.id),
            "update",
            { employeeNo, role, blockName },
          );
          return { id: Number(existing.id) };
        }
        const [result] = await connection.execute<ResultSetHeader>(
          "INSERT INTO users (employee_no, name, email, password_hash, sector, role, block_id, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [
            employeeNo,
            name,
            email,
            hashPassword(password),
            sector,
            role,
            blockId,
            active,
          ],
        );
        await audit(connection, actor, "user", result.insertId, "create", {
          employeeNo,
          role,
          blockName,
        });
        return { id: result.insertId };
      });
    }
    case "toggleUser": {
      requireRole(user, ["admin"]);
      if (typeof action.active !== "boolean")
        throw new ActionError("Status do usuário inválido.");
      const employeeNo = text(action.id, 30);
      if (employeeNo === user.id && !action.active)
        throw new ActionError("Não é possível desativar a própria conta.");
      return transaction(async (connection) => {
        const actor = await actorId(connection, user);
        const target = await one(
          connection,
          "SELECT id FROM users WHERE employee_no = ? FOR UPDATE",
          [employeeNo],
        );
        if (!target) throw new ActionError("Usuário não encontrado.", 404);
        await connection.execute("UPDATE users SET active = ? WHERE id = ?", [
          action.active ? 1 : 0,
          target.id,
        ]);
        await audit(
          connection,
          actor,
          "user",
          Number(target.id),
          action.active ? "activate" : "deactivate",
          {},
        );
        return { id: Number(target.id) };
      });
    }
    case "updatePrice": {
      requireRole(user, ["admin", "almoxarifado"]);
      const price = Number(action.price);
      if (!Number.isFinite(price) || price < 0 || price > 9999999999)
        throw new ActionError("Preço inválido.");
      return transaction(async (connection) => {
        const actor = await actorId(connection, user);
        const part = await one(
          connection,
          "SELECT id FROM parts WHERE code = ? AND active = TRUE",
          [text(action.code, 64)],
        );
        if (!part) throw new ActionError("Peça não encontrada.", 404);
        await connection.execute(
          "UPDATE parts SET reference_unit_price = ? WHERE id = ?",
          [price, part.id],
        );
        await audit(connection, actor, "part", Number(part.id), "price", {
          price,
        });
        return { ok: true };
      });
    }
    default:
      throw new ActionError("Ação não reconhecida.");
  }
}
