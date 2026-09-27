import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { databaseEnabled } from "@/lib/db";
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

export async function GET() {
  if (!databaseEnabled()) return unavailable();
  const user = await currentUser();
  if (!user)
    return NextResponse.json({ error: "Faça login." }, { status: 401 });
  try {
    return NextResponse.json(await workspaceSnapshot(user), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
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
