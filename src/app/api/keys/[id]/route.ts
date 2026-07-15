import { requireSession, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { json, notFound } from "@/lib/utils";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const { id } = await ctx.params;
  const existing = await prisma.apiKey.findUnique({ where: { id } });
  if (!existing) return notFound("API key not found");

  await prisma.apiKey.delete({ where: { id } });
  return json({ ok: true });
}
