import { requireSession, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sanitizeEmailHtml } from "@/lib/email-html";
import { notFound } from "@/lib/utils";

/** Returns sanitized HTML document for iframe srcDoc-like embedding */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const { id } = await ctx.params;
  const message = await prisma.message.findUnique({ where: { id } });
  if (!message) return notFound("Message not found");

  const html = sanitizeEmailHtml(message.htmlBody);
  if (!html) {
    return new Response("<!doctype html><html><body style='font-family:sans-serif;color:#666;padding:16px'>No HTML body</body></html>", {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": "default-src 'none'; img-src https: data: cid:; style-src 'unsafe-inline'; font-src data: https:; base-uri 'none'; form-action 'none';",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=60",
      },
    });
  }

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Allow remote images + inline CSS; no scripts
      "Content-Security-Policy":
        "default-src 'none'; img-src https: http: data: cid: blob:; style-src 'unsafe-inline'; font-src data: https:; base-uri 'none'; form-action 'none'; frame-ancestors 'self';",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=60",
      "Referrer-Policy": "no-referrer",
    },
  });
}
