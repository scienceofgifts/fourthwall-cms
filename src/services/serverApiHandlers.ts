import { GoogleGenAI, Type } from '@google/genai';
import {
  ExtractedProductData,
  extractProductFromHtml,
  isPrivateOrInternalHost,
  validateFetchableProductUrl,
} from './productExtractor';
import {
  ConfiguredGeminiModelId,
  DEFAULT_GEMINI_MODEL_ID,
  GEMINI_MODEL_DEFINITIONS,
  GeminiExecutionMetadata,
  GeminiFallbackError,
  MODEL_VERIFICATION_SUMMARY,
  PRIMARY_GEMINI_FALLBACK_ORDER,
  executeGeminiWithFallback,
} from './geminiModelConfig';

export interface ServerEnvironment {
  GEMINI_API_KEY?: string;
  APP_URL?: string;
}

export interface GenAIModelInvoker {
  generateContent(params: {
    model: string;
    contents: string;
    config?: Record<string, unknown>;
  }): Promise<{ text?: string }>;
}

export interface ApiHandlerOptions {
  /**
   * Optional DNS check hook (used in Node.js server.ts; Cloudflare Workers blocks private IPs at the edge).
   */
  assertPublicDns?: (hostname: string) => Promise<void>;
  /**
   * Optional injectable client factory for testing mocked Gemini model failures/fallbacks.
   */
  createGenAIInvoker?: (apiKey: string) => GenAIModelInvoker;
  /**
   * Optional custom sleep function for testing Retry-After behavior without waiting.
   */
  sleepMs?: (ms: number) => Promise<void>;
}

export interface ApiHandlerResult<T = Record<string, unknown>> {
  status: number;
  body: T;
}

export const MAX_AI_HTML_FRAGMENT_CHARS = 50_000;
export const MAX_PARSE_HTML_BODY_CHARS = 1_500_000;

export function isGeminiApiKeyConfigured(env: ServerEnvironment): boolean {
  const key = env?.GEMINI_API_KEY;
  return Boolean(key && key !== 'MY_GEMINI_API_KEY' && key.trim() !== '');
}

function getDefaultGenAIInvoker(apiKey: string): GenAIModelInvoker {
  const client = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
  return {
    generateContent: (params) => client.models.generateContent(params as any),
  };
}

function logSafeModelDiagnostic(entry: {
  operation: string;
  model: ConfiguredGeminiModelId;
  attemptNumber: number;
  totalModelsInChain: number;
  outcome: 'success' | 'recoverable_error' | 'permanent_error';
  errorCategory?: string;
  statusCode?: number;
  durationMs: number;
  detail?: string;
}) {
  const prefix = `[Gemini:${entry.operation}] attempt ${entry.attemptNumber}/${entry.totalModelsInChain} model=${entry.model}`;
  if (entry.outcome === 'success') {
    console.info(`${prefix} outcome=success (${entry.durationMs}ms)`);
  } else {
    console.warn(
      `${prefix} outcome=${entry.outcome} category=${entry.errorCategory || 'unknown'} status=${
        entry.statusCode || 0
      } (${entry.durationMs}ms) detail=${entry.detail || ''}`
    );
  }
}

export function handleAiStatusRequest(env: ServerEnvironment): ApiHandlerResult {
  const configured = isGeminiApiKeyConfigured(env);
  return {
    status: 200,
    body: {
      configured,
      model: DEFAULT_GEMINI_MODEL_ID,
      defaultModel: DEFAULT_GEMINI_MODEL_ID,
      fallbackOrder: [...PRIMARY_GEMINI_FALLBACK_ORDER],
      models: GEMINI_MODEL_DEFINITIONS,
      verificationNotice: MODEL_VERIFICATION_SUMMARY,
    },
  };
}

function concatUint8Arrays(chunks: Uint8Array[], totalLength: number): Uint8Array {
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/**
 * Fetches a public HTTP/HTTPS product page with SSRF validation on every redirect hop,
 * a 10-second timeout, and a 2MB response size limit using runtime-agnostic Web APIs.
 */
export async function fetchPublicProductHtmlSafely(
  initialUrl: string,
  options?: ApiHandlerOptions
): Promise<{
  html: string;
  finalUrl: string;
  statusCode: number;
}> {
  let currentUrl = initialUrl;
  const maxRedirects = 3;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const check = validateFetchableProductUrl(currentUrl);
    if (!check.valid || !check.normalizedUrl) {
      throw new Error(check.error || 'Unsafe URL blocked.');
    }
    const parsed = new URL(check.normalizedUrl);
    if (isPrivateOrInternalHost(parsed.hostname)) {
      throw new Error('Target host is restricted (private or internal network).');
    }
    if (options?.assertPublicDns) {
      await options.assertPublicDns(parsed.hostname);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(parsed.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; ScienceOfGiftsCatalogBot/1.0; +https://scienceofgifts.com)',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          throw new Error(`Redirect response (${response.status}) missing Location header.`);
        }
        if (hop === maxRedirects) {
          throw new Error('Too many redirects while fetching product URL (max 3 allowed).');
        }
        currentUrl = new URL(location, parsed.toString()).toString();
        continue;
      }

      if (!response.ok) {
        throw new Error(
          `Storefront returned HTTP ${response.status} (${
            response.statusText || 'Request blocked or unavailable'
          }).`
        );
      }

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (
        contentType &&
        !contentType.includes('text/html') &&
        !contentType.includes('application/xhtml+xml') &&
        !contentType.includes('application/json') &&
        !contentType.includes('text/plain')
      ) {
        throw new Error(`Unsupported content type "${contentType}". Expected an HTML product page.`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        const text = await response.text();
        return {
          html: text.slice(0, 2_000_000),
          finalUrl: parsed.toString(),
          statusCode: response.status,
        };
      }

      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      const maxBytes = 2 * 1024 * 1024;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > maxBytes) {
            await reader.cancel();
            break;
          }
          chunks.push(value);
        }
      }

      const combinedBytes = concatUint8Arrays(
        chunks,
        chunks.reduce((acc, c) => acc + c.byteLength, 0)
      );
      const html = new TextDecoder('utf-8').decode(combinedBytes);
      return { html, finalUrl: parsed.toString(), statusCode: response.status };
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error('Failed to fetch product page.');
}

/**
 * Optional AI extraction fallback—invoked ONLY when explicitly requested by user action
 * (`useAiFallback: true`) and deterministic metadata extraction left key fields missing.
 */
export async function runAiProductExtractionFallback(
  htmlOrText: string,
  sourceUrl: string,
  existing: ExtractedProductData,
  env: ServerEnvironment,
  preferredModel?: string | null,
  options?: ApiHandlerOptions
): Promise<{
  extracted: ExtractedProductData;
  modelMetadata?: GeminiExecutionMetadata;
}> {
  if (!isGeminiApiKeyConfigured(env)) {
    return {
      extracted: {
        ...existing,
        warnings: [
          ...existing.warnings,
          'AI extraction fallback was requested, but GEMINI_API_KEY is not configured.',
        ],
      },
    };
  }

  const invoker = (options?.createGenAIInvoker || getDefaultGenAIInvoker)(env.GEMINI_API_KEY!);

  const cleanedSnippet = htmlOrText
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 14000);

  try {
    const { result: aiData, modelMetadata } = await executeGeminiWithFallback({
      preferredModel,
      operationName: 'product_extraction_fallback',
      sleepMs: options?.sleepMs,
      logger: logSafeModelDiagnostic,
      invokeModel: async (modelId) => {
        const response = await invoker.generateContent({
          model: modelId,
          contents: [
            `Extract factual product metadata from the following product page snippet (${sourceUrl}).`,
            'CRITICAL RULES:',
            '1. NEVER invent or guess prices, original prices, SKUs, materials, dimensions, or variants.',
            '2. If a field is not explicitly present in the snippet, return an empty string "" or empty array [].',
            '3. Distinguish missing prices ("") from a confirmed zero price ("$0.00").',
            '',
            `Snippet:\n${cleanedSnippet}`,
          ].join('\n'),
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                price: { type: Type.STRING },
                originalPrice: { type: Type.STRING },
                currency: { type: Type.STRING },
                shortDescription: { type: Type.STRING },
                category: { type: Type.STRING },
                productType: { type: Type.STRING },
                sku: { type: Type.STRING },
                featuresSpecs: { type: Type.STRING },
              },
              required: [
                'name',
                'price',
                'originalPrice',
                'currency',
                'shortDescription',
                'category',
                'productType',
                'sku',
                'featuresSpecs',
              ],
            },
          },
        });

        if (!response.text || !response.text.trim()) {
          throw new Error('Empty response from Gemini model.');
        }
        return JSON.parse(response.text);
      },
    });

    const warnings = [...existing.warnings];
    if (modelMetadata.fallbackUsed) {
      warnings.push(
        `AI extraction completed using fallback model "${modelMetadata.modelUsedLabel}" (${modelMetadata.modelUsed}).`
      );
    }

    return {
      extracted: {
        ...existing,
        name: existing.name || (aiData.name || '').trim(),
        price: existing.price || (aiData.price || '').trim(),
        originalPrice: existing.originalPrice || (aiData.originalPrice || '').trim(),
        currency: existing.currency || (aiData.currency || '').trim(),
        shortDescription: existing.shortDescription || (aiData.shortDescription || '').trim(),
        category: existing.category || (aiData.category || '').trim(),
        productType: existing.productType || (aiData.productType || '').trim(),
        sku: existing.sku || (aiData.sku || '').trim(),
        featuresSpecs: existing.featuresSpecs || (aiData.featuresSpecs || '').trim(),
        warnings,
        dataSource: 'ai_fallback',
        fetchStatus:
          existing.name || aiData.name
            ? existing.price || aiData.price
              ? 'success'
              : 'partial'
            : 'failed',
      },
      modelMetadata,
    };
  } catch (err) {
    return {
      extracted: {
        ...existing,
        warnings: [
          ...existing.warnings,
          err instanceof Error
            ? `AI extraction fallback failed: ${err.message}`
            : 'AI extraction fallback failed.',
        ],
      },
    };
  }
}

export async function handleProductFetchUrlRequest(
  body: Record<string, any> | null | undefined,
  env: ServerEnvironment,
  options?: ApiHandlerOptions
): Promise<ApiHandlerResult> {
  const rawUrl = String(body?.url || '').trim();
  const useAiFallback = Boolean(body?.useAiFallback);
  const preferredModel = typeof body?.preferredModel === 'string' ? body.preferredModel : undefined;

  const urlCheck = validateFetchableProductUrl(rawUrl);
  if (!urlCheck.valid || !urlCheck.normalizedUrl) {
    return {
      status: 400,
      body: {
        ok: false,
        error: urlCheck.error || 'Invalid product URL.',
      },
    };
  }

  try {
    const { html, finalUrl } = await fetchPublicProductHtmlSafely(
      urlCheck.normalizedUrl,
      options
    );
    let extracted = extractProductFromHtml(html, finalUrl);
    let modelMetadata: GeminiExecutionMetadata | undefined;

    if (
      useAiFallback &&
      (!extracted.name || !extracted.price || !extracted.shortDescription)
    ) {
      const aiRes = await runAiProductExtractionFallback(
        html,
        finalUrl,
        extracted,
        env,
        preferredModel,
        options
      );
      extracted = aiRes.extracted;
      modelMetadata = aiRes.modelMetadata;
    }

    return {
      status: 200,
      body: {
        ok: true,
        finalUrl,
        extracted,
        ...(modelMetadata ? { modelMetadata } : {}),
      },
    };
  } catch (err) {
    const msg =
      err instanceof Error
        ? err.name === 'AbortError'
          ? 'Product page request timed out after 10 seconds.'
          : err.message
        : 'Failed to fetch product URL.';
    return {
      status: 422,
      body: {
        ok: false,
        error: msg,
        fallbackHint:
          'This page blocked automated requests or could not be reached. You can paste the page HTML/details below or enter the product fields manually.',
      },
    };
  }
}

export async function handleProductParseHtmlRequest(
  body: Record<string, any> | null | undefined,
  env: ServerEnvironment,
  options?: ApiHandlerOptions
): Promise<ApiHandlerResult> {
  const rawHtml = String(body?.html || '').trim();
  const sourceUrl = String(body?.sourceUrl || '/products/imported-item').trim();
  const useAiFallback = Boolean(body?.useAiFallback);
  const preferredModel = typeof body?.preferredModel === 'string' ? body.preferredModel : undefined;

  if (!rawHtml) {
    return {
      status: 400,
      body: { ok: false, error: 'Please provide HTML or product text to parse.' },
    };
  }

  if (rawHtml.length > MAX_PARSE_HTML_BODY_CHARS) {
    return {
      status: 400,
      body: {
        ok: false,
        error: `Pasted HTML exceeds maximum allowed length (${Math.round(
          MAX_PARSE_HTML_BODY_CHARS / 1024
        )} KB).`,
      },
    };
  }

  try {
    let extracted = extractProductFromHtml(rawHtml, sourceUrl);
    let modelMetadata: GeminiExecutionMetadata | undefined;

    if (
      useAiFallback &&
      (!extracted.name || !extracted.price || !extracted.shortDescription)
    ) {
      const aiRes = await runAiProductExtractionFallback(
        rawHtml,
        sourceUrl,
        extracted,
        env,
        preferredModel,
        options
      );
      extracted = aiRes.extracted;
      modelMetadata = aiRes.modelMetadata;
    }

    return {
      status: 200,
      body: {
        ok: true,
        extracted,
        ...(modelMetadata ? { modelMetadata } : {}),
      },
    };
  } catch (err) {
    return {
      status: 500,
      body: {
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to parse pasted product HTML.',
      },
    };
  }
}

export async function handleAiAnalyzeHtmlRequest(
  body: Record<string, any> | null | undefined,
  env: ServerEnvironment,
  options?: ApiHandlerOptions
): Promise<ApiHandlerResult> {
  // 1. Validate request inputs BEFORE checking or calling Gemini
  if (!body || typeof body !== 'object') {
    return {
      status: 400,
      body: { error: 'Invalid JSON request payload.' },
    };
  }

  const rawFragment = typeof body.htmlFragment === 'string' ? body.htmlFragment.trim() : '';
  if (!rawFragment) {
    return {
      status: 400,
      body: { error: 'Missing htmlFragment in request.' },
    };
  }

  if (rawFragment.length > MAX_AI_HTML_FRAGMENT_CHARS) {
    return {
      status: 400,
      body: {
        error: `htmlFragment exceeds maximum allowed length of ${MAX_AI_HTML_FRAGMENT_CHARS} characters.`,
      },
    };
  }

  const task = String(body.task || 'classify').trim();
  if (task !== 'classify' && task !== 'rewrite_text') {
    return {
      status: 400,
      body: { error: `Unsupported AI analysis task "${task}". Expected "classify" or "rewrite_text".` },
    };
  }

  const userInstruction = String(body.instruction || '').trim().slice(0, 2000);
  const preferredModel = typeof body.preferredModel === 'string' ? body.preferredModel : undefined;
  const htmlFragment = rawFragment.slice(0, 12000);

  // 2. Check API Key availability
  if (!isGeminiApiKeyConfigured(env)) {
    return {
      status: 503,
      body: {
        error:
          'Gemini AI service is not configured. Ensure GEMINI_API_KEY is set in your server or Cloudflare Worker secrets.',
      },
    };
  }

  const invoker = (options?.createGenAIInvoker || getDefaultGenAIInvoker)(env.GEMINI_API_KEY!);

  try {
    if (task === 'rewrite_text') {
      const { result, modelMetadata } = await executeGeminiWithFallback({
        preferredModel,
        operationName: 'analyze_html_rewrite_text',
        sleepMs: options?.sleepMs,
        logger: logSafeModelDiagnostic,
        invokeModel: async (modelId) => {
          const response = await invoker.generateContent({
            model: modelId,
            contents: [
              'You are an editorial gift-guide copy editor for Science of Gifts.',
              'Rewrite or refine ONLY the provided text/HTML snippet according to the instruction.',
              'CRITICAL RULES:',
              '1. Do NOT invent product prices, specifications, materials, or URLs.',
              '2. Preserve any existing <a> links and their exact href attributes unless instructed otherwise.',
              `Instruction: ${
                userInstruction || 'Tighten and polish this editorial copy while preserving all facts.'
              }`,
              `Selected Text/Snippet:\n${htmlFragment}`,
            ].join('\n\n'),
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  proposedText: { type: Type.STRING },
                  alternatives: { type: Type.ARRAY, items: { type: Type.STRING } },
                  notes: { type: Type.STRING },
                },
                required: ['proposedText', 'alternatives', 'notes'],
              },
            },
          });

          if (!response.text || !response.text.trim()) {
            throw new Error('Empty response from Gemini model.');
          }
          return JSON.parse(response.text);
        },
      });

      return {
        status: 200,
        body: {
          ...result,
          modelMetadata,
        },
      };
    }

    // Default task: classify ambiguous HTML fragment and suggest editable fields
    const { result, modelMetadata } = await executeGeminiWithFallback({
      preferredModel,
      operationName: 'analyze_html_classify',
      sleepMs: options?.sleepMs,
      logger: logSafeModelDiagnostic,
      invokeModel: async (modelId) => {
        const response = await invoker.generateContent({
          model: modelId,
          contents: [
            'Analyze the following custom Fourthwall HTML fragment and classify its role in a gift guide.',
            'Do not rewrite or alter the HTML. Identify its component pattern and list the editable text/link/image fields present.',
            `HTML Fragment:\n${htmlFragment}`,
          ].join('\n\n'),
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                componentCategory: {
                  type: Type.STRING,
                  description:
                    'Suggested classification (e.g., Custom Callout Box, Comparison Table, Promo Banner, Product Spotlight).',
                },
                summary: {
                  type: Type.STRING,
                  description: 'Concise explanation of how this HTML block is structured.',
                },
                suggestedEditableFields: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      label: { type: Type.STRING },
                      selectorOrTag: { type: Type.STRING },
                      currentValuePreview: { type: Type.STRING },
                    },
                    required: ['label', 'selectorOrTag', 'currentValuePreview'],
                  },
                },
              },
              required: ['componentCategory', 'summary', 'suggestedEditableFields'],
            },
          },
        });

        if (!response.text || !response.text.trim()) {
          throw new Error('Empty response from Gemini model.');
        }
        return JSON.parse(response.text);
      },
    });

    return {
      status: 200,
      body: {
        ...result,
        modelMetadata,
      },
    };
  } catch (error) {
    if (error instanceof GeminiFallbackError) {
      return {
        status: error.statusCode,
        body: {
          error: error.message,
          requestedModel: error.requestedModel,
          attemptedModels: error.attemptedModels,
          recoverable: error.recoverable,
        },
      };
    }
    return {
      status: 500,
      body: {
        error: error instanceof Error ? error.message : 'Failed to run AI HTML analysis.',
      },
    };
  }
}

export interface AIGenerateRequestBody {
  taskType:
    | 'product_badge'
    | 'editorial_title'
    | 'short_description'
    | 'editorial_copy'
    | 'section_intro'
    | 'category_description'
    | 'buying_guide_pillar'
    | 'faq_pair'
    | 'guide_intro'
    | 'category_suggestions';
  actionMode: 'generate' | 'regenerate' | 'improve' | 'shorten' | 'expand' | 'alternatives';
  preferredModel?: string;
  guideContext: {
    title: string;
    topic: string;
    audience?: string;
    sectionTitle?: string;
  };
  productContext?: {
    name: string;
    productUrl?: string;
    price?: string;
    productType?: string;
    category?: string;
    tags?: string[];
    shortDescription?: string;
    featuresSpecs?: string;
    sourceNotes?: string;
  };
  currentValue?: string;
  extraInstructions?: string;
}

const ALLOWED_TASK_TYPES = new Set<string>([
  'product_badge',
  'editorial_title',
  'short_description',
  'editorial_copy',
  'section_intro',
  'category_description',
  'buying_guide_pillar',
  'faq_pair',
  'guide_intro',
  'category_suggestions',
]);

const ALLOWED_ACTION_MODES = new Set<string>([
  'generate',
  'regenerate',
  'improve',
  'shorten',
  'expand',
  'alternatives',
]);

export async function handleAiGenerateRequest(
  rawBody: Record<string, any> | null | undefined,
  env: ServerEnvironment,
  options?: ApiHandlerOptions
): Promise<ApiHandlerResult> {
  // 1. Validate request inputs BEFORE checking or calling Gemini
  const body = rawBody as AIGenerateRequestBody | null | undefined;
  if (!body || typeof body !== 'object') {
    return {
      status: 400,
      body: { error: 'Invalid request payload.' },
    };
  }

  if (!body.taskType || !body.guideContext?.title || !body.guideContext.title.trim()) {
    return {
      status: 400,
      body: { error: 'Missing required taskType or guideContext.title in request.' },
    };
  }

  if (!ALLOWED_TASK_TYPES.has(body.taskType)) {
    return {
      status: 400,
      body: { error: `Invalid taskType "${String(body.taskType)}".` },
    };
  }

  if (body.actionMode && !ALLOWED_ACTION_MODES.has(body.actionMode)) {
    return {
      status: 400,
      body: { error: `Invalid actionMode "${String(body.actionMode)}".` },
    };
  }

  if (typeof body.currentValue === 'string' && body.currentValue.length > MAX_AI_HTML_FRAGMENT_CHARS) {
    return {
      status: 400,
      body: {
        error: `currentValue exceeds maximum allowed length of ${MAX_AI_HTML_FRAGMENT_CHARS} characters.`,
      },
    };
  }

  // 2. Check API Key availability
  if (!isGeminiApiKeyConfigured(env)) {
    return {
      status: 503,
      body: {
        error:
          'Gemini AI service is not configured. Ensure GEMINI_API_KEY is set in your server or Cloudflare Worker secrets.',
      },
    };
  }

  const invoker = (options?.createGenAIInvoker || getDefaultGenAIInvoker)(env.GEMINI_API_KEY!);

  const systemInstruction = [
    'You are a senior editorial gift-guide writer for Science of Gifts (modeled after Wirecutter and NYT Strategist).',
    'CRITICAL FACTUAL RULES:',
    '1. NEVER invent product specifications, fabric weights, materials, dimensions, prices, availability, or shipping promises that are not explicitly present in the supplied product context.',
    '2. If verified specifications or materials are missing from the source data, write smart thematic and aesthetic editorial copy without fabricating physical specs, and note any missing factual details in "reviewNotes".',
    '3. Keep the tone sharp, literate, warm, and insider-savvy—never generic e-commerce hype or cheesy souvenir clichés.',
    '4. Do not wrap output in markdown code fences.',
  ].join('\n');

  const actionDirectiveMap: Record<AIGenerateRequestBody['actionMode'], string> = {
    generate: 'Draft fresh editorial content tailored to the guide topic and product.',
    regenerate: 'Draft a fresh, distinct angle for this content while remaining faithful to the facts.',
    improve: 'Tighten prose, sharpen sensory/literary phrasing, and improve rhythm while preserving facts.',
    shorten: 'Make the copy significantly more concise and punchy without losing key factual anchors.',
    expand:
      'Expand with richer thematic context, recipient use cases, and why this design resonates with fans (target 120-160 words for long-form editorial copy).',
    alternatives: 'Provide 3 distinct, high-craft editorial alternatives.',
  };

  const taskSpecificInstructions: Record<AIGenerateRequestBody['taskType'], string> = {
    product_badge:
      'Produce a concise superlative badge (3 to 6 words max, e.g., "Best for Hades Fans", "Best Under $20", "Most Clever Lore Reference").',
    editorial_title: 'Produce a clean, compelling editorial display title for the product card.',
    short_description:
      'Produce a crisp 1-sentence dek or short summary (12-28 words) highlighting who it is for and its standout visual/material hook.',
    editorial_copy:
      'Produce 2 cohesive paragraphs of magazine-style editorial review copy (110-160 words total). Separate paragraphs with a blank line. Explain why fans of the topic love the reference and how the verified product specs hold up in daily use.',
    section_intro:
      'Produce a chapter kicker (2-4 words) and an engaging 1-2 sentence section introduction.',
    category_description:
      'Produce a 1-2 sentence category card description and a short 3-part motif subtitle separated by bullets (e.g., "Wisdom Owl • Spear • Laurel Wreath").',
    buying_guide_pillar:
      'Produce a buying guide pillar heading and a 2-3 sentence actionable paragraph explaining how to choose the right gift.',
    faq_pair:
      'Produce a natural, search-friendly FAQ question and a clear, authoritative 2-3 sentence answer grounded strictly in the provided products.',
    guide_intro: 'Produce a 2-paragraph editorial introduction for the overall gift guide.',
    category_suggestions:
      'Suggest logical thematic category groupings based on the guide topic and product details.',
  };

  const promptParts = [
    `Task: ${taskSpecificInstructions[body.taskType] || 'Generate editorial gift guide copy.'}`,
    `Action Mode: ${actionDirectiveMap[body.actionMode] || actionDirectiveMap.generate}`,
    `Guide Title: ${body.guideContext.title}`,
    `Guide Topic: ${body.guideContext.topic || body.guideContext.title}`,
    body.guideContext.audience ? `Target Audience: ${body.guideContext.audience}` : '',
    body.guideContext.sectionTitle ? `Section Context: ${body.guideContext.sectionTitle}` : '',
    body.productContext
      ? [
          'Verified Product Data (Source of Truth):',
          `- Name: ${body.productContext.name}`,
          `- URL: ${body.productContext.productUrl || 'N/A'}`,
          `- Price: ${body.productContext.price || 'N/A'}`,
          `- Type: ${body.productContext.productType || 'N/A'}`,
          `- Category: ${body.productContext.category || 'N/A'}`,
          `- Tags: ${(body.productContext.tags || []).join(', ') || 'None'}`,
          `- Short Description: ${body.productContext.shortDescription || 'None provided'}`,
          `- Verified Specs/Features: ${
            body.productContext.featuresSpecs || 'None provided — DO NOT INVENT SPECS'
          }`,
          `- Source Notes: ${body.productContext.sourceNotes || 'None'}`,
        ].join('\n')
      : '',
    body.currentValue ? `Current Field Text:\n${body.currentValue}` : '',
    body.extraInstructions ? `Additional Editor Direction:\n${body.extraInstructions}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    const { result, modelMetadata } = await executeGeminiWithFallback({
      preferredModel: body.preferredModel,
      operationName: `editorial_${body.taskType}_${body.actionMode || 'generate'}`,
      sleepMs: options?.sleepMs,
      logger: logSafeModelDiagnostic,
      invokeModel: async (modelId) => {
        const response = await invoker.generateContent({
          model: modelId,
          contents: promptParts,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                primaryText: {
                  type: Type.STRING,
                  description: 'The primary generated or refined editorial text for the field.',
                },
                secondaryText: {
                  type: Type.STRING,
                  description:
                    'Optional secondary text (such as a subtitle, kicker, or FAQ answer when generating a pair).',
                },
                alternatives: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: 'Up to 3 alternative options for the editor to pick from.',
                },
                reviewNotes: {
                  type: Type.STRING,
                  description:
                    'Any caution notes if source product specifications were sparse or missing.',
                },
              },
              required: ['primaryText', 'secondaryText', 'alternatives', 'reviewNotes'],
            },
          },
        });

        const rawText = response.text;
        if (!rawText || !rawText.trim()) {
          throw new Error('Empty response from Gemini model.');
        }
        return JSON.parse(rawText);
      },
    });

    return {
      status: 200,
      body: {
        ...result,
        modelMetadata,
      },
    };
  } catch (error) {
    if (error instanceof GeminiFallbackError) {
      return {
        status: error.statusCode,
        body: {
          error: error.message,
          requestedModel: error.requestedModel,
          attemptedModels: error.attemptedModels,
          recoverable: error.recoverable,
        },
      };
    }
    const message =
      error instanceof Error ? error.message : 'Failed to generate content with Gemini.';
    return {
      status: 500,
      body: { error: message },
    };
  }
}
