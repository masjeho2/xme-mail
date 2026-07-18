import { storeAttachments, type IncomingAttachment, type StoredAttachment } from "@/lib/attachments";

/**
 * Old/simple CF workers often dump inline images into text/html as:
 *   Content-Disposition: inline; filename="x.jpg"
 *   Content-ID: ...
 *   /9j/4AAQ...base64...
 * Recover those into real attachments and strip junk from body text.
 */

const IMAGE_B64_HINT = /(?:\/9j\/|iVBORw0KGgo|R0lGODlh|UklGR)/; // jpeg/png/gif/webp

function guessTypeFromFilename(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "image/jpeg";
}

function guessTypeFromB64(b64: string): string {
  if (b64.startsWith("/9j/")) return "image/jpeg";
  if (b64.startsWith("iVBORw0KGgo")) return "image/png";
  if (b64.startsWith("R0lGODlh")) return "image/gif";
  if (b64.startsWith("UklGR")) return "image/webp";
  return "image/jpeg";
}

function normalizeB64(chunk: string): string {
  return chunk.replace(/\s+/g, "").replace(/[^A-Za-z0-9+/=]/g, "");
}

/** Pull inline base64 image parts out of a messy text/html body */
export function extractInlineImagesFromBody(body?: string | null): {
  cleaned: string;
  attachments: IncomingAttachment[];
} {
  if (!body) return { cleaned: "", attachments: [] };

  let text = body;
  const attachments: IncomingAttachment[] = [];

  // Pattern A: Content-Disposition block + base64 payload
  const blockRe =
    /Content-Disposition:\s*inline;\s*filename="?([^"\n\r]+)"?[\s\S]{0,400}?(?:Content-ID:[^\n]*\n)?(?:X-Attachment-Id:[^\n]*\n)?\s*([A-Za-z0-9+/=\r\n]{200,})/gi;

  text = text.replace(blockRe, (_full, filename: string, b64raw: string) => {
    const b64 = normalizeB64(b64raw);
    if (b64.length < 200 || !IMAGE_B64_HINT.test(b64raw)) return _full;
    // avoid huge > ~2MB decoded (~2.7M b64 chars)
    if (b64.length > 2_800_000) return "";
    const contentType = guessTypeFromFilename(filename) || guessTypeFromB64(b64);
    attachments.push({
      filename: filename.trim() || "image.jpg",
      contentType,
      contentBase64: b64,
    });
    return "\n";
  });

  // Pattern B: orphan long base64 jpeg/png blob after short real text
  if (!attachments.length && IMAGE_B64_HINT.test(text) && text.length > 2000) {
    const m = text.match(/([A-Za-z0-9+/=\r\n]{500,})/);
    if (m) {
      const b64 = normalizeB64(m[1]);
      if (b64.length > 500 && b64.length < 2_800_000) {
        const contentType = guessTypeFromB64(b64);
        const ext = contentType === "image/png" ? "png" : contentType === "image/gif" ? "gif" : "jpg";
        attachments.push({
          filename: `inline-image.${ext}`,
          contentType,
          contentBase64: b64,
        });
        text = text.replace(m[1], "\n");
      }
    }
  }

  // Strip leftover MIME noise lines
  text = text
    .replace(/^Content-Disposition:.*$/gim, "")
    .replace(/^Content-ID:.*$/gim, "")
    .replace(/^X-Attachment-Id:.*$/gim, "")
    .replace(/^Content-Type:\s*image\/.*$/gim, "")
    .replace(/^Content-Transfer-Encoding:.*$/gim, "")
    .replace(/--[0-9a-zA-Z=_-]{10,}(--)?/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { cleaned: text, attachments };
}

export async function recoverInlineAttachments(
  messageId: string,
  textBody?: string | null,
  htmlBody?: string | null
): Promise<{ textBody: string | null; htmlBody: string | null; stored: StoredAttachment[] }> {
  const fromText = extractInlineImagesFromBody(textBody);
  const fromHtml = extractInlineImagesFromBody(htmlBody);

  // Dedupe by filename+size-ish (base64 prefix) so text+html dumps don't double-store
  const merged = [...fromText.attachments, ...fromHtml.attachments];
  const seen = new Set<string>();
  const incoming = merged
    .filter((a) => {
      const key = `${a.filename}:${a.contentBase64.slice(0, 80)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5);
  let stored: StoredAttachment[] = [];
  if (incoming.length) {
    stored = await storeAttachments(messageId, incoming);
  }

  const cleanedText = fromText.cleaned || null;
  // If html was mostly the image dump, drop it; keep real html otherwise
  let cleanedHtml = htmlBody || null;
  if (fromHtml.attachments.length && (fromHtml.cleaned.length < 40 || IMAGE_B64_HINT.test(htmlBody || ""))) {
    // if original html still looks like real markup without huge b64, keep a cleaned version
    if (/<\/?(?:p|div|html|table|span)\b/i.test(fromHtml.cleaned) && fromHtml.cleaned.length < 100_000) {
      cleanedHtml = fromHtml.cleaned;
    } else if (IMAGE_B64_HINT.test(htmlBody || "")) {
      cleanedHtml = null;
    }
  }

  return {
    textBody: cleanedText,
    htmlBody: cleanedHtml,
    stored,
  };
}
