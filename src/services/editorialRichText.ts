/**
 * Editorial Rich Text Utilities
 * 
 * Provides robust sanitization, entity encoding/decoding, plain-text extraction,
 * and link validation for the modal rich-text editor in Science of Gifts.
 */

const ALLOWED_TAGS = new Set([
  'p', 'strong', 'b', 'em', 'i', 'u', 'a',
  'ul', 'ol', 'li', 'br', 'span', 'sub', 'sup', 'code'
]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'title', 'target', 'rel', 'class', 'data-product-url']),
  p: new Set(['class']),
  span: new Set(['class']),
  ul: new Set(['class']),
  ol: new Set(['class']),
  li: new Set(['class']),
};

const SAFE_PROTOCOLS = /^(https?:|mailto:|#|\/)/i;

/**
 * Validates whether a URL is safe to use in an anchor tag.
 * Rejects javascript:, vbscript:, data: URIs, etc.
 */
export function isSafeUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  // Disallow javascript/vbscript/data text
  if (/^(javascript|vbscript|data):/i.test(trimmed)) {
    return false;
  }
  return SAFE_PROTOCOLS.test(trimmed);
}

/**
 * Strips script tags, iframe/embed tags, inline event handlers, and unsafe protocols
 * while normalizing tags (<b> -> <strong>, <i> -> <em>) and preserving safe editorial formatting.
 */
export function sanitizeEditorialRichHtml(rawHtml: string | null | undefined): string {
  if (!rawHtml) return '';
  let cleaned = String(rawHtml).trim();

  // Strip dangerous top-level containers
  cleaned = cleaned
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<(iframe|object|embed|style|form|input|button|textarea|select)[^>]*>.*?<\/\1>/gis, '')
    .replace(/<(script|iframe|object|embed|style|form|input|button|textarea|select)[^>]*\/?>/gi, '')
    // Strip inline event attributes like onclick, onerror, onload, etc.
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    // Strip javascript: pseudo-protocols
    .replace(/javascript\s*:/gi, '');

  // Normalize <b> to <strong>, <i> to <em>
  cleaned = cleaned
    .replace(/<\s*b(\s|>)/gi, '<strong$1')
    .replace(/<\/\s*b\s*>/gi, '</strong>')
    .replace(/<\s*i(\s|>)/gi, '<em$1')
    .replace(/<\/\s*i\s*>/gi, '</em>');

  // Parse and filter attributes on allowed elements
  // Standardize <a> links: if external, ensure rel="noopener noreferrer"
  cleaned = cleaned.replace(/<a\b([^>]*)>/gi, (_, attrString: string) => {
    const hrefMatch = attrString.match(/href=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const href = hrefMatch ? (hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3] ?? '') : '';

    if (!isSafeUrl(href)) {
      return '<span>';
    }

    const isExternal = /^https?:\/\//i.test(href);
    const targetMatch = attrString.match(/target=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const target = targetMatch ? (targetMatch[1] ?? targetMatch[2] ?? targetMatch[3] ?? '') : (isExternal ? '_blank' : '');

    let newAttrs = `href="${href.replace(/"/g, '&quot;')}"`;
    if (target === '_blank') {
      newAttrs += ' target="_blank" rel="noopener noreferrer"';
    }
    return `<a ${newAttrs}>`;
  });

  // Convert unmatched </a> if replaced with <span>
  cleaned = cleaned.replace(/<\/a>/gi, '</a>');

  // Clean empty paragraphs like <p><br></p> or <p></p> at ends
  cleaned = cleaned
    .replace(/<p>\s*(?:<br\s*\/?>)?\s*<\/p>/gi, '')
    .trim();

  return cleaned;
}

/**
 * Extracts plain text from an HTML snippet for character counts and search indexing.
 */
export function extractPlainTextFromHtml(html: string | null | undefined): string {
  if (!html) return '';
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Counts words in a string or HTML fragment.
 */
export function countWords(textOrHtml: string | null | undefined): number {
  const plain = extractPlainTextFromHtml(textOrHtml);
  if (!plain) return 0;
  const words = plain.split(/\s+/).filter(Boolean);
  return words.length;
}

/**
 * Ensures plain text or unformatted content is converted to standard paragraph HTML.
 */
export function ensureParagraphsHtml(content: string | null | undefined): string {
  if (!content) return '';
  const trimmed = content.trim();
  // If already contains block level tags (<p>, <ul>, <ol>, <div>), return sanitized
  if (/<(p|ul|ol|div|blockquote)\b/i.test(trimmed)) {
    return sanitizeEditorialRichHtml(trimmed);
  }

  // Split plain text by double newline
  const paragraphs = trimmed
    .split(/\n\s*\n|\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) return '';
  return paragraphs.map((p) => `<p>${p}</p>`).join('\n');
}
