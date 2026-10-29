/**
 * Centralized Gemini Model Configuration, Verification Metadata, Persistence & Bounded Fallback Runner
 *
 * Requested Model Preference & Fallback Order:
 * 1. Gemini 3.5 Flash Lite (default)        -> 'gemini-3.5-flash-lite'
 * 2. Gemini 3.6 Flash (first fallback)      -> 'gemini-3.6-flash'
 * 3. Gemini 3.8 Flash (second fallback)     -> 'gemini-3.8-flash'
 * 4. Gemini 3.1 Flash (third fallback)      -> 'gemini-3.1-flash'
 *
 * Additional Closest Verified SDK Alias (selectable):
 * - Gemini 3.1 Flash Lite (Verified SDK ID) -> 'gemini-3.1-flash-lite'
 */

export type ConfiguredGeminiModelId =
  | 'gemini-3.5-flash-lite'
  | 'gemini-3.6-flash'
  | 'gemini-3.8-flash'
  | 'gemini-3.1-flash'
  | 'gemini-3.1-flash-lite';

export interface GeminiModelDefinition {
  id: ConfiguredGeminiModelId;
  label: string;
  roleLabel: string;
  fallbackOrderIndex: number | null; // 1..4 for the primary fallback chain, null for optional verified alias
  verifiedInSdk: boolean;
  closestVerifiedModelId: 'gemini-3.1-flash-lite' | 'gemini-3.8-flash';
  verificationNote: string;
}

export const DEFAULT_GEMINI_MODEL_ID: ConfiguredGeminiModelId = 'gemini-3.5-flash-lite';

/**
 * The exact 4-model preference and fallback order requested by the user.
 */
export const PRIMARY_GEMINI_FALLBACK_ORDER: readonly ConfiguredGeminiModelId[] = [
  'gemini-3.5-flash-lite',
  'gemini-3.6-flash',
  'gemini-3.8-flash',
  'gemini-3.1-flash',
] as const;

export const GEMINI_MODEL_DEFINITIONS: readonly GeminiModelDefinition[] = [
  {
    id: 'gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash Lite',
    roleLabel: 'Default (1st Priority)',
    fallbackOrderIndex: 1,
    verifiedInSdk: false,
    closestVerifiedModelId: 'gemini-3.1-flash-lite',
    verificationNote:
      'Requested default. Note: "gemini-3.5-flash-lite" is not an official @google/genai v2.4.0 model ID (closest official Flash-Lite ID is "gemini-3.1-flash-lite"). If the API reports model unavailable (404), requests automatically fall back in order.',
  },
  {
    id: 'gemini-3.6-flash',
    label: 'Gemini 3.6 Flash',
    roleLabel: '1st Fallback',
    fallbackOrderIndex: 2,
    verifiedInSdk: false,
    closestVerifiedModelId: 'gemini-3.8-flash',
    verificationNote:
      'Requested 1st fallback. Note: "gemini-3.6-flash" is not an official @google/genai v2.4.0 model ID (closest official Flash ID is "gemini-3.8-flash"). If unavailable, requests advance to the next fallback.',
  },
  {
    id: 'gemini-3.8-flash',
    label: 'Gemini 3.8 Flash',
    roleLabel: '2nd Fallback (Verified SDK ID)',
    fallbackOrderIndex: 3,
    verifiedInSdk: true,
    closestVerifiedModelId: 'gemini-3.8-flash',
    verificationNote:
      'Verified official model ID ("gemini-3.8-flash") supported directly in @google/genai v2.4.0.',
  },
  {
    id: 'gemini-3.1-flash',
    label: 'Gemini 3.1 Flash',
    roleLabel: '3rd Fallback',
    fallbackOrderIndex: 4,
    verifiedInSdk: false,
    closestVerifiedModelId: 'gemini-3.1-flash-lite',
    verificationNote:
      'Requested 3rd fallback. Note: @google/genai v2.4.0 provides "gemini-3.1-flash-lite" rather than "gemini-3.1-flash".',
  },
  {
    id: 'gemini-3.1-flash-lite',
    label: 'Gemini 3.1 Flash Lite (Verified SDK Flash-Lite)',
    roleLabel: 'Closest Verified Flash-Lite ID',
    fallbackOrderIndex: null,
    verifiedInSdk: true,
    closestVerifiedModelId: 'gemini-3.1-flash-lite',
    verificationNote:
      'Official verified Flash-Lite model ID ("gemini-3.1-flash-lite") in @google/genai v2.4.0.',
  },
] as const;

export const MODEL_VERIFICATION_SUMMARY =
  'Model ID Verification Notice: Among the 4 requested model names, "gemini-3.8-flash" (Gemini 3.8 Flash) is a verified exact model ID in @google/genai (^2.4.0). "gemini-3.5-flash-lite", "gemini-3.6-flash", and "gemini-3.1-flash" are not listed as official model IDs in the current Gemini API / @google/genai SDK (where the official Flash-Lite ID is "gemini-3.1-flash-lite" and the official Flash ID is "gemini-3.8-flash"). Your exact requested preference and fallback order (1. Gemini 3.5 Flash Lite -> 2. Gemini 3.6 Flash -> 3. Gemini 3.8 Flash -> 4. Gemini 3.1 Flash) is preserved without silent substitution; if an unverified ID returns 404/unavailable from the Gemini API, the bounded fallback runner automatically advances through your fallback chain until a responsive model succeeds.';

const ALLOWED_MODEL_IDS = new Set<string>(GEMINI_MODEL_DEFINITIONS.map((m) => m.id));

export function isValidConfiguredGeminiModelId(
  value: unknown
): value is ConfiguredGeminiModelId {
  return typeof value === 'string' && ALLOWED_MODEL_IDS.has(value.trim());
}

export function normalizeSelectedGeminiModelId(
  value: unknown
): ConfiguredGeminiModelId {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (isValidConfiguredGeminiModelId(trimmed)) {
      return trimmed;
    }
  }
  return DEFAULT_GEMINI_MODEL_ID;
}

export function getGeminiModelDefinition(
  modelId: string
): GeminiModelDefinition {
  const normalized = normalizeSelectedGeminiModelId(modelId);
  return (
    GEMINI_MODEL_DEFINITIONS.find((m) => m.id === normalized) ||
    GEMINI_MODEL_DEFINITIONS[0]
  );
}

export function formatGeminiModelLabel(modelId: string): string {
  const found = GEMINI_MODEL_DEFINITIONS.find((m) => m.id === modelId);
  return found ? found.label : modelId;
}

/**
 * Builds the deterministic, deduplicated fallback sequence for a single user-initiated action.
 * Starts with the currently selected model, followed by the remaining models from
 * PRIMARY_GEMINI_FALLBACK_ORDER in their configured order.
 * Each configured model appears at most once.
 */
export function resolveModelFallbackChain(
  selectedModelId?: string | null
): ConfiguredGeminiModelId[] {
  const primary = normalizeSelectedGeminiModelId(selectedModelId);
  const chain: ConfiguredGeminiModelId[] = [primary];
  for (const candidate of PRIMARY_GEMINI_FALLBACK_ORDER) {
    if (!chain.includes(candidate)) {
      chain.push(candidate);
    }
  }
  return chain;
}

// ============================================================================
// Client-Side Persistence (localStorage + Custom Event Synchronization)
// ============================================================================

export const LOCAL_GEMINI_MODEL_STORAGE_KEY = 'sog_selected_gemini_model_v1';
export const GEMINI_MODEL_CHANGED_EVENT = 'sog-gemini-model-changed';

export function getSavedGeminiModelPreference(): ConfiguredGeminiModelId {
  if (typeof window === 'undefined' || !window.localStorage) {
    return DEFAULT_GEMINI_MODEL_ID;
  }
  try {
    const raw = window.localStorage.getItem(LOCAL_GEMINI_MODEL_STORAGE_KEY);
    return normalizeSelectedGeminiModelId(raw);
  } catch {
    return DEFAULT_GEMINI_MODEL_ID;
  }
}

export function saveGeminiModelPreference(
  modelId: ConfiguredGeminiModelId
): ConfiguredGeminiModelId {
  const normalized = normalizeSelectedGeminiModelId(modelId);
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(LOCAL_GEMINI_MODEL_STORAGE_KEY, normalized);
    } catch {
      // Ignore storage quota / privacy mode errors
    }
    try {
      window.dispatchEvent(
        new CustomEvent(GEMINI_MODEL_CHANGED_EVENT, { detail: { modelId: normalized } })
      );
    } catch {
      // Ignore dispatch error in non-DOM test environments
    }
  }
  return normalized;
}

// ============================================================================
// Error Classification & Bounded Fallback Execution
// ============================================================================

export type GeminiErrorCategory =
  | 'model_unavailable'
  | 'rate_limit'
  | 'service_error'
  | 'timeout'
  | 'empty_response'
  | 'validation_error'
  | 'auth_error';

export interface ClassifiedGeminiError {
  recoverable: boolean;
  category: GeminiErrorCategory;
  statusCode: number;
  message: string;
  retryAfterMs?: number;
}

export interface GeminiAttemptDiagnostic {
  model: ConfiguredGeminiModelId;
  outcome: 'success' | 'recoverable_error' | 'permanent_error';
  errorCategory?: GeminiErrorCategory;
  statusCode?: number;
  message?: string;
  durationMs: number;
}

export interface GeminiExecutionMetadata {
  requestedModel: ConfiguredGeminiModelId;
  modelUsed: ConfiguredGeminiModelId;
  modelUsedLabel: string;
  fallbackUsed: boolean;
  attemptedModels: ConfiguredGeminiModelId[];
  attempts: GeminiAttemptDiagnostic[];
}

export class GeminiFallbackError extends Error {
  public readonly statusCode: number;
  public readonly recoverable: boolean;
  public readonly category: GeminiErrorCategory;
  public readonly requestedModel: ConfiguredGeminiModelId;
  public readonly attemptedModels: ConfiguredGeminiModelId[];
  public readonly attempts: GeminiAttemptDiagnostic[];

  constructor(params: {
    message: string;
    statusCode: number;
    recoverable: boolean;
    category: GeminiErrorCategory;
    requestedModel: ConfiguredGeminiModelId;
    attemptedModels: ConfiguredGeminiModelId[];
    attempts: GeminiAttemptDiagnostic[];
  }) {
    super(params.message);
    this.name = 'GeminiFallbackError';
    this.statusCode = params.statusCode;
    this.recoverable = params.recoverable;
    this.category = params.category;
    this.requestedModel = params.requestedModel;
    this.attemptedModels = params.attemptedModels;
    this.attempts = params.attempts;
  }
}

export const MAX_PRACTICAL_RETRY_DELAY_MS = 1200;
export const DEFAULT_GEMINI_ATTEMPT_TIMEOUT_MS = 25000;

function extractRetryAfterMs(error: any, message: string): number | undefined {
  if (error && typeof error === 'object') {
    if (typeof error.retryAfterMs === 'number' && error.retryAfterMs >= 0) {
      return Math.min(error.retryAfterMs, MAX_PRACTICAL_RETRY_DELAY_MS);
    }
    const headers = error.headers || error.response?.headers;
    const headerVal =
      typeof headers?.get === 'function'
        ? headers.get('retry-after') || headers.get('Retry-After')
        : headers?.['retry-after'] || headers?.['Retry-After'];
    if (headerVal) {
      const secs = Number(headerVal);
      if (!Number.isNaN(secs) && secs >= 0) {
        return Math.min(secs * 1000, MAX_PRACTICAL_RETRY_DELAY_MS);
      }
    }
  }
  const match = message.match(/retry[- ]after[:\s]+(\d+(?:\.\d+)?)\s*(ms|s|sec|seconds)?/i);
  if (match) {
    const val = Number(match[1]);
    const unit = (match[2] || 's').toLowerCase();
    const ms = unit === 'ms' ? val : val * 1000;
    if (!Number.isNaN(ms) && ms >= 0) {
      return Math.min(ms, MAX_PRACTICAL_RETRY_DELAY_MS);
    }
  }
  return undefined;
}

/**
 * Classifies an error thrown during a Gemini API call into either:
 * - Recoverable (`recoverable: true`): model unavailability (404), rate limits (429),
 *   temporary service errors (500/502/503/504), network/timeout errors, or empty responses.
 * - Permanent (`recoverable: false`): invalid API key / auth (401/403) or malformed request /
 *   invalid user parameters (400/422).
 */
export function classifyGeminiError(error: unknown): ClassifiedGeminiError {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
      ? error
      : JSON.stringify(error || 'Unknown Gemini error');

  const errObj = (error && typeof error === 'object' ? error : {}) as Record<string, any>;
  const explicitStatus =
    typeof errObj.status === 'number'
      ? errObj.status
      : typeof errObj.statusCode === 'number'
      ? errObj.statusCode
      : typeof errObj.code === 'number'
      ? errObj.code
      : undefined;

  const retryAfterMs = extractRetryAfterMs(errObj, rawMessage);

  // 1. Check timeout / abort first
  if (
    errObj.name === 'AbortError' ||
    errObj.name === 'TimeoutError' ||
    /\b(timeout|timed out|deadline[_ ]exceeded|aborted)\b/i.test(rawMessage) ||
    explicitStatus === 408 ||
    explicitStatus === 504
  ) {
    return {
      recoverable: true,
      category: 'timeout',
      statusCode: explicitStatus || 504,
      message: rawMessage,
      retryAfterMs,
    };
  }

  // 2. Check model unavailability (404 / model not found / unsupported model)
  // Note: Check this BEFORE generic 400 checks because some SDK wrappers include "not found" or "model ... not supported"
  if (
    explicitStatus === 404 ||
    /\b404\b/.test(rawMessage) ||
    /model.*not[_ ]found/i.test(rawMessage) ||
    /models\/[a-z0-9.\-_]+ is not found/i.test(rawMessage) ||
    /model.*unavailable/i.test(rawMessage) ||
    /not supported for generateContent/i.test(rawMessage) ||
    /unsupported model/i.test(rawMessage)
  ) {
    return {
      recoverable: true,
      category: 'model_unavailable',
      statusCode: 404,
      message: rawMessage,
      retryAfterMs,
    };
  }

  // 3. Check permanent authentication / API key errors (401 / 403)
  if (
    explicitStatus === 401 ||
    explicitStatus === 403 ||
    /\b(401|403)\b/.test(rawMessage) ||
    /api[_ ]key[_ ]not[_ ]valid/i.test(rawMessage) ||
    /invalid[_ ]api[_ ]key/i.test(rawMessage) ||
    /missing[_ ]api[_ ]key/i.test(rawMessage) ||
    /unauthenticated/i.test(rawMessage) ||
    /permission[_ ]denied/i.test(rawMessage)
  ) {
    return {
      recoverable: false,
      category: 'auth_error',
      statusCode: explicitStatus || 401,
      message: rawMessage,
    };
  }

  // 4. Check permanent request validation / malformed input errors (400 / 422)
  if (
    explicitStatus === 400 ||
    explicitStatus === 422 ||
    /\b(400|422)\b/.test(rawMessage) ||
    /invalid[_ ]argument/i.test(rawMessage) ||
    /malformed/i.test(rawMessage) ||
    /validation[_ ]error/i.test(rawMessage) ||
    /invalid user parameter/i.test(rawMessage)
  ) {
    return {
      recoverable: false,
      category: 'validation_error',
      statusCode: explicitStatus || 400,
      message: rawMessage,
    };
  }

  // 5. Check rate limit / quota errors (429)
  if (
    explicitStatus === 429 ||
    /\b429\b/.test(rawMessage) ||
    /rate[_ ]limit/i.test(rawMessage) ||
    /resource[_ ]exhausted/i.test(rawMessage) ||
    /too many requests/i.test(rawMessage) ||
    /quota/i.test(rawMessage)
  ) {
    return {
      recoverable: true,
      category: 'rate_limit',
      statusCode: 429,
      message: rawMessage,
      retryAfterMs,
    };
  }

  // 6. Check empty response
  if (/empty response/i.test(rawMessage)) {
    return {
      recoverable: true,
      category: 'empty_response',
      statusCode: 502,
      message: rawMessage,
    };
  }

  // 7. Default to recoverable service error (500 / 502 / 503 / network failure)
  return {
    recoverable: true,
    category: 'service_error',
    statusCode:
      explicitStatus && explicitStatus >= 500 && explicitStatus < 600
        ? explicitStatus
        : 503,
    message: rawMessage,
    retryAfterMs,
  };
}

export interface ExecuteGeminiWithFallbackOptions<T> {
  preferredModel?: string | null;
  operationName: string;
  attemptTimeoutMs?: number;
  /**
   * Function that performs a single call against the given `modelId`.
   */
  invokeModel: (modelId: ConfiguredGeminiModelId, signal: AbortSignal) => Promise<T>;
  /**
   * Optional logger for safe server/Worker diagnostics (defaults to console.info/warn).
   */
  logger?: (entry: {
    operation: string;
    model: ConfiguredGeminiModelId;
    attemptNumber: number;
    totalModelsInChain: number;
    outcome: 'success' | 'recoverable_error' | 'permanent_error';
    errorCategory?: GeminiErrorCategory;
    statusCode?: number;
    durationMs: number;
    detail?: string;
  }) => void;
  /**
   * Optional sleep implementation (injectable for deterministic fast unit tests).
   */
  sleepMs?: (ms: number) => Promise<void>;
}

/**
 * Executes a Gemini operation starting with the selected `preferredModel` and falling back
 * through the remaining configured models in order on recoverable errors.
 *
 * Strict guarantees:
 * - Tries each configured model at most once (no nested retry loops).
 * - Immediately aborts without fallback on permanent validation/auth errors (400/401/403).
 * - Respects practical `Retry-After` guidance (capped at MAX_PRACTICAL_RETRY_DELAY_MS).
 * - Returns both the operation result and `modelMetadata` indicating which model succeeded.
 */
export async function executeGeminiWithFallback<T>(
  options: ExecuteGeminiWithFallbackOptions<T>
): Promise<{ result: T; modelMetadata: GeminiExecutionMetadata }> {
  const requestedModel = normalizeSelectedGeminiModelId(options.preferredModel);
  const chain = resolveModelFallbackChain(requestedModel);
  const timeoutMs = options.attemptTimeoutMs ?? DEFAULT_GEMINI_ATTEMPT_TIMEOUT_MS;
  const sleep =
    options.sleepMs ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const attemptedModels: ConfiguredGeminiModelId[] = [];
  const attempts: GeminiAttemptDiagnostic[] = [];
  let lastClassifiedError: ClassifiedGeminiError | null = null;

  for (let idx = 0; idx < chain.length; idx++) {
    const modelId = chain[idx];
    attemptedModels.push(modelId);
    const startTime = Date.now();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const result = await options.invokeModel(modelId, controller.signal);
      clearTimeout(timer);

      const durationMs = Date.now() - startTime;
      attempts.push({
        model: modelId,
        outcome: 'success',
        durationMs,
      });

      options.logger?.({
        operation: options.operationName,
        model: modelId,
        attemptNumber: idx + 1,
        totalModelsInChain: chain.length,
        outcome: 'success',
        durationMs,
      });

      return {
        result,
        modelMetadata: {
          requestedModel,
          modelUsed: modelId,
          modelUsedLabel: formatGeminiModelLabel(modelId),
          fallbackUsed: modelId !== requestedModel,
          attemptedModels,
          attempts,
        },
      };
    } catch (err) {
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;
      const classified = classifyGeminiError(err);
      lastClassifiedError = classified;

      const outcome = classified.recoverable ? 'recoverable_error' : 'permanent_error';
      attempts.push({
        model: modelId,
        outcome,
        errorCategory: classified.category,
        statusCode: classified.statusCode,
        message: classified.message.slice(0, 300),
        durationMs,
      });

      options.logger?.({
        operation: options.operationName,
        model: modelId,
        attemptNumber: idx + 1,
        totalModelsInChain: chain.length,
        outcome,
        errorCategory: classified.category,
        statusCode: classified.statusCode,
        durationMs,
        detail: classified.message.slice(0, 200),
      });

      // Do NOT fall back on permanent validation or authentication errors
      if (!classified.recoverable) {
        throw new GeminiFallbackError({
          message: classified.message,
          statusCode: classified.statusCode,
          recoverable: false,
          category: classified.category,
          requestedModel,
          attemptedModels,
          attempts,
        });
      }

      // If there is another fallback model remaining and a practical Retry-After hint was given, honor it briefly
      const hasMoreModels = idx < chain.length - 1;
      if (hasMoreModels && classified.retryAfterMs && classified.retryAfterMs > 0) {
        await sleep(Math.min(classified.retryAfterMs, MAX_PRACTICAL_RETRY_DELAY_MS));
      }
    }
  }

  const finalStatus = lastClassifiedError?.statusCode || 502;
  const finalCategory = lastClassifiedError?.category || 'service_error';
  const summaryReason = lastClassifiedError?.message || 'All configured Gemini models failed.';

  throw new GeminiFallbackError({
    message: `Gemini request failed after trying ${attemptedModels.length} configured model(s) [${attemptedModels.join(
      ' -> '
    )}]. Last error: ${summaryReason}`,
    statusCode: finalStatus === 404 ? 502 : finalStatus,
    recoverable: true,
    category: finalCategory,
    requestedModel,
    attemptedModels,
    attempts,
  });
}
