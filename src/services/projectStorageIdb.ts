import {
  FourthwallHeaderCssSetting,
  HtmlEditorProject,
  HtmlProjectEditorState,
  HtmlProjectSection,
  HtmlProjectSyncStatus,
  HtmlSectionCategory,
  Product,
  ProductImageMappingRecord,
  StorageFailureCategory,
} from '../types/cms';
import {
  DEFAULT_GIFT_GUIDE_CSS,
  ensureProjectHasSections,
  normalizeHeaderCssInput,
  registerFourthwallHeaderCssProvider,
} from './htmlWorkspaceEngine';

export const IDB_DATABASE_NAME = 'sog_cms_idb_v1';
export const IDB_DATABASE_VERSION = 2;
export const IDB_HTML_PROJECTS_STORE = 'html_projects';
export const IDB_IMAGE_MAPPINGS_STORE = 'image_mappings';
export const IDB_METADATA_STORE = 'cms_metadata';
export const IDB_CATALOG_PRODUCTS_STORE = 'catalog_products';

export const LEGACY_LOCAL_HTML_PROJECTS_KEY = 'sog_html_projects_v1';
export const LOCAL_ACTIVE_HTML_PROJECT_ID_KEY = 'sog_html_active_project_id_v1';
export const LOCAL_HTML_PROJECTS_MIGRATED_KEY = 'sog_html_projects_idb_migrated_v1';
export const LOCAL_PRODUCTS_STORAGE_KEY = 'sog_catalog_products_v2';
export const LOCAL_CATALOG_PRODUCTS_MIGRATED_KEY = 'sog_catalog_products_idb_migrated_v1';
export const GLOBAL_FOURTHWALL_HEADER_CSS_KEY = 'sog_cms_fourthwall_header_css_v1';
export const FOURTHWALL_HEADER_CSS_UPDATED_EVENT = 'sog-fourthwall-header-css-updated';

/**
 * Threshold for a single string field inside a single Firestore document before chunking.
 * Never applied to local IndexedDB storage or section/CSS normalization.
 */
export const MAX_SINGLE_HTML_FIELD_CHARS = 400_000;

const LEGACY_SESSION_KEY_V2 = 'sog_html_workspace_session_v2';
const LEGACY_CURRENT_HTML_KEY = 'sog_html_workspace_v2_current';
const LEGACY_ORIGINAL_HTML_KEY = 'sog_html_workspace_v2_original';

const ALLOWED_SECTION_CATEGORIES = new Set<HtmlSectionCategory>([
  'toc',
  'quick_picks',
  'editors_pick',
  'editorial_list',
  'product_grid',
  'single_product_card',
  'category_hub',
  'buying_guide',
  'faq_section',
  'related_guides',
  'content_section',
  'raw_fallback',
]);

export const DEFAULT_HTML_EDITOR_STATE: HtmlProjectEditorState = {
  viewMode: 'split',
  selectedBlockId: 'ALL',
  previewViewport: 'desktop',
  includeFourthwallCss: true,
  customCss: DEFAULT_GIFT_GUIDE_CSS,
};

// ============================================================================
// STRUCTURED STORAGE DIAGNOSTIC ERRORS
// ============================================================================

export class StorageDiagnosticError extends Error {
  readonly category: StorageFailureCategory;

  constructor(category: StorageFailureCategory, message: string) {
    super(message);
    this.name = 'StorageDiagnosticError';
    this.category = category;
  }
}

function scrubSensitiveDiagnostics(rawMessage: string): string {
  return rawMessage
    .replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/gi, 'Bearer [REDACTED_TOKEN]')
    .replace(
      /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
      '[REDACTED_TOKEN]'
    )
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[REDACTED_API_KEY]');
}

export function classifyStorageFailure(
  error: unknown,
  layer: 'idb' | 'localStorage' | 'firestore' | 'migration' | 'validation'
): StorageDiagnosticError {
  const rawMsg = scrubSensitiveDiagnostics(
    error instanceof Error ? error.message : String(error ?? 'Unknown storage error')
  );

  if (layer === 'migration') {
    return new StorageDiagnosticError(
      'migration_failure',
      rawMsg.startsWith('Migration failure:') ? rawMsg : `Migration failure: ${rawMsg}`
    );
  }

  if (error instanceof StorageDiagnosticError) {
    return error;
  }

  const lower = rawMsg.toLowerCase();

  if (layer === 'validation') {
    return new StorageDiagnosticError('validation_error', rawMsg);
  }

  if (layer === 'firestore') {
    if (
      lower.includes('maximum allowed size') ||
      lower.includes('exceeds the maximum') ||
      lower.includes('document too large') ||
      lower.includes('1048576') ||
      lower.includes('400000') ||
      lower.includes('size limit') ||
      lower.includes('payload size')
    ) {
      return new StorageDiagnosticError(
        'firestore_size_limit',
        `Firestore size limit: ${rawMsg}`
      );
    }
    return new StorageDiagnosticError(
      'firestore_permission_or_network',
      `Firestore permission or network failure: ${rawMsg}`
    );
  }

  if (layer === 'localStorage') {
    return new StorageDiagnosticError(
      'legacy_localstorage_quota',
      `Legacy localStorage quota: ${rawMsg}`
    );
  }

  // IndexedDB layer classification
  if (
    lower.includes('quotaexceeded') ||
    lower.includes('quota exceeded') ||
    lower.includes('disk full') ||
    lower.includes('not enough space') ||
    lower.includes('storage quota')
  ) {
    return new StorageDiagnosticError(
      'idb_quota_exceeded',
      `IndexedDB quota exceeded: Browser disk storage limit was reached while saving (${rawMsg}).`
    );
  }

  if (
    lower.includes('verification failed') ||
    lower.includes('did not match') ||
    lower.includes('could not be verified')
  ) {
    return new StorageDiagnosticError(
      'migration_failure',
      rawMsg.startsWith('Migration failure:') || rawMsg.startsWith('IndexedDB')
        ? rawMsg
        : `Migration failure: ${rawMsg}`
    );
  }

  return new StorageDiagnosticError(
    'idb_unavailable',
    rawMsg.startsWith('IndexedDB') || rawMsg.startsWith('Failed to persist project to browser storage')
      ? rawMsg
      : `IndexedDB unavailable: ${rawMsg}`
  );
}

// ============================================================================
// NON-TRUNCATED PROJECT & SECTION NORMALIZATION
// ============================================================================

export function sanitizeProjectSections(rawSections?: unknown): HtmlProjectSection[] | undefined {
  if (!Array.isArray(rawSections)) return undefined;
  const nowIso = new Date().toISOString();
  const result: HtmlProjectSection[] = [];
  for (let i = 0; i < Math.min(rawSections.length, 1000); i++) {
    const item = rawSections[i];
    if (!item || typeof item !== 'object') continue;
    const rec = item as Partial<HtmlProjectSection>;
    if (typeof rec.htmlContent !== 'string') continue;
    const cleanId =
      typeof rec.id === 'string' && rec.id.trim() ? rec.id.trim().slice(0, 120) : `sec-${i + 1}`;
    const cleanName =
      typeof rec.name === 'string' && rec.name.trim()
        ? rec.name.trim().slice(0, 200)
        : `Section ${i + 1}`;
    const cleanType: HtmlSectionCategory =
      typeof rec.type === 'string' && ALLOWED_SECTION_CATEGORIES.has(rec.type as HtmlSectionCategory)
        ? (rec.type as HtmlSectionCategory)
        : 'content_section';
    const cleanManualType: HtmlSectionCategory | undefined =
      typeof rec.manualType === 'string' &&
      ALLOWED_SECTION_CATEGORIES.has(rec.manualType as HtmlSectionCategory)
        ? (rec.manualType as HtmlSectionCategory)
        : undefined;
    const cleanStartNum =
      typeof rec.startingProductNumber === 'number' &&
      Number.isInteger(rec.startingProductNumber) &&
      rec.startingProductNumber >= 1
        ? rec.startingProductNumber
        : undefined;

    // Never truncate section htmlContent or originalHtml
    const sectionRecord: HtmlProjectSection = {
      id: cleanId,
      name: cleanName,
      order: i,
      htmlContent: rec.htmlContent,
      originalHtml:
        typeof rec.originalHtml === 'string' ? rec.originalHtml : rec.htmlContent,
      type: cleanManualType || cleanType,
      ...(cleanManualType ? { manualType: cleanManualType } : {}),
      ...(cleanStartNum !== undefined ? { startingProductNumber: cleanStartNum } : {}),
      createdAt: typeof rec.createdAt === 'string' && rec.createdAt ? rec.createdAt : nowIso,
      updatedAt: typeof rec.updatedAt === 'string' && rec.updatedAt ? rec.updatedAt : nowIso,
    };
    result.push(sectionRecord);
  }
  return result;
}

export function normalizeEditorState(
  raw?: Partial<HtmlProjectEditorState>,
  fallbackSections?: HtmlProjectSection[],
  fallbackCustomCss?: string
): HtmlProjectEditorState {
  const sanitizedStartingNumbers: Record<string, number> = {};
  if (raw?.sectionStartingNumbers && typeof raw.sectionStartingNumbers === 'object') {
    const entries = Object.entries(raw.sectionStartingNumbers).slice(0, 500);
    for (const [key, val] of entries) {
      if (
        typeof key === 'string' &&
        key.trim() &&
        typeof val === 'number' &&
        Number.isInteger(val) &&
        val >= 1
      ) {
        sanitizedStartingNumbers[key.trim().slice(0, 160)] = val;
      }
    }
  }

  const sanitizedSections = sanitizeProjectSections(raw?.sections ?? fallbackSections);
  const rawCss =
    typeof raw?.customCss === 'string'
      ? raw.customCss
      : typeof fallbackCustomCss === 'string'
      ? fallbackCustomCss
      : DEFAULT_GIFT_GUIDE_CSS;

  return {
    viewMode:
      raw?.viewMode === 'split' ||
      raw?.viewMode === 'visual' ||
      raw?.viewMode === 'raw' ||
      raw?.viewMode === 'css' ||
      raw?.viewMode === 'images' ||
      raw?.viewMode === 'preview'
        ? raw.viewMode
        : 'split',
    selectedBlockId:
      typeof raw?.selectedBlockId === 'string' && raw.selectedBlockId ? raw.selectedBlockId : 'ALL',
    sidebarTab: raw?.sidebarTab === 'anchors' ? 'anchors' : 'blocks',
    previewViewport: raw?.previewViewport === 'mobile' ? 'mobile' : 'desktop',
    includeFourthwallCss: raw?.includeFourthwallCss !== false,
    customCss: rawCss,
    ...(Object.keys(sanitizedStartingNumbers).length > 0
      ? { sectionStartingNumbers: sanitizedStartingNumbers }
      : {}),
    ...(sanitizedSections !== undefined ? { sections: sanitizedSections } : {}),
  };
}

export function normalizeStoredProjectRecord(item: any): HtmlEditorProject | null {
  if (
    !item ||
    typeof item !== 'object' ||
    typeof item.id !== 'string' ||
    !item.id.trim() ||
    typeof item.name !== 'string' ||
    typeof item.currentHtml !== 'string'
  ) {
    return null;
  }

  const normalizedEditorState = normalizeEditorState(
    item.editorState,
    item.sections,
    typeof item.customCss === 'string' ? item.customCss : undefined
  );

  const hydrated = ensureProjectHasSections({
    id: item.id,
    ownerId: typeof item.ownerId === 'string' ? item.ownerId : 'local-preview',
    name: item.name,
    currentHtml: item.currentHtml,
    originalHtml: typeof item.originalHtml === 'string' ? item.originalHtml : item.currentHtml,
    baseUrl: typeof item.baseUrl === 'string' ? item.baseUrl : 'https://scienceofgifts.com',
    customCss: normalizedEditorState.customCss,
    sections: normalizedEditorState.sections,
    editorState: normalizedEditorState,
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
    ...(item.syncStatus ? { syncStatus: item.syncStatus } : {}),
    ...(typeof item.syncDiagnostic === 'string' ? { syncDiagnostic: item.syncDiagnostic } : {}),
    ...(typeof item.pendingCloudSync === 'boolean'
      ? { pendingCloudSync: item.pendingCloudSync }
      : {}),
    ...(typeof item.lastCloudSyncedAt === 'string'
      ? { lastCloudSyncedAt: item.lastCloudSyncedAt }
      : {}),
  });

  return hydrated;
}

// ============================================================================
// SPEC-COMPLIANT INDEXEDDB ENGINE & CONTEXT CACHE
// ============================================================================

interface MetadataRecord {
  key: string;
  value: any;
  updatedAt: string;
}

interface StorageContextState {
  projectsMap: Map<string, HtmlEditorProject>;
  imageMappingsMap: Map<string, ProductImageMappingRecord>;
  catalogProductsMap: Map<string, Product>;
  metadataMap: Map<string, MetadataRecord>;
  activeProjectId: string | null;
  migrated: boolean;
  catalogMigrated: boolean;
  fallbackIdbFactory?: IDBFactory;
}

const contextByWindow = new WeakMap<object, StorageContextState>();
const defaultGlobalKey = {};

function getActiveWindowObject(): any {
  if (typeof window !== 'undefined' && window) {
    return window;
  }
  return defaultGlobalKey;
}

function getContextState(): StorageContextState {
  const winObj = getActiveWindowObject();
  let state = contextByWindow.get(winObj);
  if (!state) {
    state = {
      projectsMap: new Map<string, HtmlEditorProject>(),
      imageMappingsMap: new Map<string, ProductImageMappingRecord>(),
      catalogProductsMap: new Map<string, Product>(),
      metadataMap: new Map<string, MetadataRecord>(),
      activeProjectId: null,
      migrated: false,
      catalogMigrated: false,
    };
    contextByWindow.set(winObj, state);
  }
  return state;
}

export type SimulatedIdbFailureMode =
  | 'none'
  | 'unavailable'
  | 'blocked'
  | 'transaction_error'
  | 'quota_exceeded'
  | 'verification_mismatch';

let simulatedIdbFailure: SimulatedIdbFailureMode = 'none';

export function setSimulatedIdbFailureForTesting(mode: SimulatedIdbFailureMode): void {
  simulatedIdbFailure = mode;
}

export function getSimulatedIdbFailureForTesting(): SimulatedIdbFailureMode {
  return simulatedIdbFailure;
}

/**
 * Creates a realistic spec-compliant `IDBFactory` backed by serialized structured-clone storage.
 * Used in automated tests (or when a custom quota limit is tested) so every read/write executes
 * real `open()`, `onupgradeneeded`, `transaction()`, `objectStore()`, `put()`, `get()`, `getAll()`, and `delete()` steps.
 */
export function createMockIndexedDbFactory(options?: {
  maxTotalBytes?: number;
  initialStores?: Record<string, Map<string, string>>;
}): IDBFactory {
  const dbStores = new Map<string, Map<string, Map<string, string>>>();
  const dbVersions = new Map<string, number>();

  if (options?.initialStores) {
    const prefilled = new Map<string, Map<string, string>>();
    for (const [storeName, records] of Object.entries(options.initialStores)) {
      prefilled.set(storeName, new Map(records));
    }
    dbStores.set(IDB_DATABASE_NAME, prefilled);
  }

  const measureTotalBytes = (targetDb: Map<string, Map<string, string>>): number => {
    let total = 0;
    for (const storeMap of targetDb.values()) {
      for (const serialized of storeMap.values()) {
        total += serialized.length;
      }
    }
    return total;
  };

  const factory: any = {
    open(name: string, version = 1): IDBOpenDBRequest {
      const req: any = {
        result: null,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        onblocked: null,
      };

      queueMicrotask(() => {
        if (simulatedIdbFailure === 'unavailable') {
          req.error = new Error('IndexedDB unavailable: database access is disabled.');
          if (typeof req.onerror === 'function') req.onerror({ target: req });
          return;
        }
        if (simulatedIdbFailure === 'blocked') {
          if (typeof req.onblocked === 'function') req.onblocked({ target: req });
          return;
        }

        let storesForDb = dbStores.get(name);
        const currentVer = dbVersions.get(name) || 0;
        if (!storesForDb) {
          storesForDb = new Map<string, Map<string, string>>();
          dbStores.set(name, storesForDb);
        }

        const objectStoreNames = {
          contains: (storeName: string) => storesForDb!.has(storeName),
        };

        const dbInstance: any = {
          name,
          version: Math.max(version, currentVer || 1),
          objectStoreNames,
          createObjectStore(storeName: string) {
            if (!storesForDb!.has(storeName)) {
              storesForDb!.set(storeName, new Map<string, string>());
            }
            return {};
          },
          close() {},
          transaction(storeNames: string | string[], mode: IDBTransactionMode = 'readonly') {
            const tx: any = {
              mode,
              error: null,
              oncomplete: null,
              onerror: null,
              onabort: null,
              objectStore(storeName: string) {
                if (!storesForDb!.has(storeName)) {
                  storesForDb!.set(storeName, new Map<string, string>());
                }
                const backingMap = storesForDb!.get(storeName)!;

                return {
                  put(value: any) {
                    const putReq: any = { result: undefined, error: null, onsuccess: null, onerror: null };
                    try {
                      if (simulatedIdbFailure === 'transaction_error') {
                        throw new Error('IndexedDB readwrite transaction aborted.');
                      }
                      if (simulatedIdbFailure === 'quota_exceeded') {
                        throw new Error('QuotaExceededError: IndexedDB storage quota exceeded.');
                      }
                      const keyField = storeName === IDB_METADATA_STORE ? 'key' : 'id';
                      const recordKey = String(value?.[keyField] ?? '');
                      if (!recordKey) {
                        throw new Error(`Missing keyPath "${keyField}" on IndexedDB record.`);
                      }
                      const serialized = JSON.stringify(value);
                      if (options?.maxTotalBytes) {
                        const existingLen = backingMap.get(recordKey)?.length || 0;
                        const nextTotal =
                          measureTotalBytes(storesForDb!) - existingLen + serialized.length;
                        if (nextTotal > options.maxTotalBytes) {
                          throw new Error(
                            `QuotaExceededError: IndexedDB quota (${options.maxTotalBytes} bytes) exceeded.`
                          );
                        }
                      }
                      backingMap.set(recordKey, serialized);
                      putReq.result = recordKey;
                      queueMicrotask(() => {
                        if (typeof putReq.onsuccess === 'function') putReq.onsuccess({ target: putReq });
                      });
                    } catch (err) {
                      const e = err instanceof Error ? err : new Error(String(err));
                      putReq.error = e;
                      tx.error = e;
                      queueMicrotask(() => {
                        if (typeof putReq.onerror === 'function') putReq.onerror({ target: putReq });
                        if (typeof tx.onerror === 'function') tx.onerror({ target: tx });
                      });
                    }
                    return putReq;
                  },
                  get(key: string) {
                    const getReq: any = { result: undefined, error: null, onsuccess: null, onerror: null };
                    queueMicrotask(() => {
                      const raw = backingMap.get(String(key));
                      getReq.result = raw ? JSON.parse(raw) : undefined;
                      if (typeof getReq.onsuccess === 'function') getReq.onsuccess({ target: getReq });
                    });
                    return getReq;
                  },
                  getAll() {
                    const allReq: any = { result: [], error: null, onsuccess: null, onerror: null };
                    queueMicrotask(() => {
                      const items: any[] = [];
                      for (const raw of backingMap.values()) {
                        items.push(JSON.parse(raw));
                      }
                      allReq.result = items;
                      if (typeof allReq.onsuccess === 'function') allReq.onsuccess({ target: allReq });
                    });
                    return allReq;
                  },
                  delete(key: string) {
                    const delReq: any = { result: undefined, error: null, onsuccess: null, onerror: null };
                    queueMicrotask(() => {
                      backingMap.delete(String(key));
                      if (typeof delReq.onsuccess === 'function') delReq.onsuccess({ target: delReq });
                    });
                    return delReq;
                  },
                  clear() {
                    const clrReq: any = { result: undefined, error: null, onsuccess: null, onerror: null };
                    queueMicrotask(() => {
                      backingMap.clear();
                      if (typeof clrReq.onsuccess === 'function') clrReq.onsuccess({ target: clrReq });
                    });
                    return clrReq;
                  },
                };
              },
            };

            queueMicrotask(() => {
              queueMicrotask(() => {
                if (tx.error) return;
                if (simulatedIdbFailure === 'transaction_error') {
                  tx.error = new Error('IndexedDB readwrite transaction aborted.');
                  if (typeof tx.onabort === 'function') tx.onabort({ target: tx });
                  else if (typeof tx.onerror === 'function') tx.onerror({ target: tx });
                  return;
                }
                if (simulatedIdbFailure === 'quota_exceeded' && mode === 'readwrite') {
                  tx.error = new Error('QuotaExceededError: IndexedDB storage quota exceeded.');
                  if (typeof tx.onerror === 'function') tx.onerror({ target: tx });
                  return;
                }
                if (typeof tx.oncomplete === 'function') {
                  tx.oncomplete({ target: tx });
                }
              });
            });

            return tx;
          },
        };

        req.result = dbInstance;
        if (version > currentVer) {
          dbVersions.set(name, version);
          if (typeof req.onupgradeneeded === 'function') {
            req.onupgradeneeded({ target: req });
          }
        }
        if (typeof req.onsuccess === 'function') {
          req.onsuccess({ target: req });
        }
      });

      return req as IDBOpenDBRequest;
    },
  };

  return factory as IDBFactory;
}

export function resetIdbStorageForTesting(): void {
  simulatedIdbFailure = 'none';
  const winObj = getActiveWindowObject();
  contextByWindow.set(winObj, {
    projectsMap: new Map<string, HtmlEditorProject>(),
    imageMappingsMap: new Map<string, ProductImageMappingRecord>(),
    catalogProductsMap: new Map<string, Product>(),
    metadataMap: new Map<string, MetadataRecord>(),
    activeProjectId: null,
    migrated: false,
    catalogMigrated: false,
    fallbackIdbFactory: createMockIndexedDbFactory(),
  });
}

/**
 * Simulates a real browser page reload by wiping all in-memory caches while preserving
 * the underlying IndexedDB database records (`fallbackIdbFactory` or `window.indexedDB`).
 */
export function simulateBrowserReloadForTesting(): void {
  const winObj = getActiveWindowObject();
  const existingState = contextByWindow.get(winObj);
  const preservedIdbFactory = existingState?.fallbackIdbFactory;
  contextByWindow.set(winObj, {
    projectsMap: new Map<string, HtmlEditorProject>(),
    imageMappingsMap: new Map<string, ProductImageMappingRecord>(),
    catalogProductsMap: new Map<string, Product>(),
    metadataMap: new Map<string, MetadataRecord>(),
    activeProjectId: null,
    migrated: false,
    catalogMigrated: false,
    fallbackIdbFactory: preservedIdbFactory || createMockIndexedDbFactory(),
  });
}

function getEffectiveIndexedDb(): IDBFactory | null | undefined {
  if (typeof window !== 'undefined' && window) {
    if ('indexedDB' in window) {
      return (window as any).indexedDB as IDBFactory | null | undefined;
    }
  }
  if (typeof indexedDB !== 'undefined') {
    return indexedDB;
  }
  // In Node/Vitest tests where `window` was mocked with `{ localStorage }` only,
  // use the context's spec-compliant mock IDBFactory so all transactions run through IDB.
  const state = getContextState();
  if (!state.fallbackIdbFactory) {
    state.fallbackIdbFactory = createMockIndexedDbFactory();
  }
  return state.fallbackIdbFactory;
}

function assertIdbOperational(): void {
  if (simulatedIdbFailure === 'unavailable') {
    throw new StorageDiagnosticError(
      'idb_unavailable',
      'IndexedDB unavailable: Failed to persist project to browser storage because IndexedDB is unavailable in this browser context.'
    );
  }
  if (simulatedIdbFailure === 'blocked') {
    throw new StorageDiagnosticError(
      'idb_unavailable',
      'IndexedDB unavailable: Failed to persist project to browser storage because IndexedDB connection is blocked by another open tab or locked storage.'
    );
  }
  if (simulatedIdbFailure === 'transaction_error') {
    throw new StorageDiagnosticError(
      'idb_unavailable',
      'IndexedDB unavailable: Failed to persist project to browser storage because the IndexedDB readwrite transaction aborted.'
    );
  }
  if (simulatedIdbFailure === 'quota_exceeded') {
    throw new StorageDiagnosticError(
      'idb_quota_exceeded',
      'IndexedDB quota exceeded: Failed to persist project to browser storage because browser disk quota was exceeded.'
    );
  }

  const winObj = typeof window !== 'undefined' ? (window as any) : undefined;
  if (winObj && 'indexedDB' in winObj && !winObj.indexedDB) {
    throw new StorageDiagnosticError(
      'idb_unavailable',
      'IndexedDB unavailable: Failed to persist project to browser storage because IndexedDB is disabled or null in this browser environment.'
    );
  }
}

/**
 * Opens the IndexedDB database and ensures all required object stores exist.
 */
function openNativeIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      assertIdbOperational();
    } catch (err) {
      reject(err);
      return;
    }

    const idbFactory = getEffectiveIndexedDb();
    if (!idbFactory || typeof idbFactory.open !== 'function') {
      reject(
        new StorageDiagnosticError(
          'idb_unavailable',
          'IndexedDB unavailable: IndexedDB is unavailable in this browser environment (private browsing restriction or disabled storage).'
        )
      );
      return;
    }

    let req: IDBOpenDBRequest;
    try {
      req = idbFactory.open(IDB_DATABASE_NAME, IDB_DATABASE_VERSION);
    } catch (err) {
      reject(classifyStorageFailure(err, 'idb'));
      return;
    }

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_HTML_PROJECTS_STORE)) {
        db.createObjectStore(IDB_HTML_PROJECTS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(IDB_IMAGE_MAPPINGS_STORE)) {
        db.createObjectStore(IDB_IMAGE_MAPPINGS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(IDB_METADATA_STORE)) {
        db.createObjectStore(IDB_METADATA_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(IDB_CATALOG_PRODUCTS_STORE)) {
        db.createObjectStore(IDB_CATALOG_PRODUCTS_STORE, { keyPath: 'id' });
      }
    };

    req.onblocked = () => {
      reject(
        new StorageDiagnosticError(
          'idb_unavailable',
          'IndexedDB unavailable: Database upgrade is blocked by another open tab. Close other tabs of this CMS and try saving again.'
        )
      );
    };

    req.onerror = () => {
      const reason = req.error?.message || 'Unknown IndexedDB open error';
      reject(classifyStorageFailure(new Error(`IndexedDB could not be opened: ${reason}`), 'idb'));
    };

    req.onsuccess = () => {
      resolve(req.result);
    };
  });
}

// ============================================================================
// METADATA PERSISTENCE IN INDEXEDDB + BEST-EFFORT LOCALSTORAGE POINTER
// ============================================================================

async function writeMetadataToIdb(key: string, value: any): Promise<void> {
  const state = getContextState();
  const record: MetadataRecord = {
    key,
    value,
    updatedAt: new Date().toISOString(),
  };
  const db = await openNativeIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_METADATA_STORE, 'readwrite');
    const store = tx.objectStore(IDB_METADATA_STORE);
    store.put(record);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      const err = tx.error || new Error('IndexedDB metadata write failed');
      db.close();
      reject(classifyStorageFailure(err, 'idb'));
    };
    tx.onabort = () => {
      const err = tx.error || new Error('IndexedDB metadata write aborted');
      db.close();
      reject(classifyStorageFailure(err, 'idb'));
    };
  });
  state.metadataMap.set(key, record);
}

async function readMetadataFromIdb<T = any>(key: string): Promise<T | null> {
  const state = getContextState();
  try {
    const db = await openNativeIdb();
    const record = await new Promise<MetadataRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(IDB_METADATA_STORE, 'readonly');
      const store = tx.objectStore(IDB_METADATA_STORE);
      const req = store.get(key);
      req.onsuccess = () => {
        db.close();
        resolve(req.result as MetadataRecord | undefined);
      };
      req.onerror = () => {
        db.close();
        reject(req.error);
      };
    });
    if (record && record.key === key) {
      state.metadataMap.set(key, record);
      return record.value as T;
    }
  } catch {
    // Fall back to in-memory metadata map if IDB read fails
  }
  const cached = state.metadataMap.get(key);
  return cached ? (cached.value as T) : null;
}

/**
 * Best-effort writer for lightweight metadata keys in `localStorage`.
 * Never throws or invalidates an IndexedDB project save if `localStorage` is full.
 */
function trySetLocalStorageLightweightItem(key: string, value: string): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    // If localStorage is full and projects have already been migrated to IndexedDB,
    // attempt to free any leftover legacy keys and retry once.
    const state = getContextState();
    if (state.migrated) {
      try {
        window.localStorage.removeItem(LEGACY_LOCAL_HTML_PROJECTS_KEY);
        window.localStorage.removeItem(LEGACY_SESSION_KEY_V2);
        window.localStorage.removeItem(LEGACY_CURRENT_HTML_KEY);
        window.localStorage.removeItem(LEGACY_ORIGINAL_HTML_KEY);
        window.localStorage.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

export function getActiveLocalHtmlProjectId(): string | null {
  const state = getContextState();
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const fromLs = window.localStorage.getItem(LOCAL_ACTIVE_HTML_PROJECT_ID_KEY);
      if (fromLs && fromLs.trim()) {
        state.activeProjectId = fromLs.trim();
        return state.activeProjectId;
      }
    } catch {
      // Ignore localStorage read restriction
    }
  }
  return state.activeProjectId;
}

export async function getActiveHtmlProjectIdAsync(): Promise<string | null> {
  const state = getContextState();
  const idbVal = await readMetadataFromIdb<string>(LOCAL_ACTIVE_HTML_PROJECT_ID_KEY);
  if (typeof idbVal === 'string' && idbVal.trim()) {
    state.activeProjectId = idbVal.trim();
    trySetLocalStorageLightweightItem(LOCAL_ACTIVE_HTML_PROJECT_ID_KEY, state.activeProjectId);
    return state.activeProjectId;
  }
  return getActiveLocalHtmlProjectId();
}

export function setActiveLocalHtmlProjectId(projectId: string): void {
  const clean = (projectId || '').trim();
  const state = getContextState();
  state.activeProjectId = clean || null;
  trySetLocalStorageLightweightItem(LOCAL_ACTIVE_HTML_PROJECT_ID_KEY, clean);
  if (simulatedIdbFailure === 'none') {
    void writeMetadataToIdb(LOCAL_ACTIVE_HTML_PROJECT_ID_KEY, clean).catch(() => {
      // Non-blocking background sync of active project pointer
    });
  }
}

// ============================================================================
// LEGACY LOCALSTORAGE EXTRACTION & IDEMPOTENT MIGRATION
// ============================================================================

/**
 * Extracts any unmigrated HTML projects from `localStorage` without deleting them yet.
 */
export function extractUnmigratedProjectsFromLocalStorage(): {
  projects: HtmlEditorProject[];
  foundLegacyKeys: string[];
} {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { projects: [], foundLegacyKeys: [] };
  }

  const foundLegacyKeys: string[] = [];
  const extractedById = new Map<string, HtmlEditorProject>();

  try {
    const rawList = window.localStorage.getItem(LEGACY_LOCAL_HTML_PROJECTS_KEY);
    if (rawList !== null) {
      foundLegacyKeys.push(LEGACY_LOCAL_HTML_PROJECTS_KEY);
      const parsed = JSON.parse(rawList);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const normalized = normalizeStoredProjectRecord(item);
          if (normalized) {
            const existing = extractedById.get(normalized.id);
            if (!existing || normalized.updatedAt >= existing.updatedAt) {
              extractedById.set(normalized.id, normalized);
            }
          }
        }
      }
    }

    const legacySessionRaw = window.localStorage.getItem(LEGACY_SESSION_KEY_V2);
    const legacyCurrent = window.localStorage.getItem(LEGACY_CURRENT_HTML_KEY);
    const legacyOriginal = window.localStorage.getItem(LEGACY_ORIGINAL_HTML_KEY);

    if (legacySessionRaw !== null) foundLegacyKeys.push(LEGACY_SESSION_KEY_V2);
    if (legacyCurrent !== null) foundLegacyKeys.push(LEGACY_CURRENT_HTML_KEY);
    if (legacyOriginal !== null) foundLegacyKeys.push(LEGACY_ORIGINAL_HTML_KEY);

    let migratedCurrent = '';
    let migratedOriginal = '';
    let migratedName = 'Greek Mythology Gift Guide';
    let migratedId = 'proj-greek-mythology-default';

    if (legacyCurrent && legacyCurrent.trim()) {
      migratedCurrent = legacyCurrent;
      migratedOriginal =
        legacyOriginal && legacyOriginal.trim() ? legacyOriginal : legacyCurrent;
    } else if (legacySessionRaw) {
      try {
        const parsedSession = JSON.parse(legacySessionRaw);
        if (typeof parsedSession?.currentHtml === 'string' && parsedSession.currentHtml.trim()) {
          migratedCurrent = parsedSession.currentHtml;
          migratedOriginal =
            typeof parsedSession?.originalHtml === 'string' && parsedSession.originalHtml.trim()
              ? parsedSession.originalHtml
              : parsedSession.currentHtml;
          if (typeof parsedSession?.name === 'string' && parsedSession.name.trim()) {
            migratedName = parsedSession.name.trim();
          }
          if (typeof parsedSession?.id === 'string' && parsedSession.id.trim()) {
            migratedId = parsedSession.id.trim();
          }
        }
      } catch {
        // ignore malformed legacy session json
      }
    }

    if (migratedCurrent && !extractedById.has(migratedId)) {
      const nowIso = new Date().toISOString();
      const migratedProject = ensureProjectHasSections({
        id: migratedId,
        ownerId: 'local-preview',
        name: migratedName,
        currentHtml: migratedCurrent,
        originalHtml: migratedOriginal,
        baseUrl: 'https://scienceofgifts.com',
        editorState: { ...DEFAULT_HTML_EDITOR_STATE },
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      extractedById.set(migratedProject.id, migratedProject);
    }
  } catch {
    return { projects: Array.from(extractedById.values()), foundLegacyKeys };
  }

  return { projects: Array.from(extractedById.values()), foundLegacyKeys };
}

/**
 * Safe, idempotent migration from `localStorage` to IndexedDB:
 * 1. Detects legacy records in `localStorage`.
 * 2. Reads existing records in IndexedDB so newer IndexedDB records are never overwritten.
 * 3. Copies unmigrated or newer legacy records to IndexedDB (`html_projects` store).
 * 4. Reads back from IndexedDB and verifies every project's `id`, `name`, `currentHtml`, and `originalHtml`.
 * 5. Only after verification passes, removes the legacy keys from `localStorage`.
 */
export async function migrateLocalStorageProjectsToIdb(): Promise<{
  migrated: boolean;
  alreadyMigrated: boolean;
  migratedCount: number;
  projects: HtmlEditorProject[];
}> {
  const state = getContextState();
  const { projects: legacyProjects, foundLegacyKeys } = extractUnmigratedProjectsFromLocalStorage();

  if (legacyProjects.length === 0) {
    assertIdbOperational();
    const existingIdbProjects = await readAllProjectsFromBackingStore();
    if (foundLegacyKeys.length > 0 && typeof window !== 'undefined' && window.localStorage) {
      for (const key of foundLegacyKeys) {
        try {
          window.localStorage.removeItem(key);
        } catch {
          // ignore
        }
      }
    }
    state.migrated = true;
    return {
      migrated: false,
      alreadyMigrated: true,
      migratedCount: 0,
      projects: existingIdbProjects,
    };
  }

  try {
    assertIdbOperational();
    // Always read existing IndexedDB projects first so we never lose or overwrite newer records
    const existingIdbProjects = await readAllProjectsFromBackingStore();
    const existingMap = new Map(existingIdbProjects.map((p) => [p.id, p]));

    // Determine which records to write while preserving any newer existing IndexedDB record
    const projectsToWrite: HtmlEditorProject[] = [];
    const expectedFinalById = new Map<string, HtmlEditorProject>();

    for (const legacyProj of legacyProjects) {
      const existing = existingMap.get(legacyProj.id);
      if (
        existing &&
        existing.currentHtml.trim().length > 0 &&
        existing.updatedAt >= legacyProj.updatedAt
      ) {
        // Preserve newer record already in IndexedDB
        expectedFinalById.set(existing.id, existing);
      } else {
        projectsToWrite.push(legacyProj);
        expectedFinalById.set(legacyProj.id, legacyProj);
      }
    }
    if (projectsToWrite.length > 0) {
      await writeProjectsToBackingStore(projectsToWrite);
    }

    if (simulatedIdbFailure === 'verification_mismatch') {
      throw new StorageDiagnosticError(
        'migration_failure',
        'Migration failure: IndexedDB write verification failed (read-back project count or content did not match localStorage source). Preserving localStorage data.'
      );
    }

    // Read back from IndexedDB to verify integrity before removing anything from localStorage
    const readBackProjects = await readAllProjectsFromBackingStore();
    const readBackMap = new Map(readBackProjects.map((p) => [p.id, p]));

    for (const [projId, expectedProj] of expectedFinalById.entries()) {
      const verified = readBackMap.get(projId);
      if (
        !verified ||
        verified.name !== expectedProj.name ||
        verified.currentHtml !== expectedProj.currentHtml ||
        verified.originalHtml !== expectedProj.originalHtml
      ) {
        throw new StorageDiagnosticError(
          'migration_failure',
          `Migration failure: IndexedDB verification failed for project "${projId}". Original localStorage data has been preserved.`
        );
      }
    }

    // Update synchronous cache with verified IndexedDB state
    for (const proj of readBackProjects) {
      state.projectsMap.set(proj.id, proj);
    }
    state.migrated = true;

    const migrationMeta = {
      migrated: true,
      version: 2,
      migratedCount: legacyProjects.length,
      migratedAt: new Date().toISOString(),
    };

    // Persist migration marker in IndexedDB
    await writeMetadataToIdb(LOCAL_HTML_PROJECTS_MIGRATED_KEY, migrationMeta);

    // Only after verification succeeds, remove the large project keys from localStorage
    if (typeof window !== 'undefined' && window.localStorage) {
      for (const key of foundLegacyKeys) {
        try {
          window.localStorage.removeItem(key);
        } catch {
          // ignore remove error
        }
      }
      trySetLocalStorageLightweightItem(
        LOCAL_HTML_PROJECTS_MIGRATED_KEY,
        JSON.stringify(migrationMeta)
      );
      const currentActive = getActiveLocalHtmlProjectId();
      if (!currentActive && legacyProjects[0]) {
        setActiveLocalHtmlProjectId(legacyProjects[0].id);
      }
    }

    return {
      migrated: true,
      alreadyMigrated: false,
      migratedCount: legacyProjects.length,
      projects: getSortedProjectsFromMap(state.projectsMap),
    };
  } catch (err) {
    throw classifyStorageFailure(err, 'migration');
  }
}

function getSortedProjectsFromMap(map: Map<string, HtmlEditorProject>): HtmlEditorProject[] {
  return Array.from(map.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function writeProjectsToBackingStore(projects: HtmlEditorProject[]): Promise<void> {
  assertIdbOperational();
  if (simulatedIdbFailure === 'verification_mismatch') {
    throw new StorageDiagnosticError(
      'migration_failure',
      'IndexedDB write verification failed: stored project record could not be verified after write.'
    );
  }
  const state = getContextState();
  const db = await openNativeIdb();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_HTML_PROJECTS_STORE, 'readwrite');
    const store = tx.objectStore(IDB_HTML_PROJECTS_STORE);
    for (const proj of projects) {
      store.put(proj);
    }
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      const msg = tx.error?.message || 'IndexedDB write transaction failed';
      db.close();
      reject(
        classifyStorageFailure(
          new Error(`Failed to persist project to browser storage (IndexedDB): ${msg}`),
          'idb'
        )
      );
    };
    tx.onabort = () => {
      const msg = tx.error?.message || 'IndexedDB write transaction aborted';
      db.close();
      reject(
        classifyStorageFailure(
          new Error(`Failed to persist project to browser storage (IndexedDB): ${msg}`),
          'idb'
        )
      );
    };
  });

  // Read back and verify written records in IndexedDB before updating in-memory state or reporting success
  const verifyDb = await openNativeIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = verifyDb.transaction(IDB_HTML_PROJECTS_STORE, 'readonly');
    const store = tx.objectStore(IDB_HTML_PROJECTS_STORE);
    let pending = projects.length;
    if (pending === 0) {
      verifyDb.close();
      resolve();
      return;
    }
    let failed = false;
    for (const expected of projects) {
      const req = store.get(expected.id);
      req.onsuccess = () => {
        if (failed) return;
        const stored = req.result as HtmlEditorProject | undefined;
        if (
          !stored ||
          stored.id !== expected.id ||
          stored.currentHtml !== expected.currentHtml
        ) {
          failed = true;
          verifyDb.close();
          reject(
            new StorageDiagnosticError(
              'migration_failure',
              `IndexedDB write verification failed: project "${expected.id}" read-back did not match written HTML content.`
            )
          );
          return;
        }
        pending -= 1;
        if (pending === 0) {
          verifyDb.close();
          resolve();
        }
      };
      req.onerror = () => {
        if (failed) return;
        failed = true;
        verifyDb.close();
        reject(
          classifyStorageFailure(
            new Error(`Failed to verify project "${expected.id}" in IndexedDB.`),
            'idb'
          )
        );
      };
    }
  });

  for (const proj of projects) {
    state.projectsMap.set(proj.id, proj);
  }
}

async function readAllProjectsFromBackingStore(): Promise<HtmlEditorProject[]> {
  assertIdbOperational();
  const state = getContextState();
  const db = await openNativeIdb();

  const rawItems = await new Promise<any[]>((resolve, reject) => {
    const tx = db.transaction(IDB_HTML_PROJECTS_STORE, 'readonly');
    const store = tx.objectStore(IDB_HTML_PROJECTS_STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      db.close();
      resolve(Array.isArray(req.result) ? req.result : []);
    };
    req.onerror = () => {
      const msg = req.error?.message || 'IndexedDB read transaction failed';
      db.close();
      reject(classifyStorageFailure(new Error(`Failed to load projects from IndexedDB: ${msg}`), 'idb'));
    };
  });

  state.projectsMap.clear();
  const normalized: HtmlEditorProject[] = [];
  for (const item of rawItems) {
    const norm = normalizeStoredProjectRecord(item);
    if (norm) {
      normalized.push(norm);
      state.projectsMap.set(norm.id, norm);
    }
  }
  return normalized.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function deleteProjectFromBackingStore(projectId: string): Promise<void> {
  assertIdbOperational();
  const state = getContextState();
  const db = await openNativeIdb();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_HTML_PROJECTS_STORE, 'readwrite');
    const store = tx.objectStore(IDB_HTML_PROJECTS_STORE);
    store.delete(projectId);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      const msg = tx.error?.message || 'IndexedDB delete transaction failed';
      db.close();
      reject(
        classifyStorageFailure(new Error(`Failed to delete project from IndexedDB: ${msg}`), 'idb')
      );
    };
  });

  state.projectsMap.delete(projectId);
}

/**
 * Hydrates the IndexedDB project collection (running safe migration from `localStorage` if needed),
 * hydrates the global Fourthwall Header CSS reference non-destructively, and returns the sorted project list.
 */
export async function hydrateHtmlProjectsFromIdb(): Promise<HtmlEditorProject[]> {
  await migrateLocalStorageProjectsToIdb();
  await getActiveHtmlProjectIdAsync();
  await hydrateFourthwallHeaderCssFromIdb().catch(() => {
    // Keep existing header CSS if metadata hydration encounters a transient read issue
  });
  return readAllProjectsFromBackingStore();
}

/**
 * Persists a single `HtmlEditorProject` into IndexedDB and updates the active project ID pointer
 * in both IndexedDB metadata and (best-effort) `localStorage`.
 * A `localStorage` quota error on the lightweight active-project pointer NEVER invalidates a successful IndexedDB save.
 */
export async function saveHtmlProjectToIdb(project: HtmlEditorProject): Promise<HtmlEditorProject> {
  await migrateLocalStorageProjectsToIdb();
  await writeProjectsToBackingStore([project]);

  const state = getContextState();
  state.activeProjectId = project.id;

  // Persist active project ID in IndexedDB metadata so it is always recoverable even when localStorage is full
  try {
    await writeMetadataToIdb(LOCAL_ACTIVE_HTML_PROJECT_ID_KEY, project.id);
  } catch {
    // Metadata write is secondary to the verified html_projects store write
  }

  // Best-effort mirror to localStorage; never throw if localStorage quota is exhausted
  trySetLocalStorageLightweightItem(LOCAL_ACTIVE_HTML_PROJECT_ID_KEY, project.id);

  return project;
}

/**
 * Syncs a batch of projects in IndexedDB without overwriting newer unsynced local changes.
 * Never writes full project records to `localStorage`.
 */
export async function saveHtmlProjectsBatchToIdb(
  projects: HtmlEditorProject[]
): Promise<HtmlEditorProject[]> {
  assertIdbOperational();
  const normalized = projects
    .map((p) => normalizeStoredProjectRecord(p))
    .filter((p): p is HtmlEditorProject => p !== null);

  if (normalized.length > 0) {
    await writeProjectsToBackingStore(normalized);
  }
  return readAllProjectsFromBackingStore();
}

/**
 * Deletes a single project from IndexedDB and updates the active project ID pointer.
 */
export async function removeHtmlProjectFromIdb(projectId: string): Promise<HtmlEditorProject[]> {
  await migrateLocalStorageProjectsToIdb();
  await deleteProjectFromBackingStore(projectId);
  const remaining = await readAllProjectsFromBackingStore();

  const currentActive = getActiveLocalHtmlProjectId();
  if (currentActive === projectId) {
    const nextActiveId = remaining[0]?.id || '';
    setActiveLocalHtmlProjectId(nextActiveId);
  }

  return remaining;
}

/**
 * Synchronous accessor returning the hydrated IndexedDB projects cache.
 * If legacy `localStorage` data is present and has not yet been migrated in this context,
 * it hydrates the cache immediately and triggers the verified IndexedDB migration.
 */
export function getCachedHtmlProjectsSync(): HtmlEditorProject[] {
  const state = getContextState();
  const { projects: unmigrated } = extractUnmigratedProjectsFromLocalStorage();
  if (unmigrated.length > 0) {
    for (const p of unmigrated) {
      const existing = state.projectsMap.get(p.id);
      if (!existing || p.updatedAt > existing.updatedAt) {
        state.projectsMap.set(p.id, p);
      }
    }
    if (simulatedIdbFailure === 'none') {
      void migrateLocalStorageProjectsToIdb().catch(() => {
        // Keep localStorage untouched if background migration fails
      });
    }
  }
  return getSortedProjectsFromMap(state.projectsMap);
}

// ============================================================================
// PRODUCT CATALOG STORAGE IN INDEXEDDB (MIGRATING sog_catalog_products_v2)
// ============================================================================

export async function hydrateCatalogProductsFromIdb(
  hydrateRecord?: (raw: Product) => Product
): Promise<Product[]> {
  assertIdbOperational();
  const state = getContextState();
  const db = await openNativeIdb();

  const existingItems = await new Promise<Product[]>((resolve, reject) => {
    const tx = db.transaction(IDB_CATALOG_PRODUCTS_STORE, 'readonly');
    const store = tx.objectStore(IDB_CATALOG_PRODUCTS_STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      db.close();
      resolve(Array.isArray(req.result) ? req.result : []);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });

  for (const item of existingItems) {
    if (item && typeof item.id === 'string') {
      state.catalogProductsMap.set(item.id, hydrateRecord ? hydrateRecord(item) : item);
    }
  }

  // Check if legacy sog_catalog_products_v2 exists in localStorage and migrate non-destructively
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const rawLs = window.localStorage.getItem(LOCAL_PRODUCTS_STORAGE_KEY);
      if (rawLs) {
        const parsed = JSON.parse(rawLs);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const toMigrate: Product[] = [];
          for (const rawProd of parsed) {
            if (rawProd && typeof rawProd.id === 'string') {
              const normProd = hydrateRecord ? hydrateRecord(rawProd) : (rawProd as Product);
              const existing = state.catalogProductsMap.get(normProd.id);
              if (
                !existing ||
                (normProd.updatedAt &&
                  existing.updatedAt &&
                  String(normProd.updatedAt) > String(existing.updatedAt))
              ) {
                toMigrate.push(normProd);
                state.catalogProductsMap.set(normProd.id, normProd);
              }
            }
          }

          if (toMigrate.length > 0) {
            await saveCatalogProductsToIdb(Array.from(state.catalogProductsMap.values()));
          }

          // Verify read-back count before removing large catalog key from localStorage
          const verifyDb = await openNativeIdb();
          const verifiedItems = await new Promise<Product[]>((resolve, reject) => {
            const tx = verifyDb.transaction(IDB_CATALOG_PRODUCTS_STORE, 'readonly');
            const store = tx.objectStore(IDB_CATALOG_PRODUCTS_STORE);
            const req = store.getAll();
            req.onsuccess = () => {
              verifyDb.close();
              resolve(Array.isArray(req.result) ? req.result : []);
            };
            req.onerror = () => {
              verifyDb.close();
              reject(req.error);
            };
          });

          if (verifiedItems.length >= state.catalogProductsMap.size) {
            window.localStorage.removeItem(LOCAL_PRODUCTS_STORAGE_KEY);
            trySetLocalStorageLightweightItem(
              LOCAL_CATALOG_PRODUCTS_MIGRATED_KEY,
              JSON.stringify({
                migrated: true,
                count: verifiedItems.length,
                migratedAt: new Date().toISOString(),
              })
            );
          }
        }
      }
    } catch {
      // Preserve localStorage catalog untouched if migration encounters an error
    }
  }

  state.catalogMigrated = true;
  return Array.from(state.catalogProductsMap.values());
}

export async function saveCatalogProductsToIdb(products: Product[]): Promise<Product[]> {
  assertIdbOperational();
  const state = getContextState();
  const previousEntries = Array.from(state.catalogProductsMap.entries());
  state.catalogProductsMap.clear();
  for (const prod of products) {
    if (prod && typeof prod.id === 'string') {
      state.catalogProductsMap.set(prod.id, prod);
    }
  }

  try {
    const db = await openNativeIdb();

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_CATALOG_PRODUCTS_STORE, 'readwrite');
      const store = tx.objectStore(IDB_CATALOG_PRODUCTS_STORE);
      store.clear();
      for (const prod of products) {
        if (prod && typeof prod.id === 'string') {
          store.put(prod);
        }
      }
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        const err = tx.error || new Error('IndexedDB catalog write failed');
        db.close();
        reject(classifyStorageFailure(err, 'idb'));
      };
    });
  } catch (err) {
    state.catalogProductsMap.clear();
    for (const [k, v] of previousEntries) {
      state.catalogProductsMap.set(k, v);
    }
    throw err;
  }

  // Remove legacy large localStorage catalog key if present so localStorage quota stays free
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      if (window.localStorage.getItem(LOCAL_PRODUCTS_STORAGE_KEY) !== null) {
        window.localStorage.removeItem(LOCAL_PRODUCTS_STORAGE_KEY);
      }
    } catch {
      // ignore
    }
  }

  return Array.from(state.catalogProductsMap.values());
}

export function getCachedCatalogProductsSync(
  hydrateRecord?: (raw: Product) => Product
): Product[] | null {
  const state = getContextState();
  if (state.catalogProductsMap.size > 0) {
    return Array.from(state.catalogProductsMap.values());
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = window.localStorage.getItem(LOCAL_PRODUCTS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const items = (parsed as Product[]).map((p) => (hydrateRecord ? hydrateRecord(p) : p));
          for (const item of items) {
            if (item && item.id) {
              state.catalogProductsMap.set(item.id, item);
            }
          }
          if (simulatedIdbFailure === 'none') {
            void hydrateCatalogProductsFromIdb(hydrateRecord).catch(() => {});
          }
          return items;
        }
      }
    } catch {
      return null;
    }
  }
  return null;
}

// ============================================================================
// PRODUCT IMAGE MAPPING STORAGE IN INDEXEDDB
// ============================================================================

export async function getAllImageMappingsFromIdb(): Promise<ProductImageMappingRecord[]> {
  assertIdbOperational();
  const state = getContextState();
  const db = await openNativeIdb();
  const items = await new Promise<ProductImageMappingRecord[]>((resolve, reject) => {
    const tx = db.transaction(IDB_IMAGE_MAPPINGS_STORE, 'readonly');
    const store = tx.objectStore(IDB_IMAGE_MAPPINGS_STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      db.close();
      resolve(Array.isArray(req.result) ? req.result : []);
    };
    req.onerror = () => {
      db.close();
      reject(classifyStorageFailure(req.error, 'idb'));
    };
  });
  state.imageMappingsMap.clear();
  for (const item of items) {
    if (item && item.id) {
      state.imageMappingsMap.set(item.id, item);
    }
  }
  return Array.from(state.imageMappingsMap.values());
}

export function getCachedImageMappingsSync(): ProductImageMappingRecord[] {
  return Array.from(getContextState().imageMappingsMap.values());
}

export async function saveImageMappingsToIdb(
  records: ProductImageMappingRecord[]
): Promise<ProductImageMappingRecord[]> {
  assertIdbOperational();
  const state = getContextState();
  const db = await openNativeIdb();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_IMAGE_MAPPINGS_STORE, 'readwrite');
    const store = tx.objectStore(IDB_IMAGE_MAPPINGS_STORE);
    for (const rec of records) {
      store.put(rec);
    }
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      const msg = tx.error?.message || 'IndexedDB image mapping write failed';
      db.close();
      reject(
        classifyStorageFailure(
          new Error(`Failed to persist image mappings to IndexedDB: ${msg}`),
          'idb'
        )
      );
    };
  });

  for (const rec of records) {
    state.imageMappingsMap.set(rec.id, rec);
  }
  return Array.from(state.imageMappingsMap.values());
}

export async function deleteImageMappingFromIdb(mappingId: string): Promise<void> {
  assertIdbOperational();
  const state = getContextState();
  const db = await openNativeIdb();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_IMAGE_MAPPINGS_STORE, 'readwrite');
    const store = tx.objectStore(IDB_IMAGE_MAPPINGS_STORE);
    store.delete(mappingId);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(classifyStorageFailure(tx.error, 'idb'));
    };
  });

  state.imageMappingsMap.delete(mappingId);
}

// ============================================================================
// GLOBAL FOURTHWALL HEADER CSS (LIVE PREVIEW REFERENCE) IN INDEXEDDB
// ============================================================================

export function getDefaultFourthwallHeaderCssSetting(): FourthwallHeaderCssSetting {
  return {
    currentCss: DEFAULT_GIFT_GUIDE_CSS,
    previousCss: null,
    updatedAt: '',
    isCustomized: false,
    syncStatus: 'saved_local_only',
  };
}

function normalizeStoredHeaderCssRecord(raw: unknown): FourthwallHeaderCssSetting | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Partial<FourthwallHeaderCssSetting>;
  if (typeof obj.currentCss !== 'string' || !obj.currentCss.trim()) return null;
  const normalizedCurrent = normalizeHeaderCssInput(obj.currentCss);
  if (!normalizedCurrent) return null;
  const normalizedPrev =
    typeof obj.previousCss === 'string' && obj.previousCss.trim()
      ? normalizeHeaderCssInput(obj.previousCss)
      : null;

  return {
    currentCss: normalizedCurrent,
    previousCss: normalizedPrev || null,
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : '',
    isCustomized:
      typeof obj.isCustomized === 'boolean'
        ? obj.isCustomized
        : normalizedCurrent !== DEFAULT_GIFT_GUIDE_CSS,
    syncStatus: obj.syncStatus || 'saved_local_only',
    ...(typeof obj.syncDiagnostic === 'string' ? { syncDiagnostic: obj.syncDiagnostic } : {}),
  };
}

function dispatchHeaderCssUpdatedEvent(setting: FourthwallHeaderCssSetting): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      window.dispatchEvent(
        new CustomEvent(FOURTHWALL_HEADER_CSS_UPDATED_EVENT, { detail: setting })
      );
    } catch {
      // Ignore CustomEvent dispatch error in non-DOM test environments
    }
  }
}

export function getCachedFourthwallHeaderCssSync(): FourthwallHeaderCssSetting {
  const state = getContextState();
  const cachedMeta = state.metadataMap.get(GLOBAL_FOURTHWALL_HEADER_CSS_KEY);
  if (cachedMeta) {
    const normalized = normalizeStoredHeaderCssRecord(cachedMeta.value);
    if (normalized) {
      return normalized;
    }
  }
  return getDefaultFourthwallHeaderCssSetting();
}

/**
 * Hydrates the global Fourthwall Header CSS reference from IndexedDB without ever overwriting
 * existing saved Header CSS during initialization, migration, or project switching.
 */
export async function hydrateFourthwallHeaderCssFromIdb(): Promise<FourthwallHeaderCssSetting> {
  assertIdbOperational();
  const state = getContextState();
  const db = await openNativeIdb();

  const rawRecord = await new Promise<MetadataRecord | undefined>((resolve, reject) => {
    const tx = db.transaction(IDB_METADATA_STORE, 'readonly');
    const store = tx.objectStore(IDB_METADATA_STORE);
    const req = store.get(GLOBAL_FOURTHWALL_HEADER_CSS_KEY);
    req.onsuccess = () => {
      db.close();
      resolve(req.result as MetadataRecord | undefined);
    };
    req.onerror = () => {
      const err = req.error || new Error('IndexedDB header CSS read failed');
      db.close();
      reject(classifyStorageFailure(err, 'idb'));
    };
  });

  if (rawRecord && rawRecord.key === GLOBAL_FOURTHWALL_HEADER_CSS_KEY) {
    const normalized = normalizeStoredHeaderCssRecord(rawRecord.value);
    if (normalized) {
      state.metadataMap.set(GLOBAL_FOURTHWALL_HEADER_CSS_KEY, {
        key: GLOBAL_FOURTHWALL_HEADER_CSS_KEY,
        value: normalized,
        updatedAt: rawRecord.updatedAt || normalized.updatedAt || new Date().toISOString(),
      });
      return normalized;
    }
  }

  return getCachedFourthwallHeaderCssSync();
}

async function writeAndVerifyHeaderCssInIdb(
  setting: FourthwallHeaderCssSetting
): Promise<FourthwallHeaderCssSetting> {
  assertIdbOperational();
  if (simulatedIdbFailure === 'verification_mismatch') {
    throw new StorageDiagnosticError(
      'migration_failure',
      'IndexedDB write verification failed: stored Fourthwall Header CSS could not be verified after write.'
    );
  }

  const state = getContextState();
  const record: MetadataRecord = {
    key: GLOBAL_FOURTHWALL_HEADER_CSS_KEY,
    value: setting,
    updatedAt: setting.updatedAt || new Date().toISOString(),
  };

  const db = await openNativeIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_METADATA_STORE, 'readwrite');
    const store = tx.objectStore(IDB_METADATA_STORE);
    store.put(record);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      const err = tx.error || new Error('IndexedDB header CSS write failed');
      db.close();
      reject(
        classifyStorageFailure(
          new Error(`Failed to persist Fourthwall Header CSS to IndexedDB: ${err.message}`),
          'idb'
        )
      );
    };
    tx.onabort = () => {
      const err = tx.error || new Error('IndexedDB header CSS write aborted');
      db.close();
      reject(
        classifyStorageFailure(
          new Error(`Failed to persist Fourthwall Header CSS to IndexedDB: ${err.message}`),
          'idb'
        )
      );
    };
  });

  // Read back from IndexedDB and verify integrity before updating in-memory state or reporting Saved
  const verifyDb = await openNativeIdb();
  const verifiedRecord = await new Promise<MetadataRecord | undefined>((resolve, reject) => {
    const tx = verifyDb.transaction(IDB_METADATA_STORE, 'readonly');
    const store = tx.objectStore(IDB_METADATA_STORE);
    const req = store.get(GLOBAL_FOURTHWALL_HEADER_CSS_KEY);
    req.onsuccess = () => {
      verifyDb.close();
      resolve(req.result as MetadataRecord | undefined);
    };
    req.onerror = () => {
      const err = req.error || new Error('IndexedDB header CSS verification read failed');
      verifyDb.close();
      reject(classifyStorageFailure(err, 'idb'));
    };
  });

  const verifiedSetting = normalizeStoredHeaderCssRecord(verifiedRecord?.value);
  if (!verifiedSetting || verifiedSetting.currentCss !== setting.currentCss) {
    throw new StorageDiagnosticError(
      'migration_failure',
      'IndexedDB write verification failed: Fourthwall Header CSS read-back did not match written stylesheet.'
    );
  }

  state.metadataMap.set(GLOBAL_FOURTHWALL_HEADER_CSS_KEY, {
    key: GLOBAL_FOURTHWALL_HEADER_CSS_KEY,
    value: verifiedSetting,
    updatedAt: verifiedSetting.updatedAt,
  });

  dispatchHeaderCssUpdatedEvent(verifiedSetting);
  return verifiedSetting;
}

/**
 * Normalizes and persists an updated Fourthwall Header CSS stylesheet in IndexedDB,
 * automatically preserving the previous saved version so it can be restored if needed.
 */
export async function saveFourthwallHeaderCssToIdb(
  nextCssInput: string,
  options?: {
    preservePreviousOverride?: string | null;
    updatedAt?: string;
    syncStatus?: HtmlProjectSyncStatus;
    syncDiagnostic?: string;
  }
): Promise<FourthwallHeaderCssSetting> {
  if (typeof nextCssInput !== 'string') {
    throw new StorageDiagnosticError(
      'validation_error',
      'Fourthwall Header CSS must be a valid string.'
    );
  }
  const normalizedCss = normalizeHeaderCssInput(nextCssInput);
  if (!normalizedCss) {
    throw new StorageDiagnosticError(
      'validation_error',
      'Fourthwall Header CSS cannot be empty. Paste a valid CSS stylesheet.'
    );
  }

  const existing = await hydrateFourthwallHeaderCssFromIdb();
  const nextPreviousCss =
    options?.preservePreviousOverride !== undefined
      ? options.preservePreviousOverride
        ? normalizeHeaderCssInput(options.preservePreviousOverride)
        : null
      : existing.currentCss && existing.currentCss !== normalizedCss
      ? existing.currentCss
      : existing.previousCss;

  const nowIso = options?.updatedAt || new Date().toISOString();
  const nextSetting: FourthwallHeaderCssSetting = {
    currentCss: normalizedCss,
    previousCss: nextPreviousCss || null,
    updatedAt: nowIso,
    isCustomized: normalizedCss !== DEFAULT_GIFT_GUIDE_CSS,
    syncStatus: options?.syncStatus || 'saved_local_only',
    ...(options?.syncDiagnostic ? { syncDiagnostic: options.syncDiagnostic } : {}),
  };

  return writeAndVerifyHeaderCssInIdb(nextSetting);
}

/**
 * Restores the previous saved version of the Fourthwall Header CSS in IndexedDB.
 */
export async function restorePreviousFourthwallHeaderCssInIdb(): Promise<FourthwallHeaderCssSetting> {
  const existing = await hydrateFourthwallHeaderCssFromIdb();
  if (!existing.previousCss || !existing.previousCss.trim()) {
    throw new StorageDiagnosticError(
      'validation_error',
      'No previous Fourthwall Header CSS version is available to restore.'
    );
  }

  const restoredCss = normalizeHeaderCssInput(existing.previousCss);
  const nowIso = new Date().toISOString();
  const restoredSetting: FourthwallHeaderCssSetting = {
    currentCss: restoredCss,
    previousCss: existing.currentCss,
    updatedAt: nowIso,
    isCustomized: restoredCss !== DEFAULT_GIFT_GUIDE_CSS,
    syncStatus: 'saved_local_only',
  };

  return writeAndVerifyHeaderCssInIdb(restoredSetting);
}

// Register global Header CSS provider with htmlWorkspaceEngine so Live Preview iframe always uses it
registerFourthwallHeaderCssProvider(() => {
  const current = getCachedFourthwallHeaderCssSync();
  return {
    currentCss: current.currentCss,
    isCustomized: current.isCustomized,
  };
});

