import {
  BuyingGuideConfig,
  FAQItem,
  GiftGuide,
  GuideSection,
  MoreGiftsCardConfig,
  Product,
  ValidationIssue,
} from '../types/cms';
import { buildEditorialSvgDataUri } from '../data/greekMythologySeed';

/**
 * Escapes plain text for safe insertion into HTML text nodes and attribute values.
 */
export function escapeHtml(str: string | undefined | null): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Sanitizes rich inline HTML (used in FAQ answers, Buying Guide pillars, and Hub intros)
 * by stripping <script>, <iframe>, <object>, <embed>, and inline event handlers (on*)
 * while preserving safe editorial markup (<a>, <strong>, <em>, <b>, <i>, <br>, <span>).
 */
export function sanitizeEditorialHtml(rawHtml: string | undefined | null): string {
  if (!rawHtml) return '';
  return String(rawHtml)
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<(iframe|object|embed|style|form|input|button)[^>]*>.*?<\/\1>/gis, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript\s*:/gi, '');
}

/**
 * Resolves a product by ID from a map or array.
 */
function findProduct(productsMap: Map<string, Product>, productId: string): Product | undefined {
  return productsMap.get(productId);
}

/**
 * Builds the <img> tag attributes for Fourthwall compatibility.
 * - In Export mode (`forPreview = false`), outputs `data-product-url="..."` and only adds `src="..."`
 *   if an explicit `imageUrl` exists. Never injects preview SVG data URIs into exported HTML.
 * - In Preview mode (`forPreview = true`), if no `imageUrl` is provided, supplies a deterministic
 *   editorial SVG illustration in `src` so the Live Preview renders a visual card.
 */
function renderProductImgAttributes(
  productUrl: string,
  imageUrl: string,
  altText: string,
  cssClass: string,
  forPreview: boolean,
  categoryHint = 'Editorial Pick',
  lazy = false
): string {
  const safeUrl = escapeHtml(productUrl);
  const safeAlt = escapeHtml(altText);
  const resolvedSrc = imageUrl?.trim()
    ? escapeHtml(imageUrl.trim())
    : forPreview
    ? escapeHtml(buildEditorialSvgDataUri(altText || 'Featured Gift', categoryHint))
    : '';

  const parts: string[] = [];
  if (resolvedSrc) {
    parts.push(`src="${resolvedSrc}"`);
  }
  parts.push(`data-product-url="${safeUrl}"`);
  parts.push(`alt="${safeAlt}"`);
  parts.push(`class="${cssClass}"`);
  if (lazy) {
    parts.push('loading="lazy"');
  }
  return parts.join(' ');
}

function renderMoreGiftsCardsHtml(
  items: MoreGiftsCardConfig[],
  productsMap: Map<string, Product>,
  forPreview: boolean
): string {
  const sorted = [...items].sort((a, b) => a.order - b.order);
  return sorted
    .map((item) => {
      const product = findProduct(productsMap, item.productId);
      const url = (item.productUrlOverride || product?.productUrl || '#').trim();
      const img = (item.imageUrlOverride || product?.imageUrl || '').trim();
      const title = (item.displayTitle || product?.name || 'Untitled Product').trim();
      const desc = (item.description || product?.shortDescription || '').trim();
      const price = (item.priceDisplay || product?.price || '').trim();
      const cta = (item.ctaLabel || 'View Gift →').trim();
      const category = product?.category || 'Gift Guide';

      return `      <div class="sog-card">
        <a href="${escapeHtml(url)}" class="sog-card-img-link">
          <img ${renderProductImgAttributes(url, img, title, 'sog-card-img', forPreview, category)} />
        </a>
        <div class="sog-card-body">
          <h3 class="sog-card-title">
            <a href="${escapeHtml(url)}">${escapeHtml(title)}</a>
          </h3>
          <p class="sog-card-desc">${escapeHtml(desc)}</p>
          <div class="sog-card-footer">
            <span class="sog-card-price">${escapeHtml(price)}</span>
            <a href="${escapeHtml(url)}" class="sog-card-cta">${escapeHtml(cta)}</a>
          </div>
        </div>
      </div>`;
    })
    .join('\n');
}

function renderBuyingGuideInnerHtml(bg: BuyingGuideConfig): string {
  const sortedPillars = [...(bg.pillars || [])].sort((a, b) => a.order - b.order);
  const pillarsHtml = sortedPillars
    .map(
      (pillar) => `      <div class="sog-bg-pillar">
        <span class="sog-bg-num">${escapeHtml(pillar.numberLabel)}</span>
        <h3>${escapeHtml(pillar.heading)}</h3>
        <p>${sanitizeEditorialHtml(pillar.bodyHtml)}</p>
      </div>`
    )
    .join('\n');

  return `  <div class="sog-buying-guide">
    <div class="sog-bg-header">
      <span class="sog-bg-kicker">${escapeHtml(bg.kicker)}</span>
      <h2 class="sog-bg-title">${escapeHtml(bg.title)}</h2>
      <p class="sog-bg-intro">${sanitizeEditorialHtml(bg.introHtml)}</p>
    </div>
    <div class="sog-bg-pillars">
${pillarsHtml}
    </div>
  </div>`;
}

function renderFaqGridInnerHtml(
  headerTitle: string,
  headerSubtitle: string,
  faqItems: FAQItem[]
): string {
  const sortedFaqs = [...(faqItems || [])].sort((a, b) => a.order - b.order);
  const cardsHtml = sortedFaqs
    .map((faq, idx) => {
      const badge = faq.badge || `Q${String(idx + 1).padStart(2, '0')}`;
      return `    <article class="sog-faq-card">
      <div class="sog-faq-q-wrap"><span class="sog-faq-badge">${escapeHtml(badge)}</span><h3 class="sog-faq-question-title">${escapeHtml(faq.question)}</h3></div>
      <p class="sog-faq-answer-text">${sanitizeEditorialHtml(faq.answerHtml)}</p>
    </article>`;
    })
    .join('\n');

  return `  <div class="sog-faq-header">
    <h2>${escapeHtml(headerTitle)}</h2>
    <p>${escapeHtml(headerSubtitle)}</p>
  </div>
  <div class="sog-faq-grid">
${cardsHtml}
  </div>`;
}

export interface RenderOptions {
  forPreview?: boolean;
}

/**
 * Deterministically renders a single GuideSection into clean Fourthwall-compatible HTML.
 */
export function renderSectionHtml(
  section: GuideSection,
  products: Product[],
  options: RenderOptions = {}
): string {
  const forPreview = Boolean(options.forPreview);
  const productsMap = new Map<string, Product>(products.map((p) => [p.id, p]));
  const anchorId = escapeHtml(section.anchorId || `jump-${section.id}`);
  const cfg = section.config || {};

  switch (section.type) {
    case 'bookmarks': {
      const tocTitle = cfg.tocTitle || section.title || '📖 In This Gift Guide — Quick Bookmarks';
      const entries = [...(cfg.bookmarks || [])]
        .filter((b) => b.enabled)
        .sort((a, b) => a.order - b.order);

      const listItems = entries
        .map((entry) => {
          const prefix = entry.prefixIcon ? `${entry.prefixIcon.trim()} ` : '';
          const href = entry.anchorTarget.startsWith('#')
            ? entry.anchorTarget
            : `#${entry.anchorTarget}`;
          return `    <li><a href="${escapeHtml(href)}" class="sog-toc-link"><span>${escapeHtml(prefix + entry.label)}</span><span>↓</span></a></li>`;
        })
        .join('\n');

      return `<nav id="${anchorId}" class="sog-toc-box" aria-label="Table of Contents">
  <p class="sog-toc-title">${escapeHtml(tocTitle)}</p>
  <ul class="sog-toc-grid">
${listItems}
  </ul>
</nav>`;
    }

    case 'quick_picks': {
      const heading = cfg.quickPicksHeading || section.title || '⚡ Quick Picks';
      const cards = [...(cfg.quickPickCards || [])].sort((a, b) => a.order - b.order);
      const cardsHtml = cards
        .map((card) => {
          const product = findProduct(productsMap, card.productId);
          const url = (card.productUrlOverride || product?.productUrl || '#').trim();
          const img = (card.imageUrlOverride || product?.imageUrl || '').trim();
          const title = (card.displayTitle || product?.name || 'Untitled Product').trim();
          const badge = (card.badgeText || 'Top Pick').trim();
          const meta = (card.metaDescription || product?.shortDescription || '').trim();
          const price = (card.priceDisplay || product?.price || '').trim();
          const cta = (card.ctaLabel || 'Shop Gift →').trim();
          const category = product?.category || badge;

          const metaLine =
            meta && price
              ? `${escapeHtml(meta)} • <strong>${escapeHtml(price)}</strong>`
              : price
              ? `<strong>${escapeHtml(price)}</strong>`
              : escapeHtml(meta);

          return `    <div class="sog-qp-card">
      <span class="sog-qp-badge">${escapeHtml(badge)}</span>
      <a href="${escapeHtml(url)}">
        <img ${renderProductImgAttributes(url, img, title, 'sog-qp-img', forPreview, category)} />
      </a>
      <h3 class="sog-qp-title">
        <a href="${escapeHtml(url)}">${escapeHtml(title)}</a>
      </h3>
      <p class="sog-qp-meta">${metaLine}</p>
      <a href="${escapeHtml(url)}" class="sog-qp-btn">${escapeHtml(cta)}</a>
    </div>`;
        })
        .join('\n');

      return `<section id="${anchorId}" class="sog-quick-picks" aria-label="Quick Picks">
  <h2 class="sog-qp-heading">${escapeHtml(heading)}</h2>
  <div class="sog-qp-grid">
${cardsHtml}
  </div>
</section>`;
    }

    case 'editors_pick': {
      const ep = cfg.editorsPick;
      const product = ep?.productId ? findProduct(productsMap, ep.productId) : undefined;
      const url = (ep?.productUrlOverride || product?.productUrl || '#').trim();
      const img = (ep?.imageUrlOverride || product?.imageUrl || '').trim();
      const kicker = (ep?.kicker || '🏆 Our #1 Pick').trim();
      const heading = (ep?.heading || product?.name || section.title).trim();
      const desc = (ep?.description || product?.shortDescription || '').trim();
      const price = (ep?.priceDisplay || product?.price || '').trim();
      const cta = (ep?.ctaLabel || 'Shop Our #1 Pick →').trim();

      return `<section id="${anchorId}" class="sog-editor-pick" aria-label="Editor's Pick">
  <div class="sog-ep-img-wrap">
    <a href="${escapeHtml(url)}">
      <img ${renderProductImgAttributes(url, img, heading, 'sog-ep-img', forPreview, "Editor's Pick")} />
    </a>
  </div>
  <div class="sog-ep-content">
    <span class="sog-ep-kicker">${escapeHtml(kicker)}</span>
    <h2 class="sog-ep-title">
      <a href="${escapeHtml(url)}">${escapeHtml(heading)}</a>
    </h2>
    <p class="sog-ep-desc">
      ${escapeHtml(desc)}
    </p>
    <div class="sog-ep-footer">
      <span class="sog-ep-price">${escapeHtml(price)}</span>
      <a href="${escapeHtml(url)}" class="sog-ep-cta">${escapeHtml(cta)}</a>
    </div>
  </div>
</section>`;
    }

    case 'editorial_list': {
      const chapterKicker = (cfg.chapterKicker || '').trim();
      const chapterTitle = (cfg.chapterTitle || section.title).trim();
      const sectionIntro = (cfg.sectionIntro || '').trim();
      const items = [...(cfg.editorialItems || [])].sort((a, b) => a.order - b.order);

      const cardsHtml = items
        .map((item, idx) => {
          const product = findProduct(productsMap, item.productId);
          const url = (item.productUrlOverride || product?.productUrl || '#').trim();
          const img = (item.imageUrlOverride || product?.imageUrl || '').trim();
          const title = (item.displayTitle || product?.name || 'Untitled Product').trim();
          const numBadge = (item.rankNumber || `#${String(idx + 1).padStart(2, '0')}`).trim();
          const superlative = (item.superlativeBadge || 'Featured Pick').trim();
          const eyebrowCategory = (item.eyebrowCategory || product?.productType || product?.category || '').trim();
          const price = (item.priceDisplay || product?.price || '').trim();
          const priceNote = (item.priceNote || '').trim();
          const dek = (item.dek || product?.shortDescription || '').trim();
          const rawCopy = (item.editorialCopy || '').trim();
          const paragraphs = rawCopy
            ? rawCopy
                .split(/\n\s*\n/)
                .map((p) => p.trim())
                .filter(Boolean)
            : [];
          const copyHtml = paragraphs.map((p) => `          <p>${escapeHtml(p)}</p>`).join('\n');

          const rawSpecs = (item.specsCallout || product?.featuresSpecs || '').trim();
          const specLines = rawSpecs
            ? rawSpecs
                .split(/\n/)
                .map((s) => s.trim())
                .filter(Boolean)
            : [];
          const specsBlock =
            specLines.length > 0
              ? `        <div class="sog-ed-specs">\n${specLines
                  .map((line) => `          <p>${escapeHtml(line)}</p>`)
                  .join('\n')}\n        </div>\n`
              : '';

          const tagsText =
            (item.tagsText || '').trim() ||
            (product?.tags?.length ? `Tags: ${product.tags.join(' • ')}` : '');
          const cta = (item.ctaLabel || 'Shop Gift →').trim();

          return `    <article class="sog-ed-card">
      <div class="sog-ed-media">
        <a href="${escapeHtml(url)}" class="sog-ed-img-link">
          <span class="sog-ed-num">${escapeHtml(numBadge)}</span>
          <img ${renderProductImgAttributes(url, img, title, 'sog-ed-img', forPreview, eyebrowCategory || superlative)} />
        </a>
      </div>
      <div class="sog-ed-content">
        <div class="sog-ed-eyebrow">
          <span class="sog-ed-superlative">${escapeHtml(superlative)}</span>${
            eyebrowCategory
              ? `\n          <span class="sog-ed-dot">•</span>\n          <span>${escapeHtml(eyebrowCategory)}</span>`
              : ''
          }
        </div>
        <div class="sog-ed-price-top">${escapeHtml(price)}${
            priceNote ? ` <span>• ${escapeHtml(priceNote)}</span>` : ''
          }</div>
        <h3 class="sog-ed-title">
          <a href="${escapeHtml(url)}">${escapeHtml(title)}</a>
        </h3>
        <p class="sog-ed-dek">${escapeHtml(dek)}</p>
        <div class="sog-ed-copy">
${copyHtml}
        </div>
${specsBlock}        <div class="sog-ed-footer">
          <span class="sog-ed-tags">${escapeHtml(tagsText)}</span>
          <a href="${escapeHtml(url)}" class="sog-ed-cta">${escapeHtml(cta)}</a>
        </div>
      </div>
    </article>`;
        })
        .join('\n');

      const attachedGrids = cfg.attachedMoreGrids || [];
      const moreGridsHtml = attachedGrids
        .map((grid) => {
          const gridCards = renderMoreGiftsCardsHtml(grid.items || [], productsMap, forPreview);
          return `  <div class="sog-more-section">
    <h3>${escapeHtml(grid.heading)}</h3>
    ${grid.subtitle ? `<p>${escapeHtml(grid.subtitle)}</p>` : ''}
    <div class="sog-card-grid">
${gridCards}
    </div>
  </div>`;
        })
        .join('\n');

      return `<section id="${anchorId}" aria-label="${escapeHtml(chapterTitle)}">
  <div class="sog-chapter-banner">
    ${chapterKicker ? `<span class="sog-chapter-kicker">${escapeHtml(chapterKicker)}</span>\n    ` : ''}<h2 class="sog-chapter-title">${escapeHtml(chapterTitle)}</h2>
  </div>
  ${sectionIntro ? `<p>${escapeHtml(sectionIntro)}</p>\n` : ''}  <div class="sog-editorial-list">
${cardsHtml}
  </div>${moreGridsHtml ? `\n${moreGridsHtml}` : ''}
</section>`;
    }

    case 'more_gifts_grid': {
      const heading = (cfg.moreGridHeading || section.title).trim();
      const subtitle = (cfg.moreGridSubtitle || '').trim();
      const cardsHtml = renderMoreGiftsCardsHtml(cfg.moreGridItems || [], productsMap, forPreview);

      return `<section id="${anchorId}" class="sog-more-section" aria-label="${escapeHtml(heading)}">
  <h2>${escapeHtml(heading)}</h2>
  ${subtitle ? `<p>${escapeHtml(subtitle)}</p>\n` : ''}  <div class="sog-card-grid">
${cardsHtml}
  </div>
</section>`;
    }

    case 'category_hub': {
      const heading = (cfg.hubHeading || section.title || 'Find Gifts by Category').trim();
      const introHtml = sanitizeEditorialHtml(cfg.hubIntroHtml || '');
      const cards = [...(cfg.categoryCards || [])].sort((a, b) => a.order - b.order);

      const cardsHtml = cards
        .map((card) => {
          const thumbProduct = card.thumbnailProductId
            ? findProduct(productsMap, card.thumbnailProductId)
            : undefined;
          const thumbProductUrl = (
            card.thumbnailUrlOverride ||
            thumbProduct?.productUrl ||
            card.links?.[0]?.urlOverride ||
            findProduct(productsMap, card.links?.[0]?.productId || '')?.productUrl ||
            '#'
          ).trim();
          const thumbImgUrl = (thumbProduct?.imageUrl || '').trim();
          const thumbAlt = (card.thumbnailAlt || `${card.categoryName} gifts`).trim();

          const chipsHtml = (card.links || [])
            .map((lnk) => {
              const linkedProd = findProduct(productsMap, lnk.productId);
              const href = (lnk.urlOverride || linkedProd?.productUrl || '#').trim();
              const label = (lnk.label || linkedProd?.name || 'View Gift').trim();
              return `          <a href="${escapeHtml(href)}" class="sog-deity-chip">${escapeHtml(label)}</a>`;
            })
            .join('\n');

          return `    <div class="sog-deity-card"${
            card.cardAnchorId ? ` id="${escapeHtml(card.cardAnchorId)}"` : ''
          }>
      <div class="sog-deity-top">
        <img ${renderProductImgAttributes(
          thumbProductUrl,
          thumbImgUrl,
          thumbAlt,
          'sog-deity-thumb',
          forPreview,
          card.categoryName,
          true
        )} />
        <div>
          <h3>${escapeHtml(card.categoryName)}</h3>
          <p class="sog-deity-sub">${escapeHtml(card.subtitle)}</p>
        </div>
      </div>
      <div class="sog-deity-body">
        <p>${escapeHtml(card.description)}</p>
        <div class="sog-deity-links">
${chipsHtml}
        </div>
      </div>
    </div>`;
        })
        .join('\n');

      return `<section id="${anchorId}">
  <h2>${escapeHtml(heading)}</h2>
  ${introHtml ? `<p>${introHtml}</p>\n` : ''}  <div class="sog-deity-grid">
${cardsHtml}
  </div>
</section>`;
    }

    case 'buying_guide': {
      const bg = cfg.buyingGuide || {
        kicker: '🧭 Buying Guide',
        title: section.title,
        introHtml: '',
        pillars: [],
      };
      const buyingGuideMarkup = renderBuyingGuideInnerHtml(bg);
      const includeFaqs = Boolean(cfg.includeFaqsInSection && (cfg.faqItems?.length || 0) > 0);
      const faqMarkup = includeFaqs
        ? '\n\n' +
          renderFaqGridInnerHtml(
            cfg.faqHeaderTitle || 'Frequently Asked Questions',
            cfg.faqHeaderSubtitle || '',
            cfg.faqItems || []
          )
        : '';

      return `<section id="${anchorId}" class="sog-guide-faq-section" aria-label="Buying Guide and Frequently Asked Questions">
${buyingGuideMarkup}${faqMarkup}
</section>`;
    }

    case 'faq_grid': {
      const faqMarkup = renderFaqGridInnerHtml(
        cfg.faqHeaderTitle || section.title || 'Frequently Asked Questions',
        cfg.faqHeaderSubtitle || '',
        cfg.faqItems || []
      );
      return `<section id="${anchorId}" class="sog-guide-faq-section" aria-label="Frequently Asked Questions">
${faqMarkup}
</section>`;
    }

    default:
      return '';
  }
}

/**
 * Renders the full gift guide HTML by combining all enabled sections in order.
 */
export function renderFullGuideHtml(
  sections: GuideSection[],
  products: Product[],
  options: RenderOptions = {}
): string {
  const enabledSections = [...sections]
    .filter((s) => s.enabled)
    .sort((a, b) => a.order - b.order);

  return enabledSections
    .map((sec) => renderSectionHtml(sec, products, options))
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Extracts all canonical FAQ items across the guide so the HTML renderer
 * and the JSON-LD FAQPage generator always use the exact same saved questions and answers.
 */
export function extractCanonicalFaqsFromSections(sections: GuideSection[]): FAQItem[] {
  const enabled = [...sections].filter((s) => s.enabled).sort((a, b) => a.order - b.order);
  const allFaqs: FAQItem[] = [];
  for (const sec of enabled) {
    if (sec.type === 'faq_grid' && sec.config.faqItems?.length) {
      allFaqs.push(...sec.config.faqItems);
    } else if (
      sec.type === 'buying_guide' &&
      sec.config.includeFaqsInSection &&
      sec.config.faqItems?.length
    ) {
      allFaqs.push(...sec.config.faqItems);
    }
  }
  return allFaqs;
}

/**
 * Validates sections and product references before HTML export.
 */
export function validateGuideForExport(
  _guide: GiftGuide,
  sections: GuideSection[],
  products: Product[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const enabledSections = [...sections].filter((s) => s.enabled).sort((a, b) => a.order - b.order);
  const productsMap = new Map(products.map((p) => [p.id, p]));

  // 1. Check duplicate section anchor IDs
  const seenAnchors = new Map<string, string>();
  for (const sec of enabledSections) {
    const anchor = (sec.anchorId || '').trim();
    if (!anchor) {
      issues.push({
        severity: 'error',
        code: 'MISSING_ANCHOR_ID',
        message: `Section "${sec.title}" is missing an HTML anchor ID.`,
        sectionId: sec.id,
      });
    } else if (seenAnchors.has(anchor)) {
      issues.push({
        severity: 'error',
        code: 'DUPLICATE_ANCHOR_ID',
        message: `Duplicate section anchor ID "#${anchor}" found on "${sec.title}" and "${seenAnchors.get(anchor)}".`,
        sectionId: sec.id,
      });
    } else {
      seenAnchors.set(anchor, sec.title);
    }

    // Also register category card sub-anchors (e.g., #jump-zeus)
    if (sec.type === 'category_hub' && sec.config.categoryCards) {
      for (const card of sec.config.categoryCards) {
        if (card.cardAnchorId) {
          if (seenAnchors.has(card.cardAnchorId)) {
            issues.push({
              severity: 'error',
              code: 'DUPLICATE_CARD_ANCHOR_ID',
              message: `Duplicate category card anchor ID "#${card.cardAnchorId}" in "${sec.title}".`,
              sectionId: sec.id,
            });
          } else {
            seenAnchors.set(card.cardAnchorId, `${sec.title} (${card.categoryName})`);
          }
        }
      }
    }
  }

  // 2. Check Quick Bookmarks targets against enabled anchors
  for (const sec of enabledSections) {
    if (sec.type === 'bookmarks') {
      const bookmarks = (sec.config.bookmarks || []).filter((b) => b.enabled);
      const seenTargets = new Set<string>();
      for (const bm of bookmarks) {
        const cleanTarget = bm.anchorTarget.replace(/^#/, '').trim();
        if (!cleanTarget) {
          issues.push({
            severity: 'error',
            code: 'EMPTY_BOOKMARK_TARGET',
            message: `Bookmark "${bm.label}" has an empty destination anchor.`,
            sectionId: sec.id,
          });
          continue;
        }
        if (seenTargets.has(cleanTarget)) {
          issues.push({
            severity: 'warning',
            code: 'DUPLICATE_BOOKMARK_TARGET',
            message: `Bookmark destination "#${cleanTarget}" is linked more than once in Quick Bookmarks.`,
            sectionId: sec.id,
          });
        }
        seenTargets.add(cleanTarget);

        if (!seenAnchors.has(cleanTarget)) {
          issues.push({
            severity: 'warning',
            code: 'UNRESOLVED_BOOKMARK_TARGET',
            message: `Bookmark "${bm.label}" points to "#${cleanTarget}", which does not match any enabled section anchor ID.`,
            sectionId: sec.id,
          });
        }
      }
    }

    // 3. Check product references in Quick Picks and Editorial Lists
    if (sec.type === 'quick_picks') {
      for (const card of sec.config.quickPickCards || []) {
        const prod = productsMap.get(card.productId);
        const url = card.productUrlOverride || prod?.productUrl;
        if (!url) {
          issues.push({
            severity: 'error',
            code: 'MISSING_PRODUCT_URL',
            message: `Quick Pick card "${card.displayTitle || card.badgeText}" is missing a valid product URL.`,
            sectionId: sec.id,
          });
        }
      }
    }

    if (sec.type === 'editorial_list') {
      for (const item of sec.config.editorialItems || []) {
        const prod = productsMap.get(item.productId);
        const url = item.productUrlOverride || prod?.productUrl;
        if (!url) {
          issues.push({
            severity: 'error',
            code: 'MISSING_EDITORIAL_PRODUCT_URL',
            message: `Editorial card "${item.displayTitle || item.rankNumber}" in "${sec.title}" is missing a product URL.`,
            sectionId: sec.id,
          });
        }
      }
    }
  }

  return issues;
}
