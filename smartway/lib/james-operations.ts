import { createHash } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import type { Account } from "./accounts";
import { transaction } from "./db";
import { ActionError, demand, integer, reason, text } from "./permissions";
import { first, available, stock, place, partLock } from "./stock-ledger";
import { executeInventoryAction } from "./inventory-actions";
import { recordDeliveryPlan } from "./delivery-planning";

export const jamesOperations = [
  "approve",
  "analyze",
  "editRequest",
  "deleteRequest",
  "requestCancellation",
  "confirmReceipt",
  "transfer",
  "cancelTransfer",
  "planRoute",
  "stockEntry",
  "adjustStock",
] as const;
export type JamesOperation = {
  name: (typeof jamesOperations)[number];
  id?: number;
  quantity?: number;
  code?: string;
  from?: string;
  to?: string;
  warehouse?: string;
  reason?: string;
};
export function parseJamesOperation(value: unknown): JamesOperation {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ActionError("Operação inválida.", 422);
  const o = value as JamesOperation;
  if (!jamesOperations.includes(o.name))
    throw new ActionError(
      "Essa ação ainda precisa ser feita na tela do sistema.",
      422,
    );
  for (const v of [o.code, o.from, o.to, o.warehouse, o.reason])
    if (v !== undefined && (typeof v !== "string" || v.length > 1000))
      throw new ActionError("Parâmetro inválido.", 422);
  return {
    name: o.name,
    ...(o.name === "transfer"
      ? { code: text(o.code, 64), from: text(o.from, 80), to: text(o.to, 80) }
      : ["stockEntry", "adjustStock"].includes(o.name)
        ? { code: text(o.code, 64), warehouse: text(o.warehouse, 80) }
        : { id: integer(o.id) }),
    ...(["transfer", "editRequest", "stockEntry", "adjustStock"].includes(
      o.name,
    )
      ? { quantity: integer(o.quantity, o.name === "adjustStock" ? 0 : 1) }
      : {}),
    ...([
      "transfer",
      "cancelTransfer",
      "requestCancellation",
      "stockEntry",
      "adjustStock",
    ].includes(o.name)
      ? { reason: reason(o.reason) }
      : {}),
  };
}

// Read exactly the requested record with authorization before exposing a preview.
// Mutations use the same official service and transaction as the workspace API.
async function prepare(c: PoolConnection, user: Account, op: JamesOperation) {
  const actor = await first(
    c,
    "SELECT id,block_id,sector FROM users WHERE employee_no=? AND active=TRUE",
    [user.id],
  );
  if (!actor) throw new ActionError("Sessão inválida.", 401);
  if (
    [
      "transfer",
      "cancelTransfer",
      "planRoute",
      "stockEntry",
      "adjustStock",
    ].includes(op.name)
  )
    demand(user, "stock");
  if (["approve", "analyze"].includes(op.name)) demand(user, "approve");
  if (
    [
      "editRequest",
      "deleteRequest",
      "requestCancellation",
      "confirmReceipt",
    ].includes(op.name)
  )
    demand(user, "request");
  if (["stockEntry", "adjustStock"].includes(op.name)) {
    const p = await partLock(c, op.code),
      w = await place(c, op.warehouse);
    const balance = (await stock(c, Number(p.id))).find(
      (b) => Number(b.warehouse_id) === Number(w.id),
    );
    const current = Number(balance?.quantity ?? 0);
    const next =
      op.name === "stockEntry" ? current + op.quantity! : op.quantity!;
    if (next < Number(balance?.reserved ?? 0))
      throw new ActionError("Saldo não pode ficar abaixo das reservas.", 409);
    return {
      actor,
      action: {
        type: op.name,
        code: p.code,
        warehouse: w.name,
        quantity: op.quantity,
        reason: op.reason,
      },
      summary: `${op.name === "stockEntry" ? "Registrar entrada física" : "Corrigir contagem física"} de ${p.name} (${p.code}), em ${w.name}. Saldo: ${current} → ${next} ${p.unit}. Motivo: ${op.reason}. Confirme somente após conferir fisicamente os materiais.`,
    };
  }
  if (op.name === "transfer") {
    const p = await partLock(c, op.code);
    if (!p)
      throw new ActionError("Informe o código exato de um item ativo.", 422);
    const source = await place(c, op.from),
      dest = await place(c, op.to);
    if (source.id === dest.id)
      throw new ActionError("Escolha locais diferentes.", 422);
    const balance = (await stock(c, Number(p.id))).find(
      (b) => Number(b.warehouse_id) === Number(source.id),
    );
    if (
      !balance ||
      available(balance) - Number(balance.minimum_quantity) < op.quantity!
    )
      throw new ActionError(
        "Saldo insuficiente acima das reservas e do mínimo da origem.",
        409,
      );
    return {
      actor,
      action: {
        type: "transfer",
        code: p.code,
        from: source.name,
        to: dest.name,
        quantity: op.quantity,
        reason: op.reason,
      },
      summary: `Solicitar transferência de ${op.quantity} ${p.unit} de ${p.name}: ${source.name} → ${dest.name}. Motivo: ${op.reason}. Disponível na origem: ${available(balance)}; mínimo: ${balance.minimum_quantity}. A saída e o recebimento ainda exigirão conferência física.`,
    };
  }
  if (op.name === "cancelTransfer") {
    const t = await first(
      c,
      "SELECT t.id,t.status,t.quantity,p.name FROM stock_transfers t JOIN parts p ON p.id=t.part_id WHERE t.id=?",
      [op.id],
    );
    if (!t || t.status !== "Solicitada")
      throw new ActionError(
        "Transferência não encontrada ou já saiu da origem.",
        409,
      );
    return {
      actor,
      action: { type: "cancelTransfer", id: op.id, reason: op.reason },
      summary: `Cancelar transferência ${op.id}: ${t.quantity} de ${t.name}. Motivo: ${op.reason}.`,
    };
  }
  const scope =
    user.role === "funcionario"
      ? "AND r.requester_id=?"
      : user.role === "lider"
        ? "AND r.block_id=?"
        : "";
  const params =
    user.role === "funcionario"
      ? [actor.id]
      : user.role === "lider"
        ? [actor.block_id]
        : [];
  const ref = await first(
    c,
    `SELECT r.part_id FROM requests r WHERE r.id=? ${scope}`,
    [op.id, ...params],
  );
  if (!ref)
    throw new ActionError("Requisição não encontrada no seu escopo.", 404);
  await partLock(c, null, ref.part_id);
  const r = await first(
    c,
    `SELECT r.*,p.name,p.unit,b.name AS block FROM requests r JOIN parts p ON p.id=r.part_id JOIN blocks b ON b.id=r.block_id WHERE r.id=? ${scope} FOR UPDATE`,
    [op.id, ...params],
  );
  if (!r)
    throw new ActionError("Requisição não encontrada no seu escopo.", 404);
  const pending = ["Pendente", "Em análise"].includes(String(r.status));
  if (
    (["approve", "editRequest", "deleteRequest"].includes(op.name) &&
      !pending) ||
    (op.name === "analyze" && r.status !== "Pendente") ||
    (["requestCancellation", "planRoute"].includes(op.name) &&
      r.status !== "Aprovada") ||
    (op.name === "confirmReceipt" && (r.status !== "Entregue" || r.received_at))
  )
    throw new ActionError(
      "Essa ação não está disponível na etapa atual do pedido.",
      409,
    );
  const labels = {
    approve: "Aprovar e reservar",
    analyze: "Colocar em análise",
    editRequest: `Alterar quantidade para ${op.quantity} ${r.unit}`,
    deleteRequest: "Excluir pedido pendente",
    requestCancellation: "Solicitar cancelamento",
    confirmReceipt: "Confirmar que você recebeu fisicamente",
    planRoute: "Calcular e registrar rota, sem baixar estoque",
  };
  const label = labels[op.name as keyof typeof labels];
  const action =
    op.name === "approve" || op.name === "analyze"
      ? {
          type: "changeRequestStatus",
          id: op.id,
          status: op.name === "approve" ? "Aprovada" : "Em análise",
        }
      : { type: op.name, id: op.id, quantity: op.quantity, reason: op.reason };
  return {
    actor,
    action,
    summary: `${label}: requisição ${op.id}, ${r.name}, ${r.quantity} ${r.unit}, ${r.block}, status ${r.status}.${op.reason ? ` Motivo: ${op.reason}.` : ""}`,
  };
}
export async function previewJamesOperation(
  user: Account,
  operation: JamesOperation,
) {
  return transaction(async (c) => (await prepare(c, user, operation)).summary);
}
export async function executeJamesOperation(
  user: Account,
  operation: JamesOperation,
  key: string,
  expectedSummary: string,
) {
  return transaction(async (c) => {
    const actor = await first(
      c,
      "SELECT id FROM users WHERE employee_no=? AND active=TRUE",
      [user.id],
    );
    if (!actor) throw new ActionError("Sessão inválida.", 401);
    const hash = createHash("sha256")
      .update(JSON.stringify({ james: operation }))
      .digest("hex");
    // Reuse the existing persistent idempotency ledger. Result and business write commit together.
    await c.execute(
      "INSERT IGNORE INTO request_submissions(actor_id,request_key,payload_hash) VALUES(?,?,?)",
      [actor.id, key, hash],
    );
    const saved = await first(
      c,
      "SELECT payload_hash,result FROM request_submissions WHERE actor_id=? AND request_key=? FOR UPDATE",
      [actor.id, key],
    );
    if (saved.payload_hash !== hash)
      throw new ActionError("Confirmação incompatível.", 409);
    if (saved.result)
      return typeof saved.result === "string"
        ? JSON.parse(saved.result)
        : saved.result;
    const prepared = await prepare(c, user, operation);
    if (prepared.summary !== expectedSummary)
      throw new ActionError(
        "Os dados mudaram desde a revisão. Peça um novo resumo antes de confirmar.",
        409,
      );
    let result: unknown;
    let reply = "Concluído: " + prepared.summary;
    if (operation.name === "planRoute") {
      demand(user, "stock");
      const plan = await recordDeliveryPlan(
        c,
        user,
        { action: "planDelivery" },
        operation.id!,
      );
      result = { id: plan.id, mapVersion: plan.mapVersion };
      reply = plan.route
        ? `Rota registrada: ${plan.labels.join(" → ")}. Custo: ${plan.route.cost} ${plan.metric}. Versão ${plan.mapVersion}. Nenhuma baixa de estoque.`
        : `Operação manual: ${plan.reason} Decisão registrada no histórico, sem baixa de estoque.`;
    } else
      result = await executeInventoryAction(
        user,
        { ...prepared.action, requestKey: key },
        c,
      );
    const response = { result, reply, operationCompleted: true };
    await c.execute(
      "UPDATE request_submissions SET result=? WHERE actor_id=? AND request_key=?",
      [JSON.stringify(response), actor.id, key],
    );
    return response;
  });
}
