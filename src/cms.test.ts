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
} from './services/htmlWorkspaceEngine';
import {
  createNewHtmlProject,
  deleteHtmlProject,
  duplicateHtmlProject,
  getActiveLocalHtmlProjectId,
  isOfflineOrTokenServiceError,
  loadLocalCatalogProducts,
  loadLocalHtmlProjects,
  renameHtmlProject,
  saveHtmlProject,
  saveLocalCatalogProducts,
  validateHtmlProjectForSave,
  validateUserAuthToken,
} from './services/firebase';
import {
  INITIAL_PRODUCT_CATEGORIES,
  MANAGED_PRODUCT_TYPES,
  addManagedCategory,
  detectProductType,
  getUncatalogedProductCategories,
  loadManagedCategories,
  migrateAndHydrateProductRecord,
  renameManagedCategory,
} from './services/productCatalogTaxonomy';
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
  handleProductParseHtmlRequest,
} from './services/serverApiHandlers';
import { handleWorkerRequest } from '../workers';
import { GiftGuide, GuideSection, HtmlEditorProject, Product } from './types/cms';

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

  it('4. surfaces an actionable error and never falsely succeeds when saving fails (quota or validation error)', async () => {
    const failingStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError: Persistent storage limit reached');
      },
      removeItem: () => {},
    };
    Object.defineProperty(globalThis, 'window', {
      value: { localStorage: failingStorage },
      configurable: true,
      writable: true,
    });

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

    await expect(saveHtmlProject(validProj)).rejects.toThrow(
      /Failed to persist project to browser storage/
    );

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




