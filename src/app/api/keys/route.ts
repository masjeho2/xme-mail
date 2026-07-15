import { z } from "zod";
import { requireSession, unauthorized } from "@/lib/auth";
import { generateApiKey } from "@/lib/api-key";
import { prisma } from "@/lib/db";
import { badRequest, json } from "@/lib/utils";

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();

  const keys = await prisma.apiKey.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      scopes: true,
      active: true,
      lastUsedAt: true,
      createdAt: true,
    },
  });
  return json({ keys });
}

const createSchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.string().optional(),
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
  if (!parsed.success) return badRequest("Invalid payload");

  const { raw, prefix, hash } = generateApiKey();
  const key = await prisma.apiKey.create({
    data: {
      name: parsed.data.name,
      keyPrefix: prefix,
      keyHash: hash,
      scopes: parsed.data.scopes || "send",
      userId: session.userId,
    },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      scopes: true,
      active: true,
      createdAt: true,
    },
  });

  // raw only returned once
  return json({ key, secret: raw }, 201);
}
