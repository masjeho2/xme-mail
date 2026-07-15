import { createHash, randomBytes } from "crypto";
import { prisma } from "./db";

export function generateApiKey(): { raw: string; prefix: string; hash: string } {
  const raw = `xme_${randomBytes(24).toString("base64url")}`;
  const prefix = raw.slice(0, 12);
  const hash = hashApiKey(raw);
  return { raw, prefix, hash };
}

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export async function verifyApiKey(authHeader: string | null) {
  if (!authHeader) return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const raw = m[1].trim();
  if (!raw.startsWith("xme_")) return null;

  const keyHash = hashApiKey(raw);
  const key = await prisma.apiKey.findUnique({ where: { keyHash } });
  if (!key || !key.active) return null;

  await prisma.apiKey.update({
    where: { id: key.id },
    data: { lastUsedAt: new Date() },
  });

  return key;
}

export function scopesInclude(scopes: string, needed: string): boolean {
  return scopes.split(",").map((s) => s.trim()).includes(needed) || scopes.includes("*");
}
