import React, { useMemo, useState } from 'react';
import {
  Copy,
  Check,
  Download,
  Upload,
  CheckCircle2,
  AlertTriangle,
  Code,
  FileJson,
  ArchiveRestore,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { GiftGuide, GuideSection, Product, ProjectBackup } from '../types/cms';
import {
  extractCanonicalFaqsFromSections,
  renderFullGuideHtml,
  renderSectionHtml,
  validateGuideForExport,
} from '../services/htmlRenderer';
import { generateGuideJsonLd } from '../services/schemaGenerator';
import {
  buildProjectBackupJson,
  validateProjectBackupJson,
} from '../services/firebase';

interface ExportAndSchemaViewProps {
  guide: GiftGuide;
  sections: GuideSection[];
  products: Product[];
  onUpdateGuide: (updated: GiftGuide) => void;
  onSaveGuideNow: () => Promise<void>;
  onRestoreBackup: (backup: ProjectBackup, includeProducts: boolean) => Promise<void>;
}

export const ExportAndSchemaView: React.FC<ExportAndSchemaViewProps> = ({
  guide,
  sections,
  products,
  onUpdateGuide,
  onSaveGuideNow,
  onRestoreBackup,
}) => {
  const [activeTab, setActiveTab] = useState<'html_blocks' | 'json_ld' | 'backup'>('html_blocks');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyErrorId, setCopyErrorId] = useState<string | null>(null);

  // Backup restore state
  const [rawBackupJson, setRawBackupJson] = useState('');
  const [backupValidation, setBackupValidation] = useState<{
    valid: boolean;
    error?: string;
    backup?: ProjectBackup;
  } | null>(null);
  const [includeBackupProducts, setIncludeBackupProducts] = useState(true);
  const [confirmRestoreModal, setConfirmRestoreModal] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const sortedSections = useMemo(
    () => [...sections].sort((a, b) => a.order - b.order),
    [sections]
  );

  const htmlValidationIssues = useMemo(
    () => validateGuideForExport(guide, sections, products),
    [guide, sections, products]
  );

  const fullGuideHtml = useMemo(
    () => renderFullGuideHtml(sections, products, { forPreview: false }),
    [sections, products]
  );

  const schemaResult = useMemo(
    () => generateGuideJsonLd(guide, sections, products),
    [guide, sections, products]
  );

  const canonicalFaqs = useMemo(
    () => extractCanonicalFaqsFromSections(sections),
    [sections]
  );

  const copyToClipboard = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setCopyErrorId(null);
      setTimeout(() => setCopiedId(null), 2200);
    } catch {
      setCopyErrorId(id);
      setTimeout(() => setCopyErrorId(null), 3000);
    }
  };

  const downloadFile = (filename: string, content: string, mime = 'text/html;charset=utf-8') => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Schema config helpers
  const schemaCfg = guide.schemaConfig || {
    siteBaseUrl: guide.storeBaseUrl || 'https://scienceofgifts.com',
    breadcrumbs: [],
    itemListName: guide.title,
    itemListDescription: guide.introText,
    includedProductIds: [],
  };

  const toggleProductInSchema = (productId: string) => {
    const current = [...(schemaCfg.includedProductIds || [])];
    const idx = current.indexOf(productId);
    if (idx >= 0) {
      current.splice(idx, 1);
    } else {
      current.push(productId);
    }
    onUpdateGuide({
      ...guide,
      schemaConfig: {
        ...schemaCfg,
        includedProductIds: current,
      },
    });
  };

  const moveSchemaProduct = (index: number, direction: -1 | 1) => {
    const current = [...(schemaCfg.includedProductIds || [])];
    const target = index + direction;
    if (target < 0 || target >= current.length) return;
    const temp = current[index];
    current[index] = current[target];
    current[target] = temp;
    onUpdateGuide({
      ...guide,
      schemaConfig: {
        ...schemaCfg,
        includedProductIds: current,
      },
    });
  };

  const handleDownloadBackup = () => {
    const backup = buildProjectBackupJson(guide, sections, products);
    downloadFile(
      `${guide.slug || 'guide'}-cms-backup.json`,
      JSON.stringify(backup, null, 2),
      'application/json;charset=utf-8'
    );
  };

  return (
    <div className="max-w-[1380px] mx-auto px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#DED8CA] pb-5">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-[#1A567B] font-bold">
            Production Output &amp; Structured Data
          </p>
          <h1 className="text-3xl font-editorial font-semibold text-[#111A27] mt-1">
            Export &amp; Schema Studio — {guide.title}
          </h1>
          <p className="text-sm text-[#3E4C5E] mt-1 max-w-2xl">
            Export clean, standalone HTML blocks for Fourthwall custom-code sections, generate the
            unified <code className="font-mono-tabular text-[#123E59]">@graph</code> JSON-LD footer
            script, or back up your project state.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#E7E1D3] border border-[#CFC8B8] rounded-xl">
          <button
            type="button"
            onClick={() => setActiveTab('html_blocks')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'html_blocks'
                ? 'bg-[#DFEEF5] text-[#111A27] font-semibold shadow-2xs border border-[#94C0D6]'
                : 'text-[#3E4C5E] hover:text-[#111A27] font-medium'
            }`}
          >
            <Code className="w-3.5 h-3.5" />
            <span>Fourthwall HTML Blocks ({sections.filter((s) => s.enabled).length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('json_ld')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'json_ld'
                ? 'bg-[#DFEEF5] text-[#111A27] font-semibold shadow-2xs border border-[#94C0D6]'
                : 'text-[#3E4C5E] hover:text-[#111A27] font-medium'
            }`}
          >
            <FileJson className="w-3.5 h-3.5" />
            <span>JSON-LD Schema Generator</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('backup')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'backup'
                ? 'bg-[#DFEEF5] text-[#111A27] font-semibold shadow-2xs border border-[#94C0D6]'
                : 'text-[#3E4C5E] hover:text-[#111A27] font-medium'
            }`}
          >
            <ArchiveRestore className="w-3.5 h-3.5" />
            <span>Project Backup (.JSON)</span>
          </button>
        </div>
      </div>

      {/* TAB 1: FOURTHWALL HTML CUSTOM-CODE BLOCKS */}
      {activeTab === 'html_blocks' && (
        <div className="space-y-6">
          {/* Validation Summary Banner */}
          <div className="bg-[#F3EFE6] border border-[#D5CFC0] rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#111A27]">
                {htmlValidationIssues.filter((i) => i.severity === 'error').length === 0 ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-[#1D634B]" />
                    <span>All Fourthwall HTML structural checks passed</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-4 h-4 text-red-600" />
                    <span>
                      {htmlValidationIssues.filter((i) => i.severity === 'error').length} validation
                      error(s) require attention before export
                    </span>
                  </>
                )}
              </div>
              <p className="text-xs text-[#3E4C5E]">
                Exported markup contains zero global CSS, zero application JavaScript, and preserves
                all <code className="font-mono-tabular">sog-*</code> classes and{' '}
                <code className="font-mono-tabular">data-product-url</code> attributes.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => copyToClipboard('full-guide', fullGuideHtml)}
                className={copiedId === 'full-guide' ? 'sog-btn-mint' : 'sog-btn-primary'}
              >
                {copiedId === 'full-guide' ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Copied Full-Guide HTML</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Full Assembled Guide HTML</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() =>
                  downloadFile(`${guide.slug || 'guide'}-full-fourthwall.html`, fullGuideHtml)
                }
                className="sog-btn-secondary"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Full HTML</span>
              </button>
            </div>
          </div>

          {htmlValidationIssues.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-1.5 text-xs">
              <p className="font-semibold text-amber-900">Export Validation Report:</p>
              {htmlValidationIssues.map((issue, idx) => (
                <div
                  key={idx}
                  className={`flex items-center gap-2 ${
                    issue.severity === 'error' ? 'text-red-800 font-medium' : 'text-amber-800'
                  }`}
                >
                  <span>• [{issue.severity.toUpperCase()}]</span>
                  <span>{issue.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* Individual Section Export Cards */}
          <div className="space-y-4">
            {sortedSections.map((sec, idx) => {
              const secHtml = renderSectionHtml(sec, products, { forPreview: false });
              const lineCount = secHtml.split('\n').length;

              return (
                <div
                  key={sec.id}
                  className={`bg-white border rounded-xl overflow-hidden shadow-2xs ${
                    sec.enabled ? 'border-[#DED8CA]' : 'border-[#DED8CA] opacity-60'
                  }`}
                >
                  <div className="px-4 py-3 bg-[#F3EFE6] border-b border-[#DED8CA] flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-mono-tabular font-bold text-[#1A567B]">
                        Block {String(idx + 1).padStart(2, '0')}
                      </span>
                      <span aria-hidden="true">·</span>
                      <strong className="text-sm font-editorial text-[#111A27]">{sec.title}</strong>
                      <span aria-hidden="true">·</span>
                      <code className="font-mono-tabular text-[#123E59]">#{sec.anchorId}</code>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-tabular text-[#5E6B7C]">{lineCount} lines</span>
                      {!sec.enabled && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-amber-700 font-semibold">
                            Disabled in Full Export
                          </span>
                        </>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => copyToClipboard(sec.id, secHtml)}
                        className={copiedId === sec.id ? 'sog-btn-mint' : 'sog-btn-primary'}
                      >
                        {copiedId === sec.id ? (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            <span>Copied Block HTML</span>
                          </>
                        ) : copyErrorId === sec.id ? (
                          <span>Copy Failed</span>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copy HTML</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          downloadFile(
                            `${guide.slug || 'guide'}-${sec.anchorId || sec.id}.html`,
                            secHtml
                          )
                        }
                        className="sog-btn-secondary"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download .html</span>
                      </button>
                    </div>
                  </div>

                  <pre className="p-4 bg-[#111926] text-[#E6EEF8] font-mono-tabular text-xs overflow-x-auto max-h-56 leading-relaxed">
                    {secHtml}
                  </pre>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: UNIFIED @GRAPH JSON-LD SCHEMA GENERATOR */}
      {activeTab === 'json_ld' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Configuration Column */}
          <div className="lg:col-span-6 space-y-6">
            {/* BreadcrumbList Config */}
            <div className="bg-white border border-[#DED8CA] rounded-xl p-5 space-y-4 text-xs shadow-2xs">
              <div className="flex items-center justify-between border-b border-[#EAE4D8] pb-3">
                <div>
                  <h2 className="text-base font-editorial font-semibold text-[#111A27]">
                    1. BreadcrumbList Configuration
                  </h2>
                  <p className="text-[#5E6B7C] mt-0.5">
                    Positions are numbered automatically starting at 1.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onSaveGuideNow}
                  className="sog-btn-mint"
                >
                  Save Schema Settings
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="sog-label">Site Base URL</label>
                  <input
                    type="text"
                    value={schemaCfg.siteBaseUrl}
                    onChange={(e) =>
                      onUpdateGuide({
                        ...guide,
                        storeBaseUrl: e.target.value,
                        schemaConfig: { ...schemaCfg, siteBaseUrl: e.target.value },
                      })
                    }
                    className="sog-input font-mono-tabular"
                  />
                </div>
                <div>
                  <label className="sog-label">Canonical Guide URL</label>
                  <input
                    type="text"
                    value={guide.canonicalUrl}
                    onChange={(e) => onUpdateGuide({ ...guide, canonicalUrl: e.target.value })}
                    className="sog-input font-mono-tabular"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="sog-label mb-0">Breadcrumb Hierarchy</span>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateGuide({
                        ...guide,
                        schemaConfig: {
                          ...schemaCfg,
                          breadcrumbs: [
                            ...(schemaCfg.breadcrumbs || []),
                            {
                              id: `bc-${Date.now()}`,
                              name: 'New Level',
                              url: guide.canonicalUrl,
                            },
                          ],
                        },
                      })
                    }
                    className="inline-flex items-center gap-1 text-[#1A567B] hover:underline font-semibold"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Level</span>
                  </button>
                </div>

                {(schemaCfg.breadcrumbs || []).map((bc, idx) => (
                  <div key={bc.id} className="flex items-center gap-2">
                    <span className="font-mono-tabular font-semibold text-[#5E6B7C] w-6">
                      #{idx + 1}
                    </span>
                    <input
                      type="text"
                      value={bc.name}
                      onChange={(e) => {
                        const next = [...(schemaCfg.breadcrumbs || [])];
                        next[idx] = { ...bc, name: e.target.value };
                        onUpdateGuide({
                          ...guide,
                          schemaConfig: { ...schemaCfg, breadcrumbs: next },
                        });
                      }}
                      placeholder="Label"
                      className="w-40 px-2.5 py-1.5 border border-[#C8C0B0] rounded-md bg-white"
                    />
                    <input
                      type="text"
                      value={bc.url}
                      onChange={(e) => {
                        const next = [...(schemaCfg.breadcrumbs || [])];
                        next[idx] = { ...bc, url: e.target.value };
                        onUpdateGuide({
                          ...guide,
                          schemaConfig: { ...schemaCfg, breadcrumbs: next },
                        });
                      }}
                      placeholder="https://..."
                      className="flex-1 px-2.5 py-1.5 font-mono-tabular border border-[#C8C0B0] rounded-md bg-white"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const next = (schemaCfg.breadcrumbs || []).filter((_, i) => i !== idx);
                        onUpdateGuide({
                          ...guide,
                          schemaConfig: { ...schemaCfg, breadcrumbs: next },
                        });
                      }}
                      className="p-1 text-[#5E6B7C] hover:text-red-600"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* ItemList Configuration */}
            <div className="bg-white border border-[#DED8CA] rounded-xl p-5 space-y-4 text-xs shadow-2xs">
              <div className="border-b border-[#EAE4D8] pb-3">
                <h2 className="text-base font-editorial font-semibold text-[#111A27]">
                  2. ItemList Featured Products ({schemaCfg.includedProductIds?.length || 0}{' '}
                  Selected)
                </h2>
                <p className="text-[#5E6B7C] mt-0.5">
                  Explicitly choose and order the featured products to include in the schema{' '}
                  <code className="font-mono-tabular">ItemList</code>.
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="sog-label">ItemList Name</label>
                  <input
                    type="text"
                    value={schemaCfg.itemListName}
                    onChange={(e) =>
                      onUpdateGuide({
                        ...guide,
                        schemaConfig: { ...schemaCfg, itemListName: e.target.value },
                      })
                    }
                    className="sog-input"
                  />
                </div>
                <div>
                  <label className="sog-label">ItemList Description</label>
                  <textarea
                    rows={2}
                    value={schemaCfg.itemListDescription}
                    onChange={(e) =>
                      onUpdateGuide({
                        ...guide,
                        schemaConfig: { ...schemaCfg, itemListDescription: e.target.value },
                      })
                    }
                    className="sog-input"
                  />
                </div>
              </div>

              {/* Selected Order List */}
              {(schemaCfg.includedProductIds || []).length > 0 && (
                <div className="space-y-1.5">
                  <span className="sog-label">
                    Included Products Order (Positions 1–{schemaCfg.includedProductIds.length})
                  </span>
                  <div className="border border-[#DED8CA] rounded-lg divide-y divide-[#EAE4D8] max-h-52 overflow-y-auto">
                    {schemaCfg.includedProductIds.map((pid, idx) => {
                      const prod = products.find((p) => p.id === pid);
                      return (
                        <div
                          key={pid}
                          className="px-3 py-2 flex items-center justify-between gap-2 bg-[#FBF9F5]"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-mono-tabular font-semibold text-[#1A567B] w-6">
                              #{idx + 1}
                            </span>
                            <span className="font-medium text-[#111A27] truncate">
                              {prod?.name || pid}
                            </span>
                            <span className="font-mono-tabular text-[#5E6B7C]">
                              {prod?.price}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => moveSchemaProduct(idx, -1)}
                              disabled={idx === 0}
                              className="p-1 text-[#5E6B7C] hover:text-[#111A27] disabled:opacity-30"
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => moveSchemaProduct(idx, 1)}
                              disabled={idx === schemaCfg.includedProductIds.length - 1}
                              className="p-1 text-[#5E6B7C] hover:text-[#111A27] disabled:opacity-30"
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleProductInSchema(pid)}
                              className="p-1 text-[#5E6B7C] hover:text-red-600"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Toggle Products from Library */}
              <div className="space-y-1.5 pt-2">
                <span className="sog-label">Select / Deselect from Product Library</span>
                <div className="max-h-48 overflow-y-auto border border-[#DED8CA] rounded-lg divide-y divide-[#EAE4D8]">
                  {products
                    .filter((p) => !p.archived)
                    .map((prod) => {
                      const checked = (schemaCfg.includedProductIds || []).includes(prod.id);
                      return (
                        <label
                          key={prod.id}
                          className={`px-3 py-2 flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                            checked ? 'bg-[#DFEEF5]/50' : 'hover:bg-[#F5F1E7]'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleProductInSchema(prod.id)}
                              className="rounded border-[#C8C0B0]"
                            />
                            <span className="text-[#111A27] font-medium truncate">{prod.name}</span>
                          </div>
                          <span className="font-mono-tabular text-[#5E6B7C] shrink-0">
                            {prod.price}
                          </span>
                        </label>
                      );
                    })}
                </div>
              </div>
            </div>

            {/* Synchronized FAQPage Summary */}
            <div className="bg-[#DFEEF5]/60 border border-[#A8CBE0] rounded-xl p-5 space-y-2 text-xs">
              <h2 className="text-base font-editorial font-semibold text-[#123E59]">
                3. Synchronized FAQPage ({canonicalFaqs.length} Q&amp;As)
              </h2>
              <p className="text-[#1D3E53]">
                The <code className="font-mono-tabular">FAQPage</code> graph node is automatically
                generated from your guide’s visible FAQ section so that schema questions and answers
                never drift from visible storefront copy.
              </p>
            </div>
          </div>

          {/* Right Output & Validation Column */}
          <div className="lg:col-span-6 space-y-4">
            <div className="bg-white border border-[#DED8CA] rounded-xl p-5 space-y-4 shadow-2xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-editorial font-semibold text-[#111A27]">
                    Standalone Footer Schema Output
                  </h2>
                  <p className="text-xs text-[#5E6B7C]">
                    Paste this{' '}
                    <code className="font-mono-tabular">
                      &lt;script type=&quot;application/ld+json&quot;&gt;
                    </code>{' '}
                    block into your Fourthwall page footer.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => copyToClipboard('schema-script', schemaResult.scriptBlock)}
                    className={copiedId === 'schema-script' ? 'sog-btn-mint' : 'sog-btn-primary'}
                  >
                    {copiedId === 'schema-script' ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Copied Schema Script</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy &lt;script&gt; Block</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      downloadFile(
                        `${guide.slug || 'guide'}-schema.jsonld.html`,
                        schemaResult.scriptBlock
                      )
                    }
                    className="sog-btn-secondary"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download</span>
                  </button>
                </div>
              </div>

              {/* Validation Status */}
              {schemaResult.validationIssues.length === 0 ? (
                <div className="p-3 bg-[#E1F2EA] border border-[#96CDB0] rounded-lg flex items-center gap-2 text-xs text-[#134634] font-semibold">
                  <CheckCircle2 className="w-4 h-4 text-[#1D634B] shrink-0" />
                  <span>
                    Valid JSON-LD syntax · BreadcrumbList ({schemaCfg.breadcrumbs?.length || 0}) ·
                    ItemList ({schemaCfg.includedProductIds?.length || 0} products) · FAQPage (
                    {canonicalFaqs.length} Q&amp;As)
                  </span>
                </div>
              ) : (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-1 text-xs">
                  <p className="font-semibold text-amber-900">Schema Validation Report:</p>
                  {schemaResult.validationIssues.map((iss, idx) => (
                    <div
                      key={idx}
                      className={
                        iss.severity === 'error' ? 'text-red-800 font-medium' : 'text-amber-800'
                      }
                    >
                      • [{iss.severity.toUpperCase()}] {iss.message}
                    </div>
                  ))}
                </div>
              )}

              <pre className="p-4 bg-[#111926] text-[#E6EEF8] rounded-xl font-mono-tabular text-xs overflow-x-auto max-h-[540px] leading-relaxed">
                {schemaResult.scriptBlock}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: PROJECT BACKUP & RESTORE (.JSON) */}
      {activeTab === 'backup' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white border border-[#DED8CA] rounded-xl p-6 space-y-4 shadow-2xs">
            <h2 className="text-lg font-editorial font-semibold text-[#111A27]">
              Export Project Backup (.JSON)
            </h2>
            <p className="text-xs text-[#3E4C5E] leading-relaxed">
              Unlike an HTML export (which contains only final Fourthwall storefront markup), a
              Project Backup preserves your full structured CMS state—including section order,
              product assignments, editorial copy, category hub cards, FAQ data, schema config, and
              Product Library records.
            </p>
            <div className="pt-2">
              <button
                type="button"
                onClick={handleDownloadBackup}
                className="sog-btn-primary"
              >
                <Download className="w-4 h-4" />
                <span>Download Complete Project Backup (.json)</span>
              </button>
            </div>
          </div>

          <div className="bg-white border border-[#DED8CA] rounded-xl p-6 space-y-4 text-xs shadow-2xs">
            <h2 className="text-lg font-editorial font-semibold text-[#111A27]">
              Restore Project from Backup (.JSON)
            </h2>
            <p className="text-[#3E4C5E] leading-relaxed">
              Upload or paste a previously exported{' '}
              <code className="font-mono-tabular">science-of-gifts-cms-v1</code> JSON backup file.
            </p>

            <div>
              <label className="sog-btn-secondary cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                <span>Select Backup .JSON File</span>
                <input
                  type="file"
                  accept=".json"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      const text = String(reader.result || '');
                      setRawBackupJson(text);
                      setBackupValidation(validateProjectBackupJson(text));
                    };
                    reader.readAsText(file);
                  }}
                  className="hidden"
                />
              </label>
            </div>

            <textarea
              rows={5}
              value={rawBackupJson}
              onChange={(e) => {
                setRawBackupJson(e.target.value);
                setBackupValidation(
                  e.target.value.trim() ? validateProjectBackupJson(e.target.value) : null
                );
              }}
              placeholder="Or paste backup JSON here..."
              className="sog-input font-mono-tabular"
            />

            {backupValidation && !backupValidation.valid && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{backupValidation.error}</span>
              </div>
            )}

            {backupValidation?.valid && backupValidation.backup && (
              <div className="p-3 bg-[#E1F2EA] border border-[#96CDB0] rounded-lg space-y-2 text-[#134634]">
                <div className="flex items-center gap-2 font-semibold">
                  <CheckCircle2 className="w-4 h-4 text-[#1D634B]" />
                  <span>Verified Backup: {backupValidation.backup.guide.title}</span>
                </div>
                <p>
                  Contains {backupValidation.backup.sections.length} sections and{' '}
                  {backupValidation.backup.products.length} product records.
                </p>
                <label className="flex items-center gap-2 pt-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeBackupProducts}
                    onChange={(e) => setIncludeBackupProducts(e.target.checked)}
                  />
                  <span>Also restore/merge included Product Library records</span>
                </label>

                {!confirmRestoreModal ? (
                  <button
                    type="button"
                    onClick={() => setConfirmRestoreModal(true)}
                    className="mt-2 sog-btn-primary"
                  >
                    Restore Guide Project...
                  </button>
                ) : (
                  <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg space-y-2 text-amber-950">
                    <p className="font-semibold">
                      Warning: If a guide with ID &ldquo;{backupValidation.backup.guide.id}&rdquo;
                      already exists, its sections will be replaced by this backup. Proceed?
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={restoring}
                        onClick={async () => {
                          if (!backupValidation.backup) return;
                          setRestoring(true);
                          try {
                            await onRestoreBackup(backupValidation.backup, includeBackupProducts);
                            setConfirmRestoreModal(false);
                            setRawBackupJson('');
                            setBackupValidation(null);
                          } finally {
                            setRestoring(false);
                          }
                        }}
                        className="px-3 py-1.5 bg-amber-900 text-white rounded font-semibold"
                      >
                        {restoring ? 'Restoring...' : 'Confirm & Restore'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmRestoreModal(false)}
                        className="px-3 py-1.5 bg-white border border-amber-300 rounded"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
