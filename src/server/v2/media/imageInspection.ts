/**
 * IMAGE INSPECTION
 * ----------------
 * Real dimension parsing and usability checks for uploaded media.
 *
 * Two defects motivated this:
 *
 *  - JPEG and WEBP dimensions were never parsed; the service returned a
 *    hardcoded 1080x1080 for both, so the library reported sizes it had never
 *    measured.
 *  - Nothing rejected a degenerate image, so 1x1 placeholder PNGs from
 *    development were stored as if they were usable product photos and then
 *    rendered as blank cards.
 *
 * Everything here works on the file's own bytes. Extensions are never trusted.
 */

export type DetectedMime = "image/png" | "image/jpeg" | "image/webp";

export type ImageInspection = {
  mime: DetectedMime | null;
  width: number;
  height: number;
  /** Byte-level structure parsed successfully. */
  decodable: boolean;
  /** Large enough to be worth showing to a viewer. */
  usable: boolean;
  reason?: string;
};

/**
 * Smallest edge we accept. Anything below this cannot carry visible content in
 * a 1080-wide production and is almost always a placeholder or tracking pixel.
 */
export const MIN_USABLE_EDGE_PX = 32;

export function detectMime(buffer: Buffer): DetectedMime | null {
  if (buffer.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  // WEBP: 'RIFF' .... 'WEBP'
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/** PNG stores width/height as big-endian uint32 in the IHDR chunk. */
function readPngSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24) return null;
  // Bytes 12..15 must spell IHDR for this to be a real header.
  if (buffer.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/**
 * Walks JPEG segments to the Start-Of-Frame marker, which is the only place the
 * real dimensions live. Skips APPn/COM segments rather than assuming a layout.
 */
function readJpegSize(buffer: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    // SOF0..SOF15, excluding DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return { width, height };
    }
    if (offset + 3 >= buffer.length) return null;
    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (segmentLength < 2) return null;
    offset += 2 + segmentLength;
  }
  return null;
}

/** Handles the three WEBP chunk layouts: lossy, lossless and extended. */
function readWebpSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 30) return null;
  const format = buffer.toString("ascii", 12, 16);

  if (format === "VP8 ") {
    // Lossy: 14-bit dimensions after the 3-byte start code.
    const start = 26;
    if (buffer.length < start + 4) return null;
    return {
      width: buffer.readUInt16LE(start) & 0x3fff,
      height: buffer.readUInt16LE(start + 2) & 0x3fff,
    };
  }
  if (format === "VP8L") {
    // Lossless: 14-bit each, packed across four bytes after the signature.
    if (buffer.length < 25) return null;
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (format === "VP8X") {
    // Extended: 24-bit canvas size minus one.
    if (buffer.length < 30) return null;
    const width = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16));
    const height = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16));
    return { width, height };
  }
  return null;
}

/**
 * Inspects a buffer and reports what it really is.
 *
 * A file that fails here is rejected at upload; an already-stored file that
 * fails is labelled rather than silently presented as a usable image.
 */
export function inspectImage(buffer: Buffer): ImageInspection {
  const mime = detectMime(buffer);
  if (!mime) {
    return {
      mime: null,
      width: 0,
      height: 0,
      decodable: false,
      usable: false,
      reason: "This file is not a PNG, JPEG or WEBP image.",
    };
  }

  const size =
    mime === "image/png" ? readPngSize(buffer)
    : mime === "image/jpeg" ? readJpegSize(buffer)
    : readWebpSize(buffer);

  if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) {
    return {
      mime,
      width: 0,
      height: 0,
      decodable: false,
      usable: false,
      reason: "The image header could not be read, so this file is not a usable image.",
    };
  }

  if (size.width < MIN_USABLE_EDGE_PX || size.height < MIN_USABLE_EDGE_PX) {
    return {
      mime,
      width: size.width,
      height: size.height,
      decodable: true,
      usable: false,
      reason: `This image is only ${size.width}x${size.height} pixels, too small to appear in a video.`,
    };
  }

  return { mime, width: size.width, height: size.height, decodable: true, usable: true };
}
