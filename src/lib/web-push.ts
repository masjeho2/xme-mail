import webpush from "web-push";
import { prisma } from "@/lib/db";

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

function configured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

function setupWebPush() {
  if (!configured()) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:admin@x-me.cloud",
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );
  return true;
}

export async function sendPushToAll(payload: PushPayload) {
  if (!setupWebPush()) {
    return { ok: false as const, skipped: true, reason: "VAPID not configured" };
  }

  const subs = await prisma.pushSubscription.findMany();
  if (!subs.length) {
    return { ok: true as const, sent: 0, removed: 0 };
  }

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || "/dashboard/inbox",
    tag: payload.tag || "xme-mail",
  });

  let sent = 0;
  let removed = 0;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
          { TTL: 60 * 60, urgency: "high" }
        );
        sent++;
      } catch (e: unknown) {
        const status = (e as { statusCode?: number })?.statusCode;
        // Gone / expired subscription
        if (status === 404 || status === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
          removed++;
        }
      }
    })
  );

  return { ok: true as const, sent, removed };
}

export async function notifyNewInboundEmail(msg: {
  id: string;
  fromAddr: string;
  subject: string;
  toAddr: string;
}) {
  return sendPushToAll({
    title: "Email baru",
    body: `${msg.fromAddr}\n${msg.subject || "(no subject)"}`,
    url: `/dashboard/inbox?open=${encodeURIComponent(msg.id)}`,
    tag: `xme-mail-${msg.id}`,
  });
}
