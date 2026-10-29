import React, { useEffect, useState } from 'react';
import { Sparkles, Check, AlertTriangle, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import {
  AIActionMode,
  AIGenerateResponse,
  AITaskType,
  isAIRequestInFlight,
  requestAIGeneration,
} from '../services/aiClient';
import {
  ConfiguredGeminiModelId,
  GEMINI_MODEL_CHANGED_EVENT,
  GEMINI_MODEL_DEFINITIONS,
  formatGeminiModelLabel,
  getSavedGeminiModelPreference,
  saveGeminiModelPreference,
} from '../services/geminiModelConfig';
import { Product } from '../types/cms';

interface AIFieldAssistProps {
  fieldKey: string;
  taskType: AITaskType;
  label?: string;
  currentValue: string;
  onApply: (newValue: string, secondaryValue?: string) => void;
  guideContext: {
    title: string;
    topic: string;
    audience?: string;
    sectionTitle?: string;
  };
  product?: Product;
  compact?: boolean;
}

export const AIFieldAssist: React.FC<AIFieldAssistProps> = ({
  fieldKey,
  taskType,
  label = 'Editorial AI Studio',
  currentValue,
  onApply,
  guideContext,
  product,
  compact = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [loadingMode, setLoadingMode] = useState<AIActionMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AIGenerateResponse | null>(null);
  const [extraInstructions, setExtraInstructions] = useState('');
  const [selectedModel, setSelectedModel] = useState<ConfiguredGeminiModelId>(() =>
    getSavedGeminiModelPreference()
  );
  const [confirmOverwritePending, setConfirmOverwritePending] = useState<{
    primary: string;
    secondary?: string;
  } | null>(null);

  useEffect(() => {
    const syncModel = () => setSelectedModel(getSavedGeminiModelPreference());
    window.addEventListener(GEMINI_MODEL_CHANGED_EVENT, syncModel);
    return () => window.removeEventListener(GEMINI_MODEL_CHANGED_EVENT, syncModel);
  }, []);

  const handleRunAction = async (mode: AIActionMode) => {
    if (isAIRequestInFlight(fieldKey) || loadingMode) return;
    setLoadingMode(mode);
    setError(null);
    setConfirmOverwritePending(null);

    try {
      const response = await requestAIGeneration(fieldKey, {
        taskType,
        actionMode: mode,
        preferredModel: selectedModel,
        guideContext,
        productContext: product
          ? {
              name: product.name,
              productUrl: product.productUrl,
              price: product.price,
              productType: product.productType,
              category: product.category,
              tags: product.tags,
              shortDescription: product.shortDescription,
              featuresSpecs: product.featuresSpecs,
              sourceNotes: product.sourceNotes,
            }
          : undefined,
        currentValue,
        extraInstructions: extraInstructions.trim() || undefined,
      });
      setResult(response);
      setIsOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI generation failed.');
      setIsOpen(true);
    } finally {
      setLoadingMode(null);
    }
  };

  const applyWithSafetyCheck = (newPrimary: string, newSecondary?: string) => {
    if (currentValue && currentValue.trim().length > 120 && !confirmOverwritePending) {
      setConfirmOverwritePending({ primary: newPrimary, secondary: newSecondary });
      return;
    }
    onApply(newPrimary, newSecondary);
    setConfirmOverwritePending(null);
  };

  return (
    <div className="mt-2 pt-1.5 border-t border-[#ECE8DF]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => handleRunAction(currentValue ? 'regenerate' : 'generate')}
            disabled={Boolean(loadingMode)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold text-[#123E59] bg-[#DFEEF5] hover:bg-[#CEE4F0] border border-[#94C0D6] rounded transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {loadingMode === 'generate' || loadingMode === 'regenerate' ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : (
              <Sparkles className="w-3 h-3" />
            )}
            <span>{currentValue ? 'Regenerate Draft' : 'Draft with AI'}</span>
          </button>

          {currentValue && (
            <div className="inline-flex items-center bg-[#F2EDE2] p-0.5 rounded border border-[#DED8CA]">
              <button
                type="button"
                onClick={() => handleRunAction('improve')}
                disabled={Boolean(loadingMode)}
                className="px-2 py-0.5 text-[11px] font-medium text-[#151E2D] hover:bg-white rounded-xs transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                {loadingMode === 'improve' ? 'Polishing...' : 'Polish'}
              </button>
              <button
                type="button"
                onClick={() => handleRunAction('shorten')}
                disabled={Boolean(loadingMode)}
                className="px-2 py-0.5 text-[11px] font-medium text-[#151E2D] hover:bg-white rounded-xs transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                {loadingMode === 'shorten' ? 'Shortening...' : 'Shorten'}
              </button>
              {!compact && (
                <button
                  type="button"
                  onClick={() => handleRunAction('expand')}
                  disabled={Boolean(loadingMode)}
                  className="px-2 py-0.5 text-[11px] font-medium text-[#151E2D] hover:bg-white rounded-xs transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  {loadingMode === 'expand' ? 'Expanding...' : 'Expand'}
                </button>
              )}
              <button
                type="button"
                onClick={() => handleRunAction('alternatives')}
                disabled={Boolean(loadingMode)}
                className="px-2 py-0.5 text-[11px] font-medium text-[#151E2D] hover:bg-white rounded-xs transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                {loadingMode === 'alternatives' ? 'Drafting...' : '3 Angles'}
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-[#475569] hover:text-[#151E2D] whitespace-nowrap shrink-0"
        >
          <span>
            {label} ({formatGeminiModelLabel(selectedModel)})
          </span>
          {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {isOpen && (
        <div className="mt-2.5 p-3.5 bg-[#EFF6FA] border border-[#B5D5E6] rounded-lg space-y-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#D2E6F1]">
            <span className="text-[11px] font-semibold text-[#123E59]">
              Active Gemini Model Preference:
            </span>
            <select
              aria-label="Select Gemini Model"
              value={selectedModel}
              onChange={(e) => {
                const updated = saveGeminiModelPreference(
                  e.target.value as ConfiguredGeminiModelId
                );
                setSelectedModel(updated);
              }}
              className="sog-select py-1 px-2 text-[11px] font-medium w-auto"
            >
              {GEMINI_MODEL_DEFINITIONS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} — {m.roleLabel}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={extraInstructions}
              onChange={(e) => setExtraInstructions(e.target.value)}
              placeholder="Custom editorial angle (e.g., highlight dark academia aesthetic or under-$20 value)..."
              className="sog-input flex-1 text-xs py-1.5"
            />
            <button
              type="button"
              onClick={() => handleRunAction('generate')}
              disabled={Boolean(loadingMode)}
              className="sog-btn-primary py-1.5"
            >
              Run Prompt
            </button>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-2.5 bg-red-50 border border-red-200 rounded text-red-800">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold">AI Generation Notice</p>
                <p className="mt-0.5 text-red-700">{error}</p>
              </div>
            </div>
          )}

          {confirmOverwritePending && (
            <div className="p-3 bg-amber-50 border border-amber-300 rounded-md text-amber-950 flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">
                Replace your existing {currentValue.length}-character manual copy with this draft?
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    onApply(confirmOverwritePending.primary, confirmOverwritePending.secondary);
                    setConfirmOverwritePending(null);
                  }}
                  className="px-2.5 py-1 bg-amber-900 text-white rounded font-semibold hover:bg-amber-800 whitespace-nowrap shrink-0"
                >
                  Confirm Replace
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmOverwritePending(null)}
                  className="px-2.5 py-1 bg-white border border-amber-300 rounded text-amber-900 hover:bg-amber-100 whitespace-nowrap shrink-0"
                >
                  Keep Manual Edit
                </button>
              </div>
            </div>
          )}

          {result && (
            <div className="space-y-2.5">
              {result.modelMetadata && (
                <div
                  className={`px-2.5 py-1.5 rounded border text-[11px] flex flex-wrap items-center justify-between gap-2 ${
                    result.modelMetadata.fallbackUsed
                      ? 'bg-amber-50 border-amber-200 text-amber-900'
                      : 'bg-[#E1F2EA] border-[#96CDB0] text-[#134634]'
                  }`}
                >
                  <span>
                    <strong>Model Succeeded:</strong> {result.modelMetadata.modelUsedLabel} (
                    <code className="font-mono-tabular">{result.modelMetadata.modelUsed}</code>)
                  </span>
                  {result.modelMetadata.fallbackUsed && (
                    <span>
                      Fallback used (requested:{' '}
                      <code className="font-mono-tabular">
                        {result.modelMetadata.requestedModel}
                      </code>
                      ; saved preference unchanged)
                    </span>
                  )}
                </div>
              )}

              {result.reviewNotes && (
                <div className="p-2.5 bg-amber-50/90 border border-amber-200 rounded text-amber-900 text-[11px]">
                  <strong>Factual Verification Note:</strong> {result.reviewNotes}
                </div>
              )}

              <div className="p-3 bg-white border border-[#C5DCE8] rounded-md space-y-2 shadow-2xs">
                <div className="flex items-center justify-between gap-2 border-b border-stone-100 pb-2">
                  <span className="font-semibold text-[#123E59]">Proposed Editorial Copy</span>
                  <button
                    type="button"
                    onClick={() => applyWithSafetyCheck(result.primaryText, result.secondaryText)}
                    className="sog-btn-mint py-1 px-2.5 text-[11px]"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Apply Draft</span>
                  </button>
                </div>
                <p className="text-[#151E2D] whitespace-pre-line leading-relaxed">
                  {result.primaryText}
                </p>
                {result.secondaryText && (
                  <p className="text-stone-600 pt-1.5 border-t border-stone-100 whitespace-pre-line">
                    <span className="font-semibold text-stone-800">Companion field:</span>{' '}
                    {result.secondaryText}
                  </p>
                )}
              </div>

              {result.alternatives && result.alternatives.length > 0 && (
                <div className="space-y-1.5">
                  <span className="font-semibold text-[#123E59] block">
                    Alternative Editorial Angles:
                  </span>
                  {result.alternatives.map((alt, idx) => (
                    <div
                      key={idx}
                      className="p-2.5 bg-white border border-[#D4E4ED] rounded flex items-start justify-between gap-2.5"
                    >
                      <span className="text-[#151E2D] whitespace-pre-line flex-1 leading-relaxed">
                        {alt}
                      </span>
                      <button
                        type="button"
                        onClick={() => applyWithSafetyCheck(alt)}
                        className="px-2.5 py-1 text-[11px] font-semibold bg-[#DFEEF5] hover:bg-[#CEE4F0] text-[#123E59] rounded shrink-0 whitespace-nowrap"
                      >
                        Use Angle {idx + 1}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
