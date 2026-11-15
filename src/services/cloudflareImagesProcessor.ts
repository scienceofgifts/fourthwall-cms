import { calculateProportionalDimensions } from './imageOptimizerCore';
import { computeSha256Hex, isWebpBinary } from './imageR2Upload';

export interface ImageProcessInput {
  inputBytes: Uint8Array;
  maxWidth: number;
  quality: number;
}

export interface ImageProcessOutput {
  webpBytes: Uint8Array;
  originalWidth: number;
  originalHeight: number;
  optimizedWidth: number;
  optimizedHeight: number;
  width: number;
  height: number;
  wasResized: boolean;
  originalFormat: string;
  hasAlpha: boolean;
  originalSize: number;
  optimizedSize: number;
  sourceSha256: string;
  optimizedSha256: string;
}

export interface CloudflareImageInfo {
  format?: string;
  fileSize?: number;
  width?: number;
  height?: number;
}

export interface CloudflareImageTransformOptions {
  width?: number;
  height?: number;
  fit?: 'scale-down' | 'contain' | 'cover' | 'crop' | 'pad';
  rotate?: 0 | 90 | 180 | 270;
}

export interface CloudflareImageOutputOptions {
  format: 'image/webp' | 'image/avif' | 'image/jpeg' | 'image/png';
  quality?: number;
}

export interface CloudflareImageTransformationResult {
  image?: () => ReadableStream<Uint8Array>;
  contentType?: () => string;
  response: () => Response;
}

export interface CloudflareImageTransformer {
  transform(options: CloudflareImageTransformOptions): CloudflareImageTransformer;
  output(options: CloudflareImageOutputOptions): Promise<CloudflareImageTransformationResult>;
}

/**
 * Native Cloudflare Workers Images Binding (`env.IMAGES`), configured in `wrangler.toml`:
 * ```toml
 * [images]
 * binding = "IMAGES"
 * ```
 */
export interface CloudflareImagesBinding {
  info?(
    stream: ReadableStream<Uint8Array> | ArrayBuffer | Uint8Array
  ): Promise<CloudflareImageInfo>;
  input(
    stream: ReadableStream<Uint8Array> | ArrayBuffer | Uint8Array
  ): CloudflareImageTransformer;
}

export interface ParsedImageHeaderMetadata {
  format: string;
  width: number;
  height: number;
  hasAlpha: boolean;
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) >>> 0) +
    ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])
  );
}

function parseExifOrientationFromApp1(bytes: Uint8Array, app1Start: number, app1Length: number): number {
  const end = Math.min(bytes.byteLength, app1Start + app1Length);
  if (app1Start + 14 >= end) return 1;
  // Check "Exif\0\0"
  if (
    bytes[app1Start + 2] !== 0x45 ||
    bytes[app1Start + 3] !== 0x78 ||
    bytes[app1Start + 4] !== 0x69 ||
    bytes[app1Start + 5] !== 0x66 ||
    bytes[app1Start + 6] !== 0x00 ||
    bytes[app1Start + 7] !== 0x00
  ) {
    return 1;
  }

  const tiffStart = app1Start + 8;
  const littleEndian = bytes[tiffStart] === 0x49 && bytes[tiffStart + 1] === 0x49;
  const readU16 = (off: number) =>
    littleEndian ? readUint16LE(bytes, off) : readUint16BE(bytes, off);
  const readU32 = (off: number) =>
    littleEndian
      ? (bytes[off] |
          (bytes[off + 1] << 8) |
          (bytes[off + 2] << 16) |
          ((bytes[off + 3] << 24) >>> 0)) >>>
        0
      : readUint32BE(bytes, off);

  if (tiffStart + 8 > end) return 1;
  const ifdOffset = readU32(tiffStart + 4);
  const ifdStart = tiffStart + ifdOffset;
  if (ifdStart + 2 > end) return 1;

  const numEntries = readU16(ifdStart);
  for (let i = 0; i < numEntries; i++) {
    const entryOffset = ifdStart + 2 + i * 12;
    if (entryOffset + 12 > end) break;
    const tag = readU16(entryOffset);
    if (tag === 0x0112) {
      return readU16(entryOffset + 8);
    }
  }
  return 1;
}

/**
 * Pure TypeScript / Web-API binary image header parser for Cloudflare Workers.
 * Extracts format, original width, original height, and alpha transparency channel presence
 * without requiring native Node.js C++ bindings.
 */
export function parseImageHeaderMetadata(bytes: Uint8Array): ParsedImageHeaderMetadata | null {
  if (!bytes || bytes.byteLength < 10) return null;

  // 1. PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.byteLength >= 26 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    const width = readUint32BE(bytes, 16);
    const height = readUint32BE(bytes, 20);
    const colorType = bytes[25];
    let hasAlpha = colorType === 4 || colorType === 6;

    // Check for tRNS transparency chunk on indexed/RGB/grayscale PNGs
    if (!hasAlpha) {
      let offset = 8;
      while (offset + 8 <= bytes.byteLength) {
        const chunkLen = readUint32BE(bytes, offset);
        const c0 = bytes[offset + 4];
        const c1 = bytes[offset + 5];
        const c2 = bytes[offset + 6];
        const c3 = bytes[offset + 7];
        if (c0 === 0x74 && c1 === 0x52 && c2 === 0x4e && c3 === 0x53) {
          // 'tRNS'
          hasAlpha = true;
          break;
        }
        if (c0 === 0x49 && c1 === 0x44 && c2 === 0x41 && c3 === 0x54) {
          // 'IDAT' reached
          break;
        }
        offset += 12 + chunkLen;
      }
    }

    if (width > 0 && height > 0) {
      return { format: 'png', width, height, hasAlpha };
    }
  }

  // 2. WebP: RIFF....WEBP
  if (isWebpBinary(bytes) && bytes.byteLength >= 30) {
    const chunkType = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (chunkType === 'VP8 ') {
      const width = (bytes[26] | (bytes[27] << 8)) & 0x3fff;
      const height = (bytes[28] | (bytes[29] << 8)) & 0x3fff;
      if (width > 0 && height > 0) {
        return { format: 'webp', width, height, hasAlpha: false };
      }
    } else if (chunkType === 'VP8L') {
      const b0 = bytes[21];
      const b1 = bytes[22];
      const b2 = bytes[23];
      const b3 = bytes[24];
      const width = 1 + (b0 | ((b1 & 0x3f) << 8));
      const height = 1 + (((b1 & 0xc0) >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10));
      const hasAlpha = Boolean((b3 >> 4) & 1);
      if (width > 0 && height > 0) {
        return { format: 'webp', width, height, hasAlpha };
      }
    } else if (chunkType === 'VP8X') {
      const flags = bytes[20];
      const hasAlpha = Boolean(flags & 0x10);
      const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      if (width > 0 && height > 0) {
        return { format: 'webp', width, height, hasAlpha };
      }
    }
  }

  // 3. JPEG: FF D8
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    let orientation = 1;
    while (offset + 4 < bytes.byteLength) {
      if (bytes[offset] !== 0xff) {
        offset++;
        continue;
      }
      while (offset < bytes.byteLength && bytes[offset] === 0xff) {
        offset++;
      }
      if (offset >= bytes.byteLength) break;
      const marker = bytes[offset];
      offset++;

      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        continue;
      }
      if (marker === 0xd9 || marker === 0xda) {
        break;
      }
      if (offset + 2 > bytes.byteLength) break;
      const segmentLength = readUint16BE(bytes, offset);
      if (segmentLength < 2) break;

      if (marker === 0xe1) {
        const parsedOrient = parseExifOrientationFromApp1(bytes, offset, segmentLength);
        if (parsedOrient >= 1 && parsedOrient <= 8) {
          orientation = parsedOrient;
        }
      }

      const isSofMarker =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);

      if (isSofMarker && offset + 7 <= bytes.byteLength) {
        const rawHeight = readUint16BE(bytes, offset + 3);
        const rawWidth = readUint16BE(bytes, offset + 5);
        const rotated90or270 = orientation >= 5 && orientation <= 8;
        const width = rotated90or270 ? rawHeight : rawWidth;
        const height = rotated90or270 ? rawWidth : rawHeight;
        if (width > 0 && height > 0) {
          return { format: 'jpeg', width, height, hasAlpha: false };
        }
      }

      offset += segmentLength;
    }
  }

  // 4. GIF: GIF87a / GIF89a
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    const width = readUint16LE(bytes, 6);
    const height = readUint16LE(bytes, 8);
    if (width > 0 && height > 0) {
      return { format: 'gif', width, height, hasAlpha: true };
    }
  }

  // 5. AVIF (ISOBMFF ftypavif / ftypavis)
  if (
    bytes.byteLength >= 16 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (brand === 'avif' || brand === 'avis' || brand === 'mif1') {
      let width = 0;
      let height = 0;
      let hasAlpha = false;
      const limit = Math.min(bytes.byteLength - 16, 4096);
      for (let i = 0; i < limit; i++) {
        // Look for 'ispe' box
        if (
          bytes[i] === 0x69 &&
          bytes[i + 1] === 0x73 &&
          bytes[i + 2] === 0x70 &&
          bytes[i + 3] === 0x65 &&
          i + 16 <= bytes.byteLength
        ) {
          const w = readUint32BE(bytes, i + 8);
          const h = readUint32BE(bytes, i + 12);
          if (w > 0 && w <= 16384 && h > 0 && h <= 16384) {
            width = w;
            height = h;
          }
        }
        // Look for 'alpha' in auxC
        if (
          bytes[i] === 0x61 &&
          bytes[i + 1] === 0x6c &&
          bytes[i + 2] === 0x70 &&
          bytes[i + 3] === 0x68 &&
          bytes[i + 4] === 0x61
        ) {
          hasAlpha = true;
        }
      }
      if (width > 0 && height > 0) {
        return { format: 'avif', width, height, hasAlpha };
      }
    }
  }

  // 6. SVG
  const headText = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.subarray(0, Math.min(bytes.byteLength, 2048)))
    .trim();
  if (headText.includes('<svg')) {
    const viewBoxMatch = headText.match(/viewBox=["']\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)/i);
    const widthMatch = headText.match(/\bwidth=["']\s*([\d.]+)/i);
    const heightMatch = headText.match(/\bheight=["']\s*([\d.]+)/i);
    const width = Math.round(
      Number(widthMatch?.[1] || viewBoxMatch?.[1] || 600)
    );
    const height = Math.round(
      Number(heightMatch?.[1] || viewBoxMatch?.[2] || 600)
    );
    if (width > 0 && height > 0) {
      return { format: 'svg', width, height, hasAlpha: true };
    }
  }

  return null;
}

function uint8ArrayToReadableStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function readTransformationOutputBytes(
  outputResult: CloudflareImageTransformationResult
): Promise<Uint8Array> {
  if (typeof outputResult.response === 'function') {
    const res = outputResult.response();
    const ab = await res.arrayBuffer();
    return new Uint8Array(ab);
  }
  if (typeof outputResult.image === 'function') {
    const stream = outputResult.image();
    const res = new Response(stream);
    const ab = await res.arrayBuffer();
    return new Uint8Array(ab);
  }
  throw new Error('Cloudflare Images binding returned an invalid output object.');
}

function normalizeFormatName(rawFormat?: string): string {
  if (!rawFormat) return '';
  const clean = rawFormat.toLowerCase().replace(/^image\//, '').trim();
  if (clean === 'jpg') return 'jpeg';
  return clean;
}

/**
 * Cloudflare Workers-compatible image processor using the native Cloudflare Images binding (`env.IMAGES`).
 *
 * Preserves the exact CMS optimization contract:
 * - WebP output (`image/webp`)
 * - 600px standard maximum width / 900px featured maximum width
 * - Quality ~80 (configurable)
 * - Original aspect ratio preserved (`fit: 'scale-down'`)
 * - No cropping
 * - No upscaling of smaller images
 * - Alpha transparency preserved
 */
export async function processImageWithCloudflareImages(
  input: ImageProcessInput,
  imagesBinding?: CloudflareImagesBinding
): Promise<ImageProcessOutput> {
  const { inputBytes, maxWidth, quality } = input;

  if (!inputBytes || inputBytes.byteLength === 0) {
    throw new Error('Cannot optimize image: input buffer is empty.');
  }

  if (!imagesBinding || typeof imagesBinding.input !== 'function') {
    throw new Error(
      'Cloudflare Images binding (IMAGES) is not configured on this Worker. Add `[images] binding = "IMAGES"` to wrangler.toml.'
    );
  }

  const clampedMaxWidth = Math.max(64, Math.min(4096, Math.round(maxWidth || 600)));
  const clampedQuality = Math.max(10, Math.min(100, Math.round(quality || 80)));

  const parsedHeader = parseImageHeaderMetadata(inputBytes);
  let infoFromBinding: CloudflareImageInfo | null = null;

  if (typeof imagesBinding.info === 'function') {
    try {
      infoFromBinding = await imagesBinding.info(uint8ArrayToReadableStream(inputBytes));
    } catch {
      infoFromBinding = null;
    }
  }

  const originalFormat =
    parsedHeader?.format || normalizeFormatName(infoFromBinding?.format) || '';
  const originalWidth = parsedHeader?.width || infoFromBinding?.width || 0;
  const originalHeight = parsedHeader?.height || infoFromBinding?.height || 0;

  if (!originalFormat || originalWidth <= 0 || originalHeight <= 0) {
    throw new Error(
      'Unsupported or corrupted image file: unable to determine source image format and dimensions.'
    );
  }

  const hasAlpha = parsedHeader ? parsedHeader.hasAlpha : true;
  const sourceSha256 = await computeSha256Hex(inputBytes);

  // Calculate proportional dimensions without cropping or upscaling
  const targetDims = calculateProportionalDimensions(
    originalWidth,
    originalHeight,
    clampedMaxWidth
  );

  // Transform via Cloudflare Images binding using fit: 'scale-down' (never crops, never enlarges)
  const transformer = imagesBinding
    .input(uint8ArrayToReadableStream(inputBytes))
    .transform({
      width: targetDims.width,
      height: targetDims.height,
      fit: 'scale-down',
    });

  const outputResult = await transformer.output({
    format: 'image/webp',
    quality: clampedQuality,
  });

  const webpBytes = await readTransformationOutputBytes(outputResult);
  if (!isWebpBinary(webpBytes)) {
    throw new Error(
      'Cloudflare Images binding did not return a valid WebP binary (missing RIFF/WEBP header).'
    );
  }

  const outputHeader = parseImageHeaderMetadata(webpBytes);
  const optimizedWidth = outputHeader?.width || targetDims.width;
  const optimizedHeight = outputHeader?.height || targetDims.height;
  const outputHasAlpha = outputHeader ? outputHeader.hasAlpha : hasAlpha;
  const optimizedSha256 = await computeSha256Hex(webpBytes);
  const wasResized = optimizedWidth < originalWidth || optimizedHeight < originalHeight;

  return {
    webpBytes,
    originalWidth,
    originalHeight,
    optimizedWidth,
    optimizedHeight,
    width: optimizedWidth,
    height: optimizedHeight,
    wasResized,
    originalFormat,
    hasAlpha: outputHasAlpha,
    originalSize: inputBytes.byteLength,
    optimizedSize: webpBytes.byteLength,
    sourceSha256,
    optimizedSha256,
  };
}
