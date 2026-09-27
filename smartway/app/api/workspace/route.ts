import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { databaseEnabled, getPool } from "@/lib/db";
import { demand, integer } from "@/lib/permissions";
import type { RowDataPacket } from "mysql2";
import { workspaceSnapshot } from "@/lib/workspace-db";
import { ActionError, executeWorkspaceAction } from "@/lib/workspace-actions";

export const runtime = "nodejs";
const unavailable = () =>
  NextResponse.json(
    {
      error:
        "Configure DB_NAME e DB_USER (ou DATABASE_URL) para usar o modo persistente.",
    },
    { status: 503 },
  );

export async function GET(request: NextRequest) {
  if (!databaseEnabled()) return unavailable();
  const user = await currentUser();
  if (!user)
    return NextResponse.json({ error: "Faça login." }, { status: 401 });
  try {
    if (request.nextUrl.searchParams.has("transfers")) {
      demand(user, "stock");
      const page = integer(
        Number(request.nextUrl.searchParams.get("page") ?? 1),
      );
      if (page > 10000) throw new ActionError("Página inválida.");
      const mode = request.nextUrl.searchParams.get("mode") || "all",
        code = request.nextUrl.searchParams.get("code") || "",
        warehouse = request.nextUrl.searchParams.get("warehouse") || "";
      if (
        !["all", "analysis", "history"].includes(mode) ||
        code.length > 64 ||
        warehouse.length > 80
      )
        throw new ActionError("Filtro de transferências inválido.");
      const clauses = ["1=1"],
        params: string[] = [];
      const block = request.nextUrl.searchParams.get("block") || "",
        from = request.nextUrl.searchParams.get("from") || "",
        to = request.nextUrl.searchParams.get("to") || "";
      const validDate = (v: string) =>
        !v ||
        (/^\d{4}-\d{2}-\d{2}$/.test(v) &&
          !Number.isNaN(Date.parse(v)) &&
          new Date(v).toISOString().slice(0, 10) === v);
      if (
        block.length > 80 ||
        !validDate(from) ||
        !validDate(to) ||
        (from && to && from > to)
      )
        throw new ActionError("Período/bloco inválido.");
      if (block) {
        clauses.push(
          "EXISTS(SELECT 1 FROM blocks b WHERE b.id=d.block_id AND b.name=?)",
        );
        params.push(block);
      }
      if (mode === "history" && from) {
        clauses.push("t.created_at>=?");
        params.push(from);
      }
      if (mode === "history" && to) {
        clauses.push("t.created_at<DATE_ADD(?,INTERVAL 1 DAY)");
        params.push(to);
      }
      if (mode === "analysis")
        clauses.push("t.status IN ('Solicitada','Em trânsito')");
      if (mode === "history")
        clauses.push("t.status IN ('Recebida','Cancelada')");
      if (code) {
        clauses.push("p.code=?");
        params.push(code);
      }
      if (warehouse) {
        clauses.push("(s.name=? OR d.name=?)");
        params.push(warehouse, warehouse);
      }
      const [transfers] = await getPool().query<RowDataPacket[]>(
        `SELECT t.id,t.status,t.quantity,t.reason,t.created_at,t.shipped_at,t.received_at,p.code,s.name AS source,d.name AS destination,u.name AS requester,su.name AS shipper,ru.name AS receiver FROM stock_transfers t JOIN parts p ON p.id=t.part_id JOIN warehouses s ON s.id=t.source_warehouse_id JOIN warehouses d ON d.id=t.destination_warehouse_id JOIN users u ON u.id=t.performed_by LEFT JOIN users su ON su.id=t.shipped_by LEFT JOIN users ru ON ru.id=t.received_by WHERE ${clauses.join(" AND ")} ORDER BY t.id DESC LIMIT 50 OFFSET ${(page - 1) * 50}`,
        params,
      );
      return NextResponse.json(
        { transfers },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(await workspaceSnapshot(user), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof ActionError)
      return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json(
      {
        error:
          "Não foi possível carregar o estoque. Verifique o MySQL e execute npm run db:migrate.",
      },
      { status: 503 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!databaseEnabled()) return unavailable();
  if (request.headers.get("origin") !== request.nextUrl.origin)
    return NextResponse.json(
      { error: "Origem não autorizada." },
      { status: 403 },
    );
  const user = await currentUser();
  if (!user)
    return NextResponse.json({ error: "Faça login." }, { status: 401 });
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  }
  try {
    const result = await executeWorkspaceAction(user, payload);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof ActionError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    const code = (error as { code?: string }).code;
    if (code === "ER_DUP_ENTRY")
      return NextResponse.json(
        { error: "Código, QR, matrícula ou e-mail já cadastrado." },
        { status: 409 },
      );
    if (["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(code ?? ""))
      return NextResponse.json(
        {
          error:
            "Outra operação alterou este saldo. Atualize e tente novamente.",
        },
        { status: 409 },
      );
    console.error("[workspace] action failed", code ?? "unknown");
    return NextResponse.json(
      { error: "Operação não concluída. Verifique o banco e as migrações." },
      { status: 503 },
    );
  }
}
