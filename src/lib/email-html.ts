import DOMPurify from "isomorphic-dompurify";
import { decodeQuotedPrintable, looksLikeQuotedPrintable } from "@/lib/email-body";

/** Extract HTML document from messy MIME fragment */
export function extractHtmlDocument(rawHtml?: string | null): string | null {
  if (!rawHtml) return null;
  let s = rawHtml.replace(/^﻿/, "").trim();
  if (!s) return null;

  // Drop leading MIME part headers (Content-Type/Content-Transfer-Encoding blocks)
  s = s
    .replace(/^Content-Type:\s*text\/html[^\r\n]*\r?\n?/i, "")
    .replace(/^Content-Transfer-Encoding:\s*[^\r\n]+\r?\n?/i, "")
    .replace(/^;?\s*charset="?[\w-]+"?\s*/i, "")
    .trim();
  if (!s) return null;

  // Prefer real HTML document (may sit behind MIME junk)
  const docIdx = s.search(/<!DOCTYPE\s+html|<html\b/i);
  if (docIdx >= 0) s = s.slice(docIdx);

  // Only decode quoted-printable when content actually still looks QP-encoded.
  // (Old regex `/[A-F0-9]{2}/i` matched plain words like "be"/"cf" and
  // corrupted clean HTML.)
  if (looksLikeQuotedPrintable(s)) {
    s = decodeQuotedPrintable(s, true);
  }

  // Drop trailing multipart boundary
  s = s.replace(/\r?\n--?[^\r\n]{0,200}--\s*$/i, "").trim();
  if (!s) return null;

  // If still no tags, not useful as HTML
  if (!/<\/?[a-z][\s\S]*>/i.test(s)) return null;

  // If fragment without html/body, wrap
  if (!/<html\b/i.test(s)) {
    s = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${s}</body></html>`;
  }

  return s;
}


const ALLOWED_TAGS = [
  "a",
  "abbr",
  "b",
  "blockquote",
  "br",
  "caption",
  "code",
  "col",
  "colgroup",
  "div",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
  "center",
  "font",
  "html",
  "head",
  "body",
  "meta",
  "title",
  "style",
];

const ALLOWED_ATTR = [
  "href",
  "name",
  "target",
  "rel",
  "src",
  "alt",
  "title",
  "width",
  "height",
  "align",
  "valign",
  "border",
  "cellpadding",
  "cellspacing",
  "colspan",
  "rowspan",
  "bgcolor",
  "color",
  "face",
  "size",
  "class",
  "id",
  "style",
  "role",
  "charset",
  "content",
  "http-equiv",
  "name",
  "type",
];

/** Sanitize email HTML for sandboxed iframe srcDoc */
export function sanitizeEmailHtml(rawHtml?: string | null): string | null {
  const doc = extractHtmlDocument(rawHtml);
  if (!doc) return null;

  const clean = DOMPurify.sanitize(doc, {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ["style", "head", "meta", "title", "html", "body"],
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    // allow remote images over http(s) only via hook below
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|cid):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  });

  if (!clean || !/<\/?[a-z]/i.test(clean)) return null;

  // Force links open in parent/new tab safely
  let out = clean
    .replace(/<a\b([^>]*)>/gi, (full, attrs: string) => {
      let a = attrs;
      if (!/\btarget=/i.test(a)) a += ' target="_blank"';
      if (!/\brel=/i.test(a)) a += ' rel="noopener noreferrer nofollow"';
      // strip javascript: just in case
      a = a.replace(/href\s*=\s*(["'])\s*javascript:[^"']*\1/gi, 'href="#"');
      return `<a${a}>`;
    })
    // block inline event handlers leftovers
    .replace(/\son\w+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, "");

  // Inject base styles for readability inside iframe
  const inject = `
<style>
  html,body{margin:0;padding:0;background:#fff;color:#111;}
  body{font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;word-break:break-word;}
  img{max-width:100%;height:auto;}
  table{max-width:100%;}
  a{color:#1a73e8;}
  pre,code{white-space:pre-wrap;word-break:break-word;}
</style>`;

  if (/<\/head>/i.test(out)) {
    out = out.replace(/<\/head>/i, `${inject}</head>`);
  } else if (/<body\b/i.test(out)) {
    out = out.replace(/<body\b/i, `<head><meta charset="utf-8">${inject}</head><body`);
  } else {
    out = `<!DOCTYPE html><html><head><meta charset="utf-8">${inject}</head><body>${out}</body></html>`;
  }

  return out;
}

export function hasRenderableHtml(rawHtml?: string | null): boolean {
  return Boolean(sanitizeEmailHtml(rawHtml));
}
