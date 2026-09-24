import { NextRequest, NextResponse } from "next/server";
import { cookieName, createSession } from "@/lib/auth";
import { demoUsers } from "@/lib/users";
import { databaseEnabled } from "@/lib/db";

// Demo-only reader: never accepts a user ID or role from the client.
// Replace with verified hardware readings when integrating a real RFID reader.
export async function POST(request: NextRequest) {
  if (databaseEnabled()) return NextResponse.json({ error: "Leitura RFID indisponível até a integração de um leitor autenticado." }, { status: 501 });
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Origem não autorizada." }, { status: 403 });
  }
  const user = demoUsers[0];
  const response = NextResponse.json({ destination: `/inicio/${user.role}` });
  response.cookies.set(cookieName, createSession(user.id), {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 8 * 60 * 60,
  });
  return response;
}
