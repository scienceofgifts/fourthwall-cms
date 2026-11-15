import {
  GuideImageRole,
  ImageDimensions,
  ImageOptimizationStatus,
  Product,
  ProductImageMappingRecord,
} from '../types/cms';
import {
  HtmlAstNode,
  HtmlAttr,
  parseHtmlToAst,
  serializeAstToHtml,
} from './htmlWorkspaceEngine';
import { normalizeFourthwallProductUrl } from './productCatalogTaxonomy';

export const DEFAULT_CUSTOM_IMAGE_DOMAIN = 'https://images.scienceofgifts.com';
export const DEFAULT_IMAGE_PUBLIC_BASE_URL = DEFAULT_CUSTOM_IMAGE_DOMAIN;
export const DEFAULT_STANDARD_MAX_WIDTH = 600;
export const DEFAULT_STANDARD_IMAGE_MAX_WIDTH = DEFAULT_STANDARD_MAX_WIDTH;
export const DEFAULT_FEATURED_MAX_WIDTH = 900;
export const DEFAULT_FEATURED_IMAGE_MAX_WIDTH = DEFAULT_FEATURED_MAX_WIDTH;
export const DEFAULT_WEBP_QUALITY = 80;

export const CUSTOM_IMAGE_DOMAIN_STORAGE_KEY = 'sog_custom_image_domain_v1';

function getAttr(node: HtmlAstNode, name: string): string {
  if (!node.attrs) return '';
  const target = name.toLowerCase();
  const found = node.attrs.find((a) => a.name.toLowerCase() === target);
  return found ? found.value : '';
}

function setAttr(node: HtmlAstNode, name: string, value: string): void {
  if (!node.attrs) {
    node.attrs = [];
  }
  const target = name.toLowerCase();
  const existing = node.attrs.find((a) => a.name.toLowerCase() === target);
  if (existing) {
    existing.value = value;
  } else {
    const attr: HtmlAttr = { name, value, quote: '"' };
    node.attrs.push(attr);
  }
}

function removeAttr(node: HtmlAstNode, name: string): void {
  if (!node.attrs) return;
  const target = name.toLowerCase();
  node.attrs = node.attrs.filter((a) => a.name.toLowerCase() !== target);
}

function getAttrNames(node: HtmlAstNode): string[] {
  if (!node.attrs) return [];
  return node.attrs.map((a) => a.name);
}

export function getSavedCustomImageDomain(): string {
  if (typeof window === 'undefined' || !window.localStorage) {
    return DEFAULT_CUSTOM_IMAGE_DOMAIN;
  }
  try {
    const raw = window.localStorage.getItem(CUSTOM_IMAGE_DOMAIN_STORAGE_KEY);
    return normalizeCustomImageDomain(raw || DEFAULT_CUSTOM_IMAGE_DOMAIN);
  } catch {
    return DEFAULT_CUSTOM_IMAGE_DOMAIN;
  }
}

export function saveCustomImageDomain(domain: string): string {
  const normalized = normalizeCustomImageDomain(domain);
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(CUSTOM_IMAGE_DOMAIN_STORAGE_KEY, normalized);
    } catch {
      // ignore storage error
    }
  }
  return normalized;
}

export function normalizeCustomImageDomain(rawDomain: string): string {
  const trimmed = (rawDomain || '').trim().replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_CUSTOM_IMAGE_DOMAIN;
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed.replace(/^\/+/, '')}`;
}

/**
 * Deterministic slug extractor from a product page URL.
 * Example:
 *   `https://shop.scienceofgifts.com/products/viking-raven-t-shirt` -> `viking-raven-t-shirt`
 *   `/collections/norse/products/viking-raven-t-shirt?variant=123` -> `viking-raven-t-shirt`
 * Never uses AI to invent slugs or URLs.
 */
export function deriveProductSlugFromUrl(productPageUrl: string, fallbackName = ''): string {
  const raw = normalizeFourthwallProductUrl((productPageUrl || '').trim());
  let candidate = '';

  if (raw) {
    try {
      const parsed = raw.startsWith('http://') || raw.startsWith('https://')
        ? new URL(raw)
        : new URL(raw.startsWith('/') ? raw : `/${raw}`, 'https://shop.scienceofgifts.com');

      const pathname = decodeURIComponent(parsed.pathname).replace(/\/+$/, '');
      const productsMatch = pathname.match(/\/products\/([^/?#]+)/i);
      if (productsMatch && productsMatch[1]) {
        candidate = productsMatch[1];
      } else {
        const segments = pathname.split('/').filter(Boolean);
        if (segments.length > 0) {
          candidate = segments[segments.length - 1];
        }
      }
    } catch {
      const cleanPath = raw.split(/[?#]/)[0].replace(/\/+$/, '');
      const segments = cleanPath.split('/').filter(Boolean);
      if (segments.length > 0) {
        candidate = segments[segments.length - 1];
      }
    }
  }

  if (!candidate && fallbackName.trim()) {
    candidate = fallbackName.trim();
  }

  const sanitized = candidate
    .toLowerCase()
    .replace(/\.(html|htm|php|aspx|webp|jpg|jpeg|png)$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return sanitized;
}

/**
 * Normalizes an optional deterministic suffix (e.g. `back`, `detail-1`, `2`).
 */
export function sanitizeVariantSuffix(suffix?: string | null): string {
  if (!suffix) return '';
  return suffix
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Infers a deterministic suffix hint from an image URL or alt text when a product has multiple images.
 */
export function inferImageVariantHint(imageUrl: string, altText = ''): string {
  const combined = `${imageUrl || ''} ${altText || ''}`.toLowerCase();
  if (/\b(back|rear|reverse)\b|[-_]back\b/.test(combined)) return 'back';
  if (/\b(front)\b|[-_]front\b/.test(combined)) return 'front';
  if (/\b(side|profile)\b|[-_]side\b/.test(combined)) return 'side';
  if (/\b(closeup|close-up|zoom|macro)\b/.test(combined)) return 'detail-1';
  return '';
}

/**
 * Builds the clean `.webp` filename from a product slug and optional variant suffix.
 */
export function buildOptimizedImageFilename(productSlug: string, variantSuffix?: string): string {
  const cleanSlug = deriveProductSlugFromUrl(productSlug, productSlug);
  if (!cleanSlug) {
    throw new Error('Cannot build optimized filename: product slug is empty.');
  }
  const cleanSuffix = sanitizeVariantSuffix(variantSuffix);
  if (!cleanSuffix) {
    return `${cleanSlug}.webp`;
  }
  if (cleanSlug.endsWith(`-${cleanSuffix}`)) {
    return `${cleanSlug}.webp`;
  }
  return `${cleanSlug}-${cleanSuffix}.webp`;
}

/**
 * Validates and constructs a safe R2 object key (`products/<filename>.webp`).
 * Prevents path traversal (`..`), backslashes, leading slashes, or non-webp keys.
 */
export function buildR2ObjectKey(filenameOrSlug: string, variantSuffix?: string): string {
  const raw = (filenameOrSlug || '').trim().replace(/^\/+/, '');
  let filename = raw.startsWith('products/') ? raw.slice('products/'.length) : raw;
  if (!filename.endsWith('.webp') || variantSuffix) {
    filename = buildOptimizedImageFilename(filename, variantSuffix);
  }
  const key = `products/${filename}`;
  const validation = validateR2ObjectKey(key);
  if (!validation.valid) {
    throw new Error(validation.error || `Invalid R2 object key "${key}".`);
  }
  return key;
}

export function validateR2ObjectKey(objectKey: string): { valid: boolean; error?: string } {
  if (!objectKey || typeof objectKey !== 'string') {
    return { valid: false, error: 'Object key is required.' };
  }
  if (objectKey.includes('..') || objectKey.includes('\\') || objectKey.includes('\0')) {
    return {
      valid: false,
      error: 'Invalid object key: path traversal sequences and backslashes are forbidden.',
    };
  }
  if (objectKey.startsWith('/')) {
    return { valid: false, error: 'Invalid object key: must not start with a leading slash.' };
  }
  if (!/^products\/[a-z0-9]+(?:-[a-z0-9]+)*\.webp$/.test(objectKey)) {
    return {
      valid: false,
      error:
        'Object key must match "products/<lowercase-slug>.webp" using only lowercase alphanumeric characters and hyphens.',
    };
  }
  if (objectKey.length > 260) {
    return { valid: false, error: 'Object key exceeds maximum length (260 characters).' };
  }
  return { valid: true };
}

/**
 * Builds the final public URL on the configured custom domain:
 * e.g. `https://images.scienceofgifts.com/products/viking-raven-t-shirt.webp`
 * Supports both `(customDomain, objectKeyOrSlug)` and `(slug, customDomain, variantSuffix)`.
 */
export function buildPublicOptimizedImageUrl(
  firstArg: string,
  secondArg: string = DEFAULT_CUSTOM_IMAGE_DOMAIN,
  variantSuffix?: string
): string {
  const firstIsDomain =
    /^https?:\/\//i.test(firstArg.trim()) ||
    firstArg.trim().includes('.') && !firstArg.trim().endsWith('.webp');

  const customDomain = firstIsDomain ? firstArg : secondArg;
  const slugOrKey = firstIsDomain ? secondArg : firstArg;

  const base = normalizeCustomImageDomain(customDomain || DEFAULT_CUSTOM_IMAGE_DOMAIN);
  const key = buildR2ObjectKey(slugOrKey, variantSuffix);
  return `${base}/${key}`;
}

/**
 * Calculates proportional target dimensions without cropping or upscaling.
 * Preserves exact original aspect ratio.
 */
export function calculateProportionalDimensions(
  originalWidth: number,
  originalHeight: number,
  maxWidth: number
): ImageDimensions {
  if (originalWidth <= 0 || originalHeight <= 0 || maxWidth <= 0) {
    return {
      width: Math.max(1, Math.round(originalWidth || maxWidth)),
      height: Math.max(1, Math.round(originalHeight || maxWidth)),
    };
  }
  if (originalWidth <= maxWidth) {
    return { width: Math.round(originalWidth), height: Math.round(originalHeight) };
  }
  const scale = maxWidth / originalWidth;
  return {
    width: Math.round(maxWidth),
    height: Math.max(1, Math.round(originalHeight * scale)),
  };
}

export interface DetectedGuideImageItem {
  id: string;
  nodePath: string;
  originalImageUrl: string;
  altText: string;
  productPageUrl: string;
  baseProductSlug: string;
  productSlug: string;
  productId?: string;
  productName?: string;
  variantSuffix: string;
  filename: string;
  objectKey: string;
  r2ObjectKey: string;
  optimizedImageUrl: string;
  imageRole: GuideImageRole;
  role: GuideImageRole;
  maxWidth: number;
  quality: number;
  status: ImageOptimizationStatus;
  originalDimensions?: ImageDimensions;
  optimizedDimensions?: ImageDimensions;
  originalFileSize?: number;
  optimizedFileSize?: number;
  estimatedOptimizedSize?: number;
  errorMessage?: string;
  sourceChangedConflict?: boolean;
  previousOriginalImageUrl?: string;
  unmatchedReason?: string;
  optimizedWebpBase64?: string;
  lastOptimizedAt?: string;
  lastUploadedAt?: string;
  existingMapping?: ProductImageMappingRecord;
}

export type ScannedGuideImageItem = DetectedGuideImageItem;

function getElementClassString(el: HtmlAstNode): string {
  return getAttr(el, 'class').toLowerCase();
}

function findEnclosingHrefOrProductUrl(ancestors: HtmlAstNode[], imgEl: HtmlAstNode): string {
  const directDataUrl = getAttr(imgEl, 'data-product-url').trim();
  if (directDataUrl) {
    return directDataUrl;
  }
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const anc = ancestors[i];
    const ancDataUrl = getAttr(anc, 'data-product-url').trim();
    if (ancDataUrl) {
      return ancDataUrl;
    }
    const href = getAttr(anc, 'href').trim();
    if (anc.tagName === 'a' && href && !href.startsWith('#')) {
      return href;
    }
  }
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const anc = ancestors[i];
    const cls = getElementClassString(anc);
    if (
      anc.tagName === 'article' ||
      cls.includes('sog-ed-card') ||
      cls.includes('sog-qp-card') ||
      cls.includes('sog-grid-card') ||
      cls.includes('sog-editor-pick') ||
      cls.includes('sog-deity-card')
    ) {
      const cardLink = findFirstProductHrefInSubtree(anc);
      if (cardLink) return cardLink;
      break;
    }
  }
  return '';
}

function findFirstProductHrefInSubtree(node: HtmlAstNode): string {
  if (node.type !== 'element') return '';
  const dataUrl = getAttr(node, 'data-product-url').trim();
  if (dataUrl) {
    return dataUrl;
  }
  if (node.tagName === 'a') {
    const href = getAttr(node, 'href').trim();
    if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
      return href;
    }
  }
  for (const child of node.children || []) {
    const found = findFirstProductHrefInSubtree(child);
    if (found) return found;
  }
  return '';
}

function findCardHeadingText(ancestors: HtmlAstNode[]): string {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const anc = ancestors[i];
    const cls = getElementClassString(anc);
    if (
      anc.tagName === 'article' ||
      cls.includes('sog-ed-card') ||
      cls.includes('sog-qp-card') ||
      cls.includes('sog-grid-card') ||
      cls.includes('sog-editor-pick')
    ) {
      const heading = extractFirstHeadingText(anc);
      if (heading) return heading;
    }
  }
  return '';
}

function extractFirstHeadingText(node: HtmlAstNode): string {
  if (node.type === 'text') return '';
  if (node.type !== 'element') return '';
  if (node.tagName === 'h2' || node.tagName === 'h3' || node.tagName === 'h4') {
    return collectPlainText(node).trim();
  }
  for (const child of node.children || []) {
    const found = extractFirstHeadingText(child);
    if (found) return found;
  }
  return '';
}

function collectPlainText(node: HtmlAstNode): string {
  if (node.type === 'text') return node.content || '';
  if (node.type !== 'element') return '';
  return (node.children || []).map(collectPlainText).join('');
}

function detectImageRoleFromAncestors(ancestors: HtmlAstNode[], imgEl: HtmlAstNode): GuideImageRole {
  const imgCls = getElementClassString(imgEl);
  if (imgCls.includes('sog-ep-img') || imgCls.includes('featured') || imgCls.includes('hero')) {
    return 'featured';
  }
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const cls = getElementClassString(ancestors[i]);
    if (
      cls.includes('sog-editor-pick') ||
      cls.includes('sog-ep-') ||
      cls.includes('featured-product') ||
      cls.includes('hero')
    ) {
      return 'featured';
    }
  }
  return 'standard';
}

function normalizeUrlForComparison(url: string): string {
  const trimmed = (url || '').trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed, 'https://shop.scienceofgifts.com');
    return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

function matchImageToCatalogProduct(
  originalImageUrl: string,
  enclosingHref: string,
  cardHeading: string,
  altText: string,
  catalogProducts: Product[]
): Product | undefined {
  const hrefSlug = deriveProductSlugFromUrl(enclosingHref);
  if (hrefSlug) {
    const bySlug = catalogProducts.find(
      (p) => deriveProductSlugFromUrl(p.productUrl, p.name) === hrefSlug
    );
    if (bySlug) return bySlug;
  }

  const normImg = normalizeUrlForComparison(originalImageUrl);
  if (normImg) {
    const byImg = catalogProducts.find((p) => {
      if (normalizeUrlForComparison(p.imageUrl) === normImg) return true;
      if (Array.isArray(p.imageUrls)) {
        return p.imageUrls.some((u) => normalizeUrlForComparison(u) === normImg);
      }
      return false;
    });
    if (byImg) return byImg;
  }

  const targetTitle = (cardHeading || altText || '').trim().toLowerCase();
  if (targetTitle && targetTitle.length >= 4) {
    const byTitle = catalogProducts.find((p) => p.name.trim().toLowerCase() === targetTitle);
    if (byTitle) return byTitle;
  }

  return undefined;
}

/**
 * Deterministically assigns filenames and variant suffixes when multiple distinct images
 * belong to the same product slug.
 * Accepts either an array of image URL strings (for a single product) or an array of objects.
 */
export function assignDeterministicSuffixesForProductImages(
  items:
    | string[]
    | Array<{
        originalImageUrl: string;
        productSlug?: string;
        altText?: string;
        explicitSuffix?: string;
      }>
): Array<{ originalImageUrl: string; variantSuffix: string; filename: string; objectKey: string }> {
  if (items.length === 0) return [];

  // Normalize string[] overload into object array
  const normalizedItems = items.map((entry) => {
    if (typeof entry === 'string') {
      return {
        originalImageUrl: entry,
        productSlug: 'product',
        altText: entry,
      };
    }
    return {
      originalImageUrl: entry.originalImageUrl,
      productSlug: entry.productSlug || 'product',
      altText: entry.altText || '',
      explicitSuffix: entry.explicitSuffix,
    };
  });

  const isStringOverload = typeof items[0] === 'string';

  const seenUrlsBySlug = new Map<string, string[]>();
  const assignedSuffixBySlugAndUrl = new Map<string, string>();
  const usedFilenames = new Set<string>();

  for (const item of normalizedItems) {
    const slug = item.productSlug;
    if (!slug) continue;
    const normUrl = (item.originalImageUrl || '').trim();
    const key = `${slug}::${normUrl}`;
    if (assignedSuffixBySlugAndUrl.has(key)) continue;

    const urls = seenUrlsBySlug.get(slug) || [];
    const occurrenceIndex = urls.length;
    urls.push(normUrl);
    seenUrlsBySlug.set(slug, urls);

    let suffix = sanitizeVariantSuffix(item.explicitSuffix);
    if (!suffix && occurrenceIndex > 0) {
      const hint = inferImageVariantHint(normUrl, item.altText || '');
      if (hint && hint !== 'front') {
        suffix = hint;
      } else {
        suffix = occurrenceIndex === 1 && isStringOverload ? 'back' : `detail-${isStringOverload ? occurrenceIndex - 1 : occurrenceIndex}`;
      }
    }

    let filename = buildOptimizedImageFilename(slug, suffix);
    let detailCounter = 1;
    while (usedFilenames.has(filename)) {
      suffix = `detail-${detailCounter++}`;
      filename = buildOptimizedImageFilename(slug, suffix);
    }

    usedFilenames.add(filename);
    assignedSuffixBySlugAndUrl.set(key, suffix);
  }

  return normalizedItems.map((item) => {
    const slug = item.productSlug;
    const normUrl = (item.originalImageUrl || '').trim();
    if (!slug) {
      return { originalImageUrl: normUrl, variantSuffix: '', filename: '', objectKey: '' };
    }
    const rawSuffix = assignedSuffixBySlugAndUrl.get(`${slug}::${normUrl}`) || '';
    const filename = buildOptimizedImageFilename(slug, rawSuffix);
    const objectKey = buildR2ObjectKey(filename);
    const formattedSuffix = rawSuffix ? (rawSuffix.startsWith('-') ? rawSuffix : `-${rawSuffix}`) : '';
    return {
      originalImageUrl: normUrl,
      variantSuffix: isStringOverload ? formattedSuffix : rawSuffix,
      filename,
      objectKey,
    };
  });
}

/**
 * Scans gift guide HTML for all product `<img>` elements, matches them against the product catalog
 * and existing image mappings, and builds the complete list of detected images.
 */
export function scanGuideHtmlForImages(
  htmlContent: string,
  catalogProducts: Product[] = [],
  existingMappings: ProductImageMappingRecord[] = [],
  optionsOrCustomDomain?:
    | string
    | {
        customDomain?: string;
        standardMaxWidth?: number;
        featuredMaxWidth?: number;
        quality?: number;
      }
): DetectedGuideImageItem[] {
  const options =
    typeof optionsOrCustomDomain === 'string'
      ? { customDomain: optionsOrCustomDomain }
      : optionsOrCustomDomain;

  const customDomain = normalizeCustomImageDomain(
    options?.customDomain || getSavedCustomImageDomain()
  );
  const standardMaxWidth = options?.standardMaxWidth || DEFAULT_STANDARD_MAX_WIDTH;
  const featuredMaxWidth = options?.featuredMaxWidth || DEFAULT_FEATURED_MAX_WIDTH;
  const quality = options?.quality || DEFAULT_WEBP_QUALITY;

  const parsedAst = parseHtmlToAst(htmlContent || '');
  const rawDetections: Array<{
    nodePath: string;
    imgEl: HtmlAstNode;
    ancestors: HtmlAstNode[];
    originalImageUrl: string;
    altText: string;
    enclosingHref: string;
    cardHeading: string;
    imageRole: GuideImageRole;
  }> = [];

  function walk(nodes: HtmlAstNode[], pathPrefix: string, ancestors: HtmlAstNode[]) {
    nodes.forEach((node, idx) => {
      const currentPath = pathPrefix ? `${pathPrefix}.${idx}` : `${idx}`;
      if (node.type === 'element') {
        if (node.tagName === 'img') {
          const src = (getAttr(node, 'src') || getAttr(node, 'data-src')).trim();
          if (src && !src.startsWith('data:image/svg+xml')) {
            const altText = getAttr(node, 'alt').trim();
            const enclosingHref = findEnclosingHrefOrProductUrl(ancestors, node);
            const cardHeading = findCardHeadingText(ancestors);
            const imageRole = detectImageRoleFromAncestors(ancestors, node);
            rawDetections.push({
              nodePath: currentPath,
              imgEl: node,
              ancestors,
              originalImageUrl: src,
              altText,
              enclosingHref,
              cardHeading,
              imageRole,
            });
          }
        }
        walk(node.children || [], currentPath, [...ancestors, node]);
      }
    });
  }

  walk(parsedAst.rootChildren, '', []);

  const mappingByOriginalUrl = new Map<string, ProductImageMappingRecord>();
  const mappingByObjectKey = new Map<string, ProductImageMappingRecord>();
  const mappingBySlug = new Map<string, ProductImageMappingRecord>();
  for (const m of existingMappings) {
    if (m.originalImageUrl) {
      mappingByOriginalUrl.set(m.originalImageUrl.trim(), m);
    }
    const key = m.objectKey || m.r2ObjectKey;
    if (key) {
      mappingByObjectKey.set(key, m);
    }
    if (m.productSlug) {
      mappingBySlug.set(m.productSlug, m);
    }
  }

  const resolvedPass = rawDetections.map((det) => {
    const existingByUrl = mappingByOriginalUrl.get(det.originalImageUrl);
    const matchedProduct = matchImageToCatalogProduct(
      det.originalImageUrl,
      det.enclosingHref,
      det.cardHeading,
      det.altText,
      catalogProducts
    );

    const rawProductPageUrl =
      existingByUrl?.productPageUrl ||
      matchedProduct?.productUrl ||
      det.enclosingHref ||
      '';
    const productPageUrl =
      normalizeFourthwallProductUrl(rawProductPageUrl) || rawProductPageUrl;

    const baseProductSlug =
      existingByUrl?.baseProductSlug ||
      existingByUrl?.productSlug ||
      deriveProductSlugFromUrl(productPageUrl, matchedProduct?.name || '');

    return {
      ...det,
      existingByUrl,
      matchedProduct,
      productPageUrl,
      baseProductSlug,
    };
  });

  const suffixAssignments = assignDeterministicSuffixesForProductImages(
    resolvedPass.map((r) => ({
      originalImageUrl: r.originalImageUrl,
      productSlug: r.baseProductSlug,
      altText: r.altText,
      explicitSuffix: r.existingByUrl?.variantSuffix,
    }))
  );

  return resolvedPass.map((item, idx) => {
    const assignment = suffixAssignments[idx];
    const role = item.existingByUrl?.imageRole || item.existingByUrl?.role || item.imageRole;
    const maxWidth =
      item.existingByUrl?.maxWidth ||
      item.existingByUrl?.targetMaxWidth ||
      (role === 'featured' ? featuredMaxWidth : standardMaxWidth);
    const itemQuality = item.existingByUrl?.quality || quality;

    const fullSlug = assignment.filename
      ? assignment.filename.replace(/\.webp$/i, '')
      : item.baseProductSlug;

    const existingForKey =
      (assignment.objectKey ? mappingByObjectKey.get(assignment.objectKey) : undefined) ||
      (fullSlug ? mappingBySlug.get(fullSlug) : undefined);

    const existing = item.existingByUrl || existingForKey;

    const isAlreadyOptimizedUrl = Boolean(
      assignment.objectKey &&
        item.originalImageUrl === buildPublicOptimizedImageUrl(customDomain, assignment.objectKey)
    );

    const sourceChangedConflict = Boolean(
      existingForKey &&
        existingForKey.originalImageUrl &&
        existingForKey.originalImageUrl !== item.originalImageUrl &&
        !isAlreadyOptimizedUrl
    );

    const optimizedImageUrl = assignment.objectKey
      ? buildPublicOptimizedImageUrl(customDomain, assignment.objectKey)
      : '';

    let status: ImageOptimizationStatus = 'not_optimized';
    let unmatchedReason: string | undefined;

    if (!item.baseProductSlug) {
      status = 'error';
      unmatchedReason =
        'Could not determine product slug: image has no enclosing /products/ link and did not match any catalog product.';
    } else if (isAlreadyOptimizedUrl) {
      status = 'link_updated';
    } else if (sourceChangedConflict) {
      status = 'not_optimized';
    } else if (item.existingByUrl) {
      status = item.existingByUrl.status;
    }

    const widthAttr = Number(getAttr(item.imgEl, 'width') || 0);
    const heightAttr = Number(getAttr(item.imgEl, 'height') || 0);
    const fallbackDims =
      widthAttr > 0 && heightAttr > 0 ? { width: widthAttr, height: heightAttr } : undefined;

    const origFileSize =
      item.existingByUrl?.originalFileSize ?? item.existingByUrl?.originalFileSizeBytes;
    const optFileSize =
      item.existingByUrl?.optimizedFileSize ?? item.existingByUrl?.optimizedFileSizeBytes;

    return {
      id: item.existingByUrl?.id || `img-${idx}-${assignment.filename || 'unmatched'}`,
      nodePath: item.nodePath,
      originalImageUrl: item.originalImageUrl,
      altText: item.altText,
      productPageUrl: item.productPageUrl,
      baseProductSlug: item.baseProductSlug,
      productSlug: fullSlug,
      productId: item.matchedProduct?.id || existing?.productId,
      productName:
        item.matchedProduct?.name ||
        existing?.productName ||
        item.cardHeading ||
        item.altText ||
        item.baseProductSlug ||
        'Unmatched Image',
      variantSuffix: assignment.variantSuffix
        ? assignment.variantSuffix.startsWith('-')
          ? assignment.variantSuffix
          : `-${assignment.variantSuffix}`
        : '',
      filename: assignment.filename,
      objectKey: assignment.objectKey,
      r2ObjectKey: assignment.objectKey,
      optimizedImageUrl,
      imageRole: role,
      role,
      maxWidth,
      quality: itemQuality,
      status,
      originalDimensions: item.existingByUrl?.originalDimensions || fallbackDims,
      optimizedDimensions: item.existingByUrl?.optimizedDimensions,
      originalFileSize: origFileSize,
      optimizedFileSize: optFileSize,
      estimatedOptimizedSize:
        optFileSize || (origFileSize ? Math.round(origFileSize * 0.28) : undefined),
      errorMessage: unmatchedReason || item.existingByUrl?.errorMessage,
      sourceChangedConflict,
      previousOriginalImageUrl: sourceChangedConflict
        ? existingForKey?.originalImageUrl
        : undefined,
      unmatchedReason,
      optimizedWebpBase64: item.existingByUrl?.optimizedWebpBase64,
      lastOptimizedAt: item.existingByUrl?.lastOptimizedAt,
      lastUploadedAt: item.existingByUrl?.lastUploadedAt,
      existingMapping: item.existingByUrl,
    };
  });
}

export interface HtmlImageReplacementPreviewEntry {
  nodePath: string;
  productName: string;
  productSlug: string;
  originalUrl: string;
  previousSrc: string;
  newOptimizedUrl: string;
  nextSrc: string;
  matchedBy: 'exact_url' | 'unambiguous_slug';
  matchMode: 'exact_original_url' | 'unambiguous_product_slug';
  preservedAttributes: string[];
}

export interface UnmatchedGuideImageReportItem {
  nodePath: string;
  originalUrl: string;
  src: string;
  altText: string;
  productSlug?: string;
  reason: string;
}

export interface HtmlImageReplacementResult {
  html: string;
  updatedHtml: string;
  replacedCount: number;
  replacements: HtmlImageReplacementPreviewEntry[];
  unmatchedImages: UnmatchedGuideImageReportItem[];
  skippedAmbiguous: UnmatchedGuideImageReportItem[];
}

export interface ReplaceGuideHtmlOptions {
  allowSlugFallback?: boolean;
  requireUploadedStatus?: boolean;
  onlyUploadedOrOptimized?: boolean;
  catalogProducts?: Product[];
}

/**
 * Replaces original image URLs in the guide HTML using the verified image mapping:
 * 1. Matches by exact `originalImageUrl` when possible.
 * 2. Uses `productSlug` as a fallback ONLY when the mapping for that slug is unambiguous (exactly 1 ready mapping)
 *    and `allowSlugFallback !== false`.
 * 3. Preserves all other HTML attributes (`alt`, `width`, `height`, `loading`, `class`, `style`, etc.) and markup.
 * 4. Never alters gift-card CSS or crop behavior.
 * 5. Never replaces an image if the optimized version is missing, not ready, or its mapping is ambiguous.
 */
export function replaceGuideHtmlImageUrls(
  htmlContent: string,
  mappings: ProductImageMappingRecord[],
  catalogProductsOrOptions?: Product[] | ReplaceGuideHtmlOptions,
  maybeOptions?: ReplaceGuideHtmlOptions
): HtmlImageReplacementResult {
  const catalogProducts = Array.isArray(catalogProductsOrOptions)
    ? catalogProductsOrOptions
    : catalogProductsOrOptions?.catalogProducts || [];
  const options: ReplaceGuideHtmlOptions | undefined = Array.isArray(catalogProductsOrOptions)
    ? maybeOptions
    : catalogProductsOrOptions;

  const allowSlugFallback = options?.allowSlugFallback !== false;
  const requireUploadedStatus = options?.requireUploadedStatus ?? false;

  const eligibleMappings = mappings.filter((m) => {
    const key = m.objectKey || m.r2ObjectKey;
    if (!m.optimizedImageUrl || !key) return false;
    if (requireUploadedStatus) {
      return m.status === 'uploaded' || m.status === 'link_updated';
    }
    return (
      m.status === 'uploaded' ||
      m.status === 'link_updated' ||
      m.status === 'optimized_locally'
    );
  });

  const exactUrlMap = new Map<string, ProductImageMappingRecord>();
  const mappingsBySlug = new Map<string, ProductImageMappingRecord[]>();

  for (const m of eligibleMappings) {
    if (m.originalImageUrl) {
      exactUrlMap.set(m.originalImageUrl.trim(), m);
    }
    const baseSlug = m.baseProductSlug || m.productSlug;
    if (baseSlug) {
      const list = mappingsBySlug.get(baseSlug) || [];
      list.push(m);
      mappingsBySlug.set(baseSlug, list);
    }
  }

  const parsedAst = parseHtmlToAst(htmlContent || '');
  const replacements: HtmlImageReplacementPreviewEntry[] = [];
  const unmatchedImages: UnmatchedGuideImageReportItem[] = [];
  const skippedAmbiguous: UnmatchedGuideImageReportItem[] = [];

  function walk(nodes: HtmlAstNode[], pathPrefix: string, ancestors: HtmlAstNode[]) {
    nodes.forEach((node, idx) => {
      const currentPath = pathPrefix ? `${pathPrefix}.${idx}` : `${idx}`;
      if (node.type === 'element') {
        if (node.tagName === 'img') {
          const currentSrc = (getAttr(node, 'src') || getAttr(node, 'data-src')).trim();
          if (currentSrc && !currentSrc.startsWith('data:image/svg+xml')) {
            const altText = getAttr(node, 'alt').trim();
            const enclosingHref = findEnclosingHrefOrProductUrl(ancestors, node);
            const cardHeading = findCardHeadingText(ancestors);
            const matchedProduct = matchImageToCatalogProduct(
              currentSrc,
              enclosingHref,
              cardHeading,
              altText,
              catalogProducts
            );
            const derivedSlug = deriveProductSlugFromUrl(
              matchedProduct?.productUrl || enclosingHref,
              matchedProduct?.name || ''
            );

            const alreadyUpdated = eligibleMappings.find(
              (m) => m.optimizedImageUrl === currentSrc
            );
            if (alreadyUpdated) {
              return;
            }

            // 1. Try exact originalImageUrl match
            let chosenMapping = exactUrlMap.get(currentSrc);
            let matchedBy: 'exact_url' | 'unambiguous_slug' = 'exact_url';
            let matchMode: 'exact_original_url' | 'unambiguous_product_slug' =
              'exact_original_url';

            // 2. Fallback to unambiguous productSlug match if enabled
            if (!chosenMapping && allowSlugFallback && derivedSlug) {
              const candidates = mappingsBySlug.get(derivedSlug) || [];
              if (candidates.length === 1) {
                chosenMapping = candidates[0];
                matchedBy = 'unambiguous_slug';
                matchMode = 'unambiguous_product_slug';
              } else if (candidates.length > 1) {
                skippedAmbiguous.push({
                  nodePath: currentPath,
                  originalUrl: currentSrc,
                  src: currentSrc,
                  altText,
                  productSlug: derivedSlug,
                  reason: `Ambiguous slug fallback: ${candidates.length} optimized images exist for product slug "${derivedSlug}" and the exact original URL did not match.`,
                });
                return;
              }
            }

            if (chosenMapping && chosenMapping.optimizedImageUrl) {
              const preservedAttrs = getAttrNames(node).filter(
                (k) =>
                  k.toLowerCase() !== 'src' &&
                  k.toLowerCase() !== 'srcset' &&
                  k.toLowerCase() !== 'data-src' &&
                  k.toLowerCase() !== 'data-srcset'
              );
              replacements.push({
                nodePath: currentPath,
                productName:
                  chosenMapping.productName ||
                  matchedProduct?.name ||
                  cardHeading ||
                  altText ||
                  chosenMapping.productSlug,
                productSlug: chosenMapping.productSlug,
                originalUrl: currentSrc,
                previousSrc: currentSrc,
                newOptimizedUrl: chosenMapping.optimizedImageUrl,
                nextSrc: chosenMapping.optimizedImageUrl,
                matchedBy,
                matchMode,
                preservedAttributes: preservedAttrs,
              });

              setAttr(node, 'src', chosenMapping.optimizedImageUrl);
              removeAttr(node, 'data-src');
              removeAttr(node, 'data-srcset');
              removeAttr(node, 'srcset');
            } else {
              unmatchedImages.push({
                nodePath: currentPath,
                originalUrl: currentSrc,
                src: currentSrc,
                altText,
                productSlug: derivedSlug || undefined,
                reason: derivedSlug
                  ? `No optimized image mapping ready for "${derivedSlug}". Optimize the image first.`
                  : 'Image could not be matched to a product URL or slug.',
              });
            }
          }
        }
        walk(node.children || [], currentPath, [...ancestors, node]);
      }
    });
  }

  walk(parsedAst.rootChildren, '', []);

  const serialized =
    replacements.length > 0 ? serializeAstToHtml(parsedAst.rootChildren) : htmlContent;

  return {
    html: serialized,
    updatedHtml: serialized,
    replacedCount: replacements.length,
    replacements,
    unmatchedImages,
    skippedAmbiguous,
  };
}

