import { z } from "zod";
import { requireSession, unauthorized } from "@/lib/auth";
import { sendEmail } from "@/lib/resend";
import { badRequest, json } from "@/lib/utils";

const schema = z.object({
  from: z.string().min(3),
  to: z.union([z.string().email(), z.array(z.string().email()).min(1)]),
  subject: z.string().min(1).max(998),
  html: z.string().optional(),
  text: z.string().optional(),
  replyTo: z.string().email().optional(),
});

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
    providerId: result.providerId,
    message: result.message,
  });
}
