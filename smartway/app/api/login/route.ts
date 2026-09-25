import { NextRequest, NextResponse } from "next/server";
import { cookieName, createSession } from "@/lib/auth";
import { demoUsers } from "@/lib/users";
import { databaseEnabled } from "@/lib/db";
import { accountByIdentity } from "@/lib/accounts";
import { verifyPassword } from "@/lib/password";
import { clearFailedLogins, loginBlocked, recordFailedLogin } from "@/lib/login-rate";
export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Origem não autorizada." }, { status: 403 });
  let data;
  try { data = await request.json(); } catch { return NextResponse.json({ error: "Dados inválidos." }, { status: 400 }); }
  if (!data || typeof data.identity !== "string" || typeof data.password !== "string") return NextResponse.json({ error: "Informe suas credenciais." }, { status: 400 });
  const identity = data.identity.trim().toLowerCase();
  if (databaseEnabled() && await loginBlocked(identity)) return NextResponse.json({ error: "Muitas tentativas. Aguarde 15 minutos." }, { status: 429 });
  const account = databaseEnabled() ? await accountByIdentity(identity) : null;
  const user = databaseEnabled() ? account?.account : demoUsers.find((item) => item.id === identity || item.email === identity);
  const valid = databaseEnabled() ? Boolean(account && verifyPassword(data.password, account.passwordHash)) : data.password === "Marcon@123";
  if (!user || !valid) {
    if (databaseEnabled()) await recordFailedLogin(identity);
    return NextResponse.json({ error: "E-mail, matrícula ou senha incorretos. Tente novamente." }, { status: 401 });
  }
  if (databaseEnabled()) await clearFailedLogins(identity);
  const response = NextResponse.json({ destination: `/inicio/${user.role}` });
  response.cookies.set(cookieName, createSession(user.id, account?.passwordHash), { httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax", path: "/", maxAge: 8 * 60 * 60 });
  return response;
}
