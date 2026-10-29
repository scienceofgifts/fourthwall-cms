Here is the complete handover document. You can copy and paste this entire block directly into your new chat to instantly catch the next AI up to speed and begin building your AI Studio CMS prompt.

# Handover Document: Fourthwall Gift Guide Layout & AI Studio CMS

## 1. Project Context & Objectives

- **Current State:** We have successfully designed an editorial magazine-style gift guide (modeled after Wirecutter/The Strategist) for a Fourthwall static page. The layout uses semantic HTML, no-JS open FAQs, a sticky-image editorial product card design optimized for 150+ word SEO copy, and a unified `@graph` JSON-LD schema.
    
- **Next Objective:** Build a "Template Engine" CMS inside Google AI Studio.
    
- **Target Workflow:** Since scraping dynamic e-commerce pages directly via AI is prone to errors, the proposed AI Studio workflow is a two-step pipeline:
    
    1. **The Roster (Data Input):** The user provides a raw list/CSV of product links, names, and prices from Fourthwall.
        
    2. **The Template Engine (Code Output):** The AI Studio prompt acts as a CMS, mapping the raw data into the exact HTML nodes of our locked CSS/HTML templates (generating the 14-item editorial list and the 3-column "More" grids) with SEO-optimized filler copy that the user can tweak later.
        

## 2. The Master Codebase (Locked Design)

### A. The Unified CSS (Sanitized)

This includes all breakpoints, the sticky 310px editorial cards, chapter banners, the visual deity hub, and the open 2-column FAQ grid.

HTML

<style>
  html { scroll-behavior: smooth; }
  [id^="jump-"] { scroll-margin-top: 90px; }

  /* 1. TOC BOX */
  .sog-toc-box { margin: 1.75rem 0 2.25rem 0; padding: 1.35rem 1.5rem; background: #fafafa; border: 1px solid rgba(0, 0, 0, 0.09); border-left: 4px solid #111; border-radius: 8px; }
  .sog-toc-title { margin: 0 0 0.85rem 0; font-size: 0.85rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #555; }
  .sog-toc-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.55rem 2rem; list-style: none; padding: 0; margin: 0; }
  .sog-toc-link { display: flex; align-items: center; justify-content: space-between; font-size: 0.94rem; font-weight: 600; color: #111 !important; text-decoration: none; padding: 0.35rem 0; border-bottom: 1px dashed rgba(0, 0, 0, 0.1); transition: padding-left 0.15s ease, color 0.15s ease; }
  .sog-toc-link:hover { padding-left: 6px; color: #b38f22 !important; }

  /* 2. QUICK PICKS */
  .sog-quick-picks { margin: 2rem 0 2.5rem 0; padding: 1.35rem; background: #fcfaf5; border: 1px solid #e6dec8; border-radius: 12px; }
  .sog-qp-heading { margin: 0 0 1rem 0; font-size: 1.25rem; font-weight: 700; }
  .sog-qp-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; }
  .sog-qp-card { background: #fff; border: 1px solid rgba(0, 0, 0, 0.08); border-radius: 8px; padding: 0.85rem; display: flex; flex-direction: column; }
  .sog-qp-badge { display: inline-block; align-self: flex-start; font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; background: #111; color: #fff; padding: 0.22rem 0.55rem; border-radius: 4px; margin-bottom: 0.6rem; }
  .sog-qp-img { width: 100%; aspect-ratio: 1 / 1; object-fit: cover; border-radius: 6px; margin-bottom: 0.6rem; background: #f4f4f4; }
  .sog-qp-title { font-size: 0.94rem; font-weight: 700; margin: 0 0 0.25rem 0; line-height: 1.3; }
  .sog-qp-title a { color: #111; text-decoration: none; }
  .sog-qp-meta { font-size: 0.82rem; color: #555; margin: 0 0 0.75rem 0; flex-grow: 1; }
  .sog-qp-btn { display: block; text-align: center; font-size: 0.8rem; font-weight: 600; padding: 0.45rem; background: #111; color: #fff !important; border-radius: 5px; text-decoration: none; transition: opacity 0.15s ease; }
  .sog-qp-btn:hover { opacity: 0.85; }

  /* 3. EDITOR'S PICK SPOTLIGHT */
  .sog-editor-pick { display: grid; grid-template-columns: 260px 1fr; gap: 1.75rem; align-items: center; margin: 2.5rem 0 3rem 0; padding: 1.5rem; background: #141414; color: #fff; border-radius: 12px; border: 1px solid #d4af37; }
  .sog-ep-img-wrap { aspect-ratio: 1 / 1; border-radius: 8px; overflow: hidden; background: #222; }
  .sog-ep-img { width: 100%; height: 100%; object-fit: cover; }
  .sog-ep-kicker { display: inline-block; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #111; background: #d4af37; padding: 0.25rem 0.65rem; border-radius: 4px; margin-bottom: 0.65rem; }
  .sog-ep-title { margin: 0 0 0.6rem 0; font-size: 1.35rem; font-weight: 700; }
  .sog-ep-title a { color: #fff !important; text-decoration: none; }
  .sog-ep-desc { margin: 0 0 1.15rem 0; font-size: 0.95rem; line-height: 1.6; color: #d8d8d8; }
  .sog-ep-footer { display: flex; align-items: center; gap: 1rem; }
  .sog-ep-price { font-size: 1.2rem; font-weight: 700; color: #d4af37; }
  .sog-ep-cta { display: inline-block; padding: 0.6rem 1.2rem; background: #d4af37; color: #111 !important; font-weight: 700; font-size: 0.9rem; border-radius: 6px; text-decoration: none; }

  /* 4. CHAPTER BANNERS */
  .sog-chapter-banner { margin: 3.25rem 0 1.75rem 0; padding: 0.95rem 1.25rem; background: #f4f4f4; border-left: 4px solid #d4af37; border-radius: 0 8px 8px 0; }
  .sog-chapter-kicker { display: block; font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #666; }
  .sog-chapter-title { margin: 0.15rem 0 0 0; font-size: 1.3rem; font-weight: 700; }

  /* 5. EDITORIAL LONG-FORM CARDS (AI STUDIO TEMPLATE TARGET) */
  .sog-editorial-list { display: flex; flex-direction: column; gap: 2.25rem; margin: 1.75rem 0 2.75rem 0; }
  .sog-ed-card { display: grid; grid-template-columns: 310px 1fr; gap: 2.25rem; padding: 1.85rem; background: #ffffff; border: 1px solid rgba(0, 0, 0, 0.09); border-radius: 16px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.03); align-items: start; }
  .sog-ed-media { position: sticky; top: 100px; }
  .sog-ed-img-link { display: block; position: relative; aspect-ratio: 1 / 1; border-radius: 12px; overflow: hidden; background: #f4f4f4; border: 1px solid rgba(0, 0, 0, 0.06); }
  .sog-ed-img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.25s ease; }
  .sog-ed-img-link:hover .sog-ed-img { transform: scale(1.03); }
  .sog-ed-num { position: absolute; top: 12px; left: 12px; background: #111; color: #d4af37; font-size: 0.78rem; font-weight: 800; letter-spacing: 0.04em; padding: 0.3rem 0.65rem; border-radius: 6px; z-index: 2; }
  .sog-ed-content { display: flex; flex-direction: column; }
  .sog-ed-eyebrow { display: flex; flex-wrap: wrap; align-items: center; gap: 0.45rem; font-size: 0.76rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #555; margin-bottom: 0.4rem; }
  .sog-ed-superlative { color: #111; background: #f3ebd3; padding: 0.2rem 0.55rem; border-radius: 4px; }
  .sog-ed-dot { color: #ccc; }
  .sog-ed-price-top { font-size: 1.15rem; font-weight: 800; color: #111; margin: 0.15rem 0 0.4rem 0; }
  .sog-ed-price-top span { font-size: 0.78rem; font-weight: 600; color: #777; }
  .sog-ed-title { font-size: 1.45rem; font-weight: 800; line-height: 1.25; margin: 0 0 0.45rem 0; }
  .sog-ed-title a { color: #111 !important; text-decoration: none; }
  .sog-ed-title a:hover { color: #b38f22 !important; }
  .sog-ed-dek { font-size: 0.96rem; font-weight: 500; color: #4a5568; line-height: 1.5; margin: 0 0 1rem 0; }
  .sog-ed-copy { font-size: 0.95rem; line-height: 1.68; color: #2d3748; margin-bottom: 0.85rem; }
  .sog-ed-copy p { margin: 0 0 0.85rem 0; }
  .sog-ed-specs { font-size: 0.88rem; line-height: 1.55; color: #333; background: #fafafa; padding: 0.75rem 1rem; border-radius: 8px; border-left: 3px solid #d4af37; margin-bottom: 1.1rem; }
  .sog-ed-specs p { margin: 0 0 0.35rem 0; }
  .sog-ed-footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem; padding-top: 1rem; border-top: 1px solid rgba(0, 0, 0, 0.08); }
  .sog-ed-tags { font-size: 0.8rem; color: #666; }
  .sog-ed-cta { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.65rem 1.35rem; background: #111; color: #fff !important; font-size: 0.88rem; font-weight: 700; border-radius: 999px; text-decoration: none; transition: background 0.15s ease, transform 0.15s ease; }
  .sog-ed-cta:hover { background: #b38f22; color: #111 !important; transform: translateY(-1px); }

  /* 6. SECONDARY "MORE GIFTS" 3-COLUMN GRIDS */
  .sog-more-section { margin: 2.5rem 0 3.5rem 0; padding-top: 1.5rem; border-top: 1px solid rgba(0, 0, 0, 0.08); }
  .sog-card-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.35rem; margin-top: 1.25rem; }
  .sog-card { display: flex; flex-direction: column; background: #fafafa; border: 1px solid rgba(0, 0, 0, 0.08); border-radius: 10px; overflow: hidden; }
  .sog-card-img-link { display: block; aspect-ratio: 1 / 1; background: #f0f0f0; overflow: hidden; }
  .sog-card-img { width: 100%; height: 100%; object-fit: cover; }
  .sog-card-body { display: flex; flex-direction: column; flex-grow: 1; padding: 1.1rem; }
  .sog-card-title { margin: 0 0 0.45rem 0; font-size: 1.02rem; font-weight: 700; }
  .sog-card-title a { color: #111; text-decoration: none; }
  .sog-card-desc { margin: 0 0 1rem 0; font-size: 0.88rem; line-height: 1.55; color: #444; flex-grow: 1; }
  .sog-card-footer { display: flex; align-items: center; justify-content: space-between; padding-top: 0.75rem; border-top: 1px solid rgba(0, 0, 0, 0.06); }
  .sog-card-price { font-weight: 700; font-size: 0.98rem; }
  .sog-card-cta { padding: 0.4rem 0.8rem; font-size: 0.82rem; font-weight: 600; background: #111; color: #fff !important; border-radius: 6px; text-decoration: none; }

  /* 7. VISUAL DEITY HUB */
  .sog-deity-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1.5rem; margin: 1.5rem 0 2.5rem 0; }
  .sog-deity-card { display: flex; flex-direction: column; background: #fafafa; border: 1px solid rgba(0, 0, 0, 0.08); border-radius: 12px; overflow: hidden; }
  .sog-deity-top { display: flex; align-items: center; gap: 1rem; padding: 1.25rem 1.25rem 0.75rem 1.25rem; }
  .sog-deity-thumb { width: 72px; height: 72px; border-radius: 10px; object-fit: cover; background: #eee; flex-shrink: 0; border: 1px solid rgba(0, 0, 0, 0.1); }
  .sog-deity-card h3 { margin: 0 0 0.2rem 0; font-size: 1.15rem; font-weight: 700; }
  .sog-deity-sub { font-size: 0.8rem; color: #666; margin: 0; }
  .sog-deity-body { padding: 0 1.25rem 1.25rem 1.25rem; display: flex; flex-direction: column; flex-grow: 1; }
  .sog-deity-body p { font-size: 0.92rem; line-height: 1.55; color: #333; margin: 0 0 1rem 0; flex-grow: 1; }
  .sog-deity-links { display: flex; flex-wrap: wrap; gap: 0.4rem; padding-top: 0.75rem; border-top: 1px solid rgba(0, 0, 0, 0.06); }
  .sog-deity-chip { font-size: 0.78rem; font-weight: 600; padding: 0.3rem 0.6rem; background: #fff; border: 1px solid rgba(0, 0, 0, 0.14); border-radius: 6px; color: #111 !important; text-decoration: none; }
  .sog-deity-chip:hover { background: #111; color: #fff !important; }

  /* 8. EDITORIAL BUYING GUIDE & OPEN FAQ GRID */
  .sog-guide-faq-section { margin: 3.5rem 0 3rem 0; }
  .sog-buying-guide { background: #141414; color: #fff; border: 1px solid #d4af37; border-radius: 16px; padding: 2rem; margin-bottom: 2.5rem; }
  .sog-bg-header { max-width: 680px; margin-bottom: 1.5rem; }
  .sog-bg-kicker { display: inline-block; font-size: 0.74rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #111; background: #d4af37; padding: 0.25rem 0.65rem; border-radius: 4px; margin-bottom: 0.6rem; }
  .sog-bg-title { margin: 0 0 0.5rem 0; font-size: 1.5rem; font-weight: 800; color: #fff !important; }
  .sog-bg-intro { margin: 0; font-size: 0.95rem; line-height: 1.6; color: #d8d8d8; }
  .sog-bg-pillars { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.25rem; }
  .sog-bg-pillar { background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(212, 175, 55, 0.28); border-radius: 12px; padding: 1.25rem; }
  .sog-bg-num { display: block; font-size: 0.78rem; font-weight: 800; letter-spacing: 0.06em; color: #d4af37; margin-bottom: 0.35rem; }
  .sog-bg-pillar h3 { margin: 0 0 0.5rem 0; font-size: 1.05rem; font-weight: 700; color: #fff !important; }
  .sog-bg-pillar p { margin: 0; font-size: 0.88rem; line-height: 1.6; color: #ccc; }
  .sog-bg-pillar a { color: #d4af37 !important; text-decoration: underline; font-weight: 600; }
  
  .sog-faq-header { margin-bottom: 1.25rem; }
  .sog-faq-header h2 { margin: 0 0 0.35rem 0; font-size: 1.45rem; font-weight: 800; }
  .sog-faq-header p { margin: 0; font-size: 0.94rem; color: #555; }
  .sog-faq-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1.25rem; }
  .sog-faq-card { background: #fafafa; border: 1px solid rgba(0, 0, 0, 0.08); border-top: 3px solid #d4af37; border-radius: 12px; padding: 1.35rem; display: flex; flex-direction: column; }
  .sog-faq-q-wrap { display: flex; align-items: baseline; gap: 0.6rem; margin-bottom: 0.55rem; }
  .sog-faq-badge { font-size: 0.72rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; background: #111; color: #d4af37; padding: 0.18rem 0.48rem; border-radius: 4px; flex-shrink: 0; }
  .sog-faq-question-title { margin: 0; font-size: 1.02rem; font-weight: 700; line-height: 1.35; color: #111; }
  .sog-faq-answer-text { margin: 0; font-size: 0.91rem; line-height: 1.65; color: #333; }
  .sog-faq-answer-text a { color: #111 !important; font-weight: 600; text-decoration: underline; text-decoration-color: #d4af37; text-underline-offset: 3px; }

  /* RESPONSIVE BREAKPOINTS */
  @media (max-width: 860px) {
    .sog-qp-grid { grid-template-columns: repeat(2, 1fr); }
    .sog-card-grid { grid-template-columns: repeat(2, 1fr); }
    .sog-editor-pick { grid-template-columns: 1fr; }
    .sog-ep-img-wrap { max-width: 240px; }
    .sog-ed-card { grid-template-columns: 1fr; gap: 1.35rem; padding: 1.35rem; }
    .sog-ed-media { position: static; max-width: 300px; }
    .sog-bg-pillars, .sog-faq-grid { grid-template-columns: 1fr; }
    .sog-buying-guide { padding: 1.5rem; }
  }
  @media (max-width: 600px) {
    .sog-toc-grid, .sog-deity-grid, .sog-card-grid { grid-template-columns: 1fr; }
    .sog-qp-grid { grid-template-columns: repeat(2, 1fr); gap: 0.65rem; }
  }
</style>


### B. AI Studio Target Nodes (The HTML Template)

_Instruction to AI Studio Prompt:_ Loop through the provided CSV/Roster and inject product data into these two structural components:

<!-- 1. BOOKMARK TABLE OF CONTENTS -->
<nav class="sog-toc-box" aria-label="Table of Contents">
  <p class="sog-toc-title">📖 In This Gift Guide — Quick Bookmarks</p>
  <ul class="sog-toc-grid">
    <li><a href="#jump-quick-picks" class="sog-toc-link"><span>⚡ Quick Picks by Favorite God</span><span>↓</span></a></li>
    <li><a href="#jump-editors-pick" class="sog-toc-link"><span>🏆 Our #1 Pick: Best Overall Gift</span><span>↓</span></a></li>
    <li><a href="#jump-apparel" class="sog-toc-link"><span>👕 Part 1: Mythology Shirts &amp; Hoodies</span><span>↓</span></a></li>
    <li><a href="#jump-journals" class="sog-toc-link"><span>📓 Part 2: Illustrated Spiral Journals</span><span>↓</span></a></li>
    <li><a href="#jump-drinkware" class="sog-toc-link"><span>🥃 Part 3: Bottles, Mugs &amp; Rock Glasses</span><span>↓</span></a></li>
    <li><a href="#jump-home" class="sog-toc-link"><span>🏛️ Part 4: Blankets &amp; Laptop Sleeves</span><span>↓</span></a></li>
    <li><a href="#jump-deity-hub" class="sog-toc-link"><span>⚡ Find Gifts by Greek God</span><span>↓</span></a></li>
    <li><a href="#jump-faq" class="sog-toc-link"><span>🧭 Buying Guide &amp; FAQs</span><span>↓</span></a></li>
  </ul>
</nav>

<!-- 2. QUICK PICKS (REAL LINKS & AUTO-IMAGES) -->
<section id="jump-quick-picks" class="sog-quick-picks" aria-label="Quick Picks">
  <h2 class="sog-qp-heading">⚡ Quick Picks: Best Greek Mythology Gifts by Fan Type</h2>
  <div class="sog-qp-grid">
    <div class="sog-qp-card">
      <span class="sog-qp-badge">Best for Hades Fans</span>
      <a href="/products/hades-greek-mythology-shirt-ruler-of-the-underworld-t-shirt">
        <img data-product-url="/products/hades-greek-mythology-shirt-ruler-of-the-underworld-t-shirt" alt="Hades Ruler of the Underworld Tee" class="sog-qp-img" />
      </a>
      <h3 class="sog-qp-title">
        <a href="/products/hades-greek-mythology-shirt-ruler-of-the-underworld-t-shirt">Hades Ruler of the Underworld Tee</a>
      </h3>
      <p class="sog-qp-meta">Engraved underworld relic art • <strong>$24.90</strong></p>
      <a href="/products/hades-greek-mythology-shirt-ruler-of-the-underworld-t-shirt" class="sog-qp-btn">Shop Hades Tee →</a>
    </div>
   <div class="sog-qp-card">
      <span class="sog-qp-badge">Best for Athena Fans</span>
      <a href="/products/athena-owl-greek-mythology-rock-glass-gold-emblem">
        <img data-product-url="/products/athena-owl-greek-mythology-rock-glass-gold-emblem" alt="Athena Owl Whiskey Glass" class="sog-qp-img" />
      </a>
      <h3 class="sog-qp-title">
        <a href="/products/athena-owl-greek-mythology-rock-glass-gold-emblem">Athena Owl Whiskey Glass</a>
      </h3>
      <p class="sog-qp-meta">Best gift under $20 • <strong>$19.90</strong></p>
      <a href="/products/athena-owl-greek-mythology-rock-glass-gold-emblem" class="sog-qp-btn">Shop Whiskey Glass →</a>
    </div>
   <div class="sog-qp-card">
      <span class="sog-qp-badge">Best for Zeus Fans</span>
      <a href="/products/zeus-lightning-oversized-hoodie-greek-mythology-thunderbolt">
        <img data-product-url="/products/zeus-lightning-oversized-hoodie-greek-mythology-thunderbolt" alt="Zeus Thunderbolt Hoodie" class="sog-qp-img" />
      </a>
      <h3 class="sog-qp-title">
        <a href="/products/zeus-lightning-oversized-hoodie-greek-mythology-thunderbolt">Zeus Thunderbolt Hoodie</a>
      </h3>
      <p class="sog-qp-meta">Heavyweight 9.4 oz oversized fit • <strong>$49.90</strong></p>
      <a href="/products/zeus-lightning-oversized-hoodie-greek-mythology-thunderbolt" class="sog-qp-btn">Shop Zeus Hoodie →</a>
   </div>
   <div class="sog-qp-card">
      <span class="sog-qp-badge">Best for Poseidon Fans</span>
      <a href="/products/poseidon-trident-stainless-steel-water-bottle-greek-mythology-ocean-design">
        <img data-product-url="/products/poseidon-trident-stainless-steel-water-bottle-greek-mythology-ocean-design" alt="Poseidon Trident Bottle" class="sog-qp-img" />
      </a>
      <h3 class="sog-qp-title">
        <a href="/products/poseidon-trident-stainless-steel-water-bottle-greek-mythology-ocean-design">Poseidon Trident Bottle</a>
      </h3>
      <p class="sog-qp-meta">Teal &amp; gold stainless steel • <strong>$29.90</strong></p>
      <a href="/products/poseidon-trident-stainless-steel-water-bottle-greek-mythology-ocean-design" class="sog-qp-btn">Shop Poseidon Bottle →</a>
    </div>
  </div>
</section>

<!-- 3. OUR #1 PICK / EDITOR'S SPOTLIGHT -->
<section id="jump-editors-pick" class="sog-editor-pick" aria-label="Editor's Pick">
  <div class="sog-ep-img-wrap">
    <a href="/products/charons-ferry-transit-co-greek-mythology-sweatshirt">
      <img data-product-url="/products/charons-ferry-transit-co-greek-mythology-sweatshirt" alt="Charon's Ferry & Transit Co. Greek Mythology Sweatshirt" class="sog-ep-img" />
    </a>
  </div>
  <div class="sog-ep-content">
    <span class="sog-ep-kicker">🏆 Our Pick: Most Clever Mythology Gift</span>
    <h2 class="sog-ep-title">
      <a href="/products/charons-ferry-transit-co-greek-mythology-sweatshirt">Charon's Ferry &amp; Transit Co. Greek Mythology Sweatshirt</a>
    </h2>
    <p class="sog-ep-desc">
      Every journey needs a ferryman—this one just happens to operate on the River Styx. Turning Charon's underworld operation into a deadpan vintage transit company in cream and gold on organic combed cotton, this sweatshirt is our #1 pick for mythology fans, classics majors, and anyone whose humor leans mildly macabre.
    </p>
    <div class="sog-ep-footer">
      <span class="sog-ep-price">$39.90</span>
      <a href="/products/charons-ferry-transit-co-greek-mythology-sweatshirt" class="sog-ep-cta">Shop Our #1 Pick →</a>
    </div>
  </div>
</section>

<!-- =========================================================
     [AI STUDIO INJECTS THE 14 EDITORIAL CARDS AND 3-COLUMN "MORE" GRIDS HERE]
     ========================================================= -->

<!-- VISUAL DEITY HUB -->
<section id="jump-deity-hub">
  <h2>Find Gifts by Greek God</h2>
  <p>Sometimes the easiest way to choose a mythology gift is simply to know which Olympian they gravitate toward most—or <a href="/collections/greek-mythology"><strong>browse our complete Greek Mythology Gifts collection →</strong></a></p>
  <div class="sog-deity-grid">
    <div class="sog-deity-card" id="jump-zeus">
      <div class="sog-deity-top">
        <img data-product-url="/products/zeus-lightning-oversized-hoodie-greek-mythology-thunderbolt" alt="Zeus gifts" class="sog-deity-thumb" loading="lazy" />
        <div>
          <h3>Zeus: King of Olympus</h3>
          <p class="sog-deity-sub">Lightning • Eagle • Storm Clouds</p>
        </div>
      </div>
      <div class="sog-deity-body">
        <p>For the Zeus fan, look for golden lightning bolts, eagles, and the visual language of the sky across hoodies, journals, and drinkware.</p>
        <div class="sog-deity-links">
          <a href="/products/zeus-lightning-oversized-hoodie-greek-mythology-thunderbolt" class="sog-deity-chip">Zeus Hoodie</a>
          <a href="/products/zeus-notebook-greek-mythology-spiral-journal-with-eagle-lightning-design" class="sog-deity-chip">Zeus Journal</a>
          <a href="/products/greek-mythology-symbol-mug-minimal-trident-owl-laurel-design-in-black-gold" class="sog-deity-chip">Olympian Mug</a>
        </div>
      </div>
    </div>
    <div class="sog-deity-card" id="jump-athena">
      <div class="sog-deity-top">
        <img data-product-url="/products/athena-owl-greek-mythology-rock-glass-gold-emblem" alt="Athena gifts" class="sog-deity-thumb" loading="lazy" />
        <div>
          <h3>Athena: Wisdom &amp; Strategy</h3>
          <p class="sog-deity-sub">Wisdom Owl • Spear • Laurel Wreath</p>
        </div>
      </div>
      <div class="sog-deity-body">
        <p>Athena's gold-on-black owl, helmet, and laurel designs work especially well for readers, classics students, and strategic thinkers.</p>
        <div class="sog-deity-links">
          <a href="/products/athena-owl-greek-mythology-rock-glass-gold-emblem" class="sog-deity-chip">Athena Rock Glass</a>
          <a href="/products/athena-owl-hoodie-wisdom-war-greek-mythology-sweatshirt" class="sog-deity-chip">Athena Hoodie</a>
          <a href="/products/athena-notebook-greek-mythology-spiral-journal-with-owl-warrior-design" class="sog-deity-chip">Athena Journal</a>
        </div>
      </div>
    </div>
    <div class="sog-deity-card" id="jump-poseidon">
      <div class="sog-deity-top">
        <img data-product-url="/products/poseidon-trident-stainless-steel-water-bottle-greek-mythology-ocean-design" alt="Poseidon gifts" class="sog-deity-thumb" loading="lazy" />
        <div>
          <h3>Poseidon: Ruler of the Seas</h3>
          <p class="sog-deity-sub">Trident • Ocean Waves • Nautical Crest</p>
        </div>
      </div>
      <div class="sog-deity-body">
        <p>Start with the trident and crashing waves. Stainless steel bottles, vintage tees, and ocean journals make natural gifts for sea lovers.</p>
        <div class="sog-deity-links">
          <a href="/products/poseidon-ruler-of-the-seas-vintage-t-shirt" class="sog-deity-chip">Poseidon Vintage Tee</a>
          <a href="/products/poseidon-trident-stainless-steel-water-bottle-greek-mythology-ocean-design" class="sog-deity-chip">Poseidon Water Bottle</a>
          <a href="/products/poseidons-crest-oversized-hoodie" class="sog-deity-chip">Poseidon Crest Hoodie</a>
        </div>
      </div>
    </div>
    <div class="sog-deity-card" id="jump-hades">
      <div class="sog-deity-top">
        <img data-product-url="/products/hades-greek-mythology-shirt-ruler-of-the-underworld-t-shirt" alt="Hades gifts" class="sog-deity-thumb" loading="lazy" />
        <div>
          <h3>Hades: The Underworld</h3>
          <p class="sog-deity-sub">Bident • River Styx • Crowned Skull</p>
        </div>
      </div>
      <div class="sog-deity-body">
        <p>Where the collection gets darker: underworld engravings, Charon's ferry humor, and flame-wrapped bidents for fans who prefer an edge.</p>
        <div class="sog-deity-links">
          <a href="/products/hades-greek-mythology-shirt-ruler-of-the-underworld-t-shirt" class="sog-deity-chip">Hades Underworld Tee</a>
          <a href="/products/charons-ferry-transit-co-greek-mythology-sweatshirt" class="sog-deity-chip">Charon's Ferry Sweatshirt</a>
          <a href="/products/hades-trident-flame-hoodie-greek-mythology-streetwear-pullover" class="sog-deity-chip">Hades Flame Hoodie</a>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- BUYING GUIDE & OPEN EDITORIAL FAQS -->
<section id="jump-faq" class="sog-guide-faq-section" aria-label="Buying Guide and Frequently Asked Questions">
  <!-- PART A: EDITORIAL BUYING GUIDE -->
  <div class="sog-buying-guide">
    <div class="sog-bg-header">
      <span class="sog-bg-kicker">🧭 Buying Guide</span>
      <h2 class="sog-bg-title">How to Choose the Right Greek Mythology Gift</h2>
      <p class="sog-bg-intro">The best Greek god gifts never feel like generic souvenir-shop trinkets. Whether you are shopping for a classics major, a <em>Percy Jackson</em> or <em>Hades</em> gamer, or a lover of ancient history, use these three rules to pick a piece they will actually use.</p>
    </div>
    <div class="sog-bg-pillars">
      <div class="sog-bg-pillar">
        <span class="sog-bg-num">01 / MATCH THE ARCHETYPE</span>
        <h3>Start with Their Favorite Deity</h3>
        <p>Every Olympian attracts a distinct personality. Strategists, readers, and academics gravitate toward <strong>Athena’s wisdom owl</strong>; fans of darker aesthetics and dry humor love <strong>Hades and the Underworld</strong>; ocean lovers connect with <strong>Poseidon’s trident</strong>; and bold personalities favor <strong>Zeus’s golden thunderbolt</strong>.</p>
      </div>
      <div class="sog-bg-pillar">
        <span class="sog-bg-num">02 / FAVOR SUBTLE LORE</span>
        <h3>Skip Loud Clip-Art for Insider References</h3>
        <p>Adult mythology fans prefer designs that read like an insider nod—such as a vintage transit sweatshirt for <a href="/products/charons-ferry-transit-co-greek-mythology-sweatshirt">Charon’s River Styx Ferry</a> or an apothecary label for <a href="/products/nectar-ambrosia-olympian-superfood-can-glass">Olympian Nectar &amp; Ambrosia</a>.</p>
      </div>
      <div class="sog-bg-pillar">
        <span class="sog-bg-num">03 / THE SAFE BET</span>
        <h3>When in Doubt, Gift the Whole Pantheon</h3>
        <p>If you know they love Greek mythology but don't know which god they rank first, choose a multi-symbol piece that unites the Olympians—like the <a href="/products/greek-mythology-symbol-mug-minimal-trident-owl-laurel-design-in-black-gold">Olympian Symbol Mug</a> or <a href="/products/the-nine-muses-creative-residency-notebook">Nine Muses Notebook</a>.</p>
      </div>
    </div>
  </div>

  <!-- PART B: 8 ALWAYS-VISIBLE CRAWLABLE FAQS -->
  <div class="sog-faq-header">
    <h2>Frequently Asked Questions About Greek God Gifts</h2>
    <p>Quick answers on sizing, materials, budget picks, and matching the right Olympian to your recipient.</p>
  </div>
  <div class="sog-faq-grid">
    <article class="sog-faq-card">
      <div class="sog-faq-q-wrap"><span class="sog-faq-badge">Q01</span><h3 class="sog-faq-question-title">What makes a good Greek mythology gift for adults?</h3></div>
      <p class="sog-faq-answer-text">A great Greek mythology gift for adults pairs classical symbolism—such as Athena's owl, Poseidon's trident, or Charon's ferry—with elevated everyday items like heavyweight 9.4 oz streetwear hoodies, etched whiskey glasses, or insulated stainless steel bottles rather than novelty toys.</p>
    </article>
    <article class="sog-faq-card">
      <div class="sog-faq-q-wrap"><span class="sog-faq-badge">Q02</span><h3 class="sog-faq-question-title">Which Greek gods are the most popular for gifts?</h3></div>
      <p class="sog-faq-answer-text"><strong>Hades, Athena, Poseidon, and Zeus</strong> are the four most requested Greek gods for gifts. Hades leads among fans of dark academia and underworld lore; Athena is the top choice for readers and students; Poseidon appeals to ocean lovers; and Zeus suits fans of classic Olympian iconography.</p>
    </article>
    <article class="sog-faq-card">
      <div class="sog-faq-q-wrap"><span class="sog-faq-badge">Q03</span><h3 class="sog-faq-question-title">What if I don't know their favorite Greek god or goddess?</h3></div>
      <p class="sog-faq-answer-text">Pick a pantheon-wide design that celebrates Greek mythology as a whole. Our <a href="/products/charons-ferry-transit-co-greek-mythology-sweatshirt">Charon's Ferry Sweatshirt</a>, <a href="/products/greek-mythology-symbol-mug-minimal-trident-owl-laurel-design-in-black-gold">Olympian Symbol Mug</a>, <a href="/products/nectar-ambrosia-olympian-superfood-can-glass">Nectar &amp; Ambrosia Can Glass</a>, and <a href="/products/greek-mythology-trident-emblem-luxury-throw-midnight-black-gold">Luxury Throw Blanket</a> work for any mythology fan.</p>
    </article>
    <article class="sog-faq-card">
      <div class="sog-faq-q-wrap"><span class="sog-faq-badge">Q04</span><h3 class="sog-faq-question-title">What are the best Greek mythology gifts for readers and students?</h3></div>
      <p class="sog-faq-answer-text">For readers, writers, and classics majors, practical study companions work best. Top picks include <a href="/products/the-nine-muses-creative-residency-notebook">The Nine Muses Creative Residency Notebook</a>, the <a href="/products/athena-notebook-greek-mythology-spiral-journal-with-owl-warrior-design">Athena Owl Spiral Journal</a>, and the <a href="/products/greek-mythology-trident-lightning-laptop-sleeve-gold-medallion-design">Gold Medallion Laptop Sleeve</a>.</p>
    </article>
    <article class="sog-faq-card">
      <div class="sog-faq-q-wrap"><span class="sog-faq-badge">Q05</span><h3 class="sog-faq-question-title">Do you have Greek mythology gifts under $20 or $25?</h3></div>
      <p class="sog-faq-answer-text">Yes—several of our most popular gifts sit under $20, including the <a href="/products/athena-owl-greek-mythology-rock-glass-gold-emblem">Athena Owl Whiskey Glass ($19.90)</a>, all five <a href="#jump-journals">150-page deity spiral journals ($19.90)</a>, and the <a href="/products/greek-mythology-symbol-mug-minimal-trident-owl-laurel-design-in-black-gold">Olympian Symbol Mug ($16.90)</a>. All graphic tees are $24.90.</p>
    </article>
    <article class="sog-faq-card">
      <div class="sog-faq-q-wrap"><span class="sog-faq-badge">Q06</span><h3 class="sog-faq-question-title">How do the Greek mythology hoodies and sweatshirts fit?</h3></div>
      <p class="sog-faq-answer-text">Our Olympian hoodies are crafted from heavyweight 9.4 oz brushed fleece with a relaxed, drop-shoulder streetwear fit. The <a href="/products/charons-ferry-transit-co-greek-mythology-sweatshirt">Charon's Ferry Crewneck</a> has a classic unisex retail fit; size up one level if they prefer an oversized drape.</p>
    </article>
    <article class="sog-faq-card">
      <div class="sog-faq-q-wrap"><span class="sog-faq-badge">Q07</span><h3 class="sog-faq-question-title">What is the best gift for someone obsessed with Hades and the Underworld?</h3></div>
      <p class="sog-faq-answer-text">Start with the <a href="/products/hades-greek-mythology-shirt-ruler-of-the-underworld-t-shirt">Hades Ruler of the Underworld Tee</a> or <a href="/products/charons-ferry-transit-co-greek-mythology-sweatshirt">Charon's Ferry Sweatshirt</a>. You can also build a themed gift bundle with the <a href="/products/hades-trident-flame-hoodie-greek-mythology-streetwear-pullover">Hades Flame Hoodie</a>, <a href="/products/hades-bident-stainless-steel-water-bottle-greek-mythology-underworld-flame-design">Hades Bident Water Bottle</a>, and <a href="/products/hades-skull-journal-greek-mythology-spiral-notebook-dark-aesthetic">Hades Skull Journal</a>.</p>
    </article>
    <article class="sog-faq-card">
      <div class="sog-faq-q-wrap"><span class="sog-faq-badge">Q08</span><h3 class="sog-faq-question-title">Where can I browse all Greek mythology products in one place?</h3></div>
      <p class="sog-faq-answer-text">You can view every shirt, hoodie, journal, glass, water bottle, and home decor piece in our complete <a href="/collections/greek-mythology">Greek Mythology Gifts Collection</a>, with direct filtering by product type and price.</p>
    </article>
  </div>
</section>