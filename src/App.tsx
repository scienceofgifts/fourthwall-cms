/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  LogIn,
  LogOut,
  CheckCircle2,
  Database,
  ShieldCheck,
  Code,
  Package,
  SlidersHorizontal,
  Sparkles,
  FileCode2,
} from 'lucide-react';
import {
  GiftGuide,
  GuideSection,
  Product,
  ProjectBackup,
  UserSettings,
} from './types/cms';
import {
  User,
  auth,
  createNewHtmlProject,
  deleteProductFromFirestore,
  ensureUserSettings,
  fetchGuideWithSections,
  loadLocalCatalogProducts,
  onAuthStateChanged,
  restoreProjectBackupToFirestore,
  saveCompleteGuideProject,
  saveLocalCatalogProducts,
  saveProductToFirestore,
  seedGreekMythologySampleProject,
  signInWithGooglePopup,
  signOutUser,
  subscribeToGuides,
  subscribeToProducts,
  updateUserSettings,
} from './services/firebase';
import {
  SEED_GREEK_GUIDE,
  SEED_GREEK_SECTIONS,
  SEED_PRODUCTS,
} from './data/greekMythologySeed';
import { checkAIServiceStatus } from './services/aiClient';
import {
  ConfiguredGeminiModelId,
  DEFAULT_GEMINI_MODEL_ID,
  GEMINI_MODEL_CHANGED_EVENT,
  GEMINI_MODEL_DEFINITIONS,
  MODEL_VERIFICATION_SUMMARY,
  formatGeminiModelLabel,
  getGeminiModelDefinition,
  getSavedGeminiModelPreference,
  resolveModelFallbackChain,
  saveGeminiModelPreference,
} from './services/geminiModelConfig';
import { ProductLibraryView } from './components/ProductLibraryView';
import { HtmlEditorWorkspace } from './components/HtmlEditorWorkspace';
import { ExportAndSchemaView } from './components/ExportAndSchemaView';
import { renderFullGuideHtml } from './services/htmlRenderer';
import { LOCKED_FOURTHWALL_CSS } from './constants/lockedCss';
import firebaseConfig from '../firebase-applet-config.json';

type NavView = 'products' | 'html_editor' | 'export_schema' | 'settings';

export default function App() {
  const [activeNav, setActiveNav] = useState<NavView>('products');
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);

  // Cloud / Local workspace data
  const [products, setProducts] = useState<Product[]>(() => {
    const cached = loadLocalCatalogProducts();
    if (cached && cached.length > 0) return cached;
    return SEED_PRODUCTS.map((p) => ({
      ...p,
      ownerId: 'local-preview',
      dataSource: 'seed' as const,
      fetchStatus: 'success' as const,
    }));
  });
  const [guides, setGuides] = useState<GiftGuide[]>([]);
  const [activeGuide, setActiveGuide] = useState<GiftGuide | null>(null);
  const [activeSections, setActiveSections] = useState<GuideSection[]>([]);
  const [seedingSample, setSeedingSample] = useState(false);

  // Save & Toast state
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // AI service status & persisted Gemini model preference
  const [aiStatus, setAiStatus] = useState<{ configured: boolean; model: string }>({
    configured: false,
    model: DEFAULT_GEMINI_MODEL_ID,
  });
  const [selectedGeminiModel, setSelectedGeminiModel] = useState<ConfiguredGeminiModelId>(() =>
    getSavedGeminiModelPreference()
  );

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3200);
  }, []);

  // Check AI service on mount & listen for model preference changes across components
  useEffect(() => {
    checkAIServiceStatus().then(setAiStatus);
    const syncModel = () => setSelectedGeminiModel(getSavedGeminiModelPreference());
    window.addEventListener(GEMINI_MODEL_CHANGED_EVENT, syncModel);
    return () => window.removeEventListener(GEMINI_MODEL_CHANGED_EVENT, syncModel);
  }, []);

  // Persist catalog in localStorage whenever products change so reloads preserve local work
  useEffect(() => {
    if (products.length > 0) {
      saveLocalCatalogProducts(products);
    }
  }, [products]);

  // Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (currUser) => {
      setUser(currUser);
      setAuthReady(true);
      if (currUser) {
        try {
          const settings = await ensureUserSettings(currUser);
          setUserSettings(settings);
        } catch (err) {
          console.error('Failed to initialize user settings:', err);
        }
      } else {
        const cached = loadLocalCatalogProducts();
        const localProds: Product[] =
          cached && cached.length > 0
            ? cached
            : SEED_PRODUCTS.map((p) => ({
                ...p,
                ownerId: 'local-preview',
                dataSource: 'seed' as const,
                fetchStatus: 'success' as const,
              }));
        const localGuide: GiftGuide = {
          ...SEED_GREEK_GUIDE,
          ownerId: 'local-preview',
        };
        const localSecs: GuideSection[] = SEED_GREEK_SECTIONS.map((s) => ({
          ...s,
          ownerId: 'local-preview',
        }));
        setProducts(localProds);
        setGuides([localGuide]);
        setActiveGuide(localGuide);
        setActiveSections(localSecs);
      }
    });
    return () => unsub();
  }, []);

  // Subscribe to Firestore products & guides when authenticated
  useEffect(() => {
    if (!authReady || !user) return;
    const unsubProducts = subscribeToProducts(user.uid, (items) => {
      if (items.length > 0) {
        setProducts(items);
        saveLocalCatalogProducts(items);
      }
    });
    const unsubGuides = subscribeToGuides(user.uid, (items) => {
      setGuides(items);
      if (items.length > 0 && !activeGuide) {
        setActiveGuide(items[0]);
      }
    });
    return () => {
      unsubProducts();
      unsubGuides();
    };
  }, [authReady, user, activeGuide]);

  // Product Catalog handlers (persisting both to localStorage and Cloud Firestore when signed in)
  const handleSaveProduct = async (
    prod: Omit<Product, 'ownerId' | 'createdAt' | 'updatedAt'>,
    isExisting: boolean
  ) => {
    const nowIso = new Date().toISOString();
    setProducts((prev) => {
      const exists = prev.some((p) => p.id === prod.id);
      const updatedRecord: Product = {
        ...prod,
        ownerId: user ? user.uid : 'local-preview',
        updatedAt: nowIso,
      };
      const next = exists
        ? prev.map((p) => (p.id === prod.id ? { ...p, ...updatedRecord } : p))
        : [updatedRecord, ...prev];
      saveLocalCatalogProducts(next);
      return next;
    });

    if (user) {
      await saveProductToFirestore(user.uid, prod, isExisting);
      showToast(`Saved "${prod.name}" to Product Catalog (Cloud + Local).`);
    } else {
      showToast(`Saved "${prod.name}" to Product Catalog.`);
    }
  };

  const handleBatchImportProducts = async (
    batch: Array<Omit<Product, 'ownerId' | 'createdAt' | 'updatedAt'>>
  ) => {
    const nowIso = new Date().toISOString();
    setProducts((prev) => {
      const map = new Map(prev.map((p) => [p.id, p]));
      batch.forEach((b) =>
        map.set(b.id, {
          ...b,
          ownerId: user ? user.uid : 'local-preview',
          updatedAt: nowIso,
        })
      );
      const next = Array.from(map.values());
      saveLocalCatalogProducts(next);
      return next;
    });

    if (user) {
      for (const item of batch) {
        await saveProductToFirestore(user.uid, item, true);
      }
      showToast(`Imported ${batch.length} products into Cloud Firestore & Local Catalog.`);
    } else {
      showToast(`Imported ${batch.length} products into Product Catalog.`);
    }
  };

  const handleDeleteProduct = async (productId: string) => {
    setProducts((prev) => {
      const next = prev.filter((p) => p.id !== productId);
      saveLocalCatalogProducts(next);
      return next;
    });
    if (user) {
      await deleteProductFromFirestore(user.uid, productId);
    }
    showToast('Deleted product from catalog.');
  };

  const handleSeedGreekMythology = async () => {
    if (!user) {
      const seeded = SEED_PRODUCTS.map((p) => ({
        ...p,
        ownerId: 'local-preview',
        dataSource: 'seed' as const,
        fetchStatus: 'success' as const,
      }));
      setProducts((prev) => {
        const map = new Map(prev.map((p) => [p.id, p]));
        seeded.forEach((s) => map.set(s.id, s));
        const next = Array.from(map.values());
        saveLocalCatalogProducts(next);
        return next;
      });
      showToast('Loaded 18 Greek Mythology reference products into Product Catalog.');
      return;
    }
    setSeedingSample(true);
    try {
      await seedGreekMythologySampleProject(user.uid);
      showToast('Seeded 18 Greek Mythology products & reference guide to Cloud Firestore.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to seed reference catalog.');
    } finally {
      setSeedingSample(false);
    }
  };

  const handleSaveActiveGuideNow = useCallback(async () => {
    if (!activeGuide || !user) return;
    await saveCompleteGuideProject(user.uid, activeGuide, activeSections, []);
    showToast('Saved guide metadata & schema settings to Cloud Firestore.');
  }, [activeGuide, activeSections, user, showToast]);

  const handleRestoreProjectBackup = async (
    backup: ProjectBackup,
    includeProducts: boolean
  ) => {
    if (includeProducts && backup.products?.length) {
      await handleBatchImportProducts(backup.products);
    }
    if (!user) {
      const restoredGuide: GiftGuide = { ...backup.guide, ownerId: 'local-preview' };
      const restoredSecs: GuideSection[] = backup.sections.map((s) => ({
        ...s,
        ownerId: 'local-preview',
      }));
      setGuides((prev) => [
        ...prev.filter((g) => g.id !== restoredGuide.id),
        restoredGuide,
      ]);
      setActiveGuide(restoredGuide);
      setActiveSections(restoredSecs);
      showToast(`Restored "${restoredGuide.title}" in local session.`);
      return;
    }
    const guideId = await restoreProjectBackupToFirestore(
      user.uid,
      backup,
      includeProducts
    );
    const { guide, sections } = await fetchGuideWithSections(user.uid, guideId);
    setActiveGuide(guide);
    setActiveSections(sections);
    showToast(`Restored "${backup.guide.title}" to Cloud Firestore.`);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#FBF9F5] text-[#111A27]">
      {/* STREAMLINED TOP NAVIGATION: Brand | 2 Core Workspaces + Compact Utilities | Auth Action */}
      <header className="flex items-center justify-between gap-6 px-6 py-3 bg-[#111A27] text-white border-b border-[#25354C] sticky top-0 z-40">
        {/* Zone 1: Brand Wordmark */}
        <div className="flex items-center gap-3 shrink-0">
          <a
            href="#products"
            onClick={(e) => {
              e.preventDefault();
              setActiveNav('products');
            }}
            className="text-lg font-editorial font-bold tracking-tight text-[#FBF9F5] whitespace-nowrap"
          >
            Science of Gifts
          </a>
          <span className="hidden md:inline-block text-[11px] text-[#8FA4BE] border-l border-[#2C3E58] pl-3">
            Product Catalog &amp; HTML Workspace
          </span>
        </div>

        {/* Zone 2: Primary Navigation Destinations */}
        <nav className="flex items-center gap-1.5 text-xs font-medium overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveNav('products')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeNav === 'products'
                ? 'bg-[#DFEEF5] text-[#111A27] font-semibold shadow-2xs'
                : 'text-[#C6D3E3] hover:text-white hover:bg-[#1B293E]'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            <span>Products ({products.filter((p) => !p.archived).length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveNav('html_editor')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeNav === 'html_editor'
                ? 'bg-[#DFEEF5] text-[#111A27] font-semibold shadow-2xs'
                : 'text-[#C6D3E3] hover:text-white hover:bg-[#1B293E]'
            }`}
          >
            <FileCode2 className="w-3.5 h-3.5" />
            <span>HTML Editor</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveNav('export_schema')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeNav === 'export_schema'
                ? 'bg-[#DFEEF5] text-[#111A27] font-semibold'
                : 'text-[#9BB0C9] hover:text-white hover:bg-[#1B293E]'
            }`}
            title="JSON-LD @graph Schema & Project Backups"
          >
            <Code className="w-3.5 h-3.5" />
            <span>Schema &amp; Backups</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveNav('settings')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeNav === 'settings'
                ? 'bg-[#DFEEF5] text-[#111A27] font-semibold'
                : 'text-[#9BB0C9] hover:text-white hover:bg-[#1B293E]'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Settings</span>
          </button>
        </nav>

        {/* Zone 3: Quick Workflow Switch / Cloud Auth */}
        <div className="flex items-center gap-2.5 shrink-0">
          {user ? (
            <div className="flex items-center gap-2">
              <span className="hidden lg:inline-block text-[11px] text-[#96CDB0] font-medium">
                Cloud Synced ({user.email?.split('@')[0]})
              </span>
              <button
                type="button"
                onClick={signOutUser}
                className="px-2.5 py-1.5 text-xs font-medium text-[#C6D3E3] hover:text-white bg-[#1B293E] rounded-md transition-colors"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={async () => {
                setAuthError(null);
                try {
                  await signInWithGooglePopup();
                } catch (err) {
                  setAuthError(err instanceof Error ? err.message : 'Google Sign-In failed.');
                }
              }}
              className="px-3.5 py-1.5 text-xs font-semibold text-[#111A27] bg-[#DFEEF5] border border-[#94C0D6] rounded-lg hover:bg-[#CBE3EE] transition-colors whitespace-nowrap shrink-0"
            >
              Sign In with Google
            </button>
          )}
        </div>
      </header>

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 bg-[#111A27] text-white px-4 py-2.5 rounded-lg shadow-lg text-xs font-medium flex items-center gap-2 border border-[#2C3E58]">
          <CheckCircle2 className="w-4 h-4 text-[#7AD3A8] shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Compact Persistence Status Banner when Signed Out */}
      {authReady && !user && (
        <div className="bg-[#DFEEF5] border-b border-[#A8CBE0] px-6 py-1.5 flex flex-wrap items-center justify-between gap-3 text-[11px] text-[#123E59]">
          <div className="flex items-center gap-2">
            <Database className="w-3.5 h-3.5 shrink-0" />
            <span>
              <strong>Local Storage Active:</strong> Your Product Catalog and HTML Editor workspace
              persist automatically in this browser. Sign in with Google anytime to sync across
              devices via Cloud Firestore.
            </span>
          </div>
          {authError && <span className="text-red-700 font-semibold">{authError}</span>}
        </div>
      )}

      {/* DESTINATION 1: PRODUCT CATALOG & BRIEF GENERATOR */}
      {activeNav === 'products' && (
        <ProductLibraryView
          products={products}
          onSaveProduct={handleSaveProduct}
          onDeleteProduct={handleDeleteProduct}
          onBatchImportProducts={handleBatchImportProducts}
        />
      )}

      {/* DESTINATION 2: HTML EDITING WORKSPACE */}
      {activeNav === 'html_editor' && (
        <HtmlEditorWorkspace
          products={products}
          userId={user?.uid}
          defaultBaseUrl={userSettings?.defaultStoreBaseUrl || 'https://scienceofgifts.com'}
          savedGuides={guides}
          onShowToast={showToast}
        />
      )}

      {/* UTILITY 3: JSON-LD SCHEMA & PROJECT BACKUPS */}
      {activeNav === 'export_schema' && (
        <ExportAndSchemaView
          guide={
            activeGuide || {
              ...SEED_GREEK_GUIDE,
              ownerId: user ? user.uid : 'local-preview',
            }
          }
          sections={
            activeSections.length > 0
              ? activeSections
              : SEED_GREEK_SECTIONS.map((s) => ({
                  ...s,
                  ownerId: user ? user.uid : 'local-preview',
                }))
          }
          products={products}
          onUpdateGuide={(updated) => setActiveGuide(updated)}
          onSaveGuideNow={handleSaveActiveGuideNow}
          onRestoreBackup={handleRestoreProjectBackup}
        />
      )}

      {/* UTILITY 4: SETTINGS & CLOUD CONNECTION STATUS */}
      {activeNav === 'settings' && (
        <div className="max-w-4xl mx-auto w-full px-6 py-8 space-y-6 text-xs">
          <div className="border-b border-[#DED8CA] pb-4 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.14em] text-[#1A567B] font-bold">
                Workspace Configuration &amp; Cloud Sync
              </p>
              <h1 className="text-3xl font-editorial font-semibold text-[#111A27] mt-1">
                Settings &amp; Reference Data
              </h1>
            </div>

            <button
              type="button"
              onClick={handleSeedGreekMythology}
              disabled={seedingSample}
              className="sog-btn-powder"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>
                {seedingSample
                  ? 'Seeding Reference Catalog...'
                  : 'Restore 18 Greek Mythology Reference Products'}
              </span>
            </button>
          </div>

          {/* Gemini AI Model Selector & Bounded Fallback Configuration Card */}
          <div className="bg-white border border-[#DED8CA] rounded-xl p-6 space-y-4 shadow-2xs">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#EAE4D8] pb-4">
              <div className="space-y-1">
                <h2 className="text-base font-editorial font-semibold text-[#111A27] flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#1A567B]" />
                  <span>Gemini AI Model &amp; Bounded Fallback Configuration</span>
                </h2>
                <p className="text-[#3E4C5E]">
                  Choose the primary Gemini model used across all AI-powered editorial and extraction
                  features. Your selection persists across reloads.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`px-2.5 py-1 rounded-md font-semibold text-[11px] border ${
                    aiStatus.configured
                      ? 'bg-[#E1F2EA] text-[#134634] border-[#96CDB0]'
                      : 'bg-amber-50 text-amber-900 border-amber-200'
                  }`}
                >
                  {aiStatus.configured ? 'Server API Key Ready' : 'Server API Key Standby'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
              <div>
                <label htmlFor="gemini-model-selector" className="sog-label">
                  Active Primary Gemini Model
                </label>
                <select
                  id="gemini-model-selector"
                  aria-label="Gemini Model Selector"
                  value={selectedGeminiModel}
                  onChange={(e) => {
                    const updated = saveGeminiModelPreference(
                      e.target.value as ConfiguredGeminiModelId
                    );
                    setSelectedGeminiModel(updated);
                    showToast(
                      `Saved Gemini model preference: ${formatGeminiModelLabel(updated)} (${updated}).`
                    );
                  }}
                  className="sog-select font-semibold"
                >
                  {GEMINI_MODEL_DEFINITIONS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.fallbackOrderIndex ? `${m.fallbackOrderIndex}. ` : ''}
                      {m.label} ({m.id}) — {m.roleLabel}
                    </option>
                  ))}
                </select>
              </div>

              <div className="p-3 bg-[#F7F4EC] border border-[#DED8CA] rounded-lg space-y-1">
                <p className="text-[11px] font-semibold text-[#111A27]">
                  Currently Selected Model:{' '}
                  <span className="text-[#1A567B]">
                    {formatGeminiModelLabel(selectedGeminiModel)}
                  </span>{' '}
                  (<code className="font-mono-tabular">{selectedGeminiModel}</code>)
                </p>
                <p className="text-[11px] text-[#5E6B7C]">
                  {getGeminiModelDefinition(selectedGeminiModel).verificationNote}
                </p>
              </div>
            </div>

            {/* Active Bounded Fallback Sequence */}
            <div className="p-3.5 bg-[#EFF6FA] border border-[#B5D5E6] rounded-lg space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#123E59]">
                  Active Request &amp; Fallback Order (Max 1 Attempt per Model)
                </span>
                {selectedGeminiModel !== DEFAULT_GEMINI_MODEL_ID && (
                  <button
                    type="button"
                    onClick={() => {
                      const reset = saveGeminiModelPreference(DEFAULT_GEMINI_MODEL_ID);
                      setSelectedGeminiModel(reset);
                      showToast('Reset Gemini model preference to Gemini 3.5 Flash Lite (default).');
                    }}
                    className="text-[11px] font-semibold text-[#1A567B] hover:underline"
                  >
                    Reset to Default (Gemini 3.5 Flash Lite)
                  </button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {resolveModelFallbackChain(selectedGeminiModel).map((modelId, index) => {
                  const def = getGeminiModelDefinition(modelId);
                  return (
                    <React.Fragment key={modelId}>
                      <div
                        className={`px-2.5 py-1.5 rounded-md border text-[11px] ${
                          index === 0
                            ? 'bg-[#111A27] text-white border-[#111A27] font-semibold'
                            : 'bg-white text-[#111A27] border-[#C5DCE8]'
                        }`}
                      >
                        <span>
                          {index === 0 ? 'Primary: ' : `Fallback ${index}: `}
                          {def.label}
                        </span>{' '}
                        <code className="font-mono-tabular opacity-80">({def.id})</code>
                      </div>
                      {index < resolveModelFallbackChain(selectedGeminiModel).length - 1 && (
                        <span className="text-[#5E6B7C] font-bold">→</span>
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
              <p className="text-[11px] text-[#334155] leading-relaxed">
                {MODEL_VERIFICATION_SUMMARY}
              </p>
            </div>
          </div>

          {/* Account & Firebase Connection Card */}
          <div className="bg-white border border-[#DED8CA] rounded-xl p-6 space-y-4 shadow-2xs">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#EAE4D8] pb-4">
              <div className="space-y-1">
                <h2 className="text-base font-editorial font-semibold text-[#111A27] flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[#1D634B]" />
                  <span>Firebase Authentication &amp; Cloud Firestore</span>
                </h2>
                <p className="text-[#3E4C5E]">
                  Project ID: <code className="font-mono-tabular">{firebaseConfig.projectId}</code> ·
                  Database ID:{' '}
                  <code className="font-mono-tabular">{firebaseConfig.firestoreDatabaseId}</code> ·
                  Selected AI Model:{' '}
                  <code className="font-mono-tabular">{selectedGeminiModel}</code>
                </p>
              </div>

              {user ? (
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="font-semibold text-[#111A27]">{user.displayName || user.email}</p>
                    <p className="text-[#5E6B7C]">{user.email}</p>
                  </div>
                  <button
                    type="button"
                    onClick={signOutUser}
                    className="sog-btn-secondary"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign Out</span>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={signInWithGooglePopup}
                  className="sog-btn-primary"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>Sign In with Google</span>
                </button>
              )}
            </div>

            {user && userSettings && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  await updateUserSettings(user.uid, {
                    displayName: userSettings.displayName,
                    defaultStoreBaseUrl: userSettings.defaultStoreBaseUrl,
                  });
                  showToast('Saved workspace defaults to Firestore.');
                }}
                className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2"
              >
                <div>
                  <label className="sog-label">Editor Display Name</label>
                  <input
                    type="text"
                    value={userSettings.displayName}
                    onChange={(e) =>
                      setUserSettings({ ...userSettings, displayName: e.target.value })
                    }
                    className="sog-input"
                  />
                </div>
                <div>
                  <label className="sog-label">Default Fourthwall Storefront Base URL</label>
                  <input
                    type="text"
                    value={userSettings.defaultStoreBaseUrl}
                    onChange={(e) =>
                      setUserSettings({
                        ...userSettings,
                        defaultStoreBaseUrl: e.target.value,
                      })
                    }
                    className="sog-input font-mono-tabular"
                  />
                </div>
                <div className="md:col-span-2 flex justify-end">
                  <button type="submit" className="sog-btn-mint">
                    Save Workspace Defaults
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Saved Cloud Gift Guide Projects (Backward Compatibility Access) */}
          {guides.length > 0 && (
            <div className="bg-white border border-[#DED8CA] rounded-xl p-6 space-y-3 shadow-2xs">
              <h2 className="text-base font-editorial font-semibold text-[#111A27]">
                Saved Cloud Gift Guides ({guides.length})
              </h2>
              <p className="text-[#3E4C5E]">
                Your previously saved gift guides remain intact. You can copy their full HTML into
                the HTML Editor at any time.
              </p>
              <div className="divide-y divide-[#EAE4D8]">
                {guides.map((g) => (
                  <div
                    key={g.id}
                    className="py-3 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div>
                      <p className="font-semibold text-[#111A27]">{g.title}</p>
                      <p className="text-[11px] text-[#5E6B7C] font-mono-tabular">
                        {g.canonicalUrl} · {g.sectionCount} sections
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        let secs = activeSections;
                        if (user) {
                          const loaded = await fetchGuideWithSections(user.uid, g.id);
                          secs = loaded.sections;
                        }
                        const html = renderFullGuideHtml(secs, products, { forPreview: false });
                        await createNewHtmlProject({
                          name: g.title || 'Imported Cloud Guide',
                          htmlContent: html,
                          baseUrl:
                            userSettings?.defaultStoreBaseUrl || 'https://scienceofgifts.com',
                          userId: user?.uid,
                        });
                        setActiveNav('html_editor');
                        showToast(`Opened "${g.title}" as a saved project in the HTML Editor.`);
                      }}
                      className="sog-btn-powder"
                    >
                      <FileCode2 className="w-3.5 h-3.5" />
                      <span>Open HTML in Editor</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Locked Fourthwall Header CSS Reference */}
          <div className="bg-white border border-[#DED8CA] rounded-xl p-6 space-y-3 shadow-2xs">
            <h2 className="text-base font-editorial font-semibold text-[#111A27]">
              Locked Fourthwall Header CSS Contract (Read-Only Reference)
            </h2>
            <p className="text-[#3E4C5E]">
              This stylesheet is installed in your Fourthwall site header. The HTML Editor uses it
              exclusively inside the isolated Live Preview iframe and never injects it into your
              exported HTML output.
            </p>
            <pre className="p-4 bg-[#111926] text-[#E6EEF8] rounded-xl font-mono-tabular text-[11px] overflow-x-auto max-h-64 leading-relaxed">
              {`<style>${LOCKED_FOURTHWALL_CSS}</style>`}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
