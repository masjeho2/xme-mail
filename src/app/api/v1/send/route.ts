import { z } from "zod";
import { scopesInclude, verifyApiKey } from "@/lib/api-key";
import { sendEmail } from "@/lib/resend";
import { clientIp, rateLimit } from "@/lib/security";
import { badRequest, json } from "@/lib/utils";

const schema = z.object({
  from: z.string().min(3).max(320),
  to: z.union([
    z.string().email().max(320),
    z.array(z.string().email().max(320)).min(1).max(20),
  ]),
  subject: z.string().min(1).max(998),
  html: z.string().max(200_000).optional(),
  text: z.string().max(200_000).optional(),
  replyTo: z.string().email().max(320).optional(),
});

export async function POST(req: Request) {
  const ip = clientIp(req);
  const rl = rateLimit(`v1send:${ip}`, 60, 60 * 1000); // 60/min/IP
  if (!rl.ok) {
    return json({ error: "Rate limit exceeded" }, 429);
  }

  const key = await verifyApiKey(req.headers.get("authorization"));
  if (!key) {
    return json({ error: "Invalid or missing API key" }, 401);
  }
  if (!scopesInclude(key.scopes, "send")) {
    return json({ error: "API key missing send scope" }, 403);
  }

  // per-key soft limit
  const rlKey = rateLimit(`v1send:key:${key.id}`, 120, 60 * 1000);
  if (!rlKey.ok) {
    return json({ error: "API key rate limit exceeded" }, 429);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON");
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid send payload", { details: parsed.error.flatten() });

  if (!parsed.data.html && !parsed.data.text) {
    return badRequest("Provide html or text body");
  }

  const result = await sendEmail(parsed.data);
  if (!result.ok) {
    return json({ error: result.error }, result.status || 400);
  }

  return json({
    ok: true,
    simulated: result.simulated,
    id: result.message.id,
    providerId: result.providerId,
  });
}
