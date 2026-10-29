import { Product } from '../types/cms';

export interface ParsedProductRow {
  rowNumber: number;
  rawText: string;
  valid: boolean;
  errors: string[];
  product?: Omit<Product, 'ownerId' | 'createdAt' | 'updatedAt'>;
}

export interface ProductImportReport {
  totalRows: number;
  validProducts: Array<Omit<Product, 'ownerId' | 'createdAt' | 'updatedAt'>>;
  invalidRows: ParsedProductRow[];
}

/**
 * Splits a single CSV line respecting quoted fields and escaped quotes.
 */
function parseCsvLine(line: string, delimiter = ','): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Validates a product URL (either a Fourthwall relative path like `/products/...` or a full `https://...` URL).
 * Preserves the exact user-supplied slug without rewriting it.
 */
export function isValidProductUrl(url: string): boolean {
  const trimmed = (url || '').trim();
  if (!trimmed || trimmed.length > 1000) return false;
  if (trimmed.startsWith('/')) {
    return /^\/[a-zA-Z0-9\-._~%!$&'()*+,;=:@/]+$/.test(trimmed);
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validates and normalizes a price display string (e.g., "24.90" -> "$24.90", "$19.90" -> "$19.90").
 */
export function normalizePriceDisplay(rawPrice: string): { valid: boolean; formatted: string } {
  const trimmed = (rawPrice || '').trim();
  if (!trimmed) return { valid: false, formatted: '' };
  const numericMatch = trimmed.match(/^\$?\s*(\d+(?:\.\d{1,2})?)$/);
  if (!numericMatch) {
    return { valid: false, formatted: trimmed };
  }
  const num = Number(numericMatch[1]);
  if (Number.isNaN(num) || num < 0 || num > 100000) {
    return { valid: false, formatted: trimmed };
  }
  return { valid: true, formatted: `$${num.toFixed(2)}` };
}

/**
 * Generates a deterministic stable product ID from its URL slug or name.
 */
export function deriveStableProductId(productUrl: string, name: string, fallbackIndex: number): string {
  const slugMatch = productUrl.match(/\/products\/([a-zA-Z0-9\-_]+)/);
  const rawBase = slugMatch ? slugMatch[1] : name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const cleaned = rawBase.replace(/^-+|-+$/g, '').slice(0, 80);
  return cleaned ? `prod-${cleaned}` : `prod-item-${fallbackIndex}`;
}

/**
 * Parses either a CSV file/paste or a pipe/tab-separated product roster list.
 * Supported column headers (case-insensitive) or positional order:
 * name, productUrl (or url/link), price, productType (or type), category, shortDescription, featuresSpecs, imageUrl, tags
 */
export function parseProductImportBatch(rawInput: string): ProductImportReport {
  const lines = (rawInput || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { totalRows: 0, validProducts: [], invalidRows: [] };
  }

  // Detect delimiter (pipe, tab, or comma)
  const firstLine = lines[0];
  const delimiter = firstLine.includes('\t')
    ? '\t'
    : firstLine.includes('|') && !firstLine.includes(',')
    ? '|'
    : ',';

  const firstTokens = parseCsvLine(firstLine, delimiter).map((t) =>
    t.toLowerCase().replace(/[^a-z0-9]/g, '')
  );

  const knownHeaders = [
    'name',
    'title',
    'productname',
    'url',
    'producturl',
    'link',
    'price',
    'type',
    'producttype',
    'category',
  ];
  const hasHeaderRow = firstTokens.some((t) => knownHeaders.includes(t));

  const headerMap: Record<string, number> = {};
  if (hasHeaderRow) {
    firstTokens.forEach((h, idx) => {
      headerMap[h] = idx;
    });
  }

  const dataLines = hasHeaderRow ? lines.slice(1) : lines;
  const validProducts: Array<Omit<Product, 'ownerId' | 'createdAt' | 'updatedAt'>> = [];
  const invalidRows: ParsedProductRow[] = [];

  dataLines.forEach((line, idx) => {
    const rowNumber = hasHeaderRow ? idx + 2 : idx + 1;
    const cols = parseCsvLine(line, delimiter);
    const errors: string[] = [];

    const getCol = (names: string[], fallbackPos: number): string => {
      if (hasHeaderRow) {
        for (const n of names) {
          if (headerMap[n] !== undefined && cols[headerMap[n]] !== undefined) {
            return cols[headerMap[n]].trim();
          }
        }
        return '';
      }
      return (cols[fallbackPos] || '').trim();
    };

    const name = getCol(['name', 'title', 'productname'], 0);
    const productUrl = getCol(['producturl', 'url', 'link', 'href'], 1);
    const rawPrice = getCol(['price', 'cost'], 2);
    const productType = getCol(['producttype', 'type'], 3) || 'Apparel & Goods';
    const category = getCol(['category', 'deity', 'theme', 'era'], 4) || 'General';
    const shortDescription = getCol(['shortdescription', 'description', 'summary'], 5);
    const featuresSpecs = getCol(['featuresspecs', 'specs', 'features', 'specifications'], 6);
    const imageUrl = getCol(['imageurl', 'image', 'img'], 7);
    const rawTags = getCol(['tags', 'keywords'], 8);

    if (!name) {
      errors.push('Missing product name.');
    }
    if (!productUrl) {
      errors.push('Missing product URL.');
    } else if (!isValidProductUrl(productUrl)) {
      errors.push(`Invalid product URL "${productUrl}". Use a relative path (/products/...) or full https:// URL.`);
    }

    const priceCheck = normalizePriceDisplay(rawPrice);
    if (!rawPrice) {
      errors.push('Missing price.');
    } else if (!priceCheck.valid) {
      errors.push(`Invalid price "${rawPrice}". Expected format like $24.90 or 24.90.`);
    }

    if (errors.length > 0) {
      invalidRows.push({
        rowNumber,
        rawText: line,
        valid: false,
        errors,
      });
      return;
    }

    const tags = rawTags
      ? rawTags
          .split(/[;|,]/)
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 20)
      : [category.toLowerCase(), productType.toLowerCase()].filter(Boolean);

    validProducts.push({
      id: deriveStableProductId(productUrl, name, rowNumber),
      name: name.slice(0, 300),
      productUrl: productUrl.slice(0, 1000),
      imageUrl: imageUrl.slice(0, 2000),
      price: priceCheck.formatted,
      currency: 'USD',
      productType: productType.slice(0, 120),
      category: category.slice(0, 120),
      tags,
      shortDescription: shortDescription.slice(0, 2000),
      featuresSpecs: featuresSpecs.slice(0, 3000),
      sourceNotes: 'Imported via Roster / CSV tool',
      archived: false,
    });
  });

  return {
    totalRows: dataLines.length,
    validProducts,
    invalidRows,
  };
}
