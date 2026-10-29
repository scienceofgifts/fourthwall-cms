import {
  ConfiguredGeminiModelId,
  DEFAULT_GEMINI_MODEL_ID,
  GeminiExecutionMetadata,
  getSavedGeminiModelPreference,
} from './geminiModelConfig';

export type AITaskType =
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

export type AIActionMode =
  | 'generate'
  | 'regenerate'
  | 'improve'
  | 'shorten'
  | 'expand'
  | 'alternatives';

export interface AIGenerateRequest {
  taskType: AITaskType;
  actionMode: AIActionMode;
  preferredModel?: ConfiguredGeminiModelId;
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

export interface AIGenerateResponse {
  primaryText: string;
  secondaryText: string;
  alternatives: string[];
  reviewNotes: string;
  modelMetadata?: GeminiExecutionMetadata;
}

export interface AIServiceStatus {
  configured: boolean;
  model: ConfiguredGeminiModelId;
  defaultModel?: ConfiguredGeminiModelId;
  fallbackOrder?: ConfiguredGeminiModelId[];
  verificationNotice?: string;
}

// Track active requests by key to prevent duplicate concurrent submissions
const inFlightRequests = new Set<string>();

export function isAIRequestInFlight(requestKey: string): boolean {
  return inFlightRequests.has(requestKey);
}

export async function checkAIServiceStatus(): Promise<AIServiceStatus> {
  try {
    const res = await fetch('/api/ai/status');
    if (!res.ok) return { configured: false, model: DEFAULT_GEMINI_MODEL_ID };
    return await res.json();
  } catch {
    return { configured: false, model: DEFAULT_GEMINI_MODEL_ID };
  }
}

/**
 * Invokes the server-side / Worker-side Gemini endpoint only when explicitly initiated by user click.
 * Uses the user's persisted Gemini model selection (`getSavedGeminiModelPreference()`) and relies on
 * the server-side bounded fallback chain (each configured model tried at most once, with no nested client retry loop).
 */
export async function requestAIGeneration(
  requestKey: string,
  payload: AIGenerateRequest
): Promise<AIGenerateResponse> {
  if (inFlightRequests.has(requestKey)) {
    throw new Error('A generation request for this field is already in progress.');
  }

  const preferredModel = payload.preferredModel || getSavedGeminiModelPreference();

  inFlightRequests.add(requestKey);
  try {
    const res = await fetch('/api/ai/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        preferredModel,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errMessage = data.error || `AI request failed with status ${res.status}.`;
      throw new Error(errMessage);
    }

    return {
      primaryText: data.primaryText || '',
      secondaryText: data.secondaryText || '',
      alternatives: Array.isArray(data.alternatives) ? data.alternatives : [],
      reviewNotes: data.reviewNotes || '',
      modelMetadata: data.modelMetadata,
    };
  } finally {
    inFlightRequests.delete(requestKey);
  }
}
