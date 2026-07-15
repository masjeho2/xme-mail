import { requireSession, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { json } from "@/lib/utils";

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [domains, aliases, inbound24h, outbound24h, failed24h, unreadInbound, recent] =
    await Promise.all([
      prisma.domain.count(),
      prisma.alias.count({ where: { active: true } }),
      prisma.message.count({ where: { direction: "inbound", createdAt: { gte: since } } }),
      prisma.message.count({ where: { direction: "outbound", createdAt: { gte: since } } }),
      prisma.message.count({ where: { status: "failed", createdAt: { gte: since } } }),
      prisma.message.count({ where: { direction: "inbound", isRead: false } }),
      prisma.message.findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          direction: true,
          status: true,
          isRead: true,
          fromAddr: true,
          toAddr: true,
          subject: true,
          createdAt: true,
        },
      }),
    ]);

  return json({
    stats: { domains, aliases, inbound24h, outbound24h, failed24h, unreadInbound },
    recent,
  });
}
