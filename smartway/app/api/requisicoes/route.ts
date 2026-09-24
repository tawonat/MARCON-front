import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { findCatalogItem } from "@/lib/catalog";
import { demoRequests } from "@/lib/demo-requests";

export async function GET() {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json(
      { error: "Faça login para consultar requisições." },
      { status: 401 },
    );
  }
  const requests = Array.from(demoRequests.values()).filter(
    (item) => item.userId === user.id,
  );
  return NextResponse.json(
    { requests },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json(
      { error: "Origem não autorizada." },
      { status: 403 },
    );
  }
  const user = await currentUser();
  if (!user)
    return NextResponse.json(
      { error: "Faça login para requisitar." },
      { status: 401 },
    );
  if (user.role !== "funcionario")
    return NextResponse.json(
      { error: "Este perfil não pode criar requisições." },
      { status: 403 },
    );

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  }
  if (
    !body ||
    typeof body !== "object" ||
    !("itemId" in body) ||
    !("quantity" in body)
  ) {
    return NextResponse.json(
      { error: "Informe o item e a quantidade." },
      { status: 400 },
    );
  }
  const { itemId, quantity } = body;
  if (typeof itemId !== "string") {
    return NextResponse.json({ error: "Item inválido." }, { status: 400 });
  }
  const item = findCatalogItem(itemId);
  if (!item)
    return NextResponse.json(
      { error: "Item não encontrado." },
      { status: 404 },
    );
  if (
    typeof quantity !== "number" ||
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    quantity > item.stock
  ) {
    return NextResponse.json(
      { error: "Escolha uma quantidade dentro do saldo disponível." },
      { status: 422 },
    );
  }

  // Demo-only storage lasts while the process is running; stock is not reserved.
  const protocol = `REQ-${randomUUID().slice(0, 8).toUpperCase()}`;
  demoRequests.set(protocol, {
    protocol,
    userId: user.id,
    itemId: item.id,
    quantity,
    createdAt: new Date().toISOString(),
  });
  return NextResponse.json(
    { protocol, itemId: item.id, quantity },
    { status: 201 },
  );
}
