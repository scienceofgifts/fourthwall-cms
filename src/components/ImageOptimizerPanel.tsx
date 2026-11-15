import React, { useEffect, useMemo, useState } from 'react';
import JSZip from 'jszip';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  CloudUpload,
  Download,
  ExternalLink,
  Eye,
  FileArchive,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Undo2,
  Wand2,
} from 'lucide-react';
import {
  CatalogProduct,
  GuideImageRole,
  ImageOptimizationStatus,
  ProductImageMappingRecord,
} from '../types/cms';
import {
  DEFAULT_FEATURED_IMAGE_MAX_WIDTH,
  DEFAULT_IMAGE_PUBLIC_BASE_URL,
  DEFAULT_STANDARD_IMAGE_MAX_WIDTH,
  DEFAULT_WEBP_QUALITY,
  HtmlImageReplacementResult,
  ScannedGuideImageItem,
  buildOptimizedImageFilename,
  buildPublicOptimizedImageUrl,
  buildR2ObjectKey,
  calculateProportionalDimensions,
  deriveProductSlugFromUrl,
  replaceGuideHtmlImageUrls,
  scanGuideHtmlForImages,
} from '../services/imageOptimizerCore';
import {
  getAllImageMappingsFromIdb,
  saveImageMappingsToIdb,
} from '../services/projectStorageIdb';
import { auth } from '../services/firebase';

interface ImageOptimizerPanelProps {
  currentHtml: string;
  products: CatalogProduct[];
  onApplyHtmlImageReplacements: (nextHtml: string, summaryMessage: string) => void;
}

interface R2StatusState {
  checked: boolean;
  configured: boolean;
  mode: 'worker_binding' | 's3_api' | 'unconfigured';
  bucketName: string;
  publicBaseUrl: string;
  missingFields: string[];
}

function formatBytes(bytes?: number): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) {
    return '—';
  }
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

function getStatusBadgeConfig(status: ImageOptimizationStatus): {
  label: string;
  className: string;
} {
  switch (status) {
    case 'not_optimized':
      return {
        label: 'Not optimized',
        className: 'bg-[#f5efe4] text-[#6d6253] border-[#d8ccb8]',
      };
    case 'optimized_locally':
      return {
        label: 'Optimized locally',
        className: 'bg-[#e9f2fb] text-[#1d538a] border-[#b7d3ef]',
      };
    case 'upload_pending':
      return {
        label: 'Upload pending',
        className: 'bg-[#fef6e4] text-[#946200] border-[#f0d596]',
      };
    case 'uploaded':
      return {
        label: 'Uploaded',
        className: 'bg-[#e7f6ed] text-[#17663a] border-[#b2dfc4]',
      };
    case 'link_updated':
      return {
        label: 'Link updated',
        className: 'bg-[#e3f3eb] text-[#0f5132] border-[#8fd1ae]',
      };
    case 'error':
      return {
        label: 'Error',
        className: 'bg-[#fdecec] text-[#a61b1b] border-[#f3b6b6]',
      };
  }
}

export const ImageOptimizerPanel: React.FC<ImageOptimizerPanelProps> = ({
  currentHtml,
  products,
  onApplyHtmlImageReplacements,
}) => {
  const [storedMappings, setStoredMappings] = useState<ProductImageMappingRecord[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Configurable optimization settings
  const [publicBaseUrl, setPublicBaseUrl] = useState<string>(DEFAULT_IMAGE_PUBLIC_BASE_URL);
  const [standardMaxWidth, setStandardMaxWidth] = useState<number>(DEFAULT_STANDARD_IMAGE_MAX_WIDTH);
  const [featuredMaxWidth, setFeaturedMaxWidth] = useState<number>(DEFAULT_FEATURED_IMAGE_MAX_WIDTH);
  const [webpQuality, setWebpQuality] = useState<number>(DEFAULT_WEBP_QUALITY);
  const [forceReoptimize, setForceReoptimize] = useState<boolean>(false);
  const [allowConflictOverwrite, setAllowConflictOverwrite] = useState<boolean>(false);

  // Manual overrides per image row (product page URL or role)
  const [customProductUrls, setCustomProductUrls] = useState<Record<string, string>>({});
  const [customRoles, setCustomRoles] = useState<Record<string, GuideImageRole>>({});
  const [customSuffixes, setCustomSuffixes] = useState<Record<string, string>>({});

  // Operation state
  const [isOptimizing, setIsOptimizing] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [isExportingZip, setIsExportingZip] = useState<boolean>(false);
  const [activeItemProgress, setActiveItemProgress] = useState<string | null>(null);
  const [bannerMessage, setBannerMessage] = useState<{
    type: 'info' | 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);

  // Preview & Undo state for HTML Image URL replacement
  const [showReplacementPreview, setShowReplacementPreview] = useState<boolean>(false);
  const [onlyUseUploadedUrls, setOnlyUseUploadedUrls] = useState<boolean>(false);
  const [preReplacementHtmlSnapshot, setPreReplacementHtmlSnapshot] = useState<string | null>(null);

  // R2 Server status
  const [r2Status, setR2Status] = useState<R2StatusState>({
    checked: false,
    configured: false,
    mode: 'unconfigured',
    bucketName: '',
    publicBaseUrl: DEFAULT_IMAGE_PUBLIC_BASE_URL,
    missingFields: [],
  });

  // Load persisted image mappings from IndexedDB + check R2 status on mount
  useEffect(() => {
    let mounted = true;
    getAllImageMappingsFromIdb()
      .then((records) => {
        if (mounted) {
          setStoredMappings(records);
        }
      })
      .catch((err) => {
        console.warn('Could not load saved image mappings from IndexedDB:', err);
      });

    fetch('/api/images/status')
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => {
        if (!mounted || !data?.r2) return;
        setR2Status({
          checked: true,
          configured: Boolean(data.r2.configured),
          mode: data.r2.mode || 'unconfigured',
          bucketName: data.r2.bucketName || '',
          publicBaseUrl: data.r2.publicBaseUrl || DEFAULT_IMAGE_PUBLIC_BASE_URL,
          missingFields: Array.isArray(data.r2.missingVariables)
            ? data.r2.missingVariables
            : Array.isArray(data.r2.missingFields)
            ? data.r2.missingFields
            : [],
        });
        if (data.r2.publicBaseUrl) {
          setPublicBaseUrl(data.r2.publicBaseUrl);
        }
      })
      .catch(() => {
        if (mounted) {
          setR2Status((prev) => ({ ...prev, checked: true }));
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  // Build scanned items list from current guide HTML + catalog products + stored mappings
  const scannedItems: ScannedGuideImageItem[] = useMemo(() => {
    const rawItems = scanGuideHtmlForImages(currentHtml, products, storedMappings, publicBaseUrl);

    return rawItems.map((item) => {
      const overriddenProductUrl = customProductUrls[item.originalImageUrl] ?? item.productPageUrl;
      const overriddenRole = customRoles[item.originalImageUrl] ?? item.role;
      const overriddenSuffix = customSuffixes[item.originalImageUrl] ?? item.variantSuffix;
      const derivedBaseSlug =
        deriveProductSlugFromUrl(overriddenProductUrl) || item.baseProductSlug;
      const optimizedFilename = derivedBaseSlug
        ? buildOptimizedImageFilename(derivedBaseSlug, overriddenSuffix)
        : '';
      const productSlug = optimizedFilename.replace(/\.webp$/i, '');
      const r2ObjectKey = derivedBaseSlug ? buildR2ObjectKey(derivedBaseSlug, overriddenSuffix) : '';
      const optimizedImageUrl = derivedBaseSlug
        ? buildPublicOptimizedImageUrl(derivedBaseSlug, publicBaseUrl, overriddenSuffix)
        : '';

      return {
        ...item,
        productPageUrl: overriddenProductUrl,
        baseProductSlug: derivedBaseSlug,
        productSlug,
        variantSuffix: overriddenSuffix,
        role: overriddenRole,
        r2ObjectKey,
        optimizedImageUrl,
      };
    });
  }, [
    currentHtml,
    products,
    storedMappings,
    publicBaseUrl,
    customProductUrls,
    customRoles,
    customSuffixes,
  ]);

  // Auto-select all valid items on initial scan if none selected
  useEffect(() => {
    if (scannedItems.length > 0 && selectedIds.size === 0) {
      setSelectedIds(new Set(scannedItems.map((i) => i.id)));
    }
  }, [scannedItems.length]);

  const toggleSelectItem = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === scannedItems.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(scannedItems.map((i) => i.id)));
    }
  };

  // Compute replacement preview result
  const replacementPreview: HtmlImageReplacementResult = useMemo(() => {
    const activeMappings: ProductImageMappingRecord[] = scannedItems
      .map((item) => item.existingMapping)
      .filter((m): m is ProductImageMappingRecord => Boolean(m));

    // Also include stored mappings that might already have been updated
    const combinedMap = new Map<string, ProductImageMappingRecord>();
    for (const m of storedMappings) {
      combinedMap.set(m.id, m);
    }
    for (const m of activeMappings) {
      combinedMap.set(m.id, m);
    }

    return replaceGuideHtmlImageUrls(currentHtml, Array.from(combinedMap.values()), {
      onlyUploadedOrOptimized: true,
      requireUploadedStatus: onlyUseUploadedUrls,
    });
  }, [currentHtml, scannedItems, storedMappings, onlyUseUploadedUrls]);

  const upsertMappingsStateAndIdb = async (newRecords: ProductImageMappingRecord[]) => {
    if (newRecords.length === 0) return;
    setStoredMappings((prev) => {
      const map = new Map<string, ProductImageMappingRecord>();
      for (const r of prev) map.set(r.id, r);
      for (const r of newRecords) map.set(r.id, r);
      return Array.from(map.values());
    });
    await saveImageMappingsToIdb(newRecords);
  };

  // Optimize a list of scanned items via /api/images/optimize
  const runOptimizeItems = async (
    itemsToOptimize: ScannedGuideImageItem[],
    force: boolean
  ) => {
    if (itemsToOptimize.length === 0) {
      setBannerMessage({
        type: 'warning',
        text: 'Select at least one detected product image to optimize.',
      });
      return;
    }

    setIsOptimizing(true);
    setBannerMessage(null);

    let optimizedCount = 0;
    let skippedUnchangedCount = 0;
    let conflictSkippedCount = 0;
    let errorCount = 0;
    const updatedRecords: ProductImageMappingRecord[] = [];

    for (let idx = 0; idx < itemsToOptimize.length; idx++) {
      const item = itemsToOptimize[idx];
      setActiveItemProgress(
        `Optimizing ${idx + 1} of ${itemsToOptimize.length}: ${item.productName || item.productSlug || 'image'}...`
      );

      if (!item.baseProductSlug) {
        const errorRecord: ProductImageMappingRecord = {
          id: `err:${item.originalImageUrl}`,
          productId: item.productId,
          productName: item.productName,
          productPageUrl: item.productPageUrl,
          baseProductSlug: '',
          productSlug: '',
          variantSuffix: item.variantSuffix,
          role: item.role,
          originalImageUrl: item.originalImageUrl,
          optimizedImageUrl: '',
          r2ObjectKey: '',
          status: 'error',
          errorMessage:
            'Missing deterministic product slug. Assign a valid product URL (e.g. https://shop.scienceofgifts.com/products/your-product) first.',
        };
        updatedRecords.push(errorRecord);
        errorCount++;
        continue;
      }

      // Check sourceChangedConflict protection
      if (item.sourceChangedConflict && !allowConflictOverwrite) {
        conflictSkippedCount++;
        continue;
      }

      // Skip already-optimized unchanged images unless force Re-optimize is enabled
      const targetMaxWidth = item.role === 'featured' ? featuredMaxWidth : standardMaxWidth;
      if (
        !force &&
        item.existingMapping &&
        item.existingMapping.originalImageUrl === item.originalImageUrl &&
        item.existingMapping.optimizedWebpBase64 &&
        item.existingMapping.targetMaxWidth === targetMaxWidth &&
        item.existingMapping.quality === webpQuality &&
        (item.existingMapping.status === 'optimized_locally' ||
          item.existingMapping.status === 'uploaded' ||
          item.existingMapping.status === 'link_updated')
      ) {
        skippedUnchangedCount++;
        continue;
      }

      try {
        const response = await fetch('/api/images/optimize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageUrl: item.originalImageUrl,
            productPageUrl: item.productPageUrl,
            productSlug: item.baseProductSlug,
            variantSuffix: item.variantSuffix,
            role: item.role,
            maxWidth: targetMaxWidth,
            quality: webpQuality,
            publicBaseUrl,
          }),
        });

        const payload = await response.json();
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || `HTTP ${response.status} during image optimization.`);
        }

        const record: ProductImageMappingRecord = {
          id: `${item.productSlug}::${item.originalImageUrl}`,
          productId: item.productId,
          productName: item.productName,
          productPageUrl: item.productPageUrl,
          baseProductSlug: item.baseProductSlug,
          productSlug: payload.productSlug || item.productSlug,
          variantSuffix: item.variantSuffix,
          role: item.role,
          originalImageUrl: item.originalImageUrl,
          optimizedImageUrl: payload.optimizedImageUrl || item.optimizedImageUrl,
          r2ObjectKey: payload.r2ObjectKey || item.r2ObjectKey,
          originalDimensions: payload.originalDimensions,
          optimizedDimensions: payload.optimizedDimensions,
          originalFileSizeBytes: payload.originalFileSizeBytes,
          optimizedFileSizeBytes: payload.optimizedFileSizeBytes,
          targetMaxWidth: payload.targetMaxWidth || targetMaxWidth,
          quality: payload.quality || webpQuality,
          status: 'optimized_locally',
          lastOptimizedAt: payload.optimizedAt || new Date().toISOString(),
          optimizedWebpBase64: payload.webpBase64,
          sourceContentHash: payload.webpSha256,
          errorMessage: undefined,
          sourceChangedConflict: false,
        };

        updatedRecords.push(record);
        optimizedCount++;
      } catch (err: any) {
        const record: ProductImageMappingRecord = {
          id: `${item.productSlug || 'unmatched'}::${item.originalImageUrl}`,
          productId: item.productId,
          productName: item.productName,
          productPageUrl: item.productPageUrl,
          baseProductSlug: item.baseProductSlug,
          productSlug: item.productSlug,
          variantSuffix: item.variantSuffix,
          role: item.role,
          originalImageUrl: item.originalImageUrl,
          optimizedImageUrl: item.optimizedImageUrl,
          r2ObjectKey: item.r2ObjectKey,
          status: 'error',
          errorMessage: err?.message || 'Image optimization failed.',
        };
        updatedRecords.push(record);
        errorCount++;
      }
    }

    await upsertMappingsStateAndIdb(updatedRecords);
    setIsOptimizing(false);
    setActiveItemProgress(null);

    const summaryParts: string[] = [];
    if (optimizedCount > 0) summaryParts.push(`${optimizedCount} optimized to WebP`);
    if (skippedUnchangedCount > 0) summaryParts.push(`${skippedUnchangedCount} unchanged skipped`);
    if (conflictSkippedCount > 0) {
      summaryParts.push(`${conflictSkippedCount} slug conflict(s) protected from overwrite`);
    }
    if (errorCount > 0) summaryParts.push(`${errorCount} failed`);

    setBannerMessage({
      type: errorCount > 0 ? 'warning' : 'success',
      text: summaryParts.join(' · ') || 'Optimization run finished.',
    });
  };

  // Upload optimized WebP images to Cloudflare R2 using verified Firebase ID Token
  const runUploadToR2 = async (itemsToUpload: ScannedGuideImageItem[], overwrite = false) => {
    const readyItems = itemsToUpload.filter(
      (i) => i.existingMapping?.optimizedWebpBase64 && i.r2ObjectKey
    );

    if (readyItems.length === 0) {
      setBannerMessage({
        type: 'warning',
        text: 'Optimize the selected images to WebP first before uploading to Cloudflare R2.',
      });
      return;
    }

    const currentUser = auth.currentUser;
    if (!currentUser) {
      setBannerMessage({
        type: 'error',
        text: 'Firebase Authentication is required to upload to Cloudflare R2. Please click "Sign In with Google" in the top navigation bar first.',
      });
      return;
    }

    let firebaseIdToken = '';
    try {
      firebaseIdToken = await currentUser.getIdToken();
    } catch (err: any) {
      setBannerMessage({
        type: 'error',
        text: `Could not retrieve a valid Firebase ID token for R2 upload: ${
          err?.message || 'Please sign in again.'
        }`,
      });
      return;
    }

    setIsUploading(true);
    setBannerMessage(null);

    let uploadedCount = 0;
    let skippedDuplicateCount = 0;
    let errorCount = 0;
    let lastErrorText = '';
    const updatedRecords: ProductImageMappingRecord[] = [];

    for (let idx = 0; idx < readyItems.length; idx++) {
      const item = readyItems[idx];
      const mapping = item.existingMapping!;

      setActiveItemProgress(
        `Uploading ${idx + 1} of ${readyItems.length} to R2: ${item.r2ObjectKey}...`
      );

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${firebaseIdToken}`,
      };

      try {
        const response = await fetch('/api/images/upload-r2', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            objectKey: item.r2ObjectKey,
            webpBase64: mapping.optimizedWebpBase64,
            publicBaseUrl,
            overwrite,
            previousContentSha256:
              mapping.status === 'uploaded' || mapping.status === 'link_updated'
                ? mapping.sourceContentHash
                : undefined,
          }),
        });

        const payload = await response.json();
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || `R2 upload failed with HTTP ${response.status}.`);
        }

        const nextRecord: ProductImageMappingRecord = {
          ...mapping,
          r2ObjectKey: payload.objectKey || item.r2ObjectKey,
          optimizedImageUrl: payload.publicUrl || item.optimizedImageUrl,
          status: mapping.status === 'link_updated' ? 'link_updated' : 'uploaded',
          lastUploadedAt: payload.uploadedAt || new Date().toISOString(),
          sourceContentHash: payload.sha256 || mapping.sourceContentHash,
          errorMessage: undefined,
        };
        updatedRecords.push(nextRecord);

        if (payload.skippedUnchanged) {
          skippedDuplicateCount++;
        } else {
          uploadedCount++;
        }
      } catch (err: any) {
        lastErrorText = err?.message || 'Cloudflare R2 upload failed.';
        const failedRecord: ProductImageMappingRecord = {
          ...mapping,
          status: 'error',
          errorMessage: lastErrorText,
        };
        updatedRecords.push(failedRecord);
        errorCount++;
      }
    }

    await upsertMappingsStateAndIdb(updatedRecords);
    setIsUploading(false);
    setActiveItemProgress(null);

    const parts: string[] = [];
    if (uploadedCount > 0) parts.push(`${uploadedCount} uploaded to R2`);
    if (skippedDuplicateCount > 0) parts.push(`${skippedDuplicateCount} unchanged skipped`);
    if (errorCount > 0) parts.push(`${errorCount} failed (${lastErrorText})`);

    setBannerMessage({
      type: errorCount > 0 ? 'error' : 'success',
      text: parts.join(' · ') || 'R2 upload completed.',
    });
  };

  // Fallback ZIP Export: .webp files + image-mapping.json + optimization-report.json
  const handleDownloadOptimizedZip = async () => {
    setIsExportingZip(true);
    setBannerMessage(null);
    try {
      const zip = new JSZip();
      let includedWebpCount = 0;

      const exportMappings: Array<Omit<ProductImageMappingRecord, 'optimizedWebpBase64'>> = [];
      const failedOrUnmatched: Array<{
        originalImageUrl: string;
        productName: string;
        productPageUrl: string;
        reason: string;
      }> = [];

      for (const item of scannedItems) {
        const mapping = item.existingMapping;
        if (mapping && mapping.optimizedWebpBase64 && item.r2ObjectKey) {
          zip.file(item.r2ObjectKey, mapping.optimizedWebpBase64, { base64: true });
          includedWebpCount++;
          const { optimizedWebpBase64: _omit, ...cleanMapping } = mapping;
          exportMappings.push(cleanMapping);
        } else {
          failedOrUnmatched.push({
            originalImageUrl: item.originalImageUrl,
            productName: item.productName || 'Unmatched Product',
            productPageUrl: item.productPageUrl || '',
            reason:
              mapping?.errorMessage ||
              (!item.baseProductSlug
                ? 'No deterministic product slug could be derived from product URL'
                : 'Image has not been optimized to WebP yet'),
          });
        }
      }

      zip.file(
        'image-mapping.json',
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            publicBaseUrl,
            totalScannedImages: scannedItems.length,
            optimizedWebpCount: includedWebpCount,
            mappings: exportMappings,
          },
          null,
          2
        )
      );

      zip.file(
        'optimization-report.json',
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            includedWebpCount,
            failedOrUnmatchedCount: failedOrUnmatched.length,
            failedOrUnmatched,
            unmatchedFromHtmlReplacement: replacementPreview.unmatchedImages,
          },
          null,
          2
        )
      );

      const blob = await zip.generateAsync({ type: 'blob' });
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = `science-of-gifts-optimized-images-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(downloadUrl);

      setBannerMessage({
        type: 'success',
        text: `Exported ZIP archive with ${includedWebpCount} optimized .webp image(s), image-mapping.json, and optimization-report.json.`,
      });
    } catch (err: any) {
      setBannerMessage({
        type: 'error',
        text: `Failed to generate ZIP archive: ${err?.message || 'Unknown error'}`,
      });
    } finally {
      setIsExportingZip(false);
    }
  };

  // Apply HTML image URL replacements
  const handleConfirmApplyReplacements = async () => {
    if (replacementPreview.replacedCount === 0) {
      setBannerMessage({
        type: 'warning',
        text: 'No matching optimized image URLs are ready to replace in the current guide HTML.',
      });
      return;
    }

    setPreReplacementHtmlSnapshot(currentHtml);
    onApplyHtmlImageReplacements(
      replacementPreview.updatedHtml,
      `Updated ${replacementPreview.replacedCount} product image URL(s) to ${publicBaseUrl}/products/*.webp`
    );

    // Mark replaced records as link_updated
    const replacedSourceUrls = new Set(replacementPreview.replacements.map((r) => r.previousSrc));
    const replacedSlugs = new Set(replacementPreview.replacements.map((r) => r.productSlug));

    const updatedRecords: ProductImageMappingRecord[] = [];
    for (const item of scannedItems) {
      if (!item.existingMapping) continue;
      if (
        replacedSourceUrls.has(item.originalImageUrl) ||
        replacedSlugs.has(item.productSlug)
      ) {
        updatedRecords.push({
          ...item.existingMapping,
          status: 'link_updated',
          optimizedImageUrl: item.optimizedImageUrl,
        });
      }
    }

    await upsertMappingsStateAndIdb(updatedRecords);
    setShowReplacementPreview(false);
    setBannerMessage({
      type: 'success',
      text: `Replaced ${replacementPreview.replacedCount} image URL(s) in the guide HTML. You can click "Undo Link Replacement" if needed before saving.`,
    });
  };

  const handleUndoReplacements = () => {
    if (!preReplacementHtmlSnapshot) return;
    onApplyHtmlImageReplacements(
      preReplacementHtmlSnapshot,
      'Reverted product image URLs to their previous values'
    );
    setPreReplacementHtmlSnapshot(null);
    setBannerMessage({
      type: 'info',
      text: 'Reverted guide HTML image links to their pre-replacement state.',
    });
  };

  const selectedItems = useMemo(
    () => scannedItems.filter((item) => selectedIds.has(item.id)),
    [scannedItems, selectedIds]
  );

  const stats = useMemo(() => {
    let optimized = 0;
    let uploaded = 0;
    let linkUpdated = 0;
    let errors = 0;
    let totalOriginalBytes = 0;
    let totalOptimizedBytes = 0;

    for (const item of scannedItems) {
      const st = item.existingMapping?.status || 'not_optimized';
      if (st === 'optimized_locally' || st === 'uploaded' || st === 'link_updated') {
        optimized++;
      }
      if (st === 'uploaded' || st === 'link_updated') {
        uploaded++;
      }
      if (st === 'link_updated') {
        linkUpdated++;
      }
      if (st === 'error') {
        errors++;
      }
      if (item.existingMapping?.originalFileSizeBytes && item.existingMapping?.optimizedFileSizeBytes) {
        totalOriginalBytes += item.existingMapping.originalFileSizeBytes;
        totalOptimizedBytes += item.existingMapping.optimizedFileSizeBytes;
      }
    }

    const savingsPercent =
      totalOriginalBytes > 0
        ? Math.round(((totalOriginalBytes - totalOptimizedBytes) / totalOriginalBytes) * 100)
        : 0;

    return {
      total: scannedItems.length,
      optimized,
      uploaded,
      linkUpdated,
      errors,
      totalOriginalBytes,
      totalOptimizedBytes,
      savingsPercent,
    };
  }, [scannedItems]);

  return (
    <div className="flex flex-col h-full bg-[#faf7f2] text-[#1c1a17] overflow-y-auto">
      {/* Top Header & Settings Bar */}
      <div className="border-b border-[#e4dacb] bg-[#f4efe6] px-6 py-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <ImageIcon className="w-5 h-5 text-[#9a7b38]" />
              <h2 className="font-serif text-lg font-bold text-[#1c1a17]">
                Bulk Product Image Optimizer &amp; Cloudflare R2 Publisher
              </h2>
              <span
                className={`text-[11px] font-mono px-2 py-0.5 border ${
                  r2Status.configured
                    ? 'bg-[#e7f6ed] text-[#17663a] border-[#b2dfc4]'
                    : 'bg-[#fef6e4] text-[#946200] border-[#f0d596]'
                }`}
              >
                {r2Status.configured
                  ? `R2 Connected (${r2Status.mode === 'worker_binding' ? 'Worker Binding' : 'S3 API'}${
                      r2Status.bucketName ? ` · ${r2Status.bucketName}` : ''
                    })`
                  : 'R2 Credentials Not Configured (Local WebP + ZIP Fallback Ready)'}
              </span>
            </div>
            <p className="text-xs text-[#6d6253] mt-0.5">
              Proportional WebP resizing via Cloudflare Images / Sharp (no cropping, preserves aspect ratio &amp; alpha transparency) with deterministic product-slug filenames.
            </p>
          </div>

          {/* Primary Action Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isOptimizing || isUploading || selectedItems.length === 0}
              onClick={() => runOptimizeItems(selectedItems, forceReoptimize)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-[#1c1a17] text-[#faf7f2] hover:bg-[#332f29] disabled:opacity-50 transition-colors cursor-pointer"
            >
              {isOptimizing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Wand2 className="w-3.5 h-3.5 text-[#d4af37]" />
              )}
              {forceReoptimize
                ? `Re-optimize Selected (${selectedItems.length})`
                : `Optimize Selected (${selectedItems.length})`}
            </button>

            <button
              type="button"
              disabled={isOptimizing || isUploading || selectedItems.length === 0}
              onClick={() => runUploadToR2(selectedItems, forceReoptimize)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-[#1f4e78] text-white hover:bg-[#173b5c] disabled:opacity-50 transition-colors cursor-pointer"
              title="Upload optimized WebP images to Cloudflare R2 bucket under products/<slug>.webp"
            >
              {isUploading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CloudUpload className="w-3.5 h-3.5" />
              )}
              Upload to R2
            </button>

            <button
              type="button"
              disabled={isOptimizing || isUploading}
              onClick={() => setShowReplacementPreview((prev) => !prev)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-[#9a7b38] text-white hover:bg-[#82662b] disabled:opacity-50 transition-colors cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Update Image Links ({replacementPreview.replacedCount})
            </button>

            {preReplacementHtmlSnapshot && (
              <button
                type="button"
                onClick={handleUndoReplacements}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border border-[#c4a76c] bg-[#fff9ec] text-[#7a5b1e] hover:bg-[#f7ecd2] transition-colors cursor-pointer"
              >
                <Undo2 className="w-3.5 h-3.5" />
                Undo Link Replacement
              </button>
            )}

            <button
              type="button"
              disabled={isExportingZip || scannedItems.length === 0}
              onClick={handleDownloadOptimizedZip}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border border-[#d0c4b2] bg-white text-[#1c1a17] hover:bg-[#f4efe6] disabled:opacity-50 transition-colors cursor-pointer"
              title="Download a ZIP containing products/<slug>.webp files, image-mapping.json, and optimization-report.json"
            >
              {isExportingZip ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <FileArchive className="w-3.5 h-3.5 text-[#6d6253]" />
              )}
              Export WebP + Mapping ZIP
            </button>
          </div>
        </div>

        {/* Settings Controls Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 pt-2 border-t border-[#e4dacb]">
          <div className="lg:col-span-2">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#6d6253] mb-1">
              R2 Custom Image Domain
            </label>
            <input
              type="url"
              value={publicBaseUrl}
              onChange={(e) => setPublicBaseUrl(e.target.value)}
              placeholder="https://images.scienceofgifts.com"
              className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-[#d0c4b2] focus:outline-none focus:border-[#9a7b38]"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#6d6253] mb-1">
              Standard Max Width (px)
            </label>
            <input
              type="number"
              min={160}
              max={2400}
              step={20}
              value={standardMaxWidth}
              onChange={(e) =>
                setStandardMaxWidth(Math.max(160, Math.min(2400, Number(e.target.value) || 600)))
              }
              className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-[#d0c4b2] focus:outline-none focus:border-[#9a7b38]"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#6d6253] mb-1">
              Featured Max Width (px)
            </label>
            <input
              type="number"
              min={200}
              max={2400}
              step={20}
              value={featuredMaxWidth}
              onChange={(e) =>
                setFeaturedMaxWidth(Math.max(200, Math.min(2400, Number(e.target.value) || 900)))
              }
              className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-[#d0c4b2] focus:outline-none focus:border-[#9a7b38]"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#6d6253] mb-1">
              WebP Quality (1–100)
            </label>
            <input
              type="number"
              min={40}
              max={100}
              value={webpQuality}
              onChange={(e) =>
                setWebpQuality(Math.max(40, Math.min(100, Number(e.target.value) || 80)))
              }
              className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-[#d0c4b2] focus:outline-none focus:border-[#9a7b38]"
            />
          </div>

          <div className="flex flex-col justify-center gap-1.5 pt-3">
            <label className="inline-flex items-center gap-2 text-xs text-[#3d372e] cursor-pointer">
              <input
                type="checkbox"
                checked={forceReoptimize}
                onChange={(e) => setForceReoptimize(e.target.checked)}
                className="accent-[#9a7b38]"
              />
              <span>Force Re-optimize / Overwrite</span>
            </label>
            <label className="inline-flex items-center gap-2 text-xs text-[#3d372e] cursor-pointer">
              <input
                type="checkbox"
                checked={allowConflictOverwrite}
                onChange={(e) => setAllowConflictOverwrite(e.target.checked)}
                className="accent-[#9a7b38]"
              />
              <span>Allow Slug Conflict Overwrite</span>
            </label>
          </div>
        </div>

        {/* Summary Metrics Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-[#e4dacb] text-xs text-[#4f473d]">
          <div className="flex flex-wrap items-center gap-5">
            <span>
              Detected in Guide: <strong className="font-mono text-[#1c1a17]">{stats.total}</strong>
            </span>
            <span>
              Optimized WebP: <strong className="font-mono text-[#1d538a]">{stats.optimized}</strong>
            </span>
            <span>
              Uploaded to R2: <strong className="font-mono text-[#17663a]">{stats.uploaded}</strong>
            </span>
            <span>
              Links Updated: <strong className="font-mono text-[#0f5132]">{stats.linkUpdated}</strong>
            </span>
            {stats.totalOriginalBytes > 0 && (
              <span>
                Bandwidth Saved:{' '}
                <strong className="font-mono text-[#17663a]">
                  {formatBytes(stats.totalOriginalBytes)} → {formatBytes(stats.totalOptimizedBytes)} (
                  {stats.savingsPercent}% smaller)
                </strong>
              </span>
            )}
          </div>

          {activeItemProgress && (
            <div className="inline-flex items-center gap-2 text-xs font-medium text-[#9a7b38]">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>{activeItemProgress}</span>
            </div>
          )}
        </div>
      </div>

      {/* Status / Error Banner */}
      {bannerMessage && (
        <div
          className={`mx-6 mt-4 px-4 py-3 border text-xs flex items-center justify-between gap-3 ${
            bannerMessage.type === 'error'
              ? 'bg-[#fdecec] border-[#f3b6b6] text-[#9c1c1c]'
              : bannerMessage.type === 'warning'
              ? 'bg-[#fef6e4] border-[#f0d596] text-[#8a5a00]'
              : bannerMessage.type === 'success'
              ? 'bg-[#e7f6ed] border-[#b2dfc4] text-[#145932]'
              : 'bg-[#e9f2fb] border-[#b7d3ef] text-[#1d538a]'
          }`}
        >
          <div className="flex items-center gap-2">
            {bannerMessage.type === 'error' || bannerMessage.type === 'warning' ? (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            )}
            <span>{bannerMessage.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setBannerMessage(null)}
            className="text-[11px] underline opacity-75 hover:opacity-100 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Preview & Confirm Guide HTML Image Link Replacement Drawer */}
      {showReplacementPreview && (
        <div className="mx-6 mt-4 border border-[#c4a76c] bg-[#fffdf9] p-5 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e8decb] pb-3">
            <div>
              <h3 className="font-serif text-base font-bold text-[#1c1a17]">
                Preview Guide HTML Image Link Replacements
              </h3>
              <p className="text-xs text-[#6d6253]">
                Preserves all existing gift-card CSS, <code>alt</code>, <code>width</code>,{' '}
                <code>height</code>, <code>loading</code>, and class attributes. Only the{' '}
                <code>src</code> attribute of matched product images is updated.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-1.5 text-xs text-[#4f473d] cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlyUseUploadedUrls}
                  onChange={(e) => setOnlyUseUploadedUrls(e.target.checked)}
                  className="accent-[#9a7b38]"
                />
                <span>Only replace images marked Uploaded to R2</span>
              </label>

              <button
                type="button"
                disabled={replacementPreview.replacedCount === 0}
                onClick={handleConfirmApplyReplacements}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#17663a] text-white hover:bg-[#114d2b] disabled:opacity-50 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                Apply {replacementPreview.replacedCount} URL Replacement(s) to Guide HTML
              </button>

              <button
                type="button"
                onClick={() => setShowReplacementPreview(false)}
                className="px-3 py-2 text-xs font-medium border border-[#d0c4b2] bg-white hover:bg-[#f4efe6] cursor-pointer"
              >
                Close Preview
              </button>
            </div>
          </div>

          {replacementPreview.replacements.length > 0 ? (
            <div className="max-h-60 overflow-y-auto border border-[#e4dacb]">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-[#f4efe6] text-[#5c5245] border-b border-[#e4dacb]">
                  <tr>
                    <th className="py-2 px-3 font-semibold">Product Slug</th>
                    <th className="py-2 px-3 font-semibold">Match Mode</th>
                    <th className="py-2 px-3 font-semibold">Current Image URL</th>
                    <th className="py-2 px-3 font-semibold">New Optimized R2 URL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eee6d8]">
                  {replacementPreview.replacements.map((rep, i) => (
                    <tr key={`${rep.productSlug}-${i}`} className="bg-white">
                      <td className="py-2 px-3 font-mono font-medium text-[#1c1a17]">
                        {rep.productSlug}.webp
                      </td>
                      <td className="py-2 px-3">
                        <span className="px-2 py-0.5 text-[10px] font-mono bg-[#f4efe6] border border-[#d8ccb8]">
                          {rep.matchMode === 'exact_original_url'
                            ? 'Exact Source URL'
                            : 'Unambiguous Product Slug'}
                        </span>
                      </td>
                      <td className="py-2 px-3 font-mono text-[11px] text-[#7a6f5f] truncate max-w-[260px]">
                        {rep.previousSrc}
                      </td>
                      <td className="py-2 px-3 font-mono text-[11px] text-[#17663a] break-all">
                        {rep.nextSrc}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-[#7a6f5f] italic">
              No image replacements ready yet. Optimize one or more product images first.
            </p>
          )}

          {replacementPreview.unmatchedImages.length > 0 && (
            <div className="bg-[#fef6e4] border border-[#f0d596] p-3 space-y-1.5">
              <div className="text-xs font-semibold text-[#8a5a00]">
                Unmatched / Skipped Images ({replacementPreview.unmatchedImages.length}) — Left Unchanged in Guide HTML:
              </div>
              <ul className="text-[11px] text-[#6d5316] space-y-1 max-h-32 overflow-y-auto font-mono">
                {replacementPreview.unmatchedImages.map((u, idx) => (
                  <li key={`${u.src}-${idx}`}>
                    • {u.src} — <span className="font-sans">{u.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Main Detected Images Table */}
      <div className="p-6 flex-1">
        {scannedItems.length === 0 ? (
          <div className="border border-[#dfd5c5] bg-white p-12 text-center space-y-2">
            <ImageIcon className="w-8 h-8 text-[#9a7b38] mx-auto opacity-75" />
            <h3 className="font-serif text-base font-bold text-[#1c1a17]">
              No Product Images Detected in Current Guide
            </h3>
            <p className="text-xs text-[#6d6253] max-w-md mx-auto">
              Add product cards or HTML sections containing <code>&lt;img src="..."&gt;</code> tags in the HTML Editor, then open the Image Optimizer to convert them to proportional WebP files.
            </p>
          </div>
        ) : (
          <div className="border border-[#dfd5c5] bg-white shadow-xs overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-[#f4efe6] text-[#4f473d] border-b border-[#dfd5c5] uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="py-3 px-3 w-9">
                    <input
                      type="checkbox"
                      checked={
                        scannedItems.length > 0 && selectedIds.size === scannedItems.length
                      }
                      onChange={toggleSelectAll}
                      className="accent-[#9a7b38] cursor-pointer"
                      aria-label="Select all detected product images"
                    />
                  </th>
                  <th className="py-3 px-3">Preview (Original → WebP)</th>
                  <th className="py-3 px-3">Product &amp; Deterministic Slug</th>
                  <th className="py-3 px-3">Role &amp; Dimensions</th>
                  <th className="py-3 px-3">File Size</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#ece4d6]">
                {scannedItems.map((item) => {
                  const mapping = item.existingMapping;
                  const status: ImageOptimizationStatus = mapping?.status || 'not_optimized';
                  const badge = getStatusBadgeConfig(status);
                  const isSelected = selectedIds.has(item.id);
                  const targetMaxWidth =
                    item.role === 'featured' ? featuredMaxWidth : standardMaxWidth;
                  const estimatedDims = mapping?.originalDimensions
                    ? calculateProportionalDimensions(
                        mapping.originalDimensions.width,
                        mapping.originalDimensions.height,
                        targetMaxWidth
                      )
                    : undefined;

                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-[#fcfaf6] transition-colors ${
                        isSelected ? 'bg-[#fdfaf3]' : 'bg-white'
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="py-3.5 px-3 align-top">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectItem(item.id)}
                          className="accent-[#9a7b38] cursor-pointer mt-1"
                        />
                      </td>

                      {/* Original & Optimized Previews */}
                      <td className="py-3.5 px-3 align-top">
                        <div className="flex items-center gap-2">
                          <div className="w-14 h-14 border border-[#dfd5c5] bg-[#f8f5ef] flex items-center justify-center overflow-hidden shrink-0">
                            <img
                              src={item.originalImageUrl}
                              alt={item.altText || item.productName || 'Original'}
                              className="max-w-full max-h-full object-contain"
                              loading="lazy"
                            />
                          </div>
                          {mapping?.optimizedWebpBase64 && (
                            <>
                              <ArrowRight className="w-3.5 h-3.5 text-[#9a7b38] shrink-0" />
                              <div
                                className="w-14 h-14 border border-[#9a7b38] bg-[#f8f5ef] flex items-center justify-center overflow-hidden shrink-0"
                                title="Optimized WebP Preview (proportional, uncropped)"
                              >
                                <img
                                  src={`data:image/webp;base64,${mapping.optimizedWebpBase64}`}
                                  alt="Optimized WebP preview"
                                  className="max-w-full max-h-full object-contain"
                                />
                              </div>
                            </>
                          )}
                        </div>
                      </td>

                      {/* Product Name, Product Page URL, Deterministic Slug & Target R2 URL */}
                      <td className="py-3.5 px-3 align-top space-y-1.5 min-w-[280px]">
                        <div className="font-semibold text-[#1c1a17]">
                          {item.productName || 'Unmatched Guide Image'}
                        </div>

                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] uppercase tracking-wider text-[#7a6f5f] shrink-0">
                            Product URL:
                          </span>
                          <input
                            type="url"
                            value={item.productPageUrl}
                            onChange={(e) =>
                              setCustomProductUrls((prev) => ({
                                ...prev,
                                [item.originalImageUrl]: e.target.value,
                              }))
                            }
                            placeholder="https://shop.scienceofgifts.com/products/slug"
                            className="w-full px-2 py-1 text-[11px] font-mono bg-[#faf7f2] border border-[#dfd5c5] focus:outline-none focus:border-[#9a7b38]"
                          />
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-[11px]">
                          <span className="font-mono text-[#4f473d]">
                            Target:{' '}
                            <strong className="text-[#1c1a17]">
                              {item.r2ObjectKey || 'Assign product URL to generate slug'}
                            </strong>
                          </span>

                          <select
                            value={item.variantSuffix || ''}
                            onChange={(e) =>
                              setCustomSuffixes((prev) => ({
                                ...prev,
                                [item.originalImageUrl]: e.target.value,
                              }))
                            }
                            className="px-1.5 py-0.5 text-[10px] font-mono bg-[#f4efe6] border border-[#d8ccb8]"
                            title="Deterministic suffix when a product has multiple images"
                          >
                            <option value="">Primary (.webp)</option>
                            <option value="-back">-back.webp</option>
                            <option value="-detail-1">-detail-1.webp</option>
                            <option value="-detail-2">-detail-2.webp</option>
                            <option value="-detail-3">-detail-3.webp</option>
                          </select>
                        </div>

                        {item.optimizedImageUrl && (
                          <div className="text-[10px] font-mono text-[#6d6253] break-all">
                            Public URL: {item.optimizedImageUrl}
                          </div>
                        )}

                        {item.sourceChangedConflict && (
                          <div className="flex items-start gap-1.5 p-2 bg-[#fef6e4] border border-[#f0d596] text-[11px] text-[#8a5a00]">
                            <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span>
                              Slug <code>{item.productSlug}.webp</code> is already mapped to a
                              different source image URL. Choose a suffix (e.g. <code>-back</code>)
                              or enable &ldquo;Allow Slug Conflict Overwrite&rdquo; above.
                            </span>
                          </div>
                        )}
                      </td>

                      {/* Role & Dimensions */}
                      <td className="py-3.5 px-3 align-top space-y-1.5">
                        <select
                          value={item.role}
                          onChange={(e) =>
                            setCustomRoles((prev) => ({
                              ...prev,
                              [item.originalImageUrl]: e.target.value as GuideImageRole,
                            }))
                          }
                          className="px-2 py-1 text-[11px] bg-[#faf7f2] border border-[#dfd5c5] font-medium"
                        >
                          <option value="standard">Standard ({standardMaxWidth}px max)</option>
                          <option value="featured">Featured ({featuredMaxWidth}px max)</option>
                        </select>

                        <div className="font-mono text-[11px] text-[#4f473d] space-y-0.5">
                          <div>
                            Orig:{' '}
                            {mapping?.originalDimensions
                              ? `${mapping.originalDimensions.width} × ${mapping.originalDimensions.height}px`
                              : 'Detect on optimize'}
                          </div>
                          <div>
                            WebP:{' '}
                            {mapping?.optimizedDimensions
                              ? `${mapping.optimizedDimensions.width} × ${mapping.optimizedDimensions.height}px`
                              : estimatedDims
                              ? `~${estimatedDims.width} × ${estimatedDims.height}px`
                              : `Max ${targetMaxWidth}px wide`}
                          </div>
                        </div>
                      </td>

                      {/* File Sizes */}
                      <td className="py-3.5 px-3 align-top font-mono text-[11px] space-y-1">
                        <div className="text-[#6d6253]">
                          Orig: {formatBytes(mapping?.originalFileSizeBytes)}
                        </div>
                        <div className="text-[#17663a] font-semibold">
                          WebP: {formatBytes(mapping?.optimizedFileSizeBytes)}
                        </div>
                        {mapping?.originalFileSizeBytes && mapping?.optimizedFileSizeBytes && (
                          <div className="text-[10px] text-[#1d538a]">
                            {Math.max(
                              0,
                              Math.round(
                                ((mapping.originalFileSizeBytes - mapping.optimizedFileSizeBytes) /
                                  mapping.originalFileSizeBytes) *
                                  100
                              )
                            )}
                            % smaller
                          </div>
                        )}
                      </td>

                      {/* Status Badge & Error Details */}
                      <td className="py-3.5 px-3 align-top space-y-1.5">
                        <span
                          className={`inline-block px-2 py-0.5 text-[11px] font-medium border ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                        {mapping?.errorMessage && (
                          <div className="text-[11px] text-[#a61b1b] max-w-[220px] break-words">
                            {mapping.errorMessage}
                          </div>
                        )}
                        {mapping?.lastOptimizedAt && (
                          <div className="text-[10px] text-[#8c8070]">
                            Optimized {new Date(mapping.lastOptimizedAt).toLocaleTimeString()}
                          </div>
                        )}
                      </td>

                      {/* Per-Row Actions */}
                      <td className="py-3.5 px-3 align-top text-right space-y-1.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            disabled={isOptimizing || isUploading}
                            onClick={() => runOptimizeItems([item], true)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium border border-[#d0c4b2] bg-white hover:bg-[#f4efe6] disabled:opacity-50 cursor-pointer"
                            title="Optimize or Re-optimize this image with current width/quality settings"
                          >
                            <RefreshCw className="w-3 h-3" />
                            {mapping?.optimizedWebpBase64 ? 'Re-optimize' : 'Optimize'}
                          </button>

                          {mapping?.optimizedWebpBase64 && (
                            <button
                              type="button"
                              disabled={isOptimizing || isUploading}
                              onClick={() => runUploadToR2([item], true)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium border border-[#b7d3ef] bg-[#e9f2fb] text-[#1d538a] hover:bg-[#d8e8f8] disabled:opacity-50 cursor-pointer"
                              title="Upload this optimized WebP image to Cloudflare R2"
                            >
                              <CloudUpload className="w-3 h-3" />
                              Upload
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
        )}
      </div>
    </div>
  );
};
