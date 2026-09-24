import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { findCatalogItem } from "@/lib/catalog";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await currentUser())) {
    return NextResponse.json(
      { error: "Acesso não autorizado." },
      { status: 401 },
    );
  }
  const { id } = await params;
  const item = findCatalogItem(id);
  if (!item) {
    return NextResponse.json(
      { error: "Item não encontrado." },
      { status: 404 },
    );
  }
  return NextResponse.json(
    { item },
    { headers: { "Cache-Control": "no-store" } },
  );
}
