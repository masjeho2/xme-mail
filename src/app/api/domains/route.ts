import { z } from "zod";
import { requireSession, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { badRequest, json } from "@/lib/utils";

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();

  const domains = await prisma.domain.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { aliases: true, messages: true } } },
  });
  return json({ domains });
}

const createSchema = z.object({
  name: z
    .string()
    .min(3)
    .max(253)
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, "Invalid domain"),
  active: z.boolean().optional(),
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

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid domain", { details: parsed.error.flatten() });

  const name = parsed.data.name.toLowerCase();
  const existing = await prisma.domain.findUnique({ where: { name } });
  if (existing) return badRequest("Domain already exists");

  const domain = await prisma.domain.create({
    data: { name, active: parsed.data.active ?? true },
  });
  return json({ domain }, 201);
}
