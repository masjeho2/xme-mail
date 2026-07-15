import { Resend } from "resend";
import { prisma } from "./db";

export function getResend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

export type SendInput = {
  from: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
};

function parseEmail(addr: string): { local: string; domain: string } | null {
  const m = addr.trim().toLowerCase().match(/^(?:.*<)?([a-z0-9._%+-]+)@([a-z0-9.-]+\.[a-z]{2,})>?$/i);
  if (!m) return null;
  return { local: m[1].toLowerCase(), domain: m[2].toLowerCase() };
}

/** Ensure from address is an active send-capable alias on a registered domain */
export async function assertCanSendFrom(from: string) {
  const parsed = parseEmail(from);
  if (!parsed) {
    return { ok: false as const, error: "Invalid from address" };
  }

  const domain = await prisma.domain.findUnique({ where: { name: parsed.domain } });
  if (!domain || !domain.active) {
    return { ok: false as const, error: `Domain not registered: ${parsed.domain}` };
  }

  const alias = await prisma.alias.findUnique({
    where: {
      localPart_domainId: {
        localPart: parsed.local,
        domainId: domain.id,
      },
    },
  });

  if (!alias || !alias.active) {
    return { ok: false as const, error: `Alias not found: ${parsed.local}@${parsed.domain}` };
  }
  if (!alias.canSend) {
    return { ok: false as const, error: `Alias cannot send: ${parsed.local}@${parsed.domain}` };
  }

  return {
    ok: true as const,
    domain,
    alias,
    fromAddr: `${parsed.local}@${parsed.domain}`,
  };
}

export async function sendEmail(input: SendInput) {
  const check = await assertCanSendFrom(input.from);
  if (!check.ok) {
    return { ok: false as const, error: check.error, status: 400 };
  }

  const resend = getResend();
  const toList = Array.isArray(input.to) ? input.to : [input.to];
  const toAddr = toList.join(", ");

  if (!resend) {
    // Dev mode without Resend: log outbound only
    const msg = await prisma.message.create({
      data: {
        direction: "outbound",
        status: "queued",
        fromAddr: check.fromAddr,
        toAddr,
        subject: input.subject,
        textBody: input.text || null,
        htmlBody: input.html || null,
        domainId: check.domain.id,
        error: "RESEND_API_KEY not set — message queued locally only",
      },
    });
    return {
      ok: true as const,
      simulated: true,
      message: msg,
      providerId: null as string | null,
    };
  }

  try {
    // Resend types require at least one of text/html/react — build payload explicitly
    const text = input.text?.trim() || undefined;
    const html = input.html?.trim() || undefined;
    const payload = {
      from: check.fromAddr,
      to: toList,
      subject: input.subject,
      ...(html ? { html } : {}),
      ...(text ? { text } : !html ? { text: " " } : {}),
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    };

    const result = await resend.emails.send(payload as Parameters<typeof resend.emails.send>[0]);

    if (result.error) {
      const msg = await prisma.message.create({
        data: {
          direction: "outbound",
          status: "failed",
          fromAddr: check.fromAddr,
          toAddr,
          subject: input.subject,
          textBody: input.text || null,
          htmlBody: input.html || null,
          domainId: check.domain.id,
          error: result.error.message,
        },
      });
      return { ok: false as const, error: result.error.message, status: 502, message: msg };
    }

    const providerId = result.data?.id ?? null;
    const msg = await prisma.message.create({
      data: {
        direction: "outbound",
        status: "sent",
        fromAddr: check.fromAddr,
        toAddr,
        subject: input.subject,
        textBody: input.text || null,
        htmlBody: input.html || null,
        domainId: check.domain.id,
        providerId,
      },
    });

    return { ok: true as const, simulated: false, message: msg, providerId };
  } catch (e) {
    const err = e instanceof Error ? e.message : "Send failed";
    const msg = await prisma.message.create({
      data: {
        direction: "outbound",
        status: "failed",
        fromAddr: check.fromAddr,
        toAddr,
        subject: input.subject,
        textBody: input.text || null,
        htmlBody: input.html || null,
        domainId: check.domain.id,
        error: err,
      },
    });
    return { ok: false as const, error: err, status: 502, message: msg };
  }
}
