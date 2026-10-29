import { z } from "zod";
import { requireSession, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { cleanEmailBody, previewText } from "@/lib/email-body";
import { decodeMimeHeader } from "@/lib/mime-headers";
import { badRequest, json } from "@/lib/utils";

export async function GET(req: Request) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const { searchParams } = new URL(req.url);
  const direction = searchParams.get("direction") || undefined;
  const take = Math.min(Number(searchParams.get("limit") || 50), 200);
  const cursor = searchParams.get("cursor") || undefined;
  // Keep list payloads small: omit heavy bodies unless explicitly requested.
  // The reader fetches full bodies via /api/messages/[id].
  const withBodies = searchParams.get("withBodies") === "1";

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

  if (withBodies) return json({ messages });

  // Decode legacy RFC 2047 subjects (= ?UTF-8?B?...?=) for display
  const light = messages.map(({ textBody, htmlBody, ...rest }) => ({
    ...rest,
    subject: decodeMimeHeader(rest.subject) || rest.subject,
    bodyPreview: previewText(cleanEmailBody(textBody, htmlBody), 140),
    hasHtml: Boolean(htmlBody),
  }));
  return json({ messages: light });
}

const deleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200).optional(),
  allInbound: z.boolean().optional(),
  allOutbound: z.boolean().optional(),
  all: z.boolean().optional(),
});

/** Bulk delete messages */
export async function DELETE(req: Request) {
  const session = await requireSession();
  if (!session) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON");
  }

  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid payload");

  if (parsed.data.all) {
    const result = await prisma.message.deleteMany({});
    return json({ ok: true, count: result.count });
  }

  if (parsed.data.allInbound) {
    const result = await prisma.message.deleteMany({ where: { direction: "inbound" } });
    return json({ ok: true, count: result.count });
  }

  if (parsed.data.allOutbound) {
    const result = await prisma.message.deleteMany({ where: { direction: "outbound" } });
    return json({ ok: true, count: result.count });
  }

  if (!parsed.data.ids?.length) {
    return badRequest("Provide ids, allInbound, allOutbound, or all");
  }

  const result = await prisma.message.deleteMany({
    where: { id: { in: parsed.data.ids } },
  });
  return json({ ok: true, count: result.count });
}
