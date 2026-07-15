/**
 * Cloudflare Email Worker for x-me.cloud
 *
 * Deploy:
 *   1. wrangler deploy (or paste into CF Dashboard → Workers)
 *   2. Email Routing → route catch-all / address → this Worker
 *   3. Set secrets: WEBHOOK_URL, WEBHOOK_SECRET
 *
 * wrangler.toml example:
 *   name = "xme-email-worker"
 *   main = "email-worker.ts"
 *   compatibility_date = "2024-11-01"
 */

export interface Env {
  WEBHOOK_URL: string;
  WEBHOOK_SECRET: string;
}

async function streamToArrayBuffer(stream: ReadableStream<Uint8Array>, streamSize: number) {
  const result = new Uint8Array(streamSize);
  let bytesRead = 0;
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result.set(value, bytesRead);
    bytesRead += value.length;
  }
  return result;
}

function extractHeader(raw: string, name: string): string {
  const re = new RegExp(`^${name}:\\s*(.+)$`, "im");
  const m = raw.match(re);
  return m ? m[1].trim() : "";
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export default {
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    const rawSize = message.rawSize || 256 * 1024;
    const rawBytes = await streamToArrayBuffer(message.raw, Math.min(rawSize, 1024 * 1024));
    const raw = new TextDecoder().decode(rawBytes);

    const subject = message.headers.get("subject") || extractHeader(raw, "Subject") || "(no subject)";
    const from = message.from || extractHeader(raw, "From") || "";
    const to = message.to || extractHeader(raw, "To") || "";

    // Best-effort body extraction (multipart not fully parsed)
    let text = "";
    let html = "";
    if (raw.includes("Content-Type: text/html")) {
      const htmlPart = raw.split(/Content-Type:\s*text\/html/i)[1] || "";
      html = htmlPart.slice(0, 50_000);
      text = stripHtml(html).slice(0, 20_000);
    } else if (raw.includes("Content-Type: text/plain")) {
      const textPart = raw.split(/Content-Type:\s*text\/plain/i)[1] || "";
      text = textPart.replace(/^[\s\S]*?\r?\n\r?\n/, "").slice(0, 20_000);
    } else {
      text = raw.slice(0, 10_000);
    }

    const payload = {
      from,
      to,
      subject,
      text,
      html: html || null,
      headers: {
        messageId: message.headers.get("message-id") || "",
        date: message.headers.get("date") || "",
      },
      raw: raw.slice(0, 4000),
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
