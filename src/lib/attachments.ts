import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";

export type IncomingAttachment = {
  filename: string;
  contentType: string;
  /** base64 (standard or url-safe) without data: prefix */
  contentBase64: string;
  size?: number;
};

export type StoredAttachment = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  storagePath: string; // relative under data/attachments
};

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB each
const MAX_FILES = 5;
const MAX_TOTAL_BYTES = 6 * 1024 * 1024; // 6MB total

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
  "application/x-zip-compressed",
]);

function safeFilename(name: string): string {
  const base = path.basename(name || "file").replace(/[^\w.\-()+ ]+/g, "_");
  return base.slice(0, 120) || "file";
}

function guessExt(contentType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
    "text/plain": ".txt",
    "text/csv": ".csv",
  };
  return map[contentType] || "";
}

export function attachmentsRoot(): string {
  return process.env.ATTACHMENTS_DIR || path.join(process.cwd(), "data", "attachments");
}

export async function storeAttachments(
  messageId: string,
  items: IncomingAttachment[] | undefined | null
): Promise<StoredAttachment[]> {
  if (!items?.length) return [];

  const root = attachmentsRoot();
  const dir = path.join(root, messageId);
  await mkdir(dir, { recursive: true });

  const stored: StoredAttachment[] = [];
  let total = 0;

  for (const item of items.slice(0, MAX_FILES)) {
    const contentType = (item.contentType || "application/octet-stream").split(";")[0].trim().toLowerCase();
    if (!ALLOWED_TYPES.has(contentType) && !contentType.startsWith("image/")) {
      continue;
    }

    const b64 = (item.contentBase64 || "").replace(/^data:[^;]+;base64,/, "").trim();
    if (!b64) continue;

    let buf: Buffer;
    try {
      buf = Buffer.from(b64, "base64");
    } catch {
      continue;
    }
    if (!buf.length || buf.length > MAX_FILE_BYTES) continue;
    if (total + buf.length > MAX_TOTAL_BYTES) break;
    total += buf.length;

    const id = randomBytes(8).toString("hex");
    let filename = safeFilename(item.filename || `file-${id}`);
    if (!path.extname(filename)) filename += guessExt(contentType);

    const diskName = `${id}-${filename}`;
    const abs = path.join(dir, diskName);
    await writeFile(abs, buf);

    stored.push({
      id,
      filename,
      contentType,
      size: buf.length,
      storagePath: path.join(messageId, diskName),
    });
  }

  return stored;
}

export function parseAttachmentsJson(json?: string | null): StoredAttachment[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as StoredAttachment[]) : [];
  } catch {
    return [];
  }
}
