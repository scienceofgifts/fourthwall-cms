/**
 * The complete locked CSS stylesheet from the Handover Document.
 * Used exclusively inside the Live Preview container to faithfully render
 * the Fourthwall storefront styles without modifying or exporting the CSS.
 */
export const LOCKED_FOURTHWALL_CSS = `
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
`;
