import { createHash, randomBytes } from "crypto";
import { prisma } from "./db";
import { logger } from "./logger";

export function generateApiKey(): { raw: string; prefix: string; hash: string } {
  const raw = `xme_${randomBytes(24).toString("base64url")}`;
  const prefix = raw.slice(0, 12);
  const hash = hashApiKey(raw);
  return { raw, prefix, hash };
}

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Throttle lastUsedAt writes — at most once per key every 60s */
const lastTouch = new Map<string, number>();
const TOUCH_INTERVAL_MS = 60_000;

export async function verifyApiKey(authHeader: string | null) {
  if (!authHeader) return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const raw = m[1].trim();
  if (!raw.startsWith("xme_")) return null;

  const keyHash = hashApiKey(raw);
  const key = await prisma.apiKey.findUnique({ where: { keyHash } });
  if (!key || !key.active) return null;

  const now = Date.now();
  const prev = lastTouch.get(key.id) || 0;
  if (now - prev >= TOUCH_INTERVAL_MS) {
    lastTouch.set(key.id, now);
    // Fire-and-forget; don't block auth on a write
    prisma.apiKey
      .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
      .catch((e) => logger.warn("apiKey lastUsedAt update failed", e));
  }

  return key;
}

export function scopesInclude(scopes: string, needed: string): boolean {
  return scopes.split(",").map((s) => s.trim()).includes(needed) || scopes.includes("*");
}
