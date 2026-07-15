import { requireSession, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { json } from "@/lib/utils";

export async function GET(req: Request) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const { searchParams } = new URL(req.url);
  const direction = searchParams.get("direction") || undefined;
  const take = Math.min(Number(searchParams.get("limit") || 50), 200);
  const cursor = searchParams.get("cursor") || undefined;

  const messages = await prisma.message.findMany({
    where: direction ? { direction } : undefined,
    orderBy: { createdAt: "desc" },
    take,
    ...(cursor
      ? {
          skip: 1,
          cursor: { id: cursor },
        }
      : {}),
    include: { domain: { select: { name: true } } },
  });

  return json({ messages });
}
