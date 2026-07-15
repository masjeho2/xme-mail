import { z } from "zod";
import { prisma } from "@/lib/db";
import { cleanEmailBody } from "@/lib/email-body";
import { clientIp, rateLimit, safeEqual } from "@/lib/security";
import { badRequest, json } from "@/lib/utils";

const schema = z.object({
  from: z.string().min(1).max(500),
  to: z.union([z.string().max(500), z.array(z.string().max(500)).max(20)]),
  subject: z.string().max(998).optional().default(""),
  text: z.string().max(200_000).optional().nullable(),
  html: z.string().max(500_000).optional().nullable(),
  headers: z.record(z.string(), z.string()).optional(),
  raw: z.string().max(50_000).optional().nullable(),
});

function extractDomain(addr: string): string | null {
  const m = addr.toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})/);
  return m ? m[1] : null;
}

function normalizeTo(to: string | string[]): string {
  return Array.isArray(to) ? to.join(", ") : to;
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  const rl = rateLimit(`inbound:${ip}`, 120, 60 * 1000); // 120/min
  if (!rl.ok) {
    return json({ error: "Rate limit exceeded" }, 429);
  }

  // Reject oversized bodies early
  const cl = Number(req.headers.get("content-length") || 0);
  if (cl > 600_000) {
    return json({ error: "Payload too large" }, 413);
  }

  const secret = process.env.WEBHOOK_SECRET || "";
  const provided =
    req.headers.get("x-webhook-secret") ||
    req.headers.get("X-Webhook-Secret") ||
    "";

  if (!secret || !safeEqual(provided, secret)) {
    return json({ error: "Invalid webhook secret" }, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON");
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Invalid inbound payload", { details: parsed.error.flatten() });
  }

  const toAddr = normalizeTo(parsed.data.to);
  const firstTo = (Array.isArray(parsed.data.to) ? parsed.data.to[0] : parsed.data.to) || "";
  const domainName = extractDomain(firstTo);
  let domainId: string | null = null;
  if (domainName) {
    const domain = await prisma.domain.findUnique({ where: { name: domainName } });
    domainId = domain?.id ?? null;
  }

  // Optional: only accept mail for known active aliases when CF catch-all is off this is defense-in-depth
  // (still store if domain registered; unknown local parts can be dropped if STRICT_ALIAS_INBOUND=true)
  if (process.env.STRICT_ALIAS_INBOUND === "true" && domainId) {
    const local = (firstTo.split("@")[0] || "").toLowerCase();
    const alias = await prisma.alias.findFirst({
      where: { domainId, localPart: local, active: true },
    });
    if (!alias) {
      return json({ ok: true, ignored: true, reason: "alias not found" }, 202);
    }
  }

  const cleaned = cleanEmailBody(parsed.data.text, parsed.data.html);
  const textBody = cleaned === "(empty body)" ? parsed.data.text || null : cleaned;

  const message = await prisma.message.create({
    data: {
      direction: "inbound",
      status: "received",
      isRead: false,
      fromAddr: parsed.data.from,
      toAddr,
      subject: parsed.data.subject || "(no subject)",
      textBody,
      htmlBody: parsed.data.html || null,
      headersJson: parsed.data.headers ? JSON.stringify(parsed.data.headers) : null,
      rawMetaJson: parsed.data.raw
        ? JSON.stringify({ rawPreview: parsed.data.raw.slice(0, 4000) })
        : null,
      domainId,
    },
  });

  return json({ ok: true, id: message.id }, 201);
}
