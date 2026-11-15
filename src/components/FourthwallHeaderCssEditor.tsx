import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Code,
  Copy,
  Download,
  Pencil,
  Replace,
  RotateCcw,
  Save,
  X,
} from 'lucide-react';
import { FourthwallHeaderCssSetting } from '../types/cms';
import {
  FOURTHWALL_HEADER_CSS_UPDATED_EVENT,
  getFourthwallHeaderCssSync,
  loadFourthwallHeaderCssAsync,
  restorePreviousFourthwallHeaderCss,
  saveFourthwallHeaderCss,
} from '../services/firebase';
import {
  DEFAULT_GIFT_GUIDE_CSS,
  normalizeHeaderCssInput,
} from '../services/htmlWorkspaceEngine';

interface FourthwallHeaderCssEditorProps {
  userId?: string | null;
  onShowToast?: (msg: string) => void;
  onClosePanel?: () => void;
  compact?: boolean;
}

type EditorMode = 'view' | 'edit' | 'replace';

export const FourthwallHeaderCssEditor: React.FC<FourthwallHeaderCssEditorProps> = ({
  userId,
  onShowToast,
  onClosePanel,
  compact = false,
}) => {
  const [headerSetting, setHeaderSetting] = useState<FourthwallHeaderCssSetting>(() =>
    getFourthwallHeaderCssSync()
  );
  const [mode, setMode] = useState<EditorMode>('view');
  const [editBuffer, setEditBuffer] = useState<string>(() => getFourthwallHeaderCssSync().currentCss);
  const [replaceBuffer, setReplaceBuffer] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  const [saveFeedback, setSaveFeedback] = useState<{
    type: 'saved' | 'restored' | 'error';
    message: string;
  } | null>(null);
  const [pendingUnsavedAction, setPendingUnsavedAction] = useState<
    'cancel' | 'close_panel' | 'switch_to_edit' | 'switch_to_replace' | null
  >(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const replaceTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const syncFromStorage = useCallback(async () => {
    try {
      const loaded = await loadFourthwallHeaderCssAsync();
      setHeaderSetting(loaded);
      setMode((currentMode) => {
        if (currentMode === 'view') {
          setEditBuffer(loaded.currentCss);
        }
        return currentMode;
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Unable to read Fourthwall Header CSS from storage.';
      setSaveFeedback({ type: 'error', message: msg });
    }
  }, []);

  useEffect(() => {
    void syncFromStorage();
  }, [syncFromStorage]);

  useEffect(() => {
    const handleUpdated = (event: Event) => {
      const customEvt = event as CustomEvent<FourthwallHeaderCssSetting>;
      const next = customEvt.detail || getFourthwallHeaderCssSync();
      setHeaderSetting(next);
      setMode((currentMode) => {
        if (currentMode === 'view') {
          setEditBuffer(next.currentCss);
        }
        return currentMode;
      });
    };
    window.addEventListener(FOURTHWALL_HEADER_CSS_UPDATED_EVENT, handleUpdated);
    return () => window.removeEventListener(FOURTHWALL_HEADER_CSS_UPDATED_EVENT, handleUpdated);
  }, []);

  const hasUnsavedChanges =
    (mode === 'edit' && editBuffer !== headerSetting.currentCss) ||
    (mode === 'replace' && replaceBuffer.trim().length > 0);

  // Warn before browser tab unload if user is actively editing Header CSS
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const handleOpenEditMode = () => {
    if (mode === 'replace' && replaceBuffer.trim().length > 0) {
      setPendingUnsavedAction('switch_to_edit');
      return;
    }
    setSaveFeedback(null);
    setPendingUnsavedAction(null);
    setEditBuffer(headerSetting.currentCss);
    setMode('edit');
    window.setTimeout(() => {
      editTextareaRef.current?.focus();
    }, 30);
  };

  const handleOpenReplaceMode = () => {
    if (mode === 'edit' && editBuffer !== headerSetting.currentCss) {
      setPendingUnsavedAction('switch_to_replace');
      return;
    }
    setSaveFeedback(null);
    setPendingUnsavedAction(null);
    setReplaceBuffer('');
    setMode('replace');
    window.setTimeout(() => {
      replaceTextareaRef.current?.focus();
    }, 30);
  };

  const discardAndResetToView = () => {
    setEditBuffer(headerSetting.currentCss);
    setReplaceBuffer('');
    setPendingUnsavedAction(null);
    setMode('view');
  };

  const handleRequestCancel = () => {
    if (hasUnsavedChanges) {
      setPendingUnsavedAction('cancel');
      return;
    }
    discardAndResetToView();
  };

  const handleRequestClosePanel = () => {
    if (!onClosePanel) return;
    if (hasUnsavedChanges) {
      setPendingUnsavedAction('close_panel');
      return;
    }
    onClosePanel();
  };

  const handleConfirmDiscardUnsaved = () => {
    const action = pendingUnsavedAction;
    setPendingUnsavedAction(null);
    if (action === 'close_panel') {
      setEditBuffer(headerSetting.currentCss);
      setReplaceBuffer('');
      setMode('view');
      onClosePanel?.();
      return;
    }
    if (action === 'switch_to_edit') {
      setReplaceBuffer('');
      setEditBuffer(headerSetting.currentCss);
      setMode('edit');
      return;
    }
    if (action === 'switch_to_replace') {
      setEditBuffer(headerSetting.currentCss);
      setReplaceBuffer('');
      setMode('replace');
      return;
    }
    discardAndResetToView();
    onShowToast?.('Discarded unsaved Fourthwall Header CSS changes.');
  };

  const handleSaveChanges = async () => {
    const rawCandidate = mode === 'replace' ? replaceBuffer : editBuffer;
    const normalized = normalizeHeaderCssInput(rawCandidate);
    if (!normalized) {
      setSaveFeedback({
        type: 'error',
        message: 'Fourthwall Header CSS cannot be empty. Please enter or paste valid CSS rules.',
      });
      return;
    }

    setSaving(true);
    setSaveFeedback(null);
    setPendingUnsavedAction(null);

    try {
      const saved = await saveFourthwallHeaderCss(normalized, userId);
      setHeaderSetting(saved);
      setEditBuffer(saved.currentCss);
      setReplaceBuffer('');
      setMode('view');
      const statusMsg =
        saved.syncStatus === 'saved_local_and_cloud'
          ? `Saved Fourthwall Header CSS (${saved.currentCss.length.toLocaleString()} chars) to browser storage & Cloud Firestore. Live Preview updated.`
          : saved.syncStatus === 'saved_local_cloud_failed'
          ? `Saved Fourthwall Header CSS locally (${saved.currentCss.length.toLocaleString()} chars), but cloud sync failed: ${saved.syncDiagnostic || 'Check connection'}`
          : `Saved Fourthwall Header CSS (${saved.currentCss.length.toLocaleString()} chars). Live Preview updated immediately.`;
      setSaveFeedback({
        type: saved.syncStatus === 'saved_local_cloud_failed' ? 'error' : 'saved',
        message: statusMsg,
      });
      onShowToast?.('Saved Fourthwall Header CSS and updated Live Preview.');
    } catch (err) {
      const errMsg =
        err instanceof Error
          ? err.message
          : 'Failed to save Fourthwall Header CSS to persistent storage.';
      setSaveFeedback({
        type: 'error',
        message: errMsg,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRestorePreviousVersion = async () => {
    if (!headerSetting.previousCss) return;
    setSaving(true);
    setSaveFeedback(null);
    setPendingUnsavedAction(null);

    try {
      const restored = await restorePreviousFourthwallHeaderCss(userId);
      setHeaderSetting(restored);
      setEditBuffer(restored.currentCss);
      setReplaceBuffer('');
      setMode('view');
      setSaveFeedback({
        type: 'restored',
        message: `Restored previous Fourthwall Header CSS version (${restored.currentCss.length.toLocaleString()} chars). Live Preview updated immediately.`,
      });
      onShowToast?.('Restored previous Fourthwall Header CSS stylesheet.');
    } catch (err) {
      const errMsg =
        err instanceof Error
          ? err.message
          : 'Failed to restore previous Fourthwall Header CSS version.';
      setSaveFeedback({
        type: 'error',
        message: errMsg,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCopyBackupCss = async () => {
    const cssToCopy = mode === 'edit' ? editBuffer : headerSetting.currentCss;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(cssToCopy);
        setCopyFeedback(`Copied ${cssToCopy.length.toLocaleString()} chars to clipboard.`);
        onShowToast?.('Copied Fourthwall Header CSS to clipboard.');
        window.setTimeout(() => setCopyFeedback(null), 2500);
        return;
      }
      throw new Error('Clipboard API unavailable');
    } catch {
      if (editTextareaRef.current) {
        editTextareaRef.current.focus();
        editTextareaRef.current.select();
      }
      setCopyFeedback('Selected CSS in editor — press Ctrl+C (or Cmd+C) to copy.');
      window.setTimeout(() => setCopyFeedback(null), 3500);
    }
  };

  const handleDownloadBackupCss = () => {
    const cssToDownload = mode === 'edit' ? editBuffer : headerSetting.currentCss;
    const blob = new Blob([cssToDownload], { type: 'text/css;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fourthwall-header-css-backup-${new Date().toISOString().slice(0, 10)}.css`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    onShowToast?.(`Downloaded ${a.download}.`);
  };

  const displayedCss = mode === 'edit' ? editBuffer : headerSetting.currentCss;
  const lineCount = displayedCss.split('\n').length;
  const isDefaultBaseline =
    normalizeHeaderCssInput(headerSetting.currentCss) === DEFAULT_GIFT_GUIDE_CSS;

  return (
    <section
      aria-label="Fourthwall Header CSS (Live Preview Reference)"
      className={`bg-white border border-[#DED8CA] rounded-xl ${
        compact ? 'p-4 space-y-3' : 'p-6 space-y-4'
      } shadow-2xs text-xs`}
    >
      {/* Header Row */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#EAE4D8] pb-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-editorial font-semibold text-[#111A27]">
              Fourthwall Header CSS (Live Preview Reference)
            </h2>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                isDefaultBaseline
                  ? 'bg-[#EFECE2] text-[#3E4C5E] border border-[#D5CFC0]'
                  : 'bg-[#E1F2EA] text-[#134634] border border-[#96CDB0]'
              }`}
            >
              {isDefaultBaseline ? 'Default Header Reference' : 'Custom Header CSS Saved'}
            </span>
            {hasUnsavedChanges && (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-900 border border-amber-300">
                Unsaved Edits
              </span>
            )}
            <span className="text-[11px] font-mono-tabular text-[#5E6B7C]">
              {displayedCss.length.toLocaleString()} chars · {lineCount.toLocaleString()} lines
            </span>
          </div>
          <p className="text-xs text-[#3E4C5E] max-w-3xl leading-relaxed">
            This global stylesheet mirrors the CSS installed in your Fourthwall website{' '}
            <code className="font-mono-tabular">&lt;head&gt;</code>. It is injected automatically
            into the isolated CMS Live Preview across all gift guides, and is{' '}
            <strong>never</strong> automatically inserted into exported guide HTML or individual
            sections.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleOpenEditMode}
            className={
              mode === 'edit'
                ? 'px-3 py-1.5 rounded-lg font-semibold bg-[#111A27] text-white inline-flex items-center gap-1.5'
                : 'sog-btn-secondary py-1.5 px-3'
            }
          >
            <Pencil className="w-3.5 h-3.5" />
            <span>Edit CSS</span>
          </button>

          <button
            type="button"
            onClick={handleOpenReplaceMode}
            className={
              mode === 'replace'
                ? 'px-3 py-1.5 rounded-lg font-semibold bg-[#1A567B] text-white inline-flex items-center gap-1.5'
                : 'sog-btn-powder py-1.5 px-3'
            }
          >
            <Replace className="w-3.5 h-3.5" />
            <span>Replace CSS</span>
          </button>

          <button
            type="button"
            disabled={!headerSetting.previousCss || saving}
            onClick={() => void handleRestorePreviousVersion()}
            className="sog-btn-secondary py-1.5 px-3 disabled:opacity-45 disabled:cursor-not-allowed"
            title={
              headerSetting.previousCss
                ? `Restore previous saved stylesheet (${headerSetting.previousCss.length.toLocaleString()} chars)`
                : 'No previous saved version available yet'
            }
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Restore Previous Version</span>
          </button>

          <button
            type="button"
            onClick={() => void handleCopyBackupCss()}
            className="sog-btn-secondary py-1.5 px-2.5"
            title="Copy current Fourthwall Header CSS stylesheet as a backup"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Copy CSS</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadBackupCss}
            className="sog-btn-secondary py-1.5 px-2.5"
            title="Download current Fourthwall Header CSS stylesheet (.css backup)"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download Backup</span>
          </button>

          {onClosePanel && (
            <button
              type="button"
              onClick={handleRequestClosePanel}
              className="p-1.5 text-[#5E6B7C] hover:text-[#111A27] rounded-lg"
              title="Close Fourthwall Header CSS panel"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Unsaved-Changes Confirmation Warning Banner */}
      {pendingUnsavedAction && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
            <span>
              You have unsaved changes to the Fourthwall Header CSS. Discard unsaved changes?
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPendingUnsavedAction(null)}
              className="sog-btn-secondary py-1 px-2.5"
            >
              Keep Editing
            </button>
            <button
              type="button"
              onClick={handleConfirmDiscardUnsaved}
              className="px-3 py-1 bg-red-700 hover:bg-red-800 text-white rounded-lg font-semibold"
            >
              Discard Unsaved Changes
            </button>
          </div>
        </div>
      )}

      {/* Save / Restore / Persistence Failure Feedback Banner */}
      {saveFeedback && (
        <div
          role={saveFeedback.type === 'error' ? 'alert' : 'status'}
          className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${
            saveFeedback.type === 'error'
              ? 'bg-red-50 border-red-300 text-red-950'
              : 'bg-[#E1F2EA] border-[#96CDB0] text-[#134634]'
          }`}
        >
          <div className="flex items-center gap-2 font-semibold">
            {saveFeedback.type === 'error' ? (
              <AlertCircle className="w-4 h-4 text-red-700 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-[#134634] shrink-0" />
            )}
            <span>{saveFeedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setSaveFeedback(null)}
            className="text-[11px] underline opacity-80 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {copyFeedback && (
        <div
          role="status"
          className="p-2.5 rounded-lg bg-[#EFF6FA] border border-[#94C0D6] text-[#123E59] flex items-center gap-2 font-semibold"
        >
          <Check className="w-3.5 h-3.5 shrink-0" />
          <span>{copyFeedback}</span>
        </div>
      )}

      {/* REPLACE CSS MODE */}
      {mode === 'replace' && (
        <div className="bg-[#EFF6FA] border border-[#94C0D6] rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[10px] uppercase tracking-wider font-bold text-[#1A567B]">
                Replace Entire Fourthwall Header Stylesheet
              </p>
              <h3 className="text-sm font-editorial font-semibold text-[#111A27]">
                Paste New Fourthwall Header CSS
              </h3>
              <p className="text-[#3E4C5E] mt-0.5">
                Paste either raw CSS or CSS wrapped in <code>&lt;style&gt;...&lt;/style&gt;</code>{' '}
                tags. Outer <code>&lt;style&gt;</code> tags are normalized automatically, and your
                current stylesheet will be preserved for one-click recovery via{' '}
                <strong>Restore Previous Version</strong>.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setReplaceBuffer(headerSetting.currentCss)}
              className="sog-btn-secondary py-1 px-2.5"
            >
              Load Current Header CSS into Box
            </button>
          </div>

          <textarea
            ref={replaceTextareaRef}
            rows={compact ? 10 : 14}
            aria-label="Replace Fourthwall Header CSS Input"
            value={replaceBuffer}
            onChange={(e) => setReplaceBuffer(e.target.value)}
            placeholder="Paste your complete Fourthwall Header CSS stylesheet here (raw CSS or <style>...</style>)..."
            spellCheck={false}
            className="w-full p-4 bg-[#111926] text-[#E6EEF8] rounded-xl font-mono-tabular text-xs leading-relaxed focus:outline-none border border-[#2C3E58]"
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-mono-tabular text-[#3E4C5E]">
              Replacement size: {replaceBuffer.length.toLocaleString()} characters (no size truncation)
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleRequestCancel}
                className="sog-btn-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSaveChanges()}
                className="sog-btn-mint"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{saving ? 'Saving...' : 'Save Changes'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT CSS OR VIEW MODE */}
      {mode !== 'replace' && (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-[#111A27]">
                {mode === 'edit'
                  ? 'Editing Fourthwall Header CSS Stylesheet:'
                  : 'Current Active Fourthwall Header CSS Stylesheet:'}
              </span>
              {headerSetting.updatedAt && (
                <span className="text-[11px] text-[#5E6B7C]">
                  Last saved: {new Date(headerSetting.updatedAt).toLocaleString()}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {mode === 'edit' && (
                <button
                  type="button"
                  onClick={() => {
                    if (editTextareaRef.current) {
                      editTextareaRef.current.focus();
                      editTextareaRef.current.select();
                    }
                  }}
                  className="text-[11px] font-semibold text-[#1A567B] hover:underline inline-flex items-center gap-1"
                >
                  <Code className="w-3 h-3" />
                  <span>Select All</span>
                </button>
              )}
            </div>
          </div>

          <textarea
            ref={editTextareaRef}
            readOnly={mode !== 'edit'}
            rows={compact ? 10 : 14}
            aria-label="Fourthwall Header CSS Code Editor"
            value={mode === 'edit' ? editBuffer : headerSetting.currentCss}
            onChange={(e) => {
              if (mode !== 'edit') {
                setMode('edit');
              }
              setEditBuffer(e.target.value);
            }}
            spellCheck={false}
            className={`w-full p-4 bg-[#111926] text-[#E6EEF8] rounded-xl font-mono-tabular text-xs leading-relaxed focus:outline-none border ${
              mode === 'edit'
                ? 'border-[#38BDF8] ring-1 ring-[#38BDF8]/40'
                : 'border-[#2C3E58]'
            }`}
          />

          {mode === 'edit' && (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-[#5E6B7C]">
                Tip: You can paste either raw CSS or <code>&lt;style&gt;...&lt;/style&gt;</code>{' '}
                blocks; outer <code>&lt;style&gt;</code> wrappers are normalized automatically on save.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRequestCancel}
                  className="sog-btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleSaveChanges()}
                  className="sog-btn-mint"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{saving ? 'Saving...' : 'Save Changes'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
