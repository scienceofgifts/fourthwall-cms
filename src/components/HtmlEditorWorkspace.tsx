import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Code,
  Eye,
  Columns,
  Copy,
  Download,
  RotateCcw,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Replace,
  FileCode,
  Monitor,
  Smartphone,
  Hash,
  Search,
  History,
  X,
  FolderOpen,
  FilePlus2,
  Save,
  Pencil,
  Files,
  Globe,
  AlertCircle,
  Layers,
  Share2,
  Check,
} from 'lucide-react';
import {
  GiftGuide,
  GuideSection,
  HtmlEditorProject,
  HtmlProjectSection,
  HtmlSectionCategory,
  Product,
} from '../types/cms';
import {
  addRepeatedGroupItem,
  analyzeProjectSections,
  appendHtmlSectionToProject,
  applyCatalogProductToCard,
  attachPreviewImageFallbacks,
  buildSafePreviewHtml,
  buildSectionStartingNumbersMap,
  deleteProjectSectionById,
  deriveProjectSectionsFromHtml,
  ensureProjectHasSections,
  evaluateHtmlExportSize,
  FOURTHWALL_CHAR_LIMIT,
  getBlockNumberingKey,
  HUMAN_SECTION_TYPE_LABELS,
  joinProjectSectionsHtml,
  RecognizedBlock,
  RecognizedProductCard,
  removeRepeatedGroupItem,
  renameProjectSectionById,
  reorderProjectSectionById,
  reorderRepeatedGroupItem,
  replaceProjectHtmlContent,
  resolveSectionStartingNumbers,
  updateElementAttributes,
  updateElementIdAndReferences,
  updateHtmlNodeText,
  updateProductCardPrice,
  updateProductCardUrls,
  updateProjectSectionHtmlById,
  updateProjectSectionStartingNumberById,
  updateProjectSectionTypeById,
} from '../services/htmlWorkspaceEngine';
import {
  createNewHtmlProject,
  deleteHtmlProject,
  duplicateHtmlProject,
  getActiveLocalHtmlProjectId,
  loadLocalHtmlProjects,
  renameHtmlProject,
  saveHtmlProject,
  saveLocalHtmlProjectsList,
  setActiveLocalHtmlProjectId,
  subscribeToHtmlProjects,
} from '../services/firebase';
import { renderFullGuideHtml, renderSectionHtml } from '../services/htmlRenderer';
import { SEED_GREEK_SECTIONS, SEED_PRODUCTS } from '../data/greekMythologySeed';
import { LOCKED_FOURTHWALL_CSS } from '../constants/lockedCss';
import {
  ConfiguredGeminiModelId,
  GEMINI_MODEL_CHANGED_EVENT,
  GEMINI_MODEL_DEFINITIONS,
  GeminiExecutionMetadata,
  getSavedGeminiModelPreference,
  saveGeminiModelPreference,
} from '../services/geminiModelConfig';

interface HtmlEditorWorkspaceProps {
  products: Product[];
  userId?: string | null;
  defaultBaseUrl?: string;
  savedGuides?: GiftGuide[];
  onLoadSavedGuideHtml?: (guideId: string) => Promise<string>;
  onOpenCatalogProduct?: (product: Product) => void;
  onShowToast?: (msg: string) => void;
}

interface ChangeLogEntry {
  id: string;
  timestamp: string;
  description: string;
}

type WorkspaceViewMode = 'split' | 'visual' | 'raw' | 'preview';
type ProjectSaveStatus = 'saved' | 'saving' | 'unsaved' | 'error';
type PasteDrawerMode = 'add_section' | 'replace_project' | null;

const HTML_WORKSPACE_STORAGE_KEY = 'sog_html_workspace_session_v2';

const SELECTABLE_SECTION_TYPES: Array<{ value: HtmlSectionCategory; label: string }> = [
  { value: 'toc', label: HUMAN_SECTION_TYPE_LABELS.toc },
  { value: 'quick_picks', label: HUMAN_SECTION_TYPE_LABELS.quick_picks },
  { value: 'editors_pick', label: HUMAN_SECTION_TYPE_LABELS.editors_pick },
  { value: 'editorial_list', label: HUMAN_SECTION_TYPE_LABELS.editorial_list },
  { value: 'product_grid', label: HUMAN_SECTION_TYPE_LABELS.product_grid },
  { value: 'single_product_card', label: HUMAN_SECTION_TYPE_LABELS.single_product_card },
  { value: 'category_hub', label: HUMAN_SECTION_TYPE_LABELS.category_hub },
  { value: 'buying_guide', label: HUMAN_SECTION_TYPE_LABELS.buying_guide },
  { value: 'faq_section', label: HUMAN_SECTION_TYPE_LABELS.faq_section },
  { value: 'related_guides', label: HUMAN_SECTION_TYPE_LABELS.related_guides },
  { value: 'content_section', label: HUMAN_SECTION_TYPE_LABELS.content_section },
  { value: 'raw_fallback', label: HUMAN_SECTION_TYPE_LABELS.raw_fallback },
];

function buildDefaultStarterHtml(): string {
  const localProds: Product[] = SEED_PRODUCTS.map((p) => ({
    ...p,
    ownerId: 'local-preview',
  }));
  const localSecs: GuideSection[] = SEED_GREEK_SECTIONS.map((s) => ({
    ...s,
    ownerId: 'local-preview',
  }));
  return renderFullGuideHtml(localSecs, localProds, { forPreview: false });
}

function initializeProjectsState(
  userId?: string | null,
  defaultBaseUrl = 'https://scienceofgifts.com',
  catalogProducts: Product[] = []
): {
  projects: HtmlEditorProject[];
  activeProject: HtmlEditorProject;
} {
  const existingProjects = loadLocalHtmlProjects();
  const activeId = getActiveLocalHtmlProjectId();

  if (existingProjects.length > 0) {
    const found = ensureProjectHasSections(
      existingProjects.find((p) => p.id === activeId) || existingProjects[0],
      catalogProducts
    );
    setActiveLocalHtmlProjectId(found.id);
    return {
      projects: existingProjects,
      activeProject: found,
    };
  }

  // Migrate legacy single-session storage if present, otherwise seed starter project
  let initialCurrentHtml = '';
  let initialOriginalHtml = '';
  try {
    const rawLegacy = window.localStorage.getItem(HTML_WORKSPACE_STORAGE_KEY);
    if (rawLegacy) {
      const parsed = JSON.parse(rawLegacy);
      if (typeof parsed.currentHtml === 'string' && parsed.currentHtml.trim()) {
        initialCurrentHtml = parsed.currentHtml;
      }
      if (typeof parsed.originalHtml === 'string' && parsed.originalHtml.trim()) {
        initialOriginalHtml = parsed.originalHtml;
      }
    }
  } catch {
    // ignore legacy migration error
  }

  if (!initialCurrentHtml) {
    initialCurrentHtml = buildDefaultStarterHtml();
  }
  if (!initialOriginalHtml) {
    initialOriginalHtml = initialCurrentHtml;
  }

  const nowIso = new Date().toISOString();
  const starterProject: HtmlEditorProject = ensureProjectHasSections(
    {
      id: 'htmlproj-greek-mythology-default',
      ownerId: userId || 'local-preview',
      name: 'Greek Mythology Gift Guide',
      currentHtml: initialCurrentHtml,
      originalHtml: initialOriginalHtml,
      baseUrl: defaultBaseUrl,
      editorState: {
        viewMode: 'split',
        selectedBlockId: 'ALL',
        sidebarTab: 'blocks',
        previewViewport: 'desktop',
        includeFourthwallCss: true,
      },
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    catalogProducts
  );

  try {
    saveLocalHtmlProjectsList([starterProject]);
    setActiveLocalHtmlProjectId(starterProject.id);
  } catch {
    // ignore initial storage error; handled on explicit save
  }

  return {
    projects: [starterProject],
    activeProject: starterProject,
  };
}

export const HtmlEditorWorkspace: React.FC<HtmlEditorWorkspaceProps> = ({
  products,
  userId,
  defaultBaseUrl = 'https://scienceofgifts.com',
  savedGuides = [],
  onLoadSavedGuideHtml,
  onShowToast,
}) => {
  const initialData = useMemo(
    () => initializeProjectsState(userId, defaultBaseUrl, products),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Persistent Projects State
  const [projects, setProjects] = useState<HtmlEditorProject[]>(initialData.projects);
  const [activeProjectId, setActiveProjectId] = useState<string>(initialData.activeProject.id);
  const [projectName, setProjectName] = useState<string>(initialData.activeProject.name);
  const [projectBaseUrl, setProjectBaseUrl] = useState<string>(
    initialData.activeProject.baseUrl || defaultBaseUrl
  );
  const [projectCreatedAt, setProjectCreatedAt] = useState<string>(
    initialData.activeProject.createdAt
  );
  const [originalHtml, setOriginalHtml] = useState<string>(initialData.activeProject.originalHtml);
  const [sections, setSections] = useState<HtmlProjectSection[]>(
    () => initialData.activeProject.sections || []
  );
  const [currentHtml, setCurrentHtml] = useState<string>(initialData.activeProject.currentHtml);

  // Section-level Starting Product Number map (persisted per project)
  const [sectionStartingNumbers, setSectionStartingNumbers] = useState<Record<string, number>>(
    () => {
      const initAnalysis = analyzeProjectSections(
        initialData.activeProject.sections || [],
        products
      );
      return resolveSectionStartingNumbers(
        initAnalysis.blocks,
        initialData.activeProject.editorState?.sectionStartingNumbers
      );
    }
  );
  const [startingNumberInputDrafts, setStartingNumberInputDrafts] = useState<
    Record<string, string>
  >({});

  // Track exact last persisted snapshot to know when project has unsaved edits and prevent cross-project overwrite
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState<{
    id: string;
    name: string;
    currentHtml: string;
    originalHtml: string;
    baseUrl: string;
    sectionsJson: string;
    sectionStartingNumbersJson: string;
  }>(() => {
    const initSecs = initialData.activeProject.sections || [];
    const initAnalysis = analyzeProjectSections(initSecs, products);
    const resolvedInit = resolveSectionStartingNumbers(
      initAnalysis.blocks,
      initialData.activeProject.editorState?.sectionStartingNumbers
    );
    return {
      id: initialData.activeProject.id,
      name: initialData.activeProject.name,
      currentHtml: initialData.activeProject.currentHtml,
      originalHtml: initialData.activeProject.originalHtml,
      baseUrl: initialData.activeProject.baseUrl || defaultBaseUrl,
      sectionsJson: JSON.stringify(initSecs),
      sectionStartingNumbersJson: JSON.stringify(resolvedInit),
    };
  });

  const [saveStatus, setSaveStatus] = useState<ProjectSaveStatus>('saved');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string>(initialData.activeProject.updatedAt);

  // Autosave race-condition prevention refs
  const autosaveTimerRef = useRef<number | null>(null);
  const saveSequenceRef = useRef<number>(0);

  const [changeLog, setChangeLog] = useState<ChangeLogEntry[]>([]);
  const [viewMode, setViewMode] = useState<WorkspaceViewMode>(
    initialData.activeProject.editorState?.viewMode || 'split'
  );
  const [selectedBlockId, setSelectedBlockId] = useState<string>(
    initialData.activeProject.editorState?.selectedBlockId || 'ALL'
  );
  const [sidebarTab, setSidebarTab] = useState<'blocks' | 'anchors'>(
    initialData.activeProject.editorState?.sidebarTab || 'blocks'
  );

  // Differentiated Import Drawer state: 'add_section' vs 'replace_project'
  const [pasteDrawerMode, setPasteDrawerMode] = useState<PasteDrawerMode>(null);
  const [pasteBuffer, setPasteBuffer] = useState('');
  const [newSectionNameInput, setNewSectionNameInput] = useState('');
  const [newSectionTypeInput, setNewSectionTypeInput] = useState<HtmlSectionCategory | 'AUTO'>(
    'AUTO'
  );
  const [confirmReplaceProjectStep, setConfirmReplaceProjectStep] = useState(false);

  // Section Header Management state: Inline Rename & Delete Confirmation
  const [renamingSectionId, setRenamingSectionId] = useState<string | null>(null);
  const [renamingSectionNameDraft, setRenamingSectionNameDraft] = useState('');
  const [confirmDeleteSectionId, setConfirmDeleteSectionId] = useState<string | null>(null);

  // Export Section / Export Complete Project Modal state
  const [exportModalTarget, setExportModalTarget] = useState<{
    mode: 'section' | 'complete_project';
    sectionId?: string;
  } | null>(null);
  const [exportCopyFeedback, setExportCopyFeedback] = useState<{
    status: 'copied' | 'fallback';
    message: string;
  } | null>(null);
  const exportTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Raw HTML editor buffer & dirty tracking
  const [rawEditorBuffer, setRawEditorBuffer] = useState(initialData.activeProject.currentHtml);
  const [rawBufferDirty, setRawBufferDirty] = useState(false);

  // Preview settings & iframe ref
  const [previewViewport, setPreviewViewport] = useState<'desktop' | 'mobile'>(
    initialData.activeProject.editorState?.previewViewport || 'desktop'
  );
  const [includeFourthwallCss, setIncludeFourthwallCss] = useState<boolean>(
    initialData.activeProject.editorState?.includeFourthwallCss ?? true
  );
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);

  // Project Management Modals
  const [showProjectsModal, setShowProjectsModal] = useState(false);
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [renamingProjectName, setRenamingProjectName] = useState('');
  const [confirmDeleteProjectId, setConfirmDeleteProjectId] = useState<string | null>(null);

  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [newProjectNameInput, setNewProjectNameInput] = useState('');
  const [newProjectTemplateMode, setNewProjectTemplateMode] = useState<
    'blank' | 'paste' | 'greek_sample'
  >('paste');
  const [newProjectPasteHtml, setNewProjectPasteHtml] = useState('');
  const [newProjectBaseUrlInput, setNewProjectBaseUrlInput] = useState(
    projectBaseUrl || defaultBaseUrl
  );

  // Unsaved-changes guard when switching projects or creating a new project
  const [pendingProjectGuardAction, setPendingProjectGuardAction] = useState<
    | { type: 'open_project'; targetProject: HtmlEditorProject }
    | { type: 'new_project' }
    | null
  >(null);

  // Modals & Drawers
  const [showChangeSummaryModal, setShowChangeSummaryModal] = useState(false);
  const [confirmRestoreOriginal, setConfirmRestoreOriginal] = useState(false);

  // Catalog Replacement / Insertion Picker Modal
  const [catalogPickerTarget, setCatalogPickerTarget] = useState<{
    sectionId: string;
    mode: 'replace_card' | 'insert_into_group';
    card?: RecognizedProductCard;
    containerNodePath?: string;
    startingNumber?: number;
    replaceDescription: boolean;
    replaceSpecs: boolean;
  } | null>(null);
  const [catalogPickerSearch, setCatalogPickerSearch] = useState('');

  // AI Model Preference State (synced with centralized settings & localStorage)
  const [selectedGeminiModel, setSelectedGeminiModel] = useState<ConfiguredGeminiModelId>(() =>
    getSavedGeminiModelPreference()
  );

  useEffect(() => {
    const syncModel = () => setSelectedGeminiModel(getSavedGeminiModelPreference());
    window.addEventListener(GEMINI_MODEL_CHANGED_EVENT, syncModel);
    return () => window.removeEventListener(GEMINI_MODEL_CHANGED_EVENT, syncModel);
  }, []);

  // AI Assistance Drawer State (Explicitly user-triggered only)
  const [aiAssistTarget, setAiAssistTarget] = useState<{
    sectionId: string;
    nodePath: string;
    fieldLabel: string;
    currentText: string;
    asParagraphs?: boolean;
    asRawInnerHtml?: boolean;
    instruction: string;
    loading: boolean;
    error: string | null;
    proposedText: string | null;
    alternatives: string[];
    notes: string;
    modelMetadata?: GeminiExecutionMetadata;
  } | null>(null);

  // AI Unfamiliar Structure Classification state
  const [aiStructureReport, setAiStructureReport] = useState<{
    blockId: string;
    loading: boolean;
    error: string | null;
    componentCategory?: string;
    summary?: string;
    suggestedEditableFields?: Array<{
      label: string;
      selectorOrTag: string;
      currentValuePreview: string;
    }>;
    modelMetadata?: GeminiExecutionMetadata;
  } | null>(null);

  // Sync rawEditorBuffer when currentHtml changes from visual edits
  useEffect(() => {
    if (!rawBufferDirty) {
      setRawEditorBuffer(currentHtml);
    }
  }, [currentHtml, rawBufferDirty]);

  // Subscribe to Cloud Firestore HTML Projects when user is signed in
  useEffect(() => {
    if (!userId) return;
    const unsub = subscribeToHtmlProjects(userId, (cloudProjects) => {
      if (cloudProjects.length > 0) {
        setProjects(cloudProjects);
      }
    });
    return () => unsub();
  }, [userId]);

  // Run deterministic DOM/AST analysis across all ordered sections in the active project
  const analysis = useMemo(
    () => analyzeProjectSections(sections, products),
    [sections, products]
  );

  // Map from section.id -> HtmlProjectSection for fast lookup
  const sectionMapById = useMemo(() => {
    const map = new Map<string, HtmlProjectSection>();
    for (const s of sections) {
      map.set(s.id, s);
    }
    return map;
  }, [sections]);

  // Resolved starting numbers for all eligible numbered product sections
  const resolvedSectionStartingNumbers = useMemo(
    () => resolveSectionStartingNumbers(analysis.blocks, sectionStartingNumbers),
    [analysis.blocks, sectionStartingNumbers]
  );

  // Total project export evaluation (character count & Fourthwall 30k limit status)
  const completeProjectExportStatus = useMemo(
    () => evaluateHtmlExportSize(rawBufferDirty ? rawEditorBuffer : currentHtml),
    [currentHtml, rawBufferDirty, rawEditorBuffer]
  );

  // Determine whether the active project has genuinely unsaved edits compared to its last persisted state
  const isProjectDirty = useMemo(() => {
    if (lastSavedSnapshot.id !== activeProjectId) return false;
    const effectiveHtml = rawBufferDirty ? rawEditorBuffer : currentHtml;
    const trimmedName = projectName.trim() || 'Untitled Gift Guide';
    const currentStartingJson = JSON.stringify(resolvedSectionStartingNumbers);
    const currentSectionsJson = JSON.stringify(sections);
    return (
      rawBufferDirty ||
      trimmedName !== lastSavedSnapshot.name ||
      effectiveHtml !== lastSavedSnapshot.currentHtml ||
      originalHtml !== lastSavedSnapshot.originalHtml ||
      (projectBaseUrl || '') !== (lastSavedSnapshot.baseUrl || '') ||
      currentSectionsJson !== lastSavedSnapshot.sectionsJson ||
      currentStartingJson !== lastSavedSnapshot.sectionStartingNumbersJson
    );
  }, [
    activeProjectId,
    currentHtml,
    lastSavedSnapshot,
    originalHtml,
    projectBaseUrl,
    projectName,
    rawBufferDirty,
    rawEditorBuffer,
    resolvedSectionStartingNumbers,
    sections,
  ]);

  // Warn before closing browser tab if there are unsaved changes or a failed save
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isProjectDirty || saveStatus === 'error' || saveStatus === 'saving') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isProjectDirty, saveStatus]);

  const cancelPendingAutosave = useCallback(() => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  }, []);

  // Core save helper that validates & persists to localStorage (+ Firestore when signed in)
  const performSaveActiveProject = useCallback(
    async (options?: {
      overrideHtml?: string;
      overrideOriginalHtml?: string;
      overrideName?: string;
      overrideBaseUrl?: string;
      overrideSections?: HtmlProjectSection[];
      overrideSectionStartingNumbers?: Record<string, number>;
      overrideSelectedBlockId?: string;
      showToastOnSuccess?: boolean;
    }): Promise<boolean> => {
      cancelPendingAutosave();
      const saveSeq = ++saveSequenceRef.current;

      let effectiveSections = options?.overrideSections ?? sections;
      let effectiveCurrentHtml =
        options?.overrideHtml ?? (rawBufferDirty ? rawEditorBuffer : currentHtml);

      if (rawBufferDirty && options?.overrideHtml === undefined && options?.overrideSections === undefined) {
        effectiveSections = deriveProjectSectionsFromHtml(
          rawEditorBuffer,
          products,
          resolvedSectionStartingNumbers
        );
        effectiveCurrentHtml = joinProjectSectionsHtml(effectiveSections);
        setSections(effectiveSections);
        setCurrentHtml(effectiveCurrentHtml);
        setRawBufferDirty(false);
      }

      const effectiveOriginalHtml = options?.overrideOriginalHtml ?? originalHtml;
      const effectiveName = (options?.overrideName ?? projectName).trim() || 'Untitled Gift Guide';
      const effectiveBaseUrl = (options?.overrideBaseUrl ?? projectBaseUrl).trim();
      const effectiveStartingNumbers =
        options?.overrideSectionStartingNumbers ?? resolvedSectionStartingNumbers;
      const effectiveSelectedBlockId = options?.overrideSelectedBlockId ?? selectedBlockId;

      const projectToSave: HtmlEditorProject = {
        id: activeProjectId,
        ownerId: userId || 'local-preview',
        name: effectiveName,
        currentHtml: effectiveCurrentHtml,
        originalHtml: effectiveOriginalHtml,
        baseUrl: effectiveBaseUrl,
        sections: effectiveSections,
        editorState: {
          viewMode,
          selectedBlockId: effectiveSelectedBlockId,
          sidebarTab,
          previewViewport,
          includeFourthwallCss,
          sections: effectiveSections,
          sectionStartingNumbers: effectiveStartingNumbers,
        },
        createdAt: projectCreatedAt,
        updatedAt: new Date().toISOString(),
      };

      setSaveStatus('saving');
      setSaveError(null);

      try {
        const saved = await saveHtmlProject(projectToSave, userId);
        // Ignore stale completions if a newer save was triggered while awaiting
        if (saveSeq !== saveSequenceRef.current) {
          return true;
        }
        try {
          window.localStorage.setItem(
            HTML_WORKSPACE_STORAGE_KEY,
            JSON.stringify({
              originalHtml: saved.originalHtml,
              currentHtml: saved.currentHtml,
            })
          );
        } catch {
          // ignore legacy session write error
        }

        const savedSections = saved.sections || saved.editorState?.sections || effectiveSections;
        setProjects(loadLocalHtmlProjects());
        setLastSavedSnapshot({
          id: saved.id,
          name: saved.name,
          currentHtml: saved.currentHtml,
          originalHtml: saved.originalHtml,
          baseUrl: saved.baseUrl || '',
          sectionsJson: JSON.stringify(savedSections),
          sectionStartingNumbersJson: JSON.stringify(effectiveStartingNumbers),
        });
        setLastSavedAt(saved.updatedAt);
        setSaveStatus('saved');
        setSaveError(null);
        if (options?.showToastOnSuccess) {
          onShowToast?.(`Saved project "${saved.name}".`);
        }
        return true;
      } catch (err) {
        if (saveSeq !== saveSequenceRef.current) {
          return false;
        }
        const message =
          err instanceof Error ? err.message : 'Unable to save project to persistent storage.';
        setSaveStatus('error');
        setSaveError(message);
        return false;
      }
    },
    [
      activeProjectId,
      cancelPendingAutosave,
      currentHtml,
      includeFourthwallCss,
      onShowToast,
      originalHtml,
      previewViewport,
      products,
      projectBaseUrl,
      projectCreatedAt,
      projectName,
      rawBufferDirty,
      rawEditorBuffer,
      resolvedSectionStartingNumbers,
      sections,
      selectedBlockId,
      sidebarTab,
      userId,
      viewMode,
    ]
  );

  // Debounced autosave after edits (bound strictly to activeProjectId so switching never cross-writes)
  useEffect(() => {
    if (!isProjectDirty) return;
    if (lastSavedSnapshot.id !== activeProjectId) return;

    setSaveStatus((prev) => (prev === 'error' ? 'error' : 'unsaved'));

    cancelPendingAutosave();
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      void performSaveActiveProject({ showToastOnSuccess: false });
    }, 800);

    return () => cancelPendingAutosave();
  }, [
    activeProjectId,
    cancelPendingAutosave,
    currentHtml,
    isProjectDirty,
    lastSavedSnapshot.id,
    originalHtml,
    performSaveActiveProject,
    projectBaseUrl,
    projectName,
    resolvedSectionStartingNumbers,
    sections,
  ]);

  // Load a saved project into the workspace state cleanly
  const applyProjectToWorkspace = useCallback(
    (rawProj: HtmlEditorProject) => {
      cancelPendingAutosave();
      saveSequenceRef.current += 1;

      const proj = ensureProjectHasSections(rawProj, products);
      const projSections = proj.sections || [];
      const projAnalysis = analyzeProjectSections(projSections, products);
      const projStartingNumbers = resolveSectionStartingNumbers(
        projAnalysis.blocks,
        proj.editorState?.sectionStartingNumbers
      );

      setActiveLocalHtmlProjectId(proj.id);
      setActiveProjectId(proj.id);
      setProjectName(proj.name);
      setProjectBaseUrl(proj.baseUrl || 'https://scienceofgifts.com');
      setProjectCreatedAt(proj.createdAt);
      setOriginalHtml(proj.originalHtml);
      setSections(projSections);
      setCurrentHtml(proj.currentHtml);
      setRawEditorBuffer(proj.currentHtml);
      setRawBufferDirty(false);
      setSectionStartingNumbers(projStartingNumbers);
      setStartingNumberInputDrafts({});
      setRenamingSectionId(null);
      setConfirmDeleteSectionId(null);
      setViewMode(proj.editorState?.viewMode || 'split');
      setSelectedBlockId(proj.editorState?.selectedBlockId || 'ALL');
      setSidebarTab(proj.editorState?.sidebarTab || 'blocks');
      setPreviewViewport(proj.editorState?.previewViewport || 'desktop');
      setIncludeFourthwallCss(proj.editorState?.includeFourthwallCss ?? true);
      setLastSavedSnapshot({
        id: proj.id,
        name: proj.name,
        currentHtml: proj.currentHtml,
        originalHtml: proj.originalHtml,
        baseUrl: proj.baseUrl || 'https://scienceofgifts.com',
        sectionsJson: JSON.stringify(projSections),
        sectionStartingNumbersJson: JSON.stringify(projStartingNumbers),
      });
      setLastSavedAt(proj.updatedAt);
      setSaveStatus('saved');
      setSaveError(null);
      setChangeLog([
        {
          id: `open-${Date.now()}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          description: `Opened project "${proj.name}" (${projSections.length} section${
            projSections.length === 1 ? '' : 's'
          })`,
        },
      ]);
    },
    [cancelPendingAutosave, products]
  );

  // Helper to build an in-memory HtmlEditorProject snapshot representing current workspace state
  const buildCurrentWorkspaceProjectSnapshot = useCallback((): HtmlEditorProject => {
    return {
      id: activeProjectId,
      ownerId: userId || 'local-preview',
      name: projectName.trim() || 'Untitled Gift Guide',
      currentHtml,
      originalHtml,
      baseUrl: projectBaseUrl,
      sections,
      editorState: {
        viewMode,
        selectedBlockId,
        sidebarTab,
        previewViewport,
        includeFourthwallCss,
        sections,
        sectionStartingNumbers: resolvedSectionStartingNumbers,
      },
      createdAt: projectCreatedAt,
      updatedAt: new Date().toISOString(),
    };
  }, [
    activeProjectId,
    currentHtml,
    includeFourthwallCss,
    originalHtml,
    previewViewport,
    projectBaseUrl,
    projectCreatedAt,
    projectName,
    resolvedSectionStartingNumbers,
    sections,
    selectedBlockId,
    sidebarTab,
    userId,
    viewMode,
  ]);

  // Apply an updated HtmlEditorProject from a multi-section engine action and optionally persist immediately
  const commitUpdatedProjectState = useCallback(
    (
      updatedProj: HtmlEditorProject,
      description: string,
      options?: { persistImmediately?: boolean; toastMessage?: string }
    ) => {
      cancelPendingAutosave();
      const nextSections = updatedProj.sections || [];
      const nextHtml = updatedProj.currentHtml;
      const nextOriginalHtml = updatedProj.originalHtml;
      const nextStartingMap =
        updatedProj.editorState?.sectionStartingNumbers ||
        buildSectionStartingNumbersMap(nextSections, products, sectionStartingNumbers);
      const nextSelectedBlockId =
        updatedProj.editorState?.selectedBlockId ?? selectedBlockId;

      setSections(nextSections);
      setCurrentHtml(nextHtml);
      setOriginalHtml(nextOriginalHtml);
      setRawEditorBuffer(nextHtml);
      setRawBufferDirty(false);
      setSectionStartingNumbers(nextStartingMap);
      if (nextSelectedBlockId !== selectedBlockId) {
        setSelectedBlockId(nextSelectedBlockId);
      }

      setChangeLog((prev) => [
        {
          id: `chg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }),
          description,
        },
        ...prev.slice(0, 49),
      ]);

      if (options?.persistImmediately) {
        void performSaveActiveProject({
          overrideHtml: nextHtml,
          overrideOriginalHtml: nextOriginalHtml,
          overrideSections: nextSections,
          overrideSectionStartingNumbers: nextStartingMap,
          overrideSelectedBlockId: nextSelectedBlockId,
          showToastOnSuccess: false,
        });
      }

      if (options?.toastMessage) {
        onShowToast?.(options.toastMessage);
      }
    },
    [
      cancelPendingAutosave,
      onShowToast,
      performSaveActiveProject,
      products,
      sectionStartingNumbers,
      selectedBlockId,
    ]
  );

  // Apply a localized HTML edit inside a single section without affecting any other section
  const applySectionHtmlMutation = useCallback(
    (
      sectionId: string,
      mutateFn: (sectionHtml: string) => string,
      description: string,
      options?: { persistImmediately?: boolean }
    ) => {
      const targetSec = sections.find((s) => s.id === sectionId);
      if (!targetSec) return;
      const nextSectionHtml = mutateFn(targetSec.htmlContent);
      if (nextSectionHtml === targetSec.htmlContent) return;

      const updatedProj = updateProjectSectionHtmlById(
        buildCurrentWorkspaceProjectSnapshot(),
        sectionId,
        nextSectionHtml,
        products
      );
      commitUpdatedProjectState(updatedProj, description, options);
    },
    [buildCurrentWorkspaceProjectSnapshot, commitUpdatedProjectState, products, sections]
  );

  // Request to open another project (checks for unsaved changes or failed save first)
  const handleRequestOpenProject = (targetProject: HtmlEditorProject) => {
    if (targetProject.id === activeProjectId && !showProjectsModal) return;
    if (isProjectDirty || saveStatus === 'error') {
      setPendingProjectGuardAction({ type: 'open_project', targetProject });
      return;
    }
    applyProjectToWorkspace(targetProject);
    setShowProjectsModal(false);
    onShowToast?.(`Opened project "${targetProject.name}".`);
  };

  // Request to start a New Project (checks for unsaved changes or failed save first)
  const handleRequestNewProject = () => {
    if (isProjectDirty || saveStatus === 'error') {
      setPendingProjectGuardAction({ type: 'new_project' });
      return;
    }
    setNewProjectNameInput('');
    setNewProjectPasteHtml('');
    setNewProjectTemplateMode('paste');
    setNewProjectBaseUrlInput(projectBaseUrl || defaultBaseUrl);
    setShowNewProjectModal(true);
  };

  // Confirm creating the new project from the New Project modal
  const handleCreateNewProjectConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newProjectNameInput.trim() || 'Untitled Gift Guide';
    let initialHtml = '';
    if (newProjectTemplateMode === 'paste') {
      initialHtml =
        newProjectPasteHtml.trim() ||
        `<section class="sog-guide-container" id="new-gift-guide">\n  <h2>${cleanName}</h2>\n  <p>Paste your Fourthwall gift guide HTML or add sections visually here.</p>\n</section>`;
    } else if (newProjectTemplateMode === 'blank') {
      initialHtml = `<section class="sog-guide-container" id="new-gift-guide">\n  <h2>${cleanName}</h2>\n  <p>Start building or add gift guide HTML sections here.</p>\n</section>`;
    } else {
      initialHtml = buildDefaultStarterHtml();
    }

    const initialSections = deriveProjectSectionsFromHtml(initialHtml, products, {});
    const freshStartingNumbers = buildSectionStartingNumbersMap(initialSections, products, {});

    setSaveStatus('saving');
    setSaveError(null);
    try {
      const created = await createNewHtmlProject({
        name: cleanName,
        htmlContent: joinProjectSectionsHtml(initialSections),
        baseUrl: newProjectBaseUrlInput.trim() || defaultBaseUrl,
        userId,
        sections: initialSections,
        editorState: {
          viewMode: 'split',
          selectedBlockId: 'ALL',
          sidebarTab: 'blocks',
          previewViewport,
          includeFourthwallCss,
          sections: initialSections,
          sectionStartingNumbers: freshStartingNumbers,
        },
      });
      setProjects(loadLocalHtmlProjects());
      applyProjectToWorkspace(created);
      setShowNewProjectModal(false);
      onShowToast?.(`Created and saved new project "${created.name}".`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create new project.';
      setSaveStatus('error');
      setSaveError(msg);
    }
  };

  const hasDiffFromOriginal = currentHtml !== originalHtml || rawBufferDirty;

  // Switch between Visual / Split / Raw / Preview safely without discarding raw edits
  const handleSwitchViewMode = (targetMode: WorkspaceViewMode) => {
    if (rawBufferDirty && targetMode !== 'raw') {
      const updatedProj = replaceProjectHtmlContent(
        buildCurrentWorkspaceProjectSnapshot(),
        rawEditorBuffer,
        undefined,
        products
      );
      commitUpdatedProjectState(
        {
          ...updatedProj,
          originalHtml,
        },
        'Applied & re-analyzed edits from Raw HTML editor',
        {
          persistImmediately: true,
          toastMessage: 'Applied and re-analyzed your Raw HTML edits.',
        }
      );
    }
    setViewMode(targetMode);
  };

  // ACTION 1: ADD HTML SECTION (Appends new section without removing existing sections!)
  const handleAddHtmlSection = (
    htmlFragmentToAdd: string,
    customName?: string,
    manualType?: HtmlSectionCategory
  ) => {
    const trimmed = htmlFragmentToAdd.trim();
    if (!trimmed) {
      onShowToast?.('Please paste HTML section content before adding.');
      return;
    }

    const currentSnapshot = buildCurrentWorkspaceProjectSnapshot();
    const updatedProj = appendHtmlSectionToProject(
      currentSnapshot,
      trimmed,
      {
        name: customName?.trim() || newSectionNameInput.trim() || undefined,
        manualType:
          manualType || (newSectionTypeInput !== 'AUTO' ? newSectionTypeInput : undefined),
      },
      products
    );
    const addedSec = updatedProj.sections?.[updatedProj.sections.length - 1];

    setPasteDrawerMode(null);
    setPasteBuffer('');
    setNewSectionNameInput('');
    setNewSectionTypeInput('AUTO');
    setConfirmReplaceProjectStep(false);

    commitUpdatedProjectState(
      updatedProj,
      `Added HTML section "${addedSec?.name || 'New Section'}" (${
        updatedProj.sections?.length || 1
      } total sections)`,
      {
        persistImmediately: true,
        toastMessage: `Added section "${addedSec?.name || 'New Section'}" to "${projectName}".`,
      }
    );
  };

  // ACTION 2: REPLACE PROJECT HTML (Requires explicit confirmation; replaces entire project HTML)
  const handleConfirmReplaceProjectHtml = (
    htmlToLoad: string,
    sourceLabel = 'Replacement Project HTML'
  ) => {
    const trimmed = htmlToLoad.trim();
    if (!trimmed) {
      onShowToast?.('Please paste HTML content before replacing.');
      return;
    }

    const currentSnapshot = buildCurrentWorkspaceProjectSnapshot();
    const updatedProj = replaceProjectHtmlContent(currentSnapshot, trimmed, undefined, products);

    setStartingNumberInputDrafts({});
    setPasteDrawerMode(null);
    setPasteBuffer('');
    setNewSectionNameInput('');
    setNewSectionTypeInput('AUTO');
    setConfirmReplaceProjectStep(false);

    commitUpdatedProjectState(
      updatedProj,
      `Replaced entire project HTML with ${sourceLabel} (${
        updatedProj.sections?.length || 1
      } section(s))`,
      {
        persistImmediately: true,
        toastMessage: `Replaced project HTML in "${projectName}" (${
          updatedProj.sections?.length || 1
        } section(s)).`,
      }
    );
  };

  // SECTION MANAGEMENT: Delete a single section (with confirmation, immediate save)
  const handleConfirmDeleteSection = (sectionId: string) => {
    const targetSec = sectionMapById.get(sectionId);
    const secName = targetSec?.name || 'Section';
    const updatedProj = deleteProjectSectionById(
      buildCurrentWorkspaceProjectSnapshot(),
      sectionId,
      products
    );
    setConfirmDeleteSectionId(null);
    commitUpdatedProjectState(
      updatedProj,
      `Deleted section "${secName}" (${updatedProj.sections?.length || 0} remaining)`,
      {
        persistImmediately: true,
        toastMessage: `Deleted section "${secName}".`,
      }
    );
  };

  // SECTION MANAGEMENT: Reorder a section Up or Down (immediate save)
  const handleMoveSection = (sectionId: string, direction: 'up' | 'down') => {
    const targetSec = sectionMapById.get(sectionId);
    const secName = targetSec?.name || 'Section';
    const updatedProj = reorderProjectSectionById(
      buildCurrentWorkspaceProjectSnapshot(),
      sectionId,
      direction,
      products
    );
    commitUpdatedProjectState(
      updatedProj,
      `Moved section "${secName}" ${direction}`,
      {
        persistImmediately: true,
        toastMessage: `Moved "${secName}" ${direction}.`,
      }
    );
  };

  // SECTION MANAGEMENT: Rename a section (immediate save)
  const handleConfirmRenameSection = (sectionId: string, nextName: string) => {
    const clean = nextName.trim();
    if (!clean) return;
    const updatedProj = renameProjectSectionById(
      buildCurrentWorkspaceProjectSnapshot(),
      sectionId,
      clean,
      products
    );
    setRenamingSectionId(null);
    setRenamingSectionNameDraft('');
    commitUpdatedProjectState(updatedProj, `Renamed section to "${clean}"`, {
      persistImmediately: true,
      toastMessage: `Renamed section to "${clean}".`,
    });
  };

  // SECTION MANAGEMENT: Change section classification type manually (immediate save)
  const handleChangeSectionType = (sectionId: string, nextType: HtmlSectionCategory) => {
    const targetSec = sectionMapById.get(sectionId);
    const secName = targetSec?.name || 'Section';
    const updatedProj = updateProjectSectionTypeById(
      buildCurrentWorkspaceProjectSnapshot(),
      sectionId,
      nextType,
      products
    );
    commitUpdatedProjectState(
      updatedProj,
      `Changed "${secName}" section type to ${HUMAN_SECTION_TYPE_LABELS[nextType]}`,
      {
        persistImmediately: true,
        toastMessage: `Updated "${secName}" type to ${HUMAN_SECTION_TYPE_LABELS[nextType]}.`,
      }
    );
  };

  // Update a single section's Starting Product Number without altering any other section
  const handleUpdateSectionStartingNumber = (block: RecognizedBlock, nextStartNum: number) => {
    if (!Number.isInteger(nextStartNum) || nextStartNum < 1) return;
    const sectionKey = getBlockNumberingKey(block);

    setStartingNumberInputDrafts((prev) => {
      const next = { ...prev };
      delete next[sectionKey];
      return next;
    });

    const updatedProj = updateProjectSectionStartingNumberById(
      buildCurrentWorkspaceProjectSnapshot(),
      block.id,
      nextStartNum,
      products
    );

    commitUpdatedProjectState(
      updatedProj,
      `Updated "${block.label}" starting product number to ${nextStartNum}`,
      { persistImmediately: true }
    );
  };

  const handleLoadSamplePreset = (
    preset:
      | 'full_guide'
      | 'editorial_list'
      | 'quick_picks'
      | 'toc'
      | 'editors_pick'
      | 'buying_guide_faq'
  ) => {
    const localProds: Product[] = SEED_PRODUCTS.map((p) => ({
      ...p,
      ownerId: 'local-preview',
    }));
    const localSecs: GuideSection[] = SEED_GREEK_SECTIONS.map((s) => ({
      ...s,
      ownerId: 'local-preview',
    }));

    if (preset === 'full_guide') {
      const fullHtml = renderFullGuideHtml(localSecs, localProds, { forPreview: false });
      setPasteBuffer(fullHtml);
      return;
    }

    if (preset === 'toc') {
      const toc = localSecs.find((s) => s.type === 'bookmarks') || localSecs[0];
      const html = renderSectionHtml(toc, localProds, { forPreview: false });
      if (pasteDrawerMode === 'add_section') {
        handleAddHtmlSection(html, 'Table of Contents / Bookmarks', 'toc');
      } else {
        setPasteBuffer(html);
      }
    } else if (preset === 'quick_picks') {
      const sec = localSecs.find((s) => s.type === 'quick_picks') || localSecs[1];
      const html = renderSectionHtml(sec, localProds, { forPreview: false });
      if (pasteDrawerMode === 'add_section') {
        handleAddHtmlSection(html, 'Quick Picks Grid', 'quick_picks');
      } else {
        setPasteBuffer(html);
      }
    } else if (preset === 'editors_pick') {
      const sec = localSecs.find((s) => s.type === 'editors_pick') || localSecs[2];
      const html = renderSectionHtml(sec, localProds, { forPreview: false });
      if (pasteDrawerMode === 'add_section') {
        handleAddHtmlSection(html, "Our #1 Editor's Pick", 'editors_pick');
      } else {
        setPasteBuffer(html);
      }
    } else if (preset === 'editorial_list') {
      const sec = localSecs.find((s) => s.id === 'sec-part1-apparel') || localSecs[3];
      const html = renderSectionHtml(sec, localProds, { forPreview: false });
      if (pasteDrawerMode === 'add_section') {
        handleAddHtmlSection(html, 'Numbered Product Section', 'editorial_list');
      } else {
        setPasteBuffer(html);
      }
    } else if (preset === 'buying_guide_faq') {
      const faq = localSecs.find((s) => s.type === 'buying_guide')!;
      const html = renderSectionHtml(faq, localProds, { forPreview: false });
      if (pasteDrawerMode === 'add_section') {
        handleAddHtmlSection(html, 'Buying Guide & FAQs', 'buying_guide');
      } else {
        setPasteBuffer(html);
      }
    }
  };

  // Copy HTML helper with automatic fallback to selectable textarea if Clipboard API fails
  const handleCopyHtmlWithFallback = async (htmlContent: string, label: string) => {
    setExportCopyFeedback(null);
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(htmlContent);
        setExportCopyFeedback({
          status: 'copied',
          message: `Copied ${label} (${htmlContent.length.toLocaleString()} characters) to clipboard.`,
        });
        onShowToast?.(`Copied ${label} (${htmlContent.length.toLocaleString()} chars).`);
        return;
      }
      throw new Error('Clipboard API unavailable');
    } catch {
      setExportCopyFeedback({
        status: 'fallback',
        message:
          'Automatic clipboard copy was blocked by your browser. The HTML below has been selected—press Ctrl+C (or Cmd+C) to copy.',
      });
      window.setTimeout(() => {
        if (exportTextareaRef.current) {
          exportTextareaRef.current.focus();
          exportTextareaRef.current.select();
        }
      }, 50);
    }
  };

  // Download HTML file helper for either a single section or the complete project
  const handleDownloadHtmlFile = (htmlContent: string, fileBaseName: string) => {
    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const slugName =
      fileBaseName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'fourthwall-gift-guide';
    a.download = `${slugName}-${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
    onShowToast?.(`Downloaded ${a.download}.`);
  };

  // Trigger explicit AI text rewrite
  const handleRunAiRewrite = async (instructionOverride?: string) => {
    if (!aiAssistTarget) return;
    const instruction = instructionOverride || aiAssistTarget.instruction;
    setAiAssistTarget({ ...aiAssistTarget, loading: true, error: null });
    try {
      const res = await fetch('/api/ai/analyze-html', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: 'rewrite_text',
          htmlFragment: aiAssistTarget.currentText,
          instruction,
          preferredModel: selectedGeminiModel,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAiAssistTarget((prev) =>
          prev
            ? {
                ...prev,
                loading: false,
                error: data.error || `AI request failed (${res.status})`,
              }
            : null
        );
        return;
      }
      setAiAssistTarget((prev) =>
        prev
          ? {
              ...prev,
              loading: false,
              proposedText: data.proposedText || '',
              alternatives: Array.isArray(data.alternatives) ? data.alternatives : [],
              notes: data.notes || '',
              modelMetadata: data.modelMetadata,
            }
          : null
      );
    } catch (err) {
      setAiAssistTarget((prev) =>
        prev
          ? {
              ...prev,
              loading: false,
              error: err instanceof Error ? err.message : 'Network error calling AI service.',
            }
          : null
      );
    }
  };

  // Trigger explicit AI classification on an unfamiliar block
  const handleRunAiClassifyBlock = async (block: RecognizedBlock) => {
    setAiStructureReport({
      blockId: block.id,
      loading: true,
      error: null,
    });
    try {
      const res = await fetch('/api/ai/analyze-html', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: 'classify',
          htmlFragment: block.rawHtmlSnippet,
          preferredModel: selectedGeminiModel,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAiStructureReport({
          blockId: block.id,
          loading: false,
          error: data.error || 'AI classification unavailable.',
        });
        return;
      }
      setAiStructureReport({
        blockId: block.id,
        loading: false,
        error: null,
        componentCategory: data.componentCategory,
        summary: data.summary,
        suggestedEditableFields: data.suggestedEditableFields || [],
        modelMetadata: data.modelMetadata,
      });
    } catch (err) {
      setAiStructureReport({
        blockId: block.id,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to classify HTML block.',
      });
    }
  };

  const visibleBlocks = useMemo(() => {
    if (selectedBlockId === 'ALL') return analysis.blocks;
    return analysis.blocks.filter((b) => b.id === selectedBlockId);
  }, [analysis.blocks, selectedBlockId]);

  const safePreviewBodyHtml = useMemo(
    () => buildSafePreviewHtml(currentHtml, products, { baseUrl: projectBaseUrl }),
    [currentHtml, products, projectBaseUrl]
  );

  const previewIframeSrcDoc = useMemo(() => {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #111;
      background: #fff;
      margin: 0;
      padding: 24px 28px 64px 28px;
      line-height: 1.5;
    }
    img {
      max-width: 100%;
      height: auto;
      opacity: 1 !important;
      visibility: visible !important;
    }
    ${includeFourthwallCss ? LOCKED_FOURTHWALL_CSS : ''}
  </style>
</head>
<body>
${safePreviewBodyHtml}
</body>
</html>`;
  }, [safePreviewBodyHtml, includeFourthwallCss]);

  const handlePreviewIframeLoad = useCallback(() => {
    try {
      const doc = previewIframeRef.current?.contentDocument;
      if (doc) {
        attachPreviewImageFallbacks(doc);
      }
    } catch {
      // ignore cross-origin or unmounted iframe access
    }
  }, []);

  const filteredCatalogForPicker = useMemo(() => {
    const q = catalogPickerSearch.trim().toLowerCase();
    return products
      .filter((p) => !p.archived)
      .filter((p) => {
        if (!q) return true;
        return (
          p.name.toLowerCase().includes(q) ||
          p.productUrl.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q) ||
          p.productType.toLowerCase().includes(q)
        );
      });
  }, [products, catalogPickerSearch]);

  // Resolved Export Modal Payload
  const activeExportPayload = useMemo(() => {
    if (!exportModalTarget) return null;
    if (exportModalTarget.mode === 'section' && exportModalTarget.sectionId) {
      const sec = sectionMapById.get(exportModalTarget.sectionId);
      if (sec) {
        return {
          title: `Export Section: ${sec.name}`,
          subtitle: `${HUMAN_SECTION_TYPE_LABELS[sec.type] || sec.type} (Section ${sec.order + 1} of ${sections.length})`,
          fileBaseName: `${projectName}-${sec.name}`,
          ...evaluateHtmlExportSize(sec.htmlContent),
        };
      }
    }
    const fullHtml = rawBufferDirty ? rawEditorBuffer : joinProjectSectionsHtml(sections);
    return {
      title: `Export Complete Project: ${projectName}`,
      subtitle: `All ${sections.length} section(s) concatenated in displayed order`,
      fileBaseName: projectName,
      ...evaluateHtmlExportSize(fullHtml),
    };
  }, [exportModalTarget, projectName, rawBufferDirty, rawEditorBuffer, sectionMapById, sections]);

  // Helper to render a Product Card editor inside either a primary block or an attached nested block
  const renderProductCardEditor = (
    parentSectionId: string,
    ownerBlock: RecognizedBlock,
    card: RecognizedProductCard,
    cardIdx: number,
    isNumberedSection: boolean,
    sectionStartNum: number
  ) => {
    const matchedProduct = card.matchedCatalogProductId
      ? products.find((p) => p.id === card.matchedCatalogProductId)
      : undefined;
    const calculatedProductNumber = sectionStartNum + cardIdx;

    return (
      <div
        key={card.cardNodePath}
        className="border border-[#D5CFC0] rounded-xl overflow-hidden bg-white"
      >
        {/* Product Card Header Bar */}
        <div className="bg-[#F3EFE6] border-b border-[#DED8CA] px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="px-2 py-0.5 bg-[#111A27] text-white font-mono-tabular font-bold rounded text-[11px]">
              {isNumberedSection
                ? card.fields.rankNumber?.mode === 'element'
                  ? card.fields.rankNumber.value
                  : `#${String(calculatedProductNumber).padStart(2, '0')}`
                : ownerBlock.blockType === 'editors_pick'
                ? '#1 Pick'
                : `Card ${String(cardIdx + 1).padStart(2, '0')}`}
            </span>
            <h3 className="font-editorial font-semibold text-sm text-[#111A27] truncate">
              {card.fields.title?.value || 'Recognized Product Card'}
            </h3>
            {matchedProduct ? (
              <span className="text-[11px] text-[#134634] font-semibold inline-flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Catalog Match: {matchedProduct.name}</span>
              </span>
            ) : (
              <span className="text-[11px] text-[#64748B]">Unmatched URL</span>
            )}
          </div>

          {/* Catalog Sync & Reorder / Remove Controls */}
          <div className="flex flex-wrap items-center gap-1.5">
            {matchedProduct && (
              <button
                type="button"
                onClick={() => {
                  applySectionHtmlMutation(
                    parentSectionId,
                    (secHtml) =>
                      applyCatalogProductToCard(secHtml, card, matchedProduct, {
                        replaceDescription: false,
                        replaceSpecs: false,
                      }),
                    `Refreshed card "${matchedProduct.name}" from catalog`
                  );
                  onShowToast?.(
                    `Refreshed title, URL, image, and price from catalog for "${matchedProduct.name}".`
                  );
                }}
                title="Refresh existing card fields from matched catalog product"
                className="inline-flex items-center gap-1 px-2 py-1 bg-[#E1F2EA] text-[#134634] border border-[#96CDB0] rounded font-semibold hover:bg-[#CFEAD9]"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Sync from Catalog</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setCatalogPickerTarget({
                  sectionId: parentSectionId,
                  mode: 'replace_card',
                  card,
                  replaceDescription: false,
                  replaceSpecs: false,
                });
                setCatalogPickerSearch('');
              }}
              className="inline-flex items-center gap-1 px-2 py-1 bg-[#DFEEF5] text-[#123E59] border border-[#94C0D6] rounded font-semibold hover:bg-[#CBE3EE]"
            >
              <Replace className="w-3 h-3" />
              <span>Replace Product</span>
            </button>

            {ownerBlock.repeatedContainerPath && (
              <div className="inline-flex items-center gap-0.5 ml-1 pl-1.5 border-l border-[#D5CFC0]">
                <button
                  type="button"
                  disabled={cardIdx === 0}
                  onClick={() => {
                    applySectionHtmlMutation(
                      parentSectionId,
                      (secHtml) =>
                        reorderRepeatedGroupItem(
                          secHtml,
                          ownerBlock.repeatedContainerPath!,
                          card.cardNodePath,
                          'up',
                          isNumberedSection ? { startingNumber: sectionStartNum } : undefined
                        ),
                      `Moved product card up in "${ownerBlock.label}"`
                    );
                  }}
                  title="Move card up"
                  className="p-1 text-[#5E6B7C] hover:text-[#111A27] disabled:opacity-30"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  disabled={cardIdx === ownerBlock.productCards.length - 1}
                  onClick={() => {
                    applySectionHtmlMutation(
                      parentSectionId,
                      (secHtml) =>
                        reorderRepeatedGroupItem(
                          secHtml,
                          ownerBlock.repeatedContainerPath!,
                          card.cardNodePath,
                          'down',
                          isNumberedSection ? { startingNumber: sectionStartNum } : undefined
                        ),
                      `Moved product card down in "${ownerBlock.label}"`
                    );
                  }}
                  title="Move card down"
                  className="p-1 text-[#5E6B7C] hover:text-[#111A27] disabled:opacity-30"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    applySectionHtmlMutation(
                      parentSectionId,
                      (secHtml) =>
                        removeRepeatedGroupItem(
                          secHtml,
                          card.cardNodePath,
                          isNumberedSection ? { startingNumber: sectionStartNum } : undefined
                        ),
                      `Removed product card "${card.fields.title?.value || cardIdx + 1}"`
                    );
                  }}
                  title="Remove product card"
                  className="p-1 text-[#5E6B7C] hover:text-red-600"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Dynamic Card Fields Grid */}
        <div className="p-4 grid grid-cols-1 md:grid-cols-12 gap-3.5">
          {card.fields.rankNumber && card.fields.rankNumber.mode !== 'title_prefix' && (
            <div className="md:col-span-2">
              <label className="sog-label">Rank Badge</label>
              <input
                type="text"
                value={card.fields.rankNumber.value}
                onChange={(e) => {
                  const val = e.target.value;
                  applySectionHtmlMutation(
                    parentSectionId,
                    (secHtml) => updateHtmlNodeText(secHtml, card.fields.rankNumber!.nodePath, val),
                    'Updated card rank badge'
                  );
                }}
                className="sog-input font-mono-tabular"
              />
            </div>
          )}

          {card.fields.badge && (
            <div className="md:col-span-5">
              <label className="sog-label">Superlative / Badge</label>
              <input
                type="text"
                value={card.fields.badge.value}
                onChange={(e) => {
                  const val = e.target.value;
                  applySectionHtmlMutation(
                    parentSectionId,
                    (secHtml) => updateHtmlNodeText(secHtml, card.fields.badge!.nodePath, val),
                    'Updated card badge'
                  );
                }}
                className="sog-input"
              />
            </div>
          )}

          {card.fields.eyebrow && (
            <div className="md:col-span-5">
              <label className="sog-label">Eyebrow Category</label>
              <input
                type="text"
                value={card.fields.eyebrow.value}
                onChange={(e) => {
                  const val = e.target.value;
                  applySectionHtmlMutation(
                    parentSectionId,
                    (secHtml) => updateHtmlNodeText(secHtml, card.fields.eyebrow!.nodePath, val),
                    'Updated card eyebrow'
                  );
                }}
                className="sog-input"
              />
            </div>
          )}

          {card.fields.title && (
            <div className="md:col-span-6">
              <div className="flex items-center justify-between">
                <label className="sog-label mb-0">Product Title</label>
                <button
                  type="button"
                  onClick={() =>
                    setAiAssistTarget({
                      sectionId: parentSectionId,
                      nodePath: card.fields.title!.nodePath,
                      fieldLabel: 'Product Card Title',
                      currentText: card.fields.title!.value,
                      instruction:
                        'Suggest a clear, compelling editorial product title while keeping the product identity accurate.',
                      loading: false,
                      error: null,
                      proposedText: null,
                      alternatives: [],
                      notes: '',
                    })
                  }
                  className="text-[11px] font-semibold text-[#123E59] hover:underline inline-flex items-center gap-1"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>AI Polish</span>
                </button>
              </div>
              <input
                type="text"
                value={card.fields.title.value}
                onChange={(e) => {
                  const val = e.target.value;
                  applySectionHtmlMutation(
                    parentSectionId,
                    (secHtml) =>
                      updateHtmlNodeText(secHtml, card.fields.title!.nodePath, val, {
                        preserveInnerLink: true,
                      }),
                    'Updated card title'
                  );
                }}
                className="sog-input mt-1"
              />
            </div>
          )}

          {/* Canonical Product URL */}
          <div className="md:col-span-6">
            <label className="sog-label">
              Product Link URL (`href` &amp; `data-product-url`)
            </label>
            <input
              type="text"
              value={card.fields.productUrl.value}
              onChange={(e) => {
                const val = e.target.value;
                applySectionHtmlMutation(
                  parentSectionId,
                  (secHtml) =>
                    updateProductCardUrls(
                      secHtml,
                      card.fields.productUrl.hrefNodePaths,
                      card.fields.productUrl.dataUrlNodePaths,
                      val
                    ),
                  'Updated card product URL'
                );
              }}
              className="sog-input font-mono-tabular"
            />
          </div>

          {/* Price */}
          {card.fields.price && (
            <>
              <div className="md:col-span-3">
                <label className="sog-label">Price</label>
                <input
                  type="text"
                  value={card.fields.price.value}
                  onChange={(e) => {
                    const val = e.target.value;
                    applySectionHtmlMutation(
                      parentSectionId,
                      (secHtml) =>
                        updateProductCardPrice(
                          secHtml,
                          card.fields.price!.nodePath,
                          val,
                          card.fields.price!.noteValue
                        ),
                      'Updated card price'
                    );
                  }}
                  className="sog-input font-mono-tabular"
                />
              </div>
              {card.fields.price.noteNodePath && (
                <div className="md:col-span-3">
                  <label className="sog-label">Price Note / Sizing</label>
                  <input
                    type="text"
                    value={card.fields.price.noteValue || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      applySectionHtmlMutation(
                        parentSectionId,
                        (secHtml) =>
                          updateProductCardPrice(
                            secHtml,
                            card.fields.price!.nodePath,
                            card.fields.price!.value,
                            val
                          ),
                        'Updated card price note'
                      );
                    }}
                    className="sog-input"
                  />
                </div>
              )}
            </>
          )}

          {/* CTA Button Label */}
          {card.fields.cta && (
            <div className="md:col-span-6">
              <label className="sog-label">CTA Button Label</label>
              <input
                type="text"
                value={card.fields.cta.label}
                onChange={(e) => {
                  const val = e.target.value;
                  applySectionHtmlMutation(
                    parentSectionId,
                    (secHtml) => updateHtmlNodeText(secHtml, card.fields.cta!.nodePath, val),
                    'Updated card CTA label'
                  );
                }}
                className="sog-input"
              />
            </div>
          )}

          {/* Image attributes */}
          {card.fields.image && (
            <>
              <div className="md:col-span-6">
                <label className="sog-label">
                  Image `src` (Blank if using `data-product-url` auto-image)
                </label>
                <input
                  type="text"
                  value={card.fields.image.src}
                  onChange={(e) => {
                    const val = e.target.value;
                    applySectionHtmlMutation(
                      parentSectionId,
                      (secHtml) =>
                        updateElementAttributes(secHtml, card.fields.image!.nodePath, {
                          src: val,
                        }),
                      'Updated card image src'
                    );
                  }}
                  placeholder="Leave blank for Fourthwall auto-image or paste URL"
                  className="sog-input font-mono-tabular"
                />
              </div>
              <div className="md:col-span-6">
                <label className="sog-label">Image `alt` Text</label>
                <input
                  type="text"
                  value={card.fields.image.alt}
                  onChange={(e) => {
                    const val = e.target.value;
                    applySectionHtmlMutation(
                      parentSectionId,
                      (secHtml) =>
                        updateElementAttributes(secHtml, card.fields.image!.nodePath, {
                          alt: val,
                        }),
                      'Updated card image alt'
                    );
                  }}
                  className="sog-input"
                />
              </div>
            </>
          )}

          {/* Dek */}
          {card.fields.dek && (
            <div className="md:col-span-12">
              <div className="flex items-center justify-between">
                <label className="sog-label mb-0">Subheadline / Dek</label>
                <button
                  type="button"
                  onClick={() =>
                    setAiAssistTarget({
                      sectionId: parentSectionId,
                      nodePath: card.fields.dek!.nodePath,
                      fieldLabel: 'Card Dek / Subheadline',
                      currentText: card.fields.dek!.value,
                      instruction:
                        'Tighten this 1-sentence dek while keeping all product facts accurate.',
                      loading: false,
                      error: null,
                      proposedText: null,
                      alternatives: [],
                      notes: '',
                    })
                  }
                  className="text-[11px] font-semibold text-[#123E59] hover:underline inline-flex items-center gap-1"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>AI Rewrite Dek</span>
                </button>
              </div>
              <input
                type="text"
                value={card.fields.dek.value}
                onChange={(e) => {
                  const val = e.target.value;
                  applySectionHtmlMutation(
                    parentSectionId,
                    (secHtml) => updateHtmlNodeText(secHtml, card.fields.dek!.nodePath, val),
                    'Updated card dek'
                  );
                }}
                className="sog-input mt-1"
              />
            </div>
          )}

          {/* Description / Editorial Copy */}
          {card.fields.description && (
            <div className="md:col-span-12">
              <div className="flex items-center justify-between">
                <label className="sog-label mb-0">
                  {card.fields.description.isParagraphContainer
                    ? 'Editorial Copy (Paragraphs separated by blank line)'
                    : 'Product Description'}
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setAiAssistTarget({
                      sectionId: parentSectionId,
                      nodePath: card.fields.description!.nodePath,
                      fieldLabel: 'Product Description / Editorial Copy',
                      currentText: card.fields.description!.value,
                      asParagraphs: card.fields.description!.isParagraphContainer,
                      instruction:
                        'Improve the editorial flow and sharpness of this product description without inventing any specs or prices.',
                      loading: false,
                      error: null,
                      proposedText: null,
                      alternatives: [],
                      notes: '',
                    })
                  }
                  className="text-[11px] font-semibold text-[#123E59] hover:underline inline-flex items-center gap-1"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>AI Improve Description</span>
                </button>
              </div>
              <textarea
                rows={card.fields.description.isParagraphContainer ? 5 : 2}
                value={card.fields.description.value}
                onChange={(e) => {
                  const val = e.target.value;
                  applySectionHtmlMutation(
                    parentSectionId,
                    (secHtml) =>
                      updateHtmlNodeText(secHtml, card.fields.description!.nodePath, val, {
                        asParagraphs: card.fields.description!.isParagraphContainer,
                      }),
                    'Updated card description'
                  );
                }}
                className="sog-input mt-1 leading-relaxed"
              />
            </div>
          )}

          {/* Specs Callout */}
          {card.fields.specsCallout && (
            <div className="md:col-span-6">
              <label className="sog-label">Specifications Callout</label>
              <textarea
                rows={2}
                value={card.fields.specsCallout.value}
                onChange={(e) => {
                  const val = e.target.value;
                  applySectionHtmlMutation(
                    parentSectionId,
                    (secHtml) =>
                      updateHtmlNodeText(secHtml, card.fields.specsCallout!.nodePath, val, {
                        asParagraphs: card.fields.specsCallout!.isParagraphContainer,
                      }),
                    'Updated card specs'
                  );
                }}
                className="sog-input"
              />
            </div>
          )}

          {/* Tags Footer */}
          {card.fields.tagsText && (
            <div className="md:col-span-6">
              <label className="sog-label">Best-For / Footer Tags</label>
              <input
                type="text"
                value={card.fields.tagsText.value}
                onChange={(e) => {
                  const val = e.target.value;
                  applySectionHtmlMutation(
                    parentSectionId,
                    (secHtml) => updateHtmlNodeText(secHtml, card.fields.tagsText!.nodePath, val),
                    'Updated card tags'
                  );
                }}
                className="sog-input"
              />
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#FBF9F5]">
      {/* PERSISTENT PROJECT BAR: Project Name | Save Status | New / Save / Open Project | Base URL */}
      <div className="bg-[#EFECE2] border-b border-[#D5CFC0] px-5 py-2 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <span className="text-[10px] uppercase tracking-wider font-bold text-[#1A567B] shrink-0">
            Active Project
          </span>
          <input
            type="text"
            aria-label="Project Name"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="Project name (e.g. History Gifts Guide)..."
            className="px-2.5 py-1 bg-white border border-[#C8C0B0] rounded-md font-editorial font-semibold text-sm text-[#111A27] focus:outline-none focus:border-[#1A567B] w-60 sm:w-72"
          />

          {/* Visible Save State Indicator: Saving… | Saved | Unsaved changes | Actionable Error */}
          {saveStatus === 'saving' && (
            <span
              role="status"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#DFEEF5] text-[#123E59] border border-[#94C0D6] font-semibold"
            >
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>Saving…</span>
            </span>
          )}

          {saveStatus === 'saved' && !isProjectDirty && (
            <span
              role="status"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#E1F2EA] text-[#134634] border border-[#96CDB0] font-semibold"
              title={`Last saved at ${new Date(lastSavedAt).toLocaleString()}`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>
                Saved ·{' '}
                {new Date(lastSavedAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </span>
          )}

          {saveStatus !== 'saving' && saveStatus !== 'error' && isProjectDirty && (
            <span
              role="status"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-50 text-amber-900 border border-amber-300 font-semibold"
            >
              <span className="w-2 h-2 rounded-full bg-amber-600" />
              <span>Unsaved changes</span>
            </span>
          )}

          {saveStatus === 'error' && (
            <div
              role="alert"
              className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-red-50 text-red-900 border border-red-300 font-semibold"
            >
              <AlertCircle className="w-3.5 h-3.5 text-red-700 shrink-0" />
              <span className="truncate max-w-xs" title={saveError || 'Save failed'}>
                Save failed: {saveError || 'Storage error'}
              </span>
              <button
                type="button"
                onClick={() => void performSaveActiveProject({ showToastOnSuccess: true })}
                className="px-2 py-0.5 bg-red-700 hover:bg-red-800 text-white rounded text-[11px] font-semibold shrink-0"
              >
                Retry Save
              </button>
            </div>
          )}
        </div>

        {/* Right side of Project Bar: Base URL for relative images + New / Save / Open Project */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="hidden xl:flex items-center gap-1.5 bg-white border border-[#D5CFC0] rounded-md px-2 py-1">
            <Globe className="w-3.5 h-3.5 text-[#5E6B7C] shrink-0" />
            <span className="text-[11px] text-[#5E6B7C] whitespace-nowrap">Base URL:</span>
            <input
              type="text"
              aria-label="Storefront Base URL"
              value={projectBaseUrl}
              onChange={(e) => setProjectBaseUrl(e.target.value)}
              placeholder="https://scienceofgifts.com"
              className="w-44 text-[11px] font-mono-tabular text-[#111A27] focus:outline-none"
              title="Base URL used to resolve relative image src and srcset paths in the Live Preview"
            />
          </div>

          <button
            type="button"
            onClick={() => void performSaveActiveProject({ showToastOnSuccess: true })}
            disabled={saveStatus === 'saving'}
            className="sog-btn-secondary py-1 px-2.5"
            title="Save project now"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save</span>
          </button>

          <button
            type="button"
            onClick={handleRequestNewProject}
            className="sog-btn-secondary py-1 px-2.5"
          >
            <FilePlus2 className="w-3.5 h-3.5" />
            <span>New Project</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setProjects(loadLocalHtmlProjects());
              setRenamingProjectId(null);
              setConfirmDeleteProjectId(null);
              setShowProjectsModal(true);
            }}
            className="sog-btn-powder py-1 px-2.5"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span>Open Project ({projects.length})</span>
          </button>
        </div>
      </div>

      {/* TOP WORKSPACE TOOLBAR: Differentiated Add HTML Section vs Replace Project HTML */}
      <div className="bg-[#F5F1E7] border-b border-[#D5CFC0] px-5 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* Left: Differentiated Import Actions & Multi-Section Summary */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              if (pasteDrawerMode === 'add_section') {
                setPasteDrawerMode(null);
              } else {
                setPasteBuffer('');
                setNewSectionNameInput('');
                setNewSectionTypeInput('AUTO');
                setConfirmReplaceProjectStep(false);
                setPasteDrawerMode('add_section');
              }
            }}
            className="sog-btn-primary"
            title="Append a new HTML section to the current project without replacing existing sections"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{pasteDrawerMode === 'add_section' ? 'Close Add Section' : 'Add HTML Section'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (pasteDrawerMode === 'replace_project') {
                setPasteDrawerMode(null);
              } else {
                setPasteBuffer('');
                setConfirmReplaceProjectStep(false);
                setPasteDrawerMode('replace_project');
              }
            }}
            className="sog-btn-secondary"
            title="Replace all HTML sections in the current project with a newly pasted document"
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>
              {pasteDrawerMode === 'replace_project'
                ? 'Close Replace HTML'
                : 'Replace Project HTML'}
            </span>
          </button>

          <div className="flex items-center gap-2 text-[#334155]">
            <span className="font-mono-tabular font-semibold text-[#111A27]">
              {sections.length} section(s)
            </span>
            <span>·</span>
            <span className="font-mono-tabular">
              {analysis.stats.productCardCount} product card(s) ({analysis.stats.matchedCatalogCount}{' '}
              matched)
            </span>
            <span>·</span>
            <button
              type="button"
              onClick={() => {
                setExportCopyFeedback(null);
                setExportModalTarget({ mode: 'complete_project' });
              }}
              className={`font-mono-tabular px-2 py-0.5 rounded border text-[11px] font-semibold inline-flex items-center gap-1 ${
                completeProjectExportStatus.exceedsFourthwallLimit
                  ? 'bg-red-50 text-red-900 border-red-300'
                  : completeProjectExportStatus.approachingFourthwallLimit
                  ? 'bg-amber-50 text-amber-900 border-amber-300'
                  : 'bg-white text-[#334155] border-[#D5CFC0]'
              }`}
              title="Click to inspect character count and export options for Fourthwall (30,000 char limit per block)"
            >
              <span>
                {completeProjectExportStatus.characterCount.toLocaleString()} /{' '}
                {FOURTHWALL_CHAR_LIMIT.toLocaleString()} chars
              </span>
              {completeProjectExportStatus.exceedsFourthwallLimit && (
                <AlertTriangle className="w-3 h-3 text-red-700" />
              )}
            </button>
            {analysis.validationIssues.length > 0 && (
              <>
                <span>·</span>
                <button
                  type="button"
                  onClick={() => setSidebarTab('anchors')}
                  className="inline-flex items-center gap-1 text-amber-800 font-semibold hover:underline"
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>{analysis.validationIssues.length} notice(s)</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Center: View Mode Selector */}
        <div className="flex items-center gap-1 p-1 bg-[#E5DEC9] rounded-lg">
          <button
            type="button"
            onClick={() => handleSwitchViewMode('split')}
            className={`px-2.5 py-1 rounded-md font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
              viewMode === 'split'
                ? 'bg-[#111A27] text-white'
                : 'text-[#334155] hover:text-[#111A27]'
            }`}
          >
            <Columns className="w-3.5 h-3.5" />
            <span>Split (Visual + Preview)</span>
          </button>
          <button
            type="button"
            onClick={() => handleSwitchViewMode('visual')}
            className={`px-2.5 py-1 rounded-md font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
              viewMode === 'visual'
                ? 'bg-[#111A27] text-white'
                : 'text-[#334155] hover:text-[#111A27]'
            }`}
          >
            <span>Visual Editor</span>
          </button>
          <button
            type="button"
            onClick={() => handleSwitchViewMode('raw')}
            className={`px-2.5 py-1 rounded-md font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
              viewMode === 'raw'
                ? 'bg-[#111A27] text-white'
                : 'text-[#334155] hover:text-[#111A27]'
            }`}
          >
            <Code className="w-3.5 h-3.5" />
            <span>Raw HTML{rawBufferDirty ? ' *' : ''}</span>
          </button>
          <button
            type="button"
            onClick={() => handleSwitchViewMode('preview')}
            className={`px-2.5 py-1 rounded-md font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
              viewMode === 'preview'
                ? 'bg-[#111A27] text-white'
                : 'text-[#334155] hover:text-[#111A27]'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Live Preview</span>
          </button>
        </div>

        {/* Right: Preservation Status, Restore, & Export Project */}
        <div className="flex flex-wrap items-center gap-2">
          {hasDiffFromOriginal ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowChangeSummaryModal(true)}
                className="px-2.5 py-1 bg-[#DFEEF5] text-[#123E59] border border-[#94C0D6] rounded-md font-semibold inline-flex items-center gap-1"
              >
                <History className="w-3.5 h-3.5" />
                <span>{changeLog.length} Edit(s)</span>
              </button>

              {confirmRestoreOriginal ? (
                <div className="inline-flex items-center gap-1 bg-red-50 border border-red-200 px-2 py-1 rounded-md">
                  <span className="text-red-900 font-semibold">Restore original?</span>
                  <button
                    type="button"
                    onClick={() => {
                      const restoredProj = replaceProjectHtmlContent(
                        buildCurrentWorkspaceProjectSnapshot(),
                        originalHtml,
                        undefined,
                        products
                      );
                      setConfirmRestoreOriginal(false);
                      commitUpdatedProjectState(
                        restoredProj,
                        'Restored original imported HTML for this project',
                        {
                          persistImmediately: true,
                          toastMessage: 'Restored original imported HTML for this project.',
                        }
                      );
                    }}
                    className="px-2 py-0.5 bg-red-600 text-white rounded font-semibold"
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmRestoreOriginal(false)}
                    className="px-1.5 py-0.5 text-[#5E6B7C]"
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmRestoreOriginal(true)}
                  title="Restore original pasted HTML"
                  className="sog-btn-secondary py-1 px-2.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Restore Original</span>
                </button>
              )}
            </div>
          ) : (
            <span className="text-[#134634] font-medium inline-flex items-center gap-1 px-2">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Original Source Intact</span>
            </span>
          )}

          <button
            type="button"
            onClick={() => {
              setExportCopyFeedback(null);
              setExportModalTarget({ mode: 'complete_project' });
            }}
            className="sog-btn-powder"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>Export Project / Sections</span>
          </button>

          <button
            type="button"
            onClick={() => {
              const exported = rawBufferDirty ? rawEditorBuffer : currentHtml;
              handleDownloadHtmlFile(exported, projectName);
            }}
            className="sog-btn-secondary"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download .html</span>
          </button>

          <button
            type="button"
            onClick={() => {
              const exported = rawBufferDirty ? rawEditorBuffer : currentHtml;
              void handleCopyHtmlWithFallback(exported, 'complete project HTML');
            }}
            className="sog-btn-mint"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Copy Complete HTML</span>
          </button>
        </div>
      </div>

      {/* DRAWER 1: ADD HTML SECTION (Appends without replacing existing sections) */}
      {pasteDrawerMode === 'add_section' && (
        <div className="bg-[#EFF6FA] border-b border-[#94C0D6] p-5 space-y-3 text-xs shadow-inner">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#E1F2EA] text-[#134634] font-bold text-[10px] uppercase tracking-wider mb-1">
                <Plus className="w-3 h-3" />
                <span>Append Mode · Preserves All {sections.length} Existing Section(s)</span>
              </div>
              <h2 className="text-base font-editorial font-semibold text-[#111A27]">
                Add HTML Section to &ldquo;{projectName}&rdquo;
              </h2>
              <p className="text-[#3E4C5E]">
                Paste a Table of Contents, Quick Picks grid, Featured Product, Category Product
                Grid, Editorial Copy, Buying Guide, or FAQ section. It will be appended to your
                current project without removing any existing sections.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold text-[#123E59] mr-1">
                Quick Add Sample Section:
              </span>
              <button
                type="button"
                onClick={() => handleLoadSamplePreset('toc')}
                className="sog-btn-secondary py-1 px-2.5"
              >
                + Table of Contents
              </button>
              <button
                type="button"
                onClick={() => handleLoadSamplePreset('quick_picks')}
                className="sog-btn-secondary py-1 px-2.5"
              >
                + Quick Picks
              </button>
              <button
                type="button"
                onClick={() => handleLoadSamplePreset('editors_pick')}
                className="sog-btn-secondary py-1 px-2.5"
              >
                + #1 Featured Pick
              </button>
              <button
                type="button"
                onClick={() => handleLoadSamplePreset('editorial_list')}
                className="sog-btn-secondary py-1 px-2.5"
              >
                + Numbered Product Section
              </button>
              <button
                type="button"
                onClick={() => handleLoadSamplePreset('buying_guide_faq')}
                className="sog-btn-secondary py-1 px-2.5"
              >
                + Buying Guide &amp; FAQs
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="sog-label">
                Section Name (Optional — auto-detected from heading if left blank)
              </label>
              <input
                type="text"
                aria-label="New Section Name"
                value={newSectionNameInput}
                onChange={(e) => setNewSectionNameInput(e.target.value)}
                placeholder="e.g. Table of Contents, Part 1: T-Shirts, Drinkware Grid, FAQs..."
                className="sog-input bg-white"
              />
            </div>
            <div>
              <label className="sog-label">Section Type Classification</label>
              <select
                aria-label="New Section Type"
                value={newSectionTypeInput}
                onChange={(e) =>
                  setNewSectionTypeInput(e.target.value as HtmlSectionCategory | 'AUTO')
                }
                className="sog-input bg-white"
              >
                <option value="AUTO">Auto-Detect from HTML Structure (Recommended)</option>
                {SELECTABLE_SECTION_TYPES.map((st) => (
                  <option key={st.value} value={st.value}>
                    {st.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <textarea
            rows={7}
            aria-label="HTML Section Fragment to Add"
            value={pasteBuffer}
            onChange={(e) => setPasteBuffer(e.target.value)}
            placeholder="Paste your HTML section fragment here (e.g. <div class='sog-toc'>...</div>, <div class='sog-quick-picks'>...</div>, or <div class='sog-editorial-list'>...</div>)..."
            className="w-full p-3.5 bg-[#111926] text-[#E6EEF8] rounded-xl font-mono-tabular text-xs leading-relaxed focus:outline-none border border-[#2C3E58]"
          />

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setPasteDrawerMode(null)}
              className="sog-btn-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => handleAddHtmlSection(pasteBuffer)}
              className="sog-btn-primary"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Section to Project</span>
            </button>
          </div>
        </div>
      )}

      {/* DRAWER 2: REPLACE PROJECT HTML (Explicit warning + confirmation before replacing) */}
      {pasteDrawerMode === 'replace_project' && (
        <div className="bg-amber-50/90 border-b border-amber-300 p-5 space-y-3 text-xs shadow-inner">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-red-100 text-red-900 font-bold text-[10px] uppercase tracking-wider">
                <AlertTriangle className="w-3.5 h-3.5 text-red-700" />
                <span>Overwrite Warning · Replaces All {sections.length} Existing Section(s)</span>
              </div>
              <h2 className="text-base font-editorial font-semibold text-[#111A27]">
                Replace Entire Project HTML in &ldquo;{projectName}&rdquo;
              </h2>
              <p className="text-[#3E4C5E]">
                This action will replace all {sections.length} existing section(s) in your current
                project with the HTML pasted below. If you want to keep your existing sections and
                add another section, switch to{' '}
                <button
                  type="button"
                  onClick={() => setPasteDrawerMode('add_section')}
                  className="font-semibold text-[#1A567B] underline"
                >
                  Add HTML Section
                </button>{' '}
                instead.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleLoadSamplePreset('full_guide')}
                className="sog-btn-secondary py-1 px-2.5"
              >
                Load Full Greek Mythology Guide Sample
              </button>
              {savedGuides.length > 0 && onLoadSavedGuideHtml && (
                <select
                  defaultValue=""
                  onChange={async (e) => {
                    const gId = e.target.value;
                    if (!gId) return;
                    const loadedHtml = await onLoadSavedGuideHtml(gId);
                    if (loadedHtml) {
                      setPasteBuffer(loadedHtml);
                    }
                  }}
                  className="px-2.5 py-1 bg-white border border-amber-400 rounded-md text-[#111A27] font-semibold"
                >
                  <option value="">Load from Saved Cloud Guide...</option>
                  {savedGuides.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <textarea
            rows={7}
            aria-label="Replacement Project HTML"
            value={pasteBuffer}
            onChange={(e) => {
              setPasteBuffer(e.target.value);
              setConfirmReplaceProjectStep(false);
            }}
            placeholder="Paste the complete replacement HTML document or fragment here..."
            className="w-full p-3.5 bg-[#111926] text-[#E6EEF8] rounded-xl font-mono-tabular text-xs leading-relaxed focus:outline-none border border-[#2C3E58]"
          />

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setPasteDrawerMode(null);
                setConfirmReplaceProjectStep(false);
              }}
              className="sog-btn-secondary"
            >
              Cancel
            </button>

            {!confirmReplaceProjectStep ? (
              <button
                type="button"
                onClick={() => {
                  if (!pasteBuffer.trim()) {
                    onShowToast?.('Please paste HTML content before replacing.');
                    return;
                  }
                  setConfirmReplaceProjectStep(true);
                }}
                className="px-3 py-1.5 bg-amber-700 hover:bg-amber-800 text-white rounded-lg font-semibold inline-flex items-center gap-1.5"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Replace Project HTML...</span>
              </button>
            ) : (
              <div className="inline-flex items-center gap-2 bg-red-50 border border-red-300 px-3 py-1.5 rounded-lg">
                <span className="text-red-900 font-semibold">
                  Confirm replacing all {sections.length} existing section(s) in &ldquo;{projectName}
                  &rdquo;?
                </span>
                <button
                  type="button"
                  onClick={() =>
                    handleConfirmReplaceProjectHtml(pasteBuffer, 'Replacement Project HTML')
                  }
                  className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white rounded font-semibold"
                >
                  Confirm &amp; Replace All
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReplaceProjectStep(false)}
                  className="px-2 py-1 text-[#5E6B7C] hover:text-[#111A27]"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MAIN 3-COLUMN WORKSPACE BODY */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* LEFT SIDEBAR: MULTI-SECTION STRUCTURE NAVIGATOR & ANCHOR ID INSPECTOR */}
        {viewMode !== 'preview' && viewMode !== 'raw' && (
          <aside className="w-76 bg-[#F2EDE2] border-r border-[#D5CFC0] flex flex-col shrink-0 select-none">
            <div className="p-3 border-b border-[#D5CFC0] flex items-center gap-1 bg-[#EAE3D5]">
              <button
                type="button"
                onClick={() => setSidebarTab('blocks')}
                className={`flex-1 py-1.5 px-2 rounded-md text-xs font-semibold transition-colors ${
                  sidebarTab === 'blocks'
                    ? 'bg-[#DFEEF5] text-[#111A27] shadow-2xs'
                    : 'text-[#334155] hover:text-[#111A27]'
                }`}
              >
                Sections ({analysis.blocks.length})
              </button>
              <button
                type="button"
                onClick={() => setSidebarTab('anchors')}
                className={`flex-1 py-1.5 px-2 rounded-md text-xs font-semibold transition-colors flex items-center justify-center gap-1 ${
                  sidebarTab === 'anchors'
                    ? 'bg-[#DFEEF5] text-[#111A27] shadow-2xs'
                    : 'text-[#334155] hover:text-[#111A27]'
                }`}
              >
                <Hash className="w-3 h-3" />
                <span>IDs &amp; Links ({analysis.allElementIds.length})</span>
              </button>
            </div>

            {sidebarTab === 'blocks' ? (
              <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5 text-xs">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSelectedBlockId('ALL')}
                    className={`flex-1 text-left px-3 py-2 rounded-lg border transition-colors flex items-center justify-between ${
                      selectedBlockId === 'ALL'
                        ? 'bg-[#DFEEF5] border-[#82B3CC] text-[#111A27] font-semibold'
                        : 'bg-white/70 border-[#DED8CA] text-[#334155] hover:bg-white'
                    }`}
                  >
                    <span>All Project Sections</span>
                    <span className="font-mono-tabular text-[11px]">{analysis.blocks.length}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPasteBuffer('');
                      setNewSectionNameInput('');
                      setNewSectionTypeInput('AUTO');
                      setPasteDrawerMode('add_section');
                    }}
                    title="Add a new HTML section to this project"
                    className="px-2.5 py-2 bg-[#111A27] hover:bg-[#1E2E46] text-white rounded-lg font-semibold inline-flex items-center gap-1 shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add</span>
                  </button>
                </div>

                {analysis.blocks.map((block, idx) => {
                  const isActive = selectedBlockId === block.id;
                  const secRecord = sectionMapById.get(block.id);
                  const secChars = secRecord?.htmlContent.length || block.rawHtmlSnippet.length;
                  const typeLabel =
                    HUMAN_SECTION_TYPE_LABELS[block.blockType] ||
                    block.blockType.replace(/_/g, ' ');

                  return (
                    <div
                      key={block.id}
                      className={` rounded-lg border transition-all relative overflow-hidden ${
                        isActive
                          ? 'bg-[#DFEEF5] border-[#82B3CC] text-[#111A27] shadow-2xs'
                          : 'bg-white/80 border-[#DED8CA] text-[#334155] hover:bg-white'
                      }`}
                    >
                      {isActive && (
                        <span className="absolute left-0 top-0 bottom-0 w-1.5 bg-[#1A567B]" />
                      )}
                      <div className="p-2.5 pl-3 space-y-1.5">
                        <div className="flex items-center justify-between gap-1">
                          <button
                            type="button"
                            onClick={() => setSelectedBlockId(block.id)}
                            className="text-left flex-1 min-w-0"
                          >
                            <div className="flex items-center justify-between gap-1 text-[10px] uppercase tracking-wider text-[#5E6B7C] font-semibold">
                              <span className="truncate">
                                {String(idx + 1).padStart(2, '0')} · {typeLabel}
                              </span>
                            </div>
                            <p className="font-editorial font-semibold text-xs text-[#111A27] line-clamp-2 leading-snug mt-0.5">
                              {secRecord?.name || block.label}
                            </p>
                          </button>
                        </div>

                        <div className="flex items-center justify-between gap-1 pt-1 border-t border-[#DED8CA]/70 text-[10px] text-[#5E6B7C]">
                          <span className="font-mono-tabular">
                            {secChars.toLocaleString()} chars
                          </span>
                          <div className="flex items-center gap-0.5">
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => handleMoveSection(block.id, 'up')}
                              title="Move section up"
                              className="p-1 hover:text-[#111A27] disabled:opacity-30"
                            >
                              <ArrowUp className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              disabled={idx === analysis.blocks.length - 1}
                              onClick={() => handleMoveSection(block.id, 'down')}
                              title="Move section down"
                              className="p-1 hover:text-[#111A27] disabled:opacity-30"
                            >
                              <ArrowDown className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setExportCopyFeedback(null);
                                setExportModalTarget({
                                  mode: 'section',
                                  sectionId: block.id,
                                });
                              }}
                              title="Export this section's HTML"
                              className="p-1 hover:text-[#1A567B]"
                            >
                              <Share2 className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedBlockId(block.id);
                                setConfirmDeleteSectionId(block.id);
                              }}
                              title="Delete this section"
                              className="p-1 hover:text-red-600"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-3 space-y-4 text-xs">
                {/* Validation Issues List */}
                {analysis.validationIssues.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="sog-label">Validation Diagnostics</span>
                    {analysis.validationIssues.map((iss, i) => (
                      <div
                        key={i}
                        className={`p-2.5 rounded-lg border text-[11px] ${
                          iss.severity === 'error'
                            ? 'bg-red-50 border-red-200 text-red-900'
                            : 'bg-amber-50 border-amber-200 text-amber-950'
                        }`}
                      >
                        <p className="font-semibold">{iss.code}</p>
                        <p className="mt-0.5 leading-snug">{iss.message}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Element IDs with Rename + Auto-Update Anchor References across all sections */}
                <div className="space-y-2">
                  <span className="sog-label">
                    Element IDs (Renaming auto-updates matching #jump links across all sections)
                  </span>
                  {analysis.allElementIds.length === 0 ? (
                    <p className="text-[#5E6B7C] text-[11px]">
                      No element IDs detected in this project.
                    </p>
                  ) : (
                    analysis.allElementIds.map((entry) => (
                      <div
                        key={entry.nodePath}
                        className="p-2 bg-white border border-[#DED8CA] rounded-lg space-y-1"
                      >
                        <div className="flex items-center justify-between text-[10px] text-[#5E6B7C]">
                          <span>&lt;{entry.tagName}&gt;</span>
                          <span className="font-mono-tabular truncate max-w-[140px]">
                            {entry.nodePath}
                          </span>
                        </div>
                        <input
                          type="text"
                          value={entry.id}
                          onChange={(e) => {
                            const newIdVal = e.target.value.trim().replace(/^#/, '');
                            if (!newIdVal) return;
                            const oldIdVal = entry.id;
                            const [targetSecId, localPath] = entry.nodePath.includes('::')
                              ? entry.nodePath.split('::')
                              : [sections[0]?.id || '', entry.nodePath];

                            const nextSections = sections.map((sec) => {
                              if (sec.id === targetSecId) {
                                const res = updateElementIdAndReferences(
                                  sec.htmlContent,
                                  localPath,
                                  newIdVal,
                                  true
                                );
                                return { ...sec, htmlContent: res.html };
                              }
                              // Also sync any anchor links `<a href="#oldId">` in other sections (such as TOC)
                              const escapedOld = oldIdVal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                              const hrefRegex = new RegExp(
                                `(href\\s*=\\s*["'])#${escapedOld}(["'])`,
                                'gi'
                              );
                              const updatedOtherHtml = sec.htmlContent.replace(
                                hrefRegex,
                                `$1#${newIdVal}$2`
                              );
                              return { ...sec, htmlContent: updatedOtherHtml };
                            });

                            const snapshot = buildCurrentWorkspaceProjectSnapshot();
                            commitUpdatedProjectState(
                              {
                                ...snapshot,
                                sections: nextSections,
                                currentHtml: joinProjectSectionsHtml(nextSections),
                              },
                              `Renamed ID #${oldIdVal} → #${newIdVal} across project sections`
                            );
                          }}
                          className="sog-input py-1 text-xs font-mono-tabular"
                        />
                      </div>
                    ))
                  )}
                </div>

                {/* Internal Anchor Links */}
                <div className="space-y-1.5">
                  <span className="sog-label">
                    Internal Anchor Links ({analysis.allInternalAnchorLinks.length})
                  </span>
                  {analysis.allInternalAnchorLinks.map((lnk) => {
                    const targetExists = analysis.allElementIds.some(
                      (e) => `#${e.id}` === lnk.href
                    );
                    return (
                      <div
                        key={lnk.nodePath}
                        className="p-2 bg-white border border-[#DED8CA] rounded-lg space-y-1"
                      >
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-medium text-[#111A27] truncate">
                            {lnk.label || 'Anchor Link'}
                          </span>
                          <span
                            className={`text-[10px] font-semibold ${
                              targetExists ? 'text-[#134634]' : 'text-amber-700'
                            }`}
                          >
                            {targetExists ? 'Target Found' : 'External / Missing'}
                          </span>
                        </div>
                        <input
                          type="text"
                          value={lnk.href}
                          onChange={(e) => {
                            const newHref = e.target.value;
                            const [targetSecId, localPath] = lnk.nodePath.includes('::')
                              ? lnk.nodePath.split('::')
                              : [sections[0]?.id || '', lnk.nodePath];
                            applySectionHtmlMutation(
                              targetSecId,
                              (secHtml) =>
                                updateElementAttributes(secHtml, localPath, {
                                  href: newHref,
                                }),
                              `Updated internal link href to "${newHref}"`
                            );
                          }}
                          className="sog-input py-1 text-xs font-mono-tabular"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </aside>
        )}

        {/* CENTER WORKSPACE: VISUAL EDITOR OR RAW HTML CODE EDITOR */}
        {(viewMode === 'split' || viewMode === 'visual') && (
          <main className="flex-1 overflow-y-auto p-6 space-y-6 min-w-0">
            {selectedBlockId !== 'ALL' && (
              <div className="bg-[#EFECE2] border border-[#D5CFC0] rounded-lg px-4 py-2 flex items-center justify-between text-xs">
                <span className="font-medium text-[#111A27]">
                  Editing single section view ({visibleBlocks[0]?.label || selectedBlockId})
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedBlockId('ALL')}
                  className="sog-btn-secondary py-1 px-2.5"
                >
                  Show All {analysis.blocks.length} Sections
                </button>
              </div>
            )}

            {visibleBlocks.length === 0 ? (
              <div className="bg-white border border-[#DED8CA] rounded-xl p-12 text-center space-y-3">
                <Layers className="w-8 h-8 text-[#1A567B] mx-auto" />
                <h2 className="text-lg font-editorial font-semibold text-[#111A27]">
                  No HTML sections in this project yet
                </h2>
                <p className="text-xs text-[#3E4C5E] max-w-md mx-auto">
                  Click <strong>Add HTML Section</strong> in the top toolbar to paste a Table of
                  Contents, Quick Picks grid, Featured Product, Product Grid, or FAQ section.
                </p>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => setPasteDrawerMode('add_section')}
                    className="sog-btn-primary"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add First HTML Section</span>
                  </button>
                </div>
              </div>
            ) : (
              visibleBlocks.map((block) => {
                const sectionRecord = sectionMapById.get(block.id);
                const sectionOrderIdx = sectionRecord?.order ?? 0;
                const sectionName = sectionRecord?.name || block.label;
                const sectionExportEval = evaluateHtmlExportSize(
                  sectionRecord?.htmlContent || block.rawHtmlSnippet
                );
                const isRenamingThisSection = renamingSectionId === block.id;
                const isConfirmingDeleteThisSection = confirmDeleteSectionId === block.id;

                // Product numbering eligibility: ONLY show on genuine numbered product sections
                const isNumberedProductSection = Boolean(
                  block.numberingInfo?.isNumberedProductSection
                );
                const sectionKey = getBlockNumberingKey(block);
                const sectionStartNum = resolvedSectionStartingNumbers[sectionKey] ?? 1;
                const draftVal = startingNumberInputDrafts[sectionKey];
                const displayedStartInputVal =
                  draftVal !== undefined ? draftVal : String(sectionStartNum);
                const sectionEndNum =
                  block.productCards.length > 0
                    ? sectionStartNum + block.productCards.length - 1
                    : sectionStartNum;

                return (
                  <section
                    key={block.id}
                    aria-label={`Section ${sectionName}`}
                    className="bg-white border border-[#D5CFC0] rounded-xl overflow-hidden shadow-2xs"
                  >
                    {/* SECTION HEADER BAR WITH FULL MANAGEMENT CONTROLS */}
                    <div className="bg-[#162235] text-white px-4 py-3 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        {/* Left: Section Order, Type Selector, & Section Name / Inline Rename */}
                        <div className="flex flex-wrap items-center gap-2 min-w-0 flex-1">
                          <span className="px-2 py-0.5 bg-[#24344D] text-[#94C0D6] text-[10px] font-mono-tabular font-bold uppercase tracking-wider rounded shrink-0">
                            Sec {String(sectionOrderIdx + 1).padStart(2, '0')}/{sections.length}
                          </span>

                          {/* Manual Section Type Selector (allows correcting uncertain classification) */}
                          <select
                            aria-label={`Section Type for ${sectionName}`}
                            value={block.blockType}
                            onChange={(e) =>
                              handleChangeSectionType(
                                block.id,
                                e.target.value as HtmlSectionCategory
                              )
                            }
                            title="Section Type (Change if automatic classification needs adjustment)"
                            className="px-2 py-0.5 bg-[#DFEEF5] text-[#111A27] text-[11px] font-bold rounded border border-[#94C0D6] focus:outline-none cursor-pointer"
                          >
                            {SELECTABLE_SECTION_TYPES.map((st) => (
                              <option key={st.value} value={st.value}>
                                {st.label}
                              </option>
                            ))}
                          </select>

                          {isRenamingThisSection ? (
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                handleConfirmRenameSection(block.id, renamingSectionNameDraft);
                              }}
                              className="inline-flex items-center gap-1.5 flex-1 min-w-[200px]"
                            >
                              <input
                                type="text"
                                aria-label="Edit Section Name"
                                value={renamingSectionNameDraft}
                                onChange={(e) => setRenamingSectionNameDraft(e.target.value)}
                                className="px-2 py-0.5 bg-white text-[#111A27] rounded text-xs font-semibold flex-1 max-w-xs focus:outline-none"
                                autoFocus
                              />
                              <button
                                type="submit"
                                className="px-2 py-0.5 bg-[#E1F2EA] text-[#134634] rounded text-[11px] font-semibold"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setRenamingSectionId(null);
                                  setRenamingSectionNameDraft('');
                                }}
                                className="px-2 py-0.5 bg-[#24344D] text-[#C6D3E3] rounded text-[11px]"
                              >
                                Cancel
                              </button>
                            </form>
                          ) : (
                            <div className="flex items-center gap-2 min-w-0">
                              <h2 className="text-sm font-editorial font-semibold truncate">
                                {sectionName}
                              </h2>
                              {block.elementId && (
                                <code className="text-[11px] font-mono-tabular text-[#94C0D6] shrink-0">
                                  id=&quot;{block.elementId}&quot;
                                </code>
                              )}
                              <span
                                className={`text-[11px] font-mono-tabular px-1.5 py-0.5 rounded shrink-0 ${
                                  sectionExportEval.exceedsFourthwallLimit
                                    ? 'bg-red-600 text-white font-bold'
                                    : sectionExportEval.approachingFourthwallLimit
                                    ? 'bg-amber-500 text-[#111A27] font-semibold'
                                    : 'bg-[#1E2E46] text-[#94C0D6]'
                                }`}
                                title={`Section HTML size: ${sectionExportEval.characterCount.toLocaleString()} characters (Fourthwall limit: 30,000 chars)`}
                              >
                                {sectionExportEval.characterCount.toLocaleString()} chars
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Right: Section Management Controls (Edit, Rename, Move Up, Move Down, Export Section, Delete Section) */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedBlockId(selectedBlockId === block.id ? 'ALL' : block.id)
                            }
                            className="px-2 py-1 bg-[#24344D] hover:bg-[#314666] text-[#DFEEF5] rounded text-[11px] font-semibold inline-flex items-center gap-1 transition-colors"
                            title={
                              selectedBlockId === block.id
                                ? 'Show all sections'
                                : 'Focus editor on this section'
                            }
                          >
                            <span>{selectedBlockId === block.id ? 'All Sections' : 'Edit'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setRenamingSectionId(block.id);
                              setRenamingSectionNameDraft(sectionName);
                            }}
                            className="px-2 py-1 bg-[#24344D] hover:bg-[#314666] text-[#DFEEF5] rounded text-[11px] font-semibold inline-flex items-center gap-1 transition-colors"
                            title="Rename section"
                          >
                            <Pencil className="w-3 h-3" />
                            <span>Rename</span>
                          </button>

                          <button
                            type="button"
                            disabled={sectionOrderIdx === 0}
                            onClick={() => handleMoveSection(block.id, 'up')}
                            aria-label={`Move ${sectionName} up`}
                            title="Move section up"
                            className="px-2 py-1 bg-[#24344D] hover:bg-[#314666] text-[#DFEEF5] rounded text-[11px] font-semibold inline-flex items-center gap-0.5 disabled:opacity-35 transition-colors"
                          >
                            <ArrowUp className="w-3 h-3" />
                            <span>Move Up</span>
                          </button>

                          <button
                            type="button"
                            disabled={sectionOrderIdx === sections.length - 1}
                            onClick={() => handleMoveSection(block.id, 'down')}
                            aria-label={`Move ${sectionName} down`}
                            title="Move section down"
                            className="px-2 py-1 bg-[#24344D] hover:bg-[#314666] text-[#DFEEF5] rounded text-[11px] font-semibold inline-flex items-center gap-0.5 disabled:opacity-35 transition-colors"
                          >
                            <ArrowDown className="w-3 h-3" />
                            <span>Move Down</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setExportCopyFeedback(null);
                              setExportModalTarget({
                                mode: 'section',
                                sectionId: block.id,
                              });
                            }}
                            className="px-2.5 py-1 bg-[#DFEEF5] hover:bg-[#CBE3EE] text-[#111A27] rounded text-[11px] font-semibold inline-flex items-center gap-1 transition-colors"
                            title="Export or copy only this section's HTML for Fourthwall"
                          >
                            <Share2 className="w-3 h-3" />
                            <span>Export Section</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setConfirmDeleteSectionId(block.id)}
                            className="px-2 py-1 bg-[#24344D] hover:bg-red-700 text-[#DFEEF5] hover:text-white rounded text-[11px] font-semibold inline-flex items-center gap-1 transition-colors"
                            title="Delete only this section from the project"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Delete Section</span>
                          </button>
                        </div>
                      </div>

                      {/* Inline Confirmation Prompt before Deleting Section */}
                      {isConfirmingDeleteThisSection && (
                        <div
                          role="alert"
                          className="bg-red-950/90 border border-red-400 rounded-lg px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                        >
                          <div className="flex items-center gap-2 text-red-100">
                            <AlertTriangle className="w-4 h-4 text-red-300 shrink-0" />
                            <span>
                              Delete section <strong>&ldquo;{sectionName}&rdquo;</strong>? Only this
                              section will be removed; the remaining {Math.max(0, sections.length - 1)}{' '}
                              section(s) in your project will stay untouched.
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleConfirmDeleteSection(block.id)}
                              className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white rounded font-semibold"
                            >
                              Confirm Delete Section
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteSectionId(null)}
                              className="px-2.5 py-1 bg-[#24344D] text-[#C6D3E3] hover:text-white rounded"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Second Sub-Row (ONLY shown when section has Starting Product Number eligibility or Repeated Group Add actions) */}
                      {(isNumberedProductSection || block.repeatedContainerPath) && (
                        <div className="pt-2 border-t border-[#263854] flex flex-wrap items-center justify-between gap-2.5">
                          {/* Section-Level Starting Product Number: ONLY on eligible numbered product sections */}
                          {isNumberedProductSection ? (
                            <div className="inline-flex items-center gap-2 bg-[#1E2E46] border border-[#354C6E] rounded-md px-2.5 py-1 text-xs">
                              <label
                                htmlFor={`start-prod-num-${block.id}`}
                                className="text-[11px] font-semibold text-[#DFEEF5] whitespace-nowrap"
                              >
                                Starting Product Number
                              </label>
                              <input
                                id={`start-prod-num-${block.id}`}
                                type="number"
                                min={1}
                                step={1}
                                inputMode="numeric"
                                aria-label={`Starting Product Number for ${sectionName}`}
                                value={displayedStartInputVal}
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  if (raw === '') {
                                    setStartingNumberInputDrafts((prev) => ({
                                      ...prev,
                                      [sectionKey]: '',
                                    }));
                                    return;
                                  }
                                  if (!/^[1-9]\d*$/.test(raw.trim())) {
                                    return;
                                  }
                                  const parsed = Number(raw.trim());
                                  if (Number.isInteger(parsed) && parsed >= 1) {
                                    handleUpdateSectionStartingNumber(block, parsed);
                                  }
                                }}
                                onBlur={() => {
                                  if (startingNumberInputDrafts[sectionKey] !== undefined) {
                                    setStartingNumberInputDrafts((prev) => {
                                      const next = { ...prev };
                                      delete next[sectionKey];
                                      return next;
                                    });
                                  }
                                }}
                                className="w-16 px-2 py-0.5 bg-white text-[#111A27] border border-[#94C0D6] rounded font-mono-tabular font-bold text-xs text-center focus:outline-none focus:ring-1 focus:ring-[#DFEEF5]"
                              />
                              <span
                                className="text-[11px] font-mono-tabular text-[#94C0D6] whitespace-nowrap"
                                title={`Products in this section are numbered ${sectionStartNum} through ${sectionEndNum} (${block.productCards.length} total)`}
                              >
                                (#{sectionStartNum}
                                {block.productCards.length > 1 ? `–#${sectionEndNum}` : ''} ·{' '}
                                {block.productCards.length}{' '}
                                {block.productCards.length === 1 ? 'item' : 'items'})
                              </span>
                            </div>
                          ) : (
                            <div />
                          )}

                          {block.repeatedContainerPath && (
                            <div className="flex items-center gap-2">
                              {(block.blockType === 'quick_picks' ||
                                block.blockType === 'editorial_list' ||
                                block.blockType === 'product_grid') && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCatalogPickerTarget({
                                      sectionId: block.id,
                                      mode: 'insert_into_group',
                                      containerNodePath: block.repeatedContainerPath,
                                      startingNumber: isNumberedProductSection
                                        ? sectionStartNum
                                        : undefined,
                                      replaceDescription: true,
                                      replaceSpecs: true,
                                    });
                                    setCatalogPickerSearch('');
                                  }}
                                  className="px-2.5 py-1 bg-[#DFEEF5] hover:bg-[#CBE3EE] text-[#111A27] rounded-md text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                  <span>Insert Card from Catalog</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  applySectionHtmlMutation(
                                    block.id,
                                    (secHtml) =>
                                      addRepeatedGroupItem(
                                        secHtml,
                                        block.repeatedContainerPath!,
                                        undefined,
                                        isNumberedProductSection
                                          ? { startingNumber: sectionStartNum }
                                          : undefined
                                      ),
                                    `Added new item to "${sectionName}"`
                                  );
                                }}
                                className="px-2.5 py-1 bg-[#E1F2EA] hover:bg-[#CFEAD9] text-[#134634] rounded-md text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                              >
                                <Plus className="w-3.5 h-3.5" />
                                <span>Add Item (Clone Structure)</span>
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="p-5 space-y-5 text-xs">
                      {/* Fourthwall 30,000-character warning banner on individual section if applicable */}
                      {sectionExportEval.warningMessage && (
                        <div
                          role="status"
                          className={`px-3.5 py-2.5 rounded-lg border flex items-start justify-between gap-3 text-[11px] ${
                            sectionExportEval.exceedsFourthwallLimit
                              ? 'bg-red-50 border-red-300 text-red-900'
                              : 'bg-amber-50 border-amber-300 text-amber-950'
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                            <span>{sectionExportEval.warningMessage}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setExportCopyFeedback(null);
                              setExportModalTarget({ mode: 'section', sectionId: block.id });
                            }}
                            className="px-2.5 py-1 bg-white border border-current rounded font-semibold shrink-0"
                          >
                            Export Section
                          </button>
                        </div>
                      )}

                      {/* Non-destructive numbering notice ONLY when an eligible numbered product section has partial/missing number markup */}
                      {isNumberedProductSection && block.numberingInfo?.warningMessage && (
                        <div
                          role="status"
                          className="px-3.5 py-2.5 bg-[#FAF8F3] border border-[#DED8CA] rounded-lg flex items-start gap-2.5 text-[11px] text-[#334155]"
                        >
                          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                          <div className="space-y-0.5">
                            <span className="font-semibold text-[#111A27]">
                              Section Product Numbering (#{sectionStartNum}
                              {block.productCards.length > 1 ? `–#${sectionEndNum}` : ''}):{' '}
                            </span>
                            <span>{block.numberingInfo.warningMessage}</span>
                          </div>
                        </div>
                      )}

                      {/* 1. BLOCK-LEVEL HEADINGS / INTRO TEXT FIELDS */}
                      {block.textFields.length > 0 && (
                        <div className="bg-[#EFF6FA] border border-[#B5D5E6] rounded-lg p-4 space-y-3">
                          <span className="text-[11px] uppercase tracking-wider font-bold text-[#123E59]">
                            Section Headings &amp; Text
                          </span>
                          <div className="grid grid-cols-1 gap-3">
                            {block.textFields.map((tf) => (
                              <div key={tf.nodePath} className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <label className="sog-label mb-0">
                                    {tf.role.toUpperCase()} (&lt;{tf.tagName}&gt;)
                                  </label>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setAiAssistTarget({
                                        sectionId: block.id,
                                        nodePath: tf.nodePath,
                                        fieldLabel: `${tf.role} (<${tf.tagName}>)`,
                                        currentText: tf.hasInlineMarkup
                                          ? tf.htmlValue || tf.value
                                          : tf.value,
                                        asRawInnerHtml: tf.hasInlineMarkup,
                                        instruction:
                                          tf.role === 'heading'
                                            ? 'Suggest a sharper, clearer heading while keeping the topic accurate.'
                                            : 'Tighten and polish this editorial copy while preserving any links and facts.',
                                        loading: false,
                                        error: null,
                                        proposedText: null,
                                        alternatives: [],
                                        notes: '',
                                      })
                                    }
                                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#123E59] hover:underline"
                                  >
                                    <Sparkles className="w-3 h-3" />
                                    <span>AI Rewrite</span>
                                  </button>
                                </div>
                                {tf.hasInlineMarkup ? (
                                  <textarea
                                    rows={2}
                                    value={tf.htmlValue ?? tf.value}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      applySectionHtmlMutation(
                                        block.id,
                                        (secHtml) =>
                                          updateHtmlNodeText(secHtml, tf.nodePath, val, {
                                            asRawInnerHtml: true,
                                          }),
                                        `Updated <${tf.tagName}> HTML in "${sectionName}"`
                                      );
                                    }}
                                    className="sog-input font-mono-tabular text-xs"
                                  />
                                ) : tf.value.length > 90 ? (
                                  <textarea
                                    rows={2}
                                    value={tf.value}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      applySectionHtmlMutation(
                                        block.id,
                                        (secHtml) =>
                                          updateHtmlNodeText(secHtml, tf.nodePath, val),
                                        `Updated <${tf.tagName}> text in "${sectionName}"`
                                      );
                                    }}
                                    className="sog-input"
                                  />
                                ) : (
                                  <input
                                    type="text"
                                    value={tf.value}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      applySectionHtmlMutation(
                                        block.id,
                                        (secHtml) =>
                                          updateHtmlNodeText(secHtml, tf.nodePath, val),
                                        `Updated <${tf.tagName}> text in "${sectionName}"`
                                      );
                                    }}
                                    className="sog-input"
                                  />
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 2. TABLE OF CONTENTS ITEMS */}
                      {block.tocItems.length > 0 && (
                        <div className="space-y-2">
                          <span className="sog-label">
                            Table of Contents Entries ({block.tocItems.length})
                          </span>
                          <div className="space-y-2">
                            {block.tocItems.map((item, idx) => (
                              <div
                                key={item.itemNodePath}
                                className="p-3 bg-[#F7F4EC] border border-[#DED8CA] rounded-lg flex flex-wrap items-center gap-2.5"
                              >
                                <span className="font-mono-tabular font-bold text-[#5E6B7C] w-6">
                                  {String(idx + 1).padStart(2, '0')}
                                </span>
                                <input
                                  type="text"
                                  value={item.label}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    applySectionHtmlMutation(
                                      block.id,
                                      (secHtml) =>
                                        updateHtmlNodeText(secHtml, item.linkNodePath, val),
                                      `Updated TOC label "${val}"`
                                    );
                                  }}
                                  placeholder="Bookmark Label"
                                  className="flex-1 min-w-[180px] sog-input py-1"
                                />
                                <input
                                  type="text"
                                  value={item.href}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    applySectionHtmlMutation(
                                      block.id,
                                      (secHtml) =>
                                        updateElementAttributes(secHtml, item.linkNodePath, {
                                          href: val,
                                        }),
                                      `Updated TOC anchor href "${val}"`
                                    );
                                  }}
                                  placeholder="#jump-section"
                                  className="w-48 sog-input py-1 font-mono-tabular"
                                />
                                {block.repeatedContainerPath && (
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      disabled={idx === 0}
                                      onClick={() => {
                                        applySectionHtmlMutation(
                                          block.id,
                                          (secHtml) =>
                                            reorderRepeatedGroupItem(
                                              secHtml,
                                              block.repeatedContainerPath!,
                                              item.itemNodePath,
                                              'up'
                                            ),
                                          'Moved TOC item up'
                                        );
                                      }}
                                      className="p-1 text-[#5E6B7C] hover:text-[#111A27] disabled:opacity-30"
                                    >
                                      <ArrowUp className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={idx === block.tocItems.length - 1}
                                      onClick={() => {
                                        applySectionHtmlMutation(
                                          block.id,
                                          (secHtml) =>
                                            reorderRepeatedGroupItem(
                                              secHtml,
                                              block.repeatedContainerPath!,
                                              item.itemNodePath,
                                              'down'
                                            ),
                                          'Moved TOC item down'
                                        );
                                      }}
                                      className="p-1 text-[#5E6B7C] hover:text-[#111A27] disabled:opacity-30"
                                    >
                                      <ArrowDown className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        applySectionHtmlMutation(
                                          block.id,
                                          (secHtml) =>
                                            removeRepeatedGroupItem(secHtml, item.itemNodePath),
                                          'Removed TOC item'
                                        );
                                      }}
                                      className="p-1 text-[#5E6B7C] hover:text-red-600"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 3. RECOGNIZED PRODUCT CARDS (Dynamic Fields Only) */}
                      {block.productCards.length > 0 && (
                        <div className="space-y-4">
                          {block.productCards.map((card, cardIdx) =>
                            renderProductCardEditor(
                              block.id,
                              block,
                              card,
                              cardIdx,
                              isNumberedProductSection,
                              sectionStartNum
                            )
                          )}
                        </div>
                      )}

                      {/* 3B. ATTACHED SECONDARY GRIDS (.sog-more-section nested inside an editorial section) */}
                      {block.nestedBlocks &&
                        block.nestedBlocks.map((nested) => (
                          <div
                            key={nested.id}
                            className="p-4 bg-[#F7F4EC] border border-[#D5CFC0] rounded-xl space-y-4"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DED8CA] pb-2.5">
                              <div className="flex items-center gap-2">
                                <span className="px-2 py-0.5 bg-[#DFEEF5] text-[#111A27] text-[10px] font-bold uppercase tracking-wider rounded">
                                  Attached Grid
                                </span>
                                <span className="font-editorial font-semibold text-sm text-[#111A27]">
                                  {nested.label}
                                </span>
                              </div>
                              {nested.repeatedContainerPath && (
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setCatalogPickerTarget({
                                        sectionId: block.id,
                                        mode: 'insert_into_group',
                                        containerNodePath: nested.repeatedContainerPath,
                                        replaceDescription: true,
                                        replaceSpecs: true,
                                      });
                                      setCatalogPickerSearch('');
                                    }}
                                    className="px-2.5 py-1 bg-[#DFEEF5] hover:bg-[#CBE3EE] text-[#111A27] rounded-md text-xs font-semibold inline-flex items-center gap-1"
                                  >
                                    <Plus className="w-3.5 h-3.5" />
                                    <span>Insert Card from Catalog</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      applySectionHtmlMutation(
                                        block.id,
                                        (secHtml) =>
                                          addRepeatedGroupItem(
                                            secHtml,
                                            nested.repeatedContainerPath!
                                          ),
                                        `Added item to "${nested.label}"`
                                      );
                                    }}
                                    className="px-2.5 py-1 bg-[#E1F2EA] hover:bg-[#CFEAD9] text-[#134634] rounded-md text-xs font-semibold inline-flex items-center gap-1"
                                  >
                                    <Plus className="w-3.5 h-3.5" />
                                    <span>Add Grid Card</span>
                                  </button>
                                </div>
                              )}
                            </div>

                            {nested.textFields.length > 0 && (
                              <div className="grid grid-cols-1 gap-2">
                                {nested.textFields.map((tf) => (
                                  <div key={tf.nodePath}>
                                    <label className="sog-label">
                                      Grid Heading (&lt;{tf.tagName}&gt;)
                                    </label>
                                    <input
                                      type="text"
                                      value={tf.value}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        applySectionHtmlMutation(
                                          block.id,
                                          (secHtml) =>
                                            updateHtmlNodeText(secHtml, tf.nodePath, val),
                                          `Updated "${nested.label}" heading`
                                        );
                                      }}
                                      className="sog-input"
                                    />
                                  </div>
                                ))}
                              </div>
                            )}

                            <div className="space-y-3">
                              {nested.productCards.map((card, cardIdx) =>
                                renderProductCardEditor(
                                  block.id,
                                  nested,
                                  card,
                                  cardIdx,
                                  false,
                                  1
                                )
                              )}
                            </div>
                          </div>
                        ))}

                      {/* 4. CATEGORY / DEITY HUB CARDS */}
                      {block.categoryCards.length > 0 && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {block.categoryCards.map((catCard, cIdx) => (
                            <div
                              key={catCard.cardNodePath}
                              className="p-4 bg-[#F7F4EC] border border-[#DED8CA] rounded-xl space-y-3"
                            >
                              <div className="flex items-center justify-between border-b border-[#DED8CA] pb-2">
                                <span className="font-editorial font-semibold text-sm text-[#111A27]">
                                  {catCard.title?.value || `Category Card ${cIdx + 1}`}
                                </span>
                                {block.repeatedContainerPath && (
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      disabled={cIdx === 0}
                                      onClick={() => {
                                        applySectionHtmlMutation(
                                          block.id,
                                          (secHtml) =>
                                            reorderRepeatedGroupItem(
                                              secHtml,
                                              block.repeatedContainerPath!,
                                              catCard.cardNodePath,
                                              'up'
                                            ),
                                          'Moved category card up'
                                        );
                                      }}
                                      className="p-1 text-[#5E6B7C] hover:text-[#111A27] disabled:opacity-30"
                                    >
                                      <ArrowUp className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={cIdx === block.categoryCards.length - 1}
                                      onClick={() => {
                                        applySectionHtmlMutation(
                                          block.id,
                                          (secHtml) =>
                                            reorderRepeatedGroupItem(
                                              secHtml,
                                              block.repeatedContainerPath!,
                                              catCard.cardNodePath,
                                              'down'
                                            ),
                                          'Moved category card down'
                                        );
                                      }}
                                      className="p-1 text-[#5E6B7C] hover:text-[#111A27] disabled:opacity-30"
                                    >
                                      <ArrowDown className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        applySectionHtmlMutation(
                                          block.id,
                                          (secHtml) =>
                                            removeRepeatedGroupItem(secHtml, catCard.cardNodePath),
                                          'Removed category card'
                                        );
                                      }}
                                      className="p-1 text-[#5E6B7C] hover:text-red-600"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                )}
                              </div>

                              {catCard.title && (
                                <div>
                                  <label className="sog-label">Card Heading</label>
                                  <input
                                    type="text"
                                    value={catCard.title.value}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      applySectionHtmlMutation(
                                        block.id,
                                        (secHtml) =>
                                          updateHtmlNodeText(secHtml, catCard.title!.nodePath, val),
                                        'Updated category title'
                                      );
                                    }}
                                    className="sog-input"
                                  />
                                </div>
                              )}

                              {catCard.subtitle && (
                                <div>
                                  <label className="sog-label">Subtitle / Motifs</label>
                                  <input
                                    type="text"
                                    value={catCard.subtitle.value}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      applySectionHtmlMutation(
                                        block.id,
                                        (secHtml) =>
                                          updateHtmlNodeText(
                                            secHtml,
                                            catCard.subtitle!.nodePath,
                                            val
                                          ),
                                        'Updated category subtitle'
                                      );
                                    }}
                                    className="sog-input"
                                  />
                                </div>
                              )}

                              {catCard.description && (
                                <div>
                                  <label className="sog-label">Description</label>
                                  <textarea
                                    rows={2}
                                    value={catCard.description.value}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      applySectionHtmlMutation(
                                        block.id,
                                        (secHtml) =>
                                          updateHtmlNodeText(
                                            secHtml,
                                            catCard.description!.nodePath,
                                            val
                                          ),
                                        'Updated category description'
                                      );
                                    }}
                                    className="sog-input"
                                  />
                                </div>
                              )}

                              {catCard.chips.length > 0 && (
                                <div className="space-y-1.5">
                                  <label className="sog-label">Linked Product Chips</label>
                                  {catCard.chips.map((ch) => (
                                    <div key={ch.nodePath} className="grid grid-cols-2 gap-2">
                                      <input
                                        type="text"
                                        value={ch.label}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          applySectionHtmlMutation(
                                            block.id,
                                            (secHtml) =>
                                              updateHtmlNodeText(secHtml, ch.nodePath, val),
                                            'Updated chip label'
                                          );
                                        }}
                                        className="sog-input py-1 text-[11px]"
                                      />
                                      <input
                                        type="text"
                                        value={ch.href}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          applySectionHtmlMutation(
                                            block.id,
                                            (secHtml) =>
                                              updateElementAttributes(secHtml, ch.nodePath, {
                                                href: val,
                                              }),
                                            'Updated chip URL'
                                          );
                                        }}
                                        className="sog-input py-1 text-[11px] font-mono-tabular"
                                      />
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* 5. BUYING GUIDE PILLARS */}
                      {block.pillarItems.length > 0 && (
                        <div className="space-y-2.5">
                          <span className="sog-label">
                            Buying Guide Pillars ({block.pillarItems.length})
                          </span>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            {block.pillarItems.map((pil) => (
                              <div
                                key={pil.itemNodePath}
                                className="p-3.5 bg-[#F7F4EC] border border-[#DED8CA] rounded-xl space-y-2"
                              >
                                {pil.numLabel && (
                                  <input
                                    type="text"
                                    value={pil.numLabel.value}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      applySectionHtmlMutation(
                                        block.id,
                                        (secHtml) =>
                                          updateHtmlNodeText(secHtml, pil.numLabel!.nodePath, val),
                                        'Updated pillar number'
                                      );
                                    }}
                                    className="sog-input py-1 text-[11px] font-mono-tabular"
                                  />
                                )}
                                {pil.heading && (
                                  <input
                                    type="text"
                                    value={pil.heading.value}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      applySectionHtmlMutation(
                                        block.id,
                                        (secHtml) =>
                                          updateHtmlNodeText(secHtml, pil.heading!.nodePath, val),
                                        'Updated pillar heading'
                                      );
                                    }}
                                    className="sog-input font-semibold"
                                  />
                                )}
                                {pil.body && (
                                  <textarea
                                    rows={3}
                                    value={pil.body.htmlValue}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      applySectionHtmlMutation(
                                        block.id,
                                        (secHtml) =>
                                          updateHtmlNodeText(secHtml, pil.body!.nodePath, val, {
                                            asRawInnerHtml: true,
                                          }),
                                        'Updated pillar body'
                                      );
                                    }}
                                    className="sog-input text-[11px]"
                                  />
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 6. FAQ ITEMS */}
                      {block.faqItems.length > 0 && (
                        <div className="space-y-2.5">
                          <span className="sog-label">FAQ Items ({block.faqItems.length})</span>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                            {block.faqItems.map((faq, fIdx) => (
                              <div
                                key={faq.itemNodePath}
                                className="p-4 bg-[#F7F4EC] border border-[#DED8CA] rounded-xl space-y-2.5"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    {faq.badge && (
                                      <input
                                        type="text"
                                        value={faq.badge.value}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          applySectionHtmlMutation(
                                            block.id,
                                            (secHtml) =>
                                              updateHtmlNodeText(secHtml, faq.badge!.nodePath, val),
                                            'Updated FAQ badge'
                                          );
                                        }}
                                        className="w-16 sog-input py-0.5 text-center font-mono-tabular font-bold text-[11px]"
                                      />
                                    )}
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setAiAssistTarget({
                                          sectionId: block.id,
                                          nodePath: faq.answer.nodePath,
                                          fieldLabel: `FAQ Answer (${faq.question.value})`,
                                          currentText: faq.answer.htmlValue,
                                          asRawInnerHtml: true,
                                          instruction:
                                            'Refine this FAQ answer so it is concise, helpful, and preserves any existing product links verbatim.',
                                          loading: false,
                                          error: null,
                                          proposedText: null,
                                          alternatives: [],
                                          notes: '',
                                        })
                                      }
                                      className="text-[11px] font-semibold text-[#123E59] hover:underline inline-flex items-center gap-1"
                                    >
                                      <Sparkles className="w-3 h-3" />
                                      <span>AI Refine Answer</span>
                                    </button>
                                  </div>

                                  {block.repeatedContainerPath && (
                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        disabled={fIdx === 0}
                                        onClick={() => {
                                          applySectionHtmlMutation(
                                            block.id,
                                            (secHtml) =>
                                              reorderRepeatedGroupItem(
                                                secHtml,
                                                block.repeatedContainerPath!,
                                                faq.itemNodePath,
                                                'up'
                                              ),
                                            'Moved FAQ item up'
                                          );
                                        }}
                                        className="p-1 text-[#5E6B7C] hover:text-[#111A27] disabled:opacity-30"
                                      >
                                        <ArrowUp className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        disabled={fIdx === block.faqItems.length - 1}
                                        onClick={() => {
                                          applySectionHtmlMutation(
                                            block.id,
                                            (secHtml) =>
                                              reorderRepeatedGroupItem(
                                                secHtml,
                                                block.repeatedContainerPath!,
                                                faq.itemNodePath,
                                                'down'
                                              ),
                                            'Moved FAQ item down'
                                          );
                                        }}
                                        className="p-1 text-[#5E6B7C] hover:text-[#111A27] disabled:opacity-30"
                                      >
                                        <ArrowDown className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          applySectionHtmlMutation(
                                            block.id,
                                            (secHtml) =>
                                              removeRepeatedGroupItem(secHtml, faq.itemNodePath),
                                            'Removed FAQ item'
                                          );
                                        }}
                                        className="p-1 text-[#5E6B7C] hover:text-red-600"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  )}
                                </div>

                                <div>
                                  <label className="sog-label">Question</label>
                                  <input
                                    type="text"
                                    value={faq.question.value}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      applySectionHtmlMutation(
                                        block.id,
                                        (secHtml) =>
                                          updateHtmlNodeText(secHtml, faq.question.nodePath, val),
                                        'Updated FAQ question'
                                      );
                                    }}
                                    className="sog-input font-semibold"
                                  />
                                </div>

                                <div>
                                  <label className="sog-label">
                                    Answer (Supports inline `&lt;a href&gt;` and `&lt;strong&gt;`)
                                  </label>
                                  <textarea
                                    rows={3}
                                    value={faq.answer.htmlValue}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      applySectionHtmlMutation(
                                        block.id,
                                        (secHtml) =>
                                          updateHtmlNodeText(secHtml, faq.answer.nodePath, val, {
                                            asRawInnerHtml: true,
                                          }),
                                        'Updated FAQ answer'
                                      );
                                    }}
                                    className="sog-input font-mono-tabular text-[11px]"
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 7. STANDALONE LINKS & IMAGES IN GENERAL CONTENT / RELATED GUIDES BLOCKS */}
                      {block.links.length > 0 && (
                        <div className="space-y-2">
                          <span className="sog-label">Detected Links ({block.links.length})</span>
                          <div className="space-y-2">
                            {block.links.map((lnk) => (
                              <div
                                key={lnk.nodePath}
                                className="grid grid-cols-1 md:grid-cols-2 gap-2 p-2.5 bg-[#F7F4EC] border border-[#DED8CA] rounded-lg"
                              >
                                <div>
                                  <label className="sog-label">Link Text</label>
                                  <input
                                    type="text"
                                    value={lnk.label}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      applySectionHtmlMutation(
                                        block.id,
                                        (secHtml) =>
                                          updateHtmlNodeText(secHtml, lnk.nodePath, val),
                                        'Updated link text'
                                      );
                                    }}
                                    className="sog-input py-1"
                                  />
                                </div>
                                <div>
                                  <label className="sog-label">Destination URL (`href`)</label>
                                  <input
                                    type="text"
                                    value={lnk.href}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      applySectionHtmlMutation(
                                        block.id,
                                        (secHtml) =>
                                          updateElementAttributes(secHtml, lnk.nodePath, {
                                            href: val,
                                          }),
                                        'Updated link href'
                                      );
                                    }}
                                    className="sog-input py-1 font-mono-tabular"
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {block.images.length > 0 && (
                        <div className="space-y-2">
                          <span className="sog-label">Detected Images ({block.images.length})</span>
                          <div className="space-y-2">
                            {block.images.map((img) => (
                              <div
                                key={img.nodePath}
                                className="grid grid-cols-1 md:grid-cols-2 gap-2 p-2.5 bg-[#F7F4EC] border border-[#DED8CA] rounded-lg"
                              >
                                <div>
                                  <label className="sog-label">Image `src`</label>
                                  <input
                                    type="text"
                                    value={img.src}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      applySectionHtmlMutation(
                                        block.id,
                                        (secHtml) =>
                                          updateElementAttributes(secHtml, img.nodePath, {
                                            src: val,
                                          }),
                                        'Updated image src'
                                      );
                                    }}
                                    className="sog-input py-1 font-mono-tabular"
                                  />
                                </div>
                                <div>
                                  <label className="sog-label">Image `alt`</label>
                                  <input
                                    type="text"
                                    value={img.alt}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      applySectionHtmlMutation(
                                        block.id,
                                        (secHtml) =>
                                          updateElementAttributes(secHtml, img.nodePath, {
                                            alt: val,
                                          }),
                                        'Updated image alt'
                                      );
                                    }}
                                    className="sog-input py-1"
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 8. SAFE FALLBACK FOR UNFAMILIAR / CUSTOM HTML BLOCKS */}
                      {block.blockType === 'raw_fallback' && (
                        <div className="p-4 bg-[#F7F4EC] border border-[#D5CFC0] rounded-xl space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="font-semibold text-[#111A27]">
                                Preserved in Safe Raw Fallback Mode
                              </p>
                              <p className="text-[11px] text-[#5E6B7C]">
                                This custom or script/style element is preserved verbatim in the
                                exported HTML without forced schema rewriting.
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRunAiClassifyBlock(block)}
                              className="sog-btn-powder py-1 px-2.5"
                            >
                              <Sparkles className="w-3.5 h-3.5" />
                              <span>AI Analyze Structure</span>
                            </button>
                          </div>

                          {aiStructureReport && aiStructureReport.blockId === block.id && (
                            <div className="p-3 bg-[#EFF6FA] border border-[#94C0D6] rounded-lg space-y-1.5 text-xs">
                              {aiStructureReport.loading ? (
                                <p className="text-[#123E59] font-medium">
                                  Analyzing HTML fragment with Gemini...
                                </p>
                              ) : aiStructureReport.error ? (
                                <p className="text-red-800">{aiStructureReport.error}</p>
                              ) : (
                                <>
                                  {aiStructureReport.modelMetadata && (
                                    <p className="text-[11px] text-[#1A567B]">
                                      Model used:{' '}
                                      <strong>{aiStructureReport.modelMetadata.modelUsedLabel}</strong>{' '}
                                      (<code>{aiStructureReport.modelMetadata.modelUsed}</code>)
                                      {aiStructureReport.modelMetadata.fallbackUsed
                                        ? ` — fallback from ${aiStructureReport.modelMetadata.requestedModel}`
                                        : ''}
                                    </p>
                                  )}
                                  <p className="font-bold text-[#111A27]">
                                    Detected Pattern: {aiStructureReport.componentCategory}
                                  </p>
                                  <p className="text-[#334155]">{aiStructureReport.summary}</p>
                                </>
                              )}
                            </div>
                          )}

                          <pre className="p-3 bg-[#111926] text-[#E6EEF8] rounded-lg font-mono-tabular text-[11px] overflow-x-auto max-h-48">
                            {block.rawHtmlSnippet}
                          </pre>
                        </div>
                      )}
                    </div>
                  </section>
                );
              })
            )}
          </main>
        )}

        {/* RAW HTML CODE EDITOR MODE */}
        {viewMode === 'raw' && (
          <main className="flex-1 flex flex-col p-6 space-y-3 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-[#162235] text-white px-4 py-3 rounded-xl">
              <div className="space-y-0.5">
                <h2 className="text-sm font-editorial font-semibold">Raw HTML Source Editor</h2>
                <p className="text-[11px] text-[#C6D3E3]">
                  Edit the combined HTML directly. Click &ldquo;Apply &amp; Re-Analyze&rdquo; (or
                  switch back to Visual mode) to map changes back to your project sections.
                </p>
              </div>

              <div className="flex items-center gap-2">
                {rawBufferDirty && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setRawEditorBuffer(currentHtml);
                        setRawBufferDirty(false);
                      }}
                      className="px-3 py-1.5 bg-[#24344D] text-[#C6D3E3] hover:text-white rounded-lg text-xs font-semibold"
                    >
                      Discard Unapplied Raw Edits
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const updatedProj = replaceProjectHtmlContent(
                          buildCurrentWorkspaceProjectSnapshot(),
                          rawEditorBuffer,
                          undefined,
                          products
                        );
                        commitUpdatedProjectState(
                          {
                            ...updatedProj,
                            originalHtml,
                          },
                          'Applied & re-analyzed edits from Raw HTML editor',
                          {
                            persistImmediately: true,
                            toastMessage: 'Re-analyzed Raw HTML into visual sections.',
                          }
                        );
                      }}
                      className="sog-btn-mint"
                    >
                      Apply &amp; Re-Analyze Raw HTML
                    </button>
                  </>
                )}
              </div>
            </div>

            <textarea
              value={rawEditorBuffer}
              onChange={(e) => {
                setRawEditorBuffer(e.target.value);
                setRawBufferDirty(e.target.value !== currentHtml);
              }}
              spellCheck={false}
              className="flex-1 w-full p-4 bg-[#111926] text-[#E6EEF8] rounded-xl font-mono-tabular text-xs leading-relaxed focus:outline-none border border-[#2C3E58]"
            />
          </main>
        )}

        {/* RIGHT PANEL: ISOLATED LIVE STOREFRONT PREVIEW */}
        {(viewMode === 'split' || viewMode === 'preview') && (
          <aside
            className={`${
              viewMode === 'preview' ? 'flex-1' : 'w-[46%] max-w-[680px]'
            } bg-[#E4DFD3] border-l border-[#C9C2B2] flex flex-col shrink-0 min-h-0`}
          >
            {/* Dark Navy Preview Studio Bar */}
            <div className="bg-[#151F30] text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs border-b border-[#25354C]">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-[#DFEEF5]">
                  Isolated Storefront Preview ({sections.length} section{sections.length === 1 ? '' : 's'})
                </span>
                <span className="text-[11px] text-[#94A3B8]">
                  (Scripts neutralized; source untouched)
                </span>
              </div>

              <div className="flex items-center gap-2">
                <label className="inline-flex items-center gap-1.5 text-[11px] text-[#C6D3E3] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeFourthwallCss}
                    onChange={(e) => setIncludeFourthwallCss(e.target.checked)}
                    className="rounded border-[#475569]"
                  />
                  <span>Fourthwall `.sog-*` CSS</span>
                </label>

                <div className="flex items-center gap-1 p-0.5 bg-[#22314A] rounded-md">
                  <button
                    type="button"
                    onClick={() => setPreviewViewport('desktop')}
                    className={`p-1 rounded ${
                      previewViewport === 'desktop'
                        ? 'bg-[#DFEEF5] text-[#111A27]'
                        : 'text-[#C6D3E3]'
                    }`}
                    title="Desktop viewport"
                  >
                    <Monitor className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewViewport('mobile')}
                    className={`p-1 rounded ${
                      previewViewport === 'mobile'
                        ? 'bg-[#DFEEF5] text-[#111A27]'
                        : 'text-[#C6D3E3]'
                    }`}
                    title="Mobile 390px viewport"
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            <div className="flex-1 p-4 overflow-y-auto flex justify-center">
              <div
                className={`bg-white border border-[#C6BEB0] rounded-xl shadow-md overflow-hidden transition-all flex flex-col ${
                  previewViewport === 'mobile' ? 'w-[390px]' : 'w-full'
                }`}
              >
                <iframe
                  ref={previewIframeRef}
                  onLoad={handlePreviewIframeLoad}
                  title="Isolated Fourthwall HTML Preview"
                  sandbox="allow-same-origin"
                  srcDoc={previewIframeSrcDoc}
                  className="w-full flex-1 min-h-[640px] border-0"
                />
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* MODAL 0: SECTION & COMPLETE PROJECT HTML EXPORT (FOURTHWALL 30,000-CHAR LIMIT AWARE) */}
      {exportModalTarget && activeExportPayload && (
        <div className="fixed inset-0 z-50 bg-[#111A27]/60 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="bg-[#FBF9F5] border border-[#C6BEB0] rounded-xl max-w-3xl w-full max-h-[90vh] flex flex-col p-6 space-y-4 shadow-xl text-xs">
            <div className="flex items-start justify-between border-b border-[#DED8CA] pb-3 gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-[#1A567B] font-bold">
                  Fourthwall HTML Export &amp; Character Limit Inspector
                </p>
                <h2 className="text-lg font-editorial font-semibold text-[#111A27]">
                  {activeExportPayload.title}
                </h2>
                <p className="text-[#5E6B7C] mt-0.5">{activeExportPayload.subtitle}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setExportModalTarget(null);
                  setExportCopyFeedback(null);
                }}
                className="p-1 text-[#5E6B7C] hover:text-[#111A27]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scope Selector: Switch between Complete Project or Individual Sections */}
            <div className="flex flex-wrap items-center gap-2 bg-[#EFECE2] p-2.5 rounded-lg border border-[#D5CFC0]">
              <span className="text-[11px] font-semibold text-[#111A27]">Export Target:</span>
              <button
                type="button"
                onClick={() => {
                  setExportCopyFeedback(null);
                  setExportModalTarget({ mode: 'complete_project' });
                }}
                className={`px-2.5 py-1 rounded-md font-semibold transition-colors ${
                  exportModalTarget.mode === 'complete_project'
                    ? 'bg-[#111A27] text-white'
                    : 'bg-white text-[#334155] border border-[#D5CFC0]'
                }`}
              >
                Complete Project ({sections.length} Sections ·{' '}
                {completeProjectExportStatus.characterCount.toLocaleString()} chars)
              </button>

              {sections.map((sec, idx) => (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => {
                    setExportCopyFeedback(null);
                    setExportModalTarget({ mode: 'section', sectionId: sec.id });
                  }}
                  className={`px-2.5 py-1 rounded-md font-semibold transition-colors ${
                    exportModalTarget.mode === 'section' && exportModalTarget.sectionId === sec.id
                      ? 'bg-[#1A567B] text-white'
                      : 'bg-white text-[#334155] border border-[#D5CFC0]'
                  }`}
                >
                  {String(idx + 1).padStart(2, '0')}. {sec.name} ({sec.htmlContent.length.toLocaleString()}{' '}
                  chars)
                </button>
              ))}
            </div>

            {/* Character Count & Fourthwall 30,000-Char Limit Status Bar */}
            <div
              className={`p-3.5 rounded-xl border space-y-2 ${
                activeExportPayload.exceedsFourthwallLimit
                  ? 'bg-red-50 border-red-300 text-red-950'
                  : activeExportPayload.approachingFourthwallLimit
                  ? 'bg-amber-50 border-amber-300 text-amber-950'
                  : 'bg-[#E1F2EA] border-[#96CDB0] text-[#134634]'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-semibold">
                  {activeExportPayload.exceedsFourthwallLimit ||
                  activeExportPayload.approachingFourthwallLimit ? (
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                  )}
                  <span>
                    Character Count: {activeExportPayload.characterCount.toLocaleString()} /{' '}
                    {FOURTHWALL_CHAR_LIMIT.toLocaleString()} characters
                  </span>
                </div>
                <span className="font-mono-tabular text-[11px] font-bold">
                  {activeExportPayload.exceedsFourthwallLimit
                    ? `Exceeds limit by ${(
                        activeExportPayload.characterCount - FOURTHWALL_CHAR_LIMIT
                      ).toLocaleString()} chars`
                    : `${activeExportPayload.remainingCharacters.toLocaleString()} chars remaining under 30k limit`}
                </span>
              </div>

              {activeExportPayload.warningMessage && (
                <p className="text-[11px] leading-relaxed">{activeExportPayload.warningMessage}</p>
              )}
            </div>

            {/* Copy Feedback Banner */}
            {exportCopyFeedback && (
              <div
                role="status"
                className={`p-3 rounded-lg border flex items-center gap-2 font-semibold ${
                  exportCopyFeedback.status === 'copied'
                    ? 'bg-[#E1F2EA] border-[#96CDB0] text-[#134634]'
                    : 'bg-amber-50 border-amber-300 text-amber-950'
                }`}
              >
                <Check className="w-4 h-4 shrink-0" />
                <span>{exportCopyFeedback.message}</span>
              </div>
            )}

            {/* Selectable HTML Source Textarea Fallback */}
            <div className="flex-1 flex flex-col min-h-0 space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="sog-label mb-0">
                  Exported HTML Source (Preserves all classes, IDs, inline styles, and attributes)
                </label>
                <button
                  type="button"
                  onClick={() => {
                    if (exportTextareaRef.current) {
                      exportTextareaRef.current.focus();
                      exportTextareaRef.current.select();
                    }
                  }}
                  className="text-[11px] font-semibold text-[#1A567B] hover:underline"
                >
                  Select All HTML
                </button>
              </div>
              <textarea
                ref={exportTextareaRef}
                readOnly
                rows={10}
                aria-label="Exported HTML Source"
                value={activeExportPayload.html}
                onClick={(e) => e.currentTarget.select()}
                className="w-full flex-1 p-3.5 bg-[#111926] text-[#E6EEF8] rounded-xl font-mono-tabular text-xs leading-relaxed focus:outline-none border border-[#2C3E58]"
              />
            </div>

            {/* Modal Footer Actions: Copy HTML & Download .html */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#DED8CA]">
              <button
                type="button"
                onClick={() => {
                  setExportModalTarget(null);
                  setExportCopyFeedback(null);
                }}
                className="sog-btn-secondary"
              >
                Close
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    handleDownloadHtmlFile(
                      activeExportPayload.html,
                      activeExportPayload.fileBaseName
                    )
                  }
                  className="sog-btn-secondary"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download HTML</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void handleCopyHtmlWithFallback(
                      activeExportPayload.html,
                      activeExportPayload.title
                    )
                  }
                  className="sog-btn-mint"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy HTML</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: CATALOG PRODUCT PICKER (REPLACE CARD OR INSERT NEW CARD) */}
      {catalogPickerTarget && (
        <div className="fixed inset-0 z-50 bg-[#111A27]/60 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="bg-[#FBF9F5] border border-[#C6BEB0] rounded-xl max-w-2xl w-full max-h-[88vh] flex flex-col p-6 space-y-4 shadow-xl text-xs">
            <div className="flex items-center justify-between border-b border-[#DED8CA] pb-3">
              <div>
                <h2 className="text-lg font-editorial font-semibold text-[#111A27]">
                  {catalogPickerTarget.mode === 'replace_card'
                    ? 'Replace Card with Catalog Product'
                    : 'Insert New Card from Catalog'}
                </h2>
                <p className="text-[#5E6B7C] mt-0.5">
                  Applies stored title, canonical URL, `data-product-url`, image, and price while
                  preserving the card&apos;s HTML structure.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCatalogPickerTarget(null)}
                className="p-1 text-[#5E6B7C] hover:text-[#111A27]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {catalogPickerTarget.mode === 'replace_card' && (
              <div className="flex flex-wrap items-center gap-4 p-3 bg-[#EFF6FA] border border-[#94C0D6] rounded-lg">
                <label className="inline-flex items-center gap-2 font-medium text-[#111A27] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={catalogPickerTarget.replaceDescription}
                    onChange={(e) =>
                      setCatalogPickerTarget({
                        ...catalogPickerTarget,
                        replaceDescription: e.target.checked,
                      })
                    }
                  />
                  <span>Also overwrite existing card description/dek with catalog description</span>
                </label>
                <label className="inline-flex items-center gap-2 font-medium text-[#111A27] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={catalogPickerTarget.replaceSpecs}
                    onChange={(e) =>
                      setCatalogPickerTarget({
                        ...catalogPickerTarget,
                        replaceSpecs: e.target.checked,
                      })
                    }
                  />
                  <span>Also overwrite specs callout</span>
                </label>
              </div>
            )}

            <div className="relative">
              <Search className="w-4 h-4 text-[#5E6B7C] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={catalogPickerSearch}
                onChange={(e) => setCatalogPickerSearch(e.target.value)}
                placeholder="Search catalog by title, /products/ slug, or category..."
                className="w-full pl-9 pr-3 py-2 bg-white border border-[#C8C0B0] rounded-lg focus:outline-none"
              />
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-[#EAE4D8] border border-[#DED8CA] rounded-lg bg-white">
              {filteredCatalogForPicker.map((prod) => (
                <div
                  key={prod.id}
                  className="p-3 flex items-center justify-between gap-3 hover:bg-[#FAF8F3]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-editorial font-semibold text-sm text-[#111A27] truncate">
                      {prod.name}
                    </p>
                    <p className="text-[11px] font-mono-tabular text-[#5E6B7C] truncate">
                      {prod.productUrl} · {prod.price || 'Price unavailable'} · {prod.category}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        catalogPickerTarget.mode === 'replace_card' &&
                        catalogPickerTarget.card
                      ) {
                        applySectionHtmlMutation(
                          catalogPickerTarget.sectionId,
                          (secHtml) =>
                            applyCatalogProductToCard(secHtml, catalogPickerTarget.card!, prod, {
                              replaceDescription: catalogPickerTarget.replaceDescription,
                              replaceSpecs: catalogPickerTarget.replaceSpecs,
                            }),
                          `Replaced product card with "${prod.name}"`
                        );
                        onShowToast?.(`Applied "${prod.name}" to product card.`);
                      } else if (
                        catalogPickerTarget.mode === 'insert_into_group' &&
                        catalogPickerTarget.containerNodePath
                      ) {
                        applySectionHtmlMutation(
                          catalogPickerTarget.sectionId,
                          (secHtml) =>
                            addRepeatedGroupItem(
                              secHtml,
                              catalogPickerTarget.containerNodePath!,
                              prod,
                              catalogPickerTarget.startingNumber !== undefined
                                ? { startingNumber: catalogPickerTarget.startingNumber }
                                : undefined
                            ),
                          `Inserted new product card for "${prod.name}"`
                        );
                        onShowToast?.(`Inserted new card for "${prod.name}".`);
                      }
                      setCatalogPickerTarget(null);
                    }}
                    className="sog-btn-primary py-1.5 px-3"
                  >
                    Select Product
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: EXPLICIT AI REWRITE / REFINE REVIEW MODAL */}
      {aiAssistTarget && (
        <div className="fixed inset-0 z-50 bg-[#111A27]/60 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="bg-[#FBF9F5] border border-[#C6BEB0] rounded-xl max-w-2xl w-full p-6 space-y-4 shadow-xl text-xs">
            <div className="flex items-center justify-between border-b border-[#DED8CA] pb-3">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-[#1A567B] font-bold">
                  Explicit AI Editorial Assistant
                </p>
                <h2 className="text-lg font-editorial font-semibold text-[#111A27]">
                  {aiAssistTarget.fieldLabel}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setAiAssistTarget(null)}
                className="p-1 text-[#5E6B7C] hover:text-[#111A27]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-[#EFF6FA] border border-[#94C0D6] rounded-lg">
              <span className="text-[11px] font-semibold text-[#123E59]">
                Gemini Model Preference (with automatic fallback):
              </span>
              <select
                aria-label="Select Gemini Model for Rewrite"
                value={selectedGeminiModel}
                onChange={(e) => {
                  const updated = saveGeminiModelPreference(
                    e.target.value as ConfiguredGeminiModelId
                  );
                  setSelectedGeminiModel(updated);
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

            <div className="space-y-1">
              <label className="sog-label">Current Content</label>
              <div className="p-3 bg-white border border-[#DED8CA] rounded-lg text-[#334155] max-h-28 overflow-y-auto">
                {aiAssistTarget.currentText}
              </div>
            </div>

            <div className="space-y-2">
              <label className="sog-label">Instruction for AI</label>
              <div className="flex flex-wrap gap-1.5">
                {[
                  'Tighten and polish prose while preserving all facts and links.',
                  'Make it shorter and more punchy.',
                  'Suggest 3 stronger headline / angle alternatives.',
                  'Make the tone warmer and more gift-focused without inventing specs.',
                ].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setAiAssistTarget({ ...aiAssistTarget, instruction: preset });
                      handleRunAiRewrite(preset);
                    }}
                    className="px-2.5 py-1 bg-[#DFEEF5] hover:bg-[#CBE3EE] text-[#123E59] rounded-md font-medium"
                  >
                    {preset.slice(0, 38)}...
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={aiAssistTarget.instruction}
                  onChange={(e) =>
                    setAiAssistTarget({ ...aiAssistTarget, instruction: e.target.value })
                  }
                  className="sog-input flex-1"
                />
                <button
                  type="button"
                  disabled={aiAssistTarget.loading}
                  onClick={() => handleRunAiRewrite()}
                  className="sog-btn-primary"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{aiAssistTarget.loading ? 'Generating...' : 'Generate Proposal'}</span>
                </button>
              </div>
            </div>

            {aiAssistTarget.error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-800">
                {aiAssistTarget.error}
              </div>
            )}

            {aiAssistTarget.proposedText !== null && (
              <div className="p-4 bg-[#EFF6FA] border border-[#94C0D6] rounded-xl space-y-3">
                {aiAssistTarget.modelMetadata && (
                  <div
                    className={`px-3 py-1.5 rounded border text-[11px] flex flex-wrap items-center justify-between gap-2 ${
                      aiAssistTarget.modelMetadata.fallbackUsed
                        ? 'bg-amber-50 border-amber-200 text-amber-900'
                        : 'bg-[#E1F2EA] border-[#96CDB0] text-[#134634]'
                    }`}
                  >
                    <span>
                      <strong>Model Succeeded:</strong>{' '}
                      {aiAssistTarget.modelMetadata.modelUsedLabel} (
                      <code className="font-mono-tabular">
                        {aiAssistTarget.modelMetadata.modelUsed}
                      </code>
                      )
                    </span>
                    {aiAssistTarget.modelMetadata.fallbackUsed && (
                      <span>
                        Fallback used (requested:{' '}
                        <code className="font-mono-tabular">
                          {aiAssistTarget.modelMetadata.requestedModel}
                        </code>
                        ; saved preference unchanged)
                      </span>
                    )}
                  </div>
                )}
                <label className="sog-label text-[#123E59]">
                  Proposed Replacement (Editable before applying)
                </label>
                <textarea
                  rows={4}
                  value={aiAssistTarget.proposedText}
                  onChange={(e) =>
                    setAiAssistTarget({ ...aiAssistTarget, proposedText: e.target.value })
                  }
                  className="sog-input"
                />

                {aiAssistTarget.alternatives.length > 0 && (
                  <div className="space-y-1">
                    <span className="text-[11px] font-semibold text-[#123E59]">
                      Alternatives (Click to load):
                    </span>
                    {aiAssistTarget.alternatives.map((alt, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() =>
                          setAiAssistTarget({ ...aiAssistTarget, proposedText: alt })
                        }
                        className="block w-full text-left p-2 bg-white hover:bg-[#F7F4EC] border border-[#D5CFC0] rounded text-[11px]"
                      >
                        {alt}
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setAiAssistTarget(null)}
                    className="sog-btn-secondary"
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      applySectionHtmlMutation(
                        aiAssistTarget.sectionId,
                        (secHtml) =>
                          updateHtmlNodeText(
                            secHtml,
                            aiAssistTarget.nodePath,
                            aiAssistTarget.proposedText || '',
                            {
                              asParagraphs: aiAssistTarget.asParagraphs,
                              asRawInnerHtml: aiAssistTarget.asRawInnerHtml,
                            }
                          ),
                        `Applied AI rewrite to ${aiAssistTarget.fieldLabel}`
                      );
                      setAiAssistTarget(null);
                    }}
                    className="sog-btn-mint"
                  >
                    Apply Replacement
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL 3: SESSION CHANGE LOG & DIFF SUMMARY */}
      {showChangeSummaryModal && (
        <div className="fixed inset-0 z-50 bg-[#111A27]/60 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="bg-[#FBF9F5] border border-[#C6BEB0] rounded-xl max-w-2xl w-full p-6 space-y-4 shadow-xl text-xs">
            <div className="flex items-center justify-between border-b border-[#DED8CA] pb-3">
              <div>
                <h2 className="text-lg font-editorial font-semibold text-[#111A27]">
                  Session Change Summary ({changeLog.length} edits)
                </h2>
                <p className="text-[#5E6B7C]">
                  Active sections: {sections.length} · Current HTML length:{' '}
                  {currentHtml.length.toLocaleString()} chars
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowChangeSummaryModal(false)}
                className="p-1 text-[#5E6B7C] hover:text-[#111A27]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="max-h-64 overflow-y-auto divide-y divide-[#EAE4D8] border border-[#DED8CA] rounded-lg bg-white">
              {changeLog.length === 0 ? (
                <p className="p-4 text-[#5E6B7C]">No edits recorded in this session yet.</p>
              ) : (
                changeLog.map((entry) => (
                  <div key={entry.id} className="p-2.5 flex items-center justify-between gap-3">
                    <span className="font-medium text-[#111A27]">{entry.description}</span>
                    <span className="font-mono-tabular text-[11px] text-[#5E6B7C] shrink-0">
                      {entry.timestamp}
                    </span>
                  </div>
                ))
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowChangeSummaryModal(false)}
                className="sog-btn-primary"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: SAVED PROJECTS MANAGER (OPEN, RENAME, DUPLICATE, DELETE WITH CONFIRMATION) */}
      {showProjectsModal && (
        <div className="fixed inset-0 z-50 bg-[#111A27]/60 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="bg-[#FBF9F5] border border-[#C6BEB0] rounded-xl max-w-3xl w-full max-h-[86vh] flex flex-col p-6 space-y-4 shadow-xl text-xs">
            <div className="flex items-center justify-between border-b border-[#DED8CA] pb-3">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-[#1A567B] font-bold">
                  Persistent HTML Workspace Projects
                </p>
                <h2 className="text-lg font-editorial font-semibold text-[#111A27]">
                  Saved Gift Guide Projects ({projects.length})
                </h2>
                <p className="text-[#5E6B7C] mt-0.5">
                  Each project preserves all of its ordered HTML sections, product numbering, and
                  editor settings across reloads.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowProjectsModal(false);
                    handleRequestNewProject();
                  }}
                  className="sog-btn-primary py-1.5 px-3"
                >
                  <FilePlus2 className="w-3.5 h-3.5" />
                  <span>New Project</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowProjectsModal(false)}
                  className="p-1 text-[#5E6B7C] hover:text-[#111A27]"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-[#EAE4D8] border border-[#DED8CA] rounded-lg bg-white">
              {projects.length === 0 ? (
                <div className="p-8 text-center text-[#5E6B7C]">
                  No saved projects found. Click <strong>New Project</strong> to create one.
                </div>
              ) : (
                projects.map((proj) => {
                  const isCurrent = proj.id === activeProjectId;
                  const isRenaming = renamingProjectId === proj.id;
                  const isConfirmingDelete = confirmDeleteProjectId === proj.id;
                  const projSectionCount =
                    proj.sections?.length || proj.editorState?.sections?.length || 1;

                  return (
                    <div
                      key={proj.id}
                      className={`p-4 flex flex-wrap items-center justify-between gap-3 transition-colors ${
                        isCurrent ? 'bg-[#EFF6FA]' : 'hover:bg-[#FAF8F3]'
                      }`}
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        {isRenaming ? (
                          <form
                            onSubmit={async (e) => {
                              e.preventDefault();
                              const clean = renamingProjectName.trim();
                              if (!clean) return;
                              try {
                                const updated = await renameHtmlProject(proj.id, clean, userId);
                                setProjects(loadLocalHtmlProjects());
                                if (proj.id === activeProjectId) {
                                  setProjectName(updated.name);
                                  setLastSavedSnapshot((prev) => ({
                                    ...prev,
                                    name: updated.name,
                                  }));
                                }
                                setRenamingProjectId(null);
                                onShowToast?.(`Renamed project to "${updated.name}".`);
                              } catch (err) {
                                onShowToast?.(
                                  err instanceof Error ? err.message : 'Failed to rename project.'
                                );
                              }
                            }}
                            className="flex items-center gap-2"
                          >
                            <input
                              type="text"
                              value={renamingProjectName}
                              onChange={(e) => setRenamingProjectName(e.target.value)}
                              className="sog-input py-1 text-xs font-semibold max-w-xs"
                              autoFocus
                            />
                            <button type="submit" className="sog-btn-mint py-1 px-2.5">
                              Save Name
                            </button>
                            <button
                              type="button"
                              onClick={() => setRenamingProjectId(null)}
                              className="sog-btn-secondary py-1 px-2"
                            >
                              Cancel
                            </button>
                          </form>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="font-editorial font-semibold text-sm text-[#111A27] truncate">
                              {proj.name}
                            </span>
                            {isCurrent && (
                              <span className="px-2 py-0.5 bg-[#111A27] text-white rounded text-[10px] font-semibold uppercase tracking-wider">
                                Active
                              </span>
                            )}
                          </div>
                        )}

                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#5E6B7C] font-mono-tabular">
                          <span>Modified: {new Date(proj.updatedAt).toLocaleString()}</span>
                          <span>·</span>
                          <span>{projSectionCount} section(s)</span>
                          <span>·</span>
                          <span>{proj.currentHtml.length.toLocaleString()} chars</span>
                          {proj.baseUrl && (
                            <>
                              <span>·</span>
                              <span className="truncate max-w-[200px]">{proj.baseUrl}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Project Row Actions */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {isConfirmingDelete ? (
                          <div className="inline-flex items-center gap-1.5 bg-red-50 border border-red-200 px-2.5 py-1 rounded-md">
                            <span className="text-red-900 font-semibold">
                              Delete entire project &ldquo;{proj.name}&rdquo;?
                            </span>
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await deleteHtmlProject(proj.id, userId);
                                  const remaining = loadLocalHtmlProjects();
                                  setConfirmDeleteProjectId(null);

                                  if (proj.id === activeProjectId) {
                                    if (remaining.length > 0) {
                                      setProjects(remaining);
                                      applyProjectToWorkspace(remaining[0]);
                                    } else {
                                      const fresh = await createNewHtmlProject({
                                        name: 'Greek Mythology Gift Guide',
                                        htmlContent: buildDefaultStarterHtml(),
                                        baseUrl: defaultBaseUrl,
                                        userId,
                                      });
                                      const refreshed = loadLocalHtmlProjects();
                                      setProjects(refreshed);
                                      applyProjectToWorkspace(fresh);
                                    }
                                  } else {
                                    setProjects(remaining);
                                  }
                                  onShowToast?.(`Deleted project "${proj.name}".`);
                                } catch (err) {
                                  onShowToast?.(
                                    err instanceof Error ? err.message : 'Failed to delete project.'
                                  );
                                }
                              }}
                              className="px-2 py-0.5 bg-red-600 hover:bg-red-700 text-white rounded font-semibold"
                            >
                              Confirm Delete
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteProjectId(null)}
                              className="px-1.5 py-0.5 text-[#5E6B7C] hover:text-[#111A27]"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => handleRequestOpenProject(proj)}
                              className={
                                isCurrent
                                  ? 'sog-btn-secondary py-1 px-2.5'
                                  : 'sog-btn-primary py-1 px-3'
                              }
                            >
                              <FolderOpen className="w-3.5 h-3.5" />
                              <span>{isCurrent ? 'Reload' : 'Open'}</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setRenamingProjectId(proj.id);
                                setRenamingProjectName(proj.name);
                              }}
                              className="sog-btn-secondary py-1 px-2.5"
                              title="Rename project"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              <span>Rename</span>
                            </button>

                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  const copy = await duplicateHtmlProject(
                                    proj.id,
                                    undefined,
                                    userId
                                  );
                                  setProjects(loadLocalHtmlProjects());
                                  onShowToast?.(`Duplicated project as "${copy.name}".`);
                                } catch (err) {
                                  onShowToast?.(
                                    err instanceof Error
                                      ? err.message
                                      : 'Failed to duplicate project.'
                                  );
                                }
                              }}
                              className="sog-btn-secondary py-1 px-2.5"
                              title="Duplicate project"
                            >
                              <Files className="w-3.5 h-3.5" />
                              <span>Duplicate</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => setConfirmDeleteProjectId(proj.id)}
                              className="px-2 py-1 text-[#5E6B7C] hover:text-red-700 hover:bg-red-50 border border-transparent hover:border-red-200 rounded-md transition-colors inline-flex items-center gap-1"
                              title="Delete project"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Delete</span>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => setShowProjectsModal(false)}
                className="sog-btn-secondary"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 5: CREATE NEW PROJECT MODAL */}
      {showNewProjectModal && (
        <div className="fixed inset-0 z-50 bg-[#111A27]/60 backdrop-blur-[1px] flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateNewProjectConfirm}
            className="bg-[#FBF9F5] border border-[#C6BEB0] rounded-xl max-w-2xl w-full p-6 space-y-4 shadow-xl text-xs"
          >
            <div className="flex items-center justify-between border-b border-[#DED8CA] pb-3">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-[#1A567B] font-bold">
                  New HTML Gift Guide Project
                </p>
                <h2 className="text-lg font-editorial font-semibold text-[#111A27]">
                  Create a New Saved Project
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowNewProjectModal(false)}
                className="p-1 text-[#5E6B7C] hover:text-[#111A27]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="sog-label">Project Name</label>
                <input
                  type="text"
                  required
                  value={newProjectNameInput}
                  onChange={(e) => setNewProjectNameInput(e.target.value)}
                  placeholder="e.g. History Gifts Guide or Astronomy Gifts"
                  className="sog-input font-semibold"
                  autoFocus
                />
              </div>

              <div>
                <label className="sog-label">Storefront Base URL (for relative images)</label>
                <input
                  type="text"
                  value={newProjectBaseUrlInput}
                  onChange={(e) => setNewProjectBaseUrlInput(e.target.value)}
                  placeholder="https://scienceofgifts.com"
                  className="sog-input font-mono-tabular"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="sog-label">Starting HTML Source</label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setNewProjectTemplateMode('paste')}
                  className={`p-2.5 rounded-lg border text-left transition-colors ${
                    newProjectTemplateMode === 'paste'
                      ? 'bg-[#DFEEF5] border-[#82B3CC] text-[#111A27] font-semibold'
                      : 'bg-white border-[#DED8CA] text-[#334155]'
                  }`}
                >
                  Paste HTML Now
                </button>
                <button
                  type="button"
                  onClick={() => setNewProjectTemplateMode('blank')}
                  className={`p-2.5 rounded-lg border text-left transition-colors ${
                    newProjectTemplateMode === 'blank'
                      ? 'bg-[#DFEEF5] border-[#82B3CC] text-[#111A27] font-semibold'
                      : 'bg-white border-[#DED8CA] text-[#334155]'
                  }`}
                >
                  Blank Guide Container
                </button>
                <button
                  type="button"
                  onClick={() => setNewProjectTemplateMode('greek_sample')}
                  className={`p-2.5 rounded-lg border text-left transition-colors ${
                    newProjectTemplateMode === 'greek_sample'
                      ? 'bg-[#DFEEF5] border-[#82B3CC] text-[#111A27] font-semibold'
                      : 'bg-white border-[#DED8CA] text-[#334155]'
                  }`}
                >
                  Greek Mythology Template
                </button>
              </div>
            </div>

            {newProjectTemplateMode === 'paste' && (
              <div>
                <label className="sog-label">
                  Initial HTML (Optional — you can also add multiple sections later)
                </label>
                <textarea
                  rows={6}
                  value={newProjectPasteHtml}
                  onChange={(e) => setNewProjectPasteHtml(e.target.value)}
                  placeholder="Paste your first Fourthwall HTML section or full guide here..."
                  className="w-full p-3 bg-[#111926] text-[#E6EEF8] rounded-xl font-mono-tabular text-xs leading-relaxed focus:outline-none border border-[#2C3E58]"
                />
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowNewProjectModal(false)}
                className="sog-btn-secondary"
              >
                Cancel
              </button>
              <button type="submit" className="sog-btn-primary">
                <FilePlus2 className="w-3.5 h-3.5" />
                <span>Create &amp; Open Project</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 6: UNSAVED CHANGES GUARD WHEN SWITCHING OR CREATING PROJECTS */}
      {pendingProjectGuardAction && (
        <div className="fixed inset-0 z-50 bg-[#111A27]/60 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="bg-[#FBF9F5] border border-[#C6BEB0] rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl text-xs">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h2 className="text-base font-editorial font-semibold text-[#111A27]">
                  Unsaved Changes in &ldquo;{projectName}&rdquo;
                </h2>
                <p className="text-[#3E4C5E] leading-relaxed">
                  You have unsaved edits in your current project. Would you like to save them before{' '}
                  {pendingProjectGuardAction.type === 'new_project'
                    ? 'creating a new project'
                    : `switching to "${pendingProjectGuardAction.targetProject.name}"`}
                  ?
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPendingProjectGuardAction(null)}
                className="sog-btn-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const action = pendingProjectGuardAction;
                  setPendingProjectGuardAction(null);
                  if (action.type === 'open_project') {
                    applyProjectToWorkspace(action.targetProject);
                    setShowProjectsModal(false);
                    onShowToast?.(
                      `Discarded unsaved changes and opened "${action.targetProject.name}".`
                    );
                  } else {
                    setNewProjectNameInput('');
                    setNewProjectPasteHtml('');
                    setNewProjectTemplateMode('paste');
                    setNewProjectBaseUrlInput(projectBaseUrl || defaultBaseUrl);
                    setShowNewProjectModal(true);
                  }
                }}
                className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold"
              >
                Discard Unsaved Changes
              </button>
              <button
                type="button"
                onClick={async () => {
                  const savedOk = await performSaveActiveProject({ showToastOnSuccess: false });
                  if (!savedOk) {
                    setPendingProjectGuardAction(null);
                    return;
                  }
                  const action = pendingProjectGuardAction;
                  setPendingProjectGuardAction(null);
                  if (action.type === 'open_project') {
                    applyProjectToWorkspace(action.targetProject);
                    setShowProjectsModal(false);
                    onShowToast?.(`Saved changes and opened "${action.targetProject.name}".`);
                  } else {
                    setNewProjectNameInput('');
                    setNewProjectPasteHtml('');
                    setNewProjectTemplateMode('paste');
                    setNewProjectBaseUrlInput(projectBaseUrl || defaultBaseUrl);
                    setShowNewProjectModal(true);
                  }
                }}
                className="sog-btn-mint"
              >
                Save &amp; Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
