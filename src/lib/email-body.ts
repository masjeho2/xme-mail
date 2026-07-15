/** Clean messy MIME / quoted-printable fragments from inbound webhook bodies */

export function decodeQuotedPrintable(input: string): string {
  return input
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => {
      try {
        return String.fromCharCode(parseInt(hex, 16));
      } catch {
        return "";
      }
    });
}

export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function extractBetweenBoundaries(raw: string): string {
  return raw.replace(/\n--[0-9a-zA-Z=_-]+(--)?\s*$/g, "").trim();
}

function dropMimeHeaders(chunk: string): string {
  let out = chunk;
  // Cut at first blank line after MIME headers if present
  const parts = out.split(/\r?\n\r?\n/);
  if (parts.length >= 2 && /content-type:|content-transfer-encoding:|charset=/i.test(parts[0])) {
    out = parts.slice(1).join("\n\n");
  }

  // Inline noise often seen from CF worker partial parse
  out = out
    .replace(/^[\s;]*charset="?UTF-8"?\s*/i, "")
    .replace(/^[\s;]*Content-Transfer-Encoding:\s*quoted-printable\s*/i, "")
    .replace(/Content-Transfer-Encoding:\s*quoted-printable\s*/gi, "")
    .replace(/Content-Type:\s*text\/(?:plain|html)[^\n]*\n*/gi, "")
    .replace(/charset="?UTF-8"?\s*/gi, "");

  return out;
}

function extractReplyText(text: string): string {
  // Prefer the new reply text before Gmail quote markers
  const markers = [
    /\r?\nOn .+ wrote:\s*/i,
    /\r?\nPada .+ menulis:\s*/i,
    /\s+Pada\s+\w.+menulis:\s*/i,
    /\s+On\s+\w.+wrote:\s*/i,
    /\r?\nFrom:\s*.+\r?\nSent:/i,
    /\r?\n-----Original Message-----/i,
    /\r?\n________________________________/,
  ];
  for (const re of markers) {
    const idx = text.search(re);
    if (idx > 0) {
      return text.slice(0, idx).trim();
    }
  }

  return text;
}

function stripTrailingBoundary(text: string): string {
  return text
    .replace(/\s*--[0-9a-f]{10,}(--)?\s*$/i, "")
    .replace(/\s*--[0-9a-zA-Z=_-]{12,}(--)?\s*$/g, "")
    .trim();
}

/** Best-effort readable plain text for UI */
export function cleanEmailBody(text?: string | null, html?: string | null): string {
  let source = (text || "").trim();

  if (!source && html) {
    source = stripHtml(html);
  }
  if (!source) return "(empty body)";

  if (/<\/?[a-z][\s\S]*>/i.test(source) && source.includes("<")) {
    source = stripHtml(source);
  }

  source = dropMimeHeaders(source);
  source = decodeQuotedPrintable(source);
  source = extractBetweenBoundaries(source);
  source = source
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"');

  // Drop pure header/noise lines
  source = source
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      if (/^content-type:/i.test(t)) return false;
      if (/^content-transfer-encoding:/i.test(t)) return false;
      if (/^mime-version:/i.test(t)) return false;
      if (/^charset=/i.test(t)) return false;
      if (/^--[0-9a-zA-Z=_-]{10,}/.test(t)) return false;
      if (/^;?\s*charset=/i.test(t)) return false;
      return true;
    })
    .join("\n");

  source = extractReplyText(source);
  source = stripTrailingBoundary(source);

  // Fix artifacts like "Pad= a Rab" from broken soft breaks
  source = source
    .replace(/\bPad=\s*a\b/gi, "Pada")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return source || "(empty body)";
}

export function previewText(text: string, max = 100): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max - 1) + "…";
}

export function formatRelativeTime(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "baru saja";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} mnt lalu`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} jam lalu`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} hari lalu`;
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

export function initialsFromEmail(addr: string): string {
  const local = (addr.split("@")[0] || "?").replace(/[^a-zA-Z0-9]/g, "");
  return (local.slice(0, 2) || "?").toUpperCase();
}
