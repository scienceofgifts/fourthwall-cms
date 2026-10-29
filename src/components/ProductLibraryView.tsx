import React, { useMemo, useState } from 'react';
import {
  Plus,
  Search,
  Upload,
  Edit3,
  Archive,
  RotateCcw,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  X,
  Globe,
  RefreshCw,
  FileText,
  Copy,
  Download,
  CheckSquare,
  Square,
  ExternalLink,
  ArrowUpDown,
} from 'lucide-react';
import { Product, ProductVariant } from '../types/cms';
import {
  deriveStableProductId,
  isValidProductUrl,
  normalizePriceDisplay,
  parseProductImportBatch,
  ProductImportReport,
} from '../services/importParser';
import {
  ExtractedProductData,
  validateFetchableProductUrl,
} from '../services/productExtractor';
import {
  BriefAssistantTarget,
  findDuplicateProduct,
  generateProductBrief,
  mergeRefreshedProductData,
  ProductRefreshFieldChange,
} from '../services/briefGenerator';
import { buildEditorialSvgDataUri, SEED_PRODUCTS } from '../data/greekMythologySeed';
import { getSavedGeminiModelPreference } from '../services/geminiModelConfig';
import {
  MANAGED_PRODUCT_TYPES,
  ProductTypeDetectionResult,
  addManagedCategory,
  detectProductType,
  findCanonicalOption,
  getUncatalogedProductCategories,
  isPlaceholderProductType,
  loadManagedCategories,
  normalizeTaxonomyLabel,
  renameManagedCategory,
  toTaxonomyKey,
} from '../services/productCatalogTaxonomy';

interface ProductLibraryViewProps {
  products: Product[];
  defaultStoreBaseUrl?: string;
  onSaveProduct: (
    product: Omit<Product, 'ownerId' | 'createdAt' | 'updatedAt'>,
    isExisting: boolean
  ) => Promise<void>;
  onDeleteProduct: (productId: string) => Promise<void>;
  onBatchImportProducts: (
    batch: Array<Omit<Product, 'ownerId' | 'createdAt' | 'updatedAt'>>
  ) => Promise<void>;
  onShowToast?: (msg: string) => void;
}

const SAMPLE_CSV_PASTE = `name,productUrl,price,productType,category,shortDescription,featuresSpecs
Apollo Sun Chariot Oversized Hoodie,/products/apollo-sun-chariot-oversized-hoodie,$49.90,Hoodie,Apollo,Golden solar chariot and lyre crest on 9.4 oz heavyweight brushed fleece.,9.4 oz heavyweight cotton-poly fleece • Relaxed drop-shoulder fit • Double-lined hood
Hermes Caduceus Messenger Tote Bag,/products/hermes-caduceus-canvas-tote-bag,$22.90,Tote Bag,Hermes,Heavyweight 12 oz organic cotton canvas tote for books and market runs.,12 oz organic cotton canvas • Reinforced web handles • 15" x 16" gusseted bottom
Artemis Silver Moon & Stag Spiral Journal,/products/artemis-silver-moon-stag-spiral-journal,$19.90,Spiral Journal,Artemis,150-page lay-flat lined notebook featuring the sacred deer and crescent bow.,150 lined pages • 5.5" x 8.5" • Soft-touch matte cover • Black wire-o spiral`;

type SortOption = 'name_asc' | 'updated_desc' | 'price_asc' | 'price_desc' | 'category_asc';

function parseNumericPrice(priceStr: string): number {
  if (!priceStr || priceStr === 'Unavailable') return Number.POSITIVE_INFINITY;
  const m = priceStr.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}

function formatTimestampShort(ts: unknown, fallbackIso?: string): string {
  const raw = fallbackIso || (typeof ts === 'string' ? ts : undefined);
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
  }
  if (ts && typeof ts === 'object' && 'seconds' in (ts as any)) {
    const d = new Date((ts as any).seconds * 1000);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return 'Saved';
}

export const ProductLibraryView: React.FC<ProductLibraryViewProps> = ({
  products,
  defaultStoreBaseUrl = 'https://scienceofgifts.com',
  onSaveProduct,
  onDeleteProduct,
  onBatchImportProducts,
  onShowToast,
}) => {
  // URL Fetch Bar state
  const [fetchUrlInput, setFetchUrlInput] = useState('');
  const [fetchingUrl, setFetchingUrl] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchFallbackHint, setFetchFallbackHint] = useState<string | null>(null);
  const [showPasteFallbackBox, setShowPasteFallbackBox] = useState(false);
  const [pastedPageHtml, setPastedPageHtml] = useState('');
  const [duplicateWarningProduct, setDuplicateWarningProduct] = useState<Product | null>(null);
  const [extractionWarnings, setExtractionWarnings] = useState<string[]>([]);

  // Search, Filter, Sort, Selection state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [selectedType, setSelectedType] = useState('ALL');
  const [sortBy, setSortBy] = useState<SortOption>('name_asc');
  const [showArchived, setShowArchived] = useState(false);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());

  // Single Product Create / Review / Edit Modal
  const [editingProduct, setEditingProduct] = useState<Omit<
    Product,
    'ownerId' | 'createdAt' | 'updatedAt'
  > | null>(null);
  const [isExistingEdit, setIsExistingEdit] = useState(false);
  const [tagsInput, setTagsInput] = useState('');
  const [additionalImagesInput, setAdditionalImagesInput] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [savingProduct, setSavingProduct] = useState(false);

  // Refresh Review Modal state
  const [refreshingProductId, setRefreshingProductId] = useState<string | null>(null);
  const [refreshReviewState, setRefreshReviewState] = useState<{
    original: Product;
    merged: Product;
    changes: ProductRefreshFieldChange[];
    preservedFields: string[];
    warnings: string[];
  } | null>(null);

  // Brief Generator Modal state
  const [briefModalState, setBriefModalState] = useState<{
    target: BriefAssistantTarget;
    guideTopic: string;
    additionalContext: string;
    editableBriefText: string;
    hasManualEdits: boolean;
  } | null>(null);

  // CSV / Roster Batch Import Modal state
  const [showImportModal, setShowImportModal] = useState(false);
  const [rawImportText, setRawImportText] = useState('');
  const [importReport, setImportReport] = useState<ProductImportReport | null>(null);
  const [importingBatch, setImportingBatch] = useState(false);

  // Delete confirmation state
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Managed Categories & Product Type Detection UI state
  const [managedCategories, setManagedCategories] = useState<string[]>(() =>
    loadManagedCategories()
  );
  const [categorySearchFilter, setCategorySearchFilter] = useState('');
  const [showAddCategoryInline, setShowAddCategoryInline] = useState(false);
  const [newCategoryNameInput, setNewCategoryNameInput] = useState('');
  const [showRenameCategoryInline, setShowRenameCategoryInline] = useState(false);
  const [renameCategoryDraft, setRenameCategoryDraft] = useState('');
  const [detectedTypeInfo, setDetectedTypeInfo] = useState<ProductTypeDetectionResult | null>(
    null
  );

  const uncatalogedCategories = useMemo(
    () => getUncatalogedProductCategories(products, managedCategories),
    [products, managedCategories]
  );

  const categories = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const c of [...managedCategories, ...uncatalogedCategories]) {
      const clean = normalizeTaxonomyLabel(c);
      if (!clean) continue;
      const key = toTaxonomyKey(clean);
      if (!seen.has(key)) {
        seen.add(key);
        list.push(clean);
      }
    }
    return ['ALL', ...list];
  }, [managedCategories, uncatalogedCategories]);

  const productTypes = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const t of [
      ...MANAGED_PRODUCT_TYPES,
      ...products.map((p) => p.productType).filter(Boolean),
    ]) {
      const clean = normalizeTaxonomyLabel(t);
      if (!clean || isPlaceholderProductType(clean)) continue;
      const key = toTaxonomyKey(clean);
      if (!seen.has(key)) {
        seen.add(key);
        list.push(clean);
      }
    }
    return ['ALL', ...list];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = products.filter((p) => {
      if (!showArchived && p.archived) return false;
      if (showArchived && !p.archived) return false;
      if (selectedCategory !== 'ALL' && p.category !== selectedCategory) return false;
      if (selectedType !== 'ALL' && p.productType !== selectedType) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.productUrl.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.productType.toLowerCase().includes(q) ||
        (p.sku || '').toLowerCase().includes(q) ||
        p.shortDescription.toLowerCase().includes(q) ||
        p.sourceNotes.toLowerCase().includes(q) ||
        (p.tags || []).some((t) => t.toLowerCase().includes(q))
      );
    });

    return [...filtered].sort((a, b) => {
      if (sortBy === 'name_asc') return a.name.localeCompare(b.name);
      if (sortBy === 'category_asc') {
        return (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name);
      }
      if (sortBy === 'price_asc') {
        return parseNumericPrice(a.price) - parseNumericPrice(b.price);
      }
      if (sortBy === 'price_desc') {
        const pa = parseNumericPrice(a.price);
        const pb = parseNumericPrice(b.price);
        if (pa === Number.POSITIVE_INFINITY && pb === Number.POSITIVE_INFINITY) return 0;
        if (pa === Number.POSITIVE_INFINITY) return 1;
        if (pb === Number.POSITIVE_INFINITY) return -1;
        return pb - pa;
      }
      if (sortBy === 'updated_desc') {
        const ta = a.lastFetchedAt ? new Date(a.lastFetchedAt).getTime() : 0;
        const tb = b.lastFetchedAt ? new Date(b.lastFetchedAt).getTime() : 0;
        return tb - ta || a.name.localeCompare(b.name);
      }
      return 0;
    });
  }, [products, searchQuery, selectedCategory, selectedType, showArchived, sortBy]);

  const selectedProductsList = useMemo(
    () => products.filter((p) => selectedProductIds.has(p.id)),
    [products, selectedProductIds]
  );

  const toggleProductSelection = (id: string) => {
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    const allFilteredSelected =
      filteredProducts.length > 0 &&
      filteredProducts.every((p) => selectedProductIds.has(p.id));
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filteredProducts.forEach((p) => next.delete(p.id));
      } else {
        filteredProducts.forEach((p) => next.add(p.id));
      }
      return next;
    });
  };

  // Opens review modal populated from extracted data
  const openReviewModalFromExtracted = (
    extracted: ExtractedProductData,
    sourceUrl: string,
    existingMatch?: Product
  ) => {
    const nowIso = new Date().toISOString();
    const resolvedUrl = extracted.productUrl || sourceUrl;
    const id = existingMatch
      ? existingMatch.id
      : deriveStableProductId(
          resolvedUrl,
          extracted.name || 'imported-product',
          products.length + 1
        );

    const initialTags = existingMatch
      ? Array.from(new Set([...(existingMatch.tags || []), ...(extracted.tags || [])]))
      : extracted.tags || [];

    const extraImgs = (extracted.imageUrls || []).filter((u) => u !== extracted.imageUrl);

    const resolvedName = extracted.name || existingMatch?.name || '';
    const resolvedDesc = extracted.shortDescription || existingMatch?.shortDescription || '';
    const resolvedSpecs = extracted.featuresSpecs || existingMatch?.featuresSpecs || '';

    // Preserve a manually confirmed productType on existingMatch; otherwise infer locally
    const hasConfirmedExistingType =
      existingMatch &&
      (existingMatch.productTypeManualOverride ||
        (!isPlaceholderProductType(existingMatch.productType) &&
          toTaxonomyKey(existingMatch.productType) !== 'other'));

    const localDetection = detectProductType({
      name: resolvedName,
      productUrl: resolvedUrl,
      rawProductType: extracted.productType,
      category: extracted.category || existingMatch?.category,
      shortDescription: resolvedDesc,
      featuresSpecs: resolvedSpecs,
      tags: initialTags,
    });

    const resolvedProductType = hasConfirmedExistingType
      ? findCanonicalOption(existingMatch.productType, MANAGED_PRODUCT_TYPES) ||
        existingMatch.productType
      : localDetection.isConfident
      ? localDetection.detectedType
      : 'Other';

    const rawExtractedCat = normalizeTaxonomyLabel(extracted.category || '');
    const rawExistingCat = normalizeTaxonomyLabel(existingMatch?.category || '');
    const resolvedCategory =
      rawExistingCat && toTaxonomyKey(rawExistingCat) !== 'general'
        ? findCanonicalOption(rawExistingCat, managedCategories) || rawExistingCat
        : rawExtractedCat
        ? findCanonicalOption(rawExtractedCat, managedCategories) || rawExtractedCat
        : 'General History';

    setEditingProduct({
      id,
      name: resolvedName,
      productUrl: resolvedUrl,
      imageUrl: extracted.imageUrl || existingMatch?.imageUrl || '',
      imageUrls: extracted.imageUrls || existingMatch?.imageUrls || [],
      price: extracted.price || existingMatch?.price || '',
      originalPrice: extracted.originalPrice || existingMatch?.originalPrice || '',
      currency: extracted.currency || existingMatch?.currency || 'USD',
      productType: resolvedProductType,
      productTypeManualOverride: hasConfirmedExistingType ? true : false,
      category: resolvedCategory,
      sku: extracted.sku || existingMatch?.sku || '',
      tags: initialTags,
      shortDescription: resolvedDesc,
      featuresSpecs: resolvedSpecs,
      sourceNotes: existingMatch?.sourceNotes || '',
      variants:
        extracted.variants && extracted.variants.length > 0
          ? extracted.variants
          : existingMatch?.variants || [],
      lastFetchedAt: nowIso,
      dataSource: extracted.dataSource,
      fetchStatus: extracted.fetchStatus,
      archived: existingMatch?.archived || false,
    });
    setDetectedTypeInfo(localDetection);
    setCategorySearchFilter('');
    setShowAddCategoryInline(false);
    setShowRenameCategoryInline(false);
    setTagsInput(initialTags.join(', '));
    setAdditionalImagesInput(extraImgs.join('\n'));
    setIsExistingEdit(Boolean(existingMatch));
    setExtractionWarnings(extracted.warnings || []);
    setFormError(null);
  };

  // Resolve relative `/products/...` URL using defaultStoreBaseUrl when fetching
  const resolveFullUrlForFetch = (rawInput: string): string => {
    const trimmed = rawInput.trim();
    if (trimmed.startsWith('/')) {
      return `${defaultStoreBaseUrl.replace(/\/+$/, '')}${trimmed}`;
    }
    return trimmed;
  };

  const handleFetchProductByUrl = async (
    e?: React.FormEvent,
    options: { forceIgnoreDuplicate?: boolean; useAiFallback?: boolean } = {}
  ) => {
    if (e) e.preventDefault();
    setFetchError(null);
    setFetchFallbackHint(null);

    const rawTrimmed = fetchUrlInput.trim();
    if (!rawTrimmed) {
      setFetchError('Please paste a product URL first.');
      return;
    }

    // Check for duplicate in catalog before fetching
    if (!options.forceIgnoreDuplicate) {
      const existingDup = findDuplicateProduct(products, rawTrimmed);
      if (existingDup) {
        setDuplicateWarningProduct(existingDup);
        return;
      }
    }
    setDuplicateWarningProduct(null);

    const fullFetchUrl = resolveFullUrlForFetch(rawTrimmed);
    const check = validateFetchableProductUrl(fullFetchUrl);
    if (!check.valid) {
      setFetchError(check.error || 'Invalid URL.');
      return;
    }

    setFetchingUrl(true);
    try {
      const res = await fetch('/api/products/fetch-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: check.normalizedUrl,
          useAiFallback: Boolean(options.useAiFallback),
          preferredModel: options.useAiFallback ? getSavedGeminiModelPreference() : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setFetchError(data.error || `Failed to fetch product URL (status ${res.status}).`);
        setFetchFallbackHint(
          data.fallbackHint ||
            'The store blocked automated requests or returned an error. You can paste the product details/HTML below or enter the product manually.'
        );
        setShowPasteFallbackBox(true);
        return;
      }

      const extracted = data.extracted as ExtractedProductData;
      const existingDup = findDuplicateProduct(products, extracted.productUrl, extracted.sku);
      openReviewModalFromExtracted(extracted, rawTrimmed, existingDup);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Network error while fetching URL.');
      setShowPasteFallbackBox(true);
    } finally {
      setFetchingUrl(false);
    }
  };

  const handleParsePastedProductHtml = async (useAiFallback = false) => {
    if (!pastedPageHtml.trim()) {
      setFetchError('Please paste the product page HTML or text details first.');
      return;
    }
    setFetchingUrl(true);
    setFetchError(null);
    try {
      const res = await fetch('/api/products/parse-html', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          html: pastedPageHtml,
          sourceUrl: fetchUrlInput.trim() || '/products/imported-product',
          useAiFallback,
          preferredModel: useAiFallback ? getSavedGeminiModelPreference() : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setFetchError(data.error || 'Could not parse pasted product HTML.');
        return;
      }
      const extracted = data.extracted as ExtractedProductData;
      const existingDup = findDuplicateProduct(
        products,
        fetchUrlInput.trim() || extracted.productUrl,
        extracted.sku
      );
      openReviewModalFromExtracted(
        extracted,
        fetchUrlInput.trim() || extracted.productUrl,
        existingDup
      );
      setShowPasteFallbackBox(false);
      setPastedPageHtml('');
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to parse pasted content.');
    } finally {
      setFetchingUrl(false);
    }
  };

  // Refresh an existing saved product from its URL
  const handleRefreshSavedProduct = async (prod: Product) => {
    const fullUrl = resolveFullUrlForFetch(prod.productUrl);
    const check = validateFetchableProductUrl(fullUrl);
    if (!check.valid) {
      onShowToast?.(`Cannot refresh "${prod.name}": ${check.error}`);
      return;
    }

    setRefreshingProductId(prod.id);
    try {
      const res = await fetch('/api/products/fetch-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: check.normalizedUrl, useAiFallback: false }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        onShowToast?.(
          `Refresh blocked or failed for "${prod.name}": ${data.error || 'Storefront unreachable'}. Existing data was preserved.`
        );
        return;
      }

      const extracted = data.extracted as ExtractedProductData;
      const { mergedProduct, changes, preservedFields } = mergeRefreshedProductData(
        prod,
        extracted
      );
      setRefreshReviewState({
        original: prod,
        merged: mergedProduct,
        changes,
        preservedFields,
        warnings: extracted.warnings || [],
      });
    } catch (err) {
      onShowToast?.(
        `Refresh failed for "${prod.name}": ${err instanceof Error ? err.message : 'Error'}. Existing data was preserved.`
      );
    } finally {
      setRefreshingProductId(null);
    }
  };

  const openNewProductModal = (prefillUrl = '') => {
    const initialDetection = detectProductType({ productUrl: prefillUrl });
    setEditingProduct({
      id: '',
      name: '',
      productUrl: prefillUrl || '/products/',
      imageUrl: '',
      imageUrls: [],
      price: '',
      originalPrice: '',
      currency: 'USD',
      productType: initialDetection.isConfident ? initialDetection.detectedType : 'Other',
      productTypeManualOverride: false,
      category: managedCategories[0] || 'General History',
      sku: '',
      tags: [],
      shortDescription: '',
      featuresSpecs: '',
      sourceNotes: '',
      variants: [],
      lastFetchedAt: new Date().toISOString(),
      dataSource: 'manual',
      fetchStatus: 'manual',
      archived: false,
    });
    setDetectedTypeInfo(initialDetection);
    setCategorySearchFilter('');
    setShowAddCategoryInline(false);
    setShowRenameCategoryInline(false);
    setTagsInput('');
    setAdditionalImagesInput('');
    setExtractionWarnings([]);
    setIsExistingEdit(false);
    setFormError(null);
  };

  const openEditProductModal = (prod: Product) => {
    const extraImgs = (prod.imageUrls || []).filter((u) => u !== prod.imageUrl);
    const localDetection = detectProductType({
      name: prod.name,
      productUrl: prod.productUrl,
      shortDescription: prod.shortDescription,
      featuresSpecs: prod.featuresSpecs,
      tags: prod.tags,
    });

    const hasExistingSpecificType = !isPlaceholderProductType(prod.productType);
    const resolvedType = hasExistingSpecificType
      ? findCanonicalOption(prod.productType, MANAGED_PRODUCT_TYPES) || prod.productType
      : localDetection.isConfident
      ? localDetection.detectedType
      : 'Other';

    const cleanCat = normalizeTaxonomyLabel(prod.category);
    const resolvedCat = cleanCat
      ? findCanonicalOption(cleanCat, managedCategories) || cleanCat
      : 'General History';

    setEditingProduct({
      id: prod.id,
      name: prod.name,
      productUrl: prod.productUrl,
      imageUrl: prod.imageUrl,
      imageUrls: prod.imageUrls || [],
      price: prod.price === 'Unavailable' ? '' : prod.price,
      originalPrice: prod.originalPrice || '',
      currency: prod.currency || 'USD',
      productType: resolvedType,
      productTypeManualOverride: hasExistingSpecificType
        ? prod.productTypeManualOverride ?? true
        : false,
      category: resolvedCat,
      sku: prod.sku || '',
      tags: prod.tags || [],
      shortDescription: prod.shortDescription,
      featuresSpecs: prod.featuresSpecs,
      sourceNotes: prod.sourceNotes,
      variants: prod.variants || [],
      lastFetchedAt: prod.lastFetchedAt,
      dataSource: prod.dataSource || 'manual',
      fetchStatus: prod.fetchStatus || 'manual',
      archived: prod.archived,
    });
    setDetectedTypeInfo(localDetection);
    setCategorySearchFilter('');
    setShowAddCategoryInline(false);
    setShowRenameCategoryInline(false);
    setTagsInput((prod.tags || []).join(', '));
    setAdditionalImagesInput(extraImgs.join('\n'));
    setExtractionWarnings([]);
    setIsExistingEdit(true);
    setFormError(null);
  };

  const handleSaveSingleProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;

    const name = editingProduct.name.trim();
    const url = editingProduct.productUrl.trim();
    const rawPrice = editingProduct.price.trim();

    if (!name) {
      setFormError('Product title is required.');
      return;
    }
    if (!isValidProductUrl(url)) {
      setFormError('Please provide a valid Fourthwall path (/products/...) or full https:// URL.');
      return;
    }

    // Check duplicate URL when creating a new record
    const duplicate = findDuplicateProduct(
      products,
      url,
      editingProduct.sku,
      isExistingEdit ? editingProduct.id : undefined
    );
    if (duplicate && !isExistingEdit) {
      setFormError(
        `A product with this URL or SKU already exists in your catalog ("${duplicate.name}"). Edit the existing record instead of creating a duplicate.`
      );
      return;
    }

    let formattedPrice = '';
    if (rawPrice && rawPrice.toLowerCase() !== 'unavailable') {
      const priceCheck = normalizePriceDisplay(rawPrice);
      formattedPrice = priceCheck.valid ? priceCheck.formatted : rawPrice;
    }

    const finalId =
      editingProduct.id.trim() || deriveStableProductId(url, name, products.length + 1);
    const parsedTags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 20);

    const extraImgs = additionalImagesInput
      .split(/\r?\n|,/)
      .map((u) => u.trim())
      .filter(Boolean);
    const allImageUrls = Array.from(
      new Set([
        ...(editingProduct.imageUrl.trim() ? [editingProduct.imageUrl.trim()] : []),
        ...extraImgs,
      ])
    ).slice(0, 12);

    const finalCategory =
      normalizeTaxonomyLabel(editingProduct.category) || 'General History';
    const rawSelectedType = normalizeTaxonomyLabel(editingProduct.productType);
    const finalProductType = !isPlaceholderProductType(rawSelectedType)
      ? findCanonicalOption(rawSelectedType, MANAGED_PRODUCT_TYPES) || rawSelectedType
      : detectProductType({
          name,
          productUrl: url,
          shortDescription: editingProduct.shortDescription,
          featuresSpecs: editingProduct.featuresSpecs,
          tags: parsedTags,
        }).detectedType;

    setSavingProduct(true);
    setFormError(null);
    try {
      await onSaveProduct(
        {
          ...editingProduct,
          id: finalId,
          name,
          productUrl: url,
          category: finalCategory,
          productType: finalProductType,
          productTypeManualOverride: Boolean(editingProduct.productTypeManualOverride),
          imageUrl: editingProduct.imageUrl.trim() || allImageUrls[0] || '',
          imageUrls: allImageUrls,
          price: formattedPrice,
          tags: parsedTags,
        },
        isExistingEdit
      );
      setEditingProduct(null);
      setFetchUrlInput('');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save product.');
    } finally {
      setSavingProduct(false);
    }
  };

  // Open Brief Generator Modal (100% local, zero AI API calls)
  const handleOpenBriefGenerator = (target: BriefAssistantTarget) => {
    if (selectedProductsList.length === 0) return;
    const generated = generateProductBrief(selectedProductsList, {
      target,
      guideTopic: '',
      additionalContext: '',
    });
    setBriefModalState({
      target,
      guideTopic: '',
      additionalContext: '',
      editableBriefText: generated,
      hasManualEdits: false,
    });
  };

  const handleUpdateBriefOptions = (
    target: BriefAssistantTarget,
    guideTopic: string,
    additionalContext: string
  ) => {
    const regenerated = generateProductBrief(selectedProductsList, {
      target,
      guideTopic,
      additionalContext,
    });
    setBriefModalState({
      target,
      guideTopic,
      additionalContext,
      editableBriefText: regenerated,
      hasManualEdits: false,
    });
  };

  const handleParseBatch = (text: string) => {
    setRawImportText(text);
    const report = parseProductImportBatch(text);
    setImportReport(report);
  };

  const handleCsvFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result || '');
      handleParseBatch(content);
    };
    reader.readAsText(file);
  };

  const handleCommitBatchImport = async () => {
    if (!importReport || importReport.validProducts.length === 0) return;
    setImportingBatch(true);
    try {
      await onBatchImportProducts(importReport.validProducts);
      setShowImportModal(false);
      setRawImportText('');
      setImportReport(null);
    } finally {
      setImportingBatch(false);
    }
  };

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-5">
      {/* TOP HEADER & SECONDARY ACTIONS */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#DED8CA] pb-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-[#1A567B] font-bold">
            Feature 1 · Reusable Storefront Catalog &amp; Brief Studio
          </p>
          <h1 className="text-2xl md:text-3xl font-editorial font-semibold text-[#111A27] mt-0.5">
            Product Catalog
          </h1>
          <p className="text-xs text-[#3E4C5E] mt-1 max-w-2xl">
            Import products by URL, maintain verified prices and specifications, and select products
            to generate structured briefs for ChatGPT or Gemini.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {products.length === 0 && (
            <button
              type="button"
              onClick={() => onBatchImportProducts(SEED_PRODUCTS)}
              className="sog-btn-powder"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Load 18 Reference Products</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setShowImportModal(true);
              setImportReport(null);
            }}
            className="sog-btn-secondary"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Import CSV / Roster</span>
          </button>
          <button
            type="button"
            onClick={() => openNewProductModal()}
            className="sog-btn-secondary"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Manually</span>
          </button>
        </div>
      </div>

      {/* 1.1 PROMINENT URL IMPORT BAR */}
      <div className="bg-[#EFF6FA] border border-[#94C0D6] rounded-xl p-4 space-y-3 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-[#123E59]" />
            <span className="text-xs font-bold text-[#111A27]">
              Import Product by URL
            </span>
            <span className="text-[11px] text-[#3E4C5E]">
              Extracts JSON-LD, Open Graph, variants, and specs for review before saving
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowPasteFallbackBox((prev) => !prev)}
            className="text-[11px] font-semibold text-[#123E59] hover:underline"
          >
            {showPasteFallbackBox ? 'Hide HTML Paste Fallback' : 'Page blocked? Paste HTML / Details instead'}
          </button>
        </div>

        <form onSubmit={(e) => handleFetchProductByUrl(e)} className="flex flex-wrap gap-2">
          <input
            type="text"
            value={fetchUrlInput}
            onChange={(e) => {
              setFetchUrlInput(e.target.value);
              if (duplicateWarningProduct) setDuplicateWarningProduct(null);
            }}
            placeholder="Paste Fourthwall or store product URL (e.g., https://scienceofgifts.com/products/hades-underworld-tee)..."
            className="flex-1 min-w-[260px] px-3.5 py-2 text-xs font-mono-tabular bg-white border border-[#94C0D6] rounded-lg text-[#111A27] focus:outline-none focus:border-[#123E59]"
          />
          <button
            type="submit"
            disabled={fetchingUrl}
            className="sog-btn-primary px-4 py-2"
          >
            <Globe className="w-3.5 h-3.5" />
            <span>{fetchingUrl ? 'Fetching Product...' : 'Fetch Product'}</span>
          </button>
        </form>

        {/* Duplicate URL warning banner */}
        {duplicateWarningProduct && (
          <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg flex flex-wrap items-center justify-between gap-3 text-xs text-amber-950">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
              <span>
                <strong>Duplicate URL Detected:</strong> &ldquo;{duplicateWarningProduct.name}&rdquo; (
                <code className="font-mono-tabular">{duplicateWarningProduct.productUrl}</code>) is
                already in your catalog.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  openEditProductModal(duplicateWarningProduct);
                  setDuplicateWarningProduct(null);
                }}
                className="sog-btn-secondary py-1 px-2.5"
              >
                Edit Existing Product
              </button>
              <button
                type="button"
                onClick={() => {
                  handleRefreshSavedProduct(duplicateWarningProduct);
                  setDuplicateWarningProduct(null);
                }}
                className="sog-btn-powder py-1 px-2.5"
              >
                Refresh Existing from URL
              </button>
              <button
                type="button"
                onClick={() =>
                  handleFetchProductByUrl(undefined, { forceIgnoreDuplicate: true })
                }
                className="text-[11px] font-semibold text-amber-900 hover:underline px-2"
              >
                Fetch Anyway
              </button>
            </div>
          </div>
        )}

        {/* Fetch Error & Fallback Options */}
        {fetchError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg space-y-2 text-xs text-red-900">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">{fetchError}</p>
                  {fetchFallbackHint && (
                    <p className="text-[11px] text-red-800 mt-0.5">{fetchFallbackHint}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => openNewProductModal(fetchUrlInput.trim())}
                  className="sog-btn-secondary py-1 px-2.5"
                >
                  Enter Manually
                </button>
                <button
                  type="button"
                  onClick={() => setFetchError(null)}
                  className="p-1 text-red-700 hover:text-red-950"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Fallback Paste HTML / Details Box when a storefront blocks automated requests */}
        {showPasteFallbackBox && (
          <div className="p-3.5 bg-white border border-[#B5D5E6] rounded-lg space-y-2.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[#111A27]">
                Fallback: Paste Product Page HTML Source or Product Details Text
              </span>
              <button
                type="button"
                onClick={() => setShowPasteFallbackBox(false)}
                className="text-[#5E6B7C] hover:text-[#111A27]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <textarea
              rows={4}
              value={pastedPageHtml}
              onChange={(e) => setPastedPageHtml(e.target.value)}
              placeholder="Paste the page's View-Source HTML (<script type='application/ld+json'>...) or raw product description/details here..."
              className="sog-input font-mono-tabular text-[11px]"
            />
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                disabled={fetchingUrl}
                onClick={() => handleParsePastedProductHtml(false)}
                className="sog-btn-primary"
              >
                Extract Structured Metadata
              </button>
              <button
                type="button"
                disabled={fetchingUrl}
                onClick={() => handleParsePastedProductHtml(true)}
                className="sog-btn-powder"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Extract with AI Fallback</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 1.4 SELECTION & BRIEF GENERATION ACTION BAR */}
      {selectedProductIds.size > 0 && (
        <div className="bg-[#162235] text-white px-4 py-3 rounded-xl flex flex-wrap items-center justify-between gap-3 shadow-sm border border-[#283A56]">
          <div className="flex items-center gap-3 text-xs">
            <span className="px-2.5 py-1 bg-[#DFEEF5] text-[#111A27] font-mono-tabular font-bold rounded-md">
              {selectedProductIds.size} selected
            </span>
            <span className="text-[#C6D3E3]">
              Generate a structured, factual brief containing only the selected products (runs locally, zero AI API calls):
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleOpenBriefGenerator('chatgpt')}
              className="px-3.5 py-1.5 bg-[#E1F2EA] hover:bg-[#CFEAD9] text-[#134634] font-semibold text-xs rounded-lg inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Generate ChatGPT Brief</span>
            </button>
            <button
              type="button"
              onClick={() => handleOpenBriefGenerator('gemini')}
              className="px-3.5 py-1.5 bg-[#DFEEF5] hover:bg-[#CBE3EE] text-[#111A27] font-semibold text-xs rounded-lg inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Generate Gemini Brief</span>
            </button>
            <button
              type="button"
              onClick={() => setSelectedProductIds(new Set())}
              className="px-2.5 py-1.5 text-xs text-[#C6D3E3] hover:text-white hover:bg-[#24344D] rounded-lg transition-colors"
            >
              Clear Selection
            </button>
          </div>
        </div>
      )}

      {/* SEARCH, FILTER & SORT TOOLBAR */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#F3EFE6] p-3 border border-[#D5CFC0] rounded-xl text-xs">
        <div className="flex items-center gap-2.5 flex-1 min-w-[260px]">
          <button
            type="button"
            onClick={toggleSelectAllFiltered}
            className="sog-btn-secondary py-1.5 px-2.5"
            title="Select or deselect all filtered products"
          >
            {filteredProducts.length > 0 &&
            filteredProducts.every((p) => selectedProductIds.has(p.id)) ? (
              <CheckSquare className="w-3.5 h-3.5 text-[#1A567B]" />
            ) : (
              <Square className="w-3.5 h-3.5 text-[#5E6B7C]" />
            )}
            <span>Select All ({filteredProducts.length})</span>
          </button>

          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#5E6B7C] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by title, URL, category, SKU, notes, or tag..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-[#C8C0B0] rounded-lg focus:outline-none focus:border-[#1A567B]"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            aria-label="Filter by category"
            className="px-2.5 py-1.5 bg-white border border-[#C8C0B0] rounded-lg text-[#1D2838] font-medium focus:outline-none"
          >
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat === 'ALL' ? 'All Categories' : cat}
              </option>
            ))}
          </select>

          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            aria-label="Filter by product type"
            className="px-2.5 py-1.5 bg-white border border-[#C8C0B0] rounded-lg text-[#1D2838] font-medium focus:outline-none"
          >
            {productTypes.map((t) => (
              <option key={t} value={t}>
                {t === 'ALL' ? 'All Types' : t}
              </option>
            ))}
          </select>

          <div className="inline-flex items-center gap-1 bg-white border border-[#C8C0B0] rounded-lg px-2 py-1">
            <ArrowUpDown className="w-3.5 h-3.5 text-[#5E6B7C]" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              aria-label="Sort products"
              className="bg-transparent text-[#1D2838] font-medium focus:outline-none"
            >
              <option value="name_asc">Sort: Title (A–Z)</option>
              <option value="updated_desc">Sort: Recently Fetched</option>
              <option value="price_asc">Sort: Price (Low → High)</option>
              <option value="price_desc">Sort: Price (High → Low)</option>
              <option value="category_asc">Sort: Category</option>
            </select>
          </div>

          <div className="flex items-center gap-1 p-0.5 bg-[#E5DEC9] rounded-lg">
            <button
              type="button"
              onClick={() => setShowArchived(false)}
              className={`px-2.5 py-1 rounded-md font-semibold transition-colors whitespace-nowrap shrink-0 ${
                !showArchived
                  ? 'bg-[#DFEEF5] text-[#123E59]'
                  : 'text-[#3E4C5E] hover:text-[#111A27]'
              }`}
            >
              Active ({products.filter((p) => !p.archived).length})
            </button>
            <button
              type="button"
              onClick={() => setShowArchived(true)}
              className={`px-2.5 py-1 rounded-md font-semibold transition-colors whitespace-nowrap shrink-0 ${
                showArchived
                  ? 'bg-[#DFEEF5] text-[#123E59]'
                  : 'text-[#3E4C5E] hover:text-[#111A27]'
              }`}
            >
              Archived ({products.filter((p) => p.archived).length})
            </button>
          </div>
        </div>
      </div>

      {/* PRODUCT CATALOG TABLE / COMPACT CARDS */}
      {filteredProducts.length === 0 ? (
        <div className="bg-white border border-[#DED8CA] rounded-xl p-12 text-center space-y-3">
          <h2 className="text-lg font-editorial font-semibold text-[#111A27]">
            {products.length === 0
              ? 'Your Product Catalog is empty'
              : 'No products match your current filter'}
          </h2>
          <p className="text-xs text-[#3E4C5E] max-w-md mx-auto">
            {products.length === 0
              ? 'Paste a product URL above and click Fetch Product, upload a CSV roster, or load the 18 reference Greek Mythology products.'
              : 'Try clearing your search query or switching category filters.'}
          </p>
        </div>
      ) : (
        <div className="bg-white border border-[#DED8CA] rounded-xl overflow-hidden shadow-2xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-[#F3EFE6] text-[#334155] border-b border-[#DED8CA]">
                <tr>
                  <th className="py-2.5 px-3 w-10">
                    <input
                      type="checkbox"
                      checked={
                        filteredProducts.length > 0 &&
                        filteredProducts.every((p) => selectedProductIds.has(p.id))
                      }
                      onChange={toggleSelectAllFiltered}
                      aria-label="Select all visible products"
                      className="rounded border-[#B8B0A0]"
                    />
                  </th>
                  <th className="py-2.5 px-3">Product</th>
                  <th className="py-2.5 px-3">Price</th>
                  <th className="py-2.5 px-3">Category &amp; Tags</th>
                  <th className="py-2.5 px-3">Specs &amp; Notes</th>
                  <th className="py-2.5 px-3">Status / Updated</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAE4D8]">
                {filteredProducts.map((prod) => {
                  const isSelected = selectedProductIds.has(prod.id);
                  const previewThumb = prod.imageUrl?.trim()
                    ? prod.imageUrl
                    : buildEditorialSvgDataUri(prod.name, prod.category || prod.productType);
                  const hasValidPrice =
                    prod.price && prod.price.trim() !== '' && prod.price !== 'Unavailable';
                  const isRefreshing = refreshingProductId === prod.id;

                  return (
                    <tr
                      key={prod.id}
                      className={`transition-colors ${
                        isSelected ? 'bg-[#EFF6FA]' : 'hover:bg-[#FAF8F3]'
                      }`}
                    >
                      <td className="py-3 px-3 align-top">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleProductSelection(prod.id)}
                          aria-label={`Select ${prod.name}`}
                          className="rounded border-[#B8B0A0] mt-1"
                        />
                      </td>

                      {/* Thumbnail + Title + URL */}
                      <td className="py-3 px-3 align-top max-w-[320px]">
                        <div className="flex items-start gap-3">
                          <img
                            src={previewThumb}
                            alt={prod.name}
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).src = buildEditorialSvgDataUri(
                                prod.name,
                                prod.category || 'Product'
                              );
                            }}
                            className="w-12 h-12 rounded-lg object-cover bg-[#F4F0E6] border border-[#DED8CA] shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <button
                              type="button"
                              onClick={() => openEditProductModal(prod)}
                              className="text-left font-editorial font-semibold text-sm text-[#111A27] hover:text-[#1A567B] leading-snug line-clamp-2"
                            >
                              {prod.name}
                            </button>
                            <div className="flex items-center gap-1.5 mt-0.5 text-[11px] font-mono-tabular text-[#5E6B7C]">
                              <span className="truncate max-w-[220px]" title={prod.productUrl}>
                                {prod.productUrl}
                              </span>
                              <a
                                href={resolveFullUrlForFetch(prod.productUrl)}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Open product page in new tab"
                                className="text-[#1A567B] hover:text-[#111A27] shrink-0"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                            {prod.variants && prod.variants.length > 0 && (
                              <p className="text-[11px] text-[#5E6B7C] mt-0.5">
                                {prod.variants.length} variant(s) stored
                              </p>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Price */}
                      <td className="py-3 px-3 align-top whitespace-nowrap font-mono-tabular">
                        {hasValidPrice ? (
                          <div>
                            <span className="font-bold text-[#111A27]">{prod.price}</span>
                            {prod.originalPrice && prod.originalPrice !== prod.price && (
                              <span className="block text-[11px] text-[#64748B] line-through">
                                {prod.originalPrice}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[11px] text-[#64748B] italic">Unavailable</span>
                        )}
                      </td>

                      {/* Category & Tags (Unboxed metadata per Zero-Pill rule) */}
                      <td className="py-3 px-3 align-top max-w-[200px]">
                        <div className="text-[#111A27] font-medium">
                          <span>{prod.category || 'Uncategorized'}</span>
                          {prod.productType && prod.productType !== 'General' && (
                            <>
                              <span className="mx-1 text-[#64748B]">·</span>
                              <span className="text-[#334155] font-normal">{prod.productType}</span>
                            </>
                          )}
                        </div>
                        {prod.tags && prod.tags.length > 0 && (
                          <p className="text-[11px] text-[#5E6B7C] mt-0.5 truncate">
                            {prod.tags.join(' · ')}
                          </p>
                        )}
                      </td>

                      {/* Specs & Custom Notes */}
                      <td className="py-3 px-3 align-top max-w-[260px]">
                        {prod.featuresSpecs ? (
                          <p className="text-[11px] text-[#334155] line-clamp-2">
                            {prod.featuresSpecs}
                          </p>
                        ) : (
                          <p className="text-[11px] text-[#64748B] italic">No specs recorded</p>
                        )}
                        {prod.sourceNotes && (
                          <p className="text-[11px] text-[#123E59] mt-1 line-clamp-1">
                            Note: {prod.sourceNotes}
                          </p>
                        )}
                      </td>

                      {/* Status & Last Updated */}
                      <td className="py-3 px-3 align-top whitespace-nowrap text-[11px] text-[#5E6B7C]">
                        <div className="font-medium text-[#111A27]">
                          {formatTimestampShort(prod.updatedAt, prod.lastFetchedAt)}
                        </div>
                        <div>
                          {prod.dataSource === 'json_ld'
                            ? 'JSON-LD'
                            : prod.dataSource === 'open_graph'
                            ? 'Open Graph'
                            : prod.dataSource === 'ai_fallback'
                            ? 'AI Assisted'
                            : prod.dataSource === 'csv_import'
                            ? 'CSV Import'
                            : 'Catalog'}
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-3 align-top text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            disabled={isRefreshing}
                            onClick={() => handleRefreshSavedProduct(prod)}
                            title="Refresh product details from source URL"
                            className="inline-flex items-center gap-1 px-2 py-1 text-[#123E59] bg-[#DFEEF5]/60 hover:bg-[#DFEEF5] rounded font-semibold transition-colors"
                          >
                            <RefreshCw
                              className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`}
                            />
                            <span>{isRefreshing ? 'Refreshing' : 'Refresh'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => openEditProductModal(prod)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[#111A27] hover:bg-[#F2EDE2] rounded font-semibold transition-colors"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>Edit</span>
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              onSaveProduct({ ...prod, archived: !prod.archived }, true)
                            }
                            title={prod.archived ? 'Restore product' : 'Archive product'}
                            className="p-1 text-[#5E6B7C] hover:text-[#111A27] hover:bg-[#F2EDE2] rounded transition-colors"
                          >
                            {prod.archived ? (
                              <RotateCcw className="w-3.5 h-3.5" />
                            ) : (
                              <Archive className="w-3.5 h-3.5" />
                            )}
                          </button>

                          {confirmDeleteId === prod.id ? (
                            <div className="inline-flex items-center gap-1 ml-1">
                              <button
                                type="button"
                                onClick={async () => {
                                  await onDeleteProduct(prod.id);
                                  setSelectedProductIds((prev) => {
                                    const next = new Set(prev);
                                    next.delete(prod.id);
                                    return next;
                                  });
                                  setConfirmDeleteId(null);
                                }}
                                className="px-2 py-1 bg-red-600 text-white rounded text-[11px] font-semibold"
                              >
                                Confirm Delete
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="px-1.5 py-1 text-[#5E6B7C] hover:text-[#111A27] text-[11px]"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(prod.id)}
                              title="Delete product"
                              className="p-1 text-[#5E6B7C] hover:text-red-600 rounded transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL 1: REVIEW & EDIT EXTRACTED / MANUAL PRODUCT */}
      {editingProduct && (
        <div className="fixed inset-0 z-50 bg-[#111A27]/60 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="bg-[#FBF9F5] border border-[#C6BEB0] rounded-xl max-w-3xl w-full max-h-[92vh] overflow-y-auto p-6 space-y-4 shadow-xl text-xs">
            <div className="flex items-center justify-between border-b border-[#DED8CA] pb-3">
              <div>
                <h2 className="text-lg font-editorial font-semibold text-[#111A27]">
                  {isExistingEdit ? 'Edit Catalog Product' : 'Review & Save Product to Catalog'}
                </h2>
                <p className="text-[11px] text-[#5E6B7C] mt-0.5">
                  Source: <strong className="text-[#111A27]">{editingProduct.dataSource || 'manual'}</strong> ·
                  Status: <strong className="text-[#111A27]">{editingProduct.fetchStatus || 'manual'}</strong>
                  {editingProduct.lastFetchedAt && (
                    <> · Fetched: {formatTimestampShort(undefined, editingProduct.lastFetchedAt)}</>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingProduct(null)}
                className="p-1 text-[#5E6B7C] hover:text-[#111A27]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {extractionWarnings.length > 0 && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-1 text-amber-950">
                <p className="font-semibold flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-700" />
                  <span>Extraction Notes (Missing fields were left blank—never fabricated):</span>
                </p>
                <ul className="list-disc list-inside text-[11px] space-y-0.5">
                  {extractionWarnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {formError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSaveSingleProduct} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                <div className="md:col-span-2">
                  <label className="sog-label">Product Title *</label>
                  <input
                    type="text"
                    required
                    value={editingProduct.name}
                    onChange={(e) => {
                      const nextName = e.target.value;
                      const nextDetection = detectProductType({
                        name: nextName,
                        productUrl: editingProduct.productUrl,
                        shortDescription: editingProduct.shortDescription,
                        featuresSpecs: editingProduct.featuresSpecs,
                      });
                      setDetectedTypeInfo(nextDetection);
                      setEditingProduct({
                        ...editingProduct,
                        name: nextName,
                        productType: editingProduct.productTypeManualOverride
                          ? editingProduct.productType
                          : nextDetection.isConfident
                          ? nextDetection.detectedType
                          : editingProduct.productType || 'Other',
                      });
                    }}
                    placeholder="e.g., Hades Ruler of the Underworld Tee"
                    className="sog-input"
                  />
                </div>

                <div>
                  <label className="sog-label">SKU / Identifier</label>
                  <input
                    type="text"
                    value={editingProduct.sku || ''}
                    onChange={(e) =>
                      setEditingProduct({ ...editingProduct, sku: e.target.value })
                    }
                    placeholder="Optional SKU"
                    className="sog-input font-mono-tabular"
                  />
                </div>

                <div className="md:col-span-3">
                  <label className="sog-label">
                    Canonical Product URL (`/products/...` or `https://...`) *
                  </label>
                  <input
                    type="text"
                    required
                    value={editingProduct.productUrl}
                    onChange={(e) => {
                      const nextUrl = e.target.value;
                      const nextDetection = detectProductType({
                        name: editingProduct.name,
                        productUrl: nextUrl,
                        shortDescription: editingProduct.shortDescription,
                        featuresSpecs: editingProduct.featuresSpecs,
                      });
                      setDetectedTypeInfo(nextDetection);
                      setEditingProduct({
                        ...editingProduct,
                        productUrl: nextUrl,
                        productType: editingProduct.productTypeManualOverride
                          ? editingProduct.productType
                          : nextDetection.isConfident
                          ? nextDetection.detectedType
                          : editingProduct.productType || 'Other',
                      });
                    }}
                    placeholder="/products/hades-greek-mythology-shirt-ruler-of-the-underworld-t-shirt"
                    className="sog-input font-mono-tabular"
                  />
                </div>

                <div>
                  <label className="sog-label">
                    Current Price (Leave blank if unavailable)
                  </label>
                  <input
                    type="text"
                    value={editingProduct.price}
                    onChange={(e) =>
                      setEditingProduct({ ...editingProduct, price: e.target.value })
                    }
                    placeholder="e.g., $24.90"
                    className="sog-input font-mono-tabular"
                  />
                </div>

                <div>
                  <label className="sog-label">Original / Compare-At Price</label>
                  <input
                    type="text"
                    value={editingProduct.originalPrice || ''}
                    onChange={(e) =>
                      setEditingProduct({ ...editingProduct, originalPrice: e.target.value })
                    }
                    placeholder="Optional (e.g., $29.90)"
                    className="sog-input font-mono-tabular"
                  />
                </div>

                <div>
                  <label className="sog-label">Currency</label>
                  <input
                    type="text"
                    value={editingProduct.currency}
                    onChange={(e) =>
                      setEditingProduct({ ...editingProduct, currency: e.target.value })
                    }
                    placeholder="USD"
                    className="sog-input font-mono-tabular"
                  />
                </div>

                {/* Searchable Category / Theme Dropdown + Add / Rename Category */}
                <div>
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <label className="sog-label mb-0">Category / Theme</label>
                    <div className="flex items-center gap-2 text-[11px]">
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddCategoryInline((prev) => !prev);
                          setShowRenameCategoryInline(false);
                          setNewCategoryNameInput('');
                        }}
                        className="font-semibold text-[#1A567B] hover:underline"
                      >
                        + Add New
                      </button>
                      {editingProduct.category && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowRenameCategoryInline((prev) => !prev);
                            setShowAddCategoryInline(false);
                            setRenameCategoryDraft(editingProduct.category);
                          }}
                          className="text-[#5E6B7C] hover:text-[#111A27] hover:underline"
                          title="Rename this category across the catalog"
                        >
                          Rename
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <input
                      type="text"
                      value={categorySearchFilter}
                      onChange={(e) => setCategorySearchFilter(e.target.value)}
                      placeholder="Filter categories..."
                      aria-label="Filter categories"
                      className="sog-input py-1 text-[11px]"
                    />
                    <select
                      value={editingProduct.category}
                      onChange={(e) =>
                        setEditingProduct({ ...editingProduct, category: e.target.value })
                      }
                      aria-label="Category / Theme"
                      className="sog-input"
                    >
                      {(() => {
                        const filterKey = categorySearchFilter.trim().toLowerCase();
                        const currentCat = normalizeTaxonomyLabel(editingProduct.category);
                        const filteredManaged = managedCategories.filter(
                          (c) =>
                            !filterKey ||
                            c.toLowerCase().includes(filterKey) ||
                            toTaxonomyKey(c) === toTaxonomyKey(currentCat)
                        );
                        const filteredUncataloged = uncatalogedCategories.filter(
                          (c) =>
                            !filterKey ||
                            c.toLowerCase().includes(filterKey) ||
                            toTaxonomyKey(c) === toTaxonomyKey(currentCat)
                        );
                        const isCurrentInEither =
                          findCanonicalOption(currentCat, filteredManaged) ||
                          findCanonicalOption(currentCat, filteredUncataloged);

                        return (
                          <>
                            <option value="">Select a category...</option>
                            {currentCat && !isCurrentInEither && (
                              <option value={currentCat}>
                                {currentCat} (Preserved from product)
                              </option>
                            )}
                            <optgroup label="Managed Categories">
                              {filteredManaged.map((cat) => (
                                <option key={cat} value={cat}>
                                  {cat}
                                </option>
                              ))}
                            </optgroup>
                            {filteredUncataloged.length > 0 && (
                              <optgroup label="Existing Product Categories (Not Yet in Managed List)">
                                {filteredUncataloged.map((cat) => (
                                  <option key={`uncat-${cat}`} value={cat}>
                                    {cat}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </>
                        );
                      })()}
                    </select>

                    {/* Prompt to add uncataloged existing product category to managed options */}
                    {editingProduct.category &&
                      !findCanonicalOption(editingProduct.category, managedCategories) && (
                        <div className="flex items-center justify-between gap-2 px-2 py-1 bg-[#EFF6FA] border border-[#94C0D6] rounded text-[11px] text-[#123E59]">
                          <span className="truncate">
                            &ldquo;{editingProduct.category}&rdquo; is not in managed options yet.
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const res = addManagedCategory(
                                editingProduct.category,
                                managedCategories
                              );
                              setManagedCategories(res.categories);
                              setEditingProduct({
                                ...editingProduct,
                                category: res.canonicalName,
                              });
                              onShowToast?.(
                                `Added "${res.canonicalName}" to managed categories.`
                              );
                            }}
                            className="font-semibold underline shrink-0 hover:text-[#111A27]"
                          >
                            + Add to Managed List
                          </button>
                        </div>
                      )}

                    {/* Inline Add New Category */}
                    {showAddCategoryInline && (
                      <div className="p-2 bg-[#F3EFE6] border border-[#D5CFC0] rounded-lg space-y-1.5">
                        <label className="block text-[11px] font-semibold text-[#111A27]">
                          New Category Name
                        </label>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={newCategoryNameInput}
                            onChange={(e) => setNewCategoryNameInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                const res = addManagedCategory(
                                  newCategoryNameInput,
                                  managedCategories
                                );
                                if (res.canonicalName) {
                                  setManagedCategories(res.categories);
                                  setEditingProduct({
                                    ...editingProduct,
                                    category: res.canonicalName,
                                  });
                                  setShowAddCategoryInline(false);
                                  setNewCategoryNameInput('');
                                  onShowToast?.(
                                    res.added
                                      ? `Created category "${res.canonicalName}".`
                                      : `Selected existing category "${res.canonicalName}".`
                                  );
                                }
                              }
                            }}
                            placeholder="e.g., Cold War, Ancient Egypt"
                            className="sog-input py-1 text-[11px] flex-1"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const res = addManagedCategory(
                                newCategoryNameInput,
                                managedCategories
                              );
                              if (res.canonicalName) {
                                setManagedCategories(res.categories);
                                setEditingProduct({
                                  ...editingProduct,
                                  category: res.canonicalName,
                                });
                                setShowAddCategoryInline(false);
                                setNewCategoryNameInput('');
                                onShowToast?.(
                                  res.added
                                    ? `Created category "${res.canonicalName}".`
                                    : `Selected existing category "${res.canonicalName}".`
                                );
                              }
                            }}
                            className="sog-btn-primary py-1 px-2.5 text-[11px]"
                          >
                            Add
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowAddCategoryInline(false)}
                            className="text-[11px] text-[#5E6B7C] hover:text-[#111A27] px-1"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Inline Rename Category (preserves product associations) */}
                    {showRenameCategoryInline && editingProduct.category && (
                      <div className="p-2 bg-[#F3EFE6] border border-[#D5CFC0] rounded-lg space-y-1.5">
                        <label className="block text-[11px] font-semibold text-[#111A27]">
                          Rename &ldquo;{editingProduct.category}&rdquo; across catalog
                        </label>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={renameCategoryDraft}
                            onChange={(e) => setRenameCategoryDraft(e.target.value)}
                            placeholder="New category name..."
                            className="sog-input py-1 text-[11px] flex-1"
                          />
                          <button
                            type="button"
                            onClick={async () => {
                              const res = renameManagedCategory(
                                editingProduct.category,
                                renameCategoryDraft,
                                products,
                                managedCategories
                              );
                              setManagedCategories(res.categories);
                              setEditingProduct({
                                ...editingProduct,
                                category: res.canonicalNewName,
                              });
                              setShowRenameCategoryInline(false);
                              if (res.changedProducts.length > 0) {
                                await onBatchImportProducts(res.changedProducts);
                              }
                              onShowToast?.(
                                `Renamed category to "${res.canonicalNewName}" (${res.changedProducts.length} product(s) updated).`
                              );
                            }}
                            className="sog-btn-primary py-1 px-2.5 text-[11px]"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowRenameCategoryInline(false)}
                            className="text-[11px] text-[#5E6B7C] hover:text-[#111A27] px-1"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Product Type Dropdown with Automatic Local Detection & Manual Override Preservation */}
                <div>
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <label className="sog-label mb-0">Product Type</label>
                    <button
                      type="button"
                      onClick={() => {
                        const redetected = detectProductType({
                          name: editingProduct.name,
                          productUrl: editingProduct.productUrl,
                          shortDescription: editingProduct.shortDescription,
                          featuresSpecs: editingProduct.featuresSpecs,
                          tags: editingProduct.tags,
                        });
                        setDetectedTypeInfo(redetected);
                        setEditingProduct({
                          ...editingProduct,
                          productType: redetected.isConfident
                            ? redetected.detectedType
                            : 'Other',
                          productTypeManualOverride: false,
                        });
                      }}
                      className="text-[11px] font-semibold text-[#1A567B] hover:underline"
                      title="Re-detect product type from title and URL"
                    >
                      Auto-Detect
                    </button>
                  </div>

                  <select
                    value={editingProduct.productType || 'Other'}
                    onChange={(e) =>
                      setEditingProduct({
                        ...editingProduct,
                        productType: e.target.value,
                        productTypeManualOverride: true,
                      })
                    }
                    aria-label="Product Type"
                    className="sog-input"
                  >
                    {editingProduct.productType &&
                      !findCanonicalOption(
                        editingProduct.productType,
                        MANAGED_PRODUCT_TYPES
                      ) && (
                        <option value={editingProduct.productType}>
                          {editingProduct.productType} (Preserved custom type)
                        </option>
                      )}
                    {MANAGED_PRODUCT_TYPES.map((typeOpt) => (
                      <option key={typeOpt} value={typeOpt}>
                        {typeOpt}
                      </option>
                    ))}
                  </select>

                  <p className="text-[11px] text-[#5E6B7C] mt-1">
                    {editingProduct.productTypeManualOverride ? (
                      <span>
                        Manual selection locked (preserved during edits &amp; URL refreshes)
                      </span>
                    ) : detectedTypeInfo?.isConfident ? (
                      <span className="text-[#134634]">
                        Auto-detected <strong>{detectedTypeInfo.detectedType}</strong> from{' '}
                        {detectedTypeInfo.matchedSource.replace('_', ' ')}
                      </span>
                    ) : (
                      <span>Could not confidently infer specific type — defaulted to Other</span>
                    )}
                  </p>
                </div>

                <div>
                  <label className="sog-label">Tags (comma-separated)</label>
                  <input
                    type="text"
                    value={tagsInput}
                    onChange={(e) => setTagsInput(e.target.value)}
                    placeholder="hades, underworld, apparel"
                    className="sog-input"
                  />
                </div>

                <div className="md:col-span-3">
                  <label className="sog-label">Primary Image URL</label>
                  <input
                    type="text"
                    value={editingProduct.imageUrl}
                    onChange={(e) =>
                      setEditingProduct({ ...editingProduct, imageUrl: e.target.value })
                    }
                    placeholder="https://... (or leave blank for Fourthwall data-product-url auto-image)"
                    className="sog-input font-mono-tabular"
                  />
                </div>

                <div className="md:col-span-3">
                  <label className="sog-label">Additional Gallery Image URLs (one per line)</label>
                  <textarea
                    rows={2}
                    value={additionalImagesInput}
                    onChange={(e) => setAdditionalImagesInput(e.target.value)}
                    placeholder="https://..."
                    className="sog-input font-mono-tabular text-[11px]"
                  />
                </div>

                <div className="md:col-span-3">
                  <label className="sog-label">Product Description</label>
                  <textarea
                    rows={2}
                    value={editingProduct.shortDescription}
                    onChange={(e) =>
                      setEditingProduct({
                        ...editingProduct,
                        shortDescription: e.target.value,
                      })
                    }
                    placeholder="Factual product summary..."
                    className="sog-input"
                  />
                </div>

                <div className="md:col-span-3">
                  <label className="sog-label">
                    Verified Specifications (Materials, dimensions, print details)
                  </label>
                  <textarea
                    rows={2}
                    value={editingProduct.featuresSpecs}
                    onChange={(e) =>
                      setEditingProduct({
                        ...editingProduct,
                        featuresSpecs: e.target.value,
                      })
                    }
                    placeholder="e.g., 9.4 oz heavyweight brushed fleece • Relaxed unisex fit"
                    className="sog-input"
                  />
                </div>

                {/* Variants Editor (Preserves variant-specific pricing separately) */}
                <div className="md:col-span-3 bg-[#F3EFE6] border border-[#D5CFC0] rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[#111A27]">
                      Variants &amp; Variant-Specific Pricing ({editingProduct.variants?.length || 0})
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const nextVars: ProductVariant[] = [
                          ...(editingProduct.variants || []),
                          {
                            id: `var-${Date.now()}`,
                            title: '',
                            price: editingProduct.price || '',
                            sku: '',
                            available: true,
                          },
                        ];
                        setEditingProduct({ ...editingProduct, variants: nextVars });
                      }}
                      className="text-[#123E59] font-semibold hover:underline"
                    >
                      + Add Variant Row
                    </button>
                  </div>

                  {editingProduct.variants && editingProduct.variants.length > 0 && (
                    <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                      {editingProduct.variants.map((v, idx) => (
                        <div key={v.id || idx} className="grid grid-cols-12 gap-2 items-center">
                          <input
                            type="text"
                            value={v.title}
                            onChange={(e) => {
                              const next = [...(editingProduct.variants || [])];
                              next[idx] = { ...v, title: e.target.value };
                              setEditingProduct({ ...editingProduct, variants: next });
                            }}
                            placeholder="Size / Color (e.g., Black / XL)"
                            className="col-span-5 sog-input py-1 text-[11px]"
                          />
                          <input
                            type="text"
                            value={v.price || ''}
                            onChange={(e) => {
                              const next = [...(editingProduct.variants || [])];
                              next[idx] = { ...v, price: e.target.value };
                              setEditingProduct({ ...editingProduct, variants: next });
                            }}
                            placeholder="Variant Price ($24.90)"
                            className="col-span-3 sog-input py-1 text-[11px] font-mono-tabular"
                          />
                          <input
                            type="text"
                            value={v.sku || ''}
                            onChange={(e) => {
                              const next = [...(editingProduct.variants || [])];
                              next[idx] = { ...v, sku: e.target.value };
                              setEditingProduct({ ...editingProduct, variants: next });
                            }}
                            placeholder="Variant SKU"
                            className="col-span-3 sog-input py-1 text-[11px] font-mono-tabular"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const next = (editingProduct.variants || []).filter(
                                (_, i) => i !== idx
                              );
                              setEditingProduct({ ...editingProduct, variants: next });
                            }}
                            className="col-span-1 text-[#5E6B7C] hover:text-red-600 flex justify-center"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="md:col-span-3">
                  <label className="sog-label">
                    Custom Notes (Preserved during URL refreshes and included in AI briefs)
                  </label>
                  <textarea
                    rows={2}
                    value={editingProduct.sourceNotes}
                    onChange={(e) =>
                      setEditingProduct({ ...editingProduct, sourceNotes: e.target.value })
                    }
                    placeholder="Editorial angles, target audience notes, or internal reminders..."
                    className="sog-input"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#DED8CA]">
                <button
                  type="button"
                  onClick={() => setEditingProduct(null)}
                  className="sog-btn-secondary"
                >
                  Cancel
                </button>
                <button type="submit" disabled={savingProduct} className="sog-btn-mint">
                  {savingProduct ? 'Saving...' : 'Confirm & Save to Catalog'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: REFRESH REVIEW & DIFF CONFIRMATION */}
      {refreshReviewState && (
        <div className="fixed inset-0 z-50 bg-[#111A27]/60 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="bg-[#FBF9F5] border border-[#C6BEB0] rounded-xl max-w-2xl w-full p-6 space-y-4 shadow-xl text-xs">
            <div className="flex items-center justify-between border-b border-[#DED8CA] pb-3">
              <div>
                <h2 className="text-lg font-editorial font-semibold text-[#111A27]">
                  Review Refreshed Product Data
                </h2>
                <p className="text-[#5E6B7C] mt-0.5">
                  {refreshReviewState.original.name} (
                  <code className="font-mono-tabular">
                    {refreshReviewState.original.productUrl}
                  </code>
                  )
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRefreshReviewState(null)}
                className="p-1 text-[#5E6B7C] hover:text-[#111A27]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {refreshReviewState.changes.length === 0 ? (
              <div className="p-4 bg-[#E1F2EA] border border-[#96CDB0] rounded-lg text-[#134634] flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>
                  All extracted fields match your existing catalog record. Clicking Confirm will
                  update the last-fetched timestamp while preserving your custom notes.
                </span>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="font-semibold text-[#111A27]">
                  Detected Changes ({refreshReviewState.changes.length}):
                </p>
                <div className="border border-[#DED8CA] rounded-lg overflow-hidden bg-white">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-[#F3EFE6] border-b border-[#DED8CA] text-[#334155]">
                      <tr>
                        <th className="py-2 px-3">Field</th>
                        <th className="py-2 px-3">Previous Value</th>
                        <th className="py-2 px-3">Refreshed Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EAE4D8]">
                      {refreshReviewState.changes.map((ch) => (
                        <tr key={ch.field}>
                          <td className="py-2 px-3 font-semibold text-[#111A27]">{ch.label}</td>
                          <td className="py-2 px-3 text-[#64748B] line-clamp-2">
                            {ch.previousValue}
                          </td>
                          <td className="py-2 px-3 text-[#134634] font-medium line-clamp-2">
                            {ch.newValue}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {refreshReviewState.preservedFields.length > 0 && (
              <p className="text-[11px] text-[#3E4C5E]">
                <strong>Safely Preserved (Not Overwritten):</strong>{' '}
                {refreshReviewState.preservedFields.join(', ')}
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#DED8CA]">
              <button
                type="button"
                onClick={() => setRefreshReviewState(null)}
                className="sog-btn-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const { ownerId: _o, createdAt: _c, updatedAt: _u, ...clean } =
                    refreshReviewState.merged;
                  await onSaveProduct(clean, true);
                  setRefreshReviewState(null);
                }}
                className="sog-btn-mint"
              >
                Apply Refresh &amp; Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: STRUCTURED CHATGPT / GEMINI BRIEF GENERATOR */}
      {briefModalState && (
        <div className="fixed inset-0 z-50 bg-[#111A27]/60 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="bg-[#FBF9F5] border border-[#C6BEB0] rounded-xl max-w-4xl w-full max-h-[92vh] flex flex-col p-6 space-y-4 shadow-xl text-xs">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#DED8CA] pb-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.12em] text-[#1A567B] font-bold">
                  Local Brief Generator · {selectedProductsList.length} Selected Product(s)
                </p>
                <h2 className="text-lg font-editorial font-semibold text-[#111A27] mt-0.5">
                  {briefModalState.target === 'chatgpt'
                    ? 'Structured Product Brief for ChatGPT'
                    : 'Structured Product Brief for Gemini'}
                </h2>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 p-1 bg-[#E5DEC9] rounded-lg">
                  <button
                    type="button"
                    onClick={() =>
                      handleUpdateBriefOptions(
                        'chatgpt',
                        briefModalState.guideTopic,
                        briefModalState.additionalContext
                      )
                    }
                    className={`px-3 py-1 rounded-md font-semibold transition-colors ${
                      briefModalState.target === 'chatgpt'
                        ? 'bg-[#111A27] text-white'
                        : 'text-[#334155] hover:text-[#111A27]'
                    }`}
                  >
                    ChatGPT Format
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleUpdateBriefOptions(
                        'gemini',
                        briefModalState.guideTopic,
                        briefModalState.additionalContext
                      )
                    }
                    className={`px-3 py-1 rounded-md font-semibold transition-colors ${
                      briefModalState.target === 'gemini'
                        ? 'bg-[#111A27] text-white'
                        : 'text-[#334155] hover:text-[#111A27]'
                    }`}
                  >
                    Gemini Format
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setBriefModalState(null)}
                  className="p-1 text-[#5E6B7C] hover:text-[#111A27]"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="sog-label">Optional Target Guide Topic</label>
                <input
                  type="text"
                  value={briefModalState.guideTopic}
                  onChange={(e) =>
                    handleUpdateBriefOptions(
                      briefModalState.target,
                      e.target.value,
                      briefModalState.additionalContext
                    )
                  }
                  placeholder="e.g., Best Greek Mythology Gifts for Readers (2026)"
                  className="sog-input"
                />
              </div>
              <div>
                <label className="sog-label">Optional Editorial Direction for AI</label>
                <input
                  type="text"
                  value={briefModalState.additionalContext}
                  onChange={(e) =>
                    handleUpdateBriefOptions(
                      briefModalState.target,
                      briefModalState.guideTopic,
                      e.target.value
                    )
                  }
                  placeholder="e.g., Write an editorial list using .sog-ed-card HTML blocks"
                  className="sog-input"
                />
              </div>
            </div>

            <div className="flex-1 min-h-0 flex flex-col space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="sog-label mb-0">
                  Copy-Ready Brief (Editable before copying — includes only populated fields)
                </label>
                {briefModalState.hasManualEdits && (
                  <button
                    type="button"
                    onClick={() =>
                      handleUpdateBriefOptions(
                        briefModalState.target,
                        briefModalState.guideTopic,
                        briefModalState.additionalContext
                      )
                    }
                    className="text-[11px] text-[#1A567B] hover:underline font-semibold"
                  >
                    Reset Manual Edits
                  </button>
                )}
              </div>
              <textarea
                rows={14}
                value={briefModalState.editableBriefText}
                onChange={(e) =>
                  setBriefModalState({
                    ...briefModalState,
                    editableBriefText: e.target.value,
                    hasManualEdits: true,
                  })
                }
                className="w-full flex-1 p-3.5 bg-[#111926] text-[#E6EEF8] rounded-xl font-mono-tabular text-xs leading-relaxed focus:outline-none border border-[#2C3E58]"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-[#DED8CA]">
              <span className="text-[11px] text-[#5E6B7C]">
                Generated 100% locally from your stored catalog records without external AI calls.
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const blob = new Blob([briefModalState.editableBriefText], {
                      type: 'text/plain;charset=utf-8',
                    });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${briefModalState.target}-product-brief-${selectedProductsList.length}-items.txt`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="sog-btn-secondary"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download .txt</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(briefModalState.editableBriefText);
                    onShowToast?.(
                      `Copied ${
                        briefModalState.target === 'chatgpt' ? 'ChatGPT' : 'Gemini'
                      } brief (${selectedProductsList.length} products) to clipboard.`
                    );
                  }}
                  className="sog-btn-mint"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Brief to Clipboard</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: CSV / ROSTER BATCH IMPORT */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 bg-[#111A27]/60 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="bg-[#FBF9F5] border border-[#C6BEB0] rounded-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4 shadow-xl text-xs">
            <div className="flex items-center justify-between border-b border-[#DED8CA] pb-3">
              <div>
                <h2 className="text-lg font-editorial font-semibold text-[#111A27]">
                  Import Products via CSV or Pasted Roster
                </h2>
                <p className="text-xs text-[#5E6B7C] mt-0.5">
                  Columns:{' '}
                  <code className="font-mono-tabular">
                    name, productUrl, price, productType, category, shortDescription, featuresSpecs
                  </code>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="p-1 text-[#5E6B7C] hover:text-[#111A27]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="sog-btn-secondary cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                <span>Upload .CSV File</span>
                <input
                  type="file"
                  accept=".csv,.txt,.tsv"
                  onChange={handleCsvFileUpload}
                  className="hidden"
                />
              </label>

              <button
                type="button"
                onClick={() => handleParseBatch(SAMPLE_CSV_PASTE)}
                className="text-[#1A567B] hover:underline font-semibold"
              >
                Insert Sample 3-Product Roster to Test
              </button>
            </div>

            <textarea
              rows={6}
              value={rawImportText}
              onChange={(e) => handleParseBatch(e.target.value)}
              placeholder="Paste CSV rows, tab-separated spreadsheet rows, or pipe-separated lines here..."
              className="sog-input font-mono-tabular"
            />

            {importReport && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-4 p-3 bg-white border border-[#DED8CA] rounded-lg">
                  <div className="flex items-center gap-1.5 text-[#134634] font-semibold">
                    <CheckCircle2 className="w-4 h-4 text-[#1D634B]" />
                    <span>{importReport.validProducts.length} valid products ready</span>
                  </div>
                  {importReport.invalidRows.length > 0 && (
                    <div className="flex items-center gap-1.5 text-amber-800 font-semibold">
                      <AlertTriangle className="w-4 h-4" />
                      <span>
                        {importReport.invalidRows.length} invalid row(s) flagged (skipped safely)
                      </span>
                    </div>
                  )}
                </div>

                {importReport.invalidRows.length > 0 && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg space-y-1.5 max-h-40 overflow-y-auto">
                    <p className="font-semibold text-red-900">
                      Invalid Rows Report:
                    </p>
                    {importReport.invalidRows.map((row) => (
                      <div key={row.rowNumber} className="text-red-800">
                        <span className="font-mono-tabular font-semibold">
                          Row {row.rowNumber}:
                        </span>{' '}
                        {row.errors.join(' ')} —{' '}
                        <code className="text-[11px] bg-red-100 px-1 rounded">
                          {row.rawText.slice(0, 80)}
                        </code>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#DED8CA]">
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="sog-btn-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!importReport || importReport.validProducts.length === 0 || importingBatch}
                onClick={handleCommitBatchImport}
                className="sog-btn-mint"
              >
                {importingBatch
                  ? 'Importing...'
                  : `Import ${importReport?.validProducts.length || 0} Valid Product(s)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
