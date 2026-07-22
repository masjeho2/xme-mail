import { z } from "zod";
import { storeAttachments } from "@/lib/attachments";
import { prisma } from "@/lib/db";
import { cleanEmailBody } from "@/lib/email-body";
import { recoverInlineAttachments } from "@/lib/inline-mime";
import { logger } from "@/lib/logger";
import { clientIp, rateLimit, safeEqual } from "@/lib/security";
import { badRequest, json } from "@/lib/utils";
import { notifyNewInboundEmail } from "@/lib/web-push";

const attachmentSchema = z.object({
  filename: z.string().max(200).optional().default("file"),
  contentType: z.string().max(120).optional().default("application/octet-stream"),
  contentBase64: z.string().min(1).max(4_000_000),
  size: z.number().int().positive().optional(),
});

const schema = z.object({
  from: z.string().min(1).max(500),
  to: z.union([z.string().max(500), z.array(z.string().max(500)).max(20)]),
  subject: z.string().max(998).optional().default(""),
  text: z.string().max(200_000).optional().nullable(),
  html: z.string().max(500_000).optional().nullable(),
  headers: z.record(z.string(), z.string()).optional(),
  raw: z.string().max(50_000).optional().nullable(),
  attachments: z.array(attachmentSchema).max(5).optional(),
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

  // Allow a bit more for small base64 attachments
  const cl = Number(req.headers.get("content-length") || 0);
  if (cl > 8_000_000) {
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
  let textBody = cleaned === "(empty body)" ? parsed.data.text || null : cleaned;
  let htmlBody = parsed.data.html || null;

  const message = await prisma.message.create({
    data: {
      direction: "inbound",
      status: "received",
      isRead: false,
      fromAddr: parsed.data.from,
      toAddr,
      subject: parsed.data.subject || "(no subject)",
      textBody,
      htmlBody,
      headersJson: parsed.data.headers ? JSON.stringify(parsed.data.headers) : null,
      rawMetaJson: parsed.data.raw
        ? JSON.stringify({ rawPreview: parsed.data.raw.slice(0, 4000) })
        : null,
      domainId,
    },
  });

  let attachmentsCount = 0;
  const storedAll = [];

  if (parsed.data.attachments?.length) {
    try {
      const stored = await storeAttachments(
        message.id,
        parsed.data.attachments.map((a) => ({
          filename: a.filename,
          contentType: a.contentType,
          contentBase64: a.contentBase64,
          size: a.size,
        }))
      );
      storedAll.push(...stored);
    } catch (e) {
      // keep message even if attachment store fails
      logger.warn("attachment store failed", e);
    }
  }

  // Recover inline images dumped into body by simple workers
  try {
    const recovered = await recoverInlineAttachments(message.id, textBody, htmlBody);
    if (recovered.stored.length) storedAll.push(...recovered.stored);
    textBody = recovered.textBody;
    htmlBody = recovered.htmlBody;
    // re-clean text after stripping base64 dump
    if (textBody) {
      const again = cleanEmailBody(textBody, htmlBody);
      if (again && again !== "(empty body)") textBody = again;
    }
  } catch (e) {
    logger.warn("inline attachment recovery failed", e);
  }

  attachmentsCount = storedAll.length;
  const updated = await prisma.message.update({
    where: { id: message.id },
    data: {
      textBody,
      htmlBody,
      attachmentsJson: storedAll.length ? JSON.stringify(storedAll) : null,
    },
  });

  // Web Push (best-effort; don't fail inbound if push fails)
  try {
    await notifyNewInboundEmail({
      id: updated.id,
      fromAddr: updated.fromAddr,
      subject: updated.subject,
      toAddr: updated.toAddr,
    });
  } catch (e) {
    logger.warn("web push notify failed", e);
  }

  return json({ ok: true, id: message.id, attachments: attachmentsCount }, 201);
}
