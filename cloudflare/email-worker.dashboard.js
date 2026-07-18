/**
 * xme-mail Cloudflare Email Worker
 * PASTE this entire file into: Workers & Pages → mail → Edit code (index.js)
 * Then Deploy.
 *
 * Secrets / vars (Settings → Variables):
 *   WEBHOOK_URL    = https://mail.x-me.cloud/api/inbound/cloudflare
 *   WEBHOOK_SECRET = same value as panel .env WEBHOOK_SECRET
 */

async function streamToArrayBuffer(stream, maxBytes) {
  const reader = stream.getReader();
  const chunks = [];
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

function extractHeader(raw, name) {
  const re = new RegExp("^" + name + ":\\s*(.+)$", "im");
  const m = raw.match(re);
  return m ? m[1].trim() : "";
}

function decodeQuotedPrintable(input) {
  const soft = input.replace(/=\r?\n/g, "");
  const bytes = [];
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

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

function parseContentType(headerValue) {
  const parts = headerValue.split(";").map(function (p) { return p.trim(); });
  const type = (parts[0] || "application/octet-stream").toLowerCase();
  let name;
  let boundary;
  for (let i = 1; i < parts.length; i++) {
    const m = parts[i].match(/^([^=]+)=(.*)$/);
    if (!m) continue;
    const k = m[1].trim().toLowerCase();
    let v = m[2].trim().replace(/^"(.*)"$/, "$1");
    if (k === "name" || k === "filename") name = v;
    if (k === "boundary") boundary = v;
  }
  return { type: type, name: name, boundary: boundary };
}

function splitHeadersBody(part) {
  const idx = part.search(/\r?\n\r?\n/);
  if (idx < 0) return { headers: part, body: "" };
  return {
    headers: part.slice(0, idx),
    body: part.slice(idx).replace(/^\r?\n\r?\n/, ""),
  };
}

function getHeader(headers, name) {
  const re = new RegExp("^" + name + ":\\s*([\\s\\S]*?)(?=\\r?\\n\\S|$)", "im");
  const m = headers.match(re);
  if (!m) return "";
  return m[1].replace(/\r?\n[ \t]+/g, " ").trim();
}

function isAllowedAttachment(ct) {
  const t = ct.toLowerCase();
  if (t.indexOf("image/") === 0) return true;
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

function decodePartBody(body, transferEncoding) {
  const te = (transferEncoding || "").toLowerCase();
  if (te.indexOf("base64") >= 0) {
    const clean = body.replace(/\s+/g, "");
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  if (te.indexOf("quoted-printable") >= 0) {
    const text = decodeQuotedPrintable(body);
    return new TextEncoder().encode(text);
  }
  return new TextEncoder().encode(body);
}

function parseMime(raw) {
  let text = "";
  let html = "";
  const attachments = [];

  const contentTypeTop = extractHeader(raw, "Content-Type") || "text/plain";
  const top = parseContentType(contentTypeTop);

  if (!top.boundary) {
    const split = splitHeadersBody(raw.indexOf("\r\n\r\n") >= 0 ? raw : "\n\n" + raw);
    const te =
      getHeader(split.headers, "Content-Transfer-Encoding") ||
      extractHeader(raw, "Content-Transfer-Encoding");
    const ct = parseContentType(getHeader(split.headers, "Content-Type") || contentTypeTop);
    let decoded = split.body;
    if (/quoted-printable/i.test(te)) decoded = decodeQuotedPrintable(split.body);
    if (/base64/i.test(te)) {
      try {
        decoded = new TextDecoder().decode(decodePartBody(split.body, "base64"));
      } catch (e) {}
    }
    if (ct.type.indexOf("html") >= 0) html = decoded;
    else text = decoded;
    return { text: text, html: html, attachments: attachments };
  }

  const boundary = top.boundary;
  const escaped = boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = raw.split(new RegExp("\\r?\\n--" + escaped + "(?:--)?" ));

  for (let pi = 0; pi < parts.length; pi++) {
    const part = parts[pi];
    if (!part || !/Content-Type:/i.test(part)) continue;

    const split = splitHeadersBody(part);
    if (!split.body) continue;

    const ctRaw = getHeader(split.headers, "Content-Type");
    if (!ctRaw) continue;
    const ct = parseContentType(ctRaw);
    const te = getHeader(split.headers, "Content-Transfer-Encoding") || "7bit";
    const cd = getHeader(split.headers, "Content-Disposition");
    const filenameFromCd = (cd.match(/filename\*?=(?:UTF-8''|")?([^";]+)"?/i) || [])[1];
    const filename = ((filenameFromCd || ct.name || "file") + "").replace(/["']/g, "").trim();
    const isAttachment =
      /attachment/i.test(cd) ||
      (/inline/i.test(cd) && !!(filenameFromCd || ct.name)) ||
      (!!ct.name && ct.type.indexOf("text/") !== 0);

    if (ct.type.indexOf("multipart/") === 0 && ct.boundary) {
      const nested = parseMime("Content-Type: " + ctRaw + "\r\n\r\n" + split.body);
      if (!text && nested.text) text = nested.text;
      if (!html && nested.html) html = nested.html;
      for (let ai = 0; ai < nested.attachments.length; ai++) {
        if (attachments.length < 5) attachments.push(nested.attachments[ai]);
      }
      continue;
    }

    if (ct.type === "text/html" && !isAttachment) {
      let decoded = split.body;
      if (/quoted-printable/i.test(te)) decoded = decodeQuotedPrintable(split.body);
      else if (/base64/i.test(te)) {
        try {
          decoded = new TextDecoder().decode(decodePartBody(split.body, "base64"));
        } catch (e) {}
      }
      if (decoded.length > (html ? html.length : 0)) html = decoded.slice(0, 400000);
      continue;
    }

    if (ct.type === "text/plain" && !isAttachment) {
      let decoded = split.body;
      if (/quoted-printable/i.test(te)) decoded = decodeQuotedPrintable(split.body);
      else if (/base64/i.test(te)) {
        try {
          decoded = new TextDecoder().decode(decodePartBody(split.body, "base64"));
        } catch (e) {}
      }
      if (decoded.length > (text ? text.length : 0)) text = decoded.slice(0, 100000);
      continue;
    }

    if ((isAttachment || ct.type.indexOf("text/") !== 0) && isAllowedAttachment(ct.type) && attachments.length < 5) {
      try {
        const bytes = decodePartBody(split.body, te);
        if (bytes.length > 0 && bytes.length <= 1.5 * 1024 * 1024) {
          attachments.push({
            filename: filename.slice(0, 120) || "file",
            contentType: ct.type,
            contentBase64: bytesToBase64(bytes),
            size: bytes.length,
          });
        }
      } catch (e) {}
    }
  }

  if (!html && /Content-Type:\s*text\/html/i.test(raw)) {
    const htmlPart = raw.split(/Content-Type:\s*text\/html/i)[1] || "";
    html = htmlPart.slice(0, 200000);
  }
  if (!text && /Content-Type:\s*text\/plain/i.test(raw)) {
    const textPart = raw.split(/Content-Type:\s*text\/plain/i)[1] || "";
    text = textPart.replace(/^[\s\S]*?\r?\n\r?\n/, "").slice(0, 50000);
  }

  return { text: text, html: html, attachments: attachments };
}

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export default {
  async email(message, env) {
    const maxRaw = 3 * 1024 * 1024;
    const rawBytes = await streamToArrayBuffer(message.raw, maxRaw);
    const raw = new TextDecoder().decode(rawBytes);

    const subject = message.headers.get("subject") || extractHeader(raw, "Subject") || "(no subject)";
    const from = message.from || extractHeader(raw, "From") || "";
    const to = message.to || extractHeader(raw, "To") || "";

    const parsed = parseMime(raw);
    let text = parsed.text;
    const html = parsed.html;
    if (!text && html) text = stripHtml(html).slice(0, 20000);

    const payload = {
      from: from,
      to: to,
      subject: subject,
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
      const body = await res.text().catch(function () { return ""; });
      throw new Error("Webhook failed " + res.status + ": " + body.slice(0, 200));
    }
  },
};
