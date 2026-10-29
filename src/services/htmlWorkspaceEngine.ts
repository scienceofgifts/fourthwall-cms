import {
  HtmlEditorProject,
  HtmlProjectSection,
  HtmlSectionCategory,
  Product,
} from '../types/cms';
import { buildEditorialSvgDataUri } from '../data/greekMythologySeed';
import { normalizeProductUrlForMatch } from './briefGenerator';

export interface HtmlAttr {
  name: string;
  value: string;
  quote: '"' | "'" | '';
}

export interface HtmlAstNode {
  type: 'element' | 'text' | 'comment' | 'doctype';
  path: string;
  tagName?: string;
  attrs?: HtmlAttr[];
  selfClosing?: boolean;
  voidTag?: boolean;
  content?: string;
  children?: HtmlAstNode[];
}

export interface HtmlParseResult {
  rootChildren: HtmlAstNode[];
  parseWarnings: string[];
}

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const RAW_TEXT_TAGS = new Set(['script', 'style']);

function decodeAttrEntities(val: string): string {
  return (val || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function encodeAttrEntities(val: string, quote: '"' | "'" | '' = '"'): string {
  const base = (val ?? '').replace(/&(?!(?:[a-zA-Z0-9]+|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;');
  if (quote === "'") {
    return base.replace(/'/g, '&#39;');
  }
  return base.replace(/"/g, '&quot;');
}

function decodeTextEntities(val: string): string {
  return (val || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function encodeTextEntities(val: string): string {
  return (val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function parseTagAttributes(attrString: string): HtmlAttr[] {
  const attrs: HtmlAttr[] = [];
  const regex =
    /([a-zA-Z0-9_:@.\-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(attrString)) !== null) {
    const name = match[1];
    if (!name) continue;
    if (match[2] !== undefined) {
      attrs.push({ name, value: decodeAttrEntities(match[2]), quote: '"' });
    } else if (match[3] !== undefined) {
      attrs.push({ name, value: decodeAttrEntities(match[3]), quote: "'" });
    } else if (match[4] !== undefined) {
      attrs.push({ name, value: decodeAttrEntities(match[4]), quote: '"' });
    } else {
      attrs.push({ name, value: '', quote: '' });
    }
  }
  return attrs;
}

/**
 * Quote-aware scanner for HTML opening tags `<tagName ...>` or `<tagName ... />`.
 * Avoids regex catastrophic backtracking on long attributes, `srcset`, or unquoted URLs with `/`.
 */
function scanOpeningTag(
  html: string,
  startPos: number
): {
  fullLength: number;
  tagName: string;
  attrPart: string;
  selfClosing: boolean;
} | null {
  const headMatch = html.slice(startPos).match(/^<\s*([a-zA-Z][a-zA-Z0-9\-_:]*)/);
  if (!headMatch) return null;

  const tagName = headMatch[1];
  let idx = startPos + headMatch[0].length;
  const len = html.length;

  // Next char must be whitespace, '/', or '>'
  if (idx < len && !/[\s/>]/.test(html[idx])) {
    return null;
  }

  const attrStart = idx;
  let inQuote: '"' | "'" | null = null;

  while (idx < len) {
    const ch = html[idx];
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      }
      idx++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      idx++;
      continue;
    }
    if (ch === '>') {
      let attrEnd = idx;
      let selfClosing = false;
      // Check if there is a trailing '/' outside quotes right before '>'
      let trimBack = idx - 1;
      while (trimBack >= attrStart && /\s/.test(html[trimBack])) {
        trimBack--;
      }
      if (trimBack >= attrStart && html[trimBack] === '/') {
        // Ensure '/' is either at the start of attrPart, preceded by whitespace, or preceded by a quote
        const prevCh = trimBack > attrStart ? html[trimBack - 1] : ' ';
        if (/[\s"']/.test(prevCh)) {
          selfClosing = true;
          attrEnd = trimBack;
        }
      }
      const attrPart = html.slice(attrStart, attrEnd);
      return {
        fullLength: idx - startPos + 1,
        tagName,
        attrPart,
        selfClosing,
      };
    }
    idx++;
  }

  return null;
}

function assignAstPaths(nodes: HtmlAstNode[], prefix = ''): void {
  nodes.forEach((node, idx) => {
    const currentPath = prefix ? `${prefix}.${idx}` : `${idx}`;
    node.path = currentPath;
    if (node.children && node.children.length > 0) {
      assignAstPaths(node.children, currentPath);
    }
  });
}

/**
 * Parses an arbitrary HTML fragment into a lossless AST with deterministic node paths.
 * Preserves comments, inline styles, custom attributes, scripts, and unrecognized elements.
 */
export function parseHtmlToAst(html: string): HtmlParseResult {
  const parseWarnings: string[] = [];
  const rootChildren: HtmlAstNode[] = [];
  const stack: { tagName: string; children: HtmlAstNode[] }[] = [
    { tagName: '#root', children: rootChildren },
  ];

  let pos = 0;
  const len = html.length;

  const currentChildren = () => stack[stack.length - 1].children;

  while (pos < len) {
    const ltIdx = html.indexOf('<', pos);
    if (ltIdx === -1) {
      const text = html.slice(pos);
      if (text) {
        currentChildren().push({ type: 'text', path: '', content: text });
      }
      break;
    }

    if (ltIdx > pos) {
      const text = html.slice(pos, ltIdx);
      currentChildren().push({ type: 'text', path: '', content: text });
      pos = ltIdx;
    }

    // 1. Check for HTML Comment <!-- ... -->
    if (html.startsWith('<!--', pos)) {
      const endComment = html.indexOf('-->', pos + 4);
      if (endComment === -1) {
        parseWarnings.push('Unclosed HTML comment detected; preserved to end of input.');
        currentChildren().push({
          type: 'comment',
          path: '',
          content: html.slice(pos + 4),
        });
        break;
      }
      currentChildren().push({
        type: 'comment',
        path: '',
        content: html.slice(pos + 4, endComment),
      });
      pos = endComment + 3;
      continue;
    }

    // 2. Check for DOCTYPE <!DOCTYPE ...>
    if (/^<!doctype\b/i.test(html.slice(pos, pos + 15))) {
      const gtIdx = html.indexOf('>', pos + 2);
      if (gtIdx === -1) {
        currentChildren().push({ type: 'doctype', path: '', content: html.slice(pos) });
        break;
      }
      currentChildren().push({
        type: 'doctype',
        path: '',
        content: html.slice(pos, gtIdx + 1),
      });
      pos = gtIdx + 1;
      continue;
    }

    // 3. Check for Closing Tag </tag>
    const closeMatch = html.slice(pos).match(/^<\/\s*([a-zA-Z0-9\-_:]+)\s*>/);
    if (closeMatch) {
      const closingTag = closeMatch[1].toLowerCase();
      pos += closeMatch[0].length;

      if (VOID_TAGS.has(closingTag)) {
        continue;
      }

      // Find matching open tag in stack
      let foundIdx = -1;
      for (let i = stack.length - 1; i >= 1; i--) {
        if (stack[i].tagName.toLowerCase() === closingTag) {
          foundIdx = i;
          break;
        }
      }

      if (foundIdx !== -1) {
        if (foundIdx < stack.length - 1) {
          const unclosed = stack
            .slice(foundIdx + 1)
            .map((s) => `<${s.tagName}>`)
            .join(', ');
          parseWarnings.push(
            `Auto-closed unclosed tag(s) ${unclosed} before </${closingTag}>.`
          );
        }
        stack.length = foundIdx;
      } else {
        parseWarnings.push(`Ignored stray closing tag </${closingTag}> with no matching opening tag.`);
      }
      continue;
    }

    // 4. Check for Opening Tag <tag ...>
    const openScanned = scanOpeningTag(html, pos);

    if (openScanned) {
      const rawTagName = openScanned.tagName;
      const lowerTag = rawTagName.toLowerCase();
      const attrPart = openScanned.attrPart;
      const selfClosingSlash = openScanned.selfClosing;
      const isVoid = VOID_TAGS.has(lowerTag);
      pos += openScanned.fullLength;

      const attrs = parseTagAttributes(attrPart);
      const elementNode: HtmlAstNode = {
        type: 'element',
        path: '',
        tagName: rawTagName,
        attrs,
        selfClosing: selfClosingSlash,
        voidTag: isVoid,
        children: [],
      };

      currentChildren().push(elementNode);

      if (RAW_TEXT_TAGS.has(lowerTag) && !selfClosingSlash) {
        const closeRegex = new RegExp(`</\\s*${lowerTag}\\s*>`, 'i');
        const rest = html.slice(pos);
        const closeExec = closeRegex.exec(rest);
        if (closeExec) {
          const rawContent = rest.slice(0, closeExec.index);
          if (rawContent) {
            elementNode.children!.push({
              type: 'text',
              path: '',
              content: rawContent,
            });
          }
          pos += closeExec.index + closeExec[0].length;
        } else {
          parseWarnings.push(`Unclosed <${rawTagName}> tag detected; preserved remaining content.`);
          elementNode.children!.push({
            type: 'text',
            path: '',
            content: rest,
          });
          pos = len;
        }
        continue;
      }

      if (!isVoid && !selfClosingSlash) {
        stack.push({ tagName: rawTagName, children: elementNode.children! });
      }
      continue;
    }

    // 5. Fallback if '<' is not a valid tag start (e.g., '5 < 10' in text)
    const nextLt = html.indexOf('<', pos + 1);
    const sliceEnd = nextLt === -1 ? len : nextLt;
    currentChildren().push({
      type: 'text',
      path: '',
      content: html.slice(pos, sliceEnd),
    });
    pos = sliceEnd;
  }

  if (stack.length > 1) {
    const remaining = stack
      .slice(1)
      .map((s) => `<${s.tagName}>`)
      .join(', ');
    parseWarnings.push(`Auto-closed unclosed tag(s) at end of fragment: ${remaining}.`);
  }

  assignAstPaths(rootChildren);
  return { rootChildren, parseWarnings };
}

/**
 * Serializes an AST node list back into HTML, preserving all attributes, quote styles,
 * self-closing syntax, inline styles, comments, and whitespace.
 */
export function serializeAstToHtml(nodes: HtmlAstNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === 'text') {
        return node.content || '';
      }
      if (node.type === 'comment') {
        return `<!--${node.content || ''}-->`;
      }
      if (node.type === 'doctype') {
        return node.content || '';
      }
      const tag = node.tagName || 'div';
      const lowerTag = tag.toLowerCase();
      const attrStr = (node.attrs || [])
        .map((a) => {
          if (a.quote === '') {
            return a.value ? `${a.name}="${encodeAttrEntities(a.value, '"')}"` : a.name;
          }
          const q = a.quote || '"';
          return `${a.name}=${q}${encodeAttrEntities(a.value, q)}${q}`;
        })
        .join(' ');

      const openStart = attrStr ? `<${tag} ${attrStr}` : `<${tag}`;
      if (node.voidTag) {
        return node.selfClosing ? `${openStart} />` : `${openStart}>`;
      }
      if (node.selfClosing && (!node.children || node.children.length === 0)) {
        return `${openStart} />`;
      }

      const inner = serializeAstToHtml(node.children || []);
      if (RAW_TEXT_TAGS.has(lowerTag)) {
        return `${openStart}>${inner}</${tag}>`;
      }
      return `${openStart}>${inner}</${tag}>`;
    })
    .join('');
}

/**
 * Helper to look up a node by its deterministic dot-separated path (e.g. "0.2.1").
 */
export function getNodeByPath(
  rootChildren: HtmlAstNode[],
  path: string
): HtmlAstNode | undefined {
  if (path === '' || path === '#root') {
    return {
      type: 'element',
      path: '',
      tagName: 'section',
      attrs: [],
      children: rootChildren,
    };
  }
  if (!path && path !== '0') return undefined;
  const parts = path.split('.').map(Number);
  let currentList: HtmlAstNode[] | undefined = rootChildren;
  let currentNode: HtmlAstNode | undefined;

  for (const idx of parts) {
    if (!currentList || idx < 0 || idx >= currentList.length) return undefined;
    currentNode = currentList[idx];
    currentList = currentNode.children;
  }
  return currentNode;
}

export function getAttr(node: HtmlAstNode | undefined, name: string): string {
  if (!node || !node.attrs) return '';
  const lower = name.toLowerCase();
  const found = node.attrs.find((a) => a.name.toLowerCase() === lower);
  return found ? found.value : '';
}

export function hasAttr(node: HtmlAstNode | undefined, name: string): boolean {
  if (!node || !node.attrs) return false;
  const lower = name.toLowerCase();
  return node.attrs.some((a) => a.name.toLowerCase() === lower);
}

export function setAttr(node: HtmlAstNode, name: string, value: string): void {
  if (!node.attrs) node.attrs = [];
  const lower = name.toLowerCase();
  const existing = node.attrs.find((a) => a.name.toLowerCase() === lower);
  if (existing) {
    existing.value = value;
    if (existing.quote === '') existing.quote = '"';
  } else {
    node.attrs.push({ name, value, quote: '"' });
  }
}

export function hasClass(node: HtmlAstNode | undefined, className: string): boolean {
  const cls = getAttr(node, 'class');
  if (!cls) return false;
  return cls.split(/\s+/).includes(className);
}

export function getPlainText(node: HtmlAstNode | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return decodeTextEntities(node.content || '');
  if (node.type !== 'element') return '';
  if (node.tagName?.toLowerCase() === 'br') return '\n';
  return (node.children || []).map((c) => getPlainText(c)).join('');
}

export function getInnerHtml(node: HtmlAstNode | undefined): string {
  if (!node || !node.children) return '';
  return serializeAstToHtml(node.children).trim();
}

/**
 * Sets the plain text of an element while preserving any single wrapping `<a>` child if present
 * (e.g., `<h3 class="sog-ed-title"><a href="...">Title</a></h3>`).
 */
export function setElementTextPreservingInnerLink(
  node: HtmlAstNode,
  newText: string
): void {
  const elementChildren = (node.children || []).filter((c) => c.type === 'element');
  if (
    elementChildren.length === 1 &&
    elementChildren[0].tagName?.toLowerCase() === 'a'
  ) {
    elementChildren[0].children = [
      { type: 'text', path: '', content: encodeTextEntities(newText) },
    ];
    return;
  }
  node.children = [{ type: 'text', path: '', content: encodeTextEntities(newText) }];
}

/**
 * Finds the first descendant element matching a predicate.
 */
export function findDescendant(
  node: HtmlAstNode,
  predicate: (el: HtmlAstNode) => boolean
): HtmlAstNode | undefined {
  for (const child of node.children || []) {
    if (child.type === 'element') {
      if (predicate(child)) return child;
      const found = findDescendant(child, predicate);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Finds all descendant elements matching a predicate.
 */
export function findAllDescendants(
  node: HtmlAstNode,
  predicate: (el: HtmlAstNode) => boolean
): HtmlAstNode[] {
  const results: HtmlAstNode[] = [];
  for (const child of node.children || []) {
    if (child.type === 'element') {
      if (predicate(child)) results.push(child);
      results.push(...findAllDescendants(child, predicate));
    }
  }
  return results;
}

// ============================================================================
// DYNAMIC RECOGNITION INTERFACES
// ============================================================================

export interface RecognizedProductCard {
  cardNodePath: string;
  cardVariant: 'editorial' | 'quick_pick' | 'editors_pick' | 'grid_card' | 'generic_card';
  matchedCatalogProductId?: string;
  fields: {
    rankNumber?: {
      nodePath: string;
      value: string;
      parsedNumber?: number;
      mode?: 'element' | 'title_prefix';
    };
    badge?: { nodePath: string; value: string };
    eyebrow?: { nodePath: string; value: string };
    title?: { nodePath: string; value: string; linkNodePath?: string };
    productUrl: {
      value: string;
      hrefNodePaths: string[];
      dataUrlNodePaths: string[];
    };
    image?: {
      nodePath: string;
      src: string;
      alt: string;
      dataProductUrl: string;
      loading: string;
    };
    price?: {
      nodePath: string;
      value: string;
      noteNodePath?: string;
      noteValue?: string;
    };
    dek?: { nodePath: string; value: string; htmlValue?: string };
    description?: {
      nodePath: string;
      value: string;
      htmlValue?: string;
      isParagraphContainer?: boolean;
    };
    specsCallout?: {
      nodePath: string;
      value: string;
      htmlValue?: string;
      isParagraphContainer?: boolean;
    };
    tagsText?: { nodePath: string; value: string };
    cta?: { nodePath: string; label: string; href: string };
  };
}

export interface RecognizedTocItem {
  itemNodePath: string;
  linkNodePath: string;
  label: string;
  href: string;
}

export interface RecognizedFaqItem {
  itemNodePath: string;
  badge?: { nodePath: string; value: string };
  question: { nodePath: string; value: string };
  answer: { nodePath: string; htmlValue: string; textValue: string };
}

export interface RecognizedPillarItem {
  itemNodePath: string;
  numLabel?: { nodePath: string; value: string };
  heading?: { nodePath: string; value: string };
  body?: { nodePath: string; htmlValue: string; textValue: string };
}

export interface RecognizedCategoryCard {
  cardNodePath: string;
  elementId?: string;
  title?: { nodePath: string; value: string };
  subtitle?: { nodePath: string; value: string };
  description?: { nodePath: string; value: string };
  image?: { nodePath: string; src: string; alt: string; dataProductUrl: string };
  chipsContainerPath?: string;
  chips: Array<{ nodePath: string; label: string; href: string }>;
}

export interface RecognizedTextField {
  nodePath: string;
  tagName: string;
  role: 'heading' | 'kicker' | 'paragraph' | 'list_item' | 'label';
  value: string;
  htmlValue?: string;
  hasInlineMarkup?: boolean;
}

export interface RecognizedLinkField {
  nodePath: string;
  label: string;
  href: string;
  isInternalAnchor: boolean;
}

export interface RecognizedImageField {
  nodePath: string;
  src: string;
  alt: string;
  dataProductUrl: string;
  loading: string;
}

export interface BlockNumberingInfo {
  sectionKey: string;
  isProductSection: boolean;
  isNumberedProductSection: boolean;
  hasExplicitNumbering: boolean;
  hasPartialNumbering: boolean;
  numberedCardCount: number;
  totalCardCount: number;
  detectedStartingNumber: number | null;
  warningMessage?: string;
}

export interface RecognizedBlock {
  id: string;
  sectionId?: string;
  nodePath: string;
  tagName: string;
  elementId: string;
  className: string;
  blockType: HtmlSectionCategory;
  manualType?: HtmlSectionCategory;
  label: string;
  textFields: RecognizedTextField[];
  links: RecognizedLinkField[];
  images: RecognizedImageField[];
  repeatedContainerPath?: string;
  productCards: RecognizedProductCard[];
  tocItems: RecognizedTocItem[];
  faqItems: RecognizedFaqItem[];
  pillarItems: RecognizedPillarItem[];
  categoryCards: RecognizedCategoryCard[];
  nestedBlocks?: RecognizedBlock[];
  numberingInfo?: BlockNumberingInfo;
  rawHtmlSnippet: string;
}

export interface HtmlValidationIssue {
  severity: 'error' | 'warning';
  code:
    | 'DUPLICATE_ID'
    | 'BROKEN_ANCHOR_LINK'
    | 'SCRIPT_TAG_DETECTED'
    | 'INLINE_EVENT_HANDLER'
    | 'PARSE_WARNING'
    | 'EMPTY_LINK_HREF';
  message: string;
  nodePath?: string;
  targetId?: string;
}

export interface HtmlAnalysisReport {
  originalHtml: string;
  normalizedHtml: string;
  blocks: RecognizedBlock[];
  allElementIds: Array<{ id: string; nodePath: string; tagName: string }>;
  allInternalAnchorLinks: Array<{ href: string; label: string; nodePath: string }>;
  validationIssues: HtmlValidationIssue[];
  stats: {
    blockCount: number;
    productCardCount: number;
    matchedCatalogCount: number;
    faqCount: number;
    headingCount: number;
    linkCount: number;
    imageCount: number;
  };
}

/**
 * Inspects a product card element and extracts ONLY the fields that actually exist in its DOM.
 * Never invents missing elements (e.g. if there is no price element, `fields.price` is undefined).
 */
function analyzeProductCardNode(
  cardNode: HtmlAstNode,
  variant: RecognizedProductCard['cardVariant'],
  catalogProducts: Product[]
): RecognizedProductCard {
  const fields: RecognizedProductCard['fields'] = {
    productUrl: {
      value: '',
      hrefNodePaths: [],
      dataUrlNodePaths: [],
    },
  };

  // 1. Image & data-product-url
  const imgNode = findDescendant(cardNode, (el) => el.tagName?.toLowerCase() === 'img');
  if (imgNode) {
    const dataUrl = getAttr(imgNode, 'data-product-url');
    fields.image = {
      nodePath: imgNode.path,
      src: getAttr(imgNode, 'src'),
      alt: getAttr(imgNode, 'alt'),
      dataProductUrl: dataUrl,
      loading: getAttr(imgNode, 'loading'),
    };
    if (dataUrl) {
      fields.productUrl.dataUrlNodePaths.push(imgNode.path);
      if (!fields.productUrl.value) fields.productUrl.value = dataUrl;
    }
  }

  // 2. Rank / Product Number element (.sog-ed-num, .product-number, data-product-number, etc.)
  const isDedicatedRankElement = (el: HtmlAstNode): boolean => {
    if (
      hasClass(el, 'sog-ed-num') ||
      hasClass(el, 'sog-qp-num') ||
      hasClass(el, 'sog-card-num') ||
      hasClass(el, 'sog-rank') ||
      hasClass(el, 'product-number') ||
      hasClass(el, 'product-num') ||
      hasClass(el, 'item-number') ||
      hasClass(el, 'item-num') ||
      hasClass(el, 'card-number') ||
      hasClass(el, 'card-num') ||
      hasClass(el, 'rank-number') ||
      hasClass(el, 'rank-num') ||
      hasClass(el, 'rank-badge') ||
      hasClass(el, 'rank') ||
      hasClass(el, 'num-badge')
    ) {
      return true;
    }
    if (
      el !== cardNode &&
      (hasAttr(el, 'data-product-number') ||
        hasAttr(el, 'data-rank') ||
        hasAttr(el, 'data-item-number'))
    ) {
      return true;
    }
    return false;
  };

  let rankNode = findDescendant(cardNode, isDedicatedRankElement);
  if (!rankNode) {
    // Fallback check for a small standalone rank badge element whose text is purely a rank token (e.g. "#01", "1.", "No. 1", "Pick #1")
    rankNode = findDescendant(cardNode, (el) => {
      const tag = (el.tagName || '').toLowerCase();
      if (!['span', 'div', 'strong', 'b'].includes(tag)) return false;
      if ((el.children || []).some((c) => c.type === 'element')) return false;
      if (
        hasClass(el, 'sog-qp-badge') ||
        hasClass(el, 'sog-ed-superlative') ||
        hasClass(el, 'sog-ep-kicker') ||
        hasClass(el, 'price') ||
        hasClass(el, 'sog-ed-price') ||
        hasClass(el, 'sog-ed-price-top')
      ) {
        return false;
      }
      const txt = getPlainText(el).trim();
      return /^(?:#\s*0*[1-9]\d*|0*[1-9]\d*\.|No\.?\s*0*[1-9]\d*|Pick\s*#?\s*0*[1-9]\d*)$/i.test(
        txt
      );
    });
  }

  if (rankNode) {
    const rawRankText = getPlainText(rankNode).trim();
    const attrNumStr =
      getAttr(rankNode, 'data-product-number') ||
      getAttr(rankNode, 'data-rank') ||
      getAttr(rankNode, 'data-item-number') ||
      getAttr(cardNode, 'data-product-number') ||
      getAttr(cardNode, 'data-rank');
    const parsedFromText = parseProductNumberFromText(rawRankText);
    const parsedFromAttr =
      attrNumStr && /^[1-9]\d*$/.test(attrNumStr.trim()) ? Number(attrNumStr.trim()) : null;
    const parsedNumber = parsedFromText ?? parsedFromAttr ?? undefined;
    fields.rankNumber = {
      nodePath: rankNode.path,
      value: rawRankText,
      parsedNumber,
      mode: 'element',
    };
  }

  // 3. Badge / Kicker (.sog-qp-badge, .sog-ed-superlative, .sog-ep-kicker)
  const badgeNode = findDescendant(
    cardNode,
    (el) =>
      el.path !== rankNode?.path &&
      (hasClass(el, 'sog-qp-badge') ||
        hasClass(el, 'sog-ed-superlative') ||
        hasClass(el, 'sog-ed-badge') ||
        hasClass(el, 'sog-ep-kicker') ||
        hasClass(el, 'badge'))
  );
  if (badgeNode) {
    fields.badge = {
      nodePath: badgeNode.path,
      value: getPlainText(badgeNode).trim(),
    };
  }

  // 4. Eyebrow category inside .sog-ed-eyebrow
  const eyebrowNode = findDescendant(cardNode, (el) => hasClass(el, 'sog-ed-eyebrow'));
  if (eyebrowNode) {
    const spans = (eyebrowNode.children || []).filter(
      (c) =>
        c.type === 'element' &&
        !hasClass(c, 'sog-ed-superlative') &&
        !hasClass(c, 'sog-ed-dot')
    );
    if (spans.length > 0) {
      const targetSpan = spans[spans.length - 1];
      fields.eyebrow = {
        nodePath: targetSpan.path,
        value: getPlainText(targetSpan).trim(),
      };
    }
  }

  // 5. Title heading
  const titleNode =
    findDescendant(
      cardNode,
      (el) =>
        hasClass(el, 'sog-ed-title') ||
        hasClass(el, 'sog-qp-title') ||
        hasClass(el, 'sog-ep-title') ||
        hasClass(el, 'sog-card-title') ||
        hasClass(el, 'product-title') ||
        hasClass(el, 'card-title')
    ) ||
    findDescendant(cardNode, (el) => /^h[2-5]$/i.test(el.tagName || ''));

  if (titleNode) {
    const innerLink = findDescendant(titleNode, (el) => el.tagName?.toLowerCase() === 'a');
    const titleVal = getPlainText(titleNode).trim();
    fields.title = {
      nodePath: titleNode.path,
      value: titleVal,
      linkNodePath: innerLink?.path,
    };

    // If the card has no dedicated rank element, check if the title heading starts with a clear numeric prefix (e.g., "1. Product Name", "#01 Product Name")
    if (!fields.rankNumber) {
      const titlePrefixNum = parseTitlePrefixNumber(titleVal);
      if (titlePrefixNum !== null) {
        fields.rankNumber = {
          nodePath: titleNode.path,
          value: titleVal,
          parsedNumber: titlePrefixNum,
          mode: 'title_prefix',
        };
      }
    }
  }

  // 6. CTA Button / Link
  const ctaNode =
    findDescendant(
      cardNode,
      (el) =>
        hasClass(el, 'sog-ed-cta') ||
        hasClass(el, 'sog-qp-btn') ||
        hasClass(el, 'sog-ep-cta') ||
        hasClass(el, 'sog-card-cta')
    ) ||
    findAllDescendants(cardNode, (el) => el.tagName?.toLowerCase() === 'a').find(
      (a) => a.path !== fields.title?.linkNodePath && getPlainText(a).trim().length > 0
    );

  if (ctaNode) {
    fields.cta = {
      nodePath: ctaNode.path,
      label: getPlainText(ctaNode).trim(),
      href: getAttr(ctaNode, 'href'),
    };
  }

  // 7. Collect all product links on the card
  const allLinks = findAllDescendants(cardNode, (el) => el.tagName?.toLowerCase() === 'a');
  for (const aNode of allLinks) {
    const href = getAttr(aNode, 'href');
    if (href) {
      fields.productUrl.hrefNodePaths.push(aNode.path);
      if (!fields.productUrl.value) {
        fields.productUrl.value = href;
      }
    }
  }

  // 8. Price element (ONLY if present in the markup!)
  const priceNode = findDescendant(
    cardNode,
    (el) =>
      hasClass(el, 'sog-ed-price-top') ||
      hasClass(el, 'sog-ed-price') ||
      hasClass(el, 'sog-qp-price') ||
      hasClass(el, 'sog-card-price') ||
      hasClass(el, 'sog-ep-price') ||
      hasClass(el, 'price')
  );
  if (priceNode) {
    const noteSpan = findDescendant(priceNode, (el) => el.tagName?.toLowerCase() === 'span');
    if (noteSpan) {
      // Price has an inner note span like `<div class="sog-ed-price-top">$49.90 <span>• Unisex S–3XL</span></div>`
      const firstTextNode = (priceNode.children || []).find((c) => c.type === 'text');
      const rawPriceVal = firstTextNode
        ? decodeTextEntities(firstTextNode.content || '').trim()
        : getPlainText(priceNode).replace(getPlainText(noteSpan), '').trim();
      fields.price = {
        nodePath: priceNode.path,
        value: rawPriceVal,
        noteNodePath: noteSpan.path,
        noteValue: getPlainText(noteSpan).replace(/^[•·\-]\s*/, '').trim(),
      };
    } else {
      fields.price = {
        nodePath: priceNode.path,
        value: getPlainText(priceNode).trim(),
      };
    }
  }

  // 9. Dek (.sog-ed-dek)
  const dekNode = findDescendant(cardNode, (el) => hasClass(el, 'sog-ed-dek'));
  if (dekNode) {
    fields.dek = {
      nodePath: dekNode.path,
      value: getPlainText(dekNode).trim(),
      htmlValue: getInnerHtml(dekNode),
    };
  }

  // 10. Description / Editorial Copy (.sog-ed-copy, .sog-qp-meta, .sog-ep-desc, .sog-card-desc)
  const copyContainer = findDescendant(cardNode, (el) => hasClass(el, 'sog-ed-copy'));
  if (copyContainer) {
    const pChildren = (copyContainer.children || []).filter(
      (c) => c.type === 'element' && c.tagName?.toLowerCase() === 'p'
    );
    const paragraphsText =
      pChildren.length > 0
        ? pChildren.map((p) => getPlainText(p).trim()).join('\n\n')
        : getPlainText(copyContainer).trim();
    fields.description = {
      nodePath: copyContainer.path,
      value: paragraphsText,
      htmlValue: getInnerHtml(copyContainer),
      isParagraphContainer: true,
    };
  } else {
    const descNode =
      findDescendant(
        cardNode,
        (el) =>
          hasClass(el, 'sog-qp-meta') ||
          hasClass(el, 'sog-ep-desc') ||
          hasClass(el, 'sog-card-desc')
      ) ||
      findAllDescendants(cardNode, (el) => el.tagName?.toLowerCase() === 'p').find(
        (p) =>
          p.path !== fields.dek?.nodePath &&
          !hasClass(p, 'sog-ed-dek') &&
          p.path !== fields.price?.nodePath
      );
    if (descNode) {
      fields.description = {
        nodePath: descNode.path,
        value: getPlainText(descNode).trim(),
        htmlValue: getInnerHtml(descNode),
        isParagraphContainer: false,
      };
    }
  }

  // 11. Specs callout (.sog-ed-specs)
  const specsNode = findDescendant(cardNode, (el) => hasClass(el, 'sog-ed-specs'));
  if (specsNode) {
    const pChildren = (specsNode.children || []).filter(
      (c) => c.type === 'element' && c.tagName?.toLowerCase() === 'p'
    );
    const specsText =
      pChildren.length > 0
        ? pChildren.map((p) => getPlainText(p).trim()).join('\n')
        : getPlainText(specsNode).trim();
    fields.specsCallout = {
      nodePath: specsNode.path,
      value: specsText,
      htmlValue: getInnerHtml(specsNode),
      isParagraphContainer: pChildren.length > 0,
    };
  }

  // 12. Tags footer text (.sog-ed-tags)
  const tagsNode = findDescendant(cardNode, (el) => hasClass(el, 'sog-ed-tags'));
  if (tagsNode) {
    fields.tagsText = {
      nodePath: tagsNode.path,
      value: getPlainText(tagsNode).trim(),
    };
  }

  // Match against catalog products by normalized URL
  const normCardUrl = normalizeProductUrlForMatch(fields.productUrl.value);
  const matchedCatalog = normCardUrl
    ? catalogProducts.find((p) => normalizeProductUrlForMatch(p.productUrl) === normCardUrl)
    : undefined;

  return {
    cardNodePath: cardNode.path,
    cardVariant: variant,
    matchedCatalogProductId: matchedCatalog?.id,
    fields,
  };
}

/**
 * Parses a positive integer product number from a dedicated rank badge text (e.g. "#01", "06", "7.", "No. 3", "Pick #12").
 */
export function parseProductNumberFromText(rawText: string): number | null {
  const trimmed = (rawText || '').trim();
  if (!trimmed) return null;
  const directMatch = trimmed.match(
    /^(?:#\s*0*([1-9]\d*)|0*([1-9]\d*)\.?|No\.?\s*0*([1-9]\d*)|Pick\s*#?\s*0*([1-9]\d*)|Item\s*#?\s*0*([1-9]\d*))$/i
  );
  if (directMatch) {
    const numStr =
      directMatch[1] || directMatch[2] || directMatch[3] || directMatch[4] || directMatch[5];
    const parsed = Number(numStr);
    return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
  }
  const fallbackMatch = trimmed.match(/(?:^|#|\b)0*([1-9]\d*)\b/);
  if (fallbackMatch && trimmed.length <= 16) {
    const parsed = Number(fallbackMatch[1]);
    return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
  }
  return null;
}

/**
 * Parses a leading positive integer product number from a product card title (e.g. "1. Classic Tee", "#01: Classic Tee", "No. 2 - Mug").
 */
function parseTitlePrefixNumber(titleText: string): number | null {
  const trimmed = (titleText || '').trim();
  if (!trimmed) return null;
  const m = trimmed.match(
    /^(?:#\s*0*([1-9]\d*)(?:\s*[:.)\-–—]\s*|\s+)|No\.?\s*0*([1-9]\d*)(?:\s*[:.)\-–—]\s*|\s+)|0*([1-9]\d*)\s*[.):\-–—]\s+)(.+)$/i
  );
  if (!m) return null;
  const numStr = m[1] || m[2] || m[3];
  const parsed = Number(numStr);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}

/**
 * Formats a product rank value for `targetNum` while preserving the existing numbering style
 * (e.g. "#01" -> "#07", "#1" -> "#7", "1." -> "7.", "01" -> "07", or title prefix "1. Shirt" -> "7. Shirt").
 */
export function formatProductRankValue(
  existingRawValue: string,
  targetNum: number,
  mode: 'element' | 'title_prefix' = 'element'
): string {
  const safeNum = Math.max(1, Math.floor(targetNum));
  const trimmed = (existingRawValue || '').trim();

  if (mode === 'title_prefix') {
    const prefixMatch = trimmed.match(
      /^(#\s*)(0*[1-9]\d*)((?:\s*[:.)\-–—]\s*|\s+).+)$/i
    ) ||
      trimmed.match(/^(No\.?\s*)(0*[1-9]\d*)((?:\s*[:.)\-–—]\s*|\s+).+)$/i) ||
      trimmed.match(/^()(0*[1-9]\d*)(\s*[.):\-–—]\s+.+)$/i);
    if (prefixMatch) {
      const [, lead, oldDigits, rest] = prefixMatch;
      const shouldPad = oldDigits.length >= 2 && oldDigits.startsWith('0');
      const formattedDigits = shouldPad
        ? String(safeNum).padStart(oldDigits.length, '0')
        : String(safeNum);
      return `${lead}${formattedDigits}${rest}`;
    }
    return `${safeNum}. ${trimmed}`;
  }

  if (!trimmed) {
    return `#${String(safeNum).padStart(2, '0')}`;
  }

  // Replace the numeric token inside the badge while preserving zero-padding and surrounding symbols
  const tokenMatch = trimmed.match(/^(.*?)(0*[1-9]\d*)([^0-9]*)$/);
  if (tokenMatch) {
    const [, prefix, oldDigits, suffix] = tokenMatch;
    const shouldPad =
      (oldDigits.length >= 2 && oldDigits.startsWith('0')) ||
      (prefix.trim().endsWith('#') && oldDigits.length >= 2);
    const padWidth = Math.max(2, oldDigits.startsWith('0') ? oldDigits.length : 2);
    const formattedDigits = shouldPad
      ? String(safeNum).padStart(padWidth, '0')
      : String(safeNum);
    return `${prefix}${formattedDigits}${suffix}`;
  }

  return `#${String(safeNum).padStart(2, '0')}`;
}

function isLikelyProductCardElement(node: HtmlAstNode): boolean {
  if (node.type !== 'element') return false;
  if (
    hasClass(node, 'sog-ed-card') ||
    hasClass(node, 'sog-qp-card') ||
    hasClass(node, 'sog-editor-pick') ||
    hasClass(node, 'sog-card') ||
    hasClass(node, 'product-card') ||
    hasClass(node, 'product-item') ||
    hasClass(node, 'gift-card') ||
    hasClass(node, 'gift-item') ||
    hasClass(node, 'catalog-item')
  ) {
    return true;
  }

  const tag = (node.tagName || '').toLowerCase();
  if (['section', 'main', 'nav', 'header', 'footer', 'table'].includes(tag)) {
    return false;
  }

  // Heuristic for unfamiliar product card markup: contains a heading + (product link, image, price, or rank badge)
  const hasDataProductImg = Boolean(
    findDescendant(
      node,
      (el) => el.tagName?.toLowerCase() === 'img' && Boolean(getAttr(el, 'data-product-url'))
    )
  );
  const hasProductLink = Boolean(
    findDescendant(
      node,
      (el) =>
        el.tagName?.toLowerCase() === 'a' && getAttr(el, 'href').includes('/products/')
    )
  );
  const hasAnyLinkOrImg = Boolean(
    findDescendant(node, (el) => {
      const t = el.tagName?.toLowerCase();
      return t === 'a' || t === 'img';
    })
  );
  const hasRankOrPrice = Boolean(
    findDescendant(
      node,
      (el) =>
        hasClass(el, 'product-number') ||
        hasClass(el, 'product-num') ||
        hasClass(el, 'item-number') ||
        hasClass(el, 'card-number') ||
        hasClass(el, 'rank-number') ||
        hasClass(el, 'rank') ||
        hasClass(el, 'price') ||
        hasAttr(el, 'data-product-number')
    )
  );
  const headings = findAllDescendants(node, (el) => /^h[2-5]$/i.test(el.tagName || ''));
  if (headings.length !== 1) return false;

  const titleText = getPlainText(headings[0]).trim();
  const hasNumberedTitle = parseTitlePrefixNumber(titleText) !== null;

  return (
    hasDataProductImg ||
    hasProductLink ||
    hasRankOrPrice ||
    (hasNumberedTitle && hasAnyLinkOrImg)
  );
}

/**
 * Analyzes an arbitrary top-level element node into a RecognizedBlock.
 */
function analyzeTopLevelElement(
  el: HtmlAstNode,
  index: number,
  catalogProducts: Product[]
): RecognizedBlock {
  const tagName = (el.tagName || 'div').toLowerCase();
  const elementId = getAttr(el, 'id');
  const className = getAttr(el, 'class');
  const rawHtmlSnippet = serializeAstToHtml([el]);

  const baseBlock: RecognizedBlock = {
    id: `block-${index}-${el.path}`,
    nodePath: el.path,
    tagName,
    elementId,
    className,
    blockType: 'content_section',
    label: `Section ${index + 1}`,
    textFields: [],
    links: [],
    images: [],
    productCards: [],
    tocItems: [],
    faqItems: [],
    pillarItems: [],
    categoryCards: [],
    rawHtmlSnippet,
  };

  // 0. Script or Style tags -> Safe Raw Fallback
  if (tagName === 'script' || tagName === 'style') {
    baseBlock.blockType = 'raw_fallback';
    baseBlock.label = tagName === 'script' ? 'Embedded Script Block' : 'Embedded Style Block';
    return baseBlock;
  }

  // 1. Table of Contents (.sog-toc-box, .sog-toc, <nav>, or container of #anchor bookmark links)
  const tocGrid = hasClass(el, 'sog-toc-grid') || hasClass(el, 'sog-toc-list')
    ? el
    : findDescendant(el, (n) => hasClass(n, 'sog-toc-grid') || hasClass(n, 'sog-toc-list'));
  const allLinksInEl = findAllDescendants(el, (n) => n.tagName?.toLowerCase() === 'a');
  const allAnchorLinks = allLinksInEl.filter((n) => getAttr(n, 'href').startsWith('#'));
  const hasTocClassOrId = /\b(?:sog-toc(?:-box)?|toc|table-of-contents|bookmarks?)\b/i.test(
    `${elementId} ${className}`
  );
  if (
    hasClass(el, 'sog-toc-box') ||
    hasClass(el, 'sog-toc') ||
    hasTocClassOrId ||
    tocGrid ||
    (tagName === 'nav' && allAnchorLinks.length > 0) ||
    (allAnchorLinks.length >= 2 && allLinksInEl.length === allAnchorLinks.length)
  ) {
    baseBlock.blockType = 'toc';
    const titleNode = findDescendant(
      el,
      (n) => hasClass(n, 'sog-toc-title') || /^h[1-6]|p$/i.test(n.tagName || '')
    );
    if (titleNode && !findDescendant(titleNode, (n) => n.tagName?.toLowerCase() === 'a')) {
      baseBlock.textFields.push({
        nodePath: titleNode.path,
        tagName: titleNode.tagName || 'p',
        role: 'heading',
        value: getPlainText(titleNode).trim(),
      });
    }
    const listContainer =
      tocGrid ||
      (tagName === 'ul' || tagName === 'ol'
        ? el
        : findDescendant(el, (n) => n.tagName?.toLowerCase() === 'ul' || n.tagName?.toLowerCase() === 'ol'));

    if (listContainer) {
      baseBlock.repeatedContainerPath = listContainer.path;
      for (const li of (listContainer.children || []).filter((c) => c.type === 'element')) {
        const aNode =
          li.tagName?.toLowerCase() === 'a'
            ? li
            : findDescendant(li, (n) => n.tagName?.toLowerCase() === 'a');
        if (aNode) {
          const spanChildren = (aNode.children || []).filter(
            (c) => c.type === 'element' && c.tagName?.toLowerCase() === 'span'
          );
          const labelTarget = spanChildren.length > 0 ? spanChildren[0] : aNode;
          baseBlock.tocItems.push({
            itemNodePath: li.path,
            linkNodePath: aNode.path,
            label: getPlainText(labelTarget).trim(),
            href: getAttr(aNode, 'href'),
          });
        }
      }
    }
    baseBlock.label =
      baseBlock.textFields[0]?.value ||
      (elementId ? `Table of Contents (#${elementId})` : 'Table of Contents');
    return baseBlock;
  }

  // 2. Standalone Single Product Card / Featured #1 Editor's Pick (.sog-ed-card, .sog-qp-card, .sog-editor-pick, .sog-editors-pick, .sog-card)
  const isEditorsPickElement =
    hasClass(el, 'sog-editor-pick') ||
    hasClass(el, 'sog-editors-pick') ||
    Boolean(
      findDescendant(
        el,
        (n) =>
          hasClass(n, 'sog-ep-kicker') ||
          hasClass(n, 'sog-ep-heading') ||
          hasClass(n, 'sog-editor-pick') ||
          hasClass(n, 'sog-editors-pick')
      )
    );
  if (
    isEditorsPickElement ||
    hasClass(el, 'sog-ed-card') ||
    hasClass(el, 'sog-editorial-card') ||
    hasClass(el, 'sog-qp-card') ||
    hasClass(el, 'sog-card')
  ) {
    const variant = isEditorsPickElement
      ? 'editors_pick'
      : hasClass(el, 'sog-ed-card') || hasClass(el, 'sog-editorial-card')
      ? 'editorial'
      : hasClass(el, 'sog-qp-card')
      ? 'quick_pick'
      : 'grid_card';
    const card = analyzeProductCardNode(el, variant, catalogProducts);
    baseBlock.blockType =
      variant === 'editors_pick' ? 'editors_pick' : 'single_product_card';
    baseBlock.productCards = [card];
    baseBlock.label =
      card.fields.title?.value ||
      (variant === 'editors_pick' ? "Editor's Pick Spotlight" : 'Product Card');
    return baseBlock;
  }

  // 3. Quick Picks Section (.sog-quick-picks or .sog-qp-grid)
  const qpGrid = hasClass(el, 'sog-qp-grid')
    ? el
    : findDescendant(el, (n) => hasClass(n, 'sog-qp-grid'));
  if (hasClass(el, 'sog-quick-picks') || qpGrid) {
    baseBlock.blockType = 'quick_picks';
    const headingNode = findDescendant(
      el,
      (n) => hasClass(n, 'sog-qp-heading') || /^h[1-4]$/i.test(n.tagName || '')
    );
    if (headingNode && !hasClass(headingNode, 'sog-qp-title')) {
      baseBlock.textFields.push({
        nodePath: headingNode.path,
        tagName: headingNode.tagName || 'h2',
        role: 'heading',
        value: getPlainText(headingNode).trim(),
      });
    }
    const container = qpGrid || el;
    baseBlock.repeatedContainerPath = container.path;
    const cardEls = (container.children || []).filter(
      (c) => c.type === 'element' && (hasClass(c, 'sog-qp-card') || isLikelyProductCardElement(c))
    );
    baseBlock.productCards = cardEls.map((c) =>
      analyzeProductCardNode(c, 'quick_pick', catalogProducts)
    );
    baseBlock.label =
      baseBlock.textFields[0]?.value ||
      `Quick Picks (${baseBlock.productCards.length} cards)`;
    return baseBlock;
  }

  // 4. Editorial Product List (.sog-editorial-list or container with .sog-ed-card / .sog-editorial-card)
  const edListContainer = hasClass(el, 'sog-editorial-list')
    ? el
    : findDescendant(el, (n) => hasClass(n, 'sog-editorial-list'));
  const edCardNodes = findAllDescendants(
    el,
    (n) => hasClass(n, 'sog-ed-card') || hasClass(n, 'sog-editorial-card')
  );
  if (edListContainer || edCardNodes.length > 0) {
    baseBlock.blockType = 'editorial_list';
    const kickerNode = findDescendant(el, (n) => hasClass(n, 'sog-chapter-kicker'));
    if (kickerNode) {
      baseBlock.textFields.push({
        nodePath: kickerNode.path,
        tagName: kickerNode.tagName || 'span',
        role: 'kicker',
        value: getPlainText(kickerNode).trim(),
      });
    }
    const chTitleNode = findDescendant(
      el,
      (n) =>
        hasClass(n, 'sog-chapter-title') ||
        (n.tagName?.toLowerCase() === 'h2' && !hasClass(n, 'sog-ed-title'))
    );
    if (chTitleNode) {
      baseBlock.textFields.push({
        nodePath: chTitleNode.path,
        tagName: chTitleNode.tagName || 'h2',
        role: 'heading',
        value: getPlainText(chTitleNode).trim(),
      });
    }
    // Introductory paragraph directly inside section before .sog-editorial-list
    const directParagraphs = (el.children || []).filter(
      (c) => c.type === 'element' && c.tagName?.toLowerCase() === 'p'
    );
    for (const p of directParagraphs) {
      baseBlock.textFields.push({
        nodePath: p.path,
        tagName: 'p',
        role: 'paragraph',
        value: getPlainText(p).trim(),
      });
    }

    const container = edListContainer || el;
    baseBlock.repeatedContainerPath = container.path;
    const directCards = (container.children || []).filter(
      (c) =>
        c.type === 'element' &&
        (hasClass(c, 'sog-ed-card') ||
          hasClass(c, 'sog-editorial-card') ||
          isLikelyProductCardElement(c))
    );
    const resolvedCards = directCards.length > 0 ? directCards : edCardNodes;
    baseBlock.productCards = resolvedCards.map((c) =>
      analyzeProductCardNode(c, 'editorial', catalogProducts)
    );
    const nestedMoreSections = findAllDescendants(el, (n) => hasClass(n, 'sog-more-section'));
    if (nestedMoreSections.length > 0) {
      baseBlock.nestedBlocks = nestedMoreSections.map((moreEl, mIdx) => {
        const mb = analyzeTopLevelElement(moreEl, index * 100 + mIdx + 1, catalogProducts);
        mb.numberingInfo = computeBlockNumberingInfo(mb);
        return mb;
      });
    }
    baseBlock.label =
      chTitleNode
        ? getPlainText(chTitleNode).trim()
        : `Editorial Product List (${baseBlock.productCards.length} cards)`;
    return baseBlock;
  }

  // 4b. Related Gift Guides / Related Articles / Additional Reading Section
  const idAndClassLower = `${elementId} ${className}`.toLowerCase();
  const hasRelatedClassOrId =
    /\b(?:related[-_]?guides?|related[-_]?gifts?|more[-_]?guides?|other[-_]?guides?|related[-_]?articles?|additional[-_]?reading|further[-_]?reading|explore[-_]?guides?)\b/.test(
      idAndClassLower
    );
  const allHeadingNodes = findAllDescendants(el, (n) => /^h[1-6]$/i.test(n.tagName || ''));
  const firstHeadingText = allHeadingNodes.length > 0 ? getPlainText(allHeadingNodes[0]).trim() : '';
  const hasRelatedHeading =
    /\b(?:related\s+(?:gift\s+)?guides?|related\s+articles?|more\s+gift\s+guides?|other\s+gift\s+guides?|additional\s+reading|further\s+reading|explore\s+more\s+guides?|other\s+guides\s+you)\b/i.test(
      firstHeadingText
    );
  const allAnchorNodes = findAllDescendants(el, (n) => n.tagName?.toLowerCase() === 'a');
  const hasAnyProductHref = allAnchorNodes.some((a) => getAttr(a, 'href').includes('/products/'));
  const hasAnyDataProductImg = Boolean(
    findDescendant(
      el,
      (n) => n.tagName?.toLowerCase() === 'img' && Boolean(getAttr(n, 'data-product-url'))
    )
  );
  const allLinksAreArticleOrGuidePaths =
    allAnchorNodes.length > 0 &&
    !hasAnyProductHref &&
    !hasAnyDataProductImg &&
    allAnchorNodes.every((a) => {
      const h = getAttr(a, 'href').trim();
      return (
        !h ||
        /^(?:https?:\/\/[^/]+)?\/(?:pages|blogs|guides|articles|collections)\b/i.test(h)
      );
    });

  if (
    (hasRelatedClassOrId || hasRelatedHeading) &&
    !hasAnyProductHref &&
    !hasAnyDataProductImg
  ) {
    baseBlock.blockType = 'related_guides';
    const textDescendants = findAllDescendants(el, (n) =>
      ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li'].includes(n.tagName?.toLowerCase() || '')
    );
    for (const td of textDescendants) {
      const tdTag = (td.tagName || '').toLowerCase();
      const val = getPlainText(td).trim();
      if (!val) continue;
      baseBlock.textFields.push({
        nodePath: td.path,
        tagName: tdTag,
        role: /^h[1-6]$/.test(tdTag) ? 'heading' : tdTag === 'li' ? 'list_item' : 'paragraph',
        value: val,
        htmlValue: getInnerHtml(td),
        hasInlineMarkup: Boolean(
          findDescendant(td, (n) =>
            ['a', 'strong', 'em', 'b', 'i'].includes(n.tagName?.toLowerCase() || '')
          )
        ),
      });
    }
    for (const aNode of allAnchorNodes) {
      const href = getAttr(aNode, 'href');
      baseBlock.links.push({
        nodePath: aNode.path,
        label: getPlainText(aNode).trim(),
        href,
        isInternalAnchor: href.startsWith('#'),
      });
    }
    const imgNodes = findAllDescendants(el, (n) => n.tagName?.toLowerCase() === 'img');
    for (const imgNode of imgNodes) {
      baseBlock.images.push({
        nodePath: imgNode.path,
        src: getAttr(imgNode, 'src'),
        alt: getAttr(imgNode, 'alt'),
        dataProductUrl: getAttr(imgNode, 'data-product-url'),
        loading: getAttr(imgNode, 'loading'),
      });
    }
    baseBlock.label = firstHeadingText || 'Related Gift Guides';
    return baseBlock;
  }

  // 5. Secondary Product Grid (.sog-more-section, .sog-card-grid, or repeated .sog-card)
  const cardGridContainer = hasClass(el, 'sog-card-grid')
    ? el
    : findDescendant(el, (n) => hasClass(n, 'sog-card-grid'));
  if ((hasClass(el, 'sog-more-section') || cardGridContainer) && !allLinksAreArticleOrGuidePaths) {
    baseBlock.blockType = 'product_grid';
    const directHeadings = (el.children || []).filter(
      (c) => c.type === 'element' && /^h[1-4]|p$/i.test(c.tagName || '')
    );
    for (const h of directHeadings) {
      baseBlock.textFields.push({
        nodePath: h.path,
        tagName: h.tagName || 'h3',
        role: /^h/i.test(h.tagName || '') ? 'heading' : 'paragraph',
        value: getPlainText(h).trim(),
      });
    }
    const container = cardGridContainer || el;
    baseBlock.repeatedContainerPath = container.path;
    const cards = (container.children || []).filter(
      (c) => c.type === 'element' && (hasClass(c, 'sog-card') || isLikelyProductCardElement(c))
    );
    baseBlock.productCards = cards.map((c) =>
      analyzeProductCardNode(c, 'grid_card', catalogProducts)
    );
    baseBlock.label =
      baseBlock.textFields[0]?.value ||
      `Product Grid (${baseBlock.productCards.length} items)`;
    return baseBlock;
  }

  // 6. Category / Deity Hub (.sog-deity-grid or .sog-deity-card)
  const deityGrid = hasClass(el, 'sog-deity-grid')
    ? el
    : findDescendant(el, (n) => hasClass(n, 'sog-deity-grid'));
  if (deityGrid || hasClass(el, 'sog-deity-card')) {
    baseBlock.blockType = 'category_hub';
    const directTextNodes = (el.children || []).filter(
      (c) =>
        c.type === 'element' &&
        !hasClass(c, 'sog-deity-grid') &&
        /^h[1-4]|p$/i.test(c.tagName || '')
    );
    for (const tn of directTextNodes) {
      baseBlock.textFields.push({
        nodePath: tn.path,
        tagName: tn.tagName || 'h2',
        role: /^h/i.test(tn.tagName || '') ? 'heading' : 'paragraph',
        value: getPlainText(tn).trim(),
        htmlValue: getInnerHtml(tn),
        hasInlineMarkup: Boolean(findDescendant(tn, (x) => x.tagName?.toLowerCase() === 'a')),
      });
    }
    const container = deityGrid || el;
    baseBlock.repeatedContainerPath = container.path;
    const cardNodes = hasClass(el, 'sog-deity-card')
      ? [el]
      : (container.children || []).filter(
          (c) => c.type === 'element' && hasClass(c, 'sog-deity-card')
        );

    baseBlock.categoryCards = cardNodes.map((cNode) => {
      const img = findDescendant(cNode, (n) => n.tagName?.toLowerCase() === 'img');
      const h3 = findDescendant(cNode, (n) => /^h[2-5]$/i.test(n.tagName || ''));
      const sub = findDescendant(cNode, (n) => hasClass(n, 'sog-deity-sub'));
      const bodyWrap = findDescendant(cNode, (n) => hasClass(n, 'sog-deity-body'));
      const descP = bodyWrap
        ? findDescendant(bodyWrap, (n) => n.tagName?.toLowerCase() === 'p')
        : undefined;
      const chipsWrap = findDescendant(cNode, (n) => hasClass(n, 'sog-deity-links'));
      const chipLinks = chipsWrap
        ? findAllDescendants(chipsWrap, (n) => n.tagName?.toLowerCase() === 'a')
        : [];

      return {
        cardNodePath: cNode.path,
        elementId: getAttr(cNode, 'id'),
        title: h3 ? { nodePath: h3.path, value: getPlainText(h3).trim() } : undefined,
        subtitle: sub ? { nodePath: sub.path, value: getPlainText(sub).trim() } : undefined,
        description: descP ? { nodePath: descP.path, value: getPlainText(descP).trim() } : undefined,
        image: img
          ? {
              nodePath: img.path,
              src: getAttr(img, 'src'),
              alt: getAttr(img, 'alt'),
              dataProductUrl: getAttr(img, 'data-product-url'),
            }
          : undefined,
        chipsContainerPath: chipsWrap?.path,
        chips: chipLinks.map((ch) => ({
          nodePath: ch.path,
          label: getPlainText(ch).trim(),
          href: getAttr(ch, 'href'),
        })),
      };
    });
    baseBlock.label =
      baseBlock.textFields[0]?.value ||
      `Category Hub (${baseBlock.categoryCards.length} cards)`;
    return baseBlock;
  }

  // 7. Buying Guide & FAQ Section (.sog-guide-faq-section, .sog-buying-guide, .sog-faq-grid)
  const buyingGuideBox = hasClass(el, 'sog-buying-guide')
    ? el
    : findDescendant(el, (n) => hasClass(n, 'sog-buying-guide'));
  const faqGrid = hasClass(el, 'sog-faq-grid')
    ? el
    : findDescendant(el, (n) => hasClass(n, 'sog-faq-grid'));
  const faqCards = findAllDescendants(el, (n) => hasClass(n, 'sog-faq-card'));
  const detailsEls = findAllDescendants(el, (n) => n.tagName?.toLowerCase() === 'details');

  if (buyingGuideBox || faqGrid || faqCards.length > 0 || detailsEls.length > 0) {
    baseBlock.blockType = buyingGuideBox
      ? 'buying_guide'
      : 'faq_section';

    if (buyingGuideBox) {
      const bgKicker = findDescendant(buyingGuideBox, (n) => hasClass(n, 'sog-bg-kicker'));
      const bgTitle = findDescendant(buyingGuideBox, (n) => hasClass(n, 'sog-bg-title'));
      const bgIntro = findDescendant(buyingGuideBox, (n) => hasClass(n, 'sog-bg-intro'));
      if (bgKicker) {
        baseBlock.textFields.push({
          nodePath: bgKicker.path,
          tagName: bgKicker.tagName || 'span',
          role: 'kicker',
          value: getPlainText(bgKicker).trim(),
        });
      }
      if (bgTitle) {
        baseBlock.textFields.push({
          nodePath: bgTitle.path,
          tagName: bgTitle.tagName || 'h2',
          role: 'heading',
          value: getPlainText(bgTitle).trim(),
        });
      }
      if (bgIntro) {
        baseBlock.textFields.push({
          nodePath: bgIntro.path,
          tagName: bgIntro.tagName || 'p',
          role: 'paragraph',
          value: getPlainText(bgIntro).trim(),
        });
      }
      const pillarsGrid = findDescendant(buyingGuideBox, (n) => hasClass(n, 'sog-bg-pillars'));
      if (pillarsGrid) {
        for (const pNode of (pillarsGrid.children || []).filter((c) => c.type === 'element')) {
          const num = findDescendant(pNode, (n) => hasClass(n, 'sog-bg-num'));
          const h3 = findDescendant(pNode, (n) => /^h[2-5]$/i.test(n.tagName || ''));
          const pBody = findDescendant(pNode, (n) => n.tagName?.toLowerCase() === 'p');
          baseBlock.pillarItems.push({
            itemNodePath: pNode.path,
            numLabel: num ? { nodePath: num.path, value: getPlainText(num).trim() } : undefined,
            heading: h3 ? { nodePath: h3.path, value: getPlainText(h3).trim() } : undefined,
            body: pBody
              ? {
                  nodePath: pBody.path,
                  htmlValue: getInnerHtml(pBody),
                  textValue: getPlainText(pBody).trim(),
                }
              : undefined,
          });
        }
      }
    }

    const faqHeader = findDescendant(el, (n) => hasClass(n, 'sog-faq-header'));
    if (faqHeader) {
      for (const child of (faqHeader.children || []).filter((c) => c.type === 'element')) {
        baseBlock.textFields.push({
          nodePath: child.path,
          tagName: child.tagName || 'h2',
          role: /^h/i.test(child.tagName || '') ? 'heading' : 'paragraph',
          value: getPlainText(child).trim(),
        });
      }
    }

    if (faqGrid || faqCards.length > 0) {
      const container = faqGrid || el;
      baseBlock.repeatedContainerPath = container.path;
      const cards = faqGrid
        ? (faqGrid.children || []).filter((c) => c.type === 'element')
        : faqCards;

      baseBlock.faqItems = cards.map((fCard) => {
        const badgeNode = findDescendant(fCard, (n) => hasClass(n, 'sog-faq-badge'));
        const qNode =
          findDescendant(fCard, (n) => hasClass(n, 'sog-faq-question-title')) ||
          findDescendant(fCard, (n) => /^h[2-5]$/i.test(n.tagName || ''));
        const aNode =
          findDescendant(fCard, (n) => hasClass(n, 'sog-faq-answer-text')) ||
          findDescendant(fCard, (n) => n.tagName?.toLowerCase() === 'p');
        return {
          itemNodePath: fCard.path,
          badge: badgeNode
            ? { nodePath: badgeNode.path, value: getPlainText(badgeNode).trim() }
            : undefined,
          question: {
            nodePath: qNode ? qNode.path : fCard.path,
            value: qNode ? getPlainText(qNode).trim() : '',
          },
          answer: {
            nodePath: aNode ? aNode.path : fCard.path,
            htmlValue: aNode ? getInnerHtml(aNode) : '',
            textValue: aNode ? getPlainText(aNode).trim() : '',
          },
        };
      });
    } else if (detailsEls.length > 0) {
      baseBlock.repeatedContainerPath = el.path;
      baseBlock.faqItems = detailsEls.map((det) => {
        const sum = findDescendant(det, (n) => n.tagName?.toLowerCase() === 'summary');
        const ans = findDescendant(
          det,
          (n) => n.tagName?.toLowerCase() === 'p' || n.tagName?.toLowerCase() === 'div'
        );
        return {
          itemNodePath: det.path,
          question: {
            nodePath: sum ? sum.path : det.path,
            value: sum ? getPlainText(sum).trim() : '',
          },
          answer: {
            nodePath: ans ? ans.path : det.path,
            htmlValue: ans ? getInnerHtml(ans) : '',
            textValue: ans ? getPlainText(ans).trim() : '',
          },
        };
      });
    }

    baseBlock.label =
      baseBlock.textFields.find((t) => t.role === 'heading')?.value ||
      (buyingGuideBox && baseBlock.faqItems.length > 0
        ? `Buying Guide & FAQs (${baseBlock.faqItems.length} FAQs)`
        : baseBlock.faqItems.length > 0
        ? `FAQ Section (${baseBlock.faqItems.length} FAQs)`
        : 'Buying Guide');
    return baseBlock;
  }

  // 8. Heuristic Check: Unfamiliar repeated product grid, section with product list, or single product card
  const directElementChildren = (el.children || []).filter((c) => c.type === 'element');
  if (
    directElementChildren.length >= 2 &&
    directElementChildren.every((c) => isLikelyProductCardElement(c))
  ) {
    baseBlock.blockType = 'product_grid';
    baseBlock.repeatedContainerPath = el.path;
    baseBlock.productCards = directElementChildren.map((c) =>
      analyzeProductCardNode(c, 'generic_card', catalogProducts)
    );
    baseBlock.label = `Product Collection (${baseBlock.productCards.length} cards)`;
    return baseBlock;
  }

  // Check if this section/container has section heading/intro elements alongside direct product card children
  const directProductCards = directElementChildren.filter((c) => isLikelyProductCardElement(c));
  const directNonCardElements = directElementChildren.filter((c) => !isLikelyProductCardElement(c));
  if (
    directProductCards.length >= 1 &&
    directNonCardElements.every((c) => /^h[1-6]|p|header|span$/i.test(c.tagName || ''))
  ) {
    baseBlock.blockType = 'product_grid';
    baseBlock.repeatedContainerPath = el.path;
    for (const nc of directNonCardElements) {
      const ncTag = (nc.tagName || '').toLowerCase();
      if (/^h[1-6]$/.test(ncTag) || ncTag === 'p' || ncTag === 'span') {
        baseBlock.textFields.push({
          nodePath: nc.path,
          tagName: ncTag,
          role: /^h[1-6]$/.test(ncTag) ? 'heading' : ncTag === 'span' ? 'kicker' : 'paragraph',
          value: getPlainText(nc).trim(),
        });
      } else {
        const innerHeadings = findAllDescendants(nc, (h) => /^h[1-6]|p$/i.test(h.tagName || ''));
        for (const ih of innerHeadings) {
          const ihTag = (ih.tagName || 'h2').toLowerCase();
          baseBlock.textFields.push({
            nodePath: ih.path,
            tagName: ihTag,
            role: /^h[1-6]$/.test(ihTag) ? 'heading' : 'paragraph',
            value: getPlainText(ih).trim(),
          });
        }
      }
    }
    baseBlock.productCards = directProductCards.map((c) =>
      analyzeProductCardNode(c, 'generic_card', catalogProducts)
    );
    baseBlock.label =
      baseBlock.textFields.find((t) => t.role === 'heading')?.value ||
      `Product Section (${baseBlock.productCards.length} items)`;
    return baseBlock;
  }

  // Check if this section contains a child product-list/grid wrapper whose element children are product cards
  const nestedCardContainer = directElementChildren.find((child) => {
    const childEls = (child.children || []).filter((c) => c.type === 'element');
    return childEls.length >= 1 && childEls.every((c) => isLikelyProductCardElement(c));
  });
  if (nestedCardContainer) {
    baseBlock.blockType = 'product_grid';
    baseBlock.repeatedContainerPath = nestedCardContainer.path;
    for (const sibling of directElementChildren) {
      if (sibling === nestedCardContainer) continue;
      const sTag = (sibling.tagName || '').toLowerCase();
      if (/^h[1-6]|p|span$/i.test(sTag)) {
        baseBlock.textFields.push({
          nodePath: sibling.path,
          tagName: sTag,
          role: /^h[1-6]$/.test(sTag) ? 'heading' : sTag === 'span' ? 'kicker' : 'paragraph',
          value: getPlainText(sibling).trim(),
        });
      }
    }
    const cardNodes = (nestedCardContainer.children || []).filter((c) => c.type === 'element');
    baseBlock.productCards = cardNodes.map((c) =>
      analyzeProductCardNode(c, 'generic_card', catalogProducts)
    );
    baseBlock.label =
      baseBlock.textFields.find((t) => t.role === 'heading')?.value ||
      `Product Section (${baseBlock.productCards.length} items)`;
    return baseBlock;
  }

  if (isLikelyProductCardElement(el)) {
    baseBlock.blockType = 'single_product_card';
    const card = analyzeProductCardNode(el, 'generic_card', catalogProducts);
    baseBlock.productCards = [card];
    baseBlock.label = card.fields.title?.value || 'Product Card';
    return baseBlock;
  }

  // 9. General Content Section (Headings, Paragraphs, Lists, Links, Images)
  if (/^h[1-6]$/i.test(tagName)) {
    baseBlock.textFields.push({
      nodePath: el.path,
      tagName,
      role: 'heading',
      value: getPlainText(el).trim(),
    });
  } else if (tagName === 'p') {
    baseBlock.textFields.push({
      nodePath: el.path,
      tagName,
      role: 'paragraph',
      value: getPlainText(el).trim(),
      htmlValue: getInnerHtml(el),
      hasInlineMarkup: Boolean(
        findDescendant(el, (n) =>
          ['a', 'strong', 'em', 'b', 'i', 'span'].includes(n.tagName?.toLowerCase() || '')
        )
      ),
    });
  } else {
    const textDescendants = findAllDescendants(el, (n) =>
      ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'span'].includes(
        n.tagName?.toLowerCase() || ''
      )
    );
    for (const td of textDescendants) {
      const tdTag = (td.tagName || '').toLowerCase();
      // Skip spans inside links or paragraphs that are already captured
      if (tdTag === 'span' && textDescendants.some((other) => other !== td && td.path.startsWith(other.path + '.'))) {
        continue;
      }
      const val = getPlainText(td).trim();
      if (!val) continue;
      baseBlock.textFields.push({
        nodePath: td.path,
        tagName: tdTag,
        role: /^h[1-6]$/.test(tdTag)
          ? 'heading'
          : tdTag === 'li'
          ? 'list_item'
          : tdTag === 'span'
          ? 'kicker'
          : 'paragraph',
        value: val,
        htmlValue: getInnerHtml(td),
        hasInlineMarkup: Boolean(
          findDescendant(td, (n) =>
            ['a', 'strong', 'em', 'b', 'i'].includes(n.tagName?.toLowerCase() || '')
          )
        ),
      });
    }
  }

  // Collect links inside general content block
  const linkNodes =
    tagName === 'a'
      ? [el]
      : findAllDescendants(el, (n) => n.tagName?.toLowerCase() === 'a');
  for (const aNode of linkNodes) {
    const href = getAttr(aNode, 'href');
    baseBlock.links.push({
      nodePath: aNode.path,
      label: getPlainText(aNode).trim(),
      href,
      isInternalAnchor: href.startsWith('#'),
    });
  }

  // Collect images inside general content block
  const imgNodes =
    tagName === 'img'
      ? [el]
      : findAllDescendants(el, (n) => n.tagName?.toLowerCase() === 'img');
  for (const imgNode of imgNodes) {
    baseBlock.images.push({
      nodePath: imgNode.path,
      src: getAttr(imgNode, 'src'),
      alt: getAttr(imgNode, 'alt'),
      dataProductUrl: getAttr(imgNode, 'data-product-url'),
      loading: getAttr(imgNode, 'loading'),
    });
  }

  if (
    baseBlock.textFields.length === 0 &&
    baseBlock.links.length === 0 &&
    baseBlock.images.length === 0
  ) {
    baseBlock.blockType = 'raw_fallback';
    baseBlock.label = `Custom HTML (<${tagName}${elementId ? `#${elementId}` : ''}>)`;
  } else {
    const firstHeading = baseBlock.textFields.find((t) => t.role === 'heading');
    baseBlock.label =
      firstHeading?.value ||
      (elementId
        ? `<${tagName}#${elementId}>`
        : baseBlock.textFields[0]?.value?.slice(0, 48) || `Content Block (<${tagName}>)`);
  }

  return baseBlock;
}

/**
 * Analyzes a complete or partial HTML string and returns its dynamic visual structure,
 * internal anchor map, catalog matches, and validation issues.
 */
export function analyzeHtmlDocument(
  rawHtml: string,
  catalogProducts: Product[] = []
): HtmlAnalysisReport {
  const { rootChildren, parseWarnings } = parseHtmlToAst(rawHtml);
  const normalizedHtml = serializeAstToHtml(rootChildren);

  const blocks: RecognizedBlock[] = [];
  const allElementIds: Array<{ id: string; nodePath: string; tagName: string }> = [];
  const allInternalAnchorLinks: Array<{ href: string; label: string; nodePath: string }> = [];
  const validationIssues: HtmlValidationIssue[] = [];

  for (const pw of parseWarnings) {
    validationIssues.push({
      severity: 'warning',
      code: 'PARSE_WARNING',
      message: pw,
    });
  }

  // Flatten wrapper containers if a single outer wrapper (e.g. <div class="guide-wrapper"> or <main>) contains multiple distinct sections
  const topElements = rootChildren.filter((c) => c.type === 'element');
  let blockCandidates = topElements;
  if (topElements.length === 1) {
    const singleRoot = topElements[0];
    const rootTag = (singleRoot.tagName || '').toLowerCase();
    const directChildren = (singleRoot.children || []).filter((c) => c.type === 'element');
    const isSingleSectionItself =
      hasClass(singleRoot, 'sog-toc-box') ||
      hasClass(singleRoot, 'sog-quick-picks') ||
      hasClass(singleRoot, 'sog-editor-pick') ||
      hasClass(singleRoot, 'sog-editorial-list') ||
      hasClass(singleRoot, 'sog-more-section') ||
      hasClass(singleRoot, 'sog-deity-grid') ||
      hasClass(singleRoot, 'sog-guide-faq-section');

    if (
      !isSingleSectionItself &&
      directChildren.length >= 2 &&
      ['div', 'main', 'article', 'body'].includes(rootTag)
    ) {
      const childSectionCount = directChildren.filter(
        (c) =>
          (c.tagName || '').toLowerCase() === 'section' ||
          hasClass(c, 'sog-guide-container') ||
          hasClass(c, 'product-section')
      ).length;
      if (childSectionCount >= 2) {
        blockCandidates = directChildren;
      }
    }
  }

  let blockIndex = 0;
  for (const el of blockCandidates) {
    const mainBlock = analyzeTopLevelElement(el, blockIndex++, catalogProducts);
    mainBlock.numberingInfo = computeBlockNumberingInfo(mainBlock);
    blocks.push(mainBlock);
  }

  // Scan the entire AST for IDs, internal anchor links, scripts, and inline event handlers
  const walkAllElements = (nodes: HtmlAstNode[]) => {
    for (const n of nodes) {
      if (n.type !== 'element') continue;
      const tag = (n.tagName || '').toLowerCase();
      const idVal = getAttr(n, 'id').trim();
      if (idVal) {
        allElementIds.push({ id: idVal, nodePath: n.path, tagName: tag });
      }

      if (tag === 'script') {
        validationIssues.push({
          severity: 'warning',
          code: 'SCRIPT_TAG_DETECTED',
          message: `<script> tag detected at node ${n.path}. Scripts are neutralized in the live preview for safety and preserved in raw source unless removed.`,
          nodePath: n.path,
        });
      }

      for (const attr of n.attrs || []) {
        if (/^on[a-z]+$/i.test(attr.name)) {
          validationIssues.push({
            severity: 'warning',
            code: 'INLINE_EVENT_HANDLER',
            message: `Inline event handler "${attr.name}" on <${tag}> (node ${n.path}) is neutralized in preview.`,
            nodePath: n.path,
          });
        }
      }

      if (tag === 'a') {
        const href = getAttr(n, 'href').trim();
        if (!href || href === '#') {
          validationIssues.push({
            severity: 'warning',
            code: 'EMPTY_LINK_HREF',
            message: `Link "${getPlainText(n).trim().slice(0, 40) || '<a>'}" has an empty or placeholder href ("${href || ''}").`,
            nodePath: n.path,
          });
        } else if (href.startsWith('#') && href.length > 1) {
          allInternalAnchorLinks.push({
            href,
            label: getPlainText(n).trim(),
            nodePath: n.path,
          });
        }
      }

      if (n.children && n.children.length > 0) {
        walkAllElements(n.children);
      }
    }
  };
  walkAllElements(rootChildren);

  // Check for duplicate IDs
  const idCounts = new Map<string, string[]>();
  for (const entry of allElementIds) {
    const list = idCounts.get(entry.id) || [];
    list.push(entry.nodePath);
    idCounts.set(entry.id, list);
  }
  for (const [dupId, paths] of idCounts.entries()) {
    if (paths.length > 1) {
      validationIssues.push({
        severity: 'error',
        code: 'DUPLICATE_ID',
        message: `Duplicate element ID "#${dupId}" found ${paths.length} times in the HTML document.`,
        targetId: dupId,
        nodePath: paths[1],
      });
    }
  }

  // Check for broken internal anchor links (`href="#jump-xyz"`)
  // Note: If the user pasted a single section fragment (e.g., only the TOC box),
  // internal links to other sections in the full guide are flagged as warnings so they can verify them.
  for (const link of allInternalAnchorLinks) {
    const targetId = link.href.slice(1);
    if (!idCounts.has(targetId)) {
      validationIssues.push({
        severity: 'warning',
        code: 'BROKEN_ANCHOR_LINK',
        message: `Internal anchor link "${link.href}" (${link.label || 'link'}) has no matching id="${targetId}" in the current HTML fragment.`,
        targetId,
        nodePath: link.nodePath,
      });
    }
  }

  let productCardCount = 0;
  let matchedCatalogCount = 0;
  let faqCount = 0;
  let headingCount = 0;
  let linkCount = 0;
  let imageCount = 0;

  for (const b of blocks) {
    productCardCount += b.productCards.length;
    matchedCatalogCount += b.productCards.filter((c) => Boolean(c.matchedCatalogProductId)).length;
    if (b.nestedBlocks && b.nestedBlocks.length > 0) {
      for (const nb of b.nestedBlocks) {
        productCardCount += nb.productCards.length;
        matchedCatalogCount += nb.productCards.filter((c) =>
          Boolean(c.matchedCatalogProductId)
        ).length;
      }
    }
    faqCount += b.faqItems.length;
    headingCount += b.textFields.filter((t) => t.role === 'heading').length;
    linkCount += b.links.length + b.tocItems.length;
    imageCount +=
      b.images.length + b.productCards.filter((c) => Boolean(c.fields.image)).length;
  }

  return {
    originalHtml: rawHtml,
    normalizedHtml,
    blocks,
    allElementIds,
    allInternalAnchorLinks,
    validationIssues,
    stats: {
      blockCount: blocks.length,
      productCardCount,
      matchedCatalogCount,
      faqCount,
      headingCount,
      linkCount,
      imageCount,
    },
  };
}

// ============================================================================
// LOCALIZED DOM / AST TRANSFORMATION HELPERS
// ============================================================================

/**
 * Updates the text or inline HTML of a specific node by path without altering any other markup.
 */
export function updateHtmlNodeText(
  html: string,
  nodePath: string,
  newValue: string,
  options: {
    asParagraphs?: boolean;
    asRawInnerHtml?: boolean;
    preserveInnerLink?: boolean;
  } = {}
): string {
  const { rootChildren } = parseHtmlToAst(html);
  const target = getNodeByPath(rootChildren, nodePath);
  if (!target || target.type !== 'element') return html;

  if (options.asParagraphs) {
    // Preserve indentation from existing children if available
    const paragraphs = newValue
      .split(/\n\s*\n|\r?\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    const newChildren: HtmlAstNode[] = [];
    paragraphs.forEach((pText, idx) => {
      if (idx > 0) {
        newChildren.push({ type: 'text', path: '', content: '\n          ' });
      }
      newChildren.push({
        type: 'element',
        path: '',
        tagName: 'p',
        attrs: [],
        children: [{ type: 'text', path: '', content: encodeTextEntities(pText) }],
      });
    });
    target.children = newChildren;
  } else if (options.asRawInnerHtml) {
    const parsedInner = parseHtmlToAst(newValue);
    target.children = parsedInner.rootChildren;
  } else if (options.preserveInnerLink !== false) {
    setElementTextPreservingInnerLink(target, newValue);
  } else {
    target.children = [{ type: 'text', path: '', content: encodeTextEntities(newValue) }];
  }

  return serializeAstToHtml(rootChildren);
}

/**
 * Updates a specific price element that may also have an inner `<span>` note (like `.sog-ed-price-top`).
 */
export function updateProductCardPrice(
  html: string,
  priceNodePath: string,
  newPrice: string,
  noteValue?: string
): string {
  const { rootChildren } = parseHtmlToAst(html);
  const priceNode = getNodeByPath(rootChildren, priceNodePath);
  if (!priceNode || priceNode.type !== 'element') return html;

  const noteSpan = findDescendant(priceNode, (el) => el.tagName?.toLowerCase() === 'span');
  if (noteSpan) {
    const finalNote = noteValue !== undefined ? noteValue.trim() : getPlainText(noteSpan).replace(/^[•·\-]\s*/, '').trim();
    noteSpan.children = [
      {
        type: 'text',
        path: '',
        content: encodeTextEntities(finalNote ? `• ${finalNote}` : ''),
      },
    ];
    priceNode.children = [
      { type: 'text', path: '', content: `${encodeTextEntities(newPrice.trim())} ` },
      noteSpan,
    ];
  } else {
    priceNode.children = [
      { type: 'text', path: '', content: encodeTextEntities(newPrice.trim()) },
    ];
  }

  return serializeAstToHtml(rootChildren);
}

/**
 * Updates a product card's canonical URL across all its matching `<a href>` and `<img data-product-url>` nodes.
 */
export function updateProductCardUrls(
  html: string,
  hrefNodePaths: string[],
  dataUrlNodePaths: string[],
  newUrl: string
): string {
  const { rootChildren } = parseHtmlToAst(html);
  for (const hp of hrefNodePaths) {
    const aNode = getNodeByPath(rootChildren, hp);
    if (aNode && aNode.type === 'element') {
      setAttr(aNode, 'href', newUrl);
    }
  }
  for (const dp of dataUrlNodePaths) {
    const imgNode = getNodeByPath(rootChildren, dp);
    if (imgNode && imgNode.type === 'element') {
      setAttr(imgNode, 'data-product-url', newUrl);
    }
  }
  return serializeAstToHtml(rootChildren);
}

/**
 * Updates attributes on an element node (e.g., `src`, `alt`, `href`, `data-product-url`, `loading`).
 */
export function updateElementAttributes(
  html: string,
  nodePath: string,
  updates: Record<string, string | null>
): string {
  const { rootChildren } = parseHtmlToAst(html);
  const target = getNodeByPath(rootChildren, nodePath);
  if (!target || target.type !== 'element') return html;

  if (!target.attrs) target.attrs = [];
  for (const [attrName, attrVal] of Object.entries(updates)) {
    const lower = attrName.toLowerCase();
    if (attrVal === null || (attrVal === '' && lower === 'src' && hasAttr(target, 'data-product-url'))) {
      // If clearing src on a Fourthwall auto-image tag, remove the empty src attribute cleanly
      target.attrs = target.attrs.filter((a) => a.name.toLowerCase() !== lower);
    } else {
      setAttr(target, attrName, attrVal);
    }
  }
  return serializeAstToHtml(rootChildren);
}

/**
 * Updates an element's `id` attribute and optionally updates all matching internal anchor links (`href="#oldId"`).
 */
export function updateElementIdAndReferences(
  html: string,
  nodePath: string,
  newId: string,
  updateMatchingLinks = true
): { html: string; updatedLinkCount: number } {
  const cleanNewId = newId.trim().replace(/^#/, '');
  if (!cleanNewId) return { html, updatedLinkCount: 0 };

  const { rootChildren } = parseHtmlToAst(html);
  const target = getNodeByPath(rootChildren, nodePath);
  if (!target || target.type !== 'element') return { html, updatedLinkCount: 0 };

  const oldId = getAttr(target, 'id').trim();
  setAttr(target, 'id', cleanNewId);

  let updatedLinkCount = 0;
  if (updateMatchingLinks && oldId && oldId !== cleanNewId) {
    const targetHref = `#${oldId}`;
    const walkLinks = (nodes: HtmlAstNode[]) => {
      for (const n of nodes) {
        if (n.type === 'element') {
          if (n.tagName?.toLowerCase() === 'a' && getAttr(n, 'href').trim() === targetHref) {
            setAttr(n, 'href', `#${cleanNewId}`);
            updatedLinkCount++;
          }
          if (n.children) walkLinks(n.children);
        }
      }
    };
    walkLinks(rootChildren);
  }

  return {
    html: serializeAstToHtml(rootChildren),
    updatedLinkCount,
  };
}

/**
 * Applies a catalog Product's stored data to an existing product card in the HTML without adding
 * unsupported elements or altering the card's structural layout.
 */
export function applyCatalogProductToCard(
  html: string,
  card: RecognizedProductCard,
  product: Product,
  options: { replaceDescription?: boolean; replaceSpecs?: boolean } = {}
): string {
  let updated = html;

  // 1. Update URLs (href & data-product-url)
  if (product.productUrl) {
    updated = updateProductCardUrls(
      updated,
      card.fields.productUrl.hrefNodePaths,
      card.fields.productUrl.dataUrlNodePaths,
      product.productUrl
    );
  }

  // 2. Update Title (if present in card)
  if (card.fields.title && product.name) {
    let nextTitleText = product.name;
    if (
      card.fields.rankNumber?.mode === 'title_prefix' &&
      card.fields.rankNumber.parsedNumber !== undefined &&
      parseTitlePrefixNumber(product.name) === null
    ) {
      nextTitleText = formatProductRankValue(
        card.fields.rankNumber.value,
        card.fields.rankNumber.parsedNumber,
        'title_prefix'
      ).replace(
        /^((?:#\s*0*[1-9]\d*(?:\s*[:.)\-–—]\s*|\s+)|No\.?\s*0*[1-9]\d*(?:\s*[:.)\-–—]\s*|\s+)|0*[1-9]\d*\s*[.):\-–—]\s+)).*$/i,
        `$1${product.name}`
      );
    }
    updated = updateHtmlNodeText(updated, card.fields.title.nodePath, nextTitleText, {
      preserveInnerLink: true,
    });
  }

  // 3. Update Image src & alt (if present in card)
  if (card.fields.image) {
    const imgUpdates: Record<string, string | null> = {
      alt: product.name || card.fields.image.alt,
      'data-product-url': product.productUrl || card.fields.image.dataProductUrl,
    };
    if (product.imageUrl?.trim()) {
      imgUpdates.src = product.imageUrl.trim();
    } else if (card.fields.image.dataProductUrl) {
      imgUpdates.src = null;
    }
    updated = updateElementAttributes(updated, card.fields.image.nodePath, imgUpdates);
  }

  // 4. Update Price ONLY if the card already has a price element and the catalog product has a known price
  if (card.fields.price && product.price && product.price !== 'Unavailable') {
    updated = updateProductCardPrice(
      updated,
      card.fields.price.nodePath,
      product.price,
      card.fields.price.noteValue
    );
  }

  // 5. Optionally update description / dek if requested or if replacing card
  if (options.replaceDescription && product.shortDescription) {
    if (card.fields.dek) {
      updated = updateHtmlNodeText(updated, card.fields.dek.nodePath, product.shortDescription);
    } else if (card.fields.description && !card.fields.description.isParagraphContainer) {
      updated = updateHtmlNodeText(
        updated,
        card.fields.description.nodePath,
        product.shortDescription
      );
    }
  }

  if (options.replaceSpecs && card.fields.specsCallout && product.featuresSpecs) {
    updated = updateHtmlNodeText(
      updated,
      card.fields.specsCallout.nodePath,
      `Verified Specs: ${product.featuresSpecs}`,
      { asParagraphs: card.fields.specsCallout.isParagraphContainer }
    );
  }

  return updated;
}

// ============================================================================
// SECTION-LEVEL STARTING PRODUCT NUMBERING HELPERS
// ============================================================================

/**
 * Returns a stable key for storing a product section's Starting Product Number in project state.
 */
export function getBlockNumberingKey(
  block: Pick<RecognizedBlock, 'nodePath' | 'elementId' | 'sectionId'>
): string {
  if (block.elementId) return `id:${block.elementId}`;
  if (block.sectionId) return `sec:${block.sectionId}`;
  return `path:${block.nodePath}`;
}

export const HUMAN_SECTION_TYPE_LABELS: Record<HtmlSectionCategory, string> = {
  toc: 'Table of Contents / Bookmarks',
  quick_picks: 'Quick Picks',
  editors_pick: 'Featured Product',
  editorial_list: 'Numbered Product Section',
  product_grid: 'Product Grid',
  single_product_card: 'Single Product Card',
  category_hub: 'Category Hub',
  buying_guide: 'Buying Guide',
  faq_section: 'FAQs',
  related_guides: 'Related Gift Guides',
  content_section: 'Editorial Text',
  raw_fallback: 'Custom HTML',
};

/**
 * Determines whether a recognized block/section is eligible for the Starting Product Number control.
 * - Never eligible for: toc (bookmarks), quick_picks, editors_pick, category_hub, buying_guide,
 *   faq_section, related_guides, content_section (editorial text), single_product_card, or raw_fallback.
 * - Eligible when:
 *   1. The user manually classified the section as 'editorial_list' (Numbered Product Section), OR
 *   2. The section is automatically detected as 'editorial_list' or 'product_grid' AND its product cards
 *      contain explicit product numbering (or it is an 'editorial_list' product section).
 */
export function isSectionEligibleForProductNumbering(
  blockOrType:
    | Pick<RecognizedBlock, 'blockType' | 'productCards' | 'manualType'>
    | RecognizedBlock['blockType'],
  cardCountOrExplicit?: number | boolean,
  hasExplicitNumberingArg?: boolean,
  manualTypeArg?: HtmlSectionCategory
): boolean {
  const isObject = typeof blockOrType === 'object' && blockOrType !== null;
  const blockType = isObject ? blockOrType.blockType : blockOrType;
  const cardCount = isObject
    ? Array.isArray(blockOrType.productCards)
      ? blockOrType.productCards.length
      : 0
    : typeof cardCountOrExplicit === 'number'
    ? cardCountOrExplicit
    : 0;
  const hasExplicitNumbering = isObject
    ? Boolean(cardCountOrExplicit)
    : Boolean(hasExplicitNumberingArg);
  const effectiveManual = isObject ? blockOrType.manualType : manualTypeArg;

  if (effectiveManual) {
    if (effectiveManual === 'editorial_list') {
      return cardCount > 0;
    }
    if (effectiveManual === 'product_grid') {
      return cardCount > 0 && hasExplicitNumbering;
    }
    return false;
  }

  if (cardCount === 0) return false;

  if (blockType === 'editorial_list') {
    return true;
  }

  if (blockType === 'product_grid') {
    return hasExplicitNumbering;
  }

  return false;
}

/**
 * Inspects a recognized block's product cards to determine whether explicit product numbering exists,
 * whether the section is eligible for the Starting Product Number control, what the first product number is,
 * and whether any warning should be surfaced.
 */
export function computeBlockNumberingInfo(block: RecognizedBlock): BlockNumberingInfo {
  const sectionKey = getBlockNumberingKey(block);
  const totalCardCount = block.productCards.length;
  if (totalCardCount === 0) {
    return {
      sectionKey,
      isProductSection: false,
      isNumberedProductSection: false,
      hasExplicitNumbering: false,
      hasPartialNumbering: false,
      numberedCardCount: 0,
      totalCardCount: 0,
      detectedStartingNumber: null,
    };
  }

  let numberedCardCount = 0;
  let detectedStartingNumber: number | null = null;

  block.productCards.forEach((card, idx) => {
    const parsed = card.fields.rankNumber?.parsedNumber;
    if (parsed !== undefined && Number.isInteger(parsed) && parsed >= 1) {
      numberedCardCount++;
      if (detectedStartingNumber === null) {
        detectedStartingNumber = Math.max(1, parsed - idx);
      }
    }
  });

  const hasExplicitNumbering = numberedCardCount > 0;
  const hasPartialNumbering = numberedCardCount > 0 && numberedCardCount < totalCardCount;
  const isNumberedProductSection = isSectionEligibleForProductNumbering(
    block,
    hasExplicitNumbering
  );

  let warningMessage: string | undefined;
  if (!hasExplicitNumbering) {
    warningMessage =
      'This section’s HTML does not contain explicit product number elements. Existing markup will be preserved without injecting new number badges.';
  } else if (hasPartialNumbering) {
    warningMessage = `Only ${numberedCardCount} of ${totalCardCount} products in this section contain recognizable number markup. Unnumbered cards will keep their existing HTML structure.`;
  }

  return {
    sectionKey,
    isProductSection: true,
    isNumberedProductSection,
    hasExplicitNumbering,
    hasPartialNumbering,
    numberedCardCount,
    totalCardCount,
    detectedStartingNumber,
    warningMessage,
  };
}

/**
 * Resolves the Starting Product Number map for all numbered product sections in a document.
 * - Uses saved project values when present (`savedMap[sectionKey]`).
 * - Otherwise defaults to the section's existing first product number when detected in HTML.
 * - Otherwise initializes a sensible positive integer based on the section's position and preceding numbered sections.
 */
export function resolveSectionStartingNumbers(
  blocks: RecognizedBlock[],
  savedMap?: Record<string, number>
): Record<string, number> {
  const resolved: Record<string, number> = {};
  if (savedMap) {
    for (const [k, v] of Object.entries(savedMap)) {
      if (typeof v === 'number' && Number.isInteger(v) && v >= 1) {
        resolved[k] = v;
      }
    }
  }

  let runningNextStart = 1;
  for (const block of blocks) {
    if (block.productCards.length === 0) continue;
    const info = block.numberingInfo || computeBlockNumberingInfo(block);
    if (!info.isNumberedProductSection) continue;

    const key = info.sectionKey;

    let sectionStart: number;
    const savedVal = resolved[key];
    if (typeof savedVal === 'number' && Number.isInteger(savedVal) && savedVal >= 1) {
      sectionStart = savedVal;
    } else if (
      info.detectedStartingNumber !== null &&
      Number.isInteger(info.detectedStartingNumber) &&
      info.detectedStartingNumber >= 1
    ) {
      sectionStart = info.detectedStartingNumber;
    } else {
      sectionStart = runningNextStart;
    }

    resolved[key] = sectionStart;
    runningNextStart = Math.max(1, sectionStart + block.productCards.length);
  }

  return resolved;
}

/**
 * Internal helper that updates product numbers in place on a parsed AST for a list of product card AST nodes.
 */
function renumberProductCardAstNodesInPlace(
  rootChildren: HtmlAstNode[],
  cardNodes: HtmlAstNode[],
  startingNumber: number,
  catalogProducts: Product[] = []
): number {
  const validStart = Math.max(1, Math.floor(startingNumber));
  let updatedCount = 0;

  cardNodes.forEach((cardAstNode, idx) => {
    const targetNum = validStart + idx;
    const analyzedCard = analyzeProductCardNode(cardAstNode, 'generic_card', catalogProducts);
    if (analyzedCard.fields.rankNumber) {
      const rankNode = getNodeByPath(rootChildren, analyzedCard.fields.rankNumber.nodePath);
      if (rankNode && rankNode.type === 'element') {
        const formatted = formatProductRankValue(
          analyzedCard.fields.rankNumber.value,
          targetNum,
          analyzedCard.fields.rankNumber.mode || 'element'
        );
        setElementTextPreservingInnerLink(rankNode, formatted);
        if (hasAttr(rankNode, 'data-product-number')) {
          setAttr(rankNode, 'data-product-number', String(targetNum));
        }
        if (hasAttr(rankNode, 'data-rank')) {
          setAttr(rankNode, 'data-rank', String(targetNum));
        }
        if (hasAttr(rankNode, 'data-item-number')) {
          setAttr(rankNode, 'data-item-number', String(targetNum));
        }
        updatedCount++;
      }
    }
    if (hasAttr(cardAstNode, 'data-product-number')) {
      setAttr(cardAstNode, 'data-product-number', String(targetNum));
    }
    if (hasAttr(cardAstNode, 'data-rank')) {
      setAttr(cardAstNode, 'data-rank', String(targetNum));
    }
  });

  return updatedCount;
}

/**
 * Updates product numbers for all products belonging to a single recognized section,
 * starting at `startingNumber` (`startingNumber + productIndexWithinSection`).
 * Never modifies other sections or injects new visible badges into unnumbered HTML.
 */
export function updateSectionProductNumbering(
  html: string,
  blockNodePath: string,
  startingNumber: number,
  catalogProducts: Product[] = []
): {
  html: string;
  updatedCount: number;
  hasExplicitNumbering: boolean;
  warningMessage?: string;
} {
  if (!Number.isInteger(startingNumber) || startingNumber < 1) {
    return {
      html,
      updatedCount: 0,
      hasExplicitNumbering: false,
      warningMessage: 'Starting Product Number must be a positive integer (1 or greater).',
    };
  }

  const { rootChildren } = parseHtmlToAst(html);
  const blockNode = getNodeByPath(rootChildren, blockNodePath);
  if (!blockNode || blockNode.type !== 'element') {
    return {
      html,
      updatedCount: 0,
      hasExplicitNumbering: false,
      warningMessage: 'Target section could not be located in the HTML document.',
    };
  }

  const analyzedBlock = analyzeTopLevelElement(blockNode, 0, catalogProducts);
  const info = computeBlockNumberingInfo(analyzedBlock);

  if (!info.hasExplicitNumbering) {
    return {
      html,
      updatedCount: 0,
      hasExplicitNumbering: false,
      warningMessage: info.warningMessage,
    };
  }

  const cardAstNodes = analyzedBlock.productCards
    .map((c) => getNodeByPath(rootChildren, c.cardNodePath))
    .filter((n): n is HtmlAstNode => Boolean(n && n.type === 'element'));

  const updatedCount = renumberProductCardAstNodesInPlace(
    rootChildren,
    cardAstNodes,
    startingNumber,
    catalogProducts
  );

  return {
    html: serializeAstToHtml(rootChildren),
    updatedCount,
    hasExplicitNumbering: true,
    warningMessage: info.warningMessage,
  };
}

function deepCloneAstNode(node: HtmlAstNode): HtmlAstNode {
  return {
    ...node,
    attrs: node.attrs ? node.attrs.map((a) => ({ ...a })) : undefined,
    children: node.children ? node.children.map((c) => deepCloneAstNode(c)) : undefined,
  };
}

export interface RepeatedGroupMutationOptions {
  startingNumber?: number;
}

/**
 * Adds a new item to a repeated group (product cards, TOC bookmarks, FAQs, buying guide pillars, or category cards)
 * by cloning the detected structure of the group's last item.
 * When adding a product card to a numbered section, automatically recalculates that section's product numbers
 * from its configured starting number without altering any other section.
 */
export function addRepeatedGroupItem(
  html: string,
  containerNodePath: string,
  catalogProduct?: Product,
  options?: RepeatedGroupMutationOptions
): string {
  const { rootChildren } = parseHtmlToAst(html);
  const container = getNodeByPath(rootChildren, containerNodePath);
  if (!container || container.type !== 'element' || !container.children) return html;

  const elementChildren = container.children.filter((c) => c.type === 'element');
  if (elementChildren.length === 0) return html;

  const existingProductCards = elementChildren.filter((c) => isLikelyProductCardElement(c));
  let detectedSectionStart = 1;
  if (
    options?.startingNumber !== undefined &&
    Number.isInteger(options.startingNumber) &&
    options.startingNumber >= 1
  ) {
    detectedSectionStart = options.startingNumber;
  } else if (existingProductCards.length > 0) {
    const firstAnalyzed = analyzeProductCardNode(existingProductCards[0], 'generic_card', []);
    if (
      firstAnalyzed.fields.rankNumber?.parsedNumber !== undefined &&
      firstAnalyzed.fields.rankNumber.parsedNumber >= 1
    ) {
      detectedSectionStart = firstAnalyzed.fields.rankNumber.parsedNumber;
    }
  }

  const templateNode = elementChildren[elementChildren.length - 1];
  const cloned = deepCloneAstNode(templateNode);

  const nextCount = elementChildren.length + 1;
  const nextProductNum =
    existingProductCards.length > 0
      ? detectedSectionStart + existingProductCards.length
      : nextCount;
  const paddedNum = String(nextProductNum).padStart(2, '0');

  // Increment FAQ badges or buying guide pillar numbers if present
  const faqBadge = findDescendant(cloned, (el) => hasClass(el, 'sog-faq-badge'));
  if (faqBadge) {
    setElementTextPreservingInnerLink(faqBadge, `Q${String(nextCount).padStart(2, '0')}`);
  }
  const pillarNum = findDescendant(cloned, (el) => hasClass(el, 'sog-bg-num'));
  if (pillarNum) {
    setElementTextPreservingInnerLink(
      pillarNum,
      `${String(nextCount).padStart(2, '0')} / NEW PILLAR`
    );
  }

  // Ensure cloned element doesn't create a duplicate ID
  if (hasAttr(cloned, 'id')) {
    const oldId = getAttr(cloned, 'id');
    setAttr(cloned, 'id', `${oldId.replace(/-\d+$/, '')}-${ paddedNum }`);
  }

  // Append with clean newline spacing
  container.children.push({ type: 'text', path: '', content: '\n    ' });
  container.children.push(cloned);

  assignAstPaths(rootChildren);

  // If this container holds product cards, renumber all product cards in this container from detectedSectionStart
  const updatedProductCards = container.children.filter(
    (c) => c.type === 'element' && isLikelyProductCardElement(c)
  );
  if (updatedProductCards.length > 0) {
    renumberProductCardAstNodesInPlace(
      rootChildren,
      updatedProductCards,
      detectedSectionStart,
      catalogProduct ? [catalogProduct] : []
    );
  }

  let updatedHtml = serializeAstToHtml(rootChildren);

  if (catalogProduct && isLikelyProductCardElement(cloned)) {
    const reanalyzed = parseHtmlToAst(updatedHtml);
    const newContainer = getNodeByPath(reanalyzed.rootChildren, containerNodePath);
    const newElements = (newContainer?.children || []).filter((c) => c.type === 'element');
    const lastEl = newElements[newElements.length - 1];
    if (lastEl) {
      const cardInfo = analyzeProductCardNode(lastEl, 'generic_card', [catalogProduct]);
      updatedHtml = applyCatalogProductToCard(updatedHtml, cardInfo, catalogProduct, {
        replaceDescription: true,
        replaceSpecs: true,
      });
    }
  }

  return updatedHtml;
}

/**
 * Removes a specific item node from its parent container.
 * When removing a product card from a numbered section, automatically recalculates the remaining
 * product numbers in that section from its starting number without altering any other section.
 */
export function removeRepeatedGroupItem(
  html: string,
  itemNodePath: string,
  options?: RepeatedGroupMutationOptions
): string {
  const parts = itemNodePath.split('.');
  const childIdx = Number(parts.pop());
  const parentPath = parts.join('.');

  const { rootChildren } = parseHtmlToAst(html);
  const parentNode = parentPath ? getNodeByPath(rootChildren, parentPath) : undefined;
  const parentChildren = parentPath ? parentNode?.children : rootChildren;

  if (!parentChildren || Number.isNaN(childIdx) || childIdx < 0 || childIdx >= parentChildren.length) {
    return html;
  }

  // Detect the section's starting product number before removing the item
  const existingProductCards = parentChildren.filter(
    (c) => c.type === 'element' && isLikelyProductCardElement(c)
  );
  let detectedSectionStart: number | null = null;
  if (
    options?.startingNumber !== undefined &&
    Number.isInteger(options.startingNumber) &&
    options.startingNumber >= 1
  ) {
    detectedSectionStart = options.startingNumber;
  } else if (existingProductCards.length > 0) {
    for (let i = 0; i < existingProductCards.length; i++) {
      const analyzed = analyzeProductCardNode(existingProductCards[i], 'generic_card', []);
      if (
        analyzed.fields.rankNumber?.parsedNumber !== undefined &&
        analyzed.fields.rankNumber.parsedNumber >= 1
      ) {
        detectedSectionStart = Math.max(1, analyzed.fields.rankNumber.parsedNumber - i);
        break;
      }
    }
  }

  parentChildren.splice(childIdx, 1);
  // Also trim leading whitespace text node if adjacent
  if (
    childIdx > 0 &&
    parentChildren[childIdx - 1]?.type === 'text' &&
    /^\s+$/.test(parentChildren[childIdx - 1].content || '')
  ) {
    parentChildren.splice(childIdx - 1, 1);
  }

  assignAstPaths(rootChildren);

  if (detectedSectionStart !== null) {
    const remainingProductCards = parentChildren.filter(
      (c) => c.type === 'element' && isLikelyProductCardElement(c)
    );
    if (remainingProductCards.length > 0) {
      renumberProductCardAstNodesInPlace(rootChildren, remainingProductCards, detectedSectionStart);
    }
  }

  return serializeAstToHtml(rootChildren);
}

/**
 * Reorders an element child within a repeated group container (`direction: 'up' | 'down'`).
 * When reordering product cards in a numbered section, automatically recalculates product numbers
 * in that section from its starting number without altering any other section.
 */
export function reorderRepeatedGroupItem(
  html: string,
  containerNodePath: string,
  itemNodePath: string,
  direction: 'up' | 'down',
  options?: RepeatedGroupMutationOptions
): string {
  const { rootChildren } = parseHtmlToAst(html);
  const container = getNodeByPath(rootChildren, containerNodePath);
  const children = container ? container.children : rootChildren;
  if (!children) return html;

  // Detect the section's starting product number before swapping
  const existingProductCards = children.filter(
    (c) => c.type === 'element' && isLikelyProductCardElement(c)
  );
  let detectedSectionStart: number | null = null;
  if (
    options?.startingNumber !== undefined &&
    Number.isInteger(options.startingNumber) &&
    options.startingNumber >= 1
  ) {
    detectedSectionStart = options.startingNumber;
  } else if (existingProductCards.length > 0) {
    for (let i = 0; i < existingProductCards.length; i++) {
      const analyzed = analyzeProductCardNode(existingProductCards[i], 'generic_card', []);
      if (
        analyzed.fields.rankNumber?.parsedNumber !== undefined &&
        analyzed.fields.rankNumber.parsedNumber >= 1
      ) {
        detectedSectionStart = Math.max(1, analyzed.fields.rankNumber.parsedNumber - i);
        break;
      }
    }
  }

  const elementIndices: number[] = [];
  children.forEach((c, idx) => {
    if (c.type === 'element') elementIndices.push(idx);
  });

  const currentElPos = elementIndices.findIndex(
    (rawIdx) => children[rawIdx].path === itemNodePath
  );
  if (currentElPos === -1) return html;

  const targetElPos = direction === 'up' ? currentElPos - 1 : currentElPos + 1;
  if (targetElPos < 0 || targetElPos >= elementIndices.length) return html;

  const idxA = elementIndices[currentElPos];
  const idxB = elementIndices[targetElPos];
  const temp = children[idxA];
  children[idxA] = children[idxB];
  children[idxB] = temp;

  assignAstPaths(rootChildren);

  if (detectedSectionStart !== null) {
    const reorderedProductCards = children.filter(
      (c) => c.type === 'element' && isLikelyProductCardElement(c)
    );
    if (reorderedProductCards.length > 0) {
      renumberProductCardAstNodesInPlace(rootChildren, reorderedProductCards, detectedSectionStart);
    }
  }

  return serializeAstToHtml(rootChildren);
}

// ============================================================================
// PREVIEW IMAGE RESOLUTION, FALLBACK PLACEHOLDERS & SANDBOX SANITIZATION
// ============================================================================

export interface SafePreviewOptions {
  baseUrl?: string;
}

/**
 * Checks whether an image `src` attribute is missing, empty, or a 1x1 transparent lazy-load spacer.
 */
export function isPlaceholderOrEmptyImageSrc(rawSrc: string | undefined | null): boolean {
  const trimmed = (rawSrc || '').trim();
  if (!trimmed) return true;
  if (trimmed === '#' || /^about:blank$/i.test(trimmed)) return true;
  if (/^javascript:/i.test(trimmed) || /^vbscript:/i.test(trimmed)) return true;
  // Common 1x1 transparent GIF / PNG lazy-loading placeholders
  if (/^data:image\/gif;base64,R0lGODlhAQABA/i.test(trimmed)) return true;
  if (/^data:image\/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB/i.test(trimmed)) return true;
  return false;
}

/**
 * Checks whether a candidate string looks like a Fourthwall `/products/...` page link rather than an image asset.
 */
function isStorefrontProductPagePath(rawUrl: string): boolean {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return false;
  try {
    const pathPart = trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? new URL(trimmed).pathname
      : trimmed.split('?')[0].split('#')[0];
    if (/^\/products\/[^/]+$/i.test(pathPart) && !/\.(?:jpg|jpeg|png|webp|gif|svg|avif)$/i.test(pathPart)) {
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

/**
 * Resolves a single image URL for the preview iframe without altering the exported HTML:
 * - Preserves `http://`, `https://`, `data:`, and `blob:` URLs.
 * - Normalizes protocol-relative URLs (`//cdn...` -> `https://cdn...`).
 * - Resolves root-relative (`/assets/...`) and path-relative (`images/...`, `../img/...`) URLs
 *   against `baseUrl` when a valid base URL is provided.
 * - Blocks dangerous schemes (`javascript:`, `vbscript:`, `data:text/html`).
 */
export function resolvePreviewUrl(rawUrl: string, baseUrl?: string): string {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return '';
  if (/^(?:javascript|vbscript):/i.test(trimmed)) return '';
  if (/^data:text\/html/i.test(trimmed)) return '';
  if (/^(?:https?:|data:|blob:)/i.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith('//')) {
    return `https:${trimmed}`;
  }

  const cleanBase = (baseUrl || '').trim();
  if (cleanBase && /^https?:\/\//i.test(cleanBase)) {
    try {
      return new URL(trimmed, cleanBase).toString();
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}

/**
 * Resolves all candidate URLs inside a `srcset` attribute (`url1 1x, url2 2x` or `url1 400w, url2 800w`)
 * against `baseUrl` when provided.
 */
export function resolvePreviewSrcset(rawSrcset: string, baseUrl?: string): string {
  const trimmed = (rawSrcset || '').trim();
  if (!trimmed) return '';

  // Split srcset candidates separated by commas (handling standard `url descriptor, url descriptor`)
  const parts = trimmed
    .split(/,\s+(?=\S)/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  return parts
    .map((entry) => {
      const tokens = entry.split(/\s+/);
      const rawCandidateUrl = tokens[0] || '';
      const descriptor = tokens.slice(1).join(' ');
      const resolvedUrl = resolvePreviewUrl(rawCandidateUrl, baseUrl);
      if (!resolvedUrl) return '';
      return descriptor ? `${resolvedUrl} ${descriptor}` : resolvedUrl;
    })
    .filter(Boolean)
    .join(', ');
}

/**
 * Extracts the first usable URL candidate from a `srcset` string.
 */
export function extractFirstUrlFromSrcset(rawSrcset: string): string {
  const trimmed = (rawSrcset || '').trim();
  if (!trimmed) return '';
  const firstEntry = trimmed.split(/,\s+(?=\S)/)[0]?.trim() || '';
  const firstToken = firstEntry.split(/\s+/)[0]?.trim() || '';
  return firstToken;
}

/**
 * Generates a neutral, high-legibility SVG placeholder data URI for missing or broken images in the preview.
 * Uses `preserveAspectRatio="xMidYMid meet"` and a neutral warm slate palette so any aspect ratio looks clean.
 */
export function buildNeutralPreviewPlaceholderSvg(
  label: string,
  subtitle = 'Image Preview Placeholder',
  isBrokenFallback = false
): string {
  const cleanLabel = (label || 'Product Image')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .slice(0, 72);
  const cleanSub = (subtitle || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .slice(0, 80);

  const words = cleanLabel.split(/\s+/);
  const line1 = words.slice(0, 4).join(' ');
  const line2 = words.slice(4, 9).join(' ');

  const bg = isBrokenFallback ? '#F5F2EB' : '#F3F1EC';
  const border = isBrokenFallback ? '#D6CFC2' : '#DCD6C8';
  const iconStroke = '#64748B';
  const titleColor = '#1E293B';
  const subColor = '#64748B';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="600" height="600" preserveAspectRatio="xMidYMid meet">
    <rect width="600" height="600" fill="${bg}"/>
    <rect x="28" y="28" width="544" height="544" rx="16" fill="none" stroke="${border}" stroke-width="2" stroke-dasharray="${isBrokenFallback ? '8 6' : 'none'}"/>
    <g transform="translate(240, 170)" fill="none" stroke="${iconStroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <rect x="10" y="10" width="100" height="80" rx="10" fill="#FFFFFF" fill-opacity="0.7"/>
      <circle cx="38" cy="36" r="9"/>
      <path d="M18 78 L48 50 L72 72 L88 56 L104 78"/>
    </g>
    <text x="300" y="330" text-anchor="middle" fill="${titleColor}" font-family="-apple-system, BlinkMacSystemFont, Georgia, serif" font-size="22" font-weight="600">${line1}</text>
    ${line2 ? `<text x="300" y="362" text-anchor="middle" fill="${titleColor}" font-family="-apple-system, BlinkMacSystemFont, Georgia, serif" font-size="20" font-weight="500">${line2}</text>` : ''}
    <text x="300" y="415" text-anchor="middle" fill="${subColor}" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="14" font-weight="600" letter-spacing="1.5">${cleanSub.toUpperCase()}</text>
    <text x="300" y="450" text-anchor="middle" fill="#94A3B8" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="13">Original HTML attributes preserved for export</text>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function getAttrFromList(attrs: HtmlAttr[], name: string): string {
  const lower = name.toLowerCase();
  const found = attrs.find((a) => a.name.toLowerCase() === lower);
  return found ? found.value : '';
}

function upsertAttrInList(attrs: HtmlAttr[], name: string, value: string): void {
  const lower = name.toLowerCase();
  const existingIdx = attrs.findIndex((a) => a.name.toLowerCase() === lower);
  if (existingIdx >= 0) {
    attrs[existingIdx] = {
      name: attrs[existingIdx].name,
      value,
      quote: attrs[existingIdx].quote || '"',
    };
  } else {
    attrs.push({ name, value, quote: '"' });
  }
}

function removeAttrFromList(attrs: HtmlAttr[], name: string): void {
  const lower = name.toLowerCase();
  for (let i = attrs.length - 1; i >= 0; i--) {
    if (attrs[i].name.toLowerCase() === lower) {
      attrs.splice(i, 1);
    }
  }
}

/**
 * Builds a sanitized, isolated HTML snippet for rendering inside the Live Preview iframe:
 * - Strips `<script>`, `<iframe>`, `<object>`, `<embed>`, `<applet>`, `<base>` tags and `on*` event attributes
 *   so pasted scripts NEVER execute in the preview.
 * - Supports standard `src`, `srcset`, and common lazy-loading attributes (`data-src`, `data-lazy-src`,
 *   `data-original`, `data-srcset`, `data-lazy-srcset`).
 * - Resolves relative image URLs against `options.baseUrl` when known.
 * - Resolves Fourthwall `data-product-url` or enclosing product card links against `catalogProducts`,
 *   or provides a clean neutral placeholder when an image source is missing.
 * - NEVER alters the exported HTML source!
 */
export function buildSafePreviewHtml(
  rawHtml: string,
  catalogProducts: Product[] = [],
  options: SafePreviewOptions = {}
): string {
  const { rootChildren } = parseHtmlToAst(rawHtml);
  const configuredBaseUrl = (options.baseUrl || '').trim();

  const sanitizeNodes = (
    nodes: HtmlAstNode[],
    contextLinkHref = '',
    contextCardUrl = ''
  ): HtmlAstNode[] => {
    const result: HtmlAstNode[] = [];
    for (const node of nodes) {
      if (node.type === 'element') {
        const tag = (node.tagName || '').toLowerCase();
        // 1. Block dangerous active tags in preview
        if (
          tag === 'script' ||
          tag === 'iframe' ||
          tag === 'object' ||
          tag === 'embed' ||
          tag === 'applet' ||
          tag === 'base'
        ) {
          continue;
        }
        if (
          tag === 'meta' &&
          getAttr(node, 'http-equiv').toLowerCase().trim() === 'refresh'
        ) {
          continue;
        }

        // 2. Strip inline event handlers (on*) and dangerous URI schemes
        const cleanAttrs: HtmlAttr[] = (node.attrs || [])
          .filter((a) => {
            const lower = a.name.toLowerCase();
            if (lower.startsWith('on')) return false;
            if (
              (lower === 'href' ||
                lower === 'src' ||
                lower === 'action' ||
                lower === 'formaction' ||
                lower === 'xlink:href') &&
              /^\s*(?:javascript:|vbscript:|data:text\/html)/i.test(a.value)
            ) {
              return false;
            }
            return true;
          })
          .map((a) => ({ ...a }));

        // Track enclosing link or product card context for descendant <img> elements
        let nextLinkHref = contextLinkHref;
        if (tag === 'a') {
          const hrefVal = getAttrFromList(cleanAttrs, 'href').trim();
          if (hrefVal && !hrefVal.startsWith('#')) {
            nextLinkHref = hrefVal;
          }
        }

        let nextCardUrl = contextCardUrl;
        if (isLikelyProductCardElement(node)) {
          const cardDataUrl = getAttrFromList(cleanAttrs, 'data-product-url').trim();
          if (cardDataUrl) {
            nextCardUrl = cardDataUrl;
          } else {
            const firstProductLink = findAllDescendants(
              node,
              (el) => el.tagName?.toLowerCase() === 'a'
            )
              .map((a) => getAttr(a, 'href').trim())
              .find((h) => h && !h.startsWith('#'));
            if (firstProductLink) {
              nextCardUrl = firstProductLink;
            }
          }
        }

        // 3. Handle <source> elements inside <picture>
        if (tag === 'source') {
          const rawSrcset =
            getAttrFromList(cleanAttrs, 'srcset').trim() ||
            getAttrFromList(cleanAttrs, 'data-srcset').trim() ||
            getAttrFromList(cleanAttrs, 'data-lazy-srcset').trim();
          if (rawSrcset) {
            const resolvedSet = resolvePreviewSrcset(rawSrcset, configuredBaseUrl);
            if (resolvedSet) {
              upsertAttrInList(cleanAttrs, 'srcset', resolvedSet);
            }
          }
        }

        // 4. Handle <img> elements (standard src, srcset, lazy data-src/data-srcset, relative URLs, and fallbacks)
        if (tag === 'img') {
          const rawSrc = getAttrFromList(cleanAttrs, 'src').trim();
          const lazySrc =
            getAttrFromList(cleanAttrs, 'data-src').trim() ||
            getAttrFromList(cleanAttrs, 'data-lazy-src').trim() ||
            getAttrFromList(cleanAttrs, 'data-original').trim() ||
            getAttrFromList(cleanAttrs, 'data-lazy').trim() ||
            getAttrFromList(cleanAttrs, 'data-image').trim() ||
            getAttrFromList(cleanAttrs, 'data-url').trim();

          const rawSrcset =
            getAttrFromList(cleanAttrs, 'srcset').trim() ||
            getAttrFromList(cleanAttrs, 'data-srcset').trim() ||
            getAttrFromList(cleanAttrs, 'data-lazy-srcset').trim();

          const dataProductUrl = getAttrFromList(cleanAttrs, 'data-product-url').trim();
          const altVal = getAttrFromList(cleanAttrs, 'alt').trim();

          // Identify if this image belongs to a product in the catalog
          const candidateProductLink =
            dataProductUrl ||
            (isStorefrontProductPagePath(rawSrc) ? rawSrc : '') ||
            (isStorefrontProductPagePath(lazySrc) ? lazySrc : '') ||
            nextLinkHref ||
            nextCardUrl;

          const normProdUrl = candidateProductLink
            ? normalizeProductUrlForMatch(candidateProductLink)
            : '';

          let matchedProd = normProdUrl
            ? catalogProducts.find(
                (p) => normalizeProductUrlForMatch(p.productUrl) === normProdUrl
              )
            : undefined;

          if (!matchedProd && altVal) {
            const lowerAlt = altVal.toLowerCase();
            matchedProd = catalogProducts.find(
              (p) => p.name && p.name.trim().toLowerCase() === lowerAlt
            );
          }

          // Determine effective base URL for resolving relative paths
          let effectiveBaseUrl = configuredBaseUrl;
          if (!effectiveBaseUrl && matchedProd?.productUrl && /^https?:\/\//i.test(matchedProd.productUrl)) {
            try {
              effectiveBaseUrl = new URL(matchedProd.productUrl).origin;
            } catch {
              // ignore
            }
          }

          // Resolve srcset if present
          let resolvedSrcset = '';
          if (rawSrcset) {
            resolvedSrcset = resolvePreviewSrcset(rawSrcset, effectiveBaseUrl);
            if (resolvedSrcset) {
              upsertAttrInList(cleanAttrs, 'srcset', resolvedSrcset);
            }
          }

          // Determine primary candidate image URL
          const hasUsableDirectSrc =
            !isPlaceholderOrEmptyImageSrc(rawSrc) && !isStorefrontProductPagePath(rawSrc);
          const hasUsableLazySrc =
            !isPlaceholderOrEmptyImageSrc(lazySrc) && !isStorefrontProductPagePath(lazySrc);

          let chosenSrc = '';
          if (hasUsableDirectSrc) {
            chosenSrc = resolvePreviewUrl(rawSrc, effectiveBaseUrl);
          } else if (hasUsableLazySrc) {
            chosenSrc = resolvePreviewUrl(lazySrc, effectiveBaseUrl);
          } else if (resolvedSrcset) {
            chosenSrc = extractFirstUrlFromSrcset(resolvedSrcset);
          }

          // If still no usable image URL, check matched catalog product's stored image(s)
          if (!chosenSrc && matchedProd) {
            const catalogImg =
              matchedProd.imageUrl?.trim() ||
              (matchedProd.imageUrls && matchedProd.imageUrls[0]?.trim()) ||
              '';
            if (catalogImg && !isPlaceholderOrEmptyImageSrc(catalogImg)) {
              chosenSrc = resolvePreviewUrl(catalogImg, effectiveBaseUrl);
            }
          }

          // If still no usable image URL, provide a clean placeholder so the preview layout remains complete
          if (!chosenSrc) {
            if (matchedProd) {
              chosenSrc = buildEditorialSvgDataUri(
                altVal || matchedProd.name || 'Fourthwall Product',
                matchedProd.category || matchedProd.productType || 'Preview'
              );
            } else {
              chosenSrc = buildNeutralPreviewPlaceholderSvg(
                altVal || (dataProductUrl ? dataProductUrl.replace(/^\/products\//, '').replace(/-/g, ' ') : 'Image Placeholder'),
                dataProductUrl ? 'Fourthwall Storefront Auto-Image' : 'Missing Image Source'
              );
            }
          }

          // Replace or insert `src` cleanly (never leaving a duplicate empty `src=""` before it!)
          upsertAttrInList(cleanAttrs, 'src', chosenSrc);

          // Record original src and optional catalog fallback for runtime broken-image recovery
          if (rawSrc || lazySrc) {
            upsertAttrInList(cleanAttrs, 'data-preview-original-src', rawSrc || lazySrc);
          }
          if (matchedProd) {
            const catalogImg =
              matchedProd.imageUrl?.trim() ||
              (matchedProd.imageUrls && matchedProd.imageUrls[0]?.trim()) ||
              '';
            if (catalogImg && !isPlaceholderOrEmptyImageSrc(catalogImg)) {
              const resolvedCatalogImg = resolvePreviewUrl(catalogImg, effectiveBaseUrl);
              if (resolvedCatalogImg && resolvedCatalogImg !== chosenSrc) {
                upsertAttrInList(cleanAttrs, 'data-preview-catalog-fallback-src', resolvedCatalogImg);
              }
            }
          }

          // Remove `loading="lazy"` in preview iframe so images render immediately
          if (getAttrFromList(cleanAttrs, 'loading').toLowerCase() === 'lazy') {
            removeAttrFromList(cleanAttrs, 'loading');
          }

          // Add referrerpolicy="no-referrer" if not set so external CDNs do not block iframe preview requests
          if (!getAttrFromList(cleanAttrs, 'referrerpolicy')) {
            upsertAttrInList(cleanAttrs, 'referrerpolicy', 'no-referrer');
          }
        }

        result.push({
          ...node,
          attrs: cleanAttrs,
          children: node.children
            ? sanitizeNodes(node.children, nextLinkHref, nextCardUrl)
            : [],
        });
      } else {
        result.push(node);
      }
    }
    return result;
  };

  const safeAst = sanitizeNodes(rootChildren);
  return serializeAstToHtml(safeAst);
}

/**
 * Attaches runtime broken-image (`error`) listeners directly to `<img>` nodes inside
 * a sandboxed preview document (`sandbox="allow-same-origin"` without `allow-scripts`).
 * If an image fails to load at runtime, swaps in either the matched catalog image
 * or a clean neutral placeholder SVG inside the preview DOM only, leaving exported HTML untouched.
 */
export function attachPreviewImageFallbacks(doc: Document | null | undefined): void {
  if (!doc) return;
  const images = Array.from(doc.querySelectorAll('img'));

  const handleImageFailure = (img: HTMLImageElement) => {
    const stage = img.getAttribute('data-sog-fallback-stage') || 'none';
    if (stage === 'svg') return;

    const catalogFallback = img.getAttribute('data-preview-catalog-fallback-src');
    if (stage === 'none' && catalogFallback && img.src !== catalogFallback) {
      img.setAttribute('data-sog-fallback-stage', 'catalog');
      img.removeAttribute('srcset');
      img.src = catalogFallback;
      return;
    }

    img.setAttribute('data-sog-fallback-stage', 'svg');
    img.removeAttribute('srcset');
    const label =
      img.getAttribute('alt')?.trim() ||
      img.getAttribute('data-product-url')?.replace(/^\/products\//, '').replace(/-/g, ' ') ||
      'Product Image';
    const originalSrc = img.getAttribute('data-preview-original-src') || '';
    const subtitle = originalSrc
      ? 'Image failed to load in preview'
      : 'Missing image source';
    img.src = buildNeutralPreviewPlaceholderSvg(label, subtitle, true);
  };

  for (const img of images) {
    img.addEventListener('error', () => {
      handleImageFailure(img);
    });

    // Handle images that already failed synchronously before the load listener attached
    const currentSrc = img.getAttribute('src') || '';
    if (
      img.complete &&
      img.naturalWidth === 0 &&
      currentSrc &&
      !currentSrc.startsWith('data:image/svg+xml')
    ) {
      handleImageFailure(img);
    }
  }
}

// ============================================================================
// FOURTHWALL 30,000-CHARACTER EXPORT EVALUATION & MULTI-SECTION PROJECT ENGINE
// ============================================================================

export const FOURTHWALL_CHAR_LIMIT = 30_000;
export const FOURTHWALL_CHAR_WARNING_THRESHOLD = 25_000;

export interface HtmlExportPayload {
  html: string;
  charCount: number;
  characterCount: number;
  approachesLimit: boolean;
  approachingFourthwallLimit: boolean;
  exceedsLimit: boolean;
  exceedsFourthwallLimit: boolean;
  remainingChars: number;
  remainingCharacters: number;
  overLimitChars: number;
  warningMessage?: string;
}

/**
 * Evaluates an exported HTML string against Fourthwall's 30,000-character paste limit.
 * Never truncates, splits, or modifies the HTML content.
 */
export function evaluateHtmlExportSize(html: string): HtmlExportPayload {
  const safeHtml = typeof html === 'string' ? html : '';
  const charCount = safeHtml.length;
  const exceedsLimit = charCount > FOURTHWALL_CHAR_LIMIT;
  const approachesLimit = !exceedsLimit && charCount >= FOURTHWALL_CHAR_WARNING_THRESHOLD;
  const remainingChars = Math.max(0, FOURTHWALL_CHAR_LIMIT - charCount);
  const overLimitChars = Math.max(0, charCount - FOURTHWALL_CHAR_LIMIT);

  let warningMessage: string | undefined;
  if (exceedsLimit) {
    warningMessage = `This HTML is ${charCount.toLocaleString()} characters, which exceeds Fourthwall's 30,000-character limit by ${overLimitChars.toLocaleString()} characters. Export individual sections to paste into Fourthwall without truncation.`;
  } else if (approachesLimit) {
    warningMessage = `This HTML is ${charCount.toLocaleString()} characters, approaching Fourthwall's 30,000-character limit (${remainingChars.toLocaleString()} characters remaining).`;
  }

  return {
    html: safeHtml,
    charCount,
    characterCount: charCount,
    approachesLimit,
    approachingFourthwallLimit: approachesLimit,
    exceedsLimit,
    exceedsFourthwallLimit: exceedsLimit,
    remainingChars,
    remainingCharacters: remainingChars,
    overLimitChars,
    warningMessage,
  };
}

/**
 * Concatenates an ordered list of HtmlProjectSection records into the project's full HTML string.
 */
export function joinProjectSectionsHtml(sections: HtmlProjectSection[]): string {
  const sorted = [...sections].sort((a, b) => a.order - b.order);
  return sorted
    .map((s) => s.htmlContent.trim())
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Analyzes a single HtmlProjectSection into a RecognizedBlock while preserving root-relative AST node paths
 * so all visual field edits apply directly to `section.htmlContent`.
 */
export function analyzeSingleProjectSection(
  section: HtmlProjectSection,
  index: number,
  catalogProducts: Product[] = []
): RecognizedBlock {
  const { rootChildren } = parseHtmlToAst(section.htmlContent);
  const topElements = rootChildren.filter((c) => c.type === 'element');

  let analyzedBlock: RecognizedBlock;
  if (topElements.length === 1) {
    analyzedBlock = analyzeTopLevelElement(topElements[0], index, catalogProducts);
  } else if (topElements.length > 1) {
    // Wrap multiple root nodes in a virtual container without altering their rootChildren paths ("0", "1", ...)
    const virtualRoot: HtmlAstNode = {
      type: 'element',
      path: '',
      tagName: 'section',
      attrs: [],
      children: rootChildren,
    };
    analyzedBlock = analyzeTopLevelElement(virtualRoot, index, catalogProducts);
  } else {
    analyzedBlock = {
      id: section.id,
      sectionId: section.id,
      nodePath: '',
      tagName: 'div',
      elementId: '',
      className: '',
      blockType: 'raw_fallback',
      label: section.name || `Section ${index + 1}`,
      textFields: [],
      links: [],
      images: [],
      productCards: [],
      tocItems: [],
      faqItems: [],
      pillarItems: [],
      categoryCards: [],
      rawHtmlSnippet: section.htmlContent,
    };
  }

  analyzedBlock.id = section.id;
  analyzedBlock.sectionId = section.id;
  analyzedBlock.rawHtmlSnippet = section.htmlContent;
  if (section.manualType) {
    analyzedBlock.manualType = section.manualType;
    analyzedBlock.blockType = section.manualType;
  }
  if (section.name && section.name.trim()) {
    analyzedBlock.label = section.name.trim();
  }
  analyzedBlock.numberingInfo = computeBlockNumberingInfo(analyzedBlock);
  return analyzedBlock;
}

/**
 * Splits a raw HTML string into one or more initial HtmlProjectSection records.
 * Used when migrating legacy single-string projects or when replacing project HTML.
 */
export function deriveProjectSectionsFromHtml(
  rawHtml: string,
  catalogProducts: Product[] = [],
  savedStartingNumbers?: Record<string, number>
): HtmlProjectSection[] {
  const trimmed = (rawHtml || '').trim();
  if (!trimmed) return [];

  const { rootChildren } = parseHtmlToAst(trimmed);
  const topElements = rootChildren.filter((c) => c.type === 'element');
  if (topElements.length === 0) {
    const nowIso = new Date().toISOString();
    return [
      {
        id: `sec-1-${Date.now().toString(36)}`,
        name: 'Custom HTML Section',
        order: 0,
        htmlContent: trimmed,
        originalHtml: trimmed,
        type: 'raw_fallback',
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ];
  }

  let candidateElements = topElements;
  if (topElements.length === 1) {
    const singleRoot = topElements[0];
    const rootTag = (singleRoot.tagName || '').toLowerCase();
    const directChildren = (singleRoot.children || []).filter((c) => c.type === 'element');
    const isSingleSectionItself =
      hasClass(singleRoot, 'sog-toc-box') ||
      hasClass(singleRoot, 'sog-quick-picks') ||
      hasClass(singleRoot, 'sog-editor-pick') ||
      hasClass(singleRoot, 'sog-editorial-list') ||
      hasClass(singleRoot, 'sog-more-section') ||
      hasClass(singleRoot, 'sog-deity-grid') ||
      hasClass(singleRoot, 'sog-guide-faq-section');

    if (
      !isSingleSectionItself &&
      directChildren.length >= 2 &&
      ['div', 'main', 'article', 'body'].includes(rootTag)
    ) {
      const childSectionCount = directChildren.filter(
        (c) =>
          (c.tagName || '').toLowerCase() === 'section' ||
          (c.tagName || '').toLowerCase() === 'nav' ||
          hasClass(c, 'sog-guide-container') ||
          hasClass(c, 'product-section') ||
          hasClass(c, 'sog-toc-box') ||
          hasClass(c, 'sog-quick-picks') ||
          hasClass(c, 'sog-editor-pick') ||
          hasClass(c, 'sog-editorial-list') ||
          hasClass(c, 'sog-more-section') ||
          hasClass(c, 'sog-deity-grid') ||
          hasClass(c, 'sog-guide-faq-section')
      ).length;
      if (childSectionCount >= 2) {
        candidateElements = directChildren;
      }
    }
  }

  // Check if multiple top-level elements are merely prose elements (e.g. <h2> + <p> + <p>) that belong to a single editorial fragment
  const allAreSimpleProseTags =
    candidateElements.length > 1 &&
    candidateElements.every((el) => {
      const t = (el.tagName || '').toLowerCase();
      return (
        ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'blockquote'].includes(t) &&
        !hasClass(el, 'sog-chapter-banner') &&
        !hasClass(el, 'sog-toc-box')
      );
    });

  const fragments: string[] = allAreSimpleProseTags
    ? [trimmed]
    : candidateElements.length === 1 && topElements.length === 1
    ? [trimmed]
    : candidateElements.map((el) => serializeAstToHtml([el]).trim()).filter(Boolean);

  const nowIso = new Date().toISOString();
  const tempSections: HtmlProjectSection[] = fragments.map((fragHtml, idx) => {
    const secId = `sec-${idx + 1}-${Math.random().toString(36).slice(2, 7)}`;
    const draftSec: HtmlProjectSection = {
      id: secId,
      name: '',
      order: idx,
      htmlContent: fragHtml,
      originalHtml: fragHtml,
      type: 'content_section',
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    const analyzed = analyzeSingleProjectSection(draftSec, idx, catalogProducts);
    draftSec.name = analyzed.label || `Section ${idx + 1}`;
    draftSec.type = analyzed.blockType;
    return draftSec;
  });

  // Resolve starting product numbers for eligible numbered product sections
  const analyzedBlocks = tempSections.map((s, idx) =>
    analyzeSingleProjectSection(s, idx, catalogProducts)
  );
  const resolvedMap = resolveSectionStartingNumbers(analyzedBlocks, savedStartingNumbers);
  tempSections.forEach((sec, idx) => {
    const blk = analyzedBlocks[idx];
    if (blk.numberingInfo?.isNumberedProductSection) {
      const key = getBlockNumberingKey(blk);
      const legacyPathKey = `path:${idx}`;
      sec.startingProductNumber =
        resolvedMap[key] ??
        (savedStartingNumbers ? savedStartingNumbers[legacyPathKey] : undefined) ??
        blk.numberingInfo.detectedStartingNumber ??
        1;
    }
  });

  return tempSections;
}

/**
 * Analyzes an ordered list of HtmlProjectSection records and produces a unified HtmlAnalysisReport.
 */
export function analyzeProjectSections(
  sections: HtmlProjectSection[],
  catalogProducts: Product[] = []
): HtmlAnalysisReport {
  const sorted = [...sections].sort((a, b) => a.order - b.order);
  const combinedHtml = joinProjectSectionsHtml(sorted);
  const blocks = sorted.map((sec, idx) => analyzeSingleProjectSection(sec, idx, catalogProducts));

  // Run full-document AST scan on combinedHtml for cross-section IDs, #anchor links, and validation diagnostics
  const fullDocReport = analyzeHtmlDocument(combinedHtml, catalogProducts);

  let productCardCount = 0;
  let matchedCatalogCount = 0;
  let faqCount = 0;
  let headingCount = 0;
  let linkCount = 0;
  let imageCount = 0;

  for (const b of blocks) {
    productCardCount += b.productCards.length;
    matchedCatalogCount += b.productCards.filter((c) => Boolean(c.matchedCatalogProductId)).length;
    if (b.nestedBlocks && b.nestedBlocks.length > 0) {
      for (const nb of b.nestedBlocks) {
        productCardCount += nb.productCards.length;
        matchedCatalogCount += nb.productCards.filter((c) =>
          Boolean(c.matchedCatalogProductId)
        ).length;
      }
    }
    faqCount += b.faqItems.length;
    headingCount += b.textFields.filter((t) => t.role === 'heading').length;
    linkCount += b.links.length + b.tocItems.length;
    imageCount +=
      b.images.length + b.productCards.filter((c) => Boolean(c.fields.image)).length;
  }

  return {
    originalHtml: combinedHtml,
    normalizedHtml: fullDocReport.normalizedHtml,
    blocks,
    allElementIds: fullDocReport.allElementIds,
    allInternalAnchorLinks: fullDocReport.allInternalAnchorLinks,
    validationIssues: fullDocReport.validationIssues,
    stats: {
      blockCount: blocks.length,
      productCardCount,
      matchedCatalogCount,
      faqCount,
      headingCount,
      linkCount,
      imageCount,
    },
  };
}

/**
 * Builds the `sectionStartingNumbers` map from `sections` for backward-compatible storage in `editorState`.
 */
export function buildSectionStartingNumbersMap(
  sections: HtmlProjectSection[],
  catalogProducts: Product[] = [],
  existingMap?: Record<string, number>
): Record<string, number> {
  const map: Record<string, number> = { ...(existingMap || {}) };
  sections.forEach((sec, idx) => {
    const blk = analyzeSingleProjectSection(sec, idx, catalogProducts);
    const key = getBlockNumberingKey(blk);
    if (
      blk.numberingInfo?.isNumberedProductSection &&
      sec.startingProductNumber !== undefined &&
      Number.isInteger(sec.startingProductNumber) &&
      sec.startingProductNumber >= 1
    ) {
      map[key] = sec.startingProductNumber;
    } else if (!blk.numberingInfo?.isNumberedProductSection) {
      delete map[key];
      delete map[`sec:${sec.id}`];
    }
  });
  return map;
}

/**
 * Ensures an HtmlEditorProject has a synchronized `sections` array in both `project.sections` and `project.editorState.sections`.
 * Safely migrates existing projects that only stored `currentHtml` as a single string.
 */
export function ensureProjectHasSections(
  project: HtmlEditorProject,
  catalogProducts: Product[] = []
): HtmlEditorProject {
  const rawSections = project.sections ?? project.editorState?.sections;
  if (Array.isArray(rawSections) && rawSections.length > 0) {
    const sorted = [...rawSections]
      .filter((s) => s && typeof s.id === 'string' && typeof s.htmlContent === 'string')
      .sort((a, b) => a.order - b.order)
      .map((s, idx) => ({
        ...s,
        order: idx,
      }));

    const joined = joinProjectSectionsHtml(sorted);
    // If currentHtml was modified directly (e.g., via Raw HTML editor or direct currentHtml update) and no longer matches joined sections,
    // synchronize sections from currentHtml while preserving matching section metadata
    if (
      typeof project.currentHtml === 'string' &&
      project.currentHtml.trim() !== joined.trim()
    ) {
      if (!project.currentHtml.trim()) {
        return {
          ...project,
          currentHtml: '',
          sections: [],
          editorState: {
            ...project.editorState,
            sections: [],
          },
        };
      }
      if (sorted.length === 1) {
        const updatedSingle: HtmlProjectSection = {
          ...sorted[0],
          htmlContent: project.currentHtml.trim(),
          updatedAt: new Date().toISOString(),
        };
        const blk = analyzeSingleProjectSection(updatedSingle, 0, catalogProducts);
        if (
          blk.numberingInfo?.isNumberedProductSection &&
          blk.numberingInfo.detectedStartingNumber !== null
        ) {
          updatedSingle.startingProductNumber = blk.numberingInfo.detectedStartingNumber;
        }
        const nextSecs = [updatedSingle];
        const nextStartingMap = buildSectionStartingNumbersMap(
          nextSecs,
          catalogProducts,
          project.editorState?.sectionStartingNumbers
        );
        return {
          ...project,
          currentHtml: project.currentHtml.trim(),
          sections: nextSecs,
          editorState: {
            ...project.editorState,
            sections: nextSecs,
            sectionStartingNumbers: nextStartingMap,
          },
        };
      }

      const rederived = deriveProjectSectionsFromHtml(
        project.currentHtml,
        catalogProducts,
        project.editorState?.sectionStartingNumbers
      ).map((sec, idx) => {
        const prev = sorted[idx];
        if (prev && prev.type === sec.type) {
          return {
            ...sec,
            id: prev.id,
            name: prev.name || sec.name,
            manualType: prev.manualType,
          };
        }
        return sec;
      });
      const nextStartingMap = buildSectionStartingNumbersMap(
        rederived,
        catalogProducts,
        project.editorState?.sectionStartingNumbers
      );
      return {
        ...project,
        currentHtml: joinProjectSectionsHtml(rederived),
        sections: rederived,
        editorState: {
          ...project.editorState,
          sections: rederived,
          sectionStartingNumbers: nextStartingMap,
        },
      };
    }

    const nextStartingMap = buildSectionStartingNumbersMap(
      sorted,
      catalogProducts,
      project.editorState?.sectionStartingNumbers
    );
    return {
      ...project,
      currentHtml: joined,
      sections: sorted,
      editorState: {
        ...project.editorState,
        sections: sorted,
        sectionStartingNumbers: nextStartingMap,
      },
    };
  }

  // Handle intentionally empty project (0 sections) when rawSections is explicitly an empty array and currentHtml is empty
  if (Array.isArray(rawSections) && rawSections.length === 0 && !project.currentHtml?.trim()) {
    return {
      ...project,
      currentHtml: '',
      sections: [],
      editorState: {
        ...project.editorState,
        sections: [],
      },
    };
  }

  const derived = deriveProjectSectionsFromHtml(
    project.currentHtml,
    catalogProducts,
    project.editorState?.sectionStartingNumbers
  );
  const joined = joinProjectSectionsHtml(derived);
  const nextStartingMap = buildSectionStartingNumbersMap(
    derived,
    catalogProducts,
    project.editorState?.sectionStartingNumbers
  );

  return {
    ...project,
    currentHtml: joined || project.currentHtml,
    sections: derived,
    editorState: {
      ...project.editorState,
      sections: derived,
      sectionStartingNumbers: nextStartingMap,
    },
  };
}

/**
 * Appends a new HTML section to an existing project without removing or overwriting any previously added sections.
 */
export function appendHtmlSectionToProject(
  project: HtmlEditorProject,
  newHtmlFragment: string,
  options?: {
    name?: string;
    manualType?: HtmlSectionCategory;
    startingProductNumber?: number;
  },
  catalogProducts: Product[] = []
): HtmlEditorProject {
  const trimmed = (newHtmlFragment || '').trim();
  if (!trimmed) {
    throw new Error('HTML section content cannot be empty.');
  }

  const normalizedProject = ensureProjectHasSections(project, catalogProducts);
  const existingSections = normalizedProject.sections || [];
  const nextOrder = existingSections.length;
  const nowIso = new Date().toISOString();
  const newSecId = `sec-${nextOrder + 1}-${Date.now().toString(36).slice(-4)}-${Math.random()
    .toString(36)
    .slice(2, 5)}`;

  const draftSec: HtmlProjectSection = {
    id: newSecId,
    name: options?.name?.trim() || '',
    order: nextOrder,
    htmlContent: trimmed,
    originalHtml: trimmed,
    type: options?.manualType || 'content_section',
    manualType: options?.manualType,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const analyzed = analyzeSingleProjectSection(draftSec, nextOrder, catalogProducts);
  draftSec.type = options?.manualType || analyzed.blockType;
  if (!draftSec.name) {
    draftSec.name = analyzed.label || `Section ${nextOrder + 1}`;
  }

  if (analyzed.numberingInfo?.isNumberedProductSection) {
    const startNum =
      options?.startingProductNumber !== undefined &&
      Number.isInteger(options.startingProductNumber) &&
      options.startingProductNumber >= 1
        ? options.startingProductNumber
        : analyzed.numberingInfo.detectedStartingNumber ?? 1;
    draftSec.startingProductNumber = startNum;
    if (
      options?.startingProductNumber !== undefined &&
      analyzed.numberingInfo.hasExplicitNumbering
    ) {
      const renumbered = updateSectionProductNumbering(
        draftSec.htmlContent,
        analyzed.nodePath,
        startNum,
        catalogProducts
      );
      draftSec.htmlContent = renumbered.html;
    }
  }

  const nextSections = [...existingSections, draftSec].map((s, idx) => ({
    ...s,
    order: idx,
  }));
  const nextCurrentHtml = joinProjectSectionsHtml(nextSections);
  const nextOriginalHtml = normalizedProject.originalHtml?.trim()
    ? `${normalizedProject.originalHtml.trim()}\n\n${trimmed}`
    : trimmed;
  const nextStartingMap = buildSectionStartingNumbersMap(
    nextSections,
    catalogProducts,
    normalizedProject.editorState?.sectionStartingNumbers
  );

  return {
    ...normalizedProject,
    currentHtml: nextCurrentHtml,
    originalHtml: nextOriginalHtml,
    sections: nextSections,
    editorState: {
      ...normalizedProject.editorState,
      sections: nextSections,
      sectionStartingNumbers: nextStartingMap,
    },
    updatedAt: nowIso,
  };
}

/**
 * Replaces the entire project's HTML content with newly imported HTML.
 */
export function replaceProjectHtmlContent(
  project: HtmlEditorProject,
  newHtml: string,
  options?: { name?: string },
  catalogProducts: Product[] = []
): HtmlEditorProject {
  const trimmed = (newHtml || '').trim();
  if (!trimmed) {
    throw new Error('Replacement HTML content cannot be empty.');
  }

  const nowIso = new Date().toISOString();
  const nextSections = deriveProjectSectionsFromHtml(trimmed, catalogProducts, {});
  if (options?.name?.trim() && nextSections.length === 1) {
    nextSections[0].name = options.name.trim();
  }
  const nextCurrentHtml = joinProjectSectionsHtml(nextSections);
  const nextStartingMap = buildSectionStartingNumbersMap(nextSections, catalogProducts, {});

  return {
    ...project,
    currentHtml: nextCurrentHtml,
    originalHtml: nextCurrentHtml,
    sections: nextSections,
    editorState: {
      ...project.editorState,
      selectedBlockId: 'ALL',
      sections: nextSections,
      sectionStartingNumbers: nextStartingMap,
    },
    updatedAt: nowIso,
  };
}

/**
 * Deletes a single section by its ID without deleting the project or affecting any other section.
 */
export function deleteProjectSectionById(
  project: HtmlEditorProject,
  sectionId: string,
  catalogProducts: Product[] = []
): HtmlEditorProject {
  const normalized = ensureProjectHasSections(project, catalogProducts);
  const existing = normalized.sections || [];
  const remaining = existing
    .filter((s) => s.id !== sectionId)
    .map((s, idx) => ({
      ...s,
      order: idx,
    }));

  const nowIso = new Date().toISOString();
  const nextCurrentHtml = joinProjectSectionsHtml(remaining);
  const nextStartingMap = buildSectionStartingNumbersMap(remaining, catalogProducts, {});
  const nextSelectedBlockId =
    normalized.editorState?.selectedBlockId === sectionId
      ? 'ALL'
      : normalized.editorState?.selectedBlockId || 'ALL';

  return {
    ...normalized,
    currentHtml: nextCurrentHtml,
    sections: remaining,
    editorState: {
      ...normalized.editorState,
      selectedBlockId: nextSelectedBlockId,
      sections: remaining,
      sectionStartingNumbers: nextStartingMap,
    },
    updatedAt: nowIso,
  };
}

/**
 * Reorders a section up or down within the project without altering any section's internal HTML or product order.
 */
export function reorderProjectSectionById(
  project: HtmlEditorProject,
  sectionId: string,
  direction: 'up' | 'down',
  catalogProducts: Product[] = []
): HtmlEditorProject {
  const normalized = ensureProjectHasSections(project, catalogProducts);
  const sorted = [...(normalized.sections || [])].sort((a, b) => a.order - b.order);
  const idx = sorted.findIndex((s) => s.id === sectionId);
  if (idx === -1) return normalized;

  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= sorted.length) return normalized;

  const temp = sorted[idx];
  sorted[idx] = sorted[targetIdx];
  sorted[targetIdx] = temp;

  const nowIso = new Date().toISOString();
  const reindexed = sorted.map((s, i) => ({
    ...s,
    order: i,
    updatedAt: s.id === sectionId ? nowIso : s.updatedAt,
  }));
  const nextCurrentHtml = joinProjectSectionsHtml(reindexed);
  const nextStartingMap = buildSectionStartingNumbersMap(
    reindexed,
    catalogProducts,
    normalized.editorState?.sectionStartingNumbers
  );

  return {
    ...normalized,
    currentHtml: nextCurrentHtml,
    sections: reindexed,
    editorState: {
      ...normalized.editorState,
      sections: reindexed,
      sectionStartingNumbers: nextStartingMap,
    },
    updatedAt: nowIso,
  };
}

/**
 * Renames a single section within the project without altering its HTML content.
 */
export function renameProjectSectionById(
  project: HtmlEditorProject,
  sectionId: string,
  newName: string,
  catalogProducts: Product[] = []
): HtmlEditorProject {
  const cleanName = (newName || '').trim();
  if (!cleanName) {
    throw new Error('Section name cannot be empty.');
  }
  const normalized = ensureProjectHasSections(project, catalogProducts);
  const nowIso = new Date().toISOString();
  const nextSections = (normalized.sections || []).map((s) =>
    s.id === sectionId
      ? {
          ...s,
          name: cleanName,
          updatedAt: nowIso,
        }
      : s
  );

  return {
    ...normalized,
    sections: nextSections,
    editorState: {
      ...normalized.editorState,
      sections: nextSections,
    },
    updatedAt: nowIso,
  };
}

/**
 * Updates a section's manual classification type (e.g. changing uncertain section classification or numbering eligibility).
 */
export function updateProjectSectionTypeById(
  project: HtmlEditorProject,
  sectionId: string,
  manualType: HtmlSectionCategory | undefined,
  catalogProducts: Product[] = []
): HtmlEditorProject {
  const normalized = ensureProjectHasSections(project, catalogProducts);
  const nowIso = new Date().toISOString();
  const nextSections = (normalized.sections || []).map((s, idx) => {
    if (s.id !== sectionId) return s;
    const tempSec: HtmlProjectSection = {
      ...s,
      manualType,
      updatedAt: nowIso,
    };
    const analyzed = analyzeSingleProjectSection(tempSec, idx, catalogProducts);
    tempSec.type = manualType || analyzed.blockType;
    if (
      analyzed.numberingInfo?.isNumberedProductSection &&
      tempSec.startingProductNumber === undefined
    ) {
      tempSec.startingProductNumber = analyzed.numberingInfo.detectedStartingNumber ?? 1;
    }
    return tempSec;
  });

  const nextStartingMap = buildSectionStartingNumbersMap(
    nextSections,
    catalogProducts,
    normalized.editorState?.sectionStartingNumbers
  );

  return {
    ...normalized,
    sections: nextSections,
    editorState: {
      ...normalized.editorState,
      sections: nextSections,
      sectionStartingNumbers: nextStartingMap,
    },
    updatedAt: nowIso,
  };
}

/**
 * Updates the HTML content of a specific section and re-synchronizes the project's combined `currentHtml`.
 */
export function updateProjectSectionHtmlById(
  project: HtmlEditorProject,
  sectionId: string,
  newSectionHtml: string,
  catalogProducts: Product[] = []
): HtmlEditorProject {
  const normalized = ensureProjectHasSections(project, catalogProducts);
  const nowIso = new Date().toISOString();
  const nextSections = (normalized.sections || []).map((s, idx) => {
    if (s.id !== sectionId) return s;
    const updatedSec: HtmlProjectSection = {
      ...s,
      htmlContent: newSectionHtml,
      updatedAt: nowIso,
    };
    const analyzed = analyzeSingleProjectSection(updatedSec, idx, catalogProducts);
    updatedSec.type = updatedSec.manualType || analyzed.blockType;
    if (
      analyzed.numberingInfo?.isNumberedProductSection &&
      analyzed.numberingInfo.detectedStartingNumber !== null
    ) {
      updatedSec.startingProductNumber = analyzed.numberingInfo.detectedStartingNumber;
    }
    return updatedSec;
  });

  const nextCurrentHtml = joinProjectSectionsHtml(nextSections);
  const nextStartingMap = buildSectionStartingNumbersMap(
    nextSections,
    catalogProducts,
    normalized.editorState?.sectionStartingNumbers
  );

  return {
    ...normalized,
    currentHtml: nextCurrentHtml,
    sections: nextSections,
    editorState: {
      ...normalized.editorState,
      sections: nextSections,
      sectionStartingNumbers: nextStartingMap,
    },
    updatedAt: nowIso,
  };
}

/**
 * Updates the Starting Product Number for a single eligible product section and renumbers its products
 * without modifying any other section in the project.
 */
export function updateProjectSectionStartingNumberById(
  project: HtmlEditorProject,
  sectionId: string,
  startingNumber: number,
  catalogProducts: Product[] = []
): HtmlEditorProject {
  if (!Number.isInteger(startingNumber) || startingNumber < 1) {
    return project;
  }
  const normalized = ensureProjectHasSections(project, catalogProducts);
  const nowIso = new Date().toISOString();

  const nextSections = (normalized.sections || []).map((s, idx) => {
    if (s.id !== sectionId) return s;
    const analyzed = analyzeSingleProjectSection(s, idx, catalogProducts);
    const renumbered = updateSectionProductNumbering(
      s.htmlContent,
      analyzed.nodePath,
      startingNumber,
      catalogProducts
    );
    return {
      ...s,
      startingProductNumber: startingNumber,
      htmlContent: renumbered.hasExplicitNumbering ? renumbered.html : s.htmlContent,
      updatedAt: nowIso,
    };
  });

  const nextCurrentHtml = joinProjectSectionsHtml(nextSections);
  const nextStartingMap = buildSectionStartingNumbersMap(
    nextSections,
    catalogProducts,
    normalized.editorState?.sectionStartingNumbers
  );

  return {
    ...normalized,
    currentHtml: nextCurrentHtml,
    sections: nextSections,
    editorState: {
      ...normalized.editorState,
      sections: nextSections,
      sectionStartingNumbers: nextStartingMap,
    },
    updatedAt: nowIso,
  };
}

/**
 * Exports a single section's complete HTML along with its character count and Fourthwall 30,000-character limit status.
 */
export function exportProjectSectionHtml(
  project: HtmlEditorProject,
  sectionId: string,
  catalogProducts: Product[] = []
): HtmlExportPayload {
  const normalized = ensureProjectHasSections(project, catalogProducts);
  const target = (normalized.sections || []).find((s) => s.id === sectionId);
  if (!target) {
    throw new Error(`Section "${sectionId}" not found in project.`);
  }
  return evaluateHtmlExportSize(target.htmlContent);
}

/**
 * Exports the complete project HTML (concatenating all sections in displayed order)
 * along with its total character count and Fourthwall 30,000-character limit status.
 */
export function exportCompleteProjectHtml(
  project: HtmlEditorProject,
  catalogProducts: Product[] = []
): HtmlExportPayload {
  const normalized = ensureProjectHasSections(project, catalogProducts);
  const fullHtml = joinProjectSectionsHtml(normalized.sections || []);
  return evaluateHtmlExportSize(fullHtml);
}



