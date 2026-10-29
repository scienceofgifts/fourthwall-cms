import { FAQItem, GiftGuide, GuideSection, Product, ValidationIssue } from '../types/cms';
import { extractCanonicalFaqsFromSections } from './htmlRenderer';

/**
 * Strips HTML tags from an answer string for clean plain-text or schema text representation,
 * while preserving readable spacing and entity decoding.
 */
export function stripHtmlToText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolves a potentially relative Fourthwall URL (/products/...) against the configured site base URL.
 */
export function resolveFullUrl(baseUrl: string, pathOrUrl: string): string {
  const cleanPath = (pathOrUrl || '').trim();
  if (!cleanPath) return '';
  if (/^https?:\/\//i.test(cleanPath)) {
    return cleanPath;
  }
  const cleanBase = (baseUrl || 'https://scienceofgifts.com').trim().replace(/\/+$/, '');
  const normalizedPath = cleanPath.startsWith('/') ? cleanPath : `/${cleanPath}`;
  return `${cleanBase}${normalizedPath}`;
}

/**
 * Extracts a numeric price string (e.g., "24.90" from "$24.90") for Schema.org Offer compatibility.
 */
export function extractNumericPrice(priceStr: string): string {
  const match = (priceStr || '').match(/\d+(?:\.\d{1,2})?/);
  return match ? match[0] : '0.00';
}

export interface GeneratedSchemaResult {
  jsonObject: Record<string, unknown>;
  formattedJson: string;
  scriptBlock: string;
  validationIssues: ValidationIssue[];
}

/**
 * Deterministically builds and validates the unified @graph JSON-LD schema
 * containing BreadcrumbList, ItemList, and FAQPage.
 */
export function generateGuideJsonLd(
  guide: GiftGuide,
  sections: GuideSection[],
  products: Product[],
  explicitFaqOverride?: FAQItem[]
): GeneratedSchemaResult {
  const issues: ValidationIssue[] = [];
  const schemaCfg = guide.schemaConfig || {
    siteBaseUrl: guide.storeBaseUrl || 'https://scienceofgifts.com',
    breadcrumbs: [],
    itemListName: guide.title,
    itemListDescription: guide.introText,
    includedProductIds: [],
  };

  const baseUrl = (schemaCfg.siteBaseUrl || guide.storeBaseUrl || 'https://scienceofgifts.com')
    .trim()
    .replace(/\/+$/, '');
  const canonicalUrl = (guide.canonicalUrl || `${baseUrl}/pages/${guide.slug || 'gift-guide'}`).trim();

  if (!/^https?:\/\/.+/i.test(baseUrl)) {
    issues.push({
      severity: 'error',
      code: 'INVALID_BASE_URL',
      message: `Site base URL "${baseUrl}" must be a valid absolute http(s) URL.`,
      field: 'siteBaseUrl',
    });
  }

  if (!/^https?:\/\/.+/i.test(canonicalUrl)) {
    issues.push({
      severity: 'error',
      code: 'INVALID_CANONICAL_URL',
      message: `Canonical guide URL "${canonicalUrl}" must be a valid absolute http(s) URL.`,
      field: 'canonicalUrl',
    });
  }

  // 1. BreadcrumbList
  const rawBreadcrumbs =
    schemaCfg.breadcrumbs && schemaCfg.breadcrumbs.length > 0
      ? schemaCfg.breadcrumbs
      : [
          { id: 'bc-home', name: 'Home', url: `${baseUrl}/` },
          { id: 'bc-guide', name: guide.title, url: canonicalUrl },
        ];

  const breadcrumbItemListElement = rawBreadcrumbs.map((bc, idx) => {
    const resolvedItemUrl = resolveFullUrl(baseUrl, bc.url);
    if (!bc.name?.trim()) {
      issues.push({
        severity: 'error',
        code: 'EMPTY_BREADCRUMB_NAME',
        message: `Breadcrumb at position ${idx + 1} is missing a label.`,
        field: 'breadcrumbs',
      });
    }
    if (!/^https?:\/\/.+/i.test(resolvedItemUrl)) {
      issues.push({
        severity: 'error',
        code: 'INVALID_BREADCRUMB_URL',
        message: `Breadcrumb "${bc.name || idx + 1}" has an invalid URL "${bc.url}".`,
        field: 'breadcrumbs',
      });
    }
    return {
      '@type': 'ListItem',
      position: idx + 1,
      name: (bc.name || '').trim(),
      item: resolvedItemUrl,
    };
  });

  const breadcrumbNode = {
    '@type': 'BreadcrumbList',
    '@id': `${canonicalUrl}#breadcrumb`,
    itemListElement: breadcrumbItemListElement,
  };

  // 2. ItemList (Selected Featured Products)
  const productsMap = new Map<string, Product>(products.map((p) => [p.id, p]));
  const seenProdIds = new Set<string>();
  const includedProducts: Product[] = [];

  for (const pid of schemaCfg.includedProductIds || []) {
    if (seenProdIds.has(pid)) {
      issues.push({
        severity: 'warning',
        code: 'DUPLICATE_SCHEMA_PRODUCT',
        message: `Product ID "${pid}" was listed multiple times in schema inclusion; deduplicated automatically.`,
        field: 'includedProductIds',
      });
      continue;
    }
    seenProdIds.add(pid);
    const found = productsMap.get(pid);
    if (!found) {
      issues.push({
        severity: 'warning',
        code: 'MISSING_SCHEMA_PRODUCT',
        message: `Selected schema product ID "${pid}" no longer exists in the Product Library.`,
        field: 'includedProductIds',
      });
      continue;
    }
    includedProducts.push(found);
  }

  if (includedProducts.length === 0) {
    issues.push({
      severity: 'warning',
      code: 'EMPTY_ITEM_LIST',
      message: 'No products are currently selected for the ItemList schema.',
      field: 'includedProductIds',
    });
  }

  const itemListElements = includedProducts.map((prod, idx) => {
    const fullProdUrl = resolveFullUrl(baseUrl, prod.productUrl);
    if (!/^https?:\/\/.+/i.test(fullProdUrl)) {
      issues.push({
        severity: 'error',
        code: 'INVALID_PRODUCT_SCHEMA_URL',
        message: `Product "${prod.name}" resolved to an invalid URL "${fullProdUrl}".`,
        field: 'includedProductIds',
      });
    }

    const numericPrice = extractNumericPrice(prod.price);
    const productSchemaItem: Record<string, unknown> = {
      '@type': 'Product',
      name: prod.name,
      url: fullProdUrl,
      description: prod.shortDescription || prod.featuresSpecs || prod.name,
      offers: {
        '@type': 'Offer',
        url: fullProdUrl,
        priceCurrency: prod.currency || 'USD',
        price: numericPrice,
        availability: 'https://schema.org/InStock',
      },
    };

    if (prod.imageUrl?.trim()) {
      productSchemaItem.image = resolveFullUrl(baseUrl, prod.imageUrl);
    }

    return {
      '@type': 'ListItem',
      position: idx + 1,
      item: productSchemaItem,
    };
  });

  const itemListNode = {
    '@type': 'ItemList',
    '@id': `${canonicalUrl}#itemlist`,
    name: (schemaCfg.itemListName || guide.title).trim(),
    description: (schemaCfg.itemListDescription || guide.introText || '').trim(),
    url: canonicalUrl,
    numberOfItems: itemListElements.length,
    itemListOrder: 'https://schema.org/ItemListOrderAscending',
    itemListElement: itemListElements,
  };

  // 3. FAQPage (Strictly synchronized with visible FAQ section content)
  const canonicalFaqs = explicitFaqOverride ?? extractCanonicalFaqsFromSections(sections);
  if (canonicalFaqs.length === 0) {
    issues.push({
      severity: 'warning',
      code: 'EMPTY_FAQ_SCHEMA',
      message: 'No visible FAQ items found in enabled sections to populate FAQPage schema.',
      field: 'faqItems',
    });
  }

  const faqMainEntity = [...canonicalFaqs]
    .sort((a, b) => a.order - b.order)
    .map((faq, idx) => {
      const cleanQ = (faq.question || '').trim();
      const cleanA = stripHtmlToText(faq.answerHtml || '');
      if (!cleanQ || !cleanA) {
        issues.push({
          severity: 'error',
          code: 'INCOMPLETE_FAQ_ITEM',
          message: `FAQ #${idx + 1} (${faq.badge || idx + 1}) is missing a question or answer text.`,
          field: 'faqItems',
        });
      }
      return {
        '@type': 'Question',
        name: cleanQ,
        acceptedAnswer: {
          '@type': 'Answer',
          text: cleanA,
        },
      };
    });

  const faqPageNode = {
    '@type': 'FAQPage',
    '@id': `${canonicalUrl}#faq`,
    mainEntity: faqMainEntity,
  };

  const jsonObject = {
    '@context': 'https://schema.org',
    '@graph': [breadcrumbNode, itemListNode, faqPageNode],
  };

  // Escape closing script tags if any exist inside text
  const formattedJson = JSON.stringify(jsonObject, null, 2).replace(/<\//g, '<\\/');
  const scriptBlock = `<script type="application/ld+json">\n${formattedJson}\n</script>`;

  return {
    jsonObject,
    formattedJson,
    scriptBlock,
    validationIssues: issues,
  };
}
