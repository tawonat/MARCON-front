import { NextRequest, NextResponse } from "next/server";
import { cookieName, createSession } from "@/lib/auth";
import { demoUsers } from "@/lib/users";
export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Origem não autorizada." }, { status: 403 });
  let data;
  try { data = await request.json(); } catch { return NextResponse.json({ error: "Dados inválidos." }, { status: 400 }); }
  if (!data || typeof data.identity !== "string" || typeof data.password !== "string") return NextResponse.json({ error: "Informe suas credenciais." }, { status: 400 });
  const identity = data.identity.trim().toLowerCase();
  const user = demoUsers.find((item) => item.id === identity || item.email === identity);
  if (!user || data.password !== "Marcon@123") return NextResponse.json({ error: "E-mail, matrícula ou senha incorretos. Tente novamente." }, { status: 401 });
  const response = NextResponse.json({ destination: `/inicio/${user.role}` });
  response.cookies.set(cookieName, createSession(user.id), { httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax", path: "/", maxAge: 8 * 60 * 60 });
  return response;
}
