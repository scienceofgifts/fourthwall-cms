import { ProductVariant } from '../types/cms';

export interface ExtractedProductData {
  name: string;
  productUrl: string;
  price: string;
  originalPrice: string;
  currency: string;
  shortDescription: string;
  imageUrl: string;
  imageUrls: string[];
  category: string;
  productType: string;
  sku: string;
  featuresSpecs: string;
  variants: ProductVariant[];
  tags: string[];
  dataSource: 'json_ld' | 'open_graph' | 'html_meta' | 'ai_fallback' | 'manual';
  fetchStatus: 'success' | 'partial' | 'failed';
  warnings: string[];
}

/**
 * Checks whether a hostname or IP string points to a private, loopback, or internal network.
 * Used for SSRF protection before making server-side HTTP requests.
 */
export function isPrivateOrInternalHost(hostname: string): boolean {
  const clean = (hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!clean) return true;

  if (
    clean === 'localhost' ||
    clean === '0.0.0.0' ||
    clean === '::1' ||
    clean.endsWith('.localhost') ||
    clean.endsWith('.local') ||
    clean.endsWith('.internal') ||
    clean.endsWith('.nip.io') ||
    clean === 'metadata.google.internal'
  ) {
    return true;
  }

  // IPv4 private / loopback / link-local checks
  const ipv4Match = clean.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, aStr, bStr] = ipv4Match;
    const a = Number(aStr);
    const b = Number(bStr);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true;
  }

  // IPv6 loopback / link-local / unique-local checks
  if (clean.includes(':')) {
    if (
      clean === '::' ||
      clean === '::1' ||
      clean.startsWith('fe80:') ||
      clean.startsWith('fc') ||
      clean.startsWith('fd') ||
      clean.startsWith('::ffff:127.') ||
      clean.startsWith('::ffff:10.') ||
      clean.startsWith('::ffff:192.168.')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Validates that a URL is a safe public HTTP/HTTPS URL suitable for product fetching.
 */
export function validateFetchableProductUrl(rawUrl: string): {
  valid: boolean;
  normalizedUrl?: string;
  error?: string;
} {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) {
    return { valid: false, error: 'Please enter a product URL.' };
  }
  if (trimmed.length > 2000) {
    return { valid: false, error: 'URL exceeds maximum length of 2000 characters.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      valid: false,
      error: 'Invalid URL format. Enter a full public URL starting with https:// or http://.',
    };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return {
      valid: false,
      error: `Unsupported URL scheme "${parsed.protocol}". Only http: and https: are allowed.`,
    };
  }

  if (parsed.username || parsed.password) {
    return {
      valid: false,
      error: 'URLs containing embedded credentials are not allowed.',
    };
  }

  if (isPrivateOrInternalHost(parsed.hostname)) {
    return {
      valid: false,
      error: 'Fetching from private, loopback, or internal network addresses is blocked.',
    };
  }

  return { valid: true, normalizedUrl: parsed.toString() };
}

/**
 * Decodes common HTML entities in extracted metadata strings.
 */
export function decodeHtmlEntities(input: string): string {
  if (!input) return '';
  return String(input)
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_m, code) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCharCode(n) : _m;
    })
    .trim();
}

function stripTags(html: string): string {
  if (!html) return '';
  return decodeHtmlEntities(
    html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|li|div|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n+/g, '\n')
      .trim()
  );
}

/**
 * Formats a price value without inventing missing values.
 * Distinguishes an empty/missing price ("") from a confirmed zero price ("$0.00").
 */
export function formatExtractedPrice(
  rawAmount: string | number | undefined | null,
  currency = 'USD'
): string {
  if (rawAmount === undefined || rawAmount === null) return '';
  const str = String(rawAmount).trim();
  if (!str) return '';

  // If already formatted with a currency symbol and digits
  const numericMatch = str.replace(/,/g, '').match(/^([£€$¥])?\s*(\d+(?:\.\d{1,2})?)$/);
  if (numericMatch) {
    const symbol =
      numericMatch[1] ||
      (currency.toUpperCase() === 'EUR'
        ? '€'
        : currency.toUpperCase() === 'GBP'
        ? '£'
        : '$');
    const num = Number(numericMatch[2]);
    if (!Number.isNaN(num)) {
      return `${symbol}${num.toFixed(2)}`;
    }
  }
  return str.slice(0, 50);
}

function resolveRelativeUrl(candidate: string, baseUrl: string): string {
  const trimmed = (candidate || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('//')) {
    return `https:${trimmed}`;
  }
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return trimmed;
  }
}

/**
 * Recursively collects all Schema.org Product objects from JSON-LD payloads.
 */
function findProductNodesInJsonLd(node: unknown): Record<string, any>[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) {
    return node.flatMap((item) => findProductNodesInJsonLd(item));
  }
  const obj = node as Record<string, any>;
  const results: Record<string, any>[] = [];

  const rawType = obj['@type'];
  const types = Array.isArray(rawType) ? rawType : rawType ? [rawType] : [];
  if (
    types.some(
      (t) =>
        typeof t === 'string' &&
        (t === 'Product' || t === 'ProductGroup' || t.endsWith('/Product'))
    )
  ) {
    results.push(obj);
  }

  if (Array.isArray(obj['@graph'])) {
    results.push(...findProductNodesInJsonLd(obj['@graph']));
  }
  if (obj.mainEntity) {
    results.push(...findProductNodesInJsonLd(obj.mainEntity));
  }

  return results;
}

/**
 * Extracts structured product information from raw HTML and its canonical/source URL.
 * Purely deterministic—does not invent missing fields.
 */
export function extractProductFromHtml(
  html: string,
  sourceUrl: string
): ExtractedProductData {
  const warnings: string[] = [];
  let name = '';
  let productUrl = sourceUrl;
  let price = '';
  let originalPrice = '';
  let currency = '';
  let shortDescription = '';
  const imageSet = new Set<string>();
  let category = '';
  let productType = '';
  let sku = '';
  const specsList: string[] = [];
  const variants: ProductVariant[] = [];
  const tagsSet = new Set<string>();
  let dataSource: ExtractedProductData['dataSource'] = 'html_meta';

  // 1. Parse Meta tags (Open Graph, Product, Twitter, Standard)
  const metaMap = new Map<string, string>();
  const metaImages: string[] = [];
  const metaRegex = /<meta\b[^>]*>/gi;
  let metaMatch: RegExpExecArray | null;
  while ((metaMatch = metaRegex.exec(html)) !== null) {
    const tag = metaMatch[0];
    const propMatch = tag.match(/(?:property|name|itemprop)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
    const contentMatch = tag.match(/content\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const key = (propMatch?.[1] || propMatch?.[2] || propMatch?.[3] || '').toLowerCase().trim();
    const val = decodeHtmlEntities(
      contentMatch?.[1] ?? contentMatch?.[2] ?? contentMatch?.[3] ?? ''
    );
    if (!key || !val) continue;
    if (key === 'og:image' || key === 'og:image:secure_url' || key === 'twitter:image') {
      metaImages.push(resolveRelativeUrl(val, sourceUrl));
    }
    if (!metaMap.has(key)) {
      metaMap.set(key, val);
    }
  }

  // Canonical link check
  const canonicalMatch = html.match(
    /<link\b[^>]*rel\s*=\s*(?:"canonical"|'canonical')[^>]*href\s*=\s*(?:"([^"]+)"|'([^']+)')/i
  );
  if (canonicalMatch) {
    const canon = canonicalMatch[1] || canonicalMatch[2];
    if (canon) {
      productUrl = resolveRelativeUrl(decodeHtmlEntities(canon), sourceUrl);
    }
  } else if (metaMap.get('og:url')) {
    productUrl = resolveRelativeUrl(metaMap.get('og:url')!, sourceUrl);
  }

  // 2. Parse JSON-LD `<script type="application/ld+json">`
  const jsonLdRegex =
    /<script\b[^>]*type\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json')[^>]*>([\s\S]*?)<\/script>/gi;
  let ldMatch: RegExpExecArray | null;
  const productLdNodes: Record<string, any>[] = [];

  while ((ldMatch = jsonLdRegex.exec(html)) !== null) {
    const rawJson = (ldMatch[1] || '').trim();
    if (!rawJson) continue;
    try {
      const parsed = JSON.parse(rawJson);
      productLdNodes.push(...findProductNodesInJsonLd(parsed));
    } catch {
      // Some storefronts include trailing commas or comments in JSON-LD; ignore malformed block
    }
  }

  if (productLdNodes.length > 0) {
    dataSource = 'json_ld';
    const primary = productLdNodes[0];

    if (typeof primary.name === 'string' && primary.name.trim()) {
      name = decodeHtmlEntities(primary.name.trim());
    }
    if (typeof primary.description === 'string' && primary.description.trim()) {
      shortDescription = stripTags(primary.description);
    }
    if (typeof primary.sku === 'string' && primary.sku.trim()) {
      sku = primary.sku.trim();
    } else if (typeof primary.mpn === 'string' && primary.mpn.trim()) {
      sku = primary.mpn.trim();
    } else if (typeof primary.productID === 'string' && primary.productID.trim()) {
      sku = primary.productID.trim();
    }

    if (typeof primary.category === 'string' && primary.category.trim()) {
      category = decodeHtmlEntities(primary.category.trim());
    }

    // Images from JSON-LD
    const rawImgs = Array.isArray(primary.image)
      ? primary.image
      : primary.image
      ? [primary.image]
      : [];
    for (const imgEntry of rawImgs) {
      if (typeof imgEntry === 'string' && imgEntry.trim()) {
        imageSet.add(resolveRelativeUrl(imgEntry.trim(), sourceUrl));
      } else if (imgEntry && typeof imgEntry === 'object' && typeof imgEntry.url === 'string') {
        imageSet.add(resolveRelativeUrl(imgEntry.url.trim(), sourceUrl));
      }
    }

    // Offers & Variants from JSON-LD
    const rawOffers = primary.offers;
    const offersList: Record<string, any>[] = Array.isArray(rawOffers)
      ? rawOffers
      : rawOffers && typeof rawOffers === 'object'
      ? Array.isArray(rawOffers.offers)
        ? rawOffers.offers
        : [rawOffers]
      : [];

    // Also check hasVariant for ProductGroup
    const rawHasVariant = Array.isArray(primary.hasVariant) ? primary.hasVariant : [];
    for (const vNode of rawHasVariant) {
      if (vNode && typeof vNode === 'object') {
        const vOffer = Array.isArray(vNode.offers) ? vNode.offers[0] : vNode.offers;
        const vCurrency = vOffer?.priceCurrency || currency || 'USD';
        const vPrice = formatExtractedPrice(vOffer?.price, vCurrency);
        variants.push({
          id: String(vNode.sku || vNode['@id'] || `var-${variants.length + 1}`),
          title: decodeHtmlEntities(String(vNode.name || vNode.sku || `Variant ${variants.length + 1}`)),
          price: vPrice || undefined,
          sku: typeof vNode.sku === 'string' ? vNode.sku : undefined,
          available:
            typeof vOffer?.availability === 'string'
              ? !vOffer.availability.toLowerCase().includes('outofstock')
              : undefined,
        });
      }
    }

    if (offersList.length > 0) {
      const firstOffer = offersList[0];
      const offerCurrency =
        firstOffer.priceCurrency ||
        (rawOffers && !Array.isArray(rawOffers) ? rawOffers.priceCurrency : '') ||
        '';
      if (offerCurrency) {
        currency = String(offerCurrency).toUpperCase().slice(0, 10);
      }

      const rawPrimaryPrice =
        firstOffer.price ??
        firstOffer.lowPrice ??
        (rawOffers && !Array.isArray(rawOffers) ? rawOffers.price ?? rawOffers.lowPrice : undefined);

      if (rawPrimaryPrice !== undefined && rawPrimaryPrice !== null && String(rawPrimaryPrice).trim() !== '') {
        price = formatExtractedPrice(rawPrimaryPrice, currency || 'USD');
      }

      // If multiple offers exist and variants array is still empty, record them as variants
      if (offersList.length > 1 && variants.length === 0) {
        const distinctPrices = new Set<string>();
        offersList.forEach((off, idx) => {
          const offCurrency = off.priceCurrency || currency || 'USD';
          const offPrice = formatExtractedPrice(off.price, offCurrency);
          if (offPrice) distinctPrices.add(offPrice);
          const vTitle = decodeHtmlEntities(
            String(off.name || off.sku || off.itemOffered?.name || `Option ${idx + 1}`)
          );
          variants.push({
            id: String(off.sku || `offer-${idx + 1}`),
            title: vTitle,
            price: offPrice || undefined,
            sku: typeof off.sku === 'string' ? off.sku : undefined,
            available:
              typeof off.availability === 'string'
                ? !off.availability.toLowerCase().includes('outofstock')
                : undefined,
          });
        });
        if (distinctPrices.size > 1) {
          warnings.push(
            `Multiple variant prices detected (${Array.from(distinctPrices).join(', ')}). Variant-specific pricing has been preserved separately.`
          );
        }
      }
    }

    // Additional properties in JSON-LD
    if (Array.isArray(primary.additionalProperty)) {
      for (const prop of primary.additionalProperty) {
        if (prop && prop.name && prop.value) {
          specsList.push(`${decodeHtmlEntities(String(prop.name))}: ${decodeHtmlEntities(String(prop.value))}`);
        }
      }
    }
  }

  // 3. Open Graph & Product Meta Fallbacks (only fill fields that are still empty)
  if (!name) {
    const ogTitle = metaMap.get('og:title') || metaMap.get('twitter:title');
    if (ogTitle) {
      name = ogTitle.replace(/\s*[|\-–—]\s*[^|\-–—]+$/, '').trim() || ogTitle;
      if (dataSource === 'html_meta') dataSource = 'open_graph';
    }
  }

  if (!name) {
    const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch?.[1]) {
      const rawTitle = decodeHtmlEntities(titleMatch[1]);
      name = rawTitle.replace(/\s*[|\-–—]\s*[^|\-–—]+$/, '').trim() || rawTitle;
    }
  }

  if (!shortDescription) {
    const ogDesc =
      metaMap.get('og:description') ||
      metaMap.get('description') ||
      metaMap.get('twitter:description');
    if (ogDesc) {
      shortDescription = ogDesc;
      if (dataSource === 'html_meta' && metaMap.has('og:description')) {
        dataSource = 'open_graph';
      }
    }
  }

  if (!currency) {
    const metaCurr =
      metaMap.get('product:price:currency') ||
      metaMap.get('og:price:currency') ||
      metaMap.get('twitter:data2');
    if (metaCurr && /^[A-Z]{3}$/i.test(metaCurr.trim())) {
      currency = metaCurr.trim().toUpperCase();
    }
  }

  if (!price) {
    const metaPrice =
      metaMap.get('product:price:amount') ||
      metaMap.get('og:price:amount') ||
      metaMap.get('price');
    if (metaPrice !== undefined && metaPrice.trim() !== '') {
      price = formatExtractedPrice(metaPrice, currency || 'USD');
      if (dataSource === 'html_meta') dataSource = 'open_graph';
    }
  }

  const metaOrigPrice =
    metaMap.get('product:original_price:amount') ||
    metaMap.get('product:sale_price:amount');
  if (metaOrigPrice && !originalPrice) {
    const formattedOrig = formatExtractedPrice(metaOrigPrice, currency || 'USD');
    if (formattedOrig && formattedOrig !== price) {
      originalPrice = formattedOrig;
    }
  }

  if (!originalPrice) {
    const compareMatch = html.match(
      /<(?:span|del|s|div)\b[^>]*class\s*=\s*["'][^"']*(?:compare-at-price|original-price|was-price)[^"']*["'][^>]*>([\s\S]*?)<\/(?:span|del|s|div)>/i
    );
    if (compareMatch?.[1]) {
      const formattedCompare = formatExtractedPrice(
        decodeHtmlEntities(compareMatch[1]),
        currency || 'USD'
      );
      if (formattedCompare && formattedCompare !== price) {
        originalPrice = formattedCompare;
      }
    }
  }

  if (!category) {
    category =
      metaMap.get('product:category') ||
      metaMap.get('og:type') === 'product'
        ? metaMap.get('product:category') || ''
        : '';
  }

  if (!sku) {
    sku = metaMap.get('product:retailer_item_id') || metaMap.get('sku') || '';
  }

  for (const mImg of metaImages) {
    if (mImg) imageSet.add(mImg);
  }

  // 4. Check for Fourthwall / Shopify embedded product JSON scripts if variants or specs are still sparse
  const productJsonScriptRegex =
    /<script\b[^>]*(?:id|data-product-json|type)\s*=\s*["'][^"']*json[^"']*["'][^>]*>([\s\S]*?)<\/script>/gi;
  let pjMatch: RegExpExecArray | null;
  while ((pjMatch = productJsonScriptRegex.exec(html)) !== null) {
    const body = (pjMatch[1] || '').trim();
    if (!body.startsWith('{') || body.length > 500_000) continue;
    try {
      const parsed = JSON.parse(body);
      const prodObj = parsed?.product || (parsed?.title && parsed?.variants ? parsed : null);
      if (prodObj && typeof prodObj === 'object') {
        if (!name && typeof prodObj.title === 'string') {
          name = decodeHtmlEntities(prodObj.title);
        }
        if (!productType && typeof prodObj.product_type === 'string' && prodObj.product_type.trim()) {
          productType = decodeHtmlEntities(prodObj.product_type.trim());
        }
        if (Array.isArray(prodObj.tags)) {
          prodObj.tags.forEach((t: unknown) => {
            if (typeof t === 'string' && t.trim()) tagsSet.add(t.trim());
          });
        }
        if (Array.isArray(prodObj.images)) {
          prodObj.images.forEach((img: unknown) => {
            if (typeof img === 'string') imageSet.add(resolveRelativeUrl(img, sourceUrl));
            else if (img && typeof img === 'object' && typeof (img as any).src === 'string') {
              imageSet.add(resolveRelativeUrl((img as any).src, sourceUrl));
            }
          });
        }
        if (Array.isArray(prodObj.variants) && variants.length === 0) {
          prodObj.variants.forEach((v: any, idx: number) => {
            if (!v || typeof v !== 'object') return;
            const rawVPrice =
              typeof v.price === 'number' && v.price > 100 && !String(v.price).includes('.')
                ? (v.price / 100).toFixed(2)
                : v.price;
            const rawCompare =
              typeof v.compare_at_price === 'number' &&
              v.compare_at_price > 100 &&
              !String(v.compare_at_price).includes('.')
                ? (v.compare_at_price / 100).toFixed(2)
                : v.compare_at_price;
            const vFormattedPrice = formatExtractedPrice(rawVPrice, currency || 'USD');
            const vFormattedOrig = formatExtractedPrice(rawCompare, currency || 'USD');
            if (!price && vFormattedPrice) price = vFormattedPrice;
            if (!originalPrice && vFormattedOrig && vFormattedOrig !== vFormattedPrice) {
              originalPrice = vFormattedOrig;
            }
            variants.push({
              id: String(v.id || v.sku || `var-${idx + 1}`),
              title: decodeHtmlEntities(String(v.title || v.name || `Variant ${idx + 1}`)),
              price: vFormattedPrice || undefined,
              originalPrice:
                vFormattedOrig && vFormattedOrig !== vFormattedPrice ? vFormattedOrig : undefined,
              sku: typeof v.sku === 'string' && v.sku.trim() ? v.sku.trim() : undefined,
              available: typeof v.available === 'boolean' ? v.available : undefined,
            });
          });
        }
      }
    } catch {
      // Ignore non-product JSON script blocks
    }
  }

  // 5. Extract bulleted specifications from HTML if `specsList` is still empty
  if (specsList.length === 0) {
    const ulMatches = html.match(/<ul\b[^>]*>([\s\S]*?)<\/ul>/gi) || [];
    for (const ul of ulMatches) {
      // Skip navigation menus
      if (/nav|menu|footer|header|social|breadcrumb/i.test(ul)) continue;
      const liMatches = ul.match(/<li\b[^>]*>([\s\S]*?)<\/li>/gi) || [];
      if (liMatches.length >= 2 && liMatches.length <= 12) {
        const cleanedLis = liMatches
          .map((li) => stripTags(li))
          .filter((txt) => txt.length >= 6 && txt.length <= 160 && !/^home|shop|cart|login$/i.test(txt));
        if (cleanedLis.length >= 2) {
          specsList.push(...cleanedLis.slice(0, 8));
          break;
        }
      }
    }
  }

  const imageUrls = Array.from(imageSet).filter(Boolean).slice(0, 12);
  const primaryImage = imageUrls[0] || '';
  const featuresSpecs = specsList.join(' • ').slice(0, 3000);

  if (!name) {
    warnings.push('Could not automatically detect the product title from page metadata.');
  }
  if (!price) {
    warnings.push('Price was not found in structured metadata. Leave blank or enter confirmed price manually.');
  }
  if (!primaryImage) {
    warnings.push('No product image URL was detected in metadata.');
  }

  const fetchStatus: ExtractedProductData['fetchStatus'] =
    name && price && primaryImage
      ? 'success'
      : name && (price || shortDescription || primaryImage)
      ? 'partial'
      : 'failed';

  return {
    name: name.slice(0, 300),
    productUrl: productUrl.slice(0, 1000),
    price,
    originalPrice,
    currency: currency || (price ? 'USD' : ''),
    shortDescription: shortDescription.slice(0, 2000),
    imageUrl: primaryImage,
    imageUrls,
    category: category.slice(0, 120),
    productType: productType.slice(0, 120),
    sku: sku.slice(0, 120),
    featuresSpecs,
    variants: variants.slice(0, 40),
    tags: Array.from(tagsSet).slice(0, 20),
    dataSource,
    fetchStatus,
    warnings,
  };
}
