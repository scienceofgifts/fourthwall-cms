import sharp from 'sharp';
import { computeSha256Hex } from './imageR2Upload';
import type { ImageProcessInput, ImageProcessOutput } from './cloudflareImagesProcessor';

export type { ImageProcessInput, ImageProcessOutput };

const SUPPORTED_INPUT_FORMATS = new Set([
  'jpeg',
  'jpg',
  'png',
  'webp',
  'avif',
  'gif',
  'tiff',
  'svg',
]);

/**
 * Processes an input image buffer using `sharp`:
 * 1. Validates the image format and extracts original dimensions & alpha status.
 * 2. Resizes proportionally (`fit: 'inside'`) WITHOUT cropping and WITHOUT upscaling (`withoutEnlargement: true`).
 * 3. Converts to WebP at the requested quality (default ~80) while preserving transparency (`alphaQuality: 100`).
 */
export async function processImageWithSharp(
  paramsOrBytes: ImageProcessInput | Uint8Array,
  maxWidthArg?: number,
  qualityArg?: number
): Promise<ImageProcessOutput> {
  const inputBytes =
    paramsOrBytes instanceof Uint8Array ? paramsOrBytes : paramsOrBytes?.inputBytes;
  const maxWidth =
    paramsOrBytes instanceof Uint8Array ? (maxWidthArg ?? 600) : paramsOrBytes?.maxWidth;
  const quality =
    paramsOrBytes instanceof Uint8Array ? (qualityArg ?? 80) : paramsOrBytes?.quality;

  if (!inputBytes || inputBytes.byteLength === 0) {
    throw new Error('Cannot optimize image: input buffer is empty.');
  }

  const clampedMaxWidth = Math.max(64, Math.min(4096, Math.round(maxWidth || 600)));
  const clampedQuality = Math.max(10, Math.min(100, Math.round(quality || 80)));

  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
  try {
    metadata = await sharp(Buffer.from(inputBytes)).metadata();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Unsupported or corrupted image file: ${msg}`);
  }

  const format = (metadata.format || '').toLowerCase();
  if (!format || !SUPPORTED_INPUT_FORMATS.has(format)) {
    throw new Error(
      `Unsupported image format "${format || 'unknown'}". Supported formats: JPEG, PNG, WebP, AVIF, GIF, TIFF, SVG.`
    );
  }

  const originalWidth = metadata.width || 0;
  const originalHeight = metadata.height || 0;
  if (originalWidth <= 0 || originalHeight <= 0) {
    throw new Error('Unable to read image dimensions from source file.');
  }

  const hasAlpha = Boolean(metadata.hasAlpha);
  const sourceSha256 = await computeSha256Hex(inputBytes);

  const pipeline = sharp(Buffer.from(inputBytes), { animated: false })
    .rotate() // Auto-orient based on EXIF before proportional resize
    .resize({
      width: clampedMaxWidth,
      fit: 'inside', // Proportional resize, NEVER crops or forces square
      withoutEnlargement: true, // NEVER upscales images smaller than target width
    })
    .webp({
      quality: clampedQuality,
      alphaQuality: 100,
      effort: 4,
    });

  const { data: outputBuffer, info: outputInfo } = await pipeline.toBuffer({
    resolveWithObject: true,
  });

  const webpBytes = new Uint8Array(
    outputBuffer.buffer,
    outputBuffer.byteOffset,
    outputBuffer.byteLength
  );
  const optimizedSha256 = await computeSha256Hex(webpBytes);
  const wasResized = outputInfo.width < originalWidth || outputInfo.height < originalHeight;

  return {
    webpBytes,
    originalWidth,
    originalHeight,
    optimizedWidth: outputInfo.width,
    optimizedHeight: outputInfo.height,
    width: outputInfo.width,
    height: outputInfo.height,
    wasResized,
    originalFormat: format,
    hasAlpha,
    originalSize: inputBytes.byteLength,
    optimizedSize: webpBytes.byteLength,
    sourceSha256,
    optimizedSha256,
  };
}
