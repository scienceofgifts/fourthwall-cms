import React, { useMemo, useState } from 'react';
import {
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Copy,
  Eye,
  EyeOff,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Save,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Settings2,
  Search,
  Sparkles,
} from 'lucide-react';
import {
  BookmarkEntry,
  BuyingGuidePillar,
  CategoryHubCardConfig,
  EditorialCardItemConfig,
  FAQItem,
  GiftGuide,
  GuideSection,
  MoreGiftsCardConfig,
  MoreGiftsGridBlock,
  Product,
  QuickPickCardConfig,
  SectionType,
} from '../types/cms';
import { AIFieldAssist } from './AIFieldAssist';
import { LivePreviewPanel } from './LivePreviewPanel';

interface GuideEditorViewProps {
  guide: GiftGuide;
  sections: GuideSection[];
  products: Product[];
  saveState: 'saved' | 'dirty' | 'saving' | 'error';
  saveError: string | null;
  onUpdateGuide: (updated: GiftGuide) => void;
  onUpdateSections: (updated: GuideSection[], deletedSectionId?: string) => void;
  onSaveNow: () => Promise<void>;
  onOpenExportStudio: () => void;
}

const SECTION_TYPE_LABELS: Record<SectionType, string> = {
  bookmarks: 'A. Quick Bookmarks (TOC)',
  quick_picks: 'B. Quick Picks Grid',
  editors_pick: "C. Editor's Pick Spotlight",
  editorial_list: 'D. Editorial Long-Form Chapter',
  more_gifts_grid: 'E. More Gifts 3-Column Grid',
  category_hub: 'F. Visual Category / Deity Hub',
  buying_guide: 'G. Buying Guide & FAQs',
  faq_grid: 'H. Standalone Open FAQ Grid',
};

const SECTION_TYPE_SHORT_LABELS: Record<SectionType, string> = {
  bookmarks: 'TOC Bookmarks',
  quick_picks: 'Quick Picks Grid',
  editors_pick: "Editor's Pick",
  editorial_list: 'Editorial Chapter',
  more_gifts_grid: '3-Col More Grid',
  category_hub: 'Category Hub',
  buying_guide: 'Buying Guide & FAQ',
  faq_grid: 'Open FAQ Grid',
};

export const GuideEditorView: React.FC<GuideEditorViewProps> = ({
  guide,
  sections,
  products,
  saveState,
  saveError,
  onUpdateGuide,
  onUpdateSections,
  onSaveNow,
  onOpenExportStudio,
}) => {
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(
    sections[0]?.id || null
  );
  const [showLeftNav, setShowLeftNav] = useState(true);
  const [showRightPreview, setShowRightPreview] = useState(true);
  const [showGuideSettings, setShowGuideSettings] = useState(false);
  const [showAddSectionModal, setShowAddSectionModal] = useState(false);
  const [newSectionType, setNewSectionType] = useState<SectionType>('editorial_list');
  const [newSectionTitle, setNewSectionTitle] = useState('');
  const [newSectionAnchor, setNewSectionAnchor] = useState('');
  const [confirmDeleteSectionId, setConfirmDeleteSectionId] = useState<string | null>(null);
  const [productPickerFilter, setProductPickerFilter] = useState('');

  const sortedSections = useMemo(
    () => [...sections].sort((a, b) => a.order - b.order),
    [sections]
  );

  const activeSection = useMemo(
    () =>
      sortedSections.find((s) => s.id === selectedSectionId) || sortedSections[0] || null,
    [sortedSections, selectedSectionId]
  );

  const activeProducts = useMemo(
    () => products.filter((p) => !p.archived),
    [products]
  );

  // Map productId -> list of section titles where it is already assigned (to prevent accidental duplication)
  const productUsageMap = useMemo(() => {
    const map = new Map<string, string[]>();
    const addUsage = (pid: string | undefined, secTitle: string) => {
      if (!pid) return;
      const list = map.get(pid) || [];
      if (!list.includes(secTitle)) {
        list.push(secTitle);
        map.set(pid, list);
      }
    };
    for (const sec of sortedSections) {
      const cfg = sec.config || {};
      (cfg.quickPickCards || []).forEach((c) => addUsage(c.productId, sec.title));
      if (cfg.editorsPick?.productId) addUsage(cfg.editorsPick.productId, sec.title);
      (cfg.editorialItems || []).forEach((i) => addUsage(i.productId, sec.title));
      (cfg.attachedMoreGrids || []).forEach((g) =>
        (g.items || []).forEach((i) => addUsage(i.productId, `${sec.title} (More Grid)`))
      );
      (cfg.moreGridItems || []).forEach((i) => addUsage(i.productId, sec.title));
    }
    return map;
  }, [sortedSections]);

  const updateActiveSection = (updater: (sec: GuideSection) => GuideSection) => {
    if (!activeSection) return;
    const next = sortedSections.map((s) => (s.id === activeSection.id ? updater(s) : s));
    onUpdateSections(next);
  };

  const handleMoveSection = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= sortedSections.length) return;
    const next = [...sortedSections];
    const temp = next[index];
    next[index] = next[target];
    next[target] = temp;
    const reordered = next.map((s, idx) => ({ ...s, order: idx }));
    onUpdateSections(reordered);
  };

  const handleDuplicateSection = (sec: GuideSection) => {
    const newId = `sec-${sec.type}-${Date.now().toString(36)}`;
    const copy: GuideSection = {
      ...JSON.parse(JSON.stringify(sec)),
      id: newId,
      title: `${sec.title} (Copy)`,
      anchorId: `${sec.anchorId}-copy`,
      order: sortedSections.length,
    };
    const next = [...sortedSections, copy].map((s, idx) => ({ ...s, order: idx }));
    onUpdateSections(next);
    setSelectedSectionId(newId);
  };

  const handleCreateSection = (e: React.FormEvent) => {
    e.preventDefault();
    const title = newSectionTitle.trim() || SECTION_TYPE_LABELS[newSectionType];
    const cleanAnchor =
      newSectionAnchor
        .trim()
        .replace(/^#/, '')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-') ||
      `jump-${title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 28)}`;

    const newId = `sec-${newSectionType}-${Date.now().toString(36)}`;
    const newSec: GuideSection = {
      id: newId,
      ownerId: guide.ownerId,
      guideId: guide.id,
      type: newSectionType,
      title,
      anchorId: cleanAnchor,
      order: sortedSections.length,
      enabled: true,
      config:
        newSectionType === 'bookmarks'
          ? { tocTitle: `📖 In This Gift Guide — Quick Bookmarks`, bookmarks: [] }
          : newSectionType === 'quick_picks'
          ? { quickPicksHeading: `⚡ ${title}`, quickPickCards: [] }
          : newSectionType === 'editors_pick'
          ? {
              editorsPick: {
                productId: activeProducts[0]?.id || '',
                kicker: '🏆 Our #1 Pick',
                heading: activeProducts[0]?.name || title,
                description: activeProducts[0]?.shortDescription || '',
                priceDisplay: activeProducts[0]?.price || '$39.90',
                ctaLabel: 'Shop Our #1 Pick →',
                productUrlOverride: '',
                imageUrlOverride: '',
              },
            }
          : newSectionType === 'editorial_list'
          ? {
              chapterKicker: `CHAPTER • ${guide.topic.toUpperCase()}`,
              chapterTitle: title,
              sectionIntro: '',
              editorialItems: [],
              attachedMoreGrids: [],
            }
          : newSectionType === 'more_gifts_grid'
          ? { moreGridHeading: title, moreGridSubtitle: '', moreGridItems: [] }
          : newSectionType === 'category_hub'
          ? { hubHeading: title, hubIntroHtml: '', categoryCards: [] }
          : newSectionType === 'buying_guide'
          ? {
              buyingGuide: {
                kicker: '🧭 Buying Guide',
                title,
                introHtml: '',
                pillars: [],
              },
              includeFaqsInSection: false,
              faqItems: [],
            }
          : { faqHeaderTitle: title, faqHeaderSubtitle: '', faqItems: [] },
    };

    const next = [...sortedSections, newSec].map((s, idx) => ({ ...s, order: idx }));
    onUpdateSections(next);
    setSelectedSectionId(newId);
    setShowAddSectionModal(false);
    setNewSectionTitle('');
    setNewSectionAnchor('');
  };

  const syncBookmarksFromSections = () => {
    if (!activeSection || activeSection.type !== 'bookmarks') return;
    const otherEnabled = sortedSections.filter(
      (s) => s.enabled && s.id !== activeSection.id
    );
    const synced: BookmarkEntry[] = otherEnabled.map((sec, idx) => ({
      id: `bm-sync-${sec.id}`,
      prefixIcon:
        sec.type === 'quick_picks'
          ? '⚡'
          : sec.type === 'editors_pick'
          ? '🏆'
          : sec.type === 'category_hub'
          ? '🏛️'
          : sec.type === 'buying_guide' || sec.type === 'faq_grid'
          ? '🧭'
          : '📓',
      label: sec.title,
      anchorTarget: `#${sec.anchorId}`,
      order: idx,
      enabled: true,
    }));
    updateActiveSection((sec) => ({
      ...sec,
      config: { ...sec.config, bookmarks: synced },
    }));
  };

  return (
    <div className="flex flex-col h-[calc(100vh-52px)] overflow-hidden">
      {/* Guide Contextual Toolbar — Clearly Differentiated from Top Nav & Editor Canvas */}
      <div className="px-4 py-2.5 bg-[#F5F1E7] border-b border-[#D5CFC0] flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => setShowLeftNav(!showLeftNav)}
            title={showLeftNav ? 'Collapse Section Navigator' : 'Expand Section Navigator'}
            className="p-1.5 text-[#3E4C5E] hover:text-[#111A27] bg-white border border-[#CFC8B8] hover:bg-[#DFEEF5]/50 rounded-md transition-colors shrink-0"
          >
            {showLeftNav ? (
              <PanelLeftClose className="w-4 h-4" />
            ) : (
              <PanelLeftOpen className="w-4 h-4" />
            )}
          </button>

          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] text-[#5E6B7C]">
              <span className="uppercase tracking-wider font-bold text-[#1A567B]">
                {guide.topic}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-tabular truncate">{guide.canonicalUrl}</span>
              {activeSection && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-[#111A27] font-medium truncate hidden sm:inline">
                    Editing: {activeSection.title}
                  </span>
                </>
              )}
            </div>
            <h1 className="text-base md:text-lg font-editorial font-semibold text-[#111A27] truncate">
              {guide.title}
            </h1>
          </div>

          <button
            type="button"
            onClick={() => setShowGuideSettings(!showGuideSettings)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md border transition-colors whitespace-nowrap shrink-0 ${
              showGuideSettings
                ? 'bg-[#DFEEF5] text-[#123E59] border-[#94C0D6]'
                : 'bg-white text-[#1D2838] border-[#CFC8B8] hover:bg-[#EAE4D8]'
            }`}
          >
            <Settings2 className="w-3.5 h-3.5" />
            <span>Guide Settings</span>
          </button>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {/* Save Status Indicator */}
          <div className="text-xs flex items-center gap-1.5">
            {saveState === 'saving' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#DFEEF5] text-[#123E59] font-medium">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Saving to Firestore...</span>
              </span>
            )}
            {saveState === 'saved' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#E1F2EA] text-[#134634] border border-[#96CDB0] font-medium">
                <CheckCircle2 className="w-3.5 h-3.5 text-[#1D634B]" />
                <span>All changes saved</span>
              </span>
            )}
            {saveState === 'dirty' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-50 border border-amber-300 text-amber-800 font-semibold">
                <span>Unsaved edits</span>
              </span>
            )}
            {saveState === 'error' && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-red-50 border border-red-200 text-red-700 font-semibold">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Save failed: {saveError || 'Network error'}</span>
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={onSaveNow}
            disabled={saveState === 'saving'}
            className="sog-btn-mint"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save Guide</span>
          </button>

          <button
            type="button"
            onClick={onOpenExportStudio}
            className="sog-btn-powder"
          >
            <span>Export &amp; Schema Studio →</span>
          </button>

          <button
            type="button"
            onClick={() => setShowRightPreview(!showRightPreview)}
            title={showRightPreview ? 'Hide Live Preview' : 'Show Live Preview'}
            className="p-1.5 text-[#3E4C5E] hover:text-[#111A27] bg-white border border-[#CFC8B8] hover:bg-[#DFEEF5]/50 rounded-md transition-colors shrink-0"
          >
            {showRightPreview ? (
              <PanelRightClose className="w-4 h-4" />
            ) : (
              <PanelRightOpen className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Collapsible Guide Metadata Drawer */}
      {showGuideSettings && (
        <div className="px-6 py-4 bg-[#EDE8DC] border-b border-[#CFC8B8] space-y-3 text-xs shrink-0">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="sog-label">Guide Title</label>
              <input
                type="text"
                value={guide.title}
                onChange={(e) => onUpdateGuide({ ...guide, title: e.target.value })}
                className="sog-input"
              />
            </div>
            <div>
              <label className="sog-label">Topic / Theme</label>
              <input
                type="text"
                value={guide.topic}
                onChange={(e) => onUpdateGuide({ ...guide, topic: e.target.value })}
                className="sog-input"
              />
            </div>
            <div>
              <label className="sog-label">Target Audience &amp; Editorial Tone</label>
              <input
                type="text"
                value={guide.audience}
                onChange={(e) => onUpdateGuide({ ...guide, audience: e.target.value })}
                className="sog-input"
              />
            </div>
            <div>
              <label className="sog-label">Canonical Page URL</label>
              <input
                type="text"
                value={guide.canonicalUrl}
                onChange={(e) => onUpdateGuide({ ...guide, canonicalUrl: e.target.value })}
                className="sog-input font-mono-tabular"
              />
            </div>
            <div>
              <label className="sog-label">Storefront Base URL</label>
              <input
                type="text"
                value={guide.storeBaseUrl}
                onChange={(e) => onUpdateGuide({ ...guide, storeBaseUrl: e.target.value })}
                className="sog-input font-mono-tabular"
              />
            </div>
            <div>
              <label className="sog-label">Primary Collection Path</label>
              <input
                type="text"
                value={guide.collectionUrl}
                onChange={(e) => onUpdateGuide({ ...guide, collectionUrl: e.target.value })}
                className="sog-input font-mono-tabular"
              />
            </div>
          </div>
          <div>
            <label className="sog-label">Guide-Level Introduction / Summary</label>
            <textarea
              rows={2}
              value={guide.introText}
              onChange={(e) => onUpdateGuide({ ...guide, introText: e.target.value })}
              className="sog-input"
            />
            <AIFieldAssist
              fieldKey={`guide-intro-${guide.id}`}
              taskType="guide_intro"
              label="Draft Guide Intro"
              currentValue={guide.introText}
              onApply={(val) => onUpdateGuide({ ...guide, introText: val })}
              guideContext={{ title: guide.title, topic: guide.topic, audience: guide.audience }}
            />
          </div>
        </div>
      )}

      {/* Three-Pane Workspace */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT PANE: DEDICATED SECTION NAVIGATOR */}
        {showLeftNav && (
          <aside className="w-80 shrink-0 bg-[#F2EDE2] border-r border-[#D5CFC0] flex flex-col h-full select-none">
            {/* Navigator Header + Prominent Add Section Action */}
            <div className="p-3.5 bg-[#EAE4D6] border-b border-[#D5CFC0] flex items-center justify-between gap-2">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#1D2838] block">
                  Section Navigator
                </span>
                <span className="text-[11px] text-[#5E6B7C] font-mono-tabular">
                  {sortedSections.filter((s) => s.enabled).length} of {sortedSections.length} active
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowAddSectionModal(true)}
                className="sog-btn-primary"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Section</span>
              </button>
            </div>

            {/* Section List — Active Section Receives Strongest Emphasis */}
            <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
              {sortedSections.map((sec, idx) => {
                const isSelected = activeSection?.id === sec.id;
                return (
                  <div
                    key={sec.id}
                    onClick={() => setSelectedSectionId(sec.id)}
                    className={`relative overflow-hidden rounded-lg border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[#DFEEF5] border-[#82B3CC] shadow-xs pl-3.5 pr-3 py-3'
                        : 'bg-[#F8F5EE]/75 border-[#DDD6C7] hover:bg-white/95 hover:border-[#C5BEB0] px-3 py-2.5'
                    } ${!sec.enabled ? 'opacity-55' : ''}`}
                  >
                    {/* Visible Left Indicator Bar for Active Section */}
                    {isSelected && (
                      <div
                        className="absolute left-0 top-0 bottom-0 w-1.5 bg-[#1A567B]"
                        aria-hidden="true"
                      />
                    )}

                    {/* Top Row: Section Number + Section Type + Compact Action Controls */}
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className={`font-mono-tabular text-[11px] font-bold px-1.5 py-0.5 rounded ${
                            isSelected
                              ? 'bg-[#123E59] text-white'
                              : 'bg-[#E5DFD2] text-[#3E4C5E]'
                          }`}
                        >
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                        <span
                          className={`text-[10px] font-bold uppercase tracking-wider truncate ${
                            isSelected ? 'text-[#123E59]' : 'text-[#5E6B7C]'
                          }`}
                        >
                          {SECTION_TYPE_SHORT_LABELS[sec.type]}
                        </span>
                      </div>

                      {/* Accessible Reorder, Preview/Enable, Duplicate, and Delete Controls */}
                      <div
                        className="flex items-center gap-0.5 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => handleMoveSection(idx, -1)}
                          disabled={idx === 0}
                          title="Move section up"
                          className="p-1 rounded text-[#4F5D70] hover:text-[#111A27] hover:bg-white/70 disabled:opacity-25 transition-colors"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMoveSection(idx, 1)}
                          disabled={idx === sortedSections.length - 1}
                          title="Move section down"
                          className="p-1 rounded text-[#4F5D70] hover:text-[#111A27] hover:bg-white/70 disabled:opacity-25 transition-colors"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const next = sortedSections.map((s) =>
                              s.id === sec.id ? { ...s, enabled: !s.enabled } : s
                            );
                            onUpdateSections(next);
                          }}
                          title={
                            sec.enabled
                              ? 'Included in full-guide preview & export (click to disable)'
                              : 'Disabled in full-guide preview & export (click to enable)'
                          }
                          className={`p-1 rounded transition-colors ${
                            sec.enabled
                              ? 'text-[#1A567B] hover:bg-white/70'
                              : 'text-[#8B95A5] hover:text-[#111A27] hover:bg-white/70'
                          }`}
                        >
                          {sec.enabled ? (
                            <Eye className="w-3.5 h-3.5" />
                          ) : (
                            <EyeOff className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDuplicateSection(sec)}
                          title="Duplicate section"
                          className="p-1 rounded text-[#4F5D70] hover:text-[#111A27] hover:bg-white/70 transition-colors"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteSectionId(sec.id)}
                          title="Delete section"
                          className="p-1 rounded text-[#4F5D70] hover:text-red-600 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Section Name — Easier to Read (Up to 2 Lines) */}
                    <p
                      className={`mt-1.5 text-[13px] leading-snug line-clamp-2 ${
                        isSelected
                          ? 'font-editorial font-bold text-[#111A27]'
                          : 'font-medium text-[#1D2838]'
                      }`}
                    >
                      {sec.title}
                    </p>

                    {/* Anchor ID */}
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <code
                        className={`text-[11px] font-mono-tabular ${
                          isSelected ? 'text-[#123E59] font-semibold' : 'text-[#5E6B7C]'
                        }`}
                      >
                        #{sec.anchorId}
                      </code>
                      {!sec.enabled && (
                        <span className="text-[10px] font-semibold text-amber-800">
                          Hidden
                        </span>
                      )}
                    </div>

                    {confirmDeleteSectionId === sec.id && (
                      <div
                        className="mt-2.5 pt-2 border-t border-red-200 flex items-center justify-between text-[11px]"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="text-red-800 font-semibold">Delete this section?</span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              const remaining = sortedSections
                                .filter((s) => s.id !== sec.id)
                                .map((s, i) => ({ ...s, order: i }));
                              onUpdateSections(remaining, sec.id);
                              setConfirmDeleteSectionId(null);
                              if (selectedSectionId === sec.id) {
                                setSelectedSectionId(remaining[0]?.id || null);
                              }
                            }}
                            className="px-2 py-0.5 bg-red-600 text-white rounded font-semibold"
                          >
                            Delete
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteSectionId(null)}
                            className="px-2 py-0.5 bg-white border border-[#CFC8B8] rounded text-[#3E4C5E] font-medium"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </aside>
        )}

        {/* CENTER PANE: STRUCTURED EDITORIAL CONTENT STUDIO */}
        <main className="flex-1 overflow-y-auto bg-[#FBF9F5] px-6 py-6 md:px-8">
          {!activeSection ? (
            <div className="bg-white border border-[#DED8CA] rounded-xl p-12 text-center space-y-3">
              <h2 className="text-lg font-editorial font-semibold text-[#111A27]">
                No section selected
              </h2>
              <button
                type="button"
                onClick={() => setShowAddSectionModal(true)}
                className="sog-btn-primary"
              >
                Add First Section
              </button>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-7 pb-16">
              {/* LEVEL 1: SECTION IDENTITY & SETTINGS (Open Editorial Masthead — Not a Generic White Card) */}
              <section className="pb-6 border-b-2 border-[#DED8CA] space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded bg-[#DFEEF5] border border-[#94C0D6] text-[11px] uppercase tracking-wider font-bold text-[#123E59]">
                      {SECTION_TYPE_LABELS[activeSection.type]}
                    </span>
                    <code className="text-xs font-mono-tabular text-[#5E6B7C]">
                      #{activeSection.anchorId}
                    </code>
                  </div>

                  <label
                    className={`inline-flex items-center gap-2 px-3 py-1 rounded-md text-xs font-semibold border cursor-pointer transition-colors ${
                      activeSection.enabled
                        ? 'bg-[#E1F2EA] text-[#134634] border-[#96CDB0]'
                        : 'bg-[#F2EDE2] text-[#5E6B7C] border-[#D5CFC0]'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={activeSection.enabled}
                      onChange={(e) =>
                        updateActiveSection((s) => ({ ...s, enabled: e.target.checked }))
                      }
                      className="rounded border-[#96CDB0]"
                    />
                    <span>
                      {activeSection.enabled
                        ? 'Enabled in Full-Guide Export'
                        : 'Disabled in Full-Guide Export'}
                    </span>
                  </label>
                </div>

                <div>
                  <h2 className="text-2xl font-editorial font-semibold text-[#111A27] leading-tight">
                    {activeSection.title}
                  </h2>
                  <p className="text-xs text-[#5E6B7C] mt-0.5">
                    Level 1 · Section Identity &amp; Fourthwall Anchor Configuration
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                  <div>
                    <label className="sog-label">Section Internal Name / Heading</label>
                    <input
                      type="text"
                      value={activeSection.title}
                      onChange={(e) =>
                        updateActiveSection((s) => ({ ...s, title: e.target.value }))
                      }
                      className="sog-input"
                    />
                  </div>
                  <div>
                    <label className="sog-label">
                      Fourthwall Anchor ID (<code className="font-mono-tabular">id=&quot;...&quot;</code>)
                    </label>
                    <input
                      type="text"
                      value={activeSection.anchorId}
                      onChange={(e) =>
                        updateActiveSection((s) => ({
                          ...s,
                          anchorId: e.target.value.replace(/^#/, ''),
                        }))
                      }
                      placeholder="jump-quick-picks"
                      className="sog-input font-mono-tabular"
                    />
                  </div>
                </div>
              </section>

              {/* TYPE A: BOOKMARKS (TOC) */}
              {activeSection.type === 'bookmarks' && (
                <div className="space-y-5 text-xs">
                  <div className="bg-[#EFF6FA] border border-[#B5D5E6] border-l-4 border-l-[#1A567B] rounded-xl p-5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#1A567B] block">
                          TOC Header Configuration
                        </span>
                        <h3 className="text-base font-editorial font-semibold text-[#111A27]">
                          Table of Contents — Quick Bookmarks
                        </h3>
                        <p className="text-[#3E4C5E]">
                          Generates <code className="font-mono-tabular">.sog-toc-box</code> and{' '}
                          <code className="font-mono-tabular">.sog-toc-grid</code> jump navigation.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={syncBookmarksFromSections}
                          className="sog-btn-powder"
                        >
                          Sync Links from Guide Sections
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const current = activeSection.config.bookmarks || [];
                            const nextEntry: BookmarkEntry = {
                              id: `bm-${Date.now()}`,
                              prefixIcon: '⚡',
                              label: 'New Section Link',
                              anchorTarget: '#jump-section',
                              order: current.length,
                              enabled: true,
                            };
                            updateActiveSection((s) => ({
                              ...s,
                              config: { ...s.config, bookmarks: [...current, nextEntry] },
                            }));
                          }}
                          className="sog-btn-primary"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Add Bookmark</span>
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="sog-label">TOC Box Title</label>
                      <input
                        type="text"
                        value={activeSection.config.tocTitle || ''}
                        onChange={(e) =>
                          updateActiveSection((s) => ({
                            ...s,
                            config: { ...s.config, tocTitle: e.target.value },
                          }))
                        }
                        className="sog-input"
                      />
                    </div>
                  </div>

                  <div className="bg-white border border-[#DED8CA] rounded-xl overflow-hidden shadow-2xs">
                    <div className="px-4 py-2.5 bg-[#162235] text-white flex items-center justify-between text-xs">
                      <span className="font-semibold">
                        Bookmark Links ({activeSection.config.bookmarks?.length || 0})
                      </span>
                      <span className="text-[#A9B9CE] text-[11px]">
                        Icon · Visible Label · Target Anchor
                      </span>
                    </div>
                    <div className="p-4 space-y-2.5">
                      {(activeSection.config.bookmarks || []).map((bm, idx) => (
                        <div
                          key={bm.id}
                          className="p-2.5 bg-[#FBF9F5] border border-[#E2DACB] rounded-lg flex flex-wrap items-center gap-2"
                        >
                          <input
                            type="checkbox"
                            checked={bm.enabled}
                            onChange={(e) => {
                              const list = [...(activeSection.config.bookmarks || [])];
                              list[idx] = { ...bm, enabled: e.target.checked };
                              updateActiveSection((s) => ({
                                ...s,
                                config: { ...s.config, bookmarks: list },
                              }));
                            }}
                          />
                          <input
                            type="text"
                            value={bm.prefixIcon}
                            onChange={(e) => {
                              const list = [...(activeSection.config.bookmarks || [])];
                              list[idx] = { ...bm, prefixIcon: e.target.value };
                              updateActiveSection((s) => ({
                                ...s,
                                config: { ...s.config, bookmarks: list },
                              }));
                            }}
                            placeholder="Icon"
                            className="w-12 px-2 py-1.5 bg-white border border-[#C8C0B0] rounded-md text-center"
                          />
                          <input
                            type="text"
                            value={bm.label}
                            onChange={(e) => {
                              const list = [...(activeSection.config.bookmarks || [])];
                              list[idx] = { ...bm, label: e.target.value };
                              updateActiveSection((s) => ({
                                ...s,
                                config: { ...s.config, bookmarks: list },
                              }));
                            }}
                            placeholder="Visible link label"
                            className="flex-1 min-w-[160px] px-2.5 py-1.5 bg-white border border-[#C8C0B0] rounded-md font-medium"
                          />
                          <input
                            type="text"
                            value={bm.anchorTarget}
                            onChange={(e) => {
                              const list = [...(activeSection.config.bookmarks || [])];
                              list[idx] = { ...bm, anchorTarget: e.target.value };
                              updateActiveSection((s) => ({
                                ...s,
                                config: { ...s.config, bookmarks: list },
                              }));
                            }}
                            placeholder="#jump-target"
                            className="w-40 px-2.5 py-1.5 font-mono-tabular bg-white border border-[#C8C0B0] rounded-md text-[#123E59]"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const list = (activeSection.config.bookmarks || []).filter(
                                (_, i) => i !== idx
                              );
                              updateActiveSection((s) => ({
                                ...s,
                                config: { ...s.config, bookmarks: list },
                              }));
                            }}
                            className="p-1 text-[#5E6B7C] hover:text-red-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* TYPE B: QUICK PICKS */}
              {activeSection.type === 'quick_picks' && (
                <div className="space-y-6 text-xs">
                  {/* Level 2: Section Heading Band */}
                  <div className="bg-[#EFF6FA] border border-[#B5D5E6] border-l-4 border-l-[#1A567B] rounded-xl p-5 space-y-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#1A567B] block">
                      Level 2 · Quick Picks Banner Heading
                    </span>
                    <label className="sog-label">
                      Quick Picks Section Heading (<code className="font-mono-tabular">.sog-quick-picks</code>)
                    </label>
                    <input
                      type="text"
                      value={activeSection.config.quickPicksHeading || ''}
                      onChange={(e) =>
                        updateActiveSection((s) => ({
                          ...s,
                          config: { ...s.config, quickPicksHeading: e.target.value },
                        }))
                      }
                      className="sog-input"
                    />
                  </div>

                  {/* Level 3: Collection Toolbar */}
                  <div className="space-y-4">
                    <div className="px-5 py-3.5 bg-[#162235] text-white rounded-xl flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <span className="px-2 py-0.5 rounded bg-[#DFEEF5] text-[#111A27] font-mono-tabular font-bold text-xs">
                          {activeSection.config.quickPickCards?.length || 0}
                        </span>
                        <div>
                          <h3 className="text-sm font-editorial font-semibold text-white">
                            Quick Picks Card Collection
                          </h3>
                          <p className="text-[11px] text-[#A9B9CE]">
                            Renders <code className="font-mono-tabular">.sog-qp-grid</code> cards at the top of the guide
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const current = activeSection.config.quickPickCards || [];
                          const firstProd = activeProducts[0];
                          const newCard: QuickPickCardConfig = {
                            id: `qp-${Date.now()}`,
                            productId: firstProd?.id || '',
                            badgeText: `Best for ${firstProd?.category || 'Fans'}`,
                            displayTitle: firstProd?.name || 'Featured Product',
                            metaDescription: firstProd?.shortDescription?.slice(0, 45) || 'Top gift pick',
                            priceDisplay: firstProd?.price || '$24.90',
                            productUrlOverride: '',
                            imageUrlOverride: '',
                            ctaLabel: 'Shop Gift →',
                            order: current.length,
                          };
                          updateActiveSection((s) => ({
                            ...s,
                            config: { ...s.config, quickPickCards: [...current, newCard] },
                          }));
                        }}
                        className="sog-btn-mint"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add Quick Pick Card</span>
                      </button>
                    </div>

                    {/* Level 4: Individual Quick Pick Cards */}
                    <div className="space-y-4">
                      {(activeSection.config.quickPickCards || []).map((card, idx) => {
                        const linkedProd = products.find((p) => p.id === card.productId);
                        return (
                          <div
                            key={card.id}
                            className="bg-white border border-[#D8D0C0] rounded-xl overflow-hidden shadow-2xs"
                          >
                            {/* Distinct Card Header Bar */}
                            <div className="px-5 py-3 bg-[#F3EFE6] border-b border-[#DED8CA] flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span className="px-2 py-0.5 bg-[#111A27] text-[#FBF9F5] font-mono-tabular font-bold rounded text-[11px]">
                                  QP #{idx + 1}
                                </span>
                                <strong className="font-editorial text-sm text-[#111A27] truncate">
                                  {card.displayTitle}
                                </strong>
                                <span className="font-mono-tabular text-xs font-semibold text-[#1A567B]">
                                  {card.priceDisplay}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  const next = (activeSection.config.quickPickCards || []).filter(
                                    (_, i) => i !== idx
                                  );
                                  updateActiveSection((s) => ({
                                    ...s,
                                    config: { ...s.config, quickPickCards: next },
                                  }));
                                }}
                                className="text-xs text-red-700 hover:underline font-medium shrink-0"
                              >
                                Remove Card
                              </button>
                            </div>

                            <div className="p-5 space-y-4">
                              {/* Source Product Band */}
                              <div className="p-3.5 bg-[#FBF9F5] border border-[#EAE4D8] rounded-lg">
                                <label className="sog-label">Canonical Product from Library</label>
                                <select
                                  value={card.productId}
                                  onChange={(e) => {
                                    const picked = products.find((p) => p.id === e.target.value);
                                    const next = [...(activeSection.config.quickPickCards || [])];
                                    next[idx] = {
                                      ...card,
                                      productId: e.target.value,
                                      displayTitle: picked?.name || card.displayTitle,
                                      priceDisplay: picked?.price || card.priceDisplay,
                                    };
                                    updateActiveSection((s) => ({
                                      ...s,
                                      config: { ...s.config, quickPickCards: next },
                                    }));
                                  }}
                                  className="sog-input"
                                >
                                  <option value="">— Select Product —</option>
                                  {activeProducts.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.name} ({p.price} · {p.category})
                                    </option>
                                  ))}
                                </select>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                                <div>
                                  <label className="sog-label">
                                    Badge Text (<code className="font-mono-tabular">.sog-qp-badge</code>)
                                  </label>
                                  <input
                                    type="text"
                                    value={card.badgeText}
                                    onChange={(e) => {
                                      const next = [...(activeSection.config.quickPickCards || [])];
                                      next[idx] = { ...card, badgeText: e.target.value };
                                      updateActiveSection((s) => ({
                                        ...s,
                                        config: { ...s.config, quickPickCards: next },
                                      }));
                                    }}
                                    className="sog-input"
                                  />
                                  <AIFieldAssist
                                    fieldKey={`qp-badge-${card.id}`}
                                    taskType="product_badge"
                                    currentValue={card.badgeText}
                                    compact
                                    product={linkedProd}
                                    guideContext={{
                                      title: guide.title,
                                      topic: guide.topic,
                                      sectionTitle: activeSection.title,
                                    }}
                                    onApply={(val) => {
                                      const next = [...(activeSection.config.quickPickCards || [])];
                                      next[idx] = { ...card, badgeText: val };
                                      updateActiveSection((s) => ({
                                        ...s,
                                        config: { ...s.config, quickPickCards: next },
                                      }));
                                    }}
                                  />
                                </div>

                                <div>
                                  <label className="sog-label">Display Title</label>
                                  <input
                                    type="text"
                                    value={card.displayTitle}
                                    onChange={(e) => {
                                      const next = [...(activeSection.config.quickPickCards || [])];
                                      next[idx] = { ...card, displayTitle: e.target.value };
                                      updateActiveSection((s) => ({
                                        ...s,
                                        config: { ...s.config, quickPickCards: next },
                                      }));
                                    }}
                                    className="sog-input"
                                  />
                                </div>

                                <div>
                                  <label className="sog-label">Supporting Meta Callout</label>
                                  <input
                                    type="text"
                                    value={card.metaDescription}
                                    onChange={(e) => {
                                      const next = [...(activeSection.config.quickPickCards || [])];
                                      next[idx] = { ...card, metaDescription: e.target.value };
                                      updateActiveSection((s) => ({
                                        ...s,
                                        config: { ...s.config, quickPickCards: next },
                                      }));
                                    }}
                                    placeholder="e.g., Best gift under $20"
                                    className="sog-input"
                                  />
                                </div>

                                <div className="grid grid-cols-2 gap-2.5">
                                  <div>
                                    <label className="sog-label">Price Display</label>
                                    <input
                                      type="text"
                                      value={card.priceDisplay}
                                      onChange={(e) => {
                                        const next = [...(activeSection.config.quickPickCards || [])];
                                        next[idx] = { ...card, priceDisplay: e.target.value };
                                        updateActiveSection((s) => ({
                                          ...s,
                                          config: { ...s.config, quickPickCards: next },
                                        }));
                                      }}
                                      className="sog-input font-mono-tabular"
                                    />
                                  </div>
                                  <div>
                                    <label className="sog-label">CTA Button Label</label>
                                    <input
                                      type="text"
                                      value={card.ctaLabel}
                                      onChange={(e) => {
                                        const next = [...(activeSection.config.quickPickCards || [])];
                                        next[idx] = { ...card, ctaLabel: e.target.value };
                                        updateActiveSection((s) => ({
                                          ...s,
                                          config: { ...s.config, quickPickCards: next },
                                        }));
                                      }}
                                      className="sog-input"
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* TYPE C: EDITOR'S PICK SPOTLIGHT */}
              {activeSection.type === 'editors_pick' && activeSection.config.editorsPick && (
                <div className="bg-white border border-[#D8D0C0] rounded-xl overflow-hidden shadow-2xs text-xs">
                  <div className="px-5 py-3.5 bg-[#162235] text-white flex items-center justify-between">
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-[#94C0D6] font-bold block">
                        Featured Storefront Callout
                      </span>
                      <h3 className="text-sm font-editorial font-semibold text-white">
                        Editor&apos;s Pick Spotlight (<code className="font-mono-tabular">.sog-editor-pick</code>)
                      </h3>
                    </div>
                  </div>
                  {(() => {
                    const ep = activeSection.config.editorsPick!;
                    const linkedProd = products.find((p) => p.id === ep.productId);
                    const updateEp = (patch: Partial<typeof ep>) =>
                      updateActiveSection((s) => ({
                        ...s,
                        config: { ...s.config, editorsPick: { ...ep, ...patch } },
                      }));

                    return (
                      <div className="p-5 space-y-4">
                        <div className="p-3.5 bg-[#FBF9F5] border border-[#EAE4D8] rounded-lg">
                          <label className="sog-label">Featured Product from Library</label>
                          <select
                            value={ep.productId}
                            onChange={(e) => {
                              const picked = products.find((p) => p.id === e.target.value);
                              updateEp({
                                productId: e.target.value,
                                heading: picked?.name || ep.heading,
                                priceDisplay: picked?.price || ep.priceDisplay,
                              });
                            }}
                            className="sog-input"
                          >
                            <option value="">— Select Product —</option>
                            {activeProducts.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name} ({p.price})
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                          <div>
                            <label className="sog-label">
                              Kicker Badge (<code className="font-mono-tabular">.sog-ep-kicker</code>)
                            </label>
                            <input
                              type="text"
                              value={ep.kicker}
                              onChange={(e) => updateEp({ kicker: e.target.value })}
                              className="sog-input"
                            />
                            <AIFieldAssist
                              fieldKey={`ep-kicker-${activeSection.id}`}
                              taskType="product_badge"
                              currentValue={ep.kicker}
                              compact
                              product={linkedProd}
                              guideContext={{ title: guide.title, topic: guide.topic }}
                              onApply={(val) => updateEp({ kicker: val })}
                            />
                          </div>

                          <div>
                            <label className="sog-label">Spotlight Heading</label>
                            <input
                              type="text"
                              value={ep.heading}
                              onChange={(e) => updateEp({ heading: e.target.value })}
                              className="sog-input"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="sog-label">
                            Editorial Spotlight Copy (<code className="font-mono-tabular">.sog-ep-desc</code>)
                          </label>
                          <textarea
                            rows={4}
                            value={ep.description}
                            onChange={(e) => updateEp({ description: e.target.value })}
                            className="sog-input leading-relaxed"
                          />
                          <AIFieldAssist
                            fieldKey={`ep-desc-${activeSection.id}`}
                            taskType="editorial_copy"
                            currentValue={ep.description}
                            product={linkedProd}
                            guideContext={{ title: guide.title, topic: guide.topic }}
                            onApply={(val) => updateEp({ description: val })}
                          />
                        </div>

                        <div className="p-3.5 bg-[#F6F3EB] border border-[#E2DACB] rounded-lg grid grid-cols-1 md:grid-cols-2 gap-3.5">
                          <div>
                            <label className="sog-label">Displayed Price</label>
                            <input
                              type="text"
                              value={ep.priceDisplay}
                              onChange={(e) => updateEp({ priceDisplay: e.target.value })}
                              className="sog-input font-mono-tabular"
                            />
                          </div>
                          <div>
                            <label className="sog-label">CTA Button Label</label>
                            <input
                              type="text"
                              value={ep.ctaLabel}
                              onChange={(e) => updateEp({ ctaLabel: e.target.value })}
                              className="sog-input"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* TYPE D: MAIN EDITORIAL SECTIONS + OPTIONAL ATTACHED 3-COL MORE GRIDS */}
              {activeSection.type === 'editorial_list' && (
                <div className="space-y-7 text-xs">
                  {/* LEVEL 2: CHAPTER BANNER & INTRODUCTORY COPY (Powder-Blue Editorial Band) */}
                  <div className="bg-[#EFF6FA] border border-[#B5D5E6] border-l-4 border-l-[#1A567B] rounded-xl p-5 space-y-3.5">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#1A567B] block">
                          Level 2 · Chapter Banner &amp; Introductory Copy
                        </span>
                        <h3 className="text-base font-editorial font-semibold text-[#111A27]">
                          Chapter Masthead (<code className="font-mono-tabular">.sog-chapter-banner</code>)
                        </h3>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                      <div>
                        <label className="sog-label">Chapter Kicker</label>
                        <input
                          type="text"
                          value={activeSection.config.chapterKicker || ''}
                          onChange={(e) =>
                            updateActiveSection((s) => ({
                              ...s,
                              config: { ...s.config, chapterKicker: e.target.value },
                            }))
                          }
                          placeholder="CHAPTER 01 • WEARABLE CLASSICAL LORE"
                          className="sog-input"
                        />
                      </div>
                      <div>
                        <label className="sog-label">Chapter Banner Heading</label>
                        <input
                          type="text"
                          value={activeSection.config.chapterTitle || ''}
                          onChange={(e) =>
                            updateActiveSection((s) => ({
                              ...s,
                              config: { ...s.config, chapterTitle: e.target.value },
                            }))
                          }
                          className="sog-input"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="sog-label">
                        Optional Section Introduction (<code className="font-mono-tabular">.sog-section-intro</code>)
                      </label>
                      <textarea
                        rows={2}
                        value={activeSection.config.sectionIntro || ''}
                        onChange={(e) =>
                          updateActiveSection((s) => ({
                            ...s,
                            config: { ...s.config, sectionIntro: e.target.value },
                          }))
                        }
                        placeholder="Introduce this chapter's theme and recipient appeal..."
                        className="sog-input"
                      />
                      <AIFieldAssist
                        fieldKey={`sec-intro-${activeSection.id}`}
                        taskType="section_intro"
                        currentValue={activeSection.config.sectionIntro || ''}
                        guideContext={{
                          title: guide.title,
                          topic: guide.topic,
                          sectionTitle: activeSection.title,
                        }}
                        onApply={(val, secondary) =>
                          updateActiveSection((s) => ({
                            ...s,
                            config: {
                              ...s.config,
                              sectionIntro: val,
                              chapterKicker: secondary || s.config.chapterKicker,
                            },
                          }))
                        }
                      />
                    </div>
                  </div>

                  {/* LEVEL 3: EDITORIAL PRODUCT-CARD COLLECTION HEADER & CARDS */}
                  <div className="space-y-4">
                    {/* Cohesive Collection Toolbar: Item Count + Search + Add Editorial Card */}
                    <div className="px-5 py-3.5 bg-[#162235] text-white rounded-xl flex flex-wrap items-center justify-between gap-3 shadow-xs">
                      <div className="flex items-center gap-3">
                        <span className="px-2.5 py-1 rounded-md bg-[#DFEEF5] text-[#111A27] font-mono-tabular font-bold text-xs">
                          {activeSection.config.editorialItems?.length || 0} Cards
                        </span>
                        <div>
                          <h3 className="text-sm font-editorial font-semibold text-white">
                            Level 3 · 310px Sticky-Image Editorial Collection
                          </h3>
                          <p className="text-[11px] text-[#A9B9CE]">
                            Supports 3, 14, 20, or 30+ long-form product reviews (<code className="font-mono-tabular">.sog-ed-card</code>)
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <div className="relative">
                          <Search className="w-3.5 h-3.5 text-[#8B9EB7] absolute left-2.5 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            value={productPickerFilter}
                            onChange={(e) => setProductPickerFilter(e.target.value)}
                            placeholder="Search cards in chapter..."
                            className="pl-8 pr-3 py-1.5 bg-[#0D1420] border border-[#2C3F5B] text-white placeholder-[#8B9EB7] rounded-lg text-xs focus:outline-none focus:border-[#94C0D6]"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const current = activeSection.config.editorialItems || [];
                            const firstProd = activeProducts[0];
                            const nextNum = `#${String(current.length + 1).padStart(2, '0')}`;
                            const newItem: EditorialCardItemConfig = {
                              id: `ed-${Date.now()}`,
                              productId: firstProd?.id || '',
                              rankNumber: nextNum,
                              superlativeBadge: 'Best Overall Pick',
                              eyebrowCategory: (firstProd?.productType || 'FEATURED').toUpperCase(),
                              priceDisplay: firstProd?.price || '$29.90',
                              priceNote: firstProd?.category || '',
                              displayTitle: firstProd?.name || 'New Editorial Product Card',
                              dek: firstProd?.shortDescription || '',
                              editorialCopy: '',
                              specsCallout: firstProd?.featuresSpecs
                                ? firstProd.featuresSpecs.replace(/\s*•\s*/g, '\n')
                                : '',
                              tagsText: firstProd?.tags?.length
                                ? `Best for: ${firstProd.tags.join(' • ')}`
                                : '',
                              ctaLabel: `Shop ${firstProd?.productType || 'Gift'} →`,
                              productUrlOverride: '',
                              imageUrlOverride: '',
                              order: current.length,
                            };
                            updateActiveSection((s) => ({
                              ...s,
                              config: { ...s.config, editorialItems: [...current, newItem] },
                            }));
                          }}
                          className="sog-btn-mint"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Add Editorial Card</span>
                        </button>
                      </div>
                    </div>

                    <div className="space-y-5">
                      {(activeSection.config.editorialItems || [])
                        .filter((item) => {
                          if (!productPickerFilter.trim()) return true;
                          const q = productPickerFilter.toLowerCase();
                          return (
                            item.displayTitle.toLowerCase().includes(q) ||
                            item.superlativeBadge.toLowerCase().includes(q) ||
                            item.editorialCopy.toLowerCase().includes(q)
                          );
                        })
                        .map((item, idx) => {
                          const linkedProd = products.find((p) => p.id === item.productId);
                          const usages = productUsageMap.get(item.productId) || [];
                          const updateItem = (patch: Partial<EditorialCardItemConfig>) => {
                            const list = [...(activeSection.config.editorialItems || [])];
                            const realIdx = list.findIndex((x) => x.id === item.id);
                            if (realIdx < 0) return;
                            list[realIdx] = { ...list[realIdx], ...patch };
                            updateActiveSection((s) => ({
                              ...s,
                              config: { ...s.config, editorialItems: list },
                            }));
                          };

                          return (
                            <div
                              key={item.id}
                              className="bg-white border border-[#D8D0C0] rounded-xl overflow-hidden shadow-2xs transition-colors"
                            >
                              {/* LEVEL 4 HEADER: Distinct Product Rank & Title Bar Separated from Editing Fields */}
                              <div className="px-5 py-3 bg-[#F3EFE6] border-b border-[#DED8CA] flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <span className="px-2.5 py-0.5 bg-[#111A27] text-[#F2D16B] font-mono-tabular font-bold rounded text-xs shrink-0">
                                    {item.rankNumber}
                                  </span>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2 text-[11px] text-[#5E6B7C]">
                                      <span className="font-semibold text-[#1A567B]">
                                        {item.superlativeBadge || 'Editorial Pick'}
                                      </span>
                                      <span aria-hidden="true">·</span>
                                      <span className="font-mono-tabular font-bold text-[#111A27]">
                                        {item.priceDisplay}
                                      </span>
                                    </div>
                                    <strong className="text-[#111A27] font-editorial text-base block truncate">
                                      {item.displayTitle}
                                    </strong>
                                  </div>
                                </div>

                                <div className="flex items-center gap-1 bg-white/80 border border-[#DED8CA] rounded-md p-0.5 shrink-0">
                                  <button
                                    type="button"
                                    disabled={idx === 0}
                                    title="Move card up"
                                    onClick={() => {
                                      const list = [...(activeSection.config.editorialItems || [])];
                                      const temp = list[idx];
                                      list[idx] = list[idx - 1];
                                      list[idx - 1] = temp;
                                      updateActiveSection((s) => ({
                                        ...s,
                                        config: {
                                          ...s.config,
                                          editorialItems: list.map((x, i) => ({ ...x, order: i })),
                                        },
                                      }));
                                    }}
                                    className="p-1 text-[#3E4C5E] hover:text-[#111A27] hover:bg-[#F2EDE2] rounded disabled:opacity-30"
                                  >
                                    <ArrowUp className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={
                                      idx === (activeSection.config.editorialItems?.length || 1) - 1
                                    }
                                    title="Move card down"
                                    onClick={() => {
                                      const list = [...(activeSection.config.editorialItems || [])];
                                      const temp = list[idx];
                                      list[idx] = list[idx + 1];
                                      list[idx + 1] = temp;
                                      updateActiveSection((s) => ({
                                        ...s,
                                        config: {
                                          ...s.config,
                                          editorialItems: list.map((x, i) => ({ ...x, order: i })),
                                        },
                                      }));
                                    }}
                                    className="p-1 text-[#3E4C5E] hover:text-[#111A27] hover:bg-[#F2EDE2] rounded disabled:opacity-30"
                                  >
                                    <ArrowDown className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    title="Remove card from chapter"
                                    onClick={() => {
                                      const list = (
                                        activeSection.config.editorialItems || []
                                      ).filter((x) => x.id !== item.id);
                                      updateActiveSection((s) => ({
                                        ...s,
                                        config: { ...s.config, editorialItems: list },
                                      }));
                                    }}
                                    className="p-1 text-[#5E6B7C] hover:text-red-600 hover:bg-red-50 rounded"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>

                              {/* LEVEL 4 BODY: Logically Grouped Input Zones */}
                              <div className="p-5 space-y-5">
                                {/* Group A: Storefront Source & Card Framing Metadata */}
                                <div className="p-3.5 bg-[#FBF9F5] border border-[#EAE4D8] rounded-lg space-y-3">
                                  <div>
                                    <label className="sog-label">
                                      Canonical Product Assignment (Library Source)
                                    </label>
                                    <select
                                      value={item.productId}
                                      onChange={(e) => {
                                        const picked = products.find(
                                          (p) => p.id === e.target.value
                                        );
                                        updateItem({
                                          productId: e.target.value,
                                          displayTitle: picked?.name || item.displayTitle,
                                          priceDisplay: picked?.price || item.priceDisplay,
                                          dek: picked?.shortDescription || item.dek,
                                          specsCallout: picked?.featuresSpecs
                                            ? picked.featuresSpecs.replace(/\s*•\s*/g, '\n')
                                            : item.specsCallout,
                                        });
                                      }}
                                      className="sog-input"
                                    >
                                      <option value="">— Select Product from Library —</option>
                                      {activeProducts.map((p) => (
                                        <option key={p.id} value={p.id}>
                                          {p.name} ({p.price} · {p.productType})
                                        </option>
                                      ))}
                                    </select>
                                    {usages.length > 1 && (
                                      <p className="mt-1.5 px-2.5 py-1 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-900 font-medium">
                                        Cross-Section Notice: This product is also assigned in{' '}
                                        <strong>{usages.join(', ')}</strong>.
                                      </p>
                                    )}
                                  </div>

                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1">
                                    <div>
                                      <label className="sog-label">Rank Number</label>
                                      <input
                                        type="text"
                                        value={item.rankNumber}
                                        onChange={(e) => updateItem({ rankNumber: e.target.value })}
                                        className="sog-input font-mono-tabular"
                                      />
                                    </div>
                                    <div>
                                      <label className="sog-label">Superlative Badge</label>
                                      <input
                                        type="text"
                                        value={item.superlativeBadge}
                                        onChange={(e) =>
                                          updateItem({ superlativeBadge: e.target.value })
                                        }
                                        className="sog-input"
                                      />
                                    </div>
                                    <div>
                                      <label className="sog-label">Eyebrow Category</label>
                                      <input
                                        type="text"
                                        value={item.eyebrowCategory}
                                        onChange={(e) =>
                                          updateItem({ eyebrowCategory: e.target.value })
                                        }
                                        className="sog-input"
                                      />
                                    </div>
                                    <div>
                                      <label className="sog-label">Price &amp; Spec Note</label>
                                      <div className="flex gap-1.5">
                                        <input
                                          type="text"
                                          value={item.priceDisplay}
                                          onChange={(e) =>
                                            updateItem({ priceDisplay: e.target.value })
                                          }
                                          className="w-20 px-2 py-1.5 font-mono-tabular bg-white border border-[#C8C0B0] rounded-md"
                                        />
                                        <input
                                          type="text"
                                          value={item.priceNote}
                                          onChange={(e) =>
                                            updateItem({ priceNote: e.target.value })
                                          }
                                          placeholder="Spec note"
                                          className="flex-1 min-w-0 px-2 py-1.5 bg-white border border-[#C8C0B0] rounded-md"
                                        />
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                {/* Group B: Editorial Copy & AI Drafting */}
                                <div className="space-y-4">
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                                    <div>
                                      <label className="sog-label">
                                        Editorial Display Title (<code className="font-mono-tabular">.sog-ed-title</code>)
                                      </label>
                                      <input
                                        type="text"
                                        value={item.displayTitle}
                                        onChange={(e) =>
                                          updateItem({ displayTitle: e.target.value })
                                        }
                                        className="sog-input font-medium"
                                      />
                                      <AIFieldAssist
                                        fieldKey={`ed-title-${item.id}`}
                                        taskType="editorial_title"
                                        currentValue={item.displayTitle}
                                        compact
                                        product={linkedProd}
                                        guideContext={{
                                          title: guide.title,
                                          topic: guide.topic,
                                          sectionTitle: activeSection.title,
                                        }}
                                        onApply={(val) => updateItem({ displayTitle: val })}
                                      />
                                    </div>

                                    <div>
                                      <label className="sog-label">
                                        Subheadline Dek (<code className="font-mono-tabular">.sog-ed-dek</code>)
                                      </label>
                                      <input
                                        type="text"
                                        value={item.dek}
                                        onChange={(e) => updateItem({ dek: e.target.value })}
                                        className="sog-input"
                                      />
                                      <AIFieldAssist
                                        fieldKey={`ed-dek-${item.id}`}
                                        taskType="short_description"
                                        currentValue={item.dek}
                                        compact
                                        product={linkedProd}
                                        guideContext={{
                                          title: guide.title,
                                          topic: guide.topic,
                                          sectionTitle: activeSection.title,
                                        }}
                                        onApply={(val) => updateItem({ dek: val })}
                                      />
                                    </div>
                                  </div>

                                  <div>
                                    <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
                                      <label className="sog-label mb-0">
                                        Long-Form Editorial Review Copy (<code className="font-mono-tabular">.sog-ed-copy</code>)
                                      </label>
                                      <span className="text-[11px] text-[#5E6B7C]">
                                        Separate paragraphs with a blank line
                                      </span>
                                    </div>
                                    <textarea
                                      rows={5}
                                      value={item.editorialCopy}
                                      onChange={(e) =>
                                        updateItem({ editorialCopy: e.target.value })
                                      }
                                      className="sog-input leading-relaxed"
                                    />
                                    <AIFieldAssist
                                      fieldKey={`ed-copy-${item.id}`}
                                      taskType="editorial_copy"
                                      currentValue={item.editorialCopy}
                                      product={linkedProd}
                                      guideContext={{
                                        title: guide.title,
                                        topic: guide.topic,
                                        audience: guide.audience,
                                        sectionTitle: activeSection.title,
                                      }}
                                      onApply={(val) => updateItem({ editorialCopy: val })}
                                    />
                                  </div>
                                </div>

                                {/* Group C: Verified Specs Callout & Storefront Footer */}
                                <div className="p-3.5 bg-[#F6F3EB] border border-[#E2DACB] rounded-lg space-y-3">
                                  <div>
                                    <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
                                      <label className="sog-label mb-0">
                                        Verified Specifications Callout (<code className="font-mono-tabular">.sog-ed-specs</code>)
                                      </label>
                                      <span className="text-[11px] text-[#5E6B7C]">
                                        One verified product spec per line
                                      </span>
                                    </div>
                                    <textarea
                                      rows={3}
                                      value={item.specsCallout}
                                      onChange={(e) => updateItem({ specsCallout: e.target.value })}
                                      className="sog-input font-mono-tabular text-xs"
                                    />
                                  </div>

                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <div>
                                      <label className="sog-label">
                                        Footer Tags Line (<code className="font-mono-tabular">.sog-ed-tags</code>)
                                      </label>
                                      <input
                                        type="text"
                                        value={item.tagsText}
                                        onChange={(e) => updateItem({ tagsText: e.target.value })}
                                        className="sog-input"
                                      />
                                    </div>
                                    <div>
                                      <label className="sog-label">
                                        CTA Button Label (<code className="font-mono-tabular">.sog-ed-cta</code>)
                                      </label>
                                      <input
                                        type="text"
                                        value={item.ctaLabel}
                                        onChange={(e) => updateItem({ ctaLabel: e.target.value })}
                                        className="sog-input"
                                      />
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>

                  {/* Attached Secondary 3-Column "More Gifts" Grids (.sog-more-section) */}
                  <div className="bg-[#F3EFE6] border border-[#D5CFC0] rounded-xl p-5 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#1A567B] block">
                          Secondary Chapter Extension
                        </span>
                        <h3 className="text-sm font-editorial font-semibold text-[#111A27]">
                          Attached 3-Column &ldquo;More Gifts&rdquo; Grids (
                          {activeSection.config.attachedMoreGrids?.length || 0})
                        </h3>
                        <p className="text-[#3E4C5E]">
                          Renders secondary <code className="font-mono-tabular">.sog-more-section</code> and{' '}
                          <code className="font-mono-tabular">.sog-card-grid</code> directly beneath this chapter.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const grids = activeSection.config.attachedMoreGrids || [];
                          const newGrid: MoreGiftsGridBlock = {
                            id: `mg-${Date.now()}`,
                            heading: `More ${activeSection.title}`,
                            subtitle: '',
                            items: [],
                          };
                          updateActiveSection((s) => ({
                            ...s,
                            config: { ...s.config, attachedMoreGrids: [...grids, newGrid] },
                          }));
                        }}
                        className="sog-btn-primary"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add 3-Col More Grid</span>
                      </button>
                    </div>

                    {(activeSection.config.attachedMoreGrids || []).map((grid, gIdx) => (
                      <div
                        key={grid.id}
                        className="p-4 bg-white border border-[#DED8CA] rounded-xl space-y-3 shadow-2xs"
                      >
                        <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#EAE4D8]">
                          <input
                            type="text"
                            value={grid.heading}
                            onChange={(e) => {
                              const grids = [...(activeSection.config.attachedMoreGrids || [])];
                              grids[gIdx] = { ...grid, heading: e.target.value };
                              updateActiveSection((s) => ({
                                ...s,
                                config: { ...s.config, attachedMoreGrids: grids },
                              }));
                            }}
                            placeholder="More Grid Heading"
                            className="flex-1 px-2.5 py-1.5 bg-[#FBF9F5] border border-[#C8C0B0] rounded-md font-editorial font-semibold text-sm"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const firstProd = activeProducts[0];
                              const grids = [...(activeSection.config.attachedMoreGrids || [])];
                              const newCard: MoreGiftsCardConfig = {
                                id: `mc-${Date.now()}`,
                                productId: firstProd?.id || '',
                                displayTitle: firstProd?.name || 'More Gift Card',
                                description: firstProd?.shortDescription || '',
                                priceDisplay: firstProd?.price || '$24.90',
                                ctaLabel: 'View Gift →',
                                productUrlOverride: '',
                                imageUrlOverride: '',
                                order: (grid.items || []).length,
                              };
                              grids[gIdx] = {
                                ...grid,
                                items: [...(grid.items || []), newCard],
                              };
                              updateActiveSection((s) => ({
                                ...s,
                                config: { ...s.config, attachedMoreGrids: grids },
                              }));
                            }}
                            className="sog-btn-powder"
                          >
                            + Add Card
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const grids = (
                                activeSection.config.attachedMoreGrids || []
                              ).filter((_, i) => i !== gIdx);
                              updateActiveSection((s) => ({
                                ...s,
                                config: { ...s.config, attachedMoreGrids: grids },
                              }));
                            }}
                            className="p-1 text-[#5E6B7C] hover:text-red-600"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>

                        <div className="space-y-2">
                          {(grid.items || []).map((card, cIdx) => (
                            <div
                              key={card.id}
                              className="p-2.5 bg-[#FBF9F5] border border-[#E2DACB] rounded-lg grid grid-cols-1 md:grid-cols-12 gap-2 items-center"
                            >
                              <select
                                value={card.productId}
                                onChange={(e) => {
                                  const picked = products.find((p) => p.id === e.target.value);
                                  const grids = [...(activeSection.config.attachedMoreGrids || [])];
                                  const items = [...(grid.items || [])];
                                  items[cIdx] = {
                                    ...card,
                                    productId: e.target.value,
                                    displayTitle: picked?.name || card.displayTitle,
                                    description: picked?.shortDescription || card.description,
                                    priceDisplay: picked?.price || card.priceDisplay,
                                  };
                                  grids[gIdx] = { ...grid, items };
                                  updateActiveSection((s) => ({
                                    ...s,
                                    config: { ...s.config, attachedMoreGrids: grids },
                                  }));
                                }}
                                className="md:col-span-4 px-2 py-1.5 bg-white border border-[#C8C0B0] rounded-md"
                              >
                                <option value="">— Product —</option>
                                {activeProducts.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name} ({p.price})
                                  </option>
                                ))}
                              </select>
                              <input
                                type="text"
                                value={card.displayTitle}
                                onChange={(e) => {
                                  const grids = [...(activeSection.config.attachedMoreGrids || [])];
                                  const items = [...(grid.items || [])];
                                  items[cIdx] = { ...card, displayTitle: e.target.value };
                                  grids[gIdx] = { ...grid, items };
                                  updateActiveSection((s) => ({
                                    ...s,
                                    config: { ...s.config, attachedMoreGrids: grids },
                                  }));
                                }}
                                placeholder="Title"
                                className="md:col-span-3 px-2 py-1.5 bg-white border border-[#C8C0B0] rounded-md font-medium"
                              />
                              <input
                                type="text"
                                value={card.description}
                                onChange={(e) => {
                                  const grids = [...(activeSection.config.attachedMoreGrids || [])];
                                  const items = [...(grid.items || [])];
                                  items[cIdx] = { ...card, description: e.target.value };
                                  grids[gIdx] = { ...grid, items };
                                  updateActiveSection((s) => ({
                                    ...s,
                                    config: { ...s.config, attachedMoreGrids: grids },
                                  }));
                                }}
                                placeholder="Description"
                                className="md:col-span-4 px-2 py-1.5 bg-white border border-[#C8C0B0] rounded-md"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const grids = [...(activeSection.config.attachedMoreGrids || [])];
                                  const items = (grid.items || []).filter((_, i) => i !== cIdx);
                                  grids[gIdx] = { ...grid, items };
                                  updateActiveSection((s) => ({
                                    ...s,
                                    config: { ...s.config, attachedMoreGrids: grids },
                                  }));
                                }}
                                className="md:col-span-1 p-1 text-[#5E6B7C] hover:text-red-600 justify-self-end"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TYPE E: STANDALONE MORE GIFTS 3-COLUMN GRID */}
              {activeSection.type === 'more_gifts_grid' && (
                <div className="space-y-4 text-xs">
                  <div className="px-5 py-3.5 bg-[#162235] text-white rounded-xl flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-editorial font-semibold text-white">
                        3-Column Product Grid (<code className="font-mono-tabular">.sog-card-grid</code>)
                      </h3>
                      <p className="text-[11px] text-[#A9B9CE]">
                        {activeSection.config.moreGridItems?.length || 0} cards in standalone grid
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const firstProd = activeProducts[0];
                        const current = activeSection.config.moreGridItems || [];
                        const nextCard: MoreGiftsCardConfig = {
                          id: `mgc-${Date.now()}`,
                          productId: firstProd?.id || '',
                          displayTitle: firstProd?.name || 'Product Card',
                          description: firstProd?.shortDescription || '',
                          priceDisplay: firstProd?.price || '$24.90',
                          ctaLabel: 'View Gift →',
                          productUrlOverride: '',
                          imageUrlOverride: '',
                          order: current.length,
                        };
                        updateActiveSection((s) => ({
                          ...s,
                          config: { ...s.config, moreGridItems: [...current, nextCard] },
                        }));
                      }}
                      className="sog-btn-mint"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Grid Card</span>
                    </button>
                  </div>

                  <div className="space-y-2.5">
                    {(activeSection.config.moreGridItems || []).map((card, idx) => (
                      <div
                        key={card.id}
                        className="p-3.5 bg-white border border-[#DED8CA] rounded-xl grid grid-cols-1 md:grid-cols-12 gap-2.5 items-center shadow-2xs"
                      >
                        <select
                          value={card.productId}
                          onChange={(e) => {
                            const picked = products.find((p) => p.id === e.target.value);
                            const next = [...(activeSection.config.moreGridItems || [])];
                            next[idx] = {
                              ...card,
                              productId: e.target.value,
                              displayTitle: picked?.name || card.displayTitle,
                              description: picked?.shortDescription || card.description,
                              priceDisplay: picked?.price || card.priceDisplay,
                            };
                            updateActiveSection((s) => ({
                              ...s,
                              config: { ...s.config, moreGridItems: next },
                            }));
                          }}
                          className="md:col-span-4 px-2.5 py-1.5 bg-[#FBF9F5] border border-[#C8C0B0] rounded-md"
                        >
                          <option value="">— Select Product —</option>
                          {activeProducts.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} ({p.price})
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={card.displayTitle}
                          onChange={(e) => {
                            const next = [...(activeSection.config.moreGridItems || [])];
                            next[idx] = { ...card, displayTitle: e.target.value };
                            updateActiveSection((s) => ({
                              ...s,
                              config: { ...s.config, moreGridItems: next },
                            }));
                          }}
                          placeholder="Title"
                          className="md:col-span-3 px-2.5 py-1.5 bg-white border border-[#C8C0B0] rounded-md font-medium"
                        />
                        <input
                          type="text"
                          value={card.description}
                          onChange={(e) => {
                            const next = [...(activeSection.config.moreGridItems || [])];
                            next[idx] = { ...card, description: e.target.value };
                            updateActiveSection((s) => ({
                              ...s,
                              config: { ...s.config, moreGridItems: next },
                            }));
                          }}
                          placeholder="Short description"
                          className="md:col-span-4 px-2.5 py-1.5 bg-white border border-[#C8C0B0] rounded-md"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const next = (activeSection.config.moreGridItems || []).filter(
                              (_, i) => i !== idx
                            );
                            updateActiveSection((s) => ({
                              ...s,
                              config: { ...s.config, moreGridItems: next },
                            }));
                          }}
                          className="md:col-span-1 p-1 text-[#5E6B7C] hover:text-red-600 justify-self-end"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TYPE F: VISUAL CATEGORY / DEITY / ERA HUB */}
              {activeSection.type === 'category_hub' && (
                <div className="space-y-6 text-xs">
                  {/* Level 2: Hub Banner & Intro */}
                  <div className="bg-[#EFF6FA] border border-[#B5D5E6] border-l-4 border-l-[#1A567B] rounded-xl p-5 space-y-3">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#1A567B] block">
                      Level 2 · Visual Category Hub Header
                    </span>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                      <div>
                        <label className="sog-label">Hub Heading</label>
                        <input
                          type="text"
                          value={activeSection.config.hubHeading || ''}
                          onChange={(e) =>
                            updateActiveSection((s) => ({
                              ...s,
                              config: { ...s.config, hubHeading: e.target.value },
                            }))
                          }
                          className="sog-input"
                        />
                      </div>
                      <div>
                        <label className="sog-label">
                          Hub Intro HTML (supports collection link)
                        </label>
                        <input
                          type="text"
                          value={activeSection.config.hubIntroHtml || ''}
                          onChange={(e) =>
                            updateActiveSection((s) => ({
                              ...s,
                              config: { ...s.config, hubIntroHtml: e.target.value },
                            }))
                          }
                          className="sog-input"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Level 3: Hub Collection Toolbar */}
                  <div className="px-5 py-3.5 bg-[#162235] text-white rounded-xl flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <span className="px-2.5 py-0.5 rounded bg-[#DFEEF5] text-[#111A27] font-mono-tabular font-bold text-xs">
                        {activeSection.config.categoryCards?.length || 0}
                      </span>
                      <div>
                        <h3 className="text-sm font-editorial font-semibold text-white">
                          Topic-Agnostic Visual Category Cards (<code className="font-mono-tabular">.sog-deity-grid</code>)
                        </h3>
                        <p className="text-[11px] text-[#A9B9CE]">
                          Use for Greek Gods, Historical Eras, Civilizations, or Recipient Archetypes
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const current = activeSection.config.categoryCards || [];
                        const firstProd = activeProducts[0];
                        const newCat: CategoryHubCardConfig = {
                          id: `cat-${Date.now()}`,
                          cardAnchorId: `jump-cat-${current.length + 1}`,
                          categoryName: 'New Category / Era',
                          subtitle: 'Motif 1 • Motif 2 • Motif 3',
                          thumbnailProductId: firstProd?.id || '',
                          thumbnailUrlOverride: '',
                          thumbnailAlt: 'Category gifts',
                          description:
                            'Describe why fans of this category, deity, or historical era love these pieces.',
                          links: firstProd
                            ? [
                                {
                                  id: `cl-${Date.now()}`,
                                  productId: firstProd.id,
                                  label: firstProd.name.slice(0, 24),
                                  urlOverride: '',
                                },
                              ]
                            : [],
                          order: current.length,
                        };
                        updateActiveSection((s) => ({
                          ...s,
                          config: { ...s.config, categoryCards: [...current, newCat] },
                        }));
                      }}
                      className="sog-btn-mint"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Category Card</span>
                    </button>
                  </div>

                  {/* Level 4: Category Cards */}
                  <div className="space-y-4">
                    {(activeSection.config.categoryCards || []).map((card, cIdx) => {
                      const updateCard = (patch: Partial<CategoryHubCardConfig>) => {
                        const cards = [...(activeSection.config.categoryCards || [])];
                        cards[cIdx] = { ...card, ...patch };
                        updateActiveSection((s) => ({
                          ...s,
                          config: { ...s.config, categoryCards: cards },
                        }));
                      };

                      return (
                        <div
                          key={card.id}
                          className="bg-white border border-[#D8D0C0] rounded-xl overflow-hidden shadow-2xs"
                        >
                          <div className="px-5 py-3 bg-[#F3EFE6] border-b border-[#DED8CA] flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <strong className="font-editorial text-sm text-[#111A27]">
                                {card.categoryName}
                              </strong>
                              <code className="font-mono-tabular text-xs text-[#1A567B]">
                                #{card.cardAnchorId}
                              </code>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                const cards = (activeSection.config.categoryCards || []).filter(
                                  (_, i) => i !== cIdx
                                );
                                updateActiveSection((s) => ({
                                  ...s,
                                  config: { ...s.config, categoryCards: cards },
                                }));
                              }}
                              className="text-red-700 hover:underline font-medium"
                            >
                              Delete Card
                            </button>
                          </div>

                          <div className="p-5 space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                              <div>
                                <label className="sog-label">Category Name</label>
                                <input
                                  type="text"
                                  value={card.categoryName}
                                  onChange={(e) => updateCard({ categoryName: e.target.value })}
                                  className="sog-input"
                                />
                              </div>
                              <div>
                                <label className="sog-label">
                                  Motif Subtitle (<code className="font-mono-tabular">.sog-deity-sub</code>)
                                </label>
                                <input
                                  type="text"
                                  value={card.subtitle}
                                  onChange={(e) => updateCard({ subtitle: e.target.value })}
                                  className="sog-input"
                                />
                              </div>
                              <div>
                                <label className="sog-label">Thumbnail Product</label>
                                <select
                                  value={card.thumbnailProductId}
                                  onChange={(e) =>
                                    updateCard({ thumbnailProductId: e.target.value })
                                  }
                                  className="sog-input"
                                >
                                  <option value="">— Select Thumbnail Product —</option>
                                  {activeProducts.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>

                            <div>
                              <label className="sog-label">Category Description</label>
                              <textarea
                                rows={2}
                                value={card.description}
                                onChange={(e) => updateCard({ description: e.target.value })}
                                className="sog-input"
                              />
                              <AIFieldAssist
                                fieldKey={`cat-desc-${card.id}`}
                                taskType="category_description"
                                currentValue={card.description}
                                compact
                                guideContext={{
                                  title: guide.title,
                                  topic: `${guide.topic} — ${card.categoryName}`,
                                }}
                                onApply={(val, secondary) =>
                                  updateCard({
                                    description: val,
                                    subtitle: secondary || card.subtitle,
                                  })
                                }
                              />
                            </div>

                            {/* Linked Product Chips (.sog-deity-chip) */}
                            <div className="p-3.5 bg-[#F6F3EB] border border-[#E2DACB] rounded-lg space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="sog-label mb-0">
                                  Linked Product Chips (<code className="font-mono-tabular">.sog-deity-chip</code>)
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const firstProd = activeProducts[0];
                                    updateCard({
                                      links: [
                                        ...(card.links || []),
                                        {
                                          id: `cl-${Date.now()}`,
                                          productId: firstProd?.id || '',
                                          label: firstProd?.name.slice(0, 22) || 'Featured Gift',
                                          urlOverride: '',
                                        },
                                      ],
                                    });
                                  }}
                                  className="text-[#1A567B] hover:underline font-semibold"
                                >
                                  + Add Chip Link
                                </button>
                              </div>

                              {(card.links || []).map((lnk, lIdx) => (
                                <div key={lnk.id} className="flex items-center gap-2">
                                  <select
                                    value={lnk.productId}
                                    onChange={(e) => {
                                      const picked = products.find((p) => p.id === e.target.value);
                                      const links = [...(card.links || [])];
                                      links[lIdx] = {
                                        ...lnk,
                                        productId: e.target.value,
                                        label: picked?.name.slice(0, 24) || lnk.label,
                                      };
                                      updateCard({ links });
                                    }}
                                    className="flex-1 px-2.5 py-1.5 bg-white border border-[#C8C0B0] rounded-md"
                                  >
                                    <option value="">— Select Product —</option>
                                    {activeProducts.map((p) => (
                                      <option key={p.id} value={p.id}>
                                        {p.name}
                                      </option>
                                    ))}
                                  </select>
                                  <input
                                    type="text"
                                    value={lnk.label}
                                    onChange={(e) => {
                                      const links = [...(card.links || [])];
                                      links[lIdx] = { ...lnk, label: e.target.value };
                                      updateCard({ links });
                                    }}
                                    placeholder="Chip label"
                                    className="w-44 px-2.5 py-1.5 bg-white border border-[#C8C0B0] rounded-md"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const links = (card.links || []).filter((_, i) => i !== lIdx);
                                      updateCard({ links });
                                    }}
                                    className="p-1 text-[#5E6B7C] hover:text-red-600"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* TYPE G & H: BUYING GUIDE & OPEN EDITORIAL FAQS */}
              {(activeSection.type === 'buying_guide' || activeSection.type === 'faq_grid') && (
                <div className="space-y-6 text-xs">
                  {activeSection.type === 'buying_guide' && (
                    <div className="bg-white border border-[#D8D0C0] rounded-xl overflow-hidden shadow-2xs">
                      <div className="px-5 py-3.5 bg-[#162235] text-white flex items-center justify-between">
                        <div>
                          <h3 className="text-sm font-editorial font-semibold text-white">
                            Editorial Buying Guide (<code className="font-mono-tabular">.sog-buying-guide</code>)
                          </h3>
                          <p className="text-[11px] text-[#A9B9CE]">
                            Configurable introduction and content pillars
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const bg = activeSection.config.buyingGuide || {
                              kicker: '🧭 Buying Guide',
                              title: activeSection.title,
                              introHtml: '',
                              pillars: [],
                            };
                            const nextNum = String((bg.pillars?.length || 0) + 1).padStart(2, '0');
                            const newPillar: BuyingGuidePillar = {
                              id: `pil-${Date.now()}`,
                              numberLabel: `${nextNum} / NEW PILLAR`,
                              heading: 'New Buying Principle',
                              bodyHtml: 'Explain how to choose the right gift for this audience.',
                              order: bg.pillars?.length || 0,
                            };
                            updateActiveSection((s) => ({
                              ...s,
                              config: {
                                ...s.config,
                                buyingGuide: {
                                  ...bg,
                                  pillars: [...(bg.pillars || []), newPillar],
                                },
                              },
                            }));
                          }}
                          className="sog-btn-mint"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Add Buying Pillar</span>
                        </button>
                      </div>

                      {(() => {
                        const bg = activeSection.config.buyingGuide || {
                          kicker: '🧭 Buying Guide',
                          title: activeSection.title,
                          introHtml: '',
                          pillars: [],
                        };
                        const updateBg = (patch: Partial<typeof bg>) =>
                          updateActiveSection((s) => ({
                            ...s,
                            config: { ...s.config, buyingGuide: { ...bg, ...patch } },
                          }));

                        return (
                          <div className="p-5 space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                              <div>
                                <label className="sog-label">Buying Guide Kicker</label>
                                <input
                                  type="text"
                                  value={bg.kicker}
                                  onChange={(e) => updateBg({ kicker: e.target.value })}
                                  className="sog-input"
                                />
                              </div>
                              <div>
                                <label className="sog-label">Buying Guide Title</label>
                                <input
                                  type="text"
                                  value={bg.title}
                                  onChange={(e) => updateBg({ title: e.target.value })}
                                  className="sog-input"
                                />
                              </div>
                            </div>

                            <div>
                              <label className="sog-label">
                                Buying Guide Introduction (supports &lt;em&gt; and &lt;strong&gt;)
                              </label>
                              <textarea
                                rows={2}
                                value={bg.introHtml}
                                onChange={(e) => updateBg({ introHtml: e.target.value })}
                                className="sog-input"
                              />
                            </div>

                            <div className="space-y-3">
                              {(bg.pillars || []).map((pil, pIdx) => (
                                <div
                                  key={pil.id}
                                  className="p-4 bg-[#FBF9F5] border border-[#E2DACB] rounded-lg space-y-2.5"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <input
                                      type="text"
                                      value={pil.numberLabel}
                                      onChange={(e) => {
                                        const next = [...(bg.pillars || [])];
                                        next[pIdx] = { ...pil, numberLabel: e.target.value };
                                        updateBg({ pillars: next });
                                      }}
                                      className="w-48 px-2.5 py-1.5 font-mono-tabular bg-white border border-[#C8C0B0] rounded-md font-semibold"
                                    />
                                    <input
                                      type="text"
                                      value={pil.heading}
                                      onChange={(e) => {
                                        const next = [...(bg.pillars || [])];
                                        next[pIdx] = { ...pil, heading: e.target.value };
                                        updateBg({ pillars: next });
                                      }}
                                      className="flex-1 px-2.5 py-1.5 bg-white border border-[#C8C0B0] rounded-md font-editorial font-semibold"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const next = (bg.pillars || []).filter(
                                          (_, i) => i !== pIdx
                                        );
                                        updateBg({ pillars: next });
                                      }}
                                      className="p-1 text-[#5E6B7C] hover:text-red-600"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                  <textarea
                                    rows={3}
                                    value={pil.bodyHtml}
                                    onChange={(e) => {
                                      const next = [...(bg.pillars || [])];
                                      next[pIdx] = { ...pil, bodyHtml: e.target.value };
                                      updateBg({ pillars: next });
                                    }}
                                    className="sog-input"
                                  />
                                  <AIFieldAssist
                                    fieldKey={`bg-pil-${pil.id}`}
                                    taskType="buying_guide_pillar"
                                    currentValue={pil.bodyHtml}
                                    compact
                                    guideContext={{ title: guide.title, topic: guide.topic }}
                                    onApply={(val, secondary) => {
                                      const next = [...(bg.pillars || [])];
                                      next[pIdx] = {
                                        ...pil,
                                        bodyHtml: val,
                                        heading: secondary || pil.heading,
                                      };
                                      updateBg({ pillars: next });
                                    }}
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* Canonical Open FAQ Grid Editor */}
                  <div className="bg-white border border-[#D8D0C0] rounded-xl overflow-hidden shadow-2xs">
                    <div className="px-5 py-3.5 bg-[#162235] text-white flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-editorial font-semibold text-white">
                          Crawlable Open FAQ Grid (<code className="font-mono-tabular">.sog-faq-grid</code> — Synchronized with JSON-LD Schema)
                        </h3>
                        <p className="text-[11px] text-[#A9B9CE]">
                          Questions and answers edited here automatically populate both the HTML
                          FAQ cards and the <code className="font-mono-tabular">FAQPage</code>{' '}
                          JSON-LD schema.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          const current = activeSection.config.faqItems || [];
                          const nextBadge = `Q${String(current.length + 1).padStart(2, '0')}`;
                          const newFaq: FAQItem = {
                            id: `faq-${Date.now()}`,
                            badge: nextBadge,
                            question: `New question about ${guide.topic.toLowerCase()} gifts?`,
                            answerHtml: 'Provide a helpful, product-grounded answer here.',
                            order: current.length,
                          };
                          updateActiveSection((s) => ({
                            ...s,
                            config: {
                              ...s.config,
                              includeFaqsInSection: true,
                              faqItems: [...current, newFaq],
                            },
                          }));
                        }}
                        className="sog-btn-mint"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add FAQ Pair</span>
                      </button>
                    </div>

                    <div className="p-5 space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                        <div>
                          <label className="sog-label">FAQ Header Title</label>
                          <input
                            type="text"
                            value={activeSection.config.faqHeaderTitle || ''}
                            onChange={(e) =>
                              updateActiveSection((s) => ({
                                ...s,
                                config: { ...s.config, faqHeaderTitle: e.target.value },
                              }))
                            }
                            className="sog-input"
                          />
                        </div>
                        <div>
                          <label className="sog-label">FAQ Header Subtitle</label>
                          <input
                            type="text"
                            value={activeSection.config.faqHeaderSubtitle || ''}
                            onChange={(e) =>
                              updateActiveSection((s) => ({
                                ...s,
                                config: { ...s.config, faqHeaderSubtitle: e.target.value },
                              }))
                            }
                            className="sog-input"
                          />
                        </div>
                      </div>

                      <div className="space-y-3">
                        {(activeSection.config.faqItems || []).map((faq, fIdx) => (
                          <div
                            key={faq.id}
                            className="p-4 bg-[#FBF9F5] border border-[#E2DACB] rounded-lg space-y-2.5"
                          >
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={faq.badge}
                                onChange={(e) => {
                                  const list = [...(activeSection.config.faqItems || [])];
                                  list[fIdx] = { ...faq, badge: e.target.value };
                                  updateActiveSection((s) => ({
                                    ...s,
                                    config: { ...s.config, faqItems: list },
                                  }));
                                }}
                                className="w-16 px-2 py-1.5 font-mono-tabular font-bold bg-[#DFEEF5] text-[#123E59] border border-[#94C0D6] rounded-md text-center"
                              />
                              <input
                                type="text"
                                value={faq.question}
                                onChange={(e) => {
                                  const list = [...(activeSection.config.faqItems || [])];
                                  list[fIdx] = { ...faq, question: e.target.value };
                                  updateActiveSection((s) => ({
                                    ...s,
                                    config: { ...s.config, faqItems: list },
                                  }));
                                }}
                                className="flex-1 px-2.5 py-1.5 font-editorial font-semibold bg-white border border-[#C8C0B0] rounded-md"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const list = (activeSection.config.faqItems || []).filter(
                                    (_, i) => i !== fIdx
                                  );
                                  updateActiveSection((s) => ({
                                    ...s,
                                    config: { ...s.config, faqItems: list },
                                  }));
                                }}
                                className="p-1 text-[#5E6B7C] hover:text-red-600"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            <textarea
                              rows={3}
                              value={faq.answerHtml}
                              onChange={(e) => {
                                const list = [...(activeSection.config.faqItems || [])];
                                list[fIdx] = { ...faq, answerHtml: e.target.value };
                                updateActiveSection((s) => ({
                                  ...s,
                                  config: { ...s.config, faqItems: list },
                                }));
                              }}
                              placeholder="Answer HTML (supports inline <a href='/products/...'>links</a> and <strong>)"
                              className="sog-input"
                            />

                            <AIFieldAssist
                              fieldKey={`faq-item-${faq.id}`}
                              taskType="faq_pair"
                              currentValue={faq.answerHtml}
                              compact
                              guideContext={{ title: guide.title, topic: guide.topic }}
                              onApply={(val, secondary) => {
                                const list = [...(activeSection.config.faqItems || [])];
                                list[fIdx] = {
                                  ...faq,
                                  answerHtml: val,
                                  question: secondary || faq.question,
                                };
                                updateActiveSection((s) => ({
                                  ...s,
                                  config: { ...s.config, faqItems: list },
                                }));
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>

        {/* RIGHT PANE: LIVE PREVIEW */}
        {showRightPreview && (
          <div className="w-[46%] min-w-[390px] max-w-[760px] shrink-0 h-full">
            <LivePreviewPanel
              sections={sortedSections}
              activeSectionId={activeSection?.id || null}
              products={products}
              guideSlug={guide.slug}
            />
          </div>
        )}
      </div>

      {/* Modal: Add New Section */}
      {showAddSectionModal && (
        <div className="fixed inset-0 z-50 bg-[#111A27]/60 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="bg-[#FBF9F5] border border-[#C6BEB0] rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl text-xs">
            <h2 className="text-lg font-editorial font-semibold text-[#111A27]">
              Add New Guide Section
            </h2>
            <form onSubmit={handleCreateSection} className="space-y-3.5">
              <div>
                <label className="sog-label">Section Template Type</label>
                <select
                  value={newSectionType}
                  onChange={(e) => setNewSectionType(e.target.value as SectionType)}
                  className="sog-input"
                >
                  {(Object.keys(SECTION_TYPE_LABELS) as SectionType[]).map((t) => (
                    <option key={t} value={t}>
                      {SECTION_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="sog-label">Section Title *</label>
                <input
                  type="text"
                  required
                  value={newSectionTitle}
                  onChange={(e) => setNewSectionTitle(e.target.value)}
                  placeholder="e.g., Part 5: Ancient Rome & Classical Coins"
                  className="sog-input"
                />
              </div>
              <div>
                <label className="sog-label">
                  HTML Anchor ID (e.g., <code className="font-mono-tabular">jump-rome</code>)
                </label>
                <input
                  type="text"
                  value={newSectionAnchor}
                  onChange={(e) => setNewSectionAnchor(e.target.value)}
                  placeholder="jump-part-5"
                  className="sog-input font-mono-tabular"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-[#DED8CA]">
                <button
                  type="button"
                  onClick={() => setShowAddSectionModal(false)}
                  className="sog-btn-secondary"
                >
                  Cancel
                </button>
                <button type="submit" className="sog-btn-primary">
                  Create Section
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
