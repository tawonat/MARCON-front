import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { catalogItems } from "@/lib/catalog";

export async function GET() {
  if (!(await currentUser())) {
    return NextResponse.json(
      { error: "Acesso não autorizado." },
      { status: 401 },
    );
  }
  return NextResponse.json(
    { items: catalogItems },
    { headers: { "Cache-Control": "no-store" } },
  );
}
