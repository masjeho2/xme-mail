import { z } from "zod";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { sessionOptions, SessionData } from "@/lib/session";
import { clientIp, rateLimit } from "@/lib/security";
import { badRequest, json } from "@/lib/utils";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

export async function POST(req: Request) {
  const ip = clientIp(req);
  const rl = rateLimit(`login:${ip}`, 10, 15 * 60 * 1000); // 10 / 15 min / IP
  if (!rl.ok) {
    return json(
      { error: "Terlalu banyak percobaan login. Coba lagi nanti." },
      429
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON");
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Invalid credentials payload");
  }

  const email = parsed.data.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    // dummy work to reduce user-enumeration timing a bit
    await bcrypt.compare(parsed.data.password, "$2b$12$invalidhashinvalidhashinvalidhashinvalidhashinvalidhu");
    return json({ error: "Email atau password salah" }, 401);
  }

  const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!ok) {
    return json({ error: "Email atau password salah" }, 401);
  }

  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
  session.userId = user.id;
  session.email = user.email;
  session.isLoggedIn = true;
  await session.save();

  return json({
    ok: true,
    user: { id: user.id, email: user.email, name: user.name },
  });
}
