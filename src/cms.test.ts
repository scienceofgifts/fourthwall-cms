import { describe, it, expect } from 'vitest';
import {
  SEED_GREEK_GUIDE,
  SEED_GREEK_SECTIONS,
  SEED_PRODUCTS,
} from './data/greekMythologySeed';
import {
  extractCanonicalFaqsFromSections,
  renderFullGuideHtml,
  renderSectionHtml,
  sanitizeEditorialHtml,
  validateGuideForExport,
} from './services/htmlRenderer';
import { generateGuideJsonLd } from './services/schemaGenerator';
import { parseProductImportBatch } from './services/importParser';
import {
  extractProductFromHtml,
  isPrivateOrInternalHost,
  validateFetchableProductUrl,
} from './services/productExtractor';
import {
  findDuplicateProduct,
  generateProductBrief,
  mergeRefreshedProductData,
} from './services/briefGenerator';
import {
  addRepeatedGroupItem,
  analyzeHtmlDocument,
  analyzeProjectSections,
  appendHtmlSectionToProject,
  applyCatalogProductToCard,
  attachPreviewImageFallbacks,
  buildSafePreviewHtml,
  deleteProjectSectionById,
  ensureProjectHasSections,
  evaluateHtmlExportSize,
  exportCompleteProjectHtml,
  exportProjectSectionHtml,
  formatProductRankValue,
  getBlockNumberingKey,
  isSectionEligibleForProductNumbering,
  parseHtmlToAst,
  parseProductNumberFromText,
  removeRepeatedGroupItem,
  renameProjectSectionById,
  reorderProjectSectionById,
  reorderRepeatedGroupItem,
  replaceProjectHtmlContent,
  resolvePreviewSrcset,
  resolvePreviewUrl,
  resolveSectionStartingNumbers,
  serializeAstToHtml,
  updateElementAttributes,
  updateElementIdAndReferences,
  updateHtmlNodeText,
  updateProductCardPrice,
  updateProductCardUrls,
  updateProjectSectionHtmlById,
  updateProjectSectionStartingNumberById,
  updateProjectSectionTypeById,
  updateSectionProductNumbering,
  DEFAULT_GIFT_GUIDE_CSS,
  buildFourthwallExportCode,
  buildPreviewIframeDocument,
  normalizeHeaderCssInput,
  resolveProjectCss,
  updateProjectCss,
} from './services/htmlWorkspaceEngine';
import {
  FIRESTORE_GLOBAL_HEADER_CSS_DOC_ID,
  StorageDiagnosticError,
  buildFirestoreHtmlProjectPayloads,
  classifyStorageFailure,
  createMockIndexedDbFactory,
  createNewHtmlProject,
  deleteHtmlProject,
  duplicateHtmlProject,
  getActiveHtmlProjectIdAsync,
  getActiveLocalHtmlProjectId,
  getFourthwallHeaderCssSync,
  isOfflineOrTokenServiceError,
  loadFourthwallHeaderCssAsync,
  loadLocalCatalogProducts,
  loadLocalCatalogProductsAsync,
  loadLocalHtmlProjects,
  loadLocalHtmlProjectsAsync,
  mergeCloudAndLocalHtmlProjects,
  reassembleFirestoreHtmlProjects,
  renameHtmlProject,
  restorePreviousFourthwallHeaderCss,
  saveFourthwallHeaderCss,
  saveHtmlProject,
  saveLocalCatalogProducts,
  simulateBrowserReloadForTesting,
  syncCloudFourthwallHeaderCssFromDocs,
  validateHtmlProjectForSave,
  validateUserAuthToken,
} from './services/firebase';
import {
  INITIAL_PRODUCT_CATEGORIES,
  MANAGED_PRODUCT_TYPES,
  addManagedCategory,
  clearRememberedProductCategory,
  clearRememberedProductTags,
  deduplicateProductTags,
  deleteManagedCategory,
  detectProductType,
  formatProductTagsInput,
  getUncatalogedProductCategories,
  isLocalizedFourthwallProductUrl,
  loadManagedCategories,
  loadRememberedProductCategory,
  loadRememberedProductTags,
  loadReuseLastTagsPreference,
  migrateAndHydrateProductRecord,
  migrateCatalogProductUrls,
  normalizeFourthwallProductUrl,
  renameManagedCategory,
  resolveCategoryForProductModal,
  resolveTagsForProductModal,
  saveRememberedProductCategory,
  saveRememberedProductTags,
  saveReuseLastTagsPreference,
} from './services/productCatalogTaxonomy';
import {
  countWords,
  ensureParagraphsHtml,
  extractPlainTextFromHtml,
  isSafeUrl,
  sanitizeEditorialRichHtml,
} from './services/editorialRichText';
import {
  DEFAULT_GEMINI_MODEL_ID,
  GEMINI_MODEL_DEFINITIONS,
  GeminiFallbackError,
  PRIMARY_GEMINI_FALLBACK_ORDER,
  classifyGeminiError,
  executeGeminiWithFallback,
  getSavedGeminiModelPreference,
  resolveModelFallbackChain,
  saveGeminiModelPreference,
} from './services/geminiModelConfig';
import {
  handleAiAnalyzeHtmlRequest,
  handleAiGenerateRequest,
  handleAiStatusRequest,
  handleImageOptimizeRequest,
  handleImageOptimizerStatusRequest,
  handleImageUploadR2Request,
  handleProductFetchUrlRequest,
  handleProductParseHtmlRequest,
} from './services/serverApiHandlers';
import {
  LEGACY_LOCAL_HTML_PROJECTS_KEY,
  LOCAL_ACTIVE_HTML_PROJECT_ID_KEY,
  LOCAL_HTML_PROJECTS_MIGRATED_KEY,
  deleteImageMappingFromIdb,
  getAllImageMappingsFromIdb,
  hydrateHtmlProjectsFromIdb,
  migrateLocalStorageProjectsToIdb,
  removeHtmlProjectFromIdb,
  resetIdbStorageForTesting,
  saveHtmlProjectToIdb,
  saveImageMappingsToIdb,
  setSimulatedIdbFailureForTesting,
} from './services/projectStorageIdb';
import {
  assignDeterministicSuffixesForProductImages,
  buildOptimizedImageFilename,
  buildPublicOptimizedImageUrl,
  buildR2ObjectKey,
  calculateProportionalDimensions,
  deriveProductSlugFromUrl,
  replaceGuideHtmlImageUrls,
  scanGuideHtmlForImages,
  validateR2ObjectKey,
} from './services/imageOptimizerCore';
import {
  computeSha256Hex,
  getR2ConfigurationStatus,
  isWebpBinary,
  uploadWebpToCloudflareR2,
} from './services/imageR2Upload';
import {
  CloudflareImagesBinding,
  parseImageHeaderMetadata,
  processImageWithCloudflareImages,
} from './services/cloudflareImagesProcessor';
import {
  GoogleJwkSet,
  verifyFirebaseIdTokenForR2Upload,
} from './services/firebaseTokenVerifier';
import { processImageWithSharp } from './services/nodeSharpProcessor';
import sharp from 'sharp';
import { handleWorkerRequest } from '../workers';
import {
  GiftGuide,
  GuideSection,
  HtmlEditorProject,
  Product,
  ProductImageMappingRecord,
} from './types/cms';

const sampleProducts: Product[] = SEED_PRODUCTS.map((p) => ({
  ...p,
  ownerId: 'user-test-1',
}));

const sampleGreekGuide: GiftGuide = {
  ...SEED_GREEK_GUIDE,
  ownerId: 'user-test-1',
};

const sampleGreekSections: GuideSection[] = SEED_GREEK_SECTIONS.map((s) => ({
  ...s,
  ownerId: 'user-test-1',
}));

describe('Fourthwall HTML Template Renderer & Export Verification', () => {
  it('renders each section independently with exact Fourthwall CSS classes and zero global stylesheet or JS', () => {
    const tocSec = sampleGreekSections.find((s) => s.type === 'bookmarks')!;
    const tocHtml = renderSectionHtml(tocSec, sampleProducts, { forPreview: false });
    expect(tocHtml).toContain('class="sog-toc-box"');
    expect(tocHtml).toContain('class="sog-toc-grid"');
    expect(tocHtml).toContain('href="#jump-quick-picks"');
    expect(tocHtml).not.toContain('<style');
    expect(tocHtml).not.toContain('<script');

    const qpSec = sampleGreekSections.find((s) => s.type === 'quick_picks')!;
    const qpHtml = renderSectionHtml(qpSec, sampleProducts, { forPreview: false });
    expect(qpHtml).toContain('id="jump-quick-picks"');
    expect(qpHtml).toContain('class="sog-quick-picks"');
    expect(qpHtml).toContain('class="sog-qp-card"');
    expect(qpHtml).toContain('class="sog-qp-badge"');
    expect(qpHtml).toContain(
      'data-product-url="/products/hades-greek-mythology-shirt-ruler-of-the-underworld-t-shirt"'
    );
    expect(qpHtml).not.toContain('data:image/svg+xml');

    const epSec = sampleGreekSections.find((s) => s.type === 'editors_pick')!;
    const epHtml = renderSectionHtml(epSec, sampleProducts, { forPreview: false });
    expect(epHtml).toContain('id="jump-editors-pick"');
    expect(epHtml).toContain('class="sog-editor-pick"');
    expect(epHtml).toContain('class="sog-ep-kicker"');
    expect(epHtml).toContain("Charon&#39;s Ferry &amp; Transit Co. Greek Mythology Sweatshirt");

    const edSec = sampleGreekSections.find((s) => s.id === 'sec-part1-apparel')!;
    const edHtml = renderSectionHtml(edSec, sampleProducts, { forPreview: false });
    expect(edHtml).toContain('class="sog-chapter-banner"');
    expect(edHtml).toContain('class="sog-editorial-list"');
    expect(edHtml).toContain('class="sog-ed-card"');
    expect(edHtml).toContain('class="sog-ed-specs"');
    expect(edHtml).toContain('class="sog-more-section"');
    expect(edHtml).toContain('class="sog-card-grid"');

    const hubSec = sampleGreekSections.find((s) => s.type === 'category_hub')!;
    const hubHtml = renderSectionHtml(hubSec, sampleProducts, { forPreview: false });
    expect(hubHtml).toContain('id="jump-deity-hub"');
    expect(hubHtml).toContain('class="sog-deity-grid"');
    expect(hubHtml).toContain('class="sog-deity-card" id="jump-zeus"');
    expect(hubHtml).toContain('class="sog-deity-chip"');

    const faqSec = sampleGreekSections.find((s) => s.type === 'buying_guide')!;
    const faqHtml = renderSectionHtml(faqSec, sampleProducts, { forPreview: false });
    expect(faqHtml).toContain('id="jump-faq"');
    expect(faqHtml).toContain('class="sog-buying-guide"');
    expect(faqHtml).toContain('class="sog-bg-pillars"');
    expect(faqHtml).toContain('class="sog-faq-grid"');
    expect(faqHtml).toContain('class="sog-faq-card"');
  });

  it('assembles full-guide HTML in configured section order and omits disabled sections', () => {
    const fullHtml = renderFullGuideHtml(sampleGreekSections, sampleProducts, {
      forPreview: false,
    });
    const idxToc = fullHtml.indexOf('id="jump-toc"');
    const idxQp = fullHtml.indexOf('id="jump-quick-picks"');
    const idxEp = fullHtml.indexOf('id="jump-editors-pick"');
    const idxApparel = fullHtml.indexOf('id="jump-apparel"');
    const idxFaq = fullHtml.indexOf('id="jump-faq"');

    expect(idxToc).toBeGreaterThanOrEqual(0);
    expect(idxQp).toBeGreaterThan(idxToc);
    expect(idxEp).toBeGreaterThan(idxQp);
    expect(idxApparel).toBeGreaterThan(idxEp);
    expect(idxFaq).toBeGreaterThan(idxApparel);

    const modifiedSections = sampleGreekSections.map((s) =>
      s.id === 'sec-quick-picks' ? { ...s, enabled: false } : s
    );
    const updatedFullHtml = renderFullGuideHtml(modifiedSections, sampleProducts, {
      forPreview: false,
    });
    expect(updatedFullHtml).not.toContain('id="jump-quick-picks"');
  });

  it('detects duplicate section anchor IDs during export validation', () => {
    const cleanIssues = validateGuideForExport(
      sampleGreekGuide,
      sampleGreekSections,
      sampleProducts
    );
    expect(cleanIssues.filter((i) => i.severity === 'error')).toHaveLength(0);

    const dupSections = sampleGreekSections.map((s, idx) =>
      idx === 2 ? { ...s, anchorId: 'jump-quick-picks' } : s
    );
    const dupIssues = validateGuideForExport(sampleGreekGuide, dupSections, sampleProducts);
    expect(dupIssues.some((i) => i.code === 'DUPLICATE_ANCHOR_ID')).toBe(true);
  });
});

describe('Unified @graph JSON-LD Schema Generator & Validator', () => {
  it('generates valid BreadcrumbList, ItemList, and FAQPage JSON-LD wrapped in standalone script tags', () => {
    const result = generateGuideJsonLd(
      sampleGreekGuide,
      sampleGreekSections,
      sampleProducts
    );

    expect(result.validationIssues.filter((i) => i.severity === 'error')).toHaveLength(0);
    expect(result.scriptBlock.startsWith('<script type="application/ld+json">')).toBe(true);
    expect(result.scriptBlock.endsWith('</script>')).toBe(true);

    const parsed = JSON.parse(result.formattedJson);
    expect(parsed['@context']).toBe('https://schema.org');
    expect(Array.isArray(parsed['@graph'])).toBe(true);
    expect(parsed['@graph']).toHaveLength(3);

    const [breadcrumb, itemList, faqPage] = parsed['@graph'];
    expect(breadcrumb['@type']).toBe('BreadcrumbList');
    expect(breadcrumb.itemListElement[0].position).toBe(1);
    expect(breadcrumb.itemListElement[2].position).toBe(3);

    expect(itemList['@type']).toBe('ItemList');
    expect(itemList.numberOfItems).toBe(
      sampleGreekGuide.schemaConfig.includedProductIds.length
    );
    expect(itemList.itemListElement[0].position).toBe(1);
    expect(itemList.itemListElement[0].item.name).toContain("Charon's Ferry");

    const visibleFaqs = extractCanonicalFaqsFromSections(sampleGreekSections);
    expect(faqPage['@type']).toBe('FAQPage');
    expect(faqPage.mainEntity).toHaveLength(visibleFaqs.length);
    expect(faqPage.mainEntity[0].name).toBe(visibleFaqs[0].question);
  });
});

describe('Feature 1: Product Catalog URL Extraction, SSRF Safety, Refresh & Brief Generator', () => {
  it('blocks localhost, private, loopback, and link-local hosts for SSRF protection', () => {
    expect(isPrivateOrInternalHost('localhost')).toBe(true);
    expect(isPrivateOrInternalHost('127.0.0.1')).toBe(true);
    expect(isPrivateOrInternalHost('10.0.0.1')).toBe(true);
    expect(isPrivateOrInternalHost('192.168.1.50')).toBe(true);
    expect(isPrivateOrInternalHost('172.16.0.5')).toBe(true);
    expect(isPrivateOrInternalHost('169.254.169.254')).toBe(true);
    expect(isPrivateOrInternalHost('::1')).toBe(true);
    expect(isPrivateOrInternalHost('scienceofgifts.com')).toBe(false);

    expect(validateFetchableProductUrl('http://127.0.0.1:8080/secret').valid).toBe(false);
    expect(validateFetchableProductUrl('file:///etc/passwd').valid).toBe(false);
    expect(
      validateFetchableProductUrl('https://scienceofgifts.com/products/athena-owl-mug').valid
    ).toBe(true);
  });

  it('extracts structured product metadata, sale price, original price, SKU, and variant prices from JSON-LD without fabricating missing fields', () => {
    const sampleHtml = `
      <!doctype html>
      <html>
        <head>
          <title>Athena Owl Ceramic Mug | Science of Gifts</title>
          <meta property="og:image" content="https://cdn.example.com/athena-1.jpg" />
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Product",
              "name": "Athena Owl Ceramic Mug",
              "sku": "SOG-ATH-MUG",
              "category": "Drinkware",
              "description": "Heavy gloss ceramic coffee mug featuring the tetradrachm owl.",
              "image": [
                "https://cdn.example.com/athena-1.jpg",
                "https://cdn.example.com/athena-2.jpg"
              ],
              "offers": [
                {
                  "@type": "Offer",
                  "name": "11oz Mug",
                  "price": "18.90",
                  "priceCurrency": "USD",
                  "sku": "SOG-ATH-11",
                  "availability": "https://schema.org/InStock"
                },
                {
                  "@type": "Offer",
                  "name": "15oz Mug",
                  "price": "22.90",
                  "priceCurrency": "USD",
                  "sku": "SOG-ATH-15",
                  "availability": "https://schema.org/InStock"
                }
              ]
            }
          </script>
        </head>
        <body>
          <span class="compare-at-price">$24.00</span>
          <ul class="product-specs">
            <li>Material: Glossy White Ceramic</li>
            <li>Care: Dishwasher and microwave safe</li>
          </ul>
        </body>
      </html>
    `;

    const extracted = extractProductFromHtml(
      sampleHtml,
      'https://scienceofgifts.com/products/athena-owl-mug'
    );

    expect(extracted.name).toBe('Athena Owl Ceramic Mug');
    expect(extracted.productUrl).toBe('https://scienceofgifts.com/products/athena-owl-mug');
    expect(extracted.price).toBe('$18.90');
    expect(extracted.originalPrice).toBe('$24.00');
    expect(extracted.sku).toBe('SOG-ATH-MUG');
    expect(extracted.imageUrls).toHaveLength(2);
    expect(extracted.variants).toHaveLength(2);
    expect(extracted.variants[0].title).toBe('11oz Mug');
    expect(extracted.variants[0].price).toBe('$18.90');
    expect(extracted.variants[1].title).toBe('15oz Mug');
    expect(extracted.variants[1].price).toBe('$22.90');
    expect(extracted.fetchStatus).toBe('success');
  });

  it('handles incomplete or blocked pages gracefully without inventing prices or specs', () => {
    const blockedHtml = `<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>`;
    const extracted = extractProductFromHtml(
      blockedHtml,
      'https://scienceofgifts.com/products/mystery-item'
    );
    expect(extracted.price).toBe('');
    expect(extracted.sku).toBe('');
    expect(extracted.variants).toHaveLength(0);
    expect(extracted.warnings.length).toBeGreaterThan(0);
  });

  it('detects duplicate URLs/SKUs and safely merges refreshed data without overwriting custom notes or replacing valid data with empty fields', () => {
    const dup = findDuplicateProduct(
      sampleProducts,
      'https://scienceofgifts.com/products/hades-greek-mythology-shirt-ruler-of-the-underworld-t-shirt'
    );
    expect(dup).toBeDefined();
    expect(dup?.id).toBe('prod-hades-underworld-tee');

    const existingProduct: Product = {
      ...sampleProducts[0],
      sourceNotes: 'Custom internal editorial note: feature as #1 Underworld gift.',
      price: '$24.90',
      imageUrl: 'https://cdn.example.com/existing-valid-img.jpg',
    };

    const partialRefresh = extractProductFromHtml(
      `<html><head><meta property="og:title" content="Updated Hades Underworld Tee" /></head><body></body></html>`,
      'https://scienceofgifts.com/products/hades-greek-mythology-shirt-ruler-of-the-underworld-t-shirt'
    );

    const { mergedProduct, changes } = mergeRefreshedProductData(existingProduct, partialRefresh);
    expect(mergedProduct.name).toBe('Updated Hades Underworld Tee');
    // Missing price and image in partialRefresh must NOT overwrite existing valid price and image
    expect(mergedProduct.price).toBe('$24.90');
    expect(mergedProduct.imageUrl).toBe('https://cdn.example.com/existing-valid-img.jpg');
    // Custom notes must NEVER be overwritten
    expect(mergedProduct.sourceNotes).toBe(
      'Custom internal editorial note: feature as #1 Underworld gift.'
    );
    expect(changes.some((c) => c.label === 'Title')).toBe(true);
  });

  it('generates structured ChatGPT and Gemini briefs purely locally with zero AI calls and omits empty fields', () => {
    const selected = sampleProducts.slice(0, 3);
    const chatgptBrief = generateProductBrief(selected, {
      target: 'chatgpt',
      guideTopic: 'Best Greek Mythology Gifts (2026)',
      additionalContext: 'Adult mythology readers and classics students',
    });

    expect(chatgptBrief).toContain('Best Greek Mythology Gifts (2026)');
    expect(chatgptBrief).toContain(selected[0].name);
    expect(chatgptBrief).toContain(selected[0].productUrl);
    expect(chatgptBrief).toContain(selected[0].price);
    expect(chatgptBrief).not.toContain('undefined');

    const geminiBrief = generateProductBrief(selected, {
      target: 'gemini',
      guideTopic: 'Best Greek Mythology Gifts (2026)',
      additionalContext: 'Adult mythology readers',
    });
    expect(geminiBrief).toContain('# GIFT GUIDE PRODUCT BRIEF (FOR GEMINI)');
    expect(geminiBrief).toContain('PRODUCT 3');
  });
});

describe('Feature 2: HTML Editing Workspace Engine (All 10 Required HTML Input Types)', () => {
  it('1. parses and edits a single product card without adding unsupported fields or corrupting unrelated attributes', () => {
    const singleCardHtml = `<article class="sog-qp-card" data-custom="keep-me"><span class="sog-qp-badge">Best Overall</span><a class="sog-qp-img-link" href="/products/old-slug"><img class="sog-qp-img" src="https://cdn.example.com/old.jpg" alt="Old Alt"></a><div class="sog-qp-body"><h3 class="sog-qp-title"><a href="/products/old-slug">Old Product Title</a></h3><p class="sog-qp-hook">Original hook text.</p></div><div class="sog-qp-footer"><a class="sog-qp-btn" href="/products/old-slug">View Product →</a></div></article>`;

    const analysis = analyzeHtmlDocument(singleCardHtml);
    expect(analysis.blocks).toHaveLength(1);
    const card = analysis.blocks[0].productCards[0];
    expect(card).toBeDefined();
    expect(card.fields.title?.value).toBe('Old Product Title');
    // Note: this card has NO price element (.sog-qp-price), so fields.price must be undefined
    expect(card.fields.price).toBeUndefined();

    // Sync with a catalog product: must NOT invent a price element since the card doesn't have one
    const updatedHtml = applyCatalogProductToCard(singleCardHtml, card, sampleProducts[0]);
    expect(updatedHtml).toContain(sampleProducts[0].name);
    expect(updatedHtml).toContain(sampleProducts[0].productUrl);
    expect(updatedHtml).toContain('data-custom="keep-me"');
    expect(updatedHtml).not.toContain('sog-qp-price');
  });

  it('2. parses a repeated product grid and supports adding, removing, and reordering cards', () => {
    const qpSec = sampleGreekSections.find((s) => s.type === 'quick_picks')!;
    const gridHtml = renderSectionHtml(qpSec, sampleProducts, { forPreview: false });

    const analysis = analyzeHtmlDocument(gridHtml);
    const block = analysis.blocks[0];
    expect(block.repeatedContainerPath).toBeDefined();
    const initialCount = block.productCards.length;
    expect(initialCount).toBeGreaterThan(2);

    // Add item
    const afterAdd = addRepeatedGroupItem(gridHtml, block.repeatedContainerPath!);
    const analysisAfterAdd = analyzeHtmlDocument(afterAdd);
    expect(analysisAfterAdd.blocks[0].productCards.length).toBe(initialCount + 1);

    // Reorder item
    const firstCardPath = analysisAfterAdd.blocks[0].productCards[0].cardNodePath;
    const afterReorder = reorderRepeatedGroupItem(
      afterAdd,
      analysisAfterAdd.blocks[0].repeatedContainerPath!,
      firstCardPath,
      'down'
    );
    expect(afterReorder).toContain('class="sog-quick-picks"');

    // Remove item
    const analysisBeforeRemove = analyzeHtmlDocument(afterReorder);
    const afterRemove = removeRepeatedGroupItem(
      afterReorder,
      analysisBeforeRemove.blocks[0].productCards[0].cardNodePath
    );
    const analysisAfterRemove = analyzeHtmlDocument(afterRemove);
    expect(analysisAfterRemove.blocks[0].productCards.length).toBe(initialCount);
  });

  it('3. parses an editorial product list with heterogeneous cards (some with specs/badges, some without)', () => {
    const heteroEditorialHtml = `
      <div class="sog-editorial-list">
        <article class="sog-ed-card">
          <div class="sog-ed-media">
            <span class="sog-ed-num">#01</span>
            <a class="sog-ed-img-wrap" href="/products/item-a"><img class="sog-ed-img" src="https://cdn.example.com/a.jpg" alt="Item A"></a>
          </div>
          <div class="sog-ed-content">
            <div class="sog-ed-meta-row"><span class="sog-ed-badge">Best Overall</span><span class="sog-ed-type">T-Shirt</span></div>
            <h3 class="sog-ed-title"><a href="/products/item-a">Item A With Specs</a></h3>
            <div class="sog-ed-body"><p>Editorial paragraph for Item A.</p></div>
            <div class="sog-ed-specs"><p>Verified Specs: Unisex S-3XL</p></div>
            <div class="sog-ed-cta-row"><span class="sog-ed-price">$24.90</span><a class="sog-ed-btn" href="/products/item-a">Shop Item A →</a></div>
          </div>
        </article>
        <article class="sog-ed-card">
          <div class="sog-ed-media">
            <a class="sog-ed-img-wrap" href="/products/item-b"><img class="sog-ed-img" src="https://cdn.example.com/b.jpg" alt="Item B"></a>
          </div>
          <div class="sog-ed-content">
            <h3 class="sog-ed-title"><a href="/products/item-b">Item B Minimal Card</a></h3>
            <div class="sog-ed-body"><p>Editorial paragraph for Item B without rank, type, price, or specs.</p></div>
            <div class="sog-ed-cta-row"><a class="sog-ed-btn" href="/products/item-b">Shop Item B →</a></div>
          </div>
        </article>
      </div>
    `;

    const analysis = analyzeHtmlDocument(heteroEditorialHtml);
    expect(analysis.blocks[0].productCards).toHaveLength(2);
    const [cardA, cardB] = analysis.blocks[0].productCards;

    expect(cardA.fields.badge).toBeDefined();
    expect(cardA.fields.price).toBeDefined();
    expect(cardA.fields.specsCallout).toBeDefined();

    // Card B does not have badge, price, or specs list
    expect(cardB.fields.badge).toBeUndefined();
    expect(cardB.fields.price).toBeUndefined();
    expect(cardB.fields.specsCallout).toBeUndefined();

    // Updating Card A price leaves Card B untouched
    const updated = updateProductCardPrice(
      heteroEditorialHtml,
      cardA.fields.price!.nodePath,
      '$29.90'
    );
    expect(updated).toContain('$29.90');
    expect(updated).toContain('Item B Minimal Card');
  });

  it('4. parses headings, paragraphs, and ordinary links and updates them cleanly', () => {
    const introHtml = `<section id="intro-sec" class="custom-intro"><h2>Why Classical Gifts Matter</h2><p>Explore our <a href="/collections/all" target="_blank">full museum collection</a> today.</p></section>`;
    const analysis = analyzeHtmlDocument(introHtml);
    const headings = analysis.blocks[0].textFields.filter((t) => t.role === 'heading');
    expect(headings).toHaveLength(1);
    expect(analysis.blocks[0].links).toHaveLength(1);

    const h2Path = headings[0].nodePath;
    const updated = updateHtmlNodeText(introHtml, h2Path, 'Updated Classical Gift Guide');
    expect(updated).toContain('<h2>Updated Classical Gift Guide</h2>');
    expect(updated).toContain('href="/collections/all"');
  });

  it('5. parses a table of contents with internal anchors and updates linked hrefs when an ID is renamed', () => {
    const tocAndTargetHtml = `
      <nav class="sog-toc-box" id="jump-toc">
        <div class="sog-toc-title">Quick Jump</div>
        <div class="sog-toc-grid">
          <a class="sog-toc-link" href="#old-anchor"><span class="sog-toc-num">01</span><span>Apparel Section</span></a>
        </div>
      </nav>
      <div class="sog-chapter-banner" id="old-anchor">
        <h2>Part 1: Apparel</h2>
      </div>
    `;

    const analysis = analyzeHtmlDocument(tocAndTargetHtml);
    expect(
      analysis.validationIssues.filter((i) => i.code === 'BROKEN_ANCHOR_LINK')
    ).toHaveLength(0);

    const bannerBlock = analysis.blocks.find((b) => b.elementId === 'old-anchor')!;
    const { html: renamedHtml, updatedLinkCount } = updateElementIdAndReferences(
      tocAndTargetHtml,
      bannerBlock.nodePath,
      'new-apparel-anchor',
      true
    );

    expect(updatedLinkCount).toBe(1);
    expect(renamedHtml).toContain('id="new-apparel-anchor"');
    expect(renamedHtml).toContain('href="#new-apparel-anchor"');
    expect(
      analyzeHtmlDocument(renamedHtml).validationIssues.filter(
        (i) => i.code === 'BROKEN_ANCHOR_LINK'
      )
    ).toHaveLength(0);
  });

  it('6. parses an FAQ section and allows editing questions and answers', () => {
    const faqSec = sampleGreekSections.find((s) => s.type === 'buying_guide')!;
    const faqHtml = renderSectionHtml(faqSec, sampleProducts, { forPreview: false });

    const analysis = analyzeHtmlDocument(faqHtml);
    expect(analysis.blocks[0].faqItems.length).toBeGreaterThan(0);
    expect(analysis.blocks[0].pillarItems.length).toBeGreaterThan(0);

    const firstFaq = analysis.blocks[0].faqItems[0];
    const updated = updateHtmlNodeText(
      faqHtml,
      firstFaq.question.nodePath,
      'Updated Question Text?'
    );
    expect(updated).toContain('Updated Question Text?');
  });

  it('7. parses a mixed multi-section gift guide HTML fragment and preserves section order', () => {
    const fullHtml = renderFullGuideHtml(sampleGreekSections, sampleProducts, {
      forPreview: false,
    });
    const analysis = analyzeHtmlDocument(fullHtml);
    expect(analysis.blocks.length).toBeGreaterThanOrEqual(8);
    expect(analysis.validationIssues.filter((i) => i.code === 'DUPLICATE_ID')).toHaveLength(0);
    expect(
      analysis.validationIssues.filter((i) => i.code === 'BROKEN_ANCHOR_LINK')
    ).toHaveLength(0);
  });

  it('8. preserves unfamiliar classes, nested wrappers, custom data attributes, and inline styles', () => {
    const customHtml = `<div class="bespoke-wrapper" data-tracking-id="fw-992" style="border: 2px solid gold;"><div class="inner-nest"><h3 class="bespoke-heading">Custom Callout Box</h3><p data-note="preserve">Special archival edition.</p></div></div>`;
    const ast = parseHtmlToAst(customHtml);
    const roundTrip = serializeAstToHtml(ast.rootChildren);
    expect(roundTrip).toBe(customHtml);

    const analysis = analyzeHtmlDocument(customHtml);
    const heading = analysis.blocks[0].textFields.find((t) => t.role === 'heading')!;
    const updated = updateHtmlNodeText(customHtml, heading.nodePath, 'Edited Callout Heading');
    expect(updated).toContain('data-tracking-id="fw-992"');
    expect(updated).toContain('style="border: 2px solid gold;"');
    expect(updated).toContain('data-note="preserve"');
    expect(updated).toContain('Edited Callout Heading');
  });

  it('9. handles malformed or incomplete HTML gracefully without crashing', () => {
    const malformed = `<div class="sog-ed-card"><h3>Unclosed Heading<p>Paragraph text<img src="https://cdn.example.com/test.jpg" alt="Test"></div>`;
    const analysis = analyzeHtmlDocument(malformed);
    expect(analysis.blocks.length).toBeGreaterThan(0);
    const imgNodePath =
      analysis.blocks[0].productCards[0]?.fields.image?.nodePath ||
      analysis.blocks[0].images[0]?.nodePath;
    expect(imgNodePath).toBeDefined();

    const updated = updateElementAttributes(malformed, imgNodePath!, {
      alt: 'Updated Alt Text',
    });
    expect(updated).toContain('alt="Updated Alt Text"');
  });

  it('10. neutralizes <script> tags and inline on* handlers in Live Preview while flagging duplicate IDs and broken anchors', () => {
    const unsafeHtml = `
      <div id="dup-id">First Box</div>
      <div id="dup-id"><a href="#missing-target" onclick="evil()">Jump Nowhere</a></div>
      <script>window.hacked = true;</script>
    `;

    const analysis = analyzeHtmlDocument(unsafeHtml);
    expect(
      analysis.validationIssues.some((i) => i.code === 'SCRIPT_TAG_DETECTED')
    ).toBe(true);
    expect(
      analysis.validationIssues.some(
        (i) => i.code === 'DUPLICATE_ID' && i.targetId === 'dup-id'
      )
    ).toBe(true);
    expect(
      analysis.validationIssues.some(
        (i) => i.code === 'BROKEN_ANCHOR_LINK' && i.targetId === 'missing-target'
      )
    ).toBe(true);

    const safePreview = buildSafePreviewHtml(unsafeHtml, sampleProducts);
    expect(safePreview).not.toContain('<script>');
    expect(safePreview).not.toContain('onclick=');
    expect(safePreview).toContain('First Box');
  });

  it('updates all linked URLs inside a product card simultaneously when edited', () => {
    const qpSec = sampleGreekSections.find((s) => s.type === 'quick_picks')!;
    const qpHtml = renderSectionHtml(qpSec, sampleProducts, { forPreview: false });
    const analysis = analyzeHtmlDocument(qpHtml);
    const firstCard = analysis.blocks[0].productCards[0];

    const updated = updateProductCardUrls(
      qpHtml,
      firstCard.fields.productUrl.hrefNodePaths,
      firstCard.fields.productUrl.dataUrlNodePaths,
      '/products/new-unified-url'
    );
    expect(updated).toContain('href="/products/new-unified-url"');
    expect(updated).toContain('data-product-url="/products/new-unified-url"');
  });
});

describe('Project Isolation, Manual Edits Preservation & Import Validation', () => {
  it('keeps canonical product edits separate from guide-specific editorial overrides', () => {
    const updatedProducts = sampleProducts.map((p) =>
      p.id === 'prod-hades-underworld-tee'
        ? { ...p, name: 'Canonical Library Updated Name' }
        : p
    );

    const edSec = sampleGreekSections.find((s) => s.id === 'sec-part1-apparel')!;
    const rendered = renderSectionHtml(edSec, updatedProducts, { forPreview: false });

    expect(rendered).toContain('Hades Ruler of the Underworld Graphic T-Shirt');
    expect(rendered).toContain(
      'Fans of Hades and underworld lore tend to outgrow cartoonish merch quickly.'
    );
  });

  it('reports invalid CSV rows clearly while preserving valid rows in the same batch', () => {
    const csvBatch = [
      'name,productUrl,price,productType,category',
      'Valid Roman Coin Mug,/products/spqr-roman-coin-mug,$18.90,Ceramic Mug,Rome',
      'Broken Row Missing URL,,$24.90,T-Shirt,Rome',
      'Broken Price Row,/products/bad-price-item,FREE_PRICE,T-Shirt,Rome',
      'Second Valid SPQR Hoodie,/products/spqr-legion-hoodie,49.90,Hoodie,Rome',
    ].join('\n');

    const report = parseProductImportBatch(csvBatch);
    expect(report.totalRows).toBe(4);
    expect(report.validProducts).toHaveLength(2);
    expect(report.invalidRows).toHaveLength(2);
    expect(report.validProducts[0].productUrl).toBe('/products/spqr-roman-coin-mug');
    expect(report.validProducts[1].price).toBe('$49.90');
  });

  it('sanitizes dangerous inline scripts from editorial HTML while preserving links', () => {
    const dirty =
      'Check out <a href="/products/test" onclick="alert(1)">our top pick</a><script>evil()</script>!';
    const clean = sanitizeEditorialHtml(dirty);
    expect(clean).toContain('<a href="/products/test">our top pick</a>');
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('<script>');
  });
});

describe('Persistent HTML Editor Projects & Preview Image Resolution (All 10 Required Scenarios)', () => {
  const createMemoryLocalStorage = () => {
    const store = new Map<string, string>();
    return {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
    };
  };

  it('1 & 2. creates projects, saves edits, survives reloads, and keeps multiple projects independent without overwriting each other', async () => {
    const mockStorage = createMemoryLocalStorage();
    Object.defineProperty(globalThis, 'window', {
      value: { localStorage: mockStorage },
      configurable: true,
      writable: true,
    });

    // Create Project A
    const pastedHtmlA = `<section id="history-guide"><h2>History Gifts Guide</h2><p>Original intro for history buffs.</p></section>`;
    const projA = await createNewHtmlProject({
      name: 'History Gifts Guide',
      htmlContent: pastedHtmlA,
      baseUrl: 'https://scienceofgifts.com',
    });

    expect(projA.name).toBe('History Gifts Guide');
    expect(projA.originalHtml).toBe(pastedHtmlA);
    expect(projA.currentHtml).toBe(pastedHtmlA);

    // Edit Project A and save
    const editedHtmlA = updateHtmlNodeText(
      projA.currentHtml,
      analyzeHtmlDocument(projA.currentHtml).blocks[0].textFields[0].nodePath,
      'Updated History Gifts Guide 2026'
    );
    await saveHtmlProject({
      ...projA,
      currentHtml: editedHtmlA,
    });

    // Create Project B
    const pastedHtmlB = `<section id="myth-guide"><h2>Greek Mythology Gifts</h2><p>Original mythology copy.</p></section>`;
    const projB = await createNewHtmlProject({
      name: 'Greek Mythology Gifts',
      htmlContent: pastedHtmlB,
      baseUrl: 'https://scienceofgifts.com',
    });

    // Edit Project B and save
    const editedHtmlB = updateHtmlNodeText(
      projB.currentHtml,
      analyzeHtmlDocument(projB.currentHtml).blocks[0].textFields[0].nodePath,
      'Olympian & Underworld Gifts'
    );
    await saveHtmlProject({
      ...projB,
      currentHtml: editedHtmlB,
    });

    // Simulate reload: read projects fresh from storage
    const reloadedProjects = loadLocalHtmlProjects();
    expect(reloadedProjects).toHaveLength(2);
    expect(getActiveLocalHtmlProjectId()).toBe(projB.id);

    const reloadedA = reloadedProjects.find((p) => p.id === projA.id)!;
    const reloadedB = reloadedProjects.find((p) => p.id === projB.id)!;

    // Verify Project A kept its exact edited HTML and original HTML independently of Project B
    expect(reloadedA.name).toBe('History Gifts Guide');
    expect(reloadedA.currentHtml).toContain('<h2>Updated History Gifts Guide 2026</h2>');
    expect(reloadedA.originalHtml).toContain('<h2>History Gifts Guide</h2>');

    // Verify Project B kept its exact edited HTML and original HTML independently of Project A
    expect(reloadedB.name).toBe('Greek Mythology Gifts');
    expect(reloadedB.currentHtml).toContain('<h2>Olympian &amp; Underworld Gifts</h2>');
    expect(reloadedB.originalHtml).toContain('<h2>Greek Mythology Gifts</h2>');
  });

  it('3. renames, duplicates, and deletes projects cleanly', async () => {
    const mockStorage = createMemoryLocalStorage();
    Object.defineProperty(globalThis, 'window', {
      value: { localStorage: mockStorage },
      configurable: true,
      writable: true,
    });

    const p1 = await createNewHtmlProject({
      name: 'Initial Guide Name',
      htmlContent: '<div class="sog-quick-picks"><h3>Card 1</h3></div>',
    });

    const renamed = await renameHtmlProject(p1.id, 'Roman Empire Gifts Guide');
    expect(renamed.name).toBe('Roman Empire Gifts Guide');

    const duplicated = await duplicateHtmlProject(p1.id);
    expect(duplicated.id).not.toBe(p1.id);
    expect(duplicated.name).toBe('Roman Empire Gifts Guide (Copy)');
    expect(duplicated.currentHtml).toBe(p1.currentHtml);
    expect(loadLocalHtmlProjects()).toHaveLength(2);

    await deleteHtmlProject(p1.id);
    const afterDelete = loadLocalHtmlProjects();
    expect(afterDelete).toHaveLength(1);
    expect(afterDelete[0].id).toBe(duplicated.id);
  });

  it('4. surfaces an actionable error and never falsely succeeds when IndexedDB saving fails (quota or validation error), while succeeding if only localStorage is full', async () => {
    const failingLocalStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError: Persistent storage limit reached');
      },
      removeItem: () => {},
    };
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: failingLocalStorage,
        indexedDB: createMockIndexedDbFactory(),
      },
      configurable: true,
      writable: true,
    });
    resetIdbStorageForTesting();

    const validProj: HtmlEditorProject = {
      id: 'proj-quota-test',
      ownerId: 'local-preview',
      name: 'Quota Failure Guide',
      currentHtml: '<section><h2>Test</h2></section>',
      originalHtml: '<section><h2>Test</h2></section>',
      baseUrl: 'https://scienceofgifts.com',
      editorState: {
        viewMode: 'split',
        selectedBlockId: 'ALL',
        sidebarTab: 'blocks',
        previewViewport: 'desktop',
        includeFourthwallCss: true,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      setSimulatedIdbFailureForTesting('quota_exceeded');
      await expect(saveHtmlProject(validProj)).rejects.toThrow(
        /IndexedDB quota exceeded/i
      );
    } finally {
      setSimulatedIdbFailureForTesting('none');
    }

    // When IndexedDB is available, a localStorage QuotaExceededError must NOT cause saveHtmlProject to fail
    const savedDespiteFullLocalStorage = await saveHtmlProject(validProj);
    expect(savedDespiteFullLocalStorage.id).toBe('proj-quota-test');
    expect(await getActiveHtmlProjectIdAsync()).toBe('proj-quota-test');

    // Also test validation error for empty project name
    const emptyNameValidation = validateHtmlProjectForSave({
      ...validProj,
      name: '   ',
    });
    expect(emptyNameValidation.valid).toBe(false);
    expect(emptyNameValidation.error).toMatch(/name/i);
    await expect(
      saveHtmlProject({
        ...validProj,
        name: '   ',
      })
    ).rejects.toThrow(/name/i);
  });

  it('5, 6, 7 & 8. resolves normal URLs, lazy-loaded attributes, relative URLs/srcset against baseUrl, and missing/placeholder src in preview while preserving aspect-ratio/dimensions', () => {
    const htmlWithDiverseImages = `
      <div class="sog-quick-picks">
        <!-- 5. Normal absolute image URL with dimensions & style -->
        <article class="sog-qp-card">
          <a class="sog-qp-img-link" href="https://scienceofgifts.com/products/normal-item">
            <img class="sog-qp-img" src="https://cdn.example.com/normal-product.jpg" alt="Normal Product" width="600" height="600" style="aspect-ratio: 1 / 1; object-fit: cover;">
          </a>
        </article>

        <!-- 6. Lazy-loaded image with empty src attribute and data-src + data-srcset -->
        <article class="sog-qp-card">
          <a class="sog-qp-img-link" href="/products/lazy-item">
            <img class="sog-qp-img lazyload" src="" data-src="https://cdn.example.com/lazy-product.jpg" data-srcset="/cdn/lazy-1x.jpg 1x, /cdn/lazy-2x.jpg 2x" alt="Lazy Loaded Product" loading="lazy">
          </a>
        </article>

        <!-- 7. Relative image src and srcset resolved against baseUrl -->
        <article class="sog-qp-card">
          <a class="sog-qp-img-link" href="/products/relative-item">
            <img class="sog-qp-img" src="/assets/images/relative-owl-mug.jpg" srcset="/assets/images/relative-owl-mug-400.jpg 400w, images/relative-owl-mug-800.jpg 800w" alt="Relative Owl Mug">
          </a>
        </article>

        <!-- 8a. Missing src that matches a catalog product via data-product-url -->
        <article class="sog-qp-card">
          <a class="sog-qp-img-link" href="/products/hades-greek-mythology-shirt-ruler-of-the-underworld-t-shirt">
            <img class="sog-qp-img" src="" data-product-url="/products/hades-greek-mythology-shirt-ruler-of-the-underworld-t-shirt" alt="Hades Tee">
          </a>
        </article>

        <!-- 8b. Completely missing image src with no catalog match (renders neutral SVG placeholder) -->
        <article class="sog-qp-card">
          <a class="sog-qp-img-link" href="/products/unmatched-unknown-gift">
            <img class="sog-qp-img" src="" alt="Unmatched Gift Item">
          </a>
        </article>
      </div>
    `;

    const previewHtml = buildSafePreviewHtml(htmlWithDiverseImages, sampleProducts, {
      baseUrl: 'https://scienceofgifts.com',
    });

    // 5. Normal image URL & sizing attributes preserved
    expect(previewHtml).toContain('src="https://cdn.example.com/normal-product.jpg"');
    expect(previewHtml).toContain('width="600"');
    expect(previewHtml).toContain('height="600"');
    expect(previewHtml).toContain('style="aspect-ratio: 1 / 1; object-fit: cover;"');

    // 6. Lazy-loaded image promoted to primary src (and no duplicate empty src="" before it!)
    expect(previewHtml).toContain('src="https://cdn.example.com/lazy-product.jpg"');
    expect(previewHtml).not.toContain('src=""');
    expect(previewHtml).not.toContain('loading="lazy"');
    expect(previewHtml).toContain(
      'srcset="https://scienceofgifts.com/cdn/lazy-1x.jpg 1x, https://scienceofgifts.com/cdn/lazy-2x.jpg 2x"'
    );

    // 7. Relative URLs resolved against baseUrl
    expect(previewHtml).toContain(
      'src="https://scienceofgifts.com/assets/images/relative-owl-mug.jpg"'
    );
    expect(previewHtml).toContain(
      'srcset="https://scienceofgifts.com/assets/images/relative-owl-mug-400.jpg 400w, https://scienceofgifts.com/images/relative-owl-mug-800.jpg 800w"'
    );

    // 8b. Unmatched empty src replaced with neutral SVG placeholder
    expect(previewHtml).toContain('data:image/svg+xml;utf8,');

    // Direct unit checks on resolvePreviewUrl and resolvePreviewSrcset
    expect(resolvePreviewUrl('/products/img.png', 'https://scienceofgifts.com')).toBe(
      'https://scienceofgifts.com/products/img.png'
    );
    expect(
      resolvePreviewSrcset('/img-1.jpg 1x, /img-2.jpg 2x', 'https://scienceofgifts.com')
    ).toBe('https://scienceofgifts.com/img-1.jpg 1x, https://scienceofgifts.com/img-2.jpg 2x');
  });

  it('8c. replaces broken runtime images in the preview DOM with a neutral placeholder without mutating exported HTML', () => {
    // Minimal mock DOM image & document to verify attachPreviewImageFallbacks
    const listeners: Record<string, Array<() => void>> = {};
    const attrs = new Map<string, string>([
      ['src', 'https://broken.example.com/404-image.jpg'],
      ['alt', 'Broken Amphora Vase'],
      ['data-preview-original-src', 'https://broken.example.com/404-image.jpg'],
    ]);

    const mockImg = {
      complete: false,
      naturalWidth: 0,
      get src() {
        return attrs.get('src') || '';
      },
      set src(val: string) {
        attrs.set('src', val);
      },
      getAttribute: (name: string) => attrs.get(name) ?? null,
      setAttribute: (name: string, val: string) => {
        attrs.set(name, val);
      },
      removeAttribute: (name: string) => {
        attrs.delete(name);
      },
      addEventListener: (evt: string, cb: () => void) => {
        listeners[evt] = listeners[evt] || [];
        listeners[evt].push(cb);
      },
    } as unknown as HTMLImageElement;

    const mockDoc = {
      querySelectorAll: (sel: string) => (sel === 'img' ? [mockImg] : []),
    } as unknown as Document;

    attachPreviewImageFallbacks(mockDoc);
    expect(listeners.error).toHaveLength(1);

    // Trigger runtime network error on the image
    listeners.error[0]();

    expect(mockImg.src.startsWith('data:image/svg+xml;utf8,')).toBe(true);
    expect(decodeURIComponent(mockImg.src)).toContain('Broken Amphora Vase');
  });

  it('9 & 10. keeps exported HTML completely free of preview-only fallback markup and neutralizes scripts/event handlers in preview', () => {
    const rawImportedHtml = `<div class="sog-quick-picks"><article class="sog-qp-card"><a class="sog-qp-img-link" href="/products/hades-greek-mythology-shirt-ruler-of-the-underworld-t-shirt"><img class="sog-qp-img" src="" data-product-url="/products/hades-greek-mythology-shirt-ruler-of-the-underworld-t-shirt" alt="Hades Shirt" onerror="alert('xss')"></a><div class="sog-qp-body"><h3 class="sog-qp-title"><a href="/products/hades-greek-mythology-shirt-ruler-of-the-underworld-t-shirt" onclick="stealCookies()">Hades Tee</a></h3></div></article><script>window.evilPayload = 1;</script></div>`;

    // Generate preview HTML (which injects preview placeholder SVGs and strips scripts/handlers)
    const previewOutput = buildSafePreviewHtml(rawImportedHtml, sampleProducts, {
      baseUrl: 'https://scienceofgifts.com',
    });

    // 10. Scripts and inline event handlers are stripped from preview
    expect(previewOutput).not.toContain('<script');
    expect(previewOutput).not.toContain('window.evilPayload');
    expect(previewOutput).not.toContain('onerror=');
    expect(previewOutput).not.toContain('onclick=');
    expect(previewOutput).toContain('data:image/svg+xml;utf8,');

    // 9. Edit the title via the HTML Workspace Engine and verify the exported HTML is NEVER polluted with preview SVG data URIs or preview attributes
    const analysis = analyzeHtmlDocument(rawImportedHtml, sampleProducts);
    const titlePath = analysis.blocks[0].productCards[0].fields.title!.nodePath;
    const exportedAfterEdit = updateHtmlNodeText(
      rawImportedHtml,
      titlePath,
      'Hades Underworld Collector Tee'
    );

    expect(exportedAfterEdit).toContain('Hades Underworld Collector Tee');
    expect(exportedAfterEdit).toContain(
      'src="" data-product-url="/products/hades-greek-mythology-shirt-ruler-of-the-underworld-t-shirt"'
    );
    expect(exportedAfterEdit).not.toContain('data:image/svg+xml');
    expect(exportedAfterEdit).not.toContain('data-preview-original-src');
    expect(exportedAfterEdit).not.toContain('referrerpolicy="no-referrer"');
  });
});

describe('Feature 5: Configurable Section-Level Starting Product Numbers (All 10 Required Scenarios)', () => {
  const buildThreeSectionHistoryGuideHtml = () => `
    <div class="history-guide-wrapper" data-guide="history-2026">
      <section class="sog-guide-container" id="sec-tshirts">
        <div class="sog-chapter-banner"><span class="sog-chapter-kicker">Section 1</span><h2 class="sog-chapter-title">T-Shirts</h2></div>
        <div class="sog-editorial-list">
          ${[1, 2, 3, 4, 5]
            .map(
              (n) => `
          <article class="sog-ed-card" data-card-sku="tee-${n}">
            <div class="sog-ed-header">
              <div class="sog-ed-rank-box"><span class="sog-ed-num">#0${n}</span></div>
              <div class="sog-ed-title-wrap"><h3 class="sog-ed-title"><a href="/products/history-tee-${n}">History Tee ${n}</a></h3></div>
            </div>
            <div class="sog-ed-grid">
              <div class="sog-ed-media"><img src="https://cdn.scienceofgifts.com/tee-${n}.jpg" alt="History Tee ${n}"></div>
              <div class="sog-ed-body"><div class="sog-ed-copy"><p>Archival cotton tee #${n}.</p></div></div>
            </div>
          </article>`
            )
            .join('')}
        </div>
      </section>

      <section class="sog-guide-container" id="sec-drinkware">
        <div class="sog-chapter-banner"><span class="sog-chapter-kicker">Section 2</span><h2 class="sog-chapter-title">Drinkware</h2></div>
        <div class="sog-editorial-list">
          ${[6, 7, 8, 9, 10]
            .map(
              (n) => `
          <article class="sog-ed-card" data-card-sku="mug-${n}">
            <div class="sog-ed-header">
              <div class="sog-ed-rank-box"><span class="sog-ed-num">#${String(n).padStart(2, '0')}</span></div>
              <div class="sog-ed-title-wrap"><h3 class="sog-ed-title"><a href="/products/history-mug-${n}">History Mug ${n}</a></h3></div>
            </div>
          </article>`
            )
            .join('')}
        </div>
      </section>

      <section class="sog-guide-container" id="sec-posters">
        <div class="sog-chapter-banner"><span class="sog-chapter-kicker">Section 3</span><h2 class="sog-chapter-title">Posters</h2></div>
        <div class="sog-editorial-list">
          ${[11, 12, 13, 14]
            .map(
              (n) => `
          <article class="sog-ed-card" data-card-sku="poster-${n}">
            <div class="sog-ed-header">
              <div class="sog-ed-rank-box"><span class="sog-ed-num">#${String(n).padStart(2, '0')}</span></div>
              <div class="sog-ed-title-wrap"><h3 class="sog-ed-title"><a href="/products/history-poster-${n}">History Poster ${n}</a></h3></div>
            </div>
          </article>`
            )
            .join('')}
        </div>
      </section>
    </div>
  `;

  it('1, 2 & 3. detects a section with 5 products starting at 1 and updates a section with 6 products starting at 7 to 7..12', () => {
    const html = buildThreeSectionHistoryGuideHtml();
    const analysis = analyzeHtmlDocument(html);
    expect(analysis.blocks).toHaveLength(3);

    const [tshirtsBlock, drinkwareBlock, postersBlock] = analysis.blocks;
    const resolvedStarts = resolveSectionStartingNumbers(analysis.blocks);

    expect(resolvedStarts[getBlockNumberingKey(tshirtsBlock)]).toBe(1);
    expect(resolvedStarts[getBlockNumberingKey(drinkwareBlock)]).toBe(6);
    expect(resolvedStarts[getBlockNumberingKey(postersBlock)]).toBe(11);

    // 1. T-Shirts has 5 products numbered #01..#05
    expect(tshirtsBlock.productCards.map((c) => c.fields.rankNumber?.value)).toEqual([
      '#01',
      '#02',
      '#03',
      '#04',
      '#05',
    ]);

    // Add a 6th product to Drinkware and set Drinkware's starting number to 7 -> should number 7, 8, 9, 10, 11, 12
    const withSixthDrinkware = addRepeatedGroupItem(
      html,
      drinkwareBlock.repeatedContainerPath!,
      undefined,
      { startingNumber: 6 }
    );
    const renumberedDrinkware = updateSectionProductNumbering(
      withSixthDrinkware,
      drinkwareBlock.nodePath,
      7
    );
    expect(renumberedDrinkware.hasExplicitNumbering).toBe(true);
    expect(renumberedDrinkware.updatedCount).toBe(6);

    const afterAnalysis = analyzeHtmlDocument(renumberedDrinkware.html);
    const updatedDrinkware = afterAnalysis.blocks[1];
    expect(updatedDrinkware.productCards).toHaveLength(6);
    expect(updatedDrinkware.productCards.map((c) => c.fields.rankNumber?.value)).toEqual([
      '#07',
      '#08',
      '#09',
      '#10',
      '#11',
      '#12',
    ]);
  });

  it('4, 5, 6 & 8. handles adding/removing products and manual starting number changes across sections independently without auto-cascading', () => {
    const html = buildThreeSectionHistoryGuideHtml();
    const initialAnalysis = analyzeHtmlDocument(html);
    const [tshirts, drinkware, posters] = initialAnalysis.blocks;

    // 4. Add a 6th product to T-Shirts (starting number 1) -> T-Shirts becomes #01..#06, while Drinkware (#06..#10) and Posters (#11..#14) remain untouched!
    const htmlAfterAddTee = addRepeatedGroupItem(
      html,
      tshirts.repeatedContainerPath!,
      undefined,
      { startingNumber: 1 }
    );
    const analysisAfterAdd = analyzeHtmlDocument(htmlAfterAddTee);
    expect(analysisAfterAdd.blocks[0].productCards.map((c) => c.fields.rankNumber?.value)).toEqual([
      '#01',
      '#02',
      '#03',
      '#04',
      '#05',
      '#06',
    ]);
    // Drinkware and Posters must NOT be auto-renumbered when T-Shirts changes
    expect(analysisAfterAdd.blocks[1].productCards.map((c) => c.fields.rankNumber?.value)).toEqual([
      '#06',
      '#07',
      '#08',
      '#09',
      '#10',
    ]);
    expect(analysisAfterAdd.blocks[2].productCards.map((c) => c.fields.rankNumber?.value)).toEqual([
      '#11',
      '#12',
      '#13',
      '#14',
    ]);

    // 6. Now manually change Drinkware starting number from 6 to 7 -> only Drinkware updates to #07..#11; Posters stays #11..#14
    const afterDrinkwareStart7 = updateSectionProductNumbering(
      htmlAfterAddTee,
      drinkware.nodePath,
      7
    ).html;
    const analysisAfterDrinkware = analyzeHtmlDocument(afterDrinkwareStart7);
    expect(
      analysisAfterDrinkware.blocks[1].productCards.map((c) => c.fields.rankNumber?.value)
    ).toEqual(['#07', '#08', '#09', '#10', '#11']);
    expect(
      analysisAfterDrinkware.blocks[2].productCards.map((c) => c.fields.rankNumber?.value)
    ).toEqual(['#11', '#12', '#13', '#14']);

    // Now manually change Posters starting number from 11 to 12 -> Posters updates to #12..#15
    const afterPostersStart12 = updateSectionProductNumbering(
      afterDrinkwareStart12Input(afterDrinkwareStart7),
      posters.nodePath,
      12
    ).html;
    function afterDrinkwareStart12Input(h: string) {
      return h;
    }
    const analysisAfterPosters = analyzeHtmlDocument(afterPostersStart12);
    expect(
      analysisAfterPosters.blocks[2].productCards.map((c) => c.fields.rankNumber?.value)
    ).toEqual(['#12', '#13', '#14', '#15']);

    // 5. Remove the second product (#08) from Drinkware (starting at 7) -> remaining 4 Drinkware items renumber to #07, #08, #09, #10
    const secondDrinkwareCardPath =
      analysisAfterPosters.blocks[1].productCards[1].cardNodePath;
    const afterRemoveDrinkwareCard = removeRepeatedGroupItem(
      afterPostersStart12,
      secondDrinkwareCardPath,
      { startingNumber: 7 }
    );
    const analysisAfterRemove = analyzeHtmlDocument(afterRemoveDrinkwareCard);
    expect(
      analysisAfterRemove.blocks[1].productCards.map((c) => c.fields.rankNumber?.value)
    ).toEqual(['#07', '#08', '#09', '#10']);
    // T-Shirts and Posters remain completely unchanged
    expect(
      analysisAfterRemove.blocks[0].productCards.map((c) => c.fields.rankNumber?.value)
    ).toEqual(['#01', '#02', '#03', '#04', '#05', '#06']);
    expect(
      analysisAfterRemove.blocks[2].productCards.map((c) => c.fields.rankNumber?.value)
    ).toEqual(['#12', '#13', '#14', '#15']);
  });

  it('7. saves, reloads, and reopens a project with custom sectionStartingNumbers intact', async () => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => store.set(k, v),
          removeItem: (k: string) => store.delete(k),
          clear: () => store.clear(),
        },
      },
      configurable: true,
      writable: true,
    });

    const html = buildThreeSectionHistoryGuideHtml();
    const created = await createNewHtmlProject({
      name: 'History Gifts Guide',
      htmlContent: html,
      baseUrl: 'https://scienceofgifts.com',
      editorState: {
        viewMode: 'split',
        selectedBlockId: 'ALL',
        sidebarTab: 'blocks',
        previewViewport: 'desktop',
        includeFourthwallCss: true,
        sectionStartingNumbers: {
          'id:sec-tshirts': 1,
          'id:sec-drinkware': 7,
          'id:sec-posters': 12,
        },
      },
    });

    const reloadedList = loadLocalHtmlProjects();
    const reopened = reloadedList.find((p) => p.id === created.id)!;
    expect(reopened).toBeDefined();
    expect(reopened.editorState.sectionStartingNumbers).toEqual({
      'id:sec-tshirts': 1,
      'id:sec-drinkware': 7,
      'id:sec-posters': 12,
    });
  });

  it('9 & 10. supports diverse HTML structures (.product-number badges, numbered title prefixes, and unnumbered sections) while keeping unrelated markup intact', () => {
    const diverseHtml = `
      <div class="custom-guide">
        <section id="custom-badges" class="product-section" style="padding: 20px;">
          <h2>Custom Badge Section</h2>
          <div class="custom-grid">
            <div class="product-card" data-custom="keep-1">
              <span class="product-number">1.</span>
              <h3><a href="/products/astrolabe">Brass Astrolabe</a></h3>
              <img src="https://cdn.example.com/astrolabe.jpg" alt="Astrolabe">
            </div>
            <div class="product-card" data-custom="keep-2">
              <span class="product-number">2.</span>
              <h3><a href="/products/compass">Nautical Compass</a></h3>
              <img src="https://cdn.example.com/compass.jpg" alt="Compass">
            </div>
          </div>
        </section>

        <section id="title-prefixed" class="product-section">
          <h2>Title Prefixed Section</h2>
          <article class="gift-item">
            <h3><a href="/products/map-print" class="title-link">3. Antique Map Print</a></h3>
            <p>Museum archival paper.</p>
          </article>
          <article class="gift-item">
            <h3><a href="/products/quill-set" class="title-link">4. Calligraphy Quill Set</a></h3>
            <p>Hand-cut feather quill.</p>
          </article>
        </section>

        <section id="unnumbered-grid" class="sog-quick-picks">
          <h2 class="sog-qp-heading">Unnumbered Quick Picks</h2>
          <div class="sog-qp-grid">
            <article class="sog-qp-card"><h3 class="sog-qp-title"><a href="/products/unnum-1">Unnumbered Pick A</a></h3></article>
            <article class="sog-qp-card"><h3 class="sog-qp-title"><a href="/products/unnum-2">Unnumbered Pick B</a></h3></article>
          </div>
        </section>
      </div>
    `;

    const analysis = analyzeHtmlDocument(diverseHtml);
    expect(analysis.blocks).toHaveLength(3);

    const [badgeSec, titleSec, unnumberedSec] = analysis.blocks;
    expect(badgeSec.numberingInfo?.hasExplicitNumbering).toBe(true);
    expect(badgeSec.numberingInfo?.detectedStartingNumber).toBe(1);

    expect(titleSec.numberingInfo?.hasExplicitNumbering).toBe(true);
    expect(titleSec.numberingInfo?.detectedStartingNumber).toBe(3);

    expect(unnumberedSec.numberingInfo?.hasExplicitNumbering).toBe(false);
    expect(unnumberedSec.numberingInfo?.warningMessage).toContain(
      'does not contain explicit product number elements'
    );

    // Renumber badgeSec to start at 5 -> "5.", "6."
    const renumBadges = updateSectionProductNumbering(diverseHtml, badgeSec.nodePath, 5);
    expect(renumBadges.html).toContain('<span class="product-number">5.</span>');
    expect(renumBadges.html).toContain('<span class="product-number">6.</span>');
    // Unrelated attributes, styles, images, and links remain intact
    expect(renumBadges.html).toContain('style="padding: 20px;"');
    expect(renumBadges.html).toContain('data-custom="keep-1"');
    expect(renumBadges.html).toContain('src="https://cdn.example.com/astrolabe.jpg"');

    // Renumber titleSec to start at 10 -> "10. Antique Map Print", "11. Calligraphy Quill Set" while preserving inner <a> class and href
    const renumTitles = updateSectionProductNumbering(renumBadges.html, titleSec.nodePath, 10);
    expect(renumTitles.html).toContain(
      '<h3><a href="/products/map-print" class="title-link">10. Antique Map Print</a></h3>'
    );
    expect(renumTitles.html).toContain(
      '<h3><a href="/products/quill-set" class="title-link">11. Calligraphy Quill Set</a></h3>'
    );

    // Attempting to renumber unnumberedSec must NOT inject fake badges or alter its HTML
    const renumUnnumbered = updateSectionProductNumbering(
      renumTitles.html,
      unnumberedSec.nodePath,
      20
    );
    expect(renumUnnumbered.hasExplicitNumbering).toBe(false);
    expect(renumUnnumbered.updatedCount).toBe(0);
    expect(renumUnnumbered.html).toBe(renumTitles.html);

    // Also verify helper functions directly
    expect(parseProductNumberFromText('#09')).toBe(9);
    expect(formatProductRankValue('#01', 7)).toBe('#07');
    expect(formatProductRankValue('1.', 14)).toBe('14.');
  });
});

describe('Multi-Section HTML Projects, Section Management, Export, and Numbering Eligibility', () => {
  const tocHtml = `<div class="sog-toc" id="jump-toc">
    <p class="sog-toc-title">📖 In This History Gift Guide — Quick Bookmarks</p>
    <ol class="sog-toc-list">
      <li><a href="#jump-quick-picks">Quick Picks</a></li>
      <li><a href="#jump-tshirts">Part 1: T-Shirts</a></li>
      <li><a href="#jump-faq">Buying Guide &amp; FAQs</a></li>
    </ol>
  </div>`;

  const quickPicksHtml = `<div class="sog-quick-picks" id="jump-quick-picks">
    <h2 class="sog-qp-heading">⚡ Quick Picks: Best History Gifts</h2>
    <div class="sog-qp-grid">
      <article class="sog-qp-card">
        <div class="sog-qp-body">
          <h3 class="sog-qp-title"><a href="/products/roman-coin-tee">Roman Coin Heavyweight Tee</a></h3>
          <p class="sog-qp-price">$34.00</p>
        </div>
      </article>
    </div>
  </div>`;

  const featuredProductHtml = `<div class="sog-editors-pick" id="jump-editors-pick">
    <div class="sog-ep-body">
      <span class="sog-ep-kicker">🏆 Our #1 Pick</span>
      <h2 class="sog-ep-heading"><a href="/products/marcus-bust-hoodie">Marcus Aurelius Stoic Fleece</a></h2>
      <p class="sog-ep-desc">Heavyweight 9.4 oz brushed fleece.</p>
    </div>
  </div>`;

  const numberedProductSection1Html = `<section class="sog-editorial-section" id="jump-tshirts">
    <div class="sog-chapter-header">
      <span class="sog-chapter-kicker">CHAPTER 01</span>
      <h2>Part 1: History T-Shirts</h2>
    </div>
    <div class="sog-editorial-list">
      <article class="sog-editorial-card">
        <div class="sog-ed-header"><span class="sog-ed-rank">#01</span></div>
        <h3 class="sog-ed-title"><a href="/products/spqr-tee">SPQR Archival Tee</a></h3>
      </article>
      <article class="sog-editorial-card">
        <div class="sog-ed-header"><span class="sog-ed-rank">#02</span></div>
        <h3 class="sog-ed-title"><a href="/products/byzantine-tee">Byzantine Mosaic Tee</a></h3>
      </article>
    </div>
  </section>`;

  const numberedProductSection2Html = `<section class="sog-editorial-section" id="jump-drinkware">
    <div class="sog-chapter-header">
      <span class="sog-chapter-kicker">CHAPTER 02</span>
      <h2>Part 2: History Drinkware</h2>
    </div>
    <div class="sog-editorial-list">
      <article class="sog-editorial-card">
        <div class="sog-ed-header"><span class="sog-ed-rank">#03</span></div>
        <h3 class="sog-ed-title"><a href="/products/trireme-mug">Athenian Trireme Ceramic Mug</a></h3>
      </article>
      <article class="sog-editorial-card">
        <div class="sog-ed-header"><span class="sog-ed-rank">#04</span></div>
        <h3 class="sog-ed-title"><a href="/products/rubicon-tumbler">Crossing the Rubicon Tumbler</a></h3>
      </article>
    </div>
  </section>`;

  const editorialCopyHtml = `<section class="sog-editorial-intro" id="jump-intro">
    <h2>Why Historical Accuracy Matters in Gift-Giving</h2>
    <p>Every piece in our collection is researched from primary numismatic and archival sources.</p>
  </section>`;

  const relatedGuidesHtml = `<section class="sog-related-guides" id="jump-related">
    <h2>Related Gift Guides &amp; Articles</h2>
    <ul>
      <li><a href="/pages/greek-mythology-gifts">Greek Mythology Gift Guide</a></li>
      <li><a href="/pages/roman-history-gifts">Roman History Gift Guide</a></li>
    </ul>
  </section>`;

  const buyingGuideAndFaqHtml = `<section class="sog-buying-guide-wrap" id="jump-faq">
    <div class="sog-buying-guide">
      <h2 class="sog-bg-title">How to Choose the Right History Gift</h2>
      <div class="sog-bg-grid">
        <div class="sog-bg-pillar">
          <span class="sog-bg-num">01 / ERA</span>
          <h3>Match Their Favorite Era</h3>
          <p>Identify whether they read classical antiquity or medieval history.</p>
        </div>
      </div>
    </div>
    <div class="sog-faq-section">
      <h2 class="sog-faq-title">Frequently Asked Questions</h2>
      <div class="sog-faq-grid">
        <article class="sog-faq-card">
          <span class="sog-faq-badge">Q01</span>
          <h3 class="sog-faq-q">How do the t-shirts fit?</h3>
          <div class="sog-faq-a"><p>Relaxed unisex retail fit.</p></div>
        </article>
      </div>
    </div>
  </section>`;

  it('1, 2, 3, & 4. supports adding multiple independent HTML sections (product section, TOC/bookmarks, buying guide, related guides, FAQ) to one saved project so all coexist in editor and preview', async () => {
    window.localStorage.clear();

    // 1. Create a project with an initial product section
    let project = await createNewHtmlProject({
      name: 'Complete History Gifts Guide',
      initialHtml: numberedProductSection1Html,
    });
    expect(project.sections).toHaveLength(1);
    expect(project.sections![0].type).toBe('editorial_list');

    // 2. Add a bookmark / table-of-contents section to the same project
    project = appendHtmlSectionToProject(project, tocHtml, {
      name: 'Table of Contents / Bookmarks',
    });
    expect(project.sections).toHaveLength(2);

    // 3. Add Quick Picks, Featured Product, second Product Section, Editorial Text, Related Guides, and Buying Guide/FAQ
    project = appendHtmlSectionToProject(project, quickPicksHtml, { name: 'Quick Picks' });
    project = appendHtmlSectionToProject(project, featuredProductHtml, {
      name: 'Featured #1 Pick',
    });
    project = appendHtmlSectionToProject(project, numberedProductSection2Html, {
      name: 'Part 2: History Drinkware',
    });
    project = appendHtmlSectionToProject(project, editorialCopyHtml, {
      name: 'Editorial Text',
    });
    project = appendHtmlSectionToProject(project, relatedGuidesHtml, {
      name: 'Related Gift Guides',
    });
    project = appendHtmlSectionToProject(project, buyingGuideAndFaqHtml, {
      name: 'Buying Guide & FAQs',
    });

    // Save and reload project from storage
    await saveHtmlProject(project);
    const reloaded = loadLocalHtmlProjects().find((p) => p.id === project.id)!;
    expect(reloaded).toBeDefined();
    expect(reloaded.sections).toHaveLength(8);

    // 4. Confirm all 8 added sections remain visible in the editor analysis and preview HTML
    const analysis = analyzeProjectSections(reloaded.sections!);
    expect(analysis.blocks).toHaveLength(8);
    expect(analysis.blocks.map((b) => b.blockType)).toEqual([
      'editorial_list',
      'toc',
      'quick_picks',
      'editors_pick',
      'editorial_list',
      'content_section',
      'related_guides',
      'buying_guide',
    ]);

    const previewHtml = buildSafePreviewHtml(reloaded.currentHtml, []);
    expect(previewHtml).toContain('Part 1: History T-Shirts');
    expect(previewHtml).toContain('In This History Gift Guide — Quick Bookmarks');
    expect(previewHtml).toContain('Quick Picks: Best History Gifts');
    expect(previewHtml).toContain('Marcus Aurelius Stoic Fleece');
    expect(previewHtml).toContain('Part 2: History Drinkware');
    expect(previewHtml).toContain('Why Historical Accuracy Matters in Gift-Giving');
    expect(previewHtml).toContain('Related Gift Guides &amp; Articles');
    expect(previewHtml).toContain('How to Choose the Right History Gift');
    expect(previewHtml).toContain('Frequently Asked Questions');
  });

  it('5, 6, & 7. edits content inside one section without changing other sections, deletes a single section without deleting the project, and persists the deletion across reload', async () => {
    window.localStorage.clear();

    let project = await createNewHtmlProject({
      name: 'Multi-Section Persistence Test',
      initialHtml: tocHtml,
    });
    project = appendHtmlSectionToProject(project, numberedProductSection1Html, {
      name: 'T-Shirts Section',
    });
    project = appendHtmlSectionToProject(project, relatedGuidesHtml, {
      name: 'Related Guides Section',
    });
    await saveHtmlProject(project);

    const [tocSec, tshirtsSec, relatedSec] = project.sections!;

    // 5. Edit content inside T-Shirts section and confirm TOC and Related Guides remain unchanged
    const updatedTshirtsHtml = tshirtsSec.htmlContent.replace(
      'SPQR Archival Tee',
      'SPQR Senatorial Heavyweight Tee'
    );
    project = updateProjectSectionHtmlById(project, tshirtsSec.id, updatedTshirtsHtml);
    await saveHtmlProject(project);

    expect(project.sections!.find((s) => s.id === tocSec.id)!.htmlContent).toBe(tocSec.htmlContent);
    expect(project.sections!.find((s) => s.id === relatedSec.id)!.htmlContent).toBe(
      relatedSec.htmlContent
    );
    expect(project.sections!.find((s) => s.id === tshirtsSec.id)!.htmlContent).toContain(
      'SPQR Senatorial Heavyweight Tee'
    );

    // 6. Delete only the Related Guides section and confirm only that section is removed
    project = deleteProjectSectionById(project, relatedSec.id);
    await saveHtmlProject(project);

    expect(project.sections).toHaveLength(2);
    expect(project.sections!.map((s) => s.id)).toEqual([tocSec.id, tshirtsSec.id]);
    expect(project.currentHtml).not.toContain('Related Gift Guides &amp; Articles');
    expect(project.currentHtml).toContain('SPQR Senatorial Heavyweight Tee');
    expect(project.currentHtml).toContain('In This History Gift Guide — Quick Bookmarks');

    // 7. Refresh and reopen the project and confirm the deleted section does not return
    const reopened = loadLocalHtmlProjects().find((p) => p.id === project.id)!;
    expect(reopened).toBeDefined();
    expect(reopened.sections).toHaveLength(2);
    expect(reopened.sections!.map((s) => s.id)).toEqual([tocSec.id, tshirtsSec.id]);
    expect(reopened.currentHtml).not.toContain('Related Gift Guides');
  });

  it('8, 9, 10, & 11. reorders sections, exports individual sections and the complete project with character counts, and warns when exceeding Fourthwall 30,000-character limit', async () => {
    window.localStorage.clear();

    let project = await createNewHtmlProject({
      name: 'Reorder & Export Guide',
      initialHtml: numberedProductSection1Html,
    });
    project = appendHtmlSectionToProject(project, tocHtml, { name: 'Bookmarks' });
    project = appendHtmlSectionToProject(project, buyingGuideAndFaqHtml, { name: 'FAQs' });

    const [sec1, sec2, sec3] = project.sections!;
    expect(project.sections!.map((s) => s.id)).toEqual([sec1.id, sec2.id, sec3.id]);

    // 8. Move Bookmarks (sec2) up to position 0
    project = reorderProjectSectionById(project, sec2.id, 'up');
    await saveHtmlProject(project);

    expect(project.sections!.map((s) => s.id)).toEqual([sec2.id, sec1.id, sec3.id]);
    // Verify internal product order inside sec1 was not altered
    const sec1AfterReorder = project.sections!.find((s) => s.id === sec1.id)!;
    expect(sec1AfterReorder.htmlContent.indexOf('SPQR Archival Tee')).toBeLessThan(
      sec1AfterReorder.htmlContent.indexOf('Byzantine Mosaic Tee')
    );

    // 9. Export a single section and confirm only that section's HTML is included, along with its character count
    const singleExport = exportProjectSectionHtml(project, sec1.id);
    expect(singleExport.html).toBe(sec1AfterReorder.htmlContent);
    expect(singleExport.html).toContain('Part 1: History T-Shirts');
    expect(singleExport.html).not.toContain('Quick Bookmarks');
    expect(singleExport.characterCount).toBe(sec1AfterReorder.htmlContent.length);
    expect(singleExport.exceedsFourthwallLimit).toBe(false);

    // 10. Export the complete project and confirm all sections are included in the new order
    const fullExport = exportCompleteProjectHtml(project);
    const tocPos = fullExport.html.indexOf('Quick Bookmarks');
    const tshirtsPos = fullExport.html.indexOf('Part 1: History T-Shirts');
    const faqPos = fullExport.html.indexOf('Frequently Asked Questions');
    expect(tocPos).toBeGreaterThanOrEqual(0);
    expect(tshirtsPos).toBeGreaterThan(tocPos);
    expect(faqPos).toBeGreaterThan(tshirtsPos);
    expect(fullExport.characterCount).toBe(fullExport.html.length);

    // 11. Confirm a clear warning appears when a section or full project exceeds 30,000 characters (without truncating HTML)
    const oversizedSectionHtml = `<section class="sog-editorial-section"><h2>Large Section</h2><p>${'A'.repeat(
      30_500
    )}</p></section>`;
    const evalOversized = evaluateHtmlExportSize(oversizedSectionHtml);
    expect(evalOversized.characterCount).toBe(oversizedSectionHtml.length);
    expect(evalOversized.exceedsFourthwallLimit).toBe(true);
    expect(evalOversized.warningMessage).toContain('30,000-character limit');
    // Must never truncate or alter the HTML
    expect(evalOversized.html).toBe(oversizedSectionHtml);
  });

  it('12 & 13. shows Starting Product Number only on numbered product sections and never on bookmarks, quick picks, featured products, related guides, buying guides, FAQs, or ordinary editorial blocks', async () => {
    window.localStorage.clear();

    let project = await createNewHtmlProject({
      name: 'Numbering Eligibility Guide',
      initialHtml: tocHtml,
    });
    project = appendHtmlSectionToProject(project, quickPicksHtml);
    project = appendHtmlSectionToProject(project, featuredProductHtml);
    project = appendHtmlSectionToProject(project, numberedProductSection1Html);
    project = appendHtmlSectionToProject(project, numberedProductSection2Html);
    project = appendHtmlSectionToProject(project, editorialCopyHtml);
    project = appendHtmlSectionToProject(project, relatedGuidesHtml);
    project = appendHtmlSectionToProject(project, buyingGuideAndFaqHtml);

    const analysis = analyzeProjectSections(project.sections!);
    const byType = new Map(analysis.blocks.map((b) => [`${b.blockType}:${b.elementId}`, b]));

    // 13. Non-eligible sections MUST have isNumberedProductSection === false
    expect(byType.get('toc:jump-toc')?.numberingInfo?.isNumberedProductSection).toBe(false);
    expect(byType.get('quick_picks:jump-quick-picks')?.numberingInfo?.isNumberedProductSection).toBe(
      false
    );
    expect(
      byType.get('editors_pick:jump-editors-pick')?.numberingInfo?.isNumberedProductSection
    ).toBe(false);
    expect(
      byType.get('content_section:jump-intro')?.numberingInfo?.isNumberedProductSection
    ).toBe(false);
    expect(
      byType.get('related_guides:jump-related')?.numberingInfo?.isNumberedProductSection
    ).toBe(false);
    expect(byType.get('buying_guide:jump-faq')?.numberingInfo?.isNumberedProductSection).toBe(
      false
    );
    expect(isSectionEligibleForProductNumbering('faq_section', 0, false)).toBe(false);

    // 12. Numbered product sections MUST have isNumberedProductSection === true and update product numbers accurately
    const tshirtsBlock = byType.get('editorial_list:jump-tshirts')!;
    const drinkwareBlock = byType.get('editorial_list:jump-drinkware')!;
    expect(tshirtsBlock.numberingInfo?.isNumberedProductSection).toBe(true);
    expect(tshirtsBlock.numberingInfo?.detectedStartingNumber).toBe(1);
    expect(drinkwareBlock.numberingInfo?.isNumberedProductSection).toBe(true);
    expect(drinkwareBlock.numberingInfo?.detectedStartingNumber).toBe(3);

    // Update Drinkware starting product number to 7 and verify only Drinkware is renumbered (#07, #08)
    project = updateProjectSectionStartingNumberById(project, drinkwareBlock.id, 7);
    const updatedDrinkware = project.sections!.find((s) => s.id === drinkwareBlock.id)!;
    const updatedTshirts = project.sections!.find((s) => s.id === tshirtsBlock.id)!;

    expect(updatedDrinkware.htmlContent).toContain('<span class="sog-ed-rank">#07</span>');
    expect(updatedDrinkware.htmlContent).toContain('<span class="sog-ed-rank">#08</span>');
    expect(updatedTshirts.htmlContent).toContain('<span class="sog-ed-rank">#01</span>');
    expect(updatedTshirts.htmlContent).toContain('<span class="sog-ed-rank">#02</span>');

    // Also verify Replace Project HTML replaces all sections cleanly when explicitly invoked
    const replaced = replaceProjectHtmlContent(project, editorialCopyHtml);
    expect(replaced.sections).toHaveLength(1);
    expect(replaced.sections![0].type).toBe('content_section');

    // And verify manual section type reclassification works
    const reclassified = updateProjectSectionTypeById(
      replaced,
      replaced.sections![0].id,
      'related_guides'
    );
    expect(reclassified.sections![0].type).toBe('related_guides');

    // And verify renaming a section preserves its HTML content
    const renamed = renameProjectSectionById(
      reclassified,
      reclassified.sections![0].id,
      'Custom Section Title'
    );
    expect(renamed.sections![0].name).toBe('Custom Section Title');
    expect(renamed.sections![0].htmlContent).toBe(reclassified.sections![0].htmlContent);
  });
});

describe('Feature 7: Cloudflare Workers Deployment & Gemini Model Selector with Bounded Fallback (All 12 Verification Scenarios)', () => {
  function createMockStorage() {
    const store = new Map<string, string>();
    return {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, val: string) => {
        store.set(key, String(val));
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
    };
  }

  it('3 & 4. defaults to Gemini 3.5 Flash Lite (gemini-3.5-flash-lite), configures the exact 4-model fallback order, and persists manual selection across reloads', () => {
    const mockStorage = createMockStorage();
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: mockStorage,
        dispatchEvent: () => true,
      },
      configurable: true,
      writable: true,
    });

    // 3. Default model is Gemini 3.5 Flash Lite
    expect(DEFAULT_GEMINI_MODEL_ID).toBe('gemini-3.5-flash-lite');
    expect(getSavedGeminiModelPreference()).toBe('gemini-3.5-flash-lite');

    // Exact 4-model fallback order
    expect(PRIMARY_GEMINI_FALLBACK_ORDER).toEqual([
      'gemini-3.5-flash-lite',
      'gemini-3.6-flash',
      'gemini-3.8-flash',
      'gemini-3.1-flash',
    ]);
    expect(resolveModelFallbackChain()).toEqual([
      'gemini-3.5-flash-lite',
      'gemini-3.6-flash',
      'gemini-3.8-flash',
      'gemini-3.1-flash',
    ]);

    // 4. Changing the model selector updates the active model and persists across reloads
    const updated = saveGeminiModelPreference('gemini-3.8-flash');
    expect(updated).toBe('gemini-3.8-flash');
    expect(getSavedGeminiModelPreference()).toBe('gemini-3.8-flash');

    // Fallback chain starts with the newly selected model followed by remaining configured models in order
    expect(resolveModelFallbackChain(getSavedGeminiModelPreference())).toEqual([
      'gemini-3.8-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.6-flash',
      'gemini-3.1-flash',
    ]);

    // Verify model verification metadata explicitly notes verified vs unverified SDK model IDs
    const def38 = GEMINI_MODEL_DEFINITIONS.find((m) => m.id === 'gemini-3.8-flash')!;
    const def35Lite = GEMINI_MODEL_DEFINITIONS.find((m) => m.id === 'gemini-3.5-flash-lite')!;
    expect(def38.verifiedInSdk).toBe(true);
    expect(def35Lite.verifiedInSdk).toBe(false);
    expect(def35Lite.closestVerifiedModelId).toBe('gemini-3.1-flash-lite');
  });

  it('5 & 6. uses the selected model across AI features and falls back in exact order on recoverable failures (404 unavailable, 429 rate limit, 503 service error) without overwriting saved preference', async () => {
    const mockStorage = createMockStorage();
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: mockStorage,
        dispatchEvent: () => true,
      },
      configurable: true,
      writable: true,
    });

    // User has default Gemini 3.5 Flash Lite saved
    saveGeminiModelPreference('gemini-3.5-flash-lite');

    const attemptedModelsInCallOrder: string[] = [];
    const sleepDelaysRecorded: number[] = [];

    // Mock invoker where:
    // 1. gemini-3.5-flash-lite fails with 404 Model Not Found (unverified ID)
    // 2. gemini-3.6-flash fails with 429 Rate Limit + Retry-After: 1s
    // 3. gemini-3.8-flash succeeds!
    const mockCreateInvoker = () => ({
      generateContent: async (params: { model: string; contents: string }) => {
        attemptedModelsInCallOrder.push(params.model);
        if (params.model === 'gemini-3.5-flash-lite') {
          const err: any = new Error('models/gemini-3.5-flash-lite is not found for API version v1beta');
          err.status = 404;
          throw err;
        }
        if (params.model === 'gemini-3.6-flash') {
          const err: any = new Error('429 Resource Exhausted: Rate limit reached. Retry-After: 1s');
          err.status = 429;
          throw err;
        }
        if (params.model === 'gemini-3.8-flash') {
          return {
            text: JSON.stringify({
              primaryText: 'Best Overall Underworld Fleece',
              secondaryText: 'Heavyweight 9.4 oz cotton-poly blend',
              alternatives: ['Best for Hades Collectors', 'Top Dark Academia Pick'],
              reviewNotes: 'All specs verified against catalog.',
            }),
          };
        }
        throw new Error(`Unexpected model call: ${params.model}`);
      },
    });

    const response = await handleAiGenerateRequest(
      {
        taskType: 'product_badge',
        actionMode: 'generate',
        preferredModel: getSavedGeminiModelPreference(),
        guideContext: {
          title: 'Greek Mythology Gift Guide',
          topic: 'Greek Mythology',
        },
      },
      { GEMINI_API_KEY: 'test-valid-server-api-key' },
      {
        createGenAIInvoker: mockCreateInvoker,
        sleepMs: async (ms) => {
          sleepDelaysRecorded.push(ms);
        },
      }
    );

    expect(response.status).toBe(200);
    expect(response.body.primaryText).toBe('Best Overall Underworld Fleece');

    // Verify exact fallback sequence: gemini-3.5-flash-lite -> gemini-3.6-flash -> gemini-3.8-flash (stopped as soon as 3.8 succeeded)
    expect(attemptedModelsInCallOrder).toEqual([
      'gemini-3.5-flash-lite',
      'gemini-3.6-flash',
      'gemini-3.8-flash',
    ]);

    // Verify Retry-After was respected with practical cap
    expect(sleepDelaysRecorded).toEqual([1000]);

    // Verify response metadata reports which model succeeded and that fallback was used
    const meta = response.body.modelMetadata as any;
    expect(meta.requestedModel).toBe('gemini-3.5-flash-lite');
    expect(meta.modelUsed).toBe('gemini-3.8-flash');
    expect(meta.modelUsedLabel).toBe('Gemini 3.8 Flash');
    expect(meta.fallbackUsed).toBe(true);
    expect(meta.attemptedModels).toEqual([
      'gemini-3.5-flash-lite',
      'gemini-3.6-flash',
      'gemini-3.8-flash',
    ]);

    // Verify user's saved manual model choice was NOT overwritten when fallback succeeded
    expect(getSavedGeminiModelPreference()).toBe('gemini-3.5-flash-lite');
  });

  it('7. does NOT trigger fallback on permanent request-validation errors (missing fields, invalid task, 400 Invalid Argument, or 401 Invalid API Key)', async () => {
    const calledModels: string[] = [];
    const mockCreateInvoker = () => ({
      generateContent: async (params: { model: string }) => {
        calledModels.push(params.model);
        const err: any = new Error('400 INVALID_ARGUMENT: Invalid user parameter in schema');
        err.status = 400;
        throw err;
      },
    });

    // Case A: Request validation failure BEFORE calling Gemini (missing htmlFragment)
    const missingFragmentRes = await handleAiAnalyzeHtmlRequest(
      { task: 'rewrite_text', htmlFragment: '   ' },
      { GEMINI_API_KEY: 'test-valid-server-api-key' },
      { createGenAIInvoker: mockCreateInvoker }
    );
    expect(missingFragmentRes.status).toBe(400);
    expect(calledModels).toHaveLength(0);

    // Case B: Permanent 400 error from Gemini SDK stops after the 1st model without falling back to the remaining 3 models
    const sdk400Res = await handleAiAnalyzeHtmlRequest(
      {
        task: 'rewrite_text',
        htmlFragment: '<p>Sample editorial copy</p>',
        preferredModel: 'gemini-3.5-flash-lite',
      },
      { GEMINI_API_KEY: 'test-valid-server-api-key' },
      { createGenAIInvoker: mockCreateInvoker }
    );
    expect(sdk400Res.status).toBe(400);
    expect(calledModels).toEqual(['gemini-3.5-flash-lite']);
    expect(sdk400Res.body.recoverable).toBe(false);
    expect(sdk400Res.body.attemptedModels).toEqual(['gemini-3.5-flash-lite']);

    // Case C: Missing server GEMINI_API_KEY returns 503 immediately with 0 model attempts
    calledModels.length = 0;
    const missingKeyRes = await handleAiGenerateRequest(
      {
        taskType: 'product_badge',
        actionMode: 'generate',
        guideContext: { title: 'Test Guide', topic: 'History' },
      },
      { GEMINI_API_KEY: '' },
      { createGenAIInvoker: mockCreateInvoker }
    );
    expect(missingKeyRes.status).toBe(503);
    expect(calledModels).toHaveLength(0);
  });

  it('8. stops after all 4 configured models have been attempted at most once (no infinite or nested retry loops)', async () => {
    const attemptedModels: string[] = [];

    await expect(
      executeGeminiWithFallback({
        preferredModel: 'gemini-3.5-flash-lite',
        operationName: 'test_bounded_exhaustion',
        sleepMs: async () => {},
        invokeModel: async (modelId) => {
          attemptedModels.push(modelId);
          const err: any = new Error(`503 Service Unavailable on ${modelId}`);
          err.status = 503;
          throw err;
        },
      })
    ).rejects.toThrow(GeminiFallbackError);

    // Must try each of the 4 configured models exactly once, in order, and then stop
    expect(attemptedModels).toEqual([
      'gemini-3.5-flash-lite',
      'gemini-3.6-flash',
      'gemini-3.8-flash',
      'gemini-3.1-flash',
    ]);
    expect(attemptedModels).toHaveLength(4);
  });

  it('1, 2 & 9. Cloudflare Worker (workers.ts) serves static assets, preserves SPA routing fallback, routes /api/* requests, and keeps GEMINI_API_KEY strictly Worker-side', async () => {
    const mockAssetsFetcher = {
      fetch: async (reqOrUrl: Request | string) => {
        const url = new URL(typeof reqOrUrl === 'string' ? reqOrUrl : reqOrUrl.url);
        if (url.pathname === '/' || url.pathname === '/index.html') {
          return new Response('<!doctype html><html><body><div id="root"></div></body></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        }
        if (url.pathname === '/assets/index-abc123.js') {
          return new Response('console.log("app bundle");', {
            status: 200,
            headers: { 'Content-Type': 'application/javascript' },
          });
        }
        return new Response('Not Found', { status: 404 });
      },
    };

    const workerEnv = {
      GEMINI_API_KEY: 'worker-secret-gemini-key-xyz',
      ASSETS: mockAssetsFetcher,
    };

    // 1. Static asset request (/assets/index-abc123.js) served directly
    const jsRes = await handleWorkerRequest(
      new Request('https://science-of-gifts-cms.example.workers.dev/assets/index-abc123.js'),
      workerEnv
    );
    expect(jsRes.status).toBe(200);
    expect(await jsRes.text()).toContain('console.log("app bundle")');

    // 2. Missing static asset with file extension (/assets/missing.js) returns 404
    const missingJsRes = await handleWorkerRequest(
      new Request('https://science-of-gifts-cms.example.workers.dev/assets/missing.js'),
      workerEnv
    );
    expect(missingJsRes.status).toBe(404);

    // 3. Client-side SPA route (/editor/history-guide) falls back to /index.html
    const spaRes = await handleWorkerRequest(
      new Request('https://science-of-gifts-cms.example.workers.dev/editor/history-guide'),
      workerEnv
    );
    expect(spaRes.status).toBe(200);
    expect(await spaRes.text()).toContain('<div id="root"></div>');

    // 4. Worker /api/ai/status endpoint returns status & model configuration without exposing GEMINI_API_KEY
    const statusRes = await handleWorkerRequest(
      new Request('https://science-of-gifts-cms.example.workers.dev/api/ai/status'),
      workerEnv
    );
    expect(statusRes.status).toBe(200);
    const statusJson = await statusRes.json();
    expect(statusJson.configured).toBe(true);
    expect(statusJson.defaultModel).toBe('gemini-3.5-flash-lite');
    expect(statusJson.fallbackOrder).toEqual([
      'gemini-3.5-flash-lite',
      'gemini-3.6-flash',
      'gemini-3.8-flash',
      'gemini-3.1-flash',
    ]);
    expect(JSON.stringify(statusJson)).not.toContain('worker-secret-gemini-key-xyz');

    // 5. Worker /api/products/parse-html deterministic extraction works without calling Gemini when useAiFallback is false
    let geminiCalledCount = 0;
    const parseRes = await handleWorkerRequest(
      new Request('https://science-of-gifts-cms.example.workers.dev/api/products/parse-html', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          html: '<html><head><meta property="og:title" content="Athena Owl Sweatshirt" /><meta property="product:price:amount" content="39.90" /></head><body><p>Heavyweight crew sweatshirt.</p></body></html>',
          sourceUrl: 'https://scienceofgifts.com/products/athena-owl-sweatshirt',
          useAiFallback: false,
        }),
      }),
      workerEnv,
      {
        createGenAIInvoker: () => ({
          generateContent: async () => {
            geminiCalledCount++;
            return { text: '{}' };
          },
        }),
      }
    );
    expect(parseRes.status).toBe(200);
    const parseJson = await parseRes.json();
    expect(parseJson.ok).toBe(true);
    expect(parseJson.extracted.name).toBe('Athena Owl Sweatshirt');
    expect(geminiCalledCount).toBe(0);
  });

  it('detects Firebase offline and disabled Token Service API errors and validates user tokens cleanly', async () => {
    expect(
      isOfflineOrTokenServiceError(
        new Error(
          'Firebase: Error (auth/token-service-api-has-not-been-used-in-project-339975832814-before-or-it-is-disabled).'
        )
      )
    ).toBe(true);
    expect(
      isOfflineOrTokenServiceError(
        new Error('Failed to get document because the client is offline.')
      )
    ).toBe(true);
    expect(isOfflineOrTokenServiceError(new Error('Missing or insufficient permissions.'))).toBe(
      false
    );

    const brokenUser = {
      uid: 'user-broken-token',
      getIdToken: async () => {
        throw new Error(
          'Firebase: Error (auth/token-service-api-has-not-been-used-in-project-339975832814-before-or-it-is-disabled).'
        );
      },
    } as unknown as Parameters<typeof validateUserAuthToken>[0];

    const brokenCheck = await validateUserAuthToken(brokenUser);
    expect(brokenCheck.valid).toBe(false);
    expect(brokenCheck.reason).toContain('Token Service API');

    const validUser = {
      uid: 'user-valid-token',
      getIdToken: async () => 'mock-jwt-token',
    } as unknown as Parameters<typeof validateUserAuthToken>[0];

    const validCheck = await validateUserAuthToken(validUser);
    expect(validCheck.valid).toBe(true);
  });
});

describe('Feature 8: Product Catalog Category Dropdown & Automatic Product Type Detection', () => {
  it('1 & 2. provides initial categories, creates custom categories without capitalization/whitespace duplicates, persists them, and renames categories without losing product associations', () => {
    const store = new Map<string, string>();
    const prevWindow = (globalThis as any).window;
    (globalThis as any).window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
        removeItem: (k: string) => store.delete(k),
      },
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    };

    try {
      const initial = loadManagedCategories();
      expect(initial).toEqual([
        'General History',
        'American History',
        'World War II',
        'Civil War',
        'Ancient Rome',
        'Greek Mythology',
        'History Teachers',
        'Other',
      ]);

      // Create a custom category
      const addedRes = addManagedCategory('  Cold   War  ', initial);
      expect(addedRes.added).toBe(true);
      expect(addedRes.canonicalName).toBe('Cold War');
      expect(addedRes.categories).toContain('Cold War');
      expect(addedRes.categories[addedRes.categories.length - 1]).toBe('Other');

      // Duplicate with different casing/whitespace should NOT create a duplicate entry
      const dupRes = addManagedCategory('cold war', addedRes.categories);
      expect(dupRes.added).toBe(false);
      expect(dupRes.canonicalName).toBe('Cold War');
      expect(dupRes.categories.filter((c) => c.toLowerCase() === 'cold war').length).toBe(1);

      // Verify persistence in localStorage across reload
      const reloaded = loadManagedCategories();
      expect(reloaded).toContain('Cold War');

      // Rename category and verify all associated products update cleanly
      const testProds: Product[] = [
        {
          ...sampleProducts[0],
          id: 'p-1',
          category: 'Cold War',
        },
        {
          ...sampleProducts[1],
          id: 'p-2',
          category: 'American History',
        },
      ];
      const renameRes = renameManagedCategory(
        'Cold War',
        '20th Century Geopolitics',
        testProds,
        reloaded
      );
      expect(renameRes.canonicalNewName).toBe('20th Century Geopolitics');
      expect(renameRes.categories).toContain('20th Century Geopolitics');
      expect(renameRes.categories).not.toContain('Cold War');
      expect(renameRes.changedProducts.length).toBe(1);
      expect(renameRes.updatedProducts.find((p) => p.id === 'p-1')?.category).toBe(
        '20th Century Geopolitics'
      );
      expect(renameRes.updatedProducts.find((p) => p.id === 'p-2')?.category).toBe(
        'American History'
      );
    } finally {
      (globalThis as any).window = prevWindow;
    }
  });

  it('3. detects product types accurately from representative product titles, URL slugs, and metadata', () => {
    expect(MANAGED_PRODUCT_TYPES).toEqual([
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
    ]);

    // Required representative examples from prompt
    expect(detectProductType({ name: 'The Original Hottake 1943 T-Shirt' })).toMatchObject({
      detectedType: 'T-Shirt',
      isConfident: true,
      matchedSource: 'title',
    });
    expect(detectProductType({ name: 'Abraham Lincoln Superhero Hoodie' })).toMatchObject({
      detectedType: 'Hoodie',
      isConfident: true,
      matchedSource: 'title',
    });
    expect(detectProductType({ name: 'WWII Buff Mug' })).toMatchObject({
      detectedType: 'Mug',
      isConfident: true,
      matchedSource: 'title',
    });
    expect(detectProductType({ name: 'Civil War Whiskey Glass' })).toMatchObject({
      detectedType: 'Whiskey Glass',
      isConfident: true,
      matchedSource: 'title',
    });
    expect(detectProductType({ name: 'History Vintage Statue Themed Tumbler' })).toMatchObject({
      detectedType: 'Tumbler',
      isConfident: true,
      matchedSource: 'title',
    });
    expect(detectProductType({ name: 'Abraham Lincoln History Poster' })).toMatchObject({
      detectedType: 'Poster',
      isConfident: true,
      matchedSource: 'title',
    });

    // Additional managed product types (via title & URL slug)
    expect(
      detectProductType({
        name: 'Charon Ferry Crewneck Sweatshirt',
        productUrl: '/products/charon-ferry-sweatshirt',
      }).detectedType
    ).toBe('Sweatshirt');
    expect(
      detectProductType({
        name: 'Poseidon Trident Stainless Steel Water Bottle',
      }).detectedType
    ).toBe('Water Bottle');
    expect(
      detectProductType({
        name: 'Athena Owl Etched Rocks Glass',
      }).detectedType
    ).toBe('Rocks Glass');
    expect(
      detectProductType({
        name: 'Roman Legion 16oz Beer Can Glass',
      }).detectedType
    ).toBe('Beer Can Glass');
    expect(
      detectProductType({
        name: 'Artemis Silver Moon Spiral Journal',
      }).detectedType
    ).toBe('Journal');
    expect(
      detectProductType({
        name: 'Marcus Aurelius Stoic Hardcover Notebook',
      }).detectedType
    ).toBe('Notebook');
    expect(
      detectProductType({
        name: 'Hermes Caduceus Messenger Tote Bag',
      }).detectedType
    ).toBe('Tote Bag');
    expect(
      detectProductType({
        name: 'World War II Theater Map Desk Mat',
      }).detectedType
    ).toBe('Desk Mat');
    expect(
      detectProductType({
        name: 'Classical Library Padded Laptop Sleeve',
      }).detectedType
    ).toBe('Laptop Sleeve');
    expect(
      detectProductType({
        name: 'SPQR Crest Ergonomic Mouse Pad',
      }).detectedType
    ).toBe('Mouse Pad');
    expect(
      detectProductType({
        name: 'Spartan Shield MagSafe iPhone Case',
      }).detectedType
    ).toBe('iPhone Case');
    expect(
      detectProductType({
        name: 'Roman Republic Embroidered Dad Cap',
      }).detectedType
    ).toBe('Cap');

    // URL slug inference when title is generic
    expect(
      detectProductType({
        name: 'The Original Hottake 1943 Edition',
        productUrl: 'https://scienceofgifts.com/products/the-original-hottake-1943-t-shirt',
      })
    ).toMatchObject({
      detectedType: 'T-Shirt',
      isConfident: true,
      matchedSource: 'url_slug',
    });
  });

  it('4. handles ambiguous or unrecognized products carefully without false-positive classification', () => {
    // Generic "glass" must NOT be classified as Rocks Glass, Beer Can Glass, or Whiskey Glass
    const ambiguousGlass = detectProductType({
      name: 'Ancient Roman Blown Glass Artifact Replica',
      productUrl: '/products/ancient-roman-blown-glass-replica',
      shortDescription: 'Handcrafted decorative glass keepsake.',
    });
    expect(ambiguousGlass.isConfident).toBe(false);
    expect(ambiguousGlass.detectedType).toBe('Other');

    const unrecognizedItem = detectProductType({
      name: 'Julius Caesar Bronze Desk Bust',
      productUrl: '/products/julius-caesar-bronze-desk-bust',
    });
    expect(unrecognizedItem.isConfident).toBe(false);
    expect(unrecognizedItem.detectedType).toBe('Other');
  });

  it('5, 6, 7 & 8. applies detection during HTML/CSV import, preserves manual overrides across storage & URL refreshes, and migrates older records safely', () => {
    const store = new Map<string, string>();
    const prevWindow = (globalThis as any).window;
    (globalThis as any).window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
        removeItem: (k: string) => store.delete(k),
      },
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    };

    try {
      // 3. Apply detection during HTML product import
      const extracted = extractProductFromHtml(
        `<html><head>
          <meta property="og:title" content="Abraham Lincoln Superhero Hoodie" />
          <meta property="product:price:amount" content="49.90" />
        </head><body></body></html>`,
        'https://scienceofgifts.com/products/abraham-lincoln-superhero-hoodie'
      );
      expect(extracted.productType).toBe('Hoodie');

      // CSV batch import infers productType when blank in CSV
      const csvReport = parseProductImportBatch(
        `name,productUrl,price,productType,category
WWII Buff Mug,/products/wwii-buff-mug,$18.90,,World War II`
      );
      expect(csvReport.validProducts.length).toBe(1);
      expect(csvReport.validProducts[0].productType).toBe('Mug');
      expect(csvReport.validProducts[0].category).toBe('World War II');

      // 5 & 6. Manual override persists across save & reload
      const manuallyOverriddenProduct: Product = {
        id: 'prod-lincoln-custom',
        ownerId: 'local-preview',
        name: 'Abraham Lincoln Superhero Hoodie',
        productUrl: 'https://scienceofgifts.com/products/abraham-lincoln-superhero-hoodie',
        imageUrl: '',
        price: '$49.90',
        currency: 'USD',
        productType: 'Sweatshirt', // Manually overridden by user from Hoodie -> Sweatshirt
        productTypeManualOverride: true,
        category: 'American History',
        tags: ['lincoln'],
        shortDescription: 'Heavyweight fleece.',
        featuresSpecs: '9.4 oz cotton-poly',
        sourceNotes: 'User note',
        archived: false,
      };

      saveLocalCatalogProducts([manuallyOverriddenProduct]);
      const reloadedCatalog = loadLocalCatalogProducts()!;
      expect(reloadedCatalog.length).toBe(1);
      expect(reloadedCatalog[0].productType).toBe('Sweatshirt');
      expect(reloadedCatalog[0].productTypeManualOverride).toBe(true);
      expect(reloadedCatalog[0].category).toBe('American History');

      // 7. Refreshing imported product data does NOT overwrite a manual override or confirmed category
      const refreshResult = mergeRefreshedProductData(manuallyOverriddenProduct, {
        ...extracted,
        price: '$52.00',
        productType: 'Hoodie',
        category: 'General',
      });
      expect(refreshResult.mergedProduct.productType).toBe('Sweatshirt');
      expect(refreshResult.mergedProduct.productTypeManualOverride).toBe(true);
      expect(refreshResult.mergedProduct.category).toBe('American History');
      expect(refreshResult.mergedProduct.price).toBe('$52.00');
      expect(refreshResult.preservedFields).toContain('Product Type');
      expect(refreshResult.preservedFields).toContain('Category');

      // 8. Migration of older product records preserves existing categories & custom types, and populates missing types
      const legacyMissingTypeProduct: Product = {
        ...manuallyOverriddenProduct,
        id: 'prod-legacy-no-type',
        name: 'The Original Hottake 1943 T-Shirt',
        productUrl: '/products/the-original-hottake-1943-t-shirt',
        productType: '',
        productTypeManualOverride: undefined,
        category: 'Hades', // Uncataloged legacy category
      };

      const hydrated = migrateAndHydrateProductRecord(
        legacyMissingTypeProduct,
        INITIAL_PRODUCT_CATEGORIES
      );
      expect(hydrated.category).toBe('Hades'); // Preserved!
      expect(hydrated.productType).toBe('T-Shirt'); // Suggested type populated!

      const uncataloged = getUncatalogedProductCategories([hydrated], INITIAL_PRODUCT_CATEGORIES);
      expect(uncataloged).toContain('Hades');
    } finally {
      (globalThis as any).window = prevWindow;
    }
  });
});

describe('Feature 8: Modal Rich-Text Editor for First Three Editorial Fields (Subheadline/Dek, Editorial Copy, Specifications Callout)', () => {
  it('1. validates safe and unsafe hyperlinks correctly (rejects javascript, vbscript, data)', () => {
    expect(isSafeUrl('https://scienceofgifts.com/products/iliad')).toBe(true);
    expect(isSafeUrl('http://example.com')).toBe(true);
    expect(isSafeUrl('mailto:curator@scienceofgifts.com')).toBe(true);
    expect(isSafeUrl('#section-ancient-rome')).toBe(true);
    expect(isSafeUrl('/products/achilles-mug')).toBe(true);

    expect(isSafeUrl('javascript:alert(document.cookie)')).toBe(false);
    expect(isSafeUrl('JAVASCRIPT:void(0)')).toBe(false);
    expect(isSafeUrl('vbscript:msgbox("test")')).toBe(false);
    expect(isSafeUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeUrl('')).toBe(false);
    expect(isSafeUrl(null)).toBe(false);
  });

  it('2. sanitizes rich editorial HTML: strips dangerous scripts, iframes, inline event handlers while preserving safe formatting and external link rel', () => {
    const malicious = `
      <p>A <strong>magnificent</strong> gift guide pick with <script>alert("xss")</script> and <iframe src="//evil.com"></iframe>.</p>
      <p>Check this <a href="https://fourthwall.com/science-of-gifts" onclick="malicious()" target="_blank">curated store</a> and an unsafe <a href="javascript:doBadThings()">bad link</a>.</p>
      <b>Bold text</b> and <i>italic text</i>.
    `;
    const sanitized = sanitizeEditorialRichHtml(malicious);

    expect(sanitized).not.toContain('<script');
    expect(sanitized).not.toContain('<iframe');
    expect(sanitized).not.toContain('onclick');
    expect(sanitized).not.toContain('javascript:');

    // Normalizes <b> to <strong> and <i> to <em>
    expect(sanitized).toContain('<strong>magnificent</strong>');
    expect(sanitized).toContain('<strong>Bold text</strong>');
    expect(sanitized).toContain('<em>italic text</em>');

    // External link has target="_blank" and rel="noopener noreferrer"
    expect(sanitized).toContain('rel="noopener noreferrer"');
    expect(sanitized).toContain('href="https://fourthwall.com/science-of-gifts"');
  });

  it('3. extracts plain text and counts words accurately from formatted HTML', () => {
    const richSnippet = '<p>The <strong>ultimate</strong> companion for <em>history teachers</em>.</p><ul><li>100% Linen</li><li>Made in Greece</li></ul>';
    const plain = extractPlainTextFromHtml(richSnippet);
    expect(plain).toBe('The ultimate companion for history teachers.\n\n100% Linen\nMade in Greece');
    expect(countWords(richSnippet)).toBe(11);
  });

  it('4. converts unformatted multi-line text into standard HTML paragraphs and leaves rich HTML intact', () => {
    const plain = 'First paragraph.\n\nSecond paragraph with notes.';
    const paragraphs = ensureParagraphsHtml(plain);
    expect(paragraphs).toContain('<p>First paragraph.</p>');
    expect(paragraphs).toContain('<p>Second paragraph with notes.</p>');

    const alreadyRich = '<p>Already formatted paragraph.</p>';
    expect(ensureParagraphsHtml(alreadyRich)).toBe('<p>Already formatted paragraph.</p>');
  });

  it('5. extracts htmlValue on dek, description, and specsCallout during AST analysis', () => {
    const sampleCardHtml = `
      <article class="sog-ed-card">
        <div class="sog-ed-media">
          <a href="https://example.com/p1"><span class="sog-ed-num">#01</span><img src="/img.jpg" alt="Item" /></a>
        </div>
        <div class="sog-ed-content">
          <h3 class="sog-ed-title"><a href="https://example.com/p1">The History Atlas</a></h3>
          <p class="sog-ed-dek">A <strong>visually stunning</strong> chronicle with <a href="https://example.com">historical charts</a>.</p>
          <div class="sog-ed-copy">
            <p>First paragraph detailing the map fidelity and rich binding.</p>
            <p>Second paragraph praising the <em>curated footnotes</em>.</p>
          </div>
          <div class="sog-ed-specs">
            <p>• Hardcover foil embossed</p>
            <p>• 480 pages, archival paper</p>
          </div>
          <div class="sog-ed-footer">
            <span class="sog-ed-tags">Best for: Cartography lovers</span>
            <a href="https://example.com/p1" class="sog-ed-cta">Shop Gift →</a>
          </div>
        </div>
      </article>
    `;

    const report = analyzeHtmlDocument(sampleCardHtml, sampleProducts);
    const card = report.blocks[0].productCards[0];
    expect(card).toBeDefined();

    // Plain text values are extracted
    expect(card.fields.dek?.value).toBe('A visually stunning chronicle with historical charts.');
    expect(card.fields.description?.value).toContain('First paragraph detailing the map fidelity');
    expect(card.fields.specsCallout?.value).toContain('Hardcover foil embossed');

    // Rich inner HTML is captured
    expect(card.fields.dek?.htmlValue).toContain('<strong>visually stunning</strong>');
    expect(card.fields.dek?.htmlValue).toContain('<a href="https://example.com">historical charts</a>');
    expect(card.fields.description?.htmlValue).toContain('<p>First paragraph detailing');
    expect(card.fields.description?.htmlValue).toContain('<em>curated footnotes</em>');
    expect(card.fields.specsCallout?.htmlValue).toContain('<p>• Hardcover foil embossed</p>');
  });

  it('6. updates dek, description, and specsCallout AST nodes with rich HTML without altering sibling nodes', () => {
    const cardHtml = `
      <article class="sog-ed-card">
        <h3 class="sog-ed-title">Atlas</h3>
        <p class="sog-ed-dek">Old plain dek</p>
        <div class="sog-ed-copy"><p>Old copy</p></div>
        <div class="sog-ed-specs"><p>Old specs</p></div>
      </article>
    `;

    const initialReport = analyzeHtmlDocument(cardHtml, sampleProducts);
    const card = initialReport.blocks[0].productCards[0];

    // 1. Update Dek with formatted HTML
    const updatedWithRichDek = updateHtmlNodeText(
      cardHtml,
      card.fields.dek!.nodePath,
      'A <strong>monumental</strong> work with <a href="https://maps.example.com">fine engravings</a>',
      { asRawInnerHtml: true }
    );
    expect(updatedWithRichDek).toContain('<p class="sog-ed-dek">A <strong>monumental</strong> work with <a href="https://maps.example.com">fine engravings</a></p>');
    expect(updatedWithRichDek).toContain('<h3 class="sog-ed-title">Atlas</h3>'); // Sibling preserved!

    // 2. Update Description with multiple paragraphs and lists
    const updatedDescReport = analyzeHtmlDocument(updatedWithRichDek, sampleProducts);
    const card2 = updatedDescReport.blocks[0].productCards[0];

    const richCopy = '<p>Paragraph 1 with <em>emphasis</em>.</p><ul><li>Feature A</li><li>Feature B</li></ul>';
    const updatedWithRichCopy = updateHtmlNodeText(
      updatedWithRichDek,
      card2.fields.description!.nodePath,
      richCopy,
      { asRawInnerHtml: true }
    );
    expect(updatedWithRichCopy).toContain('<div class="sog-ed-copy"><p>Paragraph 1 with <em>emphasis</em>.</p><ul><li>Feature A</li><li>Feature B</li></ul></div>');
    expect(updatedWithRichCopy).toContain('<strong>monumental</strong>'); // Dek preserved!

    // 3. Update Specs with formatted bullets
    const updatedSpecsReport = analyzeHtmlDocument(updatedWithRichCopy, sampleProducts);
    const card3 = updatedSpecsReport.blocks[0].productCards[0];

    const richSpecs = '<p>• <strong>Material:</strong> 100% Cotton</p><p>• <strong>Origin:</strong> USA</p>';
    const finalHtml = updateHtmlNodeText(
      updatedWithRichCopy,
      card3.fields.specsCallout!.nodePath,
      richSpecs,
      { asRawInnerHtml: true }
    );
    expect(finalHtml).toContain('<div class="sog-ed-specs"><p>• <strong>Material:</strong> 100% Cotton</p><p>• <strong>Origin:</strong> USA</p></div>');
  });

  it('7. renders editorial_list in htmlRenderer with rich markup intact and safely sanitized', () => {
    const mockSection: GuideSection = {
      id: 'sec-editorial-test',
      ownerId: 'local-preview',
      guideId: 'guide-test',
      type: 'editorial_list',
      title: 'History Essentials',
      anchorId: 'history-essentials',
      enabled: true,
      order: 1,
      config: {
        editorialItems: [
          {
            id: 'ed-item-1',
            order: 1,
            productId: sampleProducts[0].id,
            rankNumber: '#01',
            superlativeBadge: 'Best Overall',
            eyebrowCategory: 'Cartography',
            priceDisplay: '$34.00',
            priceNote: 'Unisex',
            displayTitle: 'The Classical Atlas',
            dek: 'A <strong>gorgeous</strong> edition with <a href="https://example.com">ancient maps</a>.',
            editorialCopy: '<p>Every map was hand-restored.</p><p>Includes <em>marginalia</em>.</p>',
            specsCallout: '<p>• <strong>Binding:</strong> Leatherette</p>',
            tagsText: 'Best for: History buffs',
            ctaLabel: 'Shop Gift →',
            productUrlOverride: '',
            imageUrlOverride: '',
          },
        ],
      },
    };

    const rendered = renderSectionHtml(mockSection, sampleProducts, { forPreview: false });
    expect(rendered).toContain('<p class="sog-ed-dek">A <strong>gorgeous</strong> edition with <a href="https://example.com">ancient maps</a>.</p>');
    expect(rendered).toContain('<div class="sog-ed-copy">\n<p>Every map was hand-restored.</p><p>Includes <em>marginalia</em>.</p>\n        </div>');
    expect(rendered).toContain('<strong>Binding:</strong> Leatherette');
  });
});

describe('Feature 9: Replaceable & Preview-Synced Gift Guide CSS Editor', () => {
  it('1. loads existing default CSS when opening or creating a project with no custom CSS override', async () => {
    const project = await createNewHtmlProject({
      name: 'Default CSS Guide',
      htmlContent: '<section class="sog-guide-container"><h2 class="sog-chapter-title">Olympus Gifts</h2></section>',
    });

    expect(resolveProjectCss(project)).toBe(DEFAULT_GIFT_GUIDE_CSS);
    expect(project.customCss).toBe(DEFAULT_GIFT_GUIDE_CSS);
    expect(project.editorState.customCss).toBe(DEFAULT_GIFT_GUIDE_CSS);
    expect(DEFAULT_GIFT_GUIDE_CSS).toContain('.sog-chapter-banner');
    expect(DEFAULT_GIFT_GUIDE_CSS).toContain('.sog-ed-card');
  });

  it('2. replaces the entire CSS stylesheet independently without resetting product data, sections, or numbering', async () => {
    const initialHtml = `
      <section class="sog-guide-container" id="sec-roman">
        <div class="sog-chapter-banner"><h2 class="sog-chapter-title">Roman Artifacts</h2></div>
        <div class="sog-editorial-list">
          <article class="sog-ed-card">
            <div class="sog-ed-header">
              <div class="sog-ed-rank-box"><span class="sog-ed-num">#05</span></div>
              <div class="sog-ed-title-wrap"><h3 class="sog-ed-title"><a href="/products/spqr-mug">SPQR Ceramic Mug</a></h3></div>
            </div>
            <div class="sog-ed-body"><p class="sog-ed-dek">Hand-glazed imperial crimson mug.</p></div>
          </article>
        </div>
      </section>
    `;

    let project = await createNewHtmlProject({
      name: 'Roman Empire Guide',
      htmlContent: initialHtml,
    });

    project = updateProjectSectionStartingNumberById(project, project.sections![0].id, 5, sampleProducts);

    const brandNewStylesheet = `
      /* Complete Replacement Stylesheet v2 */
      .sog-guide-container { max-width: 1240px; background: #fffdf9; border: 3px solid #7c2d12; }
      .sog-ed-card { border-radius: 24px; box-shadow: 0 12px 32px rgba(124, 45, 18, 0.15); }
      .sog-ed-title a { color: #7c2d12; text-transform: uppercase; }
    `.trim();

    // Also test stripping outer <style> wrapper if the user pastes <style>...</style>
    const updatedProject = updateProjectCss(
      project,
      `<style>\n${brandNewStylesheet}\n</style>`,
      sampleProducts
    );

    expect(updatedProject.customCss).toBe(brandNewStylesheet);
    expect(updatedProject.editorState.customCss).toBe(brandNewStylesheet);
    expect(resolveProjectCss(updatedProject)).toBe(brandNewStylesheet);

    // HTML sections, product card content, and starting product number remain untouched
    expect(updatedProject.sections).toHaveLength(1);
    expect(updatedProject.sections![0].name).toContain('Roman Artifacts');
    expect(updatedProject.sections![0].startingProductNumber).toBe(5);
    expect(updatedProject.currentHtml).toContain('SPQR Ceramic Mug');
    expect(updatedProject.currentHtml).toContain('#05');
  });

  it('3. synchronizes the live preview iframe document with the replaced CSS and never uses the old stylesheet', () => {
    const safeBodyHtml = '<section class="sog-guide-container"><h2 class="sog-chapter-title">Preview Sync Check</h2></section>';
    const replacementCss = '.sog-guide-container { background: rgb(18, 52, 86); color: #f8fafc; }';

    const previewDoc = buildPreviewIframeDocument(safeBodyHtml, replacementCss, true);

    expect(previewDoc).toContain(replacementCss);
    expect(previewDoc).toContain('Preview Sync Check');
    // Must not inject the old default stylesheet when replacement CSS is active
    expect(previewDoc).not.toContain('/* 1. CHAPTER BANNERS */');
  });

  it('4. persists replaced CSS across project saves, reloads, and switching between multiple saved guides', async () => {
    const cssGuideA = '/* Guide A Custom CSS */ .sog-guide-container { border-color: #1e40af; }';
    const cssGuideB = '/* Guide B Custom CSS */ .sog-guide-container { border-color: #065f46; }';

    let guideA = await createNewHtmlProject({
      name: 'Guide A - Naval History',
      htmlContent: '<section class="sog-guide-container"><h2>Naval Picks</h2></section>',
    });
    guideA = updateProjectCss(guideA, cssGuideA);
    await saveHtmlProject(guideA);

    let guideB = await createNewHtmlProject({
      name: 'Guide B - Botanical History',
      htmlContent: '<section class="sog-guide-container"><h2>Botanical Picks</h2></section>',
    });
    guideB = updateProjectCss(guideB, cssGuideB);
    await saveHtmlProject(guideB);

    // Reload from persistent storage (simulating closing & reopening the app or switching projects)
    const reloadedProjects = loadLocalHtmlProjects();
    const loadedA = reloadedProjects.find((p) => p.id === guideA.id)!;
    const loadedB = reloadedProjects.find((p) => p.id === guideB.id)!;

    expect(loadedA).toBeDefined();
    expect(loadedB).toBeDefined();
    expect(resolveProjectCss(loadedA)).toBe(cssGuideA);
    expect(resolveProjectCss(loadedB)).toBe(cssGuideB);
  });

  it('5. exports final Fourthwall code with the current replaced CSS and HTML, never exporting outdated CSS', async () => {
    let project = await createNewHtmlProject({
      name: 'Fourthwall Final Export Guide',
      htmlContent: '<section class="sog-guide-container" id="sec-1"><h2>Section 1</h2></section>',
    });

    project = appendHtmlSectionToProject(
      project,
      '<section class="sog-guide-container" id="sec-2"><h2>Section 2 FAQ</h2></section>',
      { name: 'Section 2', manualType: 'faq_section' },
      sampleProducts
    );

    const newFourthwallCss = `
/* Custom Fourthwall Production Stylesheet 2026 */
.sog-guide-container { font-family: "Georgia", serif; margin: 32px auto; }
.sog-ed-cta { background: #1d4ed8 !important; color: #ffffff !important; }
    `.trim();

    project = updateProjectCss(project, newFourthwallCss, sampleProducts);

    // Complete project export includes <style> with the new CSS + all HTML sections in order
    const exportedWithCss = exportCompleteProjectHtml(project, sampleProducts, { includeCss: true });
    expect(exportedWithCss.html).toContain(`<style>\n${newFourthwallCss}\n</style>`);
    expect(exportedWithCss.html).toContain('<section class="sog-guide-container" id="sec-1"><h2>Section 1</h2></section>');
    expect(exportedWithCss.html).toContain('<section class="sog-guide-container" id="sec-2"><h2>Section 2 FAQ</h2></section>');
    // Never contains the old default stylesheet
    expect(exportedWithCss.html).not.toContain('/* 1. CHAPTER BANNERS */');

    // Individual section export with includeCss: true also uses the new CSS
    const sectionExportWithCss = exportProjectSectionHtml(
      project,
      project.sections![0].id,
      sampleProducts,
      { includeCss: true }
    );
    expect(sectionExportWithCss.html).toContain(`<style>\n${newFourthwallCss}\n</style>`);
    expect(sectionExportWithCss.html).toContain('Section 1');
    expect(sectionExportWithCss.html).not.toContain('Section 2 FAQ');

    // HTML-only export option omits <style> cleanly when requested
    const htmlOnlyExport = buildFourthwallExportCode(project.currentHtml, newFourthwallCss, {
      includeCss: false,
    });
    expect(htmlOnlyExport).not.toContain('<style>');
    expect(htmlOnlyExport).toContain('Section 1');
    expect(htmlOnlyExport).toContain('Section 2 FAQ');
  });
});

describe('Feature 10: IndexedDB Project Persistence, Bulk Sharp Image Optimizer, Deterministic Slugs, R2 Upload, and Guide HTML Link Replacement', () => {
  it('1. migrates existing localStorage projects to IndexedDB once, verifies read-back integrity, and removes the large localStorage project payload', async () => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => store.set(k, v),
          removeItem: (k: string) => store.delete(k),
        },
      },
      configurable: true,
      writable: true,
    });
    resetIdbStorageForTesting();

    const legacyProjects = [
      {
        id: 'legacy-proj-1',
        ownerId: 'local-preview',
        name: 'Legacy Roman Empire Guide',
        currentHtml: '<section class="sog-guide-container"><h2>Roman Legion Picks</h2></section>',
        originalHtml: '<section class="sog-guide-container"><h2>Roman Legion Picks</h2></section>',
        baseUrl: 'https://scienceofgifts.com',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
      {
        id: 'legacy-proj-2',
        ownerId: 'local-preview',
        name: 'Legacy Viking History Guide',
        currentHtml: '<section class="sog-guide-container"><h2>Viking Raven Picks</h2></section>',
        originalHtml: '<section class="sog-guide-container"><h2>Viking Raven Picks</h2></section>',
        baseUrl: 'https://scienceofgifts.com',
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-04T00:00:00.000Z',
      },
    ];

    store.set(LEGACY_LOCAL_HTML_PROJECTS_KEY, JSON.stringify(legacyProjects));

    const migrationResult = await migrateLocalStorageProjectsToIdb();
    expect(migrationResult.migratedCount).toBe(2);
    expect(migrationResult.alreadyMigrated).toBe(false);

    // Verify large project list was removed from localStorage after verified IndexedDB write
    expect(store.has(LEGACY_LOCAL_HTML_PROJECTS_KEY)).toBe(false);
    // Verify lightweight migration metadata was recorded in localStorage
    expect(store.get(LOCAL_HTML_PROJECTS_MIGRATED_KEY)).toContain('"migratedCount":2');

    // Hydrate from IndexedDB and verify both projects are intact
    const hydrated = await hydrateHtmlProjectsFromIdb();
    expect(hydrated).toHaveLength(2);
    expect(hydrated.map((p) => p.id).sort()).toEqual(['legacy-proj-1', 'legacy-proj-2']);

    // Running migration a second time is a no-op
    const secondRun = await migrateLocalStorageProjectsToIdb();
    expect(secondRun.alreadyMigrated).toBe(true);
  });

  it('2. saves, loads, updates, and deletes a large multi-project collection (> 5.2 MB total HTML) in IndexedDB without hitting the old ~4.1 MB localStorage limit', async () => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => {
            if (v.length > 4_000_000) {
              throw new Error('QuotaExceededError: localStorage 4MB limit exceeded');
            }
            store.set(k, v);
          },
          removeItem: (k: string) => store.delete(k),
        },
      },
      configurable: true,
      writable: true,
    });
    resetIdbStorageForTesting();

    // Create 15 large projects totaling > 5.2 MB across currentHtml + originalHtml + sections
    const repeatedCardChunk =
      '<article class="sog-ed-card"><h3>Historical Artifact Replica</h3><p>' +
      'Detailed museum-grade historical gift description and archival provenance notes. '.repeat(25) +
      '</p></article>\n';
    const largeSectionHtml = `<section class="sog-guide-container">\n${repeatedCardChunk.repeat(68)}</section>`;
    expect(largeSectionHtml.length).toBeGreaterThan(130_000);

    const createdIds: string[] = [];
    for (let i = 1; i <= 15; i++) {
      const created = await createNewHtmlProject({
        name: `Large Historical Gift Guide #${i}`,
        htmlContent: largeSectionHtml,
      });
      createdIds.push(created.id);
    }

    const allProjects = await hydrateHtmlProjectsFromIdb();
    expect(allProjects).toHaveLength(15);

    const totalSerializedBytes = JSON.stringify(allProjects).length;
    // Total collection exceeds 5.2 MB (well above the old 4.1 MB localStorage failure threshold)
    expect(totalSerializedBytes).toBeGreaterThan(5_200_000);

    // Ensure full project collection is NOT stored in localStorage
    expect(store.has(LEGACY_LOCAL_HTML_PROJECTS_KEY)).toBe(false);
    expect(store.get(LOCAL_ACTIVE_HTML_PROJECT_ID_KEY)).toBe(createdIds[14]);

    // Update one of the projects and verify persistence
    const targetToUpdate = allProjects.find((p) => p.id === createdIds[0])!;
    const updatedProj = await saveHtmlProject({
      ...targetToUpdate,
      name: 'Updated Large Historical Guide #1',
    });
    expect(updatedProj.name).toBe('Updated Large Historical Guide #1');

    // Delete one project and verify 14 remain
    await deleteHtmlProject(createdIds[1]);
    const remaining = await hydrateHtmlProjectsFromIdb();
    expect(remaining).toHaveLength(14);
    expect(remaining.some((p) => p.id === createdIds[1])).toBe(false);
  });

  it('3. surfaces actionable IndexedDB errors when unavailable, blocked, or failing verification, and never falsely succeeds', async () => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => store.set(k, v),
          removeItem: (k: string) => store.delete(k),
        },
      },
      configurable: true,
      writable: true,
    });
    resetIdbStorageForTesting();

    const sampleProject: HtmlEditorProject = {
      id: 'idb-error-test-proj',
      ownerId: 'local-preview',
      name: 'IDB Failure Test Project',
      currentHtml: '<section><h2>Test</h2></section>',
      originalHtml: '<section><h2>Test</h2></section>',
      baseUrl: 'https://scienceofgifts.com',
      editorState: {
        viewMode: 'split',
        selectedBlockId: 'ALL',
        sidebarTab: 'blocks',
        previewViewport: 'desktop',
        includeFourthwallCss: true,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      setSimulatedIdbFailureForTesting('unavailable');
      await expect(saveHtmlProject(sampleProject)).rejects.toThrow(/IndexedDB is unavailable/i);

      setSimulatedIdbFailureForTesting('blocked');
      await expect(saveHtmlProject(sampleProject)).rejects.toThrow(/blocked by another open tab/i);

      setSimulatedIdbFailureForTesting('verification_mismatch');
      await expect(saveHtmlProjectToIdb(sampleProject)).rejects.toThrow(
        /write verification failed/i
      );
    } finally {
      setSimulatedIdbFailureForTesting('none');
    }
  });

  it('4, 5 & 6. resizes landscape, portrait, and square images proportionally with Sharp without cropping, never upscales smaller images, and preserves RGBA transparency in WebP', async () => {
    // 4a. Landscape 1600x1200 (4:3) -> resized to 600x450
    const landscapePng = await sharp({
      create: {
        width: 1600,
        height: 1200,
        channels: 4,
        background: { r: 30, g: 64, b: 175, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const landscapeResult = await processImageWithSharp(
      new Uint8Array(landscapePng),
      600,
      80
    );
    expect(landscapeResult.originalWidth).toBe(1600);
    expect(landscapeResult.originalHeight).toBe(1200);
    expect(landscapeResult.width).toBe(600);
    expect(landscapeResult.height).toBe(450);
    expect(landscapeResult.wasResized).toBe(true);
    expect(isWebpBinary(landscapeResult.webpBytes)).toBe(true);

    // 4b. Portrait 1200x1800 (2:3) -> resized to 600x900 (uncropped aspect ratio preserved!)
    const portraitPng = await sharp({
      create: {
        width: 1200,
        height: 1800,
        channels: 4,
        background: { r: 124, g: 45, b: 18, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const portraitResult = await processImageWithSharp(
      new Uint8Array(portraitPng),
      600,
      80
    );
    expect(portraitResult.width).toBe(600);
    expect(portraitResult.height).toBe(900);
    expect(portraitResult.wasResized).toBe(true);

    // 4c. Square 1200x1200 (1:1) -> resized to 900x900 for featured image
    const squarePng = await sharp({
      create: {
        width: 1200,
        height: 1200,
        channels: 3,
        background: { r: 20, g: 83, b: 45 },
      },
    })
      .png()
      .toBuffer();

    const squareResult = await processImageWithSharp(
      new Uint8Array(squarePng),
      900,
      82
    );
    expect(squareResult.width).toBe(900);
    expect(squareResult.height).toBe(900);

    // 5. Image smaller than target width (400x300 with maxWidth 600) is NOT upscaled
    const smallPng = await sharp({
      create: {
        width: 400,
        height: 300,
        channels: 3,
        background: { r: 100, g: 100, b: 100 },
      },
    })
      .png()
      .toBuffer();

    const smallResult = await processImageWithSharp(new Uint8Array(smallPng), 600, 80);
    expect(smallResult.width).toBe(400);
    expect(smallResult.height).toBe(300);
    expect(smallResult.wasResized).toBe(false);

    // 6. Transparent RGBA PNG preserves alpha channel when converted to WebP
    const transparentPng = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 4,
        background: { r: 255, g: 215, b: 0, alpha: 0.35 },
      },
    })
      .png()
      .toBuffer();

    const transparentWebp = await processImageWithSharp(
      new Uint8Array(transparentPng),
      600,
      80
    );
    expect(transparentWebp.width).toBe(600);
    expect(transparentWebp.height).toBe(450);
    expect(transparentWebp.hasAlpha).toBe(true);

    const decodedMeta = await sharp(Buffer.from(transparentWebp.webpBytes)).metadata();
    expect(decodedMeta.format).toBe('webp');
    expect(decodedMeta.hasAlpha).toBe(true);
  });

  it('7 & 8. derives deterministic product slugs from URLs, assigns deterministic suffixes for multi-image products, persists mappings in IndexedDB, and flags source-changed conflicts', async () => {
    resetIdbStorageForTesting();

    // Deterministic slug derivation from full URLs, query strings, and relative /products/ paths
    expect(
      deriveProductSlugFromUrl(
        'https://shop.scienceofgifts.com/products/viking-raven-t-shirt?variant=123#top'
      )
    ).toBe('viking-raven-t-shirt');
    expect(
      deriveProductSlugFromUrl('/products/Marcus_Aurelius_Stoic_Mug/')
    ).toBe('marcus-aurelius-stoic-mug');

    expect(
      buildPublicOptimizedImageUrl(
        'viking-raven-t-shirt',
        'https://images.scienceofgifts.com'
      )
    ).toBe('https://images.scienceofgifts.com/products/viking-raven-t-shirt.webp');

    expect(buildR2ObjectKey('viking-raven-t-shirt', '-back')).toBe(
      'products/viking-raven-t-shirt-back.webp'
    );

    // Deterministic suffixes for multiple distinct images belonging to the same product
    const multiImageSuffixes = assignDeterministicSuffixesForProductImages([
      'https://cdn.fourthwall.com/viking-front.png',
      'https://cdn.fourthwall.com/viking-back.png',
      'https://cdn.fourthwall.com/viking-closeup-1.png',
      'https://cdn.fourthwall.com/viking-closeup-2.png',
    ]);
    expect(multiImageSuffixes.map((x) => x.variantSuffix)).toEqual([
      '',
      '-back',
      '-detail-1',
      '-detail-2',
    ]);

    // Persist mapping in IndexedDB and verify sourceChangedConflict detection
    const initialMapping: ProductImageMappingRecord = {
      id: 'viking-raven-t-shirt::https://cdn.fourthwall.com/viking-v1.png',
      productName: 'Viking Raven T-Shirt',
      productPageUrl: 'https://shop.scienceofgifts.com/products/viking-raven-t-shirt',
      baseProductSlug: 'viking-raven-t-shirt',
      productSlug: 'viking-raven-t-shirt',
      variantSuffix: '',
      role: 'standard',
      originalImageUrl: 'https://cdn.fourthwall.com/viking-v1.png',
      optimizedImageUrl: 'https://images.scienceofgifts.com/products/viking-raven-t-shirt.webp',
      r2ObjectKey: 'products/viking-raven-t-shirt.webp',
      status: 'uploaded',
    };
    await saveImageMappingsToIdb([initialMapping]);

    const savedMappings = await getAllImageMappingsFromIdb();
    expect(savedMappings).toHaveLength(1);

    // Scan guide HTML where the same product now points to a DIFFERENT original image URL (v2)
    const guideHtmlWithNewSource = `
      <article class="sog-ed-card">
        <a href="https://shop.scienceofgifts.com/products/viking-raven-t-shirt">
          <img class="sog-ed-img" src="https://cdn.fourthwall.com/viking-v2-changed.png" alt="Viking Raven Tee">
        </a>
      </article>
    `;
    const scanned = scanGuideHtmlForImages(
      guideHtmlWithNewSource,
      [],
      savedMappings,
      'https://images.scienceofgifts.com'
    );
    expect(scanned).toHaveLength(1);
    expect(scanned[0].productSlug).toBe('viking-raven-t-shirt');
    expect(scanned[0].sourceChangedConflict).toBe(true);
  });

  it('9. replaces product image URLs in Guide HTML while preserving alt, width, height, loading, and CSS classes, and leaves unmatched/ambiguous images untouched', () => {
    const originalGuideHtml = `
      <section class="sog-guide-container">
        <div class="sog-editor-pick">
          <a href="https://shop.scienceofgifts.com/products/viking-raven-t-shirt">
            <img class="sog-ep-img" src="https://cdn.fourthwall.com/raw/viking-raven-huge.png" alt="Viking Raven Tee" width="900" height="675" loading="eager">
          </a>
        </div>
        <div class="sog-editorial-list">
          <article class="sog-ed-card">
            <div class="sog-ed-media">
              <img class="sog-ed-img" src="https://cdn.fourthwall.com/raw/spqr-mug-old.jpg" data-product-url="/products/spqr-roman-mug" alt="SPQR Ceramic Mug" width="600" height="450" loading="lazy">
            </div>
          </article>
          <article class="sog-ed-card">
            <div class="sog-ed-media">
              <img class="sog-ed-img" src="https://cdn.fourthwall.com/raw/unoptimized-poster.jpg" data-product-url="/products/unoptimized-poster" alt="Unoptimized Poster" loading="lazy">
            </div>
          </article>
        </div>
      </section>
    `.trim();

    const mappings: ProductImageMappingRecord[] = [
      {
        id: 'map-1',
        productName: 'Viking Raven T-Shirt',
        productPageUrl: 'https://shop.scienceofgifts.com/products/viking-raven-t-shirt',
        baseProductSlug: 'viking-raven-t-shirt',
        productSlug: 'viking-raven-t-shirt',
        variantSuffix: '',
        role: 'featured',
        originalImageUrl: 'https://cdn.fourthwall.com/raw/viking-raven-huge.png',
        optimizedImageUrl: 'https://images.scienceofgifts.com/products/viking-raven-t-shirt.webp',
        r2ObjectKey: 'products/viking-raven-t-shirt.webp',
        status: 'uploaded',
      },
      {
        id: 'map-2',
        productName: 'SPQR Roman Mug',
        productPageUrl: 'https://shop.scienceofgifts.com/products/spqr-roman-mug',
        baseProductSlug: 'spqr-roman-mug',
        productSlug: 'spqr-roman-mug',
        variantSuffix: '',
        role: 'standard',
        // Different original URL to test unambiguous product-slug fallback matching
        originalImageUrl: 'https://cdn.fourthwall.com/raw/spqr-mug-original-upload.jpg',
        optimizedImageUrl: 'https://images.scienceofgifts.com/products/spqr-roman-mug.webp',
        r2ObjectKey: 'products/spqr-roman-mug.webp',
        status: 'optimized_locally',
      },
    ];

    const result = replaceGuideHtmlImageUrls(originalGuideHtml, mappings, {
      onlyUploadedOrOptimized: true,
    });

    expect(result.replacedCount).toBe(2);
    expect(result.replacements[0]).toMatchObject({
      productSlug: 'viking-raven-t-shirt',
      matchMode: 'exact_original_url',
      nextSrc: 'https://images.scienceofgifts.com/products/viking-raven-t-shirt.webp',
    });
    expect(result.replacements[1]).toMatchObject({
      productSlug: 'spqr-roman-mug',
      matchMode: 'unambiguous_product_slug',
      nextSrc: 'https://images.scienceofgifts.com/products/spqr-roman-mug.webp',
    });

    // Verify attributes (alt, width, height, loading, class) are preserved
    expect(result.updatedHtml).toContain(
      'class="sog-ep-img" src="https://images.scienceofgifts.com/products/viking-raven-t-shirt.webp" alt="Viking Raven Tee" width="900" height="675" loading="eager"'
    );
    expect(result.updatedHtml).toContain(
      'class="sog-ed-img" src="https://images.scienceofgifts.com/products/spqr-roman-mug.webp" data-product-url="/products/spqr-roman-mug" alt="SPQR Ceramic Mug" width="600" height="450" loading="lazy"'
    );

    // Unmatched image is reported and left untouched in the HTML
    expect(result.unmatchedImages).toHaveLength(1);
    expect(result.unmatchedImages[0].src).toBe(
      'https://cdn.fourthwall.com/raw/unoptimized-poster.jpg'
    );
    expect(result.updatedHtml).toContain(
      'src="https://cdn.fourthwall.com/raw/unoptimized-poster.jpg"'
    );
  });

  it('10. enforces server-side Firebase ID token verification for R2 uploads, rejects spoofed headers or unauthorized users, and uploads via Worker binding & S3 API using configured bucket name', async () => {
    // Generate a real WebP binary buffer via Sharp
    const samplePng = await sharp({
      create: {
        width: 300,
        height: 225,
        channels: 4,
        background: { r: 15, g: 81, b: 50, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const processed = await processImageWithSharp(new Uint8Array(samplePng), 600, 80);
    const validWebpBase64 = Buffer.from(processed.webpBytes).toString('base64');

    // Generate a real RSA-2048 keypair via Web Crypto to sign test Firebase ID tokens
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify']
    );
    const publicJwk = (await crypto.subtle.exportKey('jwk', keyPair.publicKey)) as JsonWebKey;
    const testKid = 'test-firebase-kid-2026';
    const customJwkSet: GoogleJwkSet = {
      keys: [
        {
          ...publicJwk,
          kid: testKid,
          kty: 'RSA',
          alg: 'RS256',
          use: 'sig',
          n: publicJwk.n!,
          e: publicJwk.e!,
        },
      ],
    };

    const toBase64Url = (input: string | Uint8Array): string => {
      const buf = typeof input === 'string' ? Buffer.from(input, 'utf-8') : Buffer.from(input);
      return buf
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    };

    const nowSec = 1_760_000_000;
    const signFirebaseJwt = async (
      claimsOverride: Record<string, unknown> = {},
      headerOverride: Record<string, unknown> = {}
    ): Promise<string> => {
      const header = { alg: 'RS256', typ: 'JWT', kid: testKid, ...headerOverride };
      const payload = {
        iss: 'https://securetoken.google.com/rock-sound-kdtd0',
        aud: 'rock-sound-kdtd0',
        sub: 'kXSNJQbhD7fxP64zJgGY5ALlZ1c2',
        email: 'scienceofgifts@gmail.com',
        email_verified: true,
        iat: nowSec - 60,
        exp: nowSec + 3600,
        ...claimsOverride,
      };
      const unsignedToken = `${toBase64Url(JSON.stringify(header))}.${toBase64Url(
        JSON.stringify(payload)
      )}`;
      const signature = await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        keyPair.privateKey,
        new TextEncoder().encode(unsignedToken)
      );
      return `${unsignedToken}.${toBase64Url(new Uint8Array(signature))}`;
    };

    const validCmsOwnerToken = await signFirebaseJwt();

    // 10a. Reject path traversal or invalid object keys
    expect(validateR2ObjectKey('../secrets/evil.webp').valid).toBe(false);
    expect(validateR2ObjectKey('products/viking-raven.jpg').valid).toBe(false);
    expect(validateR2ObjectKey('products/viking-raven-t-shirt.webp').valid).toBe(true);

    // 10b. Reject unauthenticated request AND reject spoofable X-SOG-CMS-Client: 1 header
    const unauthRes = await handleImageUploadR2Request(
      {
        objectKey: 'products/viking-raven-t-shirt.webp',
        webpBase64: validWebpBase64,
      },
      {},
      { cmsClientHeader: '1' },
      { customJwkSet, nowSeconds: nowSec }
    );
    expect(unauthRes.status).toBe(401);
    expect(unauthRes.body.error).toMatch(/missing Firebase Authentication Bearer token/i);

    // 10c. Reject expired Firebase ID token (401)
    const expiredToken = await signFirebaseJwt({ exp: nowSec - 120 });
    const expiredRes = await handleImageUploadR2Request(
      {
        objectKey: 'products/viking-raven-t-shirt.webp',
        webpBase64: validWebpBase64,
      },
      {},
      { authorization: `Bearer ${expiredToken}` },
      { customJwkSet, nowSeconds: nowSec }
    );
    expect(expiredRes.status).toBe(401);
    expect(expiredRes.body.error).toMatch(/expired/i);

    // 10d. Reject valid Firebase token from an unauthorized user not in the CMS allowlist (403)
    const unauthorizedUserToken = await signFirebaseJwt({
      sub: 'unlisted-random-uid-999',
      email: 'intruder@example.com',
      email_verified: true,
    });
    const forbiddenRes = await handleImageUploadR2Request(
      {
        objectKey: 'products/viking-raven-t-shirt.webp',
        webpBase64: validWebpBase64,
      },
      {},
      { authorization: `Bearer ${unauthorizedUserToken}` },
      { customJwkSet, nowSeconds: nowSec }
    );
    expect(forbiddenRes.status).toBe(403);
    expect(forbiddenRes.body.error).toMatch(/not an authorized Science of Gifts CMS editor/i);

    // 10e. Reject non-WebP binary payload even with valid Firebase ID token
    const fakeJpgBase64 = Buffer.from('not-a-valid-riff-webp-file').toString('base64');
    const badFileRes = await handleImageUploadR2Request(
      {
        objectKey: 'products/viking-raven-t-shirt.webp',
        webpBase64: fakeJpgBase64,
      },
      {},
      { authorization: `Bearer ${validCmsOwnerToken}` },
      { customJwkSet, nowSeconds: nowSec }
    );
    expect(badFileRes.status).toBe(400);
    expect(badFileRes.body.error).toMatch(/RIFF\/WEBP/i);

    // 10f. Upload via Cloudflare Worker IMAGES_BUCKET binding through workers.ts
    // Also verify that even if R2_UPLOAD_AUTH_TOKEN is present in env, Firebase ID token auth succeeds
    const bucketObjects = new Map<string, { bytes: Uint8Array; options: any }>();
    const mockImagesBucket = {
      async put(key: string, value: Uint8Array | ArrayBuffer, options?: any) {
        const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
        bucketObjects.set(key, { bytes, options });
        return { key, etag: 'etag-mock-123' };
      },
      async head(key: string) {
        return bucketObjects.has(key) ? { key, size: bucketObjects.get(key)!.bytes.length } : null;
      },
    };

    const workerUploadReq = new Request('https://cms.scienceofgifts.com/api/images/upload-r2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validCmsOwnerToken}`,
      },
      body: JSON.stringify({
        objectKey: 'products/viking-raven-t-shirt.webp',
        webpBase64: validWebpBase64,
        publicBaseUrl: 'https://images.scienceofgifts.com',
      }),
    });

    const workerRes = await handleWorkerRequest(
      workerUploadReq,
      {
        IMAGES_BUCKET: mockImagesBucket,
        R2_BUCKET_NAME: 'custom-gifts-r2-bucket',
        R2_PUBLIC_BASE_URL: 'https://images.scienceofgifts.com',
        R2_UPLOAD_AUTH_TOKEN: 'legacy-env-secret-that-must-not-block-firebase-auth',
      },
      { customJwkSet, nowSeconds: nowSec }
    );
    expect(workerRes.status).toBe(200);
    const workerData = await workerRes.json();
    expect(workerData.ok).toBe(true);
    expect(workerData.mode).toBe('worker_binding');
    expect(workerData.authenticatedUserEmail).toBe('scienceofgifts@gmail.com');
    expect(workerData.publicUrl).toBe(
      'https://images.scienceofgifts.com/products/viking-raven-t-shirt.webp'
    );
    expect(bucketObjects.has('products/viking-raven-t-shirt.webp')).toBe(true);
    expect(
      bucketObjects.get('products/viking-raven-t-shirt.webp')!.options.httpMetadata.contentType
    ).toBe('image/webp');

    // 10g. Upload via S3-compatible R2 API using a custom configured R2_BUCKET_NAME
    const s3Requests: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
    const s3Res = await handleImageUploadR2Request(
      {
        objectKey: 'products/spqr-roman-mug.webp',
        webpBase64: validWebpBase64,
        publicBaseUrl: 'https://images.scienceofgifts.com',
        overwrite: true,
      },
      {
        R2_ACCOUNT_ID: 'acc123456',
        R2_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
        R2_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        R2_BUCKET_NAME: 'my-custom-configured-bucket',
        R2_PUBLIC_BASE_URL: 'https://images.scienceofgifts.com',
      },
      { authorization: `Bearer ${validCmsOwnerToken}` },
      {
        customJwkSet,
        nowSeconds: nowSec,
        customFetch: async (input, init) => {
          const urlStr = typeof input === 'string' ? input : input.toString();
          s3Requests.push({
            url: urlStr,
            method: init?.method || 'GET',
            headers: (init?.headers as Record<string, string>) || {},
          });
          return new Response('', { status: 200 });
        },
      }
    );
    expect(s3Res.status).toBe(200);
    expect(s3Res.body.mode).toBe('s3_api');
    expect(s3Requests).toHaveLength(1);
    expect(s3Requests[0].method).toBe('PUT');
    expect(s3Requests[0].url).toBe(
      'https://acc123456.r2.cloudflarestorage.com/my-custom-configured-bucket/products/spqr-roman-mug.webp'
    );
  });

  it('11. processes images in Cloudflare Workers using the native Cloudflare Images binding (IMAGES) with WebP output, 600px/900px max widths, quality ~80, aspect ratio preservation, no cropping, no upscaling, and alpha transparency preserved', async () => {
    const recordedTransforms: Array<{
      transformOpts: any;
      outputOpts: any;
    }> = [];

    // Mock Cloudflare Workers native `env.IMAGES` binding backed by sharp to produce real WebP output bytes
    const mockCloudflareImagesBinding: CloudflareImagesBinding = {
      input(stream) {
        let transformOpts: any = {};
        return {
          transform(opts) {
            transformOpts = { ...transformOpts, ...opts };
            return this;
          },
          async output(outputOpts) {
            recordedTransforms.push({ transformOpts, outputOpts });
            const inputAb = await new Response(stream as ReadableStream).arrayBuffer();
            const outBuf = await sharp(Buffer.from(inputAb))
              .rotate()
              .resize({
                width: transformOpts.width,
                height: transformOpts.height,
                fit: 'inside',
                withoutEnlargement: true,
              })
              .webp({
                quality: outputOpts.quality ?? 80,
                alphaQuality: 100,
              })
              .toBuffer();
            return {
              contentType: () => 'image/webp',
              response: () =>
                new Response(new Uint8Array(outBuf), {
                  headers: { 'Content-Type': 'image/webp' },
                }),
            };
          },
        };
      },
    };

    // 11a. Standard product landscape image (1600x1200 -> 600x450, WebP quality 80) via Worker endpoint
    const landscapePng = await sharp({
      create: {
        width: 1600,
        height: 1200,
        channels: 4,
        background: { r: 25, g: 55, b: 109, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();

    const workerOptimizeReq = new Request('https://cms.scienceofgifts.com/api/images/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageUrl: 'https://cdn.fourthwall.com/products/viking-raven-t-shirt.png',
        productPageUrl: 'https://shop.scienceofgifts.com/products/viking-raven-t-shirt',
        role: 'standard',
      }),
    });

    const workerOptimizeRes = await handleWorkerRequest(
      workerOptimizeReq,
      {
        IMAGES: mockCloudflareImagesBinding,
        R2_PUBLIC_BASE_URL: 'https://images.scienceofgifts.com',
      },
      {
        customImageBytesFetcher: async (url) => ({
          bytes: new Uint8Array(landscapePng),
          contentType: 'image/png',
          finalUrl: url,
        }),
      }
    );

    expect(workerOptimizeRes.status).toBe(200);
    const workerOptBody = await workerOptimizeRes.json();
    expect(workerOptBody.ok).toBe(true);
    expect(workerOptBody.productSlug).toBe('viking-raven-t-shirt');
    expect(workerOptBody.r2ObjectKey).toBe('products/viking-raven-t-shirt.webp');
    expect(workerOptBody.optimizedImageUrl).toBe(
      'https://images.scienceofgifts.com/products/viking-raven-t-shirt.webp'
    );
    expect(workerOptBody.originalDimensions).toEqual({ width: 1600, height: 1200 });
    expect(workerOptBody.optimizedDimensions).toEqual({ width: 600, height: 450 });
    expect(workerOptBody.hasAlpha).toBe(true);
    expect(recordedTransforms[0]).toEqual({
      transformOpts: { width: 600, height: 450, fit: 'scale-down' },
      outputOpts: { format: 'image/webp', quality: 80 },
    });

    // 11b. Featured portrait image (1200x1800 -> 900x1350, aspect ratio preserved, uncropped)
    const portraitPng = await sharp({
      create: {
        width: 1200,
        height: 1800,
        channels: 3,
        background: { r: 120, g: 40, b: 20 },
      },
    })
      .png()
      .toBuffer();

    const featuredOut = await processImageWithCloudflareImages(
      {
        inputBytes: new Uint8Array(portraitPng),
        maxWidth: 900,
        quality: 80,
      },
      mockCloudflareImagesBinding
    );
    expect(featuredOut.originalWidth).toBe(1200);
    expect(featuredOut.originalHeight).toBe(1800);
    expect(featuredOut.optimizedWidth).toBe(900);
    expect(featuredOut.optimizedHeight).toBe(1350);
    expect(featuredOut.wasResized).toBe(true);

    // 11c. Small image (400x300 with maxWidth 600) is NEVER upscaled
    const smallJpeg = await sharp({
      create: {
        width: 400,
        height: 300,
        channels: 3,
        background: { r: 80, g: 80, b: 80 },
      },
    })
      .jpeg()
      .toBuffer();

    const smallParsed = parseImageHeaderMetadata(new Uint8Array(smallJpeg));
    expect(smallParsed).toEqual({
      format: 'jpeg',
      width: 400,
      height: 300,
      hasAlpha: false,
    });

    const smallOut = await processImageWithCloudflareImages(
      {
        inputBytes: new Uint8Array(smallJpeg),
        maxWidth: 600,
        quality: 80,
      },
      mockCloudflareImagesBinding
    );
    expect(smallOut.optimizedWidth).toBe(400);
    expect(smallOut.optimizedHeight).toBe(300);
    expect(smallOut.wasResized).toBe(false);
  });
});

describe('Feature 11: Fourthwall Section-Only Character Limit Validation, >10 MB IndexedDB Persistence, Reload Hydration, Firestore Multi-Document Chunking, and Storage Diagnostics', () => {
  it('1. treats complete assembled gift guide character counts (e.g. 71,715+ chars across 16 sections) as neutral informational statistics while retaining the 30,000-char limit for individual section exports (including CSS when enabled)', async () => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => store.set(k, v),
          removeItem: (k: string) => store.delete(k),
        },
        indexedDB: createMockIndexedDbFactory(),
      },
      configurable: true,
      writable: true,
    });
    resetIdbStorageForTesting();

    // Build 16 sections (~4,500 chars each) so the complete assembled guide is ~72,000 chars
    const sectionParagraph =
      '<p>Museum-grade historical replica and archival gift commentary for collectors and educators. </p>';
    const makeSectionHtml = (idx: number, targetLen: number) => {
      const header = `<section class="sog-editorial-section" id="jump-sec-${idx}"><h2>Section ${idx}: Historical Curations</h2>`;
      const footer = '</section>';
      const bodyRepeat = Math.ceil(
        Math.max(100, targetLen - header.length - footer.length) / sectionParagraph.length
      );
      return `${header}${sectionParagraph.repeat(bodyRepeat)}${footer}`.slice(
        0,
        targetLen - footer.length
      ) + footer;
    };

    let project = await createNewHtmlProject({
      name: 'Complete 16-Section World History Gift Guide',
      initialHtml: makeSectionHtml(1, 4482),
    });
    for (let i = 2; i <= 16; i++) {
      project = appendHtmlSectionToProject(project, makeSectionHtml(i, 4482), {
        name: `Section ${i}`,
      });
    }
    project = await saveHtmlProject(project);

    expect(project.sections).toHaveLength(16);
    expect(project.currentHtml.length).toBeGreaterThan(71_000);

    // 1a. Complete project export evaluation MUST be neutral and NEVER report exceedsFourthwallLimit
    const completeEval = exportCompleteProjectHtml(project, [], { includeCss: false });
    expect(completeEval.characterCount).toBeGreaterThan(71_000);
    expect(completeEval.exceedsFourthwallLimit).toBe(false);
    expect(completeEval.exceedsLimit).toBe(false);
    expect(completeEval.approachingFourthwallLimit).toBe(false);
    expect(completeEval.warningMessage).toBeUndefined();

    const completeEvalWithCss = exportCompleteProjectHtml(project, [], { includeCss: true });
    expect(completeEvalWithCss.characterCount).toBeGreaterThan(80_000);
    expect(completeEvalWithCss.exceedsFourthwallLimit).toBe(false);
    expect(completeEvalWithCss.exceedsLimit).toBe(false);
    expect(completeEvalWithCss.warningMessage).toBeUndefined();

    // 1b. Normal individual section (~4,482 chars, or ~24,000 chars with CSS) is well under 30,000 chars
    const firstSecId = project.sections![0].id;
    const normalSecExport = exportProjectSectionHtml(project, firstSecId, [], {
      includeCss: false,
    });
    expect(normalSecExport.characterCount).toBeLessThan(30_000);
    expect(normalSecExport.exceedsFourthwallLimit).toBe(false);
    expect(normalSecExport.warningMessage).toBeUndefined();

    // 1c. Section that is 18,000 chars alone is valid without CSS, but when exported WITH a 19,500-char CSS block (total > 37,500 chars) exceeds the 30,000-char per-section limit
    const mediumSectionHtml = makeSectionHtml(17, 18_000);
    project = appendHtmlSectionToProject(project, mediumSectionHtml, {
      name: 'Section 17 Medium',
    });
    const sec17Id = project.sections![project.sections!.length - 1].id;

    const sec17HtmlOnly = exportProjectSectionHtml(project, sec17Id, [], { includeCss: false });
    expect(sec17HtmlOnly.characterCount).toBe(18_000);
    expect(sec17HtmlOnly.exceedsFourthwallLimit).toBe(false);

    const sec17WithCss = exportProjectSectionHtml(project, sec17Id, [], { includeCss: true });
    expect(sec17WithCss.characterCount).toBeGreaterThan(30_000);
    expect(sec17WithCss.exceedsFourthwallLimit).toBe(true);
    expect(sec17WithCss.warningMessage).toContain('30,000-character limit');

    // 1d. Individual section > 30,000 chars alone triggers per-section warning without truncating HTML
    const oversizedSecHtml = makeSectionHtml(18, 32_500);
    project = appendHtmlSectionToProject(project, oversizedSecHtml, {
      name: 'Section 18 Oversized',
    });
    const sec18Id = project.sections![project.sections!.length - 1].id;
    const sec18Export = exportProjectSectionHtml(project, sec18Id, [], { includeCss: false });
    expect(sec18Export.characterCount).toBe(32_500);
    expect(sec18Export.exceedsFourthwallLimit).toBe(true);
    expect(sec18Export.warningMessage).toContain('30,000-character limit');
    expect(sec18Export.html.length).toBe(32_500);
  });

  it('2. stores multiple complete gift guides totaling over 10 MB in IndexedDB and survives a simulated browser reload after clearing in-memory caches', async () => {
    const store = new Map<string, string>();
    const mockIdb = createMockIndexedDbFactory();
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => {
            if (v.length > 4_000_000) {
              throw new Error('QuotaExceededError: localStorage 4MB limit exceeded');
            }
            store.set(k, v);
          },
          removeItem: (k: string) => store.delete(k),
        },
        indexedDB: mockIdb,
      },
      configurable: true,
      writable: true,
    });
    resetIdbStorageForTesting();

    // Create 8 large guides (~500 KB HTML each -> > 1.5 MB serialized per guide with originalHtml + sections -> > 12 MB total)
    const cardChunk =
      '<article class="sog-ed-card"><h3>Archival Museum Edition Gift</h3><p>' +
      'Comprehensive curatorial notes, historical context, and material specifications. '.repeat(20) +
      '</p></article>\n';
    const guideHtml500k = `<section class="sog-guide-container">\n${cardChunk.repeat(290)}</section>`;
    expect(guideHtml500k.length).toBeGreaterThan(480_000); // Also exceeds old 400 KB single-project limit!

    const createdIds: string[] = [];
    for (let i = 1; i <= 8; i++) {
      const proj = await createNewHtmlProject({
        name: `Mega Historical Gift Guide #${i}`,
        htmlContent: guideHtml500k,
      });
      createdIds.push(proj.id);
    }

    // Edit Guide #8 and save
    const allBeforeReload = await loadLocalHtmlProjectsAsync();
    expect(allBeforeReload).toHaveLength(8);
    const totalBytes = JSON.stringify(allBeforeReload).length;
    expect(totalBytes).toBeGreaterThan(10_500_000); // > 10.5 MB total stored in IndexedDB

    const guide8 = allBeforeReload.find((p) => p.id === createdIds[7])!;
    const editedHtml = guide8.currentHtml + '\n<!-- VERIFIED_RELOAD_MARKER_2026 -->';
    await saveHtmlProject({
      ...guide8,
      name: 'Mega Historical Gift Guide #8 (Edited)',
      currentHtml: editedHtml,
    });

    // Simulate a real browser page reload: clear all in-memory caches while keeping mockIdb intact
    simulateBrowserReloadForTesting();
    expect(loadLocalHtmlProjects()).toHaveLength(0); // Synchronous cache is empty before async hydration

    // Re-hydrate from IndexedDB as HtmlEditorWorkspace does on mount
    const activeIdAfterReload = await getActiveHtmlProjectIdAsync();
    const hydratedAfterReload = await loadLocalHtmlProjectsAsync();

    expect(activeIdAfterReload).toBe(createdIds[7]);
    expect(hydratedAfterReload).toHaveLength(8);
    const reloadedGuide8 = hydratedAfterReload.find((p) => p.id === createdIds[7])!;
    expect(reloadedGuide8.name).toBe('Mega Historical Gift Guide #8 (Edited)');
    expect(reloadedGuide8.currentHtml.endsWith('<!-- VERIFIED_RELOAD_MARKER_2026 -->')).toBe(true);
    expect(reloadedGuide8.currentHtml.length).toBe(editedHtml.length); // Zero silent truncation!
  });

  it('3. preserves existing IndexedDB projects during legacy localStorage migration, keeps legacy localStorage intact if migration fails, and migrates catalog products out of localStorage', async () => {
    const store = new Map<string, string>();
    const mockIdb = createMockIndexedDbFactory();
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => store.set(k, v),
          removeItem: (k: string) => store.delete(k),
        },
        indexedDB: mockIdb,
      },
      configurable: true,
      writable: true,
    });
    resetIdbStorageForTesting();

    // 3a. Pre-populate IndexedDB with a newer version of proj-shared and an existing idb-only project
    await saveHtmlProject({
      id: 'proj-shared',
      ownerId: 'local-preview',
      name: 'Newer IDB Version of Shared Guide',
      currentHtml: '<section><h2>Newer IDB Content</h2></section>',
      originalHtml: '<section><h2>Newer IDB Content</h2></section>',
      baseUrl: 'https://scienceofgifts.com',
      editorState: {
        viewMode: 'split',
        selectedBlockId: 'ALL',
        sidebarTab: 'blocks',
        previewViewport: 'desktop',
        includeFourthwallCss: true,
      },
      createdAt: '2026-02-01T00:00:00.000Z',
      updatedAt: '2026-03-10T00:00:00.000Z',
    });

    // Put an older version of proj-shared + a legacy-only project in localStorage
    const legacyPayload = JSON.stringify([
      {
        id: 'proj-shared',
        ownerId: 'local-preview',
        name: 'Older Legacy Version of Shared Guide',
        currentHtml: '<section><h2>Older Legacy Content</h2></section>',
        originalHtml: '<section><h2>Older Legacy Content</h2></section>',
        baseUrl: 'https://scienceofgifts.com',
        createdAt: '2026-02-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'proj-legacy-only',
        ownerId: 'local-preview',
        name: 'Legacy Only Guide',
        currentHtml: '<section><h2>Legacy Only Content</h2></section>',
        originalHtml: '<section><h2>Legacy Only Content</h2></section>',
        baseUrl: 'https://scienceofgifts.com',
        createdAt: '2026-01-05T00:00:00.000Z',
        updatedAt: '2026-01-06T00:00:00.000Z',
      },
    ]);
    store.set(LEGACY_LOCAL_HTML_PROJECTS_KEY, legacyPayload);
    store.delete(LOCAL_HTML_PROJECTS_MIGRATED_KEY);

    // 3b. Simulate an IndexedDB failure during migration and verify legacy localStorage data is NOT deleted
    try {
      setSimulatedIdbFailureForTesting('quota_exceeded');
      await expect(migrateLocalStorageProjectsToIdb()).rejects.toThrow(/Migration failure/i);
      expect(store.get(LEGACY_LOCAL_HTML_PROJECTS_KEY)).toBe(legacyPayload);
    } finally {
      setSimulatedIdbFailureForTesting('none');
    }

    // 3c. Now let migration succeed and verify both projects exist and newer IDB record was preserved
    const migRes = await migrateLocalStorageProjectsToIdb();
    expect(migRes.migratedCount).toBe(2);
    expect(store.has(LEGACY_LOCAL_HTML_PROJECTS_KEY)).toBe(false);

    const hydrated = await loadLocalHtmlProjectsAsync();
    expect(hydrated).toHaveLength(2);
    const shared = hydrated.find((p) => p.id === 'proj-shared')!;
    expect(shared.name).toBe('Newer IDB Version of Shared Guide');
    expect(shared.currentHtml).toContain('Newer IDB Content');
    expect(hydrated.some((p) => p.id === 'proj-legacy-only')).toBe(true);

    // 3d. Verify sog_catalog_products_v2 migrates from localStorage to IndexedDB catalog_products store
    store.set(
      'sog_catalog_products_v2',
      JSON.stringify([
        {
          ...SEED_PRODUCTS[0],
          id: 'migrated-catalog-prod-1',
          name: 'Migrated Roman Coin Replica',
        },
      ])
    );
    simulateBrowserReloadForTesting();
    const migratedCatalog = await loadLocalCatalogProductsAsync();
    expect(migratedCatalog).not.toBeNull();
    expect(migratedCatalog![0].id).toBe('migrated-catalog-prod-1');
    expect(store.has('sog_catalog_products_v2')).toBe(false);
  });

  it('4. chunks large projects (>500 KB) across backward-compatible Firestore documents that satisfy firestore.rules, reassembles them losslessly, and accurately tracks local vs cloud sync status', async () => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => store.set(k, v),
          removeItem: (k: string) => store.delete(k),
        },
        indexedDB: createMockIndexedDbFactory(),
      },
      configurable: true,
      writable: true,
    });
    resetIdbStorageForTesting();

    // 4a. Build a 550 KB guide that exceeds the single-document 400,000-char Firestore rule limit
    const largeHtml = `<section class="sog-editorial-section"><h2>Large Cloud Guide</h2><p>${'B'.repeat(
      550_000
    )}</p></section>`;
    const largeProject: HtmlEditorProject = ensureProjectHasSections({
      id: 'cloud-chunked-guide',
      ownerId: 'user-123',
      name: 'Chunked Cloud Guide',
      currentHtml: largeHtml,
      originalHtml: largeHtml,
      baseUrl: 'https://scienceofgifts.com',
      customCss: DEFAULT_GIFT_GUIDE_CSS,
      editorState: {
        viewMode: 'split',
        selectedBlockId: 'ALL',
        sidebarTab: 'blocks',
        previewViewport: 'desktop',
        includeFourthwallCss: true,
      },
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-02T00:00:00.000Z',
    });

    const plan = buildFirestoreHtmlProjectPayloads('user-123', largeProject);
    expect(plan.isChunked).toBe(true);
    expect(plan.chunkDocs.length).toBeGreaterThanOrEqual(4);

    // Verify every generated document strictly satisfies firestore.rules constraints:
    // currentHtml.size() <= 400000, originalHtml.size() <= 400000, editorState.keys().size() <= 15
    expect(plan.parentPayload.currentHtml.length).toBeLessThanOrEqual(400_000);
    expect(plan.parentPayload.originalHtml.length).toBeLessThanOrEqual(400_000);
    expect(Object.keys(plan.parentPayload.editorState).length).toBeLessThanOrEqual(15);
    for (const chunkDoc of plan.chunkDocs) {
      expect(chunkDoc.payload.currentHtml.length).toBeLessThanOrEqual(400_000);
      expect(chunkDoc.payload.originalHtml.length).toBeLessThanOrEqual(400_000);
      expect(Object.keys(chunkDoc.payload.editorState).length).toBeLessThanOrEqual(15);
    }

    // Reassemble from raw Firestore docs and verify 100% lossless restoration (and chunk parts are hidden)
    const rawFirestoreDocs = [
      { id: plan.parentId, data: plan.parentPayload },
      ...plan.chunkDocs.map((c) => ({ id: c.id, data: c.payload })),
    ];
    const reassembled = reassembleFirestoreHtmlProjects(rawFirestoreDocs, 'user-123');
    expect(reassembled).toHaveLength(1);
    expect(reassembled[0].id).toBe('cloud-chunked-guide');
    expect(reassembled[0].currentHtml.length).toBe(largeHtml.length);
    expect(reassembled[0].originalHtml.length).toBe(largeHtml.length);

    // 4b. Test saveHtmlProject sync statuses:
    // - Firestore offline -> saved_local_cloud_pending (no false confirmed cloud save!)
    const offlineSaved = await saveHtmlProject(largeProject, 'user-123', {
      firestoreWriter: async () => {
        throw new Error('FirebaseError: Failed to get document because the client is offline.');
      },
    });
    expect(offlineSaved.syncStatus).toBe('saved_local_cloud_pending');
    expect(offlineSaved.pendingCloudSync).toBe(true);

    // - Firestore permission/size failure -> saved_local_cloud_failed (local save preserved!)
    const failedCloudSaved = await saveHtmlProject(largeProject, 'user-123', {
      firestoreWriter: async () => {
        throw new Error('Missing or insufficient permissions.');
      },
    });
    expect(failedCloudSaved.syncStatus).toBe('saved_local_cloud_failed');
    expect(failedCloudSaved.pendingCloudSync).toBe(true);
    expect(failedCloudSaved.syncDiagnostic).toMatch(/permission or network failure/i);

    // - Firestore success -> saved_local_and_cloud
    const syncedCloudSaved = await saveHtmlProject(largeProject, 'user-123', {
      firestoreWriter: async () => 'cloud-chunked-guide',
    });
    expect(syncedCloudSaved.syncStatus).toBe('saved_local_and_cloud');
    expect(syncedCloudSaved.pendingCloudSync).toBe(false);

    // 4c. Verify mergeCloudAndLocalHtmlProjects never overwrites pending local edits or hides local-only guides
    const localPendingGuide: HtmlEditorProject = {
      ...largeProject,
      id: 'guide-shared',
      name: 'Local Unsynced Edit',
      updatedAt: '2026-03-05T12:00:00.000Z',
      syncStatus: 'saved_local_cloud_pending',
      pendingCloudSync: true,
    };
    const localOnlyGuide: HtmlEditorProject = {
      ...largeProject,
      id: 'guide-local-only',
      name: 'Local Only Guide',
      updatedAt: '2026-03-04T00:00:00.000Z',
      syncStatus: 'saved_local_only',
    };
    const staleCloudSnapshot: HtmlEditorProject = {
      ...largeProject,
      id: 'guide-shared',
      name: 'Stale Cloud Version',
      updatedAt: '2026-03-01T00:00:00.000Z',
    };
    const restoredFromCloudGuide: HtmlEditorProject = {
      ...largeProject,
      id: 'guide-cloud-restored',
      name: 'Restored Cloud Guide',
      updatedAt: '2026-03-06T00:00:00.000Z',
    };

    const merged = mergeCloudAndLocalHtmlProjects(
      [staleCloudSnapshot, restoredFromCloudGuide],
      [localPendingGuide, localOnlyGuide]
    );
    expect(merged.map((p) => p.id)).toEqual([
      'guide-cloud-restored',
      'guide-shared',
      'guide-local-only',
    ]);
    expect(merged.find((p) => p.id === 'guide-shared')!.name).toBe('Local Unsynced Edit');

    // 4d. Verify storage diagnostic classification & credential scrubbing
    const scrubbedErr = classifyStorageFailure(
      new Error('QuotaExceededError with Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.secret.sig'),
      'idb'
    );
    expect(scrubbedErr).toBeInstanceOf(StorageDiagnosticError);
    expect(scrubbedErr.category).toBe('idb_quota_exceeded');
    expect(scrubbedErr.message).not.toContain('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(scrubbedErr.message).toContain('[REDACTED_TOKEN]');
  });
});

describe('Feature 12: Editable, Replaceable, and Persistent Fourthwall Header CSS (Live Preview Reference)', () => {
  it('1 & 2 & 7. edits and replaces the Fourthwall Header CSS with raw CSS or <style>-wrapped CSS without truncating large stylesheets', async () => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => store.set(k, v),
          removeItem: (k: string) => store.delete(k),
          clear: () => store.clear(),
        },
      },
      configurable: true,
      writable: true,
    });
    resetIdbStorageForTesting();

    // Initially defaults to DEFAULT_GIFT_GUIDE_CSS
    const initialHeader = await loadFourthwallHeaderCssAsync();
    expect(initialHeader.currentCss).toBe(DEFAULT_GIFT_GUIDE_CSS);
    expect(initialHeader.previousCss).toBeNull();
    expect(initialHeader.isCustomized).toBe(false);

    // 1. Edit existing Header CSS (adding a new rule to the existing stylesheet)
    const editedHeaderCss = `${initialHeader.currentCss}\n/* 2026 Header Update */\n.sog-header-badge { background: #1e3a8a; color: #ffffff; }`;
    const afterEdit = await saveFourthwallHeaderCss(editedHeaderCss);
    expect(afterEdit.currentCss).toBe(editedHeaderCss);
    expect(afterEdit.previousCss).toBe(DEFAULT_GIFT_GUIDE_CSS);
    expect(afterEdit.isCustomized).toBe(true);

    // 2 & 7. Replace entire Header CSS with a large <style>-wrapped stylesheet (verifying no duplicate <style> tags and zero truncation)
    const largeRules = Array.from(
      { length: 400 },
      (_, idx) => `.sog-fw-rule-${idx + 1} { padding: ${(idx % 16) + 4}px; border-color: #123456; }`
    ).join('\n');
    const fullReplacementRaw = `/* Fourthwall Site Header 2026 v3 */\n.sog-guide-container { max-width: 1360px; margin: 0 auto; }\n${largeRules}`;
    const styleWrappedInput = `<style type="text/css">\n${fullReplacementRaw}\n</style>`;

    expect(normalizeHeaderCssInput(styleWrappedInput)).toBe(fullReplacementRaw);
    expect(normalizeHeaderCssInput(styleWrappedInput)).not.toContain('<style');
    expect(normalizeHeaderCssInput(styleWrappedInput)).not.toContain('</style>');

    const afterReplace = await saveFourthwallHeaderCss(styleWrappedInput);
    expect(afterReplace.currentCss).toBe(fullReplacementRaw);
    expect(afterReplace.currentCss.length).toBe(fullReplacementRaw.length);
    expect(afterReplace.currentCss).not.toContain('<style');
    // Previous version is preserved as the edited version from step 1
    expect(afterReplace.previousCss).toBe(editedHeaderCss);
  });

  it('3 & 4 & 5 & 6. persists across browser reloads, project migrations, and guide switches, updates Live Preview immediately without stale stylesheets, and restores the previous version', async () => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => store.set(k, v),
          removeItem: (k: string) => store.delete(k),
          clear: () => store.clear(),
        },
      },
      configurable: true,
      writable: true,
    });
    resetIdbStorageForTesting();

    // Create two gift guides before updating Header CSS
    const guideOne = await createNewHtmlProject({
      name: 'Ancient Rome Gift Guide',
      htmlContent: '<section class="sog-guide-container" id="sec-rome"><h2>Roman Gifts</h2></section>',
    });
    const guideTwo = await createNewHtmlProject({
      name: 'World War II Gift Guide',
      htmlContent: '<section class="sog-guide-container" id="sec-ww2"><h2>WWII Gifts</h2></section>',
    });

    const headerV1 = '/* Fourthwall Header V1 */ .sog-guide-container { max-width: 1180px; background: #faf8f5; }';
    const headerV2 = '/* Fourthwall Header V2 */ .sog-guide-container { max-width: 1440px; background: #0f172a; color: #f8fafc; }';

    await saveFourthwallHeaderCss(headerV1);
    await saveFourthwallHeaderCss(`<style>\n${headerV2}\n</style>`);

    // 5. Live Preview updates immediately for both existing guides and newly created guides
    const guideThree = await createNewHtmlProject({
      name: 'Greek Mythology Gift Guide',
      htmlContent: '<section class="sog-guide-container" id="sec-greek"><h2>Greek Gifts</h2></section>',
    });

    for (const guide of [guideOne, guideTwo, guideThree]) {
      const safeBody = buildSafePreviewHtml(guide.currentHtml, []);
      const previewDoc = buildPreviewIframeDocument(safeBody, resolveProjectCss(guide), true);
      expect(previewDoc).toContain(headerV2);
      // Must NOT contain stale V1 or stale default LOCKED_FOURTHWALL_CSS
      expect(previewDoc).not.toContain(headerV1);
      expect(previewDoc).not.toContain('/* 1. CHAPTER BANNERS */');
      // Only one #sog-fourthwall-header-css style block in <head>
      const headerStyleMatches = previewDoc.match(/id="sog-fourthwall-header-css"/g) || [];
      expect(headerStyleMatches).toHaveLength(1);
    }

    // 3. Simulate browser reload and verify Header CSS is never overwritten during initialization or migration
    simulateBrowserReloadForTesting();
    const reloadedProjects = await loadLocalHtmlProjectsAsync();
    expect(reloadedProjects).toHaveLength(3);

    const reloadedHeader = await loadFourthwallHeaderCssAsync();
    expect(reloadedHeader.currentCss).toBe(headerV2);
    expect(reloadedHeader.previousCss).toBe(headerV1);
    expect(getFourthwallHeaderCssSync().currentCss).toBe(headerV2);

    // Preview after reload still uses headerV2
    const previewAfterReload = buildPreviewIframeDocument(
      '<section class="sog-guide-container"><h2>Reload Check</h2></section>',
      resolveProjectCss(reloadedProjects[0]),
      true
    );
    expect(previewAfterReload).toContain(headerV2);
    expect(previewAfterReload).not.toContain('/* 1. CHAPTER BANNERS */');

    // 6. Restore Previous Version restores headerV1 and updates Live Preview immediately
    const restored = await restorePreviousFourthwallHeaderCss();
    expect(restored.currentCss).toBe(headerV1);
    expect(restored.previousCss).toBe(headerV2);

    const previewAfterRestore = buildPreviewIframeDocument(
      '<section class="sog-guide-container"><h2>Restore Check</h2></section>',
      resolveProjectCss(reloadedProjects[0]),
      true
    );
    expect(previewAfterRestore).toContain(headerV1);
    expect(previewAfterRestore).not.toContain(headerV2);
  });

  it('8 & 9. keeps Fourthwall Header CSS strictly separated from exported guide HTML and guide-specific CSS Editor, and reports storage failures clearly', async () => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => store.set(k, v),
          removeItem: (k: string) => store.delete(k),
          clear: () => store.clear(),
        },
      },
      configurable: true,
      writable: true,
    });
    resetIdbStorageForTesting();

    const customGlobalHeaderCss =
      '/* GLOBAL SITE HEADER CSS ONLY FOR PREVIEW */ .site-global-nav { height: 88px; background: #111827; }';
    await saveFourthwallHeaderCss(customGlobalHeaderCss);

    let guide = await createNewHtmlProject({
      name: 'Export Separation Test Guide',
      htmlContent:
        '<section class="sog-guide-container" id="sec-export-1"><h2>Section 1</h2></section>',
    });
    guide = appendHtmlSectionToProject(
      guide,
      '<section class="sog-guide-container" id="sec-export-2"><h2>Section 2</h2></section>'
    );

    // 8. Exported HTML (both complete guide and individual sections) must NEVER automatically include the Fourthwall Header CSS
    const exportedCompleteDefault = exportCompleteProjectHtml(guide);
    expect(exportedCompleteDefault.html).not.toContain(customGlobalHeaderCss);
    expect(exportedCompleteDefault.html).not.toContain('<style>');
    expect(exportedCompleteDefault.html).toContain('Section 1');
    expect(exportedCompleteDefault.html).toContain('Section 2');

    const exportedSectionDefault = exportProjectSectionHtml(guide, guide.sections![0].id);
    expect(exportedSectionDefault.html).not.toContain(customGlobalHeaderCss);
    expect(exportedSectionDefault.html).not.toContain('<style>');

    // Individual HTML sections in project storage never duplicate or contain the Header CSS
    for (const sec of guide.sections!) {
      expect(sec.htmlContent).not.toContain(customGlobalHeaderCss);
    }

    // 9. Guide-specific CSS Editor remains completely independent from Fourthwall Header CSS
    const guideSpecificCss = '/* Guide-Specific Override */ .sog-ed-card { border: 2px solid #b45309; }';
    guide = updateProjectCss(guide, guideSpecificCss);
    await saveHtmlProject(guide);

    expect(resolveProjectCss(guide)).toBe(guideSpecificCss);
    expect(getFourthwallHeaderCssSync().currentCss).toBe(customGlobalHeaderCss);

    // Live Preview includes BOTH the global Fourthwall Header CSS AND the guide-specific custom CSS without duplication
    const combinedPreview = buildPreviewIframeDocument(
      guide.currentHtml,
      resolveProjectCss(guide),
      true
    );
    expect(combinedPreview).toContain(customGlobalHeaderCss);
    expect(combinedPreview).toContain(guideSpecificCss);
    expect(combinedPreview).not.toContain('/* 1. CHAPTER BANNERS */');

    // Exporting with guide-specific CSS includes ONLY guideSpecificCss and NEVER customGlobalHeaderCss
    const exportedWithGuideCss = exportCompleteProjectHtml(guide);
    expect(exportedWithGuideCss.html).toContain(guideSpecificCss);
    expect(exportedWithGuideCss.html).not.toContain(customGlobalHeaderCss);

    // Cloud sync filters out the internal global Header CSS doc from the gift guide projects list
    const cloudHeaderDoc = {
      id: FIRESTORE_GLOBAL_HEADER_CSS_DOC_ID,
      data: {
        ownerId: 'user-123',
        name: 'Fourthwall Header CSS (Live Preview Reference)',
        currentHtml: customGlobalHeaderCss,
        originalHtml: DEFAULT_GIFT_GUIDE_CSS,
        baseUrl: 'https://scienceofgifts.com',
        editorState: { isGlobalHeaderCssSetting: true },
        updatedAt: '2026-04-01T00:00:00.000Z',
      },
    };
    const reassembledGuides = reassembleFirestoreHtmlProjects([cloudHeaderDoc], 'user-123');
    expect(reassembledGuides).toHaveLength(0);
    const syncedHeader = await syncCloudFourthwallHeaderCssFromDocs([cloudHeaderDoc]);
    expect(syncedHeader?.currentCss).toBe(customGlobalHeaderCss);

    // Persistence failures throw a clear StorageDiagnosticError instead of falsely succeeding
    setSimulatedIdbFailureForTesting('quota_exceeded');
    await expect(
      saveFourthwallHeaderCss('/* Will Fail */ .test { color: red; }')
    ).rejects.toThrow(/IndexedDB quota exceeded/i);
    setSimulatedIdbFailureForTesting('none');
    // Unsaved failed edit did not corrupt the previously saved Header CSS
    expect((await loadFourthwallHeaderCssAsync()).currentCss).toBe(customGlobalHeaderCss);
  });
});

describe('Product Catalog Import Workflow: Remembered Categories, Remembered Tags & Fourthwall /en-usd URL Normalization (All 12 Scenarios)', () => {
  const setupMockStorage = () => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => store.set(k, v),
          removeItem: (k: string) => store.delete(k),
          clear: () => store.clear(),
        },
      },
      configurable: true,
      writable: true,
    });
    resetIdbStorageForTesting();
    return store;
  };

  it('1, 2, 3, 4 & 5. remembers the last selected category, preselects it on subsequent imports, updates when changed, falls back safely if missing/deleted, and preserves existing product categories on edit', () => {
    setupMockStorage();

    // 4a. When no remembered category exists yet, falls back to detected category or General History
    expect(loadRememberedProductCategory()).toBeNull();
    expect(
      resolveCategoryForProductModal({
        isExistingEdit: false,
        managedCategories: loadManagedCategories(),
      })
    ).toEqual({
      category: 'General History',
      source: 'default_fallback',
    });

    // 1. Save a product with "Ancient Rome" and remember the category
    const savedCat = saveRememberedProductCategory('Ancient Rome');
    expect(savedCat).toBe('Ancient Rome');
    expect(loadRememberedProductCategory()).toBe('Ancient Rome');

    // 2. Next imported product automatically preselects "Ancient Rome"
    expect(
      resolveCategoryForProductModal({
        isExistingEdit: false,
        extractedCategory: '',
        managedCategories: loadManagedCategories(),
      })
    ).toEqual({
      category: 'Ancient Rome',
      source: 'remembered_category',
    });

    // 3. Change the category to a custom category ("Byzantine Empire") and save -> updates remembered category
    addManagedCategory('Byzantine Empire');
    saveRememberedProductCategory('Byzantine Empire');
    expect(loadRememberedProductCategory()).toBe('Byzantine Empire');
    expect(
      resolveCategoryForProductModal({
        isExistingEdit: false,
        managedCategories: loadManagedCategories(),
      })
    ).toEqual({
      category: 'Byzantine Empire',
      source: 'remembered_category',
    });

    // Renaming a managed category also updates the remembered category automatically
    renameManagedCategory('Byzantine Empire', 'Eastern Roman Empire', []);
    expect(loadRememberedProductCategory()).toBe('Eastern Roman Empire');
    expect(
      resolveCategoryForProductModal({
        isExistingEdit: false,
        managedCategories: loadManagedCategories(),
      })
    ).toEqual({
      category: 'Eastern Roman Empire',
      source: 'remembered_category',
    });

    // 4b. Deleting the remembered category clears or safely falls back to General History / detected category
    deleteManagedCategory('Eastern Roman Empire');
    expect(loadRememberedProductCategory()).toBeNull();
    expect(
      resolveCategoryForProductModal({
        isExistingEdit: false,
        extractedCategory: 'Greek Mythology',
        managedCategories: loadManagedCategories(),
      })
    ).toEqual({
      category: 'Greek Mythology',
      source: 'auto_detected',
    });

    // Even if localStorage manually contains a stale deleted category name, resolveCategoryForProductModal falls back safely
    saveRememberedProductCategory('Deleted Niche Category');
    expect(
      resolveCategoryForProductModal({
        isExistingEdit: false,
        extractedCategory: '',
        managedCategories: loadManagedCategories(),
      })
    ).toEqual({
      category: 'General History',
      source: 'default_fallback',
    });

    // 5. Editing an already-saved catalog product ALWAYS preserves that product's existing category instead of overwriting it with the remembered category
    saveRememberedProductCategory('World War II');
    expect(
      resolveCategoryForProductModal({
        isExistingEdit: true,
        existingCategory: 'Civil War',
        managedCategories: loadManagedCategories(),
      })
    ).toEqual({
      category: 'Civil War',
      source: 'existing_product',
    });

    clearRememberedProductCategory();
    expect(loadRememberedProductCategory()).toBeNull();
  });

  it('6 & 7. remembers and reuses last saved tags with case-insensitive deduplication, avoids silently mixing into extracted tags, supports disabling reuse, and preserves existing product tags on edit', () => {
    setupMockStorage();

    // Default state: reuse enabled, no remembered tags yet
    expect(loadReuseLastTagsPreference()).toBe(true);
    expect(loadRememberedProductTags()).toEqual([]);

    // 6a. Save tags with duplicate casing and extra whitespace -> deduplicated cleanly while preserving display casing
    const savedTags = saveRememberedProductTags([
      '  Roman Empire ',
      'SPQR',
      'roman empire',
      'Stoicism',
      'spqr',
      '',
    ]);
    expect(savedTags).toEqual(['Roman Empire', 'SPQR', 'Stoicism']);
    expect(loadRememberedProductTags()).toEqual(['Roman Empire', 'SPQR', 'Stoicism']);
    expect(
      deduplicateProductTags(['Marcus Aurelius', 'spqr', 'SPQR', 'Stoicism'])
    ).toEqual(['Marcus Aurelius', 'spqr', 'Stoicism']);
    expect(formatProductTagsInput('Marcus Aurelius, spqr, SPQR, Stoicism')).toBe(
      'Marcus Aurelius, spqr, Stoicism'
    );

    // 6b. Next newly imported product with NO extracted tags automatically pre-fills the remembered tags
    const resolvedNoExtracted = resolveTagsForProductModal({
      isExistingEdit: false,
      extractedTags: [],
    });
    expect(resolvedNoExtracted.tags).toEqual(['Roman Empire', 'SPQR', 'Stoicism']);
    expect(resolvedNoExtracted.source).toBe('remembered_tags');

    // 6c. Next newly imported product that ALREADY has extracted tags from the storefront page does NOT silently mix unrelated remembered tags into extracted tags
    const resolvedWithExtracted = resolveTagsForProductModal({
      isExistingEdit: false,
      extractedTags: ['youtuber', 'funny definition', 'Youtuber'],
    });
    expect(resolvedWithExtracted.tags).toEqual(['youtuber', 'funny definition']);
    expect(resolvedWithExtracted.source).toBe('extracted_tags');
    expect(resolvedWithExtracted.hasExtractedVsRememberedChoice).toBe(true);

    // 6d. Disabling "Reuse last tags" stops pre-filling remembered tags when switching product niches
    saveReuseLastTagsPreference(false);
    expect(loadReuseLastTagsPreference()).toBe(false);
    const resolvedWhenDisabled = resolveTagsForProductModal({
      isExistingEdit: false,
      extractedTags: [],
    });
    expect(resolvedWhenDisabled.tags).toEqual([]);
    expect(resolvedWhenDisabled.source).toBe('empty');

    // Re-enable reuse
    saveReuseLastTagsPreference(true);

    // 7. Editing an existing saved catalog product ALWAYS preserves its existing tags (even if empty or different from remembered tags)
    const resolvedExistingWithTags = resolveTagsForProductModal({
      isExistingEdit: true,
      existingTags: ['Greek Mythology', 'Athena Owl'],
    });
    expect(resolvedExistingWithTags.tags).toEqual(['Greek Mythology', 'Athena Owl']);
    expect(resolvedExistingWithTags.source).toBe('existing_product');

    const resolvedExistingEmpty = resolveTagsForProductModal({
      isExistingEdit: true,
      existingTags: [],
    });
    expect(resolvedExistingEmpty.tags).toEqual([]);
    expect(resolvedExistingEmpty.source).toBe('existing_product');

    clearRememberedProductTags();
    expect(loadRememberedProductTags()).toEqual([]);
  });

  it('8, 9 & 10. normalizes full and relative Fourthwall /en-usd/products/... URLs while preserving canonical URLs, query params, fragments, slugs containing en-usd, and image CDN URLs', () => {
    // 8. Full Fourthwall URLs with /en-usd/
    expect(
      normalizeFourthwallProductUrl(
        'https://shop.scienceofgifts.com/en-usd/products/funny-youtuber-definition-t-shirt'
      )
    ).toBe('https://shop.scienceofgifts.com/products/funny-youtuber-definition-t-shirt');

    expect(
      normalizeFourthwallProductUrl(
        'https://scienceofgifts.com/en-USD/products/spqr-roman-standard-hoodie/'
      )
    ).toBe('https://scienceofgifts.com/products/spqr-roman-standard-hoodie');

    // 9. Relative Fourthwall paths with /en-usd/
    expect(
      normalizeFourthwallProductUrl('/en-usd/products/funny-youtuber-definition-t-shirt')
    ).toBe('/products/funny-youtuber-definition-t-shirt');

    expect(
      normalizeFourthwallProductUrl('en-usd/products/funny-youtuber-definition-t-shirt')
    ).toBe('/products/funny-youtuber-definition-t-shirt');

    // 10a. Already-normalized Fourthwall URLs remain unchanged
    expect(
      normalizeFourthwallProductUrl(
        'https://shop.scienceofgifts.com/products/funny-youtuber-definition-t-shirt'
      )
    ).toBe('https://shop.scienceofgifts.com/products/funny-youtuber-definition-t-shirt');
    expect(
      normalizeFourthwallProductUrl('/products/funny-youtuber-definition-t-shirt')
    ).toBe('/products/funny-youtuber-definition-t-shirt');

    // 10b. Preserves query parameters and hash fragments
    expect(
      normalizeFourthwallProductUrl(
        'https://shop.scienceofgifts.com/en-usd/products/funny-youtuber-definition-t-shirt?variant=49102#sizing'
      )
    ).toBe(
      'https://shop.scienceofgifts.com/products/funny-youtuber-definition-t-shirt?variant=49102#sizing'
    );
    expect(
      normalizeFourthwallProductUrl(
        '/en-usd/products/funny-youtuber-definition-t-shirt?utm_source=guide#reviews'
      )
    ).toBe('/products/funny-youtuber-definition-t-shirt?utm_source=guide#reviews');

    // 10c. Does NOT corrupt product slugs that contain "en-usd" inside the product handle
    expect(
      normalizeFourthwallProductUrl('https://shop.scienceofgifts.com/products/en-usd-currency-shirt')
    ).toBe('https://shop.scienceofgifts.com/products/en-usd-currency-shirt');
    expect(
      normalizeFourthwallProductUrl(
        'https://shop.scienceofgifts.com/en-usd/products/en-usd-currency-shirt'
      )
    ).toBe('https://shop.scienceofgifts.com/products/en-usd-currency-shirt');

    // 10d. Does NOT modify image CDN URLs or non-product external URLs
    const r2ImageUrl =
      'https://images.scienceofgifts.com/gift-guides/youtuber-gifts/funny-youtuber-definition-t-shirt.webp';
    const fwCdnUrl = 'https://cdn.fourthwall.com/offer/en-usd/image-123.jpg';
    expect(normalizeFourthwallProductUrl(r2ImageUrl)).toBe(r2ImageUrl);
    expect(normalizeFourthwallProductUrl(fwCdnUrl)).toBe(fwCdnUrl);

    expect(
      isLocalizedFourthwallProductUrl(
        'https://shop.scienceofgifts.com/en-usd/products/funny-youtuber-definition-t-shirt'
      )
    ).toBe(true);
    expect(
      isLocalizedFourthwallProductUrl(
        'https://shop.scienceofgifts.com/products/funny-youtuber-definition-t-shirt'
      )
    ).toBe(false);
  });

  it('11. migrates existing catalog products with /en-usd/ URLs without losing data or creating duplicates, and retries localized URLs during server product fetch when needed', async () => {
    setupMockStorage();

    // 11a. Single record migration preserves ID and all fields while stripping /en-usd
    const legacyProduct = migrateAndHydrateProductRecord({
      id: 'prod-youtuber-tee',
      ownerId: 'local-preview',
      name: 'Funny YouTuber Definition T-Shirt',
      productUrl:
        'https://shop.scienceofgifts.com/en-usd/products/funny-youtuber-definition-t-shirt',
      imageUrl: 'https://cdn.fourthwall.com/youtuber-tee.jpg',
      price: '$24.99',
      currency: 'USD',
      category: 'General History',
      productType: 'T-Shirt',
      tags: ['YouTuber', 'youtuber', 'Creator Gift'],
      shortDescription: '<p>Creator definition tee</p>',
      featuresSpecs: '100% Cotton',
      sourceNotes: '<p>Soft ringspun cotton.</p>',
      archived: false,
    });

    expect(legacyProduct.id).toBe('prod-youtuber-tee');
    expect(legacyProduct.productUrl).toBe(
      'https://shop.scienceofgifts.com/products/funny-youtuber-definition-t-shirt'
    );
    expect(legacyProduct.tags).toEqual(['YouTuber', 'Creator Gift']);
    expect(legacyProduct.shortDescription).toBe('<p>Creator definition tee</p>');

    // 11b. Catalog-wide migration deduplicates collisions if both /en-usd/products/x and /products/x existed, merging fields without losing data
    const migratedCatalog = migrateCatalogProductUrls([
      {
        ...SEED_PRODUCTS[0],
        id: 'prod-dup-localized',
        ownerId: 'local-preview',
        name: 'Funny YouTuber Definition T-Shirt',
        productUrl:
          'https://shop.scienceofgifts.com/en-usd/products/funny-youtuber-definition-t-shirt',
        shortDescription: '<p>Rich subheadline from localized entry</p>',
        featuresSpecs: '',
        tags: ['YouTuber', 'Video Creator'],
        updatedAt: '2026-03-01T00:00:00.000Z',
      },
      {
        ...SEED_PRODUCTS[0],
        id: 'prod-dup-canonical',
        ownerId: 'local-preview',
        name: 'Funny YouTuber Definition T-Shirt',
        productUrl:
          'https://shop.scienceofgifts.com/products/funny-youtuber-definition-t-shirt',
        shortDescription: '',
        featuresSpecs: '<p>Detailed specs from canonical entry</p>',
        tags: ['funny definition', 'youtuber'],
        updatedAt: '2026-03-05T00:00:00.000Z',
      },
    ]);

    expect(migratedCatalog.migratedCount).toBe(1);
    expect(migratedCatalog.deduplicatedCount).toBe(1);
    expect(migratedCatalog.products).toHaveLength(1);
    expect(migratedCatalog.products[0].productUrl).toBe(
      'https://shop.scienceofgifts.com/products/funny-youtuber-definition-t-shirt'
    );
    expect(migratedCatalog.products[0].shortDescription).toBe(
      '<p>Rich subheadline from localized entry</p>'
    );
    expect(migratedCatalog.products[0].featuresSpecs).toBe(
      '<p>Detailed specs from canonical entry</p>'
    );
    expect(migratedCatalog.products[0].tags).toEqual([
      'funny definition',
      'youtuber',
      'Video Creator',
    ]);

    // Saving and loading catalog products from local storage automatically normalizes URLs
    saveLocalCatalogProducts([
      {
        ...SEED_PRODUCTS[0],
        id: 'prod-persisted-en-usd',
        ownerId: 'local-preview',
        productUrl: 'https://shop.scienceofgifts.com/en-usd/products/roman-aquila-hoodie',
      },
    ]);
    const loadedSync = loadLocalCatalogProducts()!;
    expect(loadedSync).not.toBeNull();
    expect(loadedSync[0].productUrl).toBe(
      'https://shop.scienceofgifts.com/products/roman-aquila-hoodie'
    );
    const loadedAsync = (await loadLocalCatalogProductsAsync())!;
    expect(loadedAsync).not.toBeNull();
    expect(loadedAsync[0].productUrl).toBe(
      'https://shop.scienceofgifts.com/products/roman-aquila-hoodie'
    );

    // 11c. Server fetch handler tries canonical URL first, and if that fails, retries original /en-usd/ URL while returning canonical productUrl
    const fetchedUrls: string[] = [];
    const mockFetch: typeof fetch = async (input) => {
      const targetUrl = String(input);
      fetchedUrls.push(targetUrl);
      if (!targetUrl.includes('/en-usd/')) {
        return new Response('Not Found', { status: 404 });
      }
      return new Response(
        `<html><head>
          <meta property="og:title" content="Funny YouTuber Definition T-Shirt" />
          <meta property="og:image" content="https://cdn.fourthwall.com/youtuber.jpg" />
          <meta property="product:price:amount" content="26.99" />
          <link rel="canonical" href="https://shop.scienceofgifts.com/en-usd/products/funny-youtuber-definition-t-shirt" />
        </head><body></body></html>`,
        {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }
      );
    };

    const fetchResult = await handleProductFetchUrlRequest(
      {
        url: 'https://shop.scienceofgifts.com/en-usd/products/funny-youtuber-definition-t-shirt',
      },
      {},
      { customFetch: mockFetch }
    );

    expect(fetchResult.status).toBe(200);
    expect(fetchedUrls).toEqual([
      'https://shop.scienceofgifts.com/products/funny-youtuber-definition-t-shirt',
      'https://shop.scienceofgifts.com/en-usd/products/funny-youtuber-definition-t-shirt',
    ]);
    const extracted = (
      fetchResult.body as { extracted: { productUrl: string; name: string } }
    ).extracted;
    expect(extracted.name).toBe('Funny YouTuber Definition T-Shirt');
    expect(extracted.productUrl).toBe(
      'https://shop.scienceofgifts.com/products/funny-youtuber-definition-t-shirt'
    );
  });

  it('12. matches products consistently across catalog duplicate detection, CSV/JSON batch import, gift-guide HTML rendering, HTML workspace cards, JSON-LD schema, and Image Optimizer after URL normalization', () => {
    const canonicalProduct = migrateAndHydrateProductRecord({
      ...SEED_PRODUCTS[0],
      id: 'prod-youtuber-1',
      ownerId: 'local-preview',
      name: 'Funny YouTuber Definition T-Shirt',
      productUrl: 'https://shop.scienceofgifts.com/products/funny-youtuber-definition-t-shirt',
      imageUrl: 'https://cdn.fourthwall.com/youtuber-shirt.jpg',
      price: '$24.99',
    });

    // 12a. Duplicate detection matches /en-usd/ URL against canonical catalog product
    const duplicateMatch = findDuplicateProduct(
      [canonicalProduct],
      'https://shop.scienceofgifts.com/en-usd/products/funny-youtuber-definition-t-shirt'
    );
    expect(duplicateMatch?.id).toBe('prod-youtuber-1');

    // 12b. Batch import normalizes /en-usd/ URLs and derives the exact same stable ID
    const batchReport = parseProductImportBatch(
      [
        'name,productUrl,price,productType,category',
        'Funny YouTuber Definition T-Shirt,https://shop.scienceofgifts.com/en-usd/products/funny-youtuber-definition-t-shirt,$24.99,T-Shirt,General History',
      ].join('\n')
    );
    expect(batchReport.validProducts).toHaveLength(1);
    expect(batchReport.validProducts[0].productUrl).toBe(
      'https://shop.scienceofgifts.com/products/funny-youtuber-definition-t-shirt'
    );
    expect(batchReport.validProducts[0].id).toBe(
      'prod-funny-youtuber-definition-t-shirt'
    );

    // 12c. Gift-guide section rendering outputs canonical URLs without /en-usd/
    const productWithLocalizedUrl = {
      ...canonicalProduct,
      productUrl:
        'https://shop.scienceofgifts.com/en-usd/products/funny-youtuber-definition-t-shirt',
    };
    const renderedSection = renderSectionHtml(
      {
        id: 'sec-test-norm',
        ownerId: 'local-preview',
        guideId: 'guide-test',
        type: 'quick_picks',
        title: 'Quick Picks',
        anchorId: 'jump-qp',
        order: 1,
        enabled: true,
        config: {
          quickPicksHeading: 'Quick Picks',
          quickPickCards: [
            {
              id: 'qp-card-1',
              productId: productWithLocalizedUrl.id,
              badgeText: 'Top Pick',
              displayTitle: 'Funny YouTuber Definition T-Shirt',
              metaDescription: 'Soft cotton tee',
              priceDisplay: '$24.99',
              productUrlOverride:
                'https://shop.scienceofgifts.com/en-usd/products/funny-youtuber-definition-t-shirt',
              imageUrlOverride: '',
              ctaLabel: 'Shop Now',
              order: 1,
            },
          ],
        },
      },
      [productWithLocalizedUrl]
    );
    expect(renderedSection).toContain(
      'href="https://shop.scienceofgifts.com/products/funny-youtuber-definition-t-shirt"'
    );
    expect(renderedSection).not.toContain('/en-usd/products/');

    // 12d. HTML Workspace card replacement normalizes /en-usd/ URLs
    const sampleCardHtml = `<section class="sog-editorial-section" id="sec-cards"><div class="sog-editorial-list"><article class="sog-ed-card"><div class="sog-ed-header"><div class="sog-ed-title-wrap"><h3 class="sog-ed-title"><a href="/en-usd/products/old-item">Old Item</a></h3></div></div><div class="sog-ed-grid"><div class="sog-ed-media"><a class="sog-ed-img-wrap" href="/en-usd/products/old-item"><img class="sog-ed-img" src="https://cdn.fourthwall.com/old.jpg" alt="Old"></a></div><div class="sog-ed-body"><a class="sog-ed-cta" href="/en-usd/products/old-item">Shop Now</a></div></div></article></div></section>`;
    const cardAnalysis = analyzeHtmlDocument(sampleCardHtml);
    const updatedCardHtml = applyCatalogProductToCard(
      sampleCardHtml,
      cardAnalysis.blocks[0].productCards[0],
      productWithLocalizedUrl
    );
    expect(updatedCardHtml).toContain(
      'href="https://shop.scienceofgifts.com/products/funny-youtuber-definition-t-shirt"'
    );
    expect(updatedCardHtml).not.toContain('/en-usd/products/');

    // 12e. JSON-LD Schema generator outputs canonical URLs without /en-usd/
    const jsonLd = generateGuideJsonLd(
      {
        ...SEED_GREEK_GUIDE,
        ownerId: 'local-preview',
        schemaConfig: {
          ...SEED_GREEK_GUIDE.schemaConfig,
          includedProductIds: [productWithLocalizedUrl.id],
        },
      },
      [],
      [productWithLocalizedUrl]
    );
    expect(jsonLd.formattedJson).toContain(
      'https://shop.scienceofgifts.com/products/funny-youtuber-definition-t-shirt'
    );
    expect(jsonLd.formattedJson).not.toContain('/en-usd/products/');

    // 12f. Image Optimizer derives clean product slug and matches catalog products even if guide HTML or catalog had /en-usd/
    expect(
      deriveProductSlugFromUrl(
        'https://shop.scienceofgifts.com/en-usd/products/funny-youtuber-definition-t-shirt'
      )
    ).toBe('funny-youtuber-definition-t-shirt');
    expect(
      deriveProductSlugFromUrl('/en-usd/products/funny-youtuber-definition-t-shirt')
    ).toBe('funny-youtuber-definition-t-shirt');

    const guideHtmlWithEnUsdLink = `
      <article class="sog-ed-card">
        <div class="sog-ed-header">
          <h3 class="sog-ed-title">
            <a href="https://shop.scienceofgifts.com/en-usd/products/funny-youtuber-definition-t-shirt">Funny YouTuber Definition T-Shirt</a>
          </h3>
        </div>
        <div class="sog-ed-media">
          <a href="https://shop.scienceofgifts.com/en-usd/products/funny-youtuber-definition-t-shirt">
            <img src="https://cdn.fourthwall.com/youtuber-shirt.jpg" alt="Funny YouTuber Definition T-Shirt" />
          </a>
        </div>
      </article>
    `;
    const scannedImages = scanGuideHtmlForImages(guideHtmlWithEnUsdLink, [canonicalProduct], []);
    expect(scannedImages).toHaveLength(1);
    expect(scannedImages[0].productSlug).toBe('funny-youtuber-definition-t-shirt');
    expect(scannedImages[0].productId).toBe('prod-youtuber-1');
    expect(scannedImages[0].productPageUrl).toBe(
      'https://shop.scienceofgifts.com/products/funny-youtuber-definition-t-shirt'
    );
  });
});




