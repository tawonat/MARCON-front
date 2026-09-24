import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { catalogItems } from "@/lib/catalog";
import { databaseEnabled } from "@/lib/db";
import { workspaceSnapshot } from "@/lib/workspace-db";

export async function GET() {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json(
      { error: "Acesso não autorizado." },
      { status: 401 },
    );
  }
  const items = databaseEnabled()
    ? (await workspaceSnapshot(user)).stock.map((part) => ({
        id: part.code, name: part.name, category: "Peças", stock: part.quantity,
        unit: "unidades", location: part.location, description: part.name,
        specification: `QR/ID ${part.qrCode ?? part.code}`,
      }))
    : catalogItems;
  return NextResponse.json(
    { items },
    { headers: { "Cache-Control": "no-store" } },
  );
}
