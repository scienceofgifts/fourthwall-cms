import { Product } from '../types/cms';

export const LOCAL_MANAGED_CATEGORIES_KEY = 'sog_catalog_categories_v1';
export const LOCAL_MANAGED_PRODUCT_TYPES_KEY = 'sog_catalog_product_types_v1';

/**
 * Initial Category / Theme options for the Science of Gifts catalog.
 * Serving as starting options that can be extended and renamed by the user.
 */
export const INITIAL_PRODUCT_CATEGORIES: readonly string[] = [
  'General History',
  'American History',
  'World War II',
  'Civil War',
  'Ancient Rome',
  'Greek Mythology',
  'History Teachers',
  'Other',
] as const;

/**
 * Centralized Product Type options recognized across the Science of Gifts catalog.
 */
export const MANAGED_PRODUCT_TYPES: readonly string[] = [
  'T-Shirt',
  'Hoodie',
  'Sweatshirt',
  'Mug',
  'Water Bottle',
  'Tumbler',
  'Rocks Glass',
  'Beer Can Glass',
  'Whiskey Glass',
  'Poster',
  'Journal',
  'Notebook',
  'Tote Bag',
  'Desk Mat',
  'Laptop Sleeve',
  'Mouse Pad',
  'iPhone Case',
  'Cap',
  'Other',
] as const;

/**
 * Collapses repeated internal whitespace and trims leading/trailing whitespace.
 */
export function normalizeTaxonomyLabel(raw: string): string {
  return (raw || '').trim().replace(/\s+/g, ' ').slice(0, 120);
}

/**
 * Case-insensitive comparison key after collapsing whitespace.
 */
export function toTaxonomyKey(raw: string): string {
  return normalizeTaxonomyLabel(raw).toLowerCase();
}

/**
 * Finds an existing category in a list matching case-insensitively and ignoring extra whitespace.
 */
export function findCanonicalOption(
  candidate: string,
  options: readonly string[]
): string | undefined {
  const targetKey = toTaxonomyKey(candidate);
  if (!targetKey) return undefined;
  return options.find((opt) => toTaxonomyKey(opt) === targetKey);
}

/**
 * Deduplicates a list of category names case-insensitively while keeping 'Other' at the end.
 */
export function deduplicateCategoriesList(categories: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  let hasOther = false;

  for (const raw of categories) {
    const cleaned = normalizeTaxonomyLabel(raw);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (key === 'other') {
      hasOther = true;
      continue;
    }
    if (!seen.has(key)) {
      seen.add(key);
      result.push(cleaned);
    }
  }

  if (hasOther || !seen.has('other')) {
    result.push('Other');
  }
  return result;
}

/**
 * Loads managed categories from localStorage, seeded with INITIAL_PRODUCT_CATEGORIES.
 */
export function loadManagedCategories(): string[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [...INITIAL_PRODUCT_CATEGORIES];
  }
  try {
    const raw = window.localStorage.getItem(LOCAL_MANAGED_CATEGORIES_KEY);
    if (!raw) {
      return [...INITIAL_PRODUCT_CATEGORIES];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [...INITIAL_PRODUCT_CATEGORIES];
    }
    const cleaned = deduplicateCategoriesList(parsed.map((item) => String(item || '')));
    return cleaned.length > 0 ? cleaned : [...INITIAL_PRODUCT_CATEGORIES];
  } catch {
    return [...INITIAL_PRODUCT_CATEGORIES];
  }
}

/**
 * Persists the managed category list to localStorage.
 */
export function saveManagedCategories(categories: readonly string[]): string[] {
  const normalized = deduplicateCategoriesList(categories);
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(LOCAL_MANAGED_CATEGORIES_KEY, JSON.stringify(normalized));
    } catch {
      // Ignore localStorage quota errors
    }
  }
  return normalized;
}

/**
 * Adds a new custom category to the managed list, preventing duplicates caused by capitalization or whitespace.
 */
export function addManagedCategory(
  rawCategory: string,
  currentCategories?: readonly string[]
): {
  categories: string[];
  canonicalName: string;
  added: boolean;
} {
  const baseList = currentCategories
    ? deduplicateCategoriesList(currentCategories)
    : loadManagedCategories();
  const cleaned = normalizeTaxonomyLabel(rawCategory);
  if (!cleaned) {
    return { categories: baseList, canonicalName: '', added: false };
  }

  const existing = findCanonicalOption(cleaned, baseList);
  if (existing) {
    return { categories: baseList, canonicalName: existing, added: false };
  }

  const withoutOther = baseList.filter((c) => toTaxonomyKey(c) !== 'other');
  const nextList = [...withoutOther, cleaned, 'Other'];
  const saved = saveManagedCategories(nextList);
  return {
    categories: saved,
    canonicalName: cleaned,
    added: true,
  };
}

/**
 * Renames a category in the managed list and updates all associated products without losing associations.
 */
export function renameManagedCategory(
  oldCategory: string,
  newCategoryRaw: string,
  products: Product[],
  currentCategories?: readonly string[]
): {
  categories: string[];
  canonicalNewName: string;
  updatedProducts: Product[];
  changedProducts: Product[];
} {
  const baseList = currentCategories
    ? deduplicateCategoriesList(currentCategories)
    : loadManagedCategories();
  const cleanOld = normalizeTaxonomyLabel(oldCategory);
  const cleanNew = normalizeTaxonomyLabel(newCategoryRaw);
  if (!cleanOld || !cleanNew) {
    return {
      categories: baseList,
      canonicalNewName: cleanOld,
      updatedProducts: products,
      changedProducts: [],
    };
  }

  const oldKey = toTaxonomyKey(cleanOld);
  const existingNewMatch =
    findCanonicalOption(cleanNew, baseList.filter((c) => toTaxonomyKey(c) !== oldKey)) || cleanNew;

  let replacedInList = false;
  const updatedList = baseList.map((cat) => {
    if (toTaxonomyKey(cat) === oldKey) {
      replacedInList = true;
      return existingNewMatch;
    }
    return cat;
  });

  if (!replacedInList) {
    updatedList.push(existingNewMatch);
  }

  const savedCategories = saveManagedCategories(updatedList);
  const changedProducts: Product[] = [];
  const updatedProducts = products.map((prod) => {
    if (toTaxonomyKey(prod.category) === oldKey && prod.category !== existingNewMatch) {
      const updated = { ...prod, category: existingNewMatch };
      changedProducts.push(updated);
      return updated;
    }
    return prod;
  });

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const rememberedRaw = window.localStorage.getItem('sog_catalog_last_selected_category_v1');
      if (rememberedRaw && toTaxonomyKey(rememberedRaw) === oldKey) {
        window.localStorage.setItem('sog_catalog_last_selected_category_v1', existingNewMatch);
      }
    } catch {
      // Ignore storage errors
    }
  }

  return {
    categories: savedCategories,
    canonicalNewName: existingNewMatch,
    updatedProducts,
    changedProducts,
  };
}

/**
 * Removes a category from the managed category list while preserving any existing products that use it.
 * If the removed category was the remembered last-selected category, clears that remembered preference
 * so subsequent imports fall back safely to the normal category selector.
 */
export function deleteManagedCategory(
  categoryToRemove: string,
  currentCategories?: readonly string[]
): { categories: string[]; removed: boolean } {
  const cats = currentCategories ? [...currentCategories] : loadManagedCategories();
  const targetKey = toTaxonomyKey(categoryToRemove);
  if (!targetKey) {
    return { categories: cats, removed: false };
  }
  const filtered = cats.filter((c) => toTaxonomyKey(c) !== targetKey);
  const removed = filtered.length !== cats.length;
  const saved = saveManagedCategories(filtered);

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const rememberedRaw = window.localStorage.getItem('sog_catalog_last_selected_category_v1');
      if (rememberedRaw && toTaxonomyKey(rememberedRaw) === targetKey) {
        window.localStorage.removeItem('sog_catalog_last_selected_category_v1');
      }
    } catch {
      // Ignore storage errors
    }
  }

  return { categories: saved, removed };
}

/**
 * Returns distinct category strings present on existing products that are not yet in the managed category list.
 */
export function getUncatalogedProductCategories(
  products: readonly Pick<Product, 'category'>[],
  managedCategories: readonly string[]
): string[] {
  const managedKeys = new Set(managedCategories.map((c) => toTaxonomyKey(c)));
  const foundMap = new Map<string, string>();

  for (const prod of products) {
    const cleaned = normalizeTaxonomyLabel(prod.category);
    if (!cleaned) continue;
    const key = toTaxonomyKey(cleaned);
    if (key === 'general' || key === 'uncategorized') continue;
    if (!managedKeys.has(key) && !foundMap.has(key)) {
      foundMap.set(key, cleaned);
    }
  }

  return Array.from(foundMap.values()).sort((a, b) => a.localeCompare(b));
}

/**
 * Loads managed product types from localStorage, seeded with MANAGED_PRODUCT_TYPES.
 */
export function loadManagedProductTypes(): string[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [...MANAGED_PRODUCT_TYPES];
  }
  try {
    const raw = window.localStorage.getItem(LOCAL_MANAGED_PRODUCT_TYPES_KEY);
    if (!raw) {
      return [...MANAGED_PRODUCT_TYPES];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [...MANAGED_PRODUCT_TYPES];
    }
    const merged = deduplicateCategoriesList([
      ...MANAGED_PRODUCT_TYPES,
      ...parsed.map((item) => String(item || '')),
    ]);
    return merged;
  } catch {
    return [...MANAGED_PRODUCT_TYPES];
  }
}

/**
 * Checks whether a productType string is empty or an unspecific legacy placeholder.
 */
export function isPlaceholderProductType(productType?: string | null): boolean {
  const key = toTaxonomyKey(productType || '');
  return (
    !key ||
    key === 'general' ||
    key === 'apparel & goods' ||
    key === 'apparel and goods' ||
    key === 'uncategorized' ||
    key === 'unknown'
  );
}

export interface ProductTypeDetectionInput {
  name?: string;
  productUrl?: string;
  rawProductType?: string;
  category?: string;
  shortDescription?: string;
  featuresSpecs?: string;
  tags?: string[];
}

export interface ProductTypeDetectionResult {
  detectedType: string;
  confidence: 'high' | 'medium' | 'low';
  isConfident: boolean;
  matchedSource: 'metadata' | 'title' | 'url_slug' | 'tags' | 'description' | 'none';
}

interface ProductTypeMatchRule {
  productType: string;
  /** Patterns matched against title, URL slug, or explicit metadata */
  primaryPatterns: RegExp[];
  /** Stricter patterns matched against description, specs, or tags */
  secondaryPatterns: RegExp[];
}

/**
 * Ordered from most specific multi-word product types to general single-word types.
 * Specifically requires clear qualifiers for glassware so a generic "glass" is never
 * misclassified as a Rocks Glass, Beer Can Glass, or Whiskey Glass.
 */
const PRODUCT_TYPE_MATCH_RULES: readonly ProductTypeMatchRule[] = [
  {
    productType: 'Beer Can Glass',
    primaryPatterns: [
      /\bbeer\s+can\s+glass(?:es)?\b/i,
      /\bcan\s+shaped\s+glass(?:es)?\b/i,
      /\b16\s*oz\s+beer\s+can\b/i,
    ],
    secondaryPatterns: [/\bbeer\s+can\s+glass(?:es)?\b/i, /\bcan\s+shaped\s+glass(?:es)?\b/i],
  },
  {
    productType: 'Whiskey Glass',
    primaryPatterns: [
      /\bwhisk(?:e)?y\s+glass(?:es)?\b/i,
      /\bbourbon\s+glass(?:es)?\b/i,
      /\bscotch\s+glass(?:es)?\b/i,
      /\bwhisk(?:e)?y\s+tumbler(?:s)?\b/i,
    ],
    secondaryPatterns: [/\bwhisk(?:e)?y\s+glass(?:es)?\b/i, /\bbourbon\s+glass(?:es)?\b/i],
  },
  {
    productType: 'Rocks Glass',
    primaryPatterns: [
      /\brocks?\s+glass(?:es)?\b/i,
      /\bold\s+fashioned\s+glass(?:es)?\b/i,
      /\blowball\s+glass(?:es)?\b/i,
    ],
    secondaryPatterns: [/\brocks?\s+glass(?:es)?\b/i, /\bold\s+fashioned\s+glass(?:es)?\b/i],
  },
  {
    productType: 'Water Bottle',
    primaryPatterns: [
      /\bwater\s+bottle(?:s)?\b/i,
      /\bsports\s+bottle(?:s)?\b/i,
      /\binsulated\s+(?:stainless\s+steel\s+)?bottle(?:s)?\b/i,
      /\bstainless\s+steel\s+bottle(?:s)?\b/i,
      /\btrident\s+bottle\b/i,
    ],
    secondaryPatterns: [
      /\bwater\s+bottle(?:s)?\b/i,
      /\bvacuum\s+insulated\s+stainless\s+steel\s+bottle\b/i,
    ],
  },
  {
    productType: 'Tumbler',
    primaryPatterns: [/\btumbler(?:s)?\b/i, /\btravel\s+mug(?:s)?\b/i],
    secondaryPatterns: [/\binsulated\s+tumbler(?:s)?\b/i, /\bstainless\s+tumbler(?:s)?\b/i],
  },
  {
    productType: 'Mug',
    primaryPatterns: [/\bmug(?:s)?\b/i, /\bcoffee\s+cup(?:s)?\b/i, /\btea\s+cup(?:s)?\b/i],
    secondaryPatterns: [/\bceramic\s+mug(?:s)?\b/i, /\bcoffee\s+mug(?:s)?\b/i, /\b11\s*oz\s+mug\b/i, /\b15\s*oz\s+mug\b/i],
  },
  {
    productType: 'iPhone Case',
    primaryPatterns: [
      /\biphone(?:\s+[a-z0-9]+){0,3}\s+case(?:s)?\b/i,
      /\bphone\s+case(?:s)?\b/i,
      /\bmagsafe\s+case(?:s)?\b/i,
    ],
    secondaryPatterns: [/\biphone\s+case(?:s)?\b/i, /\bphone\s+case(?:s)?\b/i],
  },
  {
    productType: 'Laptop Sleeve',
    primaryPatterns: [
      /\blaptop\s+sleeve(?:s)?\b/i,
      /\bmacbook\s+sleeve(?:s)?\b/i,
      /\bcomputer\s+sleeve(?:s)?\b/i,
      /\blaptop\s+pouch(?:es)?\b/i,
    ],
    secondaryPatterns: [/\blaptop\s+sleeve(?:s)?\b/i, /\bmacbook\s+sleeve(?:s)?\b/i],
  },
  {
    productType: 'Desk Mat',
    primaryPatterns: [
      /\bdesk\s+mat(?:s)?\b/i,
      /\bdesk\s+pad(?:s)?\b/i,
      /\bgaming\s+desk\s+mat(?:s)?\b/i,
    ],
    secondaryPatterns: [/\bdesk\s+mat(?:s)?\b/i, /\bdesk\s+pad(?:s)?\b/i],
  },
  {
    productType: 'Mouse Pad',
    primaryPatterns: [
      /\bmouse\s+pad(?:s)?\b/i,
      /\bmousepad(?:s)?\b/i,
      /\bmouse\s+mat(?:s)?\b/i,
    ],
    secondaryPatterns: [/\bmouse\s+pad(?:s)?\b/i, /\bmousepad(?:s)?\b/i],
  },
  {
    productType: 'Tote Bag',
    primaryPatterns: [
      /\btote\s+bag(?:s)?\b/i,
      /\bcanvas\s+tote(?:s)?\b/i,
      /\bmarket\s+tote(?:s)?\b/i,
      /\bbook\s+tote(?:s)?\b/i,
      /\btote(?:s)?\b/i,
    ],
    secondaryPatterns: [/\btote\s+bag(?:s)?\b/i, /\bcanvas\s+tote(?:s)?\b/i],
  },
  {
    productType: 'Cap',
    primaryPatterns: [
      /\bbaseball\s+cap(?:s)?\b/i,
      /\bdad\s+hat(?:s)?\b/i,
      /\bdad\s+cap(?:s)?\b/i,
      /\btrucker\s+hat(?:s)?\b/i,
      /\btrucker\s+cap(?:s)?\b/i,
      /\bsnapback(?:\s+cap|\s+hat)?(?:s)?\b/i,
      /\bcorduroy\s+cap(?:s)?\b/i,
      /\bembroidered\s+cap(?:s)?\b/i,
      /\bcap(?:s)?\b/i,
    ],
    secondaryPatterns: [
      /\bbaseball\s+cap(?:s)?\b/i,
      /\bdad\s+hat(?:s)?\b/i,
      /\btrucker\s+hat(?:s)?\b/i,
      /\bsnapback\s+cap(?:s)?\b/i,
    ],
  },
  {
    productType: 'Journal',
    primaryPatterns: [/\bjournal(?:s)?\b/i, /\bdiary\b/i],
    secondaryPatterns: [/\bspiral\s+journal(?:s)?\b/i, /\bhardcover\s+journal(?:s)?\b/i, /\blined\s+journal(?:s)?\b/i],
  },
  {
    productType: 'Notebook',
    primaryPatterns: [/\bnotebook(?:s)?\b/i, /\bnotepad(?:s)?\b/i],
    secondaryPatterns: [/\bspiral\s+notebook(?:s)?\b/i, /\bhardcover\s+notebook(?:s)?\b/i],
  },
  {
    productType: 'Poster',
    primaryPatterns: [
      /\bposter(?:s)?\b/i,
      /\bart\s+print(?:s)?\b/i,
      /\bwall\s+art\s+print(?:s)?\b/i,
      /\bmuseum\s+print(?:s)?\b/i,
      /\bgiclee\s+print(?:s)?\b/i,
    ],
    secondaryPatterns: [/\bposter(?:s)?\b/i, /\bmuseum\s+quality\s+poster\b/i],
  },
  {
    productType: 'Hoodie',
    primaryPatterns: [
      /\bhoodie(?:s)?\b/i,
      /\bhooded\s+sweatshirt(?:s)?\b/i,
      /\bpullover\s+hoodie(?:s)?\b/i,
      /\bzip\s+hoodie(?:s)?\b/i,
    ],
    secondaryPatterns: [/\bhoodie(?:s)?\b/i, /\bdouble\s+lined\s+hood\b/i],
  },
  {
    productType: 'Sweatshirt',
    primaryPatterns: [
      /\bsweatshirt(?:s)?\b/i,
      /\bcrewneck(?:s)?\b/i,
      /\bcrew\s+neck\s+(?:fleece|pullover|shirt)(?:s)?\b/i,
    ],
    secondaryPatterns: [/\bcrewneck\s+sweatshirt(?:s)?\b/i, /\bsweatshirt(?:s)?\b/i],
  },
  {
    productType: 'T-Shirt',
    primaryPatterns: [
      /\bt\s+shirt(?:s)?\b/i,
      /\btshirt(?:s)?\b/i,
      /\btee\s+shirt(?:s)?\b/i,
      /\bgraphic\s+tee(?:s)?\b/i,
      /\bheavyweight\s+tee(?:s)?\b/i,
      /\bvintage\s+tee(?:s)?\b/i,
      /\bunisex\s+tee(?:s)?\b/i,
      /\bshort\s+sleeve\s+tee(?:s)?\b/i,
      /\btee(?:s)?\b/i,
    ],
    secondaryPatterns: [/\bt\s+shirt(?:s)?\b/i, /\btshirt(?:s)?\b/i, /\btee\s+shirt(?:s)?\b/i],
  },
];

function normalizeForRuleSearch(input: string): string {
  if (!input) return '';
  return input
    .toLowerCase()
    .replace(/[-_/.,()[\]|:;"'’`!?+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractUrlSlugForSearch(rawUrl: string): string {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return '';
  let pathname = trimmed;
  try {
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      pathname = new URL(trimmed).pathname;
    } else {
      pathname = trimmed.split('?')[0].split('#')[0];
    }
  } catch {
    pathname = trimmed.split('?')[0].split('#')[0];
  }
  const prodIdx = pathname.toLowerCase().indexOf('/products/');
  const targetSegment = prodIdx >= 0 ? pathname.slice(prodIdx + '/products/'.length) : pathname;
  return normalizeForRuleSearch(targetSegment);
}

function matchPrimaryRules(normalizedText: string): string | null {
  if (!normalizedText) return null;
  for (const rule of PRODUCT_TYPE_MATCH_RULES) {
    for (const pattern of rule.primaryPatterns) {
      if (pattern.test(normalizedText)) {
        return rule.productType;
      }
    }
  }
  return null;
}

function matchSecondaryRules(normalizedText: string): string | null {
  if (!normalizedText) return null;
  for (const rule of PRODUCT_TYPE_MATCH_RULES) {
    for (const pattern of rule.secondaryPatterns) {
      if (pattern.test(normalizedText)) {
        return rule.productType;
      }
    }
  }
  return null;
}

/**
 * Infers the most likely Product Type locally from product title, URL slug, and metadata.
 * Never makes an AI or network call. Returns 'Other' with `isConfident: false` when ambiguous.
 */
export function detectProductType(input: ProductTypeDetectionInput): ProductTypeDetectionResult {
  const normTitle = normalizeForRuleSearch(input.name || '');
  const normSlug = extractUrlSlugForSearch(input.productUrl || '');
  const rawMetaType = normalizeTaxonomyLabel(input.rawProductType || '');

  // 1. Check Title first for clear, unambiguous user-facing product naming
  //    (e.g., "Civil War Whiskey Glass", "The Original Hottake 1943 T-Shirt", "Abraham Lincoln Superhero Hoodie")
  if (normTitle) {
    const titleMatch = matchPrimaryRules(normTitle);
    if (titleMatch) {
      return {
        detectedType: titleMatch,
        confidence: 'high',
        isConfident: true,
        matchedSource: 'title',
      };
    }
  }

  // 2. Check explicit productType metadata (e.g., JSON-LD or Shopify product_type)
  if (rawMetaType && !isPlaceholderProductType(rawMetaType)) {
    const exactManaged = findCanonicalOption(
      rawMetaType,
      MANAGED_PRODUCT_TYPES.filter((t) => t !== 'Other')
    );
    if (exactManaged) {
      return {
        detectedType: exactManaged,
        confidence: 'high',
        isConfident: true,
        matchedSource: 'metadata',
      };
    }
    const normMeta = normalizeForRuleSearch(rawMetaType);
    const metaMatch = matchPrimaryRules(normMeta);
    if (metaMatch) {
      return {
        detectedType: metaMatch,
        confidence: 'high',
        isConfident: true,
        matchedSource: 'metadata',
      };
    }
  }

  // 3. Check URL slug (e.g., /products/the-original-hottake-1943-t-shirt)
  if (normSlug) {
    const slugMatch = matchPrimaryRules(normSlug);
    if (slugMatch) {
      return {
        detectedType: slugMatch,
        confidence: 'high',
        isConfident: true,
        matchedSource: 'url_slug',
      };
    }
  }

  // 4. Check tags (medium confidence)
  if (input.tags && input.tags.length > 0) {
    const normTags = normalizeForRuleSearch(input.tags.join(' '));
    const tagMatch = matchPrimaryRules(normTags);
    if (tagMatch) {
      return {
        detectedType: tagMatch,
        confidence: 'medium',
        isConfident: true,
        matchedSource: 'tags',
      };
    }
  }

  // 5. Check short description and specs using stricter secondary patterns
  const normDescAndSpecs = normalizeForRuleSearch(
    `${input.shortDescription || ''} ${input.featuresSpecs || ''}`
  );
  if (normDescAndSpecs) {
    const descMatch = matchSecondaryRules(normDescAndSpecs);
    if (descMatch) {
      return {
        detectedType: descMatch,
        confidence: 'medium',
        isConfident: true,
        matchedSource: 'description',
      };
    }
  }

  // 6. Unrecognized or ambiguous (e.g., generic "glass" without whiskey/rocks/beer-can qualifier)
  return {
    detectedType: 'Other',
    confidence: 'low',
    isConfident: false,
    matchedSource: 'none',
  };
}

/**
 * Resolves the appropriate productType, category, and normalized Fourthwall URL for an existing/migrated product record:
 * - Normalizes Fourthwall `/en-usd/products/...` URLs to `/products/...` while preserving product identity.
 * - Preserves existing category strings (normalizing case/whitespace if matching a managed category).
 * - Preserves manually confirmed or non-empty product types.
 * - Populates a suggested productType via local detection only when the existing product lacks one.
 * - Deduplicates tags cleanly while preserving display casing.
 */
export function migrateAndHydrateProductRecord(
  product: Product,
  managedCategories: readonly string[] = INITIAL_PRODUCT_CATEGORIES
): Product {
  const normalizedUrl =
    normalizeFourthwallProductUrl(product.productUrl || '') || product.productUrl;
  const cleanTags = Array.isArray(product.tags)
    ? deduplicateProductTags(product.tags)
    : product.tags;

  const rawCategory = normalizeTaxonomyLabel(product.category || '');
  const canonicalCategory = rawCategory
    ? findCanonicalOption(rawCategory, managedCategories) || rawCategory
    : '';

  const rawType = normalizeTaxonomyLabel(product.productType || '');
  if (!isPlaceholderProductType(rawType)) {
    const canonicalManagedType = findCanonicalOption(rawType, MANAGED_PRODUCT_TYPES);
    return {
      ...product,
      productUrl: normalizedUrl,
      category: canonicalCategory,
      productType: canonicalManagedType || rawType,
      ...(cleanTags ? { tags: cleanTags } : {}),
    };
  }

  const detection = detectProductType({
    name: product.name,
    productUrl: normalizedUrl,
    shortDescription: product.shortDescription,
    featuresSpecs: product.featuresSpecs,
    tags: cleanTags,
  });

  return {
    ...product,
    productUrl: normalizedUrl,
    category: canonicalCategory,
    productType: detection.isConfident ? detection.detectedType : 'Other',
    ...(cleanTags ? { tags: cleanTags } : {}),
  };
}

// ============================================================================
// FOURTHWALL URL NORMALIZATION (REMOVING `/en-usd` LOCALE PREFIX)
// ============================================================================

const IMAGE_OR_ASSET_EXTENSION_RE =
  /\.(?:webp|jpg|jpeg|png|gif|svg|avif|ico|css|js|json|xml|pdf|woff2?|ttf)$/i;
const FOURTHWALL_STOREFRONT_ROUTE_AFTER_LOCALE_RE =
  /^\/en-usd(\/(?:products|collections|pages|cart|checkouts)(?:\/|$).*)$/i;

function isAssetOrCdnHostname(hostname: string): boolean {
  const lower = (hostname || '').toLowerCase();
  return (
    lower.startsWith('cdn.') ||
    lower.startsWith('images.') ||
    lower.startsWith('img.') ||
    lower.startsWith('assets.') ||
    lower.startsWith('static.') ||
    lower.includes('.r2.dev') ||
    lower.includes('.r2.cloudflarestorage.com') ||
    lower.includes('storage.googleapis.com')
  );
}

function isKnownStorefrontHostname(hostname: string): boolean {
  const lower = (hostname || '').toLowerCase();
  return (
    lower === 'scienceofgifts.com' ||
    lower.endsWith('.scienceofgifts.com') ||
    lower === 'fourthwall.com' ||
    lower.endsWith('.fourthwall.com') ||
    lower.endsWith('.fourthwall.shop')
  );
}

function stripTrailingPathnameSlash(pathname: string): string {
  if (!pathname || pathname === '/') return pathname || '/';
  return pathname.replace(/\/+$/, '') || '/';
}

function normalizeStorefrontPathname(
  pathname: string,
  isKnownStoreHost: boolean
): {
  normalizedPathname: string;
  changed: boolean;
} {
  if (!pathname || IMAGE_OR_ASSET_EXTENSION_RE.test(pathname)) {
    return { normalizedPathname: pathname, changed: false };
  }

  const routeMatch = pathname.match(FOURTHWALL_STOREFRONT_ROUTE_AFTER_LOCALE_RE);
  if (routeMatch && routeMatch[1]) {
    const stripped = stripTrailingPathnameSlash(routeMatch[1]);
    return { normalizedPathname: stripped, changed: true };
  }

  if (isKnownStoreHost && /^\/en-usd\/?$/i.test(pathname)) {
    return { normalizedPathname: '/', changed: true };
  }

  if (
    /^\/products\/[^/]+\/+$/i.test(pathname) ||
    /^\/collections\/[^/]+\/products\/[^/]+\/+$/i.test(pathname)
  ) {
    const stripped = stripTrailingPathnameSlash(pathname);
    return { normalizedPathname: stripped, changed: stripped !== pathname };
  }

  return { normalizedPathname: pathname, changed: false };
}

/**
 * Checks whether a URL string contains a localized Fourthwall `/en-usd` storefront prefix
 * that `normalizeFourthwallProductUrl` will strip.
 */
export function isLocalizedFourthwallProductUrl(rawUrl: string): boolean {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return false;
  return normalizeFourthwallProductUrl(trimmed) !== trimmed;
}

/**
 * Deterministically normalizes Fourthwall storefront & product URLs by removing the `/en-usd`
 * locale prefix when it appears as a storefront route prefix:
 *   - `https://shop.scienceofgifts.com/en-usd/products/funny-youtuber-definition-t-shirt`
 *     -> `https://shop.scienceofgifts.com/products/funny-youtuber-definition-t-shirt`
 *   - `/en-usd/products/funny-youtuber-definition-t-shirt`
 *     -> `/products/funny-youtuber-definition-t-shirt`
 *
 * Rules:
 *   - Removes `/en-usd` ONLY when it is a locale prefix before Fourthwall storefront routes
 *     (`/products/...`, `/collections/...`, `/pages/...`, `/cart`, `/checkouts`, or root on storefront host).
 *   - Never alters product slugs that contain `en-usd` inside the handle (e.g. `/products/en-usd-shirt`).
 *   - Never alters image CDN URLs or static asset URLs.
 *   - Preserves query parameters (`?variant=...`) and hash fragments (`#...`) while cleaning trailing slashes.
 */
export function normalizeFourthwallProductUrl(rawUrl: string): string {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return '';

  // 1. Relative path starting with `/` (or `en-usd/...` without a leading slash)
  if (
    /^en-usd\/(?:products|collections|pages|cart|checkouts)(?:\/|$)/i.test(trimmed)
  ) {
    return normalizeFourthwallProductUrl(`/${trimmed}`);
  }

  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    const hashIdx = trimmed.indexOf('#');
    const fragment = hashIdx >= 0 ? trimmed.slice(hashIdx) : '';
    const beforeHash = hashIdx >= 0 ? trimmed.slice(0, hashIdx) : trimmed;

    const queryIdx = beforeHash.indexOf('?');
    const search = queryIdx >= 0 ? beforeHash.slice(queryIdx) : '';
    const pathname = queryIdx >= 0 ? beforeHash.slice(0, queryIdx) : beforeHash;

    const { normalizedPathname, changed } = normalizeStorefrontPathname(pathname, true);
    if (!changed) return trimmed;
    return `${normalizedPathname}${search}${fragment}`;
  }

  // 2. Full http:// or https:// URL
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (isAssetOrCdnHostname(parsed.hostname)) {
        return trimmed;
      }
      const knownHost = isKnownStorefrontHostname(parsed.hostname);
      const { normalizedPathname, changed } = normalizeStorefrontPathname(
        parsed.pathname,
        knownHost
      );
      if (!changed) {
        return trimmed;
      }
      parsed.pathname = normalizedPathname;
      return parsed.toString();
    } catch {
      return trimmed;
    }
  }

  // 3. Bare domain pasted without scheme (e.g. `shop.scienceofgifts.com/en-usd/products/foo`)
  if (/^[a-z0-9.-]+\.[a-z]{2,}\/en-usd\/(?:products|collections|pages)\b/i.test(trimmed)) {
    const slashIdx = trimmed.indexOf('/');
    const hostPart = trimmed.slice(0, slashIdx);
    if (!isAssetOrCdnHostname(hostPart)) {
      const rest = trimmed.slice(slashIdx);
      const normalizedRest = normalizeFourthwallProductUrl(rest);
      return `${hostPart}${normalizedRest}`;
    }
  }

  return trimmed;
}

function getNormalizedProductUrlComparisonKey(url: string): string {
  const norm = normalizeFourthwallProductUrl(url).trim();
  if (!norm) return '';
  const withoutQuery = norm.split('?')[0].split('#')[0].replace(/\/+$/, '').toLowerCase();
  const prodIdx = withoutQuery.indexOf('/products/');
  if (prodIdx >= 0) {
    return withoutQuery.slice(prodIdx);
  }
  return withoutQuery;
}

/**
 * Batch-migrates a catalog product list so any `/en-usd/products/...` links are normalized
 * to canonical `/products/...` URLs while preserving product identity, all product fields,
 * and deduplicating any collision where both localized and canonical records existed.
 */
export function migrateCatalogProductUrls(
  products: readonly Product[],
  managedCategories?: readonly string[]
): {
  products: Product[];
  migratedCount: number;
  deduplicatedCount: number;
} {
  const cats = managedCategories || loadManagedCategories();
  let migratedCount = 0;
  let deduplicatedCount = 0;

  const byUrlKey = new Map<string, number>();
  const result: Product[] = [];

  for (const rawProd of products) {
    const wasLocalized = isLocalizedFourthwallProductUrl(rawProd.productUrl);
    const hydrated = migrateAndHydrateProductRecord(rawProd, cats);
    if (wasLocalized || hydrated.productUrl !== rawProd.productUrl) {
      migratedCount++;
    }

    const urlKey = getNormalizedProductUrlComparisonKey(hydrated.productUrl);
    if (!urlKey) {
      result.push(hydrated);
      continue;
    }

    const existingIdx = byUrlKey.get(urlKey);
    if (existingIdx === undefined) {
      byUrlKey.set(urlKey, result.length);
      result.push(hydrated);
    } else {
      deduplicatedCount++;
      const existing = result[existingIdx];
      const primary = !wasLocalized ? hydrated : existing;
      const secondary = !wasLocalized ? existing : hydrated;

      result[existingIdx] = {
        ...secondary,
        ...primary,
        id: existing.id || hydrated.id,
        productUrl: primary.productUrl || secondary.productUrl,
        name: primary.name || secondary.name,
        price:
          primary.price && primary.price !== 'Unavailable'
            ? primary.price
            : secondary.price || primary.price,
        originalPrice: primary.originalPrice || secondary.originalPrice,
        imageUrl: primary.imageUrl || secondary.imageUrl,
        imageUrls:
          primary.imageUrls && primary.imageUrls.length > 0
            ? primary.imageUrls
            : secondary.imageUrls,
        shortDescription: primary.shortDescription || secondary.shortDescription,
        featuresSpecs: primary.featuresSpecs || secondary.featuresSpecs,
        sourceNotes: primary.sourceNotes || secondary.sourceNotes,
        sku: primary.sku || secondary.sku,
        variants:
          primary.variants && primary.variants.length > 0
            ? primary.variants
            : secondary.variants,
        tags: deduplicateProductTags([
          ...(primary.tags || []),
          ...(secondary.tags || []),
        ]),
      };
    }
  }

  return {
    products: result,
    migratedCount,
    deduplicatedCount,
  };
}

// ============================================================================
// REMEMBERED CATEGORY & TAG REUSE PERSISTENCE
// ============================================================================

export const LOCAL_LAST_SELECTED_CATEGORY_KEY = 'sog_catalog_last_selected_category_v1';
export const LOCAL_LAST_SAVED_TAGS_KEY = 'sog_catalog_last_saved_tags_v1';
export const LOCAL_REUSE_LAST_TAGS_ENABLED_KEY = 'sog_catalog_reuse_last_tags_enabled_v1';

/**
 * Loads the last manually selected and saved product category from localStorage.
 * Validates that the remembered category still exists in `managedCategories`.
 * If no remembered category exists or it was deleted from `managedCategories`, returns `null`.
 */
export function loadRememberedProductCategory(
  managedCategories?: readonly string[]
): string | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(LOCAL_LAST_SELECTED_CATEGORY_KEY);
    const clean = normalizeTaxonomyLabel(raw || '');
    if (!clean) return null;
    const cats = managedCategories ?? loadManagedCategories();
    const canonical = findCanonicalOption(clean, cats);
    return canonical || null;
  } catch {
    return null;
  }
}

/**
 * Saves the selected product category as the remembered default for subsequent product imports.
 */
export function saveRememberedProductCategory(
  category: string,
  managedCategories?: readonly string[]
): string | null {
  const clean = normalizeTaxonomyLabel(category);
  if (!clean) {
    clearRememberedProductCategory();
    return null;
  }
  const cats = managedCategories ?? loadManagedCategories();
  const canonical = findCanonicalOption(clean, cats) || clean;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(LOCAL_LAST_SELECTED_CATEGORY_KEY, canonical);
    } catch {
      // Ignore storage errors
    }
  }
  return canonical;
}

export function clearRememberedProductCategory(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(LOCAL_LAST_SELECTED_CATEGORY_KEY);
    } catch {
      // Ignore storage errors
    }
  }
}

/**
 * Resolves the initial category for the Review & Save / Edit Product modal:
 * - When editing an existing product (`isExistingEdit: true`), strictly preserves the existing product's category.
 * - When importing/creating a new product (`isExistingEdit: false`), preselects the remembered category if valid;
 *   otherwise falls back to the auto-detected extracted category or `'General History'`.
 */
export function resolveCategoryForProductModal(params: {
  isExistingEdit: boolean;
  existingCategory?: string;
  extractedCategory?: string;
  managedCategories?: readonly string[];
}): {
  category: string;
  source: 'existing_product' | 'remembered_category' | 'auto_detected' | 'default_fallback';
} {
  const cats = params.managedCategories ?? loadManagedCategories();

  if (params.isExistingEdit) {
    const cleanExisting = normalizeTaxonomyLabel(params.existingCategory || '');
    if (cleanExisting && toTaxonomyKey(cleanExisting) !== 'general') {
      const canonical = findCanonicalOption(cleanExisting, cats) || cleanExisting;
      return { category: canonical, source: 'existing_product' };
    }
    const cleanExtracted = normalizeTaxonomyLabel(params.extractedCategory || '');
    if (cleanExtracted && toTaxonomyKey(cleanExtracted) !== 'general') {
      const canonical = findCanonicalOption(cleanExtracted, cats) || cleanExtracted;
      return { category: canonical, source: 'auto_detected' };
    }
    return { category: 'General History', source: 'existing_product' };
  }

  // New product import: check remembered category first
  const remembered = loadRememberedProductCategory(cats);
  if (remembered) {
    return { category: remembered, source: 'remembered_category' };
  }

  // Fallback to auto-detected category if no valid remembered category exists
  const cleanExtracted = normalizeTaxonomyLabel(params.extractedCategory || '');
  if (cleanExtracted && toTaxonomyKey(cleanExtracted) !== 'general') {
    const canonical = findCanonicalOption(cleanExtracted, cats) || cleanExtracted;
    return { category: canonical, source: 'auto_detected' };
  }

  return { category: 'General History', source: 'default_fallback' };
}

/**
 * Deduplicates and normalizes a list or comma-separated string of product tags.
 * Preserves consistent formatting and first-seen casing while deduplicating case-insensitively.
 */
export function deduplicateProductTags(
  input: readonly string[] | string | undefined | null
): string[] {
  if (!input) return [];
  const rawTokens = Array.isArray(input) ? input : String(input).split(',');

  const seenLower = new Set<string>();
  const result: string[] = [];

  for (const token of rawTokens) {
    const cleaned = String(token ?? '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 60);
    if (!cleaned) continue;
    const lower = cleaned.toLowerCase();
    if (!seenLower.has(lower)) {
      seenLower.add(lower);
      result.push(cleaned);
      if (result.length >= 20) break;
    }
  }
  return result;
}

export function formatProductTagsInput(
  input: readonly string[] | string | undefined | null
): string {
  return deduplicateProductTags(input).join(', ');
}

/**
 * Loads the last saved product tags from localStorage.
 */
export function loadRememberedProductTags(): string[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(LOCAL_LAST_SAVED_TAGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return deduplicateProductTags(parsed.filter((x) => typeof x === 'string'));
    }
    if (typeof parsed === 'string') {
      return deduplicateProductTags(parsed);
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Saves the current product's deduplicated tags to localStorage for reuse on subsequent imports.
 */
export function saveRememberedProductTags(
  tags: readonly string[] | string | undefined | null
): string[] {
  const clean = deduplicateProductTags(tags);
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(LOCAL_LAST_SAVED_TAGS_KEY, JSON.stringify(clean));
    } catch {
      // Ignore storage errors
    }
  }
  return clean;
}

export function clearRememberedProductTags(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(LOCAL_LAST_SAVED_TAGS_KEY);
    } catch {
      // Ignore storage errors
    }
  }
}

/**
 * Loads the user's "Reuse last tags" toggle preference from localStorage (defaults to `true`).
 */
export function loadReuseLastTagsPreference(): boolean {
  if (typeof window === 'undefined' || !window.localStorage) {
    return true;
  }
  try {
    const raw = window.localStorage.getItem(LOCAL_REUSE_LAST_TAGS_ENABLED_KEY);
    if (raw === null) return true;
    return raw !== 'false' && raw !== '0';
  } catch {
    return true;
  }
}

/**
 * Saves the user's "Reuse last tags" toggle preference to localStorage.
 */
export function saveReuseLastTagsPreference(enabled: boolean): boolean {
  const boolVal = Boolean(enabled);
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(
        LOCAL_REUSE_LAST_TAGS_ENABLED_KEY,
        boolVal ? 'true' : 'false'
      );
    } catch {
      // Ignore storage errors
    }
  }
  return boolVal;
}

/**
 * Resolves the initial tags for the Review & Save / Edit Product modal:
 * - Editing an existing product (`isExistingEdit: true`): strictly preserves existing product tags without overwriting.
 * - New product import (`isExistingEdit: false`):
 *   - If extracted tags exist on the newly fetched product, keeps `extractedTags` as the initial tags
 *     (never silently mixing unrelated remembered tags into extracted tags) and flags `hasExtractedVsRememberedChoice: true`
 *     so the UI can offer one-click "Use Last Tags" or "Merge Last Tags" with full reversibility.
 *   - If no extracted tags exist and `reuseLastTags` is enabled, pre-fills `rememberedTags`.
 *   - If `reuseLastTags` is disabled, leaves tags empty (or extracted only).
 */
export function resolveTagsForProductModal(params: {
  isExistingEdit: boolean;
  existingTags?: readonly string[];
  extractedTags?: readonly string[];
  rememberedTags?: readonly string[];
  reuseLastTagsEnabled?: boolean;
}): {
  tags: string[];
  tagsInput: string;
  extractedTags: string[];
  rememberedTags: string[];
  reuseLastTagsEnabled: boolean;
  source: 'existing_product' | 'remembered_tags' | 'extracted_tags' | 'empty';
  hasExtractedVsRememberedChoice: boolean;
} {
  const cleanExisting = deduplicateProductTags(params.existingTags);
  const cleanExtracted = deduplicateProductTags(params.extractedTags);
  const cleanRemembered = deduplicateProductTags(
    params.rememberedTags ?? loadRememberedProductTags()
  );
  const reuseEnabled =
    params.reuseLastTagsEnabled ?? loadReuseLastTagsPreference();

  if (params.isExistingEdit) {
    return {
      tags: cleanExisting,
      tagsInput: cleanExisting.join(', '),
      extractedTags: cleanExtracted,
      rememberedTags: cleanRemembered,
      reuseLastTagsEnabled: reuseEnabled,
      source: 'existing_product',
      hasExtractedVsRememberedChoice: false,
    };
  }

  // New product import
  if (cleanExtracted.length > 0) {
    const extractedKey = cleanExtracted.map((t) => t.toLowerCase()).join('|');
    const rememberedKey = cleanRemembered.map((t) => t.toLowerCase()).join('|');
    return {
      tags: cleanExtracted,
      tagsInput: cleanExtracted.join(', '),
      extractedTags: cleanExtracted,
      rememberedTags: cleanRemembered,
      reuseLastTagsEnabled: reuseEnabled,
      source: 'extracted_tags',
      hasExtractedVsRememberedChoice:
        cleanRemembered.length > 0 && extractedKey !== rememberedKey,
    };
  }

  if (reuseEnabled && cleanRemembered.length > 0) {
    return {
      tags: cleanRemembered,
      tagsInput: cleanRemembered.join(', '),
      extractedTags: [],
      rememberedTags: cleanRemembered,
      reuseLastTagsEnabled: reuseEnabled,
      source: 'remembered_tags',
      hasExtractedVsRememberedChoice: false,
    };
  }

  return {
    tags: [],
    tagsInput: '',
    extractedTags: [],
    rememberedTags: cleanRemembered,
    reuseLastTagsEnabled: reuseEnabled,
    source: 'empty',
    hasExtractedVsRememberedChoice: false,
  };
}

