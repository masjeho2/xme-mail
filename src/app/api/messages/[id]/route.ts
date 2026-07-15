import { z } from "zod";
import { requireSession, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { badRequest, json, notFound } from "@/lib/utils";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const { id } = await ctx.params;
  const { searchParams } = new URL(req.url);
  const markRead = searchParams.get("markRead") !== "0";

  let message = await prisma.message.findUnique({
    where: { id },
    include: { domain: true },
  });
  if (!message) return notFound("Message not found");

  // Opening an inbound message marks it read by default
  if (markRead && message.direction === "inbound" && !message.isRead) {
    message = await prisma.message.update({
      where: { id },
      data: { isRead: true },
      include: { domain: true },
    });
  }

  return json({ message });
}

const patchSchema = z.object({
  isRead: z.boolean(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON");
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid payload");

  const existing = await prisma.message.findUnique({ where: { id } });
  if (!existing) return notFound("Message not found");

  const message = await prisma.message.update({
    where: { id },
    data: { isRead: parsed.data.isRead },
    include: { domain: true },
  });

  return json({ message });
}
