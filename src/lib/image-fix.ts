/**
 * Some phone/email JPEG pipelines store broken EXIF dimensions (0x0).
 * A few mobile browsers then show a blank page for "inline" images.
 * Strip APP1/EXIF (and other APP segments) so viewers use SOF size.
 */
export function stripJpegAppSegments(buf: Buffer): Buffer {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return buf;

  const out: number[] = [0xff, 0xd8];
  let i = 2;
  while (i < buf.length - 1) {
    if (buf[i] !== 0xff) {
      // entropy-coded data; copy rest
      for (let j = i; j < buf.length; j++) out.push(buf[j]);
      break;
    }

    // skip fill 0xFF bytes
    while (i < buf.length && buf[i] === 0xff) i++;
    if (i >= buf.length) break;
    const marker = buf[i++];

    // standalone markers
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      out.push(0xff, marker);
      if (marker === 0xd9) {
        // EOI
        break;
      }
      continue;
    }

    if (i + 1 >= buf.length) break;
    const seglen = (buf[i] << 8) | buf[i + 1];
    if (seglen < 2 || i + seglen > buf.length) {
      // corrupt — copy remainder
      out.push(0xff, marker);
      for (let j = i; j < buf.length; j++) out.push(buf[j]);
      break;
    }

    // Drop APP0-APP15 (including EXIF APP1) and COM
    const drop = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
    if (!drop) {
      out.push(0xff, marker);
      for (let j = 0; j < seglen; j++) out.push(buf[i + j]);
    }

    i += seglen;

    // After SOS, remainder is image data
    if (marker === 0xda) {
      for (let j = i; j < buf.length; j++) out.push(buf[j]);
      break;
    }
  }

  return Buffer.from(out);
}

export function maybeFixImageBuffer(contentType: string, buf: Buffer): Buffer {
  if (contentType.startsWith("image/jpeg") || contentType === "image/jpg") {
    return stripJpegAppSegments(buf);
  }
  return buf;
}
