export type SectionType =
  | 'bookmarks'
  | 'quick_picks'
  | 'editors_pick'
  | 'editorial_list'
  | 'more_gifts_grid'
  | 'category_hub'
  | 'buying_guide'
  | 'faq_grid';

export interface ProductVariant {
  id: string;
  title: string;
  price?: string;
  originalPrice?: string;
  sku?: string;
  available?: boolean;
  options?: Record<string, string>;
}

export interface Product {
  id: string;
  ownerId: string;
  name: string;
  productUrl: string;
  imageUrl: string;
  imageUrls?: string[];
  price: string;
  originalPrice?: string;
  currency: string;
  productType: string;
  category: string;
  sku?: string;
  tags: string[];
  shortDescription: string;
  featuresSpecs: string;
  sourceNotes: string;
  variants?: ProductVariant[];
  lastFetchedAt?: string;
  dataSource?: 'json_ld' | 'open_graph' | 'html_meta' | 'ai_fallback' | 'manual' | 'csv_import' | 'seed';
  fetchStatus?: 'success' | 'partial' | 'failed' | 'manual';
  archived: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface BookmarkEntry {
  id: string;
  prefixIcon: string;
  label: string;
  anchorTarget: string;
  order: number;
  enabled: boolean;
}

export interface QuickPickCardConfig {
  id: string;
  productId: string;
  badgeText: string;
  displayTitle: string;
  metaDescription: string;
  priceDisplay: string;
  productUrlOverride: string;
  imageUrlOverride: string;
  ctaLabel: string;
  order: number;
}

export interface EditorsPickConfig {
  productId: string;
  kicker: string;
  heading: string;
  description: string;
  priceDisplay: string;
  ctaLabel: string;
  productUrlOverride: string;
  imageUrlOverride: string;
}

export interface EditorialCardItemConfig {
  id: string;
  productId: string;
  rankNumber: string; // e.g., "#01" or "01"
  superlativeBadge: string; // e.g., "Best Overall Hoodie"
  eyebrowCategory: string; // e.g., "HEAVYWEIGHT STREETWEAR"
  priceDisplay: string;
  priceNote: string; // e.g., "Unisex S–3XL"
  displayTitle: string;
  dek: string;
  editorialCopy: string; // Multiple paragraphs separated by \n\n
  specsCallout: string; // Verified specs lines separated by \n
  tagsText: string; // e.g., "Best for: Hades fans, dark academia, classics majors"
  ctaLabel: string;
  productUrlOverride: string;
  imageUrlOverride: string;
  order: number;
}

export interface MoreGiftsCardConfig {
  id: string;
  productId: string;
  displayTitle: string;
  description: string;
  priceDisplay: string;
  ctaLabel: string;
  productUrlOverride: string;
  imageUrlOverride: string;
  order: number;
}

export interface MoreGiftsGridBlock {
  id: string;
  heading: string;
  subtitle: string;
  items: MoreGiftsCardConfig[];
}

export interface CategoryHubLink {
  id: string;
  productId: string;
  label: string;
  urlOverride: string;
}

export interface CategoryHubCardConfig {
  id: string;
  cardAnchorId: string; // e.g., "jump-zeus"
  categoryName: string; // e.g., "Zeus: King of Olympus"
  subtitle: string; // e.g., "Lightning • Eagle • Storm Clouds"
  thumbnailProductId: string;
  thumbnailUrlOverride: string;
  thumbnailAlt: string;
  description: string;
  links: CategoryHubLink[];
  order: number;
}

export interface BuyingGuidePillar {
  id: string;
  numberLabel: string; // e.g., "01 / MATCH THE ARCHETYPE"
  heading: string;
  bodyHtml: string; // Supports safe inline links <a>, <strong>, <em>
  order: number;
}

export interface BuyingGuideConfig {
  kicker: string;
  title: string;
  introHtml: string;
  pillars: BuyingGuidePillar[];
}

export interface FAQItem {
  id: string;
  badge: string; // e.g., "Q01"
  question: string;
  answerHtml: string; // Supports safe inline links <a>, <strong>, <em>
  order: number;
}

export interface SectionConfigMap {
  // For 'bookmarks'
  tocTitle?: string;
  bookmarks?: BookmarkEntry[];

  // For 'quick_picks'
  quickPicksHeading?: string;
  quickPickCards?: QuickPickCardConfig[];

  // For 'editors_pick'
  editorsPick?: EditorsPickConfig;

  // For 'editorial_list'
  chapterKicker?: string;
  chapterTitle?: string;
  sectionIntro?: string;
  editorialItems?: EditorialCardItemConfig[];
  attachedMoreGrids?: MoreGiftsGridBlock[];

  // For 'more_gifts_grid'
  moreGridHeading?: string;
  moreGridSubtitle?: string;
  moreGridItems?: MoreGiftsCardConfig[];

  // For 'category_hub'
  hubHeading?: string;
  hubIntroHtml?: string;
  categoryCards?: CategoryHubCardConfig[];

  // For 'buying_guide'
  buyingGuide?: BuyingGuideConfig;
  includeFaqsInSection?: boolean; // Reference template combines Buying Guide & FAQs in #jump-faq when desired
  faqHeaderTitle?: string;
  faqHeaderSubtitle?: string;
  faqItems?: FAQItem[];
}

export interface GuideSection {
  id: string;
  ownerId: string;
  guideId: string;
  type: SectionType;
  title: string;
  anchorId: string;
  order: number;
  enabled: boolean;
  config: SectionConfigMap;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface BreadcrumbConfigItem {
  id: string;
  name: string;
  url: string;
}

export interface SchemaConfig {
  siteBaseUrl: string;
  breadcrumbs: BreadcrumbConfigItem[];
  itemListName: string;
  itemListDescription: string;
  includedProductIds: string[];
}

export interface GiftGuide {
  id: string;
  ownerId: string;
  title: string;
  topic: string;
  audience: string;
  slug: string;
  canonicalUrl: string;
  storeBaseUrl: string;
  collectionUrl: string;
  introText: string;
  sectionCount: number;
  productCount: number;
  schemaConfig: SchemaConfig;
  schemaVersion: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface UserSettings {
  ownerId: string;
  displayName: string;
  defaultStoreBaseUrl: string;
  schemaVersion: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ProjectBackup {
  backupFormat: 'science-of-gifts-cms-v1';
  exportedAt: string;
  guide: Omit<GiftGuide, 'ownerId' | 'createdAt' | 'updatedAt'>;
  sections: Array<Omit<GuideSection, 'ownerId' | 'createdAt' | 'updatedAt'>>;
  products: Array<Omit<Product, 'ownerId' | 'createdAt' | 'updatedAt'>>;
}

export interface ValidationIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  sectionId?: string;
  field?: string;
}

export type HtmlSectionCategory =
  | 'toc'
  | 'quick_picks'
  | 'editors_pick'
  | 'editorial_list'
  | 'product_grid'
  | 'single_product_card'
  | 'category_hub'
  | 'buying_guide'
  | 'faq_section'
  | 'related_guides'
  | 'content_section'
  | 'raw_fallback';

export interface HtmlProjectSection {
  id: string;
  name: string;
  order: number;
  htmlContent: string;
  originalHtml: string;
  type: HtmlSectionCategory;
  manualType?: HtmlSectionCategory;
  startingProductNumber?: number;
  createdAt: string;
  updatedAt: string;
}

export interface HtmlProjectEditorState {
  viewMode: 'split' | 'visual' | 'raw' | 'preview';
  selectedBlockId: string;
  sidebarTab?: 'blocks' | 'anchors';
  previewViewport: 'desktop' | 'mobile';
  includeFourthwallCss: boolean;
  sectionStartingNumbers?: Record<string, number>;
  sections?: HtmlProjectSection[];
}

export interface HtmlEditorProject {
  id: string;
  ownerId: string;
  name: string;
  currentHtml: string;
  originalHtml: string;
  baseUrl: string;
  editorState: HtmlProjectEditorState;
  sections?: HtmlProjectSection[];
  createdAt: string;
  updatedAt: string;
}


