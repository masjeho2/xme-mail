import { existsSync, readFileSync } from "fs";
import path from "path";
import { requireSession, unauthorized } from "@/lib/auth";
import { attachmentsRoot, parseAttachmentsJson } from "@/lib/attachments";
import { prisma } from "@/lib/db";
import { maybeFixImageBuffer } from "@/lib/image-fix";
import { notFound } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; attId: string }> }
) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const { id, attId } = await ctx.params;
  const message = await prisma.message.findUnique({ where: { id } });
  if (!message) return notFound("Message not found");

  const list = parseAttachmentsJson(message.attachmentsJson);
  const att = list.find((a) => a.id === attId);
  if (!att) return notFound("Attachment not found");

  const abs = path.resolve(attachmentsRoot(), att.storagePath);
  const root = path.resolve(attachmentsRoot());
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    return notFound("Invalid path");
  }
  if (!existsSync(abs)) return notFound("File missing");

  const raw = readFileSync(abs);
  const contentType = att.contentType || "application/octet-stream";
  const fixed = maybeFixImageBuffer(contentType, raw);
  const isImage = contentType.startsWith("image/");
  const safeName = att.filename.replace(/[^\w.\-()+ ]+/g, "_");

  const headers = new Headers({
    "Content-Type": contentType,
    "Content-Length": String(fixed.length),
    "Content-Disposition": isImage
      ? `inline; filename="${safeName}"`
      : `attachment; filename="${safeName}"`,
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
    "X-Frame-Options": "SAMEORIGIN",
    "Content-Security-Policy":
      "default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'self'",
  });

  const range = req.headers.get("range");
  if (range) {
    const m = range.match(/bytes=(\d+)-(\d*)/);
    if (m) {
      const start = Number(m[1]);
      const end = m[2] ? Number(m[2]) : fixed.length - 1;
      if (start >= 0 && end < fixed.length && start <= end) {
        const slice = fixed.subarray(start, end + 1);
        headers.set("Content-Length", String(slice.length));
        headers.set("Content-Range", `bytes ${start}-${end}/${fixed.length}`);
        return new Response(toArrayBuffer(Buffer.from(slice)), { status: 206, headers });
      }
    }
  }

  return new Response(toArrayBuffer(fixed), { status: 200, headers });
}
