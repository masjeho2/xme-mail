/**
 * RFC 2047 encoded-word decoder for subjects / display names.
 *   =?utf-8?B?...?=  (base64)
 *   =?utf-8?Q?...?=  (quoted-printable)
 * Multiple adjacent encoded-words must be joined without spaces.
 */

/** Decode a single charset-encoded string (best-effort). */
function decodeCharsetBytes(bytes: number[], label: string): string {
  try {
    const dec = new TextDecoder(label, { fatal: false });
    return dec.decode(Uint8Array.from(bytes));
  } catch {
    try {
      const dec = new TextDecoder("utf-8", { fatal: false });
      return dec.decode(Uint8Array.from(bytes));
    } catch {
      return String.fromCharCode(...bytes);
    }
  }
}

function decodeQWord(text: string, charset: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "=" && i + 2 < text.length && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) {
      bytes.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else if (c === "_") {
      bytes.push(0x20);
    } else {
      bytes.push(c.charCodeAt(0) & 0xff);
    }
  }
  return decodeCharsetBytes(bytes, charset);
}

function decodeBWord(text: string, charset: string): string {
  const b64 = text.replace(/[^A-Za-z0-9+/=]/g, "");
  const bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const bytes: number[] = [];
  for (let i = 0; i < bin.length; i++) bytes.push(bin.charCodeAt(i) & 0xff);
  return decodeCharsetBytes(bytes, charset);
}

/** True if the string contains RFC 2047 encoded-words. */
export function isEncodedWord(s: string): boolean {
  return /=\?[^?]+\?[bBqQ]\?/.test(s || "");
}

/**
 * Decode all RFC 2047 encoded-words in a header value.
 * Stray `=?` that don't form a valid encoded-word are left untouched.
 */
export function decodeMimeHeader(input?: string | null): string {
  if (!input) return input || "";
  if (!isEncodedWord(input)) return input;

  return input
    .replace(
      /\?=\s+=\?/g,
      "?==?" // remove whitespace between adjacent encoded-words
    )
    .replace(
      /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g,
      (_m, charset: string, enc: string, payload: string) => {
        try {
          return enc.toLowerCase() === "b"
            ? decodeBWord(payload, charset)
            : decodeQWord(payload, charset);
        } catch {
          return _m;
        }
      }
    )
    .replace(/\s{2,}/g, " ")
    .trim();
}
