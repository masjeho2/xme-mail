import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "./db";
import { sessionOptions, SessionData } from "./session";

export type { SessionData };
export { sessionOptions };

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}

export async function requireSession() {
  const session = await getSession();
  if (!session.isLoggedIn || !session.userId) {
    return null;
  }
  return session;
}

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;

  const session = await getSession();
  session.userId = user.id;
  session.email = user.email;
  session.isLoggedIn = true;
  await session.save();
  return user;
}

export async function logout() {
  const session = await getSession();
  session.destroy();
}

export function unauthorized() {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
