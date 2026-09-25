import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { databaseEnabled } from "@/lib/db";
import { workspaceSnapshot } from "@/lib/workspace-db";
import { ActionError, executeWorkspaceAction } from "@/lib/workspace-actions";

export const runtime = "nodejs";
const unavailable = () => NextResponse.json({ error: "Configure DB_NAME e DB_USER (ou DATABASE_URL) para usar o modo persistente." }, { status: 503 });

export async function GET() {
  if (!databaseEnabled()) return unavailable();
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Faça login." }, { status: 401 });
  return NextResponse.json(await workspaceSnapshot(user), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (!databaseEnabled()) return unavailable();
  if (request.headers.get("origin") !== request.nextUrl.origin)
    return NextResponse.json({ error: "Origem não autorizada." }, { status: 403 });
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Faça login." }, { status: 401 });
  let payload: unknown;
  try { payload = await request.json(); }
  catch { return NextResponse.json({ error: "Dados inválidos." }, { status: 400 }); }
  try {
    const result = await executeWorkspaceAction(user, payload);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ActionError) return NextResponse.json({ error: error.message }, { status: error.status });
    const code = (error as { code?: string }).code;
    if (code === "ER_DUP_ENTRY") return NextResponse.json({ error: "Código, QR, matrícula ou e-mail já cadastrado." }, { status: 409 });
    throw error;
  }
}
