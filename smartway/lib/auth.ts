import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { demoUsers } from "./users";
import { databaseEnabled } from "./db";
import { accountByEmployeeNo, type Account } from "./accounts";
if (databaseEnabled() && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32 || process.env.SESSION_SECRET.startsWith("troque_"))) {
  throw new Error("SESSION_SECRET forte (mínimo 32 caracteres) é obrigatória no modo MySQL.");
}
const globalAuth = globalThis as typeof globalThis & { marconSecret?: string };
const secret = process.env.SESSION_SECRET || (globalAuth.marconSecret ??= randomBytes(32).toString("hex"));
export const cookieName = "marcon_session";
const sign = (value: string) => createHmac("sha256", secret).update(value).digest("hex");
export function createSession(id: string) {
  const payload = `${id}:${Date.now() + 8 * 60 * 60 * 1000}`;
  return `${payload}:${sign(payload)}`;
}
export async function currentUser(): Promise<Account | null> {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  const [id, expiry, signature, extra] = token.split(":");
  if (extra || !id || !expiry || !signature || !/^\d+$/.test(expiry) || Number(expiry) <= Date.now()) return null;
  const expected = Buffer.from(sign(`${id}:${expiry}`));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  if (databaseEnabled()) return accountByEmployeeNo(id);
  return demoUsers.find((user) => user.id === id) ?? null;
}
