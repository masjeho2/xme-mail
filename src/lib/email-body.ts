/** Clean messy MIME / quoted-printable / HTML fragments from inbound email bodies */

import {
  decodeQuotedPrintable,
  looksLikeQuotedPrintable,
  repairCorruptedUrls,
  stripInvisibleNoise,
} from "@/lib/email-noise";

export { decodeQuotedPrintable, looksLikeQuotedPrintable, repairCorruptedUrls, stripInvisibleNoise } from "@/lib/email-noise";

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      try {
        return String.fromCodePoint(Number(n));
      } catch {
        return "";
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      try {
        return String.fromCodePoint(parseInt(h, 16));
      } catch {
        return "";
      }
    });
}

function normalizeHref(href: string): string {
  return decodeHtmlEntities(href.trim()).replace(/&amp;/gi, "&");
}

/** Collect http(s) hrefs from HTML (order preserved, unique) */
export function extractHrefs(html: string): string[] {
  const decoded = decodeQuotedPrintable(dropMimeHeaders(html));
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(decoded))) {
    const href = normalizeHref(m[1]);
    if (!/^https?:\/\//i.test(href)) continue;
    // skip tracking pixels / useless anchors
    if (/^(https?:\/\/)?#/i.test(href)) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    out.push(href);
  }
  return out;
}

export function stripHtml(html: string): string {
  let s = html;
  // Remove head / style / script entirely
  s = s.replace(/<head[\s\S]*?<\/head>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");

  const keptLinks: string[] = [];

  // Links: keep visible text + URL (always keep URL for buttons/images)
  s = s.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_m, attrs: string, text: string) => {
    const hrefMatch = attrs.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!hrefMatch) return ` ${text.replace(/<[^>]+>/g, " ")} `;
    const href = normalizeHref(hrefMatch[1]);
    const t = text
      .replace(/<img\b[^>]*>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!/^https?:\/\//i.test(href)) {
      return t ? ` ${t} ` : " ";
    }
    keptLinks.push(href);
    if (!t) return `\n${href}\n`;
    if (t === href || t.includes(href)) return `\n${t}\n`;
    return `\n${t}\n${href}\n`;
  });

  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/p>/gi, "\n\n");
  s = s.replace(/<\/div>/gi, "\n");
  s = s.replace(/<\/tr>/gi, "\n");
  s = s.replace(/<\/h[1-6]>/gi, "\n\n");
  s = s.replace(/<\/li>/gi, "\n");
  s = s.replace(/<hr\b[^>]*>/gi, "\n---\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeHtmlEntities(s);

  // Ensure important hrefs weren't lost (e.g. nested/broken tags)
  for (const href of keptLinks) {
    if (!s.includes(href)) s += `\n${href}`;
  }

  return s;
}

/** Turn plain URLs into safe React-friendly segments for linkifying UIs */
export function linkifySegments(text: string): Array<{ type: "text" | "link"; value: string }> {
  // Fix corrupted query-string equals before link detection
  text = repairCorruptedUrls(text || "");
  const re = /(https?:\/\/[^\s<>"')\]]+)/gi;
  const segments: Array<{ type: "text" | "link"; value: string }> = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) {
      segments.push({ type: "text", value: text.slice(last, m.index) });
    }
    let url = m[1];
    // trim trailing punctuation often glued to URLs
    url = url.replace(/[.,;:!?]+$/g, "");
    segments.push({ type: "link", value: url });
    // if we trimmed punctuation, put it back as text
    const trimmed = m[1].slice(url.length);
    if (trimmed) segments.push({ type: "text", value: trimmed });
    last = m.index + m[1].length;
  }
  if (last < text.length) segments.push({ type: "text", value: text.slice(last) });
  if (!segments.length) segments.push({ type: "text", value: text });
  return segments;
}

function stripCssNoise(text: string): string {
  let s = text;
  // @media / @font-face blocks (may contain nested braces — strip greedily to closing brace at line end)
  s = s.replace(/@media[^{]+\{[\s\S]*?\}\s*\}/gi, " ");
  s = s.replace(/@font-face[^{]+\{[\s\S]*?\}\s*\}/gi, " ");
  s = s.replace(/@keyframes[^{]+\{[\s\S]*?\}\s*\}/gi, " ");
  // leftover css rules: .class { ... } or #id { ... } — only when clearly selector-shaped
  s = s.replace(/(?:^|\n)\s*[.#][a-zA-Z_-][\w ,-]*\s*\{[^}]*\}/g, " ");
  // property: value !important;
  s = s.replace(/[a-z-]+\s*:\s*[^;{}]+!important\s*;?/gi, " ");
  s = s.replace(/(?:^|[{;\s])(?:width|max-width|min-width|padding|margin|color|background|background-color|font|font-family|font-size|display|border|border-radius|line-height|text-align|height|letter-spacing)[a-z-]*\s*:\s*[^;{}\n]+;?/gi, " ");
  return s;
}

function dropMimeHeaders(chunk: string): string {
  let out = chunk.replace(/^﻿/, "").trim();

  // Prefer real HTML document if present (even after MIME headers / multipart noise)
  const htmlIdx = out.search(/<!DOCTYPE\s+html|<html\b/i);
  if (htmlIdx >= 0) {
    out = out.slice(htmlIdx);
    // cut trailing multipart boundary if any
    out = out.replace(/\r?\n----[^\r\n]*--\s*$/i, "").trim();
    return out;
  }

  // Leading "; charset=... Content-Transfer-Encoding..."
  out = out.replace(/^;?\s*charset="?[^"\s;]+"?\s*/i, "");
  out = out.replace(/^Content-Transfer-Encoding:\s*\S+\s*/i, "");
  out = out.replace(/^Content-Type:\s*[^\r\n]+\s*/i, "");

  // Only split headers if the first block looks like MIME headers AND
  // the remainder is substantial (avoid wiping body down to a boundary only)
  const parts = out.split(/\r?\n\r?\n/);
  if (
    parts.length >= 2 &&
    /content-type:|content-transfer-encoding:|charset=/i.test(parts[0]) &&
    parts.slice(1).join("\n\n").trim().length > 40
  ) {
    out = parts.slice(1).join("\n\n");
  }

  out = out
    .replace(/Content-Transfer-Encoding:\s*\S+\s*/gi, "")
    .replace(/Content-Type:\s*text\/(?:plain|html)[^\n]*\n*/gi, "")
    .replace(/charset="?UTF-8"?\s*/gi, "");

  // Drop trailing multipart boundary lines
  out = out.replace(/\r?\n----[^\r\n]*--\s*$/i, "").trim();

  return out;
}

function extractReplyText(text: string): string {
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
    if (idx > 0) return text.slice(0, idx).trim();
  }
  return text;
}

function stripTrailingBoundary(text: string): string {
  return text
    .replace(/\s*--[0-9a-f]{10,}(--)?\s*$/i, "")
    .replace(/\s*--[0-9a-zA-Z=_-]{12,}(--)?\s*$/g, "")
    .trim();
}

function normalizeWhitespace(text: string): string {
  return stripInvisibleNoise(text)
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    // broken QP soft breaks that survived: "ne= ed" / "servi= ces"
    // DO NOT strip `=` inside URLs (query string token=abc)
    .replace(/=\s+(?![/?#&])/g, "")
    .trim();
}

function looksLikeHtml(s: string): boolean {
  return /<\/?(?:html|body|div|table|p|span|a|br|head|meta|style)\b/i.test(s) || /<!DOCTYPE/i.test(s);
}

function looksLikeCssHeavy(s: string): boolean {
  return /@media\b/i.test(s) || (/!important/i.test(s) && /\{[^}]+\}/.test(s));
}

/** Best-effort readable plain text for UI */
export function cleanEmailBody(text?: string | null, html?: string | null): string {
  const candidates: string[] = [];

  // Prefer HTML when present (marketing mails are HTML-first)
  if (html && html.trim()) {
    let h = dropMimeHeaders(html.trim());
    // Only QP-decode when content still looks encoded (protects URL query `=`)
    h = decodeQuotedPrintable(h);
    if (looksLikeHtml(h) || h.includes("<")) {
      candidates.push(stripHtml(h));
    } else {
      candidates.push(h);
    }
  }

  if (text && text.trim()) {
    let t = dropMimeHeaders(text.trim());
    t = decodeQuotedPrintable(t);
    // Fix messages already corrupted by older decoder (� in URLs)
    t = repairCorruptedUrls(t);
    if (looksLikeHtml(t)) {
      candidates.push(stripHtml(t));
    } else {
      candidates.push(t);
    }
  }

  if (!candidates.length) return "(empty body)";

  // Score: prefer less CSS noise, more readable words
  function score(s: string): number {
    let sc = s.length;
    if (looksLikeCssHeavy(s)) sc -= 5000;
    if (/@media|!important|\.email-container/i.test(s)) sc -= 3000;
    if (/https?:\/\//i.test(s)) sc += 50;
    if (/hello|thanks|welcome|confirm|account|code|otp/i.test(s)) sc += 100;
    // penalize high symbol density
    const symbols = (s.match(/[{};<>]/g) || []).length;
    sc -= symbols * 5;
    return sc;
  }

  let best = candidates[0];
  let bestScore = score(best);
  for (const c of candidates.slice(1)) {
    const sc = score(c);
    if (sc > bestScore) {
      best = c;
      bestScore = sc;
    }
  }

  let source = best;
  source = stripCssNoise(source);
  source = decodeHtmlEntities(source);
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
      if (/^@media\b/i.test(t)) return false;
      if (/\{[^}]*\}/.test(t) && /!important|px|em|%/.test(t) && t.length < 200) return false;
      return true;
    })
    .join("\n");

  source = extractReplyText(source);
  source = stripTrailingBoundary(source);
  source = repairCorruptedUrls(source);
  source = normalizeWhitespace(source);
  // Prefer real hrefs extracted from HTML when present (most reliable for login links)
  if (html && html.trim()) {
    const hrefs = extractHrefs(html);
    for (const href of hrefs) {
      if (href && !source.includes(href)) {
        // Replace corrupted near-matches or append clean URL
        const token = href.match(/[?&]token=([^&]+)/i)?.[1];
        if (token) {
          const broken = new RegExp(
            `https?:\\/\\/[^\\s<>"']*token.?${token.slice(0, 12)}[^\\s<>"']*`,
            "i"
          );
          if (broken.test(source)) {
            source = source.replace(broken, href);
            continue;
          }
        }
        source += `\n${href}`;
      }
    }
  }

  // Final CSS purge if still noisy
  if (looksLikeCssHeavy(source)) {
    source = stripCssNoise(source);
    source = normalizeWhitespace(source);
  }

  return source || "(empty body)";
}

export function previewText(text: string, max = 100): string {
  const oneLine = stripInvisibleNoise(cleanEmailBody(text))
    .replace(/\s+/g, " ")
    .trim();
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
  // bounce+xxx-user=domain@provider → try extract local before =
  const angle = addr.match(/<([^>]+)>/);
  const email = (angle ? angle[1] : addr).trim();
  let local = email.split("@")[0] || "?";
  if (local.includes("=")) local = local.split("=").pop() || local;
  if (local.includes("+")) local = local.split("+")[0] || local;
  local = local.replace(/[^a-zA-Z0-9]/g, "");
  return (local.slice(0, 2) || "?").toUpperCase();
}

/** Shorter display for noisy bounce/from addresses */
export function displayFrom(addr: string): string {
  const angle = addr.match(/^(.*)<([^>]+)>\s*$/);
  if (angle && angle[1].trim()) return `${angle[1].trim()} <${angle[2]}>`;
  // bounce+hash-user=domain@svc → user@domain via svc
  const m = addr.match(/^bounce\+[^=]+=([^@]+)@(.+)$/i);
  if (m) return `${m[1].replace(/-/g, "@")} via ${m[2]}`;
  return addr;
}
