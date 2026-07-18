/**
 * Cloudflare Email Worker for xme-mail
 *
 * Secrets/vars:
 *   WEBHOOK_URL    = https://mail.example.com/api/inbound/cloudflare
 *   WEBHOOK_SECRET = same as panel .env
 *
 * Limits (Cloudflare Email Workers):
 *   - Best-effort MIME parse
 *   - Small attachments only (images/pdf/docs), base64 in JSON
 */

export interface Env {
  WEBHOOK_URL: string;
  WEBHOOK_SECRET: string;
}

type ParsedAttachment = {
  filename: string;
  contentType: string;
  contentBase64: string;
  size: number;
};

async function streamToArrayBuffer(stream: ReadableStream<Uint8Array>, maxBytes: number) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.length;
    if (total > maxBytes) {
      chunks.push(value.slice(0, Math.max(0, value.length - (total - maxBytes))));
      break;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const c of chunks) {
    const slice = c.subarray(0, Math.min(c.length, out.length - offset));
    out.set(slice, offset);
    offset += slice.length;
    if (offset >= out.length) break;
  }
  return out;
}

function extractHeader(raw: string, name: string): string {
  const re = new RegExp(`^${name}:\\s*(.+)$`, "im");
  const m = raw.match(re);
  return m ? m[1].trim() : "";
}

function decodeQuotedPrintable(input: string): string {
  const soft = input.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < soft.length; i++) {
    if (soft[i] === "=" && i + 2 < soft.length && /^[0-9A-Fa-f]{2}$/.test(soft.slice(i + 1, i + 3))) {
      bytes.push(parseInt(soft.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(soft.charCodeAt(i) & 0xff);
    }
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(Uint8Array.from(bytes));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function parseContentType(headerValue: string): { type: string; name?: string; boundary?: string } {
  const parts = headerValue.split(";").map((p) => p.trim());
  const type = (parts[0] || "application/octet-stream").toLowerCase();
  let name: string | undefined;
  let boundary: string | undefined;
  for (const p of parts.slice(1)) {
    const m = p.match(/^([^=]+)=(.*)$/);
    if (!m) continue;
    const k = m[1].trim().toLowerCase();
    const v = m[2].trim().replace(/^"(.*)"$/, "$1");
    if (k === "name" || k === "filename") name = v;
    if (k === "boundary") boundary = v;
  }
  return { type, name, boundary };
}

function splitHeadersBody(part: string): { headers: string; body: string } {
  const idx = part.search(/\r?\n\r?\n/);
  if (idx < 0) return { headers: part, body: "" };
  return { headers: part.slice(0, idx), body: part.slice(idx).replace(/^\r?\n\r?\n/, "") };
}

function getHeader(headers: string, name: string): string {
  const re = new RegExp(`^${name}:\\s*([\\s\\S]*?)(?=\\r?\\n\\S|$)`, "im");
  const m = headers.match(re);
  if (!m) return "";
  return m[1].replace(/\r?\n[ \t]+/g, " ").trim();
}

function isAllowedAttachment(ct: string): boolean {
  const t = ct.toLowerCase();
  if (t.startsWith("image/")) return true;
  return (
    t === "application/pdf" ||
    t === "text/plain" ||
    t === "text/csv" ||
    t === "application/msword" ||
    t === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    t === "application/vnd.ms-excel" ||
    t === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    t === "application/zip" ||
    t === "application/x-zip-compressed"
  );
}

function decodePartBody(body: string, transferEncoding: string): Uint8Array {
  const te = transferEncoding.toLowerCase();
  if (te.includes("base64")) {
    const clean = body.replace(/\s+/g, "");
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  if (te.includes("quoted-printable")) {
    const text = decodeQuotedPrintable(body);
    return new TextEncoder().encode(text);
  }
  return new TextEncoder().encode(body);
}

function parseMime(raw: string): {
  text: string;
  html: string;
  attachments: ParsedAttachment[];
} {
  let text = "";
  let html = "";
  const attachments: ParsedAttachment[] = [];

  const contentTypeTop = extractHeader(raw, "Content-Type") || "text/plain";
  const top = parseContentType(contentTypeTop);

  // Non-multipart
  if (!top.boundary) {
    const { headers, body } = splitHeadersBody(raw.includes("\r\n\r\n") ? raw : `\n\n${raw}`);
    const te = getHeader(headers, "Content-Transfer-Encoding") || extractHeader(raw, "Content-Transfer-Encoding");
    const ct = parseContentType(getHeader(headers, "Content-Type") || contentTypeTop);
    let decoded = body;
    if (/quoted-printable/i.test(te)) decoded = decodeQuotedPrintable(body);
    if (/base64/i.test(te)) {
      try {
        decoded = new TextDecoder().decode(decodePartBody(body, "base64"));
      } catch {
        /* keep */
      }
    }
    if (ct.type.includes("html")) html = decoded;
    else text = decoded;
    return { text, html, attachments };
  }

  const boundary = top.boundary;
  const parts = raw.split(new RegExp(`\\r?\\n--${boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:--)?`));

  for (const part of parts) {
    if (!part || /^--/.test(part.trim()) || part.includes("MIME-Version") && !/Content-Type:/i.test(part)) {
      // skip preamble-ish
    }
    if (!/Content-Type:/i.test(part)) continue;

    const { headers, body } = splitHeadersBody(part);
    if (!body) continue;

    const ctRaw = getHeader(headers, "Content-Type");
    if (!ctRaw) continue;
    const ct = parseContentType(ctRaw);
    const te = getHeader(headers, "Content-Transfer-Encoding") || "7bit";
    const cd = getHeader(headers, "Content-Disposition");
    const filenameFromCd = (cd.match(/filename\*?=(?:UTF-8''|")?([^\";]+)"?/i) || [])[1];
    const filename = (filenameFromCd || ct.name || "file").replace(/["']/g, "").trim();
    const isAttachment =
      /attachment/i.test(cd) ||
      (/inline/i.test(cd) && Boolean(filenameFromCd || ct.name)) ||
      (Boolean(ct.name) && !ct.type.startsWith("text/"));

    // Nested multipart: shallow recurse by scanning only
    if (ct.type.startsWith("multipart/") && ct.boundary) {
      const nested = parseMime(
        `Content-Type: ${ctRaw}\r\n\r\n${body}`
      );
      if (!text && nested.text) text = nested.text;
      if (!html && nested.html) html = nested.html;
      for (const a of nested.attachments) {
        if (attachments.length < 5) attachments.push(a);
      }
      continue;
    }

    if (ct.type === "text/html" && !isAttachment) {
      let decoded = body;
      if (/quoted-printable/i.test(te)) decoded = decodeQuotedPrintable(body);
      else if (/base64/i.test(te)) {
        try {
          decoded = new TextDecoder().decode(decodePartBody(body, "base64"));
        } catch {
          /* keep */
        }
      }
      if (decoded.length > (html?.length || 0)) html = decoded.slice(0, 400_000);
      continue;
    }

    if (ct.type === "text/plain" && !isAttachment) {
      let decoded = body;
      if (/quoted-printable/i.test(te)) decoded = decodeQuotedPrintable(body);
      else if (/base64/i.test(te)) {
        try {
          decoded = new TextDecoder().decode(decodePartBody(body, "base64"));
        } catch {
          /* keep */
        }
      }
      if (decoded.length > (text?.length || 0)) text = decoded.slice(0, 100_000);
      continue;
    }

    // Attachments (small only)
    if ((isAttachment || !ct.type.startsWith("text/")) && isAllowedAttachment(ct.type) && attachments.length < 5) {
      try {
        const bytes = decodePartBody(body, te);
        // Cap ~1.5MB each to keep worker JSON reasonable
        if (bytes.length > 0 && bytes.length <= 1.5 * 1024 * 1024) {
          attachments.push({
            filename: filename.slice(0, 120) || "file",
            contentType: ct.type,
            contentBase64: bytesToBase64(bytes),
            size: bytes.length,
          });
        }
      } catch {
        /* skip bad part */
      }
    }
  }

  // Fallback crude extract if multipart parse failed
  if (!html && /Content-Type:\s*text\/html/i.test(raw)) {
    const htmlPart = raw.split(/Content-Type:\s*text\/html/i)[1] || "";
    html = htmlPart.slice(0, 200_000);
  }
  if (!text && /Content-Type:\s*text\/plain/i.test(raw)) {
    const textPart = raw.split(/Content-Type:\s*text\/plain/i)[1] || "";
    text = textPart.replace(/^[\s\S]*?\r?\n\r?\n/, "").slice(0, 50_000);
  }

  return { text, html, attachments };
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const worker = {
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    const maxRaw = 3 * 1024 * 1024; // 3MB raw cap
    const rawBytes = await streamToArrayBuffer(message.raw, maxRaw);
    const raw = new TextDecoder().decode(rawBytes);

    const subject = message.headers.get("subject") || extractHeader(raw, "Subject") || "(no subject)";
    const from = message.from || extractHeader(raw, "From") || "";
    const to = message.to || extractHeader(raw, "To") || "";

    const parsed = parseMime(raw);
    let text = parsed.text;
    const html = parsed.html;
    if (!text && html) text = stripHtml(html).slice(0, 20_000);

    const payload = {
      from,
      to,
      subject,
      text: text || null,
      html: html || null,
      headers: {
        messageId: message.headers.get("message-id") || "",
        date: message.headers.get("date") || "",
      },
      raw: raw.slice(0, 4000),
      attachments: parsed.attachments,
    };

    const res = await fetch(env.WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": env.WEBHOOK_SECRET,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Webhook failed ${res.status}: ${body.slice(0, 200)}`);
    }
  },
};

export default worker;
