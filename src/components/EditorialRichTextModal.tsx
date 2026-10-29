import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Bold,
  Italic,
  Link2,
  Unlink,
  List,
  ListOrdered,
  Pilcrow,
  Undo2,
  Redo2,
  Code,
  Eye,
  X,
  Check,
  AlertTriangle,
  ExternalLink,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import {
  countWords,
  extractPlainTextFromHtml,
  isSafeUrl,
  sanitizeEditorialRichHtml,
} from '../services/editorialRichText';

export type EditorialFieldKey = 'dek' | 'description' | 'specsCallout';

interface EditorialRichTextModalProps {
  isOpen: boolean;
  fieldKey: EditorialFieldKey;
  cardTitle?: string;
  initialValue: string;
  onSave: (sanitizedHtml: string, plainText: string) => void;
  onClose: () => void;
}

const FIELD_METADATA: Record<
  EditorialFieldKey,
  {
    title: string;
    label: string;
    subtitle: string;
    placeholder: string;
    allowLists: boolean;
    allowParagraphs: boolean;
  }
> = {
  dek: {
    title: 'Edit Subheadline / Dek',
    label: 'Subheadline / Dek',
    subtitle:
      'A punchy single-line summary displayed immediately below the product title. Supports bold, italics, and inline links.',
    placeholder: 'Enter a compelling 1-line subheadline...',
    allowLists: false,
    allowParagraphs: false,
  },
  description: {
    title: 'Edit Editorial Copy',
    label: 'Editorial Copy',
    subtitle:
      'Detailed editorial review and recommendation. Supports multiple paragraphs, bold, italics, links, and bulleted or numbered lists.',
    placeholder: 'Write your editorial copy and recommendation...',
    allowLists: true,
    allowParagraphs: true,
  },
  specsCallout: {
    title: 'Edit Specifications Callout',
    label: 'Specifications Callout',
    subtitle:
      'Key materials, dimensions, fit, or manufacturing notes. Supports bullet points, formatted text, and links.',
    placeholder: 'Enter specs (e.g. • 100% Linen • Made in Portugal)...',
    allowLists: true,
    allowParagraphs: true,
  },
};

export const EditorialRichTextModal: React.FC<EditorialRichTextModalProps> = ({
  isOpen,
  fieldKey,
  cardTitle,
  initialValue,
  onSave,
  onClose,
}) => {
  const meta = FIELD_METADATA[fieldKey] || FIELD_METADATA.description;

  const [mode, setMode] = useState<'visual' | 'source'>('visual');
  const [sourceValue, setSourceValue] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  // Link Editor Popover state
  const [linkEditorOpen, setLinkEditorOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');
  const [linkNewTab, setLinkNewTab] = useState(true);
  const [linkError, setLinkError] = useState<string | null>(null);
  const savedSelectionRef = useRef<Range | null>(null);

  const editorRef = useRef<HTMLDivElement>(null);
  const initialValueRef = useRef(initialValue);

  // Initialize or reset when modal opens
  useEffect(() => {
    if (isOpen) {
      const cleanInitial = initialValue?.trim() || '';
      initialValueRef.current = cleanInitial;
      setSourceValue(cleanInitial);
      setIsDirty(false);
      setShowDiscardConfirm(false);
      setLinkEditorOpen(false);
      setMode('visual');

      // Populate contentEditable on next tick
      setTimeout(() => {
        if (editorRef.current) {
          editorRef.current.innerHTML = cleanInitial;
        }
      }, 0);
    }
  }, [isOpen, initialValue, fieldKey]);

  // Synchronize between visual mode and source mode
  const syncToSource = useCallback(() => {
    if (editorRef.current) {
      const currentHtml = editorRef.current.innerHTML;
      setSourceValue(currentHtml);
      return currentHtml;
    }
    return sourceValue;
  }, [sourceValue]);

  const syncToVisual = useCallback(
    (htmlToSet?: string) => {
      const html = htmlToSet !== undefined ? htmlToSet : sourceValue;
      if (editorRef.current) {
        editorRef.current.innerHTML = html;
      }
    },
    [sourceValue]
  );

  const handleVisualInput = () => {
    if (!editorRef.current) return;
    const currentHtml = editorRef.current.innerHTML;
    setSourceValue(currentHtml);
    const hasChanged = currentHtml.trim() !== initialValueRef.current.trim();
    setIsDirty(hasChanged);
  };

  const handleSourceChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setSourceValue(val);
    const hasChanged = val.trim() !== initialValueRef.current.trim();
    setIsDirty(hasChanged);
  };

  const handleSwitchMode = (newMode: 'visual' | 'source') => {
    if (newMode === mode) return;
    if (newMode === 'source') {
      syncToSource();
    } else {
      syncToVisual(sourceValue);
    }
    setMode(newMode);
    setLinkEditorOpen(false);
  };

  // Safe command executor
  const executeCommand = (command: string, value: string | undefined = undefined) => {
    if (mode !== 'visual') return;
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    handleVisualInput();
  };

  // Save current selection range before opening link popover
  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      savedSelectionRef.current = sel.getRangeAt(0).cloneRange();
    } else {
      savedSelectionRef.current = null;
    }
  };

  const restoreSelection = () => {
    if (savedSelectionRef.current) {
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(savedSelectionRef.current);
      }
    }
  };

  // Find if cursor/selection is currently inside an <a> tag
  const findParentAnchor = (): HTMLAnchorElement | null => {
    const sel = window.getSelection();
    if (!sel || !sel.anchorNode) return null;
    let node: Node | null = sel.anchorNode;
    while (node && node !== editorRef.current) {
      if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === 'A') {
        return node as HTMLAnchorElement;
      }
      node = node.parentNode;
    }
    return null;
  };

  const handleOpenLinkEditor = () => {
    if (mode !== 'visual') return;
    saveSelection();
    const anchor = findParentAnchor();
    if (anchor) {
      setLinkUrl(anchor.getAttribute('href') || '');
      setLinkText(anchor.textContent || '');
      setLinkNewTab(anchor.getAttribute('target') === '_blank');
    } else {
      const selectedText = savedSelectionRef.current?.toString() || '';
      setLinkText(selectedText);
      setLinkUrl('');
      setLinkNewTab(true);
    }
    setLinkError(null);
    setLinkEditorOpen(true);
  };

  const handleApplyLink = () => {
    const trimmedUrl = linkUrl.trim();
    if (!trimmedUrl) {
      setLinkError('Please provide a destination URL (e.g. https://example.com or #anchor)');
      return;
    }
    if (!isSafeUrl(trimmedUrl)) {
      setLinkError('Unsafe link protocol. URLs must start with https://, http://, mailto:, #, or /');
      return;
    }

    restoreSelection();
    editorRef.current?.focus();

    const anchor = findParentAnchor();
    if (anchor) {
      // Update existing anchor element
      anchor.setAttribute('href', trimmedUrl);
      if (linkText.trim()) {
        anchor.textContent = linkText.trim();
      }
      if (linkNewTab) {
        anchor.setAttribute('target', '_blank');
        anchor.setAttribute('rel', 'noopener noreferrer');
      } else {
        anchor.removeAttribute('target');
        anchor.removeAttribute('rel');
      }
    } else {
      // Insert new link
      const textToInsert = linkText.trim() || trimmedUrl;
      const targetAttr = linkNewTab ? ' target="_blank" rel="noopener noreferrer"' : '';
      const anchorHtml = `<a href="${trimmedUrl}"${targetAttr}>${textToInsert}</a>`;

      if (savedSelectionRef.current && !savedSelectionRef.current.collapsed) {
        document.execCommand('insertHTML', false, anchorHtml);
      } else {
        document.execCommand('insertHTML', false, anchorHtml);
      }
    }

    setLinkEditorOpen(false);
    handleVisualInput();
  };

  const handleRemoveLink = () => {
    restoreSelection();
    editorRef.current?.focus();
    const anchor = findParentAnchor();
    if (anchor) {
      const text = anchor.textContent || '';
      const textNode = document.createTextNode(text);
      anchor.parentNode?.replaceChild(textNode, anchor);
    } else {
      document.execCommand('unlink', false);
    }
    setLinkEditorOpen(false);
    handleVisualInput();
  };

  // Keyboard navigation & Esc handling
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (linkEditorOpen) {
          setLinkEditorOpen(false);
        } else if (showDiscardConfirm) {
          setShowDiscardConfirm(false);
        } else if (isDirty) {
          setShowDiscardConfirm(true);
        } else {
          onClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, linkEditorOpen, showDiscardConfirm, isDirty, onClose]);

  const handleAttemptClose = () => {
    if (isDirty) {
      setShowDiscardConfirm(true);
    } else {
      onClose();
    }
  };

  const handleConfirmDiscard = () => {
    setShowDiscardConfirm(false);
    setIsDirty(false);
    onClose();
  };

  const handleSave = () => {
    const rawContent = mode === 'visual' ? (editorRef.current?.innerHTML || '') : sourceValue;
    const sanitized = sanitizeEditorialRichHtml(rawContent);
    const plainText = extractPlainTextFromHtml(sanitized);

    setIsDirty(false);
    onSave(sanitized, plainText);
    onClose();
  };

  if (!isOpen) return null;

  const currentContent = mode === 'visual' ? (editorRef.current?.innerHTML || '') : sourceValue;
  const wordCount = countWords(currentContent);
  const charCount = extractPlainTextFromHtml(currentContent).length;
  const hasLinks = /<a\b/i.test(currentContent);
  const hasFormatting = /<(strong|b|em|i|u|ul|ol)\b/i.test(currentContent);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="rich-editor-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-[#111A27]/60 backdrop-blur-xs transition-opacity"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleAttemptClose();
        }
      }}
    >
      <div className="bg-[#FAF8F5] border border-[#C8C0B0] rounded-xl shadow-2xl flex flex-col max-h-[92vh] w-full max-w-3xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* MODAL HEADER */}
        <div className="bg-[#111A27] text-white px-5 py-3.5 flex items-center justify-between border-b border-[#2A3B4D] shrink-0">
          <div className="min-w-0 pr-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-[#1A567B] text-[#E1F2EA]">
                {meta.label}
              </span>
              {cardTitle && (
                <span className="text-xs text-slate-300 truncate font-editorial">
                  {cardTitle}
                </span>
              )}
            </div>
            <h2 id="rich-editor-title" className="text-base font-bold font-editorial text-white mt-0.5">
              {meta.title}
            </h2>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* View Mode Toggle: Visual vs HTML */}
            <div className="inline-flex items-center bg-[#1D2939] p-0.5 rounded-lg border border-[#344054] text-xs">
              <button
                type="button"
                onClick={() => handleSwitchMode('visual')}
                className={`px-2.5 py-1 rounded-md font-semibold transition-all inline-flex items-center gap-1.5 ${
                  mode === 'visual'
                    ? 'bg-[#1A567B] text-white shadow-xs'
                    : 'text-slate-300 hover:text-white'
                }`}
                title="Visual rich-text editor"
              >
                <Eye className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Visual</span>
              </button>
              <button
                type="button"
                onClick={() => handleSwitchMode('source')}
                className={`px-2.5 py-1 rounded-md font-semibold transition-all inline-flex items-center gap-1.5 ${
                  mode === 'source'
                    ? 'bg-[#1A567B] text-white shadow-xs'
                    : 'text-slate-300 hover:text-white'
                }`}
                title="Direct HTML source editor"
              >
                <Code className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">HTML</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleAttemptClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              title="Close editor (Esc)"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* GUIDANCE BANNER */}
        <div className="bg-[#F4EFE6] px-5 py-2 border-b border-[#E5DFD3] text-xs text-[#483F30] flex items-center justify-between gap-3 shrink-0">
          <p className="leading-snug">{meta.subtitle}</p>
          {isDirty && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-[#FFF4DE] text-[#8C5E00] border border-[#F3D797] shrink-0">
              <AlertTriangle className="w-3 h-3" />
              Unsaved changes
            </span>
          )}
        </div>

        {/* FORMATTING TOOLBAR (Visual Mode) */}
        {mode === 'visual' && (
          <div className="bg-[#EFECE2] border-b border-[#D5CFC0] px-3 py-1.5 flex flex-wrap items-center gap-1 shrink-0 text-xs">
            {/* History: Undo / Redo */}
            <div className="flex items-center gap-0.5 pr-1.5 border-r border-[#C8C0B0]">
              <button
                type="button"
                onClick={() => executeCommand('undo')}
                className="p-1.5 rounded hover:bg-[#DDD6C8] active:bg-[#CCC3B2] text-[#111A27] transition-colors"
                title="Undo (Ctrl+Z)"
              >
                <Undo2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => executeCommand('redo')}
                className="p-1.5 rounded hover:bg-[#DDD6C8] active:bg-[#CCC3B2] text-[#111A27] transition-colors"
                title="Redo (Ctrl+Y)"
              >
                <Redo2 className="w-4 h-4" />
              </button>
            </div>

            {/* Inline Formatting: Bold / Italic */}
            <div className="flex items-center gap-0.5 px-1.5 border-r border-[#C8C0B0]">
              <button
                type="button"
                onClick={() => executeCommand('bold')}
                className="p-1.5 rounded hover:bg-[#DDD6C8] active:bg-[#CCC3B2] text-[#111A27] font-bold transition-colors"
                title="Bold (Ctrl+B)"
              >
                <Bold className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => executeCommand('italic')}
                className="p-1.5 rounded hover:bg-[#DDD6C8] active:bg-[#CCC3B2] text-[#111A27] italic transition-colors"
                title="Italic (Ctrl+I)"
              >
                <Italic className="w-4 h-4" />
              </button>
            </div>

            {/* Hyperlink Controls */}
            <div className="flex items-center gap-0.5 px-1.5 border-r border-[#C8C0B0]">
              <button
                type="button"
                onClick={handleOpenLinkEditor}
                className="p-1.5 rounded hover:bg-[#DDD6C8] active:bg-[#CCC3B2] text-[#111A27] inline-flex items-center gap-1 transition-colors"
                title="Insert or Edit Hyperlink"
              >
                <Link2 className="w-4 h-4" />
                <span className="hidden sm:inline font-semibold text-[11px]">Link</span>
              </button>
              <button
                type="button"
                onClick={handleRemoveLink}
                className="p-1.5 rounded hover:bg-[#DDD6C8] active:bg-[#CCC3B2] text-[#111A27] transition-colors"
                title="Remove Link (Unlink)"
              >
                <Unlink className="w-4 h-4" />
              </button>
            </div>

            {/* Block Formatting (Paragraphs & Lists) if permitted for field */}
            {meta.allowParagraphs && (
              <div className="flex items-center gap-0.5 px-1.5 border-r border-[#C8C0B0]">
                <button
                  type="button"
                  onClick={() => executeCommand('formatBlock', '<p>')}
                  className="p-1.5 rounded hover:bg-[#DDD6C8] active:bg-[#CCC3B2] text-[#111A27] inline-flex items-center gap-1 transition-colors"
                  title="Format as Paragraph"
                >
                  <Pilcrow className="w-4 h-4" />
                  <span className="hidden sm:inline text-[11px] font-semibold">Paragraph</span>
                </button>
              </div>
            )}

            {meta.allowLists && (
              <div className="flex items-center gap-0.5 px-1.5 border-r border-[#C8C0B0]">
                <button
                  type="button"
                  onClick={() => executeCommand('insertUnorderedList')}
                  className="p-1.5 rounded hover:bg-[#DDD6C8] active:bg-[#CCC3B2] text-[#111A27] transition-colors"
                  title="Bulleted List (•)"
                >
                  <List className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => executeCommand('insertOrderedList')}
                  className="p-1.5 rounded hover:bg-[#DDD6C8] active:bg-[#CCC3B2] text-[#111A27] transition-colors"
                  title="Numbered List (1, 2, 3)"
                >
                  <ListOrdered className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Clear Formatting */}
            <div className="flex items-center gap-0.5 pl-1.5 ml-auto">
              <button
                type="button"
                onClick={() => executeCommand('removeFormat')}
                className="px-2 py-1 rounded hover:bg-[#DDD6C8] active:bg-[#CCC3B2] text-[#665D4D] hover:text-[#111A27] text-[11px] font-semibold transition-colors"
                title="Clear inline formatting from selection"
              >
                Clear Format
              </button>
            </div>
          </div>
        )}

        {/* INLINE LINK EDITOR POPOVER */}
        {linkEditorOpen && (
          <div className="bg-[#DFEEF5] border-b border-[#94C0D6] px-4 py-3 flex flex-col gap-2.5 shadow-inner animate-in slide-in-from-top-2 duration-150">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#123E59] inline-flex items-center gap-1.5">
                <Link2 className="w-3.5 h-3.5" />
                Insert / Edit Hyperlink
              </span>
              <button
                type="button"
                onClick={() => setLinkEditorOpen(false)}
                className="text-[#123E59] hover:text-black p-0.5"
                title="Cancel link"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="text-[11px] font-semibold text-[#123E59] block mb-0.5">
                  Link Text (anchor label)
                </label>
                <input
                  type="text"
                  value={linkText}
                  onChange={(e) => setLinkText(e.target.value)}
                  placeholder="e.g. Shop on Fourthwall"
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-[#94C0D6] rounded focus:outline-none focus:ring-1 focus:ring-[#1A567B]"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-[#123E59] block mb-0.5">
                  Destination URL
                </label>
                <input
                  type="text"
                  value={linkUrl}
                  onChange={(e) => {
                    setLinkUrl(e.target.value);
                    setLinkError(null);
                  }}
                  placeholder="https://... or #anchor"
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-[#94C0D6] rounded focus:outline-none focus:ring-1 focus:ring-[#1A567B]"
                />
              </div>
            </div>

            {linkError && (
              <p className="text-[11px] font-semibold text-[#B3261E]">{linkError}</p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <label className="inline-flex items-center gap-2 text-xs text-[#123E59] cursor-pointer">
                <input
                  type="checkbox"
                  checked={linkNewTab}
                  onChange={(e) => setLinkNewTab(e.target.checked)}
                  className="rounded text-[#1A567B] focus:ring-[#1A567B]"
                />
                <span>Open in new window / tab (target=&quot;_blank&quot;)</span>
              </label>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRemoveLink}
                  className="px-2.5 py-1 text-xs font-semibold text-[#7D221C] hover:bg-[#FBEAE9] rounded border border-[#E9A8A6] transition-colors"
                >
                  Remove Link
                </button>
                <button
                  type="button"
                  onClick={handleApplyLink}
                  className="px-3.5 py-1 text-xs font-bold text-white bg-[#1A567B] hover:bg-[#123E59] rounded shadow-xs transition-colors"
                >
                  Apply Link
                </button>
              </div>
            </div>
          </div>
        )}

        {/* EDITOR AREA */}
        <div className="flex-1 p-5 overflow-y-auto min-h-[220px] max-h-[55vh] bg-white">
          {mode === 'visual' ? (
            <div
              ref={editorRef}
              contentEditable
              onInput={handleVisualInput}
              role="textbox"
              aria-multiline="true"
              aria-label={meta.title}
              data-placeholder={meta.placeholder}
              className="outline-none min-h-[200px] font-serif text-[#111A27] text-base leading-relaxed selection:bg-[#BEE1F4] selection:text-[#111A27] [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-3 [&_li]:mb-1 [&_a]:text-[#1A567B] [&_a]:underline [&_strong]:font-bold [&_em]:italic empty:before:content-[attr(data-placeholder)] empty:before:text-slate-400 empty:before:pointer-events-none"
            />
          ) : (
            <textarea
              value={sourceValue}
              onChange={handleSourceChange}
              placeholder={meta.placeholder}
              rows={12}
              aria-label="Direct HTML Source"
              className="w-full h-full min-h-[200px] font-mono text-xs text-[#111A27] bg-[#FAF8F5] p-3 border border-[#D5CFC0] rounded-md focus:outline-none focus:border-[#1A567B] leading-relaxed resize-y"
            />
          )}
        </div>

        {/* BOTTOM METRICS & FORMATTING TAGS BAR */}
        <div className="bg-[#FAF8F5] border-t border-[#E5DFD3] px-5 py-2 flex flex-wrap items-center justify-between gap-3 text-xs text-[#665D4D] shrink-0">
          <div className="flex items-center gap-3">
            <span>
              <strong>{wordCount}</strong> {wordCount === 1 ? 'word' : 'words'}
            </span>
            <span className="text-[#D5CFC0]">•</span>
            <span>
              <strong>{charCount}</strong> characters
            </span>
          </div>

          <div className="flex items-center gap-2">
            {hasFormatting && (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-[#E8E4D8] text-[#4A4335]">
                Formatted Text
              </span>
            )}
            {hasLinks && (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-[#DFEEF5] text-[#123E59] inline-flex items-center gap-1">
                <ExternalLink className="w-2.5 h-2.5" />
                Links Active
              </span>
            )}
          </div>
        </div>

        {/* DISCARD CONFIRMATION BANNER */}
        {showDiscardConfirm && (
          <div className="bg-[#FFF4DE] border-t border-[#F3D797] px-5 py-3 flex flex-wrap items-center justify-between gap-3 shrink-0 animate-in fade-in duration-150">
            <div className="flex items-center gap-2 text-xs text-[#8C5E00] font-medium">
              <AlertTriangle className="w-4 h-4 text-[#C47D00] shrink-0" />
              <span>
                <strong>Discard unsaved changes?</strong> You have edits in this field that will be lost.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowDiscardConfirm(false)}
                className="px-3 py-1 text-xs font-semibold bg-white border border-[#F3D797] text-[#8C5E00] rounded hover:bg-[#FFFDF9]"
              >
                Keep Editing
              </button>
              <button
                type="button"
                onClick={handleConfirmDiscard}
                className="px-3 py-1 text-xs font-bold bg-[#B3261E] text-white rounded hover:bg-[#8F1D16]"
              >
                Discard Changes
              </button>
            </div>
          </div>
        )}

        {/* MODAL FOOTER */}
        <div className="bg-[#EFECE2] border-t border-[#D5CFC0] px-5 py-3 flex items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={handleAttemptClose}
            className="px-4 py-2 rounded-lg border border-[#C8C0B0] bg-white text-xs font-semibold text-[#111A27] hover:bg-[#F4EFE6] transition-colors"
          >
            Cancel
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              className="px-5 py-2 rounded-lg bg-[#1A567B] hover:bg-[#123E59] text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm transition-all"
            >
              <Check className="w-4 h-4" />
              <span>Save Changes</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
