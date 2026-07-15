import { z } from "zod";
import { requireSession, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { badRequest, json } from "@/lib/utils";

const schema = z.object({
  ids: z.array(z.string()).min(1).optional(),
  allInbound: z.boolean().optional(),
  isRead: z.boolean().default(true),
});

/** Bulk mark read/unread */
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
  if (!parsed.success) return badRequest("Invalid payload");

  if (parsed.data.allInbound) {
    const result = await prisma.message.updateMany({
      where: { direction: "inbound", isRead: !parsed.data.isRead },
      data: { isRead: parsed.data.isRead },
    });
    return json({ ok: true, count: result.count });
  }

  if (!parsed.data.ids?.length) {
    return badRequest("Provide ids or allInbound");
  }

  const result = await prisma.message.updateMany({
    where: { id: { in: parsed.data.ids } },
    data: { isRead: parsed.data.isRead },
  });

  return json({ ok: true, count: result.count });
}
