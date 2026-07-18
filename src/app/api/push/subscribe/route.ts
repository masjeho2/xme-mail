import { z } from "zod";
import { requireSession, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { badRequest, json } from "@/lib/utils";

const schema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(10).max(500),
    auth: z.string().min(8).max(200),
  }),
  userAgent: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  const session = await requireSession();
  if (!session) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON");
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid subscription", { details: parsed.error.flatten() });

  const { endpoint, keys, userAgent } = parsed.data;
  const sub = await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: {
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent: userAgent || req.headers.get("user-agent") || null,
    },
    update: {
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent: userAgent || req.headers.get("user-agent") || null,
    },
  });

  return json({ ok: true, id: sub.id });
}

export async function DELETE(req: Request) {
  const session = await requireSession();
  if (!session) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON");
  }

  const endpoint = (body as { endpoint?: string })?.endpoint;
  if (!endpoint) return badRequest("endpoint required");

  await prisma.pushSubscription.deleteMany({ where: { endpoint } });
  return json({ ok: true });
}

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  const count = await prisma.pushSubscription.count();
  return json({ count });
}
