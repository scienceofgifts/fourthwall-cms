import React, { useMemo, useState } from 'react';
import { Copy, Check, Download, Code, Eye, Monitor, Smartphone, Tablet } from 'lucide-react';
import { LOCKED_FOURTHWALL_CSS } from '../constants/lockedCss';
import { GuideSection, Product } from '../types/cms';
import { renderFullGuideHtml, renderSectionHtml } from '../services/htmlRenderer';

interface LivePreviewPanelProps {
  sections: GuideSection[];
  activeSectionId: string | null;
  products: Product[];
  guideSlug: string;
}

export const LivePreviewPanel: React.FC<LivePreviewPanelProps> = ({
  sections,
  activeSectionId,
  products,
  guideSlug,
}) => {
  const [previewScope, setPreviewScope] = useState<'section' | 'full'>('section');
  const [viewTab, setViewTab] = useState<'visual' | 'html'>('visual');
  const [viewportWidth, setViewportWidth] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  const activeSection = useMemo(
    () => sections.find((s) => s.id === activeSectionId) || sections[0] || null,
    [sections, activeSectionId]
  );

  // Rendered HTML for visual preview (includes fallback SVG data URIs when product imageUrl is blank)
  const visualHtml = useMemo(() => {
    if (previewScope === 'section') {
      if (!activeSection) return '<p>Select or create a section to preview.</p>';
      return renderSectionHtml(activeSection, products, { forPreview: true });
    }
    return renderFullGuideHtml(sections, products, { forPreview: true });
  }, [previewScope, activeSection, sections, products]);

  // Exact exported HTML for Fourthwall custom-code block (never includes preview stylesheet or preview SVGs)
  const exportHtml = useMemo(() => {
    if (previewScope === 'section') {
      if (!activeSection) return '';
      return renderSectionHtml(activeSection, products, { forPreview: false });
    }
    return renderFullGuideHtml(sections, products, { forPreview: false });
  }, [previewScope, activeSection, sections, products]);

  // Complete srcDoc for the isolated iframe preview so Fourthwall responsive breakpoints (@media) work accurately
  const iframeSrcDoc = useMemo(() => {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body {
      margin: 0;
      padding: 20px 24px 60px 24px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #111;
      background: #ffffff;
      line-height: 1.5;
    }
    * { box-sizing: border-box; }
    ${LOCKED_FOURTHWALL_CSS}
  </style>
</head>
<body>
  ${visualHtml}
</body>
</html>`;
  }, [visualHtml]);

  const handleCopyExportHtml = async () => {
    if (!exportHtml) return;
    try {
      await navigator.clipboard.writeText(exportHtml);
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus('idle'), 2200);
    } catch {
      setCopyStatus('error');
      setTimeout(() => setCopyStatus('idle'), 3000);
    }
  };

  const handleDownloadHtml = () => {
    if (!exportHtml) return;
    const filename =
      previewScope === 'section' && activeSection
        ? `${guideSlug || 'guide'}-${activeSection.anchorId || activeSection.id}.html`
        : `${guideSlug || 'guide'}-full-fourthwall.html`;

    const blob = new Blob([exportHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const iframeMaxWidth =
    viewportWidth === 'mobile' ? '390px' : viewportWidth === 'tablet' ? '768px' : '100%';

  return (
    <div className="flex flex-col h-full bg-[#E4DFD3] border-l border-[#C5BEB0]">
      {/* Dark Navy Studio Preview Control Deck */}
      <div className="px-4 py-3 bg-[#151F30] text-white border-b border-[#25354F] flex flex-wrap items-center justify-between gap-2.5">
        {/* Distinct Selected States for Section Preview vs Full-Guide Preview */}
        <div
          className="inline-flex items-center p-1 bg-[#0D1420] border border-[#2A3B56] rounded-lg"
          role="group"
          aria-label="Preview Scope"
        >
          <button
            type="button"
            onClick={() => setPreviewScope('section')}
            className={`px-3 py-1.5 text-xs rounded-md transition-all whitespace-nowrap shrink-0 ${
              previewScope === 'section'
                ? 'bg-[#DFEEF5] text-[#111A27] font-semibold shadow-xs'
                : 'text-[#A9B9CE] hover:text-white font-medium'
            }`}
          >
            Section Preview
          </button>
          <button
            type="button"
            onClick={() => setPreviewScope('full')}
            className={`px-3 py-1.5 text-xs rounded-md transition-all whitespace-nowrap shrink-0 ${
              previewScope === 'full'
                ? 'bg-[#DFEEF5] text-[#111A27] font-semibold shadow-xs'
                : 'text-[#A9B9CE] hover:text-white font-medium'
            }`}
          >
            Full-Guide Preview
          </button>
        </div>

        {/* Coherent Viewport & View Mode Toolbar */}
        <div className="flex items-center gap-2">
          <div
            className="inline-flex items-center p-1 bg-[#0D1420] border border-[#2A3B56] rounded-lg"
            role="group"
            aria-label="Viewport Size"
          >
            <button
              type="button"
              onClick={() => setViewportWidth('desktop')}
              title="Desktop Viewport (100%)"
              className={`p-1.5 rounded transition-colors ${
                viewportWidth === 'desktop'
                  ? 'bg-[#253854] text-[#DFEEF5]'
                  : 'text-[#8B9EB7] hover:text-white'
              }`}
            >
              <Monitor className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setViewportWidth('tablet')}
              title="Tablet Viewport (768px)"
              className={`p-1.5 rounded transition-colors ${
                viewportWidth === 'tablet'
                  ? 'bg-[#253854] text-[#DFEEF5]'
                  : 'text-[#8B9EB7] hover:text-white'
              }`}
            >
              <Tablet className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setViewportWidth('mobile')}
              title="Mobile Viewport (390px)"
              className={`p-1.5 rounded transition-colors ${
                viewportWidth === 'mobile'
                  ? 'bg-[#253854] text-[#DFEEF5]'
                  : 'text-[#8B9EB7] hover:text-white'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
            </button>
          </div>

          <div
            className="inline-flex items-center p-1 bg-[#0D1420] border border-[#2A3B56] rounded-lg"
            role="group"
            aria-label="Preview Format"
          >
            <button
              type="button"
              onClick={() => setViewTab('visual')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition-colors whitespace-nowrap shrink-0 ${
                viewTab === 'visual'
                  ? 'bg-[#DFEEF5] text-[#111A27] font-semibold'
                  : 'text-[#A9B9CE] hover:text-white font-medium'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Storefront</span>
            </button>
            <button
              type="button"
              onClick={() => setViewTab('html')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition-colors whitespace-nowrap shrink-0 ${
                viewTab === 'html'
                  ? 'bg-[#DFEEF5] text-[#111A27] font-semibold'
                  : 'text-[#A9B9CE] hover:text-white font-medium'
              }`}
            >
              <Code className="w-3.5 h-3.5" />
              <span>Raw HTML</span>
            </button>
          </div>
        </div>
      </div>

      {/* Contextual Target & Export Sub-Toolbar */}
      <div className="px-4 py-2.5 bg-[#EDE8DC] border-b border-[#CFC8B8] flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="text-[#3E4C5E] truncate min-w-0">
          {previewScope === 'section' && activeSection ? (
            <span className="inline-flex items-center gap-1.5 truncate">
              <span className="uppercase tracking-wider text-[10px] font-bold text-[#5E6B7C]">
                Active Block
              </span>
              <span aria-hidden="true">·</span>
              <strong className="text-[#111A27] font-semibold truncate">
                {activeSection.title}
              </strong>
              <span aria-hidden="true">·</span>
              <code className="font-mono-tabular text-[#1A567B] font-medium">
                #{activeSection.anchorId}
              </code>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <span className="uppercase tracking-wider text-[10px] font-bold text-[#5E6B7C]">
                Full Storefront Page
              </span>
              <span aria-hidden="true">·</span>
              <strong className="font-mono-tabular text-[#111A27]">
                {sections.filter((s) => s.enabled).length}
              </strong>{' '}
              enabled sections assembled
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleCopyExportHtml}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-semibold transition-colors whitespace-nowrap shrink-0 ${
              copyStatus === 'copied'
                ? 'bg-[#E1F2EA] text-[#134634] border border-[#8FC9AE]'
                : 'bg-[#151F30] text-white hover:bg-[#22324B]'
            }`}
          >
            {copyStatus === 'copied' ? (
              <>
                <Check className="w-3.5 h-3.5 text-[#1D634B]" />
                <span>Copied HTML</span>
              </>
            ) : copyStatus === 'error' ? (
              <span>Clipboard Failed</span>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy {previewScope === 'section' ? 'Section' : 'Full'} HTML</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handleDownloadHtml}
            title="Download clean Fourthwall HTML"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white border border-[#C6BEB0] text-[#1D2838] rounded-md font-semibold hover:bg-[#FBF9F5] transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download</span>
          </button>
        </div>
      </div>

      {/* Recessed Studio Preview Stage — Unmistakable Document Boundary */}
      <div className="flex-1 overflow-auto bg-[#E4DFD3] p-4 md:p-5 flex justify-center">
        {viewTab === 'visual' ? (
          <div
            style={{ width: iframeMaxWidth }}
            className="h-full bg-white border border-[#B8B0A0] rounded-lg shadow-[0_10px_28px_-6px_rgba(17,26,39,0.16)] overflow-hidden transition-all duration-150 flex flex-col"
          >
            {/* Subtle Browser / Storefront Frame Header */}
            <div className="px-3.5 py-1.5 bg-[#F6F3EC] border-b border-[#DFD8CA] flex items-center justify-between text-[11px] text-[#5E6B7C] select-none shrink-0">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#D0C8B8]" />
                <span className="w-2 h-2 rounded-full bg-[#D0C8B8]" />
                <span className="w-2 h-2 rounded-full bg-[#D0C8B8]" />
                <span className="ml-1.5 font-medium text-[#3E4C5E]">
                  Fourthwall Storefront Canvas
                </span>
              </div>
              <span className="font-mono-tabular text-[10px] text-[#5E6B7C]">
                {viewportWidth === 'desktop'
                  ? 'Responsive Desktop'
                  : viewportWidth === 'tablet'
                  ? '768px Tablet'
                  : '390px Mobile'}
              </span>
            </div>
            <iframe
              title="Fourthwall Storefront Live Preview"
              srcDoc={iframeSrcDoc}
              sandbox="allow-same-origin"
              className="w-full flex-1 border-0 bg-white"
            />
          </div>
        ) : (
          <div className="w-full h-full bg-[#111926] text-[#E6EEF8] border border-[#2A3B56] rounded-lg p-4 overflow-auto font-mono-tabular text-xs leading-relaxed shadow-inner">
            <pre className="whitespace-pre-wrap break-words">{exportHtml}</pre>
          </div>
        )}
      </div>
    </div>
  );
};
