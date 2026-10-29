/** Clean messy MIME / quoted-printable / HTML fragments from inbound email bodies */

/**
 * Detect whether text still looks like raw quoted-printable.
 * IMPORTANT: plain URLs often contain `=hex` query values (token=5a2f...).
 * Blind QP decoding destroys those links (produces broken chars).
 */
export function looksLikeQuotedPrintable(input: string): boolean {
  if (!input) return false;
  // Soft line breaks are the strongest signal
  if (/=\r?\n/.test(input)) return true;
  // Common QP encodings for HTML/MIME
  if (/=3D/i.test(input) || /=20/i.test(input) || /=0A/i.test(input) || /=C2=A0/i.test(input)) return true;
  // HTML attributes encoded as style=3D"..." / href=3D"..."
  if (/\b(?:style|href|src|class|lang)=3D/i.test(input)) return true;
  // High density of =XX escapes outside URL query context
  const esc = input.match(/=[0-9A-Fa-f]{2}/g);
  if (esc && esc.length >= 8) {
    // If many are classic QP bytes (3D/20/0A/0D/C3/E2) treat as QP
    const classic = esc.filter((e) => /^=(?:3D|20|0A|0D|09|C2|C3|E2)/i.test(e)).length;
    if (classic >= 3) return true;
  }
  return false;
}

/** Decode quoted-printable into UTF-8 text. No-op if input doesn't look like QP. */
export function decodeQuotedPrintable(input: string, force = false): string {
  if (!input) return input;
  if (!force && !looksLikeQuotedPrintable(input)) return input;

  // Soft line breaks
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
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(Uint8Array.from(bytes));
  } catch {
    return soft.replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }
}

/** Repair links previously corrupted by blind QP decode on URL query strings */
export function repairCorruptedUrls(text: string): string {
  if (!text) return text;
  let s = text;
  // Replacement char (U+FFFD) often left where `=` was eaten
  s = s.replace(/�/g, "=");
  // Some UIs show a diamond glyph for bad bytes
  s = s.replace(/◆/g, "="); // ◆
  // token<badchar>5a2f... or email<badchar>admin inside URLs
  s = s.replace(
    /(https?:\/\/[^\s<>"']*?[?&][A-Za-z0-9_.-]{1,64})[^A-Za-z0-9=&%+\-./:?#]([0-9a-fA-F%]{8,})/g,
    "$1=$2"
  );
  // &email=admin sometimes becomes &email<bad>admin
  s = s.replace(
    /(https?:\/\/[^\s<>"']*?[?&]email)[^A-Za-z0-9=&%+\-./:?#]([A-Za-z0-9._%+-]+@[^\s<>"']+)/gi,
    "$1=$2"
  );
  return s;
}

/** Strip invisible zero-width / shadow fallback chars used by tracking pixels */
export function stripInvisibleNoise(text: string): string {
  if (!text) return text;
  return text
    // zero-width & bidi marks, BOM, shadow chars (braille blank / figure space / CGJ)
    .replace(/[​-‏‪-‮⁠-⁤﻿­͏ ⠀]/g, " ")
    .replace(/�{2,}/g, " ")
    .replace(/[ \t]{2,}/g, " ");
}
