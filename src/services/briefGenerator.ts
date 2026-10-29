import { Product } from '../types/cms';
import {
  detectProductType,
  isPlaceholderProductType,
  normalizeTaxonomyLabel,
} from './productCatalogTaxonomy';
import { ExtractedProductData } from './productExtractor';

export type BriefAssistantTarget = 'chatgpt' | 'gemini';

export interface BriefGenerationOptions {
  target: BriefAssistantTarget;
  guideTopic?: string;
  additionalContext?: string;
}

/**
 * Normalizes a product URL for duplicate detection and catalog matching.
 * Treats `/products/foo-bar` and `https://scienceofgifts.com/products/foo-bar?variant=123` as matching the `/products/foo-bar` path.
 */
export function normalizeProductUrlForMatch(rawUrl: string): string {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return '';
  try {
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      const parsed = new URL(trimmed);
      const cleanPath = parsed.pathname.replace(/\/+$/, '').toLowerCase();
      if (cleanPath.includes('/products/')) {
        const idx = cleanPath.indexOf('/products/');
        return cleanPath.slice(idx);
      }
      return `${parsed.hostname.toLowerCase()}${cleanPath}`;
    }
  } catch {
    // Fallback to string normalization below
  }
  const withoutQuery = trimmed.split('?')[0].split('#')[0].replace(/\/+$/, '').toLowerCase();
  const prodIdx = withoutQuery.indexOf('/products/');
  if (prodIdx >= 0) {
    return withoutQuery.slice(prodIdx);
  }
  return withoutQuery;
}

/**
 * Checks if a candidate URL or SKU already exists in the catalog.
 */
export function findDuplicateProduct(
  products: Product[],
  candidateUrl: string,
  candidateSku?: string,
  excludeProductId?: string
): Product | undefined {
  const normCandidateUrl = normalizeProductUrlForMatch(candidateUrl);
  const cleanSku = (candidateSku || '').trim().toLowerCase();

  return products.find((p) => {
    if (excludeProductId && p.id === excludeProductId) return false;
    if (normCandidateUrl && normalizeProductUrlForMatch(p.productUrl) === normCandidateUrl) {
      return true;
    }
    if (cleanSku && p.sku && p.sku.trim().toLowerCase() === cleanSku) {
      return true;
    }
    return false;
  });
}

export interface ProductRefreshFieldChange {
  field: string;
  label: string;
  previousValue: string;
  newValue: string;
}

/**
 * Merges newly extracted source data into an existing Product record safely:
 * - Updates fields that were successfully extracted.
 * - Preserves custom notes (`sourceNotes`) and user tags.
 * - Never overwrites populated existing fields with empty or failed extraction results.
 */
export function mergeRefreshedProductData(
  existing: Product,
  extracted: ExtractedProductData
): {
  mergedProduct: Product;
  changes: ProductRefreshFieldChange[];
  preservedFields: string[];
} {
  const changes: ProductRefreshFieldChange[] = [];
  const preservedFields: string[] = [];

  const pickNonEmpty = (
    fieldKey: string,
    label: string,
    oldVal: string | undefined,
    newVal: string | undefined
  ): string => {
    const cleanOld = (oldVal || '').trim();
    const cleanNew = (newVal || '').trim();
    if (!cleanNew) {
      if (cleanOld) preservedFields.push(label);
      return cleanOld;
    }
    if (cleanNew !== cleanOld) {
      changes.push({
        field: fieldKey,
        label,
        previousValue: cleanOld || '(empty)',
        newValue: cleanNew,
      });
    }
    return cleanNew;
  };

  const mergedName = pickNonEmpty('name', 'Title', existing.name, extracted.name) || existing.name;
  const mergedPrice =
    pickNonEmpty(
      'price',
      'Price',
      existing.price === 'Unavailable' ? '' : existing.price,
      extracted.price
    ) || existing.price;
  const mergedOriginalPrice = pickNonEmpty(
    'originalPrice',
    'Original Price',
    existing.originalPrice,
    extracted.originalPrice
  );
  const mergedCurrency =
    pickNonEmpty('currency', 'Currency', existing.currency, extracted.currency) ||
    existing.currency ||
    'USD';
  const mergedDesc = pickNonEmpty(
    'shortDescription',
    'Description',
    existing.shortDescription,
    extracted.shortDescription
  );
  const mergedImage = pickNonEmpty('imageUrl', 'Primary Image URL', existing.imageUrl, extracted.imageUrl);

  // Preserve user-selected category if already populated; otherwise adopt extracted category
  const cleanExistingCat = normalizeTaxonomyLabel(existing.category);
  const cleanExtractedCat = normalizeTaxonomyLabel(extracted.category);
  let mergedCategory = cleanExistingCat;
  if (!cleanExistingCat || cleanExistingCat.toLowerCase() === 'general') {
    mergedCategory = pickNonEmpty('category', 'Category', existing.category, cleanExtractedCat);
  } else if (cleanExtractedCat && cleanExtractedCat !== cleanExistingCat) {
    preservedFields.push('Category');
  } else if (cleanExistingCat) {
    preservedFields.push('Category');
  }

  const mergedSku = pickNonEmpty('sku', 'SKU', existing.sku, extracted.sku);
  const mergedSpecs = pickNonEmpty(
    'featuresSpecs',
    'Specifications',
    existing.featuresSpecs,
    extracted.featuresSpecs
  );

  // Never overwrite a manually confirmed productType during refresh
  const cleanExistingType = normalizeTaxonomyLabel(existing.productType);
  const hasConfirmedExistingType =
    Boolean(existing.productTypeManualOverride) ||
    (!isPlaceholderProductType(cleanExistingType) && cleanExistingType.toLowerCase() !== 'other');

  let mergedType = cleanExistingType;
  if (hasConfirmedExistingType) {
    preservedFields.push('Product Type');
  } else {
    const inferredRefreshType =
      !isPlaceholderProductType(extracted.productType) && extracted.productType !== 'Other'
        ? extracted.productType
        : detectProductType({
            name: mergedName,
            productUrl: existing.productUrl,
            rawProductType: extracted.productType,
            shortDescription: mergedDesc,
            featuresSpecs: mergedSpecs,
            tags: extracted.tags,
          }).detectedType;
    mergedType = pickNonEmpty('productType', 'Product Type', existing.productType, inferredRefreshType);
  }

  // Merge imageUrls without losing existing images if new extraction is empty
  const mergedImageUrls =
    extracted.imageUrls && extracted.imageUrls.length > 0
      ? extracted.imageUrls
      : existing.imageUrls && existing.imageUrls.length > 0
      ? existing.imageUrls
      : mergedImage
      ? [mergedImage]
      : [];

  // Merge variants without overwriting existing variants with empty array
  const mergedVariants =
    extracted.variants && extracted.variants.length > 0
      ? extracted.variants
      : existing.variants || [];

  // Always preserve user custom notes and combine tags
  const combinedTags = Array.from(
    new Set([...(existing.tags || []), ...(extracted.tags || [])])
  ).slice(0, 20);

  if (existing.sourceNotes?.trim()) {
    preservedFields.push('Custom Notes');
  }

  const nowIso = new Date().toISOString();

  const mergedProduct: Product = {
    ...existing,
    name: mergedName,
    price: mergedPrice,
    originalPrice: mergedOriginalPrice || undefined,
    currency: mergedCurrency,
    shortDescription: mergedDesc,
    imageUrl: mergedImage,
    imageUrls: mergedImageUrls,
    category: mergedCategory,
    productType: mergedType,
    productTypeManualOverride: existing.productTypeManualOverride,
    sku: mergedSku || undefined,
    featuresSpecs: mergedSpecs,
    variants: mergedVariants,
    tags: combinedTags,
    // Strictly preserve user custom notes
    sourceNotes: existing.sourceNotes,
    lastFetchedAt: nowIso,
    dataSource: extracted.dataSource,
    fetchStatus: extracted.fetchStatus,
  };

  return { mergedProduct, changes, preservedFields };
}

/**
 * Generates a structured, copy-ready text brief for ChatGPT or Gemini from selected catalog products.
 * CRITICAL: Runs 100% locally from stored catalog data—never triggers an AI API call.
 * Includes only populated fields and never emits empty placeholder lines for missing values.
 */
export function generateProductBrief(
  selectedProducts: Product[],
  options: BriefGenerationOptions
): string {
  const { target, guideTopic, additionalContext } = options;

  const assistantHeader =
    target === 'chatgpt'
      ? '# GIFT GUIDE PRODUCT BRIEF (FOR CHATGPT)'
      : '# GIFT GUIDE PRODUCT BRIEF (FOR GEMINI)';

  const assistantSpecificNote =
    target === 'chatgpt'
      ? '- Format your response as clean, production-ready Fourthwall HTML fragments (or structured prose as requested) without inventing unverified product attributes.'
      : '- Ground every product claim strictly in the structured blocks below and preserve all Fourthwall `/products/...` or canonical URLs verbatim.';

  const lines: string[] = [
    assistantHeader,
    '',
    '## INSTRUCTIONS FOR THE AI ASSISTANT',
    '- Treat product URLs as the canonical destination links.',
    '- Use the supplied titles and facts accurately.',
    '- Do not invent prices, materials, dimensions, specifications, or availability.',
    '- Preserve the exact product URLs when inserting links.',
    '- Use descriptions and notes as reference information, not as mandatory marketing copy.',
    '- If the task requires information that is missing, ask for it or avoid making the claim.',
    assistantSpecificNote,
  ];

  if (guideTopic && guideTopic.trim()) {
    lines.push('', `## TARGET GUIDE TOPIC: ${guideTopic.trim()}`);
  }
  if (additionalContext && additionalContext.trim()) {
    lines.push('', `## EDITORIAL DIRECTION: ${additionalContext.trim()}`);
  }

  selectedProducts.forEach((prod, index) => {
    lines.push('', `PRODUCT ${index + 1}`);

    const cleanTitle = (prod.name || '').trim();
    if (cleanTitle) {
      lines.push(`- Title: ${cleanTitle}`);
    }

    const cleanUrl = (prod.productUrl || '').trim();
    if (cleanUrl) {
      lines.push(`- Product URL: ${cleanUrl}`);
    }

    const cleanPrice = (prod.price || '').trim();
    if (cleanPrice && cleanPrice.toLowerCase() !== 'unavailable') {
      const curr = (prod.currency || '').trim();
      const priceWithCurrency = curr && !cleanPrice.includes(curr) ? `${cleanPrice} (${curr})` : cleanPrice;
      lines.push(`- Current price and currency: ${priceWithCurrency}`);
    }

    const cleanOriginalPrice = (prod.originalPrice || '').trim();
    if (cleanOriginalPrice && cleanOriginalPrice !== cleanPrice) {
      lines.push(`- Original price: ${cleanOriginalPrice}`);
    }

    const cleanDesc = (prod.shortDescription || '').trim();
    if (cleanDesc) {
      lines.push(`- Description: ${cleanDesc}`);
    }

    const cleanCat = (prod.category || '').trim();
    const cleanType = (prod.productType || '').trim();
    if (cleanCat && cleanCat.toLowerCase() !== 'general') {
      lines.push(
        `- Category: ${cleanType && cleanType.toLowerCase() !== 'general' ? `${cleanCat} (${cleanType})` : cleanCat}`
      );
    } else if (cleanType && cleanType.toLowerCase() !== 'general') {
      lines.push(`- Category: ${cleanType}`);
    }

    const cleanSku = (prod.sku || '').trim();
    if (cleanSku) {
      lines.push(`- SKU: ${cleanSku}`);
    }

    const allImages = Array.from(
      new Set([
        ...(prod.imageUrl ? [prod.imageUrl.trim()] : []),
        ...((prod.imageUrls || []).map((u) => u.trim())),
      ])
    ).filter(Boolean);

    if (allImages.length > 0) {
      lines.push(`- Image URLs: ${allImages.join(', ')}`);
    }

    if (Array.isArray(prod.variants) && prod.variants.length > 0) {
      const formattedVariants = prod.variants
        .map((v) => {
          const parts = [v.title];
          if (v.price) parts.push(v.price);
          if (v.sku) parts.push(`SKU: ${v.sku}`);
          if (v.available === false) parts.push('Out of stock');
          return parts.join(' — ');
        })
        .join(' | ');
      if (formattedVariants) {
        lines.push(`- Variants: ${formattedVariants}`);
      }
    }

    const cleanSpecs = (prod.featuresSpecs || '').trim();
    if (cleanSpecs) {
      lines.push(`- Specifications: ${cleanSpecs}`);
    }

    const cleanNotes = (prod.sourceNotes || '').trim();
    const cleanTags = (prod.tags || []).filter(Boolean);
    if (cleanNotes || cleanTags.length > 0) {
      const noteParts: string[] = [];
      if (cleanNotes) noteParts.push(cleanNotes);
      if (cleanTags.length > 0) noteParts.push(`Tags: ${cleanTags.join(', ')}`);
      lines.push(`- Custom notes: ${noteParts.join(' | ')}`);
    }
  });

  return lines.join('\n').trim() + '\n';
}
